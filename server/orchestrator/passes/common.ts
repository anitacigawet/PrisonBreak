/**
 * Shared pass-runner — the tool-use loop. Each pass (prosecutor /
 * defender / synthesizer) calls this with its persona and gets back the
 * final assistant text (which the pass parses as JSON).
 *
 * Loop:
 *   1. send messages + tools to provider
 *   2. if response.kind === "text" → done, return text
 *   3. if response.kind === "tool-calls" → execute each via runTool,
 *      append assistant+tool-result messages to history, repeat.
 *
 * Caps the loop at MAX_ITERATIONS to prevent runaway tool spirals.
 * Emits a `tool-call` / `tool-result` event for each
 * step so the frontend visualization sees real-time progress.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { z } from "zod";
import { buildToolDefs, runTool } from "../tools";
import type { LLMProvider } from "../providers";
import type { ProviderMessage, ResponseSchema } from "../providers/types";
import type { PassId, TrialStageEvent } from "../types";
import { parseToolEvidence, type GroundedCitationValue } from "../grounding";

const MAX_ITERATIONS = 14;
/** Final-pass output ceiling. Defender/prosecutor JSON for a mid-sized
 *  case is ~3-6kB; 4096 tokens (the SDK default) truncates and produces
 *  unterminated JSON that JSON.parse rejects. 8192 leaves slack. */
const PASS_MAX_TOKENS = 8192;
const PERSONAS_DIR = path.join(process.cwd(), "server", "orchestrator", "personas");
const DEBUG_DIR = path.join(process.cwd(), "data", "orchestrator-debug");

export function loadPersona(name: string): string {
  return fs.readFileSync(path.join(PERSONAS_DIR, `${name}.md`), "utf-8");
}

export interface PassRunOptions {
  pass: PassId;
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  initialUserMessage: string;
  caseId: number;
  /** Emit progress events. */
  emit: (event: TrialStageEvent) => void;
  /** Optional Structured-Outputs schema for the model's final text. */
  responseSchema?: ResponseSchema;
}

export interface PassRunResult {
  text: string;
  evidence: GroundedCitationValue[];
}

export async function runPass(opts: PassRunOptions): Promise<PassRunResult> {
  const messages: ProviderMessage[] = [
    { role: "user", content: opts.initialUserMessage },
  ];
  const evidence = new Map<string, GroundedCitationValue>();

  // Tools advertised to the LLM are scoped to what's actually available
  // for this case (only bloomed petals appear in the queryPetal enum;
  // queryPetal is dropped entirely if zero petals are bloomed). Prevents
  // burning tokens on calls that would only ever return "petal X not
  // bloomed" errors.
  const tools = await buildToolDefs(opts.caseId);

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    const response = await opts.provider.runWithTools({
      systemPrompt: opts.systemPrompt,
      messages,
      tools,
      model: opts.model,
      maxTokens: PASS_MAX_TOKENS,
      responseSchema: opts.responseSchema,
    });

    if (response.kind === "text") {
      return { text: response.text, evidence: Array.from(evidence.values()) };
    }

    // Tool calls — append the assistant turn (carrying its tool calls
    // so each provider can reconstruct the SDK-required shape on the
    // next round-trip) + each tool result, then loop.
    messages.push({
      role: "assistant-with-tool-calls",
      text: response.text,
      calls: response.calls,
    });

    for (const call of response.calls) {
      const tool = call.toolName === "queryCase" || call.toolName === "queryPetal"
        ? (call.toolName as "queryCase" | "queryPetal")
        : null;
      const queryStr =
        (call.input.question as string | undefined) ?? JSON.stringify(call.input);
      const petalKey =
        (call.input.petalKey as string | undefined) ?? undefined;

      opts.emit({
        kind: "tool-call",
        pass: opts.pass,
        tool: tool ?? "queryCase",
        query: queryStr,
        target: petalKey,
      });

      const output = await runTool(call.toolName, call.input, { caseId: opts.caseId });
      for (const citation of parseToolEvidence(output)) {
        evidence.set(citation.citationId, citation);
      }

      opts.emit({
        kind: "tool-result",
        pass: opts.pass,
        tool: tool ?? "queryCase",
        preview: output.slice(0, 200),
      });

      messages.push({
        role: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output,
      });
    }
  }

  throw new Error(
    `${opts.pass} pass exceeded ${MAX_ITERATIONS} tool-use iterations without producing a final answer.`,
  );
}

/**
 * Best-effort JSON extraction + Zod validation of the LLM's final text.
 *
 * Steps:
 *   1. Strip markdown fences and slice to the outer braces (handles
 *      models that wrap JSON in prose despite the persona telling them
 *      not to).
 *   2. JSON.parse to get a value.
 *   3. Zod-validate against the pass's schema if one is provided.
 *
 * On failure: dump the full text + error to data/orchestrator-debug/
 * so we can diagnose without having to re-run the orchestrator. Throws
 * with the dump path included.
 */
export function parsePassJson<T>(
  text: string,
  label: string,
  schema?: z.ZodType<T>,
): T {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const m = s.match(fence);
  if (m) s = m[1].trim();
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }

  // Stage 1: JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (err) {
    throw makeBadOutputError(label, text, s, "JSON.parse", (err as Error).message);
  }

  // Stage 2: Zod validation (if schema provided)
  console.log(
    `[Orchestrator] parsePassJson(${label}) schema=${schema ? "provided" : "MISSING"}`,
  );
  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      console.log(`[Orchestrator] parsePassJson(${label}) Zod REJECTED — ${result.error.issues.length} issues`);
      const summary = result.error.issues
        .slice(0, 5)
        .map((iss) => `  - ${iss.path.join(".") || "<root>"}: ${iss.message}`)
        .join("\n");
      throw makeBadOutputError(
        label,
        text,
        s,
        "Zod schema",
        `${result.error.issues.length} issue(s):\n${summary}`,
      );
    }
    return result.data;
  }
  return parsed as T;
}

function makeBadOutputError(
  label: string,
  rawText: string,
  slicedText: string,
  stage: string,
  detail: string,
): Error {
  let dumpPath: string | null = null;
  try {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    dumpPath = path.join(DEBUG_DIR, `${stamp}-${label}-bad.txt`);
    fs.writeFileSync(
      dumpPath,
      `# Pass: ${label}\n` +
        `# Stage: ${stage}\n` +
        `# Detail: ${detail}\n` +
        `# Raw output (${rawText.length} chars, sliced to ${slicedText.length}):\n\n` +
        rawText,
      "utf8",
    );
  } catch {
    // best-effort — don't mask the real error
  }
  return new Error(
    `${label} pass output rejected at ${stage} (${slicedText.length} chars). ` +
      `${detail}. ` +
      `${dumpPath ? `Dump: ${dumpPath}` : ""}`,
  );
}
