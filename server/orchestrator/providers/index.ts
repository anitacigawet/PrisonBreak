/**
 * Provider factory — returns the right LLM provider based on the
 * current orchestrator settings. Throws a useful error if the user
 * has selected a provider without configuring its API key.
 */
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import type { LLMProvider } from "./types";
import type { OrchestratorSettings } from "../types";

export function makeProvider(settings: OrchestratorSettings): LLMProvider {
  if (settings.provider === "anthropic") {
    if (!settings.anthropicApiKey) {
      throw new Error(
        "Anthropic provider selected but no API key configured. Add one in Settings.",
      );
    }
    return new AnthropicProvider(settings.anthropicApiKey);
  }
  if (settings.provider === "openai") {
    if (!settings.openaiApiKey) {
      throw new Error(
        "OpenAI provider selected but no API key configured. Add one in Settings.",
      );
    }
    return new OpenAIProvider(settings.openaiApiKey);
  }
  throw new Error(`Unknown provider: ${(settings as { provider: string }).provider}`);
}

export type { LLMProvider } from "./types";
