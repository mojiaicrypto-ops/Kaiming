/**
 * Git port for workspace discovery and initialization
 * (`docs/architecture/ARCHITECTURE.md` §4, `docs/product/knowledge.md` §4/§5).
 *
 * Every Git call goes through a Port so the path/repository rules of this package
 * can be exercised without running Git, while `NodeGitPort` is the real
 * implementation used in production. `NodeGitPort` builds an explicit argument
 * vector and never goes through a shell (`shell: false`), so a path or branch name
 * can never be re-interpreted as a command.
 *
 * Failure policy: a probe answer that is legitimately "no" (not a repository,
 * unborn HEAD, detached HEAD) is a successful call with `null`/`false`, while a
 * call that could not be answered at all is an explicit `{ok:false, errors}`.
 * Nothing is swallowed: a caller that must not guess (dirty-workspace and
 * revision checks) gets `ok:false` instead of a clean-looking empty result.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import type { ErrorCode, JsonObject } from '@agentdev/contracts';

/** Lowercase SHA256 over UTF-8 text or raw bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** `true` when the error is a "the path does not exist" family error. */
export function isMissingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

/** A structured failure entry shared by every workspace API. */
export interface WorkspaceDiagnostic {
  readonly code: ErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly command?: readonly string[];
  readonly status?: number | null;
  readonly stderr?: string;
}

/** Error carrying one of the protocol `ERROR_CODES`. */
export class WorkspaceError extends Error {
  readonly code: ErrorCode;
  readonly details: JsonObject | null;

  constructor(
    code: ErrorCode,
    message: string,
    options: { readonly details?: JsonObject; readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.details = options.details ?? null;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Canonical realpath, or `null` when the path (or a symlink target) does not
 * exist. Other filesystem failures are reported rather than treated as missing.
 */
export function canonicalPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw new WorkspaceError('INTERNAL_ERROR', `无法解析路径 realpath：${path}`, { cause: error });
  }
}

/** One `git status --porcelain=v1` line split into its state and path(s). */
export interface PorcelainEntry {
  /** The two-letter XY state as Git printed it. */
  readonly state: string;
  /** Post-image path first for a rename; both sides are returned. */
  readonly paths: readonly string[];
}

/** Removes Git's quoting and the usual escapes from one porcelain path token. */
function unquotePath(token: string): string {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) return token;
  return token
    .slice(1, -1)
    .replace(/\\"/gu, '"')
    .replace(/\\\\/gu, '\\')
    .replace(/\\t/gu, '\t')
    .replace(/\\n/gu, '\n');
}

/**
 * Parses one porcelain v1 line. A rename (`R  old -> new`) returns both paths;
 * the caller hashes whichever side exists on disk.
 */
export function parsePorcelainLine(line: string): PorcelainEntry {
  const state = line.slice(0, 2);
  const rest = line.slice(2).trimStart();
  const paths = rest
    .split(' -> ')
    .map((token) => unquotePath(token.trim()))
    .filter((token) => token !== '');
  return { state, paths };
}

export interface GitCommandOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface GitCommandOutcome {
  readonly ok: boolean;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError: string | null;
}

/** Runs `git <args>` with an explicit argument vector and no shell. */
export function runGit(args: readonly string[], options: GitCommandOptions): GitCommandOutcome {
  const result = spawnSync('git', [...args], {
    cwd: options.cwd,
    shell: false,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 64 * 1024 * 1024,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    spawnError: result.error === undefined ? null : result.error.message,
  };
}

export interface GitSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface GitFailure {
  readonly ok: false;
  readonly errors: readonly WorkspaceDiagnostic[];
}

/** Result of a Git call whose answer may legitimately be "no". */
export type GitResult<T> = GitSuccess<T> | GitFailure;

export interface GitInitOptions {
  /** Branch the initialized repository starts on. */
  readonly branch: string;
}

export interface GitInitValue {
  readonly root: string;
  readonly branch: string;
  readonly created: boolean;
}

export interface GitCommitOptions {
  /** Commit message; an empty message is refused. */
  readonly message: string;
  /** Repo-relative paths to commit; empty means an `--allow-empty` commit. */
  readonly paths: readonly string[];
}

export interface GitCommitValue {
  /** Full OID of the created commit. */
  readonly revision: string;
}

/**
 * Git operations the workspace package needs.
 *
 * `isRepository` is a convenience over `resolveRoot`; every other method reports
 * failures explicitly so a broken Git can never masquerade as "not a repository"
 * or "clean workspace".
 */
export interface GitPort {
  isRepository(path: string): boolean;
  /** `git rev-parse --show-toplevel`; `null` when `path` is not in a work tree. */
  resolveRoot(path: string): GitResult<string | null>;
  /** Full OID of HEAD; `null` on an unborn branch. */
  headRevision(path: string): GitResult<string | null>;
  /** Raw `git status --porcelain=v1 --untracked-files=all` lines. */
  statusPorcelain(path: string): GitResult<readonly string[]>;
  initRepository(path: string, options: GitInitOptions): GitResult<GitInitValue>;
  /** Current branch name (`git symbolic-ref --short HEAD`); `null` when detached. */
  branchName(path: string): GitResult<string | null>;
  commit(path: string, options: GitCommitOptions): GitResult<GitCommitValue>;
  /** Repo-relative tracked file paths (`git ls-files`). */
  trackedFiles(path: string): GitResult<readonly string[]>;
}

const NOT_A_REPOSITORY = /not a git repository/iu;
const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** Deterministic identity for automated commits when the repo configures none. */
const GIT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'AgentDev',
  GIT_AUTHOR_EMAIL: 'agentdev@localhost',
  GIT_COMMITTER_NAME: 'AgentDev',
  GIT_COMMITTER_EMAIL: 'agentdev@localhost',
};

function gitFailure(
  code: ErrorCode,
  message: string,
  args: readonly string[],
  outcome: GitCommandOutcome,
  cwd: string,
): GitFailure {
  const detail = outcome.stderr.trim() === '' ? outcome.spawnError : outcome.stderr.trim();
  return {
    ok: false,
    errors: [
      {
        code,
        message: detail === null || detail === '' ? message : `${message}：${detail}`,
        path: cwd,
        command: args,
        status: outcome.status,
        stderr: outcome.stderr,
      },
    ],
  };
}

/** Real Git implementation backed by `node:child_process.spawnSync`. */
export class NodeGitPort implements GitPort {
  private readonly timeoutMs: number;

  constructor(options: { readonly timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private run(
    cwd: string,
    args: readonly string[],
    env?: Readonly<Record<string, string>>,
  ): GitCommandOutcome {
    return runGit(args, {
      cwd,
      timeoutMs: this.timeoutMs,
      ...(env === undefined ? {} : { env }),
    });
  }

  /** Canonical working directory, or an explicit failure for a missing path. */
  private cwdOf(path: string): GitResult<string> {
    const canonical = canonicalPath(path);
    if (canonical === null) {
      return { ok: false, errors: [{ code: 'NOT_FOUND', message: `路径不存在：${path}`, path }] };
    }
    return { ok: true, value: canonical };
  }

  isRepository(path: string): boolean {
    const resolved = this.resolveRoot(path);
    return resolved.ok && resolved.value !== null;
  }

  resolveRoot(path: string): GitResult<string | null> {
    const cwd = this.cwdOf(path);
    if (!cwd.ok) return cwd;
    const args = ['rev-parse', '--show-toplevel'];
    const outcome = this.run(cwd.value, args);
    if (outcome.ok) {
      const value = outcome.stdout.trim();
      if (value === '') return { ok: true, value: null };
      return { ok: true, value: canonicalPath(value) ?? value };
    }
    if (NOT_A_REPOSITORY.test(outcome.stderr)) return { ok: true, value: null };
    return gitFailure(
      'INTERNAL_ERROR',
      'git rev-parse --show-toplevel 失败',
      args,
      outcome,
      cwd.value,
    );
  }

  headRevision(path: string): GitResult<string | null> {
    const cwd = this.cwdOf(path);
    if (!cwd.ok) return cwd;
    const args = ['rev-parse', '--verify', '--quiet', 'HEAD'];
    const outcome = this.run(cwd.value, args);
    if (outcome.ok) {
      const value = outcome.stdout.trim();
      return { ok: true, value: FULL_OID.test(value) ? value : null };
    }
    if (outcome.status === 1 && outcome.stderr.trim() === '') return { ok: true, value: null };
    if (NOT_A_REPOSITORY.test(outcome.stderr)) return { ok: true, value: null };
    return gitFailure('INTERNAL_ERROR', 'git rev-parse HEAD 失败', args, outcome, cwd.value);
  }

  statusPorcelain(path: string): GitResult<readonly string[]> {
    const cwd = this.cwdOf(path);
    if (!cwd.ok) return cwd;
    const args = ['status', '--porcelain=v1', '--untracked-files=all'];
    const outcome = this.run(cwd.value, args);
    if (!outcome.ok) {
      if (NOT_A_REPOSITORY.test(outcome.stderr)) {
        return {
          ok: false,
          errors: [{ code: 'NOT_FOUND', message: `不是 Git 仓库：${cwd.value}`, path: cwd.value }],
        };
      }
      return gitFailure('INTERNAL_ERROR', 'git status 失败', args, outcome, cwd.value);
    }
    return {
      ok: true,
      value: outcome.stdout
        .split('\n')
        .map((line) => line.replace(/\r$/u, ''))
        .filter((line) => line.trim() !== ''),
    };
  }

  initRepository(path: string, options: GitInitOptions): GitResult<GitInitValue> {
    const cwd = this.cwdOf(path);
    if (!cwd.ok) return cwd;
    if (options.branch.trim() === '') {
      return {
        ok: false,
        errors: [{ code: 'VALIDATION_ERROR', message: 'initialization branch must not be empty' }],
      };
    }
    const stats = statSync(cwd.value);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        errors: [{ code: 'NOT_FOUND', message: `不是目录：${cwd.value}`, path: cwd.value }],
      };
    }
    const probe = this.resolveRoot(cwd.value);
    if (!probe.ok) return probe;
    if (probe.value !== null && probe.value === cwd.value) {
      return {
        ok: false,
        errors: [
          {
            code: 'INVALID_STATE',
            message: `目录已是 Git 仓库，无需初始化：${probe.value}`,
            path: cwd.value,
          },
        ],
      };
    }
    // Inside a parent repository this creates an independent nested repository,
    // which `ARCHITECTURE.md` §4 requires to be opened separately.
    const args = ['init', '-b', options.branch];
    const outcome = this.run(cwd.value, args);
    if (!outcome.ok) {
      return gitFailure('INTERNAL_ERROR', 'git init 失败', args, outcome, cwd.value);
    }
    return { ok: true, value: { root: cwd.value, branch: options.branch, created: true } };
  }

  branchName(path: string): GitResult<string | null> {
    const cwd = this.cwdOf(path);
    if (!cwd.ok) return cwd;
    const args = ['symbolic-ref', '--short', '-q', 'HEAD'];
    const outcome = this.run(cwd.value, args);
    if (outcome.ok) {
      const value = outcome.stdout.trim();
      return { ok: true, value: value === '' ? null : value };
    }
    if (outcome.status === 1 && outcome.stderr.trim() === '') return { ok: true, value: null };
    if (NOT_A_REPOSITORY.test(outcome.stderr)) {
      return {
        ok: false,
        errors: [{ code: 'NOT_FOUND', message: `不是 Git 仓库：${cwd.value}`, path: cwd.value }],
      };
    }
    return gitFailure('INTERNAL_ERROR', 'git symbolic-ref 失败', args, outcome, cwd.value);
  }

  commit(path: string, options: GitCommitOptions): GitResult<GitCommitValue> {
    if (options.message.trim() === '') {
      return {
        ok: false,
        errors: [{ code: 'VALIDATION_ERROR', message: 'commit message must not be empty' }],
      };
    }
    const cwd = this.cwdOf(path);
    if (!cwd.ok) return cwd;
    if (options.paths.length > 0) {
      const addArgs = ['add', '--', ...options.paths];
      const add = this.run(cwd.value, addArgs);
      if (!add.ok) return gitFailure('INTERNAL_ERROR', 'git add 失败', addArgs, add, cwd.value);
    }
    const args =
      options.paths.length === 0
        ? ['commit', '--allow-empty', '-m', options.message]
        : ['commit', '-m', options.message, '--', ...options.paths];
    const outcome = this.run(cwd.value, args, this.identityEnv(cwd.value));
    if (!outcome.ok)
      return gitFailure('INTERNAL_ERROR', 'git commit 失败', args, outcome, cwd.value);
    const head = this.run(cwd.value, ['rev-parse', 'HEAD']);
    if (!head.ok) {
      return gitFailure(
        'INTERNAL_ERROR',
        'git rev-parse HEAD 失败',
        ['rev-parse', 'HEAD'],
        head,
        cwd.value,
      );
    }
    const revision = head.stdout.trim();
    if (!FULL_OID.test(revision)) {
      return {
        ok: false,
        errors: [
          {
            code: 'INTERNAL_ERROR',
            message: `git rev-parse HEAD 返回了非法 OID：${revision}`,
            path: cwd.value,
          },
        ],
      };
    }
    return { ok: true, value: { revision } };
  }

  trackedFiles(path: string): GitResult<readonly string[]> {
    const cwd = this.cwdOf(path);
    if (!cwd.ok) return cwd;
    const args = ['ls-files', '-z'];
    const outcome = this.run(cwd.value, args);
    if (!outcome.ok) {
      if (NOT_A_REPOSITORY.test(outcome.stderr)) {
        return {
          ok: false,
          errors: [{ code: 'NOT_FOUND', message: `不是 Git 仓库：${cwd.value}`, path: cwd.value }],
        };
      }
      return gitFailure('INTERNAL_ERROR', 'git ls-files 失败', args, outcome, cwd.value);
    }
    return {
      ok: true,
      value: outcome.stdout.split('\0').filter((entry) => entry !== ''),
    };
  }

  /** Adds a deterministic author identity only when the repository configures none. */
  private identityEnv(cwd: string): Readonly<Record<string, string>> {
    const configured = this.run(cwd, ['config', '--get', 'user.email']);
    if (configured.ok && configured.stdout.trim() !== '') return {};
    return GIT_IDENTITY;
  }
}

export interface MemoryGitCommit {
  readonly message: string;
  readonly paths: readonly string[];
  readonly revision: string;
}

export interface MemoryGitRepositoryState {
  readonly root: string;
  readonly branch: string;
  readonly head: string | null;
  readonly status: readonly string[];
  readonly tracked: readonly string[];
  readonly commits: readonly MemoryGitCommit[];
}

export interface MemoryGitRepositorySeed {
  readonly root: string;
  readonly branch?: string;
  readonly head?: string | null;
  readonly status?: readonly string[];
  readonly tracked?: readonly string[];
}

export interface MemoryGitPortOptions {
  readonly repositories?: readonly MemoryGitRepositorySeed[];
}

/** `GitPort` plus the mutators tests and in-memory callers need. */
export interface MemoryGitPort extends GitPort {
  /** Replaces the porcelain lines of the repository containing `path`. */
  setStatus(path: string, lines: readonly string[]): void;
  /** Sets HEAD of the repository containing `path`. */
  setHead(path: string, revision: string | null): void;
  /** Replaces the tracked-file list of the repository containing `path`. */
  setTracked(path: string, paths: readonly string[]): void;
  /** Sets the branch of the repository containing `path`. */
  setBranch(path: string, branch: string): void;
  /** The repository containing `path`, or `null`. */
  state(path: string): MemoryGitRepositoryState | null;
  /** Every known repository, in registration order. */
  repositories(): readonly MemoryGitRepositoryState[];
}

interface MutableRepository {
  root: string;
  branch: string;
  head: string | null;
  status: string[];
  tracked: string[];
  commits: MemoryGitCommit[];
}

function stripTrailingSeparator(path: string): string {
  return path.length > 1 && path.endsWith(sep) ? path.slice(0, -1) : path;
}

/**
 * Normalizes a path for repository lookup.
 *
 * A path that does not exist yet still has to compare equal to its repository, so
 * the nearest existing ancestor is canonicalized and the remaining segments are
 * appended (`/var/…` and `/private/var/…` must not look like different roots).
 */
function normalizeRoot(path: string): string {
  const canonical = canonicalPath(path);
  if (canonical !== null) return stripTrailingSeparator(canonical);
  const suffix: string[] = [];
  let current = path;
  for (;;) {
    const parent = dirname(current);
    if (parent === current) return stripTrailingSeparator(path);
    suffix.unshift(basename(current));
    const canonicalParent = canonicalPath(parent);
    if (canonicalParent !== null) {
      return stripTrailingSeparator(join(canonicalParent, ...suffix));
    }
    current = parent;
  }
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * In-memory `GitPort` for tests and for callers that own no real repository.
 *
 * Revisions are deterministic (`sha256(root, message, sequence)` truncated to a
 * 40-hex OID) so a test can assert recovery decisions without depending on a Git
 * installation. Committing paths also clears their porcelain entries and adds them
 * to the tracked list, which keeps the dirty-workspace flows realistic.
 */
export function createMemoryGitPort(options: MemoryGitPortOptions = {}): MemoryGitPort {
  const repositories = new Map<string, MutableRepository>();
  for (const seed of options.repositories ?? []) {
    const root = normalizeRoot(seed.root);
    repositories.set(root, {
      root,
      branch: seed.branch ?? 'main',
      head: seed.head ?? null,
      status: [...(seed.status ?? [])],
      tracked: [...(seed.tracked ?? [])],
      commits: [],
    });
  }

  const find = (path: string): MutableRepository | null => {
    const target = normalizeRoot(path);
    let best: MutableRepository | null = null;
    for (const repository of repositories.values()) {
      if (
        isInside(repository.root, target) &&
        (best === null || repository.root.length > best.root.length)
      ) {
        best = repository;
      }
    }
    return best;
  };

  const notFound = (path: string): GitFailure => ({
    ok: false,
    errors: [{ code: 'NOT_FOUND', message: `不是 Git 仓库：${path}`, path }],
  });

  const snapshot = (repository: MutableRepository): MemoryGitRepositoryState => ({
    root: repository.root,
    branch: repository.branch,
    head: repository.head,
    status: [...repository.status],
    tracked: [...repository.tracked],
    commits: repository.commits.map((commit) => ({ ...commit, paths: [...commit.paths] })),
  });

  return {
    isRepository(path) {
      return find(path) !== null;
    },
    resolveRoot(path) {
      const repository = find(path);
      return { ok: true, value: repository === null ? null : repository.root };
    },
    headRevision(path) {
      const repository = find(path);
      if (repository === null) return notFound(path);
      return { ok: true, value: repository.head };
    },
    statusPorcelain(path) {
      const repository = find(path);
      if (repository === null) return notFound(path);
      return { ok: true, value: [...repository.status] };
    },
    initRepository(path, init) {
      const root = normalizeRoot(path);
      if (init.branch.trim() === '') {
        return {
          ok: false,
          errors: [
            { code: 'VALIDATION_ERROR', message: 'initialization branch must not be empty' },
          ],
        };
      }
      if (repositories.has(root)) {
        return {
          ok: false,
          errors: [
            {
              code: 'INVALID_STATE',
              message: `目录已是 Git 仓库，无需初始化：${root}`,
              path: root,
            },
          ],
        };
      }
      repositories.set(root, {
        root,
        branch: init.branch,
        head: null,
        status: [],
        tracked: [],
        commits: [],
      });
      return { ok: true, value: { root, branch: init.branch, created: true } };
    },
    branchName(path) {
      const repository = find(path);
      if (repository === null) return notFound(path);
      return { ok: true, value: repository.branch };
    },
    commit(path, commit) {
      if (commit.message.trim() === '') {
        return {
          ok: false,
          errors: [{ code: 'VALIDATION_ERROR', message: 'commit message must not be empty' }],
        };
      }
      const repository = find(path);
      if (repository === null) return notFound(path);
      const sequence = repository.commits.length + 1;
      const revision = sha256Hex(`${repository.root}\0${commit.message}\0${sequence}`).slice(0, 40);
      repository.head = revision;
      repository.commits.push({ message: commit.message, paths: [...commit.paths], revision });
      if (commit.paths.length > 0) {
        repository.tracked = [...new Set([...repository.tracked, ...commit.paths])];
        const committed = new Set(commit.paths);
        repository.status = repository.status.filter(
          (line) => !parsePorcelainLine(line).paths.some((entry) => committed.has(entry)),
        );
      }
      return { ok: true, value: { revision } };
    },
    trackedFiles(path) {
      const repository = find(path);
      if (repository === null) return notFound(path);
      return { ok: true, value: [...repository.tracked] };
    },
    setStatus(path, lines) {
      const repository = find(path);
      if (repository === null) throw new WorkspaceError('NOT_FOUND', `不是 Git 仓库：${path}`);
      repository.status = [...lines];
    },
    setHead(path, revision) {
      const repository = find(path);
      if (repository === null) throw new WorkspaceError('NOT_FOUND', `不是 Git 仓库：${path}`);
      repository.head = revision;
    },
    setTracked(path, paths) {
      const repository = find(path);
      if (repository === null) throw new WorkspaceError('NOT_FOUND', `不是 Git 仓库：${path}`);
      repository.tracked = [...paths];
    },
    setBranch(path, branch) {
      const repository = find(path);
      if (repository === null) throw new WorkspaceError('NOT_FOUND', `不是 Git 仓库：${path}`);
      repository.branch = branch;
    },
    state(path) {
      const repository = find(path);
      return repository === null ? null : snapshot(repository);
    },
    repositories() {
      return [...repositories.values()].map(snapshot);
    },
  };
}
