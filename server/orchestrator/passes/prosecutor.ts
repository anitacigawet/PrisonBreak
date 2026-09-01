/**
 * Prosecutor pass — produces a `ProsecutorReading`.
 *
 * Loads the prosecutor persona, kicks off the tool-use loop with an
 * initial user message that hands the model the case's fact sheet, and
 * parses the final JSON. The synthesizer pass consumes its output.
 */
import { loadPersona, parsePassJson, runPass } from "./common";
import { ProsecutorReadingSchema, toOpenAISchema } from "../schemas";
import type { LLMProvider } from "../providers";
import type {
  ProsecutorReading,
  TrialStageEvent,
} from "../types";
import { assertGroundedCitations } from "../grounding";

export interface ProsecutorOpts {
  caseId: number;
  provider: LLMProvider;
  model: string;
  /** The case's standardized fact sheet (cases.caseFacts), stringified. */
  factSheet: string;
  emit: (event: TrialStageEvent) => void;
}

const RESPONSE_SCHEMA = toOpenAISchema(
  ProsecutorReadingSchema,
  "ProsecutorReading",
  "The prosecutor pass's grounded reading of the case, element by element.",
);

export async function runProsecutorPass(opts: ProsecutorOpts): Promise<ProsecutorReading> {
  opts.emit({ kind: "pass-start", pass: "prosecutor", label: "Building the prosecutor's reading…" });

  const systemPrompt = loadPersona("prosecutor");
  const initial = [
    "Here is the case's standardized fact sheet (extracted by the Analyze step):",
    "",
    "```json",
    opts.factSheet,
    "```",
    "",
    "Use the retrieval tools to gather evidence. Copy every citationId, sourceLabel, passage, locator, and sourceUrl exactly; use null for sourceUrl when the tool returned none. When you have enough, emit the final JSON object matching the ProsecutorReading shape.",
  ].join("\n");

  const run = await runPass({
    pass: "prosecutor",
    provider: opts.provider,
    model: opts.model,
    systemPrompt,
    initialUserMessage: initial,
    caseId: opts.caseId,
    emit: opts.emit,
    responseSchema: RESPONSE_SCHEMA,
  });

  opts.emit({ kind: "pass-end", pass: "prosecutor" });
  const reading = parsePassJson<ProsecutorReading>(run.text, "prosecutor", ProsecutorReadingSchema);
  assertGroundedCitations(reading, run.evidence, "Prosecutor pass");
  return reading;
}
