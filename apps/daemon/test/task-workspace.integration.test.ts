/**
 * WP-12 W6 — the per-Task workspace, proven with real Git.
 *
 * A real repository, a real `ProjectStore`, real Task/Run rows and the real resolver
 * `main.ts` wires. The assertions are the W6 promise:
 *
 * - two Tasks of the same Work get two different external worktrees (never the project
 *   root), created from the Work's frozen base revision;
 * - deleting inside Task A's worktree removes A's *copy* and leaves the project root and
 *   Task B's worktree untouched — the isolation the phase-1 "delete inside the workspace is
 *   allowed" decision depends on;
 * - a second Attempt of the same Task is refused with `BUSY` while the first holds the
 *   worktree lease (`reliability.md` §2/§3).
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import {
  ProtocolError,
  createTaskWorktreeWorkspaceResolver,
  resolveWithinRoots,
} from '@agentdev/core';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { createNodeWorktreeGitPort, taskWorktreePath } from '@agentdev/workspace';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db000';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db010';
const RUN_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db011';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db050';
const ATTEMPT_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db051';
const TASK_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db040';
const TASK_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db041';
const HASH = 'a'.repeat(64);

const SCOPES: Scope = {
  readPaths: ['src'],
  writePaths: ['src'],
  operations: ['read', 'search', 'edit', 'write', 'bash'],
  networkTargets: [],
};

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

describe('per-Task workspace (W6)', () => {
  let repo: string;
  let dataDir: string;
  let worktrees: string;
  let store: ProjectStore;
  let revision: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'agentdev-w6-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-w6-data-'));
    worktrees = mkdtempSync(join(tmpdir(), 'agentdev-w6-trees-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test']);
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'a.txt'), 'A\n', 'utf8');
    writeFileSync(join(repo, 'src', 'b.txt'), 'B\n', 'utf8');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'base']);
    revision = git(repo, ['rev-parse', 'HEAD']).trim();

    store = Store.open({
      dataDir,
      canonicalRoot: repo,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    const projectId = projectIdFromRoot(repo);
    store.projects.insert({
      id: projectId,
      root: repo,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    const budget = store.budgets.insert({
      projectId,
      workId: WORK_ID,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    store.works.insert({
      id: WORK_ID,
      projectId,
      intent: 'delivery',
      purpose: 'prove the per-Task workspace',
      level: 'L2',
      goal: 'isolate two Tasks',
      scope: SCOPES,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: revision,
      budgetId: budget.id,
      policyRevision: 1,
    });
    for (const [taskId, role] of [
      [TASK_A, 'backend'],
      [TASK_B, 'backend'],
    ] as const) {
      store.tasks.insert({
        id: taskId,
        projectId,
        workId: WORK_ID,
        planRef: { id: taskId, version: 1, hash: HASH },
        role,
        dependsOn: [],
        dependencyManifestRefs: [],
        scope: SCOPES,
        stage: 'develop',
        acceptanceIds: ['AC-048'],
      });
    }
    for (const [runId, taskId, attemptId] of [
      [RUN_A, TASK_A, ATTEMPT_A],
      [RUN_B, TASK_B, ATTEMPT_B],
    ] as const) {
      store.runs.insert({
        id: runId,
        projectId,
        workId: WORK_ID,
        taskId,
        role: 'backend',
        purpose: 'implementation',
        stage: 'develop-L2',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: '1'.repeat(64),
        contextSnapshotId: '2'.repeat(64),
        dispatchSnapshotId: '3'.repeat(64),
        budgetAllocation: 1_000,
      });
      store.attempts.insert({
        id: attemptId,
        projectId,
        runId,
        number: 1,
        status: 'running',
        ownerEpoch: 1,
      });
    }
  });

  afterEach(() => {
    store.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(worktrees, { recursive: true, force: true });
  });

  function resolver() {
    return createTaskWorktreeWorkspaceResolver({
      store,
      git: createNodeWorktreeGitPort(),
      worktreeRoot: worktrees,
      repoRoot: repo,
    });
  }

  it('gives each Task its own worktree and keeps one writer per worktree', () => {
    const resolve = resolver();
    const a = resolve.resolve({
      workId: WORK_ID,
      runId: RUN_A,
      attemptId: ATTEMPT_A,
      epoch: 1,
    });
    const b = resolve.resolve({
      workId: WORK_ID,
      runId: RUN_B,
      attemptId: ATTEMPT_B,
      epoch: 1,
    });

    expect(a.taskWorktree).toBe(true);
    expect(b.taskWorktree).toBe(true);
    // The manager reports the canonical path (`/var` → `/private/var` on macOS).
    expect(a.root).toBe(realpathSync(taskWorktreePath(worktrees, TASK_A)));
    expect(b.root).toBe(realpathSync(taskWorktreePath(worktrees, TASK_B)));
    expect(a.root).not.toBe(b.root);
    expect(a.root).not.toBe(repo);
    expect(readFileSync(join(a.root, 'src', 'a.txt'), 'utf8')).toBe('A\n');
    // The Task row now points at its worktree.
    expect(store.tasks.find(TASK_A)?.worktreeId).toBe(TASK_A);

    // A second Attempt of the *same* Task cannot take the worktree.
    let refusal: unknown;
    try {
      resolve.resolve({ workId: WORK_ID, runId: RUN_A, attemptId: 'other-attempt', epoch: 9 });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ProtocolError);
    expect((refusal as ProtocolError).code).toBe('BUSY');
  });

  it("deleting inside Task A's worktree leaves the project root and Task B untouched", () => {
    const resolve = resolver();
    const a = resolve.resolve({ workId: WORK_ID, runId: RUN_A, attemptId: ATTEMPT_A, epoch: 1 });
    const b = resolve.resolve({ workId: WORK_ID, runId: RUN_B, attemptId: ATTEMPT_B, epoch: 1 });

    // Task B writes its own work.
    writeFileSync(join(b.root, 'src', 'b-work.txt'), 'B WORK\n', 'utf8');

    // Task A "deletes inside its workspace" — the operation phase-1 allows.
    rmSync(join(a.root, 'src', 'b.txt'));

    expect(existsSync(join(a.root, 'src', 'b.txt'))).toBe(false);
    // The project root and the sibling Task are untouched: the delete was scoped to a tree
    // that belongs to Task A alone.
    expect(readFileSync(join(repo, 'src', 'b.txt'), 'utf8')).toBe('B\n');
    expect(readFileSync(join(b.root, 'src', 'b.txt'), 'utf8')).toBe('B\n');
    expect(readFileSync(join(b.root, 'src', 'b-work.txt'), 'utf8')).toBe('B WORK\n');

    // And Task A cannot name a path outside its own worktree at all: the Broker's boundary
    // is evaluated against the Task root.
    const outside = resolveWithinRoots({
      path: join(repo, 'src', 'b.txt'),
      access: 'write',
      roots: [a.root],
    });
    expect(outside.ok).toBe(false);
    if (outside.ok) throw new Error('unreachable');
    expect(outside.code).toBe('NOT_AUTHORIZED');
  });

  it('reuses an existing worktree on a second resolve without rewinding or recreating it', () => {
    const resolve = resolver();
    const first = resolve.resolve({
      workId: WORK_ID,
      runId: RUN_A,
      attemptId: ATTEMPT_A,
      epoch: 1,
    });
    const uncommitted = join(first.root, 'src', 'draft.txt');
    writeFileSync(uncommitted, 'draft\n', 'utf8');
    const again = resolve.resolve({
      workId: WORK_ID,
      runId: RUN_A,
      attemptId: ATTEMPT_A,
      epoch: 1,
    });
    expect(again.root).toBe(first.root);
    // The Run's uncommitted work survives a re-resolve: the worktree is only rewound when
    // it is parked at a *different* base revision.
    expect(readFileSync(uncommitted, 'utf8')).toBe('draft\n');
  });
});
