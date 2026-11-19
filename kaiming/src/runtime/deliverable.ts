/**
 * Delivery observation (G3): the program, not the model, binds a review/test report to the state of
 * the delivered files it actually checked.
 *
 * The state is a digest over the project's file contents, excluding host bookkeeping (`.dev`), the
 * repository metadata (`.git`), installed packages (`node_modules`), the project knowledge entries
 * the workspace was initialized with, and files git ignores: the first three are host records,
 * knowledge is rewritten by settlement, and ignored files are build outputs or the user's own files
 * that no commit can carry. The observed path list travels with the digest, so completion re-reads
 * exactly the files the report covered — a later addition (a knowledge entry, a report body) does
 * not invalidate a review, while a change or removal of a reviewed file does.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { changedProjectPaths, ignoredProjectPaths } from './git-delivery.ts';

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
 * Observe the committable delivery now. `excludePaths` are absolute paths of project knowledge
 * entries: a settlement legitimately rewrites them after the review, so they are not part of what
 * was reviewed. Files git ignores are removed by the same rule.
 */
export function snapshotDelivery(cwd: string, excludePaths: readonly string[] = []): DeliveryState {
  const paths = deliveryPaths(cwd, excludePaths);
  return { digest: digestOfPaths(cwd, paths), paths };
}

/**
 * Every project file the delivery walk observes, before git's ignore filter. Exported for the
 * completion check: new candidates can be filtered by `git check-ignore` alone, so a turn with no
 * late files pays only the directory walk.
 */
export function projectFilePaths(cwd: string, excludePaths: readonly string[] = []): string[] {
  const excluded = new Set(excludePaths.map((path) => normalize(path)));
  const observed: string[] = [];
  collect(cwd, '', excluded, observed);
  return observed;
}

/**
 * The observed delivery path list without hashing: enough to answer "did anything new appear since
 * the review" on every completion check, without paying a full digest walk each time. The review and
 * test digests still use `snapshotDelivery`. A file git ignores is not part of the delivery, even
 * though the walk sees it on disk: no commit can carry it, and build outputs or the user's own
 * excluded files must not invalidate a review. If git cannot answer, fail instead of silently
 * treating every observed path as delivery.
 */
export function deliveryPaths(cwd: string, excludePaths: readonly string[] = []): string[] {
  const observed = projectFilePaths(cwd, excludePaths);
  const observation = ignoredProjectPaths(cwd, observed);
  if (observation.detail !== undefined) {
    throw new Error(`ignored paths could not be determined: ${observation.detail}`);
  }
  const ignored = observation.ignored;
  return ignored.size === 0 ? observed : observed.filter((path) => !ignored.has(path));
}

/**
 * The files a main design Task is reviewed against. `.dev/backlog.md` is excluded because
 * settlement legitimately closes the original item after Review; `.dev/work` and legacy records are
 * host/evidence files, not design output.
 */
export function snapshotDesignDelivery(cwd: string, excludePaths: readonly string[] = []): DeliveryState {
  const paths = designDeliveryPaths(cwd, excludePaths);
  return { digest: digestOfPaths(cwd, paths), paths };
}

/** The design delivery path list without hashing; see `deliveryPaths`. */
export function designDeliveryPaths(cwd: string, excludePaths: readonly string[] = []): string[] {
  const excluded = new Set(excludePaths.map((path) => normalize(path)));
  const observed: string[] = [];
  for (const dir of ['.dev/product', '.dev/technical']) {
    collect(cwd, dir, new Set(), observed);
  }
  for (const file of ['AGENTS.md', '.dev/INDEX.md', '.dev/PROJECT.md']) {
    if (isObservedFile(cwd, file)) observed.push(file);
  }
  return [...new Set(observed)].filter((path) => !excluded.has(normalize(join(cwd, path)))).sort();
}

/** Recompute the digest of the very paths a report covered (missing files count as changed). */
export function digestOfPaths(cwd: string, paths: readonly string[]): string {
  const lines = [...paths].sort().map((path) => `${path}\0${hashFile(join(cwd, path))}`);
  return sha256(lines.join('\n'));
}

/**
 * The identity of a file that was already dirty when a write Task was created: its content hash (or
 * `missing`/`unreadable`). A file whose bytes still match is somebody else's uncommitted work and not
 * part of this Task's delivery; once they change, it joins the Task's scope and delivery.
 */
export type DirtyBaseline = Readonly<Record<string, string>>;

/**
 * Whether the delivery walk would observe this path: a regular file, not a symlink, outside the host
 * bookkeeping directories. Git can report paths the snapshot never walks; demanding a review for
 * those would be unsatisfiable.
 */
export function isWalkedProjectFile(cwd: string, path: string): boolean {
  if (path.split('/').some((segment) => SKIP_DIRS.has(segment))) return false;
  return isObservedFile(cwd, path);
}

/**
 * Snapshot every git-dirty project path's content. No repository means no baseline (no filtering).
 * `design` also captures `.dev/product/**` and `.dev/technical/**`: those are a design Task's delivery
 * even though ordinary reviews never see `.dev`.
 */
export function captureDirtyBaseline(cwd: string, options: { design?: boolean } = {}): DirtyBaseline {
  const baseline: Record<string, string> = {};
  for (const path of changedProjectPaths(cwd)) {
    // A deleted path is still an identity (`missing`); anything present must be a readable file the
    // walk could visit, so a FIFO or a symlink never blocks Task creation or the recheck.
    const absolute = join(cwd, path);
    if (!existsSync(absolute)) {
      baseline[path] = 'missing';
      continue;
    }
    if (isWalkedProjectFile(cwd, path)) {
      baseline[path] = hashFile(absolute);
      continue;
    }
    const designArtifact =
      options.design === true && (path.startsWith('.dev/product/') || path.startsWith('.dev/technical/'));
    if (designArtifact && isObservedFile(cwd, path)) baseline[path] = hashFile(absolute);
  }
  return baseline;
}

/** True when the path was dirty at Task creation and its bytes have not changed since. */
export function isUnchangedBaselineDirty(
  cwd: string,
  path: string,
  baseline: DirtyBaseline | null | undefined,
): boolean {
  return baseline != null && Object.hasOwn(baseline, path) && hashFile(join(cwd, path)) === baseline[path];
}

/**
 * The observed state minus the files this Task inherited: one rule for the review snapshot and every
 * later recheck, so the two digests are computed over the same paths.
 */
export function withoutInherited(
  cwd: string,
  state: DeliveryState,
  baseline: DirtyBaseline | null | undefined,
): DeliveryState {
  const paths = state.paths.filter((path) => !isUnchangedBaselineDirty(cwd, path, baseline));
  return paths.length === state.paths.length ? state : { digest: digestOfPaths(cwd, paths), paths };
}

/**
 * A path the review binding can actually cover: code files bind the review, docs/root Markdown are
 * settlement output once a code path exists, and `.dev/**` is host bookkeeping. A design Task binds
 * only its design artifacts.
 */
export function isCodeDeliveryPath(path: string): boolean {
  return (
    !path.startsWith('.dev/') &&
    path !== '.gitignore' &&
    !path.endsWith('/.gitignore') &&
    !path.startsWith('docs/') &&
    (path.includes('/') || !path.endsWith('.md'))
  );
}

/** What a review for this Task can bind; `excluded` holds project-relative knowledge entries. */
export interface DeliveryBinding {
  readonly design: boolean;
  readonly codeBound: boolean;
  /** Knowledge entries are saved by settlement, so a change there never demands a review. */
  readonly excluded?: ReadonlySet<string>;
}

/** Whether a change at `path` could be covered by the review this Task kind produces. */
export function isReviewableDeliveryPath(path: string, binding: DeliveryBinding): boolean {
  if (binding.excluded?.has(path) === true) return false;
  if (binding.design) {
    return path.startsWith('.dev/product/') || path.startsWith('.dev/technical/');
  }
  if (binding.codeBound) return isCodeDeliveryPath(path);
  return !path.startsWith('.dev/');
}

/**
 * Inherited files that left the baseline after the review and could have been covered by it: they are
 * the Task's delivery now, but the review recorded a path list without them, so it must run again.
 * `covered` is the path list that review recorded; the binding excludes changes a review can never
 * cover (settlement output, host bookkeeping).
 */
export function changedInheritedPaths(
  cwd: string,
  baseline: DirtyBaseline | null | undefined,
  covered: readonly string[],
  binding: DeliveryBinding,
): string[] {
  if (baseline == null) return [];
  const reviewed = new Set(covered);
  return Object.keys(baseline)
    .filter((path) => {
      if (reviewed.has(path) || !isReviewableDeliveryPath(path, binding)) return false;
      // A design artifact lives under `.dev`, which the ordinary walk skips; the design snapshot
      // reads it directly, so both observations are regular files.
      const observed = binding.design ? isObservedFile(cwd, path) : isWalkedProjectFile(cwd, path);
      return observed && hashFile(join(cwd, path)) !== baseline[path];
    })
    .sort();
}

/**
 * Paths the current delivery contains that the last passed review never covered. The caller passes
 * the observed path list (not digests: this runs on every completion check). Inherited baseline paths
 * are excluded by identity: their changes are `changedInheritedPaths`' finding, not a new file, and
 * an untouched inherited file is the user's own work. This is exactly the "created after the review"
 * set for the paths a review of this Task kind can bind; settlement output never lands here.
 */
export function newReviewableDeliveryPaths(
  cwd: string,
  paths: readonly string[],
  reviewed: readonly string[],
  binding: DeliveryBinding,
  baseline: DirtyBaseline | null | undefined,
): string[] {
  const covered = new Set(reviewed);
  const candidates = paths.filter(
    (path) =>
      !covered.has(path) &&
      isReviewableDeliveryPath(path, binding) &&
      !(baseline != null && Object.hasOwn(baseline, path)),
  );
  if (candidates.length === 0 || binding.design) return candidates.sort();
  // Only the candidates need git's ignore answer; the paths the review already covered were filtered
  // when that review ran.
  const observation = ignoredProjectPaths(cwd, candidates);
  if (observation.detail !== undefined) {
    throw new Error(`ignored paths could not be determined: ${observation.detail}`);
  }
  return candidates.filter((path) => !observation.ignored.has(path)).sort();
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
