/**
 * Anthropic provider — Claude with tool use.
 *
 * Wraps @anthropic-ai/sdk's Messages API into the `LLMProvider`
 * interface. The orchestrator does the loop — this module is just
 * one round-trip per call.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderResponse,
  RunWithToolsOptions,
} from "./types";

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("AnthropicProvider: missing API key");
    }
    this.client = new Anthropic({ apiKey });
  }

  async runWithTools(opts: RunWithToolsOptions): Promise<ProviderResponse> {
    // Map our generic messages onto Anthropic's MessageParam shape.
    // Done as a typed accumulator (not flatMap) so the discriminated
    // union narrows correctly on each branch.
    const messages: Anthropic.MessageParam[] = [];
    for (const m of opts.messages) {
      if (m.role === "system") continue; // system handled separately
      if (m.role === "user") {
        messages.push({ role: "user", content: m.content });
        continue;
      }
      if (m.role === "assistant") {
        messages.push({ role: "assistant", content: m.content });
        continue;
      }
      if (m.role === "assistant-with-tool-calls") {
        // Reconstruct the assistant turn with its tool_use blocks so
        // the subsequent tool_result blocks can resolve their ids.
        const content: Anthropic.ContentBlockParam[] = [];
        if (m.text) content.push({ type: "text", text: m.text });
        for (const c of m.calls) {
          content.push({
            type: "tool_use",
            id: c.toolCallId,
            name: c.toolName,
            input: c.input,
          });
        }
        messages.push({ role: "assistant", content });
        continue;
      }
      // tool-result — anthropic wraps it as a user message with a
      // tool_result content block.
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: m.output,
          },
        ],
      });
    }

    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.systemPrompt,
      messages,
    };
    if (opts.tools.length > 0) {
      request.tools = opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));
    }
    const response = await this.client.messages.create(request);

    // Anthropic returns an array of content blocks. Pull out text +
    // tool_use blocks separately.
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const textBlocks = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (toolUseBlocks.length > 0) {
      return {
        kind: "tool-calls",
        text: textBlocks || undefined,
        calls: toolUseBlocks.map((b) => ({
          toolCallId: b.id,
          toolName: b.name,
          input: b.input as Record<string, unknown>,
        })),
      };
    }

    return {
      kind: "text",
      text: textBlocks,
    };
  }
}
