/**
 * WP-12 T4b round 2: `work.retry`, `recovery.inspect`/`recovery.resolve` and
 * `task.list`/`task.get` over real SQLite and the real `Orchestrator`.
 *
 * The Provider round trip is the only stub (a scripted transport), so "a new Run was
 * queued" is a real `Orchestrator` decision and a real `run` row, not a fabricated
 * response. The recovery report is produced by an injected `RunRecoveryPort` because
 * the daemon's production port delegates to the same `RecoveryReport` builder the
 * WP-11 recovery suite covers.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject } from '@agentdev/contracts';
import {
  ArtifactService,
  AttachmentService,
  ConfigStore,
  DecisionService,
  DownloadTokenStore,
  EventHub,
  FindingService,
  ModelGateway,
  Orchestrator,
  PlanGateService,
  RequirementContinuation,
  SnapshotWriter,
  createSecretRepository,
  SecretStore,
  userIdFromSubject,
  type GatewayTransport,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import { WorkbenchProtocol, type WorkbenchCaller, type RunRecoveryPort } from '../src/protocol.js';

const ROOT = '/tmp/agentdev-round2-root';
const GIT_HEAD = 'a'.repeat(40);
const MODEL_ID = 'stub-model';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7001';

const caller: WorkbenchCaller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief',
};

const stubTransport: GatewayTransport = {
  complete: () => Promise.resolve({ ok: true, text: 'pong', inputTokens: 3, outputTokens: 1 }),
};

let dataDir: string;
let stateDir: string;
let store: ProjectStore;
let protocol: WorkbenchProtocol;
let projectId: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-round2-'));
  stateDir = mkdtempSync(join(tmpdir(), 'agentdev-round2-home-'));
  projectId = projectIdFromRoot(ROOT);
  store = ProjectStore.open({
    dataDir,
    canonicalRoot: ROOT,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  store.projects.insert({
    id: projectId,
    root: ROOT,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: GIT_HEAD,
  });
  const blobs = new BlobStore({ root: dataDir });
  const artifacts = new ArtifactService({ store, blobs });
  const snapshots = new SnapshotWriter({ store });
  const config = ConfigStore.open({ globalDir: stateDir, projectRoot: dataDir, snapshots });
  const secrets = new SecretStore();
  const secretRepository = createSecretRepository({ home: stateDir, backend: 'file' });
  const gateway = new ModelGateway({
    config,
    snapshots,
    transport: stubTransport,
    secrets: { resolve: (ref) => (secrets.has(ref) ? 'gateway-visible' : undefined) },
  });
  const orchestrator = new Orchestrator({ store, config, snapshots, gateway });
  protocol = new WorkbenchProtocol({
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
    secrets,
    secretRepository,
  });
  protocol.attachOrchestrator(orchestrator);
});

afterEach(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

function call(method: string, params: JsonObject = {}): JsonObject {
  return JSON.parse(JSON.stringify(protocol.dispatch(method, params, { caller }))) as JsonObject;
}

function refusal(run: () => unknown): { code: string; message: string; details?: JsonObject } {
  try {
    run();
  } catch (error) {
    const failure = error as { code?: string; message?: string; details?: JsonObject };
    return {
      code: failure.code ?? '',
      message: failure.message ?? '',
      ...(failure.details === undefined ? {} : { details: failure.details }),
    };
  }
  throw new Error('expected the call to be refused');
}

function configureProvider(): void {
  const saved = call('provider.upsert', {
    provider: {
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      enabled: true,
      models: [
        {
          id: MODEL_ID,
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    },
    secret: 'sk-round2',
  });
  expect(saved['status']).toBe('applied');
  const providerId = saved['providerId'] as string;
  const profile = {
    providerId,
    modelId: MODEL_ID,
    reasoning: 'off',
    skills: [],
    toolSubset: [],
    contextLimit: 32_000,
  };
  const configured = call('config.save', {
    scope: 'global',
    patch: { roleOverrides: { chief: profile, backend: profile } },
  });
  expect(configured['status']).toBe('applied');
}

function seedWork(options: { readonly tokensUsed?: number } = {}): string {
  const budget = store.budgets.insert({
    projectId,
    workId: WORK_ID,
    tokenLimit: 200_000,
    tokensUsed: options.tokensUsed ?? 0,
    tokensReserved: 0,
    activeTimeLimit: 3_600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  store.works.insert({
    id: WORK_ID,
    projectId,
    intent: 'delivery',
    purpose: 'round 2 retry',
    level: 'L2',
    goal: 'retry the failed work',
    scope: { readPaths: ['src'], writePaths: [], operations: ['read'], networkTargets: [] },
    sourceRef: { kind: 'action', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7020', version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: GIT_HEAD,
    budgetId: budget.id,
    policyRevision: 1,
  });
  return WORK_ID;
}

function seedRun(status: string): string {
  return store.runs.insert({
    projectId,
    workId: WORK_ID,
    role: 'chief',
    purpose: 'analysis',
    stage: 'coordinate',
    status: status as never,
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: 'c'.repeat(64),
    contextSnapshotId: 'd'.repeat(64),
    dispatchSnapshotId: 'e'.repeat(64),
    budgetAllocation: 100,
  }).id;
}

function eventsOf(name: string) {
  return store.events.readAfter(0, { limit: 1_000 }).filter((event) => event.name === name);
}

describe('work.retry (protocol.md §4)', () => {
  it('queues a real new Run for a finished Work and records the user action', () => {
    configureProvider();
    seedWork();
    const failed = seedRun('failed');
    const result = call('work.retry', { workId: WORK_ID, reason: 'fix and retry' });
    expect(result['status']).toBe('accepted');
    const runId = result['runId'] as string;
    expect(runId).not.toBe(failed);
    expect(result['previousRunIds']).toEqual([failed]);
    const queued = store.runs.find(runId);
    expect(queued?.status).toBe('queued');
    expect(queued?.workId).toBe(WORK_ID);
    expect(queued?.role).toBe('chief');
    expect(eventsOf('run.queued').some((event) => event.entityId === runId)).toBe(true);
    const action = store.userActions.list({ where: 'action = ?', params: ['work.retry'] });
    expect(action).toHaveLength(1);
  });

  it('refuses while a Run still has unknown side effects (workflow.md §5.1)', () => {
    configureProvider();
    seedWork();
    seedRun('recovery_required');
    const unknown = refusal(() => call('work.retry', { workId: WORK_ID }));
    expect(unknown.code).toBe('RECOVERY_REQUIRED');
    expect(unknown.details?.['runId']).toBeDefined();
  });

  it('refuses while a Run is still live', () => {
    configureProvider();
    seedWork();
    const live = seedRun('running');
    const running = refusal(() => call('work.retry', { workId: WORK_ID }));
    expect(running.code).toBe('INVALID_STATE');
    expect(store.runs.find(live)?.status).toBe('running');
  });

  it('refuses when the Work has no token budget left', () => {
    configureProvider();
    seedWork({ tokensUsed: 200_000 });
    seedRun('failed');
    const empty = refusal(() => call('work.retry', { workId: WORK_ID }));
    expect(empty.code).toBe('BUDGET_EXCEEDED');
  });
});

describe('recovery.inspect / recovery.resolve (protocol.md §4, reliability.md §6)', () => {
  /**
   * Seeds the report address the way `RunRecoveryService.recordRestart` really does:
   * one `recover` operation row holding `stepResults.reports[]`, and the single
   * `recovery.report_ready` event of the same transaction.
   */
  function seedFrozenReport(runId: string): { reportRef: JsonObject; hash: string } {
    const run = store.runs.find(runId);
    const work = store.works.find(WORK_ID);
    if (run === undefined || work === undefined) throw new Error('seed the Work and Run first');
    const operationId = store.newId();
    const reportRef: JsonObject = { id: operationId, version: 1, hash: sha256(`report:${runId}`) };
    store.operations.insert({
      id: operationId,
      projectId,
      workId: WORK_ID,
      sourceRef: { kind: 'action', id: 'daemon-restart:test', version: '1' },
      kind: 'recover',
      state: 'completed',
      stepResults: {
        hostEpoch: 'host-test',
        reports: [{ runId, workId: WORK_ID, hash: reportRef['hash'], reportRef }],
      },
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    } as never);
    store.events.append({
      name: 'recovery.report_ready',
      entityId: runId,
      entityVersion: run.version,
      data: {
        runId,
        workId: WORK_ID,
        hostEpoch: 'host-test',
        reportRef,
        reportHash: reportRef['hash'] as string,
        expectedVersions: { run: run.version, attempt: null, work: work.version },
        recommendedActions: ['resume'],
      },
    });
    return { reportRef, hash: reportRef['hash'] as string };
  }

  function attachPort(overrides: Partial<RunRecoveryPort> = {}): { resumed: string[] } {
    const resumed: string[] = [];
    protocol.attachRunRecovery({
      recordResumeDecision: () => ({ ok: true }),
      resumeParkedRun: (runId) => {
        // The real supervisor opens the next Attempt and the Run leaves the parked
        // state; the fake does the same.
        const run = store.runs.find(runId);
        if (run !== undefined && run.status === 'interrupted') {
          store.runs.update(runId, { status: 'running' }, run.version);
        }
        resumed.push(runId);
        return { ok: true };
      },
      ...overrides,
    });
    return { resumed };
  }

  it('returns the frozen report without emitting a second recovery.report_ready', () => {
    seedWork();
    const runId = seedRun('interrupted');
    const seeded = seedFrozenReport(runId);
    const { resumed } = attachPort();
    const inspected = call('recovery.inspect', { workId: WORK_ID });
    expect(inspected['status']).toBe('accepted');
    const reports = inspected['reports'] as JsonObject[];
    expect(reports).toHaveLength(1);
    expect(reports[0]?.['runId']).toBe(runId);
    expect(reports[0]?.['reportHash']).toBe(seeded.hash);
    expect((reports[0]?.['reportRef'] as JsonObject)['id']).toBe(seeded.reportRef['id']);
    // Exactly one event: the restart recovery's own, never one per inspect.
    expect(eventsOf('recovery.report_ready')).toHaveLength(1);
    expect(call('recovery.inspect', { workId: WORK_ID })['status']).toBe('accepted');
    expect(eventsOf('recovery.report_ready')).toHaveLength(1);

    const resolved = call('recovery.resolve', {
      workId: WORK_ID,
      reportRef: seeded.reportRef,
      choice: 'resume',
    });
    expect(resolved['status']).toBe('accepted');
    expect(resolved['resumedRunIds']).toEqual([runId]);
    expect(resumed).toEqual([runId]);
    expect(eventsOf('recovery.report_ready')).toHaveLength(1);
  });

  it('refuses to apply a report whose target versions moved (reliability.md §6)', () => {
    seedWork();
    const runId = seedRun('interrupted');
    const seeded = seedFrozenReport(runId);
    attachPort();
    // The Work moved after the report was frozen.
    const work = store.works.find(WORK_ID);
    if (work === undefined) throw new Error('work missing');
    store.works.update(WORK_ID, { purpose: 'moved on' }, work.version);
    const stale = refusal(() =>
      call('recovery.resolve', { workId: WORK_ID, reportRef: seeded.reportRef, choice: 'resume' }),
    );
    expect(stale.code).toBe('STALE_ARTIFACT');
    expect((stale.details?.['drifted'] as JsonObject)['work']).toBeDefined();

    // A report that names another Work is never applied.
    const foreign = refusal(() =>
      call('recovery.resolve', {
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7099',
        reportRef: seeded.reportRef,
        choice: 'resume',
      }),
    );
    expect(foreign.code).toBe('NOT_FOUND');
    expect(store.runs.find(runId)?.status).toBe('interrupted');
  });

  it('refuses an undefined choice, a missing report and a Work without one', () => {
    seedWork();
    seedRun('interrupted');
    attachPort();
    expect(
      refusal(() => call('recovery.resolve', { workId: WORK_ID, reportRef: {}, choice: 'nope' }))
        .code,
    ).toBe('VALIDATION_ERROR');
    expect(
      refusal(() =>
        call('recovery.resolve', {
          workId: WORK_ID,
          reportRef: {
            id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7098',
            version: 1,
            hash: 'a'.repeat(64),
          },
          choice: 'resume',
        }),
      ).code,
    ).toBe('NOT_FOUND');
    // No restart recovery ever froze a report for this Work.
    expect(refusal(() => call('recovery.inspect', { workId: WORK_ID })).code).toBe('INVALID_STATE');
  });
});

describe('task.list / task.get (protocol.md §4)', () => {
  function seedTask(): string {
    const taskId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7040';
    store.tasks.insert({
      id: taskId,
      projectId,
      workId: WORK_ID,
      planRef: { id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7050', version: 1, hash: 'f'.repeat(64) },
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: { readPaths: ['src'], writePaths: [], operations: ['read'], networkTargets: [] },
      stage: 'develop',
      acceptanceIds: ['AC-081'],
    } as never);
    store.runs.insert({
      projectId,
      workId: WORK_ID,
      taskId,
      role: 'backend',
      purpose: 'implementation',
      stage: 'develop-L2',
      status: 'completed',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'c'.repeat(64),
      contextSnapshotId: 'd'.repeat(64),
      dispatchSnapshotId: 'e'.repeat(64),
      budgetAllocation: 100,
    });
    return taskId;
  }

  it('lists the Work Task DAG and gets one Task with its Runs', () => {
    seedWork();
    const taskId = seedTask();
    const listed = call('task.list', { workId: WORK_ID });
    const items = listed['items'] as JsonObject[];
    expect(items).toHaveLength(1);
    expect(items[0]?.['id']).toBe(taskId);
    expect(items[0]?.['runCount']).toBe(1);

    const got = call('task.get', { taskId });
    expect((got['task'] as JsonObject)['id']).toBe(taskId);
    expect((got['work'] as JsonObject)['id']).toBe(WORK_ID);
    expect(got['runs'] as JsonObject[]).toHaveLength(1);

    expect(
      refusal(() => call('task.list', { workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7097' })).code,
    ).toBe('NOT_FOUND');
    expect(
      refusal(() => call('task.get', { taskId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7096' })).code,
    ).toBe('NOT_FOUND');
  });
});
