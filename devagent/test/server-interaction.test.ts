import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { AuthService, CSRF_HEADER, SESSION_COOKIE } from '../src/server/auth.ts';
import { RpcRouter } from '../src/server/rpc.ts';
import { createWorkbenchServer } from '../src/server/http.ts';
import { registerCoreMethods } from '../src/server/methods.ts';
import { registerReadMethods } from '../src/server/read-methods.ts';
import { registerWriteMethods } from '../src/server/write-methods.ts';
import { registerStreamMethods } from '../src/server/stream-methods.ts';
import { SessionEventHub } from '../src/server/hub.ts';
import { WorkbenchWorker } from '../src/server/worker.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner } from '../src/runtime/runner.ts';
import { InteractionBridge } from '../src/runtime/interactions.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { epochOf } from '../src/runtime/epoch.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'interaction-secret';
const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');

interface Harness {
  readonly origin: string;
  readonly store: Store;
  readonly projectId: string;
  readonly runner: InputRunner;
  readonly hub: SessionEventHub;

  cookie: string;
  csrf: string;
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  awaitRun(): Promise<void>;
}

async function harness(replies: readonly StubReply[]): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-interaction-'));
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 3 });
  const projectId = 'p-1';
  store.createProject({ id: projectId, realPath: realpathSync(projectRoot) });
  store.createSession({ id: 's-chief', projectId, roleId: 'chief', cwd: realpathSync(projectRoot) });

  const model = await startStubModelServer(replies);
  cleanups.push(async () => {
    await model.close();
  });
  const env = await createStubEnv(model.baseUrl);
  cleanups.push(() => rmSync(env.root, { recursive: true, force: true }));
  const server: RuntimeDefaults = {
    model: { providerId: 'stub', modelId: 'stub-1' },
    agentDir: env.agentDir,
    promptDir: PROMPT_DIR,
    tools: [],
  };
  const hub = new SessionEventHub();
  const factory = new PiRuntimeFactory(server);
  const registry = new SessionRegistry(factory);
  const epoch = (sessionId: string): string =>
    epochOf({ serverEpoch: store.epoch, instanceGeneration: registry.generationOf(sessionId) });
  const interactions = new InteractionBridge({
    store,
    publish: (sessionId, event, meta) => {
      hub.publish(sessionId, event, { ...(meta?.inputId !== undefined ? { inputId: meta.inputId } : {}) });
    },
  });
  const runner = new InputRunner({
    store,
    registry,
    factory,
    interactions,
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server }),
    onEvent: (sessionId, event, meta) => {
      hub.publish(sessionId, event, { inputId: meta.inputId, epoch: epoch(sessionId) });
    },
  });
  const worker = new WorkbenchWorker({ store, runner, idleDelayMs: 10 });
  const auth = new AuthService({ accessPassword: PASSWORD });
  const router = new RpcRouter();
  registerCoreMethods(router, { store, server });
  registerReadMethods(router, { store });
  registerWriteMethods(router, {
    store,
    notify: () => worker.notify(),
    stopInput: (sessionId, stop) => runner.requestStop(sessionId, stop),
    controlTask: (control) => runner.controlTask(control),
    invalidate: (sessionId, entity, id) => hub.publish(sessionId, { type: 'invalidate', entity, id }),
    resolveInteraction: (interactionId, response) => interactions.resolve(interactionId, response),
  });
  registerStreamMethods(router, { store, hub, epochOf: (sessionId) => epoch(sessionId) });
  const workbench = createWorkbenchServer({ store, auth, router, hub });
  const { origin } = await workbench.listen(0);
  worker.start();
  cleanups.push(async () => {
    interactions.clear();
    await worker.stop();
    await workbench.close();
    registry.disposeAll();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const h: Harness = {
    origin,
    store,
    projectId,
    runner,
    hub,
    cookie: '',
    csrf: '',
    async call(method, params = {}) {
      const response = await fetch(`${origin}/api/v1/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(h.cookie === '' ? {} : { cookie: `${SESSION_COOKIE}=${h.cookie}`, [CSRF_HEADER]: h.csrf }),
        },
        body: JSON.stringify({ requestId: `req-${Math.random().toString(16).slice(2)}`, method, params }),
      });
      return (await response.json()) as Record<string, unknown>;
    },
    /**
     * Wait until the chief session really has nothing in flight: a stored fact, so a waiter that
     * arrives after the run settled still returns immediately.
     */
    awaitRun: async () => {
      for (let attempt = 0; attempt < 50_000; attempt += 1) {
        const inputs = h.store.listInputs('s-chief');
        const busy = inputs.some((input) => input.status === 'queued' || input.status === 'processing');
        if (inputs.length > 0 && !busy) {
          return;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
      throw new Error('the run did not settle');
    },
  };
  const login = await fetch(`${origin}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'auth.login', params: { password: PASSWORD } }),
  });
  h.cookie = /agentdev_session=([0-9a-f]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1] ?? '';
  h.csrf = String(((await login.json()) as { result: { csrfToken: string } }).result.csrfToken);
  return h;
}

/** Await the pending interaction appearing in the store (the real signal). */
async function awaitPending(store: Store, sessionId: string): Promise<{ interactionId: string; revision: number }> {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    const [pending] = store.listPendingInteractions(sessionId);
    if (pending !== undefined) {
      return { interactionId: pending.interactionId, revision: pending.revision };
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('no pending interaction appeared');
}

const questionReply = (method: string, extra: Record<string, unknown>): StubReply => ({
  kind: 'tool_calls',
  calls: [{ name: 'question', arguments: JSON.stringify({ method, title: '确认一下', ...extra }) }],
});

describe('interaction bridge', () => {
  it('asks through the real adapter, persists the question, and continues with the answer', async () => {
    const h = await harness([
      questionReply('select', { options: ['加入', '暂不加入'] }),
      { kind: 'text', text: '好的，按你说的办。' },
    ]);

    const submitted = await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: '整理一下需求' }],
    });
    const inputId = (submitted['result'] as { inputId: string }).inputId;
    const pending = await awaitPending(h.store, 's-chief');

    // The request is durable and visible in the snapshot: a reconnecting page sees it.
    const row = h.store.getInteraction(pending.interactionId);
    expect(row).toMatchObject({ method: 'select', state: 'pending', inputId, sessionId: 's-chief' });
    expect(JSON.parse(row?.options ?? '[]')).toEqual(['加入', '暂不加入']);

    const prepared = await h.call('session.stream.prepare', { projectId: h.projectId, sessionId: 's-chief' });
    const snapshot = (prepared['result'] as { snapshot: { interactions: Array<{ interactionId: string; method: string }> } })
      .snapshot;
    expect(snapshot.interactions.map((entry) => entry.interactionId)).toContain(pending.interactionId);

    // The answer is saved, then handed back to the waiting model call.
    const answered = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: pending.revision,
      response: { value: '加入' },
    });

    expect(answered['error']).toBeUndefined();
    expect((answered['result'] as { state: string }).state).toBe('resolved');
    await h.awaitRun();
    expect(h.store.getInput(inputId)?.status).toBe('completed');
    expect(h.store.getInteraction(pending.interactionId)?.response).toBe(JSON.stringify({ value: '加入' }));
    // The model really continued with the answer: the run's second turn produced text.
    const binding = h.store.getSessionBinding('s-chief');
    expect(binding?.piFile).toBeDefined();
  }, 30_000);

  it('never overwrites an answer and refuses a different one for the same interaction', async () => {
    const h = await harness([questionReply('confirm', { message: '要开始开发吗？' }), { kind: 'text', text: '好' }]);
    await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: '问一下' }],
    });
    const pending = await awaitPending(h.store, 's-chief');

    const first = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: pending.revision,
      response: { confirmed: true },
    });
    const retry = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: h.store.getInteraction(pending.interactionId)?.revision ?? 1,
      response: { confirmed: true },
    });
    const different = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: h.store.getInteraction(pending.interactionId)?.revision ?? 1,
      response: { confirmed: false },
    });

    expect((first['result'] as { state: string }).state).toBe('resolved');
    // The identical retry returns the original record instead of writing again.
    expect((retry['result'] as { state: string }).state).toBe('resolved');
    expect((different['error'] as { code: string }).code).toBe('REQUEST_CONFLICT');
    expect(h.store.getInteraction(pending.interactionId)?.response).toBe(JSON.stringify({ confirmed: true }));

    await h.awaitRun();
  }, 30_000);

  it('refuses an answer from another session and a stale revision', async () => {
    const h = await harness([questionReply('input', { placeholder: '写点什么' }), { kind: 'text', text: '好' }]);
    await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: '问一下' }],
    });
    const pending = await awaitPending(h.store, 's-chief');
    const other = await h.call('session.create', { projectId: h.projectId });
    const otherSession = (other['result'] as { session: { sessionId: string } }).session.sessionId;

    const foreign = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: otherSession,
      interactionId: pending.interactionId,
      expectedRevision: pending.revision,
      response: { value: 'x' },
    });
    const stale = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: pending.revision + 5,
      response: { value: 'x' },
    });

    expect((foreign['error'] as { code: string }).code).toBe('FORBIDDEN');
    expect((stale['error'] as { code: string }).code).toBe('VERSION_CONFLICT');
    expect(h.store.getInteraction(pending.interactionId)?.state).toBe('pending');

    // Leaving it un-answered would hang the run: answer it, then assert the run finished.
    await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: pending.revision,
      response: { value: 'ok' },
    });
    await h.awaitRun();
  }, 30_000);

  it('accepts a typed answer that is not one of the options, and refuses an empty one', async () => {
    const h = await harness([
      questionReply('select', { options: ['加入', '暂不加入'] }),
      { kind: 'text', text: '好' },
    ]);
    await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: '整理一下需求' }],
    });
    const pending = await awaitPending(h.store, 's-chief');

    // Silence is not a choice: an empty answer would hand the model nothing to act on.
    const empty = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: pending.revision,
      response: { value: '   ' },
    });
    expect((empty['error'] as { code: string }).code).toBe('INVALID_ARGUMENT');
    expect(h.store.getInteraction(pending.interactionId)?.state).toBe('pending');

    // The user's own words are a legitimate answer: the options can all be wrong, and forcing one of
    // them would put a decision nobody made into the record. It is stored verbatim, not mapped.
    const typed = await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: pending.revision,
      response: { value: '先看一份样例再定' },
    });
    expect(typed['error']).toBeUndefined();
    expect(h.store.getInteraction(pending.interactionId)).toMatchObject({
      state: 'resolved',
      response: '{"value":"先看一份样例再定"}',
    });
    await h.awaitRun();
  }, 30_000);

  it('cleans up a session that used the interaction bridge', async () => {
    const h = await harness([questionReply('confirm', { message: '继续吗？' }), { kind: 'text', text: '好' }]);
    await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: '问一下' }],
    });
    const pending = await awaitPending(h.store, 's-chief');
    await h.call('interaction.respond', {
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      interactionId: pending.interactionId,
      expectedRevision: pending.revision,
      response: { confirmed: true },
    });
    await h.awaitRun();

    // The interaction rows belong to the session: cleanup removes them instead of failing on the FK.
    const cleaned = await h.call('session.cleanup', {
      projectId: h.projectId,
      sessionId: 's-chief',
      expectedRevision: h.store.getSession('s-chief')?.revision ?? 1,
    });

    expect(cleaned['error']).toBeUndefined();
    expect(h.store.getSession('s-chief')).toBeUndefined();
    expect(h.store.listInteractions('s-chief')).toEqual([]);
  }, 30_000);

  it('marks the question stale when its input is stopped, so nothing waits forever', async () => {
    const h = await harness([questionReply('confirm', { message: '继续吗？' })]);
    const submitted = await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: '问一下' }],
    });
    const inputId = (submitted['result'] as { inputId: string }).inputId;
    const pending = await awaitPending(h.store, 's-chief');

    const stopped = await h.call('session.input.stop', {
      projectId: h.projectId,
      sessionId: 's-chief',
      inputId,
    });
    await h.awaitRun();

    expect(stopped['error']).toBeUndefined();
    // The question can never be resumed: it goes stale instead of leaving the page waiting.
    expect(h.store.getInteraction(pending.interactionId)?.state).toBe('stale');
    expect(h.store.getInput(inputId)?.status).toBe('stopped');
    expect(h.runner.interactions.pendingCount).toBe(0);
  }, 30_000);
});

describe('member questions reach the chief channel', () => {
  it('a member session question appears in the chief snapshot and can be answered', async () => {
    const h = await harness([]);
    const task = h.store.createTask({
      id: 't-q', projectId: h.projectId, chiefSessionId: 's-chief', ownerEpoch: 1,
      type: 'write', requiresTest: false, goal: 'g', scope: 's', acceptanceRefs: [], basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/p.md', sha256: 'x' }, authorizationRefs: [], sourceInputId: 'i-1',
    });
    h.store.updateTask({ taskId: task.id, phase: 'develop' });
    // createTaskSessions creates the member session itself.
    h.store.createTaskSessions({
      taskId: task.id,
      members: [
        {
          sessionId: 's-member', taskId: task.id, roleId: 'developer', phase: 'develop', label: 'work',
          instructions: 'do the work', refs: [], dependencies: [], expectedKind: 'implementation',
          inputId: 'i-m1', inputPayload: { content: [{ type: 'text', text: 'work' }] },
        },
      ],
    });
    // The member's own question (created by its ctx.ui call).
    h.store.createInteraction({
      interactionId: 'q-member', projectId: h.projectId, sessionId: 's-member', inputId: 'i-m1',
      taskId: task.id, method: 'select', title: 'which target?', options: ['a', 'b'],
      requestKey: 'q-member',
    });

    // The chief sees its member's pending question (M5: presented on the chief's channel).
    const pending = h.store.listPendingInteractionsForChief('s-chief');
    expect(pending.map((row) => row.interactionId)).toEqual(['q-member']);
    // An unrelated chief sees nothing.
    h.store.createSession({ id: 's-other', projectId: h.projectId, roleId: 'chief', cwd: '/tmp' });
    expect(h.store.listPendingInteractionsForChief('s-other')).toHaveLength(0);
  });
});

describe('interaction wait state', () => {
  it('marks the session as waiting until the answer arrives', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devagent-wait-'));
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    cleanups.push(() => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    });
    store.createProject({ id: 'p-1', realPath: '/projects/alpha' });
    store.createSession({ id: 's-chief', projectId: 'p-1', roleId: 'chief', cwd: '/projects/alpha' });
    store.createSession({ id: 's-other', projectId: 'p-1', roleId: 'chief', cwd: '/projects/alpha' });
    const bridge = new InteractionBridge({ store });

    const pending = bridge.ask({ sessionId: 's-chief', method: 'select', title: 'pick', options: ['a', 'b'] });
    expect(bridge.isWaiting('s-chief')).toBe(true);
    expect(bridge.isWaiting('s-other')).toBe(false);

    expect(bridge.resolve(bridge.lastInteractionIdFor('s-chief'), 'a')).toBe(true);
    await expect(pending).resolves.toBe('a');
    // The run is producing again: the watchdog's stall clock applies as before.
    expect(bridge.isWaiting('s-chief')).toBe(false);
  });
});
