import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { assembleSystemPrompt, loadPromptBodies } from '../src/runtime/prompt-assembly.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner, boundaryPersistedOnDisk } from '../src/runtime/runner.ts';
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
  taskType?: 'read' | 'write';
  /** Mutable task type for tests that change it between inputs. */
  taskTypeOf?: () => 'read' | 'write' | undefined;
  sessionExtras?: ConstructorParameters<typeof InputRunner>[0]['sessionExtras'];
  acceptInput?: boolean;
}): Promise<Harness> {
  const server = await startStubModelServer(options.replies);
  servers.push(server);
  const env = await createStubEnv(
    server.baseUrl,
    options.modelIds !== undefined ? { modelIds: options.modelIds } : {},
  );
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
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: defaults }),
    taskTypeOf: options.taskTypeOf ?? (() => options.taskType),
    ...(options.sessionExtras !== undefined ? { sessionExtras: options.sessionExtras } : {}),
  });
  return { store, runner, registry, defaults, agentDir: env.agentDir, cwd: env.cwd };
}

function accept(store: Store, inputId: string, requestKey: string): void {
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId: 's-1',
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
    const dir = mkdtempSync(join(tmpdir(), 'devagent-boundary-'));
    dirs.push(dir);
    const file = join(dir, 'session.jsonl');
    const marker = {
      type: 'custom',
      id: 'm1',
      parentId: null,
      customType: 'agentdev.input-marker',
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
    // The chief session never carries project-writing tools, even in a write Task.
    expect(requested).not.toContain('write');
    expect(requested).not.toContain('edit');
    // Only registered names really activate; the record shows both.
    expect(active.every((name) => requested.includes(name))).toBe(true);
    expect(active).toContain('read');
    expect(shape.taskType).toBe('write');
  });

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
      sessionExtras: () => ({ customTools: [tool('requirement') as never, tool('probe_ok') as never] }),
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    const active = h.registry.get('s-1')?.session.getActiveToolNames() ?? [];
    expect(active).toContain('probe_ok');
    expect(active).not.toContain('requirement');
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
        customTools: [tool('createTask') as never, tool('probe_ok') as never],
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
    expect(active).not.toContain('createTask');
    expect(active).not.toContain('write');
    expect(active).not.toContain('bash');
  });

  it('gives the chief session the four core Task tools', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }] });
    await h.runner.runNext('s-1');

    const active = h.registry.get('s-1')?.session.getActiveToolNames() ?? [];

    expect(active).toEqual(
      expect.arrayContaining(['createTask', 'updateTask', 'endTask', 'task', 'read']),
    );
    expect(active).not.toContain('write');
  });

  it('creates a Task through the real tool loop and persists its plan', async () => {
    const args = JSON.stringify({
      type: 'write',
      goal: 'add password reset',
      scope: 'account module',
      acceptanceRefs: ['AC-1'],
      basisRefs: ['req-1'],
      planMarkdown: '# Plan\n1. implement\n2. review\n',
      authorizationRef: 'm-001',
      requiresTest: true,
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'createTask', arguments: args }] },
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

  it('surfaces a refused createTask as an error result instead of a Task', async () => {
    const args = JSON.stringify({
      type: 'write',
      goal: 'no tests declared',
      scope: 'x',
      planMarkdown: '# Plan\n',
      authorizationRef: 'm-001',
    });
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'createTask', arguments: args }] },
        { kind: 'text', text: 'refused' },
      ],
    });

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    expect(h.store.listTasks('p-1')).toHaveLength(0);
    expect(h.store.getTask('t-1')).toBeUndefined();
  });

  it('resolves the current input and Task per run, not per session instance', async () => {
    const h = await harness({
      replies: [
        {
          kind: 'tool_calls',
          calls: [
            {
              name: 'createTask',
              arguments: JSON.stringify({
                type: 'read',
                goal: 'investigate',
                scope: 'x',
                planMarkdown: '# plan\n',
                authorizationRef: 'm-001',
              }),
            },
          ],
        },
        { kind: 'text', text: 'created' },
        { kind: 'tool_calls', calls: [{ name: 'task', arguments: '{}' }] },
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
});