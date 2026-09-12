/**
 * Per-Task Git worktrees with writer ownership (`docs/architecture/reliability.md`
 * §4, §2; AC-062/AC-081).
 *
 * `reliability.md` §4 requires every dependency-free Task to work in an external
 * worktree created from its base revision, and §2 requires that "旧进程未确认终止时
 * 不把工作区授予新写者" — a worktree has exactly one writer. This module owns both
 * halves:
 *
 * - `WorktreeManager` creates and removes the real Git worktree behind
 *   `WorktreeGitPort`, the extension of the existing `GitPort` seam that adds the
 *   `git worktree` / `update-ref` / `merge-base` / `cherry-pick` calls this package
 *   needs. `NodeWorktreeGitPort` is the real implementation (explicit argument
 *   vector, no shell, the repository's deterministic commit identity).
 * - Every worktree is covered by a **lease record**. A second runner asking for the
 *   same worktree is refused with the current holder, so two runners can never own
 *   one worktree. Creation rolls the lease back when `git worktree add` fails, so a
 *   failed create leaves neither a half-owned worktree nor a dangling lease.
 * - Removing a worktree that still has uncommitted work is refused with the exact
 *   dirty paths, because that content exists nowhere else. Only an explicit
 *   `discard: true` (the user's documented handling) removes it.
 *
 * The lease seam is a Port (`WorktreeLeaseStore`): the daemon backs it with the
 * `lease` table (`data.md` §2), tests can use the in-memory store.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JsonObject } from '@agentdev/contracts';
import {
  NodeGitPort,
  WorkspaceError,
  canonicalPath,
  parsePorcelainLine,
  runGit,
  type GitCommandOutcome,
  type GitPort,
  type GitResult,
  type WorkspaceDiagnostic,
} from './git-port.js';

/** Full Git OID: sha1 (40) or sha256 (64) repositories. */
const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeListing {
  /** Absolute canonical path of the linked worktree. */
  readonly path: string;
  /** Full OID of the checked-out commit. */
  readonly head: string | null;
  /** Branch ref (`refs/heads/...`) or `null` when detached. */
  readonly branchRef: string | null;
  readonly detached: boolean;
  readonly bare: boolean;
}

export interface AddWorktreeRequest {
  /** Repository the worktree is linked to. */
  readonly repoRoot: string;
  /** Absolute path the worktree is created at. */
  readonly path: string;
  /**
   * Commit the worktree is created from. `null` checks out the repository's
   * current HEAD (used while the delivery branch is still unborn).
   */
  readonly baseRevision: string | null;
  /** New branch created for this worktree. */
  readonly branch?: string;
}

export interface UpdateRefRequest {
  /** Repository the ref lives in. */
  readonly repoRoot: string;
  /** Full ref name, e.g. `refs/heads/agentdev/main`. */
  readonly ref: string;
  readonly newRevision: string;
  /**
   * The only old value this update may observe. Compare-and-swap is the whole
   * point of this call, so it is required: `null` means "the ref must not exist".
   */
  readonly expectedOldRevision: string | null;
}

/** The Git operations worktree management and CAS integration need. */
export interface WorktreeGitPort extends GitPort {
  /** `git rev-parse --verify <rev>^{commit}`; `null` when the revision is unknown. */
  resolveRevision(repoRoot: string, revision: string): GitResult<string | null>;
  /** `git rev-parse <rev>^{tree}`; `null` when the revision is unknown. */
  mergeTree(repoRoot: string, revision: string): GitResult<string | null>;
  /** `git worktree add` into `path`. */
  addWorktree(request: AddWorktreeRequest): GitResult<WorktreeListing>;
  /** `git worktree list --porcelain`. */
  listWorktrees(repoRoot: string): GitResult<readonly WorktreeListing[]>;
  /** `git worktree remove [--force]`. */
  removeWorktree(repoRoot: string, path: string, force: boolean): GitResult<null>;
  /** `git update-ref <ref> <new> <expected>`; never a force update. */
  updateRef(request: UpdateRefRequest): GitResult<null>;
  /** `git merge-base <a> <b>`; `null` when the histories are unrelated. */
  mergeBase(repoRoot: string, a: string, b: string): GitResult<string | null>;
  /** `git merge-base --is-ancestor <ancestor> <descendant>`. */
  isAncestor(repoRoot: string, ancestor: string, descendant: string): GitResult<boolean>;
  /** Commits already-staged/relevant paths; repo-relative paths scope the commit. */
  commitPaths(
    repoRoot: string,
    message: string,
    paths: readonly string[],
  ): GitResult<{ readonly revision: string }>;
  /**
   * The Task's own commits still missing from `upstream` (`git cherry`), in order.
   *
   * Patch identity is what makes this safe: a commit whose change is already present
   * in the target is reported by Git as already applied and is never replayed
   * (`reliability.md` §4 "避免重复cherry-pick祖先"), even when the delivery branch
   * reached that change through a different commit.
   */
  cherry(repoRoot: string, upstream: string, head: string): GitResult<readonly string[]>;
  /** `git cherry-pick <revision>` on a clean worktree. */
  cherryPick(repoRoot: string, revision: string): GitResult<null>;
  /** `git cherry-pick --abort`, returning the worktree to its pre-pick state. */
  cherryPickAbort(repoRoot: string): GitResult<null>;
  /** `git cherry-pick --skip`, advancing past an already-applied (empty) pick. */
  cherryPickSkip(repoRoot: string): GitResult<null>;
  /** Paths present under `<revision>` (`git ls-tree -r -z --name-only`). */
  listTree(
    repoRoot: string,
    revision: string,
    paths: readonly string[],
  ): GitResult<readonly string[]>;
  /** `true` when `<revision>:<path>` exists (a blob, in practice). */
  pathAtRevision(repoRoot: string, revision: string, path: string): GitResult<boolean>;
}

/** Diagnostics as a JSON detail payload. */
export function gitDiagnostics(errors: readonly WorkspaceDiagnostic[]): JsonObject {
  return {
    errors: errors.map((error) => ({
      code: error.code,
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.command === undefined ? {} : { command: [...error.command] }),
      ...(error.status === undefined || error.status === null ? {} : { status: error.status }),
      ...(error.stderr === undefined ? {} : { stderr: error.stderr }),
    })),
  };
}

/** Builds one failure diagnostic from a raw Git outcome. */
function gitDiagnostic(
  repoRoot: string,
  args: readonly string[],
  outcome: GitCommandOutcome,
  message: string,
): WorkspaceDiagnostic {
  const detail = outcome.stderr.trim() === '' ? outcome.spawnError : outcome.stderr.trim();
  return {
    code: 'INTERNAL_ERROR',
    message: detail === null || detail === '' ? message : `${message}：${detail}`,
    path: repoRoot,
    command: args,
    status: outcome.status,
    stderr: outcome.stderr,
  };
}

function failure(diagnostic: WorkspaceDiagnostic): GitResult<never> {
  return { ok: false, errors: [diagnostic] };
}

/** Unwraps a `GitResult`, raising the typed `WorkspaceError` on failure. */
export function requireGit<T>(
  result: GitResult<T>,
  code: WorkspaceDiagnostic['code'],
  message: string,
): T {
  if (result.ok) return result.value;
  const first = result.errors[0];
  throw new WorkspaceError(code, first === undefined ? message : `${message}：${first.message}`, {
    details: gitDiagnostics(result.errors),
  });
}

/**
 * The repository's commit identity, added only when the repository configures none,
 * so an automated commit never fails on a missing `user.email`.
 */
export const WORKTREE_GIT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'AgentDev',
  GIT_AUTHOR_EMAIL: 'agentdev@localhost',
  GIT_COMMITTER_NAME: 'AgentDev',
  GIT_COMMITTER_EMAIL: 'agentdev@localhost',
};

/**
 * Real Git implementation, composed onto the existing `NodeGitPort` so discovery,
 * initialization and worktree calls share one Git seam.
 */
export class NodeWorktreeGitPort implements WorktreeGitPort {
  private readonly base: NodeGitPort;
  private readonly timeoutMs: number;

  constructor(options: { readonly timeoutMs?: number } = {}) {
    this.base = new NodeGitPort(options);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  isRepository(path: string): boolean {
    return this.base.isRepository(path);
  }

  resolveRoot(path: string): GitResult<string | null> {
    return this.base.resolveRoot(path);
  }

  headRevision(path: string): GitResult<string | null> {
    return this.base.headRevision(path);
  }

  statusPorcelain(path: string): GitResult<readonly string[]> {
    return this.base.statusPorcelain(path);
  }

  initRepository(
    path: string,
    options: { readonly branch: string },
  ): GitResult<{ readonly root: string; readonly branch: string; readonly created: boolean }> {
    return this.base.initRepository(path, options);
  }

  branchName(path: string): GitResult<string | null> {
    return this.base.branchName(path);
  }

  commit(
    path: string,
    options: { readonly message: string; readonly paths: readonly string[] },
  ): GitResult<{ readonly revision: string }> {
    return this.base.commit(path, options);
  }

  trackedFiles(path: string): GitResult<readonly string[]> {
    return this.base.trackedFiles(path);
  }

  resolveRevision(repoRoot: string, revision: string): GitResult<string | null> {
    const args = ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`];
    const outcome = this.spawn(repoRoot, args);
    if (outcome.ok) {
      const oid = outcome.stdout.trim();
      return { ok: true, value: FULL_OID.test(oid) ? oid : null };
    }
    if (outcome.status === 1 && outcome.stderr.trim() === '') return { ok: true, value: null };
    return failure(gitDiagnostic(repoRoot, args, outcome, 'git rev-parse 失败'));
  }

  mergeTree(repoRoot: string, revision: string): GitResult<string | null> {
    const args = ['rev-parse', '--verify', '--quiet', `${revision}^{tree}`];
    const outcome = this.spawn(repoRoot, args);
    if (outcome.ok) {
      const oid = outcome.stdout.trim();
      return { ok: true, value: FULL_OID.test(oid) ? oid : null };
    }
    if (outcome.status === 1 && outcome.stderr.trim() === '') return { ok: true, value: null };
    return failure(gitDiagnostic(repoRoot, args, outcome, 'git rev-parse 失败'));
  }

  addWorktree(request: AddWorktreeRequest): GitResult<WorktreeListing> {
    const args = ['worktree', 'add'];
    if (request.branch === undefined) args.push('--detach');
    else args.push('-b', request.branch);
    args.push(request.path);
    if (request.baseRevision !== null) args.push(request.baseRevision);
    const outcome = this.spawn(request.repoRoot, args, this.identityEnv(request.repoRoot));
    if (!outcome.ok) {
      return failure(gitDiagnostic(request.repoRoot, args, outcome, 'git worktree add 失败'));
    }
    const head = this.base.headRevision(request.path);
    if (!head.ok) return head;
    const branch = this.base.branchName(request.path);
    if (!branch.ok) return branch;
    return {
      ok: true,
      value: {
        path: canonicalPath(request.path) ?? request.path,
        head: head.value,
        branchRef: branch.value === null ? null : `refs/heads/${branch.value}`,
        detached: branch.value === null,
        bare: false,
      },
    };
  }

  listWorktrees(repoRoot: string): GitResult<readonly WorktreeListing[]> {
    const args = ['worktree', 'list', '--porcelain'];
    const outcome = this.spawn(repoRoot, args);
    if (!outcome.ok)
      return failure(gitDiagnostic(repoRoot, args, outcome, 'git worktree list 失败'));
    const entries: WorktreeListing[] = [];
    let entry: {
      path?: string;
      head?: string | null;
      branchRef?: string | null;
      detached?: boolean;
      bare?: boolean;
    } = {};
    const flush = (): void => {
      if (entry.path === undefined) {
        entry = {};
        return;
      }
      entries.push({
        path: canonicalPath(entry.path) ?? entry.path,
        head: entry.head ?? null,
        branchRef: entry.branchRef ?? null,
        detached: entry.detached === true,
        bare: entry.bare === true,
      });
      entry = {};
    };
    for (const rawLine of outcome.stdout.split('\n')) {
      const line = rawLine.replace(/\r$/u, '');
      if (line === '') {
        flush();
        continue;
      }
      const separator = line.indexOf(' ');
      const key = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? '' : line.slice(separator + 1);
      if (key === 'worktree') {
        flush();
        entry.path = value;
      } else if (key === 'HEAD') {
        entry.head = FULL_OID.test(value) ? value : null;
      } else if (key === 'branch') {
        entry.branchRef = value;
      } else if (key === 'detached') {
        entry.detached = true;
      } else if (key === 'bare') {
        entry.bare = true;
      }
    }
    flush();
    return { ok: true, value: entries };
  }

  removeWorktree(repoRoot: string, path: string, force: boolean): GitResult<null> {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(path);
    const outcome = this.spawn(repoRoot, args);
    if (!outcome.ok) {
      return failure(gitDiagnostic(repoRoot, args, outcome, 'git worktree remove 失败'));
    }
    return { ok: true, value: null };
  }

  updateRef(request: UpdateRefRequest): GitResult<null> {
    const args = ['update-ref', request.ref, request.newRevision];
    // A zero OID is Git's documented spelling of "the ref must not exist".
    args.push(request.expectedOldRevision ?? '0'.repeat(40));
    const outcome = this.spawn(request.repoRoot, args);
    if (!outcome.ok) {
      return failure(gitDiagnostic(request.repoRoot, args, outcome, 'git update-ref 失败'));
    }
    return { ok: true, value: null };
  }

  mergeBase(repoRoot: string, a: string, b: string): GitResult<string | null> {
    const args = ['merge-base', a, b];
    const outcome = this.spawn(repoRoot, args);
    if (outcome.ok) {
      const oid = outcome.stdout.trim();
      return { ok: true, value: FULL_OID.test(oid) ? oid : null };
    }
    // Exit 1 with no stderr is Git's "no common ancestor".
    if (outcome.status === 1 && outcome.stderr.trim() === '') return { ok: true, value: null };
    return failure(gitDiagnostic(repoRoot, args, outcome, 'git merge-base 失败'));
  }

  isAncestor(repoRoot: string, ancestor: string, descendant: string): GitResult<boolean> {
    const args = ['merge-base', '--is-ancestor', ancestor, descendant];
    const outcome = this.spawn(repoRoot, args);
    if (outcome.ok) return { ok: true, value: true };
    if (outcome.status === 1 && outcome.stderr.trim() === '') return { ok: true, value: false };
    return failure(gitDiagnostic(repoRoot, args, outcome, 'git merge-base --is-ancestor 失败'));
  }

  commitPaths(
    repoRoot: string,
    message: string,
    paths: readonly string[],
  ): GitResult<{ readonly revision: string }> {
    if (message.trim() === '') {
      return {
        ok: false,
        errors: [{ code: 'VALIDATION_ERROR', message: 'commit message must not be empty' }],
      };
    }
    if (paths.length > 0) {
      const args = ['add', '--', ...paths];
      const add = this.spawn(repoRoot, args);
      if (!add.ok) return failure(gitDiagnostic(repoRoot, args, add, 'git add 失败'));
    }
    const args =
      paths.length === 0
        ? ['commit', '--allow-empty', '-m', message]
        : ['commit', '-m', message, '--', ...paths];
    const outcome = this.spawn(repoRoot, args, this.identityEnv(repoRoot));
    if (!outcome.ok) return failure(gitDiagnostic(repoRoot, args, outcome, 'git commit 失败'));
    return this.headRevisionOrFail(repoRoot);
  }

  cherry(repoRoot: string, upstream: string, head: string): GitResult<readonly string[]> {
    const args = ['cherry', upstream, head];
    const outcome = this.spawn(repoRoot, args);
    if (!outcome.ok) return failure(gitDiagnostic(repoRoot, args, outcome, 'git cherry 失败'));
    return {
      ok: true,
      value: outcome.stdout
        .split('\n')
        .map((line) => line.replace(/\r$/u, '').trim())
        .filter((line) => line.startsWith('+ '))
        .map((line) => line.slice(2).trim())
        .filter((line) => FULL_OID.test(line)),
    };
  }

  cherryPick(repoRoot: string, revision: string): GitResult<null> {
    const args = ['cherry-pick', revision];
    const outcome = this.spawn(repoRoot, args, this.identityEnv(repoRoot));
    // A conflict is reported by the caller through `statusPorcelain`, so the raw
    // outcome is kept as the failure detail rather than collapsed into "internal".
    if (!outcome.ok) {
      return failure(gitDiagnostic(repoRoot, args, outcome, 'git cherry-pick 失败'));
    }
    return { ok: true, value: null };
  }

  cherryPickAbort(repoRoot: string): GitResult<null> {
    const args = ['cherry-pick', '--abort'];
    const outcome = this.spawn(repoRoot, args);
    if (!outcome.ok) {
      return failure(gitDiagnostic(repoRoot, args, outcome, 'git cherry-pick --abort 失败'));
    }
    return { ok: true, value: null };
  }

  cherryPickSkip(repoRoot: string): GitResult<null> {
    const args = ['cherry-pick', '--skip'];
    const outcome = this.spawn(repoRoot, args);
    if (!outcome.ok) {
      return failure(gitDiagnostic(repoRoot, args, outcome, 'git cherry-pick --skip 失败'));
    }
    return { ok: true, value: null };
  }

  listTree(
    repoRoot: string,
    revision: string,
    paths: readonly string[],
  ): GitResult<readonly string[]> {
    const args = ['ls-tree', '-r', '-z', '--name-only', revision];
    if (paths.length > 0) args.push('--', ...paths);
    const outcome = this.spawn(repoRoot, args);
    if (!outcome.ok) return failure(gitDiagnostic(repoRoot, args, outcome, 'git ls-tree 失败'));
    return { ok: true, value: outcome.stdout.split('\0').filter((entry) => entry !== '') };
  }

  pathAtRevision(repoRoot: string, revision: string, path: string): GitResult<boolean> {
    const args = ['cat-file', '-e', `${revision}:${path}`];
    const outcome = this.spawn(repoRoot, args);
    if (outcome.ok) return { ok: true, value: true };
    if (outcome.status === 128) return { ok: true, value: false };
    return failure(gitDiagnostic(repoRoot, args, outcome, 'git cat-file 失败'));
  }

  /** HEAD after a successful commit; a commit that produced no HEAD is fatal. */
  private headRevisionOrFail(repoRoot: string): GitResult<{ readonly revision: string }> {
    const head = this.base.headRevision(repoRoot);
    if (!head.ok) return head;
    if (head.value === null) {
      return {
        ok: false,
        errors: [{ code: 'INTERNAL_ERROR', message: '提交后仓库没有 HEAD', path: repoRoot }],
      };
    }
    return { ok: true, value: { revision: head.value } };
  }

  /** Adds a deterministic identity only when the repository configures none. */
  private identityEnv(repoRoot: string): Readonly<Record<string, string>> {
    const args = ['config', '--get', 'user.email'];
    const outcome = this.spawn(repoRoot, args);
    if (outcome.ok && outcome.stdout.trim() !== '') return {};
    return WORKTREE_GIT_IDENTITY;
  }

  private spawn(
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
}

export interface WorktreeLease {
  readonly worktreeId: string;
  /** The Task that owns the worktree; `null` for a resource-scoped lease. */
  readonly taskId: string | null;
  /** Attempt that holds the lease (`data.md` §2 `lease.ownerAttemptId`). */
  readonly ownerAttemptId: string;
  /** Monotonic fencing epoch; a stale epoch can never write. */
  readonly epoch: number;
  /** UTC ISO8601 milliseconds. */
  readonly expiresAt: string;
  readonly acquiredAt: string;
  /** Worktree path the lease covers. */
  readonly path: string;
}

export interface AcquireWorktreeLeaseRequest {
  readonly worktreeId: string;
  readonly taskId: string | null;
  readonly ownerAttemptId: string;
  readonly epoch: number;
  readonly path: string;
  readonly ttlMs: number;
  readonly at: string;
}

export type AcquireWorktreeLeaseResult =
  | {
      readonly acquired: true;
      readonly lease: WorktreeLease;
      /** `true` when an expired lease was replaced (`reliability.md` §2). */
      readonly replacedExpired: boolean;
      /** `true` when the same owner refreshed its own lease. */
      readonly renewed: boolean;
    }
  | { readonly acquired: false; readonly heldBy: WorktreeLease };

/** Persistence seam for worktree ownership. */
export interface WorktreeLeaseStore {
  find(worktreeId: string): WorktreeLease | null;
  acquire(request: AcquireWorktreeLeaseRequest): AcquireWorktreeLeaseResult;
  /** Releases only when `ownerAttemptId` is the current holder. */
  release(worktreeId: string, ownerAttemptId: string): boolean;
  list(): readonly WorktreeLease[];
}

function cloneLease(lease: WorktreeLease): WorktreeLease {
  return { ...lease };
}

function nextLease(request: AcquireWorktreeLeaseRequest): WorktreeLease {
  return {
    worktreeId: request.worktreeId,
    taskId: request.taskId,
    ownerAttemptId: request.ownerAttemptId,
    epoch: request.epoch,
    expiresAt: new Date(Date.parse(request.at) + request.ttlMs).toISOString(),
    acquiredAt: request.at,
    path: request.path,
  };
}

/** In-memory ownership ledger for tests and callers without a database. */
export function createMemoryWorktreeLeaseStore(): WorktreeLeaseStore {
  const leases = new Map<string, WorktreeLease>();
  return {
    find(worktreeId) {
      const lease = leases.get(worktreeId);
      return lease === undefined ? null : cloneLease(lease);
    },
    acquire(request) {
      const existing = leases.get(request.worktreeId);
      if (existing !== undefined) {
        const expired = Date.parse(existing.expiresAt) <= Date.parse(request.at);
        const sameOwner = existing.ownerAttemptId === request.ownerAttemptId;
        if (!expired && !sameOwner) return { acquired: false, heldBy: cloneLease(existing) };
        const lease = nextLease(request);
        leases.set(request.worktreeId, lease);
        return {
          acquired: true,
          lease: cloneLease(lease),
          replacedExpired: expired && !sameOwner,
          renewed: sameOwner,
        };
      }
      const lease = nextLease(request);
      leases.set(request.worktreeId, lease);
      return { acquired: true, lease: cloneLease(lease), replacedExpired: false, renewed: false };
    },
    release(worktreeId, ownerAttemptId) {
      const existing = leases.get(worktreeId);
      if (existing === undefined || existing.ownerAttemptId !== ownerAttemptId) return false;
      leases.delete(worktreeId);
      return true;
    },
    list() {
      return [...leases.values()].map(cloneLease);
    },
  };
}

export interface WorktreeRecord {
  readonly id: string;
  readonly taskId: string;
  /** Canonical repository root the worktree is linked to. */
  readonly repoRoot: string;
  /** Absolute canonical worktree path. */
  readonly path: string;
  readonly branch: string | null;
  /** The frozen base the worktree was created from (`null` = current HEAD). */
  readonly baseRevision: string | null;
  readonly createdAt: string;
}

export type WorktreeRefusalCode = 'BUSY' | 'INVALID_STATE' | 'NOT_AUTHORIZED' | 'INTERNAL_ERROR';

export interface CreateWorktreeRequest {
  readonly taskId: string;
  readonly repoRoot: string;
  readonly path: string;
  /** Frozen base revision; omitted means the repository's current HEAD. */
  readonly baseRevision?: string;
  readonly worktreeId?: string;
  readonly branch?: string;
  readonly ownerAttemptId: string;
  readonly epoch: number;
  readonly ttlMs?: number;
}

export type CreateWorktreeOutcome =
  | {
      readonly ok: true;
      readonly record: WorktreeRecord;
      readonly lease: WorktreeLease;
      /** `true` when an existing worktree on disk was re-used rather than created. */
      readonly reused: boolean;
    }
  | {
      readonly ok: false;
      readonly code: WorktreeRefusalCode;
      readonly message: string;
      readonly heldBy: WorktreeLease | null;
      readonly errors: readonly WorkspaceDiagnostic[];
    };

export interface RemoveWorktreeRequest {
  readonly worktreeId: string;
  /** Caller identity; when given it must own the lease. */
  readonly ownerAttemptId?: string;
  /**
   * Explicit user handling of the uncommitted work. Without it, a dirty worktree is
   * refused: uncommitted content exists nowhere else.
   */
  readonly discard?: boolean;
}

export type RemoveWorktreeOutcome =
  | {
      readonly ok: true;
      readonly worktreeId: string;
      readonly path: string;
      /** Worktree-relative paths that were uncommitted and are now gone. */
      readonly discardedPaths: readonly string[];
      readonly leaseReleased: boolean;
    }
  | {
      readonly ok: false;
      readonly code: WorktreeRefusalCode;
      readonly message: string;
      /** Paths that blocked the removal; empty for a non-dirty refusal. */
      readonly dirtyPaths: readonly string[];
      readonly errors: readonly WorkspaceDiagnostic[];
    };

export interface WorktreeManagerOptions {
  readonly git: WorktreeGitPort;
  readonly leases: WorktreeLeaseStore;
  /** Clock seam; defaults to the real UTC clock. */
  readonly now?: () => string;
  /** Lease lifetime; defaults to one hour. */
  readonly leaseTtlMs?: number;
}

/** The public worktree API. */
export interface WorktreeManager {
  create(request: CreateWorktreeRequest): CreateWorktreeOutcome;
  remove(request: RemoveWorktreeRequest): RemoveWorktreeOutcome;
  find(worktreeId: string): WorktreeRecord | null;
  leaseFor(worktreeId: string): WorktreeLease | null;
  list(): readonly WorktreeRecord[];
  /** The worktree covering `taskId`, when one is owned. */
  findForTask(taskId: string): WorktreeRecord | null;
}

function defaultNow(): string {
  return new Date().toISOString();
}

/** Worktree-relative paths of one `git status --porcelain` line. */
export function dirtyPathsOf(line: string): readonly string[] {
  return parsePorcelainLine(line).paths;
}

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager {
  const git = options.git;
  const leases = options.leases;
  const now = options.now ?? defaultNow;
  const defaultTtlMs = options.leaseTtlMs ?? 60 * 60 * 1000;
  const records = new Map<string, WorktreeRecord>();

  const createRefusal = (
    code: WorktreeRefusalCode,
    message: string,
    extra: {
      readonly heldBy?: WorktreeLease;
      readonly errors?: readonly WorkspaceDiagnostic[];
    } = {},
  ): CreateWorktreeOutcome => ({
    ok: false,
    code,
    message,
    heldBy: extra.heldBy ?? null,
    errors: extra.errors ?? [],
  });

  const removeRefusal = (
    code: WorktreeRefusalCode,
    message: string,
    extra: {
      readonly dirtyPaths?: readonly string[];
      readonly errors?: readonly WorkspaceDiagnostic[];
    } = {},
  ): RemoveWorktreeOutcome => ({
    ok: false,
    code,
    message,
    dirtyPaths: extra.dirtyPaths ?? [],
    errors: extra.errors ?? [],
  });

  return {
    create(request) {
      const at = now();
      const ttlMs = request.ttlMs ?? defaultTtlMs;
      const worktreeId = request.worktreeId ?? request.taskId;

      if (request.taskId.trim() === '' || request.ownerAttemptId.trim() === '') {
        return createRefusal('INVALID_STATE', '创建 worktree 需要 taskId 与 ownerAttemptId');
      }
      if (request.baseRevision !== undefined && !FULL_OID.test(request.baseRevision)) {
        return createRefusal(
          'INVALID_STATE',
          `baseRevision 不是完整 Git OID：${request.baseRevision}`,
        );
      }
      const existing = records.get(worktreeId);
      // An expired lease is not ownership (`reliability.md` §2 "过期先撤销旧执行"), so
      // only a live lease held by somebody else blocks this runner.
      const live = leases.find(worktreeId);
      const liveHeldByOther =
        live !== null &&
        live.ownerAttemptId !== request.ownerAttemptId &&
        Date.parse(live.expiresAt) > Date.parse(at);
      if (existing !== undefined && !liveHeldByOther) {
        const owned = leases.acquire({
          worktreeId,
          taskId: request.taskId,
          ownerAttemptId: request.ownerAttemptId,
          epoch: request.epoch,
          path: existing.path,
          ttlMs,
          at,
        });
        if (owned.acquired) {
          return { ok: true, record: { ...existing }, lease: owned.lease, reused: true };
        }
      }
      if (liveHeldByOther && live !== null) {
        return createRefusal(
          'BUSY',
          `worktree ${worktreeId} 已由 attempt ${live.ownerAttemptId}（epoch ${live.epoch}）持有，直到 ${live.expiresAt}`,
          { heldBy: live },
        );
      }

      const acquired = leases.acquire({
        worktreeId,
        taskId: request.taskId,
        ownerAttemptId: request.ownerAttemptId,
        epoch: request.epoch,
        path: request.path,
        ttlMs,
        at,
      });
      if (!acquired.acquired) {
        return createRefusal(
          'BUSY',
          `worktree ${worktreeId} 已由 attempt ${acquired.heldBy.ownerAttemptId}（epoch ${acquired.heldBy.epoch}）持有，直到 ${acquired.heldBy.expiresAt}`,
          { heldBy: acquired.heldBy },
        );
      }

      // Any failure past this point must not leave a lease behind.
      const resolved = git.resolveRoot(request.repoRoot);
      if (!resolved.ok || resolved.value === null) {
        leases.release(worktreeId, request.ownerAttemptId);
        return createRefusal(
          'INVALID_STATE',
          `交付仓库不存在或不是 Git 仓库：${request.repoRoot}`,
          resolved.ok ? {} : { errors: resolved.errors },
        );
      }
      const repoRoot = resolved.value;
      const listing = git.listWorktrees(repoRoot);
      if (!listing.ok) {
        leases.release(worktreeId, request.ownerAttemptId);
        return createRefusal('INTERNAL_ERROR', 'git worktree list 失败', {
          errors: listing.errors,
        });
      }
      const wanted = canonicalPath(request.path) ?? request.path;
      const onDisk = listing.value.find((entry) => canonicalPath(entry.path) === wanted);

      let worktree: WorktreeListing;
      let created = false;
      if (onDisk !== undefined) {
        worktree = onDisk;
      } else {
        if (request.baseRevision !== undefined) {
          const known = git.resolveRevision(repoRoot, request.baseRevision);
          if (!known.ok || known.value === null) {
            leases.release(worktreeId, request.ownerAttemptId);
            return createRefusal(
              'INVALID_STATE',
              `baseRevision 不存在于仓库中：${request.baseRevision}`,
              known.ok ? {} : { errors: known.errors },
            );
          }
        }
        mkdirSync(dirname(request.path), { recursive: true });
        const added = git.addWorktree({
          repoRoot,
          path: request.path,
          baseRevision: request.baseRevision ?? null,
          ...(request.branch === undefined ? {} : { branch: request.branch }),
        });
        if (!added.ok) {
          leases.release(worktreeId, request.ownerAttemptId);
          return createRefusal('INTERNAL_ERROR', 'git worktree add 失败', { errors: added.errors });
        }
        worktree = added.value;
        created = true;
      }

      const record: WorktreeRecord = {
        id: worktreeId,
        taskId: request.taskId,
        repoRoot,
        path: worktree.path,
        branch:
          request.branch ??
          (worktree.branchRef === null ? null : worktree.branchRef.replace(/^refs\/heads\//u, '')),
        baseRevision: request.baseRevision ?? null,
        createdAt: at,
      };
      records.set(worktreeId, record);
      return { ok: true, record, lease: acquired.lease, reused: !created };
    },

    remove(request) {
      const record = records.get(request.worktreeId);
      if (record === undefined) {
        return removeRefusal('INVALID_STATE', `找不到 worktree 记录：${request.worktreeId}`);
      }
      const lease = leases.find(record.id);
      if (
        request.ownerAttemptId !== undefined &&
        lease !== null &&
        lease.ownerAttemptId !== request.ownerAttemptId
      ) {
        return removeRefusal(
          'NOT_AUTHORIZED',
          `worktree ${record.id} 由 attempt ${lease.ownerAttemptId} 持有，${request.ownerAttemptId} 不能移除`,
        );
      }

      const status = git.statusPorcelain(record.path);
      if (!status.ok) {
        return removeRefusal('INTERNAL_ERROR', 'git status 失败，无法确认 worktree 是否干净', {
          errors: status.errors,
        });
      }
      const dirtyPaths = status.value.flatMap((line) => dirtyPathsOf(line));
      if (dirtyPaths.length > 0 && request.discard !== true) {
        return removeRefusal(
          'INVALID_STATE',
          `worktree 有 ${dirtyPaths.length} 个未提交路径，拒绝移除：需显式 discard 处置`,
          { dirtyPaths },
        );
      }

      const removed = git.removeWorktree(record.repoRoot, record.path, request.discard === true);
      if (!removed.ok) {
        return removeRefusal('INTERNAL_ERROR', 'git worktree remove 失败', {
          errors: removed.errors,
        });
      }
      records.delete(request.worktreeId);
      const leaseReleased =
        lease === null
          ? false
          : request.ownerAttemptId === undefined
            ? leases.release(record.id, lease.ownerAttemptId)
            : leases.release(record.id, request.ownerAttemptId);
      return {
        ok: true,
        worktreeId: record.id,
        path: record.path,
        discardedPaths: dirtyPaths,
        leaseReleased,
      };
    },

    find(worktreeId) {
      const record = records.get(worktreeId);
      return record === undefined ? null : { ...record };
    },

    leaseFor(worktreeId) {
      return leases.find(worktreeId);
    },

    list() {
      return [...records.values()].map((record) => ({ ...record }));
    },

    findForTask(taskId) {
      for (const record of records.values()) {
        if (record.taskId === taskId) return { ...record };
      }
      return null;
    },
  };
}

/**
 * The resource name a worktree lease is stored under.
 *
 * `resource` is unique in `data.md` §2's `lease` table, so this function is the one
 * place that decides how a worktree lease is addressed.
 */
export function worktreeLeaseResource(worktreeId: string): string {
  return `worktree:${worktreeId}`;
}

/** Convenience factory for the real, integration-aware Git port. */
export function createNodeWorktreeGitPort(
  options: { readonly timeoutMs?: number } = {},
): NodeWorktreeGitPort {
  return new NodeWorktreeGitPort(options);
}
