/**
 * Model gateway endpoint tests (WP-11 A2-T6).
 *
 * The proxy is exercised over real loopback HTTP with a real `ModelGateway` and a stub
 * transport, so what is asserted is the *contract* `execution.md` §2 fixes: the secret
 * stays in Core, the capability decides who may call, and the frozen configuration — not
 * the Runner — decides which model runs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ProjectStore, projectIdFromRoot } from '@agentdev/storage';
import {
  AttemptCapabilityStore,
  ConfigStore,
  ModelGateway,
  SnapshotWriter,
  createModelGatewayProxy,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayTransport,
  type ModelGatewayProxy,
} from '../src/index.js';

/** Records every request and answers with deterministic text. */
class StubTransport implements GatewayTransport {
  readonly requests: GatewayRequest[] = [];
  reply:
    | { ok: true; text: string; inputTokens: number; outputTokens: number }
    | { ok: false; code: 'PROVIDER_UNAVAILABLE'; retryable: boolean; message: string } = {
    ok: true,
    text: 'pong',
    inputTokens: 7,
    outputTokens: 3,
  };

  complete(request: GatewayRequest): Promise<GatewayResponse> {
    this.requests.push(request);
    return Promise.resolve(this.reply);
  }
}

let store: ProjectStore;
let dataDir: string;
let home: string;
let transport: StubTransport;
let gateway: ModelGateway;
let snapshots: SnapshotWriter;
let capabilities: AttemptCapabilityStore;
let proxy: ModelGatewayProxy;
let providerStub: Server;
const canonicalRoot = '/repo';
const projectId = projectIdFromRoot(canonicalRoot);
const MODEL_ID = 'stub-model';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  return address !== null && typeof address === 'object' ? address.port : 0;
}

/** Creates a queued Run whose frozen profile points at the stub Provider. */
function seedRun(snapshots: SnapshotWriter): { runId: string; attemptId: string; token: string } {
  const config = ConfigStore.open({ globalDir: home, projectRoot: dataDir, snapshots });
  const provider = config.upsertProvider({
    type: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${String(providerPort)}/v1`,
    enabled: true,
    models: [
      {
        id: MODEL_ID,
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
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
  const frozen = config.freeze('backend', {});
  const workId = store.newId();
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
    purpose: 'implementation',
    level: 'L2',
    goal: 'seed',
    scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
    sourceRef: { kind: 'action', id: store.newId(), version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: 'a'.repeat(40),
    budgetId: budget.id,
    policyRevision: 1,
  });
  const run = store.runs.insert({
    projectId,
    workId,
    role: 'backend',
    purpose: 'implementation',
    stage: 'Develop',
    status: 'queued',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: frozen.snapshotId,
    contextSnapshotId: 'd'.repeat(64),
    dispatchSnapshotId: 'e'.repeat(64),
    budgetAllocation: 1_000,
  });
  const attempt = store.attempts.insert({
    runId: run.id,
    projectId,
    number: 1,
    status: 'running',
    ownerEpoch: 0,
    runnerId: 'runner-test',
  });
  const capability = capabilities.issue({
    attemptId: attempt.id,
    runId: run.id,
    epoch: 1,
    role: 'backend',
  });
  return { runId: run.id, attemptId: attempt.id, token: capability.token };
}

let providerPort = 0;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-gateway-data-'));
  home = mkdtempSync(join(tmpdir(), 'agentdev-gateway-home-'));
  store = ProjectStore.open({
    dataDir,
    canonicalRoot,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => new Date(1_000_000).toISOString() },
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
  // A real loopback Provider stub, so the transport is the only stub in the chain.
  providerStub = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  });
  providerPort = await listen(providerStub);
  transport = new StubTransport();
  snapshots = new SnapshotWriter({ store });
  gateway = new ModelGateway({
    config: ConfigStore.open({ globalDir: home, projectRoot: dataDir, snapshots }),
    snapshots,
    transport,
  });
  capabilities = new AttemptCapabilityStore();
});

afterEach(async () => {
  await proxy?.close();
  await new Promise<void>((resolve) => providerStub.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('AttemptCapabilityStore', () => {
  it('issues one capability per Attempt and verifies it', () => {
    const first = capabilities.issue({
      attemptId: 'attempt-1',
      runId: 'run-1',
      epoch: 1,
      role: 'backend',
    });
    expect(capabilities.verify(first.token).ok).toBe(true);
    // Re-issuing replaces the earlier token: a revoked Attempt cannot keep calling.
    const second = capabilities.issue({
      attemptId: 'attempt-1',
      runId: 'run-1',
      epoch: 2,
      role: 'backend',
    });
    expect(capabilities.verify(first.token).ok).toBe(false);
    expect(capabilities.verify(second.token).ok).toBe(true);
  });

  it('refuses an unknown token and an expired capability', () => {
    let clock = 1_000;
    const store2 = new AttemptCapabilityStore({ now: () => clock });
    const capability = store2.issue({
      attemptId: 'a',
      runId: 'r',
      epoch: 1,
      role: 'backend',
      ttlMs: 10,
      now: () => clock,
    });
    expect(store2.verify(undefined)).toMatchObject({ ok: false, code: 'NOT_AUTHORIZED' });
    expect(store2.verify('made-up')).toMatchObject({ ok: false, code: 'NOT_AUTHORIZED' });
    clock += 11;
    expect(store2.verify(capability.token)).toMatchObject({ ok: false, code: 'AUTH_EXPIRED' });
    expect(store2.size).toBe(0);
  });

  it('revokes by Attempt and by Run', () => {
    capabilities.issue({ attemptId: 'a1', runId: 'r1', epoch: 1, role: 'backend' });
    capabilities.issue({ attemptId: 'a2', runId: 'r1', epoch: 1, role: 'backend' });
    capabilities.issue({ attemptId: 'a3', runId: 'r2', epoch: 1, role: 'backend' });
    expect(capabilities.revoke('a1')).toBe(true);
    expect(capabilities.revoke('a1')).toBe(false);
    expect(capabilities.revokeRun('r1')).toBe(1);
    expect(capabilities.size).toBe(1);
  });
});

describe('model gateway proxy', () => {
  async function start(): Promise<void> {
    proxy = await createModelGatewayProxy({
      gateway,
      store,
      capabilities,
      port: 0,
      onUsage: () => undefined,
    });
  }

  it('answers a completion for a valid capability and keeps the secret in Core', async () => {
    await start();
    const { token, runId } = seedRun(snapshots);
    const response = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL_ID, messages: [{ role: 'user', content: 'ping' }] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number };
      model: string;
    };
    expect(body.choices[0]?.message.content).toBe('pong');
    expect(body.usage.prompt_tokens).toBe(7);
    expect(body.model).toBe(MODEL_ID);
    // The request reaching the transport carries the frozen model, and the stub never
    // received the capability or a Provider secret.
    expect(transport.requests.at(-1)?.modelId).toBe(MODEL_ID);
    expect(JSON.stringify(transport.requests.at(-1))).not.toContain(token);
    expect(store.runs.find(runId)?.status).toBe('queued');
  });

  it('refuses a missing capability and a request for another model', async () => {
    await start();
    const { token } = seedRun(snapshots);
    const unauthorized = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    expect(unauthorized.status).toBe(401);

    const substituted = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'another-model',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    expect(substituted.status).toBe(409);
    expect((await substituted.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'CONFIG_INVALID' },
    });
  });

  it('maps a Provider failure onto an OpenAI-shaped error', async () => {
    await start();
    const { token } = seedRun(snapshots);
    transport.reply = {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'the Provider is down',
    };
    const response = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()) as { error: { code: string; message: string } }).toMatchObject({
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
  });

  it('refuses a capability whose Attempt is no longer live', async () => {
    await start();
    const { token, attemptId } = seedRun(snapshots);
    // The supervisor parks an Attempt as `lost` when its Runner dies and revokes the
    // capability; a process still holding the token must not keep calling (WP11R1-03).
    const attempt = store.attempts.find(attemptId);
    if (attempt === undefined) throw new Error('unreachable');
    store.attempts.update(attempt.id, { status: 'lost' }, attempt.version);
    const response = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    expect(response.status).toBe(401);
    expect(transport.requests).toHaveLength(0);
    // …and the revocation is durable: the token is gone from the store.
    expect(capabilities.find(attemptId)).toBeUndefined();
  });

  it('refuses a capability minted for another epoch', async () => {
    await start();
    const { token, attemptId } = seedRun(snapshots);
    const attempt = store.attempts.find(attemptId);
    if (attempt === undefined) throw new Error('unreachable');
    // A newer Attempt owns the Run now; the old epoch's token must be inert.
    store.attempts.update(attempt.id, { ownerEpoch: 5 }, attempt.version);
    const response = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    expect(response.status).toBe(401);
    expect(transport.requests).toHaveLength(0);
  });

  it('streams a valid SSE sequence when the Runner asks for one', async () => {
    await start();
    const { token } = seedRun(snapshots);
    const response = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], stream: true }),
    });
    expect(response.headers.get('content-type') ?? '').toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('"content":"pong"');
    expect(text).toContain('data: [DONE]');
  });

  it('lists only the frozen model, and refuses a terminal Run', async () => {
    await start();
    const { token, runId } = seedRun(snapshots);
    const models = await fetch(`${proxy.url}/models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await models.json()) as { data: { id: string }[] };
    expect(body.data.map((entry) => entry.id)).toEqual([MODEL_ID]);

    const run = store.runs.find(runId);
    if (run === undefined) throw new Error('unreachable');
    store.runs.update(run.id, { status: 'cancelled' }, run.version);
    const afterTerminal = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    // A terminal Run refuses the call (409) and the capability is revoked with it, so a
    // retry cannot slip through on a Run that already ended.
    expect(afterTerminal.status).toBe(409);
    const retry = await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    expect(retry.status).toBe(401);
  });

  it('reports usage so the daemon can reconcile the budget', async () => {
    const usage: unknown[] = [];
    proxy = await createModelGatewayProxy({
      gateway,
      store,
      capabilities,
      port: 0,
      onUsage: (entry) => usage.push(entry),
    });
    const { token, runId, attemptId } = seedRun(snapshots);
    await fetch(`${proxy.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    expect(usage).toEqual([{ runId, attemptId, inputTokens: 7, outputTokens: 3 }]);
  });
});
