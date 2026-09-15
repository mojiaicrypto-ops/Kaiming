/**
 * Join: a parallel sibling failure on the real Core stack (`AC-046`).
 *
 * `rules/agents.md` §3: "joinPolicy=none/all；none持久分派后Chief可继续，all挂起该ChiefRun直至指定子Run
 * 终态。requiredChild失败阻断相关Gate，其他子Run继续。" `packages/core/test/join.test.ts` proves the
 * rule over hand-driven rows; this integration drill drives the same semantics through the
 * real services — real SQLite, the real `Orchestrator` dispatch path, the real `StageGate`
 * two-strike rule, the real `RunLifecycle` and the real `ProjectMailbox` — and asserts the
 * documented event shape (`protocol.md` §7 `chief_action_required`) rather than a boolean.
 *
 * Nothing is seeded: the two children are created by a real Chief dispatch, the required
 * child fails through the documented two-invalid-submissions path (no `settleRun(…,'failed')`
 * shortcut), and the sibling delivers through a real accepted `stage.submit`.
 *
 * Honest scope note: this file drives the coordinator's verdicts directly over the real
 * services (one layer below the wire), and it asserts the production guard that is wired in
 * the same place (`RunLifecycle.end` refusing `completed` while a live `join=all` child
 * exists). The production *trigger* is no longer missing: `createProjectExecution` builds a
 * `JoinCoordinator` and calls `onChildSettled` from the supervisor's settled hook
 * (`packages/core/src/execution.ts`), so a settled child updates its parent Chief Run in the
 * real daemon path. That path is proven end to end — scripted Runner child, real control
 * channel, no direct coordinator call — by the `join` drill in
 * `apps/daemon/test/assessment-dispatch.integration.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ChiefDispatchSpec,
  ContextSelection,
  Profile,
  ProviderInput,
  Run,
} from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  ConfigStore,
  JoinCoordinator,
  ModelGateway,
  Orchestrator,
  ProjectMailbox,
  SnapshotWriter,
  StageGate,
  professionalSpec,
  type GatewayTransport,
} from '../src/index.js';

const ROOT = '/tmp/agentdev-join-integration-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e50';
const MESSAGE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e62';
const PROVIDER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71';
const MODEL_ID = 'test-model';
const emptyScope = { readPaths: [], writePaths: [], operations: [], networkTargets: [] };

const offlineTransport: GatewayTransport = {
  complete: () => Promise.resolve({ ok: true, text: 'ok', inputTokens: 1, outputTokens: 1 }),
};

const selection: ContextSelection = {
  goal: 'converge the children',
  sourceRefs: [{ kind: 'message', id: MESSAGE_ID, version: '1' }],
  reasonPerSource: { [`message:${MESSAGE_ID}`]: 'the user asked for it' },
  featureRefs: [],
  codePaths: [],
  artifactRefs: [],
  excluded: [],
  unknowns: [],
  readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
};

const profile: Profile = {
  providerId: PROVIDER_ID,
  modelId: MODEL_ID,
  reasoning: 'medium',
  skills: [],
  toolSubset: ['read'],
  contextLimit: 64_000,
};

function provider(): ProviderInput {
  return {
    providerId: PROVIDER_ID,
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234',
    enabled: true,
    models: [
      {
        id: MODEL_ID,
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
        reasoningLevels: ['off', 'low', 'medium'],
        vision: false,
      },
    ],
  };
}

describe('join: parallel sibling failure on the real stack (AC-046)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let orchestrator: Orchestrator;
  let joins: JoinCoordinator;
  let stages: StageGate;
  let chief: Run;

  beforeEach(() => {
    dataDir = mkdtempSync(joinPath(tmpdir(), 'agentdev-join-integration-'));
    const globalDir = mkdtempSync(joinPath(tmpdir(), 'agentdev-join-integration-global-'));
    const projectRoot = mkdtempSync(joinPath(tmpdir(), 'agentdev-join-integration-project-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: joinPath(dataDir, 'pre.sqlite') },
    });
    const projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
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
      purpose: 'ship the join drill',
      level: 'L2',
      goal: 'ship the join drill',
      scope: emptyScope,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      budgetId: budget.id,
      policyRevision: 1,
    });
    const snapshots = new SnapshotWriter({ store });
    const config = ConfigStore.open({ globalDir, projectRoot, snapshots });
    config.upsertProvider(provider());
    for (const role of ['chief', 'backend', 'review'] as const) {
      config.update('global', { roleOverrides: { [role]: profile } });
    }
    const gateway = new ModelGateway({ config, snapshots, transport: offlineTransport });
    orchestrator = new Orchestrator({ store, config, snapshots, gateway });
    joins = new JoinCoordinator({ store });
    stages = new StageGate({ store });

    const spec: ChiefDispatchSpec = {
      kind: 'chief',
      workId: WORK_ID,
      role: 'chief',
      purpose: 'analysis',
      goal: 'assess the request',
      scope: emptyScope,
      stage: 'assist',
      contextSelection: selection,
      profileRevision: orchestrator.currentProfileRevision('chief'),
      requiredOutputs: ['stage.submit'],
      budgetAllocation: 20_000,
    };
    chief = orchestrator.dispatch({ spec }).run;
    orchestrator.beginAttempt(chief.id, { runnerId: 'runner-1' });
    chief = store.runs.find(chief.id) as Run;
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** One real professional child of the Chief Run (`join=all`, required by default). */
  function child(requiredChild = true): Run {
    return orchestrator.dispatch({
      spec: professionalSpec({
        workId: WORK_ID,
        role: 'backend',
        purpose: 'implementation',
        goal: 'implement the adapter',
        scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
        stage: 'develop',
        contextSelection: selection,
        profileRevision: orchestrator.currentProfileRevision('backend'),
        requiredOutputs: ['stage.submit'],
        requiredChild,
        joinPolicy: 'all',
        budgetAllocation: 4_000,
        parentRunId: chief.id,
      }),
    }).run;
  }

  it('keeps the sibling result, blocks the gate and still processes a new Chief instruction (AC-046)', async () => {
    const required = child();
    const sibling = child();
    expect(store.runs.find(chief.id)?.status).toBe('running');

    // The two children run in parallel; a terminal child may not let the Chief claim success.
    const requiredAttempt = orchestrator.beginAttempt(required.id).id;
    const siblingAttempt = orchestrator.beginAttempt(sibling.id).id;
    expect(() => orchestrator.settleRun(chief.id, 'completed')).toThrowError(
      /live join=all children/,
    );

    // The sibling delivers through the real gate and settles (the supervisor's own step).
    const accepted = stages.submit({
      runId: sibling.id,
      attemptId: siblingAttempt,
      epoch: 0,
      payload: {
        status: 'success',
        summary: 'the adapter is implemented',
        artifactRefs: [],
        evidenceRefs: [],
        changedPaths: ['packages/storage/src/adapter.ts'],
        findingIds: [],
        unknowns: [],
        requestedActions: [],
        readLedgerSeq: 1,
        readLedgerHash: 'b'.repeat(64),
      },
    });
    expect(accepted).toMatchObject({ accepted: true });
    orchestrator.settleRun(sibling.id, 'completed');

    const waiting = joins.onChildSettled(sibling.id);
    expect(waiting).toMatchObject({ kind: 'waiting', pending: [required.id] });
    expect(store.runs.find(chief.id)?.status).toBe('waiting_children');

    // The required child fails through the documented two-strike path: the first invalid
    // submission is a correction, the second is the `contract_violation`.
    const invalid = { status: 'success' };
    expect(
      stages.submit({ runId: required.id, attemptId: requiredAttempt, epoch: 0, payload: invalid }),
    ).toMatchObject({ accepted: false, code: 'VALIDATION_ERROR', correctionsRemaining: 1 });
    expect(
      stages.submit({ runId: required.id, attemptId: requiredAttempt, epoch: 0, payload: invalid }),
    ).toMatchObject({
      accepted: false,
      code: 'CONTRACT_VIOLATION',
      runStatus: 'contract_violation',
      rejections: 2,
    });
    expect(store.runs.find(required.id)?.status).toBe('contract_violation');

    // Every child is terminal now: the join is blocked on the required failure.
    const blocked = joins.onChildSettled(required.id);
    expect(blocked).toMatchObject({ kind: 'blocked', parentRunId: chief.id });
    if (blocked.kind !== 'blocked') throw new Error('expected a blocked join');
    expect(blocked.failedRequired.map((entry) => entry.runId)).toEqual([required.id]);
    // Sibling results survive the failure, and the whole picture travels with the todo.
    expect(blocked.children.map((entry) => entry.runId).sort()).toEqual(
      [required.id, sibling.id].sort(),
    );
    const siblingOutcome = blocked.children.find((entry) => entry.runId === sibling.id);
    expect(siblingOutcome?.stageResult).toMatchObject({
      status: 'success',
      summary: 'the adapter is implemented',
      readLedgerSeq: 1,
    });
    expect(siblingOutcome?.stageResult?.readLedgerHash).toBe('b'.repeat(64));
    expect(store.stageResults.list({ where: 'run_id = ?', params: [sibling.id] })).toHaveLength(1);
    // The parent stays waiting, so a new Chief instruction can still be processed.
    expect(store.runs.find(chief.id)?.status).toBe('waiting_children');
    expect(blocked.chiefTodo).not.toBe('');

    // `protocol.md` §7 `chief_action_required`: the todo carries the failing set and every
    // child's delivery, and recomputing the join does not file it twice (N-06).
    const todos = store.events
      .readAfter(0, { limit: 1_000 })
      .filter((event) => event.name === 'chief_action_required');
    expect(todos).toHaveLength(1);
    expect(todos[0]?.entityId).toBe(chief.id);
    expect(todos[0]?.data).toMatchObject({
      reason: 'required_child_failed',
      failed: [required.id],
      failedRequired: [required.id],
    });
    const reported = todos[0]?.data['children'] as unknown as readonly Record<string, unknown>[];
    expect(reported.map((entry) => entry['runId']).sort()).toEqual(
      [required.id, sibling.id].sort(),
    );
    const reportedSibling = reported.find((entry) => entry['runId'] === sibling.id);
    expect(reportedSibling).toMatchObject({
      role: 'backend',
      status: 'completed',
      requiredChild: true,
      join: 'all',
      stageResult: { status: 'success', summary: 'the adapter is implemented' },
    });
    const again = joins.onChildSettled(required.id);
    expect(again).toMatchObject({ kind: 'blocked' });
    expect(
      store.events
        .readAfter(0, { limit: 1_000 })
        .filter((event) => event.name === 'chief_action_required'),
    ).toHaveLength(1);

    // A new Chief instruction is still processed while the parent is blocked (AC-046).
    const mailbox = new ProjectMailbox();
    const admission = mailbox.submitCommand({
      subject: chief.id,
      operation: 'agent.dispatch',
      run: () =>
        orchestrator.dispatch({
          spec: professionalSpec({
            workId: WORK_ID,
            role: 'backend',
            purpose: 'implementation',
            goal: 'repair the failed adapter',
            scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
            stage: 'develop',
            contextSelection: selection,
            profileRevision: orchestrator.currentProfileRevision('backend'),
            requiredOutputs: ['stage.submit'],
            requiredChild: true,
            joinPolicy: 'all',
            budgetAllocation: 2_000,
            parentRunId: chief.id,
          }),
        }).run,
    });
    expect(admission.accepted).toBe(true);
    if (!admission.accepted) throw new Error('the mailbox refused the new instruction');
    const repair = await admission.completion;
    expect(repair.parentRunId).toBe(chief.id);
    expect(joins.state(chief.id)).toMatchObject({ kind: 'waiting', pending: [repair.id] });
    // The failed child was not rewritten or dropped by any of this.
    expect(store.runs.find(required.id)?.status).toBe('contract_violation');
    expect(store.stageResults.list({ where: 'run_id = ?', params: [sibling.id] })).toHaveLength(1);
  });
});
