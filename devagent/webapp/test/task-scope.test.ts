import { describe, expect, it } from 'vitest';
import { taskForSession } from '../src/state/task-scope';

describe('task state ownership', () => {
  it('does not expose the previous session Task after switching', () => {
    const detail = { taskId: 't-old' };
    expect(taskForSession(detail, 's-old', 's-new')).toBeNull();
    expect(taskForSession('t-old', 's-old', 's-new')).toBeNull();
  });

  it('keeps the Task while the owning session is current, and clears it with no owner', () => {
    const detail = { taskId: 't-1' };
    expect(taskForSession(detail, 's-1', 's-1')).toBe(detail);
    expect(taskForSession(detail, null, 's-1')).toBeNull();
    expect(taskForSession(detail, 's-1', null)).toBeNull();
  });
});
