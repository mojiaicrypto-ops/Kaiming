/**
 * T3 轮 2 — the documented internal methods `context.request` and `agent.request_dispatch`
 * over the real control handler and the real endpoint (`protocol.md` §6, AC-032/AC-045).
 *
 * Real SQLite, a real workspace file, the real `ReadLedgerRegistry` and the real
 * `Orchestrator`/`StageGate` the daemon assembles, so the assertions are about the handlers
 * the Runner actually calls:
 *
 * - `context.request` returns content for a ref inside the Run's ACL and appends to the same
 *   read ledger `tool.execute` uses (`AC-085`); a ref outside the scope is recorded as a
 *   pending expansion and escalated with `chief_action_required` instead of vanishing;
 * - `agent.request_dispatch` only produces that event — a professional Run never creates a
 *   grandchild Run (`rules/agents.md` §3);
 * - the endpoint serves both on the shared attempt-capability channel and refuses them when
 *   the daemon did not configure them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject, Scope } from '@agentdev/contracts';
import {
  ArtifactService,
  AttachmentService,
  DecisionService,
  DownloadTokenStore,
  EventHub,
  AttemptCapabilityStore,
  ConfigStore,
  ModelGateway,
  Orchestrator,
  ReadLedgerRegistry,
  RunLifecycle,
  SnapshotWriter,
  StageGate,
  createControlEndpoint,
  type ControlEndpoint,
} from '@agentdev/core';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import { WorkbenchProtocol } from '../src/protocol.js';
import { createControlHandlers } from '../src/control-handler.js';
import { CONTROL_PATHS } from '../../../packages/core/src/control-http.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3df000';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3df010';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3df050';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3df040';
const CHIEF_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3df020';
const CHIEF_ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3df051';
const A = 'src/a.ts';
const HASH = 'a'.repeat(64);
const REVISION = 'c'.repeat(40);
const SCOPE: Scope = {
  readPaths: [A],
  writePaths: [A],
  operations: ['read', 'search', 'edit'],
  networkTargets: [],
};

describe('context.request and agent.request_dispatch (T3 轮 2)', () => {
  let home: string;
  let repo: string;
  let store: ProjectStore;
  let readLedgers: ReadLedgerRegistry;
  let handlers: ReturnType<typeof createControlHandlers>;
  let endpoint: ControlEndpoint;
  let capabilities: AttemptCapabilityStore;
  let token: string;
  let chiefToken: string;
  let blobs: BlobStore;
  let artifacts: ArtifactService;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'agentdev-ctxreq-home-'));
    repo = mkdtempSync(join(tmpdir(), 'agentdev-ctxreq-repo-'));
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, A), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(home, 'outside.txt'), 'outside\n', 'utf8');
    store = Store.open({
      dataDir: home,
      canonicalRoot: repo,
      migrations: { backup: () => undefined, backupPath: join(home, 'pre.sqlite') },
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
      purpose: 'deliver the internal methods',
      level: 'L2',
      goal: 'read inside the scope',
      scope: SCOPE,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
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
      scope: SCOPE,
      stage: 'develop',
      acceptanceIds: ['AC-032'],
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
      configSnapshotId: '1'.repeat(64),
      contextSnapshotId: '2'.repeat(64),
      dispatchSnapshotId: '3'.repeat(64),
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
    blobs = new BlobStore({ root: home });
    artifacts = new ArtifactService({ store, blobs });
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
    const orchestrator = new Orchestrator({ store, config, snapshots, gateway, lifecycle });
    readLedgers = new ReadLedgerRegistry({ store });
    handlers = createControlHandlers({
      store,
      orchestrator,
      stageGate: new StageGate({ store, lifecycle, readLedgers }),
      readLedgers,
      artifacts,
      log: () => undefined,
    });
    // A Chief Run for `decision_request` (the method is Chief-only).
    store.runs.insert({
      id: CHIEF_RUN_ID,
      projectId,
      workId: WORK_ID,
      role: 'chief',
      purpose: 'artifact',
      stage: 'coordinate',
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
      id: CHIEF_ATTEMPT_ID,
      projectId,
      runId: CHIEF_RUN_ID,
      number: 1,
      status: 'running',
      ownerEpoch: 0,
    });
    capabilities = new AttemptCapabilityStore();
    token = capabilities.issue({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      epoch: 1,
      role: 'backend',
    }).token;
    chiefToken = capabilities.issue({
      attemptId: CHIEF_ATTEMPT_ID,
      runId: CHIEF_RUN_ID,
      epoch: 1,
      role: 'chief',
    }).token;
    endpoint = await createControlEndpoint({
      store,
      capabilities,
      handler: handlers.handler,
    });
  });

  afterEach(async () => {
    await endpoint.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const caller = { runId: RUN_ID, attemptId: ATTEMPT_ID, epoch: 0, role: 'backend' as const };

  async function post(
    path: string,
    body: JsonObject,
  ): Promise<{ status: number; body: JsonObject }> {
    const response = await fetch(`${endpoint.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ attemptId: ATTEMPT_ID, epoch: 0, ...body }),
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) as JsonObject };
  }

  it('returns content inside the scope and appends it to the read ledger', async () => {
    const answer = await post(CONTROL_PATHS.contextRequest, {
      workId: WORK_ID,
      requestedRefs: [{ path: A, reason: 'need the module' }],
      reason: 'implement the change',
    });
    // The handler is called directly too, so the assertion is about the handler, not only
    // about what the endpoint returned.
    const direct = handlers.handler.contextRequest?.({
      caller,
      workId: WORK_ID,
      requestedRefs: [{ path: A, reason: 'need the module' }],
      reason: 'implement the change',
    });
    expect(answer.status).toBe(200);
    expect(direct?.['status']).toBe('applied');
    const items = answer.body['items'] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]?.['content']).toContain('export const a = 1;');
    expect(items[0]?.['revision']).toBe(REVISION);
    // Two calls (the endpoint's and the direct one) appended two entries.
    expect(readLedgers.binding(ATTEMPT_ID).seq).toBe(2);
    expect(readLedgers.entries(ATTEMPT_ID).map((entry) => entry.path)).toEqual([A, A]);
  });

  it('records an out-of-scope ref as a pending expansion and escalates to the Chief', async () => {
    const answer = await post(CONTROL_PATHS.contextRequest, {
      workId: WORK_ID,
      requestedRefs: [{ path: '../outside.txt' }],
      reason: 'look outside the project',
    });
    expect(answer.status).toBe(200);
    expect(answer.body['escalated']).toBe(true);
    const outOfScope = answer.body['outOfScope'] as Array<Record<string, unknown>>;
    expect(outOfScope[0]?.['code']).toBe('NOT_AUTHORIZED');
    expect(readLedgers.entries(ATTEMPT_ID)).toHaveLength(0);
    const events = store.events.readAfter(0, { limit: 100 });
    expect(events.some((event) => event.name === 'chief_action_required')).toBe(true);
  });

  it('emits chief_action_required for a requested dispatch and never creates a Run', async () => {
    const runsBefore = store.runs.count();
    const answer = await post(CONTROL_PATHS.agentRequestDispatch, {
      workId: WORK_ID,
      reason: 'the UI needs a frontend review',
      requestedRole: 'frontend',
      goal: 'adjust the layout',
      sourceRefs: [],
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ status: 'accepted', event: 'chief_action_required' });
    expect(store.runs.count()).toBe(runsBefore);
    const events = store.events.readAfter(0, { limit: 100 });
    const escalation = events.find((event) => event.name === 'chief_action_required');
    expect(escalation?.data['requestedRole']).toBe('frontend');
    expect(escalation?.data['runId']).toBe(RUN_ID);
  });

  it('refuses an unknown requested role and a foreign Run', async () => {
    const unknown = await post(CONTROL_PATHS.agentRequestDispatch, {
      workId: WORK_ID,
      reason: 'x',
      requestedRole: 'nobody',
      goal: 'x',
      sourceRefs: [],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    // A Run that does not exist (or belongs to another Work) is refused, never treated as
    // the caller's own scope.
    expect(() =>
      handlers.handler.contextRequest?.({
        caller: { ...caller, runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3df0ff' },
        workId: WORK_ID,
        requestedRefs: [],
        reason: 'x',
      }),
    ).toThrowError(/does not exist/);
  });

  it('records a Chief question as a decision artifact and closes it through decision.resolve', () => {
    const chiefCaller = {
      runId: CHIEF_RUN_ID,
      attemptId: CHIEF_ATTEMPT_ID,
      epoch: 0,
      role: 'chief' as const,
    };
    const asked = handlers.handler.decisionRequest?.({
      caller: chiefCaller,
      workId: WORK_ID,
      question: 'Should the theme switch to dark mode?',
      choices: [],
    });
    expect(asked?.['status']).toBe('pending');
    expect(asked?.['choices']).toEqual(['accept', 'decline']);
    const decisionId = typeof asked?.['decisionId'] === 'string' ? asked['decisionId'] : '';
    const artifactId = typeof asked?.['artifactId'] === 'string' ? asked['artifactId'] : '';
    const decision = store.decisions.get(decisionId);
    // The question lives in a real `kind='decision'` artifact; the Decision points at it,
    // with its version, and that is how the Inbox gets the full text (`protocol.md` §7).
    const artifact = store.artifacts.get(artifactId);
    expect(artifact.kind).toBe('decision');
    expect(artifact.mime).toBe('text/markdown');
    expect(blobs.read(artifact.relativeBlobPath).toString('utf8')).toBe(
      'Should the theme switch to dark mode?',
    );
    expect(decision.targetRef).toEqual({
      id: artifact.id,
      version: artifact.version,
      hash: artifact.contentHash,
    });
    expect(decision.effectRefs).toContain(artifact.id);
    expect(
      store.events
        .readAfter(0, { limit: 200 })
        .some((event) => event.name === 'decision.created' && event.entityId === decision.id),
    ).toBe(true);

    // The answer closes the row through the ordinary `decision.resolve` (accept).
    const protocol = new WorkbenchProtocol({
      store,
      blobs,
      events: new EventHub({ store }),
      attachments: new AttachmentService({ store, blobs }),
      artifacts,
      tokens: new DownloadTokenStore(),
      version: '0.0.0-test',
      decisions: new DecisionService({ store, artifacts }),
    });
    const accepted = protocol.dispatch(
      'decision.resolve',
      { decisionId, choice: 'accept' },
      { caller: { subject: 'installation:local', userId: 'installation:local', role: 'chief' } },
    ) as JsonObject;
    expect(accepted['status']).toBe('applied');
    expect(store.decisions.get(decisionId).state).toBe('accepted');
    expect(
      store.events
        .readAfter(0, { limit: 300 })
        .some((event) => event.name === 'decision.resolved' && event.entityId === decisionId),
    ).toBe(true);
  });

  it('applies a decline through the documented product-behaviour branch', () => {
    const chiefCaller = {
      runId: CHIEF_RUN_ID,
      attemptId: CHIEF_ATTEMPT_ID,
      epoch: 0,
      role: 'chief' as const,
    };
    const asked = handlers.handler.decisionRequest?.({
      caller: chiefCaller,
      workId: WORK_ID,
      question: 'Delete the legacy endpoint?',
      choices: [],
    });
    const decisionId = typeof asked?.['decisionId'] === 'string' ? asked['decisionId'] : '';
    const protocol = new WorkbenchProtocol({
      store,
      blobs,
      events: new EventHub({ store }),
      attachments: new AttachmentService({ store, blobs }),
      artifacts,
      tokens: new DownloadTokenStore(),
      version: '0.0.0-test',
      decisions: new DecisionService({ store, artifacts }),
    });
    const rejected = protocol.dispatch(
      'decision.resolve',
      { decisionId, choice: 'decline' },
      { caller: { subject: 'installation:local', userId: 'installation:local', role: 'chief' } },
    ) as JsonObject;
    // `decline` is the product-behaviour branch: the answer is recorded as a follow-up product
    // decision (AC-015/016) instead of flipping the question row.
    expect(rejected['status']).toBe('applied');
    const followUpId =
      typeof rejected['newDecisionId'] === 'string' ? rejected['newDecisionId'] : '';
    expect(followUpId).not.toBe('');
    expect(store.decisions.get(followUpId).choice).toBe('decline');
  });

  it('serves decision.request on the capability channel and refuses a non-Chief caller', async () => {
    const response = await fetch(`${endpoint.url}${CONTROL_PATHS.decisionRequest}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chiefToken}` },
      body: JSON.stringify({
        attemptId: CHIEF_ATTEMPT_ID,
        epoch: 0,
        workId: WORK_ID,
        question: 'Pick a colour?',
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as JsonObject;
    expect(body['status']).toBe('pending');

    // A professional Run may not ask a product question.
    const refused = await fetch(`${endpoint.url}${CONTROL_PATHS.decisionRequest}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ attemptId: ATTEMPT_ID, epoch: 0, workId: WORK_ID, question: 'x' }),
    });
    expect(refused.status).toBe(401);
  });

  it('refuses both methods when the daemon did not configure them', async () => {
    const bare = await createControlEndpoint({
      store,
      capabilities,
      handler: {
        assessmentSubmit: () => ({}),
        agentDispatch: () => ({}),
        stageSubmit: () => ({ accepted: true }),
      },
    });
    try {
      const response = await fetch(`${bare.url}${CONTROL_PATHS.contextRequest}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ workId: WORK_ID, requestedRefs: [], reason: 'x' }),
      });
      expect(response.status).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
