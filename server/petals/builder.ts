/**
 * Build one research domain:
 *  1. ask the selected local CLI to discover primary sources;
 *  2. fetch and retain each source independently;
 *  3. index the retained artifact into local Qdrant;
 *  4. persist the source ledger and a short research summary.
 */
import type { Case } from "../../drizzle/schema";
import { randomUUID } from "node:crypto";
import { parseCaseFacts } from "../../shared/caseFacts";
import { emitPetalProgress } from "../_core/websocket";
import * as appDb from "../db";
import { localRag } from "../rag/bridge";
import { runWebResearch } from "../research";
import { fetchAndSnapshotSource } from "../sources/fetch";
import { activatePetalGeneration, ensurePetalRow, getPetal, updatePetal } from "./db";
import type { PetalSpec } from "./types";
import { cleanInactiveGenerations, discardGeneration } from "./generations";

function eventShape(
  spec: PetalSpec,
  patch: {
    status: "building" | "completed" | "skipped" | "failed";
    progress: number;
    summary?: string | null;
    reasonSkipped?: string | null;
    errorMessage?: string | null;
    corpusKey?: string | null;
    sourceCount?: number;
  },
) {
  return {
    key: spec.key,
    label: spec.label,
    description: spec.description,
    status: patch.status,
    progress: patch.progress,
    summary: patch.summary ?? null,
    reasonSkipped: patch.reasonSkipped ?? null,
    errorMessage: patch.errorMessage ?? null,
    corpusKey: patch.corpusKey ?? null,
    sourceCount: patch.sourceCount ?? 0,
  };
}

export async function buildPetal(
  caseRow: Case,
  spec: PetalSpec,
): Promise<{
  status: "completed" | "skipped" | "failed";
  corpusKey: string | null;
  sourceCount: number;
  summary: string | null;
  errorMessage: string | null;
}> {
  const petalId = await ensurePetalRow(caseRow.id, spec.key);
  const previous = await getPetal(caseRow.id, spec.key);
  const facts = parseCaseFacts(caseRow.caseFacts);
  // Every attempt gets a private staging corpus. Queries resolve only the
  // active key on casePetals; failed staging never overwrites that key.
  const corpusKey = `research:${spec.key}:${randomUUID()}`;
  let published: { sourceCount: number; summary: string } | null = null;
  try {
  const applicability = await spec.applicability(caseRow, facts);

  if (!applicability.apply) {
    await updatePetal(petalId, {
      status: "skipped",
      progress: 0,
      corpusKey: null,
      sourceCount: 0,
      reasonSkipped: applicability.reason,
      completedAt: new Date(),
    });
    emitPetalProgress(
      caseRow.id,
      eventShape(spec, {
        status: "skipped",
        progress: 0,
        reasonSkipped: applicability.reason,
      }),
    );
    return {
      status: "skipped",
      corpusKey: null,
      sourceCount: 0,
      summary: null,
      errorMessage: null,
    };
  }

  await updatePetal(petalId, {
    status: "building",
    progress: 5,
    startedAt: new Date(),
    reasonSkipped: null,
    errorMessage: null,
  });
  emitPetalProgress(
    caseRow.id,
    eventShape(spec, { status: "building", progress: 5, corpusKey: previous?.corpusKey }),
  );

    const query = spec.researchQuery(caseRow, facts);
    const research = await runWebResearch({
      query,
      jurisdiction: facts?.jurisdiction ?? caseRow.jurisdiction ?? undefined,
      maxSources: 6,
    });
    await updatePetal(petalId, { progress: 25 });
    emitPetalProgress(
      caseRow.id,
      eventShape(spec, { status: "building", progress: 25, corpusKey }),
    );

    const admitted: Array<{
      source: (typeof research.sources)[number];
      artifact: Awaited<ReturnType<typeof fetchAndSnapshotSource>>;
    }> = [];
    const rejected: string[] = [];

    for (const source of research.sources) {
      try {
        const artifact = await fetchAndSnapshotSource({
          caseId: caseRow.id,
          corpusKey,
          url: source.url,
        });
        admitted.push({ source, artifact });
      } catch (error) {
        rejected.push(`${source.title}: ${(error as Error).message}`);
      }
      const progress = 25 + Math.round((admitted.length / Math.max(research.sources.length, 1)) * 30);
      await updatePetal(petalId, { progress });
      emitPetalProgress(
        caseRow.id,
        eventShape(spec, { status: "building", progress, corpusKey }),
      );
    }

    if (admitted.length === 0) {
      const detail = [...research.limitations, ...rejected].join(" ");
      throw new Error(
        detail || "The research CLI returned no primary source that PrisonBreak could fetch and retain.",
      );
    }

    const ledgerRows = await appDb.replaceResearchSources(
      caseRow.id,
      corpusKey,
      admitted.map(({ source, artifact }) => ({
        url: artifact.canonicalUrl,
        title: source.title,
        publisher: source.publisher,
        excerpt: source.citedExcerpt,
        snapshotPath: artifact.snapshotPath,
        contentHash: artifact.contentHash,
        retrievedAt: artifact.retrievedAt,
      })),
    );

    for (let index = 0; index < ledgerRows.length; index += 1) {
      const row = ledgerRows[index];
      const admittedSource = admitted[index].source;
      await localRag.upsertFile({
        caseId: caseRow.id,
        corpus: corpusKey,
        sourceId: `research:${row.id}`,
        sourceLabel: row.title,
        filePath: row.snapshotPath,
        metadata: {
          sourceKind: "web_source",
          canonicalUrl: row.url,
          publisher: row.publisher,
          retrievedAt: row.retrievedAt.toISOString(),
          researchSourceId: row.id,
          primarySourceKind: admittedSource.sourceKind,
        },
      });
      const progress = 55 + Math.round(((index + 1) / ledgerRows.length) * 40);
      await updatePetal(petalId, { progress });
      emitPetalProgress(
        caseRow.id,
        eventShape(spec, {
          status: "building",
          progress,
          corpusKey,
          sourceCount: index + 1,
        }),
      );
    }

    const limitationText = [...research.limitations, ...rejected];
    const summary = [
      research.summary,
      limitationText.length > 0 ? `Limits: ${limitationText.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    activatePetalGeneration({
      caseId: caseRow.id,
      petalId,
      corpusKey,
      sourceCount: ledgerRows.length,
      summary,
    });
    published = { sourceCount: ledgerRows.length, summary };
    // Publication has committed. Inactive-generation cleanup must not turn a
    // successful publication into a rollback to the previous corpus.
    try { await cleanInactiveGenerations(caseRow.id, spec.key, corpusKey); }
    catch { console.error("[Grow] Inactive research cleanup deferred until retry or case deletion."); }
    emitPetalProgress(
      caseRow.id,
      eventShape(spec, {
        status: "completed",
        progress: 100,
        corpusKey,
        sourceCount: ledgerRows.length,
        summary,
      }),
    );
    return {
      status: "completed",
      corpusKey,
      sourceCount: ledgerRows.length,
      summary,
      errorMessage: null,
    };
  } catch (error) {
    if (published) {
      return { status: "completed", corpusKey, sourceCount: published.sourceCount, summary: published.summary, errorMessage: null };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    try { await discardGeneration(caseRow.id, corpusKey); }
    catch { console.error("[Grow] Partial research data retained for a later cleanup retry or case deletion."); }
    // Keep both the active ledger and vectors on any discovery, fetch, index,
    // or activation failure. Abandoned staging is invisible and remains
    // case-scoped so retryable case deletion also removes partial generations.
    const retained = !!previous?.corpusKey && previous.sourceCount > 0;
    await updatePetal(petalId, {
      status: retained ? "completed" : "failed",
      progress: retained ? 100 : 0,
      corpusKey: previous?.corpusKey ?? null,
      sourceCount: previous?.sourceCount ?? 0,
      summary: previous?.summary ?? null,
      errorMessage,
      completedAt: new Date(),
    });
    emitPetalProgress(
      caseRow.id,
      eventShape(spec, {
        status: retained ? "completed" : "failed",
        progress: retained ? 100 : 0,
        corpusKey: previous?.corpusKey ?? null,
        sourceCount: previous?.sourceCount ?? 0,
        summary: previous?.summary ?? null,
        errorMessage,
      }),
    );
    return {
      status: "failed",
      corpusKey: previous?.corpusKey ?? null,
      sourceCount: previous?.sourceCount ?? 0,
      summary: previous?.summary ?? null,
      errorMessage,
    };
  }
}
