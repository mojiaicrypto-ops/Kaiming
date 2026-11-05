import { describe, expect, it } from 'vitest';
import { flowOf, plannedTail } from '../src/chat/task-flow';

const write = { type: 'write', phase: 'design', status: 'active' as const, requiresTest: false };
const member = (
  phase: string,
  over: Partial<{ activity: string; lastInputStatus: 'completed' | 'failed' | null; reportMissing: boolean; waitingUser: boolean }> = {},
) => ({
  phase,
  activity: over.activity ?? 'idle',
  lastInputStatus: over.lastInputStatus ?? null,
  ...(over.reportMissing === undefined ? {} : { reportMissing: over.reportMissing }),
  ...(over.waitingUser === undefined ? {} : { waitingUser: over.waitingUser }),
});

describe('the flow of a running Task', () => {
  it('draws the step being worked on and the plan it still owes, in one array', () => {
    const flow = flowOf({ task: write, members: [member('design', { activity: 'processing' })], pendingQuestions: 0 });
    // Persona's scenario: design is running, review and settle are owed, test was never declared.
    expect(flow.map((step) => `${step.phase}:${step.kind}`)).toEqual(['design:run', 'review:plan', 'settle:plan']);
  });

  it('marks a step only when every member of it completed', () => {
    const done = flowOf({
      task: { ...write, phase: 'review' },
      members: [member('design', { lastInputStatus: 'completed' })],
      pendingQuestions: 0,
    });
    expect(done[0]).toMatchObject({ phase: 'design', done: true, kind: 'done' });
    // The review step is the frontier: nothing dispatched there yet, not a promise of progress.
    expect(done[1]).toMatchObject({ phase: 'review', done: false, kind: 'wait', members: 0 });
  });

  it('keeps a failed step from reading as finished, and never plans past a reached step', () => {
    const flow = flowOf({
      task: { ...write, phase: 'review', requiresTest: true },
      members: [member('design', { lastInputStatus: 'completed' }), member('review', { lastInputStatus: 'failed' })],
      pendingQuestions: 0,
    });
    expect(flow.map((step) => step.phase)).toEqual(['design', 'review', 'test', 'settle']);
    expect(flow[1]).toMatchObject({ kind: 'block', done: false });
  });
  it('does not mark a step done when a settled member has no formal report', () => {
    const flow = flowOf({
      task: { ...write, phase: 'review' },
      members: [member('review', { lastInputStatus: 'completed', reportMissing: true })],
      pendingQuestions: 0,
    });
    expect(flow[0]).toMatchObject({ phase: 'review', kind: 'block', done: false });
  });


  it('shows rework as a second round of the same phase, and does not re-plan what already ran', () => {
    const flow = flowOf({
      task: { ...write, phase: 'develop', requiresTest: true },
      members: [
        member('develop', { lastInputStatus: 'completed' }),
        member('review', { lastInputStatus: 'failed' }),
        member('develop', { activity: 'processing' }),
      ],
      pendingQuestions: 0,
    });
    expect(flow.map((step) => `${step.phase}#${String(step.round)}:${step.kind}`)).toEqual([
      'develop#1:done',
      'review#1:block',
      'develop#2:run',
      'test#1:plan',
      'settle#1:plan',
    ]);
  });

  it('gives the user turn precedence: an open question outranks every member state', () => {
    const flow = flowOf({
      task: write,
      members: [member('design', { activity: 'processing' })],
      pendingQuestions: 1,
    });
    expect(flow[0]).toMatchObject({ phase: 'design', kind: 'decide' });
  });

  it('promises nothing while the Task is paused', () => {
    const flow = flowOf({ task: { ...write, status: 'paused' }, members: [], pendingQuestions: 0 });
    expect(flow.every((step) => step.kind !== 'plan')).toBe(true);
  });

  it('leaves a read Task without a tail: its flow is whatever the chief runs', () => {
    expect(plannedTail({ type: 'read', phase: 'analyze' }, ['analyze'])).toEqual([]);
    expect(plannedTail({ type: 'write', phase: 'design', requiresTest: true }, ['design'])).toEqual(['review', 'test', 'settle']);
  });
});
