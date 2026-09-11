/**
 * Project identity: which repository a request belongs to.
 *
 * `ARCHITECTURE.md` §4: "规范化realpath并识别git rev-parse --show-toplevel；同一Git
 * 根只打开一个ProjectRuntime。projectId=SHA256(canonicalRoot)前32hex… 子目录打开归一
 * 为仓库根；嵌套独立仓库必须单独打开，父项目文件读写排除其路径。"
 */
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { projectIdFromRoot } from '@agentdev/storage';

export interface ProjectIdentity {
  /** Canonical absolute repository root: the git toplevel when there is one. */
  readonly canonicalRoot: string;
  /** `git rev-parse --show-toplevel`, when the root is inside a repository. */
  readonly gitRoot?: string;
  /** `SHA256(canonicalRoot)[0:32]`. */
  readonly projectId: string;
  /** Nested independent repositories under this root, absolute and canonical. */
  readonly nestedRepos: readonly string[];
  /** Whether the given path was normalized up to a repository root. */
  readonly normalizedFromSubdirectory: boolean;
}

export interface ResolveIdentityOptions {
  /** Directory walk used to find nested repositories; defaults to a bounded scan. */
  readonly scanNestedRepos?: boolean;
  /** Maximum directory depth scanned for nested repositories. */
  readonly maxScanDepth?: number;
}

const DEFAULT_MAX_SCAN_DEPTH = 3;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.venv']);

/**
 * Canonicalises a path with `realpath`, which also resolves symlinks, so two
 * spellings of the same directory produce one project id.
 */
export function canonicalPath(path: string): string {
  return realpathSync.native(resolve(path));
}

/**
 * Resolves a git repository root by walking up for a `.git` entry.
 *
 * Git itself is not required: a `.git` directory or file marks the root, exactly
 * as `git rev-parse --show-toplevel` would report it.
 */
export function findGitRoot(path: string): string | undefined {
  let current = canonicalPath(path);
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Directories that carry their own `.git`, i.e. nested independent repositories. */
export function findNestedRepos(root: string, options: { maxDepth?: number } = {}): string[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_SCAN_DEPTH;
  const found: string[] = [];
  const walk = (directory: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry);
      if (!statSync(path).isDirectory()) continue;
      if (entry === '.git') continue;
      if (existsSync(join(path, '.git'))) {
        found.push(path);
        continue; // a nested repository owns its own tree
      }
      if (SKIP_DIRECTORIES.has(entry)) continue;
      walk(path, depth + 1);
    }
  };
  walk(canonicalPath(root), 1);
  return found.sort();
}

/**
 * Resolves the identity of the Project that owns `path`.
 *
 * A subdirectory inside a repository normalizes to the repository root, so opening
 * `repo/src/deep` and `repo` yield the same project id (AC-024).
 */
export function resolveProjectIdentity(
  path: string,
  options: ResolveIdentityOptions = {},
): ProjectIdentity {
  const requested = canonicalPath(path);
  const gitRoot = findGitRoot(requested);
  const canonicalRoot = gitRoot ?? requested;
  const identity: ProjectIdentity = {
    canonicalRoot,
    ...(gitRoot === undefined ? {} : { gitRoot }),
    projectId: projectIdFromRoot(canonicalRoot),
    nestedRepos:
      options.scanNestedRepos === false
        ? []
        : findNestedRepos(canonicalRoot, {
            ...(options.maxScanDepth === undefined ? {} : { maxDepth: options.maxScanDepth }),
          }),
    normalizedFromSubdirectory: canonicalRoot !== requested,
  };
  return identity;
}

/** Two roots belong to the same Project only when their project ids match. */
export function isSameProject(left: ProjectIdentity, right: ProjectIdentity): boolean {
  return left.projectId === right.projectId;
}

/**
 * Whether `path` sits inside a nested repository that the parent must not touch.
 *
 * "父项目文件读写排除其路径" — the parent Project excludes those trees, and the
 * nested repository has to be opened as its own Project.
 */
export function isInsideNestedRepo(identity: ProjectIdentity, path: string): boolean {
  const absolute = resolve(identity.canonicalRoot, path);
  return identity.nestedRepos.some(
    (nested) => absolute === nested || absolute.startsWith(`${nested}${sep}`),
  );
}

/**
 * Repository-relative prefixes of every nested repository, for scope building.
 *
 * A read or write scope built for the parent Project subtracts these paths.
 */
export function nestedRepoExclusions(identity: ProjectIdentity): string[] {
  return identity.nestedRepos.map((nested) =>
    relative(identity.canonicalRoot, nested).split(sep).join('/'),
  );
}

/**
 * A nested repository must be opened on its own, so its identity differs from the
 * parent's; the parent may not serve requests for it.
 */
export function requireOwnIdentity(
  parent: ProjectIdentity,
  path: string,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'NESTED_REPO'; readonly nestedRoot: string } {
  if (!isInsideNestedRepo(parent, path)) return { ok: true };
  const absolute = resolve(parent.canonicalRoot, path);
  const nestedRoot = parent.nestedRepos
    .filter((nested) => absolute === nested || absolute.startsWith(`${nested}${sep}`))
    .sort((left, right) => right.length - left.length)[0] as string;
  return { ok: false, code: 'NESTED_REPO', nestedRoot };
}
