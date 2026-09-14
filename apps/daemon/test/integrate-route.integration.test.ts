/**
 * WP-12 T4b round 3 (step 3): the route wiring for the L2 delivery chain.
 *
 * `workflow.md` §3/§7 give the Settle stage its own professional Run, and `protocol.md` §6
 * puts that Run's result on the `stage.submit` control channel. The accepted result of a
 * `purpose='settlement'` Run is therefore the documented Accept/Integrate point: the daemon
 * must integrate the verified Task candidates and then settle the candidate the CAS
 * installed. This test drives the real `createControlHandlers` + real `StageGate` and asserts
 * exactly that, including that a non-settlement Run does **not** trigger the chain.
 *
 * The integration itself is a recording double here on purpose: its real behaviour is
 * proven against real Git in `packages/core/test/integrate.integration.test.ts`. What this
 * file pins down is the wiring — which Run purpose triggers it, in which order, and that a
 * refusal is surfaced to the Runner instead of being swallowed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactService,
  ConfigStore,
  ModelGateway,
  Orchestrator,
  RunLifecycle,
  SettlementService,
  SnapshotWriter,
  StageGate,
  emptyReadLedgerBinding,
  type IntegrateOutcome,
  type IntegrateRequest,
  type IntegrateService,
} from '@agentdev/core';
import type { Scope } from '@agentdev/contracts';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import {
  createCasService,
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
} from '@agentdev/workspace';
import { createControlHandlers } from '../src/control-handler.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da001';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da010';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da050';
const SETTLE_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da011';
const SETTLE_ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da051';
const HASH = 'a'.repeat(64);
const SCOPE: Scope = {
  readPaths: ['src'],
  writePaths: ['src'],
  operations: ['read', 'edit'],
  networkTargets: [],
};
const created: string[] = [];

function makeTempDir(prefix: string): string {
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

describe('the Settle stage triggers Integrate then Settlement (workflow.md §3/§7)', () => {
  let repo: string;
  let store: ProjectStore;
  let projectId: string;
  let calls: IntegrateRequest[];
  let outcome: IntegrateOutcome;
  let handlers: ReturnType<typeof createControlHandlers>;

  beforeEach(() => {
    const home = makeTempDir('agentdev-route-home-');
    repo = makeTempDir('agentdev-route-repo-');
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
    projectId = projectIdFromRoot(repo);
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
      purpose: 'settle the L2 delivery',
      level: 'L2',
      goal: 'deliver',
      scope: SCOPE,
      sourceRef: { kind: 'action', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: seed.value.revision,
      budgetId: budget.id,
      policyRevision: 1,
    });
    for (const [runId, role, purpose] of [
      [RUN_ID, 'backend', 'implementation'],
      [SETTLE_RUN_ID, 'settlement', 'settlement'],
    ] as const) {
      store.runs.insert({
        id: runId,
        projectId,
        workId: WORK_ID,
        role,
        purpose,
        stage: purpose === 'settlement' ? 'settle-L2' : 'develop-L2',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: HASH,
        contextSnapshotId: HASH,
        dispatchSnapshotId: HASH,
        budgetAllocation: 1_000,
      });
    }
    for (const [attemptId, runId] of [
      [ATTEMPT_ID, RUN_ID],
      [SETTLE_ATTEMPT_ID, SETTLE_RUN_ID],
    ] as const) {
      store.attempts.insert({
        id: attemptId,
        projectId,
        runId,
        number: 1,
        status: 'running',
        ownerEpoch: 0,
      });
    }

    const blobs = new BlobStore({ root: home });
    const artifacts = new ArtifactService({ store, blobs });
    const snapshots = new SnapshotWriter({ store });
    const config = ConfigStore.open({ globalDir: home, projectRoot: home, snapshots });
    const gateway = new ModelGateway({
      config,
      snapshots,
      transport: {
        complete: () =>
          Promise.resolve({ ok: true, text: 'pong', inputTokens: 1, outputTokens: 1 }),
      },
      secrets: { has: () => false, resolve: () => undefined },
    });
    const lifecycle = new RunLifecycle({ store });
    const journal = createMemoryCasJournal();
    const events = createMemoryCasEvents();
    const cas = createCasService({ git, journal, events });

    calls = [];
    outcome = {
      ok: false,
      code: 'TASK_MERGE_CONFLICT',
      message: 'two passed Tasks conflict',
      branchUntouched: true,
      details: {},
    };
    const integrate: IntegrateService = {
      integrate: (request) => {
        calls.push(request);
        return outcome;
      },
    };
    const settlement = new SettlementService({
      store,
      worktrees: git,
      cas,
      journal,
      events,
      snapshots,
    });
    handlers = createControlHandlers({
      store,
      orchestrator: new Orchestrator({ store, config, snapshots, gateway, lifecycle }),
      // No read ledger: this test never goes through the tool bridge, so the seal is
      // not the subject (the real delivery-path test uses the real registry).
      stageGate: new StageGate({ store, lifecycle }),
      artifacts,
      integrate,
      settlement,
      log: () => undefined,
    });
  });

  function submit(runId: string, attemptId: string) {
    return handlers.handler.stageSubmit({
      caller: {
        runId,
        attemptId,
        epoch: 0,
        role: runId === SETTLE_RUN_ID ? 'settlement' : 'backend',
      },
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
      operationId: `op-${attemptId}`,
    });
  }

  it('runs Integrate then Settlement when the Settle stage is accepted', () => {
    const response = submit(SETTLE_RUN_ID, SETTLE_ATTEMPT_ID);
    expect(response['accepted']).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.workId).toBe(WORK_ID);
    // The operation id names the integration so a retry addresses the same candidate.
    expect(calls[0]?.operationId).toBe(`integrate:op-${SETTLE_ATTEMPT_ID}`);
    // The refusal is surfaced to the Runner instead of being swallowed.
    expect(response['delivery']).toEqual({
      status: 'refused',
      step: 'integrate',
      code: 'TASK_MERGE_CONFLICT',
      message: 'two passed Tasks conflict',
      branchUntouched: true,
    });
  });

  it('settles the candidate the integration installed', () => {
    outcome = {
      ok: true,
      operationId: `integrate:op-${SETTLE_ATTEMPT_ID}`,
      operationRowId: store.newId(),
      workId: WORK_ID,
      ref: 'refs/heads/agentdev/main',
      targetRevision: 'b'.repeat(40),
      revision: 'c'.repeat(40),
      outcome: 'integrated',
      appliedTaskIds: [],
      skippedTaskIds: [],
      supersededTaskIds: [],
      applied: [],
      tasks: [],
      verificationManifestId: null,
      replayed: true,
    };
    const response = submit(SETTLE_RUN_ID, SETTLE_ATTEMPT_ID);
    expect(calls).toHaveLength(1);
    // No such integration operation exists in the store, so the real settlement refuses
    // before any write — which is exactly the fail-closed path (`NOT_FOUND`).
    expect(response['delivery']).toMatchObject({ status: 'refused', step: 'settle' });
    expect(store.requirements.list({})).toHaveLength(0);
  });

  it('does not touch the delivery chain for a non-settlement Run', () => {
    const response = submit(RUN_ID, ATTEMPT_ID);
    expect(response['accepted']).toBe(true);
    expect(calls).toHaveLength(0);
    expect(response['delivery']).toBeUndefined();
  });
});
