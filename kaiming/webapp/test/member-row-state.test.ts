/**
 * The member row must agree with the step it sits in (X-04): a member whose latest report failed is
 * not "done", however normally its input ended. The failed member's reason resolves the terminal
 * error code for the user: a known catalog sentence, null otherwise (the row keeps its note).
 */
import { describe, expect, it } from 'vitest';
import { memberRowState } from '../src/chat/TaskTodo';
import { reportReasonOf } from '../src/chat/task-labels';
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

describe('the failed member reason resolves the terminal error code for the user', () => {
  const t = (key: 'error.blocked_config' | 'task.state.failed'): string =>
    ({
      'error.REPORT_RETRY_EXHAUSTED': '报告连续失败，重试预算已用尽，运行已终止',
      'error.blocked_config': '没有可用模型',
      'task.state.failed': '运行失败',
    })[key] ?? key;

  it('shows the catalog sentence for a known terminal code on a plain failure', () => {
    expect(reportReasonOf({ lastInputStatus: 'failed', errorCode: 'REPORT_RETRY_EXHAUSTED' }, t)).toBe(
      '报告连续失败，重试预算已用尽，运行已终止',
    );
  });
  it('resolves the reason for a missing report too — the sentence says WHY it is missing', () => {
    // The incident case: a degenerate member's row shows Report missing; the reason sentence
    // distinguishes the retry budget from an instruction-shaped REPORT_MISSING.
    expect(reportReasonOf({ lastInputStatus: 'failed', errorCode: 'REPORT_RETRY_EXHAUSTED' }, t)).toBe(
      '报告连续失败，重试预算已用尽，运行已终止',
    );
    expect(reportReasonOf({ lastInputStatus: 'failed', errorCode: 'REPORT_MISSING' }, t)).toBeNull();
  });
  it('returns null for an unknown code so the row keeps its generic note', () => {
    expect(reportReasonOf({ lastInputStatus: 'failed', errorCode: 'SOMETHING_NEW' }, t)).toBeNull();
  });
  it('returns null when the input carries no code or did not fail', () => {
    expect(reportReasonOf({ lastInputStatus: 'failed' }, t)).toBeNull();
    expect(reportReasonOf({ lastInputStatus: 'completed', errorCode: 'REPORT_RETRY_EXHAUSTED' }, t)).toBeNull();
  });
});
