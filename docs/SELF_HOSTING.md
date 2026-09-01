# Self-hosting PrisonBreak

## Requirements

- Node.js 22 or newer
- pnpm 10
- Python 3.11 or newer
- A locally installed and authenticated Codex CLI or Claude CLI for live web research
- An Anthropic or OpenAI API key for fact extraction, grounded comparison, and the Defender Handoff

The application runs on the local computer, but its research and analysis providers are network-backed. Read [SECURITY.md](../SECURITY.md) before using sensitive material.

## Install

```bash
git clone https://github.com/anitacigawet/PrisonBreak.git
cd PrisonBreak
pnpm install
python -m pip install -r server/rag/requirements.txt
```

The Python requirements install Qdrant local mode, FastEmbed, and PDF text extraction. The default embedding model is downloaded on first use and then cached under `data/fastembed/`.

Copy `.env.example` to `.env`, then select the research CLI:

```dotenv
PRISONBREAK_RESEARCH_PROVIDER=codex
```

Use `claude` instead of `codex` to run research through Claude CLI. The chosen executable must already be installed, authenticated, and able to use web search. Optional executable and storage-path overrides are documented in `.env.example`.

Start the application:

```bash
pnpm dev
```

Open the localhost URL printed in the terminal. In Settings, select Anthropic or OpenAI, choose a model, and enter the corresponding API key. The key is stored locally in `data/settings.json`; it is not placed in `.env`.

## Using documents

PrisonBreak can extract text from TXT, Markdown, HTML, PDF, and DOCX files. It does not include OCR. If a PDF contains only scanned page images, run OCR with another tool before uploading it.

Analyze parses and indexes the case documents into local Qdrant, then uses the configured API provider to produce a citation-checked fact sheet. Grow uses the selected CLI to discover official web sources, retains its own snapshots, and indexes those snapshots into separate case-scoped research corpora.

## Production build

```bash
pnpm build
pnpm start
```

“Production” here means an optimized local build. It does not make the application suitable for public hosting.

## Local data

The ignored `data/` directory contains:

- `app.db` — case metadata, source records, analysis results, and notes
- `uploads/` — uploaded case documents
- `qdrant/` — the persistent local vector index, including case-document passages
- `fastembed/` — the local embedding-model cache
- `research/` — retained, hash-addressed snapshots of admitted web sources
- `settings.json` — the selected analysis provider, model, and API key
- `orchestrator-debug/` — failed structured-output captures, when created

Treat the entire directory as sensitive. PrisonBreak does not encrypt it at rest.

## Before using sensitive material

Local indexing does not mean that the whole workflow stays on the machine. Retrieved case passages are sent to the configured Anthropic or OpenAI API during fact extraction and comparison. Research briefs are sent through the selected Codex or Claude CLI and its web services. Confirm that those data flows are appropriate for the material and any confidentiality, privilege, retention, or professional obligations involved.
