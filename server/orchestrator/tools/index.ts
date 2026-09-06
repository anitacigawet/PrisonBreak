/**
 * Evidence-retrieval tools used by both the prosecutor and defense passes.
 * Results come from exact case/corpus filters in the local Qdrant index.
 */
import { getCaseById } from "../../db";
import { listPetalsForCase } from "../../petals/db";
import { localRag, type RagCitation } from "../../rag/bridge";
import type { ProviderToolDef } from "../providers/types";
import type { GroundedCitationValue } from "../grounding";

const PETAL_DESCRIPTIONS: Record<string, string> = {
  laws: "official statutes and regulations",
  jurisprudence: "controlling opinions and precedent",
  procedural: "court rules and procedural requirements",
  patterns: "official sentencing and case-processing statistics",
  demographics: "official venue and jury-source information",
  forensics: "official forensic reliability material",
  id_confession: "official identification and statement reliability material",
  cost: "official representation, expert, and court resource information",
};

const QUERY_CASE_DEF: ProviderToolDef = {
  name: "queryCase",
  description:
    "Retrieve verbatim passages from the user's uploaded case documents. Each result includes a server-generated citation ID, source label, locator, and passage. Cite only returned evidence.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "A focused factual question about the uploaded record.",
      },
    },
    required: ["question"],
  },
};

export async function buildToolDefs(caseId: number): Promise<ProviderToolDef[]> {
  const definitions: ProviderToolDef[] = [QUERY_CASE_DEF];
  const petals = await listPetalsForCase(caseId);
  const completed = petals.filter(petal => petal.status === "completed" && petal.corpusKey);
  if (completed.length === 0) return definitions;

  const keys = completed.map(petal => petal.petalKey);
  const available = keys
    .map(key => `  - ${key}: ${PETAL_DESCRIPTIONS[key] ?? "primary-source research"}`)
    .join("\n");
  definitions.push({
    name: "queryPetal",
    description:
      `Retrieve verbatim passages from a retained primary-source research corpus. Cite only returned evidence.\n\nAvailable corpora:\n${available}`,
    inputSchema: {
      type: "object",
      properties: {
        petalKey: {
          type: "string",
          enum: keys,
          description: "The research domain to query.",
        },
        question: {
          type: "string",
          description: "A focused legal or factual research question.",
        },
      },
      required: ["petalKey", "question"],
    },
  });
  return definitions;
}

export interface ToolContext {
  caseId: number;
}

export interface ToolResult {
  output: string;
  evidence: GroundedCitationValue[];
}

function message(output: string): ToolResult {
  return { output, evidence: [] };
}

export function evidenceResult(matches: RagCitation[]): ToolResult {
  const evidence = matches.map(match => ({
    citationId: match.citationId,
    sourceLabel: match.sourceLabel,
    locator: match.locator,
    passage: match.passage,
    sourceUrl: typeof match.metadata.canonicalUrl === "string" ? match.metadata.canonicalUrl : null,
  }));
  // Display encoding is not an authority parser. Newlines or delimiter-like
  // metadata remain inside JSON strings; only these typed matches grant IDs.
  return { output: JSON.stringify({ evidence }), evidence };
}

async function queryCorpus(
  caseId: number,
  corpus: string,
  question: string,
): Promise<ToolResult> {
  if (!question.trim()) return message("ERROR: empty question.");
  try {
    const result = await localRag.query({
      caseId,
      corpus,
      query: question,
      limit: 8,
    });
    if (result.matches.length === 0) {
      return message("NO MATCHES: the selected local corpus contains no passage responsive to this question.");
    }
    return evidenceResult(result.matches);
  } catch (error) {
    return message(`ERROR querying local evidence: ${(error as Error).message}`);
  }
}

export async function runTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  if (toolName === "queryCase") {
    const caseRow = await getCaseById(context.caseId);
    if (!caseRow?.ragIndexedAt) {
      return message("ERROR: the uploaded case documents have not been indexed. Run Analyze first.");
    }
    return queryCorpus(context.caseId, "case", String(input.question ?? ""));
  }
  if (toolName === "queryPetal") {
    const petalKey = String(input.petalKey ?? "");
    const petals = await listPetalsForCase(context.caseId);
    const petal = petals.find(item => item.petalKey === petalKey);
    if (!petal) return message(`ERROR: research domain "${petalKey}" was not found.`);
    if (petal.status !== "completed" || !petal.corpusKey) {
      return message(`ERROR: research domain "${petalKey}" is not available (status: ${petal.status}).`);
    }
    return queryCorpus(
      context.caseId,
      petal.corpusKey,
      String(input.question ?? ""),
    );
  }
  throw new Error(`Unknown tool: ${toolName}`);
}
