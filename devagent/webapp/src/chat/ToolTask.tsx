import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { Markdown } from './Markdown';
import { parseArgs } from './transcript-model';
import { ToolCard } from './ToolCard';
import type { ToolStatus } from './ToolCard';
import type { SessionActivity } from '../api/stream';
import { usePhaseLabel, type TaskMemberRow } from './task-labels';
import { TaskMemberRows } from './TaskLive';

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
  /** Member sessions working right now: their dispatch stays expanded even if the call returned. */
  readonly liveSessions?: ReadonlySet<string> | undefined;
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
export function ToolTask({ callId, op, args, status, resultText, elapsedMs, taskId, planMarkdown, members, liveSessions, onFollow, phase, summaryText }: ToolTaskProps) {
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
  const continuation = typeof first === 'string' && first !== '';
  // A dispatch that named nobody is a pure wait: it reads "Current step" while it is the live card,
  // and "Waited for the step" once it has folded, where member rows are no longer beside it.
  const named = sessions.length > 0;

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

  // The card stays open while the work it started is still going: the chief's call returns when its
  // wait expires, but the members keep developing, and folding then hides exactly what the user is
  // watching. A returned call whose members have all stopped folds to one line as before.
  const live = members !== undefined && liveSessions !== undefined && members.some((row) => liveSessions.has(row.sessionId));
  if (op === 'dispatch' && status !== 'running' && !live) {
    // One line once the call is over: the members it started are no longer this line's business, and
    // the raw result belongs behind a disclosure, not sprawling across the transcript.
    return (
      <details className="tc" data-call-id={callId}>
        <summary>
          <State kind="done" />
          <span className="tn">
            {continuation
              ? t('task.dispatchContinue', { label: sessions[0]?.label ?? first })
              : named
                ? t('task.dispatch', { count: sessions.length })
                : t('task.dispatchWait')}
          </span>
          {/* A continuation's head already names the member; repeating the labels here read as a
              stutter ("Continue X · X"). The named case still lists who was dispatched. */}
          <span className="ts">{!continuation && named ? sessions.map((entry) => entry.label ?? entry.sessionId).join(' · ') : ''}</span>
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

  // The design puts the members directly under the chief's message: the rows are the block, with no
  // header repeating what the sentence above already said.
  return (
    <div
      className={`obj disp ${status === 'running' ? 'running' : 'ok'}`}
      data-call-id={callId}
      data-call-status={status}
      data-step={live ? 'live' : 'settled'}
    >
      <TaskMemberRows rows={rows} onFollow={(sessionId) => onFollow?.(sessionId)} testId="task-dispatch-members" />
    </div>
  );
}
