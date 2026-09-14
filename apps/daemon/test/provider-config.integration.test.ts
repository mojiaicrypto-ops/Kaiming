/**
 * WP-12 T2.0/T2.6 integration: the Provider commands and the approved-Plan → Run hand-off.
 *
 * `protocol.md` §5 defines `provider.upsert` (ProviderInput plus the secret value, with the
 * `secretRef` server-created) and `provider.test` (`accepted`, then a persistent
 * `provider.test_completed` event). `WP-12` Q3=A makes `plan.approve` queue the next
 * professional Run from the Plan the user already approved.
 *
 * Everything here is real SQLite, a real 0600 credential repository, the real
 * `PlanGateService` and the real `Orchestrator`; only the model round trip is a stub, so
 * "the connection test passed" is a real transport result rather than an assumption.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactService,
  AttachmentService,
  ConfigStore,
  createSecretRepository,
  DecisionService,
  DownloadTokenStore,
  EventHub,
  FindingService,
  ModelGateway,
  Orchestrator,
  PlanGateService,
  RequirementContinuation,
  SecretStore,
  SnapshotWriter,
  userIdFromSubject,
  type GatewayTransport,
  type PlanDraft,
  type SecretRepository,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import type { JsonObject } from '@agentdev/contracts';

import { WorkbenchProtocol, type WorkbenchCaller } from '../src/protocol.js';

const ROOT = '/tmp/agentdev-provider-root';
const GIT_HEAD = 'a'.repeat(40);
const MODEL_ID = 'stub-model';

const uuid = (suffix: string): string => `018f2c1e-9a4b-7c3d-8e5f-${suffix.padStart(12, '0')}`;

let dataDir: string;
let stateDir: string;
let store: ProjectStore;
let config: ConfigStore;
let snapshots: SnapshotWriter;
let protocol: WorkbenchProtocol;
let secrets: SecretStore;
let secretRepository: SecretRepository;
let transportCalls: number;

const caller: WorkbenchCaller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief',
};

/** A transport that answers every probe, so "connected" is a real result. */
const stubTransport: GatewayTransport = {
  complete: () => {
    transportCalls += 1;
    return Promise.resolve({ ok: true, text: 'pong', inputTokens: 3, outputTokens: 1 });
  },
};

function providerInput(overrides: JsonObject = {}): JsonObject {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-provider-'));
  stateDir = mkdtempSync(join(tmpdir(), 'agentdev-provider-home-'));
  store = ProjectStore.open({
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
    head: GIT_HEAD,
  });
  const blobs = new BlobStore({ root: dataDir });
  const artifacts = new ArtifactService({ store, blobs });
  snapshots = new SnapshotWriter({ store });
  config = ConfigStore.open({ globalDir: stateDir, projectRoot: dataDir, snapshots });
  secrets = new SecretStore();
  secretRepository = createSecretRepository({ home: stateDir, backend: 'file' });
  transportCalls = 0;
  const gateway = new ModelGateway({
    config,
    snapshots,
    transport: stubTransport,
    secrets: {
      resolve: (ref) => (secrets.has(ref) ? 'gateway-visible' : undefined),
    },
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
  protocol.attachGateway(gateway);
  protocol.attachOrchestrator(orchestrator);
});

afterEach(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

function call(method: string, params: JsonObject): JsonObject {
  return protocol.dispatch(method, params, { caller }) as JsonObject;
}

/** The `providerId` a provider command answered, typed instead of widened JSON. */
function providerIdOf(value: JsonObject): string {
  const id = value['providerId'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('the command did not answer a providerId');
  }
  return id;
}

describe('provider.upsert / provider.test (WP-12 T2.0)', () => {
  it('registers the provider and its credential without ever echoing the value', () => {
    const secret = 'sk-drill-secret-value';
    const result = call('provider.upsert', { provider: providerInput(), secret });
    expect(result).toMatchObject({ status: 'applied', secretConfigured: true });
    expect(typeof result['providerId']).toBe('string');
    expect(typeof result['version']).toBe('number');
    // The response never carries the value, nor a digest of it.
    expect(JSON.stringify(result)).not.toContain(secret);

    // The credential is really registered under the `gateway` audience, and the 0600
    // config file holds only the server-created reference.
    const providerId = providerIdOf(result);
    const saved = config.provider(providerId);
    expect(saved?.secretRef).toBe(`provider:${providerId}`);
    // The durable repository really holds the value, and the running daemon can resolve it.
    expect(secretRepository.get(saved?.secretRef ?? '')?.value).toBe(secret);
    expect(secrets.has(saved?.secretRef ?? '')).toBe(true);
    const configFile = readFileSync(join(stateDir, 'config.toml'), 'utf8');
    expect(configFile).not.toContain(secret);
    expect(configFile).toContain(`provider:${providerId}`);

    // `config.get` reports the registration honestly.
    const document = call('config.get', { scope: 'global' });
    const providers = document['providers'] as JsonObject[];
    expect(providers[0]).toMatchObject({ secretConfigured: true, enabled: true });
  });

  it('keeps the stored credential when the secret field is left blank', () => {
    const first = call('provider.upsert', { provider: providerInput(), secret: 'sk-first' });
    const firstId = providerIdOf(first);
    const ref = `provider:${firstId}`;
    const second = call('provider.upsert', {
      provider: providerInput({ providerId: firstId }),
    });
    expect(second).toMatchObject({ providerId: firstId, secretConfigured: true });
    expect(secretRepository.get(ref)?.value).toBe('sk-first');
    expect(secrets.has(ref)).toBe(true);
  });

  it('probes the live configuration and emits provider.test_completed', async () => {
    const saved = call('provider.upsert', { provider: providerInput(), secret: 'sk-probe' });
    const providerId = providerIdOf(saved);
    const accepted = call('provider.test', { providerId, modelId: MODEL_ID });
    expect(accepted).toMatchObject({ status: 'accepted', accepted: true });
    expect(transportCalls).toBe(1);

    // The outcome is the documented persistent event (`protocol.md` §7).
    const deadline = Date.now() + 5_000;
    let event = store.events
      .readAfter(0, { limit: 100 })
      .find((entry) => entry.name === 'provider.test_completed');
    while (event === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      event = store.events
        .readAfter(0, { limit: 100 })
        .find((entry) => entry.name === 'provider.test_completed');
    }
    expect(event?.data).toMatchObject({
      providerId,
      modelId: MODEL_ID,
      accepted: true,
      ok: true,
    });
    expect(typeof event?.data['latencyMs']).toBe('number');
  });

  it('refuses a test for an unknown model instead of pretending it ran', () => {
    const saved = call('provider.upsert', { provider: providerInput(), secret: 'sk-probe' });
    const providerId = providerIdOf(saved);
    expect(() => call('provider.test', { providerId, modelId: 'nope' })).toThrowError(
      /not configured/,
    );
    expect(transportCalls).toBe(0);
  });
});

describe('plan.approve queues the next Run (WP-12 T2.6, Q3=A)', () => {
  /** A Work with a budget, a completed Planning Run, a live Chief Run and an authorization. */
  function seedApprovalPreconditions(): {
    workId: string;
    planningRunId: string;
    chiefRunId: string;
    authorizationId: string;
  } {
    const projectId = projectIdFromRoot(ROOT);
    const workId = uuid('10');
    const budget = store.budgets.insert({
      projectId,
      workId,
      tokenLimit: 500_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 7_200,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    store.works.insert({
      id: workId,
      projectId,
      intent: 'delivery',
      purpose: 'seed the plan approval',
      level: 'L2',
      goal: 'ship the approved plan',
      scope: {
        readPaths: ['packages/core/src'],
        writePaths: ['packages/core/src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: GIT_HEAD,
      budgetId: budget.id,
      policyRevision: 1,
    });
    const run = (role: string, stage: string, parentRunId?: string): string => {
      const row = store.runs.insert({
        projectId,
        workId,
        role: role as never,
        purpose: role === 'chief' ? 'analysis' : 'artifact',
        stage,
        status: role === 'chief' ? 'running' : 'completed',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: sha256(`config-${role}`),
        contextSnapshotId: sha256(`context-${role}`),
        dispatchSnapshotId: sha256(`dispatch-${role}`),
        budgetAllocation: 0,
        ...(parentRunId === undefined ? {} : { parentRunId }),
      });
      return row.id;
    };
    const planningRunId = run('planning', 'plan');
    const chiefRunId = run('chief', 'coordinate');
    const authorizationId = store.authorizations.insert({
      projectId,
      sourceRef: { kind: 'action', id: uuid('31'), version: '1' },
      workId,
      goal: 'the user approved this plan',
      scope: {
        readPaths: ['packages/core/src'],
        writePaths: ['packages/core/src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      operations: ['read', 'edit'],
      acceptedAt: store.now(),
    }).id;
    // The orchestrator verifies the profile revision against the live configuration.
    const provider = config.upsertProvider({
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
    });
    config.update('global', {
      roleOverrides: {
        backend: {
          providerId: provider.providerId,
          modelId: MODEL_ID,
          reasoning: 'off',
          skills: [],
          toolSubset: [],
          contextLimit: 32_000,
        },
      },
    });
    return { workId, planningRunId, chiefRunId, authorizationId };
  }

  const plan: PlanDraft = {
    goal: 'implement the approved change',
    scope: {
      readPaths: ['packages/core/src'],
      writePaths: ['packages/core/src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    tasks: [
      {
        id: 'T1',
        role: 'backend',
        goal: 'apply the approved change',
        paths: ['packages/core/src'],
        dependsOn: [],
        acceptanceIds: ['AC-014'],
        checks: ['pnpm test:unit'],
      },
    ],
  };

  it('creates a real queued professional Run as a direct child of the Chief Run (AC-014)', () => {
    const seeded = seedApprovalPreconditions();
    const approved = call('plan.approve', {
      workId: seeded.workId,
      planVersion: 0,
      plan: plan as unknown as JsonObject,
      approval: {
        authorizationRef: seeded.authorizationId,
        runId: seeded.planningRunId,
        productChanged: false,
      },
      revision: GIT_HEAD,
    });
    expect(approved['planRef']).toMatchObject({ version: 1 });
    const runId = approved['runId'];
    expect(typeof runId).toBe('string');
    const queued = store.runs.find(runId as string);
    expect(queued).toMatchObject({
      role: 'backend',
      status: 'queued',
      parentRunId: seeded.chiefRunId,
      workId: seeded.workId,
      // `rules/workflow.md` §2: the Work's level fixes the develop stage, and the
      // context ACL / Grant envelope are keyed by `develop-L1|L2|L3`. A bare
      // `develop` produced no run-scope file Grant and a degraded read ledger (T3).
      stage: 'develop-L2',
    });
    expect(queued?.dispatchSnapshotId).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      store.events
        .readAfter(0, { limit: 200 })
        .filter((event) => event.name === 'run.queued' && event.entityId === runId),
    ).toHaveLength(1);

    // `WP-12 T2.8`: the Plan's Task DAG is real, and the Run is bound to its Task.
    const tasks = store.tasks.list({ where: 'work_id = ?', params: [seeded.workId] });
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task).toMatchObject({
      role: 'backend',
      stage: 'ready',
      acceptanceIds: ['AC-014'],
      dependsOn: [],
    });
    expect(task?.planRef.id).toBe(
      approved['planRef'] && (approved['planRef'] as { id: string }).id,
    );
    expect(task?.scope.writePaths).toEqual(['packages/core/src']);
    expect(queued?.taskId).toBe(task?.id);
  });

  it('fails typed when no live Chief Run can parent the Run, then the Chief-settle hook queues it', () => {
    const seeded = seedApprovalPreconditions();
    // Park the only Chief Run: it can no longer accept a new dispatch.
    const chief = store.runs.find(seeded.chiefRunId);
    if (chief === undefined) throw new Error('unreachable');
    store.runs.update(chief.id, { status: 'completed' }, chief.version);
    // The approval is persisted, but the hand-off cannot happen: the command must say
    // so with a typed error instead of `applied` with a null `runId` (G8 drill finding).
    let failure: { code?: string; details?: JsonObject } | undefined;
    try {
      call('plan.approve', {
        workId: seeded.workId,
        planVersion: 0,
        plan: plan as unknown as JsonObject,
        approval: {
          authorizationRef: seeded.authorizationId,
          runId: seeded.planningRunId,
          productChanged: false,
        },
        revision: GIT_HEAD,
      });
    } catch (error) {
      failure = error as { code?: string; details?: JsonObject };
    }
    expect(failure?.code).toBe('GATE_NOT_READY');
    const reason = failure?.details?.['reason'];
    expect(typeof reason).toBe('string');
    expect(reason).toContain('Chief');
    // The approval itself survived, so the recovery hook can finish the hand-off.
    const pending = protocol.resumeApprovedPlan(seeded.workId);
    expect(pending.runId).toBeNull();
    expect(pending.reason).toContain('Chief');
    // A new live Chief Run makes the retry succeed with a real, parented Run.
    const replacement = store.runs.insert({
      projectId: store.projectId,
      workId: seeded.workId,
      role: 'chief',
      purpose: 'analysis',
      stage: 'coordinate',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'c'.repeat(64),
      contextSnapshotId: 'd'.repeat(64),
      dispatchSnapshotId: 'e'.repeat(64),
      budgetAllocation: 10_000,
    });
    const resumed = protocol.resumeApprovedPlan(seeded.workId);
    expect(resumed.reason).toBeNull();
    const queued = store.runs.find(resumed.runId ?? '');
    expect(queued).toMatchObject({
      role: 'backend',
      status: 'queued',
      parentRunId: replacement.id,
      workId: seeded.workId,
    });
    // The hook is idempotent: a second call finds the Run and queues nothing new.
    const again = protocol.resumeApprovedPlan(seeded.workId);
    expect(again.runId).toBe(resumed.runId);
    expect(
      store.runs
        .list({ where: 'work_id = ?', params: [seeded.workId] })
        .filter((run) => run.role === 'backend' && run.status === 'queued'),
    ).toHaveLength(1);
  });
});
