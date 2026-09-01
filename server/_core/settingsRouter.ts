/**
 * Settings tRPC router.
 *
 * Exposes the safe (redacted) settings shape to the client, plus an
 * `updateOrchestrator` mutation for the Settings page to write the
 * provider config (provider + model + API keys). API keys are write-only
 * from the UI — `get` returns boolean flags, not the keys themselves.
 */
import { z } from "zod";
import { publicProcedure, router } from "./trpc";
import { readSafeSettings, writeSettings } from "./settings";

export const settingsRouter = router({
  get: publicProcedure.query(() => {
    return readSafeSettings();
  }),

  updateOrchestrator: publicProcedure
    .input(
      z.object({
        provider: z.enum(["anthropic", "openai"]).optional(),
        model: z.string().optional(),
        /** If a key is provided as an empty string, it CLEARS that key.
         *  If omitted (undefined), the existing key is preserved. */
        anthropicApiKey: z.string().optional(),
        openaiApiKey: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      // Empty string means clear; undefined means leave alone.
      const patch: {
        provider?: "anthropic" | "openai";
        model?: string;
        anthropicApiKey?: string;
        openaiApiKey?: string;
      } = {};
      if (input.provider) patch.provider = input.provider;
      if (input.model) patch.model = input.model;
      if (input.anthropicApiKey !== undefined) {
        patch.anthropicApiKey = input.anthropicApiKey;
      }
      if (input.openaiApiKey !== undefined) {
        patch.openaiApiKey = input.openaiApiKey;
      }
      writeSettings({
        orchestrator: {
          // Defaults filled in by readSettings if any field is missing.
          provider: patch.provider ?? "openai",
          model: patch.model ?? "gpt-4.1-mini",
          anthropicApiKey: patch.anthropicApiKey,
          openaiApiKey: patch.openaiApiKey,
        },
      });
      return { ok: true as const };
    }),
});
