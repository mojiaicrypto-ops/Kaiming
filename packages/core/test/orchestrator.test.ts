import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AssessmentPayload,
  ChiefDispatchSpec,
  ContextSelection,
  Profile,
  ProviderInput,
  Run,
  Scope,
} from '@agentdev/contracts';
import {
  ProjectStore as Store,
  projectIdFromRoot,
  sha256,
  withTransaction,
  type ProjectStore,
} from '@agentdev/storage';
import {
  ConfigStore,
  ModelGateway,
  Orchestrator,
  ProtocolError,
  SnapshotWriter,
  assertDerivableScope,
  assertPlanWithinAuthority,
  deliveryRoute,
  nextDeliveryStage,
  parseDeliveredPlanDocument,
  professionalSpec,
  type GatewayTransport,
  type ProfessionalSpecDraft,
} from '../src/index.js';

const ROOT = '/tmp/agentdev-orchestrator-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e50';
const OTHER_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e51';
const MESSAGE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e62';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70';
const OTHER_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e72';
const PROVIDER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71';
const AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e81';
const FOREIGN_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e82';
const REVOKED_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e83';
const L3_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e52';
/** The Chief Run `WORK_ID`'s L3 assessments are submitted from (AC-011). */
const WORK_CHIEF_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e91';
const L3_UNAUTHORIZED_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e53';
const L3_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e84';
const NONE_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e54';
const WRITE_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e85';
const NETWORK_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e86';
const READONLY_WRITE_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e87';
const DEPLOY_READ_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e88';
const NONE_GIT_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e89';
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

    // A `none` Work may not hand out write authority (`data.md` §2).
    const noneBudget = store.budgets.insert({
      projectId,
      workId: NONE_WORK_ID,
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
      id: NONE_WORK_ID,
      projectId,
      intent: 'assist',
      purpose: 'answer the question',
      level: 'none',
      goal: 'explain the routing rules',
      scope: emptyScope,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      budgetId: noneBudget.id,
      policyRevision: 1,
    });

    // One L3 Work that carries its authorization, and one that does not: creating a
    // Run for the latter must be refused (R11-03).
    for (const [id, authorizationRef] of [
      [L3_WORK_ID, L3_AUTHORIZATION_ID],
      [L3_UNAUTHORIZED_WORK_ID, undefined],
    ] as const) {
      const l3Budget = store.budgets.insert({
        projectId,
        workId: id,
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
        id,
        projectId,
        intent: 'operation',
        purpose: 'operate the environment',
        level: 'L3',
        goal: 'deploy the release',
        scope: { ...emptyScope, operations: ['deploy'] },
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
        ...(authorizationRef === undefined ? {} : { authorizationRef }),
        status: 'running',
        blockerIds: [],
        budgetId: l3Budget.id,
        policyRevision: 1,
      });
    }
    store.authorizations.insert({
      id: L3_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: L3_WORK_ID,
      goal: 'authorized deployment',
      scope: { ...emptyScope, operations: ['deploy'] },
      operations: ['deploy'],
      acceptedAt: new Date().toISOString(),
    });

    // The L3 route needs a real authorization row: the Core verifies that the
    // referenced authorization exists (`data.md` §2, DC-63).
    store.authorizations.insert({
      id: AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorized environment operation',
      scope: emptyScope,
      operations: ['deploy'],
      acceptedAt: new Date().toISOString(),
    });

    // A grant whose envelope covers one workspace path, for the path-coverage checks.
    store.authorizations.insert({
      id: WRITE_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorized workspace write',
      scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
      operations: ['write'],
      acceptedAt: new Date().toISOString(),
    });

    // R15-01: a read-only grant whose path envelope covers a write path.
    store.authorizations.insert({
      id: READONLY_WRITE_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorized to read a subtree',
      scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
      operations: ['read'],
      acceptedAt: new Date().toISOString(),
    });
    // A deploy grant whose read envelope covers a path, with no read operation.
    store.authorizations.insert({
      id: DEPLOY_READ_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorized deployment',
      scope: { ...emptyScope, readPaths: ['docs'] },
      operations: ['deploy'],
      acceptedAt: new Date().toISOString(),
    });
    // A git grant bound to the none-level Work, to prove the write gate is
    // independent of the grant.
    store.authorizations.insert({
      id: NONE_GIT_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: NONE_WORK_ID,
      goal: 'authorized git use',
      scope: emptyScope,
      operations: ['git'],
      acceptedAt: new Date().toISOString(),
    });

    // A grant that lists a network target but carries no `network` operation.
    store.authorizations.insert({
      id: NETWORK_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorized to read from a host',
      scope: { ...emptyScope, networkTargets: ['10.0.0.5'] },
      operations: ['read'],
      acceptedAt: new Date().toISOString(),
    });

    // Authorities the Core must reject: another Work's grant, and a revoked one.
    store.authorizations.insert({
      id: FOREIGN_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: OTHER_WORK_ID,
      goal: 'authorized for a different work',
      scope: emptyScope,
      operations: ['deploy'],
      acceptedAt: new Date().toISOString(),
    });
    store.authorizations.insert({
      id: REVOKED_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      workId: WORK_ID,
      goal: 'revoked authority',
      scope: emptyScope,
      operations: ['deploy'],
      acceptedAt: new Date().toISOString(),
      revokedAt: new Date().toISOString(),
    });

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
    for (const role of ['chief', 'backend', 'review', 'planning'] as const) {
      config.update('global', { roleOverrides: { [role]: profile() } });
    }
    const gateway = new ModelGateway({ config, snapshots, transport: offlineTransport });
    orchestrator = new Orchestrator({ store, config, snapshots, gateway });

    // `WORK_ID` also carries the Chief Run an L3 assessment is submitted from, so the
    // confirmation question has a real producing Run to attribute its Artifact to.
    store.runs.insert({
      id: WORK_CHIEF_RUN_ID,
      projectId,
      workId: WORK_ID,
      role: 'chief',
      purpose: 'analysis',
      stage: 'assess',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: sha256(`l3-config:${WORK_ID}`),
      contextSnapshotId: sha256(`l3-context:${WORK_ID}`),
      dispatchSnapshotId: sha256(`l3-dispatch:${WORK_ID}`),
      budgetAllocation: 10_000,
    });

    // `workflow.md` §2.3 / AC-011: an L3 Work admits no professional Run until the
    // explicit confirmation is accepted. The L3 fixtures below are the state *after*
    // that interaction (the user confirmed the high-risk delivery), so the
    // authorization tests they exist for still exercise their own rule; the
    // confirmation interaction itself is covered by
    // `apps/web/test/l3-confirmation.integration.test.ts`.
    for (const workId of [L3_WORK_ID, L3_UNAUTHORIZED_WORK_ID]) {
      store.runs.insert({
        id: store.newId(),
        projectId,
        workId,
        role: 'chief',
        purpose: 'analysis',
        stage: 'assess',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: sha256(`l3-config:${workId}`),
        contextSnapshotId: sha256(`l3-context:${workId}`),
        dispatchSnapshotId: sha256(`l3-dispatch:${workId}`),
        budgetAllocation: 10_000,
      });
      const confirmation = orchestrator.confirmations.raise({
        workId,
        goal: 'confirmed L3 fixture',
        riskFlags: ['securityBoundary'],
        reason: 'the fixture represents an L3 delivery the user already confirmed',
        scope: emptyScope,
      });
      orchestrator.confirmations.resolve({
        decisionId: confirmation.decisionId,
        choice: 'confirm',
      });
    }
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

  function assessmentPayloadFixture(): AssessmentPayload {
    return {
      intent: 'delivery',
      goal: 'ship WP-02',
      scope: emptyScope,
      level: 'L2',
      semanticImpact: false,
      riskFlags: [],
      uncertainties: [],
      policyRevision: 1,
      reason: 'L2 delivery work',
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

  it('applies the documented routing floor from the payload alone (R9-01, DC-62)', () => {
    const lower =
      (payload: Partial<AssessmentPayload>): (() => unknown) =>
      () =>
        orchestrator.assess({
          workId: WORK_ID,
          payload: { ...assessmentPayloadFixture(), level: 'L2', ...payload },
        });

    // The document states the criteria in Chinese prose; those terms must select
    // the same lockdown risk as the camelCase flag.
    expect(lower({ riskFlags: ['安全边界'] })).toThrowError(/routing rules require L3/);
    expect(lower({ riskFlags: ['数据删除'] })).toThrowError(/routing rules require L3/);
    expect(lower({ riskFlags: ['security-boundary'] })).toThrowError(/routing rules require L3/);
    expect(lower({ riskFlags: ['securityBoundary'] })).toThrowError(/routing rules require L3/);

    // An operation that touches a running environment is L3 because of its own
    // scope, not because the Work row happens to be L3.
    expect(
      lower({
        intent: 'operation',
        scope: { ...emptyScope, operations: ['deploy'] },
      }),
    ).toThrowError(/routing rules require L3/);
    expect(
      lower({
        intent: 'operation',
        scope: { ...emptyScope, networkTargets: ['https://example.test'] },
      }),
    ).toThrowError(/routing rules require L3/);

    // A delivery cannot be routed below L2 while it claims a semantic impact.
    expect(lower({ intent: 'delivery', semanticImpact: true, level: 'L1' })).toThrowError(
      /routing rules require L2/,
    );

    // The documented Chinese criterion routes to L3 and is accepted with authority.
    // The assessment arrives from the Work's Chief Run, which is what raises the
    // explicit L3 confirmation (AC-011).
    const accepted = orchestrator.assess({
      workId: WORK_ID,
      runId: WORK_CHIEF_RUN_ID,
      payload: {
        ...assessmentPayloadFixture(),
        level: 'L3',
        semanticImpact: true,
        riskFlags: ['安全边界'],
        authorizationRef: AUTHORIZATION_ID,
      },
    });
    expect(accepted.level).toBe('L3');
  });

  it('fails closed on unknown risk flags and on authorization provenance (R10-01/R10-02)', () => {
    const deliver =
      (overrides: Partial<AssessmentPayload>): unknown =>
      () =>
        orchestrator.assess({
          workId: WORK_ID,
          payload: { ...assessmentPayloadFixture(), ...overrides },
        });

    // An unregistered flag must not be read as "no risk".
    expect(deliver({ riskFlags: ['securityBoundry'] })).toThrowError(/unknown riskFlags/);
    expect(deliver({ riskFlags: ['安全'] })).toThrowError(/unknown riskFlags/);
    expect(deliver({ riskFlags: ['operation_touches_environment'] })).toThrowError(
      /unknown riskFlags/,
    );
    // The document's own combined wording is part of the accepted vocabulary.
    expect(deliver({ riskFlags: ['数据删除/迁移'] })).toThrowError(/routing rules require L3/);
    expect(deliver({ riskFlags: ['部署/发布'] })).toThrowError(/routing rules require L3/);

    // Authorization provenance: foreign Work, revoked, and fabricated refs.
    const l3 =
      (authorizationRef: string): unknown =>
      () =>
        orchestrator.assess({
          workId: WORK_ID,
          payload: {
            ...assessmentPayloadFixture(),
            level: 'L3',
            semanticImpact: true,
            riskFlags: ['安全边界'],
            authorizationRef,
          },
        });
    expect(l3(FOREIGN_AUTHORIZATION_ID)).toThrowError(/belongs to Work/);
    expect(l3(REVOKED_AUTHORIZATION_ID)).toThrowError(/was revoked/);
    // A reference on a level that does not need one is still verified.
    expect(deliver({ authorizationRef: FOREIGN_AUTHORIZATION_ID })).toThrowError(/belongs to Work/);
    expect(deliver({ authorizationRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99' })).toThrowError(
      /does not exist/,
    );
  });

  it('never lets an intent label open the L3 gates (R11-01/R11-02)', () => {
    const assessWith =
      (payload: Partial<AssessmentPayload>): unknown =>
      () =>
        orchestrator.assess({
          workId: WORK_ID,
          payload: { ...assessmentPayloadFixture(), ...payload },
        });

    // assist/artifact are the light routes, but a deployment or a documented
    // lockdown risk still forces L3 — the label cannot open the gate.
    for (const intent of ['assist', 'artifact'] as const) {
      expect(
        assessWith({ intent, level: 'none', scope: { ...emptyScope, operations: ['deploy'] } }),
      ).toThrowError(/routing rules require L3/);
      expect(
        assessWith({
          intent,
          level: 'none',
          scope: { ...emptyScope, networkTargets: ['10.0.0.5'] },
        }),
      ).toThrowError(/routing rules require L3/);
      expect(assessWith({ intent, level: 'none', riskFlags: ['安全边界'] })).toThrowError(
        /routing rules require L3/,
      );
      expect(assessWith({ intent, level: 'L1', riskFlags: ['数据删除/迁移'] })).toThrowError(
        /routing rules require L3/,
      );
    }

    // An operation is never L1: the Core decision is L2 and the floor follows.
    expect(assessWith({ intent: 'operation', level: 'none' })).toThrowError(
      /routing rules require L2/,
    );
    expect(assessWith({ intent: 'operation', level: 'L1' })).toThrowError(
      /routing rules require L2/,
    );
  });

  it('requires a verified authorization to create a Run for an L3 Work (R11-03)', () => {
    const spec = (workId: string): ChiefDispatchSpec => ({
      ...chiefSpec(),
      workId,
      scope: { ...emptyScope, operations: ['deploy'] },
    });

    // The Work carries no authorization: no Run may be created.
    expect(() => orchestrator.dispatch({ spec: spec(L3_UNAUTHORIZED_WORK_ID) })).toThrowError(
      /requires an explicit authorizationRef/,
    );
    // A fabricated reference is not authority either.
    expect(() =>
      orchestrator.dispatch({
        spec: spec(L3_UNAUTHORIZED_WORK_ID),
        authorizationRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99',
      }),
    ).toThrowError(/does not exist/);
    // The Work's own authorization is verified and accepted.
    const run = orchestrator.dispatch({ spec: spec(L3_WORK_ID) }).run;
    expect(run.workId).toBe(L3_WORK_ID);
  });

  it('applies the L3 floor from the spec scope, not only the Work level (R12-01/R12-02)', () => {
    const chief = chiefRun();
    const environmentScope = { ...emptyScope, operations: ['delete_data'] };

    // The Work is L2, but this Run declares a data operation: it needs L3 authority
    // and the Work has none, so no Run is created.
    expect(() =>
      orchestrator.dispatch({ spec: backendSpec(chief.id, { scope: environmentScope }) }),
    ).toThrowError(/requires an explicit authorizationRef/);

    // A grant that does not cover the operation cannot back it.
    expect(() =>
      orchestrator.dispatch({
        spec: backendSpec(chief.id, { scope: environmentScope }),
        authorizationRef: AUTHORIZATION_ID,
      }),
    ).toThrowError(/does not cover the declared scope/);

    // The same Run is admitted once the grant covers its scope.
    const admitted = orchestrator.dispatch({
      spec: backendSpec(chief.id, { scope: { ...emptyScope, operations: ['deploy'] } }),
      authorizationRef: AUTHORIZATION_ID,
    });
    expect(admitted.dispatchSnapshot.authorizationRef).toBe(AUTHORIZATION_ID);

    // Network writes are checked against the authorization's targets too.
    expect(() =>
      orchestrator.dispatch({
        spec: backendSpec(chief.id, { scope: { ...emptyScope, networkTargets: ['10.0.0.5'] } }),
        authorizationRef: AUTHORIZATION_ID,
      }),
    ).toThrowError(/does not cover the declared scope/);
  });

  it('treats the authorization envelope as the scope boundary (R13-01)', () => {
    const chief = chiefRun();
    // The grant has no write paths, so a Run that writes is not covered — and the
    // path dimension must be the reason (the spec declares no operations).
    try {
      orchestrator.dispatch({ spec: backendSpec(chief.id), authorizationRef: AUTHORIZATION_ID });
      throw new Error('expected a coverage error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_AUTHORIZED' });
      const details = (error as { details: Record<string, unknown> }).details;
      expect(details['uncoveredWritePaths']).toEqual(['packages/storage/src']);
      expect(details['uncoveredOperations']).toEqual([]);
    }

    // A grant that covers the path and the write operation is accepted.
    const covered = orchestrator.dispatch({
      spec: backendSpec(chief.id, {
        scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
      }),
      authorizationRef: WRITE_AUTHORIZATION_ID,
    });
    expect(covered.dispatchSnapshot.effectiveScope.writePaths).toEqual(['packages/storage/src']);

    // An operation outside the grant is refused even on the same path.
    expect(() =>
      orchestrator.dispatch({
        spec: backendSpec(chief.id, {
          scope: { ...emptyScope, writePaths: ['packages/storage/src'], operations: ['edit'] },
        }),
        authorizationRef: WRITE_AUTHORIZATION_ID,
      }),
    ).toThrowError(/does not cover the declared scope/);

    // An assessment is checked against its own scope too.
    expect(() =>
      orchestrator.assess({
        workId: WORK_ID,
        payload: {
          ...assessmentPayloadFixture(),
          scope: { ...emptyScope, writePaths: ['packages/core/src'] },
          authorizationRef: WRITE_AUTHORIZATION_ID,
        },
      }),
    ).toThrowError(/does not cover the declared scope/);
  });

  it('treats git as a workspace write and network targets as network writes (R14-01)', () => {
    const noneChief = orchestrator.dispatch({ spec: { ...chiefSpec(), workId: NONE_WORK_ID } }).run;
    // `git` rewrites tracked files, so a none-level Work must not get it — with or
    // without a grant of its own.
    const gitSpec = backendSpec(noneChief.id, {
      workId: NONE_WORK_ID,
      taskId: undefined,
      scope: { ...emptyScope, operations: ['git'] },
    });
    expect(() => orchestrator.dispatch({ spec: gitSpec })).toThrowError(
      /cannot create a Run with write or environment authority/,
    );
    // A grant bound to this very Work does not change the Work's own authority.
    expect(() =>
      orchestrator.dispatch({ spec: gitSpec, authorizationRef: NONE_GIT_AUTHORIZATION_ID }),
    ).toThrowError(/cannot create a Run with write or environment authority/);

    const chief = chiefRun();
    // Listing a target in the grant is not enough: reaching it is a network write.
    try {
      orchestrator.dispatch({
        spec: backendSpec(chief.id, {
          scope: { ...emptyScope, operations: ['network'], networkTargets: ['10.0.0.5'] },
        }),
        authorizationRef: NETWORK_AUTHORIZATION_ID,
      });
      throw new Error('expected a coverage error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_AUTHORIZED' });
      const details = (error as { details: Record<string, unknown> }).details;
      expect(details['networkTargetsWithoutGrant']).toEqual(['10.0.0.5']);
    }
  });

  it('requires a matching capability for every declared dimension (R15-01)', () => {
    const chief = chiefRun();
    const writeScope = { ...emptyScope, writePaths: ['packages/storage/src'] };

    // The grant's path envelope covers the write, but it grants no write operation:
    // a Run must not freeze write scope it cannot be authorized to use.
    try {
      orchestrator.dispatch({
        spec: backendSpec(chief.id, { scope: writeScope }),
        authorizationRef: READONLY_WRITE_AUTHORIZATION_ID,
      });
      throw new Error('expected a coverage error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_AUTHORIZED' });
      const details = (error as { details: Record<string, unknown> }).details;
      expect(details['capabilityGaps']).toEqual(['writePaths without a write operation']);
      expect(details['uncoveredWritePaths']).toEqual([]);
    }

    // Same rule on the read side.
    try {
      orchestrator.dispatch({
        spec: backendSpec(chief.id, { scope: { ...emptyScope, readPaths: ['docs'] } }),
        authorizationRef: DEPLOY_READ_AUTHORIZATION_ID,
      });
      throw new Error('expected a coverage error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_AUTHORIZED' });
      const details = (error as { details: Record<string, unknown> }).details;
      expect(details['capabilityGaps']).toEqual(['readPaths without a read operation']);
    }

    // An environment-only grant cannot back a write range either.
    expect(() =>
      orchestrator.dispatch({
        spec: backendSpec(chief.id, { scope: writeScope }),
        authorizationRef: AUTHORIZATION_ID,
      }),
    ).toThrowError(/does not cover the declared scope/);
  });

  it('lets a none-level Work produce its own artifact but not act on the world (R16-01/M-1)', () => {
    const noneChief = orchestrator.dispatch({ spec: { ...chiefSpec(), workId: NONE_WORK_ID } }).run;
    // `execution.md` §21/§53: artifact_write belongs to every role, so an assist Work
    // may dispatch a Run that writes its own Artifact.
    const artifactRun = orchestrator.dispatch({
      spec: backendSpec(noneChief.id, {
        workId: NONE_WORK_ID,
        taskId: undefined,
        scope: { ...emptyScope, operations: ['artifact_write'] },
      }),
    }).run;
    expect(artifactRun.workId).toBe(NONE_WORK_ID);

    // The same Work cannot gain write or environment authority from a grant.
    const deploySpec = backendSpec(noneChief.id, {
      workId: NONE_WORK_ID,
      taskId: undefined,
      scope: { ...emptyScope, operations: ['deploy'] },
    });
    expect(() => orchestrator.dispatch({ spec: deploySpec })).toThrowError(
      /cannot create a Run with write or environment authority/,
    );
    expect(() =>
      orchestrator.dispatch({ spec: deploySpec, authorizationRef: NONE_GIT_AUTHORIZATION_ID }),
    ).toThrowError(/cannot create a Run with write or environment authority/);

    // `assess` agrees with `dispatch` about the same scope.
    expect(() =>
      orchestrator.assess({
        workId: NONE_WORK_ID,
        payload: {
          ...assessmentPayloadFixture(),
          intent: 'assist',
          level: 'none',
          scope: { ...emptyScope, operations: ['deploy'] },
        },
      }),
    ).toThrowError(/cannot declare a write or environment scope/);
    expect(() =>
      orchestrator.assess({
        workId: NONE_WORK_ID,
        payload: {
          ...assessmentPayloadFixture(),
          intent: 'artifact',
          level: 'none',
          scope: { ...emptyScope, writePaths: ['docs'] },
        },
      }),
    ).toThrowError(/cannot declare a write or environment scope/);

    // An artifact-only assessment is still accepted on the assist route.
    const accepted = orchestrator.assess({
      workId: NONE_WORK_ID,
      payload: {
        ...assessmentPayloadFixture(),
        intent: 'artifact',
        level: 'none',
        scope: { ...emptyScope, operations: ['artifact_write'] },
      },
    });
    expect(accepted.level).toBe('none');
  });

  it('counts a local write operation as modification authority (R13-02)', () => {
    const noneChief = orchestrator.dispatch({ spec: { ...chiefSpec(), workId: NONE_WORK_ID } }).run;
    // No path list at all, just an operation that edits the workspace.
    expect(() =>
      orchestrator.dispatch({
        spec: backendSpec(noneChief.id, {
          workId: NONE_WORK_ID,
          taskId: undefined,
          scope: { ...emptyScope, operations: ['edit'] },
        }),
      }),
    ).toThrowError(/cannot create a Run with write or environment authority/);
  });

  it('cleans absent optional fields instead of failing on the snapshot (R13-03)', () => {
    const chief = chiefRun();
    const before = store.snapshots.list().length;
    // A raw spec object that carries an explicit `undefined` optional field.
    const run = orchestrator.dispatch({
      spec: { ...backendSpec(chief.id), taskId: undefined },
    }).run;
    expect(run.taskId).toBeUndefined();
    // Three snapshots for the Run; nothing was left behind by a failed dispatch.
    expect(store.snapshots.list().length).toBe(before + 3);
  });

  it('never freezes write authority for a none-level Work (R12-01, DC-66)', () => {
    const noneChief = orchestrator.dispatch({ spec: { ...chiefSpec(), workId: NONE_WORK_ID } }).run;
    expect(() =>
      orchestrator.dispatch({
        spec: backendSpec(noneChief.id, { workId: NONE_WORK_ID, taskId: undefined }),
      }),
    ).toThrowError(/cannot create a Run with write or environment authority/);
    // A read-only child of the same Work is still allowed.
    const readOnly = orchestrator.dispatch({
      spec: backendSpec(noneChief.id, {
        workId: NONE_WORK_ID,
        taskId: undefined,
        scope: { ...emptyScope, readPaths: ['packages/core/src'] },
      }),
    }).run;
    expect(readOnly.workId).toBe(NONE_WORK_ID);
  });

  it('freezes the authorization the Core actually verified (R12-03)', () => {
    const result = orchestrator.dispatch({
      spec: {
        ...chiefSpec(),
        workId: L3_WORK_ID,
        scope: { ...emptyScope, operations: ['deploy'] },
      },
    });
    // The reference comes from the Work row, and recovery must be able to rebuild it.
    expect(result.dispatchSnapshot.authorizationRef).toBe(L3_AUTHORIZATION_ID);

    // The Work's grant only covers `deploy`; a wider scope is refused.
    expect(() =>
      orchestrator.dispatch({
        spec: {
          ...chiefSpec(),
          workId: L3_WORK_ID,
          scope: { ...emptyScope, operations: ['delete_data'] },
        },
      }),
    ).toThrowError(/does not cover the declared scope/);
  });

  it('routes environment operations to L3 whatever the intent label says (R10-07)', () => {
    // A delivery that declares a deployment is still an environment operation.
    expect(() =>
      orchestrator.assess({
        workId: WORK_ID,
        payload: {
          ...assessmentPayloadFixture(),
          intent: 'delivery',
          scope: { ...emptyScope, operations: ['deploy'] },
        },
      }),
    ).toThrowError(/routing rules require L3/);
    expect(() =>
      orchestrator.assess({
        workId: WORK_ID,
        payload: {
          ...assessmentPayloadFixture(),
          intent: 'document',
          scope: { ...emptyScope, networkTargets: ['https://example.test'] },
        },
      }),
    ).toThrowError(/routing rules require L3/);

    // A read-only investigation is not an environment operation, so it stays L2.
    const readOnly = orchestrator.assess({
      workId: WORK_ID,
      payload: {
        ...assessmentPayloadFixture(),
        intent: 'operation',
        scope: { ...emptyScope, operations: ['read', 'search'] },
      },
    });
    expect(readOnly.level).toBe('L2');

    // The accepted L1 carries the effective floor, so the audit trail is consistent.
    const l1 = orchestrator.assess({
      workId: WORK_ID,
      payload: { ...assessmentPayloadFixture(), intent: 'delivery', level: 'L1' },
    });
    expect(l1.level).toBe('L1');
    const saved = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'assessment.saved' && event.entityId === l1.id);
    expect(saved[0]?.data).toMatchObject({ level: 'L1', floor: 'L1' });
  });

  it('rejects a malformed runParams and dispatch authorization before writing (R10-05)', () => {
    const chief = chiefRun();
    const snapshotsBefore = store.snapshots.list().length;
    const badRunParams: readonly unknown[] = [
      { contextLimit: -5 },
      { bogus: 1 },
      { reasoning: 'hyper' },
      { providerId: 'not-a-uuid' },
    ];
    for (const runParams of badRunParams) {
      try {
        orchestrator.dispatch({ spec: backendSpec(chief.id), runParams: runParams as never });
        throw new Error('expected a validation error');
      } catch (error) {
        // A client-side field error must not surface as a provider outage.
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
    }
    expect(store.snapshots.list().length).toBe(snapshotsBefore);

    // A frozen authorization reference is verified too.
    expect(() =>
      orchestrator.dispatch({
        spec: backendSpec(chief.id),
        authorizationRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99',
      }),
    ).toThrowError(/does not exist/);
    expect(store.snapshots.list().length).toBe(snapshotsBefore);

    // Idempotency keys and stages are bounded, not stored verbatim.
    expect(() =>
      orchestrator.requestDispatch({
        runId: chief.id,
        requestedRole: 'review',
        goal: 'ok',
        operationId: '   ',
      }),
    ).toThrowError(/request_dispatch request is invalid/);
    expect(() =>
      orchestrator.requestDispatch({
        runId: chief.id,
        requestedRole: 'review',
        goal: 'ok',
        stage: 'x'.repeat(100),
      }),
    ).toThrowError(/request_dispatch request is invalid/);
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
    // Unmeasured usage keeps the reservation and flags the Work cost-unknown.
    expect(store.budgets.find(budgetRow.id)?.tokensReserved).toBe(60_000);
    expect(store.budgets.find(budgetRow.id)?.costKnown).toBe(false);
    const ended = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'run.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.data).toMatchObject({
      outcome: 'completed',
      releasedTokens: 0,
      usageMeasured: false,
    });
    // Reconcile with the real usage (WP-10): hold released, usage charged.
    orchestrator.lifecycle.reconcile(run.id, { tokensUsed: 1_000 });
    expect(store.budgets.find(budgetRow.id)?.tokensReserved).toBe(0);
    expect(store.budgets.find(budgetRow.id)?.tokensUsed).toBe(1_000);
    expect(store.budgets.find(budgetRow.id)?.costKnown).toBe(true);
    // `run.started` is the documented name for the executing transition.
    expect(store.events.readAfter(0, { limit: 100 }).some((e) => e.name === 'run.started')).toBe(
      true,
    );
  });

  it('applies the authorized Run parameter layer when freezing a profile', () => {
    const run = orchestrator.dispatch({
      spec: chiefSpec({ scope: emptyScope }),
      // `runParams` can name another Provider/Model, so it must come with authority
      // (WP-12 fix round 2, G1 precondition).
      authorizationRef: AUTHORIZATION_ID,
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

    // A fabricated authorization reference is not authority (DC-63).
    expect(() =>
      orchestrator.assess({
        workId: WORK_ID,
        payload: {
          intent: 'delivery',
          goal: 'ship WP-02',
          scope: emptyScope,
          level: 'L3',
          semanticImpact: true,
          authorizationRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99',
          riskFlags: ['securityBoundary'],
          uncertainties: [],
          policyRevision: 1,
          reason: 'forged authorization',
        },
      }),
    ).toThrowError(/does not exist/);

    const row = orchestrator.assess({
      workId: WORK_ID,
      runId: WORK_CHIEF_RUN_ID,
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
    // Without a provider usage report the hold is kept, not released as zero.
    const unmeasured = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.name === 'run.ended')[0];
    expect(unmeasured?.data).toMatchObject({ usageMeasured: false, tokensUsed: 0 });
    expect(store.budgets.find(budgetRow.id)?.tokensReserved).toBe(40_000);
    orchestrator.lifecycle.reconcile(run.id, { tokensUsed: 0 });

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

  it('keeps budget accounting honest across cancel, over-usage and replay (R5-02/03/04/09)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const chief = chiefRun();
    const first = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const second = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;

    // R5-02: cancelling the parent through the public entry point takes the
    // children with it instead of leaving them in a Join nobody owns.
    const cancelled = orchestrator.settleRun(chief.id, 'cancelled');
    expect(cancelled.status).toBe('cancelled');
    expect(store.runs.find(first.id)?.status).toBe('cancelled');
    expect(store.runs.find(second.id)?.status).toBe('cancelled');

    // M-3: cancelling an already terminal Run must not touch its children.
    const others = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 10_000 }) }).run;
    const orphan = orchestrator.dispatch({ spec: backendSpec(others.id) }).run;
    orchestrator.beginAttempt(others.id);
    orchestrator.settleRun(others.id, 'failed');
    expect(() => orchestrator.lifecycle.cancel(others.id)).toThrowError(/cannot move failed/);
    expect(store.runs.find(orphan.id)?.status).toBe('cancelled');
  });

  it('caps a usage report that exceeds the reservation and records the excess (R5-03)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const run = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 10_000 }) }).run;
    orchestrator.beginAttempt(run.id);
    // A provider may report more than the reservation; the terminal transition must
    // still succeed, capped to what the Work budget can absorb.
    const settled = orchestrator.settleRun(run.id, 'completed', {
      tokensUsed: 25_000,
      measured: true,
    });
    expect(settled.status).toBe('completed');
    const budget = store.budgets.find(budgetRow.id);
    expect(budget?.tokensReserved).toBe(0);
    expect(budget?.tokensUsed).toBe(10_000);
    const ended = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.entityId === run.id && event.name === 'run.ended');
    expect(ended[0]?.data).toMatchObject({
      tokensUsed: 25_000,
      chargedTokens: 10_000,
      uncoveredTokens: 15_000,
      releasedTokens: 0,
    });
    // Usage is validated: a negative report is a validation error, not a silent
    // clamp that disagrees with the event.
    const next = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 1_000 }) }).run;
    orchestrator.beginAttempt(next.id);
    expect(() =>
      orchestrator.settleRun(next.id, 'completed', { tokensUsed: -5, measured: true }),
    ).toThrowError(/non-negative integer/);
    expect(store.runs.find(next.id)?.status).toBe('running');
  });

  it('reconciles usage once and only consumes its own hold (R5-04)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const chief = chiefRun();
    const held = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const reconciled = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.beginAttempt(reconciled.id);
    orchestrator.settleRun(reconciled.id, 'completed');
    const reservedBefore = store.budgets.find(budgetRow.id)?.tokensReserved ?? 0;

    orchestrator.lifecycle.reconcile(reconciled.id, { tokensUsed: 1_000 });
    const afterFirst = store.budgets.find(budgetRow.id);
    // The other Run's hold survives: reconcile released only its own reservation.
    expect(afterFirst?.tokensReserved).toBe(reservedBefore - reconciled.budgetAllocation);
    expect(afterFirst?.tokensUsed).toBe(1_000);

    // A replayed reconciliation is a no-op, never a second charge.
    orchestrator.lifecycle.reconcile(reconciled.id, { tokensUsed: 1_000 });
    const afterReplay = store.budgets.find(budgetRow.id);
    expect(afterReplay?.tokensUsed).toBe(1_000);
    expect(afterReplay?.tokensReserved).toBe(afterFirst?.tokensReserved);
    expect(store.runs.find(held.id)?.status).toBe('queued');
  });

  it('reports a malformed spec as VALIDATION_ERROR and writes no snapshot (R7-01/R7-07)', () => {
    const chief = chiefRun();
    const snapshotsBefore = store.snapshots.list().length;
    const runsBefore = store.runs.list().length;
    const malformed = [
      { ...backendSpec(chief.id), contextSelection: { goal: 'no read paths' } },
      { ...backendSpec(chief.id), requiredOutputs: 'stage.submit' },
      { ...backendSpec(chief.id), scope: null },
      null,
      42,
    ];
    for (const spec of malformed) {
      try {
        orchestrator.dispatch({ spec: spec as never });
        throw new Error('expected a validation error');
      } catch (error) {
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
    }
    // A rejected dispatch must not leave snapshots or Runs behind.
    expect(store.runs.list().length).toBe(runsBefore);
    expect(store.snapshots.list().length).toBe(snapshotsBefore);

    // The same for a purely admission-level rejection.
    const stale = { ...backendSpec(chief.id), profileRevision: 999_999 };
    expect(() => orchestrator.dispatch({ spec: stale })).toThrowError(/is stale/);
    expect(store.snapshots.list().length).toBe(snapshotsBefore);
  });

  it('rejects malformed protocol requests before persisting anything (R8-01/R8-02)', () => {
    const chief = chiefRun();
    const child = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const malformedRequests: readonly Record<string, unknown>[] = [
      { runId: child.id, requestedRole: 'review', goal: 'ok', sourceRefs: 'oops' },
      { runId: child.id, requestedRole: 'review', goal: 'ok', requiredOutputs: 5 },
      { runId: child.id, requestedRole: 'review', goal: 'ok', sourceRefs: [null] },
      { runId: child.id, requestedRole: 'review', goal: 123 },
      { runId: child.id, requestedRole: 'review', goal: 'ok', stage: 42 },
      { runId: child.id, requestedRole: 'review', goal: 'ok', budgetAllocation: -5 },
      { runId: child.id, requestedRole: 'review', goal: 'ok', operationId: 123 },
      { runId: child.id, requestedRole: 'nobody', goal: 'ok' },
    ];
    const todosBefore = store.events
      .readAfter(0, { limit: 200 })
      .filter((event) => event.name === 'chief_action_required').length;
    for (const request of malformedRequests) {
      try {
        orchestrator.requestDispatch(request as never);
        throw new Error('expected a validation error');
      } catch (error) {
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
    }
    // A rejected request leaves no Chief todo behind.
    expect(
      store.events
        .readAfter(0, { limit: 200 })
        .filter((event) => event.name === 'chief_action_required'),
    ).toHaveLength(todosBefore);

    // `assessment.submit` follows the protocol error space too.
    const good = assessmentPayloadFixture();
    const malformedAssessments: readonly unknown[] = [
      { workId: WORK_ID, payload: null },
      { workId: WORK_ID, payload: { ...good, riskFlags: null } },
      { workId: WORK_ID, payload: { ...good, riskFlags: 5 } },
      { workId: WORK_ID, payload: { ...good, uncertainties: null } },
      { workId: WORK_ID, payload: { ...good, level: 'B2' } },
      { workId: WORK_ID, payload: { ...good, intent: 123 } },
    ];
    for (const input of malformedAssessments) {
      try {
        orchestrator.assess(input as never);
        throw new Error('expected a validation error');
      } catch (error) {
        // Never a storage-layer violation: only protocol codes may escape.
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
    }
    // The good payload still works.
    expect(orchestrator.assess({ workId: WORK_ID, payload: good }).level).toBe('L2');
  });

  it('leaves no snapshot behind when the frozen inputs are invalid (R8-04/R8-09)', () => {
    const chief = chiefRun();
    const snapshotsBefore = store.snapshots.list().length;
    const contextBefore = store.snapshots.list({
      where: 'type = ?',
      params: ['context'],
    }).length;
    const runsBefore = store.runs.list().length;
    const badInputs: readonly unknown[] = [
      { spec: backendSpec(chief.id), authorizationRef: 'not-a-uuid' },
      { spec: backendSpec(chief.id), requiredOutputSchemas: [{ kind: 'x' }] },
      { spec: backendSpec(chief.id), contextPayload: ['not', 'an', 'object'] },
      { spec: backendSpec(chief.id), runParams: 5 },
      { spec: backendSpec(chief.id), runParams: [] },
    ];
    for (const input of badInputs) {
      try {
        orchestrator.dispatch(input as never);
        throw new Error('expected a validation error');
      } catch (error) {
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
    }
    expect(store.runs.list().length).toBe(runsBefore);
    expect(store.snapshots.list().length).toBe(snapshotsBefore);
    expect(store.snapshots.list({ where: 'type = ?', params: ['context'] }).length).toBe(
      contextBefore,
    );
  });

  it('treats a different cost for the same Run as a conflict (R7-02/R7-03)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const chief = chiefRun();
    const run = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.beginAttempt(run.id);
    orchestrator.settleRun(run.id, 'completed', { tokensUsed: 1_000, measured: true });
    // Same tokens, different cost is not a replay: it must not be silently dropped.
    expect(() =>
      orchestrator.lifecycle.reconcile(run.id, { tokensUsed: 1_000, cost: 5 }),
    ).toThrowError(/already booked/);
    expect(store.budgets.find(budgetRow.id)?.cost).toBeUndefined();
    // Cost without a measurement is contradictory input.
    const other = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.beginAttempt(other.id);
    expect(() =>
      orchestrator.settleRun(other.id, 'completed', {
        tokensUsed: 0,
        measured: false,
        cost: 5,
      }),
    ).toThrowError(/without a measured usage/);
  });

  it('releases the reservation of a never-started child when a parent is cancelled (R7-09)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const chief = chiefRun();
    const neverStarted = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const reservedBefore = store.budgets.find(budgetRow.id)?.tokensReserved ?? 0;
    expect(reservedBefore).toBeGreaterThanOrEqual(neverStarted.budgetAllocation);

    // Neither Run ever started an Attempt, so both are known-zero usage: cancelling
    // the parent must hand back its own hold *and* the child's (R8-03), otherwise a
    // zero-consumption cancel would block the Work budget forever.
    orchestrator.settleRun(chief.id, 'cancelled');
    expect(store.runs.find(neverStarted.id)?.status).toBe('cancelled');
    expect(store.budgets.find(budgetRow.id)?.tokensReserved).toBe(
      reservedBefore - neverStarted.budgetAllocation - chief.budgetAllocation,
    );
    const events = store.events
      .readAfter(0, { limit: 200 })
      .filter((event) => event.name === 'run.ended' && event.entityId === chief.id);
    expect(events[0]?.data).toMatchObject({
      usageMeasured: true,
      releasedTokens: chief.budgetAllocation,
    });

    // A Run that did start keeps its hold as unknown for later reconciliation.
    const started = orchestrator.dispatch({ spec: chiefSpec({ budgetAllocation: 6_000 }) }).run;
    orchestrator.beginAttempt(started.id);
    const beforeStartedCancel = store.budgets.find(budgetRow.id)?.tokensReserved ?? 0;
    orchestrator.settleRun(started.id, 'cancelled');
    expect(store.budgets.find(budgetRow.id)?.tokensReserved).toBe(beforeStartedCancel);
  });

  it('never re-books an already measured Run (R6-01/R6-04/R6-05)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const chief = chiefRun();
    const held = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const measured = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.beginAttempt(measured.id);
    // Settled with a real usage report: the reconciliation path must have nothing
    // left to book.
    orchestrator.settleRun(measured.id, 'completed', { tokensUsed: 1_000, measured: true });
    const afterSettle = store.budgets.find(budgetRow.id);
    const reservedAfterSettle = afterSettle?.tokensReserved ?? 0;

    expect(orchestrator.lifecycle.reconcile(measured.id, { tokensUsed: 1_000 })).toBeDefined();
    const afterReplay = store.budgets.find(budgetRow.id);
    // No second charge, and the other Run's hold is untouched.
    expect(afterReplay?.tokensUsed).toBe(1_000);
    expect(afterReplay?.tokensReserved).toBe(reservedAfterSettle);
    expect(store.runs.find(held.id)?.status).toBe('queued');
    expect(orchestrator.lifecycle.settlements(measured.id)).toHaveLength(1);

    // A different report for the same Run is a conflict, not a silent no-op.
    expect(() => orchestrator.lifecycle.reconcile(measured.id, { tokensUsed: 9_000 })).toThrowError(
      /already booked/,
    );
    expect(store.budgets.find(budgetRow.id)?.tokensUsed).toBe(1_000);

    // The unknown-usage path still reconciles exactly once, with an orderable key.
    const unknown = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.beginAttempt(unknown.id);
    orchestrator.settleRun(unknown.id, 'completed');
    orchestrator.lifecycle.reconcile(unknown.id, { tokensUsed: 2_000, cost: 0.0025 });
    const events = orchestrator.lifecycle.settlements(unknown.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.data).toMatchObject({
      reconciled: true,
      chargedTokens: 2_000,
      runCostKnown: true,
      cost: 0.0025,
    });
    expect(events[1]?.data['costKnown']).toBeUndefined();
    // Cost is charged to the Work budget and may be fractional (R6-02).
    expect(store.budgets.find(budgetRow.id)?.cost).toBeCloseTo(0.0025);
  });

  it('books measured usage on cancellation and refuses a contradictory report (R6-03)', () => {
    const budgetRow = store.budgets.list({ where: 'work_id = ?', params: [WORK_ID] })[0];
    if (budgetRow === undefined) throw new Error('budget fixture missing');
    const chief = chiefRun();
    const cancelled = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.beginAttempt(cancelled.id);
    orchestrator.settleRun(cancelled.id, 'cancelled', { tokensUsed: 3_000, measured: true });
    const ended = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.entityId === cancelled.id && event.name === 'run.ended');
    expect(ended[0]?.data).toMatchObject({
      outcome: 'cancelled',
      tokensUsed: 3_000,
      chargedTokens: 3_000,
      usageMeasured: true,
    });
    expect(store.budgets.find(budgetRow.id)?.tokensUsed).toBeGreaterThanOrEqual(3_000);

    // Unknown usage with a non-zero amount is contradictory and must be reported.
    const other = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.beginAttempt(other.id);
    expect(() =>
      orchestrator.settleRun(other.id, 'completed', { tokensUsed: 5, measured: false }),
    ).toThrowError(/measured is false/);
    expect(store.runs.find(other.id)?.status).toBe('running');
  });

  it('derives an idempotency key and reports bad input as VALIDATION_ERROR (R6-09/R6-10)', () => {
    const chief = chiefRun();
    const child = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const first = orchestrator.requestDispatch({
      runId: child.id,
      requestedRole: 'review',
      goal: 'review without a key',
    });
    const second = orchestrator.requestDispatch({
      runId: child.id,
      requestedRole: 'review',
      goal: 'review without a key',
    });
    expect(second.chiefTodo).toBe(first.chiefTodo);
    const todos = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.entityId === chief.id && event.name === 'chief_action_required');
    expect(todos).toHaveLength(1);
    expect(todos[0]?.data).toMatchObject({ operationIdSource: 'derived' });
    // A different request without a key is a genuinely different todo.
    orchestrator.requestDispatch({
      runId: child.id,
      requestedRole: 'review',
      goal: 'another goal',
    });
    expect(
      store.events
        .readAfter(0, { limit: 100 })
        .filter((event) => event.entityId === chief.id && event.name === 'chief_action_required'),
    ).toHaveLength(2);

    // Schema failures surface as the protocol error, not a raw ZodError.
    try {
      professionalSpec({
        workId: WORK_ID,
        taskId: TASK_ID,
        role: 'backend',
        purpose: 'implementation',
        goal: 'bad input',
        scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
        stage: 'develop',
        contextSelection: selection,
        profileRevision: orchestrator.currentProfileRevision('backend'),
        requiredOutputs: ['stage.submit'],
        requiredChild: true,
        joinPolicy: 'all',
        budgetAllocation: 1_000,
        parentRunId: chief.id,
        bogusField: true,
      } as never);
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('answers an operationId replay even after the Chief Run has ended (R5-09)', () => {
    const chief = chiefRun();
    const child = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const first = orchestrator.requestDispatch({
      runId: child.id,
      requestedRole: 'review',
      goal: 'review the adapter',
      operationId: 'op-replay',
    });
    orchestrator.beginAttempt(chief.id);
    orchestrator.settleRun(chief.id, 'failed');
    const replay = orchestrator.requestDispatch({
      runId: child.id,
      requestedRole: 'review',
      goal: 'review the adapter',
      operationId: 'op-replay',
    });
    expect(replay.chiefTodo).toBe(first.chiefTodo);
    expect(() =>
      orchestrator.requestDispatch({
        runId: child.id,
        requestedRole: 'review',
        goal: 'a new request now that the Chief ended',
      }),
    ).toThrowError(/cannot request more work|cannot take a new dispatch request/);
  });

  it('refuses to end a parent while join=all children are live, and cancel propagates (Q-04)', () => {
    const parent = chiefRun();
    const spec = professionalSpec({
      workId: WORK_ID,
      role: 'backend',
      purpose: 'implementation',
      goal: 'work that outlives the parent',
      scope: emptyScope,
      stage: 'develop',
      contextSelection: selection,
      profileRevision: orchestrator.currentProfileRevision('backend'),
      requiredOutputs: ['stage.submit'],
      requiredChild: true,
      joinPolicy: 'all',
      budgetAllocation: 5_000,
      parentRunId: parent.id,
    });
    const child = orchestrator.dispatch({ spec }).run;
    orchestrator.beginAttempt(parent.id);
    expect(() => orchestrator.settleRun(parent.id, 'completed')).toThrowError(
      /live join=all children/,
    );
    expect(store.runs.find(parent.id)?.status).toBe('running');
    // Cancellation is the documented exception and takes the child with it.
    const cancelled = orchestrator.lifecycle.cancel(parent.id);
    expect(cancelled.status).toBe('cancelled');
    expect(store.runs.find(child.id)?.status).toBe('cancelled');
    expect(store.runs.find(parent.id)).toBeDefined();
  });

  it('rejects a reused operationId with a different payload (Q-01)', () => {
    const chief = chiefRun();
    const first = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const second = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    orchestrator.requestDispatch({
      runId: first.id,
      requestedRole: 'review',
      goal: 'review the adapter',
      operationId: 'op-shared',
    });
    // Same key + same request is the replay case and returns the original todo.
    const replay = orchestrator.requestDispatch({
      runId: first.id,
      requestedRole: 'review',
      goal: 'review the adapter',
      operationId: 'op-shared',
    });
    expect(typeof replay.chiefTodo).toBe('string');
    // Same key + different request must not be silently swallowed.
    expect(() =>
      orchestrator.requestDispatch({
        runId: first.id,
        requestedRole: 'review',
        goal: 'a different review',
        operationId: 'op-shared',
      }),
    ).toThrowError(/already used for a different dispatch request/);
    expect(() =>
      orchestrator.requestDispatch({
        runId: second.id,
        requestedRole: 'review',
        goal: 'review the adapter',
        operationId: 'op-shared',
      }),
    ).toThrowError(/already used for a different dispatch request/);
    // Any differing field counts, not just the goal (R5-01).
    expect(() =>
      orchestrator.requestDispatch({
        runId: first.id,
        requestedRole: 'review',
        goal: 'review the adapter',
        budgetAllocation: 2_000,
        operationId: 'op-shared',
      }),
    ).toThrowError(/already used for a different dispatch request/);
    const todos = store.events
      .readAfter(0, { limit: 100 })
      .filter((event) => event.data['operationId'] === 'op-shared');
    expect(todos).toHaveLength(1);
  });

  it('refuses a dispatch request when the Chief Run itself cannot act (H-01)', () => {
    const chief = chiefRun();
    const requester = orchestrator.dispatch({ spec: backendSpec(chief.id) }).run;
    const chiefRow = store.runs.find(chief.id);
    expect(chiefRow).toBeDefined();
    if (chiefRow === undefined) throw new Error('chief fixture missing');
    store.runs.update(chiefRow.id, { status: 'completed' }, chiefRow.version);
    expect(() =>
      orchestrator.requestDispatch({
        runId: requester.id,
        requestedRole: 'test',
        goal: 'nobody can act on this',
      }),
    ).toThrowError(/cannot take a new dispatch request/);
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

  /**
   * WP-12 T2.2: the assessment is the Work's routing decision, and a plain natural-language
   * instruction is its own authorization (`PRODUCT.md` §5, user decision Q1=B). The derived
   * envelope stays inside the project root and never carries an environment operation.
   */
  describe('assessment persistence and derived authorization (WP-12 T2.2)', () => {
    /** A Work with no authorization, as `conversation.message.send` creates it. */
    function freshWork(options: { readonly task?: boolean } = {}): string {
      const workId = store.newId();
      const budget = store.budgets.insert({
        projectId,
        workId,
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
        id: workId,
        projectId,
        intent: 'delivery',
        purpose: 'implement the dark theme',
        level: 'none',
        goal: 'implement the dark theme',
        scope: emptyScope,
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
        status: 'running',
        blockerIds: [],
        budgetId: budget.id,
        policyRevision: 1,
      });
      // `workflow.md` §3: a develop-stage dispatch needs the Task the approved Plan
      // materialises (`orchestrator.enforceRouteOrder`). These cases exercise the
      // authorization/budget guards *after* that admission, so the Plan's output is
      // seeded directly; the route refusal itself is covered separately.
      if (options.task !== false) {
        store.tasks.insert({
          id: store.newId(),
          projectId,
          workId,
          planRef: { id: store.newId(), version: 1, hash: 'c'.repeat(64) },
          role: 'backend',
          dependsOn: [],
          dependencyManifestRefs: [],
          scope: emptyScope,
          stage: 'develop',
          acceptanceIds: ['AC-003'],
        });
      }
      return workId;
    }

    /** A real Chief Run of an unseeded Work, created through the normal dispatch path. */
    function chiefParent(workId: string): Run {
      return orchestrator.dispatch({
        spec: chiefSpec({ workId, scope: { ...emptyScope, readPaths: ['src'] } }),
      }).run;
    }

    /**
     * The `agent.dispatch` draft, minus the Core-owned fields.
     *
     * `overrides` is spread *first* so the literal defaults keep their narrow types
     * (`role`/`purpose` are unions in the contract) while a test can still replace a field.
     */
    function derivedSpec(
      workId: string,
      parentRunId: string,
      overrides: Partial<ProfessionalSpecDraft> = {},
    ): ProfessionalSpecDraft {
      return {
        role: 'backend',
        purpose: 'implementation',
        goal: 'implement the dark theme',
        scope: { ...emptyScope, writePaths: ['src/theme'] },
        stage: 'develop',
        contextSelection: selection,
        requiredOutputs: ['stage.submit'],
        requiredChild: false,
        joinPolicy: 'none',
        budgetAllocation: 4_000,
        parentRunId,
        ...overrides,
      };
    }
    function derivedPayload(overrides: Partial<AssessmentPayload> = {}): AssessmentPayload {
      return {
        intent: 'delivery',
        goal: 'implement the dark theme',
        scope: { ...emptyScope, readPaths: ['src'], writePaths: ['src/theme'] },
        level: 'L2',
        semanticImpact: false,
        riskFlags: [],
        uncertainties: [],
        policyRevision: 1,
        reason: 'a plain delivery instruction from the user',
        ...overrides,
      };
    }

    it('persists the assessed level on the Work so the next dispatch is authorized', () => {
      const workId = freshWork();
      orchestrator.assess({ workId, payload: derivedPayload({ scope: emptyScope }) });
      const work = store.works.find(workId);
      expect(work?.level).toBe('L2');
      // A re-assessment that says L1 must not downgrade the Work (`workflow.md` §2).
      orchestrator.assess({
        workId,
        payload: derivedPayload({ scope: emptyScope, level: 'L1' }),
      });
      expect(store.works.find(workId)?.level).toBe('L2');
    });

    it('derives the authorization from the assessment and freezes a real Run (Q1=B)', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      const { assessment, authorizationRef, dispatch } = orchestrator.assessAndDispatch({
        workId,
        payload: derivedPayload(),
        parentRunId: chief.id,
        spec: derivedSpec(workId, chief.id),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      expect(assessment.level).toBe('L2');
      expect(authorizationRef).toBeDefined();
      expect(dispatch.run.status).toBe('queued');
      const authorization = store.authorizations.find(authorizationRef ?? '');
      expect(authorization).toMatchObject({
        workId,
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      expect(authorization?.scope.writePaths).toEqual(['src/theme']);
      // The derived envelope now carries the coding surface (`execution.md` §2): the
      // shell/git/network operations a build or test needs, so the Run is not blocked on a
      // per-occurrence decision — but never the irreversible operations.
      expect(authorization?.operations).toEqual(
        expect.arrayContaining(['read', 'edit', 'write', 'bash', 'network', 'secret']),
      );
      for (const irreversible of ['push', 'deploy', 'delete_data']) {
        expect(authorization?.operations).not.toContain(irreversible);
      }
      // An explicit network target is still not derivable.
      expect(authorization?.scope.networkTargets).toEqual([]);
      const work = store.works.find(workId);
      expect(work?.level).toBe('L2');
      expect(work?.authorizationRef).toBe(authorizationRef);
      expect(work?.scope.writePaths).toEqual(['src/theme']);
      // The frozen dispatch snapshot names the derived authority, not a model claim.
      expect(dispatch.dispatchSnapshot.authorizationRef).toBe(authorizationRef);
    });

    it('injects the profile revision instead of trusting the draft (data.md §3)', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      const { dispatch } = orchestrator.assessAndDispatch({
        workId,
        payload: derivedPayload(),
        parentRunId: chief.id,
        // The draft cannot even name a revision; Core freezes the current one.
        spec: derivedSpec(workId, chief.id, { budgetAllocation: 1_234 }),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      expect(dispatch.dispatchSnapshot.profileRevision).toBe(
        orchestrator.currentProfileRevision('backend'),
      );
      // The budget the Chief asked for is the budget that is frozen and reserved.
      expect(dispatch.dispatchSnapshot.dispatchSpec.budgetAllocation).toBe(1_234);
      expect(dispatch.run.budgetAllocation).toBe(1_234);
    });

    it('caps the allocation at what the parent Chief Run can still fund (N-10)', () => {
      const workId = freshWork();
      // `derivedSpec` asks for 4_000 of the parent's 10_000; a second child asking for
      // 20_000 cannot exceed the parent's own hold, so Core freezes what is available.
      const chief = chiefParent(workId);
      const first = orchestrator.assessAndDispatch({
        workId,
        payload: derivedPayload(),
        parentRunId: chief.id,
        spec: derivedSpec(workId, chief.id, { budgetAllocation: 4_000 }),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      expect(first.dispatch.run.budgetAllocation).toBe(4_000);
      const second = orchestrator.assessAndDispatch({
        workId,
        payload: derivedPayload(),
        parentRunId: chief.id,
        spec: derivedSpec(workId, chief.id, { budgetAllocation: 20_000 }),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      // 10_000 − 4_000 live = 6_000, whatever the draft asked for.
      expect(second.dispatch.run.budgetAllocation).toBe(6_000);
      expect(second.dispatch.dispatchSnapshot.dispatchSpec.budgetAllocation).toBe(6_000);
    });

    it('fails closed on an empty scope: nothing is derived and the dispatch is refused', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      expect(() =>
        orchestrator.assessAndDispatch({
          workId,
          payload: derivedPayload({ scope: emptyScope }),
          parentRunId: chief.id,
          spec: derivedSpec(workId, chief.id),
          sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
        }),
      ).toThrowError(/NOT_AUTHORIZED|no authorization/);
      expect(store.authorizations.list({ where: 'work_id = ?', params: [workId] })).toHaveLength(0);
      // Nothing was derived, so the only Run of this Work is the Chief Run that called in.
      expect(store.runs.list({ where: 'work_id = ?', params: [workId] })).toHaveLength(1);
    });

    it('refuses a path that would leave the project root before writing authority', () => {
      // `repoPathSchema` already refuses `..`/absolute paths at the protocol edge, so the
      // derivation's own guard is asserted directly: it is the second, explicit check.
      expect(() =>
        assertDerivableScope(
          'work',
          { ...emptyScope, readPaths: ['~/secrets'], writePaths: ['~/.ssh'] },
          ['read', 'edit', 'write'],
        ),
      ).toThrowError(/inside the project root/);
    });

    it('fails closed on an environment operation', () => {
      const environment = freshWork();
      const environmentChief = chiefParent(environment);
      expect(() =>
        orchestrator.assessAndDispatch({
          workId: environment,
          payload: derivedPayload({
            intent: 'operation',
            level: 'L3',
            scope: { ...emptyScope, operations: ['deploy'] },
          }),
          parentRunId: environmentChief.id,
          spec: derivedSpec(environment, environmentChief.id, {
            scope: { ...emptyScope, operations: ['deploy'] },
          }),
          sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
        }),
      ).toThrowError(/never grants environment operations/);
      expect(
        store.authorizations.list({ where: 'work_id = ?', params: [environment] }),
      ).toHaveLength(0);
    });

    it('keeps an existing authorization instead of deriving a second one', () => {
      const chief = chiefParent(WORK_ID);
      const { authorizationRef } = orchestrator.assessAndDispatch({
        workId: WORK_ID,
        payload: derivedPayload({
          authorizationRef: WRITE_AUTHORIZATION_ID,
          scope: {
            readPaths: [],
            writePaths: ['packages/storage/src'],
            operations: ['write'],
            networkTargets: [],
          },
        }),
        parentRunId: chief.id,
        spec: derivedSpec(WORK_ID, chief.id, {
          scope: { ...emptyScope, writePaths: ['packages/storage/src'] },
        }),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      expect(authorizationRef).toBe(WRITE_AUTHORIZATION_ID);
    });

    it('assessWithDerivation writes the authority the assessment path will reuse', () => {
      const workId = freshWork();
      const { assessment, authorizationRef } = orchestrator.assessWithDerivation({
        workId,
        payload: derivedPayload(),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      expect(assessment.level).toBe('L2');
      expect(authorizationRef).toBeDefined();
      expect(store.works.find(workId)?.authorizationRef).toBe(authorizationRef);
      // A second assessment reuses the same grant instead of deriving another one.
      const again = orchestrator.assessWithDerivation({
        workId,
        payload: derivedPayload(),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      expect(again.authorizationRef).toBe(authorizationRef);
    });

    it('refuses an out-of-envelope agent.dispatch with zero residue (WP-12 T2.5)', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      orchestrator.assessWithDerivation({
        workId,
        payload: derivedPayload(),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      const before = {
        work: store.works.find(workId),
        runs: store.runs.list({ where: 'work_id = ?', params: [workId] }).length,
        authorizations: store.authorizations.list().length,
        snapshots: store.snapshots.list().length,
      };
      // The derived envelope covers `src/theme`; a spec reaching for another path, for an
      // **irreversible** operation, or for an explicit network target is refused by the same
      // guard the assessment path uses. `bash` is deliberately no longer in this list: it is
      // part of the derived coding envelope now (`execution.md` §2).
      const scopes: Scope[] = [
        { ...emptyScope, writePaths: ['src/elsewhere'] },
        { ...emptyScope, writePaths: ['src/theme'], operations: ['deploy'] },
        { ...emptyScope, writePaths: ['src/theme'], networkTargets: ['https://example.test'] },
      ];
      for (const scope of scopes) {
        try {
          orchestrator.dispatchProfessional({
            parentRunId: chief.id,
            spec: derivedSpec(workId, chief.id, { scope }),
          });
          throw new Error('expected a NOT_AUTHORIZED refusal');
        } catch (error) {
          expect(error).toMatchObject({ code: 'NOT_AUTHORIZED' });
        }
      }
      const after = store.works.find(workId);
      expect(after?.level).toBe(before.work?.level);
      expect(after?.authorizationRef).toBe(before.work?.authorizationRef);
      expect(after?.scope).toEqual(before.work?.scope);
      expect(store.runs.list({ where: 'work_id = ?', params: [workId] })).toHaveLength(before.runs);
      expect(store.authorizations.list()).toHaveLength(before.authorizations);
      expect(store.snapshots.list()).toHaveLength(before.snapshots);
    });

    it('refuses a develop dispatch before the Plan tasked the role (WP-12 W4)', () => {
      // `workflow.md` §3: Product→Plan→Develop. Without the Plan there is no Task, so the
      // develop Run could never obtain a file Grant and could only report a blocker; the
      // dispatch is refused with the remedy instead of being queued.
      const workId = freshWork({ task: false });
      const chief = chiefParent(workId);
      orchestrator.assessWithDerivation({
        workId,
        payload: derivedPayload(),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      const runsBefore = store.runs.list({ where: 'work_id = ?', params: [workId] }).length;
      try {
        orchestrator.dispatchProfessional({
          parentRunId: chief.id,
          spec: derivedSpec(workId, chief.id),
        });
        throw new Error('expected a GATE_NOT_READY refusal');
      } catch (error) {
        expect(error).toMatchObject({ code: 'GATE_NOT_READY' });
        expect((error as Error).message).toMatch(/Product→Plan→Develop/u);
      }
      expect(store.runs.list({ where: 'work_id = ?', params: [workId] })).toHaveLength(runsBefore);
      // The documented remedy is admitted: the planning stage is not a develop stage.
      const planning = orchestrator.dispatchProfessional({
        parentRunId: chief.id,
        spec: derivedSpec(workId, chief.id, {
          role: 'planning',
          purpose: 'artifact',
          stage: 'planning',
        }),
      });
      expect(planning.run.role).toBe('planning');
      // `plan.approve` binds the Plan's Task to the develop Run (`queueApprovedRun`), which
      // is what makes the same dispatch admissible afterwards.
      store.tasks.insert({
        id: store.newId(),
        projectId,
        workId,
        planRef: { id: store.newId(), version: 1, hash: 'c'.repeat(64) },
        role: 'backend',
        dependsOn: [],
        dependencyManifestRefs: [],
        scope: emptyScope,
        stage: 'develop',
        acceptanceIds: ['AC-003'],
      });
      const develop = orchestrator.dispatchProfessional({
        parentRunId: chief.id,
        spec: derivedSpec(workId, chief.id),
      });
      expect(develop.run.role).toBe('backend');
    });

    it('refuses to queue a child Run the Chief Run cannot fund (review P3)', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      orchestrator.assessWithDerivation({
        workId,
        payload: derivedPayload(),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      // Exhaust the parent's allocation with one legitimate child, then ask for another.
      orchestrator.dispatchProfessional({
        parentRunId: chief.id,
        spec: derivedSpec(workId, chief.id, { budgetAllocation: 10_000 }),
      });
      try {
        orchestrator.dispatchProfessional({
          parentRunId: chief.id,
          spec: derivedSpec(workId, chief.id, { budgetAllocation: 1_000 }),
        });
        throw new Error('expected BUDGET_EXCEEDED');
      } catch (error) {
        expect(error).toMatchObject({ code: 'BUDGET_EXCEEDED' });
      }
      expect(
        store.runs
          .list({ where: 'work_id = ?', params: [workId] })
          .filter((run) => run.role !== 'chief'),
      ).toHaveLength(1);
    });

    it('refuses an agent.dispatch write scope with no authorization (review P2-1)', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      // The Work never obtained authority: a write spec must be refused outright rather
      // than frozen with `authorizationRef: null`.
      try {
        orchestrator.dispatchProfessional({
          parentRunId: chief.id,
          spec: derivedSpec(workId, chief.id),
        });
        throw new Error('expected a NOT_AUTHORIZED refusal');
      } catch (error) {
        expect(error).toMatchObject({ code: 'NOT_AUTHORIZED' });
      }
      expect(store.runs.list({ where: 'work_id = ?', params: [workId] })).toHaveLength(1);
      expect(store.authorizations.list({ where: 'work_id = ?', params: [workId] })).toHaveLength(0);
    });

    it('refuses agent.dispatch from a Run that is not the Work’s Chief', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      orchestrator.assessWithDerivation({
        workId,
        payload: derivedPayload(),
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      });
      const child = orchestrator.dispatchProfessional({
        parentRunId: chief.id,
        spec: derivedSpec(workId, chief.id),
      }).run;
      expect(() =>
        orchestrator.dispatchProfessional({
          parentRunId: child.id,
          spec: derivedSpec(workId, chief.id),
        }),
      ).toThrowError(/not the Chief Run/);
    });

    it('leaves no Run or snapshot behind when the draft spec is invalid', () => {
      const workId = freshWork();
      const chief = chiefParent(workId);
      const runsBefore = store.runs.list().length;
      const snapshotsBefore = store.snapshots.list().length;
      expect(() =>
        orchestrator.assessAndDispatch({
          workId,
          payload: derivedPayload(),
          parentRunId: chief.id,
          // `role` is a closed union in the contract; the cast is what a hostile or
          // hallucinating Runner would send over the wire.
          spec: derivedSpec(workId, chief.id, {
            role: 'nobody',
          } as unknown as Partial<ProfessionalSpecDraft>),
          sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
        }),
      ).toThrowError(/VALIDATION_ERROR|agent.dispatch spec/);
      expect(store.runs.list().length).toBe(runsBefore);
      expect(store.snapshots.list().length).toBe(snapshotsBefore);
    });
  });
});

describe('the L2/L3 delivery route and a delivered Plan (WP-12 W4b)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let projectId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-route-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
      now: () => new Date().toISOString(),
    } as never);
    // The Work and its budget reference a registered Project (`data.md` §2), so the row
    // exists before any budget insert — the same order the daemon's project open uses.
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      gitRoot: ROOT,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
      head: 'a'.repeat(40),
    } as never);
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function routedWork(level: 'L2' | 'L3' = 'L2'): string {
    const workId = store.newId();
    // The Work references its budget, so both rows commit in one transaction (`data.md` §2:
    // the foreign key is deferred inside it), exactly like the daemon's own message path.
    return withTransaction(store.db, () => {
      const budget = store.budgets.insert({
        projectId,
        workId,
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
        id: workId,
        projectId,
        intent: 'delivery',
        purpose: 'deliver the cancellation change',
        level,
        goal: 'deliver the cancellation change',
        scope: {
          readPaths: ['src/a.ts'],
          writePaths: ['src/a.ts'],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
        sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
        status: 'running',
        blockerIds: [],
        budgetId: budget.id,
        policyRevision: 1,
      });
      return workId;
    });
  }

  /** One professional Run of the Work that delivered a successful stage result. */
  function deliveredStage(workId: string, role: string, stage: string): void {
    const chief = store.runs.insert({
      workId,
      role: 'chief',
      purpose: 'analysis',
      stage: 'coordinate',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'a'.repeat(64),
      contextSnapshotId: 'b'.repeat(64),
      dispatchSnapshotId: 'c'.repeat(64),
      budgetAllocation: 0,
    } as never);
    const run = store.runs.insert({
      workId,
      role,
      purpose: 'artifact',
      parentRunId: chief.id,
      stage,
      status: 'completed',
      requiredChild: true,
      join: 'all',
      childIds: [],
      configSnapshotId: 'd'.repeat(64),
      contextSnapshotId: 'e'.repeat(64),
      dispatchSnapshotId: 'f'.repeat(64),
      budgetAllocation: 0,
    } as never);
    const attempt = store.attempts.insert({
      runId: run.id,
      number: 1,
      status: 'completed',
      ownerEpoch: 0,
    });
    store.stageResults.insert({
      runId: run.id,
      attemptId: attempt.id,
      status: 'success',
      summary: `${role} delivered`,
      artifactRefs: [],
      evidenceRefs: [],
      changedPaths: [],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
    });
  }

  const planDocument = JSON.stringify({
    goal: 'make unpaid orders cancellable',
    scope: {
      readPaths: ['src/a.ts'],
      writePaths: ['src/a.ts'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    tasks: [
      {
        role: 'backend',
        goal: 'change src/a.ts',
        paths: ['src/a.ts'],
        dependsOn: [],
        acceptanceIds: ['AC-010'],
        checks: ['node --check'],
      },
    ],
    risks: ['the paid path must not change'],
  });

  it('projects the documented route from real records only', () => {
    const workId = routedWork();
    const work = store.works.find(workId)!;
    const before = deliveryRoute({ store, work, planApproved: false });
    expect(before.map((step) => step.stage)).toEqual([
      'Plan',
      'Develop',
      'Review',
      'Test',
      'Settle',
    ]);
    expect(before.every((step) => !step.delivered)).toBe(true);
    expect(nextDeliveryStage(before)?.stage).toBe('Plan');

    deliveredStage(workId, 'planning', 'planning');
    deliveredStage(workId, 'backend', 'develop-L2');
    const after = deliveryRoute({ store, work, planApproved: true });
    expect(after.map((step) => step.delivered)).toEqual([true, true, false, false, false]);
    expect(nextDeliveryStage(after)?.stage).toBe('Review');
    // The develop stage name follows the Work's level (`context/acl.ts` ROLE_STAGES).
    expect(after[1]?.runStage).toBe('develop-L2');
  });

  it('reads a delivered Plan document and refuses a non-Plan artifact body', () => {
    const document = parseDeliveredPlanDocument(Buffer.from(planDocument, 'utf8'));
    expect(document).not.toBeNull();
    expect(document?.goal).toBe('make unpaid orders cancellable');
    expect(document?.tasks).toHaveLength(1);
    expect(document?.tasks[0]?.acceptanceIds).toEqual(['AC-010']);
    expect(parseDeliveredPlanDocument(Buffer.from('not json', 'utf8'))).toBeNull();
    expect(parseDeliveredPlanDocument(Buffer.from('{"goal":"x"}', 'utf8'))).toBeNull();
    expect(
      parseDeliveredPlanDocument(
        Buffer.from('{"goal":"x","scope":{"readPaths":[]},"tasks":[]}', 'utf8'),
      ),
    ).toBeNull();
  });

  it('refuses a delivered Plan that writes outside the Work authorization', () => {
    const document = parseDeliveredPlanDocument(Buffer.from(planDocument, 'utf8'))!;
    expect(() =>
      assertPlanWithinAuthority({
        plan: document,
        writePaths: ['src/a.ts'],
        operations: ['read', 'edit'],
      }),
    ).not.toThrow();
    expect(() =>
      assertPlanWithinAuthority({
        plan: document,
        writePaths: ['other/'],
        operations: ['read', 'edit'],
      }),
    ).toThrowError(/outside the Work's authorization/);
    expect(() =>
      assertPlanWithinAuthority({
        plan: document,
        writePaths: ['src/a.ts'],
        operations: ['read'],
      }),
    ).toThrowError(/operations the Work is not authorized for/);
  });
});
