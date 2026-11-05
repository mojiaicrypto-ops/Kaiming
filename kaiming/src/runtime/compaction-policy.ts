/**
 * The proactive compaction policy: whether the next input should compact before it is delivered.
 * Pi's own auto-compaction stays enabled as a backstop near the window limit; this policy is the
 * earlier, user-configured percentage.
 */
export interface CompactionPolicy {
  readonly auto: boolean;
  /** Window percentage (0–100) at which the next input compacts first. */
  readonly thresholdPercent: number;
}

/** A reading at or above the threshold compacts; `null` (right after compaction) never does. */
export function compactionDue(percent: number | null | undefined, policy: CompactionPolicy): boolean {
  return policy.auto && percent !== null && percent !== undefined && percent >= policy.thresholdPercent;
}
