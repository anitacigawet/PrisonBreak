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

/** Single-user app: every userId column references this row. */
export const LOCAL_USER_ID = 1;
const LOCAL_USER_OPEN_ID = "local-user";

let _db: SqliteRemoteDatabase<typeof schema> | undefined;
let _sqlite: SqlJsDatabase | undefined;
let _dbPath: string | undefined;

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function flushToDisk(): void {
  if (!_sqlite || !_dbPath) return;
  fs.writeFileSync(_dbPath, Buffer.from(_sqlite.export()));
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
  if (_db) return;

  const dbPath = ENV.databasePath;
  ensureParentDir(dbPath);

  const SQL = await initSqlJs();
  const buffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const sqliteDb = buffer ? new SQL.Database(buffer) : new SQL.Database();
  sqliteDb.run("PRAGMA foreign_keys = ON");

  applyMigrations(sqliteDb);

  _sqlite = sqliteDb;
  _dbPath = dbPath;
  flushToDisk();

  _db = drizzle<typeof schema>(
    async (sqlText: string, params: unknown[], method) => {
      const db = _sqlite;
      if (!db) throw new Error("sql.js DB unavailable");

      if (method === "run") {
        db.run(sqlText, params as any[]);
        if (isMutating(sqlText)) flushToDisk();
        return { rows: [] };
      }

      const stmt = db.prepare(sqlText);
      try {
        stmt.bind(params as any[]);
        const rows: unknown[][] = [];
        while (stmt.step()) {
          rows.push(stmt.get() as unknown[]);
        }
        if (isMutating(sqlText)) flushToDisk();
        if (method === "get") return { rows: rows[0] ?? [] };
        return { rows };
      } finally {
        stmt.free();
      }
    },
    { schema }
  );

  await seedLocalUser(_db);
  console.log(`[Database] SQLite opened at ${dbPath}`);
}

export function getDb(): SqliteRemoteDatabase<typeof schema> {
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
  await db.update(cases).set(updateData).where(eq(cases.id, caseId));
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
  const db = getDb();
  await db
    .update(cases)
    .set({
      ragIndexedAt: null,
      caseFacts: null,
      status: "pending",
      updatedAt: new Date(),
    })
    .where(eq(cases.id, caseId));
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
  const db = getDb();

  // ── DB cascade (every per-case table, including post-2026-05 additions) ──
  await db.delete(documents).where(eq(documents.caseId, caseId));
  await db.delete(caseNotes).where(eq(caseNotes.caseId, caseId));
  await db.delete(researchSources).where(eq(researchSources.caseId, caseId));
  await db.delete(schema.casePetals).where(eq(schema.casePetals.caseId, caseId));
  await db.delete(schema.trialResults).where(eq(schema.trialResults.caseId, caseId));
  await db.delete(cases).where(eq(cases.id, caseId));

  // ── Disk cleanup (uploads + retained web-source snapshots) ──
  // Best-effort: don't fail the whole delete if a directory is locked or
  // missing. Log and continue.
  const uploadsDir = path.join(process.cwd(), "data", "uploads", "cases", String(caseId));
  const researchDir = path.join(process.cwd(), "data", "research", "cases", String(caseId));
  for (const dir of [uploadsDir, researchDir]) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`[deleteCase] Failed to remove ${dir}:`, (err as Error).message);
    }
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
  const db = getDb();
  const result = await db
    .insert(documents)
    .values({ caseId, fileName, fileKey, fileUrl, fileHash, mimeType, fileSize })
    .returning({ insertId: documents.id });
  return result;
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
  const db = getDb();
  await db
    .delete(researchSources)
    .where(
      and(
        eq(researchSources.caseId, caseId),
        eq(researchSources.corpusKey, corpusKey),
      ),
    );
  if (rows.length === 0) return [];
  return await db
    .insert(researchSources)
    .values(rows.map(row => ({ caseId, corpusKey, ...row })))
    .returning();
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

export async function updateCaseNote(noteId: number, content: string) {
  const db = getDb();
  await db.update(caseNotes).set({ content }).where(eq(caseNotes.id, noteId));
}

export async function deleteCaseNote(noteId: number) {
  const db = getDb();
  await db.delete(caseNotes).where(eq(caseNotes.id, noteId));
}
