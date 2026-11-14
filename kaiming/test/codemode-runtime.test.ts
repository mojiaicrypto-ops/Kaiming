/**
 * Codemode through the real runtime: the batch tool activates only where the role allowlist names
 * it (tester, developer), a script's nested allowed call really resolves, and a nested denied call
 * really rejects — the negative control proving that permission work applies inside scripts too.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner } from '../src/runtime/runner.ts';
import { readPiHistory } from '../src/server/history.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function harness(options: {
  /** Passed by reference: replies pushed after harness creation are served for later requests. */
  readonly replies: StubReply[];
  readonly roleId: string;
  readonly taskType?: 'read' | 'write';
}): Promise<{ readonly store: Store; readonly runner: InputRunner; readonly cwd: string; readonly agentDir: string }> {
  const server = await startStubModelServer(options.replies);
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
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: options.roleId, cwd: env.cwd });
  store.acceptInput({
    inputId: 'i-1',
    projectId: 'p-1',
    sessionId: 's-1',
    sourceKey: 'user:req-1',
    requestKey: 'req-1',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'run the checks' }] },
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
    taskTypeOf: () => options.taskType,
  });
  return { store, runner, cwd: env.cwd, agentDir: env.agentDir };
}

/** The tool names Pi really activated for the finished input. */
function recordedTools(store: Store): string[] {
  const raw = store.getInput('i-1')?.effectiveConfig ?? '{}';
  const parsed = JSON.parse(raw) as { activeTools?: unknown };
  return Array.isArray(parsed.activeTools) ? (parsed.activeTools as string[]) : [];
}

function codemodeResult(store: Store, agentDir: string): { readonly isError: boolean | null | undefined; readonly text: string } | undefined {
  const binding = store.getSessionBinding('s-1');
  const history = readPiHistory(binding?.piFile, agentDir);
  const record = history.records.find((entry) => entry.role === 'toolResult' && entry.toolName === 'codemode');
  if (record === undefined) return undefined;
  return { isError: record.isError, text: JSON.stringify(record.content) };
}

describe('codemode in a real run', () => {
  it('activates only for the tester and the developer allowlists', async () => {
    for (const [roleId, expected] of [
      ['tester', true],
      ['developer', true],
      ['reviewer', false],
    ] as const) {
      const h = await harness({ replies: [{ kind: 'text', text: 'ok' }], roleId, taskType: 'write' });
      const outcome = await h.runner.runNext('s-1');
      expect(outcome.kind).toBe('completed');
      const active = recordedTools(h.store);
      if (expected) {
        expect(active, roleId).toContain('codemode');
      } else {
        expect(active, roleId).not.toContain('codemode');
      }
    }
  });

  it('runs an allowed nested call and returns only the script summary to the model', async () => {
    const replies: StubReply[] = [];
    const h = await harness({ replies, roleId: 'tester', taskType: 'write' });
    writeFileSync(join(h.cwd, 'note.txt'), 'codemode-saw-this-marker\n');
    replies.push(
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'codemode',
            arguments: JSON.stringify({
              code: `const content = await tools.read({ path: ${JSON.stringify(join(h.cwd, 'note.txt'))} });\nreturn { seen: content.trim() };`,
            }),
          },
        ],
      },
      { kind: 'text', text: 'The script saw the marker.' },
    );
    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');
    const result = codemodeResult(h.store, h.agentDir);
    expect(result).toBeDefined();
    expect(result?.isError).toBe(false);
    expect(result?.text).toContain('codemode-saw-this-marker');
  });

  it('rejects a nested call to a tool the role does not hold, and changes nothing on disk', async () => {
    const replies: StubReply[] = [];
    const h = await harness({ replies, roleId: 'tester', taskType: 'write' });
    const escapePath = join(h.cwd, 'escape.txt');
    replies.push(
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'codemode',
            arguments: JSON.stringify({
              code: `await tools.write({ path: ${JSON.stringify(escapePath)}, content: 'nope' });\nreturn 'wrote';`,
            }),
          },
        ],
      },
      { kind: 'text', text: 'The script failed as expected.' },
    );
    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');
    const result = codemodeResult(h.store, h.agentDir);
    expect(result).toBeDefined();
    // The negative control: the nested write really fails for the permission reason.
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain('write');
    expect(existsSync(escapePath)).toBe(false);
  });
});
