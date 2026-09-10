import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PiRuntimeError,
  PiSessionFactory,
  createExplicitResources,
  type PiSessionHandle,
  type PiSessionEvent,
  type PiToolSpec,
} from '../src/index.js';

/**
 * SDK contract tests (AC-066).
 *
 * No provider or network is involved: the catalog is the statically bundled one
 * and the tool below is a local stub. WP-00 verifies lifecycle, tool gating and
 * resource control; the live-model paths of AC-066 are re-run at WP-10.
 */
let root: string;
let factory: PiSessionFactory;
let provider: string;
let modelId: string;
const open: PiSessionHandle[] = [];

const probeTool: PiToolSpec = {
  name: 'agentdev_probe',
  label: 'Probe',
  description: 'returns a fixed value',
  parameters: Type.Object({ value: Type.String() }),
  execute: (params) =>
    Promise.resolve({ text: `probe:${typeof params.value === 'string' ? params.value : ''}` }),
};

function explicitLoader() {
  return createExplicitResources({
    cwd: root,
    agentDir: join(root, 'agent'),
    trusted: true,
    systemPrompt: 'agentdev runner',
  }).loader;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agentdev-pi-'));
  factory = await PiSessionFactory.create({ cwd: root, agentDir: join(root, 'agent') });
  const first = factory.listModels()[0];
  if (first === undefined) throw new Error('the offline catalog is empty');
  provider = first.provider;
  modelId = first.id;
});

afterEach(async () => {
  for (const handle of open.splice(0)) {
    if (!handle.disposed()) handle.dispose();
  }
  await rm(root, { recursive: true, force: true });
});

async function createSession(
  extra: Partial<Parameters<PiSessionFactory['createSession']>[0]> = {},
) {
  const handle = await factory.createSession({
    provider,
    modelId,
    resourceLoader: explicitLoader(),
    toolNames: ['agentdev_probe'],
    customTools: [probeTool],
    ...extra,
  });
  open.push(handle);
  return handle;
}

describe('Pi session lifecycle', () => {
  it('creates a session with the configured model and no network', async () => {
    const session = await createSession();
    expect(session.provider).toBe(provider);
    expect(session.modelId).toBe(modelId);
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes exactly the allowlisted tools', async () => {
    const session = await createSession();
    expect(session.activeToolNames()).toContain('agentdev_probe');
    // Built-in coding tools are not enabled because the role registry did not select them.
    for (const builtin of ['bash', 'edit', 'write']) {
      expect(session.activeToolNames()).not.toContain(builtin);
    }
  });

  it('omits a custom tool that the allowlist does not name', async () => {
    const session = await createSession({ toolNames: [] });
    expect(session.activeToolNames()).not.toContain('agentdev_probe');
  });

  it('subscribes, unsubscribes and disposes', async () => {
    const session = await createSession();
    const seen: PiSessionEvent[] = [];
    const unsubscribe = session.subscribe((event) => seen.push(event));
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(session.disposed()).toBe(false);
    session.dispose();
    expect(session.disposed()).toBe(true);
  });

  it('refuses every operation after dispose', async () => {
    const session = await createSession();
    session.dispose();
    expect(() => session.activeToolNames()).toThrowError(PiRuntimeError);
    expect(() => session.subscribe(() => {})).toThrowError(/disposed/);
    await expect(session.prompt('hello')).rejects.toThrowError(/disposed/);
    await expect(session.abort()).rejects.toThrowError(/disposed/);
  });

  it('aborts an idle session without error', async () => {
    const session = await createSession();
    await expect(session.abort()).resolves.toBeUndefined();
  });

  it('refuses to compact a session that has nothing to compact', async () => {
    const session = await createSession();
    // Observed SDK behaviour: an empty session rejects with
    // "Nothing to compact (session too small)" instead of hanging or silently
    // discarding history. A regression that made compaction always resolve (or
    // always fail for another reason) breaks this assertion.
    await expect(session.compact()).rejects.toThrow(/compact/i);
    expect(session.disposed()).toBe(false);
  });

  it('rejects a model that is not in the catalog', async () => {
    await expect(
      factory.createSession({
        provider: 'no-such-provider',
        modelId: 'no-such-model',
        resourceLoader: explicitLoader(),
        toolNames: [],
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('binds a file-backed session when a session directory is given', async () => {
    const session = await createSession({ sessionDir: join(root, 'sessions') });
    // The SDK only writes the file once an entry exists, but the manager is
    // already persisted and reports where the session will live.
    expect(session.sessionFile()).toBeDefined();
  });

  it('wires the resume path for a stored session file', async () => {
    const sessionDir = join(root, 'sessions');
    const storedFile = join(sessionDir, 'stored-session.jsonl');
    // SDK behaviour reproduced offline: `SessionManager` assigns the file path
    // eagerly but flushes it only once a real turn is recorded, and `open()` on
    // an entry-less file starts a fresh session id. This case therefore does NOT
    // claim to restore history — it asserts the resume path is wired and yields a
    // usable session. History restoration and live streaming need a model turn
    // and are re-verified by the WP-10 live matrix (AC-066 发布回归).
    const secondFactory = await PiSessionFactory.create({
      cwd: root,
      agentDir: join(root, 'agent'),
    });
    const resumed = await secondFactory.createSession({
      provider,
      modelId,
      resourceLoader: explicitLoader(),
      toolNames: ['agentdev_probe'],
      customTools: [probeTool],
      resumeFrom: storedFile,
      sessionDir,
    });
    open.push(resumed);

    expect(resumed.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(resumed.activeToolNames()).toContain('agentdev_probe');
    expect(resumed.disposed()).toBe(false);
  });

  it('keeps the runtime catalog offline and enumerable', () => {
    const models = factory.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(factory.listModelsOf(provider)).toContain(modelId);
  });
});
