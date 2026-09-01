/** Verify handoff quotations against the server-owned local RAG citation. */
import { listPetalsForCase } from "../petals/db";
import { localRag, type RagCitation } from "../rag/bridge";
import type { DefenderHandoff, HandoffQuestion } from "./types";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[*_`]+/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuotedPassages(value: string): string[] {
  const passages: string[] = [];
  for (const pattern of [/"([^"]{8,})"/g, /[“]([^”]{8,})[”]/g, /[«]([^»]{8,})[»]/g]) {
    for (const match of Array.from(value.matchAll(pattern))) {
      if (match[1]) passages.push(match[1]);
    }
  }
  return passages.sort((left, right) => right.length - left.length);
}

function verifiedQuestion(
  question: HandoffQuestion,
  citation: RagCitation,
): HandoffQuestion {
  const metadata = citation.metadata as Record<string, unknown>;
  return {
    ...question,
    citationId: citation.citationId,
    sourceLabel: citation.sourceLabel,
    locator: citation.locator,
    sourceUrl: typeof metadata.canonicalUrl === "string" ? metadata.canonicalUrl : null,
    verified: true,
    verificationNote: undefined,
  };
}

async function verifyQuestion(
  question: HandoffQuestion,
  caseId: number,
  corpora: string[],
): Promise<HandoffQuestion> {
  const quotes = extractQuotedPassages(question.whyAsking);
  if (quotes.length === 0) {
    return {
      ...question,
      verified: false,
      verificationNote:
        "No quoted passage was found. Open the cited source before relying on this question.",
    };
  }

  for (const quote of quotes) {
    for (const corpus of corpora) {
      const result = await localRag.query({ caseId, corpus, query: quote, limit: 12 });
      const citation = result.matches.find(match => match.citationId === question.citationId);
      if (
        citation &&
        normalize(citation.passage).includes(normalize(quote)) &&
        citation.sourceLabel === question.sourceLabel
      ) {
        return verifiedQuestion(question, citation);
      }
    }
  }

  return {
    ...question,
    verified: false,
    verificationNote:
      "The quoted passage did not match the retained citation. Open the source directly before relying on it.",
  };
}

export async function verifyHandoffCitations(
  handoff: DefenderHandoff,
  caseId: number,
): Promise<DefenderHandoff> {
  const petals = await listPetalsForCase(caseId);
  const corpora = [
    "case",
    ...petals
      .filter(petal => petal.status === "completed" && petal.corpusKey)
      .map(petal => petal.corpusKey as string),
  ];
  const questions: HandoffQuestion[] = [];
  for (const question of handoff.questions) {
    questions.push(await verifyQuestion(question, caseId, corpora));
  }
  return { ...handoff, questions };
}
