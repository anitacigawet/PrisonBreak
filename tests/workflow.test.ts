import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCasePhase, replacePetalSnapshot, refreshResearchOutputCaches } from "../client/src/pages/case-detail/workflowState";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireRepo = createRequire(path.join(repository, "package.json"));
const originalCwd = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "prisonbreak-workflow-"));
let db: typeof import("../server/db");
let petalDb: typeof import("../server/petals/db");
let trialDb: typeof import("../server/orchestrator/db");
let operations: typeof import("../server/caseOperations");

before(async () => {
  fs.cpSync(path.join(repository, "drizzle", "migrations"), path.join(fixture, "drizzle", "migrations"), { recursive: true });
  process.chdir(fixture);
  process.env.DATABASE_PATH = path.join(fixture, "data", "test.db");
  process.env.PRISONBREAK_DATA_DIR = path.join(fixture, "data");
  delete process.env.PRISONBREAK_QDRANT_PATH;
  db = await import("../server/db");
  await db.initDb();
  petalDb = await import("../server/petals/db");
  trialDb = await import("../server/orchestrator/db");
  operations = await import("../server/caseOperations");
});
after(() => {
  db?.closeDb();
  process.chdir(originalCwd);
  if (fixture.startsWith(path.join(os.tmpdir(), "prisonbreak-workflow-"))) fs.rmSync(fixture, { recursive: true, force: true });
});

// Execute the production module; substitute only network/provider/event edges.
function loadModule(relative: string, mocks: Record<string, any>): any {
  const full = path.resolve(repository, relative);
  assert(full.startsWith(repository + path.sep) && !relative.startsWith("data/"));
  const code = ts.transpileModule(fs.readFileSync(full, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier: string) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith(".")) throw new Error(`Unmocked module edge ${specifier}`);
    return requireRepo(specifier);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: full })(localRequire, module, module.exports);
  return module.exports;
}

const spec = { key: "laws", label: "Laws", description: "Synthetic", applicability: async () => ({ apply: true }), researchQuery: () => "Synthetic official research" };
const research = { summary: "Synthetic findings", limitations: [], sources: [
  { url: "https://example.gov/source", title: "Synthetic source", publisher: "Synthetic government", citedExcerpt: "Fixture passage", sourceKind: "statute" },
] };
const trial = (caseId: number, summary: string) => ({ caseId, prosecutor: {}, defender: {}, verdict: { summary }, completedAt: new Date().toISOString(), provider: "synthetic", model: "synthetic" }) as any;

async function createCase() {
  const caseId = Number((await db.createCase(1, "Synthetic case"))[0].insertId);
  await db.setCaseFacts(caseId, JSON.stringify({ jurisdiction: "Synthetic", charges: [] }));
  await db.updateCaseStatus(caseId, "completed");
  return (await db.getCaseById(caseId))!;
}

test("new trial and changed source records invalidate all dependent output", async () => {
  const row = await createCase();
  await trialDb.upsertTrialResult(trial(row.id, "old"));
  await trialDb.upsertHandoff(row.id, { questions: [], caseHeader: "old", openQuestion: "", disclaimer: "" });
  await trialDb.upsertTrialResult(trial(row.id, "new"));
  assert.equal(await trialDb.getHandoff(row.id), null);
  const id = await petalDb.ensurePetalRow(row.id, "laws");
  await petalDb.updatePetal(id, { status: "completed", corpusKey: "research:laws:old", sourceCount: 1 });
  await db.updateCase(row.id, { jurisdiction: "Changed jurisdiction" });
  assert.equal((await db.getCaseById(row.id))!.caseFacts, null);
  assert.deepEqual(await petalDb.listPetalsForCase(row.id), []);
  assert.equal(await trialDb.getTrialResult(row.id), null);
});

test("research failure preserves active generation; activation publishes indexed ledger atomically", async () => {
  const row = await createCase();
  const id = await petalDb.ensurePetalRow(row.id, "laws");
  const oldCorpus = "research:laws:previous";
  await petalDb.updatePetal(id, { status: "completed", progress: 100, corpusKey: oldCorpus, sourceCount: 1, summary: "Retained old source" });
  await db.replaceResearchSources(row.id, oldCorpus, [{ url: "https://example.gov/old", title: "Old", excerpt: "Old passage", snapshotPath: path.join(fixture, "old.txt"), contentHash: "old", retrievedAt: new Date() }]);
  await trialDb.upsertTrialResult(trial(row.id, "Old trial"));
  const indexed: string[] = [];
  const cleaned: string[] = [];
  let mode = "discovery-failure";
  const builder = loadModule("server/petals/builder.ts", {
    "../../shared/caseFacts": { parseCaseFacts: JSON.parse }, "../db": db, "./db": petalDb,
    "../_core/websocket": { emitPetalProgress: () => {} },
    "../research": { runWebResearch: async () => { if (mode === "discovery-failure") throw new Error("Synthetic discovery failure"); return research; } },
    "../sources/fetch": { fetchAndSnapshotSource: async (input: any) => ({ canonicalUrl: input.url, snapshotPath: path.join(fixture, "source.txt"), contentHash: "fixture", retrievedAt: new Date() }) },
    "../rag/bridge": { localRag: { upsertFile: async (input: any) => {
      indexed.push(input.corpus);
      assert.equal((await petalDb.getPetal(row.id, "laws"))!.corpusKey, oldCorpus, "new corpus must remain invisible while indexing");
      if (mode === "index-failure") throw new Error("Synthetic partial index failure");
      return { chunkCount: 1 };
    } } },
    "./generations": { discardGeneration: async (_caseId: number, corpus: string) => cleaned.push(corpus), cleanInactiveGenerations: async () => {} },
  });
  for (const failure of ["discovery-failure", "index-failure"]) {
    mode = failure;
    const result = await builder.buildPetal(row, spec);
    assert.equal(result.status, "failed");
    const current = (await petalDb.getPetal(row.id, "laws"))!;
    assert.equal(current.corpusKey, oldCorpus);
    assert.equal(current.status, "completed");
    assert.equal(current.summary, "Retained old source");
    assert.equal((await db.listResearchSources(row.id, oldCorpus)).length, 1);
    assert.equal((await trialDb.getTrialResult(row.id))!.verdict.summary, "Old trial");
  }
  assert.equal(cleaned.length, 2);
  assert(cleaned.every(corpus => corpus !== oldCorpus));
  mode = "success";
  const result = await builder.buildPetal(row, spec);
  assert.equal(result.status, "completed");
  assert.notEqual(result.corpusKey, oldCorpus);
  assert.equal((await petalDb.getPetal(row.id, "laws"))!.corpusKey, result.corpusKey);
  assert((await db.listResearchSources(row.id, result.corpusKey))[0].indexedAt instanceof Date);
  assert.equal(await trialDb.getTrialResult(row.id), null);
  assert.equal(new Set(indexed).size, indexed.length, "each attempt has its own generation");
});

test("Grow checks prerequisites before ACK, rejects duplicates and catches setup failure", async () => {
  const row = await createCase();
  let resolveBuild!: (value: any) => void;
  let configValid = false;
  let failure = false;
  const events: any[] = [];
  const runner = loadModule("server/petals/runner.ts", {
    "../db": db, "../caseOperations": operations, "./db": petalDb,
    "../research": { validateResearchConfiguration: () => { if (!configValid) throw new Error("Synthetic configuration missing"); } },
    "../_core/websocket": { emitPetalsStarted: () => {}, emitPetalProgress: () => {}, emitPetalsComplete: (_id: number, payload: any) => events.push(payload) },
    "./registry": { PETAL_SPECS: [spec] },
    "./builder": { buildPetal: async () => { if (failure) throw new Error("Synthetic setup error"); return new Promise(resolve => { resolveBuild = resolve; }); } },
  });
  await assert.rejects(runner.startPetalGrowth(999999), /not found/i);
  await assert.rejects(runner.startPetalGrowth(row.id), /configuration missing/);
  assert.equal(operations.getActiveCaseOperation(row.id), null);
  configValid = true;
  await runner.startPetalGrowth(row.id);
  for (let n = 0; n < 50 && !resolveBuild; n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(operations.getActiveCaseOperation(row.id), "grow");
  await assert.rejects(runner.startPetalGrowth(row.id), /busy/);
  await assert.rejects(operations.acquireCaseOperation(row.id, "delete"), /busy/);
  resolveBuild({ status: "completed" });
  for (let n = 0; n < 50 && operations.getActiveCaseOperation(row.id); n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(operations.getActiveCaseOperation(row.id), null);
  failure = true;
  await runner.startPetalGrowth(row.id);
  for (let n = 0; n < 50 && operations.getActiveCaseOperation(row.id); n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await petalDb.getPetal(row.id, "laws"))!.status, "failed");
  assert.equal(events.at(-1).failed, 1);
  assert.equal(operations.getActiveCaseOperation(row.id), null);
});

test("trial completion is emitted only after durable save, and failures release the lease", async () => {
  const row = await createCase();
  const events: any[] = [];
  const runner = loadModule("server/orchestrator/runner.ts", {
    "../_core/websocket": { emitTrialStage: (_id: number, event: any) => events.push(event) }, "../db": db,
    "./passes/prosecutor": { runProsecutorPass: async () => ({}) }, "./passes/defender": { runDefenderPass: async () => ({}) },
    "./passes/synthesizer": { runSynthesizerPass: async () => ({ summary: "Synthetic verdict" }) }, "./providers": { makeProvider: () => ({}) },
  });
  let resolveSave!: () => void;
  let released = false;
  runner.startTakeToTrialInBackground(row.id, { provider: "openai", model: "fixture" }, () => new Promise<void>(resolve => { resolveSave = resolve; }), () => { released = true; });
  for (let n = 0; n < 50 && !resolveSave; n++) await new Promise(resolve => setImmediate(resolve));
  assert(!events.some(event => event.kind === "complete"));
  assert.equal(released, false);
  resolveSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.at(-1).kind, "complete");
  assert.equal(released, true);
  events.length = 0; released = false;
  runner.startTakeToTrialInBackground(row.id, { provider: "openai", model: "fixture" }, async () => { throw new Error("Synthetic disk failure"); }, () => { released = true; });
  for (let n = 0; n < 50 && !released; n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.at(-1).kind, "error");
  assert(!events.some(event => event.kind === "complete"));
  assert.equal(released, true);
});

test("failed research stays retryable; missing facts override stale blooms; empty snapshots clear sockets", () => {
  const base = { hasDocuments: true, hasFacts: true, analyzing: false, growing: false, expectedPetals: 1 };
  assert.equal(deriveCasePhase({ ...base, petals: [{ status: "failed" }] }), "grow");
  assert.equal(deriveCasePhase({ ...base, petals: [{ status: "pending" }] }), "grow");
  assert.equal(deriveCasePhase({ ...base, petals: [{ status: "completed" }] }), "bloomed");
  assert.equal(deriveCasePhase({ ...base, hasFacts: false, petals: [{ status: "completed" }] }), "analyze");
  assert.equal(deriveCasePhase({ ...base, analyzing: true, petals: [{ status: "completed" }] }), "analyzing");
  assert.deepEqual(replacePetalSnapshot([]), {});
});

test("retry Grow control renders explicitly and pending start disables it", () => {
  const { default: PrebloomCard } = loadModule("client/src/pages/case-detail/PrebloomCard.tsx", {});
  const properties = { phase: "grow", docs: [], onUpload() {}, onAnalyze() {}, onBeginGrow() {}, retryGrow: true };
  const ready = renderToStaticMarkup(createElement(PrebloomCard, properties));
  assert.match(ready, /Retry research/);
  assert.doesNotMatch(ready, /disabled=""/);
  const pending = renderToStaticMarkup(createElement(PrebloomCard, { ...properties, growPending: true }));
  assert.match(pending, /disabled=""/);
  assert.match(pending, /Starting…/);
});

test("research completion/reconnect clears trial and handoff caches and refreshes all three queries", async () => {
  const calls: string[] = [];
  let trialCache: unknown = { summary: "stale trial" };
  let handoffCache: unknown = { question: "stale printable question" };
  await refreshResearchOutputCaches({
    clearTrial: () => { calls.push("clear-trial"); trialCache = null; },
    clearHandoff: () => { calls.push("clear-handoff"); handoffCache = null; },
    refreshPetals: async () => { calls.push("petals"); },
    refreshTrial: async () => { calls.push("trial"); assert.equal(trialCache, null); },
    refreshHandoff: async () => { calls.push("handoff"); assert.equal(handoffCache, null); },
  });
  assert.deepEqual(calls, ["clear-trial", "clear-handoff", "petals", "trial", "handoff"]);

  const effects: Array<() => unknown> = [];
  const handlers = new Map<string, (...args: any[]) => void>();
  let refreshed = 0;
  const hook = loadModule("client/src/hooks/usePetalsSocket.ts", {
    react: { useCallback: (f: any) => f, useEffect: (f: any) => effects.push(f), useRef: () => ({ current: null }), useState: (value: any) => [value, () => {}] },
    "socket.io-client": { io: () => ({ on: (event: string, f: any) => handlers.set(event, f), emit() {}, disconnect() {} }) },
    "@/pages/case-detail/workflowState": { replacePetalSnapshot },
  });
  hook.usePetalsSocket(1, () => refreshed++);
  effects.forEach(effect => effect());
  handlers.get("connect")!();
  assert.equal(refreshed, 1);
  handlers.get("petals-complete")!({ total: 1, completed: 1, skipped: 0, failed: 0 });
  assert.equal(refreshed, 2);
  handlers.get("connect")!();
  assert.equal(refreshed, 3, "reconnect reconciles the persisted generation even if completion was missed");
});
