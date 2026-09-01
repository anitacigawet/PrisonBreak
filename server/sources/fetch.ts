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
  fetchImpl?: typeof fetch;
  resolveHost?: typeof resolvePublicHost;
  dataRoot?: string;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0];
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) return !isPrivateIpv6(address);
  return false;
}

export async function resolvePublicHost(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new Error(`Research source host is not public: ${hostname}`);
  }
  const records = await lookup(lower, { all: true, verbatim: true });
  if (records.length === 0 || records.some(record => !isPublicAddress(record.address))) {
    throw new Error(`Research source resolved to a private or reserved address: ${hostname}`);
  }
}

async function validateUrl(raw: string, resolveHost: typeof resolvePublicHost): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Research sources must use HTTP(S), received ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("Research source URLs cannot contain credentials.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error(`Research source URL uses a blocked port: ${url.port}`);
  }
  await resolveHost(url.hostname);
  return url;
}

async function readBounded(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
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
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveHost = deps.resolveHost ?? resolvePublicHost;
  const requested = await validateUrl(input.url, resolveHost);
  let current = requested;
  let response: Response | undefined;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document;q=0.8",
        "User-Agent": "PrisonBreak-source-retriever/1.0",
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Research source redirect omitted Location: ${current}`);
    if (redirects === MAX_REDIRECTS) throw new Error("Research source exceeded redirect limit.");
    current = await validateUrl(new URL(location, current).toString(), resolveHost);
  }

  if (!response?.ok) {
    throw new Error(`Research source returned HTTP ${response?.status ?? "unknown"}: ${current}`);
  }
  const mimeType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) throw new Error(`Unsupported research source content type: ${mimeType || "missing"}`);

  const body = await readBounded(response);
  if (body.length === 0) throw new Error("Research source returned an empty body.");
  const contentHash = createHash("sha256").update(body).digest("hex");
  const root = deps.dataRoot ?? path.join(process.cwd(), "data", "research", "cases");
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
