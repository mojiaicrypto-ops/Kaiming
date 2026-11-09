/**
 * The MCP surface end to end: a real workbench (stub model) and the real stdio process a coding agent
 * launches. The test speaks JSON-RPC to it exactly as Codex or Claude Code does, so a regression in
 * framing, tool shapes or the run lifecycle fails here rather than in someone's editor.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkbench } from '../src/server/main.ts';
import { createStubEnv, startStubModelServer, type StubReply } from '../spikes/harness/pi-env.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

interface McpClient {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  readonly notifications: Array<Record<string, unknown>>;
  readonly stderr: string[];
  close(): Promise<void>;
}

function connect(env: NodeJS.ProcessEnv): McpClient {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['src/mcp/main.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const notifications: Array<Record<string, unknown>> = [];
  const stderr: string[] = [];
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
      // stdout carries protocol messages and nothing else: a stray log line would throw here.
      const message = JSON.parse(line) as { id?: number; method?: string };
      if (message.method !== undefined) {
        notifications.push(message as Record<string, unknown>);
        continue;
      }
      const settle = message.id === undefined ? undefined : pending.get(message.id);
      if (settle !== undefined) {
        pending.delete(message.id as number);
        settle(message as Record<string, unknown>);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr.push(chunk);
  });
  const request = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no answer to ${method} within 30s; stderr: ${stderr.join('')}`));
      }, 30_000);
      const settle = pending.get(id);
      pending.set(id, (value) => {
        clearTimeout(timer);
        settle?.(value);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return {
    request,
    notifications,
    stderr,
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

async function workbench(replies: readonly StubReply[]): Promise<{
  origin: string;
  password: string;
  projectPath: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-mcp-'));
  const projectDir = join(root, 'project');
  mkdirSync(projectDir, { recursive: true });
  const stub = await startStubModelServer(replies);
  const env = await createStubEnv(stub.baseUrl);
  const running = await startWorkbench({
    dataDir: join(root, 'data'),
    agentDir: env.agentDir,
    accessPassword: 'mcp-test-password',
    port: 0,
    model: { providerId: 'stub', modelId: 'stub-1' },
  });
  cleanups.push(async () => {
    await running.close();
    await stub.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { origin: running.origin, password: 'mcp-test-password', projectPath: realpathSync(projectDir) };
}

function toolPayload(answer: Record<string, unknown>): Record<string, unknown> {
  const result = answer['result'] as
    | { structuredContent?: Record<string, unknown>; isError?: boolean; content?: Array<{ text?: string }> }
    | undefined;
  expect(answer['error']).toBeUndefined();
  expect(result?.isError, result?.content?.[0]?.text).toBe(false);
  return result?.structuredContent ?? {};
}

async function callTool(
  client: McpClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return toolPayload(await client.request('tools/call', { name, arguments: args }));
}

describe('the MCP surface', () => {
  it('speaks the protocol a coding agent expects and answers a delegation to completion', async () => {
    const bench = await workbench([{ kind: 'text', text: '收到，这是讨论结论。' }]);
    const client = connect({
      KAIMING_MCP_URL: bench.origin,
      KAIMING_ACCESS_PASSWORD: bench.password,
      KAIMING_MCP_PROJECT: bench.projectPath,
    });
    cleanups.push(() => client.close());
    try {
      const initialize = await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: { elicitation: { form: {} } },
        clientInfo: { name: 'vitest', version: '1.0.0' },
      });
      const init = initialize['result'] as { protocolVersion?: string; serverInfo?: { name?: string } };
      expect(init.protocolVersion).toBe('2025-11-25');
      expect(init.serverInfo?.name).toBe('kaiming');

      const listed = (await client.request('tools/list'))['result'] as { tools: Array<{ name: string }> };
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        'kaiming_answer',
        'kaiming_backlog',
        'kaiming_cancel',
        'kaiming_delegate',
        'kaiming_projects',
        'kaiming_read',

        'kaiming_runs',
        'kaiming_status',
        'kaiming_tell',
        'kaiming_wait',
      ]);

      const delegated = await callTool(client, 'kaiming_delegate', {
        objective: 'Explain what this project is for.',
        wait_seconds: 15,
      });
      const runId = String(delegated['runId']);
      expect(runId).toContain(':');

      let status = delegated;
      const deadline = Date.now() + 30_000;
      while (status['complete'] !== true && Date.now() < deadline) {
        status = await callTool(client, 'kaiming_status', { run_id: runId });
        if (status['complete'] === true) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(status['complete']).toBe(true);
      expect(status['status']).toBe('completed');

      const transcript = await callTool(client, 'kaiming_read', { run_id: runId, kind: 'transcript' });
      expect(JSON.stringify(transcript)).toContain('收到，这是讨论结论');

      // A run with no Task has no report, and says so instead of inventing one.
      const report = await client.request('tools/call', {
        name: 'kaiming_read',
        arguments: { run_id: runId, kind: 'report' },
      });
      const reportResult = report['result'] as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(reportResult.isError).toBe(true);
      expect(reportResult.content?.[0]?.text).toContain('REPORT_MISSING');

      const projects = await callTool(client, 'kaiming_projects');
      expect(JSON.stringify(projects)).toContain(bench.projectPath);
    } finally {
      await client.close();
    }
  }, 90_000);

  it('reports the Task a delegation created, its Plan, and its steps', async () => {
    const bench = await workbench([
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'task',
            arguments: JSON.stringify({
              op: 'create',
              type: 'read',
              goal: 'Survey the project entry points',
              scope: 'repository as found',
              acceptanceRefs: [],
              basisRefs: [],
              planMarkdown: '# Plan\n\n1. read the entry points\n',
            }),
          },
        ],
      },
      { kind: 'text', text: '已建立只读任务。' },
    ]);
    const client = connect({
      KAIMING_MCP_URL: bench.origin,
      KAIMING_ACCESS_PASSWORD: bench.password,
      KAIMING_MCP_PROJECT: bench.projectPath,
    });
    cleanups.push(() => client.close());
    try {
      await client.request('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'vitest' } });
      const delegated = await callTool(client, 'kaiming_delegate', {
        objective: 'Survey the project structure.',
        mode: 'review',
        wait_seconds: 15,
      });
      const runId = String(delegated['runId']);
      let status = delegated;
      const deadline = Date.now() + 30_000;
      while (status['taskId'] === null && Date.now() < deadline) {
        status = await callTool(client, 'kaiming_wait', { run_id: runId, seconds: 5 });
        if (status['taskId'] !== null && status['complete'] === true) break;
      }
      expect(status['taskId']).not.toBeNull();
      expect(status['taskType']).toBe('read');
      // The turn ended with the Task still open: the caller is not told the work is finished.
      expect(status['status']).toBe('waiting_user');
      const steps = status['steps'] as Array<{ phase: string; state: string }>;
      expect(steps.map((step) => step.phase)).toContain('plan');

      const plan = await callTool(client, 'kaiming_read', { run_id: runId, kind: 'plan' });
      expect(String(plan['markdown'])).toContain('# Plan');

      const cancelled = await callTool(client, 'kaiming_cancel', { run_id: runId });
      expect(cancelled['status']).toBe('cancelled');

      const runs = await callTool(client, 'kaiming_runs', {});
      expect(JSON.stringify(runs)).toContain(runId);
    } finally {
      await client.close();
    }
  }, 90_000);
});
