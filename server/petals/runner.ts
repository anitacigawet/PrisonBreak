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
import { getCaseById } from "../db";
import { emitPetalsComplete, emitPetalsStarted } from "../_core/websocket";
import { buildPetal } from "./builder";
import { PETAL_SPECS } from "./registry";

export interface GrowthOutcome {
  caseId: number;
  total: number;
  completed: number;
  skipped: number;
  failed: number;
}

/**
 * Kick off a sequential petal build for a case. Returns immediately;
 * the work runs in a background promise.
 */
export function startPetalGrowth(caseId: number): void {
  void runPetalGrowthInBackground(caseId);
}

async function runPetalGrowthInBackground(caseId: number): Promise<void> {
  const caseRow = await getCaseById(caseId);
  if (!caseRow) {
    throw new Error(`startPetalGrowth: case ${caseId} not found`);
  }

  emitPetalsStarted(caseId, { total: PETAL_SPECS.length });

  const outcome: GrowthOutcome = {
    caseId,
    total: PETAL_SPECS.length,
    completed: 0,
    skipped: 0,
    failed: 0,
  };

  for (const spec of PETAL_SPECS) {
    const result = await buildPetal(caseRow, spec);
    if (result.status === "completed") outcome.completed += 1;
    else if (result.status === "skipped") outcome.skipped += 1;
    else outcome.failed += 1;
    // Failed petals do NOT abort the run — other research corpora are
    // independent and worth trying. The UI will show the failure on the
    // affected petal and proceed with the next one.
  }

  emitPetalsComplete(caseId, outcome);
}
