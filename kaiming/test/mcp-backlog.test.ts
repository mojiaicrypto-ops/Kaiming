import { describe, expect, it } from 'vitest';
import { type Control } from '../src/mcp/control.ts';
import { createMcpProtocol } from '../src/mcp/protocol.ts';
import { RunTools } from '../src/mcp/runs.ts';

interface Call {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function harness(): { calls: Call[]; protocol: ReturnType<typeof createMcpProtocol> } {
  const calls: Call[] = [];
  const control: Control = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === 'project.open') {
        return { project: { projectId: 'p-1', realPath: '/tmp/project' } };
      }
      if (method === 'backlog.get') {
        return { id: params['id'], title: 'one', state: 'open', issues: [], warnings: [] };
      }
      return { items: [{ id: 'B-1', title: 'one', state: 'open' }], issues: [], warnings: [], nextCursor: null };
    },
  };
  return {
    calls,
    protocol: createMcpProtocol({
      tools: new RunTools({ control, defaultProjectPath: '/tmp/project', caller: 'tests' }),
      info: { name: 'kaiming', title: 'Kaiming', version: '0.1.0' },
    }),
  };
}

async function callTool(
  protocol: ReturnType<typeof createMcpProtocol>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const response = await protocol.handle({
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return response as { result?: unknown; error?: { code: number; message: string } };
}

describe('kaiming_backlog', () => {
  it('is declared read-only with a list/get schema', async () => {
    const { protocol } = harness();
    const answer = await protocol.handle({ id: 1, method: 'tools/list' });
    const tools = (answer?.result as {
      tools: Array<{ name: string; annotations: Record<string, boolean>; inputSchema: { properties: Record<string, unknown> } }>;
    }).tools;
    const tool = tools.find((entry) => entry.name === 'kaiming_backlog');
    expect(tool).toBeDefined();
    expect(tool?.annotations.readOnlyHint).toBe(true);
    expect(tool?.annotations.destructiveHint).toBe(false);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['project_path', 'state', 'query', 'backlog_id', 'limit', 'cursor']),
    );
  });

  it('lists through backlog.list with the resolved project and the requested filters', async () => {
    const { calls, protocol } = harness();
    const result = await callTool(protocol, 'kaiming_backlog', { state: 'all', query: '退款', limit: 10 });
    expect(result.error).toBeUndefined();
    const list = calls.find((entry) => entry.method === 'backlog.list');
    expect(list?.params).toMatchObject({ projectId: 'p-1', state: 'all', query: '退款', limit: 10 });
  });

  it('reads one item through backlog.get', async () => {
    const { calls, protocol } = harness();
    const result = await callTool(protocol, 'kaiming_backlog', { backlog_id: 'B-1' });
    expect(result.error).toBeUndefined();
    expect(calls.find((entry) => entry.method === 'backlog.get')?.params).toMatchObject({
      projectId: 'p-1',
      id: 'B-1',
    });
  });
});
