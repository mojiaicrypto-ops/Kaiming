import { useI18n } from '../i18n/I18nProvider';
import type { SessionActivity } from '../api/stream';
import { MESSAGE_KEYS } from '../i18n/catalog';

/** The phase names a Task really has, and the label each one shows. */
const PHASE_KEY = {
  clarify: 'task.clarify',
  analyze: 'task.analyze',
  design: 'task.design',
  plan: 'task.plan',
  develop: 'task.develop',
  review: 'task.review',
  test: 'task.test',
  settle: 'task.settle',
} as const;

export function usePhaseLabel(): (phase: string) => string {
  const { t } = useI18n();
  return (phase: string): string => {
    const key = PHASE_KEY[phase as keyof typeof PHASE_KEY];
    return key === undefined ? phase : t(key);
  };
}

/** What the transcript knows about one member of a step, for its row. */
export interface TaskMemberRow {
  readonly sessionId: string;
  /** The role, the way the design names a member: short enough for its own column. */
  readonly label: string;
  /** The step this member works in: the roster groups by it and counts re-entry rounds. */
  readonly phase: string;
  /** What the chief asked this member to do; shown when there is no live note to show instead. */
  readonly assignment: string;
  readonly activity: SessionActivity;
  readonly lastInputStatus: 'completed' | 'failed' | 'stopped' | 'interrupted' | null;
  readonly reportMissing?: boolean;
  /** Latest delegation window: start when delivered, end when it settled. */
  readonly executionStartedAt?: string | null;
  readonly executionEndedAt?: string | null;
  readonly latestVerdict?: string | null;
  readonly waitingUser?: boolean;
  readonly note: string;
  /** The terminal errorCode of the member's latest input, when the input failed. */
  readonly errorCode?: string | null;
}

/** The catalog key for a terminal error code, or null when no sentence exists for it. */
export function catalogErrorKey(code: string | null | undefined): 'error.blocked_config' | null {
  if (code === null || code === undefined || code === '') return null;
  return MESSAGE_KEYS.includes(`error.${code}` as never) ? (`error.${code}` as 'error.blocked_config') : null;
}

/**
 * The reason a member's input failed, when the terminal error code has a catalog sentence: shown
 * on the roster row for a failed member (the raw code stays visible for unknown codes) and for a
 * member whose report is missing (the sentence says WHY it is missing — the 11-14 degeneration
 * budget vs an instruction-shaped REPORT_MISSING read differently). Null when there is no
 * resolvable code, so the row keeps its generic note.
 */
export function reportReasonOf(
  row: Pick<TaskMemberRow, 'lastInputStatus' | 'errorCode'>,
  t: (key: 'error.blocked_config' | 'task.state.failed') => string,
): string | null {
  if (row.lastInputStatus !== 'failed') return null;
  if (row.errorCode === null || row.errorCode === undefined || row.errorCode === '') return null;
  const key = catalogErrorKey(row.errorCode);
  return key === null ? null : t(key);
}
