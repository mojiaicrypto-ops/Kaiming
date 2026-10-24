import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { Markdown } from './Markdown';
import { parseArgs } from './transcript-model';
import { ToolCard } from './ToolCard';
import type { ToolStatus } from './ToolCard';
import type { SessionActivity } from '../api/stream';

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

export interface TaskMemberRow {
  readonly sessionId: string;
  readonly label: string;
  readonly activity: SessionActivity;
  readonly lastInputStatus: 'completed' | 'failed' | 'stopped' | 'interrupted' | null;
  readonly waitingUser?: boolean;
  readonly note: string;
}

export interface ToolTaskProps {
  /** The call's own id, so a fallback card can be matched to its result. */
  readonly callId: string;
  readonly op: string;
  readonly args: string;
  readonly status: ToolStatus;
  readonly resultText?: string | undefined;
  readonly elapsedMs?: number | undefined;
  readonly taskId?: string | undefined;
  readonly planMarkdown?: string | undefined;
  readonly members?: readonly TaskMemberRow[] | undefined;
  readonly onFollow?: ((sessionId: string) => void) | undefined;
  readonly phase: string;
  readonly summaryText?: string | undefined;
}

/**
 * The four task tool calls, each drawn at its own weight: `create` shows the plan itself, `update`
 * collapses to one event line, `dispatch` shows the members and their live state, `end` is a
 * closing event. Collapsing a finished call to one line is the point — a completed Task must not
 * keep a wall of text in the middle of a conversation (D3/D5/D6/D7).
 */
export function ToolTask({ callId, op, args, status, resultText, elapsedMs, taskId, planMarkdown, members, onFollow, phase, summaryText }: ToolTaskProps) {
  const { t } = useI18n();
  const phaseLabel = usePhaseLabel();
  const parsed = parseArgs(args) ?? {};
  const phaseName = typeof parsed['phase'] === 'string' ? parsed['phase'] : phase;

  if (op === 'update' && status === 'ok') {
    const text = typeof parsed['summary'] === 'string' ? parsed['summary'] : summaryText ?? '';
    return (
      <div className="ev">
        {t('task.entered', { phase: phaseLabel(phaseName) })}
        {text === '' ? '' : ` · ${text}`}
      </div>
    );
  }

  if (op === 'end' && status === 'ok') {
    return <div className="ev">{t('task.ended')}</div>;
  }

  if (op === 'create' && status === 'ok') {
    return (
      <div className="obj">
        <div className="row">
          <State kind="done" />
          <b>
            {t('task.created')} {taskId ?? ''}
          </b>
          <span className="f3">{typeof parsed['requirementId'] === 'string' ? parsed['requirementId'] : ''}</span>
          <span className="sp" />
        </div>
        {planMarkdown !== undefined && planMarkdown !== '' && (
          <div className="obj-b">
            <Markdown text={planMarkdown} />
          </div>
        )}
      </div>
    );
  }

  const sessions = Array.isArray(parsed['sessions'])
    ? (parsed['sessions'] as Array<{ sessionId?: string; label?: string }>)
    : [];
  const first = sessions[0]?.sessionId;
  const head =
    typeof first === 'string' && first !== ''
      ? t('task.dispatchContinue', { label: sessions[0]?.label ?? first })
      : t('task.dispatch', { count: sessions.length });

  /**
   * One row per member this call named. The live Task detail is preferred (it carries the real input
   * state); when it is gone - the Task finished and its detail panel is closed - the call's own
   * arguments still name the members, and dropping them would erase who was dispatched.
   */
  const rows: ReadonlyArray<{
    sessionId: string;
    label: string;
    activity: SessionActivity;
    lastInputStatus: 'completed' | 'failed' | 'stopped' | 'interrupted' | null;
    waitingUser: boolean;
    note: string;
  }> =
    members !== undefined && members.length > 0
      ? members.map((member) => ({
          sessionId: member.sessionId,
          label: member.label,
          activity: member.activity,
          lastInputStatus: member.lastInputStatus,
          waitingUser: member.waitingUser === true,
          note: member.note,
        }))
      : sessions
          .filter((entry): entry is { sessionId: string; label?: string } => typeof entry.sessionId === 'string')
          .map((entry) => ({
            sessionId: entry.sessionId,
            label: entry.label ?? entry.sessionId,
            activity: 'idle' as SessionActivity,
            lastInputStatus: null,
            waitingUser: false,
            note: '',
          }));

  // A dispatch that is still running keeps its card open and lists the members it started; only a
  // returned call folds to one line, because then the rows would claim live work that already ended.
  if (op === 'dispatch' && status !== 'running') {
    // One line once the call is over: the members it started are no longer this line's business, and
    // the raw result belongs behind a disclosure, not sprawling across the transcript.
    return (
      <details className="tc" data-call-id={callId}>
        <summary>
          <State kind="done" />
          <span className="tn">{head}</span>
          <span className="ts">{sessions.length > 0 ? sessions.map((entry) => entry.label ?? entry.sessionId).join(' · ') : ''}</span>
          <span className="tt">{elapsedMs === undefined ? '' : `${(elapsedMs / 1000).toFixed(1)}s`}</span>
        </summary>
        <div className="tc-sec">{t('tool.output')}</div>
        <pre className="tc-out">{resultText ?? ''}</pre>
      </details>
    );
  }

  if (op !== 'dispatch') {
    // Anything the four shapes above do not cover — a failed create, an unknown op, an argument
    // set the server rejected — still has to be visible: a tool call that vanishes takes its
    // error with it, and the user cannot tell a refusal from a silent success.
    return (
      <ToolCard
        name={`task ${op}`.trim()}
        callId={callId}
        args={args}
        status={status}
        resultText={resultText}
        elapsedMs={elapsedMs}
      />
    );
  }

  return (
    <div className={`obj disp ${status === 'running' ? 'running' : 'ok'}`} data-call-id={callId}>
      <div className="row">
        <b>{head}</b>
        <span className="sp" />
        {status === 'running' ? (
          <State kind="run">{t('task.waitingStep', { elapsed: `${((elapsedMs ?? 0) / 1000).toFixed(1)}s` })}</State>
        ) : (
          // "Preparing to dispatch" described a moment that had already ended: the call is over,
          // and what it produced is the sentence beside the head (including a refusal).
          <State kind="wait">{t('task.dispatched')}</State>
        )}
      </div>
      <div className="mlist">
        {rows.map((row) => (
          <button
            key={row.sessionId}
            type="button"
            className="mrow"
            onClick={() => onFollow?.(row.sessionId)}
            disabled={onFollow === undefined}
          >
            <MemberState activity={row.activity} lastInputStatus={row.lastInputStatus} waitingUser={row.waitingUser} />
            <span className="ml">{row.label}</span>
            <span className="mn ell">{row.note}</span>
            <span className="mo">{t('chat.member.follow')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MemberState({
  activity,
  lastInputStatus,
  waitingUser,
}: {
  activity: SessionActivity;
  lastInputStatus: 'completed' | 'failed' | 'stopped' | 'interrupted' | null;
  waitingUser: boolean;
}) {
  const { t } = useI18n();
  if (waitingUser) return <State kind="decide">{t('task.waitingYou')}</State>;
  if (activity === 'processing') return <State kind="run">{t('tool.running')}</State>;
  if (activity === 'queued') return <State kind="wait">{t('queue.queued')}</State>;
  if (lastInputStatus === 'completed') return <State kind="done">{t('tool.done')}</State>;
  if (lastInputStatus === 'failed') return <State kind="block">{t('tool.failed')}</State>;
  if (lastInputStatus === 'stopped' || lastInputStatus === 'interrupted') return <State kind="paused">{t('task.paused')}</State>;
  return <State kind="idle">{t('common.none')}</State>;
}
