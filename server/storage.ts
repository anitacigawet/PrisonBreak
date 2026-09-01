/**
 * Local filesystem storage for uploaded case documents.
 *
 * Files live under ./data/uploads/<key> and are served via the
 * /api/files/<key> Express route registered in server/_core/index.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
const PUBLIC_URL_PREFIX = "/api/files";

function ensureUploadRoot(): void {
  if (!fs.existsSync(UPLOAD_ROOT)) {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  }
}

function normalizeKey(relKey: string): string {
  // Trim leading slashes, normalize separators, block parent traversal.
  const trimmed = relKey.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (trimmed.split("/").some(seg => seg === "..")) {
    throw new Error(`Refusing storage key containing '..': ${relKey}`);
  }
  return trimmed;
}

function resolveLocalPath(key: string): string {
  return path.join(UPLOAD_ROOT, key);
}

function buildPublicUrl(key: string): string {
  return `${PUBLIC_URL_PREFIX}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  ensureUploadRoot();
  const key = normalizeKey(relKey);
  const localPath = resolveLocalPath(key);

  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const buffer =
    typeof data === "string"
      ? Buffer.from(data, "utf8")
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);

  fs.writeFileSync(localPath, buffer);

  return { key, url: buildPublicUrl(key) };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: buildPublicUrl(key) };
}

/** Resolve a storage key to its absolute disk path. Used by the file-serve route. */
export function resolveStoragePath(relKey: string): string {
  return resolveLocalPath(normalizeKey(relKey));
}

export const STORAGE_ROOT = UPLOAD_ROOT;
