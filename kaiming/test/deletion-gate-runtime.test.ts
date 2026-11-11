/**
 * The deletion gate through the real runtime: a scripted model calls bash with a destructive
 * command, the gate asks through the durable interaction surface, and the user's answer decides —
 * approval runs the command, refusal blocks it as a tool result the model can see. Both halves of
 * the loop are exercised against the real Pi session, not the rule table alone.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner, type RunOutcome } from '../src/runtime/runner.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

interface GateHarness {
  readonly store: Store;
  readonly runner: InputRunner;
  readonly cwd: string;
}

async function harness(replies: readonly StubReply[]): Promise<GateHarness> {
  const server = await startStubModelServer(replies);
  cleanups.push(async () => {
    await server.close();
  });
  const env = await createStubEnv(server.baseUrl);
  cleanups.push(() => {
    rmSync(env.root, { recursive: true, force: true });
  });
  const store = new Store({ path: join(env.root, 'state.db'), serverEpoch: 1 });
  cleanups.push(() => {
    store.close();
  });
  store.createProject({ id: 'p-1', realPath: env.cwd });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: env.cwd });
  store.acceptInput({
    inputId: 'i-1',
    projectId: 'p-1',
    sessionId: 's-1',
    sourceKey: 'user:req-1',
    requestKey: 'req-1',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'clean up the build directory' }] },
  });
  const defaults: RuntimeDefaults = {
    model: { providerId: 'stub', modelId: 'stub-1' },
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
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: defaults }),
  });
  return { store, runner, cwd: env.cwd };
}

const APPROVE_ONCE = 'Approve once';
const TRUST_SESSION = 'Trust all commands in this session';
const REJECT = 'Reject';

/** Drive one run and answer the gate's question with the given choice, once it appears. */
async function runWithChoice(h: GateHarness, choice: string): Promise<RunOutcome> {
  const answering = (async () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const question = h.store.listPendingInteractionsForChief('s-1')[0];
      if (question !== undefined) {
        // The durable answer first, then the in-memory waiter — exactly what interaction.respond
        // does, so the record is no longer pending when the run continues.
        h.store.resolveInteraction({
          interactionId: question.interactionId,
          expectedRevision: question.revision,
          response: choice,
          answeredBy: 'test',
          requestKey: `answer:${question.interactionId}`,
        });
        expect(h.runner.interactions.resolve(question.interactionId, choice)).toBe(true);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the gate never asked its question');
  })();
  const outcome = await h.runner.runNext('s-1');
  await answering;
  return outcome;
}

describe('the deletion gate in a real run', () => {
  it('runs the destructive command after the user approves it', async () => {
    // A file the command really deletes: approval must mean execution, not a silent skip.
    const sandbox = mkdtempSync(join(tmpdir(), 'kaiming-gate-'));
    cleanups.push(() => {
      rmSync(sandbox, { recursive: true, force: true });
    });
    const victim = join(sandbox, 'victim.txt');
    writeFileSync(victim, 'delete me');
    const h = await harness([
      { kind: 'tool_calls', calls: [{ name: 'bash', arguments: JSON.stringify({ command: `rm ${victim}` }) }] },
      { kind: 'text', text: 'deleted after approval' },
    ]);

    const outcome = await runWithChoice(h, APPROVE_ONCE);

    expect(outcome.kind).toBe('completed');
    expect(existsSync(victim)).toBe(false);
  }, 30_000);

  it('blocks the destructive command as a tool result when the user declines', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'kaiming-gate-'));
    cleanups.push(() => {
      rmSync(sandbox, { recursive: true, force: true });
    });
    const victim = join(sandbox, 'victim.txt');
    writeFileSync(victim, 'keep me');
    const h = await harness([
      { kind: 'tool_calls', calls: [{ name: 'bash', arguments: JSON.stringify({ command: `rm ${victim}` }) }] },
      { kind: 'text', text: 'declined, moving on without deleting' },
    ]);

    const outcome = await runWithChoice(h, REJECT);

    expect(outcome.kind).toBe('completed');
    expect(existsSync(victim)).toBe(true);
    // The refusal is a visible tool result, so the model knows why nothing was deleted.
    expect(h.store.listPendingInteractionsForChief('s-1')).toHaveLength(0);
  }, 30_000);

  it('does not ask for an ordinary command', async () => {
    const h = await harness([
      { kind: 'tool_calls', calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'echo ordinary-ok' }) }] },
      { kind: 'text', text: 'ran without a question' },
    ]);

    const outcome = await h.runner.runNext('s-1');

    expect(outcome.kind).toBe('completed');
    expect(h.store.listPendingInteractionsForChief('s-1')).toHaveLength(0);
  }, 30_000);

  it('trusts every later command in the session after the explicit choice', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'kaiming-gate-'));
    cleanups.push(() => {
      rmSync(sandbox, { recursive: true, force: true });
    });
    const first = join(sandbox, 'first.txt');
    const second = join(sandbox, 'second.txt');
    writeFileSync(first, 'delete me');
    writeFileSync(second, 'delete me too');
    const h = await harness([
      { kind: 'tool_calls', calls: [{ name: 'bash', arguments: JSON.stringify({ command: `rm ${first}` }) }] },
      { kind: 'tool_calls', calls: [{ name: 'bash', arguments: JSON.stringify({ command: `rm ${second}` }) }] },
      { kind: 'text', text: 'both deleted after trusting the session' },
    ]);

    const outcome = await runWithChoice(h, TRUST_SESSION);

    expect(outcome.kind).toBe('completed');
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
    expect(h.store.listPendingInteractionsForChief('s-1')).toHaveLength(0);
  }, 30_000);
});
