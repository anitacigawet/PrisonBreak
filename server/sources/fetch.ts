/**
 * Fetch and retain an immutable copy of a web-research source.
 *
 * CLI research discovers candidate URLs. This module, not the CLI output,
 * admits evidence into the case corpus. Every redirect is revalidated and
 * private/link-local targets are rejected to keep this from becoming an SSRF
 * proxy when a model returns a hostile URL.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isIP } from "node:net";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { LookupAddress } from "node:dns";
import { validatePrimarySourceUrl } from "../research/schema";
import { getDataRoot } from "../runtimePaths";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 30_000;

const MIME_EXTENSIONS: Record<string, string> = {
  "text/html": ".html",
  "application/xhtml+xml": ".html",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export interface SourceFetchInput {
  caseId: number;
  corpusKey: string;
  url: string;
  timeoutMs?: number;
  /** Explicit operator-owned official hosts; never inferred from CLI output. */
  officialHostAllowlist?: readonly string[];
}

export interface SourceArtifact {
  requestedUrl: string;
  canonicalUrl: string;
  snapshotPath: string;
  mimeType: string;
  byteLength: number;
  contentHash: string;
  retrievedAt: Date;
}

export interface SourceFetchDependencies {
  /** Injectable connector for synthetic tests. Production always pins DNS. */
  requestImpl?: typeof httpsRequest;
  resolveHost?: typeof resolvePublicHost;
  dataRoot?: string;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  if (ip.includes("%")) return true;
  // WHATWG normalization converts dotted IPv4 tails to hex. Classification is
  // on all 128 bits, so compressed/expanded/mapped forms have the same result.
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = normalized.split("::");
  const lhs = left ? left.split(":") : [];
  const rhs = right ? right.split(":") : [];
  const words = right === undefined ? lhs : [...lhs, ...Array(8 - lhs.length - rhs.length).fill("0"), ...rhs];
  const bytes = words.flatMap(word => { const value = parseInt(word, 16); return [value >> 8, value & 255]; });
  if (bytes.slice(0, 10).every(value => value === 0) && bytes[10] === 255 && bytes[11] === 255) {
    return isPrivateIpv4(bytes.slice(12).join("."));
  }
  // Only ordinary global unicast is supported. Exclude protocol assignments,
  // documentation and transition ranges instead of accepting all other IPv6.
  if ((bytes[0] & 0xe0) !== 0x20) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] < 2) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true;
  return bytes[0] === 0x3f && (bytes[1] & 0xf0) === 0xf0;
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) return !isPrivateIpv6(address);
  return false;
}

export async function resolvePublicHost(hostname: string): Promise<LookupAddress[]> {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new Error(`Research source host is not public: ${hostname}`);
  }
  const records = await lookup(lower, { all: true, verbatim: true });
  if (records.length === 0 || records.some(record => !isPublicAddress(record.address))) {
    throw new Error(`Research source resolved to a private or reserved address: ${hostname}`);
  }
  return records;
}

function validateUrl(raw: string, officialHostAllowlist: readonly string[] = []): URL {
  return new URL(validatePrimarySourceUrl(raw, officialHostAllowlist));
}

/** The connector can resolve only the prevalidated address, while TLS still
 * verifies the original official hostname. No second DNS lookup or pooled
 * socket is allowed to change the destination between admission and connect. */
export async function requestPinnedSource(url: URL, signal: AbortSignal, deps: SourceFetchDependencies = {}): Promise<Response> {
  signal.throwIfAborted();
  const records = await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Research source lookup timed out"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => (deps.resolveHost ?? resolvePublicHost)(url.hostname)).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  if (!records.length || records.some(record => !isPublicAddress(record.address) || isIP(record.address) !== record.family)) {
    throw new Error("Research source resolved to a private or reserved address");
  }
  const selected = records[0];
  const options: RequestOptions = {
    method: "GET", agent: false, signal, servername: url.hostname,
    lookup: ((_host: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      if (_host !== url.hostname) { callback(new Error("Unexpected lookup host")); return; }
      if (lookupOptions.all) callback(null, [selected]);
      else callback(null, selected.address, selected.family);
    }) as RequestOptions["lookup"],
    headers: {
      Accept: "text/html,application/xhtml+xml,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document;q=0.8",
      "Accept-Encoding": "identity", "User-Agent": "PrisonBreak-source-retriever/1.0",
    },
  };
  return new Promise((resolve, reject) => {
    const req = (deps.requestImpl ?? httpsRequest)(url, options, response => {
      try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const status = response.statusCode ?? 500;
      // Do not retain redirect/error bodies. The successful response is bounded
      // while the socket is read, before a body buffer or web Response is built.
      if (status < 200 || status >= 300 || [204, 205].includes(status)) {
        response.destroy(); resolve(new Response(null, { status, headers })); return;
      }
      const declared = Number(headers.get("content-length") ?? "0");
      if (declared > MAX_BYTES) {
        response.destroy(); reject(new Error(`Research source exceeds ${MAX_BYTES} bytes.`)); return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let failed = false;
      const fail = (error: Error) => { failed = true; response.destroy(); reject(error); };
      response.on("error", fail);
      response.on("aborted", () => fail(new Error("Research source response was interrupted")));
      response.on("data", (chunk: Buffer) => {
        if (failed) return;
        total += chunk.length;
        if (total > MAX_BYTES) {
          fail(new Error(`Research source exceeds ${MAX_BYTES} bytes.`)); return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (failed) return;
        try { resolve(new Response(new Uint8Array(Buffer.concat(chunks, total)), { status, headers })); }
        catch (error) { reject(error); }
      });
      } catch (error) { response.destroy(); reject(error); }
    });
    req.on("error", reject);
    req.end();
  });
}

async function readBounded(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(`Research source exceeds ${MAX_BYTES} bytes.`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`Research source exceeds ${MAX_BYTES} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

function safeCorpusSegment(corpusKey: string): string {
  const segment = corpusKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  if (!segment) throw new Error("Corpus key is empty after normalization.");
  return segment;
}

export async function fetchAndSnapshotSource(
  input: SourceFetchInput,
  deps: SourceFetchDependencies = {},
): Promise<SourceArtifact> {
  if (!Number.isSafeInteger(input.caseId) || input.caseId <= 0) throw new Error("A positive case ID is required");
  const requested = validateUrl(input.url, input.officialHostAllowlist);
  const signal = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let current = requested;
  let response: Response | undefined;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    response = await requestPinnedSource(current, signal, deps);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error(`Research source redirect omitted Location: ${current}`);
    if (redirects === MAX_REDIRECTS) throw new Error("Research source exceeded redirect limit.");
    current = validateUrl(new URL(location, current).toString(), input.officialHostAllowlist);
  }

  if (!response?.ok) {
    await response?.body?.cancel();
    throw new Error(`Research source returned HTTP ${response?.status ?? "unknown"}: ${current}`);
  }
  const mimeType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension || ![null, "identity"].includes(response.headers.get("content-encoding"))) {
    await response.body?.cancel();
    throw new Error(`Unsupported research source content type or encoding: ${mimeType || "missing"}`);
  }

  const body = await readBounded(response);
  if (body.length === 0) throw new Error("Research source returned an empty body.");
  const contentHash = createHash("sha256").update(body).digest("hex");
  const root = deps.dataRoot ?? path.join(getDataRoot(), "research", "cases");
  const directory = path.join(root, String(input.caseId), safeCorpusSegment(input.corpusKey));
  await fs.mkdir(directory, { recursive: true });
  const snapshotPath = path.join(directory, `${contentHash}${extension}`);
  try {
    await fs.writeFile(snapshotPath, body, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  return {
    requestedUrl: requested.toString(),
    canonicalUrl: current.toString(),
    snapshotPath,
    mimeType,
    byteLength: body.length,
    contentHash,
    retrievedAt: new Date(),
  };
}
