/**
 * Translator pass — produces a `DefenderHandoff` from a cached
 * `TrialResult` + the case's `caseFacts`.
 *
 * No new retrieval or web-research round-trips. This is a pure transform
 * over the synthesizer's verdict. The translator picks the top 3 actionable
 * pivots, reshapes them as questions for the public defender (with
 * verbatim citation passages), and emits the one-page handoff shape.
 *
 * The audience framing is deliberately restrained — a public defender
 * glancing at this should feel
 * "professional," not "impressive").
 */
import { loadPersona, parsePassJson } from "./common";
import { DefenderHandoffSchema, toOpenAISchema } from "../schemas";
import type { LLMProvider } from "../providers";
import type {
  DefenderHandoff,
  ProsecutorReading,
  DefenderReading,
  TrialVerdict,
} from "../types";
import { assertGroundedCitations, collectGroundedCitations } from "../grounding";

const RESPONSE_SCHEMA = toOpenAISchema(
  DefenderHandoffSchema,
  "DefenderHandoff",
  "Single-page handoff document the defendant brings to their public defender — three prioritized questions with verbatim-citation grounding.",
);

export interface TranslatorOpts {
  provider: LLMProvider;
  model: string;
  /** The case's standardized fact sheet (cases.caseFacts), stringified. */
  factSheet: string;
  prosecutorReading: ProsecutorReading;
  defenderReading: DefenderReading;
  verdict: TrialVerdict;
}

export async function runTranslatorPass(opts: TranslatorOpts): Promise<DefenderHandoff> {
  const systemPrompt = loadPersona("translator");

  const userMessage = [
    "Below is everything you need to compose the Defender Handoff one-pager.",
    "",
    "**Case fact sheet** (use to template the case header):",
    "",
    "```json",
    opts.factSheet,
    "```",
    "",
    "**Prosecutor's reading** (for cross-reference when picking citation passages):",
    "",
    "```json",
    JSON.stringify(opts.prosecutorReading, null, 2),
    "```",
    "",
    "**Defender's reading** (for cross-reference when picking citation passages):",
    "",
    "```json",
    JSON.stringify(opts.defenderReading, null, 2),
    "```",
    "",
    "**Verdict** (the canonical pivot map — pick your handoff questions from here):",
    "",
    "```json",
    JSON.stringify(opts.verdict, null, 2),
    "```",
    "",
    "Per the rules in your system prompt, emit the final JSON object matching the DefenderHandoff shape. JSON only, no preamble.",
  ].join("\n");

  // No tools — translator works only from given material.
  const response = await opts.provider.runWithTools({
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [],
    model: opts.model,
    maxTokens: 4096,
    responseSchema: RESPONSE_SCHEMA,
  });

  const text = response.kind === "text" ? response.text : response.text ?? "";
  const handoff = parsePassJson<DefenderHandoff>(text, "translator", DefenderHandoffSchema);
  assertGroundedCitations(
    handoff,
    collectGroundedCitations(opts.verdict),
    "Defender Handoff translator",
  );
  return handoff;
}
