/**
 * WP-12 reliability debt 3b — an accepted delivery frees the per-Task worktree lease.
 *
 * `reliability.md` §3 keeps one writer per Task worktree, and `task-workspace.ts` binds that
 * lease to `(attemptId, epoch)` with a one-hour TTL. A delivery ends the Attempt's *writing*
 * while its process is still finishing the turn: the next stage of the route (Review, on the
 * same Task) resolves the same tree and got `BUSY`. The fix has two halves, and this test
 * drives both through the production seam:
 *
 * - `execution.ts` hands the daemon the stack's own `release` port (`releaseWorkspaceLease`);
 * - `control-handler.ts` calls it after the accepted `stage.submit`, exactly where it already
 *   released the Work-level writer lease.
 *
 * The stack is the real `createProjectExecution`; the handler is the daemon's real
 * `createControlHandlers`; the repository, store and worktree manager are real and the
 * resolver is the *same instance* the stack was built with. The only stubs are the ones the
 * delivery path never touches (Runner spawn, invocation builder).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigStore,
  SecretStore,
  SnapshotWriter,
  createProjectExecution,
  createTaskWorktreeWorkspaceResolver,
  emptyReadLedgerBinding,
  type ProjectExecution,
  type RunWorkspaceResolver,
} from '@agentdev/core';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';

import { createControlHandlers, type ControlHandlers } from '../src/control-handler.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc000';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc040';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc010';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc050';
const HASH = 'a'.repeat(64);

describe('the accepted delivery frees the per-Task worktree lease (WP-12 debt 3b)', () => {
  let home: string;
  let repo: string;
  let store: ProjectStore;
  let execution: ProjectExecution;
  let workspace: RunWorkspaceResolver;
  let handlers: ControlHandlers;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'agentdev-lease-home-'));
    repo = mkdtempSync(join(tmpdir(), 'agentdev-lease-repo-'));
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n', 'utf8');
    const git = createNodeWorktreeGitPort();
    const init = git.initRepository(repo, { branch: 'agentdev/main' });
    if (!init.ok) throw new Error('git init failed');
    const seed = git.commitPaths(repo, 'chore: seed', ['src/a.ts']);
    if (!seed.ok) throw new Error('seed commit failed');

    store = Store.open({
      dataDir: home,
      canonicalRoot: repo,
      migrations: { backup: () => undefined, backupPath: join(home, 'pre.sqlite') },
    });
    const projectId = projectIdFromRoot(repo);
    store.projects.insert({
      id: projectId,
      root: repo,
      gitRoot: repo,
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
      purpose: 'deliver the change',
      level: 'L2',
      goal: 'prove the lease lifecycle',
      scope: {
        readPaths: ['src/a.ts'],
        writePaths: ['src/a.ts'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: seed.value.revision,
      budgetId: budget.id,
      policyRevision: 1,
    });
    store.tasks.insert({
      id: TASK_ID,
      projectId,
      workId: WORK_ID,
      planRef: { id: TASK_ID, version: 1, hash: HASH },
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: {
        readPaths: ['src/a.ts'],
        writePaths: ['src/a.ts'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      stage: 'develop',
      acceptanceIds: ['AC-048'],
    });
    store.runs.insert({
      id: RUN_ID,
      projectId,
      workId: WORK_ID,
      taskId: TASK_ID,
      role: 'backend',
      purpose: 'implementation',
      stage: 'develop-L2',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: HASH,
      contextSnapshotId: HASH,
      dispatchSnapshotId: HASH,
      budgetAllocation: 1_000,
    });
    store.attempts.insert({
      id: ATTEMPT_ID,
      projectId,
      runId: RUN_ID,
      number: 1,
      status: 'running',
      ownerEpoch: 0,
    });

    workspace = createTaskWorktreeWorkspaceResolver({
      store,
      git,
      worktreeRoot: join(home, 'task-worktrees'),
      repoRoot: repo,
    });
    const snapshots = new SnapshotWriter({ store });
    const config = ConfigStore.open({ globalDir: home, projectRoot: home, snapshots });
    execution = await createProjectExecution({
      store,
      config,
      snapshots,
      secrets: new SecretStore(),
      workspace,
      prepare: () => () => {
        throw new Error('no Runner is spawned in this drill');
      },
      spawn: {
        spawn: () => {
          throw new Error('no Runner is spawned in this drill');
        },
      },
      // The daemon's own wiring (`main.ts`): forward every port the stack supplies,
      // including `releaseWorkspaceLease`, to the real control handlers.
      control: {
        attach: ({ orchestrator, stageGate, releaseWorkspaceLease }) => {
          handlers = createControlHandlers({
            store,
            orchestrator,
            stageGate,
            ...(releaseWorkspaceLease === undefined ? {} : { releaseWorkspaceLease }),
            log: () => undefined,
          });
          return handlers;
        },
      },
      transport: {
        complete: () =>
          Promise.resolve({ ok: true, text: 'pong', inputTokens: 1, outputTokens: 1 }),
      },
      tickMs: 1_000,
      log: () => undefined,
    });
  });

  afterEach(async () => {
    await execution.stop();
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('releases the worktree lease at acceptance so the next stage is not BUSY', () => {
    // The implementer's Attempt takes the Task worktree and holds its `(attempt, epoch)` lease.
    const first = workspace.resolve({
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
    });
    expect(first.taskWorktree).toBe(true);
    // A second Attempt of the same Task is refused while the first holds it.
    expect(() =>
      workspace.resolve({ workId: WORK_ID, runId: RUN_ID, attemptId: 'attempt-next', epoch: 9 }),
    ).toThrowError(/unavailable/u);

    // The delivered stage goes through the same handler the control endpoint calls.
    const accepted = handlers.handler.stageSubmit({
      caller: { runId: RUN_ID, attemptId: ATTEMPT_ID, epoch: 0, role: 'backend' },
      result: {
        status: 'success',
        summary: 'the stage is delivered',
        artifactRefs: [],
        evidenceRefs: [],
        changedPaths: [],
        findingIds: [],
        unknowns: [],
        requestedActions: [],
        readLedgerSeq: emptyReadLedgerBinding().seq,
        readLedgerHash: emptyReadLedgerBinding().hash,
      },
      operationId: 'op-lease-release',
    });
    expect(accepted['accepted']).toBe(true);

    // The lease is gone, so the next stage of the route resolves the same tree.
    const next = workspace.resolve({
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: 'attempt-next',
      epoch: 9,
    });
    expect(next.root).toBe(first.root);
  });
});
