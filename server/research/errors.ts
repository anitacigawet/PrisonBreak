export class ResearchConfigurationError extends Error {
  readonly code = "RESEARCH_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ResearchConfigurationError";
  }
}

export class ResearchCliUnavailableError extends Error {
  readonly code = "RESEARCH_CLI_UNAVAILABLE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchCliUnavailableError";
  }
}

export class ResearchExecutionError extends Error {
  readonly code = "RESEARCH_EXECUTION_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchExecutionError";
  }
}

export class ResearchOutputError extends Error {
  readonly code = "RESEARCH_OUTPUT_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchOutputError";
  }
}
