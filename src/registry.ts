import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Owns ~/.standby/: a registry of live extension-host windows so a Claude Code
 * hook can route its event to the window whose workspace contains the hook's
 * cwd, letting multiple Cursor windows run Standby at once.
 *
 * - `ports.json`  — the source of truth: { version, windows: WindowEntry[] }.
 * - `ports.tsv`   — a flat `<folder>\t<port>` companion the POSIX hook greps
 *                   (no jq/JSON parsing in shell). One line per folder per window.
 *
 * All writes are atomic (temp file + rename) and guarded by a best-effort
 * lockfile. Entries self-heal: dead pids and entries older than the TTL are
 * pruned on every write and on startup. Folders are stored resolved to their
 * physical path (realpath) so symlinked workspaces match — the hook resolves
 * its cwd the same way (`pwd -P`).
 *
 * IMPORTANT: every function here does synchronous fs I/O. It must never be
 * called from the hide/reveal path (guarantees #1/#5) — only at activate/
 * deactivate/listen/workspace-change, which are off the feel-critical path.
 */

const DIR = path.join(os.homedir(), '.standby');
const JSON_PATH = path.join(DIR, 'ports.json');
const TSV_PATH = path.join(DIR, 'ports.tsv');
const LOCK_PATH = path.join(DIR, '.lock');
const TAB = String.fromCharCode(9); // literal tab — the hook splits on it via IFS
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // crash-without-cleanup backstop behind pid-liveness

export interface WindowEntry {
  pid: number;
  port: number;
  folders: string[];
  updated: number;
}

interface RegistryFile {
  version: 1;
  windows: WindowEntry[];
}

/** True if the pid is a live process (EPERM = alive but not ours; ESRCH = dead). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Resolve a folder to its physical path; fall back to path.resolve on error. */
function resolveFolder(folder: string): string {
  try {
    return fs.realpathSync(folder);
  } catch {
    return path.resolve(folder);
  }
}

/** Read the registry; any error (missing/corrupt/wrong shape) yields [] and self-heals on next write. */
function readEntries(): WindowEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) as RegistryFile;
    if (parsed?.version === 1 && Array.isArray(parsed.windows)) {
      return parsed.windows.filter(
        (e) =>
          e &&
          typeof e.pid === 'number' &&
          typeof e.port === 'number' &&
          Array.isArray(e.folders) &&
          typeof e.updated === 'number'
      );
    }
  } catch {
    // corrupt == empty; the next writeAtomic rewrites it cleanly
  }
  return [];
}

/** Keep only live entries; tolerate our own pid past the TTL, drop others past it. */
function prune(entries: WindowEntry[], selfPid: number): WindowEntry[] {
  const now = Date.now();
  return entries.filter(
    (e) => isAlive(e.pid) && (e.pid === selfPid || now - e.updated < STALE_TTL_MS)
  );
}

function writeAtomic(entries: WindowEntry[]): void {
  fs.mkdirSync(DIR, { recursive: true });

  const jsonTmp = `${JSON_PATH}.${process.pid}.tmp`;
  const file: RegistryFile = { version: 1, windows: entries };
  fs.writeFileSync(jsonTmp, JSON.stringify(file, null, 2) + '\n');
  fs.renameSync(jsonTmp, JSON_PATH); // atomic on the same filesystem

  const tsvTmp = `${TSV_PATH}.${process.pid}.tmp`;
  const tsv =
    entries.flatMap((e) => e.folders.map((f) => `${f}${TAB}${e.port}`)).join('\n') + '\n';
  fs.writeFileSync(tsvTmp, tsv);
  fs.renameSync(tsvTmp, TSV_PATH);
}

/**
 * Run `fn` under a best-effort lock. If the lock can't be acquired (another
 * process holds it), still run `fn` — the atomic rename keeps writes coherent —
 * but NEVER unlink a lock this call did not create.
 */
function withLock(fn: () => void): void {
  fs.mkdirSync(DIR, { recursive: true });
  let acquired = false;
  for (let i = 0; i < 5; i++) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.closeSync(fd);
      acquired = true;
      break;
    } catch {
      // Someone else holds it; sleep ~20ms synchronously and retry.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    fn();
  } finally {
    if (acquired) {
      try {
        fs.unlinkSync(LOCK_PATH);
      } catch {
        // ignore
      }
    }
  }
}

/** Upsert this window's entry (keyed by pid), pruning dead/stale entries first. */
export function register(entry: { pid: number; port: number; folders: string[] }): void {
  withLock(() => {
    const folders = entry.folders.map(resolveFolder);
    const others = prune(readEntries(), entry.pid).filter((e) => e.pid !== entry.pid);
    others.push({ pid: entry.pid, port: entry.port, folders, updated: Date.now() });
    writeAtomic(others);
  });
}

/** Remove this window's entry (clean shutdown). Prunes others in passing. */
export function unregister(pid: number): void {
  withLock(() => {
    const remaining = prune(readEntries(), pid).filter((e) => e.pid !== pid);
    writeAtomic(remaining);
  });
}

/** Drop dead/stale entries on startup so a crashed window's entry doesn't linger. */
export function pruneStartup(): void {
  withLock(() => {
    writeAtomic(prune(readEntries(), process.pid));
  });
}

/** Current live entries (for the diagnostics command in Phase 1c). */
export function readSnapshot(): WindowEntry[] {
  return readEntries();
}

/** Exposed for tests: the on-disk locations. */
export const paths = { DIR, JSON_PATH, TSV_PATH, LOCK_PATH };
