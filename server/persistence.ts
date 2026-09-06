import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/** Replace only after the complete new file has been written and checked. */
export function atomicWriteFile(file: string, contents: Uint8Array | string): void {
  const bytes = Buffer.from(contents);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (!fs.readFileSync(temporary).equals(bytes)) {
      throw new Error("Persistent write verification failed");
    }
    fs.renameSync(temporary, file);
    // Directory fsync is supported on POSIX but not all Windows filesystems.
    // Once rename succeeds the new file is committed; never report rollback
    // merely because an optional directory flush is unsupported.
    if (process.platform !== "win32") {
      let directory: number | undefined;
      try { directory = fs.openSync(path.dirname(file), "r"); fs.fsyncSync(directory); }
      catch { /* Atomic replacement remains valid without a directory fsync. */ }
      finally { if (directory !== undefined) { try { fs.closeSync(directory); } catch { /* Already committed. */ } } }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Called only after exclusive ownership; recover incomplete pre-rename writes. */
export function removeAbandonedAtomicWrites(file: string): void {
  const directory = path.dirname(file);
  if (!fs.existsSync(directory)) return;
  const prefix = path.basename(file) + ".";
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(prefix) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(name.slice(prefix.length))) continue;
    const target = path.join(directory, name);
    if (!fs.lstatSync(target).isFile()) throw new Error("Unexpected atomic-write recovery path; inspect local storage before restarting.");
    fs.unlinkSync(target);
  }
}

function canonicalPath(target: string): string {
  const absolute = path.resolve(target);
  if (fs.existsSync(absolute)) return fs.realpathSync.native(absolute);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return path.join(fs.realpathSync.native(path.dirname(absolute)), path.basename(absolute));
}

type LockOwner = { pid: number; nonce: string };
function readOwner(file: string): LockOwner {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.nonce !== "string") {
    throw new Error(`Incomplete runtime lock at ${file}. Stop all app processes and inspect this lock before removing it.`);
  }
  return value;
}
function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function acquireFileLock(file: string): () => void {
  const owner: LockOwner = { pid: process.pid, nonce: randomUUID() };
  const claim = () => {
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  };
  try { claim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Serialize crash recovery. A live/reused PID is always treated as owned.
    // An incomplete owner/recovery lock fails closed instead of guessing.
    const recovery = `${file}.recovery`;
    try { fs.mkdirSync(recovery); }
    catch { throw new Error(`Runtime lock recovery already in progress at ${file}`); }
    try {
      if (fs.existsSync(file)) {
        const previous = readOwner(file);
        if (processExists(previous.pid)) throw new Error(`Runtime already owned by process ${previous.pid}: ${file}`);
        fs.unlinkSync(file);
      }
      claim();
    } finally { fs.rmdirSync(recovery); }
  }
  return () => {
    if (fs.existsSync(file) && readOwner(file).nonce === owner.nonce) fs.unlinkSync(file);
  };
}

/** Lock both shared runtime state and the canonical DB before reading either. */
export function acquireRuntimeOwnership(dataRoot: string, databasePath: string, sharedStorePaths: string[] = []): {
  databasePath: string; release: () => void;
} {
  fs.mkdirSync(dataRoot, { recursive: true });
  const canonicalRoot = canonicalPath(dataRoot);
  const canonicalDb = canonicalPath(databasePath);
  if (fs.existsSync(canonicalDb) && fs.statSync(canonicalDb).nlink > 1) {
    throw new Error("Hard-linked database files are not supported; use a single ordinary database file.");
  }
  const targets = Array.from(new Set([
    path.join(canonicalRoot, ".prisonbreak.lock"), `${canonicalDb}.lock`,
    ...sharedStorePaths.map(store => `${canonicalPath(store)}.prisonbreak.lock`),
  ])).sort();
  const releases: Array<() => void> = [];
  try { for (const target of targets) releases.push(acquireFileLock(target)); }
  catch (error) { for (const release of releases.reverse()) release(); throw error; }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const unlock of releases.reverse()) unlock();
    process.off("exit", release);
  };
  process.once("exit", release);
  return { databasePath: canonicalDb, release };
}
