/**
 * Process bridge for the provider-neutral local retrieval worker.
 *
 * Requests and responses cross the process boundary as one JSON document on
 * stdin/stdout. Calls are serialized because separate Qdrant local clients
 * must not open the same persistent directory concurrently.
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { getDataRoot } from "../runtimePaths";

import type {
  RagBridgeOptions,
  RagDeleteCaseInput,
  RagDeleteCorpusInput,
  RagDeleteScopeResult,
  RagDeleteSourceInput,
  RagDeleteSourceResult,
  RagHealthResult,
  RagQueryInput,
  RagQueryResult,
  RagUpsertFileInput,
  RagUpsertResult,
  RagUpsertTextInput,
} from "./contracts";

type WorkerAction =
  | "health"
  | "upsert_file"
  | "upsert_text"
  | "delete_source"
  | "delete_case"
  | "delete_corpus"
  | "query";

interface WorkerEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string | { code?: string; message?: string };
}

interface WorkerRequest {
  action: WorkerAction;
  config: Record<string, unknown>;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;

function definedEntries(
  entries: Array<[string, unknown]>
): Record<string, unknown> {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export class LocalRagBridge {
  private readonly options: RagBridgeOptions;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RagBridgeOptions = {}, private readonly spawnWorker: typeof spawn = spawn) {
    this.options = options;
  }

  health(): Promise<RagHealthResult> {
    return this.request<RagHealthResult>("health");
  }

  upsertFile(input: RagUpsertFileInput): Promise<RagUpsertResult> {
    return this.request<RagUpsertResult>("upsert_file", input);
  }

  upsertText(input: RagUpsertTextInput): Promise<RagUpsertResult> {
    return this.request<RagUpsertResult>("upsert_text", input);
  }

  deleteSource(input: RagDeleteSourceInput): Promise<RagDeleteSourceResult> {
    return this.request<RagDeleteSourceResult>("delete_source", input);
  }

  deleteCase(input: RagDeleteCaseInput): Promise<RagDeleteScopeResult> {
    this.validateDeletionCase(input.caseId);
    return this.request<RagDeleteScopeResult>("delete_case", input);
  }

  deleteCorpus(input: RagDeleteCorpusInput): Promise<RagDeleteScopeResult> {
    this.validateDeletionCase(input.caseId);
    if (typeof input.corpus !== "string" || !input.corpus.trim()) throw new Error("A corpus is required");
    return this.request<RagDeleteScopeResult>("delete_corpus", input);
  }

  private validateDeletionCase(caseId: unknown): void {
    if (!/^[1-9][0-9]*$/.test(String(caseId)) || !Number.isSafeInteger(Number(caseId))) throw new Error("Deletion requires a positive integer case ID");
  }

  query(input: RagQueryInput): Promise<RagQueryResult> {
    return this.request<RagQueryResult>("query", input);
  }

  private request<T>(action: WorkerAction, input?: unknown): Promise<T> {
    const payload = this.workerInput(input);
    const run = this.queue.then(
      () =>
        this.runWorker<T>({ action, config: this.workerConfig(), ...payload }),
      () =>
        this.runWorker<T>({ action, config: this.workerConfig(), ...payload })
    );
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private workerInput(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const value = input as Record<string, unknown>;
    return definedEntries([
      ["case_id", value.caseId],
      ["corpus", value.corpus],
      ["source_id", value.sourceId],
      ["source_label", value.sourceLabel],
      ["file_path", value.filePath],
      ["mime_type", value.mimeType],
      ["text", value.text],
      ["locator_prefix", value.locatorPrefix],
      ["metadata", value.metadata],
      ["query", value.query],
      ["limit", value.limit],
      ["score_threshold", value.scoreThreshold],
      ["source_ids", value.sourceIds],
    ]);
  }

  private workerConfig(): Record<string, unknown> {
    const repoRoot = path.resolve(this.options.repoRoot ?? process.cwd());
    const storePath = path.resolve(
      repoRoot,
      this.options.storePath ?? process.env.PRISONBREAK_QDRANT_PATH ?? path.join(getDataRoot(), "qdrant")
    );
    const modelCachePath = this.options.modelCachePath
      ? path.resolve(repoRoot, this.options.modelCachePath)
      : process.env.PRISONBREAK_FASTEMBED_CACHE ?? path.join(getDataRoot(), "fastembed");

    return definedEntries([
      ["store_path", storePath],
      ["collection_name", this.options.collectionName],
      ["embedding_model", this.options.embeddingModel],
      ["model_cache_path", modelCachePath],
      ["chunk_words", this.options.chunkWords],
      ["chunk_overlap", this.options.chunkOverlap],
    ]);
  }

  private runWorker<T>(request: WorkerRequest): Promise<T> {
    const repoRoot = path.resolve(this.options.repoRoot ?? process.cwd());
    const pythonExecutable =
      this.options.pythonExecutable ??
      process.env.PRISONBREAK_PYTHON ??
      (process.platform === "win32" ? "python" : "python3");
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const serialized = JSON.stringify(request);
    if (Buffer.byteLength(serialized) > MAX_REQUEST_BYTES) return Promise.reject(new Error("Local RAG request exceeds byte limit"));

    return new Promise<T>((resolve, reject) => {
      const child = this.spawnWorker(pythonExecutable, ["-m", "server.rag.worker"], {
        cwd: repoRoot,
        env: process.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let diagnosticBytes = 0;
      let settled = false;
      let failure: Error | undefined;

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };

      const failAfterClose = (error: Error): void => {
        if (settled || failure) return;
        failure = error;
        clearTimeout(timer);
        // A kill request is not process exit. Keep the serial queue (and the
        // caller's case-operation lease) occupied until the worker closes, so
        // it cannot overlap the next Qdrant reader/writer while shutting down.
        child.kill("SIGKILL");
      };

      const timer = setTimeout(() => {
        failAfterClose(
            new Error(
              `Local RAG worker timed out after ${timeoutMs}ms (${request.action})`
            )
        );
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        if (failure) return;
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > MAX_RESPONSE_BYTES) {
          failAfterClose(new Error("Local RAG response exceeds byte limit")); return;
        }
        stdout += chunk;
      });
      child.stderr.on("data", chunk => {
        if (failure) return;
        diagnosticBytes += Buffer.byteLength(chunk);
        if (diagnosticBytes <= MAX_DIAGNOSTIC_BYTES) stderr += chunk;
      });
      child.on("error", error => {
        failAfterClose(
            new Error(
              `Unable to start local RAG worker with ${pythonExecutable}: ${error.message}`
            )
        );
      });
      child.on("close", code => {
        finish(() => {
          if (failure) { reject(failure); return; }
          const diagnostic = stderr.trim();
          if (code !== 0) {
            reject(
              new Error(
                `Local RAG worker exited with code ${code} (${request.action})${
                  diagnostic ? `: ${diagnostic}` : ""
                }`
              )
            );
            return;
          }

          let envelope: WorkerEnvelope<T>;
          try {
            envelope = JSON.parse(stdout) as WorkerEnvelope<T>;
          } catch {
            reject(
              new Error(
                `Local RAG worker returned invalid JSON (${request.action})${
                  diagnostic ? `: ${diagnostic}` : ""
                }`
              )
            );
            return;
          }

          if (!envelope.ok || envelope.result === undefined) {
            const workerError =
              typeof envelope.error === "string"
                ? envelope.error
                : envelope.error?.message;
            reject(
              new Error(
                workerError ||
                  `Local RAG worker failed without an error (${request.action})`
              )
            );
            return;
          }
          resolve(envelope.result);
        });
      });

      child.stdin.on("error", error => {
        failAfterClose(new Error(`Local RAG input failed: ${error.message}`));
      });
      child.stdin.end(serialized);
    });
  }
}

/** Default bridge for application wiring. No worker starts until a method runs. */
export const localRag = new LocalRagBridge();

export type {
  RagBridgeOptions,
  RagDeleteCaseInput,
  RagDeleteCorpusInput,
  RagDeleteScopeResult,
  RagCitation,
  RagDeleteSourceInput,
  RagDeleteSourceResult,
  RagHealthResult,
  RagMetadata,
  RagMetadataValue,
  RagQueryInput,
  RagQueryResult,
  RagSourceIdentity,
  RagUpsertFileInput,
  RagUpsertResult,
  RagUpsertTextInput,
} from "./contracts";
