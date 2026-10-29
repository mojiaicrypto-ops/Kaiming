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
      const matched = waiters.filter(
        (entry) => entry.sessionId === sessionId && entry.kind === outcome.kind,
      );
      for (const waiter of matched) waiter.resolve();
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (matched.includes(waiters[index]!)) waiters.splice(index, 1);
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
    compactSession: (sessionId) => runner.compactManually(sessionId),
    controlTask: (control) => runner.controlTask(control),
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

  it('controls a Task through the same stop flow as the chief tool', async () => {
    const h = await harness();
    const task = h.store.createTask({
      id: 't-ctrl',
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

    const paused = await h.call('task.control', {
      projectId: h.projectId,
      taskId: task.id,
      expectedRevision: h.store.getTask(task.id)?.revision ?? 1,
      command: 'pause',
    });
    expect(paused.status).toBe(200);
    expect(resultOf<{ status: string }>(paused.body).status).toBe('paused');

    const stale = await h.call('task.control', {
      projectId: h.projectId,
      taskId: task.id,
      expectedRevision: h.store.getTask(task.id)?.revision ?? 1,
      command: 'cancel',
    });
    expect(resultOf<{ status: string }>(stale.body).status).toBe('cancelled');

    const wrongProject = await h.call('task.control', {
      projectId: h.projectId,
      taskId: 't-nope',
      expectedRevision: 1,
      command: 'pause',
    });
    expect(wrongProject.status).toBe(404);
  }, 30_000);

  it('cleans up only a session nothing references and lists the real reasons otherwise', async () => {
    const h = await harness();
    // A session that still has work cannot be cleaned up: the reason names the input.
    h.store.acceptInput({
      inputId: 'in-8',
      projectId: h.projectId,
      sessionId: 's-dev',
      sourceKey: 's-dev:in-8',
      requestKey: 'in-8',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'x' }] },
    });
    const busy = await h.call('session.cleanup', {
      projectId: h.projectId,
      sessionId: 's-dev',
      expectedRevision: h.store.getSession('s-dev')?.revision ?? 1,
    });
    // WORKSPACE_BUSY: the session is still referenced, and the gaps say why (R6 mapping).
    expect(busy.status).toBe(409);
    expect(errorCode(busy.body)).toBe('WORKSPACE_BUSY');
    expect((busy.body['error'] as { details: { gaps: string[] } }).details.gaps.join(' ')).toContain('in-8');
    expect(h.store.getSession('s-dev')).toBeDefined();

    // A session with its own rows still deletes cleanly: the rows go with it (no FK leftovers).
    const created = await h.call('session.create', { projectId: h.projectId });
    const fresh = resultOf<{ session: { sessionId: string } }>(created.body).session.sessionId;
    h.store.acceptInput({
      inputId: 'in-fresh',
      projectId: h.projectId,
      sessionId: fresh,
      sourceKey: `${fresh}:in-fresh`,
      requestKey: 'in-fresh',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'done' }] },
    });
    const claimedFresh = h.store.claimNextInput(fresh);
    if (claimedFresh.kind !== 'claimed') {
      throw new Error('the fresh session input could not be claimed');
    }
    h.store.finishInput({
      inputId: 'in-fresh',
      expectedRevision: claimedFresh.input.revision,
      status: 'completed',
    });
    h.store.recordSessionBinding({ sessionId: fresh, piFile: join(tmpdir(), 'devagent-fresh.jsonl'), hasHistory: false, configHash: 'c' });
    expect(h.store.sessionCleanupGaps(fresh)).toEqual([]);
    const cleaned = await h.call('session.cleanup', {
      projectId: h.projectId,
      sessionId: fresh,
      expectedRevision: h.store.getSession(fresh)?.revision ?? 1,
    });

    expect(cleaned.status).toBe(200);
    expect(resultOf<{ deleted: boolean }>(cleaned.body).deleted).toBe(true);
    expect(h.store.getSession(fresh)).toBeUndefined();
    // Its own rows went with it (a parent-first delete would have failed on the FK).
    expect(h.store.listInputs(fresh)).toEqual([]);
    expect(h.store.getSessionBinding(fresh)).toBeUndefined();

    // A session that coordinated a Task is referenced by that record: refused with the reason.
    const coordinated = 's-chief';
    const task = h.store.createTask({
      id: 't-history',
      projectId: h.projectId,
      chiefSessionId: coordinated,
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
    h.store.controlTask({ taskId: task.id, expectedRevision: task.revision, command: 'cancel' });
    expect(h.store.getSession(coordinated)?.currentTaskId).toBeNull();
    const chiefed = await h.call('session.cleanup', {
      projectId: h.projectId,
      sessionId: coordinated,
      expectedRevision: h.store.getSession(coordinated)?.revision ?? 1,
    });
    expect(chiefed.status).toBe(409);
    expect(errorCode(chiefed.body)).toBe('WORKSPACE_BUSY');
    expect((chiefed.body['error'] as { details: { gaps: string[] } }).details.gaps.join(' ')).toContain('coordinated');

    // A wrong revision on an otherwise clean session is a version conflict, and nothing is deleted.
    const spare = await h.call('session.create', { projectId: h.projectId });
    const spareId = resultOf<{ session: { sessionId: string } }>(spare.body).session.sessionId;
    const stale = await h.call('session.cleanup', {
      projectId: h.projectId,
      sessionId: spareId,
      expectedRevision: 999,
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('VERSION_CONFLICT');
    expect(h.store.getSession(spareId)).toBeDefined();
  }, 30_000);

  it('names a chief conversation, and clearing the name returns it to the derived title', async () => {
    const h = await harness([], { startWorker: false });
    h.store.acceptInput({
      inputId: 'in-name',
      projectId: h.projectId,
      sessionId: 's-chief',
      sourceKey: 's-chief:in-name',
      requestKey: 'in-name',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: '帮我看一下这个项目的文档结构' }] },
    });

    const listed = async (): Promise<string | null> => {
      const body = await h.call('session.list', { projectId: h.projectId, limit: 50 });
      const sessions = resultOf<{ sessions: Array<{ sessionId: string; title: string | null; revision: number }> }>(
        body.body,
      ).sessions;
      return sessions.find((row) => row.sessionId === 's-chief')?.title ?? null;
    };
    const revisionOf = (sessionId: string): number => h.store.getSession(sessionId)?.revision ?? 0;

    // Unnamed: the rail falls back to the first thing the user said.
    expect(await listed()).toBe('帮我看一下这个项目的文档结构');

    const renamed = await h.call('session.rename', {
      projectId: h.projectId,
      sessionId: 's-chief',
      title: '文档结构',
      expectedRevision: revisionOf('s-chief'),
    });
    expect(renamed.status).toBe(200);
    expect(resultOf<{ title: string }>(renamed.body).title).toBe('文档结构');
    expect(await listed()).toBe('文档结构');

    // A name is not a blank label: an empty title means "back to the default", not "".
    await h.call('session.rename', {
      projectId: h.projectId,
      sessionId: 's-chief',
      title: '   ',
      expectedRevision: revisionOf('s-chief'),
    });
    expect(await listed()).toBe('帮我看一下这个项目的文档结构');

    // Sub-sessions are not in the rail, so naming one would be a write nobody can see.
    const sub = await h.call('session.rename', {
      projectId: h.projectId,
      sessionId: 's-dev',
      title: 'dev',
      expectedRevision: revisionOf('s-dev'),
    });
    expect(sub.status).toBe(400);
    expect(errorCode(sub.body)).toBe('INVALID_ARGUMENT');

    // A stale revision is a conflict, and the stored name is untouched.
    const stale = await h.call('session.rename', {
      projectId: h.projectId,
      sessionId: 's-chief',
      title: 'other',
      expectedRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('VERSION_CONFLICT');
    expect(await listed()).toBe('帮我看一下这个项目的文档结构');
  }, 30_000);

  it('resolves an interrupted input only with cited evidence, then lets the queue continue', async () => {
    const h = await harness();
    // An interrupted input blocks the session until a real verification closes it.
    h.store.acceptInput({
      inputId: 'in-9',
      projectId: h.projectId,
      sessionId: 's-chief',
      sourceKey: 's-chief:in-9',
      requestKey: 'in-9',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'first' }] },
    });
    const claimed = h.store.claimNextInput('s-chief');
    if (claimed.kind !== 'claimed') {
      throw new Error('the input could not be claimed');
    }
    h.store.finishInput({
      inputId: 'in-9',
      expectedRevision: claimed.input.revision,
      status: 'interrupted',
      errorCode: 'HOST_SAVE_FAILED',
      errorMessage: 'boundary unknown',
    });

    const withoutEvidence = await h.call('session.recovery.resolve', {
      projectId: h.projectId,
      sessionId: 's-chief',
      inputId: 'in-9',
      expectedRevision: h.store.getInput('in-9')?.revision ?? 1,
      resolution: 'completed',
      evidenceRefs: [],
    });
    expect(withoutEvidence.status).toBe(409);
    expect(errorCode(withoutEvidence.body)).toBe('PI_INPUT_UNCONFIRMED');
    expect(h.store.getInput('in-9')?.status).toBe('interrupted');

    const resolved = await h.call('session.recovery.resolve', {
      projectId: h.projectId,
      sessionId: 's-chief',
      inputId: 'in-9',
      expectedRevision: h.store.getInput('in-9')?.revision ?? 1,
      resolution: 'completed',
      evidenceRefs: ['session:history:i-1'],
    });

    expect(resolved.status).toBe(200);
    const row = h.store.getInput('in-9');
    expect(row?.status).toBe('completed');
    expect(JSON.parse(row?.recovery ?? '{}')).toMatchObject({
      resolution: 'completed',
      evidenceRefs: ['session:history:i-1'],
    });
    // The session is consumable again and a second resolve is refused (the input is not interrupted).
    const again = await h.call('session.recovery.resolve', {
      projectId: h.projectId,
      sessionId: 's-chief',
      inputId: 'in-9',
      expectedRevision: row?.revision ?? 1,
      resolution: 'completed',
      evidenceRefs: ['x'],
    });
    expect(again.status).toBe(400);
  }, 30_000);

  it('refuses to control a terminal Task and to resolve without real evidence', async () => {
    const h = await harness();
    const task = h.store.createTask({
      id: 't-done',
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
    h.store.controlTask({ taskId: task.id, expectedRevision: task.revision, command: 'cancel' });

    const resurrect = await h.call('task.control', {
      projectId: h.projectId,
      taskId: task.id,
      expectedRevision: h.store.getTask(task.id)?.revision ?? 1,
      command: 'pause',
    });

    expect(resurrect.status).toBe(409);
    expect(errorCode(resurrect.body)).toBe('VERSION_CONFLICT');
    expect(h.store.getTask(task.id)?.status).toBe('cancelled');

    // Blank evidence is not evidence.
    h.store.createSession({ id: 's-blank', projectId: h.projectId, roleId: 'chief', cwd: h.store.getProject(h.projectId)?.realPath ?? '' });
    h.store.acceptInput({
      inputId: 'in-blank',
      projectId: h.projectId,
      sessionId: 's-blank',
      sourceKey: 's-blank:in-blank',
      requestKey: 'in-blank',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'x' }] },
    });
    const claimed = h.store.claimNextInput('s-blank');
    if (claimed.kind !== 'claimed') {
      throw new Error('the input could not be claimed');
    }
    h.store.finishInput({
      inputId: 'in-blank',
      expectedRevision: claimed.input.revision,
      status: 'interrupted',
      errorCode: 'HOST_SAVE_FAILED',
    });
    const blank = await h.call('session.recovery.resolve', {
      projectId: h.projectId,
      sessionId: 's-blank',
      inputId: 'in-blank',
      expectedRevision: h.store.getInput('in-blank')?.revision ?? 1,
      resolution: 'stopped',
      evidenceRefs: ['   '],
    });
    expect(blank.status).toBe(409);
    expect(errorCode(blank.body)).toBe('PI_INPUT_UNCONFIRMED');
    expect(h.store.getInput('in-blank')?.status).toBe('interrupted');
  }, 30_000);

  it('lets the session consume its remaining work after a resolution', async () => {
    const h = await harness();
    h.store.acceptInput({
      inputId: 'in-old',
      projectId: h.projectId,
      sessionId: 's-chief',
      sourceKey: 's-chief:in-old',
      requestKey: 'in-old',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'first' }] },
    });
    const claimed = h.store.claimNextInput('s-chief');
    if (claimed.kind !== 'claimed') {
      throw new Error('the input could not be claimed');
    }
    h.store.finishInput({
      inputId: 'in-old',
      expectedRevision: claimed.input.revision,
      status: 'interrupted',
      errorCode: 'HOST_SAVE_FAILED',
    });
    // While the interrupted input is unverified nothing else of this session is consumable.
    expect(h.store.claimNextInput('s-chief').kind).toBe('blocked');

    const resolved = await h.call('session.recovery.resolve', {
      projectId: h.projectId,
      sessionId: 's-chief',
      inputId: 'in-old',
      expectedRevision: h.store.getInput('in-old')?.revision ?? 1,
      resolution: 'stopped',
      evidenceRefs: ['session:history:i-1'],
    });
    expect(resolved.status).toBe(200);

    // Real continuation: the next queued input is claimable again (S7: new work, not a resend).
    await h.call(
      'session.input.submit',
      { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: 'continue' }] },
      'in-new',
    );
    const next = h.store.claimNextInput('s-chief');
    expect(next.kind).toBe('claimed');
    if (next.kind === 'claimed') {
      expect(next.input.inputId).toBe('in-new');
      h.store.finishInput({ inputId: 'in-new', expectedRevision: next.input.revision, status: 'completed' });
    }
  }, 30_000);

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

describe('frozen chief sessions', () => {
  it('lists a chief session\'s own interrupted inputs so the host can close them', async () => {
    const h = await harness();
    // A chief's user input left interrupted by a dead process.
    h.store.acceptInput({
      inputId: 'in-frozen', projectId: h.projectId, sessionId: 's-chief',
      sourceKey: 's-chief:in-frozen', requestKey: 'in-frozen', method: 'session.input.submit',
      kind: 'user', payload: { content: [{ type: 'text', text: 'hello' }] },
    });
    const claimed = h.store.claimNextInput('s-chief');
    if (claimed.kind !== 'claimed') throw new Error('not claimable');
    h.store.finishInput({ inputId: 'in-frozen', expectedRevision: claimed.input.revision, status: 'interrupted' });

    const frozen = h.store.listInterruptedChiefInputs();
    expect(frozen.map((row) => row.inputId)).toContain('in-frozen');

    // Until the host closes it, the session can consume nothing at all (RECOVERY_REQUIRED).
    h.store.acceptInput({
      inputId: 'in-later', projectId: h.projectId, sessionId: 's-chief',
      sourceKey: 's-chief:in-later', requestKey: 'in-later', method: 'session.input.submit',
      kind: 'user', payload: { content: [{ type: 'text', text: 'next' }] },
    });
    expect(h.store.claimNextInput('s-chief').kind).toBe('blocked');

    // Host closes it: the queue moves again.
    h.store.resolveInterruptedInput({
      sessionId: 's-chief', inputId: 'in-frozen', expectedRevision: h.store.getInput('in-frozen')!.revision,
      resolution: 'stopped', evidenceRefs: ['host:process-restart'], resolvedBy: 'host:startup',
    });
    const after = h.store.claimNextInput('s-chief');
    expect(after.kind).toBe('claimed');
    expect(after.kind === 'claimed' ? after.input.inputId : '').toBe('in-later');
  });
});

describe('compaction policy surface', () => {
  it('reads the default, saves a valid threshold and refuses an out-of-range one', async () => {
    const h = await harness();

    const initial = await h.call('compaction.get');
    expect(initial.status).toBe(200);
    const first = (initial.body['result'] as { config: { auto: boolean; thresholdPercent: number; revision: number } }).config;
    expect(first).toMatchObject({ auto: true, thresholdPercent: 70, revision: 1 });

    const saved = await h.call('compaction.save', { auto: false, thresholdPercent: 85, expectedRevision: first.revision });
    expect(saved.status).toBe(200);
    const next = (saved.body['result'] as { config: { auto: boolean; thresholdPercent: number; revision: number } }).config;
    expect(next).toMatchObject({ auto: false, thresholdPercent: 85, revision: 2 });

    const refused = await h.call('compaction.save', { auto: true, thresholdPercent: 40, expectedRevision: next.revision });
    expect(refused.status).toBe(400);
    expect((refused.body['error'] as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('answers a manual compact request from the runner instead of guessing the session state', async () => {
    const h = await harness([{ kind: 'text', text: '好的。' }]);

    const noInstance = await h.call('session.compact', { projectId: h.projectId, sessionId: 's-chief' });
    expect(noInstance.status).toBe(200);
    expect(noInstance.body['result']).toEqual({ status: 'unavailable' });

    await h.call('session.input.submit', { projectId: h.projectId, sessionId: 's-chief', content: [{ type: 'text', text: '你好' }] });
    await h.awaitOutcome('s-chief', 'completed');

    const nothing = await h.call('session.compact', { projectId: h.projectId, sessionId: 's-chief' });
    expect(nothing.status).toBe(200);
    expect(nothing.body['result']).toEqual({ status: 'nothing' });
  });
});
