/** Verify handoff quotations against the server-owned local RAG citation. */
import { listPetalsForCase } from "../petals/db";
import { localRag, type RagCitation } from "../rag/bridge";
import type { DefenderHandoff, HandoffQuestion } from "./types";
import { allQuotesMatch, extractQuotedPassages } from "./quotations";

export function checkedQuestion(
  question: HandoffQuestion,
  citation?: RagCitation,
): HandoffQuestion {
  const canonicalUrl = citation && typeof citation.metadata.canonicalUrl === "string"
    ? citation.metadata.canonicalUrl : null;
  if (citation && citation.citationId === question.citationId &&
      citation.sourceLabel === question.sourceLabel && citation.locator === question.locator &&
      canonicalUrl === question.sourceUrl && allQuotesMatch(question.whyAsking, citation.passage)) {
    return { ...question, sourceLabel: citation.sourceLabel, locator: citation.locator,
      sourceUrl: canonicalUrl, verified: true, verificationNote: undefined };
  }
  // Never preserve a model-supplied clickable URL after verification fails.
  return { ...question, sourceUrl: null, verified: false,
    verificationNote: "Not every quoted passage matched the current retained citation. Check the source before relying on this question." };
}

async function verifyQuestion(
  question: HandoffQuestion,
  caseId: number,
  corpora: string[],
): Promise<HandoffQuestion> {
  const quotes = extractQuotedPassages(question.whyAsking);

  for (const quote of quotes) {
    for (const corpus of corpora) {
      const result = await localRag.query({ caseId, corpus, query: quote, limit: 12 });
      const citation = result.matches.find(match => match.citationId === question.citationId);
      if (citation) return checkedQuestion(question, citation);
    }
  }

  return checkedQuestion(question);
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
