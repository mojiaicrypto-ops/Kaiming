/**
 * T3 轮 3 改动人：T3（父代理 session-2bf56aa1）——`controlTools` 现在按 `execution.md` §7
 * 注册完整角色工具集（专业角色 +`request_dispatch`，Chief +`decision_request`，全角色
 * +`context_request`），因此本文件两处「控制工具集合」断言随之更新；行为本身未改。
 */
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
      capability: 'cap-1',
      controlUrl: 'http://127.0.0.1:1',
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
  it('activates the role control tools in a real Pi session (chief)', async () => {
    // Real Pi SDK session (offline catalog, no provider call). Pi 0.85.1 treats `tools` as
    // the allowlist *and* the initial active set and filters `customTools` through it, so a
    // runner that passed only the frozen `toolSubset` would silently drop these.
    const runner = build({ role: 'chief', toolNames: [] });
    await expect(runner.start()).resolves.toBe(0);
    const ready = messages().find((message) => message.type === 'attempt.ready');
    if (ready?.type !== 'attempt.ready') throw new Error('no ready message');
    expect(ready.tools).toContain('assessment_submit');
    expect(ready.tools).toContain('agent_dispatch');
    expect(ready.tools).not.toContain('stage_yield');
    // Nothing the role owes Core was dropped.
    expect(ready.droppedTools).toEqual([]);
    // The environment is this process's own observation, not a placeholder: the drill runs
    // the real Runner on the host, so the value names the real host/arch/Node major.
    expect(ready.environmentRef).toMatch(
      new RegExp(
        `^host:${process.platform}/${process.arch}/node-${String(process.versions.node.split('.')[0])}$`,
      ),
    );
    runner.dispose();
  });

  it('activates only stage_yield for a professional role', async () => {
    const runner = build({ role: 'backend', toolNames: [] });
    await expect(runner.start()).resolves.toBe(0);
    const ready = messages().find((message) => message.type === 'attempt.ready');
    if (ready?.type !== 'attempt.ready') throw new Error('no ready message');
    expect(ready.tools).toContain('stage_yield');
    expect(ready.tools).not.toContain('assessment_submit');
    expect(ready.tools).not.toContain('agent_dispatch');
    expect(ready.droppedTools).toEqual([]);
    runner.dispose();
  });

  it('reports ready with the enforced tool set', async () => {
    const runner = build();
    await expect(runner.start()).resolves.toBe(0);
    const ready = messages().find((message) => message.type === 'attempt.ready');
    expect(ready).toBeDefined();
    if (ready?.type === 'attempt.ready') {
      expect(ready.attemptId).toBe('attempt-1');
      expect(ready.epoch).toBe(7);
      // The session's allowlist is the profile subset plus the role's documented control
      // tools (default role = backend → `stage_yield`, `request_dispatch`,
      // `context_request`; `execution.md` §7 / T3 轮 3).
      expect(ready.tools).toEqual([
        'agentdev_probe',
        'stage_yield',
        'request_dispatch',
        'context_request',
      ]);
      expect(ready.droppedTools).toEqual([]);
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

  it('keeps the process alive when a turn delivered nothing, so the correction can land (protocol.md §6)', async () => {
    // The real regression (WP-12 R7): `drill.message-to-stage` reported a non-delivering turn
    // and `process.exit(0)` ~18ms later, so the supervisor's `attempt.steer` was written to a
    // dead pipe and the Run ended without a stage result. A non-delivering turn must report the
    // result and *wait* for the one correction.
    let sawPrompt = '';
    const fake = fakeSession();
    const session: PiSessionHandle = {
      ...fake.handle,
      prompt: (text) => {
        sawPrompt = text;
        return Promise.resolve();
      },
    };
    const runner = build(
      { role: 'backend', submissionGraceMs: 20 },
      { buildSession: () => Promise.resolve(session) },
    );
    await runner.start();
    const keep = await runner.handle({
      v: 1,
      type: 'attempt.prompt',
      attemptId: 'attempt-1',
      epoch: 7,
      text: 'go',
    });
    expect(sawPrompt).toBe('go');
    // Reported, but alive: Core still owes this Attempt the corrective prompt.
    expect(keep).toBe(true);
    expect(exitCode).toBeUndefined();
    const result = messages().find((message) => message.type === 'attempt.result');
    expect(result?.type === 'attempt.result' ? result.status : undefined).toBe('completed');
    runner.dispose();
  });

  it('runs the correction as a real turn on an idle session instead of queueing it forever', async () => {
    // `pi-agent-core` `Agent.steer()` only enqueues; its queue is drained inside the prompt
    // loop. After the previous turn ended the loop is gone, so a plain `steer()` would leave
    // the correction unread — an idle session therefore gets a real `prompt()` turn (R7).
    const calls: string[] = [];
    const fake = fakeSession();
    const session: PiSessionHandle = {
      ...fake.handle,
      prompt: (text) => {
        calls.push(`prompt:${text}`);
        return Promise.resolve();
      },
      steer: (text) => {
        calls.push(`steer:${text}`);
        return Promise.resolve();
      },
    };
    const runner = build(
      { role: 'backend', submissionGraceMs: 20 },
      { buildSession: () => Promise.resolve(session) },
    );
    await runner.start();
    await runner.handle({
      v: 1,
      type: 'attempt.prompt',
      attemptId: 'attempt-1',
      epoch: 7,
      text: 'go',
    });
    const keep = await runner.handle({
      v: 1,
      type: 'attempt.steer',
      attemptId: 'attempt-1',
      epoch: 7,
      text: 'Contract: call stage_yield.',
    });
    expect(calls).toContain('prompt:Contract: call stage_yield.');
    expect(calls.some((call) => call.startsWith('steer:'))).toBe(false);
    // Still nothing delivered, so the Attempt stays alive for Core's verdict.
    expect(keep).toBe(true);
    expect(exitCode).toBeUndefined();
    runner.dispose();
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

  it('reports requested tools the session did not activate, including a control tool', async () => {
    // The scripted session activates only `read`, so both the profile's probe and the role's
    // control tool count as dropped and the Attempt will be refused by the supervisor.
    const fake = fakeSession(['read']);
    const runner = build(
      { toolNames: ['agentdev_probe', 'read'], role: 'chief' },
      { buildSession: () => Promise.resolve(fake.handle) },
    );
    await runner.start();

    const ready = messages().find((message) => message.type === 'attempt.ready');
    expect(ready?.type === 'attempt.ready' ? ready.tools : []).toEqual(['read']);
    expect(ready?.type === 'attempt.ready' ? ready.droppedTools : []).toEqual([
      'agentdev_probe',
      'assessment_submit',
      'agent_dispatch',
      'decision_request',
      'context_request',
    ]);
    runner.dispose();
  });
});
