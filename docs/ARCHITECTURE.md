# Architecture

PrisonBreak separates local retrieval, network-backed research, adversarial comparison, and the final handoff because each step has a different evidence boundary.

```text
Uploaded case documents
    │
    ├── Local files + SQLite metadata
    │
    └── Local parsing and FastEmbed embeddings
            │
            └── Persistent Qdrant local-mode index
                    │
                    ├── Citation-checked case fact extraction
                    │       └── Selected Anthropic or OpenAI API
                    │
                    └── Bounded research briefs
                            └── Codex CLI or Claude CLI web search
                                    │
                                    └── Candidate official sources
                                            │
                                            ├── Independently fetched snapshots
                                            ├── Source ledger + content hashes
                                            └── Qdrant research corpora
                                                    │
                                                    ├── Prosecutor pass
                                                    ├── Defense pass
                                                    └── Grounded comparison
                                                            │
                                                            ├── Take-to-Trial view
                                                            └── Defender Handoff
```

## Local retrieval

The TypeScript server invokes the Python worker under `server/rag/`. The production retrieval path parses TXT, Markdown, HTML, PDF, and DOCX files, chunks their text, creates embeddings locally with FastEmbed, and stores the vectors and citation payloads in Qdrant's persistent local mode. Each retrieved passage includes a stable citation ID, source ID and label, content hashes, a locator, and the verbatim passage.

This parser does not perform OCR. A scan-only PDF must be converted to a text-readable PDF before PrisonBreak can index it.

## Case fact extraction

Analyze indexes the uploaded documents before asking the configured Anthropic or OpenAI model to build a neutral fact sheet from retrieved passages. A non-null fact survives only when its quoted provenance can be matched back to the exact Qdrant citation that was supplied to the model. Unsupported fields are cleared rather than inferred.

This step is not local-only: the selected API provider receives the retrieved passages used for fact extraction.

## Web research and source admission

Grow creates bounded research briefs from structured case details such as jurisdiction, charges or statutes, court level, and relevant evidence types. A locally installed Codex CLI or Claude CLI performs live web research and returns candidate primary sources. The CLI is network-backed even though it is launched from the local application.

CLI output is treated as discovery data, not as evidence. PrisonBreak independently validates and fetches each admitted URL, retains a hash-addressed snapshot under `data/research/`, records it in the source ledger, and indexes the snapshot into a case-scoped Qdrant research corpus. A source that cannot be fetched and retained is not admitted to grounded comparison.

## Grounded comparison

Take to Trial runs separate prosecutor and defense passes through the configured Anthropic or OpenAI provider. Tool calls retrieve passages from the local case and research corpora. The comparison layer accepts only citations that were actually returned by those retrieval calls, and the defender-handoff verifier resolves citations back to Qdrant before preserving them.

The resulting Take-to-Trial view is a map of agreements, disagreements, and narrow factual or legal pivots. The Defender Handoff is generated separately and is limited to no more than three source-linked questions for qualified counsel.

## Storage and trust boundary

The app uses `sql.js` with Drizzle and writes its database, uploads, Qdrant files, retained research snapshots, FastEmbed model cache, provider settings, and structured-output debug artifacts below `data/`. That directory is ignored by Git, but it is not encrypted by PrisonBreak.

The application is a single-user localhost tool, not a hardened network service. Research and analysis features contact external providers, so local storage must not be mistaken for local-only processing. See [SECURITY.md](../SECURITY.md) before using real material.
