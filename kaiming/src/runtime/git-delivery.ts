/**
 * Delivery commits, observed by the host (D-07).
 *
 * The settlement contract asks the settler to commit this round's delivery and to leave unrelated
 * work alone. Until this module existed nothing checked that it happened: `task end` closed the
 * Task on reports and file digests alone, so a forgotten commit was invisible. The host now looks
 * at git and reports the fact; it does not commit on the model's behalf (the model decides what
 * belongs in the commit, the program only says whether anything is still uncommitted).
 *
 * Deliberately narrow: the repository, HEAD, and the state of the paths the review covered.
 * Anything else about git (branches, remotes, conflicts, what the commit message should say) is the
 * model's business.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export type CommitMode = 'git' | 'no-git' | 'unverifiable';

export interface CommitObservation {
  /** `git`: a repository answered. `no-git`: nothing to commit to. `unverifiable`: cannot tell. */
  readonly mode: CommitMode;
  /** HEAD, or null in a repository without commits yet. */
  readonly head: string | null;
  /** Paths (project-relative, as git prints them) with staged, unstaged or untracked changes. */
  readonly dirty: readonly string[];
  /** Paths excluded by .gitignore: invisible to status, and therefore never committed. */
  readonly ignored: readonly string[];
  /**
   * Reviewed files that live inside a repository of their own (a vendored dependency, a submodule).
   * The project's own commits can never contain them, so each is checked against that repository.
   */
  readonly nested: readonly {
    readonly root: string;
    /**
     * `recorded`: this repository's commits carry the nested repository (a committed gitlink).
     * `unrecorded`: its path has changes here, so the pointer or content is not committed.
     * `ignored`: this repository ignores the path, so no commit here can ever carry it.
     */
    readonly state: 'recorded' | 'unrecorded' | 'ignored';
    readonly observation: CommitObservation;
  }[];
  /** Why the observation is `unverifiable`; absent otherwise. */
  readonly detail?: string;
}

const TIMEOUT_MS = 5_000;
/** Paths per `git status` call: well under any argv limit, few enough that a huge review is rare. */
const PATH_BATCH = 200;

interface GitRun {
  readonly ok: boolean;
  readonly stdout: string;
  readonly detail?: string;
  /** Exit code when git ran and refused; absent when it never started. */
  readonly code?: number;
}

function runGit(cwd: string, args: readonly string[], input?: string): GitRun {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...(input === undefined ? {} : { input }),
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
    return { ok: true, stdout };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, stdout: '', detail: 'git is not installed' };
    const stderr = (error as { stderr?: unknown }).stderr;
    const status = (error as { status?: unknown }).status;
    const detail =
      typeof stderr === 'string' && stderr.trim() !== ''
        ? stderr.trim().split('\n')[0]!
        : String(code ?? 'git failed');
    return { ok: false, stdout: '', detail, ...(typeof status === 'number' ? { code: status } : {}) };
  }
}

/** A `.git` directory, or the `gitdir:` pointer file a worktree/submodule uses. */
function isRepositoryMarker(dir: string): boolean {
  const marker = join(dir, '.git');
  if (!existsSync(marker)) return false;
  try {
    const info = statSync(marker);
    if (info.isDirectory()) return true;
    if (!info.isFile()) return false;
    return readFileSync(marker, 'utf8').startsWith('gitdir:');
  } catch {
    return false;
  }
}

/** The nearest repository above the project: a project can live inside a larger repository. */
function repositoryMarker(start: string): string | undefined {
  let current = start;
  for (;;) {
    if (isRepositoryMarker(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Group the reviewed paths by the repository they belong to below the project. git does not cross
 * such a boundary: an inner file never appears in the outer status, and passing it to an outer
 * `check-ignore` is an error. Each group is therefore checked in its own repository.
 */
function nestedGroups(
  cwd: string,
  paths: readonly string[],
): { outer: readonly string[]; groups: readonly { root: string; paths: readonly string[] }[] } {
  const byRoot = new Map<string, string[]>();
  const outer: string[] = [];
  for (const path of paths) {
    let dir = dirname(resolve(cwd, path));
    // The OUTERMOST boundary below the project: it is what this repository must record. Deeper
    // repositories are that repository's business, and are checked when its turn comes.
    let root: string | undefined;
    while (dir !== cwd && dir.startsWith(cwd)) {
      if (isRepositoryMarker(dir)) root = dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (root === undefined) {
      outer.push(path);
      continue;
    }
    const key = relative(cwd, root);
    const bucket = byRoot.get(key);
    if (bucket === undefined) byRoot.set(key, [path]);
    else bucket.push(path);
  }
  return {
    outer,
    groups: [...byRoot.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([root, group]) => ({ root, paths: group })),
  };
}

/**
 * Sort the `-z` status output into paths. A rename prints two records (status + destination, then
 * the source), so the second one is consumed rather than reported as another changed path.
 */
function dirtyPaths(porcelain: string): readonly string[] {
  const records = porcelain.split('\0').filter((entry) => entry !== '');
  const paths = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    paths.add(record.slice(3));
    if (status.startsWith('R') || status.startsWith('C')) index += 1;
  }
  return [...paths].sort();
}

function blocks(start: number, total: number, size: number): readonly [number, number][] {
  const out: [number, number][] = [];
  for (let at = start; at < total; at += size) out.push([at, Math.min(at + size, total)]);
  return out;
}

/**
 * The observed paths git cannot commit: untracked files matched by `.gitignore`,
 * `.git/info/exclude` or the configured global excludes. Tracked files are deliberately absent even
 * when a pattern matches them - git keeps tracked files committable. A missing repository or git is
 * not an error here; the caller simply has nothing to exclude.
 */
export function ignoredProjectPaths(cwd: string, paths: readonly string[]): ReadonlySet<string> {
  if (paths.length === 0) return new Set();
  const list = runGit(cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']);
  if (!list.ok) return new Set();
  const wanted = new Set(paths);
  const ignored = new Set<string>();
  for (const path of list.stdout.split('\0')) {
    if (path !== '' && wanted.has(path)) ignored.add(path);
  }
  return ignored;
}

/**
 * Project-relative paths with staged, unstaged or untracked changes anywhere in the work tree.
 * Used by the Plan scope check: the same status observation the commit gate relies on, without a
 * reviewed-path filter. A project without a readable repository reports no changed paths.
 */
export function changedProjectPaths(cwd: string): readonly string[] {
  const inside = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) return [];
  const prefixRun = runGit(cwd, ['rev-parse', '--show-prefix']);
  const prefix = prefixRun.ok ? prefixRun.stdout.trim() : '';
  const status = runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!status.ok) return [];
  return dirtyPaths(status.stdout)
    .map((path) => (prefix !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path))
    .filter((path) => path !== '')
    .sort();
}

/** Whether (and how) git can speak for this project, and which of `paths` are not committed. */
export function observeCommit(cwd: string, paths: readonly string[]): CommitObservation {
  const inside = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) {
    // A repository that git cannot read (broken gitdir, dubious ownership, no git at all) is not the
    // no-git case: claiming "nothing to commit" would hide it.
    if (repositoryMarker(cwd) !== undefined) {
      return {
        mode: 'unverifiable',
        head: null,
        dirty: [],
        ignored: [],
        nested: [],
        detail: inside.detail ?? 'git could not read the repository',
      };
    }
    // No repository anywhere above: the contract's no-git case, saved locally.
    return { mode: 'no-git', head: null, dirty: [], ignored: [], nested: [] };
  }

  const { outer, groups } = nestedGroups(cwd, paths);
  const headRun = runGit(cwd, ['rev-parse', 'HEAD']);
  const head = headRun.ok ? headRun.stdout.trim() : null;
  // status prints repository-relative paths; the caller works in project-relative ones, so the
  // prefix from the repository root to this directory comes off.
  const prefixRun = runGit(cwd, ['rev-parse', '--show-prefix']);
  const prefix = prefixRun.ok ? prefixRun.stdout.trim() : '';
  const toProject = (path: string): string =>
    prefix !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path;

  // A nested repository is part of the delivery: the project must record it (a committed gitlink),
  // or its content is in no commit this project makes.
  const roots = new Set(groups.map((group) => group.root));
  const ignoredRoots = new Set<string>();
  const dirty = new Set<string>();
  const ignored = new Set<string>();
  for (const [start, end] of blocks(0, outer.length, PATH_BATCH)) {
    const files = outer.slice(start, end);
    const status = runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...files]);
    if (!status.ok) {
      return {
        mode: 'unverifiable',
        head,
        dirty: [...dirty].sort(),
        ignored: [],
        nested: [],
        detail: status.detail ?? 'git status failed',
      };
    }
    for (const path of dirtyPaths(status.stdout)) dirty.add(toProject(path).replace(/\/+$/, ''));
    const inspect = files;
    if (inspect.length === 0) continue;
    // Ignored paths never reach status, so a delivery that matched a .gitignore rule would look
    // committed while no commit can contain it. -z needs --stdin, NUL-separated both ways.
    const check = runGit(cwd, ['check-ignore', '-z', '--stdin'], `${inspect.join('\0')}\0`);
    // Exit 1 is git's "none of these are ignored", not a failure.
    if (!check.ok && check.code !== 1) {
      return {
        mode: 'unverifiable',
        head,
        dirty: [...dirty].sort(),
        ignored: [],
        nested: [],
        detail: check.detail ?? 'git check-ignore failed',
      };
    }
    if (check.ok) {
      for (const path of check.stdout.split('\0').filter((entry) => entry !== '')) {
        const candidate = toProject(path).replace(/\/+$/, '');
        if (roots.has(candidate)) {
          ignoredRoots.add(candidate);
          continue;
        }
        // An ignored path that no longer exists cannot be committed anywhere; the delivery digest
        // rejects that case, and suggesting `git add -f` for it would be useless.
        if (existsSync(join(cwd, candidate))) ignored.add(candidate);
      }
    }
  }

  for (const [start, end] of blocks(0, roots.size, PATH_BATCH)) {
    const batch = [...roots].slice(start, end);
    const check = runGit(cwd, ['check-ignore', '-z', '--stdin'], `${batch.join('\0')}\0`);
    if (!check.ok && check.code !== 1) {
      return {
        mode: 'unverifiable',
        head,
        dirty: [...dirty].sort(),
        ignored: [...ignored].sort(),
        nested: [],
        detail: check.detail ?? 'git check-ignore failed',
      };
    }
    if (check.ok) {
      for (const path of check.stdout.split('\0').filter((entry) => entry !== '')) {
        ignoredRoots.add(toProject(path).replace(/\/+$/, ''));
      }
    }
  }

  const nested: CommitObservation['nested'] = groups.map((group) => {
    const observation = observeCommit(
      join(cwd, group.root),
      group.paths.map((path) => relative(group.root, path)),
    );
    // The pointer this repository's HEAD carries for the nested repository. It is recorded when it
    // exists and names the commit the nested repository is actually at - a dirty worktree inside the
    // nested repository is that repository's own fact, not a missing pointer.
    const committed = runGit(cwd, ['rev-parse', `HEAD:${group.root}`]);
    const recorded =
      committed.ok && observation.head !== null && committed.stdout.trim() === observation.head;
    return {
      root: group.root,
      state: ignoredRoots.has(group.root) ? 'ignored' : recorded ? 'recorded' : 'unrecorded',
      observation,
    };
  });

  return {
    mode: 'git',
    head,
    dirty: [...dirty].sort(),
    ignored: [...ignored].sort(),
    nested,
  };
}

/** Up to four paths, then a count: enough to act on without a wall of filenames. */
function summarize(paths: readonly string[]): string {
  const shown = paths.slice(0, 4).join(', ');
  return paths.length > 4 ? `${shown} and ${paths.length - 4} more` : shown;
}

/**
 * The completion facts for an observation: empty when the delivery is committed (or there is no
 * repository to commit to). One sentence per distinct problem, so a caller can act on each.
 */
export function commitGaps(observation: CommitObservation, inside?: string): readonly string[] {
  const prefix = inside === undefined ? '' : `inside nested repository ${inside}: `;
  if (observation.mode === 'no-git') {
    return inside === undefined
      ? []
      : [`${prefix}it is not a git repository, so the reviewed delivery there can never be committed`];
  }
  if (observation.mode === 'unverifiable') {
    return [
      `${prefix}the delivery could not be checked against git (${observation.detail ?? 'unknown error'}); restore git, commit the delivery, then end again`,
    ];
  }
  const gaps: string[] = [];
  if (observation.ignored.length > 0) {
    gaps.push(
      `${prefix}the reviewed delivery contains ${observation.ignored.length} ignored file(s) that this repository's commits cannot contain (${summarize(observation.ignored)}); keep them out of the delivery, or commit them deliberately with \`git add -f -- <paths>\` if the ignore rule is wrong`,
    );
  }
  if (observation.dirty.length > 0) {
    gaps.push(
      `${prefix}the reviewed delivery is not committed: ${observation.dirty.length} file(s) with uncommitted changes (${summarize(observation.dirty)}); stage them (\`git add -- <paths>\`), commit, then end again`,
    );
  }
  for (const entry of observation.nested) {
    const label = inside === undefined ? entry.root : `${inside}/${entry.root}`;
    if (entry.state === 'ignored') {
      gaps.push(
        `the nested repository ${label} is excluded by a .gitignore rule of the repository it sits in, so no commit there can carry what was reviewed; remove that rule or keep the nested delivery out of the delivery`,
      );
    } else if (entry.state === 'unrecorded') {
      gaps.push(
        `the nested repository ${label} is not recorded as committed in this project (its commit points at nothing, or at a different commit than the one it is at, so the project's commit does not carry what was reviewed); commit inside it if it has changes of its own, then record it here (\`git add -- ${entry.root}\`), and end again`,
      );
    }
    gaps.push(...commitGaps(entry.observation, label));
  }
  return gaps;
}
