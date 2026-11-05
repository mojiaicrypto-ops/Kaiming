/**
 * External tools through the real runtime (S9): the chief's allowlist really reaches Pi, a tool call
 * really executes, and the result really comes back to the model. The browser is not launched here —
 * that is a smoke step — but `web_fetch` is exercised against a local HTTP server.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
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
  readonly replies: readonly StubReply[];
  readonly roleId?: string;
  readonly taskType?: 'read' | 'write';
}): Promise<{ readonly store: Store; readonly runner: InputRunner; readonly agentDir: string }> {
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
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: options.roleId ?? 'chief', cwd: env.cwd });
  store.acceptInput({
    inputId: 'i-1',
    projectId: 'p-1',
    sessionId: 's-1',
    sourceKey: 'user:req-1',
    requestKey: 'req-1',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'fetch the page and tell me' }] },
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
  return { store, runner, agentDir: env.agentDir };
}

async function pageServer(body: string): Promise<{ url: string }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(body);
  });
  const closed = Promise.withResolvers<void>();
  cleanups.push(async () => {
    server.close(() => closed.resolve());
    await closed.promise;
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/doc` };
}

/** The tool names Pi really activated for the finished input. */
function recordedTools(store: Store): string[] {
  const raw = store.getInput('i-1')?.effectiveConfig ?? '{}';
  const parsed = JSON.parse(raw) as { activeTools?: unknown };
  return Array.isArray(parsed.activeTools) ? (parsed.activeTools as string[]) : [];
}

describe('external tools in a real run', () => {
  it('registers web_search, web_fetch and browser for the chief and runs a fetched page through', async () => {
    const page = await pageServer('<html><body><h1>Fetched heading</h1><p>Body text the model needs.</p></body></html>');
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'web_fetch', arguments: JSON.stringify({ url: page.url }) }] },
        { kind: 'text', text: 'I read the page.' },
      ],
    });
    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');

    expect(recordedTools(h.store)).toEqual(
      expect.arrayContaining(['web_search', 'web_fetch', 'browser']),
    );

    const binding = h.store.getSessionBinding('s-1');
    const history = readPiHistory(binding?.piFile, h.agentDir);
    const result = history.records.find((record) => record.role === 'toolResult' && record.toolName === 'web_fetch');
    expect(result).toBeDefined();
    const text = JSON.stringify(result?.content);
    expect(text).toContain('Fetched heading');
    expect(text).toContain('Body text the model needs.');
    expect(text).toContain('saved:');
    expect(result?.isError).toBe(false);
  });

  it('lets the model grep the page web_fetch saved, without opening the rest of private storage', async () => {
    const page = await pageServer('<html><body><p>Searchable needle in the saved page.</p></body></html>');
    // The stub reads its reply array at request time, so the grep path can name the real work root.
    const replies: StubReply[] = [];
    const h = await harness({ replies });
    replies.push(
      { kind: 'tool_calls', calls: [{ name: 'web_fetch', arguments: JSON.stringify({ url: page.url }) }] },
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'grep',
            arguments: JSON.stringify({ pattern: 'Searchable needle', path: join(h.agentDir, 'work', 's-1', 'web') }),
          },
        ],
      },
      { kind: 'text', text: 'found it' },
    );
    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');
    const history = readPiHistory(h.store.getSessionBinding('s-1')?.piFile, h.agentDir);
    const grep = history.records.find((record) => record.role === 'toolResult' && record.toolName === 'grep');
    expect(grep?.isError).toBe(false);
    expect(JSON.stringify(grep?.content)).toContain('Searchable needle');
  });

  it('does not hand the settler any network or browser tool', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }], roleId: 'settler', taskType: 'write' });
    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');
    const active = recordedTools(h.store);
    expect(active).not.toContain('web_search');
    expect(active).not.toContain('web_fetch');
    expect(active).not.toContain('browser');
  });

  it('keeps a reviewer read-only in a write Task, so its browser cannot act', async () => {
    const h = await harness({
      replies: [
        { kind: 'tool_calls', calls: [{ name: 'browser', arguments: JSON.stringify({ action: 'click', ref: 'e1' }) }] },
        { kind: 'text', text: 'I could not act.' },
      ],
      roleId: 'reviewer',
      taskType: 'write',
    });
    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');
    const binding = h.store.getSessionBinding('s-1');
    const history = readPiHistory(binding?.piFile, h.agentDir);
    const result = history.records.find((record) => record.role === 'toolResult' && record.toolName === 'browser');
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).toContain('FORBIDDEN');
  });

  it('keeps the tools in a read Task, where the browser is registered read-only', async () => {
    const h = await harness({ replies: [{ kind: 'text', text: 'ok' }], roleId: 'investigator', taskType: 'read' });
    const outcome = await h.runner.runNext('s-1');
    expect(outcome.kind).toBe('completed');
    const active = recordedTools(h.store);
    expect(active).toEqual(expect.arrayContaining(['web_search', 'web_fetch', 'browser']));
    // A read Task still drops the shell.
    expect(active).not.toContain('bash');
  });
});
