/**
 * OpenAI provider — GPT / o-series with function calling.
 *
 * Wraps the openai SDK's `chat.completions.create` into the
 * `LLMProvider` interface. The orchestrator does the loop — this module
 * is just one round-trip per call.
 */
import OpenAI from "openai";
import type {
  LLMProvider,
  ProviderResponse,
  RunWithToolsOptions,
} from "./types";

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai" as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("OpenAIProvider: missing API key");
    }
    this.client = new OpenAI({ apiKey });
  }

  async runWithTools(opts: RunWithToolsOptions): Promise<ProviderResponse> {
    // Build the typed message array via accumulator (not flatMap) so
    // the discriminated union narrows correctly on each branch.
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.systemPrompt },
    ];
    for (const m of opts.messages) {
      if (m.role === "system") {
        messages.push({ role: "system", content: m.content });
        continue;
      }
      if (m.role === "user") {
        messages.push({ role: "user", content: m.content });
        continue;
      }
      if (m.role === "assistant") {
        messages.push({ role: "assistant", content: m.content });
        continue;
      }
      if (m.role === "assistant-with-tool-calls") {
        // Reconstruct the assistant turn with its tool_calls field so
        // the subsequent tool messages can resolve their tool_call_id.
        messages.push({
          role: "assistant",
          content: m.text ?? null,
          tool_calls: m.calls.map((c) => ({
            id: c.toolCallId,
            type: "function" as const,
            function: {
              name: c.toolName,
              arguments: JSON.stringify(c.input),
            },
          })),
        });
        continue;
      }
      messages.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.output,
      });
    }

    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages,
    };
    if (opts.tools.length > 0) {
      request.tools = opts.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as Record<string, unknown>,
        },
      }));
    }
    if (opts.responseSchema) {
      // Structured Outputs — guarantees the model's final text output
      // validates against the schema. Compatible with tool calls: the
      // model picks one or the other on each turn.
      request.response_format = {
        type: "json_schema",
        json_schema: {
          name: opts.responseSchema.name,
          description: opts.responseSchema.description,
          schema: opts.responseSchema.schema,
          strict: opts.responseSchema.strict,
        },
      };
    }
    const response = await this.client.chat.completions.create(request);

    const choice = response.choices[0];
    if (!choice) {
      return { kind: "text", text: "" };
    }

    const text = choice.message.content ?? "";
    const toolCalls = choice.message.tool_calls ?? [];

    if (toolCalls.length > 0) {
      return {
        kind: "tool-calls",
        text: text || undefined,
        calls: toolCalls
          .filter((c) => c.type === "function")
          .map((c) => {
            const fc = c as OpenAI.Chat.ChatCompletionMessageToolCall & {
              function: { name: string; arguments: string };
            };
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(fc.function.arguments);
            } catch {
              // ignore malformed JSON — pass empty input
            }
            return {
              toolCallId: c.id,
              toolName: fc.function.name,
              input,
            };
          }),
      };
    }

    return { kind: "text", text };
  }
}
