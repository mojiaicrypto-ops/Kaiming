import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner, boundaryPersistedOnDisk } from '../src/runtime/runner.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

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
    tools: options.tools ?? [],
  };
  const factory = new PiRuntimeFactory(defaults);
  const registry = new SessionRegistry(factory);
  const runner = new InputRunner({
    store,
    registry,
    factory,
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: defaults }),
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
    const defaults: RuntimeDefaults = { model: selection, agentDir: env.agentDir, tools: [] };
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