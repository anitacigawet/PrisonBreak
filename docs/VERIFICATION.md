# Verification

Run from the repository root with Node 22.12+, pnpm 10, and the documented Python
RAG environment. Tests use synthetic material and temporary directories; they do
not load the checkout's `.env`, call analysis/research providers, or use its case data.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test
.\.venv-rag\Scripts\python.exe -m unittest discover -s tests -p worker_budget_test.py -v
pnpm.cmd test:runtime
pnpm.cmd audit --prod
```

On macOS/Linux, use `.venv-rag/bin/python`. An alternate installed interpreter
can be passed to the runtime test using `PRISONBREAK_TEST_PYTHON`.

## What these checks cover

- Exact local browser origins, session admission, sockets, room selection, source
  redirects, pinned DNS, private-address rejection, and connector deadlines.
- Typed citation authority, every repeated citation, handoff metadata, and all
  supported quoted passages; rejected output does not retain an untrusted URL.
- Partial settings updates, exclusive runtime ownership, crash recovery, failed
  writes, rollback, deletion retries, secure erasure of synthetic SQLite records,
  and cleanup of abandoned atomic-write siblings.
- Case-operation conflicts, dependent-state invalidation, staged research
  publication, failure recovery, completion after persistence, UI retry controls,
  and query-cache reconciliation on research completion/reconnect.
- Document/ZIP/XML/PDF/text/chunk budgets, ordinary parser controls, real local
  Qdrant scoped deletion, and worker queues that wait for process exit.
- A built server starting against fresh disposable state; HTTP/API admission,
  redacted settings, synthetic HTML upload/download, and case deletion.

## Boundaries

These tests do not certify the application secure. They do not test provider-backed
end-to-end analysis, effective installed-Claude tool restrictions, every browser,
live internet source interoperability, operating-system memory limits, disk power
loss, exported copies, backups, or provider retention.

The Codex research route fails before launching a CLI. This is a feature block,
not a verified Codex filesystem sandbox. Claude is configured with WebSearch and
WebFetch only, safe mode, an empty strict MCP configuration, and a reduced child
environment; incompatible CLI versions must fail rather than weaken those flags.

New model failures do not create raw debug dumps. Old flat `orchestrator-debug`
files, if present from earlier builds, are not attributable to a case by filename
and are not removed by case deletion. Inspect or remove those only with the
operator's explicit permission.

Python dependencies use bounded ranges, not a complete lockfile. The existing
React Joyride peer-version warning and large client-bundle warning are separate
maintenance items, not passing security checks.
