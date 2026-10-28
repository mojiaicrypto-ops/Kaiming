/** The proactive threshold is a pure decision; Pi's own near-limit compaction stays separate. */
import { describe, expect, it } from 'vitest';
import { compactionDue } from '../src/runtime/compaction-policy.ts';

describe('proactive compaction policy', () => {
  it('compacts at or above the configured percentage', () => {
    expect(compactionDue(70, { auto: true, thresholdPercent: 70 })).toBe(true);
    expect(compactionDue(69.9, { auto: true, thresholdPercent: 70 })).toBe(false);
    expect(compactionDue(100, { auto: true, thresholdPercent: 95 })).toBe(true);
  });

  it('never compacts when auto is off or the reading is unknown', () => {
    expect(compactionDue(90, { auto: false, thresholdPercent: 70 })).toBe(false);
    expect(compactionDue(null, { auto: true, thresholdPercent: 70 })).toBe(false);
    expect(compactionDue(undefined, { auto: true, thresholdPercent: 70 })).toBe(false);
  });
});
