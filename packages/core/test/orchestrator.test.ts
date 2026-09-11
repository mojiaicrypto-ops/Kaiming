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
  ModelGateway,
  Orchestrator,
  ProtocolError,
  SnapshotWriter,
  professionalSpec,
  type GatewayTransport,
} from '../src/index.js';

const ROOT = '/tmp/agentdev-orchestrator-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e50';
const OTHER_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e51';
const MESSAGE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e62';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70';
const OTHER_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e72';
const PROVIDER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71';
const AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e81';
const MODEL_ID = 'test-model';
const emptyScope = { readPaths: [], writePaths: [], operations: [], networkTargets: [] };

const selection: ContextSelection = {
  goal: 'route the work',
  sourceRefs: [{ kind: 'message', id: MESSAGE_ID, version: '1' }],
  reasonPerSource: { [`message:${MESSAGE_ID}`]: 'the user asked for it' },
  featureRefs: [],
  codePaths: [],
  artifactRefs: [],
  excluded: [],
  unknowns: [],
  readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
};

/** A transport that never reaches a network; WP-02 only proves the dispatch path. */
const offlineTransport: GatewayTransport = {
  complete: () => Promise.resolve({ ok: true, text: 'ok', inputTokens: 1, outputTokens: 1 }),
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

function profile(contextLimit = 64_000): Profile {
  return {
    providerId: PROVIDER_ID,
    modelId: MODEL_ID,
    reasoning: 'medium',
    skills: [],
    toolSubset: ['read'],
    contextLimit,
  };
}

describe('chief orchestration (AC-045, AC-044, AC-082)', () => {
  let dataDir: string;
  let globalDir: string;
  let projectRoot: string;
  let store: ProjectStore;
  let snapshots: SnapshotWriter;
  let config: ConfigStore;
  let orchestrator: Orchestrator;
  let projectId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-orch-'));
    globalDir = mkdtempSync(join(tmpdir(), 'agentdev-orch-global-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'agentdev-orch-project-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(ROOT);
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
    for (const [id, status] of [
      [WORK_ID, 'running'],
      [OTHER_WORK_ID, 'queued'],
    ] as const) {
      store.works.insert({
        id,
        projectId,
        intent: 'delivery',
        purpose: 'ship the feature',
        level: 'L2',
        goal: 'ship WP-02',
        scope: emptyScope,
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
        status,
        blockerIds: [],
        budgetId: budget.id,
        policyRevision: 1,
      });
    }

    // One Task per Work, so a professional spec can bind its work item and a
    // cross-Work task can be refused.
    for (const [id, workId] of [
      [TASK_ID, WORK_ID],
      [OTHER_TASK_ID, OTHER_WORK_ID],
    ] as const) {
      store.tasks.insert({
        id,
        projectId,
        workId,
        planRef: { id, version: 1, hash: 'c'.repeat(64) },
        role: 'backend',
        dependsOn: [],
        dependencyManifestRefs: [],
        scope: emptyScope,
        stage: 'develop',
        acceptanceIds: ['AC-045'],
      });
    }

    snapshots = new SnapshotWriter({ store });
    config = ConfigStore.open({ globalDir, projectRoot, snapshots });
    config.upsertProvider(provider());
    for (const role of ['chief', 'backend', 'review'] as const) {
      config.update('global', { roleOverrides: { [role]: profile() } });
    }
    const gateway = new ModelGateway({ config, snapshots, transport: offlineTransport });
    orchestrator = new Orchestrator({ store, config, snapshots, gateway });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function chiefSpec(overrides: Partial<ChiefDispatchSpec> = {}): ChiefDispatchSpec {
    return {
      kind: 'chief',
      workId: WORK_ID,
      role: 'chief',
      purpose: 'analysis',
      goal: 'assess the request',
      scope: { ...emptyScope, readPaths: ['docs'] },
      stage: 'assist',
      contextSelection: selection,
      profileRevision: orchestrator.currentProfileRevision('chief'),
      requiredOutputs: ['stage.submit'],
      budgetAllocation: 10_000,
      ...overrides,
    };
  }

  function chiefRun(): Run {
    return orchestrator.dispatch({ spec: chiefSpec() }).run;
  }

  function backendSpec(parentRunId: string, overrides: Record<string, unknown> = {}) {
    return professionalSpec({
      workId: WORK_ID,
      taskId: TASK_ID,
      role: 'backend',
      purpose: 'implementation',
      goal: 'implement the storage adapter',
      scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
      stage: 'develop',
      contextSelection: selection,
      profileRevision: orchestrator.currentProfileRevision('backend'),
      requiredOutputs: ['stage.submit'],
      requiredChild: true,
      joinPolicy: 'all',
      budgetAllocation: 4_000,
      parentRunId,
      ...overrides,
    } as never);
  }

  it('records an immutable assessment with the routing evidence', () => {
    const row = orchestrator.assess({
      workId: WORK_ID,
      payload: {
        intent: 'delivery',
        goal: 'ship WP-02',
        scope: emptyScope,
        level: 'L2',
        semanticImpact: false,
        riskFlags: [],
        uncertainties: ['provider behaviour unknown'],
        policyRevision: 1,
        reason: 'multi-file change with a storage migration',
      },
    });
    expect(row).toMatchObject({ workId: WORK_ID, level: 'L2', intent: 'delivery' });
    const events = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'assessment.saved');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ workId: WORK_ID, level: 'L2' });
    // A re-assessment is a new row, never an update.
    const again = orchestrator.assess({
      workId: WORK_ID,
      payload: {
        intent: 'delivery',
        goal: 'ship WP-02',
        scope: emptyScope,
        level: 'L1',
        semanticImpact: false,
        riskFlags: [],
        uncertainties: [],
        policyRevision: 1,
        reason: 'narrowed after inspection',
      },
    });
    expect(again.id).not.toBe(row.id);
    expect(store.assessments.list({ orderBy: 'created_at ASC' })).toHaveLength(2);
  });

  it('requires explicit authorization for L3 and refuses an unknown Work', () => {
    expect(() =>
      orchestrator.assess({
        workId: WORK_ID,
        payload: {
          intent: 'delivery',
          goal: 'ship WP-02',
          scope: emptyScope,
          level: 'L3',
          semanticImpact: true,
          riskFlags: ['lockdown'],
          uncertainties: [],
          policyRevision: 1,
          reason: 'touches the authentication boundary',
        },
      }),
    ).toThrowError(ProtocolError);
    expect(store.assessments.list()).toHaveLength(0);
    expect(() =>
      orchestrator.assess({
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99',
        payload: {
          intent: 'delivery',
          goal: 'x',
          scope: emptyScope,
          level: 'L2',
          semanticImpact: false,
          riskFlags: [],
          uncertainties: [],
          policyRevision: 1,
          reason: 'y',
        },
      }),
    ).toThrowError(/does not exist/);
  });

  it('freezes config, context and dispatch before queueing the Run', () => {
    const { run, dispatchSnapshot } = orchestrator.dispatch({ spec: chiefSpec() });
    expect(run).toMatchObject({
      workId: WORK_ID,
      role: 'chief',
      purpose: 'analysis',
      stage: 'assist',
      status: 'queued',
      join: 'none',
      childIds: [],
      budgetAllocation: 10_000,
    });
    // All three references are real, immutable snapshot rows of the right type.
    expect(snapshots.read(run.configSnapshotId)?.type).toBe('config');
    expect(snapshots.read(run.contextSnapshotId)?.type).toBe('context');
    const frozen = snapshots.read(run.dispatchSnapshotId);
    expect(frozen?.type).toBe('dispatch');
    // The DispatchSnapshot's own hash is the identity of the row it lives in.
    expect(dispatchSnapshot.hash).toBe(run.dispatchSnapshotId);
    expect(frozen?.payload).toMatchObject({
      hash: run.dispatchSnapshotId,
      profileRevision: orchestrator.currentProfileRevision('chief'),
    });
    expect(() =>
      store.db
        .prepare('UPDATE snapshot SET payload = ? WHERE hash = ?')
        .run('{}', run.dispatchSnapshotId),
    ).toThrowError(/immutable/);

    const queued = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'run.queued');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.entityId).toBe(run.id);
  });

  it('creates a professional Run only as a direct child of the Chief Run', () => {
    const chief = chiefRun();
    const child = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    expect(child).toMatchObject({
      role: 'backend',
      parentRunId: chief.id,
      status: 'queued',
      requiredChild: true,
      join: 'all',
    });
    expect(store.runs.find(chief.id)?.childIds).toEqual([child.id]);
    expect(child.taskId).toBe(TASK_ID);

    // A professional Run may not be the parent of another Run.
    expect(() => orchestrator.dispatch({ spec: backendSpec(child.id) })).toThrowError(
      /only direct Chief children/,
    );
    expect(store.runs.list({ where: 'parent_run_id = ?', params: [child.id] })).toHaveLength(0);

    // A chief of another Work may not parent a child in this Work either.
    const foreignChief = orchestrator.dispatch({
      spec: chiefSpec({ workId: OTHER_WORK_ID }),
    }).run;
    expect(() =>
      orchestrator.dispatch({
        spec: professionalSpec({
          ...(backendSpec(foreignChief.id) as never as Record<string, unknown>),
          workId: WORK_ID,
        } as never),
      }),
    ).toThrowError(/only direct Chief children/);
  });

  it('binds a professional Run to a task of the same Work', () => {
    const chief = chiefRun();
    const spec = professionalSpec({
      ...(backendSpec(chief.id) as never as Record<string, unknown>),
      taskId: OTHER_TASK_ID,
    } as never);
    expect(() => orchestrator.dispatch({ spec })).toThrowError(/does not belong to Work/);
    expect(store.runs.list({ where: 'parent_run_id = ?', params: [chief.id] })).toHaveLength(0);
  });

  it('refuses a stale profileRevision instead of running an unexpected model', () => {
    const chief = chiefRun();
    const spec = backendSpec(chief.id, { profileRevision: 0 });
    expect(() => orchestrator.dispatch({ spec })).toThrowError(/is stale/);
    expect(store.runs.list({ where: 'parent_run_id = ?', params: [chief.id] })).toHaveLength(0);
  });

  it('refuses a dispatch that the role may not carry or that the budget cannot fund', () => {
    const chief = chiefRun();
    expect(() =>
      orchestrator.dispatch({
        spec: professionalSpec({
          ...(backendSpec(chief.id) as never as Record<string, unknown>),
          purpose: 'test',
        } as never),
      }),
    ).toThrowError(/may not carry purpose test/);

    // The parent Run reserved 10_000; three 4_000 requests cannot all fit.
    orchestrator.dispatch({ spec: backendSpec(chief.id) });
    orchestrator.dispatch({ spec: backendSpec(chief.id) });
    expect(() => orchestrator.dispatch({ spec: backendSpec(chief.id) })).toThrowError(
      /live children of Run .* hold 8000 of 10000/,
    );
    expect(store.runs.list({ where: 'parent_run_id = ?', params: [chief.id] })).toHaveLength(2);
  });

  it('blocks the dispatch when the role has no usable model', () => {
    const chief = chiefRun();
    // `test` has no profile in this fixture, so there is no model to run on.
    const spec = professionalSpec({
      ...(backendSpec(chief.id) as never as Record<string, unknown>),
      role: 'test',
      purpose: 'test',
    } as never);
    expect(() => orchestrator.dispatch({ spec })).toThrowError(/has no usable model/);
    expect(store.runs.list({ where: 'parent_run_id = ?', params: [chief.id] })).toHaveLength(0);
  });

  it('restores the narrow frozen scope after a restart (AC-082)', () => {
    const narrow = { ...emptyScope, readPaths: ['docs'], writePaths: ['packages/core/src'] };
    const run = orchestrator.dispatch({
      spec: chiefSpec({ scope: narrow }),
      requiredOutputSchemas: [{ kind: 'stage.submit', schemaVersion: 1 }],
    }).run;

    // The Work scope later widens; the frozen DispatchSnapshot still wins.
    const work = store.works.find(WORK_ID);
    if (work === undefined) throw new Error('work fixture missing');
    store.works.update(
      work.id,
      { scope: { ...emptyScope, readPaths: ['**'], writePaths: ['**'], operations: ['bash'] } },
      work.version,
    );

    const view = orchestrator.recoveryView(run.id);
    expect(view.effectiveScope).toEqual(narrow);
    expect(view.effectiveScope.writePaths).toEqual(['packages/core/src']);
    expect(view.effectiveScope.writePaths).not.toContain('**');
    expect(view.requiredOutputSchemas).toEqual([{ kind: 'stage.submit', schemaVersion: 1 }]);
    expect(view.profile.effectiveContextLimit).toBe(64_000);

    // A Run whose snapshot is gone cannot be resumed on a guess.
    const orphan = store.runs.insert({
      workId: WORK_ID,
      role: 'chief',
      purpose: 'analysis',
      stage: 'assist',
      status: 'queued',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: run.configSnapshotId,
      contextSnapshotId: run.contextSnapshotId,
      dispatchSnapshotId: 'f'.repeat(64),
      budgetAllocation: 0,
    });
    expect(() => orchestrator.recoveryView(orphan.id)).toThrowError(/is missing/);
  });

  it('reserves the Work budget on dispatch and releases it when the Run ends', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    expect(budgetRow.tokensReserved).toBe(0);

    const run = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 60_000 }) }).run;
    expect(store.budgets.find(budgetRow.id)?.tokensReserved).toBe(60_000);
    // The second dispatch cannot double-spend the same budget, and a Core-built
    // chief spec reports the documented error code rather than a Schema violation.
    expect(() =>
      orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 60_000 }) }),
    ).toThrowError(expect.objectContaining({ code: 'BUDGET_EXCEEDED' }));
    // A chief spec over the whole Work budget is refused before anything is written.
    expect(() =>
      orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 1_000_000 }) }),
    ).toThrowError(expect.objectContaining({ code: 'BUDGET_EXCEEDED' }));
    expect(store.runs.list().filter((row) => row.budgetAllocation === 60_000)).toHaveLength(1);

    orchestrator.beginAttempt(run.id);
    orchestrator.settleRun(run.id, 'completed');
    expect(store.budgets.find(budgetRow.id)?.tokensReserved).toBe(0);
    const ended = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'run.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.data).toMatchObject({ outcome: 'completed', releasedTokens: 60_000 });
    // `run.started` is the documented name for the executing transition.
    expect(store.events.readAfter(0, { limit: 100 }).some((e) => e.name === 'run.started')).toBe(
      true,
    );
  });

  it('applies the authorized Run parameter layer when freezing a profile', () => {
    const run = orchestrator.dispatch({
      spec: chiefSpec(),
      runParams: { reasoning: 'low', contextLimit: 10_000 },
    }).run;
    const frozen = config.readFrozen(run.configSnapshotId);
    expect(frozen?.profile.reasoning).toBe('low');
    expect(frozen?.profile.contextLimit).toBe(10_000);
    // Provenance survives the restart path.
    expect(frozen?.sources).toMatchObject({ reasoning: 'run', contextLimit: 'run' });
    expect(orchestrator.recoveryView(run.id).profile.profile.reasoning).toBe('low');
  });

  it('refuses an assessment below the level the routing rules require', () => {
    expect(() =>
      orchestrator.assess({
        workId: WORK_ID,
        payload: {
          intent: 'delivery',
          goal: 'ship WP-02',
          scope: emptyScope,
          level: 'L2',
          semanticImpact: false,
          riskFlags: ['securityBoundary'],
          uncertainties: [],
          policyRevision: 1,
          reason: 'touches the security boundary',
        },
      }),
    ).toThrowError(/routing rules require L3/);
    expect(store.assessments.list()).toHaveLength(0);

    const row = orchestrator.assess({
      workId: WORK_ID,
      payload: {
        intent: 'delivery',
        goal: 'ship WP-02',
        scope: emptyScope,
        level: 'L3',
        semanticImpact: true,
        authorizationRef: AUTHORIZATION_ID,
        riskFlags: ['securityBoundary'],
        uncertainties: [],
        policyRevision: 1,
        reason: 'user authorized the boundary change',
      },
    });
    expect(row.level).toBe('L3');
    const saved = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'assessment.saved');
    expect(saved[0]?.data).toMatchObject({ decidedLevel: 'L3' });
  });

  it("frees a settled child's share of the parent allocation (M-01)", () => {
    const parent = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 20_000 }) }).run;
    const spec = (goal: string) =>
      professionalSpec({
        workId: WORK_ID,
        role: 'backend',
        purpose: 'implementation',
        goal,
        scope: emptyScope,
        stage: 'develop',
        contextSelection: selection,
        profileRevision: orchestrator.currentProfileRevision('backend'),
        requiredOutputs: ['stage.submit'],
        requiredChild: true,
        joinPolicy: 'all',
        budgetAllocation: 10_000,
        parentRunId: parent.id,
      });
    const first = orchestrator.dispatch({ spec: spec('first') }).run;
    const second = orchestrator.dispatch({ spec: spec('second') }).run;
    // Both live children fill the parent's allocation, so a third cannot fit.
    expect(() => orchestrator.dispatch({ spec: spec('third') })).toThrowError(/live children/);
    orchestrator.beginAttempt(first.id);
    orchestrator.settleRun(first.id, 'completed');
    // The settled child released its share, so the third child fits again.
    const third = orchestrator.dispatch({ spec: spec('third') }).run;
    expect(third.parentRunId).toBe(parent.id);
    expect(second.parentRunId).toBe(parent.id);
  });

  it('charges measured usage and records an unmeasured release honestly (M-02)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const run = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 40_000 }) }).run;
    orchestrator.beginAttempt(run.id);
    orchestrator.settleRun(run.id, 'completed');
    // Without a provider usage report the release is recorded as unmeasured.
    const unmeasured = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'run.ended')[0];
    expect(unmeasured?.data).toMatchObject({ usageMeasured: false, tokensUsed: 0 });

    const measured = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 40_000 }) }).run;
    orchestrator.beginAttempt(measured.id);
    orchestrator.lifecycle.settle(measured.id, 'completed', { tokensUsed: 12_000, measured: true });
    const budget = store.budgets.find(budgetRow.id);
    expect(budget?.tokensUsed).toBe(12_000);
    expect(budget?.tokensReserved).toBe(0);
    const ended = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'run.ended')
      .at(-1);
    expect(ended?.data).toMatchObject({ usageMeasured: true, tokensUsed: 12_000 });
  });

  it('turns an agent dispatch request into a chief todo, never a grandchild Run', () => {
    const chief = chiefRun();
    const child = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const result = orchestrator.requestDispatch({
      runId: child.id,
      workId: WORK_ID,
      reason: 'the adapter needs behaviour verification',
      requestedRole: 'test',
      purpose: 'test',
      goal: 'verify the adapter',
      stage: 'test',
      requiredOutputs: ['stage.submit'],
      budgetAllocation: 2_000,
    });
    expect(result.disposition).toBe('chief_action_required');
    expect(store.runs.list({ where: 'parent_run_id = ?', params: [child.id] })).toHaveLength(0);
    const todo = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'chief_action_required');
    expect(todo).toHaveLength(1);
    expect(todo[0]?.entityId).toBe(chief.id);
    expect(todo[0]?.data).toMatchObject({
      requestedBy: child.id,
      role: 'test',
      purpose: 'test',
      requestReason: 'the adapter needs behaviour verification',
    });
    // The todo is idempotent per operationId and describes the Chief Run.
    const deduped = orchestrator.requestDispatch({
      runId: child.id,
      requestedRole: 'review',
      goal: 'review the adapter',
      operationId: 'op-1',
    });
    const again = orchestrator.requestDispatch({
      runId: child.id,
      requestedRole: 'review',
      goal: 'review the adapter',
      operationId: 'op-1',
    });
    expect(again.chiefTodo).toBe(deduped.chiefTodo);
    const all = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'chief_action_required');
    expect(all).toHaveLength(2);
    const chiefRunId = child.parentRunId;
    if (chiefRunId === undefined) throw new Error('child has no Chief parent');
    const chiefRow = store.runs.find(chiefRunId);
    expect(all[1]?.entityId).toBe(chiefRunId);
    expect(all[1]?.entityVersion).toBe(chiefRow?.version);

    // A Run that already ended cannot file more Chief todos.
    orchestrator.beginAttempt(child.id);
    orchestrator.settleRun(child.id, 'failed');
    expect(() =>
      orchestrator.requestDispatch({
        runId: child.id,
        requestedRole: 'review',
        goal: 'too late',
      }),
    ).toThrowError(/cannot request more work/);

    // Asking another Run for work, or dispatching from the Chief, is refused.
    expect(() =>
      orchestrator.requestDispatch({
        runId: child.id,
        requestedRole: 'test',
        goal: 'verify',
        stage: 'test',
        parentRunId: WORK_ID,
      }),
    ).toThrowError(/own Chief Run/);
    expect(() =>
      orchestrator.requestDispatch({
        runId: chief.id,
        requestedRole: 'backend',
        goal: 'x',
        stage: 'develop',
      }),
    ).toThrowError(/dispatches directly/);
  });
});
