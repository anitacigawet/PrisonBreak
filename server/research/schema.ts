import {
  PRIMARY_SOURCE_KINDS,
  type ResearchFinding,
  type ResearchPayload,
  type ResearchSource,
} from "./types";
import { ResearchOutputError } from "./errors";

export const researchOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings", "sources", "limitations"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4000 },
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "sourceIds"],
        properties: {
          statement: { type: "string", minLength: 1, maxLength: 2000 },
          sourceIds: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: { type: "string", pattern: "^S[1-9][0-9]*$" },
          },
        },
      },
    },
    sources: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "publisher",
          "url",
          "sourceKind",
          "citedExcerpt",
        ],
        properties: {
          id: { type: "string", pattern: "^S[1-9][0-9]*$" },
          title: { type: "string", minLength: 1, maxLength: 500 },
          publisher: { type: "string", minLength: 1, maxLength: 300 },
          url: { type: "string", pattern: "^https://" },
          sourceKind: { type: "string", enum: [...PRIMARY_SOURCE_KINDS] },
          citedExcerpt: { type: "string", minLength: 20, maxLength: 4000 },
        },
      },
    },
    limitations: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
  },
} as const;

const DEFAULT_OFFICIAL_SUFFIXES = [".gov", ".mil"] as const;
const PLACEHOLDER_EXCERPT =
  /^(n\/?a|none|not available|no excerpt|unknown|unavailable)[.!]?$/i;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResearchOutputError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function strictKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const extras = Object.keys(record).filter(key => !allowed.includes(key));
  if (extras.length > 0) {
    throw new ResearchOutputError(
      `${label} contains unexpected fields: ${extras.join(", ")}.`
    );
  }
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  minLength: number,
  maxLength: number
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ResearchOutputError(`${label}.${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new ResearchOutputError(
      `${label}.${key} must be between ${minLength} and ${maxLength} characters.`
    );
  }
  return trimmed;
}

function normalizeAllowedHosts(hosts: readonly string[]): string[] {
  return hosts
    .map(host => host.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

function hostMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

export function validatePrimarySourceUrl(
  rawUrl: string,
  officialHostAllowlist: readonly string[] = []
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new ResearchOutputError(`Source URL is invalid: ${rawUrl}`, {
      cause: error,
    });
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ResearchOutputError(
      `Source URL must be an unauthenticated HTTPS URL: ${rawUrl}`
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const allowedHosts = normalizeAllowedHosts(officialHostAllowlist);
  const hasOfficialSuffix = DEFAULT_OFFICIAL_SUFFIXES.some(
    suffix => hostname === suffix.slice(1) || hostname.endsWith(suffix)
  );
  const explicitlyAllowed = allowedHosts.some(allowed =>
    hostMatches(hostname, allowed)
  );

  if (!hasOfficialSuffix && !explicitlyAllowed) {
    throw new ResearchOutputError(
      `Source URL is not on a recognized primary-source host: ${hostname}. ` +
        "Use a .gov or .mil source, or explicitly allow the official host."
    );
  }

  parsed.hash = "";
  return parsed.toString();
}

function validateExcerpt(value: string, label: string): string {
  const excerpt = value.trim();
  if (excerpt.length < 20 || excerpt.length > 4000) {
    throw new ResearchOutputError(
      `${label} must be between 20 and 4000 characters.`
    );
  }
  if (PLACEHOLDER_EXCERPT.test(excerpt) || excerpt.split(/\s+/).length < 4) {
    throw new ResearchOutputError(
      `${label} must contain a real cited passage, not a placeholder.`
    );
  }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(excerpt)) {
    throw new ResearchOutputError(
      `${label} contains unsupported control characters.`
    );
  }
  return excerpt;
}

function validateSource(
  value: unknown,
  index: number,
  officialHostAllowlist: readonly string[]
): ResearchSource {
  const label = `sources[${index}]`;
  const record = asRecord(value, label);
  strictKeys(
    record,
    ["id", "title", "publisher", "url", "sourceKind", "citedExcerpt"],
    label
  );

  const sourceKind = requiredString(record, "sourceKind", label, 1, 100);
  if (!(PRIMARY_SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    throw new ResearchOutputError(
      `${label}.sourceKind is not a recognized primary-source kind.`
    );
  }

  return {
    id: requiredString(record, "id", label, 2, 20),
    title: requiredString(record, "title", label, 1, 500),
    publisher: requiredString(record, "publisher", label, 1, 300),
    url: validatePrimarySourceUrl(
      requiredString(record, "url", label, 9, 4000),
      officialHostAllowlist
    ),
    sourceKind: sourceKind as ResearchSource["sourceKind"],
    citedExcerpt: validateExcerpt(
      requiredString(record, "citedExcerpt", label, 20, 4000),
      `${label}.citedExcerpt`
    ),
  };
}

function validateFinding(value: unknown, index: number): ResearchFinding {
  const label = `findings[${index}]`;
  const record = asRecord(value, label);
  strictKeys(record, ["statement", "sourceIds"], label);
  if (!Array.isArray(record.sourceIds) || record.sourceIds.length === 0) {
    throw new ResearchOutputError(
      `${label}.sourceIds must contain at least one source ID.`
    );
  }
  const sourceIds = record.sourceIds.map((sourceId, sourceIndex) => {
    if (typeof sourceId !== "string" || !/^S[1-9][0-9]*$/.test(sourceId)) {
      throw new ResearchOutputError(
        `${label}.sourceIds[${sourceIndex}] is invalid.`
      );
    }
    return sourceId;
  });
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new ResearchOutputError(`${label}.sourceIds contains duplicates.`);
  }
  return {
    statement: requiredString(record, "statement", label, 1, 2000),
    sourceIds,
  };
}

export function validateResearchPayload(
  value: unknown,
  options: { maxSources: number; officialHostAllowlist?: readonly string[] }
): ResearchPayload {
  const record = asRecord(value, "research output");
  strictKeys(
    record,
    ["summary", "findings", "sources", "limitations"],
    "research output"
  );

  if (!Array.isArray(record.findings) || record.findings.length > 20) {
    throw new ResearchOutputError(
      "research output.findings must be an array with at most 20 items."
    );
  }
  if (
    !Array.isArray(record.sources) ||
    record.sources.length > options.maxSources
  ) {
    throw new ResearchOutputError(
      `research output.sources must be an array with at most ${options.maxSources} items.`
    );
  }
  if (!Array.isArray(record.limitations) || record.limitations.length > 20) {
    throw new ResearchOutputError(
      "research output.limitations must be an array with at most 20 items."
    );
  }

  const sources = record.sources.map((source, index) =>
    validateSource(source, index, options.officialHostAllowlist ?? [])
  );
  const findings = record.findings.map(validateFinding);
  const limitations = record.limitations.map((limitation, index) => {
    if (
      typeof limitation !== "string" ||
      !limitation.trim() ||
      limitation.trim().length > 1000
    ) {
      throw new ResearchOutputError(
        `limitations[${index}] must be a non-empty string.`
      );
    }
    return limitation.trim();
  });

  const sourceIds = new Set<string>();
  const canonicalUrls = new Set<string>();
  for (const source of sources) {
    if (!/^S[1-9][0-9]*$/.test(source.id)) {
      throw new ResearchOutputError(`Source ID is invalid: ${source.id}.`);
    }
    if (sourceIds.has(source.id)) {
      throw new ResearchOutputError(`Source ID is duplicated: ${source.id}.`);
    }
    if (canonicalUrls.has(source.url)) {
      throw new ResearchOutputError(`Source URL is duplicated: ${source.url}.`);
    }
    sourceIds.add(source.id);
    canonicalUrls.add(source.url);
  }

  const referencedSourceIds = new Set<string>();
  for (const finding of findings) {
    for (const sourceId of finding.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        throw new ResearchOutputError(
          `Finding cites an unknown source ID: ${sourceId}.`
        );
      }
      referencedSourceIds.add(sourceId);
    }
  }
  sourceIds.forEach(sourceId => {
    if (!referencedSourceIds.has(sourceId)) {
      throw new ResearchOutputError(
        `Source ${sourceId} is not cited by any finding.`
      );
    }
  });

  return {
    summary: requiredString(record, "summary", "research output", 1, 4000),
    findings,
    sources,
    limitations,
  };
}
