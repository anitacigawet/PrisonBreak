/**
 * Synthesizer pass — produces a `TrialVerdict`.
 *
 * Does NOT use the queryCase/queryPetal tools — its job is purely
 * structural comparison of the two grounded readings it was given.
 * No tool surface is provided (the provider's tools list is empty).
 *
 * The synthesizer persona references Wertheimer's Productive Thinking;
 * verbatim passages live in synthesizer.md (currently TODO).
 */
import { loadPersona, parsePassJson } from "./common";
import { TrialVerdictSchema, toOpenAISchema } from "../schemas";
import type { LLMProvider } from "../providers";
import type {
  DefenderReading,
  ProsecutorReading,
  TrialStageEvent,
  TrialVerdict,
} from "../types";
import { assertGroundedCitations, collectGroundedCitations } from "../grounding";

const RESPONSE_SCHEMA = toOpenAISchema(
  TrialVerdictSchema,
  "TrialVerdict",
  "Structural comparison of prosecutor + defender readings — uncontested findings, pivots, unsupported claims, plain-English summary.",
);

export interface SynthesizerOpts {
  provider: LLMProvider;
  model: string;
  prosecutorReading: ProsecutorReading;
  defenderReading: DefenderReading;
  emit: (event: TrialStageEvent) => void;
}

export async function runSynthesizerPass(opts: SynthesizerOpts): Promise<TrialVerdict> {
  opts.emit({ kind: "pass-start", pass: "synthesizer", label: "Identifying structural pivots…" });

  const systemPrompt = loadPersona("synthesizer");
  const userMessage = [
    "You have been given two grounded readings of the same case.",
    "",
    "**Prosecutor's reading:**",
    "```json",
    JSON.stringify(opts.prosecutorReading, null, 2),
    "```",
    "",
    "**Defender's reading:**",
    "```json",
    JSON.stringify(opts.defenderReading, null, 2),
    "```",
    "",
    "Per the Wertheimer-informed framework in your system prompt, compare these two grounded readings structurally. Identify:",
    "",
    "- Uncontested findings (both readings agree, or one asserts and the other does not contest).",
    "- Structural pivots — the small number of single-inference / single-ruling / single-interpretation points the case turns on. Surface each with both readings' positions and categorize the kind of disagreement.",
    "- Unsupported findings — claims the prosecution needs but cannot ground from the record, or gaps the defender flagged.",
    "- A one-paragraph plain-English summary for the defendant, naming the pivots.",
    "",
    "Emit the final JSON object matching the TrialVerdict shape. JSON only, no preamble.",
  ].join("\n");

  // No tools for synthesizer — it works only with what was given.
  const response = await opts.provider.runWithTools({
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [],
    model: opts.model,
    maxTokens: 8192,
    responseSchema: RESPONSE_SCHEMA,
  });

  let text = "";
  if (response.kind === "text") {
    text = response.text;
  } else {
    // Shouldn't happen — synthesizer has no tools available. Take any
    // interim text and treat the lack of tools as a signal to finalize.
    text = response.text ?? "";
  }

  opts.emit({ kind: "pass-end", pass: "synthesizer" });
  const verdict = parsePassJson<TrialVerdict>(text, "synthesizer", TrialVerdictSchema);
  assertGroundedCitations(
    verdict,
    [
      ...collectGroundedCitations(opts.prosecutorReading),
      ...collectGroundedCitations(opts.defenderReading),
    ],
    "Synthesizer pass",
  );
  return verdict;
}
