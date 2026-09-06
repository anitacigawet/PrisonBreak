/**
 * Petals runner — orchestrates building all applicable petals for a case.
 *
 * Builds petals sequentially so each research corpus is fetched,
 * snapshotted, and indexed before the next one begins. The side label
 * "growing petal" moves from one petal to the next as each completes.
 *
 * The runner doesn't block the calling tRPC mutation — `growPetalsForCase`
 * returns immediately and the actual work happens in a background
 * promise that updates DB rows + emits WebSocket events.
 */
import { TRPCError } from "@trpc/server";
import type { Case } from "../../drizzle/schema";
import { getCaseById } from "../db";
import { acquireCaseOperation } from "../caseOperations";
import { validateResearchConfiguration } from "../research";
import { emitPetalProgress, emitPetalsComplete, emitPetalsStarted } from "../_core/websocket";
import { buildPetal } from "./builder";
import { ensurePetalRow, getPetal, listPetalsForCase, updatePetal } from "./db";
import { PETAL_SPECS } from "./registry";

export interface GrowthOutcome {
  caseId: number;
  total: number;
  completed: number;
  skipped: number;
  failed: number;
}

/**
 * Validate and reserve a sequential petal build before acknowledging it;
 * the provider work then runs in a caught background promise.
 */
export async function startPetalGrowth(caseId: number): Promise<void> {
  const release = await acquireCaseOperation(caseId, "grow");
  try {
    const caseRow = await getCaseById(caseId);
    if (!caseRow?.caseFacts || caseRow.status !== "completed") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Analyze the current case documents before growing research." });
    }
    validateResearchConfiguration();
    // Persist planned rows before ACK; all background failures are contained.
    for (const spec of PETAL_SPECS) await ensurePetalRow(caseId, spec.key);
    void runPetalGrowthInBackground(caseRow).catch(() => {
      console.error("[Grow] Could not persist the terminal workflow state.");
    }).finally(release);
  } catch (error) {
    release();
    throw error;
  }
}

export async function runPetalGrowthInBackground(caseRow: Case): Promise<void> {
  const caseId = caseRow.id;
  const outcome: GrowthOutcome = {
    caseId,
    total: PETAL_SPECS.length,
    completed: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    emitPetalsStarted(caseId, { total: PETAL_SPECS.length });
    for (const spec of PETAL_SPECS) {
      const current = await getPetal(caseId, spec.key);
      if (current?.status === "completed" && !current.errorMessage) { outcome.completed++; continue; }
      if (current?.status === "skipped") { outcome.skipped++; continue; }
      const result = await buildPetal(caseRow, spec);
      if (result.status === "completed") outcome.completed += 1;
      else if (result.status === "skipped") outcome.skipped += 1;
      else outcome.failed += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research workflow failed.";
    // Even if the database has failed closed and cannot persist a failure row,
    // the terminal event must not report zero failures.
    outcome.failed++;
    const rows = await listPetalsForCase(caseId);
    const unfinished = rows.filter(row => row.status === "building" || row.status === "pending");
    outcome.failed += Math.max(0, unfinished.length - 1);
    for (const row of unfinished) {
      const retained = !!row.corpusKey && row.sourceCount > 0;
      await updatePetal(row.id, { status: retained ? "completed" : "failed", progress: retained ? 100 : 0, errorMessage: message, completedAt: new Date() });
      const spec = PETAL_SPECS.find(spec => spec.key === row.petalKey)!;
      emitPetalProgress(caseId, { key: row.petalKey, label: spec.label, description: spec.description,
        status: retained ? "completed" : "failed", progress: retained ? 100 : 0, corpusKey: row.corpusKey,
        sourceCount: row.sourceCount, summary: row.summary, reasonSkipped: null, errorMessage: message });
    }
  } finally {
    emitPetalsComplete(caseId, outcome);
  }
}
