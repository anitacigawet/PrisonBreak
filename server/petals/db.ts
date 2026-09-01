/**
 * Drizzle helpers for the casePetals table.
 *
 * One row per (case, petal) pair. UNIQUE INDEX on (caseId, petalKey)
 * means inserts are upserts effectively — call `ensurePetalRow` on
 * every analysis run; it'll create or reset as appropriate.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
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
 * Get-or-create a petal row. If one already exists for (caseId,
 * petalKey), it's reset to status='pending' and progress=0 so a
 * re-grow starts cleanly.
 */
export async function ensurePetalRow(
  caseId: number,
  petalKey: PetalKey
): Promise<number> {
  const db = getDb();
  const existing = await getPetal(caseId, petalKey);
  if (existing) {
    await db
      .update(casePetals)
      .set({
        status: "pending",
        progress: 0,
        summary: null,
        reasonSkipped: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(casePetals.id, existing.id));
    return existing.id;
  }
  const inserted = await db
    .insert(casePetals)
    .values({ caseId, petalKey })
    .returning({ id: casePetals.id });
  return Number(inserted[0].id);
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
