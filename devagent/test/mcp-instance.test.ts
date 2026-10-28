/**
 * Two facts a coding agent depends on when it launches this server itself:
 *  - restarting over unfinished work must not put recovery text on stdout (the transport's only channel);
 *  - a second client must attach to the workbench this installation already runs, not open a second
 *    store behind it (a second epoch would declare the first client's live run interrupted).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'mcp-instance-password';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

interface Client {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  readonly stray: string[];
  close(): Promise<void>;
}

function connect(env: NodeJS.ProcessEnv): Client {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['src/mcp/main.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stray: string[] = [];
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  let nextId = 1;
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === '') continue;
      let message: { id?: number };
      try {
        message = JSON.parse(line) as { id?: number };
      } catch {
        stray.push(line);
        continue;
      }
      const settle = message.id === undefined ? undefined : pending.get(message.id);
      if (settle !== undefined) {
        pending.delete(message.id as number);
        settle(message as Record<string, unknown>);
      }
    }
  });
  child.stderr.resume();
  return {
    stray,
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => reject(new Error(`no answer to ${method} within 30s`)), 30_000);
        pending.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    async close() {
      child.stdin.end();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
      });
    },
  };
}

/** A store holding one run that was in flight when its process died: the restart scenario. */
function seedInterruptedWork(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const store = new Store({ path: join(dataDir, 'state.db'), serverEpoch: 1 });
  try {
    store.createProject({ id: 'p-1', realPath: dataDir });
    store.createSession({ id: 's-old', projectId: 'p-1', roleId: 'chief', cwd: dataDir });
    store.acceptInput({
      inputId: 'i-old',
      projectId: 'p-1',
      sessionId: 's-old',
      sourceKey: 's-old:i-old',
      requestKey: 'i-old',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'unfinished work' }] },
    });
    store.claimNextInput('s-old');
  } finally {
    store.close();
  }
}

describe('the stdio MCP process', () => {
  it('keeps stdout protocol-only while recovering unfinished work, and a second client attaches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devagent-mcp-instance-'));
    const dataDir = join(root, 'data');
    const projectDir = join(root, 'project');
    mkdirSync(projectDir, { recursive: true });
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    seedInterruptedWork(dataDir);
    const port = await freePort();

    const env = {
      AGENTDEV_ACCESS_PASSWORD: PASSWORD,
      AGENTDEV_DATA_DIR: dataDir,
      AGENTDEV_MCP_PROJECT: realpathSync(projectDir),
      AGENTDEV_PORT: String(port),
    };
    const first = connect(env);
    cleanups.push(() => first.close());
    const firstInit = await first.request('initialize', { protocolVersion: '2025-11-25' });
    expect((firstInit['result'] as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
    // Recovery diagnostics exist and go to stderr; a stray stdout line would be a protocol violation.
    expect(first.stray).toEqual([]);
    const lock = JSON.parse(readFileSync(join(dataDir, 'mcp-instance.json'), 'utf8')) as { pid: number; origin: string };
    expect(typeof lock.pid).toBe('number');
    expect(lock.origin).toContain(String(port));

    // The second client must not open a second store: it attaches to the one already running.
    const second = connect(env);
    cleanups.push(() => second.close());
    const secondInit = await second.request('initialize', { protocolVersion: '2025-06-18' });
    expect((secondInit['result'] as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
    expect(second.stray).toEqual([]);

    // Both clients see the same store: the run started by the first is readable through the second.
    const delegated = await first.request('tools/call', {
      name: 'agentdev_delegate',
      arguments: { objective: 'Anything at all', wait_seconds: 0 },
    });
    const run = (delegated['result'] as { structuredContent: { runId: string } }).structuredContent;
    expect(run.runId).toContain(':');
    const seenBySecond = await second.request('tools/call', {
      name: 'agentdev_status',
      arguments: { run_id: run.runId },
    });
    const secondRun = (seenBySecond['result'] as { structuredContent: { runId: string } }).structuredContent;
    expect(secondRun.runId).toBe(run.runId);
    const projects = await second.request('tools/call', { name: 'agentdev_projects', arguments: {} });
    expect(JSON.stringify(projects)).toContain(realpathSync(projectDir));

    // The owner removes the instance record when it stops serving; the second client never owned it.
    await second.close();
    expect(existsSync(join(dataDir, 'mcp-instance.json'))).toBe(true);
    await first.close();
    expect(existsSync(join(dataDir, 'mcp-instance.json'))).toBe(false);
  }, 120_000);
});
