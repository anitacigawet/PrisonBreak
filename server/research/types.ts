export const RESEARCH_PROVIDERS = ["codex", "claude"] as const;

export type ResearchProvider = (typeof RESEARCH_PROVIDERS)[number];

export const PRIMARY_SOURCE_KINDS = [
  "statute",
  "regulation",
  "court_opinion",
  "court_rule",
  "government_record",
  "official_guidance",
  "other_official",
] as const;

export type PrimarySourceKind = (typeof PRIMARY_SOURCE_KINDS)[number];

/**
 * Callers pass text only. The bridge deliberately accepts no paths, file
 * handles, or repository roots, so a CLI process cannot receive case files
 * implicitly. Any context included here is an explicit disclosure by the
 * caller and is copied into the research prompt.
 */
export interface WebResearchRequest {
  query: string;
  jurisdiction?: string;
  context?: string;
  maxSources?: number;
}

export interface ResearchSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  sourceKind: PrimarySourceKind;
  citedExcerpt: string;
}

export interface ResearchFinding {
  statement: string;
  sourceIds: string[];
}

export interface ResearchPayload {
  summary: string;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  limitations: string[];
}

export interface WebResearchResult extends ResearchPayload {
  provider: ResearchProvider;
  query: string;
  jurisdiction: string | null;
}

export interface CommandInvocation {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Injectable runners may return the provider's final structured message. */
  finalOutput?: string;
}

export interface CommandRunner {
  run(invocation: CommandInvocation): Promise<CommandResult>;
}

export interface WebResearchOptions {
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  tempRoot?: string;
  timeoutMs?: number;
  /** Exact hosts or parent domains allowed in addition to .gov/.mil/.us. */
  officialHostAllowlist?: readonly string[];
}
