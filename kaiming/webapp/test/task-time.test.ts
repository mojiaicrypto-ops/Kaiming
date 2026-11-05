import { describe, expect, it } from 'vitest';
import { elapsed } from '../src/chat/transcript-model';
import { taskEndedAt } from '../src/chat/task-time';

describe('task timing', () => {
  it('formats short and long execution windows', () => {
    expect(elapsed(820)).toBe('820ms');
    expect(elapsed(1_400)).toBe('1.4s');
    expect(elapsed(62_000)).toBe('1m 02s');
    expect(elapsed(3_900_000)).toBe('1h 05m');
  });

  it('stops the Task clock at the last recorded state only when it is not moving', () => {
    const updatedAt = '2026-11-05T10:00:00.000Z';
    expect(taskEndedAt({ status: 'active', updatedAt })).toBeNull();
    expect(taskEndedAt({ status: 'completed', updatedAt })).toBe(updatedAt);
    expect(taskEndedAt({ status: 'cancelled', updatedAt })).toBe(updatedAt);
    expect(taskEndedAt({ status: 'paused', updatedAt })).toBe(updatedAt);
  });
});
