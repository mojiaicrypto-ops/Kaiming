/**
 * Control endpoint tests (WP-12 T2.3).
 *
 * `protocol.md` §6 is the Chief/Runner internal channel. The endpoint is exercised over real
 * loopback HTTP with a real `AttemptCapabilityStore` and a real store, so what is asserted is
 * the authority model rather than a mock: the capability decides which Run may call, the
 * Attempt/epoch is re-checked on every request, a terminal Run refuses further calls, and the
 * three documented methods reach the injected handler with the capability-derived binding.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore, projectIdFromRoot } from '@agentdev/storage';
import {
  AttemptCapabilityStore,
  CONTROL_PATHS,
  ProtocolError,
  createControlEndpoint,
  type ControlEndpoint,
  type ControlHandler,
  type ProtocolErrorCode,
} from '../src/index.js';

const canonicalRoot = '/repo';
const projectId = projectIdFromRoot(canonicalRoot);

/** What the stub handler recorded, so the test can assert the binding Core decided. */
interface Recorded {
  readonly method: string;
  readonly caller: unknown;
  readonly body: unknown;
}

let store: ProjectStore;
let dataDir: string;
let capabilities: AttemptCapabilityStore;
let endpoint: ControlEndpoint;
let recorded: Recorded[];
let submitted: { runId: string; attemptId: string; method: string }[];
let failNext: { code: string; message: string } | undefined;

const handler: ControlHandler = {
  assessmentSubmit: (input) => {
    recorded.push({ method: 'assessment.submit', caller: input.caller, body: input });
    if (failNext !== undefined) {
      throw new ProtocolError(failNext.code as ProtocolErrorCode, failNext.message);
    }
    return { saved: true, workId: input.workId };
  },
  agentDispatch: (input) => {
    recorded.push({ method: 'agent.dispatch', caller: input.caller, body: input });
    return { runId: 'run-child', status: 'queued' };
  },
  stageSubmit: (input) => {
    recorded.push({ method: 'stage.submit', caller: input.caller, body: input });
    return { accepted: true, status: 'success' };
  },
};

/** Creates one queued Run with a live Attempt and returns its capability token. */
function issueRun(status: 'queued' | 'running' | 'completed' = 'running'): {
  runId: string;
  attemptId: string;
  token: string;
} {
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
    purpose: 'implement the feature',
    level: 'L2',
    goal: 'wire the control channel',
    scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
    sourceRef: { kind: 'action', id: store.newId(), version: '1' },
    status: 'running',
    blockerIds: [],
    budgetId: budget.id,
    policyRevision: 1,
  });
  const run = store.runs.insert({
    projectId,
    workId,
    role: 'chief',
    purpose: 'analysis',
    stage: 'coordinate',
    status,
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: 'c'.repeat(64),
    contextSnapshotId: 'd'.repeat(64),
    dispatchSnapshotId: 'e'.repeat(64),
    budgetAllocation: 1_000,
  });
  const attempt = store.attempts.insert({
    projectId,
    runId: run.id,
    number: 1,
    status: 'running',
    ownerEpoch: 0,
  });
  const capability = capabilities.issue({
    attemptId: attempt.id,
    runId: run.id,
    epoch: 1,
    role: 'chief',
  });
  return { runId: run.id, attemptId: attempt.id, token: capability.token };
}

async function post(
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${endpoint.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-control-'));
  store = ProjectStore.open({
    dataDir,
    canonicalRoot,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  store.projects.insert({
    id: projectId,
    root: canonicalRoot,
    gitRoot: canonicalRoot,
    codeRoot: 'src',
    documentRoot: 'docs/agentdev',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: 'a'.repeat(40),
  });
  capabilities = new AttemptCapabilityStore();
  recorded = [];
  submitted = [];
  failNext = undefined;
  endpoint = await createControlEndpoint({
    store,
    capabilities,
    maxBodyBytes: 2_048,
    handler,
    noteSubmitted: (input) => {
      submitted.push(input);
    },
    log: () => undefined,
  });
});

afterEach(async () => {
  await endpoint.close();
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('control endpoint (protocol.md §6)', () => {
  it('refuses a request without a capability and logs the refusal', async () => {
    const response = await fetch(`${endpoint.url}${CONTROL_PATHS.stageSubmit}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: { status: 'success' } }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_AUTHORIZED');
    expect(recorded).toHaveLength(0);
    expect(submitted).toHaveLength(0);
  });

  it('refuses a token minted by another process (unknown capability)', async () => {
    const response = await post(
      CONTROL_PATHS.assessmentSubmit,
      { workId: store.newId(), assessment: {} },
      'not-a-real-token',
    );
    expect(response.status).toBe(401);
    expect((response.body['error'] as { code: string }).code).toBe('NOT_AUTHORIZED');
  });

  it('re-checks the Attempt state on every call: a finished Attempt is refused', async () => {
    const { attemptId, token, runId } = issueRun();
    const attempt = store.attempts.find(attemptId);
    if (attempt === undefined) throw new Error('unreachable');
    store.attempts.update(attemptId, { status: 'completed' }, attempt.version);
    const response = await post(CONTROL_PATHS.stageSubmit, { result: {} }, token);
    expect(response.status).toBe(401);
    // The capability is revoked, not merely refused: a stale Runner must not keep calling.
    expect(capabilities.find(attemptId)).toBeUndefined();
    expect(store.runs.find(runId)?.status).toBe('running');
  });

  it('refuses a terminal Run and revokes the capability', async () => {
    const { runId, attemptId, token } = issueRun('completed');
    const response = await post(CONTROL_PATHS.stageSubmit, { result: {} }, token);
    expect(response.status).toBe(409);
    expect((response.body['error'] as { code: string }).code).toBe('INVALID_STATE');
    expect(capabilities.find(attemptId)).toBeUndefined();
    expect(store.runs.find(runId)?.status).toBe('completed');
  });

  it('rejects a mismatching capability epoch before the handler runs', async () => {
    const { runId, attemptId } = issueRun();
    const attempt = store.attempts.find(attemptId);
    if (attempt === undefined) throw new Error('unreachable');
    // A newer Attempt exists, so the old capability's epoch is no longer current.
    store.attempts.update(attemptId, { ownerEpoch: 1 }, attempt.version);
    const stale = capabilities.issue({ attemptId, runId, epoch: 1, role: 'chief' });
    const response = await post(CONTROL_PATHS.stageSubmit, { result: {} }, stale.token);
    expect(response.status).toBe(401);
    expect(recorded).toHaveLength(0);
  });

  it('dispatches assessment.submit to the handler with the capability-derived caller', async () => {
    const { runId, attemptId, token } = issueRun();
    const response = await post(
      CONTROL_PATHS.assessmentSubmit,
      {
        workId: 'work-1',
        assessment: { intent: 'delivery', level: 'L2' },
        operationId: 'op-1',
      },
      token,
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ saved: true, workId: 'work-1' });
    expect(recorded[0]?.method).toBe('assessment.submit');
    // `protocol.md` §6 names the Attempt's own epoch, not the capability generation.
    expect(recorded[0]?.caller).toMatchObject({ runId, attemptId, epoch: 0, role: 'chief' });
    expect((recorded[0]?.body as { operationId?: string }).operationId).toBe('op-1');
    expect(submitted).toEqual([{ runId, attemptId, method: 'assessment.submit' }]);
  });

  it('dispatches agent.dispatch and stage.submit to their handlers', async () => {
    const { runId, attemptId, token } = issueRun();
    const dispatch = await post(
      CONTROL_PATHS.agentDispatch,
      { spec: { role: 'backend', purpose: 'implementation' } },
      token,
    );
    expect(dispatch.status).toBe(200);
    expect(dispatch.body).toMatchObject({ runId: 'run-child', status: 'queued' });
    const stage = await post(
      CONTROL_PATHS.stageSubmit,
      { result: { status: 'success', summary: 'done' } },
      token,
    );
    expect(stage.status).toBe(200);
    expect(stage.body).toMatchObject({ accepted: true, status: 'success' });
    expect(recorded.map((entry) => entry.method)).toEqual(['agent.dispatch', 'stage.submit']);
    expect(submitted.map((entry) => entry.method)).toEqual(['agent.dispatch', 'stage.submit']);
    // Neither method may name its own Run/Attempt: the binding comes from the capability.
    expect((recorded[0]?.caller as { attemptId: string }).attemptId).toBe(attemptId);
    expect((recorded[1]?.caller as { runId: string }).runId).toBe(runId);
  });

  it('answers a protocol refusal from the handler with its code and status', async () => {
    const { token } = issueRun();
    failNext = { code: 'VALIDATION_ERROR', message: 'the spec is invalid' };
    const response = await post(
      CONTROL_PATHS.assessmentSubmit,
      { workId: 'w', assessment: {} },
      token,
    );
    expect(response.status).toBe(400);
    expect(response.body['error']).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'the spec is invalid',
    });
    // A refused submission is not recorded: the two-strike rule must count acceptances.
    expect(submitted).toHaveLength(0);
  });

  it('validates the documented parameters', async () => {
    const { token } = issueRun();
    const missing = await post(CONTROL_PATHS.assessmentSubmit, { assessment: {} }, token);
    expect(missing.status).toBe(400);
    expect((missing.body['error'] as { code: string }).code).toBe('VALIDATION_ERROR');
    const notObject = await post(CONTROL_PATHS.stageSubmit, { result: 'text' }, token);
    expect(notObject.status).toBe(400);
    const unknownPath = await post('/control/unknown.method', {}, token);
    expect(unknownPath.status).toBe(404);
  });

  it('refuses an oversized body with a typed 413 (review P3-1)', async () => {
    const { token } = issueRun();
    const response = await fetch(`${endpoint.url}${CONTROL_PATHS.assessmentSubmit}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ workId: 'w', assessment: {}, padding: 'x'.repeat(4096) }),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('larger than');
  });

  it('rejects unknown body fields and a non-relative path (review P3-2/P3-5)', async () => {
    const { token } = issueRun();
    const extra = await post(CONTROL_PATHS.stageSubmit, { result: {}, surprise: 1 }, token);
    expect(extra.status).toBe(400);
    expect((extra.body['error'] as { code: string }).code).toBe('VALIDATION_ERROR');

    const tilde = await post(
      CONTROL_PATHS.assessmentSubmit,
      {
        workId: 'w',
        assessment: {
          scope: { readPaths: ['~/.ssh'], writePaths: [], operations: [], networkTargets: [] },
        },
      },
      token,
    );
    expect(tilde.status).toBe(400);
    expect((tilde.body['error'] as { message: string }).message).toContain('repository-relative');
    expect(submitted).toHaveLength(0);
  });

  it('hands the documented expectedVersion to the handler (review P3-3)', async () => {
    const { token } = issueRun();
    const response = await post(
      CONTROL_PATHS.assessmentSubmit,
      { workId: 'w', assessment: {}, expectedVersion: 7 },
      token,
    );
    expect(response.status).toBe(200);
    expect((recorded[0]?.body as { expectedVersion?: number }).expectedVersion).toBe(7);
  });

  it('serves a health check without a capability and refuses a non-POST method', async () => {
    const health = await fetch(`${endpoint.url}/healthz`);
    expect(health.status).toBe(200);
    const { token } = issueRun();
    const get = await fetch(`${endpoint.url}${CONTROL_PATHS.stageSubmit}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(404);
  });
});
