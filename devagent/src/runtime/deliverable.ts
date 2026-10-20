/**
 * Delivery observation (G3): the program, not the model, binds a review/test report to the state of
 * the delivered files it actually checked.
 *
 * The state is a digest over the project's file contents, excluding host bookkeeping (`.dev`), the
 * repository metadata (`.git`), installed packages (`node_modules`) and the project knowledge entries
 * the workspace was initialized with: those are records the settlement writes, not the delivery it
 * verifies. The observed path list travels with the digest, so completion re-reads exactly the files
 * the report covered — a later addition (a knowledge entry, a report body) does not invalidate a
 * review, while a change or removal of a reviewed file does.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';

export interface DeliveryState {
  /** sha256 over the observed paths and their contents. */
  readonly digest: string;
  /** Project-relative POSIX paths the digest covers, sorted. */
  readonly paths: readonly string[];
}

/** Directories that are never part of a delivery. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dev']);

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * Stable identity of one file: its digest, or a distinct marker for "gone" and "present but
 * unreadable". The two must differ, or a reviewed file that was unreadable and is later deleted would
 * still look unchanged.
 */
function hashFile(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return existsSync(path) ? 'unreadable' : 'missing';
  }
}

function collect(cwd: string, dir: string, excluded: ReadonlySet<string>, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(cwd, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const relativePath = dir === '' ? entry.name : join(dir, entry.name);
    const absolute = normalize(join(cwd, relativePath));
    if (excluded.has(absolute)) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collect(cwd, relativePath, excluded, out);
      }
      continue;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isFile()) {
      out.push(toPosix(relativePath));
    }
  }
}

/**
 * Observe the whole delivery now. `excludePaths` are absolute paths of project knowledge entries: a
 * settlement legitimately rewrites them after the review, so they are not part of what was reviewed.
 */
export function snapshotDelivery(cwd: string, excludePaths: readonly string[] = []): DeliveryState {
  const excluded = new Set(excludePaths.map((path) => normalize(path)));
  const paths: string[] = [];
  collect(cwd, '', excluded, paths);
  return { digest: digestOfPaths(cwd, paths), paths };
}

/** Recompute the digest of the very paths a report covered (missing files count as changed). */
export function digestOfPaths(cwd: string, paths: readonly string[]): string {
  const lines = [...paths].sort().map((path) => `${path}\0${hashFile(join(cwd, path))}`);
  return sha256(lines.join('\n'));
}

/** Whether a path inside the project is a file the walk would observe (symlinks are not). */
export function isObservedFile(cwd: string, path: string): boolean {
  try {
    const stats = lstatSync(join(cwd, path));
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Project-relative POSIX spelling of an absolute path, for diagnostics. */
export function relativeToProject(cwd: string, absolute: string): string {
  return toPosix(relative(cwd, absolute));
}
