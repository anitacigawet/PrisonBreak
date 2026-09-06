import fs from "node:fs/promises";
import path from "node:path";
import { atomicDatabaseTransaction, listResearchSources } from "../db";
import { localRag } from "../rag/bridge";
import { getDataRoot } from "../runtimePaths";

/** Only generated, inactive UUID corpora are eligible for this cleanup. Case
 * deletion separately removes legacy and partially staged data by case ID. */
export async function discardGeneration(caseId: number, corpusKey: string): Promise<void> {
  if (!Number.isSafeInteger(caseId) || caseId <= 0 ||
    !/^research:[a-z_]+:[0-9a-f-]{36}$/.test(corpusKey)) throw new Error("Invalid research generation");
  const caseRoot = path.resolve(getDataRoot(), "research", "cases", String(caseId));
  const directory = path.resolve(caseRoot, corpusKey.replace(/[^a-zA-Z0-9_-]/g, "-"));
  if (path.dirname(directory) !== caseRoot) throw new Error("Research generation escaped case storage");
  await localRag.deleteCorpus({ caseId, corpus: corpusKey });
  await fs.rm(directory, { recursive: true, force: true });
  atomicDatabaseTransaction(sqlite => {
    sqlite.run('DELETE FROM researchSources WHERE caseId = ? AND corpusKey = ?', [caseId, corpusKey]);
  });
}

export async function cleanInactiveGenerations(caseId: number, petalKey: string, activeCorpus: string): Promise<void> {
  const sources = await listResearchSources(caseId);
  const corpora = Array.from(new Set(sources.map(source => source.corpusKey)));
  for (const corpus of corpora.filter(corpus => corpus !== activeCorpus && corpus.startsWith(`research:${petalKey}:`))) {
    try { await discardGeneration(caseId, corpus); }
    catch { console.error("[Grow] Inactive research data retained for a later cleanup retry or case deletion."); }
  }
}
