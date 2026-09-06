import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { atomicWriteFile, acquireRuntimeOwnership } from "../server/persistence";

const originalCwd = process.cwd();
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "prisonbreak-persistence-"));
const databasePath = path.join(fixture, "data", "test.db");
let db: typeof import("../server/db");
let operations: typeof import("../server/caseOperations");
let deletion: typeof import("../server/caseDeletion");

before(async () => {
  fs.cpSync(path.join(repository, "drizzle", "migrations"), path.join(fixture, "drizzle", "migrations"), { recursive: true });
  process.chdir(fixture);
  process.env.DATABASE_PATH = databasePath;
  process.env.PRISONBREAK_DATA_DIR = path.join(fixture, "data");
  delete process.env.PRISONBREAK_QDRANT_PATH;
  db = await import("../server/db");
  operations = await import("../server/caseOperations");
  deletion = await import("../server/caseDeletion");
  await db.initDb();
});

after(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
  db?.closeDb();
  process.chdir(originalCwd);
  // This is the test's own mkdtemp directory, never repository runtime data.
  if (fixture.startsWith(path.join(os.tmpdir(), "prisonbreak-persistence-"))) fs.rmSync(fixture, { recursive: true, force: true });
});

async function createCase(title = "Synthetic test case") {
  return Number((await db.createCase(1, title))[0].insertId);
}

test("partial settings updates preserve provider, model and omitted keys; explicit empty clears", async () => {
  const { writeSettings, readSettings } = await import("../server/_core/settings");
  const { settingsRouter } = await import("../server/_core/settingsRouter");
  writeSettings({ orchestrator: { provider: "anthropic", model: "synthetic-model", anthropicApiKey: "test-only-a", openaiApiKey: "test-only-b" } });
  const caller = settingsRouter.createCaller({} as any);
  await caller.updateOrchestrator({ model: "new-synthetic-model" });
  assert.deepEqual(readSettings().orchestrator, { provider: "anthropic", model: "new-synthetic-model", anthropicApiKey: "test-only-a", openaiApiKey: "test-only-b" });
  writeSettings({ orchestrator: { anthropicApiKey: undefined } });
  await caller.updateOrchestrator({ openaiApiKey: "" });
  assert.equal(readSettings().orchestrator?.anthropicApiKey, "test-only-a");
  assert.equal(readSettings().orchestrator?.openaiApiKey, "");
  assert.equal(readSettings().orchestrator?.provider, "anthropic");
  assert.equal(readSettings().orchestrator?.model, "new-synthetic-model");
});

test("atomic file replacement failure leaves old bytes and removes temporary file", () => {
  const target = path.join(fixture, "atomic.txt");
  atomicWriteFile(target, "old");
  const rename = fs.renameSync;
  mock.method(fs, "renameSync", (source, destination) => {
    if (destination === target) throw new Error("Synthetic rename failure");
    return rename(source, destination);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => atomicWriteFile(target, "new"), /Synthetic rename failure/);
    assert.equal(fs.readFileSync(target, "utf8"), "old");
    assert.deepEqual(fs.readdirSync(fixture).filter(name => name.startsWith("atomic.txt.")), []);
  } finally { mock.restoreAll(); syncBuiltinESMExports(); }
});

test("partial temporary writes, flush failures and corrupt reads never replace the good copy", () => {
  const target = path.join(fixture, "failure-matrix.txt");
  for (const phase of ["write", "fsync", "verify"]) {
    atomicWriteFile(target, "retained-good-copy");
    const originalWrite = fs.writeFileSync;
    const originalRead = fs.readFileSync;
    if (phase === "write") mock.method(fs, "writeFileSync", (file, data, ...options: any[]) => {
      originalWrite(file, Buffer.from("partial"));
      throw new Error("Synthetic partial write failure");
    });
    if (phase === "fsync") mock.method(fs, "fsyncSync", () => { throw new Error("Synthetic fsync failure"); });
    if (phase === "verify") mock.method(fs, "readFileSync", (file, ...options: any[]) =>
      String(file).endsWith(".tmp") ? Buffer.from("corrupt") : (originalRead as any)(file, ...options));
    syncBuiltinESMExports();
    try { assert.throws(() => atomicWriteFile(target, "new-copy")); }
    finally { mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(fs.readFileSync(target, "utf8"), "retained-good-copy");
    assert.deepEqual(fs.readdirSync(fixture).filter(name => name.startsWith("failure-matrix.txt.")), []);
  }
});

test("runtime ownership rejects shared root, canonical database and shared vector store", () => {
  assert.throws(() => acquireRuntimeOwnership(path.join(fixture, "data"), path.join(fixture, "data", "other.db")), /owned/);
  assert.throws(() => acquireRuntimeOwnership(path.join(fixture, "other-runtime"), databasePath), /owned/);
  assert.throws(() => acquireRuntimeOwnership(path.join(fixture, "third-runtime"), path.join(fixture, "third.db"), [path.join(fixture, "data", "qdrant")]), /owned/);
  const separate = acquireRuntimeOwnership(path.join(fixture, "independent"), path.join(fixture, "independent.db"));
  separate.release();
});

test("independent process cannot take an owned runtime; dead process lock is recovered", () => {
  const moduleUrl = pathToFileURL(path.join(repository, "server", "persistence.ts")).href;
  const loader = pathToFileURL(path.join(repository, "node_modules", "tsx", "dist", "loader.mjs")).href;
  const run = (code: string) => spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval", code], { cwd: fixture, encoding: "utf8", timeout: 10000, windowsHide: true });
  const blocked = run(`import {acquireRuntimeOwnership} from ${JSON.stringify(moduleUrl)}; acquireRuntimeOwnership(${JSON.stringify(path.join(fixture, "data"))}, ${JSON.stringify(path.join(fixture, "child.db"))});`);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /owned/);
  const crashedRoot = path.join(fixture, "crashed-runtime");
  const crashedDb = path.join(crashedRoot, "app.db");
  const crashed = run(`import {acquireRuntimeOwnership} from ${JSON.stringify(moduleUrl)}; acquireRuntimeOwnership(${JSON.stringify(crashedRoot)}, ${JSON.stringify(crashedDb)}); process.kill(process.pid, 'SIGKILL');`);
  assert.notEqual(crashed.status, 0);
  assert.equal(fs.existsSync(path.join(crashedRoot, ".prisonbreak.lock")), true);
  const reclaimed = acquireRuntimeOwnership(crashedRoot, crashedDb);
  reclaimed.release();
  assert.equal(fs.existsSync(path.join(crashedRoot, ".prisonbreak.lock")), false);
});

test("case operation lease prevents overlapping mutations and rejects missing case", async () => {
  const caseId = await createCase();
  const release = await operations.acquireCaseOperation(caseId, "grow");
  assert.equal(operations.getActiveCaseOperation(caseId), "grow");
  for (const kind of ["edit", "upload", "analyze", "trial", "handoff", "delete"]) {
    await assert.rejects(operations.acquireCaseOperation(caseId, kind), /busy/);
  }
  release();
  assert.equal(operations.getActiveCaseOperation(caseId), null);
  await assert.rejects(operations.acquireCaseOperation(999999, "upload"), /not found/);
  assert.equal(operations.getActiveCaseOperation(999999), null);
});

function seedDerived(caseId: number) {
  db.atomicDatabaseTransaction(sqlite => {
    sqlite.run("UPDATE cases SET caseFacts = '{}', status = 'completed', ragIndexedAt = 1 WHERE id = ?", [caseId]);
    sqlite.run("INSERT INTO casePetals (caseId, petalKey, corpusKey, status) VALUES (?, 'laws', 'laws-old', 'completed')", [caseId]);
    sqlite.run("INSERT INTO trialResults (caseId, result, handoff) VALUES (?, '{}', '{}')", [caseId]);
  });
}

test("meaningful metadata changes and uploads invalidate all derived state, not no-op edits", async () => {
  const caseId = await createCase("Same title");
  seedDerived(caseId);
  await db.updateCase(caseId, { title: "Same title" });
  assert.equal((await db.getCaseById(caseId))?.caseFacts, "{}");
  await db.updateCase(caseId, { jurisdiction: "Synthetic jurisdiction" });
  assert.equal((await db.getCaseById(caseId))?.caseFacts, null);
  const { casePetals, trialResults } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  assert.deepEqual(await db.getDb().select().from(casePetals).where(eq(casePetals.caseId, caseId)), []);
  assert.deepEqual(await db.getDb().select().from(trialResults).where(eq(trialResults.caseId, caseId)), []);
  seedDerived(caseId);
  await db.addDocument(caseId, "synthetic.txt", "fake-key", "fake-url", "fake-hash", "text/plain", 1);
  assert.equal((await db.getCaseById(caseId))?.caseFacts, null);
  assert.deepEqual(await db.getDb().select().from(trialResults).where(eq(trialResults.caseId, caseId)), []);
});

test("failed vector cleanup keeps case, identities and files; retry removes all scoped state", async () => {
  const erasedMarker = "SYNTHETIC_DELETE_MARKER_6bd370ba";
  const caseId = await createCase(erasedMarker);
  await db.addDocument(caseId, "synthetic.txt", "fake-key", "fake-url", "fake-hash");
  const upload = path.join(fixture, "data", "uploads", "cases", String(caseId));
  fs.mkdirSync(upload, { recursive: true });
  fs.writeFileSync(path.join(upload, "synthetic.txt"), "synthetic only");
  await assert.rejects(deletion.deleteCaseWithCleanup(caseId, async () => { throw new Error("Synthetic Qdrant failure"); }), /incomplete/);
  assert.equal((await db.getCaseById(caseId))?.deletionState, "error");
  assert.equal((await db.getDocumentsByCaseId(caseId)).length, 1);
  assert.equal(fs.existsSync(upload), true);
  await assert.rejects(operations.acquireCaseOperation(caseId, "analyze"), /incomplete/);
  assert.deepEqual(await deletion.deleteCaseWithCleanup(caseId, async () => undefined), { success: true });
  assert.equal(await db.getCaseById(caseId), undefined);
  assert.deepEqual(await db.getDocumentsByCaseId(caseId), []);
  assert.equal(fs.existsSync(upload), false);
  assert.equal(fs.readFileSync(databasePath).includes(Buffer.from(erasedMarker)), false);
});

test("failed filesystem cleanup leaves a retryable tombstone after vector deletion", async () => {
  const caseId = await createCase();
  const upload = path.join(fixture, "data", "uploads", "cases", String(caseId));
  fs.mkdirSync(upload, { recursive: true });
  const remove = fs.rmSync;
  mock.method(fs, "rmSync", (target, options) => {
    if (target === upload) throw new Error("Synthetic locked file");
    return remove(target, options);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(deletion.deleteCaseWithCleanup(caseId, async () => undefined), /incomplete/);
    assert.equal((await db.getCaseById(caseId))?.deletionState, "error");
  } finally { mock.restoreAll(); syncBuiltinESMExports(); }
  await deletion.deleteCaseWithCleanup(caseId, async () => undefined);
});

test("transaction rollback prevents partial source-ledger activation", () => {
  assert.throws(() => db.atomicDatabaseTransaction(sqlite => {
    sqlite.run("INSERT INTO cases (userId, title) VALUES (1, 'must rollback')");
    throw new Error("Synthetic transaction failure");
  }), /Synthetic transaction failure/);
  const rows = db.atomicDatabaseTransaction(sqlite => sqlite.exec("SELECT id FROM cases WHERE title = 'must rollback'"));
  assert.deepEqual(rows, []);
});

test("failed DB replacement preserves the only disk copy and blocks subsequent mutations", async () => {
  const original = fs.readFileSync(databasePath);
  const rename = fs.renameSync;
  mock.method(fs, "renameSync", (source, destination) => {
    if (destination === databasePath) throw new Error("Synthetic disk failure");
    return rename(source, destination);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(createCase("must not persist"), (error: any) => /persistence failed/.test(error.cause?.message ?? error.message));
    assert.equal(fs.readFileSync(databasePath).equals(original), true);
    await assert.rejects(createCase("later mutation blocked"), /persistence failed/);
  } finally { mock.restoreAll(); syncBuiltinESMExports(); }
  db.closeDb();
  await db.initDb();
  assert.equal((await db.getCasesByUserId(1)).some(row => /must not persist|later mutation blocked/.test(row.title)), false);
  assert.equal(fs.readdirSync(path.dirname(databasePath)).some(name => /\.tmp$|\.bak$/.test(name)), false);
});

test("startup clears abandoned pre-rename DB copies but not unrelated files", async () => {
  db.closeDb();
  const orphan = `${databasePath}.00000000-0000-0000-0000-000000000001.tmp`;
  const unrelated = `${databasePath}.operator-note.tmp`;
  fs.writeFileSync(orphan, "synthetic old record");
  fs.writeFileSync(unrelated, "operator-owned filename");
  await db.initDb();
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.existsSync(unrelated), true);
});

test("restart marks interrupted analysis, Grow and deletion as retryable", async () => {
  const caseId = await createCase();
  db.atomicDatabaseTransaction(sqlite => {
    sqlite.run("UPDATE cases SET status = 'analyzing', deletionState = 'deleting' WHERE id = ?", [caseId]);
    sqlite.run("INSERT INTO casePetals (caseId, petalKey, status) VALUES (?, 'laws', 'building')", [caseId]);
  });
  db.closeDb();
  await db.initDb();
  assert.equal((await db.getCaseById(caseId))?.status, "error");
  assert.equal((await db.getCaseById(caseId))?.deletionState, "error");
  const rows = db.atomicDatabaseTransaction(sqlite => sqlite.exec("SELECT status FROM casePetals WHERE caseId = ?", [caseId]));
  assert.equal(rows[0].values[0][0], "failed");
});

test("restart retains the previous completed research generation when a rebuild was interrupted", async () => {
  const caseId = await createCase();
  db.atomicDatabaseTransaction(sqlite => sqlite.run("INSERT INTO casePetals (caseId, petalKey, corpusKey, status) VALUES (?, 'laws', 'existing-generation', 'building')", [caseId]));
  db.closeDb();
  await db.initDb();
  const rows = db.atomicDatabaseTransaction(sqlite => sqlite.exec("SELECT status, corpusKey, errorMessage FROM casePetals WHERE caseId = ?", [caseId]));
  assert.deepEqual(rows[0].values[0], ["completed", "existing-generation", "Interrupted; retry Grow"]);
});

test("upload route rejects missing cases and busy cases before creating local files", async () => {
  const { appRouter } = await import("../server/routers");
  const caller = appRouter.createCaller({ user: { id: 1 } } as any);
  await assert.rejects(caller.documents.upload({ caseId: 99999, fileName: "synthetic.txt", fileData: "c3ludGhldGlj" }), /not found/);
  const caseId = await createCase();
  const release = await operations.acquireCaseOperation(caseId, "grow");
  try {
    await assert.rejects(caller.documents.upload({ caseId, fileName: "synthetic.txt", fileData: "c3ludGhldGlj" }), /busy/);
    await assert.rejects(caller.cases.update({ id: caseId, title: "changed" }), /busy/);
  } finally { release(); }
  assert.equal(fs.existsSync(path.join(fixture, "data", "uploads", "cases", String(caseId))), false);
  const result = await caller.documents.upload({ caseId, fileName: "synthetic.txt", fileData: "c3ludGhldGlj" });
  assert.equal(result.success, true);
  assert.equal((await db.getDocumentsByCaseId(caseId)).length, 1);
});
