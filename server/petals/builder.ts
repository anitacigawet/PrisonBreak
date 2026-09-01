/**
 * Build one research domain:
 *  1. ask the selected local CLI to discover primary sources;
 *  2. fetch and retain each source independently;
 *  3. index the retained artifact into local Qdrant;
 *  4. persist the source ledger and a short research summary.
 */
import type { Case } from "../../drizzle/schema";
import { parseCaseFacts } from "../../shared/caseFacts";
import { emitPetalProgress } from "../_core/websocket";
import * as appDb from "../db";
import { localRag } from "../rag/bridge";
import { runWebResearch } from "../research";
import { fetchAndSnapshotSource } from "../sources/fetch";
import { ensurePetalRow, updatePetal } from "./db";
import type { PetalSpec } from "./types";

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
  const facts = parseCaseFacts(caseRow.caseFacts);
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

  const corpusKey = `research:${spec.key}`;
  await updatePetal(petalId, {
    status: "building",
    progress: 5,
    corpusKey,
    sourceCount: 0,
    startedAt: new Date(),
    reasonSkipped: null,
    errorMessage: null,
  });
  emitPetalProgress(
    caseRow.id,
    eventShape(spec, { status: "building", progress: 5, corpusKey }),
  );

  try {
    const previous = await appDb.listResearchSources(caseRow.id, corpusKey);
    for (const source of previous) {
      await localRag.deleteSource({
        caseId: caseRow.id,
        corpus: corpusKey,
        sourceId: `research:${source.id}`,
      });
    }

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

    await updatePetal(petalId, {
      status: "completed",
      progress: 100,
      corpusKey,
      sourceCount: ledgerRows.length,
      summary,
      completedAt: new Date(),
    });
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updatePetal(petalId, {
      status: "failed",
      progress: 0,
      sourceCount: 0,
      errorMessage,
      completedAt: new Date(),
    });
    emitPetalProgress(
      caseRow.id,
      eventShape(spec, {
        status: "failed",
        progress: 0,
        corpusKey,
        errorMessage,
      }),
    );
    return {
      status: "failed",
      corpusKey,
      sourceCount: 0,
      summary: null,
      errorMessage,
    };
  }
}
