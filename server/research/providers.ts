import type { ResearchProvider } from "./types";
import { ResearchConfigurationError } from "./errors";

export function assertResearchProviderIsolated(provider: ResearchProvider): void {
  if (provider === "codex") {
    throw new ResearchConfigurationError(
      "Codex research is disabled until its web-only tool and filesystem isolation can be verified. " +
      "A read-only sandbox does not prevent local file reads. Configure PRISONBREAK_RESEARCH_PROVIDER=claude " +
      "with Claude Code signed in to use the restricted WebSearch/WebFetch workflow. No provider was switched automatically.",
    );
  }
}

export interface ProviderCommand {
  executable: string;
  args: string[];
  resultPath: string | null;
}

interface ProviderCommandOptions {
  provider: ResearchProvider;
  env: NodeJS.ProcessEnv;
  workDir: string;
  schemaPath: string;
  schemaJson: string;
  resultPath: string;
}

export function getProviderExecutable(
  provider: ResearchProvider,
  env: NodeJS.ProcessEnv
): string {
  if (provider === "codex")
    return env.PRISONBREAK_RESEARCH_CODEX_BIN?.trim() || "codex";
  return env.PRISONBREAK_RESEARCH_CLAUDE_BIN?.trim() || "claude";
}

export function buildProviderCommand(
  options: ProviderCommandOptions
): ProviderCommand {
  assertResearchProviderIsolated(options.provider);
  const executable = getProviderExecutable(options.provider, options.env);

  return {
    executable,
    args: [
      "--print",
      "--output-format",
      "json",
      "--json-schema",
      options.schemaJson,
      "--tools",
      "WebSearch,WebFetch",
      "--permission-mode",
      "dontAsk",
      "--no-session-persistence",
      "--safe-mode",
      "--mcp-config",
      "{}",
      "--strict-mcp-config",
    ],
    resultPath: null,
  };
}
