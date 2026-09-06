/**
 * SQLite-backed data layer using sql.js (pure WASM, no native build).
 *
 * sql.js was chosen over better-sqlite3 so the app installs cleanly on
 * every platform with zero compilation — better-sqlite3 has no prebuilt
 * binary for Windows ARM64 and would otherwise require MSVC tooling
 * via node-gyp. The trade-off is an async API and an in-memory DB that
 * we manually flush to disk on each mutation.
 *
 * All data-access functions are async. `await initDb()` MUST be called
 * before any tRPC handler runs (see server/_core/index.ts).
 */
import { and, eq } from "drizzle-orm";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as fs from "node:fs";
import * as path from "node:path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";

import {
  caseNotes,
  cases,
  documents,
  researchSources,
  users,
} from "../drizzle/schema";
import * as schema from "../drizzle/schema";
import { ENV } from "./_core/env";
import { acquireRuntimeOwnership, atomicWriteFile, removeAbandonedAtomicWrites } from "./persistence";
import { getDataRoot } from "./runtimePaths";

/** Single-user app: every userId column references this row. */
export const LOCAL_USER_ID = 1;
const LOCAL_USER_OPEN_ID = "local-user";

let _db: SqliteRemoteDatabase<typeof schema> | undefined;
let _sqlite: SqlJsDatabase | undefined;
let _dbPath: string | undefined;
let _SQL: Awaited<ReturnType<typeof initSqlJs>> | undefined;
let _releaseOwnership: (() => void) | undefined;
let _initializing: Promise<void> | undefined;
let _persistenceFault: Error | undefined;

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function configureSqlite(sqlite: SqlJsDatabase): void {
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA secure_delete = ON");
}

function exportDatabase(sqlite: SqlJsDatabase): Uint8Array {
  // sql.js export closes/reopens its connection, resetting connection PRAGMAs.
  const bytes = sqlite.export();
  configureSqlite(sqlite);
  return bytes;
}

function flushToDisk(): void {
  if (!_sqlite || !_dbPath) return;
  const bytes = exportDatabase(_sqlite);
  const verification = new _SQL!.Database(bytes);
  try {
    const result = verification.exec("PRAGMA integrity_check");
    if (result.length !== 1 || result[0].values.length !== 1 || result[0].values[0][0] !== "ok") throw new Error("Database export failed integrity checking");
  } finally { verification.close(); }
  atomicWriteFile(_dbPath, Buffer.from(bytes));
}

function restoreSnapshot(snapshot: Uint8Array): void {
  _sqlite?.close();
  _sqlite = new _SQL!.Database(snapshot);
  configureSqlite(_sqlite);
}

/** One synchronous mutation boundary: no awaits or interleaved DB callbacks. */
export function atomicDatabaseTransaction<T>(operation: (sqlite: SqlJsDatabase) => T): T {
  if (!_sqlite || _persistenceFault) throw new Error("Database unavailable; restart after checking persistent storage.");
  const snapshot = exportDatabase(_sqlite);
  try {
    _sqlite.run("BEGIN");
    const result = operation(_sqlite);
    if (result && typeof (result as any).then === "function") throw new Error("Database transaction callbacks must be synchronous");
    _sqlite.run("COMMIT");
    try { flushToDisk(); }
    catch (error) { _persistenceFault = new Error("Database persistence failed; writes are blocked until restart.", { cause: error }); throw _persistenceFault; }
    return result;
  } catch (error) {
    restoreSnapshot(snapshot);
    throw error;
  }
}

function applyMigrations(sqliteDb: SqlJsDatabase): void {
  const migrationsDir = path.join(process.cwd(), "drizzle", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[Database] No migrations directory at ${migrationsDir}`);
    return;
  }

  sqliteDb.run(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )`
  );

  const appliedResult = sqliteDb.exec("SELECT hash FROM __drizzle_migrations");
  const applied = new Set<string>();
  if (appliedResult.length > 0) {
    for (const row of appliedResult[0].values) {
      applied.add(String(row[0]));
    }
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const fullPath = path.join(migrationsDir, file);
    const sqlText = fs.readFileSync(fullPath, "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of statements) sqliteDb.run(stmt);
    sqliteDb.run(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      [file, Date.now()]
    );
    console.log(`[Database] Applied migration: ${file}`);
  }
}

async function seedLocalUser(db: SqliteRemoteDatabase<typeof schema>): Promise<void> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, LOCAL_USER_ID));

  if (existing.length > 0) return;

  await db.insert(users).values({
    id: LOCAL_USER_ID,
    openId: LOCAL_USER_OPEN_ID,
    name: "Local User",
    role: "admin",
  });

  console.log(`[Database] Seeded local user (id=${LOCAL_USER_ID})`);
}

const MUTATING_PREFIXES = ["INSERT", "UPDATE", "DELETE", "REPLACE"];
function isMutating(sql: string): boolean {
  const upper = sql.trimStart().toUpperCase();
  return MUTATING_PREFIXES.some(p => upper.startsWith(p));
}

/** Initialize the database. Must be awaited before any route handler runs. */
export async function initDb(): Promise<void> {
  if (_initializing) return _initializing;
  if (_persistenceFault) throw _persistenceFault;
  if (_db) return;
  _initializing = initializeDatabase();
  try { await _initializing; } finally { _initializing = undefined; }
}

async function initializeDatabase(): Promise<void> {
  const ownership = acquireRuntimeOwnership(getDataRoot(), ENV.databasePath, [process.env.PRISONBREAK_QDRANT_PATH ?? path.join(getDataRoot(), "qdrant")]);
  _releaseOwnership = ownership.release;
  try {

  const dbPath = ownership.databasePath;
  ensureParentDir(dbPath);
  removeAbandonedAtomicWrites(dbPath);
  removeAbandonedAtomicWrites(path.join(getDataRoot(), "settings.json"));

  const SQL = await initSqlJs();
  _SQL = SQL;
  const buffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const sqliteDb = buffer ? new SQL.Database(buffer) : new SQL.Database();
  configureSqlite(sqliteDb);

  applyMigrations(sqliteDb);
  // Jobs do not survive process exit. Surface interruption instead of pretending
  // a stale in-progress operation is still running after a clean restart.
  sqliteDb.run("UPDATE cases SET status = 'error' WHERE status = 'analyzing'");
  sqliteDb.run("UPDATE casePetals SET status = CASE WHEN corpusKey IS NOT NULL THEN 'completed' ELSE 'failed' END, errorMessage = 'Interrupted; retry Grow', progress = CASE WHEN corpusKey IS NOT NULL THEN 100 ELSE 0 END WHERE status IN ('building', 'pending')");
  sqliteDb.run("UPDATE cases SET deletionState = 'error', deletionError = 'Deletion interrupted; retry deleting this case' WHERE deletionState = 'deleting'");

  _sqlite = sqliteDb;
  _dbPath = dbPath;
  flushToDisk();

  _db = drizzle<typeof schema>(
    async (sqlText: string, params: unknown[], method) => {
      if (_persistenceFault) throw _persistenceFault;
      const db = _sqlite;
      if (!db) throw new Error("sql.js DB unavailable");
      const execute = (sqlite: SqlJsDatabase) => {
        if (method === "run") { sqlite.run(sqlText, params as any[]); return { rows: [] }; }
        const stmt = sqlite.prepare(sqlText);
        try {
          stmt.bind(params as any[]);
          const rows: unknown[][] = [];
          while (stmt.step()) rows.push(stmt.get() as unknown[]);
          return { rows: method === "get" ? rows[0] ?? [] : rows };
        } finally { stmt.free(); }
      };
      return isMutating(sqlText) ? atomicDatabaseTransaction(execute) : execute(db);
    },
    { schema }
  );

  await seedLocalUser(_db);
  console.log(`[Database] SQLite opened at ${dbPath}`);
  } catch (error) { closeDb(); throw error; }
}

/** Used during shutdown and isolated tests. Never exports uncommitted RAM. */
export function closeDb(): void {
  _sqlite?.close();
  _sqlite = undefined;
  _db = undefined;
  _dbPath = undefined;
  _persistenceFault = undefined;
  _releaseOwnership?.();
  _releaseOwnership = undefined;
}

export function getDb(): SqliteRemoteDatabase<typeof schema> {
  if (_persistenceFault) throw _persistenceFault;
  if (!_db) throw new Error("DB not initialized — call initDb() first");
  return _db;
}

// ──────────────────────────────────────────────────────────────────────
// Cases
// ──────────────────────────────────────────────────────────────────────

export async function createCase(
  userId: number,
  title: string,
  caseNumber?: string,
  jurisdiction?: string,
  charges?: string
) {
  const db = getDb();
  const result = await db
    .insert(cases)
    .values({ userId, title, caseNumber, jurisdiction, charges, status: "pending" })
    .returning({ insertId: cases.id });
  return result;
}

export async function getCasesByUserId(userId: number) {
  const db = getDb();
  return db.select().from(cases).where(eq(cases.userId, userId));
}

export async function getCaseById(caseId: number) {
  const db = getDb();
  const result = await db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateCaseStatus(
  caseId: number,
  status: "pending" | "analyzing" | "completed" | "error"
) {
  const db = getDb();
  await db.update(cases).set({ status }).where(eq(cases.id, caseId));
}

export async function updateCase(
  caseId: number,
  data: { title?: string; caseNumber?: string; jurisdiction?: string; charges?: string }
) {
  const db = getDb();
  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.caseNumber !== undefined) updateData.caseNumber = data.caseNumber;
  if (data.jurisdiction !== undefined) updateData.jurisdiction = data.jurisdiction;
  if (data.charges !== undefined) updateData.charges = data.charges;
  if (Object.keys(updateData).length === 0) return;
  const current = await getCaseById(caseId);
  if (!current) throw new Error("Case not found");
  const changes = Object.entries(updateData).filter(([key, value]) => value !== current[key as keyof typeof current]);
  if (!changes.length) return;
  atomicDatabaseTransaction(sqlite => {
    sqlite.run(`UPDATE cases SET ${changes.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`, [...changes.map(([, value]) => value), caseId] as any[]);
    invalidateDerived(sqlite, caseId);
  });
}

/** Persist the JSON-encoded fact sheet produced by Analyze. */
export async function setCaseFacts(caseId: number, factsJson: string) {
  const db = getDb();
  await db
    .update(cases)
    .set({ caseFacts: factsJson, updatedAt: new Date() })
    .where(eq(cases.id, caseId));
}

export async function markCaseIndexed(caseId: number, indexedAt = new Date()) {
  const db = getDb();
  await db
    .update(cases)
    .set({ ragIndexedAt: indexedAt, updatedAt: indexedAt })
    .where(eq(cases.id, caseId));
}

/** Any new upload makes the prior fact sheet and retrieval timestamp stale. */
export async function invalidateCaseAnalysis(caseId: number) {
  atomicDatabaseTransaction(sqlite => invalidateDerived(sqlite, caseId));
}

function invalidateDerived(sqlite: SqlJsDatabase, caseId: number): void {
  sqlite.run("UPDATE cases SET ragIndexedAt = NULL, caseFacts = NULL, status = 'pending', updatedAt = ? WHERE id = ?", [Math.floor(Date.now() / 1000), caseId]);
  sqlite.run("DELETE FROM casePetals WHERE caseId = ?", [caseId]);
  sqlite.run("DELETE FROM trialResults WHERE caseId = ?", [caseId]);
  // Keep source identities for case-wide deletion; inactive generations are not
  // offered to retrieval once the active petal pointers have been cleared.
}

export async function markDocumentIndexed(
  documentId: number,
  chunkCount: number,
  indexedAt = new Date(),
) {
  const db = getDb();
  await db
    .update(documents)
    .set({ ragIndexedAt: indexedAt, ragChunkCount: chunkCount })
    .where(eq(documents.id, documentId));
}

/**
 * Cascade-delete everything associated with a case: every row in every
 * per-case table, plus the case row itself and local uploads. Qdrant
 * vectors are deleted by the caller before this database cascade.
 */
export async function deleteCase(caseId: number) {
  const row = await getCaseById(caseId);
  if (!row || row.deletionState !== "deleting") throw new Error("Case deletion must be started before final cleanup");
  atomicDatabaseTransaction(sqlite => {
    for (const table of ["documents", "caseNotes", "researchSources", "casePetals", "trialResults"]) sqlite.run(`DELETE FROM ${table} WHERE caseId = ?`, [caseId]);
    sqlite.run("DELETE FROM cases WHERE id = ?", [caseId]);
  });
}

export async function beginCaseDeletion(caseId: number): Promise<void> {
  await getDb().update(cases).set({ deletionState: "deleting", deletionError: null }).where(eq(cases.id, caseId));
}

export async function failCaseDeletion(caseId: number): Promise<void> {
  await getDb().update(cases).set({ deletionState: "error", deletionError: "Local cleanup failed. Retry deleting this case." }).where(eq(cases.id, caseId));
}

/** Delete only current, case-scoped paths; never guess ownership of legacy logs. */
export function deleteCaseFiles(caseId: number): void {
  if (!Number.isSafeInteger(caseId) || caseId <= 0) throw new Error("Invalid case ID");
  const root = path.resolve(getDataRoot());
  for (const relative of [path.join("uploads", "cases"), path.join("research", "cases"), path.join("orchestrator-debug", "cases")]) {
    const dir = path.resolve(root, relative, String(caseId));
    if (!dir.startsWith(root + path.sep)) throw new Error("Case cleanup path escapes runtime root");
    if (!fs.existsSync(dir)) continue;
    const realRoot = fs.realpathSync.native(root);
    const realDir = fs.realpathSync.native(dir);
    const expected = path.join(realRoot, relative, String(caseId));
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalize(realDir) !== normalize(expected)) throw new Error("Case cleanup path is redirected; refusing to remove another location");
    fs.rmSync(dir, { recursive: true, force: false });
    if (fs.existsSync(dir)) throw new Error("Case files still present after cleanup");
  }
}

// ──────────────────────────────────────────────────────────────────────
// Documents
// ──────────────────────────────────────────────────────────────────────

export async function addDocument(
  caseId: number,
  fileName: string,
  fileKey: string,
  fileUrl: string,
  fileHash: string,
  mimeType?: string,
  fileSize?: number
) {
  return atomicDatabaseTransaction(sqlite => {
    sqlite.run("INSERT INTO documents (caseId, fileName, fileKey, fileUrl, fileHash, mimeType, fileSize) VALUES (?, ?, ?, ?, ?, ?, ?)", [caseId, fileName, fileKey, fileUrl, fileHash, mimeType ?? null, fileSize ?? null]);
    const insertId = Number(sqlite.exec("SELECT last_insert_rowid()")[0].values[0][0]);
    invalidateDerived(sqlite, caseId);
    return [{ insertId }];
  });
}

export async function getDocumentsByCaseId(caseId: number) {
  const db = getDb();
  return db.select().from(documents).where(eq(documents.caseId, caseId));
}

export async function checkDuplicateDocument(caseId: number, fileHash: string) {
  const db = getDb();
  const result = await db
    .select()
    .from(documents)
    .where(and(eq(documents.caseId, caseId), eq(documents.fileHash, fileHash)))
    .limit(1);
  return result.length > 0;
}

// ─────────────────────────────────────
// Research-source ledger
// ─────────────────────────────────────

export async function replaceResearchSources(
  caseId: number,
  corpusKey: string,
  rows: Array<{
    url: string;
    title: string;
    publisher?: string | null;
    excerpt: string;
    snapshotPath: string;
    contentHash: string;
    retrievedAt: Date;
    indexedAt?: Date | null;
  }>,
) {
  atomicDatabaseTransaction(sqlite => {
    sqlite.run("DELETE FROM researchSources WHERE caseId = ? AND corpusKey = ?", [caseId, corpusKey]);
    for (const row of rows) sqlite.run(
      "INSERT INTO researchSources (caseId, corpusKey, url, title, publisher, excerpt, snapshotPath, contentHash, retrievedAt, indexedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [caseId, corpusKey, row.url, row.title, row.publisher ?? null, row.excerpt, row.snapshotPath, row.contentHash, Math.floor(row.retrievedAt.getTime() / 1000), row.indexedAt ? Math.floor(row.indexedAt.getTime() / 1000) : null],
    );
  });
  return listResearchSources(caseId, corpusKey);
}

export async function listResearchSources(caseId: number, corpusKey?: string) {
  const db = getDb();
  const condition = corpusKey
    ? and(
        eq(researchSources.caseId, caseId),
        eq(researchSources.corpusKey, corpusKey),
      )
    : eq(researchSources.caseId, caseId);
  return await db.select().from(researchSources).where(condition);
}

// ──────────────────────────────────────────────────────────────────────
// Case notes
// ──────────────────────────────────────────────────────────────────────

export async function createCaseNote(caseId: number, userId: number, content: string) {
  const db = getDb();
  const result = await db
    .insert(caseNotes)
    .values({ caseId, userId, content })
    .returning({ insertId: caseNotes.id });
  return result;
}

export async function getCaseNotesByCaseId(caseId: number) {
  const db = getDb();
  return db.select().from(caseNotes).where(eq(caseNotes.caseId, caseId));
}

export async function getCaseNoteById(noteId: number) {
  return (await getDb().select().from(caseNotes).where(eq(caseNotes.id, noteId)).limit(1))[0];
}

export async function updateCaseNote(noteId: number, content: string) {
  const db = getDb();
  await db.update(caseNotes).set({ content }).where(eq(caseNotes.id, noteId));
}

export async function deleteCaseNote(noteId: number) {
  const db = getDb();
  await db.delete(caseNotes).where(eq(caseNotes.id, noteId));
}
