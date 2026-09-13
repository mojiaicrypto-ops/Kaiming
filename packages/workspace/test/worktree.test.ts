/**
 * Worktree creation, removal and ownership tests (AC-062/AC-081,
 * `docs/architecture/reliability.md` §4/§2).
 *
 * The Git seam is a fake `WorktreeGitPort` so ownership rules can be asserted
 * deterministically; the real `git worktree` invocation is exercised end to end in
 * `cas.integration.test.ts` and against real temporary repositories.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryGitPort, type GitResult } from '@agentdev/workspace';
import {
  createMemoryWorktreeLeaseStore,
  createNodeWorktreeGitPort,
  createWorktreeManager,
  dirtyPathsOf,
  requireGit,
  worktreeLeaseResource,
  type AddWorktreeRequest,
  type CreateWorktreeOutcome,
  type RemoveWorktreeOutcome,
  type UpdateRefRequest,
  type WorktreeGitPort,
  type WorktreeListing,
} from '@agentdev/workspace';

const created: string[] = [];

function makeTempDir(prefix = 'agentdev-worktree-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const BASE_OID = 'a'.repeat(40);
/** A real temporary directory tree so `mkdirSync` and canonical paths behave normally. */
const scratch = realpathSync(makeTempDir('agentdev-worktree-scratch-'));
const REPO_ROOT = join(scratch, 'repo');
const WT_ROOT = join(scratch, 'worktrees');

interface FakeState {
  worktrees: WorktreeListing[];
  added: AddWorktreeRequest[];
  removed: { path: string; force: boolean }[];
  resets: { path: string; revision: string }[];
  refs: Map<string, string>;
  dirty: Map<string, string[]>;
  revisions: Set<string>;
}

/** A `WorktreeGitPort` that records calls and answers from in-memory state. */
function fakeWorktreeGit(seed: Partial<FakeState> = {}): {
  readonly git: WorktreeGitPort;
  readonly state: FakeState;
} {
  const state: FakeState = {
    worktrees: seed.worktrees ?? [],
    added: [],
    removed: [],
    resets: [],
    refs: seed.refs ?? new Map<string, string>([['refs/heads/agentdev/main', BASE_OID]]),
    dirty: seed.dirty ?? new Map<string, string[]>(),
    revisions: seed.revisions ?? new Set<string>([BASE_OID]),
  };
  const base = createMemoryGitPort({
    repositories: [{ root: REPO_ROOT, branch: 'agentdev/main', head: BASE_OID }],
  });
  const git: WorktreeGitPort = {
    isRepository: (path) => base.isRepository(path),
    resolveRoot: (path) => base.resolveRoot(path),
    headRevision: (path) => {
      const linked = state.worktrees.find((entry) => entry.path === path);
      return linked === undefined ? base.headRevision(path) : { ok: true, value: linked.head };
    },
    statusPorcelain: (path) => {
      const lines = state.dirty.get(path);
      return lines === undefined ? { ok: true, value: [] } : { ok: true, value: lines };
    },
    initRepository: (path, options) => base.initRepository(path, options),
    branchName: (path) => base.branchName(path),
    commit: (path, options) => base.commit(path, options),
    trackedFiles: (path) => base.trackedFiles(path),
    resolveRevision: (_repoRoot, revision) =>
      state.revisions.has(revision) ? { ok: true, value: revision } : { ok: true, value: null },
    mergeTree: (_repoRoot, revision) =>
      state.revisions.has(revision)
        ? { ok: true, value: 'b'.repeat(40) }
        : { ok: true, value: null },
    addWorktree: (request) => {
      state.added.push({ ...request });
      state.revisions.add(request.baseRevision ?? BASE_OID);
      const listing: WorktreeListing = {
        path: request.path,
        head: request.baseRevision ?? BASE_OID,
        branchRef: request.branch === undefined ? null : `refs/heads/${request.branch}`,
        detached: request.branch === undefined,
        bare: false,
      };
      state.worktrees.push(listing);
      return { ok: true, value: listing };
    },
    listWorktrees: () => ({ ok: true, value: [...state.worktrees] }),
    removeWorktree: (_repoRoot, path, force) => {
      state.removed.push({ path, force });
      state.worktrees = state.worktrees.filter((entry) => entry.path !== path);
      return { ok: true, value: null };
    },
    resetHard: (worktreePath, revision) => {
      state.resets.push({ path: worktreePath, revision });
      state.worktrees = state.worktrees.map((entry) =>
        entry.path === worktreePath ? { ...entry, head: revision } : entry,
      );
      return { ok: true, value: null };
    },
    updateRef: (request: UpdateRefRequest) => {
      state.refs.set(request.ref, request.newRevision);
      return { ok: true, value: null };
    },
    mergeBase: () => ({ ok: true, value: BASE_OID }),
    isAncestor: () => ({ ok: true, value: true }),
    commitPaths: () => ({ ok: true, value: { revision: 'c'.repeat(40) } }),
    cherry: () => ({ ok: true, value: [] }),
    cherryPick: () => ({ ok: true, value: null }),
    cherryPickAbort: () => ({ ok: true, value: null }),
    cherryPickSkip: () => ({ ok: true, value: null }),
    listTree: () => ({ ok: true, value: [] }),
    pathAtRevision: () => ({ ok: true, value: true }),
    readBlob: () => ({ ok: true, value: null }),
  };
  return { git, state };
}

function expectCreated(
  outcome: CreateWorktreeOutcome,
): Extract<CreateWorktreeOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected create to succeed: ${outcome.message}`);
  return outcome;
}

function expectRemoved(
  outcome: RemoveWorktreeOutcome,
): Extract<RemoveWorktreeOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected remove to succeed: ${outcome.message}`);
  return outcome;
}

const CLOCK = '2026-09-11T00:00:00.000Z';
const LATER = '2026-09-11T02:00:00.000Z';

describe('worktree manager', () => {
  it('runs a real `git worktree add` through the port and creates the worktree', () => {
    const { git, state } = fakeWorktreeGit();
    const manager = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
    });
    const outcome = expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-a'),
        baseRevision: BASE_OID,
        branch: 'agentdev/task-a',
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );

    expect(state.added).toHaveLength(1);
    expect(state.added[0]).toMatchObject({
      repoRoot: REPO_ROOT,
      path: join(WT_ROOT, 'task-a'),
      baseRevision: BASE_OID,
      branch: 'agentdev/task-a',
    });
    expect(outcome.record).toMatchObject({
      id: 'wt-a',
      taskId: 'task-a',
      path: join(WT_ROOT, 'task-a'),
      branch: 'agentdev/task-a',
      baseRevision: BASE_OID,
    });
    expect(outcome.reused).toBe(false);
    expect(outcome.lease.ownerAttemptId).toBe('attempt-1');
    expect(outcome.lease.epoch).toBe(1);
    // One lease record per worktree resource, addressed the documented way.
    expect(worktreeLeaseResource('wt-a')).toBe('worktree:wt-a');
    expect(manager.leaseFor('wt-a')?.ownerAttemptId).toBe('attempt-1');
  });

  it('refuses a second runner that asks for a worktree already owned by another attempt', () => {
    const { git, state } = fakeWorktreeGit();
    const manager = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
    });
    const first = expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-a'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );
    const second = manager.create({
      taskId: 'task-a',
      worktreeId: 'wt-a',
      repoRoot: REPO_ROOT,
      path: join(WT_ROOT, 'task-b'),
      baseRevision: BASE_OID,
      ownerAttemptId: 'attempt-2',
      epoch: 2,
    });

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.code).toBe('BUSY');
    expect(second.heldBy?.ownerAttemptId).toBe('attempt-1');
    expect(second.heldBy?.epoch).toBe(1);
    // The second runner created neither a worktree nor a competing lease.
    expect(state.added).toHaveLength(1);
    expect(first.lease.ownerAttemptId).toBe('attempt-1');
    expect(manager.list()).toHaveLength(1);
  });

  it('rewinds a re-used worktree that is parked at another base (W8R2-01)', () => {
    const parked = 'd'.repeat(40);
    // The worktree directory exists on disk, so path matching resolves like the real
    // `git worktree list` case does.
    mkdirSync(join(WT_ROOT, 'task-a'), { recursive: true });
    const { git, state } = fakeWorktreeGit({
      worktrees: [
        {
          path: join(WT_ROOT, 'task-a'),
          head: parked,
          branchRef: null,
          detached: true,
          bare: false,
        },
      ],
      revisions: new Set([BASE_OID, parked]),
    });
    const manager = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
    });
    const outcome = expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-a'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );
    expect(outcome.reused).toBe(true);
    // FALSIFY (W8R2-01): the stale base is not silently continued; the worktree is
    // rewound to the requested base before anything is built on it.
    expect(state.resets).toEqual([{ path: join(WT_ROOT, 'task-a'), revision: BASE_OID }]);
    expect(state.worktrees).toEqual([
      expect.objectContaining({ path: join(WT_ROOT, 'task-a'), head: BASE_OID }),
    ]);
  });

  it('renews the lease for the same attempt and replaces an expired lease', () => {
    const { git } = fakeWorktreeGit();
    const manager = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
      leaseTtlMs: 60_000,
    });
    expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-a'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );
    const renewed = expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-a'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );
    expect(renewed.reused).toBe(true);

    const clockValue = { value: LATER };
    const expiring = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => clockValue.value,
    });
    expectCreated(
      expiring.create({
        taskId: 'task-c',
        worktreeId: 'wt-c',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-c'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-1',
        epoch: 1,
        ttlMs: 1000,
      }),
    );
    clockValue.value = '2026-09-11T02:00:05.000Z';
    // The expired owner is replaced ("过期先撤销旧执行"), so a new attempt owns it.
    const replaced = expectCreated(
      expiring.create({
        taskId: 'task-c',
        worktreeId: 'wt-c',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-c'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-2',
        epoch: 2,
      }),
    );
    expect(replaced.lease.ownerAttemptId).toBe('attempt-2');
    expect(expiring.leaseFor('wt-c')?.epoch).toBe(2);
  });

  it('refuses to remove a worktree with uncommitted work unless it is discarded', () => {
    const { git, state } = fakeWorktreeGit();
    state.dirty.set(join(WT_ROOT, 'task-a'), [' M src/orders.ts', '?? scratch/notes.md']);
    const manager = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
    });
    expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-a'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );

    const refused = manager.remove({ worktreeId: 'wt-a', ownerAttemptId: 'attempt-1' });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.code).toBe('INVALID_STATE');
    expect(refused.dirtyPaths).toEqual(['src/orders.ts', 'scratch/notes.md']);
    expect(state.removed).toHaveLength(0);

    const discarded = expectRemoved(
      manager.remove({ worktreeId: 'wt-a', ownerAttemptId: 'attempt-1', discard: true }),
    );
    expect(discarded.discardedPaths).toEqual(['src/orders.ts', 'scratch/notes.md']);
    expect(discarded.leaseReleased).toBe(true);
    expect(state.removed).toEqual([{ path: join(WT_ROOT, 'task-a'), force: true }]);
    expect(manager.find('wt-a')).toBeNull();
    expect(manager.leaseFor('wt-a')).toBeNull();
  });

  it('removes a clean worktree without discarding and refuses a foreign attempt', () => {
    const { git, state } = fakeWorktreeGit();
    const manager = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
    });
    expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: REPO_ROOT,
        path: join(WT_ROOT, 'task-a'),
        baseRevision: BASE_OID,
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );
    const foreign = manager.remove({ worktreeId: 'wt-a', ownerAttemptId: 'attempt-9' });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw new Error('unreachable');
    expect(foreign.code).toBe('NOT_AUTHORIZED');
    expect(state.removed).toHaveLength(0);

    const removed = expectRemoved(
      manager.remove({ worktreeId: 'wt-a', ownerAttemptId: 'attempt-1' }),
    );
    expect(removed.leaseReleased).toBe(true);
    expect(state.removed).toEqual([{ path: join(WT_ROOT, 'task-a'), force: false }]);
  });

  it('reports a create failure without leaving a lease behind', () => {
    const { git } = fakeWorktreeGit();
    const broken: WorktreeGitPort = {
      ...git,
      addWorktree: (): GitResult<WorktreeListing> => ({
        ok: false,
        errors: [{ code: 'INTERNAL_ERROR', message: 'worktree add 失败' }],
      }),
    };
    const manager = createWorktreeManager({
      git: broken,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
    });
    const outcome = manager.create({
      taskId: 'task-a',
      worktreeId: 'wt-a',
      repoRoot: REPO_ROOT,
      path: join(WT_ROOT, 'task-a'),
      baseRevision: BASE_OID,
      ownerAttemptId: 'attempt-1',
      epoch: 1,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.code).toBe('INTERNAL_ERROR');
    // A failed create must not lock the worktree out for the next attempt.
    expect(manager.leaseFor('wt-a')).toBeNull();
  });

  it('refuses a base revision that the repository does not have', () => {
    const { git, state } = fakeWorktreeGit();
    const manager = createWorktreeManager({
      git,
      leases: createMemoryWorktreeLeaseStore(),
      now: () => CLOCK,
    });
    const outcome = manager.create({
      taskId: 'task-a',
      worktreeId: 'wt-a',
      repoRoot: REPO_ROOT,
      path: join(WT_ROOT, 'task-a'),
      baseRevision: 'f'.repeat(40),
      ownerAttemptId: 'attempt-1',
      epoch: 1,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.code).toBe('INVALID_STATE');
    expect(state.added).toHaveLength(0);
  });

  it('splits porcelain lines into their paths, including renames', () => {
    expect(dirtyPathsOf(' M src/orders.ts')).toEqual(['src/orders.ts']);
    expect(dirtyPathsOf('R  old.ts -> new.ts')).toEqual(['old.ts', 'new.ts']);
    expect(dirtyPathsOf('?? "a b/c d.md"')).toEqual(['a b/c d.md']);
    expect(dirtyPathsOf(' M ')).toEqual([]);
  });

  it('raises a typed WorkspaceError from requireGit with the diagnostics attached', () => {
    let raised: unknown;
    try {
      requireGit(
        { ok: false, errors: [{ code: 'INVALID_STATE', message: 'boom', path: REPO_ROOT }] },
        'VERSION_CONFLICT',
        'CAS 失败',
      );
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(Error);
    expect((raised as { readonly code?: string }).code).toBe('VERSION_CONFLICT');
    expect((raised as { readonly message: string }).message).toContain('boom');
    // The real adapter is exported for production wiring.
    expect(typeof createNodeWorktreeGitPort).toBe('function');
  });

  it('creates and removes a real worktree through NodeWorktreeGitPort', () => {
    const repo = makeTempDir();
    const worktreePath = join(makeTempDir(), 'task-a');
    const nodeGit = createNodeWorktreeGitPort();
    const initialized = nodeGit.initRepository(repo, { branch: 'agentdev/main' });
    expect(initialized.ok).toBe(true);
    const committed = nodeGit.commit(repo, { message: 'chore: seed', paths: [] });
    expect(committed.ok).toBe(true);
    if (!committed.ok) throw new Error('unreachable');
    const manager = createWorktreeManager({
      git: nodeGit,
      leases: createMemoryWorktreeLeaseStore(),
    });
    const outcome = expectCreated(
      manager.create({
        taskId: 'task-a',
        worktreeId: 'wt-a',
        repoRoot: repo,
        path: worktreePath,
        baseRevision: committed.value.revision,
        branch: 'agentdev/task-a',
        ownerAttemptId: 'attempt-1',
        epoch: 1,
      }),
    );
    expect(outcome.record.baseRevision).toBe(committed.value.revision);
    const listing = nodeGit.listWorktrees(repo);
    expect(listing.ok).toBe(true);
    if (!listing.ok) throw new Error('unreachable');
    expect(listing.value.length).toBeGreaterThanOrEqual(2);
    const removed = expectRemoved(
      manager.remove({ worktreeId: 'wt-a', ownerAttemptId: 'attempt-1' }),
    );
    expect(removed.leaseReleased).toBe(true);
  });
});
