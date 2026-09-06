# Maintainer Notes

This describes the current source as of 2026-09-06, not a new tagged release.
The public v1.0.0 baseline is recorded in START_HERE.md.
Preserve existing unrelated changes and private operator data.

## Runtime map

- server/_core/index.ts initializes the loopback HTTP/session boundary, database,
  tRPC, Socket.IO, attachment downloads, and development or built client.
- server/_core/localSecurity.ts shares exact Host/Origin/session checks with
  sockets. This is a local browser boundary, not multiuser authentication.
- server/db.ts uses sql.js/Drizzle. Each synchronous mutation exports a verified
  database to an atomic sibling file. Failure restores memory and blocks further
  access until restart. sql.js export resets PRAGMAs, so foreign_keys and
  secure_delete must be reapplied after every export.
- server/persistence.ts owns runtime/database/Qdrant locks, atomic replacement,
  stale-process recovery, and abandoned temporary-write cleanup.
- server/caseOperations.ts serializes mutations per case. Deletion state is
  durable; other operation ownership is process-local and interrupted jobs are
  marked retryable on restart.
- server/caseDeletion.ts records deletion before removing vectors and scoped
  files, then deletes SQL records atomically. Incomplete cleanup keeps the case.
- server/rag/bridge.ts serializes workers through process close, including errors.
  server/rag/worker.py parses bounded documents and uses local Qdrant/FastEmbed.
- server/research/ invokes restricted Claude web discovery. Codex research is
  disabled before execution pending verified web-only isolation. Existing Codex
  configuration is not silently changed to Claude.
- server/sources/fetch.ts enforces official HTTPS URLs through every redirect,
  pins checked DNS addresses to the connection, and retains source snapshots.
- server/petals/ stages UUID corpus generations. Only the active database pointer
  grants retrieval access. Failed rebuilds preserve the previous usable corpus;
  abandoned generations remain case-scoped for cleanup retries.
- server/orchestrator/ uses typed retrieval evidence as citation authority.
  Every duplicate occurrence and every handoff question is checked. Quote
  matching does not prove the surrounding legal interpretation is correct.
- client/src/pages/CaseDetail.tsx coordinates retry controls and query/socket
  reconciliation. Clearing the flower alone does not clear trial/handoff caches.

## Workflow and data invariants

Metadata changes and uploads invalidate facts, active research pointers, trial
output, and handoff. A no-op metadata edit does not. New trial output clears the
old handoff. Successful research activation invalidates trial/handoff; failed
staging does not replace the active corpus.

All case mutation paths must hold the shared operation lease, including Analyze,
Grow, upload/edit, trial, handoff, notes, and deletion. Do not release it merely
because a subprocess received a kill request. Do not emit completion before the
database commit.

The default data root is ./data; PRISONBREAK_DATA_DIR can relocate it. Explicit
database, Qdrant, and cache overrides remain separate. Start from the repository
root for migration/persona assets. Tests use disposable directories and explicit
paths; DATABASE_PATH alone is not sufficient isolation.

New failures do not persist raw model-output diagnostics. Legacy flat
orchestrator-debug captures are not attributable to cases and remain untouched.
Deletion does not cover external exports, filesystem backups, or provider records.

## Verification

See VERIFICATION.md for commands and precise coverage. The repository now has
Node regression tests, Python parser/Qdrant tests, and a built-runtime smoke test.
There is no lint or format script. Provider-backed end-to-end analysis and real
browser workflow interaction have not been exercised by these synthetic tests.

The regular check command disables incremental TypeScript state so verification
does not reuse stale diagnostics from an earlier compiler configuration.

## Remaining maintenance items

- Effective installed-Claude tool isolation and compatibility still require an
  operator-authorized provider test. A prompt is not a filesystem boundary.
- Parser limits are resource budgets, not an operating-system memory sandbox.
- Python dependencies use bounded ranges rather than a complete lockfile.
- React Joyride declares React 15-18 peers while this app uses React 19.
- The production client retains Vite's greater-than-500-kB bundle warning.
- The onboarding tour has selectors from an older interface.
- The upload card is click-only despite its drop wording, and its accept list is
  narrower than the parser's supported types.
- Theme handling is split across multiple integrations.
- Client handoff types manually mirror server types and can drift.
- The synthesizer's Wertheimer material is paraphrased; primary-source excerpts
  are an optional documentation enhancement, not a runtime prerequisite.

The unchanged SECURITY.md remains the deployment and reporting policy. Current
CLI behavior and implementation limitations above supersede its older generic
Codex/Claude processing description; no new risk exclusions are authorized here.
