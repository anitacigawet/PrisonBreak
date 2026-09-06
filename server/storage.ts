/**
 * Local filesystem storage for uploaded case documents.
 *
 * Files live under ./data/uploads/<key> and are served via the
 * /api/files/<key> Express route registered in server/_core/index.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./persistence";
import { getDataRoot } from "./runtimePaths";

const uploadRoot = () => path.join(getDataRoot(), "uploads");
const PUBLIC_URL_PREFIX = "/api/files";

function ensureUploadRoot(): void {
  const UPLOAD_ROOT = uploadRoot();
  if (!fs.existsSync(UPLOAD_ROOT)) {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  }
}

function normalizeKey(relKey: string): string {
  // Trim leading slashes, normalize separators, block parent traversal.
  const trimmed = relKey.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (!trimmed || trimmed.split("/").some(seg => !seg || seg === ".." || seg === "." || /[\x00-\x1f:]/.test(seg))) {
    throw new Error(`Refusing storage key containing '..': ${relKey}`);
  }
  return trimmed;
}

function resolveLocalPath(key: string): string {
  const root = uploadRoot();
  const target = path.resolve(root, key);
  if (!target.startsWith(root + path.sep)) throw new Error("Storage key escapes upload root");
  // Existing symlinked ancestors may not redirect writes or downloads elsewhere.
  if (fs.existsSync(root)) {
    let ancestor = target;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const canonicalRoot = fs.realpathSync.native(root);
    const canonicalAncestor = fs.realpathSync.native(ancestor);
    if (canonicalAncestor !== canonicalRoot && !canonicalAncestor.startsWith(canonicalRoot + path.sep)) throw new Error("Storage path escapes upload root");
  }
  return target;
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

  atomicWriteFile(localPath, buffer);

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

export const STORAGE_ROOT = uploadRoot();

/** Roll back only the unique upload created by the current failed request. */
export function storageRemove(relKey: string): void {
  const file = resolveStoragePath(relKey);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
