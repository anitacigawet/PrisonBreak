# Self-hosting PrisonBreak

This public distribution supports fresh installs only. Do not reuse a database
from an older private-development build. Maintainers continuing work in an
existing checkout should read [START_HERE.md](../START_HERE.md) before running
migration or smoke-test commands.

## Requirements

- Node.js 22.12 or newer
- pnpm 10
- Python 3.11 or newer
- A locally installed and authenticated Claude Code CLI for live web research
- An Anthropic or OpenAI API key for fact extraction, grounded comparison, and the Defender Handoff

The application runs on the local computer, but its research and analysis providers are network-backed. Read [SECURITY.md](../SECURITY.md) before using sensitive material.

## Install

On Windows, the release launcher installs lockfile-frozen Node dependencies and
the Python requirement ranges, prepares the local environment, builds, and starts
the server:

```powershell
git clone https://github.com/anitacigawet/PrisonBreak.git
Set-Location PrisonBreak
.\launch.bat
```

For a manual installation, install Node dependencies first:

```bash
git clone https://github.com/anitacigawet/PrisonBreak.git
cd PrisonBreak
pnpm install --frozen-lockfile
```

On Windows PowerShell:

```powershell
py -3 -m venv .venv-rag
.\.venv-rag\Scripts\python.exe -c "import sys; raise SystemExit(sys.version_info[:2] < (3, 11))"
.\.venv-rag\Scripts\python.exe -m pip install -r server\rag\requirements.txt
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
python3 -m venv .venv-rag
.venv-rag/bin/python -c 'import sys; raise SystemExit(sys.version_info[:2] < (3, 11))'
.venv-rag/bin/python -m pip install -r server/rag/requirements.txt
cp .env.example .env
```

The Python requirements use bounded version ranges rather than a lockfile. They
install Qdrant local mode, FastEmbed, and PDF text extraction. The default
embedding model is downloaded on first use and then cached under
`data/fastembed/`.

Set `PRISONBREAK_PYTHON` to the interpreter inside `.venv-rag`, then select the
research CLI. Use the platform-specific interpreter value in `.env.example`:

```dotenv
PRISONBREAK_RESEARCH_PROVIDER=claude
```

Claude Code must support the web-only tool list, safe mode, and strict empty MCP configuration used by the bridge. Unsupported versions fail instead of relaxing the policy. The Codex selection currently fails with an explicit configuration error: its former read-only sandbox did not establish file-read isolation. No provider is switched automatically. Optional executable and storage-path overrides are documented in `.env.example`.

Start the application:

```bash
pnpm dev
```

Open the localhost URL printed in the terminal. This establishes a per-process browser session before API requests and progress sockets start. Only loopback hosts are supported. In Settings, select Anthropic or OpenAI, choose a model, and enter the corresponding API key. The key is stored locally in `data/settings.json`; it is not placed in `.env`.

Verify local RAG availability separately from the launcher:

```powershell
'{"action":"health","config":{}}' | .\.venv-rag\Scripts\python.exe -m server.rag.worker
```

The response must have `ok`, `result.qdrantAvailable`, and
`result.fastembedAvailable` all set to `true`. This checks module availability and
configuration only; it does not load the embedding model or exercise indexing and
querying.

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
- `orchestrator-debug/` — legacy failed-output captures, if an earlier build created them; new runs do not save raw model output

Treat the entire directory as sensitive. PrisonBreak does not encrypt it at rest.

`PRISONBREAK_DATA_DIR` relocates the shared runtime root. An explicit
`DATABASE_PATH` or Qdrant/cache override remains independent; review all paths
when isolating a test. A second app cannot own the same runtime root, database,
or Qdrant path. Stop the first app instead of deleting a live ownership lock.

Case deletion removes case-scoped vectors, uploads, snapshots, and database
records. Failed cleanup leaves a visible case that can be deleted again. Legacy
flat debug files cannot reliably be assigned to a case and are not automatically
deleted. Operating-system backups, exported documents, and provider retention
are outside this cleanup.

Documents have explicit byte, expanded-archive, text, page, and chunk budgets.
An over-limit document is rejected; these budgets are not an operating-system
memory sandbox. Uploaded files download as attachments, including HTML.

## Before using sensitive material

Local indexing does not mean that the whole workflow stays on the machine. Retrieved case passages are sent to the configured Anthropic or OpenAI API during fact extraction and comparison. Research briefs are sent through Claude CLI and its web services. Confirm that those data flows are appropriate for the material and any confidentiality, privilege, retention, or professional obligations involved.
