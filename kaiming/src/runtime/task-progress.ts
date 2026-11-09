/**
 * The Task's flow as data, for callers outside the browser (MCP) — the same rule the task strip and
 * the task list draw: real phase-rounds first, a phase that reappears is a rework round, and the
 * declaration's remaining steps follow in canonical order. The webapp keeps its own copy because the
 * two builds do not import each other; `test-fixtures/task-progress.json` pins both to one answer.
 */

/** Canonical phase order: how far along a phase sits, for the planned tail. */
export const PHASE_ORDER = ['clarify', 'analyze', 'design', 'plan', 'develop', 'review', 'test', 'settle'] as const;

export type ProgressState = 'completed' | 'in_progress' | 'planned';

export interface ProgressMember {
  readonly phase: string;
  /** The member session, when the caller has one: it is how a report verdict is matched back. */
  readonly sessionId?: string;
  readonly roleId: string;
  readonly label: string;
  /** 'processing' | 'queued' | 'stopping' | 'idle' — derived, never stored (R2). */
  readonly activity: string;
  /** How the member's own input ended, when it ended at all. */
  readonly lastInputStatus: string | null;
  /** True when the input settled without the formal report this member was dispatched for. */
  readonly reportMissing?: boolean;
  /**
   * The verdict of the member's latest formal report, or null when it has none. An input that ended
   * normally is not a pass: a reviewer can finish its turn with `verdict=failed`.
   */
  readonly latestVerdict?: string | null;
}

/** Did this member actually pass: its input ended normally, delivered its report, and that report agrees. */
export function memberPassed(member: {
  readonly lastInputStatus: string | null;
  readonly reportMissing?: boolean;
  readonly latestVerdict?: string | null;
}): boolean {
  if (member.reportMissing === true) return false;
  const verdict = member.latestVerdict ?? null;
  return member.lastInputStatus === 'completed' && verdict !== 'failed' && verdict !== 'blocked';
}

export interface ProgressStep {
  readonly phase: string;
  /** 1-based rework round of this phase; the planned tail uses 1 because it has not run yet. */
  readonly round: number;
  readonly state: ProgressState;
  readonly members: readonly {
    readonly sessionId?: string;
    readonly roleId: string;
    readonly label: string;
    readonly activity: string;
    readonly lastInputStatus: string | null;
    /** A member that ended without a completed report is the evidence a rework is needed. */
    readonly passed: boolean;
  }[];
}

export interface ProgressInput {
  readonly task: {
    readonly type: string;
    readonly workKind?: string | undefined;
    readonly phase: string;
    readonly status: string;
    readonly requiresTest?: boolean | undefined;
  };
  /** Members in latest-dispatch order, as the store returns them (a continuation moves its row last). */
  readonly members: readonly ProgressMember[];
}

/**
 * The steps a write Task still owes from its own declaration: review, test only when the chief
 * declared requiresTest, then settle. Only phases after the furthest step actually reached are
 * listed, so rework never re-plans a phase that already ran. Read Tasks owe nothing.
 */
export function plannedTail(
  task: {
    readonly type: string;
    readonly phase: string;
    readonly requiresTest?: boolean | undefined;
    readonly workKind?: string | undefined;
  },
  phasesSoFar: readonly string[],
): readonly string[] {
  if (task.type !== 'write') return [];
  const test = task.requiresTest === true ? ['test'] : [];
  const kind = task.workKind;
  if (kind === undefined) {
    const index = (phase: string): number => PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
    const reach = Math.max(index(task.phase), ...phasesSoFar.map(index));
    return ['review', ...test, 'settle'].filter((phase) => index(phase) > reach);
  }
  const sequence =
    kind === 'design'
      ? ['clarify', 'analyze', 'design', 'review', 'settle']
      : kind === 'document'
        ? ['plan', 'design', 'review', 'settle']
        : kind === 'implement'
          ? task.phase === 'design'
            ? ['design', 'develop', 'review', ...test, 'settle']
            : ['plan', 'develop', 'review', ...test, 'settle']
          : [];
  if (sequence.length === 0) return [];
  const positions = [task.phase, ...phasesSoFar]
    .map((phase) => sequence.indexOf(phase))
    .filter((position) => position >= 0);
  const reach = positions.length === 0 ? -1 : Math.max(...positions);
  return sequence.slice(reach + 1);
}

/**
 * Phase-round groups: consecutive members of the same phase are one step, and a phase that comes
 * back after a different phase is a new round. The Task's own phase, when no member sits there yet,
 * is the frontier step.
 */
export function rosterGroups(members: readonly ProgressMember[], currentPhase: string): Array<{
  readonly phase: string;
  readonly round: number;
  readonly rows: readonly ProgressMember[];
}> {
  const groups: Array<{ phase: string; round: number; rows: ProgressMember[] }> = [];
  const rounds = new Map<string, number>();
  let previous = '';
  for (const member of members) {
    if (member.phase !== previous) {
      const round = (rounds.get(member.phase) ?? 0) + 1;
      rounds.set(member.phase, round);
      groups.push({ phase: member.phase, round, rows: [member] });
      previous = member.phase;
    } else {
      const last = groups[groups.length - 1];
      if (last !== undefined) last.rows.push(member);
    }
  }
  if (currentPhase !== '' && currentPhase !== previous) {
    groups.push({ phase: currentPhase, round: (rounds.get(currentPhase) ?? 0) + 1, rows: [] });
  }
  return groups;
}

/** A Task's flow: real steps (with rework rounds) followed by the steps it still owes. */
export function taskProgress(input: ProgressInput): {
  readonly steps: readonly ProgressStep[];
  readonly stepsDone: number;
  readonly stepsTotal: number;
} {
  const groups = rosterGroups(input.members, input.task.phase);
  const steps: ProgressStep[] = groups.map((group) => ({
    phase: group.phase,
    round: group.round,
    // The frontier group has no members yet, and a member that failed its review is not a check.
    state: group.rows.length > 0 && group.rows.every(memberPassed) ? 'completed' : 'in_progress',
    members: group.rows.map((row) => ({
      ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
      roleId: row.roleId,
      label: row.label,
      activity: row.activity,
      lastInputStatus: row.lastInputStatus,
      passed: memberPassed(row),
    })),
  }));
  // A Task that is not moving does not promise the rest of its plan.
  const moving =
    input.task.status !== 'paused' &&
    input.task.status !== 'pausing' &&
    input.task.status !== 'cancelled' &&
    input.task.status !== 'completed';
  const planned = moving ? plannedTail(input.task, groups.map((group) => group.phase)) : [];
  const withTail: ProgressStep[] = [
    ...steps,
    ...planned.map((phase): ProgressStep => ({ phase, round: 1, state: 'planned', members: [] })),
  ];
  return {
    steps: withTail,
    stepsDone: steps.filter((step) => step.state === 'completed').length,
    stepsTotal: withTail.length,
  };
}
