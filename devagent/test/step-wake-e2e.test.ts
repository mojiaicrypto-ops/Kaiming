/**
 * Real-process proof of the settled-step wake: a member's run ends after the chief's turn is gone,
 * and the chief is woken by the host with one notice that its own turn then consumes.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkbench } from '../src/server/main.ts';
import { Store } from '../src/store/store.ts';
import { createStubEnv, startStubModelServer } from '../spikes/harness/pi-env.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/**
 * Poll a real workbench through a second SQLite reader. This is an integration test against the real
 * worker, so the store is the only observable surface: there is no event to await and fake timers
 * cannot advance another process's loop.
 */
async function until<T>(probe: () => T | undefined, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for the settled-step wake');
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 50);
    await promise;
  }
}

describe('settled-step wake (real workbench)', () => {
  it('wakes the chief when a member report lands after its turn already ended', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devagent-step-e2e-'));
    const dataDir = join(root, 'data');
    const projectDir = join(root, 'project');
    mkdirSync(projectDir, { recursive: true });
    const stub = await startStubModelServer([
      { kind: 'text', text: 'member finished' },
      { kind: 'text', text: 'chief woke on the settled step' },
    ]);
    const env = await createStubEnv(stub.baseUrl);
    mkdirSync(dataDir, { recursive: true });
    cleanups.push(() => stub.close());
    cleanups.push(() => rmSync(env.root, { recursive: true, force: true }));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));

    // Seed a Task whose current step is one dispatched developer — the state the chief's dispatch
    // creates — before the workbench opens its store.
    const seed = new Store({ path: join(dataDir, 'state.db'), serverEpoch: 1 });
    const realProject = realpathSync(projectDir);
    seed.createProject({ id: 'p-1', realPath: realProject });
    seed.createSession({ id: 's-chief', projectId: 'p-1', roleId: 'chief', cwd: realProject });
    seed.createTask({
      id: 't-1',
      projectId: 'p-1',
      chiefSessionId: 's-chief',
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
    seed.createTaskSessions({
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
    seed.close();

    const running = await startWorkbench({
      dataDir,
      agentDir: env.agentDir,
      accessPassword: 'step-wake-secret',
      port: 0,
      model: { providerId: 'stub', modelId: 'stub-1' },
      log: () => undefined,
    });
    cleanups.push(() => running.close());
    const reader = new Store({ path: join(dataDir, 'state.db'), serverEpoch: 2 });
    cleanups.push(() => reader.close());

    // The member runs and ends; its turn is over, and the chief had nothing running.
    await until(() => (reader.getInput('i-dev')?.status === 'completed' ? true : undefined));
    const notice = await until(() =>
      reader.listInputs('s-chief').find((input) => input.kind === 'system_notice'),
    );
    expect(notice).toMatchObject({ taskId: 't-1', status: expect.stringMatching(/queued|processing|completed/) });
    expect(JSON.stringify(notice.payload)).toContain('phase plan');

    // The worker claims it, so the wake really produces the chief turn that was missing.
    await until(() => (reader.getInput(notice.inputId)?.status === 'completed' ? true : undefined));
    expect(reader.listInputs('s-chief').map((input) => input.inputId)).toEqual([notice.inputId]);
    // Two model requests: the member's own run, then the chief's wake turn.
    expect(stub.requests.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
