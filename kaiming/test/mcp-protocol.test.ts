/**
 * Protocol behaviour that does not need a workbench: version negotiation, the compatibility probe,
 * unknown methods and tools, and the rule that a business refusal is a tool result (readable by the
 * calling model) rather than a transport error.
 */
import { describe, expect, it } from 'vitest';
import { ControlError, type Control } from '../src/mcp/control.ts';
import { createMcpProtocol, PROTOCOL_VERSIONS } from '../src/mcp/protocol.ts';
import { RunTools } from '../src/mcp/runs.ts';

function protocol(control: Control = { call: async () => ({}) }) {
  return createMcpProtocol({
    tools: new RunTools({ control, defaultProjectPath: '/tmp/project', caller: 'tests' }),
    info: { name: 'kaiming', title: 'Kaiming', version: '0.1.0' },
  });
}

describe('the MCP protocol layer', () => {
  it('negotiates the requested version when it is served, and never claims a newer one', async () => {
    for (const version of PROTOCOL_VERSIONS) {
      const answer = await protocol().handle({ id: 1, method: 'initialize', params: { protocolVersion: version } });
      expect((answer?.result as { protocolVersion: string }).protocolVersion).toBe(version);
    }
    // A client speaking the draft 2026 generation gets the newest version we actually serve.
    const newer = await protocol().handle({
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2026-07-28' },
    });
    expect((newer?.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    const missing = await protocol().handle({ id: 3, method: 'initialize', params: {} });
    expect(missing?.error?.code).toBe(-32602);
  });

  it('answers the compatibility probe so a modern client can negotiate down', async () => {
    const answer = await protocol().handle({ id: 1, method: 'server/discover' });
    expect((answer?.result as { protocolVersions: string[] }).protocolVersions).toEqual([...PROTOCOL_VERSIONS]);
  });

  it('declares every tool with a schema, a title and honest annotations', async () => {
    const answer = await protocol().handle({ id: 1, method: 'tools/list' });
    const tools = (answer?.result as {
      tools: Array<{ name: string; description: string; inputSchema: { type: string }; annotations: Record<string, boolean> }>;
    }).tools;
    expect(tools.length).toBe(10);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.annotations).toMatchObject({ readOnlyHint: expect.any(Boolean), openWorldHint: expect.any(Boolean) });
    }
    // Delegation writes to a project; every read stays read-only.
    expect(tools.find((tool) => tool.name === 'kaiming_delegate')?.annotations.destructiveHint).toBe(true);
    for (const name of [
      'kaiming_status',
      'kaiming_read',
      'kaiming_projects',

      'kaiming_backlog',
      'kaiming_runs',
    ]) {
      expect(tools.find((tool) => tool.name === name)?.annotations.readOnlyHint).toBe(true);
    }
  });

  it('refuses an unknown method and an unknown tool without pretending either worked', async () => {
    const unknownMethod = await protocol().handle({ id: 9, method: 'session/prompt' });
    expect(unknownMethod?.error?.code).toBe(-32601);

    const unknownTool = await protocol().handle({ id: 10, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    const result = unknownTool?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('INVALID_ARGUMENT');
  });

  it('reports a business refusal as a tool error the model can read', async () => {
    const failing: Control = {
      call: async () => {
        throw new ControlError('NOT_FOUND', 'input i-1 does not exist in this project');
      },
    };
    const answer = await protocol(failing).handle({
      id: 11,
      method: 'tools/call',
      params: { name: 'kaiming_status', arguments: { run_id: 'p-1:i-1' } },
    });
    const result = answer?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('NOT_FOUND: input i-1 does not exist in this project');
    // A failure is a result, not a JSON-RPC error: the caller's model can see and act on it.
    expect(answer?.error).toBeUndefined();
  });

  it('returns a run payload with structured content and the same JSON as text', async () => {
    const control: Control = {
      call: async (method) => {
        if (method === 'session.input.get') {
          return { sessionId: 's-1', taskId: null, input: { status: 'completed', error: null } };
        }
        if (method === 'session.get') {
          return { session: { activity: 'idle', currentTaskId: null, queuedInputs: 0 } };
        }
        if (method === 'interaction.list') return { interactions: [] };
        if (method === 'task.list') return { tasks: [], nextCursor: null };
        throw new ControlError('NOT_FOUND', `unexpected ${method}`);
      },
    };
    const answer = await protocol(control).handle({
      id: 12,
      method: 'tools/call',
      params: { name: 'kaiming_status', arguments: { run_id: 'p-1:i-1' } },
    });
    const result = answer?.result as { structuredContent: Record<string, unknown>; content: Array<{ text: string }> };
    expect(result.structuredContent['status']).toBe('completed');
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(result.structuredContent);
  });

  it('reads only this run’s messages out of a shared fixed session', async () => {
    const control: Control = {
      call: async (method, params) => {
        if (method === 'session.input.get') {
          return { sessionId: 's-1', taskId: null, input: { status: 'completed', error: null } };
        }
        if (method === 'session.get') return { session: { activity: 'idle', currentTaskId: null, queuedInputs: 0 } };
        if (method === 'interaction.list') return { interactions: [] };
        if (method === 'task.list') return { tasks: [], nextCursor: null };
        if (method === 'session.messages.list') {
          expect(params['sessionId']).toBe('s-1');
          return {
            messages: [
              { entryId: 'a', inputId: 'someone-else', content: [{ type: 'text', text: 'other caller' }] },
              { entryId: 'b', inputId: 'i-1', content: [{ type: 'text', text: 'mine' }] },
            ],
            nextCursor: null,
          };
        }
        throw new ControlError('NOT_FOUND', `unexpected ${method}`);
      },
    };
    const answer = await protocol(control).handle({
      id: 20,
      method: 'tools/call',
      params: { name: 'kaiming_read', arguments: { run_id: 'p-1:i-1', kind: 'transcript' } },
    });
    const result = answer?.result as { structuredContent: { messages: Array<{ entryId: string }>; filteredByInput: string } };
    expect(result.structuredContent.filteredByInput).toBe('i-1');
    expect(result.structuredContent.messages.map((entry) => entry.entryId)).toEqual(['b']);
  });


  it('sends progress only to callers that supplied a token', async () => {
    let clock = 0;
    let polls = 0;
    const control: Control = {
      call: async (method) => {
        if (method === 'session.input.get') {
          return { sessionId: 's-1', taskId: null, input: { status: 'processing', error: null } };
        }
        if (method === 'session.get') {
          return { session: { activity: 'processing', currentTaskId: null, queuedInputs: 0, blocked: null } };
        }
        if (method === 'interaction.list') return { interactions: [] };
        if (method === 'task.list') {
          polls += 1;
          // The Task shows up a poll later: that is the change a progress notification reports.
          return polls < 3
            ? { tasks: [], nextCursor: null }
            : {
                tasks: [
                  {
                    taskId: 't-1',
                    type: 'write',
                    phase: 'design',
                    status: 'active',
                    goal: 'g',
                    summary: 's',
                    nextStep: null,
                    blockReason: null,
                    requiresTest: false,
                    sourceInputId: 'i-1',
                    updatedAt: '2026-10-28T00:00:00Z',
                  },
                ],
                nextCursor: null,
              };
        }
        throw new ControlError('NOT_FOUND', method);
      },
    };
    const notified: Array<{ token: unknown; progress: number }> = [];
    const make = (): ReturnType<typeof createMcpProtocol> =>
      createMcpProtocol({
        tools: new RunTools({
          control,
          defaultProjectPath: '/tmp/project',
          caller: 'tests',
          // Advance imagined time per poll instead of waiting for it.
          now: () => {
            clock += 1000;
            return clock;
          },
          sleep: async () => undefined,
        }),
        info: { name: 'kaiming', title: 'Kaiming', version: '0.1.0' },
        notifyProgress: (token, progress) => notified.push({ token, progress }),
      });

    // Without a token there is nothing to attach a notification to, so none is sent.
    polls = 0;
    const untagged = await make().handle({
      id: 30,
      method: 'tools/call',
      params: { name: 'kaiming_wait', arguments: { run_id: 'p-1:i-1', seconds: 5 } },
    });
    expect(untagged?.error).toBeUndefined();
    expect(notified).toHaveLength(0);

    // With one, the observed change is reported under that token.
    polls = 0;
    const tagged = await make().handle({
      id: 31,
      method: 'tools/call',
      params: {
        name: 'kaiming_wait',
        arguments: { run_id: 'p-1:i-1', seconds: 5 },
        _meta: { progressToken: 'tok-1' },
      },
    });
    expect(tagged?.error).toBeUndefined();
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ token: 'tok-1', progress: 1 });
  });

});
