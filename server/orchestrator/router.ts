/**
 * Orchestrator tRPC router — `cases.takeToTrial` mutation + a query for
 * the cached result.
 *
 * The mutation is fire-and-forget: returns immediately with `{ started:
 * true }`, and progress streams via socket.io's `trial-stage` events to
 * the case room. On completion, the runner upserts into trialResults.
 *
 * The query reads from trialResults so the panel can render the last
 * verdict on mount without re-running.
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getCaseById } from "../db";
import { readSettings } from "../_core/settings";
import { startTakeToTrialInBackground } from "./runner";
import { getHandoff, getTrialResult, upsertHandoff, upsertTrialResult } from "./db";
import { makeProvider } from "./providers";
import { runTranslatorPass } from "./passes/translator";
import { verifyHandoffCitations } from "./verify";
import type { OrchestratorSettings } from "./types";

export const orchestratorRouter = router({
  takeToTrial: publicProcedure
    .input(z.object({ caseId: z.number() }))
    .mutation(async ({ input }) => {
      const caseRow = await getCaseById(input.caseId);
      if (!caseRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      }
      if (!caseRow.caseFacts) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Case has not been analyzed yet — analyze first.",
        });
      }

      const settings = readSettings();
      const orchestrator = settings.orchestrator;
      if (!orchestrator) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Orchestrator settings missing.",
        });
      }
      const hasKey =
        orchestrator.provider === "anthropic"
          ? !!orchestrator.anthropicApiKey
          : !!orchestrator.openaiApiKey;
      if (!hasKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${orchestrator.provider} API key not configured. Add one in Settings.`,
        });
      }

      const runtimeSettings: OrchestratorSettings = {
        provider: orchestrator.provider,
        model: orchestrator.model,
        anthropicApiKey: orchestrator.anthropicApiKey,
        openaiApiKey: orchestrator.openaiApiKey,
      };

      // Fire-and-forget; progress streams via WebSocket.
      startTakeToTrialInBackground(input.caseId, runtimeSettings, async (result) => {
        await upsertTrialResult(result);
      });

      return { started: true as const, caseId: input.caseId };
    }),

  getTrialResult: publicProcedure
    .input(z.object({ caseId: z.number() }))
    .query(async ({ input }) => {
      return await getTrialResult(input.caseId);
    }),

  /**
   * Generate the Defender Handoff one-pager from the cached verdict.
   *
   * Synchronous (the translator pass is one LLM call, no tool loop —
   * typically 10-30s). Persists to trialResults.handoff and returns the
   * handoff in the response so the caller doesn't need to refetch.
   *
   * Requires a TrialResult to exist (run Take-to-Trial first).
   */
  generateHandoff: publicProcedure
    .input(z.object({ caseId: z.number() }))
    .mutation(async ({ input }) => {
      const trial = await getTrialResult(input.caseId);
      if (!trial) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Take-to-Trial has not been run for this case yet. Run it first, then generate the handoff.",
        });
      }
      const caseRow = await getCaseById(input.caseId);
      if (!caseRow?.caseFacts) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Case fact sheet missing — re-run Analyze.",
        });
      }

      const settings = readSettings();
      const orchestrator = settings.orchestrator;
      if (!orchestrator) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Orchestrator settings missing.",
        });
      }
      const hasKey =
        orchestrator.provider === "anthropic"
          ? !!orchestrator.anthropicApiKey
          : !!orchestrator.openaiApiKey;
      if (!hasKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${orchestrator.provider} API key not configured. Add one in Settings.`,
        });
      }

      const runtimeSettings: OrchestratorSettings = {
        provider: orchestrator.provider,
        model: orchestrator.model,
        anthropicApiKey: orchestrator.anthropicApiKey,
        openaiApiKey: orchestrator.openaiApiKey,
      };
      const provider = makeProvider(runtimeSettings);

      const rawHandoff = await runTranslatorPass({
        provider,
        model: runtimeSettings.model,
        factSheet: caseRow.caseFacts,
        prosecutorReading: trial.prosecutor,
        defenderReading: trial.defender,
        verdict: trial.verdict,
      });

      // Verify each question's quoted passage against the source file
      // on disk (CB-1). Unverified questions get a tag the UI surfaces
      // so the PD knows to open the source directly rather than trusting
      // a possibly-hallucinated quote.
      const handoff = await verifyHandoffCitations(rawHandoff, input.caseId);

      await upsertHandoff(input.caseId, handoff);
      return handoff;
    }),

  getHandoff: publicProcedure
    .input(z.object({ caseId: z.number() }))
    .query(async ({ input }) => {
      return await getHandoff(input.caseId);
    }),
});
