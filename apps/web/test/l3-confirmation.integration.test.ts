/**
 * The explicit L3 confirmation interaction over the real daemon (AC-011).
 *
 * The product model in force (`9c10d93`) keeps the agent on the host and reserves the
 * approval interaction for **irreversible / high-risk** operations. `workflow.md` §2.3
 * routes identity/permission, Secret, security-boundary, data deletion/migration,
 * payment, incompatible public protocol, deploy/release and project-gate-rule work to
 * L3, and §3 makes the L3 route `Plan → Develop → …`. AC-011 asks for an explicit
 * authorization *interaction*: the user has to see what was routed and answer, and
 * nothing high-risk may execute before that answer is recorded.
 *
 * Everything below is the real stack — real SQLite `ProjectStore`, the real
 * `WorkbenchProtocol`, the real `Orchestrator` (which owns the L3 confirmation service),
 * the real control handler (`assessment.submit`), the real Plan gate and the real
 * Inbox projection. Only the Work/Run rows the user's message would normally create are
 * seeded, exactly as the other daemon drills do, so the assertions are about the
 * interaction under test rather than about the seeding.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ArtifactService,
  AttachmentService,
  ConfigStore,
  DecisionService,
  DownloadTokenStore,
  EventHub,
  FindingService,
  L3_CONFIRMATION_CHOICES,
  ModelGateway,
  Orchestrator,
  PlanGateService,
  professionalSpec,
  RequirementContinuation,
  SnapshotWriter,
  userIdFromSubject,
  type GatewayTransport,
  type ProtocolError,
} from '@agentdev/core';
import { ProjectStore, BlobStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import type { JsonObject } from '@agentdev/contracts';

import { createControlHandlers } from '../../daemon/src/control-handler.js';
import { WorkbenchProtocol, type WorkbenchCaller } from '../../daemon/src/protocol.js';

const PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'agentdev-l3-root-'));
const GIT_HEAD = 'b'.repeat(40);
const MIGRATION_GOAL = 'migrate the delivery tables to the new schema';

/** A transport that never leaves the process: no provider is called by this drill. */
const offlineTransport: GatewayTransport = {
  complete: () => Promise.resolve({ ok: true, text: 'ok', inputTokens: 1, outputTokens: 1 }),
};

interface Drill {
  readonly store: ProjectStore;
  readonly protocol: WorkbenchProtocol;
  readonly orchestrator: Orchestrator;
  readonly snapshots: SnapshotWriter;
  readonly artifacts: ArtifactService;
  readonly projectId: string;
  readonly caller: WorkbenchCaller;
  close(): Promise<void>;
}

let drill: Drill;
let workId = '';
let chiefRunId = '';
let confirmationDecisionId = '';

/** Opens the real daemon surface over a temporary store. */
function boot(): Drill {
  const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-l3-data-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'agentdev-l3-state-'));
  const store = ProjectStore.open({
    dataDir,
    canonicalRoot: PROJECT_ROOT,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  const projectId = projectIdFromRoot(PROJECT_ROOT);
  const blobs = new BlobStore({ root: dataDir });
  const artifacts = new ArtifactService({ store, blobs });
  const snapshots = new SnapshotWriter({ store });
  // The real config store freezes the Run's configuration snapshot through the real
  // writer (`agents.md` §5), so the admission path can freeze the Run it admits.
  const config = ConfigStore.open({ globalDir: stateDir, projectRoot: dataDir, snapshots });
  const provider = config.upsertProvider({
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1',
    enabled: true,
    models: [
      {
        id: 'drill-model',
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        reasoningLevels: ['off'],
        vision: false,
      },
    ],
  });
  config.update('global', {
    roleOverrides: {
      chief: {
        providerId: provider.providerId,
        modelId: 'drill-model',
        reasoning: 'off',
        skills: [],
        toolSubset: [],
        contextLimit: 32_000,
      },
      backend: {
        providerId: provider.providerId,
        modelId: 'drill-model',
        reasoning: 'off',
        skills: [],
        toolSubset: [],
        contextLimit: 32_000,
      },
    },
  });
  const gateway = new ModelGateway({ config, snapshots, transport: offlineTransport });
  const orchestrator = new Orchestrator({ store, config, snapshots, gateway });
  const protocol = new WorkbenchProtocol({
    store,
    blobs,
    events: new EventHub({ store }),
    attachments: new AttachmentService({ store, blobs }),
    artifacts,
    tokens: new DownloadTokenStore(),
    version: '0.0.0-test',
    config,
    gates: new PlanGateService({ store, artifacts, blobs }),
    decisions: new DecisionService({ store, artifacts }),
    findings: new FindingService({ store, artifacts }),
    requirements: new RequirementContinuation({ store }),
  });
  // The protocol answers `decision.resolve` for an L3 confirmation through the same
  // service the admission guard reads (`attachOrchestrator`).
  protocol.attachOrchestrator(orchestrator);
  protocol.attachGateway(gateway);
  store.projects.insert({
    id: projectId,
    root: PROJECT_ROOT,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: GIT_HEAD,
  });
  const caller: WorkbenchCaller = {
    subject: 'installation:local',
    userId: userIdFromSubject('installation:local'),
    role: 'chief',
  };
  return {
    store,
    protocol,
    orchestrator,
    snapshots,
    artifacts,
    projectId,
    caller,
    close: () => {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}

/**
 * Seeds the Work and the Chief Run a message would have created.
 *
 * The Work starts at `none` — the state a freshly routed request is in — so the L3
 * level and everything that follows come from the assessment under test.
 */
function seedWorkAndChiefRun(input: Drill): {
  workId: string;
  runId: string;
  authorizationId: string;
} {
  const store = input.store;
  const id = store.newId();
  const budget = store.budgets.insert({
    projectId: input.projectId,
    workId: id,
    tokenLimit: 500_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 7_200,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  const work = store.works.insert({
    id,
    projectId: input.projectId,
    intent: 'assist',
    purpose: 'route the request',
    level: 'none',
    goal: MIGRATION_GOAL,
    scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
    sourceRef: { kind: 'action', id: store.newId(), version: '1' },
    // The Work row the supervisor's `markWorkRunning` produces once it picks the Chief
    // Run up (`workflow.md` §5.1 `queued → running`); the assessment under test then
    // parks it on the confirmation.
    status: 'running',
    blockerIds: [],
    baseRevision: GIT_HEAD,
    budgetId: budget.id,
    policyRevision: 1,
  });
  const run = store.runs.insert({
    id: store.newId(),
    projectId: input.projectId,
    workId: work.id,
    role: 'chief',
    purpose: 'analysis',
    stage: 'assess',
    status: 'running',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: sha256(`config:${work.id}`),
    contextSnapshotId: sha256(`context:${work.id}`),
    dispatchSnapshotId: sha256(`dispatch:${work.id}`),
    budgetAllocation: 100_000,
  });
  store.attempts.insert({
    id: store.newId(),
    projectId: input.projectId,
    runId: run.id,
    number: 1,
    status: 'running',
    ownerEpoch: 1,
    runnerId: 'drill-runner',
  });
  // The authority the routing assessment is admitted under. `workflow.md` §2.3 makes an
  // L3 delivery an explicit-authorization route, so a real authorization row exists
  // before the assessment — this is the user's authorization, not something the drill
  // invents for the confirmation.
  const authorization = store.authorizations.insert({
    projectId: input.projectId,
    sourceRef: { kind: 'action', id: store.newId(), version: '1' },
    workId: work.id,
    goal: MIGRATION_GOAL,
    scope: {
      readPaths: ['src'],
      writePaths: ['src/db', 'src/config'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    operations: ['read', 'edit'],
    acceptedAt: new Date().toISOString(),
  });
  return { workId: work.id, runId: run.id, authorizationId: authorization.id };
}

/** The control channel the Chief's Runner uses, over the real handler. */
function controlHandlers(input: Drill): ReturnType<typeof createControlHandlers>['handler'] {
  return createControlHandlers({
    store: input.store,
    orchestrator: input.orchestrator,
    // This drill never submits a stage, so a gate is provided only because the
    // handler's contract names it; nothing below reaches it.
    stageGate: {
      submit: () => {
        throw new Error('the L3 confirmation drill submits no stage result');
      },
    } as never,
    artifacts: input.artifacts,
    log: () => undefined,
  }).handler;
}

/** The inbox answer as the browser reads it (`protocol.md` §5 `inbox`). */
function inboxDecisions(input: Drill): JsonObject[] {
  const answer = input.protocol.dispatch('inbox', {}, { caller: input.caller }) as {
    items: JsonObject[];
  };
  return answer.items.filter((item) => item['kind'] === 'decision');
}

/** The `decision.resolve` write, as the Inbox button sends it. */
function resolveDecision(
  input: Drill,
  decisionId: string,
  choice: string,
  reason?: string,
): unknown {
  return input.protocol.dispatch(
    'decision.resolve',
    {
      decisionId,
      choice,
      ...(reason === undefined ? {} : { reason }),
    },
    { caller: input.caller, idempotencyKey: `l3-${choice}-${decisionId}` },
  );
}

beforeAll(() => {
  drill = boot();
});

afterAll(async () => {
  await drill.close();
  rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

describe('explicit L3 confirmation over the real daemon (AC-011)', () => {
  it('raises one visible confirmation when the routing assessment routes L3, and admits nothing before it is answered', () => {
    const seeded = seedWorkAndChiefRun(drill);
    workId = seeded.workId;
    chiefRunId = seeded.runId;
    const handlers = controlHandlers(drill);

    // 1. The Chief's routing assessment for a real data migration. `workflow.md` §2.3
    //    routes the documented risk flag to L3; the assessment is what makes the Work L3.
    const submitted = handlers.assessmentSubmit({
      caller: { runId: chiefRunId, attemptId: drill.store.newId(), epoch: 1, role: 'chief' },
      workId,
      assessment: {
        intent: 'delivery',
        goal: MIGRATION_GOAL,
        scope: {
          readPaths: ['src'],
          writePaths: ['src/db'],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
        level: 'L3',
        semanticImpact: true,
        riskFlags: ['数据删除/迁移'],
        uncertainties: [],
        policyRevision: 1,
        authorizationRef: seeded.authorizationId,
        reason: 'the migration rewrites stored delivery rows, which is not reversible in place',
      },
    });
    expect(submitted['saved']).toBe(true);
    expect(submitted['level']).toBe('L3');

    const work = drill.store.works.find(workId);
    expect(work?.level).toBe('L3');

    // 2. The confirmation Decision exists, is pending, and offers exactly the two
    //    documented answers with the risk flag the routing produced.
    const decisions = inboxDecisions(drill);
    const confirmationRow = decisions.find((item) => item['l3Confirmation'] !== undefined);
    expect(confirmationRow).toBeDefined();
    const confirmation = confirmationRow?.['l3Confirmation'] as JsonObject;
    const decisionId = confirmationRow?.['id'] as string;
    expect(confirmationRow?.['decisionKind']).toBe('product');
    expect(confirmationRow?.['state']).toBe('pending');
    expect(confirmationRow?.['choices']).toEqual([...L3_CONFIRMATION_CHOICES]);
    expect(confirmation['workId']).toBe(workId);
    expect(confirmation['level']).toBe('L3');
    expect(confirmation['riskFlags']).toEqual(['数据删除/迁移']);
    expect(confirmation['reason']).toBe(
      'the migration rewrites stored delivery rows, which is not reversible in place',
    );
    expect(confirmation['outcome']).toBe('pending');
    expect(confirmation['scope']).toMatchObject({ writePaths: ['src/db'] });
    expect(confirmation['revision']).toBe(GIT_HEAD);

    // The question body the card renders is a real artifact (protocol.md §6).
    const targetRef = confirmationRow?.['targetRef'] as JsonObject;
    const artifact = drill.store.artifacts.find(targetRef['id'] as string);
    if (artifact === undefined) throw new Error('the confirmation question artifact is missing');
    expect(artifact.kind).toBe('decision');
    expect(artifact.mime).toBe('text/markdown');
    const question = Buffer.from(drill.artifacts.read(artifact)).toString('utf8');
    expect(question).toContain('L3');
    expect(question).toContain('数据删除/迁移');
    expect(question).toContain('src/db');
    expect(question).toContain(workId);

    // 3. The Work is parked on the Decision: blocked + the Decision as its blocker.
    const parked = drill.store.works.find(workId);
    expect(parked?.status).toBe('blocked');
    expect(parked?.blockerIds).toContain(decisionId);
    expect(drill.orchestrator.confirmations.pending(workId)).toBe(true);

    // 4. The high-risk step cannot begin: a professional dispatch of the L3 develop
    //    route is refused while the confirmation is unanswered, with zero residue
    //    (no Run row, no snapshot).
    const runsBefore = drill.store.runs.list({ where: 'work_id = ?', params: [workId] }).length;
    const snapshotsBefore = drill.store.snapshots.list({}).length;
    let refusal: ProtocolError | undefined;
    try {
      drill.orchestrator.dispatch({ spec: l3DevelopSpec(drill, workId, chiefRunId) });
    } catch (error) {
      refusal = error as ProtocolError;
    }
    expect(refusal?.code).toBe('GATE_NOT_READY');
    expect(refusal?.message).toContain('confirmation');
    expect(refusal?.details?.['l3Confirmation']).toBe('pending');
    expect(refusal?.details?.['decisionId']).toBe(decisionId);
    expect(drill.store.runs.list({ where: 'work_id = ?', params: [workId] }).length).toBe(
      runsBefore,
    );
    expect(drill.store.snapshots.list({}).length).toBe(snapshotsBefore);

    // 5. The audit shows the raise in the documented order: `decision.created` happened
    //    when the assessment was recorded, and no execution event followed it.
    const events = drill.store.events.readAfter(0, { limit: 5_000 });
    const created = events.findIndex(
      (event) => event.name === 'decision.created' && event.entityId === decisionId,
    );
    expect(created).toBeGreaterThan(-1);
    expect(
      events.some(
        (event) =>
          event.name === 'work.control_changed' &&
          event.data['control'] === 'l3-confirmation-required',
      ),
    ).toBe(true);
    expect(events.some((event) => event.name === 'decision.resolved')).toBe(false);

    confirmationDecisionId = decisionId;
  });

  it('resumes the route after the user confirms, and records user → decision → execution in that order', () => {
    const decisionId = confirmationDecisionId;
    expect(decisionId).not.toBe('');

    // 1. The Inbox button resolves the confirmation through the documented entry point.
    const resolved = resolveDecision(drill, decisionId, 'confirm') as {
      status?: string;
      state?: string;
      choice?: string;
      l3Confirmation?: JsonObject;
    };
    expect(resolved.status).toBe('applied');
    expect(resolved.state).toBe('accepted');
    expect(resolved.choice).toBe('confirm');
    expect(resolved.l3Confirmation?.['accepted']).toBe(true);
    expect(resolved.l3Confirmation?.['workId']).toBe(workId);

    // 2. The Work is no longer parked: the blocker is cleared and the status resumed.
    const work = drill.store.works.find(workId);
    expect(work?.status).toBe('running');
    expect(work?.blockerIds).not.toContain(decisionId);
    expect(drill.orchestrator.confirmations.pending(workId)).toBe(false);
    expect(drill.orchestrator.confirmations.latest(workId)?.state).toBe('accepted');

    // 3. The high-risk step is now admitted: a real professional Run is created.
    const result = drill.orchestrator.dispatch({ spec: l3DevelopSpec(drill, workId, chiefRunId) });
    expect(result.run.status).toBe('queued');
    expect(result.run.role).toBe('backend');
    expect(result.run.stage).toBe('develop-L3');
    expect(result.run.parentRunId).toBe(chiefRunId);

    // 4. The audit really shows user → decision → execution: `decision.created`, then
    //    `decision.resolved` carrying the answer, then `run.queued` for the admitted Run.
    const events = drill.store.events.readAfter(0, { limit: 5_000 });
    const created = events.findIndex(
      (event) => event.name === 'decision.created' && event.entityId === decisionId,
    );
    const answered = events.findIndex(
      (event) => event.name === 'decision.resolved' && event.entityId === decisionId,
    );
    const executed = events.findIndex(
      (event) => event.name === 'run.queued' && event.entityId === result.run.id,
    );
    expect(created).toBeGreaterThan(-1);
    expect(answered).toBeGreaterThan(created);
    expect(executed).toBeGreaterThan(answered);
    expect(events[answered]?.data['choice']).toBe('confirm');
    expect(events[answered]?.data['kind']).toBe('l3_confirmation');

    // 5. The Inbox no longer lists the confirmation as actionable, and resolving the same
    //    choice again is the documented idempotent replay (not a second decision).
    const row = inboxDecisions(drill).find((item) => item['id'] === decisionId);
    expect(row?.['state']).toBe('accepted');
    expect(row?.['actionable']).toBe(false);
    // A replay with the same key and payload returns the recorded answer, so no second
    // decision is minted.
    const replay = resolveDecision(drill, decisionId, 'confirm') as { status?: string };
    expect(replay.status).toBe('applied');
    expect(
      drill.store.decisions
        .list({ where: 'work_id = ?', params: [workId] })
        .filter((row) => row.kind === 'product'),
    ).toHaveLength(1);
  });

  it('blocks the high-risk step when the user declines, and records the reason', () => {
    const seeded = seedWorkAndChiefRun(drill);
    const handlers = controlHandlers(drill);
    handlers.assessmentSubmit({
      caller: { runId: seeded.runId, attemptId: drill.store.newId(), epoch: 1, role: 'chief' },
      workId: seeded.workId,
      assessment: {
        intent: 'delivery',
        goal: 'rotate the provider credentials',
        scope: {
          readPaths: ['src'],
          writePaths: ['src/config'],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
        level: 'L3',
        semanticImpact: true,
        riskFlags: ['Secret'],
        uncertainties: [],
        policyRevision: 1,
        authorizationRef: seeded.authorizationId,
        reason: 'the change rewrites a stored credential',
      },
    });
    const decisionId = inboxDecisions(drill).find(
      (item) =>
        (item['workId'] as string) === seeded.workId && item['l3Confirmation'] !== undefined,
    )?.['id'] as string;
    expect(decisionId).toBeDefined();

    // Declining is a deliberate refusal of a high-risk delivery; the reason is recorded
    // and the Work stays blocked instead of silently continuing.
    const declined = resolveDecision(
      drill,
      decisionId,
      'decline',
      'the migration plan is not acceptable yet',
    ) as { status?: string; state?: string; l3Confirmation?: JsonObject };
    expect(declined.status).toBe('applied');
    expect(declined.state).toBe('rejected');
    expect(declined.l3Confirmation?.['accepted']).toBe(false);
    expect(declined.l3Confirmation?.['reason']).toBe('the migration plan is not acceptable yet');
    // The Work stays blocked on the refused Decision: the blocker is *not* cleared by a
    // decline, so the Work's own row shows why it is parked (`workflow.md` §5.1).
    const declinedWork = drill.store.works.find(seeded.workId);
    expect(declinedWork?.status).toBe('blocked');
    expect(declinedWork?.blockerIds).toContain(decisionId);
    expect(drill.orchestrator.confirmations.pending(seeded.workId)).toBe(true);

    // The decline really blocks execution, and the reason is on the documented event.
    let refusal: ProtocolError | undefined;
    try {
      drill.orchestrator.dispatch({ spec: l3DevelopSpec(drill, seeded.workId, seeded.runId) });
    } catch (error) {
      refusal = error as ProtocolError;
    }
    expect(refusal?.code).toBe('GATE_NOT_READY');
    expect(refusal?.details?.['l3Confirmation']).toBe('rejected');
    const events = drill.store.events.readAfter(0, { limit: 5_000 });
    const answered = events.find(
      (event) => event.name === 'decision.resolved' && event.entityId === decisionId,
    );
    expect(answered?.data['choice']).toBe('decline');
    expect(answered?.data['reason']).toBe('the migration plan is not acceptable yet');
    expect(
      events.some(
        (event) => event.name === 'work.control_changed' && event.data['control'] === 'l3-declined',
      ),
    ).toBe(true);

    // The Inbox keeps the refusal visible with the reason, and never re-offers it as an
    // actionable decision.
    const row = inboxDecisions(drill).find((item) => item['id'] === decisionId);
    expect(row?.['state']).toBe('rejected');
    expect(row?.['actionable']).toBe(false);
    expect((row?.['l3Confirmation'] as JsonObject)['declineReason']).toBe(
      'the migration plan is not acceptable yet',
    );
  });
});

/**
 * One professional develop dispatch for an L3 Work, as a Chief Run submits it.
 *
 * `kind`, `workId` and `profileRevision` are Core's (`data.md` §3), so the spec is
 * built through `professionalSpec` with the current profile revision — exactly what a
 * real Chief dispatch produces. The develop stage is the L3 spelling Core itself uses
 * (`developStageFor('L3')`).
 */
function l3DevelopSpec(
  input: Drill,
  forWorkId: string,
  parentRunId: string,
): ReturnType<typeof professionalSpec> {
  return professionalSpec({
    workId: forWorkId,
    role: 'backend',
    purpose: 'implementation',
    goal: MIGRATION_GOAL,
    scope: {
      readPaths: ['src'],
      writePaths: ['src/db'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    stage: 'develop-L3',
    contextSelection: {
      goal: MIGRATION_GOAL,
      sourceRefs: [],
      reasonPerSource: {},
      featureRefs: [],
      codePaths: ['src/db'],
      artifactRefs: [],
      excluded: [],
      unknowns: [],
      readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
    },
    profileRevision: input.orchestrator.currentProfileRevision('backend'),
    requiredOutputs: ['stage_result'],
    requiredChild: false,
    joinPolicy: 'none',
    budgetAllocation: 20_000,
    parentRunId,
  } as never);
}
