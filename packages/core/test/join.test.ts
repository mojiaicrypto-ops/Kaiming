import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  ProtocolError,
  SnapshotWriter,
  StageGate,
  professionalSpec,
  type GatewayTransport,
} from '../src/index.js';

const ROOT = '/tmp/agentdev-join-root';
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

describe('join and structured delivery (AC-046, AC-047)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let orchestrator: Orchestrator;
  let config: ConfigStore;
  let joins: JoinCoordinator;
  let stages: StageGate;
  let chief: Run;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-join-'));
    const globalDir = mkdtempSync(join(tmpdir(), 'agentdev-join-global-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'agentdev-join-project-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
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
      purpose: 'ship WP-02',
      level: 'L2',
      goal: 'ship WP-02',
      scope: emptyScope,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      budgetId: budget.id,
      policyRevision: 1,
    });
    const snapshots = new SnapshotWriter({ store });
    config = ConfigStore.open({ globalDir, projectRoot, snapshots });
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

  function child(requiredChild = true, joinPolicy: 'none' | 'all' = 'all'): Run {
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
        joinPolicy,
        budgetAllocation: 4_000,
        parentRunId: chief.id,
      }),
    }).run;
  }

  function attemptOf(run: Run): string {
    return orchestrator.beginAttempt(run.id).id;
  }

  it('holds the parent in waiting_children and keeps every sibling result', async () => {
    const first = child();
    const second = child();
    expect(joins.onChildSettled(attemptAndSettle(first, 'completed').id).kind).toBe('waiting');
    expect(store.runs.find(chief.id)?.status).toBe('waiting_children');

    // The parent is waiting, not blocked: its mailbox answers, and it can still
    // dispatch more children while a sibling is outstanding (AC-046).
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
            goal: 'a second adapter',
            scope: { ...emptyScope, writePaths: ['packages/core/src'] },
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
    if (!admission.accepted) throw new Error('mailbox refused the command');
    const third = await admission.completion;
    expect(third.parentRunId).toBe(chief.id);
    // The waiting parent is unchanged by the mailbox command's own status: still
    // waiting for the outstanding sibling, now with one more child.
    const statusAdmission = mailbox.submitCommand({
      subject: chief.id,
      operation: 'join.status',
      run: () => joins.state(chief.id),
    });
    expect(statusAdmission.accepted).toBe(true);
    if (!statusAdmission.accepted) throw new Error('mailbox refused the status command');
    await expect(statusAdmission.completion).resolves.toMatchObject({
      kind: 'waiting',
      pending: [second.id, third.id],
    });

    joins.onChildSettled(attemptAndSettle(second, 'completed').id);
    const settled = joins.onChildSettled(attemptAndSettle(third, 'completed').id);
    expect(settled).toMatchObject({ kind: 'ready', parentRunId: chief.id });
    if (settled.kind !== 'ready') throw new Error('expected ready');
    // Every child's result survives the join.
    expect(settled.children.map((entry) => entry.runId).sort()).toEqual(
      [first.id, second.id, third.id].sort(),
    );
    expect(settled.children.every((entry) => entry.stageResult !== undefined)).toBe(true);
    expect(store.runs.find(chief.id)?.status).toBe('running');
  });

  it('does not hold the parent for joinPolicy=none, but still pages the Chief', () => {
    const fireAndForget = child(true, 'none');
    attemptAndSettle(fireAndForget, 'failed');
    const outcome = joins.onChildSettled(fireAndForget.id);
    expect(outcome).toMatchObject({ kind: 'ready', parentRunId: chief.id });
    // A `none` child never puts the Chief into waiting_children.
    expect(store.runs.find(chief.id)?.status).toBe('running');
    const todos = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'chief_action_required');
    expect(todos).toHaveLength(1);
    expect(todos[0]?.data).toMatchObject({
      reason: 'fire_and_forget_child_failed',
      failed: [fireAndForget.id],
    });

    // A mixed set only waits for the `all` child.
    const waiting = child(true, 'all');
    joins.onChildSettled(attemptAndSettle(child(true, 'none'), 'completed').id);
    const mixed = joins.state(chief.id);
    expect(mixed).toMatchObject({ kind: 'waiting', pending: [waiting.id] });
  });

  it('refuses delivery for a terminal Run, a stale epoch or a superseded attempt', () => {
    const run = child();
    const attemptId = orchestrator.beginAttempt(run.id).id;
    const valid = {
      status: 'success',
      summary: 'adapter implemented',
      artifactRefs: [],
      evidenceRefs: [],
      changedPaths: [],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 1,
      readLedgerHash: 'c'.repeat(64),
    };
    // A wrong epoch is a late/stale Attempt and writes nothing.
    expect(() =>
      stages.submit({ runId: run.id, attemptId, epoch: 7, payload: valid }),
    ).toThrowError(/not the current epoch/);
    expect(store.stageResults.list({ where: 'run_id = ?', params: [run.id] })).toHaveLength(0);

    // Once the Run is terminal, no further evidence is accepted (AC-047 finality).
    const rejected = stages.submit({ runId: run.id, attemptId, epoch: 0, payload: {} });
    expect(rejected).toMatchObject({ accepted: false, code: 'VALIDATION_ERROR' });
    stages.submit({ runId: run.id, attemptId, epoch: 0, payload: {} });
    expect(store.runs.find(run.id)?.status).toBe('contract_violation');
    expect(() =>
      stages.submit({ runId: run.id, attemptId, epoch: 0, payload: valid }),
    ).toThrowError(/accepts no further stage results/);
    expect(store.stageResults.list({ where: 'run_id = ?', params: [run.id] })).toHaveLength(0);
  });

  it('blocks the gate and pages the Chief when a required child fails', () => {
    const ok = child();
    const broken = child();
    joins.onChildSettled(attemptAndSettle(ok, 'completed').id);
    attemptAndSettle(broken, 'failed');

    const outcome = joins.onChildSettled(broken.id);
    expect(outcome).toMatchObject({ kind: 'blocked', parentRunId: chief.id });
    if (outcome.kind !== 'blocked') throw new Error('expected blocked');
    expect(outcome.failedRequired.map((entry) => entry.runId)).toEqual([broken.id]);
    // The successful sibling is retained and reported with the failure.
    expect(outcome.children.map((entry) => entry.runId).sort()).toEqual([ok.id, broken.id].sort());
    // The parent stays waiting so a new Chief message can be processed.
    expect(store.runs.find(chief.id)?.status).toBe('waiting_children');
    const todos = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'chief_action_required');
    expect(todos).toHaveLength(1);
    expect(todos[0]?.data).toMatchObject({ reason: 'required_child_failed' });
  });

  it('does not block on an optional child failure or before every child settles', () => {
    const optional = child(false);
    const required = child(true);
    attemptAndSettle(required, 'completed');
    joins.onChildSettled(required.id);
    const outcome = joins.onChildSettled(attemptAndSettle(optional, 'failed').id);
    expect(outcome).toMatchObject({ kind: 'ready' });
    expect(
      store.events.readAfter(0, { limit: 100 }).filter((e) => e.name === 'chief_action_required'),
    ).toHaveLength(0);
  });

  it('accepts one correction and then records a contract violation (AC-047)', () => {
    const run = child();
    const attemptId = attemptOf(run);
    const invalid = { status: 'success' }; // missing the required summary
    const first = stages.submit({ runId: run.id, attemptId, epoch: 0, payload: invalid });
    expect(first).toMatchObject({ accepted: false, code: 'VALIDATION_ERROR' });
    const second = stages.submit({ runId: run.id, attemptId, epoch: 0, payload: invalid });
    expect(second).toMatchObject({
      accepted: false,
      code: 'CONTRACT_VIOLATION',
      runStatus: 'contract_violation',
      rejections: 2,
    });
    expect(store.runs.find(run.id)?.status).toBe('contract_violation');
    const rejections = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.data['outcome'] === 'schema_invalid');
    expect(rejections).toHaveLength(2);
    expect(rejections.every((event) => event.name === 'stage.failed')).toBe(true);
    expect(store.events.readAfter(0, { limit: 100 }).some((e) => e.name === 'run.ended')).toBe(
      true,
    );
    // A spoken success never stands in for the Schema.
    expect(store.stageResults.list({ where: 'run_id = ?', params: [run.id] })).toHaveLength(0);
  });

  it('records a valid stage result without letting a client claim another Run', () => {
    const run = child();
    const attemptId = attemptOf(run);
    const accepted = stages.submit({
      runId: run.id,
      attemptId,
      epoch: 0,
      payload: {
        status: 'success',
        summary: 'adapter implemented',
        artifactRefs: [],
        evidenceRefs: [],
        changedPaths: ['packages/storage/src/store.ts'],
        findingIds: [],
        unknowns: [],
        requestedActions: [],
        readLedgerSeq: 7,
        readLedgerHash: 'a'.repeat(64),
      },
    });
    expect(accepted.accepted).toBe(true);
    if (!accepted.accepted) throw new Error('expected acceptance');
    expect(accepted.row).toMatchObject({ runId: run.id, attemptId, readLedgerSeq: 7 });

    // Ownership fields cannot be smuggled through the payload.
    expect(() =>
      stages.submit({
        runId: run.id,
        attemptId,
        epoch: 0,
        payload: { status: 'success', summary: 'x', runId: chief.id },
      }),
    ).toThrowError(ProtocolError);
    // Nor can an attempt of another Run deliver for this one.
    const otherAttempt = attemptOf(child());
    expect(() =>
      stages.submit({
        runId: run.id,
        attemptId: otherAttempt,
        epoch: 0,
        payload: { status: 'success', summary: 'x' },
      }),
    ).toThrowError(/does not belong to this Run/);
  });

  /** Starts the child, marks it `running`, submits a result and settles it. */
  function attemptAndSettle(run: Run, status: 'completed' | 'failed'): Run {
    const attemptId = orchestrator.beginAttempt(run.id).id;
    void attemptId;
    stages.submit({
      runId: run.id,
      attemptId,
      epoch: 0,
      payload: {
        status: status === 'completed' ? 'success' : 'failed',
        summary: `child ${status}`,
        artifactRefs: [],
        evidenceRefs: [],
        changedPaths: [],
        findingIds: [],
        unknowns: [],
        requestedActions: [],
        readLedgerSeq: 1,
        readLedgerHash: 'b'.repeat(64),
      },
    });
    return orchestrator.settleRun(run.id, status);
  }
});
