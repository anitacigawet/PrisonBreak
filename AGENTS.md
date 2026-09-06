# PrisonBreak Public Repository Instructions

This repository is the public, fresh-install distribution of PrisonBreak. It is
intended to be cloned and run locally. Do not add private-development artifacts,
historical case data, generated databases, uploaded files, credentials, build
outputs, or editor state.

## Start here

Read these files in order before changing the project:

1. `START_HERE.md` — current handoff state, setup, verification, and known limits.
2. `README.md` — public product description and operator workflow.
3. `docs/ARCHITECTURE.md` — runtime components and data flow.
4. `docs/SELF_HOSTING.md` — supported local-install procedure.
5. `docs/MAINTAINER_NOTES.md` — implementation map and verified maintenance gaps.
6. `SECURITY.md` — security boundary and reporting instructions.

Current source of truth is the checked-out code and lockfiles. When documentation
and code disagree, verify runtime behavior, correct the documentation, and record
the discrepancy in `docs/MAINTAINER_NOTES.md` if it remains unresolved.

## Local-state boundary

- Never print, commit, replace, migrate, or delete `.env` or anything under
  `data/` without James's explicit instruction.
- The existing ignored `data/app.db` may contain private-development state and is
  not a valid fresh-install test target.
- Use the disposable runtime in `pnpm test:runtime` for app verification.
  A `DATABASE_PATH` override alone does not isolate the other runtime stores.
- Do not commit `node_modules/`, `.venv-rag/`, `dist/`, coverage output, logs, or
  generated release archives.
- Do not infer that ignored local files belong in the public distribution.

## Architecture invariants

- Start the application from the repository root; runtime paths are relative to
  the current working directory.
- The TypeScript server owns HTTP, tRPC, Socket.IO progress, SQLite persistence,
  provider orchestration, and the built client.
- `server/rag/worker.py` is a line-oriented JSON worker spawned by the TypeScript
  bridge. Keep stdout machine-readable; diagnostic output belongs on stderr.
- Qdrant and FastEmbed run locally. Provider CLIs and analysis APIs are external
  boundaries and must remain explicit.
- Uploaded material and generated case work stay local by default and must never
  enter fixtures or commits.
- Preserve source citations and provenance through retrieval, analysis, comparison,
  and Defender Handoff output.

## Verification

From the repository root, use the pinned package manager and lockfile:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test
pnpm.cmd build
pnpm.cmd audit --prod
'{"action":"health","config":{}}' | .\.venv-rag\Scripts\python.exe -m server.rag.worker
```

For a runtime smoke test, run `pnpm test:runtime`. The test starts the built server
with disposable data and explicit configuration, checks HTTP/API/upload/deletion,
and stops its own process. Do not test migrations against `data/app.db`.

The regression suite and runtime smoke test are described in `docs/VERIFICATION.md`.
There is no lint or format script. Record exactly what was and was not exercised.

## Change boundaries

- Keep public-release changes limited to files needed to install, run, understand,
  or maintain the local application.
- Do not change legal/product claims casually; preserve the README disclaimer.
- Do not push, publish a release, deploy, rewrite history, or destructively alter
  local data without James's explicit approval for that action.
- Update `START_HERE.md` and `docs/MAINTAINER_NOTES.md` when shipped state or a
  verified maintenance gap changes.
