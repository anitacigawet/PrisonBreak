/**
 * Provider abstraction — Claude (Anthropic) and OpenAI behind a single
 * interface. Both providers support tool use; the orchestrator's passes
 * call `runWithTools` and get back either text output (the pass is done)
 * or a list of tool-call requests (the pass wants to query a notebook).
 *
 * The orchestrator runs a tool-use loop: call provider → if tool calls
 * come back, execute them via `tools/` wrappers → feed the results back
 * → repeat until the provider returns text. Standard agent pattern.
 */
import type { LLMProviderId } from "../types";

/** The tool's schema, as the provider sees it. Both SDKs accept a
 *  similar shape; this is the lowest common denominator. */
export interface ProviderToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** A single message in the conversation passed to `runWithTools`. */
export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | {
      /** An assistant turn that called tools. Carries the tool calls
       *  forward so the next iteration can include them in the SDK's
       *  expected shape — Anthropic needs the tool_use content block,
       *  OpenAI needs the tool_calls field. Without this, the
       *  subsequent tool_result references an id that doesn't exist in
       *  the conversation and both APIs return 400. */
      role: "assistant-with-tool-calls";
      text?: string;
      calls: Array<{
        toolCallId: string;
        toolName: string;
        input: Record<string, unknown>;
      }>;
    }
  | {
      role: "tool-result";
      toolCallId: string;
      toolName: string;
      output: string;
    };

/** What the provider returns from one `runWithTools` call. */
export type ProviderResponse =
  | {
      kind: "text";
      /** The final text from the assistant. */
      text: string;
    }
  | {
      kind: "tool-calls";
      /** The assistant's intermediate text alongside the tool calls
       *  (some providers return both — concat for the conversation log). */
      text?: string;
      calls: Array<{
        toolCallId: string;
        toolName: string;
        input: Record<string, unknown>;
      }>;
    };

/** Schema the provider should constrain the model's final-text output to.
 *  Only honored when the model is NOT calling a tool — tool calls still
 *  follow the tool's own input schema. OpenAI uses this via
 *  response_format: { type: "json_schema", json_schema: {...strict:true} }
 *  which mechanically guarantees the model's text output validates. */
export interface ResponseSchema {
  name: string;
  description?: string;
  /** JSON Schema (draft 2020-12). Must be Structured-Outputs-compatible
   *  in OpenAI's terms: every property in `required`,
   *  `additionalProperties: false` everywhere, no `oneOf` at the root. */
  schema: Record<string, unknown>;
  strict: true;
}

export interface RunWithToolsOptions {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ProviderToolDef[];
  /** Provider-specific model identifier. */
  model: string;
  /** Soft cap on total output tokens. */
  maxTokens?: number;
  /** Optional schema for the model's final JSON output. OpenAI enforces
   *  it mechanically; Anthropic falls back to Zod validation downstream. */
  responseSchema?: ResponseSchema;
}

export interface LLMProvider {
  /** Provider identity (used for logging/audit). */
  readonly id: LLMProviderId;
  /** One round-trip to the provider's API. Returns either final text
   *  or tool calls the orchestrator should execute and feed back. */
  runWithTools(opts: RunWithToolsOptions): Promise<ProviderResponse>;
}
