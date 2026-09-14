import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import {
  EXTENSION_API_VERSION,
  PiSessionFactory,
  type BuiltinExtensionSpec,
  type PiSessionEvent,
  type PiSessionHandle,
  type PiSessionListener,
  type PiToolSpec,
} from '@agentdev/pi-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttemptRunner, type AttemptRunnerDeps } from '../src/attempt.js';
import { messageSchema, type RunnerMessage } from '../src/ipc.js';

/**
 * Runner contract tests.
 *
 * A real Pi session is created (offline catalog, no provider call); the Core
 * side is a recording sink instead of a pipe, so the assertions are about the
 * messages the Runner owes the daemon.
 */
let root: string;
let provider: string;
let modelId: string;
let lines: string[];
let exitCode: number | undefined;

const probeTool: PiToolSpec = {
  name: 'agentdev_probe',
  label: 'Probe',
  description: 'stub tool',
  parameters: Type.Object({ value: Type.String() }),
  execute: () => Promise.resolve({ text: 'ok' }),
};

function messages(): RunnerMessage[] {
  return lines.map((line) => messageSchema.parse(JSON.parse(line)));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agentdev-runner-'));
  lines = [];
  exitCode = undefined;
  const factory = await PiSessionFactory.create({ cwd: root, agentDir: join(root, 'agent') });
  const first = factory.listModels()[0];
  if (first === undefined) throw new Error('the offline catalog is empty');
  provider = first.provider;
  modelId = first.id;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function build(
  overrides: Partial<ConstructorParameters<typeof AttemptRunner>[0]> = {},
  deps: Partial<AttemptRunnerDeps> = {},
) {
  return new AttemptRunner(
    {
      attemptId: 'attempt-1',
      epoch: 7,
      cwd: root,
      agentDir: join(root, 'agent'),
      provider,
      modelId,
      toolNames: ['agentdev_probe'],
      customTools: [probeTool],
      trusted: true,
      ...overrides,
    },
    {
      output: { write: (line) => lines.push(line) },
      exit: (code) => (exitCode = code),
      ...deps,
    },
  );
}

/** A scripted session, so event flow and gating are testable without a model. */
function fakeSession(activeTools: string[] = ['agentdev_probe']) {
  const listeners: PiSessionListener[] = [];
  let isDisposed = false;
  const handle: PiSessionHandle = {
    sessionId: 'fake-session',
    provider,
    modelId,
    sessionFile: () => undefined,
    activeToolNames: () => [...activeTools],
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    // A scripted session is idle as soon as the prompt is accepted; the real session's
    // `prompt()` also resolves early, which is why the Runner waits for `isIdle()`
    // (WP-11 A2-T6).
    prompt: () => Promise.resolve(),
    isIdle: () => true,
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    compact: () => Promise.resolve(),
    disposed: () => isDisposed,
    dispose: () => {
      isDisposed = true;
    },
  };
  return {
    handle,
    emit: (event: PiSessionEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.length,
  };
}

describe('AttemptRunner', () => {
  it('reports ready with the enforced tool set', async () => {
    const runner = build();
    await expect(runner.start()).resolves.toBe(0);
    const ready = messages().find((message) => message.type === 'attempt.ready');
    expect(ready).toBeDefined();
    if (ready?.type === 'attempt.ready') {
      expect(ready.attemptId).toBe('attempt-1');
      expect(ready.epoch).toBe(7);
      expect(ready.tools).toEqual(['agentdev_probe']);
      expect(ready.modelId).toBe(modelId);
    }
    runner.dispose();
  });

  it('drops a command from another epoch', async () => {
    const runner = build();
    await runner.start();
    const keep = await runner.handle({
      v: 1,
      type: 'attempt.abort',
      attemptId: 'attempt-1',
      epoch: 8,
    });
    expect(keep).toBe(true);
    expect(messages().some((message) => message.type === 'attempt.result')).toBe(false);
    runner.dispose();
  });

  it('drops a malformed or unknown line', async () => {
    const runner = build();
    await runner.start();
    await expect(runner.handleLine('not json')).resolves.toBe(true);
    await expect(runner.handleLine('{"type":"mystery"}')).resolves.toBe(true);
    expect(messages().some((message) => message.type === 'attempt.error')).toBe(false);
    runner.dispose();
  });

  it('reports a cancelled result on abort and releases the session', async () => {
    const runner = build();
    await runner.start();
    const keep = await runner.handle({
      v: 1,
      type: 'attempt.abort',
      attemptId: 'attempt-1',
      epoch: 7,
    });
    expect(keep).toBe(false);
    const result = messages().find((message) => message.type === 'attempt.result');
    expect(result?.type === 'attempt.result' ? result.status : undefined).toBe('cancelled');
    expect(exitCode).toBe(1);
  });

  it('fails before starting when the model is not configured in the catalog', async () => {
    const runner = build({ modelId: 'missing-model' });
    await expect(runner.start()).resolves.toBe(1);
    const error = messages().find((message) => message.type === 'attempt.error');
    expect(error?.type === 'attempt.error' ? error.code : undefined).toBe('MODEL_UNAVAILABLE');
    expect(exitCode).toBeUndefined();
  });

  it('serialises every emitted event with a monotonic sequence number', async () => {
    const fake = fakeSession();
    const runner = build({}, { buildSession: () => Promise.resolve(fake.handle) });
    await runner.start();
    fake.emit({ type: 'turn_start' });
    fake.emit({ type: 'text_delta', delta: 'hi' });
    fake.emit({ type: 'turn_end' });

    const events = messages().filter((message) => message.type === 'attempt.event');
    expect(events.map((event) => (event.type === 'attempt.event' ? event.seq : -1))).toEqual([
      0, 1, 2,
    ]);
    expect(events[1]).toMatchObject({ event: { type: 'text_delta', delta: 'hi' } });
    runner.dispose();
  });

  it('subscribes once and releases the subscription on dispose', async () => {
    const fake = fakeSession();
    const runner = build({}, { buildSession: () => Promise.resolve(fake.handle) });
    await runner.start();
    expect(fake.listenerCount()).toBe(1);
    runner.dispose();
    expect(fake.listenerCount()).toBe(0);
    expect(fake.handle.disposed()).toBe(true);
  });

  it('blocks the attempt when a critical extension fails, before any session exists', async () => {
    const fake = fakeSession();
    const critical: BuiltinExtensionSpec = {
      id: 'core-policy',
      version: '1.0.0',
      apiVersion: EXTENSION_API_VERSION,
      capabilities: ['policy'],
      critical: true,
      enabledByDefault: true,
    };
    let sessionBuilt = false;
    const runner = build(
      {
        extensionManifest: [critical],
        activateExtension: () => {
          throw new Error('policy backend unavailable');
        },
      },
      {
        buildSession: () => {
          sessionBuilt = true;
          return Promise.resolve(fake.handle);
        },
      },
    );

    await expect(runner.start()).resolves.toBe(1);
    expect(sessionBuilt).toBe(false);
    const error = messages().find((message) => message.type === 'attempt.error');
    expect(error?.type === 'attempt.error' ? error.code : undefined).toBe(
      'CRITICAL_EXTENSION_FAILED',
    );
    expect(error?.type === 'attempt.error' ? error.message : '').toContain('core-policy');
  });

  it('rejects an extension id the release does not ship', async () => {
    const fake = fakeSession();
    let sessionBuilt = false;
    const runner = build(
      { extensionRequests: [{ id: 'not-shipped', enabled: true }] },
      {
        buildSession: () => {
          sessionBuilt = true;
          return Promise.resolve(fake.handle);
        },
      },
    );

    await expect(runner.start()).resolves.toBe(1);
    expect(sessionBuilt).toBe(false);
    const error = messages().find((message) => message.type === 'attempt.error');
    expect(error?.type === 'attempt.error' ? error.code : undefined).toBe('UNKNOWN_EXTENSION');
  });

  it('reports requested tools the session did not activate', async () => {
    const fake = fakeSession(['read']);
    const runner = build(
      { toolNames: ['agentdev_probe', 'read'] },
      { buildSession: () => Promise.resolve(fake.handle) },
    );
    await runner.start();

    const ready = messages().find((message) => message.type === 'attempt.ready');
    expect(ready?.type === 'attempt.ready' ? ready.tools : []).toEqual(['read']);
    expect(ready?.type === 'attempt.ready' ? ready.droppedTools : []).toEqual(['agentdev_probe']);
    runner.dispose();
  });
});
