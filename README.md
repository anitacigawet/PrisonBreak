![PrisonBreak](docs/assets/prisonbreak-banner.webp)

# PrisonBreak

## What is this?

PrisonBreak is an extremely experimental case-reading workspace for individuals attempting to understand a criminal case record. It organizes case documents in a local Qdrant RAG database, keeps extracted facts tied to their source passages, and can use Codex CLI or Claude CLI to find official material on the web. It compares a prosecutor reading and a defense reading of the same retained material, then produces a concise handoff ready for immediate attorney review.

It is currently a working beta and is not in any way, shape, or form a legal service. It does not in any way, shape, or form predict outcomes, create an attorney-client relationship, or replace any type of qualified counsel.

## Who is this for?

- Individuals who want to experiment with an AI-assisted way of reading their own case materials before speaking with counsel, or to explore different potentialities within a case.
- Public defenders or legal-aid teams.
- Innocence organizations.
- People evaluating source-grounded, RAG-grounded legal technology.

## What it actually does

PrisonBreak is not a simple chatbot. It separates three different structures of work:

1. **Source retrieval.** Uploaded documents become a case corpus inside a local Qdrant RAG database. PrisonBreak extracts facts with citations so a reviewer can follow each retained fact directly back to its source passage and location.
2. **Case analysis and search.** The case record is used to identify focused research questions. A locally invoked Codex or Claude CLI searches for primary legal and government sources. PrisonBreak then fetches those sources itself, stores local snapshots, records their URLs and content hashes, and indexes the retained text into separate research corpora.
3. **Grounded comparison.** PrisonBreak conducts a “prosecutor pass” and a “defense pass” over the same case material. It battles those readings out alongside the web-acquired research in a RAG-grounded clean room, comparing where they agree, disagree, or depend on narrow factual or legal pivots. The result is a map of the disputes, not a prediction.

The resulting “Take-to-Trial” view is for understanding. A separate “Defender Handoff” translates the most actionable points into no more than three RAG-cited, source-linked questions that can be printed and given to qualified legal counsel.

### Current workflow

```text
Create a case
    ↓
Upload the record
    ↓
Index the record locally and extract source-cited facts
    ↓
Research official sources and retain local snapshots
    ↓
Compare prosecutor and defense readings
    ↓
Review Take-to-Trial and print the Defender Handoff
```

Research is organized into bounded corpora for laws, controlling cases, procedure, public case data, venue data, forensic reliability, identification or statement science, and representation resources. Research that does not apply to the cited case facts is skipped rather than invented.

## Running it locally

Requirements:

- Node.js 22 or newer
- pnpm 10
- Python 3.11 or newer
- Codex CLI or Claude CLI for web research
- An Anthropic or OpenAI API key for fact extraction and the comparison passes

```bash
git clone https://github.com/anitacigawet/PrisonBreak.git
cd PrisonBreak
pnpm install
python -m venv .venv-rag
```

On Windows PowerShell:

```powershell
.\.venv-rag\Scripts\python.exe -m pip install -r server\rag\requirements.txt
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
.venv-rag/bin/python -m pip install -r server/rag/requirements.txt
cp .env.example .env
```

Set `PRISONBREAK_PYTHON` and `PRISONBREAK_RESEARCH_PROVIDER` in `.env`, then start the app:

```bash
pnpm dev
```

Open the local URL printed by the server. Configure the Anthropic or OpenAI analysis provider under Settings. The first real indexing run downloads the FastEmbed model and caches it under `data/fastembed/`.

See [the self-hosting guide](docs/SELF_HOSTING.md) for the complete setup and data-flow boundaries.

## ⚙️ Extreme technicals below

### Data flow

- Uploaded TXT, Markdown, HTML, PDF, and DOCX files remain under the local `data/` directory.
- Python extracts text locally. Scanned image-only PDFs require OCR before upload; PrisonBreak does not include OCR.
- FastEmbed creates embeddings locally using `BAAI/bge-small-en-v1.5` by default.
- Qdrant runs in persistent local mode under `data/qdrant/`.
- Every retrieved chunk carries a stable citation ID, source identity, content hash, locator, and verbatim passage.
- Codex CLI or Claude CLI performs live web discovery. PrisonBreak independently fetches the returned official sources before admitting them to the research index.
- Anthropic or OpenAI performs structured fact extraction and the prosecutor, defense, synthesis, and handoff passes. Those model calls are network-backed.
- SQLite stores cases, document metadata, research-source ledgers, analysis results, notes, and settings.

Local storage is not the same as local-only processing. Case excerpts and prompts can be sent to the configured Anthropic or OpenAI provider. Web research uses the selected Codex or Claude CLI and therefore also uses that provider's network service. Review provider policies and any confidentiality, privilege, retention, or professional obligations that apply before using sensitive material.

### Project structure

```text
client/                 React interface
server/rag/             Local parsing, FastEmbed, and Qdrant retrieval
server/research/        Codex/Claude CLI web-research bridge
server/sources/         Independent source fetching and snapshots
server/petals/          Bounded research-corpus builders
server/orchestrator/    Prosecutor, defense, synthesis, and handoff passes
shared/                 Shared fact and citation contracts
drizzle/                SQLite schema and migrations
examples/               Synthetic example material
docs/                   Architecture, setup, and safety notes
```

### Local verification

```bash
pnpm check
pnpm build
pnpm audit --prod
```

### Important limitations

- AI output can be incomplete, misleading, or wrong even when it includes citations. A citation identifies supporting text; it does not prove the legal interpretation is correct.
- PrisonBreak does not determine guilt, provide legal advice, calculate filing deadlines, or make strategic decisions.
- Web research is limited to sources the selected CLI can find and PrisonBreak can fetch. Missing or inaccessible authority remains missing.
- Text extraction can lose layout, handwriting, tables, images, or scan content.
- The project has not been validated for emergency matters, filing deadlines, jurisdiction-specific professional compliance, production hosting, or unattended use.
- Nothing generated by PrisonBreak should be filed, sent, or acted on without review by a licensed attorney in the relevant jurisdiction.

### Contributions and support

Bug reports and documentation corrections can be opened through GitHub Issues. Use synthetic or thoroughly redacted examples only. See [SECURITY.md](SECURITY.md).

### License

Copyright 2026 ScootSolute LLC.

The source is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use is not granted. This is source-available software, not open-source software as defined by the Open Source Initiative.
