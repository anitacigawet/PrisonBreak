# Start Here

Use this file to continue work on the public PrisonBreak repository with another
AI or maintainer. Repository-specific instructions are in `AGENTS.md`; read that
file before this one when it has not already been loaded automatically.

## Release baseline

- Repository: `https://github.com/anitacigawet/PrisonBreak`
- Branch: `main`
- Public release: `v1.0.0` at
  `dede798808c3778f1eb7e9556db616be48db7bc1`
- Distribution policy: fresh installs only. Private-development databases and
  other ignored runtime state are not part of the public release.
- Verification evidence is checkout- and date-specific. Re-run it after any code
  change rather than treating this document as a permanent passing result.

After this file, read in order:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/SELF_HOSTING.md`
4. `docs/MAINTAINER_NOTES.md`
5. `SECURITY.md`

## Current source — 2026-09-06

The current source includes updates after manual code and security review.
This source update does not replace the existing v1.0.0 release archive. See
`docs/VERIFICATION.md` for reproducible checks and their limitations.

Run `pnpm test` for the new regression suite and `pnpm test:runtime` for the built
application smoke test using disposable state. Python parser and Qdrant deletion
tests use `python -m unittest discover -s tests -p worker_budget_test.py -v` with
the documented RAG environment. No provider calls are made by these tests.

Research currently requires Claude Code. The Codex selection fails closed rather
than using an unverified file-read boundary or silently switching providers.
The supported Node minimum is 22.12. A process owns its runtime root, database,
and Qdrant path exclusively. Do not remove a live ownership lock.

## Verification

The current source passed 42 Node regression tests, 10 Python tests, and one
built-runtime integration test on 2026-09-06 with Node 24.15.0, pnpm 10.4.1,
and Python 3.12.10. Type checking, the production build, and the production
dependency audit also passed. There is no lint or format script.
Provider-backed end-to-end analysis remains unverified because it requires an
operator-supplied API key and an authenticated research CLI.

## Protect local state

A working checkout may contain ignored operator state. Treat it as private.

- Do not print or commit `.env`.
- Do not open, migrate, replace, or delete `data/app.db`.
- Use `pnpm test:runtime` for a smoke test. It starts the built server in a
  disposable directory with explicit synthetic configuration, not the checkout's
  `.env`. A database-path override alone does not isolate the other runtime stores.
- Use an isolated clean checkout for a complete fresh-install or workflow test.
  The public baseline is not an upgrade package for older private-development
  databases.
- Do not commit `data/`, `.venv-rag/`, `node_modules/`, or `dist/`.

## Run on Windows

The supported convenience path is:

```powershell
.\launch.bat
```

The launcher checks the expected tools, installs lockfile-frozen Node dependencies
and the Python requirement ranges, prepares the local Python environment, builds
the application, and starts it. Manual setup, the separate RAG-availability check,
and macOS/Linux commands are in `docs/SELF_HOSTING.md`.

Minimum manual verification from the repository root:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test
pnpm.cmd build
pnpm.cmd audit --prod
'{"action":"health","config":{}}' | .\.venv-rag\Scripts\python.exe -m server.rag.worker
```

For a passing RAG availability check, `ok`, `result.qdrantAvailable`, and
`result.fastembedAvailable` must all be `true`.

## Immediate maintainer task

Inspect `git status`, confirm the current task, and read the documents above. The
current implementation and remaining verification limits are recorded in
`docs/MAINTAINER_NOTES.md` and `docs/VERIFICATION.md`. Re-run the relevant
regressions before changing those state transitions.

## Copy-paste handoff prompt

```text
Work only in the PrisonBreak-Public repository. This is the public, fresh-install
local distribution, not the private development repository. Read AGENTS.md,
START_HERE.md, README.md, docs/ARCHITECTURE.md, docs/SELF_HOSTING.md,
docs/MAINTAINER_NOTES.md, and SECURITY.md in that order before making changes.

Preserve all ignored operator state. Never print or commit .env, and do not open,
migrate, replace, or delete data/app.db. Use pnpm test:runtime for the isolated
synthetic app smoke test; a DATABASE_PATH override alone does not isolate settings,
uploads, snapshots or Qdrant. Start build/test commands from the repository root.

First report the checked-out branch, HEAD, tracked/ignored state relevant to the
task, and which verification commands are available. Then verify the stated
fresh-install path. Distinguish source/build/RAG checks from provider-backed
end-to-end testing. There are automated tests; no lint or format script is present.
Read docs/MAINTAINER_NOTES.md before changing workflow state or persistence.

Do not push, publish a release, deploy, rewrite history, or destructively change
local data without James's explicit approval. At the end, state exactly what
changed, what was verified, what remains unverified, and whether the worktree is
clean.
```
