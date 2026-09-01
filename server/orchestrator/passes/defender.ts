/**
 * Defender pass — produces a `DefenderReading`. Runs AFTER the
 * prosecutor pass; receives the prosecutor's reading as context so the
 * defender knows what to contest.
 */
import { loadPersona, parsePassJson, runPass } from "./common";
import { DefenderReadingSchema, toOpenAISchema } from "../schemas";
import type { LLMProvider } from "../providers";
import type {
  DefenderReading,
  ProsecutorReading,
  TrialStageEvent,
} from "../types";
import { assertGroundedCitations, collectGroundedCitations } from "../grounding";

export interface DefenderOpts {
  caseId: number;
  provider: LLMProvider;
  model: string;
  factSheet: string;
  prosecutorReading: ProsecutorReading;
  emit: (event: TrialStageEvent) => void;
}

const RESPONSE_SCHEMA = toOpenAISchema(
  DefenderReadingSchema,
  "DefenderReading",
  "The defender pass's grounded counter-reading — element-by-element contests, available motions, procedural failures.",
);

export async function runDefenderPass(opts: DefenderOpts): Promise<DefenderReading> {
  opts.emit({ kind: "pass-start", pass: "defender", label: "Building the defender's reading…" });

  const systemPrompt = loadPersona("defender");
  const initial = [
    "Here is the case's standardized fact sheet:",
    "",
    "```json",
    opts.factSheet,
    "```",
    "",
    "The prosecutor persona has already analyzed this case. Their reading was:",
    "",
    "```json",
    JSON.stringify(opts.prosecutorReading, null, 2),
    "```",
    "",
    "Read the same evidence through the defender's lens. Copy every citationId, sourceLabel, passage, locator, and sourceUrl exactly from a retrieval result or the prosecutor reading; use null for sourceUrl when none was returned. Surface missing evidence, suppression-eligible items, contestable interpretations, available motions, and procedural failures. Emit the final JSON object matching the DefenderReading shape.",
  ].join("\n");

  const run = await runPass({
    pass: "defender",
    provider: opts.provider,
    model: opts.model,
    systemPrompt,
    initialUserMessage: initial,
    caseId: opts.caseId,
    emit: opts.emit,
    responseSchema: RESPONSE_SCHEMA,
  });

  opts.emit({ kind: "pass-end", pass: "defender" });
  const reading = parsePassJson<DefenderReading>(run.text, "defender", DefenderReadingSchema);
  assertGroundedCitations(
    reading,
    [...run.evidence, ...collectGroundedCitations(opts.prosecutorReading)],
    "Defender pass",
  );
  return reading;
}
