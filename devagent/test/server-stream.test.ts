import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { epochOf } from '../src/runtime/epoch.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

const cleanups: Array<() => Promise<void> | void> = [];
/** Per-harness block records, read by the injected `blockedOf`. */
const blocks = new Map<string, { code: string; detail: string }>();

afterEach(async () => {
  blocks.clear();
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'stream-secret';
const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');

interface Harness {
  readonly liveHistories: Map<string, { records: readonly import('../src/server/history.ts').HistoryRecord[]; problems?: readonly string[] } | undefined>;
  readonly origin: string;
  readonly store: Store;
  readonly projectId: string;
  /** The temporary root and its project directory: tests write history files under them. */
  readonly root: string;
  readonly projectRoot: string;
  readonly hub: SessionEventHub;
  readonly registry: SessionRegistry;
  awaitRun(): Promise<void>;
  cookie: string;
  csrf: string;
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  prepare(sessionId: string): Promise<{
    subscriptionId: string;
    streamPath: string;
    epoch: string;
    boundary: number;
    snapshot: Record<string, unknown>;
  }>;
  /** Read SSE frames as they arrive; `state` is live and the waiters are real signals. */
  readStream(streamPath: string): Promise<{
    readonly state: { events: Array<Record<string, unknown>>; resync: string | null };
    waitForEvents(count: number): Promise<void>;
    waitForResync(): Promise<void>;
    close(): void;
    done: Promise<void>;
  }>;
}

async function harness(
  replies: readonly StubReply[] = [],
  options: { bufferLimit?: number; prepareTtlMs?: number; clock?: { value: number } } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-stream-'));
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 7 });
  const projectId = 'p-1';
  store.createProject({ id: projectId, realPath: realpathSync(projectRoot) });
  store.createSession({ id: 's-chief', projectId, roleId: 'chief', cwd: realpathSync(projectRoot) });

  const model = replies.length > 0 ? await startStubModelServer(replies) : undefined;
  cleanups.push(async () => {
    await model?.close();
  });
  const env = model === undefined ? undefined : await createStubEnv(model.baseUrl);
  if (env !== undefined) {
    cleanups.push(() => rmSync(env.root, { recursive: true, force: true }));
  }
  const server: RuntimeDefaults = {
    model: model === undefined ? { providerId: 'unset', modelId: 'unset' } : { providerId: 'stub', modelId: 'stub-1' },
    agentDir: env?.agentDir ?? join(root, 'agent'),
    promptDir: PROMPT_DIR,
    tools: [],
  };
  const clock = options.clock;
  const hub = new SessionEventHub({
    ...(options.bufferLimit !== undefined ? { bufferLimit: options.bufferLimit } : {}),
    ...(options.prepareTtlMs !== undefined ? { prepareTtlMs: options.prepareTtlMs } : {}),
    ...(clock !== undefined ? { now: () => clock.value } : {}),
  });
  const factory = new PiRuntimeFactory(server);
  const registry = new SessionRegistry(factory);
  const epoch = (sessionId: string): string =>
    epochOf({ serverEpoch: store.epoch, instanceGeneration: registry.generationOf(sessionId) });
  const runner = new InputRunner({
    store,
    registry,
    factory,
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server }),
    onEvent: (sessionId, event, meta) => {
      // The same epoch definition the entry uses: server generation + Pi instance generation.
      hub.publish(sessionId, event, { inputId: meta.inputId, epoch: epoch(sessionId) });
    },
  });
  const liveHistories = new Map<string, { records: readonly import('../src/server/history.ts').HistoryRecord[]; problems?: readonly string[] } | undefined>();
  const runWaiters: Array<() => void> = [];
  const worker = new WorkbenchWorker({
    store,
    runner,
    idleDelayMs: 10,
    onOutcome: (_sessionId, outcome) => {
      if (outcome.kind === 'completed' || outcome.kind === 'failed' || outcome.kind === 'stopped') {
        for (const resolve of runWaiters.splice(0)) {
          resolve();
        }
      }
    },
  });
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
  });
  registerStreamMethods(router, {
    store,
    hub,
    // The tests set this to model a run that cannot start.
    blockedOf: (sessionId) => blocks.get(sessionId) ?? null,
    epochOf: (sessionId) => epoch(sessionId),
    // Tests inject a "live" history source (what main.ts backs with the registry).
    currentHistory: (sessionId) => liveHistories.get(sessionId),
  });
  const workbench = createWorkbenchServer({ store, auth, router, hub });
  const { origin } = await workbench.listen(0);
  worker.start();
  cleanups.push(async () => {
    await worker.stop();
    await workbench.close();
    registry.disposeAll();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const h: Harness = {
    liveHistories,
    origin,
    store,
    projectId,
    root,
    projectRoot,
    hub,
    registry,
    awaitRun: () =>
      new Promise((resolve) => {
        runWaiters.push(resolve);
      }),
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
    async prepare(sessionId) {
      const body = await h.call('session.stream.prepare', { projectId, sessionId });
      const result = body['result'] as {
        subscriptionId: string;
        streamPath: string;
        epoch: string;
        boundary: number;
        snapshot: Record<string, unknown>;
      };
      return result;
    },
    async readStream(streamPath) {
      // A live object: the async reader below mutates it, and the test reads it after `done`.
      const state: { events: Array<Record<string, unknown>>; resync: string | null } = { events: [], resync: null };
      const done = Promise.withResolvers<void>();
      const eventWaiters: Array<{ count: number; resolve: () => void }> = [];
      let resyncWaiter: (() => void) | undefined;
      const settle = (): void => {
        // Only satisfied waiters leave the list; the others keep waiting for their own condition.
        for (let index = eventWaiters.length - 1; index >= 0; index -= 1) {
          const waiter = eventWaiters[index];
          if (waiter !== undefined && state.events.length >= waiter.count) {
            eventWaiters.splice(index, 1);
            waiter.resolve();
          }
        }
        if (state.resync !== null && resyncWaiter !== undefined) {
          const resolve = resyncWaiter;
          resyncWaiter = undefined;
          resolve();
        }
      };
      const controller = new AbortController();
      const response = await fetch(`${origin}${streamPath}`, {
        headers: { cookie: `${SESSION_COOKIE}=${h.cookie}`, accept: 'text/event-stream' },
        signal: controller.signal,
      });
      const immediate = (): Promise<void> => Promise.resolve();
      if (response.status !== 200) {
        const body = (await response.json()) as { error?: { code: string } };
        state.resync = body.error?.code ?? 'http-error';
        done.resolve();
        return { state, waitForEvents: immediate, waitForResync: immediate, close: () => controller.abort(), done: done.promise };
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      void (async () => {
        try {
          for (;;) {
            const chunk = await reader?.read();
            if (chunk === undefined || chunk.done === true) {
              break;
            }
            buffered += decoder.decode(chunk.value, { stream: true });
            let boundary = buffered.indexOf('\n\n');
            while (boundary >= 0) {
              const frame = buffered.slice(0, boundary);
              buffered = buffered.slice(boundary + 2);
              const eventLine = /^event: (.+)$/m.exec(frame)?.[1];
              const dataLine = /^data: (.+)$/m.exec(frame)?.[1];
              if (eventLine === 'resync' && dataLine !== undefined) {
                state.resync = String((JSON.parse(dataLine) as { reason: string }).reason);
              } else if (dataLine !== undefined) {
                state.events.push(JSON.parse(dataLine) as Record<string, unknown>);
              }
              settle();
              boundary = buffered.indexOf('\n\n');
            }
          }
        } catch {
          // An aborted read is a normal close.
        } finally {
          done.resolve();
        }
      })();
      return {
        state,
        waitForEvents: (count: number) =>
          state.events.length >= count
            ? Promise.resolve()
            : new Promise((resolve) => {
                eventWaiters.push({ count, resolve });
              }),
        waitForResync: () =>
          state.resync !== null
            ? Promise.resolve()
            : new Promise((resolve) => {
                resyncWaiter = resolve;
              }),
        close: () => controller.abort(),
        done: done.promise,
      };
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

/** Await the hub really dropping a subscription after the reader went away. */
async function waitForRelease(hub: SessionEventHub, attempts = 500): Promise<void> {
  for (let attempt = 0; attempt < attempts && hub.size > 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(hub.size).toBe(0);
}

async function afterHarness(h: Harness): Promise<void> {
  // The shared afterEach cleans by directory; nothing extra to release here.
  void h;
}

describe('session stream', () => {
  it('prepares a snapshot with a boundary and streams only what happens after it', async () => {
    const h = await harness();
    // Something already true before the boundary: a queued input.
    h.store.acceptInput({
      inputId: 'i-old',
      projectId: h.projectId,
      sessionId: 's-chief',
      sourceKey: 's-chief:i-old',
      requestKey: 'i-old',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'before' }] },
    });

    const prepared = await h.prepare('s-chief');

    // serverEpoch:instanceGeneration - no Pi instance exists yet, so the generation is 0.
    expect(prepared.epoch).toBe('7:0');
    expect(prepared.boundary).toBe(0);
    expect((prepared.snapshot['inputs'] as Array<{ inputId: string }>).map((entry) => entry.inputId)).toEqual(['i-old']);
    expect(prepared.snapshot['activity']).toBe('queued');
    expect(prepared.streamPath).toContain(`subscriptionId=${prepared.subscriptionId}`);

    const stream = await h.readStream(prepared.streamPath);
    // An event published after prepare reaches the reader; the snapshot input is not replayed.
    h.hub.publish('s-chief', { type: 'agent_start' }, { epoch: '7' });
    h.hub.publish('s-chief', { type: 'invalidate', entity: 'task', id: 't-1' }, { epoch: '7' });
    await stream.waitForEvents(2);
    stream.close();
    await stream.done;

    expect(stream.state.events.map((entry) => entry['seq'])).toEqual([1, 2]);
    // A Pi event keeps `type: 'pi'` with the event nested; a business notice is the frame's own type.
    expect(stream.state.events[0]).toMatchObject({ type: 'pi' });
    expect((stream.state.events[0]?.['event'] as { type: string }).type).toBe('agent_start');
    expect(stream.state.events[1]).toMatchObject({ type: 'invalidate', entity: 'task', id: 't-1' });
    expect(stream.state.resync).toBeNull();
  });

  it('carries a tool result identity through the snapshot so a reload can flip the same card', async () => {
    const h = await harness();
    // A history in which a tool call was answered: the result message names the call.
    const piFile = join(h.root, 'sessions', 's-chief.jsonl');
    mkdirSync(dirname(piFile), { recursive: true });
    writeFileSync(
      piFile,
      [
        JSON.stringify({ type: 'session', id: 'h-1', version: 3, timestamp: 't', cwd: h.projectRoot }),
        JSON.stringify({
          type: 'message',
          id: 'a-1',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'call_7', name: 'question', arguments: { method: 'select' } }],
          },
          timestamp: 't1',
        }),
        JSON.stringify({
          type: 'message',
          id: 'r-1',
          message: {
            role: 'toolResult',
            toolCallId: 'call_7',
            toolName: 'question',
            isError: false,
            content: [{ type: 'text', text: 'interactionId=q-1' }],
          },
          timestamp: 't2',
        }),
      ].join('\n') + '\n',
    );
    h.store.recordSessionBinding({ sessionId: 's-chief', piFile, hasHistory: true, configHash: 'cfg' });

    const prepared = await h.prepare('s-chief');
    const messages = prepared.snapshot['messages'] as Array<Record<string, unknown>>;
    const result = messages.find((message) => message['role'] === 'toolResult');
    // Without the identity a reloaded transcript could not match the result to its call card.
    expect(result).toMatchObject({ toolCallId: 'call_7', toolName: 'question', isError: false });
    const call = messages.find((message) => message['role'] === 'assistant');
    expect(call?.['toolCallId']).toBeUndefined();
  });

  it('auths the stream by cookie, refuses a foreign subscription and expires unused ones', async () => {
    const h = await harness();
    const prepared = await h.prepare('s-chief');

    // No cookie, no stream (a credential never travels in the URL).
    const anonymous = await fetch(`${h.origin}${prepared.streamPath}`);
    expect(anonymous.status).toBe(401);

    // A subscription belongs to the actor and session that prepared it.
    const otherSession = await h.call('session.create', { projectId: h.projectId });
    const otherId = (otherSession['result'] as { session: { sessionId: string } }).session.sessionId;
    const forged = await fetch(`${h.origin}/api/v1/sessions/${otherId}/stream?subscriptionId=${prepared.subscriptionId}`, {
      headers: { cookie: `${SESSION_COOKIE}=${h.cookie}` },
    });
    expect(forged.status).toBe(409);
    expect(((await forged.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('forbidden');

    // An unknown subscription asks the client to prepare again.
    const unknown = await fetch(`${h.origin}/api/v1/sessions/s-chief/stream?subscriptionId=nope`, {
      headers: { cookie: `${SESSION_COOKIE}=${h.cookie}` },
    });
    expect(unknown.status).toBe(409);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('STREAM_RESYNC_REQUIRED');

    // Taking the same subscription twice is refused (a stream owns its buffer).
    const first = await h.readStream(prepared.streamPath);
    const second = await fetch(`${h.origin}${prepared.streamPath}`, { headers: { cookie: `${SESSION_COOKIE}=${h.cookie}` } });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('taken');
    first.close();
    await first.done;
  });

  it('tells a reader that fell behind to resync instead of feeding it a gap', async () => {
    const h = await harness([], { bufferLimit: 3 });
    const prepared = await h.prepare('s-chief');
    // Nobody is reading yet: the buffer overflows.
    for (let index = 0; index < 6; index += 1) {
      h.hub.publish('s-chief', { type: 'agent_start', index }, { epoch: '7' });
    }

    const stream = await h.readStream(prepared.streamPath);
    await stream.done;

    expect(stream.state.resync).toBe('overflow');
    expect(stream.state.events).toEqual([]);
  });

  it('resyncs when the instance generation changes under a live stream', async () => {
    const h = await harness();
    const prepared = await h.prepare('s-chief');
    const stream = await h.readStream(prepared.streamPath);

    // A new generation invalidates this boundary (the first event is adopted as the epoch).
    h.hub.publish('s-chief', { type: 'agent_start' }, { epoch: '7' });
    await stream.waitForEvents(1);
    h.hub.publish('s-chief', { type: 'agent_start' }, { epoch: '8' });
    await stream.waitForResync();
    await stream.done;

    expect(stream.state.resync).toBe('epoch');
    expect(stream.state.events).toHaveLength(1);
  });

  it('drops a prepared subscription nobody took instead of growing forever', async () => {
    const clock = { value: 1_000 };
    const h = await harness([], { prepareTtlMs: 100, clock });
    const first = await h.prepare('s-chief');
    expect(h.hub.size).toBe(1);

    // Time passes without the stream ever being requested: the next prepare sweeps the stale one.
    clock.value += 1_000;
    const second = await h.prepare('s-chief');

    expect(second.subscriptionId).not.toBe(first.subscriptionId);
    expect(h.hub.size).toBe(1);
  });

  it('resyncs a live stream when the Pi instance is really rebuilt', async () => {
    const h = await harness([{ kind: 'text', text: 'first' }, { kind: 'text', text: 'second' }]);
    const prepared = await h.prepare('s-chief');
    const stream = await h.readStream(prepared.streamPath);

    // Run once: the instance exists and its generation is current.
    await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: 'one' }],
    });
    await h.awaitRun();
    await stream.waitForEvents(1);

    // Rebuilding the instance ends that generation: the boundary no longer describes the session.
    h.registry.disposeAll();
    await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: 'two' }],
    });
    await stream.waitForResync();
    await stream.done;

    expect(stream.state.resync).toBe('epoch');
    // Both inputs exist; the second one is still running when the reader is told to resync.
    expect(h.store.listInputs('s-chief')).toHaveLength(2);
  }, 30_000);

  it('streams real Pi events for a run and keeps the work going after the reader leaves', async () => {
    const h = await harness([{ kind: 'text', text: '好的，先讨论。' }]);
    const prepared = await h.prepare('s-chief');
    const stream = await h.readStream(prepared.streamPath);

    const submitted = await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: '先讨论' }],
    });
    const inputId = (submitted['result'] as { inputId: string }).inputId;
    await h.awaitRun();

    // The reader saw the input invalidation and the live Pi events of the run it caused.
    await stream.waitForEvents(2);
    expect(stream.state.events.some((entry) => entry['type'] === 'invalidate')).toBe(true);
    expect(stream.state.events.some((entry) => entry['inputId'] === inputId)).toBe(true);
    expect(stream.state.events.every((entry) => typeof entry['seq'] === 'number')).toBe(true);

    // Disconnecting destroys the reader's buffer; it never cancels the work (M4).
    stream.close();
    await stream.done;
    expect(h.store.getInput(inputId)?.status).toBe('completed');
    // The server releases the subscription when the connection goes away.
    await waitForRelease(h.hub);
  }, 30_000);
});

describe('session.stream.prepare with a live history source', () => {
  it('snapshot messages come from the in-memory projection, so an in-flight entry is visible', async () => {
    const h = await harness();
    try {
      // The "live" instance has seen the marker, the user message and an assistant entry that
      // has NOT yet been flushed to the history file (readPiHistory would miss it).
      h.liveHistories.set('s-chief', {
        records: [
          { index: 0, id: 'mk1', type: 'custom', role: null, content: null, toolCallId: null, toolName: null, isError: null, timestamp: null, inputId: 'i-1', marker: { inputId: 'i-1' } },
          { index: 1, id: 'u1', type: 'message', role: 'user', content: [{ type: 'text', text: 'q' }], toolCallId: null, toolName: null, isError: null, timestamp: null, inputId: 'i-1', marker: null },
          { index: 2, id: 'a-live', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'streaming tail' }], toolCallId: null, toolName: null, isError: null, timestamp: null, inputId: 'i-1', marker: null },
        ],
        problems: [],
      });
      const { snapshot } = await h.prepare('s-chief');
      const messages = snapshot['messages'] as Array<Record<string, unknown>>;
      // Markers are not conversation: pageHistory lists message entries only (same as the file
      // read). The correlated inputId still travels on each message.
      expect(messages.map((entry) => entry['entryId'])).toEqual(['u1', 'a-live']);
      expect(messages.every((entry) => entry['inputId'] === 'i-1')).toBe(true);
      expect((messages[1]?.['content'] as Array<{ text?: string }>)[0]?.text).toBe('streaming tail');
      expect(snapshot['historyProblems']).toEqual([]);
    } finally {
      await afterHarness(h);
    }
  });

  it('without a live source the snapshot still reads the history file (fallback)', async () => {
    const h = await harness();
    try {
      const piDir = join(h.root, 'sessions');
      mkdirSync(piDir, { recursive: true });
      const piFile = join(piDir, 'pi.jsonl');
      writeFileSync(
        piFile,
        [
          JSON.stringify({ type: 'session', id: 'pi-1', cwd: h.projectRoot, version: 2 }),
          JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: 't', message: { role: 'user', content: [{ type: 'text', text: 'from file' }], timestamp: 1 } }),
        ].join('\n') + '\n',
      );
      h.store.recordSessionBinding({ sessionId: 's-chief', piFile, hasHistory: true, configHash: 'test' });
      const { snapshot } = await h.prepare('s-chief');
      const messages = snapshot['messages'] as Array<Record<string, unknown>>;
      expect(messages.map((entry) => entry['entryId'])).toEqual(['u1']);
    } finally {
      await afterHarness(h);
    }
  });
});

describe('stream preparation', () => {
  it('carries the current block, so a late reader still learns why nothing runs', async () => {
    const h = await harness();
    h.store.createSession({ id: 's-blocked', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });
    blocks.set('s-blocked', { code: 'blocked_config', detail: 'no model is configured' });

    const prepared = await h.prepare('s-blocked');

    expect(prepared.snapshot['blocked']).toEqual({ code: 'blocked_config', detail: 'no model is configured' });
    // A session with nothing blocking it says so, instead of carrying an old reason.
    h.store.createSession({ id: 's-clear', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });
    const clear = await h.prepare('s-clear');
    expect(clear.snapshot['blocked']).toBeNull();
  });
});
