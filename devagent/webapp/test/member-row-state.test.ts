/**
 * The member row must agree with the step it sits in (X-04): a member whose latest report failed is
 * not "done", however normally its input ended.
 */
import { describe, expect, it } from 'vitest';
import { memberRowState } from '../src/chat/TaskTodo';
import type { TaskMemberRow } from '../src/chat/task-labels';

const row = (over: Partial<TaskMemberRow>): TaskMemberRow => ({
  sessionId: 's-1',
  label: 'Reviewer',
  phase: 'review',
  assignment: '',
  activity: 'idle',
  lastInputStatus: 'completed',
  latestVerdict: null,
  note: '',
  ...over,
});

describe('a member row', () => {
  it('is not done when its finished input delivered a failed report', () => {
    expect(memberRowState(row({ latestVerdict: 'failed' }))).toEqual({ kind: 'block', note: 'failed' });
    // The same row when the input itself failed: still an unfinished step, still "Not passed".
    expect(memberRowState(row({ lastInputStatus: 'failed', latestVerdict: null }))).toEqual({
      kind: 'block',
      note: 'failed',
    });
  });
  it('is not done when the settled input has no formal report', () => {
    expect(memberRowState(row({ reportMissing: true }))).toEqual({ kind: 'block', note: 'missingReport' });
  });


  it('is done only when the input ended and no report says otherwise', () => {
    expect(memberRowState(row({ latestVerdict: null }))).toEqual({ kind: 'done', note: 'done' });
    expect(memberRowState(row({ latestVerdict: 'passed' }))).toEqual({ kind: 'done', note: 'done' });
  });

  it('asks the user when the report is blocked, and shows work in progress while running', () => {
    expect(memberRowState(row({ latestVerdict: 'blocked' })).kind).toBe('decide');
    expect(memberRowState(row({ activity: 'processing', lastInputStatus: null }))).toEqual({ kind: 'run', note: 'running' });
    expect(memberRowState(row({ activity: 'queued', lastInputStatus: null })).kind).toBe('wait');
  });
});
