import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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
import { WorkbenchWorker } from '../src/server/worker.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner, type RunOutcome, type RunnerOptions } from '../src/runtime/runner.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'write-surface-secret';
// The role bodies live in the repository (two levels above devagent/test).
const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');

interface Harness {
  readonly origin: string;
  readonly store: Store;
  readonly projectId: string;
  readonly runner: InputRunner;
  readonly outcomes: Array<{ sessionId: string; kind: RunOutcome['kind'] }>;
  /** Resolves when the worker reports the given outcome (a real event, not a guessed delay). */
  awaitOutcome(sessionId: string, kind: RunOutcome['kind']): Promise<void>;
  cookie: string;
  csrf: string;
  call(method: string, params?: Record<string, unknown>, requestId?: string): Promise<{ status: number; body: Record<string, unknown> }>;
}

/** A workbench wired like the entry point: store, runner, worker (unless the test drives it), HTTP. */
async function harness(
  replies: readonly StubReply[] = [],
  options: { startWorker?: boolean; sessionExtras?: RunnerOptions['sessionExtras'] } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-write-'));
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  const projectId = 'p-1';
  store.createProject({ id: projectId, realPath: realpathSync(projectRoot) });
  store.createSession({ id: 's-chief', projectId, roleId: 'chief', cwd: realpathSync(projectRoot) });
  store.createSession({ id: 's-dev', projectId, roleId: 'developer', cwd: realpathSync(projectRoot) });

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
  const factory = new PiRuntimeFactory(server);
  const registry = new SessionRegistry(factory);
  const runner = new InputRunner({
    store,
    registry,
    factory,
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server }),
    ...(options.sessionExtras !== undefined ? { sessionExtras: options.sessionExtras } : {}),
  });
  const outcomes: Array<{ sessionId: string; kind: RunOutcome['kind'] }> = [];
  const waiters: Array<{ sessionId: string; kind: RunOutcome['kind']; resolve: () => void }> = [];
  const worker = new WorkbenchWorker({
    store,
    runner,
    idleDelayMs: 10,
    onOutcome: (sessionId, outcome) => {
      outcomes.push({ sessionId, kind: outcome.kind });
      for (const waiter of waiters.splice(0).filter((entry) => entry.sessionId === sessionId && entry.kind === outcome.kind)) {
        waiter.resolve();
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
  });
  const workbench = createWorkbenchServer({ store, auth, router });
  const { origin } = await workbench.listen(0);
  const started = options.startWorker ?? true;
  if (started) {
    worker.start();
  }
  cleanups.push(async () => {
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
    outcomes,
    awaitOutcome: (sessionId, kind) =>
      new Promise((resolve) => {
        if (outcomes.some((entry) => entry.sessionId === sessionId && entry.kind === kind)) {
          resolve();
          return;
        }
        waiters.push({ sessionId, kind, resolve });
      }),
    cookie: '',
    csrf: '',
    async call(method, params = {}, requestId = `req-${Math.random().toString(16).slice(2)}`) {
      const response = await fetch(`${origin}/api/v1/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(h.cookie === '' ? {} : { cookie: `${SESSION_COOKIE}=${h.cookie}`, [CSRF_HEADER]: h.csrf }),
        },
        body: JSON.stringify({ requestId, method, params }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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

const resultOf = <T>(body: Record<string, unknown>): T => body['result'] as T;
const errorCode = (body: Record<string, unknown>): string => (body['error'] as { code: string }).code;

describe('write surface', () => {
  it('accepts a chief input and runs it through the worker', async () => {
    const h = await harness([{ kind: 'text', text: '好的，先讨论。' }]);

    const submitted = await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: '先讨论，不开始开发' }] },
      'in-1',
    );

    expect(submitted.status).toBe(200);
    expect(resultOf<{ inputId: string; status: string }>(submitted.body)).toMatchObject({ inputId: 'in-1', status: 'queued' });
    // Await the worker's own report instead of guessing how long a run takes.
    await h.awaitOutcome('s-chief', 'completed');

    expect(h.store.getInput('in-1')?.status).toBe('completed');
    // The run really produced a Pi history carrying the host's correlation marker.
    const binding = h.store.getSessionBinding('s-chief');
    const history = readFileSync(binding?.piFile ?? '', 'utf8');
    expect(history).toContain('agentdev.input-marker');
    expect(history).toContain('in-1');
  }, 30_000);

  it('is idempotent for a retried submit and refuses a different input with the same id', async () => {
    const h = await harness([{ kind: 'text', text: 'ok' }]);

    const first = await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'hello' }] },
      'in-2',
    );
    const retry = await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'hello' }] },
      'in-2',
    );

    expect(resultOf<{ inputId: string }>(retry.body).inputId).toBe(resultOf<{ inputId: string }>(first.body).inputId);
    expect(h.store.listInputs('s-chief').filter((input) => input.inputId === 'in-2')).toHaveLength(1);

    const conflict = await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'something else' }] },
      'in-2',
    );
    expect(conflict.status).toBe(409);
    expect(errorCode(conflict.body)).toBe('REQUEST_CONFLICT');
  }, 30_000);

  it('refuses user input for a professional session, an empty content list and a foreign Task', async () => {
    const h = await harness();

    const professional = await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-dev',
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(professional.status).toBe(403);
    expect(errorCode(professional.body)).toBe('FORBIDDEN');

    const empty = await h.call('session.input.submit', { projectId: h.projectId, sessionId: 's-chief', content: [] });
    expect(empty.status).toBe(400);
    expect(errorCode(empty.body)).toBe('INVALID_ARGUMENT');

    const foreignTask = await h.call('session.input.submit', {
      projectId: h.projectId,
      sessionId: 's-chief',
      content: [{ type: 'text', text: 'hello' }],
      taskId: 't-nope',
    });
    expect(foreignTask.status).toBe(400);
    expect(h.store.listInputs('s-chief')).toHaveLength(0);
  });

  it('keeps an input that belongs to no running Task queued behind the Task it does not cite', async () => {
    const h = await harness();
    const task = h.store.createTask({
      id: 't-open',
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      ownerEpoch: 1,
      type: 'read',
      requiresTest: false,
      goal: 'investigate',
      scope: 'x',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'p' },
      authorizationRefs: [],
      sourceInputId: 'none',
    });
    expect(task.id).toBe('t-open');

    const submitted = await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: '另一个话题' }] },
      'in-3',
    );

    // The state is decidable immediately: the input is stored, and the store refuses to hand it out.
    expect(resultOf<{ waitingForTask?: string }>(submitted.body).waitingForTask).toBe('t-open');
    expect(h.store.getInput('in-3')?.status).toBe('queued');
    expect(h.store.claimNextInput('s-chief').kind).toBe('busy');
  }, 30_000);

  it('stops a queued input without running it and reports the session as idle', async () => {
    // No model is configured, so the worker cannot run the input before the stop arrives.
    const h = await harness();

    await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'stop me' }] },
      'in-4',
    );
    const stopped = await h.call(
      'session.input.stop',
      { projectId: h.projectId, sessionId: 's-chief', inputId: 'in-4' },
      'stop-1',
    );

    expect(stopped.status).toBe(200);
    expect(resultOf<{ status: string; stopRequested: boolean; activity: string }>(stopped.body)).toMatchObject({
      status: 'stopped',
      stopRequested: true,
      activity: 'idle',
    });
    expect(h.store.getInput('in-4')?.status).toBe('stopped');
  });

  it('stops a live run, waits for it to settle, and reports the terminal state', async () => {
    const entered = Promise.withResolvers<void>();
    const h = await harness([{ kind: 'tool_calls', calls: [{ name: 'probe_hold', arguments: '{}' }] }], {
      startWorker: false,
      // A tool that blocks until the run is aborted: the stop then has a live run to stop.
      sessionExtras: () => ({
        customTools: [
          {
            name: 'probe_hold',
            label: 'probe_hold',
            description: 'holds the run open until it is aborted',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            executionMode: 'sequential',
            async execute(
              _toolCallId: string,
              _params: unknown,
              signal: AbortSignal | undefined,
              _onUpdate: unknown,
              _ctx: unknown,
            ) {
              entered.resolve();
              const aborted = Promise.withResolvers<void>();
              signal?.addEventListener('abort', () => aborted.resolve(), { once: true });
              await aborted.promise;
              return { content: [{ type: 'text', text: 'aborted' }], details: {} };
            },
          } as never,
        ],
      }),
    });
    await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'long run' }] },
      'in-5',
    );
    // Drive the run from the test so the live phase is deterministic (the worker stays stopped).
    const running = h.runner.runNext('s-chief');
    await entered.promise;
    expect(h.store.getInput('in-5')?.status).toBe('processing');

    const stopped = await h.call(
      'session.input.stop',
      { projectId: h.projectId, sessionId: 's-chief', inputId: 'in-5' },
      'stop-2',
    );
    const outcome = await running;

    expect(stopped.status).toBe(200);
    // The reply reports the settled row, so status and activity cannot contradict each other.
    expect(resultOf<{ inputId: string; stopRequested: boolean; status: string; activity: string }>(stopped.body)).toMatchObject({
      inputId: 'in-5',
      stopRequested: true,
      status: 'stopped',
      activity: 'idle',
    });
    expect(outcome.kind).toBe('stopped');
    expect(h.store.getInput('in-5')?.status).toBe('stopped');
  }, 60_000);

  it('closes an input whose Task already ended instead of blocking the queue with it', async () => {
    const h = await harness();
    // The chief gets a Task and cites it on a supplementary input.
    const task = h.store.createTask({
      id: 't-ends',
      projectId: h.projectId,
      chiefSessionId: 's-chief',
      ownerEpoch: 1,
      type: 'read',
      requiresTest: false,
      goal: 'investigate',
      scope: 'x',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'p' },
      authorizationRefs: [],
      sourceInputId: 'none',
    });
    await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'more about it' }], taskId: task.id },
      'in-6',
    );
    // The Task ends before that input is ever claimed.
    h.store.controlTask({ taskId: task.id, expectedRevision: h.store.getTask(task.id)?.revision ?? 1, command: 'cancel' });
    await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'a new topic' }] },
      'in-7',
    );

    const claim = h.store.claimNextInput('s-chief');

    // The orphaned input is closed with the real reason, and the queue moves on to the next input.
    expect(h.store.getInput('in-6')).toMatchObject({ status: 'stopped', errorCode: 'TASK_ENDED' });
    expect(claim.kind).toBe('claimed');
    if (claim.kind === 'claimed') {
      expect(claim.input.inputId).toBe('in-7');
      h.store.finishInput({ inputId: 'in-7', expectedRevision: claim.input.revision, status: 'completed' });
    }
  }, 30_000);
});
