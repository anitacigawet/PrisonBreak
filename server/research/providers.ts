import type { ResearchProvider } from "./types";

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
  const executable = getProviderExecutable(options.provider, options.env);

  if (options.provider === "codex") {
    return {
      executable,
      args: [
        "--search",
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--cd",
        options.workDir,
        "--output-schema",
        options.schemaPath,
        "--output-last-message",
        options.resultPath,
        "--color",
        "never",
        "-",
      ],
      resultPath: options.resultPath,
    };
  }

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
