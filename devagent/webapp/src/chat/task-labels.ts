import { useI18n } from '../i18n/I18nProvider';
import type { SessionActivity } from '../api/stream';

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
  readonly waitingUser?: boolean;
  readonly note: string;
}
