/**
 * Drizzle helpers for the casePetals table.
 *
 * One row per (case, petal) pair. UNIQUE INDEX on (caseId, petalKey)
 * means inserts are upserts effectively — call `ensurePetalRow` on
 * every analysis run; it'll create or reset as appropriate.
 */
import { and, eq } from "drizzle-orm";
import { atomicDatabaseTransaction, getDb } from "../db";
import {
  casePetals,
  type CasePetal,
  type PetalKey,
  type PetalStatus,
} from "./types-bridge";

export async function listPetalsForCase(caseId: number): Promise<CasePetal[]> {
  const db = getDb();
  return (await db
    .select()
    .from(casePetals)
    .where(eq(casePetals.caseId, caseId))) as CasePetal[];
}

export async function getPetal(
  caseId: number,
  petalKey: PetalKey
): Promise<CasePetal | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(casePetals)
    .where(and(eq(casePetals.caseId, caseId), eq(casePetals.petalKey, petalKey)))
    .limit(1);
  return rows.length > 0 ? (rows[0] as CasePetal) : null;
}

/**
 * Get-or-create without changing the active generation. Rebuild progress must
 * never erase the last usable source set before its replacement is indexed.
 */
export async function ensurePetalRow(
  caseId: number,
  petalKey: PetalKey
): Promise<number> {
  const db = getDb();
  const existing = await getPetal(caseId, petalKey);
  if (existing) {
    return existing.id;
  }
  const inserted = await db
    .insert(casePetals)
    .values({ caseId, petalKey })
    .returning({ id: casePetals.id });
  return Number(inserted[0].id);
}

/** The only visibility switch: all staged vectors already exist before this
 * transaction publishes their corpus key and invalidates derived trial work. */
export function activatePetalGeneration(input: {
  caseId: number; petalId: number; corpusKey: string; sourceCount: number; summary: string;
}): void {
  atomicDatabaseTransaction(sqlite => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run('UPDATE researchSources SET indexedAt = ? WHERE caseId = ? AND corpusKey = ?',
      [now, input.caseId, input.corpusKey]);
    sqlite.run(`UPDATE casePetals SET status = 'completed', progress = 100,
      corpusKey = ?, sourceCount = ?, summary = ?, errorMessage = NULL,
      reasonSkipped = NULL, completedAt = ?, updatedAt = ? WHERE id = ? AND caseId = ?`,
      [input.corpusKey, input.sourceCount, input.summary, now, now, input.petalId, input.caseId]);
    sqlite.run('DELETE FROM trialResults WHERE caseId = ?', [input.caseId]);
  });
}

export interface PetalUpdate {
  status?: PetalStatus;
  progress?: number;
  corpusKey?: string | null;
  sourceCount?: number;
  summary?: string | null;
  reasonSkipped?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export async function updatePetal(
  petalId: number,
  patch: PetalUpdate
): Promise<void> {
  const db = getDb();
  await db
    .update(casePetals)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(casePetals.id, petalId));
}
