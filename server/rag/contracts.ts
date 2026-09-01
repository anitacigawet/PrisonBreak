/**
 * Provider-neutral contracts for PrisonBreak's local retrieval layer.
 *
 * These types deliberately describe corpora, sources, chunks, and citations;
 * they do not expose Qdrant collection names or embedding-provider details to
 * callers. That keeps the application-facing boundary stable if the storage
 * implementation changes later.
 */

export type RagCaseId = string | number;

export type RagMetadataValue =
  | string
  | number
  | boolean
  | null
  | RagMetadata
  | RagMetadataValue[];

export interface RagMetadata {
  [key: string]: RagMetadataValue;
}

export interface RagBridgeOptions {
  /** Python interpreter. Defaults to PRISONBREAK_PYTHON, then python/python3. */
  pythonExecutable?: string;
  /** Repository root used as the Python module working directory. */
  repoRoot?: string;
  /** Persistent Qdrant local-mode directory. Defaults to data/qdrant. */
  storePath?: string;
  /** Internal Qdrant collection name. */
  collectionName?: string;
  /** FastEmbed model name. */
  embeddingModel?: string;
  /** Cache directory for downloaded FastEmbed model files. */
  modelCachePath?: string;
  /** Maximum words per chunk. */
  chunkWords?: number;
  /** Words repeated between adjacent chunks. */
  chunkOverlap?: number;
  /** Worker-process timeout. */
  timeoutMs?: number;
}

export interface RagSourceIdentity {
  caseId: RagCaseId;
  /** Logical corpus, for example "case" or "research:laws". */
  corpus: string;
  /** Stable application-owned identifier for this source. */
  sourceId: string;
  /** Human-readable citation label, usually the original filename or title. */
  sourceLabel: string;
}

export interface RagUpsertFileInput extends RagSourceIdentity {
  filePath: string;
  mimeType?: string;
  metadata?: RagMetadata;
}

export interface RagUpsertTextInput extends RagSourceIdentity {
  text: string;
  /** Locator prefix used for generated passages. Defaults to "text". */
  locatorPrefix?: string;
  metadata?: RagMetadata;
}

export interface RagUpsertResult extends RagSourceIdentity {
  sourceHash: string;
  indexedChunks: number;
  replacedChunks: number;
  embeddingMode: "fastembed";
}

export interface RagDeleteSourceInput {
  caseId: RagCaseId;
  corpus: string;
  sourceId: string;
}

export interface RagDeleteSourceResult {
  caseId: string;
  corpus: string;
  sourceId: string;
  deletedChunks: number;
}

export interface RagQueryInput {
  caseId: RagCaseId;
  corpus: string;
  query: string;
  limit?: number;
  scoreThreshold?: number;
  /** Optional source allow-list inside the selected case and corpus. */
  sourceIds?: string[];
}

/** Stable, directly displayable source citation returned with every match. */
export interface RagCitation {
  /** UUIDv5 derived from the source version, locator, and chunk content. */
  citationId: string;
  caseId: string;
  corpus: string;
  sourceId: string;
  sourceLabel: string;
  sourceHash: string;
  contentHash: string;
  chunkIndex: number;
  /** Page, line range, DOCX paragraph/table cell, or HTML block locator. */
  locator: string;
  /** Verbatim normalized passage stored in the index. */
  passage: string;
  score: number;
  metadata: RagMetadata;
}

export interface RagQueryResult {
  matches: RagCitation[];
  embeddingMode: "fastembed";
}

export interface RagHealthResult {
  backend: "qdrant-local";
  storePath: string;
  collectionName: string;
  embeddingMode: "fastembed";
  embeddingModel: string;
  qdrantAvailable: boolean;
  fastembedAvailable: boolean;
}
