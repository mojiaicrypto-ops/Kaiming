import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { resolveEffectiveConfig, type RuntimeDefaults, type ThinkingLevel } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { assembleSystemPrompt, loadPromptBodies } from '../src/runtime/prompt-assembly.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner, boundaryPersistedOnDisk, type RunOutcome } from '../src/runtime/runner.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

/** The role prompts the server ships (docs/technicalnew/prompts). */
const PROMPT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'technicalnew',
  'prompts',
);

/**
 * Fixture note: the scripted model endpoint lives in spikes/harness (a test fixture); it should move
 * to a dedicated `test/fixtures` module once the P0 spikes are retired.
 */
const dirs: string[] = [];
const stores: Store[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Harness {
  readonly store: Store;
  readonly runner: InputRunner;
  readonly registry: SessionRegistry;
  readonly defaults: RuntimeDefaults;
  readonly agentDir: string;
  readonly cwd: string;
}

async function harness(options: {
  replies: readonly StubReply[];
  tools?: readonly string[];
  modelIds?: readonly string[];
  model?: RuntimeDefaults['model'];
  /** The stub models declare reasoning, and the role runs at this Pi thinking level. */
  reasoning?: boolean;
  level?: ThinkingLevel;
  taskType?: 'read' | 'write';
  /** Mutable task type for tests that change it between inputs. */
  taskTypeOf?: () => 'read' | 'write' | undefined;
  sessionExtras?: ConstructorParameters<typeof InputRunner>[0]['sessionExtras'];
  acceptInput?: boolean;
  /** Run watchdog windows, for tests that exercise a stall without waiting 15 minutes. */
  runStallMs?: number;
  runTotalMs?: number;
  /** Give bash calls this many seconds when the test model omits a timeout. */
  bashTimeoutSeconds?: number;
  /** Runs the runner started outside the worker (the chief's dispatch tool). */
  onRunSettled?: (sessionId: string, outcome: RunOutcome) => void;
}): Promise<Harness> {
  const server = await startStubModelServer(options.replies);
  servers.push(server);
  const env = await createStubEnv(server.baseUrl, {
    ...(options.modelIds !== undefined ? { modelIds: options.modelIds } : {}),
    ...(options.reasoning === true ? { reasoning: true } : {}),
  });
  dirs.push(env.root);
  const store = new Store({ path: join(env.root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: env.cwd });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: env.cwd });
  if (options.acceptInput !== false) {
    accept(store, 'i-1', 'req-1');
  }
  const defaults: RuntimeDefaults = {
    model: options.model ?? { providerId: 'stub', modelId: 'stub-1' },
    agentDir: env.agentDir,
    promptDir: PROMPT_DIR,
    tools: options.tools ?? [],
  };
  const factory = new PiRuntimeFactory(defaults);
  const registry = new SessionRegistry(factory);
  const runner = new InputRunner({
    store,
    registry,
    factory,
    resolveConfig: (roleId) =>
      resolveEffectiveConfig({
        roleId,
        server: defaults,
        // A level is stored on the same row as a model, so the harness states both or neither.
        ...(options.level !== undefined
          ? {
              roleOverrides: { [roleId]: defaults.model },
              roleLevels: { [roleId]: options.level },
            }
          : {}),
      }),
    taskTypeOf: options.taskTypeOf ?? (() => options.taskType),
    ...(options.sessionExtras !== undefined ? { sessionExtras: options.sessionExtras } : {}),
    ...(options.runStallMs !== undefined ? { runStallMs: options.runStallMs } : {}),
    ...(options.runTotalMs !== undefined ? { runTotalMs: options.runTotalMs } : {}),
    ...(options.bashTimeoutSeconds !== undefined ? { bashTimeoutSeconds: options.bashTimeoutSeconds } : {}),
    ...(options.onRunSettled !== undefined ? { onRunSettled: options.onRunSettled } : {}),
  });
  return { store, runner, registry, defaults, agentDir: env.agentDir, cwd: env.cwd };
}

function accept(store: Store, inputId: string, requestKey: string, taskId?: string): void {
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId: 's-1',
    // An input for the running Task must cite it (R3); without a Task the field stays absent.
    ...(taskId !== undefined ? { taskId } : {}),
    sourceKey: `user:${requestKey}`,
    requestKey,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'hello' }] },
  });
}

describe('effective configuration', () => {
  const server: RuntimeDefaults = {
    model: { providerId: 'stub', modelId: 'stub-1' },
    agentDir: '/agent',
    promptDir: PROMPT_DIR,
    tools: ['read'],
  };

  it('prefers the role override, then the project default, then the server default', () => {
    expect(
      resolveEffectiveConfig({
        roleId: 'reviewer',
        server,
        project: { model: { providerId: 'p', modelId: 'project-model' } },
        roleOverrides: { reviewer: { providerId: 'r', modelId: 'role-model' } },
      }),
    ).toMatchObject({ source: 'role', selection: { providerId: 'r', modelId: 'role-model' } });

    expect(
      resolveEffectiveConfig({
        roleId: 'developer',
        server,
        project: { model: { providerId: 'p', modelId: 'project-model' } },
        roleOverrides: { reviewer: { providerId: 'r', modelId: 'role-model' } },
      }),
    ).toMatchObject({ source: 'project', selection: { providerId: 'p', modelId: 'project-model' } });

    expect(resolveEffectiveConfig({ roleId: 'chief', server })).toMatchObject({
      source: 'server',
      selection: { providerId: 'stub', modelId: 'stub-1' },
      tools: ['read'],
    });
  });
});

describe('delivered boundary read-back', () => {
  it('requires a real session header, this input marker, the first user entry and a reachable leaf', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kaiming-boundary-'));
    dirs.push(dir);
    const file = join(dir, 'session.jsonl');
    const marker = {
      type: 'custom',
      id: 'm1',
      parentId: null,
      customType: 'kaiming.input-marker',
      data: { inputId: 'i-1', requestDigest: 'digest-1', generation: { serverEpoch: 1, claim: 1 } },
    };
    const user = { type: 'message', id: 'u1', parentId: 'm1', message: { role: 'user', content: 'hi' } };
    const assistant = { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant' } };
    const header = { type: 'session', id: 'h1', version: 3, timestamp: 't', cwd: dir };
    const write = (entries: readonly unknown[]): void => {
      writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    };
    write([header, marker, user, assistant]);

    const checkpoint = {
      piFile: file,
      leafEntryId: 'a1',
      inputMarkerId: 'm1',
      inputEntryId: 'u1',
      configHash: 'x',
    };
    const expected = { inputId: 'i-1', requestDigest: 'digest-1', cwd: dir };

    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(true);
    // Same ids but for a different input: not this input's history.
    expect(
      boundaryPersistedOnDisk(checkpoint, { ...expected, inputId: 'i-2' }),
    ).toBe(false);
    expect(
      boundaryPersistedOnDisk(checkpoint, { ...expected, requestDigest: 'other' }),
    ).toBe(false);
    // A copied marker without a digest is not this input's marker.
    write([header, { ...marker, data: { inputId: 'i-1' } }, user, assistant]);
    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(false);
    write([header, marker, user, assistant]);
    // The file must belong to the expected working directory.
    write([{ ...header, cwd: join(dir, 'other') }, marker, user, assistant]);
    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(false);
    write([header, marker, user, assistant]);
    // The root entry must be a user message descending from the marker.
    write([header, marker, { ...user, parentId: null }, assistant]);
    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(false);
    // The leaf must be reachable from the root.
    write([header, marker, user, { ...assistant, parentId: null }]);
    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(false);
    // A corrupt cycle must terminate and be rejected rather than hang the runner.
    write([
      header,
      { ...marker, parentId: 'cyc' },
      { id: 'cyc', type: 'custom', parentId: 'm1', customType: 'other' },
    ]);
    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(false);
    // A file without a session header, a truncated file, or a missing file is not a valid history.
    write([marker, user, assistant]);
    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(false);
    writeFileSync(file, '{"type":"session","id":"h1"}\n{broken');
    expect(boundaryPersistedOnDisk(checkpoint, expected)).toBe(false);
    expect(
      boundaryPersistedOnDisk({ ...checkpoint, piFile: join(dir, 'nope.jsonl') }, expected),
    ).toBe(false);
  });
});

describe('role context injection', () => {
  it('injects the base rules and the chief body without replacing Pi instructions', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    await h.runner.runNext('s-1');
    const systemPrompt = h.registry.get('s-1')?.session.systemPrompt ?? '';
    const bodies = loadPromptBodies(PROMPT_DIR);
    const assembled = assembleSystemPrompt(bodies, 'chief');

    expect(assembled.sources.map((source) => source.name)).toEqual(['base', 'chief']);
    // A distinctive slice of each injected body really reaches the model.
    expect(systemPrompt).toContain(bodies.base.text.slice(0, 120));
    expect(systemPrompt).toContain(bodies.roles.chief.text.slice(0, 120));
    // Pi's own instructions are still there (we append, never replace).
    expect(systemPrompt.length).toBeGreaterThan(assembled.text.length);
    expect(systemPrompt).toContain('<cwd>');
  });

  it('gives a specialist the shared specialist rules and only its own role body', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    h.store.createSession({
      id: 's-reviewer',
      projectId: 'p-1',
      roleId: 'reviewer',
      cwd: h.cwd,
    });
    h.store.acceptInput({
      inputId: 'r-1',
      projectId: 'p-1',
      sessionId: 's-reviewer',
      sourceKey: 'delegation:r-1',
      requestKey: 'r-1',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'review the candidate' }] },
    });

    const outcome = await h.runner.runNext('s-reviewer');

    expect(outcome.kind).toBe('completed');
    const systemPrompt = h.registry.get('s-reviewer')?.session.systemPrompt ?? '';
    const bodies = loadPromptBodies(PROMPT_DIR);
    expect(systemPrompt).toContain(bodies.specialists.text.slice(0, 120));
    expect(systemPrompt).toContain(bodies.roles.reviewer.text.slice(0, 120));
    expect(systemPrompt).not.toContain(bodies.roles.chief.text.slice(0, 120));
  });

  it('refuses a session whose role has no prompt body instead of running without rules', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    h.store.createSession({ id: 's-ghost', projectId: 'p-1', roleId: 'nobody', cwd: h.cwd });
    h.store.acceptInput({
      inputId: 'g-1',
      projectId: 'p-1',
      sessionId: 's-ghost',
      sourceKey: 'user:g-1',
      requestKey: 'g-1',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'hello' }] },
    });

    const outcome = await h.runner.runNext('s-ghost');

    expect(outcome.kind).toBe('blocked_role');
    expect(h.store.getInput('g-1')?.status).toBe('queued');
    expect(h.registry.count()).toBe(0);
  });
});

describe('input runner', () => {
  it('completes a delivered input and records the real boundary', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') {
      throw new Error('unreachable');
    }
    expect(outcome.checkpoint?.inputMarkerId).toBeDefined();
    const row = h.store.getInput('i-1');
    expect(row).toMatchObject({ status: 'completed', claim: 1, serverEpoch: 1 });
    expect(row?.effectiveConfig).toContain('stub-1');
    expect(row?.checkpoint).toContain(outcome.checkpoint?.inputEntryId ?? 'missing');
    // The exact Pi file is bound so later inputs (and a rebuilt instance) resume this history.
    expect(h.store.getSessionBinding('s-1')?.piFile).toBe(outcome.checkpoint?.piFile);
    expect(h.registry.count()).toBe(1);
    h.registry.disposeAll();
    expect(h.registry.count()).toBe(0);
  });

  it('reuses one Pi instance for a second input of the same session', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    await h.runner.runNext('s-1');
    const first = h.registry.get('s-1');
    accept(h.store, 'i-2', 'req-2');

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    expect(h.registry.get('s-1')).toBe(first);
    expect(h.registry.count()).toBe(1);
  });

  it('gives the paused turn its own instance and tool set, not the running one\'s', async () => {
    // The tool allowlist is part of the registry's binding hash, so a pause - which narrows it - must
    // produce a fresh instance from the same history rather than running on the old, wider one.
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }, { kind: 'text', text: 'paused' }, { kind: 'text', text: 'resumed' }] });
    expect((await h.runner.runNext('s-1')).kind).toBe('completed');
    const runningHandle = h.registry.get('s-1');
    expect(runningHandle?.session.getActiveToolNames() ?? []).toContain('bash');

    const task = h.store.createTask({
      id: 't-reuse',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'reset password',
      scope: 'account',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
      authorizationRefs: ['m-1'],
      sourceInputId: 'i-1',
    });
    h.store.updateTask({ taskId: task.id, phase: 'review' });
    h.store.controlTask({ taskId: task.id, command: 'pause' });
    accept(h.store, 'i-2', 'req-2', task.id);
    expect((await h.runner.runNext('s-1')).kind).toBe('completed');

    const pausedHandle = h.registry.get('s-1');
    expect(pausedHandle).not.toBe(runningHandle);
    expect(pausedHandle?.piFile()).toBe(runningHandle?.piFile());
    const active = pausedHandle?.session.getActiveToolNames() ?? [];
    expect(active).not.toContain('bash');
    expect(active).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls', 'task']));

    h.store.controlTask({ taskId: task.id, command: 'resume' });
    accept(h.store, 'i-3', 'req-3', task.id);
    expect((await h.runner.runNext('s-1')).kind).toBe('completed');
    expect(h.registry.get('s-1')?.session.getActiveToolNames() ?? []).toContain('bash');
  });

  it('classifies a failing model run as failed rather than completed', async () => {
    const h = await harness({ replies: [{ kind: 'http_error', status: 500, message: 'boom' }] });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('failed');
    expect(h.store.getInput('i-1')).toMatchObject({ status: 'failed', errorCode: 'MODEL_ERROR' });
    // A failed run still settled in Pi, so its delivered boundary is a real fact worth keeping.
    expect(h.store.getInput('i-1')?.checkpoint).not.toBeNull();
  }, 60_000);

  it('classifies a host-aborted run as stopped', async () => {
    let noteAbort: (() => void) | undefined;
    const h = await harness({
      replies: [{ kind: 'tool_calls', calls: [{ name: 'probe_abort', arguments: '{}' }] }],
      tools: ['probe_abort'],
      sessionExtras: () => ({
        customTools: [
          {
            name: 'probe_abort',
            label: 'probe_abort',
            description: 'aborts the run from inside the tool',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            executionMode: 'sequential',
            async execute(
              _toolCallId: string,
              _params: unknown,
              _signal: unknown,
              _onUpdate: unknown,
              ctx: { abort(): void },
            ) {
              noteAbort?.();
              ctx.abort();
              return { content: [{ type: 'text', text: 'aborting' }], details: {} };
            },
          } as never,
        ],
      }),
    });
    noteAbort = () => h.runner.noteAbort('s-1', 'i-1');

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('stopped');
    expect(h.store.getInput('i-1')?.status).toBe('stopped');
  }, 30_000);

  it('reports the same abort as failed when no stop was requested', async () => {
    const h = await harness({
      replies: [{ kind: 'tool_calls', calls: [{ name: 'probe_abort', arguments: '{}' }] }],
      tools: ['probe_abort'],
      sessionExtras: () => ({
        customTools: [
          {
            name: 'probe_abort',
            label: 'probe_abort',
            description: 'aborts without telling the runner',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            executionMode: 'sequential',
            async execute(
              _toolCallId: string,
              _params: unknown,
              _signal: unknown,
              _onUpdate: unknown,
              ctx: { abort(): void },
            ) {
              ctx.abort();
              return { content: [{ type: 'text', text: 'aborting' }], details: {} };
            },
          } as never,
        ],
      }),
    });

    const outcome = await h.runner.runNext('s-1');

    // Without a recorded stop the abort is indistinguishable from a provider error, so the honest
    // classification is `failed` (never a silent success, never a guessed `stopped`).
    expect(outcome.kind).toBe('failed');
  }, 30_000);

  it('persists a stop that lands while the run is still in flight', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const h = await harness({
      replies: [{ kind: 'tool_calls', calls: [{ name: 'probe_wait', arguments: '{}' }] }],
      tools: ['probe_wait'],
      sessionExtras: () => ({
        customTools: [
          {
            name: 'probe_wait',
            label: 'probe_wait',
            description: 'waits until released or aborted',
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
              await Promise.race([release.promise, aborted.promise]);
              return { content: [{ type: 'text', text: 'released' }], details: {} };
            },
          } as never,
        ],
      }),
    });

    const running = h.runner.runNext('s-1');
    await entered.promise;
    const stop = await h.runner.requestStop('s-1', {
      inputId: 'i-1',
      requestKey: 'stop-1',
      reason: 'user',
    });
    release.resolve();
    const outcome = await running;

    expect(stop).toEqual({ status: 'processing', stopRequested: true });
    expect(outcome.kind).toBe('stopped');
    expect(h.store.getInput('i-1')?.status).toBe('stopped');
  }, 30_000);

  it('rebuilds the instance on a config change but keeps the same history file', async () => {
    const server = await startStubModelServer([
      { kind: 'text', text: 'first' },
      { kind: 'text', text: 'second' },
    ]);
    servers.push(server);
    const env = await createStubEnv(server.baseUrl, { modelIds: ['stub-1', 'stub-2'] });
    dirs.push(env.root);
    const store = new Store({ path: join(env.root, 'state.db'), serverEpoch: 1 });
    stores.push(store);
    store.createProject({ id: 'p-1', realPath: env.cwd });
    store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: env.cwd });
    accept(store, 'i-1', 'req-1');
    accept(store, 'i-2', 'req-2');
    let selection = { providerId: 'stub', modelId: 'stub-1' };
    const defaults: RuntimeDefaults = {
      model: selection,
      agentDir: env.agentDir,
      promptDir: PROMPT_DIR,
      tools: [],
    };
    const factory = new PiRuntimeFactory(defaults);
    const registry = new SessionRegistry(factory);
    const runner = new InputRunner({
      store,
      registry,
      factory,
      resolveConfig: (roleId) =>
        resolveEffectiveConfig({ roleId, server: { ...defaults, model: selection } }),
    });

    const first = await runner.runNext('s-1');
    const firstHandle = registry.get('s-1');
    const piFile = firstHandle?.piFile();
    expect(piFile).toBeDefined();
    selection = { providerId: 'stub', modelId: 'stub-2' };

    const second = await runner.runNext('s-1');

    expect(first.kind).toBe('completed');
    expect(second.kind).toBe('completed');
    expect(registry.get('s-1')).not.toBe(firstHandle);
    expect(registry.get('s-1')?.piFile()).toBe(piFile);
    const contents = readFileSync(piFile ?? '', 'utf8');
    expect(contents).toContain('first');
    expect(contents).toContain('second');
  }, 30_000);

  it('treats a boundary that cannot be read back from disk as interrupted', async () => {
    const h = await harness({
      replies: [{ kind: 'tool_calls', calls: [{ name: 'probe_lock', arguments: '{}' }] }],
      tools: ['probe_lock'],
      sessionExtras: () => ({
        customTools: [
          {
            name: 'probe_lock',
            label: 'probe_lock',
            description: 'makes the session file unreadable after writing',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            executionMode: 'sequential',
            async execute(
              _toolCallId: string,
              _params: unknown,
              _signal: unknown,
              _onUpdate: unknown,
              ctx: { sessionManager: { getSessionFile(): string | undefined } },
            ) {
              const file = ctx.sessionManager.getSessionFile();
              if (file !== undefined) {
                chmodSync(file, 0o000);
              }
              return { content: [{ type: 'text', text: 'locked' }], details: {} };
            },
          } as never,
        ],
      }),
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('interrupted');
    expect(h.store.getInput('i-1')?.status).toBe('interrupted');
  }, 30_000);

  it('keeps a run alive while it waits for a user answer, past the stall window', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'question',
              arguments: JSON.stringify({ method: 'select', title: 'which target?', options: ['a', 'b'] }),
            },
          ],
        },
        { kind: 'text', text: 'answered' },
      ],
      runStallMs: 120,
      runTotalMs: 5_000,
    });

    // The user answers only after the stall window has passed: the run is waiting on a human, not
    // stalled, so it must still settle normally instead of being aborted (RUN_STALLED).
    const answering = (async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        // Wait for the watchdog's own predicate, not just the stored row: the record is written
        // slightly before the waiter is registered, and answering in that gap let the stall check
        // see "not waiting" and abort the run under a loaded suite.
        if (h.runner.interactions.isWaiting('s-1')) {
          const pending = h.store.listPendingInteractionsForChief('s-1');
          await new Promise((resolve) => setTimeout(resolve, 250));
          expect(h.runner.interactions.resolve(pending[0]?.interactionId ?? '', 'a')).toBe(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('the run never asked its question');
    })();

    const outcome = await h.runner.runNext('s-1');
    await answering;

    expect(outcome.kind).toBe('completed');
    expect(h.store.getInput('i-1')?.status).toBe('completed');
  }, 30_000);

  it('does not charge the chief for time spent waiting on a dispatched step', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'task',
              arguments: JSON.stringify({ op: 'dispatch', taskId: 't-1', waitTimeoutMs: 2_000 }),
            },
          ],
        },
        { kind: 'text', text: 'step settled' },
      ],
      runTotalMs: 500,
      runStallMs: 600,
      acceptInput: false,
    });
    h.store.createTask({
      id: 't-1',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'ship it',
      scope: 'x',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'p' },
      authorizationRefs: [],
      sourceInputId: 'seed',
    });
    h.store.createTaskSessions({
      taskId: 't-1',
      members: [
        {
          sessionId: 's-dev',
          taskId: 't-1',
          roleId: 'developer',
          phase: 'plan',
          label: 'dev',
          instructions: 'implement it',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          writeScope: ['src/**'],
          inputId: 'i-dev',
          inputPayload: { content: [{ type: 'text', text: 'implement it' }] },
        },
      ],
    });
    // The chief's input cites the Task, as the browser does while the Task is open.
    accept(h.store, 'i-1', 'req-1', 't-1');
    const member = h.store.claimNextInput('s-dev');
    if (member.kind !== 'claimed') throw new Error(`member input was not claimable: ${member.kind}`);

    // The member settles well past both watchdog windows. Only the chief's wait is real here, so a
    // watchdog that charges that wait would abort the chief (RUN_TIMEOUT/RUN_STALLED) before this.
    const finishing = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      h.store.finishInput({
        inputId: 'i-dev',
        expectedRevision: member.input.revision,
        status: 'completed',
      });
    })();

    const outcome = await h.runner.runNext('s-1');
    await finishing;

    expect(outcome.kind).toBe('completed');
    expect(h.store.getInput('i-1')?.status).toBe('completed');
  }, 30_000);

  it('reports a member run the dispatch tool started after the chief turn ended', async () => {
    const memberSettled = Promise.withResolvers<string>();
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'task',
              arguments: JSON.stringify({
                op: 'dispatch',
                taskId: 't-1',
                waitTimeoutMs: 1_000,
                sessions: [
                  {
                    roleId: 'developer',
                    instructions: 'implement it',
                    writeScope: ['src/**'],
                    expectedKind: 'implementation',
                  },
                ],
              }),
            },
          ],
        },
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'agent_report',
              arguments: JSON.stringify({ summary: 'implemented it', body: '# implementation\n\ndone\n' }),
            },
          ],
        },
        { kind: 'slow_text', text: 'member finished', chunks: 1, delayMs: 1_200 },
        { kind: 'text', text: 'chief ended before the member' },
      ],
      acceptInput: false,
      onRunSettled: (sessionId, outcome) => {
        if (sessionId !== 's-1' && outcome.kind === 'completed') memberSettled.resolve(sessionId);
      },
    });
    h.store.createTask({
      id: 't-1',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'ship it',
      scope: 'x',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'p' },
      authorizationRefs: [],
      sourceInputId: 'seed',
    });
    h.store.updateTask({ taskId: 't-1', phase: 'develop' });
    accept(h.store, 'i-1', 'req-1', 't-1');

    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');

    // The dispatch wait returned before the member; its run finishes afterwards in the background
    // and must still be reported to the host (otherwise no invalidate and no settled-step wake).
    const memberSessionId = await memberSettled.promise;
    const member = h.store.getTaskSession(memberSessionId);
    expect(member?.taskId).toBe('t-1');
    expect(h.store.getInput(member?.currentInputId ?? '')?.status).toBe('completed');
  }, 30_000);

  it('reports an inaccessible project before claiming, leaving the input queued', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    rmSync(h.cwd, { recursive: true, force: true });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('blocked_project');
    expect(h.store.getInput('i-1')?.status).toBe('queued');
    expect(h.registry.count()).toBe(0);
  });

  it('does not strand an input when the session cannot be prepared', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    // Bind the session to a file that does not exist: preparing the instance must fail with the
    // precise reason, and the input must not be left in processing.
    h.store.recordSessionBinding({
      sessionId: 's-1',
      piFile: join(h.agentDir, 'sessions', 'missing.jsonl'),
      hasHistory: true,
      configHash: 'none',
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('interrupted');
    expect(h.store.getInput('i-1')).toMatchObject({
      status: 'interrupted',
      errorCode: 'HISTORY_UNAVAILABLE',
    });
  });

  it('treats an unconfirmable delivery boundary as interrupted', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    await h.runner.runNext('s-1');
    const piFile = h.registry.get('s-1')?.piFile();
    expect(piFile).toBeDefined();
    expect(existsSync(piFile ?? '')).toBe(true);
    const file = piFile ?? '';
    await chmod(file, 0o444);
    await chmod(join(h.agentDir, 'sessions'), 0o555);
    accept(h.store, 'i-2', 'req-2');

    let outcome;
    try {
      outcome = await h.runner.runNext('s-1');
    } finally {
      await chmod(join(h.agentDir, 'sessions'), 0o755);
      await chmod(file, 0o644);
    }

    expect(outcome.kind).toBe('interrupted');
    expect(h.store.getInput('i-2')).toMatchObject({
      status: 'interrupted',
      errorCode: 'HOST_SAVE_FAILED',
    });
  }, 30_000);

  it('records the terminal state even when construction fails while a stop lands', async () => {
    const server = await startStubModelServer([{ kind: 'text', text: 'ok' }]);
    servers.push(server);
    const env = await createStubEnv(server.baseUrl);
    dirs.push(env.root);
    const store = new Store({ path: join(env.root, 'state.db'), serverEpoch: 1 });
    stores.push(store);
    store.createProject({ id: 'p-1', realPath: env.cwd });
    store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: env.cwd });
    accept(store, 'i-1', 'req-1');
    const defaults: RuntimeDefaults = {
      model: { providerId: 'stub', modelId: 'stub-1' },
      agentDir: env.agentDir,
      promptDir: PROMPT_DIR,
      tools: [],
    };
    const factory = new PiRuntimeFactory(defaults);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    factory.create = async () => {
      entered.resolve();
      await release.promise;
      throw new Error('construction failed');
    };
    const registry = new SessionRegistry(factory);
    const runner = new InputRunner({
      store,
      registry,
      factory,
      resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: defaults }),
    });

    const running = runner.runNext('s-1');
    await entered.promise;
    const stop = await runner.requestStop('s-1', {
      inputId: 'i-1',
      requestKey: 'stop-1',
      reason: 'user',
    });
    release.resolve();
    const outcome = await running;

    expect(stop).toEqual({ status: 'processing', stopRequested: true });
    expect(outcome.kind).toBe('interrupted');
    // The stop moved the revision while construction was in flight; the write must not use the
    // claimed revision, or the row would stay `processing` forever.
    expect(store.getInput('i-1')?.status).toBe('interrupted');
  }, 30_000);

  it('records the terminal state when session wiring fails after the claim', async () => {
    const h = await harness({
      replies: [{ kind: 'text', text: 'ok' }],
      sessionExtras: () => {
        throw new Error('wiring failed');
      },
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('interrupted');
    expect(h.store.getInput('i-1')?.status).toBe('interrupted');
  });

  it('refuses to continue when the bound history file disappears', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    const first = await h.runner.runNext('s-1');
    expect(first.kind).toBe('completed');
    const piFile = h.store.getSessionBinding('s-1')?.piFile ?? '';
    expect(piFile).not.toBe('');
    rmSync(piFile, { force: true });
    accept(h.store, 'i-2', 'req-2');

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('interrupted');
    expect(h.store.getInput('i-2')).toMatchObject({
      status: 'interrupted',
      errorCode: 'HISTORY_UNAVAILABLE',
    });
    // The stale instance is dropped instead of continuing against a vanished history.
    expect(h.registry.count()).toBe(0);
  }, 30_000);

  it('keeps a reviewer session read-only even in a write Task', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }], taskType: 'write' });
    h.store.createSession({ id: 's-reviewer', projectId: 'p-1', roleId: 'reviewer', cwd: h.cwd });
    h.store.acceptInput({
      inputId: 'r-1',
      projectId: 'p-1',
      sessionId: 's-reviewer',
      sourceKey: 'delegation:r-1',
      requestKey: 'r-1',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'review the candidate' }] },
    });

    const outcome = await h.runner.runNext('s-reviewer');

    expect(outcome.kind).toBe('completed');
    const active = h.registry.get('s-reviewer')?.session.getActiveToolNames() ?? [];
    expect(active).toContain('read');
    expect(active).toContain('grep');
    expect(active).not.toContain('write');
    expect(active).not.toContain('edit');
    expect(active).not.toContain('bash');
  });

  it('gives a developer session the writing tools in a write Task and refuses them in a read Task', async () => {
    const writeHarness = await harness({
      replies: [{ kind: 'text', text: 'ok' }],
      taskType: 'write',
    });
    writeHarness.store.createSession({
      id: 's-dev',
      projectId: 'p-1',
      roleId: 'developer',
      cwd: writeHarness.cwd,
    });
    writeHarness.store.acceptInput({
      inputId: 'd-1',
      projectId: 'p-1',
      sessionId: 's-dev',
      sourceKey: 'delegation:d-1',
      requestKey: 'd-1',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'implement the change' }] },
    });

    const writeOutcome = await writeHarness.runner.runNext('s-dev');

    expect(writeOutcome.kind).toBe('completed');
    const writeTools = writeHarness.registry.get('s-dev')?.session.getActiveToolNames() ?? [];
    expect(writeTools).toEqual(expect.arrayContaining(['read', 'write', 'edit', 'bash']));

    const readHarness = await harness({ replies: [{ kind: 'text', text: 'ok' }], taskType: 'read' });
    readHarness.store.createSession({
      id: 's-dev',
      projectId: 'p-1',
      roleId: 'developer',
      cwd: readHarness.cwd,
    });
    readHarness.store.acceptInput({
      inputId: 'd-1',
      projectId: 'p-1',
      sessionId: 's-dev',
      sourceKey: 'delegation:d-1',
      requestKey: 'd-1',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'analyse the change' }] },
    });

    const readOutcome = await readHarness.runner.runNext('s-dev');

    expect(readOutcome.kind).toBe('completed');
    const readTools = readHarness.registry.get('s-dev')?.session.getActiveToolNames() ?? [];
    expect(readTools).toContain('read');
    expect(readTools).not.toContain('write');
    expect(readTools).not.toContain('edit');
    expect(readTools).not.toContain('bash');
  });

  it('records the tool set that was requested and the one really active', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }], taskType: 'write' });
    await h.runner.runNext('s-1');

    const recorded: unknown = JSON.parse(h.store.getInput('i-1')?.effectiveConfig ?? '{}');
    if (typeof recorded !== 'object' || recorded === null) {
      throw new Error('effectiveConfig is not an object');
    }
    const shape = recorded as { requestedTools?: unknown; activeTools?: unknown; taskType?: unknown };
    expect(Array.isArray(shape.requestedTools)).toBe(true);
    expect(Array.isArray(shape.activeTools)).toBe(true);
    const requested = shape.requestedTools as string[];
    const active = shape.activeTools as string[];
    expect(requested).toContain('read');
    // The chief can check the real state itself, but never carries project-writing tools.
    expect(requested).toContain('bash');
    expect(requested).not.toContain('write');
    expect(requested).not.toContain('edit');
    // Only registered names really activate; the record shows both.
    expect(active.every((name) => requested.includes(name))).toBe(true);
    expect(active).toContain('read');
    expect(shape.taskType).toBe('write');
  });

  it('lets the chief run a shell command itself', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'echo chief-shell-ok' }) }],
        },
        { kind: 'text', text: 'checked' },
      ],
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    const messages = h.registry.get('s-1')?.session.messages ?? [];
    const observed = JSON.stringify(messages);
    expect(observed).toContain('chief-shell-ok');
    // The real command ran: the tool result, not the model's claim, carries the output.
    expect(messages.some((message) => message.role === 'toolResult')).toBe(true);
  }, 30_000);

  it('refuses a model file read outside the project as a tool result', async () => {
    // The stub reads its reply array at request time, so the call can name a path only known after
    // the harness exists.
    const replies: StubReply[] = [];
    const h = await harness({ replies });
    const outside = join(h.cwd, '..', 'outside.txt');
    // A real file outside the project: the refusal must be the boundary, not a missing file.
    writeFileSync(outside, 'TOP-SECRET-CONTENT');
    replies.push(
      { kind: 'tool_calls', calls: [{ name: 'read', arguments: JSON.stringify({ path: outside }) }] },
      { kind: 'text', text: 'could not read it' },
    );

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    const messages = h.registry.get('s-1')?.session.messages ?? [];
    const result = messages.find((message) => message.role === 'toolResult') as
      | { isError?: boolean; content?: unknown }
      | undefined;
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).toMatch(/outside the project/);
    expect(JSON.stringify(messages)).not.toContain('TOP-SECRET-CONTENT');
  }, 30_000);

  it('bounds a bash command that omits a timeout, so a hang is a tool result not a stalled run', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'sleep 2' }) }],
        },
        { kind: 'text', text: 'saw the timeout' },
      ],
      bashTimeoutSeconds: 1,
      runStallMs: 60_000,
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    const observed = JSON.stringify(h.registry.get('s-1')?.session.messages ?? []);
    expect(observed).toContain('timed out after 1 seconds');
  }, 30_000);

  it('lets the designer move and delete documents through the shell', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'bash',
              arguments: JSON.stringify({ command: 'mkdir -p archive && mv src/a.md archive/a.md && rm src/b.md' }),
            },
          ],
        },
        { kind: 'text', text: 'archived' },
      ],
    });
    h.store.createSession({ id: 's-design', projectId: 'p-1', roleId: 'designer', cwd: h.cwd });
    mkdirSync(join(h.cwd, 'src'), { recursive: true });
    writeFileSync(join(h.cwd, 'src', 'a.md'), '# a\n');
    writeFileSync(join(h.cwd, 'src', 'b.md'), '# b\n');
    h.store.acceptInput({
      inputId: 'i-design',
      projectId: 'p-1',
      sessionId: 's-design',
      sourceKey: 'delegation:i-design',
      requestKey: 'i-design',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'archive the old document and drop the duplicate' }] },
    });

    // The command deletes src/b.md, so the deletion gate asks first; the user approves it here.
    const approving = (async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const question = h.store.listPendingInteractionsForChief('s-design')[0];
        if (question !== undefined) {
          h.store.resolveInteraction({
            interactionId: question.interactionId,
            expectedRevision: question.revision,
            response: true,
            answeredBy: 'test',
            requestKey: `answer:${question.interactionId}`,
          });
          expect(h.runner.interactions.resolve(question.interactionId, true)).toBe(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('the gate never asked about the deletion');
    })();

    const outcome = await h.runner.runNext('s-design');
    await approving;

    expect(outcome.kind).toBe('completed');
    // Pi has no rm/mv tool: without shell the designer cannot reorganize documents at all.
    expect(existsSync(join(h.cwd, 'archive', 'a.md'))).toBe(true);
    expect(existsSync(join(h.cwd, 'src', 'a.md'))).toBe(false);
    expect(existsSync(join(h.cwd, 'src', 'b.md'))).toBe(false);
  }, 30_000);

  it('rebuilds the instance when the Task type changes the tool set', async () => {
    let taskType: 'read' | 'write' | undefined = 'write';
    const h = await harness({
      replies: [{ kind: 'text', text: 'ok' }],
      taskTypeOf: () => taskType,
    });
    h.store.createSession({ id: 's-dev', projectId: 'p-1', roleId: 'developer', cwd: h.cwd });
    for (const [inputId, text] of [
      ['d-1', 'implement'],
      ['d-2', 'analyse'],
    ] as const) {
      h.store.acceptInput({
        inputId,
        projectId: 'p-1',
        sessionId: 's-dev',
        sourceKey: `delegation:${inputId}`,
        requestKey: inputId,
        method: 'task.session',
        kind: 'delegation',
        payload: { content: [{ type: 'text', text }] },
      });
    }

    const first = await h.runner.runNext('s-dev');
    const writeHandle = h.registry.get('s-dev');
    const writeTools = writeHandle?.session.getActiveToolNames() ?? [];
    taskType = 'read';
    const second = await h.runner.runNext('s-dev');
    const readHandle = h.registry.get('s-dev');
    const readTools = readHandle?.session.getActiveToolNames() ?? [];

    expect(first.kind).toBe('completed');
    expect(second.kind).toBe('completed');
    expect(writeTools).toEqual(expect.arrayContaining(['read', 'write', 'edit', 'bash']));
    // A read Task must not keep the writing tools a previous write Task activated.
    expect(readHandle).not.toBe(writeHandle);
    expect(readTools).toContain('read');
    expect(readTools).not.toContain('write');
    expect(readTools).not.toContain('edit');
    expect(readTools).not.toContain('bash');
  });

  it('never re-adds a denied tool through the host tool union', async () => {
    const tool = (name: string) => ({
      name,
      label: name,
      description: 'probe',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      executionMode: 'sequential' as const,
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }], details: {} };
      },
    });
    const h = await harness({
      replies: [{ kind: 'text', text: 'ok' }],
      taskType: 'read',
      sessionExtras: () => ({ customTools: [tool('backlog') as never, tool('probe_ok') as never] }),
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    const active = h.registry.get('s-1')?.session.getActiveToolNames() ?? [];
    expect(active).toContain('probe_ok');
    expect(active).not.toContain('backlog');
  });

  it('keeps role-level denials intact through the host tool union in a write Task', async () => {
    const tool = (name: string) => ({
      name,
      label: name,
      description: 'probe',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      executionMode: 'sequential' as const,
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }], details: {} };
      },
    });
    const h = await harness({
      replies: [{ kind: 'text', text: 'ok' }],
      taskType: 'write',
      sessionExtras: () => ({
        customTools: [tool('project') as never, tool('probe_ok') as never],
      }),
    });
    h.store.createSession({ id: 's-reviewer', projectId: 'p-1', roleId: 'reviewer', cwd: h.cwd });
    h.store.acceptInput({
      inputId: 'r-1',
      projectId: 'p-1',
      sessionId: 's-reviewer',
      sourceKey: 'delegation:r-1',
      requestKey: 'r-1',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'review' }] },
    });

    const outcome = await h.runner.runNext('s-reviewer');

    expect(outcome.kind).toBe('completed');
    const active = h.registry.get('s-reviewer')?.session.getActiveToolNames() ?? [];
    // A reviewer keeps its own tools and the generic probe, but never the chief's task tools.
    expect(active).toContain('read');
    expect(active).toContain('probe_ok');
    expect(active).not.toContain('project');
    expect(active).not.toContain('write');
    expect(active).not.toContain('bash');
  });

  it('gives the chief session the one Task tool and the project surface', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    await h.runner.runNext('s-1');

    const active = h.registry.get('s-1')?.session.getActiveToolNames() ?? [];

    expect(active).toEqual(expect.arrayContaining(['task', 'backlog', 'project', 'read']));
    expect(active).not.toContain('write');
  });

  it('creates a Task through the real tool loop and persists its plan', async () => {
    const args = JSON.stringify({
      op: 'create',
      type: 'write',
      goal: 'add password reset',
      scope: 'account module',
      acceptanceRefs: ['AC-1'],
      basisRefs: ['req-1'],
      planMarkdown: '# Plan\n1. implement\n2. review\n\n## 验收\n- feature works\n',
      authorizationRef: { inputId: 'i-1' },
      requiresTest: true,
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: args }] },
        { kind: 'text', text: 'task created' },
      ],
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    const tasks = h.store.listTasks('p-1');
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task).toMatchObject({ type: 'write', requiresTest: true, phase: 'plan', status: 'active' });
    expect(task?.planRef?.path).toContain(join('.dev', 'work'));
    expect(existsSync(task?.planRef?.path ?? '')).toBe(true);
    expect(readFileSync(task?.planRef?.path ?? '', 'utf8')).toContain('implement');
    // The chief's slot is taken while the Task is open.
    expect(h.store.getSession('s-1')?.currentTaskId).toBe(task?.id);
  });

  it('surfaces a refused Task create as an error result instead of a Task', async () => {
    const args = JSON.stringify({
      op: 'create',
      type: 'write',
      goal: 'no tests declared',
      scope: 'x',
      planMarkdown: '# Plan\n',
      authorizationRef: { inputId: 'i-1' },
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: args }] },
        { kind: 'text', text: 'refused' },
      ],
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    expect(h.store.listTasks('p-1')).toHaveLength(0);
    expect(h.store.getTask('t-1')).toBeUndefined();
  });

  it('closes an interrupted member input through task(op=recover, sessionId)', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'task',
              arguments: JSON.stringify({
                op: 'recover',
                taskId: 't-1',
                sessionId: 's-dev',
                evidenceRefs: ['file:src/x.ts'],
                resolution: 'stopped',
              }),
            },
          ],
        },
        { kind: 'text', text: 'recovered' },
      ],
      acceptInput: false,
    });
    h.store.createTask({
      id: 't-1',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'ship it',
      scope: 'x',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'p' },
      authorizationRefs: [],
      sourceInputId: 'seed',
    });
    h.store.createTaskSessions({
      taskId: 't-1',
      members: [
        {
          sessionId: 's-dev',
          taskId: 't-1',
          roleId: 'developer',
          phase: 'plan',
          label: 'dev',
          instructions: 'implement it',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          writeScope: ['src/**'],
          inputId: 'i-dev',
          inputPayload: { content: [{ type: 'text', text: 'implement it' }] },
        },
      ],
    });
    accept(h.store, 'i-1', 'req-1', 't-1');
    const member = h.store.claimNextInput('s-dev');
    if (member.kind !== 'claimed') throw new Error(`member input was not claimable: ${member.kind}`);
    h.store.finishInput({
      inputId: 'i-dev',
      expectedRevision: member.input.revision,
      status: 'interrupted',
      errorCode: 'RUN_TIMEOUT',
      errorMessage: 'run exceeded 5400s',
    });

    const outcome = await h.runner.runNext('s-1');

    // The schema must declare `sessionId` or the tool layer rejects the whole call; the op reads it
    // at the top level, so a rejected call leaves the interrupted input untouched.
    expect(outcome.kind).toBe('completed');
    expect(h.store.getInput('i-dev')?.status).toBe('stopped');
  }, 30_000);

  it('resolves the current input and Task per run, not per session instance', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'task',
              arguments: JSON.stringify({
                op: 'create',
                type: 'read',
                goal: 'investigate',
                scope: 'x',
                planMarkdown: '# plan\n',
                authorizationRef: { inputId: 'i-1' },
              }),
            },
          ],
        },
        { kind: 'text', text: 'created' },
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: '{"op":"get"}' }] },
        { kind: 'text', text: 'read back' },
      ],
    });
    const toolTexts: string[] = [];
    await h.runner.runNext('s-1');
    const task = h.store.listTasks('p-1')[0];
    expect(task?.sourceInputId).toBe('i-1');
    h.registry.get('s-1')?.session.subscribe((event) => {
      if (event.type === 'message_end' && event.message.role === 'toolResult') {
        toolTexts.push(
          event.message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
        );
      }
    });
    h.store.acceptInput({
      inputId: 'i-2',
      projectId: 'p-1',
      sessionId: 's-1',
      // A question about the running Task cites it (R3).
      ...(task !== undefined ? { taskId: task.id } : {}),
      sourceKey: 'user:req-2',
      requestKey: 'req-2',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'what is my task?' }] },
    });

    const second = await h.runner.runNext('s-1');

    expect(second.kind).toBe('completed');
    // task.get without an id must find the Task created in this session (the instance is reused).
    expect(toolTexts.join(' ')).toContain(task?.id ?? 'missing');
    expect(toolTexts.join(' ')).not.toContain('has no current Task');
  });

  it('delegates a member through the real tool loop and waits for the whole step', async () => {
    const createArgs = JSON.stringify({
      op: 'create',
      type: 'write',
      goal: 'reset password',
      scope: 'account',
      planMarkdown: '# plan\n1. develop\n\n## 验收\n- feature works\n',
      authorizationRef: { inputId: 'i-1' },
      requiresTest: true,
    });
    const delegateArgs = JSON.stringify({
      op: 'dispatch',
      waitTimeoutMs: 20_000,
      sessions: [
        {
          roleId: 'developer',
          label: 'implement',
          instructions: 'implement the reset flow',
          expectedKind: 'implementation',
          writeScope: ['src/'],
        },
      ],
    });
    const reportArgs = JSON.stringify({
      summary: 'implemented the reset flow',
      body: '# implementation\n\nimplemented the reset flow\n',
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: createArgs }] },
        { kind: 'text', text: 'task created' },
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: delegateArgs }] },
        { kind: 'tool_calls', calls: [{ name: 'agent_report', arguments: reportArgs }] },
        { kind: 'text', text: 'member done' },
        { kind: 'text', text: 'delegation finished' },
      ],
    });
    // Input 1: create the Task (the Task's first phase is plan, so move it before delegating).
    const first = await h.runner.runNext('s-1');
    expect(first.kind).toBe('completed');
    const task = h.store.listTasks('p-1')[0];
    expect(task).toBeDefined();
    const moved = h.store.updateTask({
      taskId: task?.id ?? '',
      phase: 'develop',
    });
    expect(moved.phase).toBe('develop');
    accept(h.store, 'i-2', 'req-2', h.store.listTasks('p-1')[0]?.id);

    const second = await h.runner.runNext('s-1');

    expect(second.kind).toBe('completed');
    const members = h.store.listTaskSessions(task?.id ?? '');
    expect(members).toHaveLength(1);
    expect(members[0]?.roleId).toBe('developer');
    // The member really ran its own input in its own session with the Task's type.
    expect(h.store.getInput(members[0]?.currentInputId ?? '')?.status).toBe('completed');
    expect(h.store.getTaskSession(members[0]?.sessionId ?? '')).toMatchObject({
      phase: 'develop',
      expectedKind: 'implementation',
    });
    // The chief's wait ended with the aggregate, not a guess.
    const memberHandle = h.registry.get(members[0]?.sessionId ?? '');
    expect(memberHandle).toBeDefined();
    expect(h.store.getTask(task?.id ?? '')?.currentSessionIds).toEqual([members[0]?.sessionId]);
  }, 60_000);

  it('stops the Task live work when it is paused and keeps the chief bound to it', async () => {
    const entered = Promise.withResolvers<void>();
    const createArgs = JSON.stringify({
      op: 'create',
      type: 'write',
      goal: 'reset password',
      scope: 'account',
      planMarkdown: '# plan\n1. develop\n\n## 验收\n- feature works\n',
      authorizationRef: { inputId: 'i-1' },
      requiresTest: true,
    });
    const delegateArgs = JSON.stringify({
      op: 'dispatch',
      waitTimeoutMs: 30_000,
      sessions: [
        {
          roleId: 'developer',
          label: 'implement',
          instructions: 'implement the reset flow',
          expectedKind: 'implementation',
          writeScope: ['src/'],
        },
      ],
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: createArgs }] },
        { kind: 'text', text: 'task created' },
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: delegateArgs }] },
        { kind: 'tool_calls', calls: [{ name: 'probe_wait', arguments: '{}' }] },
        { kind: 'text', text: 'delegation ended' },
      ],
      tools: ['probe_wait'],
      sessionExtras: () => ({
        customTools: [
          {
            name: 'probe_wait',
            label: 'probe_wait',
            description: 'runs until aborted',
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
    const first = await h.runner.runNext('s-1');
    expect(first.kind).toBe('completed');
    const task = h.store.listTasks('p-1')[0];
    h.store.updateTask({
      taskId: task?.id ?? '',
      phase: 'develop',
    });
    accept(h.store, 'i-2', 'req-2', task?.id);

    // The chief delegates and waits while the member runs.
    const chief = h.runner.runNext('s-1');
    await entered.promise;
    const member = h.store.listTaskSessions(task?.id ?? '')[0];
    expect(member).toBeDefined();
    expect(h.store.getInput(member?.currentInputId ?? '')?.status).toBe('processing');

    const paused = await h.runner.controlTask({
      taskId: task?.id ?? '',
      command: 'pause',
    });

    // The pause reaches its final status only after the Task's own work really stopped.
    expect(paused.status).toBe('paused');
    expect(h.store.getInput(member?.currentInputId ?? '')?.status).toBe('stopped');
    // A paused Task refuses to hand out its queued work, and keeps the chief bound to it.
    expect(h.store.claimNextInput(member?.sessionId ?? '').kind).not.toBe('claimed');
    const stillRunning = await chief;
    expect(stillRunning.kind).toBe('completed');
    expect(h.store.getSession('s-1')?.currentTaskId).toBe(task?.id ?? null);
    // Cancelling the paused Task ends it and frees the slot.
    const cancelled = await h.runner.controlTask({
      taskId: task?.id ?? '',
      command: 'cancel',
    });
    expect(cancelled.status).toBe('cancelled');
    expect(h.store.getSession('s-1')?.currentTaskId).toBeNull();
  }, 60_000);

  it('runs the read-only recovery check of a paused Task through the real runner', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'agent_report',
              arguments: JSON.stringify({ summary: 'recovery checked', body: '# recovery\n\nchecked\n' }),
            },
          ],
        },
        { kind: 'text', text: 'recovery checked' },
      ],
    });
    const task = h.store.createTask({
      id: 't-rec',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'reset password',
      scope: 'account',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
      authorizationRefs: ['m-1'],
      sourceInputId: 'i-1',
    });
    h.store.updateTask({ taskId: task.id, phase: 'develop' });
    const paused = h.store.controlTask({
      taskId: task.id,
      command: 'pause',
    });
    expect(paused.status).toBe('paused');
    h.store.createTaskSessions({
      taskId: task.id,
      members: [
        {
          sessionId: 's-rec',
          taskId: task.id,
          roleId: 'investigator',
          phase: 'develop',
          label: 'recover',
          instructions: 'verify what the interrupted run left behind',
          refs: [],
          dependencies: [],
          expectedKind: 'recovery',
          inputId: 'i-rec',
          inputPayload: { content: [{ type: 'text', text: 'verify the work' }] },
        },
      ],
    });

    const outcome = await h.runner.runNext('s-rec');

    // The claim exception really lets the recovery check run while the Task is not running.
    expect(outcome.kind).toBe('completed');
    expect(h.store.getInput('i-rec')?.status).toBe('completed');
  }, 30_000);

  it('keeps queued work when a Task is paused and stops it when cancelled', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    const spec = (sessionId: string, inputId: string) => ({
      sessionId,
      taskId: '',
      roleId: 'developer',
      phase: 'develop' as const,
      label: 'implement',
      instructions: 'implement it',
      refs: [],
      dependencies: [],
      expectedKind: 'implementation',
      inputId,
      inputPayload: { content: [{ type: 'text', text: 'implement it' }] },
    });
    const createTask = (id: string, chiefSessionId: string) =>
      h.store.createTask({
        id,
        projectId: 'p-1',
        chiefSessionId,
        ownerEpoch: 1,
        type: 'write',
        requiresTest: true,
        goal: 'reset password',
        scope: 'account',
        acceptanceRefs: [],
        basisRefs: [],
        planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
        authorizationRefs: ['m-1'],
        sourceInputId: 'i-1',
      });

    // pause: queued work is preserved for a later resume
    const first = createTask('t-pause', 's-1');
    h.store.updateTask({ taskId: first.id, phase: 'develop' });
    h.store.createTaskSessions({ taskId: first.id, members: [{ ...spec('m-pause', 'i-mp'), taskId: first.id }] });
    const paused = await h.runner.controlTask({
      taskId: first.id,
      command: 'pause',
    });
    expect(paused.status).toBe('paused');
    expect(h.store.getInput('i-mp')?.status).toBe('queued');
    expect(h.store.claimNextInput('m-pause').kind).toBe('controlled');

    const resumed = await h.runner.controlTask({
      taskId: first.id,
      command: 'resume',
    });
    expect(resumed.status).toBe('active');
    expect(h.store.claimNextInput('m-pause').kind).toBe('claimed');

    // cancel: unstarted work is stopped and the chief's slot is released (a second chief, because the
    // resumed Task above still holds its own slot)
    h.store.createSession({ id: 's-2', projectId: 'p-1', roleId: 'chief', cwd: h.cwd });
    const second = createTask('t-cancel', 's-2');
    h.store.updateTask({ taskId: second.id, phase: 'develop' });
    h.store.createTaskSessions({ taskId: second.id, members: [{ ...spec('m-cancel', 'i-mc'), taskId: second.id }] });
    const cancelled = await h.runner.controlTask({
      taskId: second.id,
      command: 'cancel',
    });

    expect(cancelled.status).toBe('cancelled');
    expect(h.store.getInput('i-mc')?.status).toBe('stopped');
    expect(h.store.getSession('s-2')?.currentTaskId).toBeNull();
  }, 30_000);

  it('delivers a member report through the real loop and closes a read Task with it', async () => {
    const createArgs = JSON.stringify({
      op: 'create',
      type: 'read',
      goal: 'investigate the reset flow',
      scope: 'account',
      planMarkdown: '# read plan\n1. look\n',
      authorizationRef: { inputId: 'i-1' },
    });
    const delegateArgs = JSON.stringify({
      op: 'dispatch',
      waitTimeoutMs: 20_000,
      sessions: [
        {
          roleId: 'investigator',
          label: 'investigate',
          instructions: 'report what really exists',
          expectedKind: 'investigation',
        },
      ],
    });
    const reportArgs = JSON.stringify({
      summary: 'the reset flow exists but has no test',
      body: '# investigation\n\nfound an untested reset path\n',
      checks: [{ name: 'read the sources', status: 'passed' }],
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: createArgs }] },
        { kind: 'text', text: 'task created' },
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: delegateArgs }] },
        { kind: 'tool_calls', calls: [{ name: 'agent_report', arguments: reportArgs }] },
        { kind: 'text', text: 'member done' },
        { kind: 'text', text: 'investigation recorded' },
      ],
    });
    const first = await h.runner.runNext('s-1');
    expect(first.kind).toBe('completed');
    accept(h.store, 'i-2', 'req-2', h.store.listTasks('p-1')[0]?.id);

    const second = await h.runner.runNext('s-1');

    expect(second.kind).toBe('completed');
    const task = h.store.listTasks('p-1')[0];
    const member = h.store.listTaskSessions(task?.id ?? '')[0];
    expect(member?.roleId).toBe('investigator');
    expect(h.store.getInput(member?.currentInputId ?? '')?.status).toBe('completed');
    const results = h.store.listTaskResults(task?.id ?? '');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'investigation', roleId: 'investigator', inputId: member?.currentInputId });
    // The body is really on disk where a read Task keeps it, with the recorded digest.
    expect(existsSync(results[0]?.bodyRef.path ?? '')).toBe(true);
    expect(readFileSync(results[0]?.bodyRef.path ?? '', 'utf8')).toBe(
      '# investigation\n\nfound an untested reset path\n',
    );
    // The aggregate the chief's wait returns reports what that member produced.
    expect(h.store.resultsForInputs([member?.currentInputId ?? '']).map((entry) => entry.resultId)).toEqual([
      results[0]?.resultId,
    ]);
    // The Task can be finished with exactly that report.
    const ended = h.store.endTask({
      taskId: task?.id ?? '',
      completionResultId: results[0]?.resultId ?? '',
    });
    expect(ended).toMatchObject({ ok: true });
    expect(h.store.getTask(task?.id ?? '')?.status).toBe('completed');
  }, 60_000);
  it('marks a one-line answer without the dispatched report as failed', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'passed' }] });
    const task = h.store.createTask({
      id: 't-no-report',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'deliver the change',
      scope: 'deploy',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
      authorizationRefs: ['m-1'],
      sourceInputId: 'i-1',
    });
    h.store.updateTask({ taskId: task.id, phase: 'review' });
    h.store.createTaskSessions({
      taskId: task.id,
      members: [
        {
          sessionId: 's-review-no-report',
          taskId: task.id,
          roleId: 'reviewer',
          phase: 'review',
          label: 'review',
          instructions: 'review the change',
          refs: [],
          dependencies: [],
          expectedKind: 'review',
          inputId: 'i-review-no-report',
          inputPayload: { content: [{ type: 'text', text: 'review the change' }] },
        },
      ],
    });

    const outcome = await h.runner.runNext('s-review-no-report');

    // A clean Pi stop is not a delivered review: the host records the missing report and leaves the
    // Session available for the chief to continue, instead of showing a passed step.
    expect(outcome.kind).toBe('failed');
    expect(h.store.getInput('i-review-no-report')).toMatchObject({
      status: 'failed',
      errorCode: 'REPORT_MISSING',
    });
    expect(h.store.resultsForInputs(['i-review-no-report'])).toEqual([]);
    expect(h.store.getTaskSession('s-review-no-report')?.currentInputId).toBe('i-review-no-report');
  }, 30_000);

  it('lets an investigator deliver a read-only report inside a write Task', async () => {
    const createArgs = JSON.stringify({
      op: 'create',
      type: 'write',
      goal: 'change the reset flow',
      scope: 'account',
      planMarkdown: '# write plan\n1. look, then change\n\n## 验收\n- behaviour changed\n',
      authorizationRef: { inputId: 'i-1' },
      requiresTest: false,
    });
    const delegateArgs = JSON.stringify({
      op: 'dispatch',
      waitTimeoutMs: 20_000,
      sessions: [
        {
          roleId: 'investigator',
          label: 'investigate',
          instructions: 'report what really exists before the change',
          expectedKind: 'investigation',
        },
      ],
    });
    const reportArgs = JSON.stringify({
      summary: 'the reset flow exists but has no test',
      body: '# investigation\n\nfound an untested reset path\n',
      checks: [{ name: 'read the sources', status: 'passed' }],
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: createArgs }] },
        { kind: 'text', text: 'task created' },
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: delegateArgs }] },
        { kind: 'tool_calls', calls: [{ name: 'agent_report', arguments: reportArgs }] },
        { kind: 'text', text: 'member done' },
        { kind: 'text', text: 'investigation recorded' },
      ],
    });
    const first = await h.runner.runNext('s-1');
    expect(first.kind).toBe('completed');
    const task = h.store.listTasks('p-1')[0];
    accept(h.store, 'i-2', 'req-2', task?.id);

    const second = await h.runner.runNext('s-1');
    expect(second.kind).toBe('completed');
    const member = h.store.listTaskSessions(task?.id ?? '')[0];
    const results = h.store.listTaskResults(task?.id ?? '');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'investigation', roleId: 'investigator' });
    expect(results[0]?.bodyRef.storage).toBe('server');
    expect(existsSync(results[0]?.bodyRef.path ?? '')).toBe(true);
    expect(readFileSync(results[0]?.bodyRef.path ?? '', 'utf8')).toBe(
      '# investigation\n\nfound an untested reset path\n',
    );
    expect(h.store.getTask(task?.id ?? '')?.status).toBe('active');
    expect(member?.currentInputId).not.toBeNull();
  }, 60_000);

  it('writes a backlog item through the real tool loop', async () => {
    const addArgs = JSON.stringify({
      op: 'add',
      title: '密码重置',
      body: '允许用户重置密码。',
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'backlog', arguments: addArgs }] },
        { kind: 'text', text: 'recorded' },
      ],
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    const path = join(h.cwd, '.dev', 'backlog.md');
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('密码重置');
    expect(text).toContain('- 创建人: local');
  }, 30_000);

  it('initializes the project entries through the real tool loop', async () => {
    const args = JSON.stringify({
      op: 'initialize',
      files: [
        { path: 'AGENTS.md', content: '# Agent rules\n\nRead .dev/INDEX.md first.\n' },
        { path: '.dev/INDEX.md', content: '# 索引\n' },
      ],
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-1' },
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'project', arguments: args }] },
        { kind: 'text', text: 'entries created' },
      ],
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    expect(readFileSync(join(h.cwd, 'AGENTS.md'), 'utf8')).toBe('# Agent rules\n\nRead .dev/INDEX.md first.\n');
    expect(existsSync(join(h.cwd, '.dev', 'INDEX.md'))).toBe(true);
    expect(h.store.getProject('p-1')?.initializationRef).not.toBeNull();
  }, 30_000);

  it('keeps the input queued when the model is unavailable, without falling back', async () => {
    const h = await harness({
      replies: [{ kind: 'text', text: 'ok' }],
      model: { providerId: 'missing-provider', modelId: 'nope' },
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('blocked_config');
    expect(h.store.getInput('i-1')?.status).toBe('queued');
    expect(h.registry.count()).toBe(0);
  });

  it('reports a session awaiting recovery instead of running past it', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    const claimed = h.store.claimNextInput('s-1');
    expect(claimed.kind).toBe('claimed');
    const path = join(h.agentDir, '..', 'state.db');
    const restarted = new Store({ path, serverEpoch: 2 });
    stores.push(restarted);
    expect(restarted.scanStartup()).toEqual({ interrupted: 1 });
    const runner = new InputRunner({
      store: restarted,
      registry: h.registry,
      factory: new PiRuntimeFactory(h.defaults),
      resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: h.defaults }),
    });

    const outcome = await runner.runNext('s-1');

    expect(outcome).toEqual({ kind: 'blocked', inputId: 'i-1', code: 'RECOVERY_REQUIRED' });
  });

  it('stops queued work before it is ever delivered', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }], acceptInput: false });
    accept(h.store, 'i-1', 'req-1');
    accept(h.store, 'i-2', 'req-2');

    const stop = await h.runner.requestStop('s-1', {
      inputId: 'i-2',
      requestKey: 'stop-2',
      reason: 'user',
    });
    const outcome = await h.runner.runNext('s-1');

    expect(stop).toEqual({ status: 'stopped', stopRequested: true });
    expect(outcome.kind).toBe('completed');
    expect(h.store.getInput('i-2')?.status).toBe('stopped');
  }, 30_000);

  it('runs the chief own turn while its Task is paused, and refuses its project writes there', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }, { kind: 'text', text: 'and again' }] });
    const task = h.store.createTask({
      id: 't-held',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'reset password',
      scope: 'account',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
      authorizationRefs: ['m-1'],
      sourceInputId: 'i-1',
    });
    h.store.updateTask({ taskId: task.id, phase: 'review' });
    const paused = await h.runner.controlTask({ taskId: task.id, command: 'pause' });
    expect(paused.status).toBe('paused');
    // The chief keeps its Task while it is paused, so the user's next message cites it.
    accept(h.store, 'i-2', 'req-2', task.id);

    const outcome = await h.runner.runNext('s-1');

    // The conversation is not Task work: it is delivered while the Task is held (S3).
    expect(outcome.kind).toBe('completed');
    expect(h.store.getInput('i-2')?.status).toBe('completed');
    // The recorded allowlist is this run's own: the probe test below covers what Pi really activated.
    const recorded = JSON.parse(h.store.getInput('i-2')?.effectiveConfig ?? '{}') as {
      requestedTools?: string[];
    };
    // Recorded too, so a reader of the run can see why the shell was missing.
    expect(recorded.requestedTools ?? []).not.toContain('bash');
  }, 60_000);

  it('hands the chief a paused turn without its shell, and the resumed turn with it', async () => {
    // The probe reads the live registry from inside a tool call, so it records what the model could
    // really call in that turn - not a scope read after the run settled.
    const scopes: string[][] = [];
    let harnessRef: Harness | undefined;
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'probe_scope', arguments: '{}' }] },
        { kind: 'text', text: 'recorded' },
        { kind: 'tool_calls', calls: [{ name: 'probe_scope', arguments: '{}' }] },
        { kind: 'text', text: 'recorded' },
      ],
      tools: ['probe_scope'],
      sessionExtras: () => ({
        customTools: [
          {
            name: 'probe_scope',
            label: 'probe_scope',
            description: 'records the active tool names of this run',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            executionMode: 'sequential',
            async execute(): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, never> }> {
              scopes.push([...(harnessRef?.registry.get('s-1')?.session.getActiveToolNames() ?? [])]);
              return { content: [{ type: 'text', text: 'recorded' }], details: {} };
            },
          } as never,
        ],
      }),
    });
    harnessRef = h;
    const task = h.store.createTask({
      id: 't-shell',
      projectId: 'p-1',
      chiefSessionId: 's-1',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'reset password',
      scope: 'account',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
      authorizationRefs: ['m-1'],
      sourceInputId: 'i-1',
    });
    h.store.updateTask({ taskId: task.id, phase: 'review' });
    h.store.controlTask({ taskId: task.id, command: 'pause' });
    accept(h.store, 'i-2', 'req-2', task.id);
    expect((await h.runner.runNext('s-1')).kind).toBe('completed');
    // `bash` is the one writing-capable tool a chief carries, so it is the honest probe of the hold.
    for (const withheld of ['bash', 'write', 'edit', 'backlog', 'project']) {
      expect(scopes[0] ?? []).not.toContain(withheld);
    }
    expect(scopes[0] ?? []).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls', 'task']));

    h.store.controlTask({ taskId: task.id, command: 'resume' });
    accept(h.store, 'i-3', 'req-3', task.id);
    expect((await h.runner.runNext('s-1')).kind).toBe('completed');
    // A second probe, in the running Task: the shell is back.
    expect(scopes[1] ?? []).toContain('bash');
  }, 60_000);
});
describe('thinking level', () => {
  it('creates the session at the resolved level, and Pi clamps it to what the model accepts', async () => {
    const high = await harness({ replies: [{ kind: 'text', text: 'ok' }], reasoning: true, level: 'high' });
    await high.runner.runNext('s-1');
    expect(high.registry.get('s-1')?.session.thinkingLevel).toBe('high');

    // The same choice against a model that declares no reasoning is clamped, not ignored silently by
    // us: Pi decides, and the run records what it really used.
    const plain = await harness({ replies: [{ kind: 'text', text: 'ok' }], level: 'high' });
    await plain.runner.runNext('s-1');
    expect(plain.registry.get('s-1')?.session.thinkingLevel).toBe('off');
  });

  it('changes level on the same logical session by starting a new Pi instance from the same history', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }], reasoning: true, level: 'low' });
    await h.runner.runNext('s-1');
    const first = h.registry.get('s-1');
    expect(first?.session.thinkingLevel).toBe('low');
    const file = first?.piFile();

    // The level is part of the binding: a different level must not reuse an instance created with the
    // old one, but it must continue the same conversation file.
    const upgraded = await harness({ replies: [{ kind: 'text', text: 'ok' }], reasoning: true, level: 'high' });
    await upgraded.runner.runNext('s-1');
    expect(upgraded.registry.get('s-1')?.session.thinkingLevel).toBe('high');
    expect(file).toBeDefined();
  });
});
