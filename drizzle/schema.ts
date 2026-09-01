import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * SQLite schema for PrisonBreak.
 *
 *  - The `users` table is vestigial. There is no auth — a single
 *    `LOCAL_USER_ID = 1` row is seeded on first boot and every
 *    `userId` foreign-key references it.
 *  - Timestamps use SQLite INTEGER (`mode: "timestamp"`) so Drizzle
 *    converts to/from JS `Date` automatically.
 *  - JSON-shaped fields use `text({ mode: "json" })` and store real
 *    JSON instead of stringified blobs.
 */

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Stable identifier for the local user (always "local-user"). */
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const cases = sqliteTable("cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId").notNull(),
  caseNumber: text("caseNumber"),
  title: text("title").notNull(),
  jurisdiction: text("jurisdiction"),
  charges: text("charges"),
  status: text("status", {
    enum: ["pending", "analyzing", "completed", "error"],
  })
    .notNull()
    .default("pending"),
  /** Last successful rebuild of the case's local Qdrant corpus. */
  ragIndexedAt: integer("ragIndexedAt", { mode: "timestamp" }),
  /**
   * Standardized fact sheet extracted from the local case corpus by the
   * "Analyze" step. JSON-encoded `CaseFacts` (see shared/caseFacts.ts).
   * Null until the user has clicked Analyze. Drives petal source-picking
   * (Phase 1) and the orchestrator's cross-query plan (Phase 2).
   */
  caseFacts: text("caseFacts"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Case = typeof cases.$inferSelect;
export type InsertCase = typeof cases.$inferInsert;

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("caseId").notNull(),
  fileName: text("fileName").notNull(),
  fileKey: text("fileKey").notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileHash: text("fileHash").notNull(),
  mimeType: text("mimeType"),
  fileSize: integer("fileSize"),
  /** Last time this exact file hash was indexed into local Qdrant. */
  ragIndexedAt: integer("ragIndexedAt", { mode: "timestamp" }),
  /** Number of cited chunks currently stored for this document. */
  ragChunkCount: integer("ragChunkCount").notNull().default(0),
  uploadedAt: integer("uploadedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

export const caseNotes = sqliteTable("caseNotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("caseId").notNull(),
  userId: integer("userId").notNull(),
  content: text("content").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type CaseNote = typeof caseNotes.$inferSelect;
export type InsertCaseNote = typeof caseNotes.$inferInsert;

/**
 * Per-case research domains. The flower visualization renders this table.
 * Each row = one (case, petal) pair. The flower UI renders this table.
 * See docs/ARCHITECTURE.md.
 */
export const casePetals = sqliteTable("casePetals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("caseId").notNull(),
  /** Stable petal identifier: "core" | "laws" | "jurisprudence" | "procedural" | ... */
  petalKey: text("petalKey").notNull(),
  /** Stable local-Qdrant corpus name after a successful build. */
  corpusKey: text("corpusKey"),
  /** Number of web sources retained in the local source ledger. */
  sourceCount: integer("sourceCount").notNull().default(0),
  /** 'pending' | 'building' | 'completed' | 'failed' | 'skipped' */
  status: text("status", {
    enum: ["pending", "building", "completed", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  /** 0..100 for the petal's fill animation. */
  progress: integer("progress").notNull().default(0),
  /** One-line domain summary produced after the petal's build query. */
  summary: text("summary"),
  /** If status='skipped', why (e.g. "case has no forensic evidence"). */
  reasonSkipped: text("reasonSkipped"),
  errorMessage: text("errorMessage"),
  startedAt: integer("startedAt", { mode: "timestamp" }),
  completedAt: integer("completedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type CasePetal = typeof casePetals.$inferSelect;
export type InsertCasePetal = typeof casePetals.$inferInsert;

/**
 * Durable ledger for sources acquired by Codex CLI or Claude CLI web research.
 * Qdrant is rebuildable; this table and the local snapshot are the citation
 * record that must survive an index rebuild.
 */
export const researchSources = sqliteTable("researchSources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("caseId").notNull(),
  corpusKey: text("corpusKey").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  publisher: text("publisher"),
  excerpt: text("excerpt").notNull(),
  snapshotPath: text("snapshotPath").notNull(),
  contentHash: text("contentHash").notNull(),
  retrievedAt: integer("retrievedAt", { mode: "timestamp" }).notNull(),
  indexedAt: integer("indexedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ResearchSource = typeof researchSources.$inferSelect;
export type InsertResearchSource = typeof researchSources.$inferInsert;

/**
 * Take-to-Trial orchestrator output cache. One row per case. The
 * three-pass result (prosecutor + defender + synthesizer verdict) is
 * JSON-encoded so the schema doesn't have to track every field as the
 * synthesizer's verdict shape evolves.
 */
export const trialResults = sqliteTable("trialResults", {
  caseId: integer("caseId").primaryKey(),
  /** JSON-encoded TrialResult (see server/orchestrator/types.ts). */
  result: text("result").notNull(),
  completedAt: integer("completedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  /** JSON-encoded DefenderHandoff. Null until the user generates it
   *  via cases.generateHandoff. The translator pass writes here after
   *  reshaping the verdict for the public-defender audience. */
  handoff: text("handoff"),
});

export type TrialResultRow = typeof trialResults.$inferSelect;
export type InsertTrialResultRow = typeof trialResults.$inferInsert;
