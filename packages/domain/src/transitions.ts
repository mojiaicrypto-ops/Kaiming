/**
 * Legal state transitions (`docs/rules/workflow.md` §5).
 *
 * Each table is exhaustive: a transition that is not listed is rejected, which is
 * what makes "failed只能启动同Work的新Run尝试" and "离开running的Attempt不可重写其
 * 证据" enforceable in one place.
 */
import type {
  AttemptStatus,
  Phase,
  RequirementState,
  RunStatus,
  TaskStage,
  WorkStatus,
} from '@agentdev/contracts';

type TransitionTable<T extends string> = Readonly<Record<T, readonly T[]>>;

/** `Work.status` — `workflow.md` §5.1. */
export const WORK_TRANSITIONS = {
  queued: ['running'],
  running: ['blocked', 'paused', 'cancelling', 'completed', 'failed'],
  blocked: ['running'],
  paused: ['running'],
  cancelling: ['cancelled', 'blocked'],
  // Terminal states only lead to a new Work attempt, never back into this row.
  cancelled: [],
  failed: [],
  completed: [],
} as const satisfies TransitionTable<WorkStatus>;

/** `Requirement.lifecycle` — `workflow.md` §5.1 and `requirements.md` §4. */
export const REQUIREMENT_TRANSITIONS = {
  queued: ['active', 'archived', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: ['archived'],
  cancelled: [],
  archived: [],
} as const satisfies TransitionTable<RequirementState>;

/** `Task.stage` — the route decides whether review goes to `done` or `test`. */
export const TASK_TRANSITIONS = {
  ready: ['develop'],
  develop: ['review'],
  // "Review或Test失败返回develop"（workflow.md §5.2），通过则前进；L1 与文档路线
  // review 直接 done。
  review: ['test', 'done', 'develop'],
  test: ['done', 'develop'],
  // 引用的产品/Plan/代码失效时重开 ready。
  done: ['ready'],
} as const satisfies TransitionTable<TaskStage>;

/** `Run.status` — `workflow.md` §5.3; terminal states are absorbing. */
export const RUN_TRANSITIONS = {
  queued: ['starting', 'cancelled'],
  starting: ['running', 'failed', 'cancelled', 'interrupted'],
  running: [
    'waiting_permission',
    'waiting_children',
    'paused',
    'interrupted',
    'recovery_required',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
    'contract_violation',
  ],
  waiting_permission: ['running', 'paused', 'cancelled', 'failed'],
  waiting_children: ['running', 'paused', 'cancelled', 'failed'],
  paused: ['running', 'cancelled'],
  interrupted: ['starting', 'recovery_required', 'cancelled'],
  recovery_required: ['starting', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  contract_violation: [],
} as const satisfies TransitionTable<RunStatus>;

/** `Attempt.status` — `workflow.md` §5.3; evidence cannot be rewritten later. */
export const ATTEMPT_TRANSITIONS = {
  starting: ['running', 'failed', 'lost', 'stopped'],
  running: ['completed', 'failed', 'lost', 'stopped'],
  stopped: [],
  completed: [],
  failed: [],
  lost: [],
} as const satisfies TransitionTable<AttemptStatus>;

/** `Requirement.phase` progression for active requirements. */
export const PHASE_ORDER = ['product', 'plan', 'execute', 'accept', 'settle'] as const;
export type PhaseName = (typeof PHASE_ORDER)[number];

function canTransition<T extends string>(table: TransitionTable<T>, from: T, to: T): boolean {
  return (table[from] as readonly T[]).includes(to);
}

export const canTransitionWork = (from: WorkStatus, to: WorkStatus): boolean =>
  canTransition(WORK_TRANSITIONS, from, to);

export const canTransitionRequirement = (from: RequirementState, to: RequirementState): boolean =>
  canTransition(REQUIREMENT_TRANSITIONS, from, to);

export const canTransitionTask = (from: TaskStage, to: TaskStage): boolean =>
  canTransition(TASK_TRANSITIONS, from, to);

export const canTransitionRun = (from: RunStatus, to: RunStatus): boolean =>
  canTransition(RUN_TRANSITIONS, from, to);

export const canTransitionAttempt = (from: AttemptStatus, to: AttemptStatus): boolean =>
  canTransition(ATTEMPT_TRANSITIONS, from, to);

/** Terminal Run states never restart; later work creates a new Run. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'contract_violation',
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

/** A Run that left `running` cannot be revived; recovery opens a new Attempt. */
export function runAcceptsNewAttempt(status: RunStatus): boolean {
  return status === 'interrupted' || status === 'recovery_required' || status === 'paused';
}

/**
 * Phases only move forward, and only an active requirement has a phase.
 *
 * `Phase` and `PhaseName` are the same union, so the lookup needs no cast; the
 * `-1` guards keep a future enum change fail-closed.
 */
export function canAdvancePhase(from: Phase, to: Phase): boolean {
  const fromIndex = PHASE_ORDER.indexOf(from);
  const toIndex = PHASE_ORDER.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return false;
  return toIndex >= fromIndex;
}

/** Restoring an archived requirement returns it to its recorded previous state. */
export function restoreTarget(previous: 'queued' | 'completed' | undefined): RequirementState {
  return previous ?? 'queued';
}
