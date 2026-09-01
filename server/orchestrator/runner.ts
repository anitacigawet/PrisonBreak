/**
 * takeToTrial — top-level orchestrator. Runs three passes in sequence
 * (prosecutor → defender → synthesizer), emits stage events for the
 * frontend visualization, and returns the final TrialResult.
 *
 * Designed to run as a background promise from the tRPC mutation: the
 * mutation returns immediately, and progress streams via socket.io to
 * the case room. Mirrors the pattern used by `startPetalGrowth`.
 */
import { emitTrialStage } from "../_core/websocket";
import { getCaseById } from "../db";
import { runProsecutorPass } from "./passes/prosecutor";
import { runDefenderPass } from "./passes/defender";
import { runSynthesizerPass } from "./passes/synthesizer";
import { makeProvider } from "./providers";
import type {
  OrchestratorSettings,
  TrialResult,
  TrialStageEvent,
} from "./types";

export interface TakeToTrialOptions {
  caseId: number;
  settings: OrchestratorSettings;
}

export async function takeToTrial(opts: TakeToTrialOptions): Promise<TrialResult> {
  const { caseId, settings } = opts;

  const emit = (event: TrialStageEvent) => emitTrialStage(caseId, event);

  try {
    emit({ kind: "start" });

    const caseRow = await getCaseById(caseId);
    if (!caseRow) throw new Error(`Case ${caseId} not found`);
    if (!caseRow.caseFacts) {
      throw new Error(
        "Case has not been analyzed — caseFacts is null. Run Analyze first.",
      );
    }

    const provider = makeProvider(settings);
    const model = settings.model;
    const factSheet = caseRow.caseFacts;

    const prosecutorReading = await runProsecutorPass({
      caseId,
      provider,
      model,
      factSheet,
      emit,
    });

    const defenderReading = await runDefenderPass({
      caseId,
      provider,
      model,
      factSheet,
      prosecutorReading,
      emit,
    });

    const verdict = await runSynthesizerPass({
      provider,
      model,
      prosecutorReading,
      defenderReading,
      emit,
    });

    const result: TrialResult = {
      caseId,
      prosecutor: prosecutorReading,
      defender: defenderReading,
      verdict,
      completedAt: new Date().toISOString(),
      provider: settings.provider,
      model,
    };

    emit({ kind: "complete", verdict });
    return result;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    emit({ kind: "error", message });
    throw err;
  }
}

/**
 * Fire-and-forget variant — returns immediately. The caller's tRPC
 * mutation can use this to spin off the orchestrator without blocking;
 * progress streams via emit, and the final result can be persisted
 * inside the runner or via a separate hook.
 */
export function startTakeToTrialInBackground(
  caseId: number,
  settings: OrchestratorSettings,
  onComplete?: (result: TrialResult) => void | Promise<void>,
): void {
  void (async () => {
    try {
      const result = await takeToTrial({ caseId, settings });
      if (onComplete) await onComplete(result);
    } catch {
      // Errors already emitted via socket; swallow here.
    }
  })();
}
