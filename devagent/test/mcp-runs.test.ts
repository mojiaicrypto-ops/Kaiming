/**
 * Tool-level behaviour that needs no workbench: what a queued run reports, that cancel reaches a
 * paused Task, and that a member whose report failed is not reported as passed. These branches are
 * where the product contract (X-02 queueing, X-04 member facts) is actually decided.
 */
import { describe, expect, it } from 'vitest';
import { ControlError, type Control } from '../src/mcp/control.ts';
import { RunTools } from '../src/mcp/runs.ts';

interface Call {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function toolsWith(handler: (call: Call) => unknown): { tools: RunTools; calls: Call[] } {
  const calls: Call[] = [];
  const control: Control = {
    call: async (method, params) => {
      calls.push({ method, params });
      return handler({ method, params });
    },
  };
  return { tools: new RunTools({ control, defaultProjectPath: '/tmp/project', caller: 'tests' }), calls };
}

const queuedSession = {
  session: {
    activity: 'queued',
    currentTaskId: 't-blocking',
    queuedInputs: 1,
    blocked: null as { code: string; detail: string } | null,
  },
};

describe('the run tools', () => {
  it('names the work a queued run is waiting behind', async () => {
    const { tools } = toolsWith(({ method }) => {
      if (method === 'session.input.get') {
        return { sessionId: 's-1', taskId: null, input: { status: 'queued', error: null } };
      }
      if (method === 'session.get') return queuedSession;
      if (method === 'interaction.list') return { interactions: [] };
      if (method === 'task.list') return { tasks: [], nextCursor: null };
      if (method === 'task.get') return { task: { taskId: 't-blocking', type: 'write', phase: 'develop', status: 'active' }, members: [], results: [] };
      throw new ControlError('NOT_FOUND', method);
    });
    const status = await tools.status({ run_id: 'p-1:i-1' });
    expect(status.status).toBe('queued');
    expect(status.awaiting).toBe('queued');
    expect(status.waitingForTask).toBe('t-blocking');
    expect(status.summary).toContain('unfinished work');
  });

  it('says why a queued run cannot even start', async () => {
    const { tools } = toolsWith(({ method }) => {
      if (method === 'session.input.get') {
        return { sessionId: 's-1', taskId: null, input: { status: 'queued', error: null } };
      }
      if (method === 'session.get') {
        return {
          session: {
            activity: 'queued',
            currentTaskId: null,
            queuedInputs: 1,
            blocked: { code: 'MODEL_UNAVAILABLE', detail: 'no model is configured for this role' },
          },
        };
      }
      if (method === 'interaction.list') return { interactions: [] };
      if (method === 'task.list') return { tasks: [], nextCursor: null };
      throw new ControlError('NOT_FOUND', method);
    });
    const status = await tools.status({ run_id: 'p-1:i-1' });
    expect(status.awaiting).toBe('blocked');
    expect(status.summary).toContain('MODEL_UNAVAILABLE');
  });

  it('cancels a paused Task, which otherwise holds the session forever', async () => {
    let taskStatus = 'paused';
    const { tools, calls } = toolsWith(({ method, params }) => {
      if (method === 'session.input.get') {
        return { sessionId: 's-1', taskId: 't-1', input: { status: 'completed', error: null } };
      }
      if (method === 'session.get') {
        return { session: { activity: 'idle', currentTaskId: 't-1', queuedInputs: 0, blocked: null } };
      }
      if (method === 'interaction.list') return { interactions: [] };
      if (method === 'task.get') {
        return {
          task: { taskId: 't-1', type: 'write', phase: 'develop', status: taskStatus, revision: 7 },
          members: [],
          results: [],
        };
      }
      if (method === 'task.control') {
        taskStatus = 'cancelled';
        expect(params['command']).toBe('cancel');
        expect(params['expectedRevision']).toBe(7);
        return { task: { taskId: 't-1', status: 'cancelled' } };
      }
      if (method === 'task.list') return { tasks: [], nextCursor: null };
      throw new ControlError('NOT_FOUND', method);
    });
    const cancelled = await tools.cancel({ run_id: 'p-1:i-1' });
    expect(calls.some((call) => call.method === 'task.control')).toBe(true);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.complete).toBe(true);
  });

  it('does not report a member as passed when its latest report failed', async () => {
    const { tools } = toolsWith(({ method }) => {
      if (method === 'session.input.get') {
        return { sessionId: 's-1', taskId: 't-1', input: { status: 'completed', error: null } };
      }
      if (method === 'session.get') {
        return { session: { activity: 'idle', currentTaskId: 't-1', queuedInputs: 0, blocked: null } };
      }
      if (method === 'interaction.list') return { interactions: [] };
      if (method === 'task.get') {
        return {
          task: { taskId: 't-1', type: 'write', phase: 'review', status: 'active', revision: 3 },
          members: [
            {
              sessionId: 's-review',
              roleId: 'reviewer',
              phase: 'review',
              label: 'Review',
              activity: 'idle',
              lastInputStatus: 'completed',
            },
          ],
          results: [{ resultId: 'r-1', kind: 'review', verdict: 'failed', summary: 'two findings', sessionId: 's-review', createdAt: '2026-10-28T00:00:00Z' }],
        };
      }
      if (method === 'task.list') return { tasks: [], nextCursor: null };
      throw new ControlError('NOT_FOUND', method);
    });
    const status = await tools.status({ run_id: 'p-1:i-1' });
    const review = status.steps.find((step) => step.phase === 'review');
    // The input ended normally, but the report says it failed: the step is not a check mark.
    expect(review?.state).toBe('in_progress');
    expect(review?.members[0]?.passed).toBe(false);
  });

  it('tells the caller that an interrupted run needs verification, not another wait', async () => {
    const { tools } = toolsWith(({ method }) => {
      if (method === 'session.input.get') {
        return { sessionId: 's-1', taskId: null, input: { status: 'interrupted', error: null } };
      }
      if (method === 'session.get') {
        return { session: { activity: 'idle', currentTaskId: null, queuedInputs: 0, blocked: null } };
      }
      if (method === 'interaction.list') return { interactions: [] };
      if (method === 'task.list') return { tasks: [], nextCursor: null };
      throw new ControlError('NOT_FOUND', method);
    });
    const status = await tools.status({ run_id: 'p-1:i-1' });
    expect(status.status).toBe('unknown');
    expect(status.summary).toContain('verify the real state');
  });

  it('requires an explicit project on an endpoint that serves many', async () => {
    const control: Control = { call: async () => ({}) };
    const tools = new RunTools({
      control,
      defaultProjectPath: '/tmp/server-cwd',
      caller: 'tests',
      requireProjectPath: true,
    });
    await expect(tools.delegate({ objective: 'do work' })).rejects.toThrow(/project_path is required/);
  });
});
