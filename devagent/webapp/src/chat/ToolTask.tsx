import { useEffect, useRef, useState } from 'react';
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
/** Seconds since this call was first seen running; the design's line counts the wait. */
function useRunningFor(active: boolean): number | undefined {
  const since = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      since.current = null;
      return;
    }
    if (since.current === null) since.current = Date.now();
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return active && since.current !== null ? now - since.current : undefined;
}

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
  const named = sessions.length > 0;
  const head = continuation
    ? t('task.dispatchContinue', { label: sessions[0]?.label ?? first })
    : named
      ? t('task.dispatch', { count: sessions.length })
      : t('task.waitingMembers');

  /**
   * One row per member this call named. The live Task detail is preferred (it carries the real input
   * state); when it is gone - the Task finished and its detail panel is closed - the call's own
   * arguments still name the members, and dropping them would erase who was dispatched.
   */
  const rows: readonly TaskMemberRow[] =
    members !== undefined && members.length > 0
      ? members.map((member) => ({
          sessionId: member.sessionId,
          label: member.label,
          assignment: member.assignment,
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
            assignment: '',
            activity: 'idle' as SessionActivity,
            lastInputStatus: null,
            waitingUser: false,
            note: '',
          }));

  // The card stays open while the work it started is still going: the chief's call returns when its
  // wait expires, but the members keep developing, and folding then hides exactly what the user is
  // watching. A returned call whose members have all stopped folds to one line as before.
  const live = members !== undefined && liveSessions !== undefined && members.some((row) => liveSessions.has(row.sessionId));
  // The wait is counted from the moment this card first shows one, so the sentence keeps moving even
  // after the call itself returned.
  const waited = useRunningFor(status === 'running' || live);
  if (op === 'dispatch' && status !== 'running' && !live) {
    // One line once the call is over: the members it started are no longer this line's business, and
    // the raw result belongs behind a disclosure, not sprawling across the transcript.
    return (
      <details className="fold" data-call-id={callId}>
        <summary className="tline">
          <State kind="done" />
          <span className="tn">{head}</span>
          {/* The design puts the call's own result on this line. Keeping it whole behind the
              disclosure is what makes a long dispatch report readable at all. */}
          {/* A continuation's head already names the member; repeating the labels here read as a
              stutter ("Continue X · X"). The named case still lists who was dispatched. */}
          <span className="ts">
            {!continuation && named ? sessions.map((entry) => entry.label ?? entry.sessionId).join(' · ') : ''}
          </span>
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

  // The open card is the design's `.obj.disp`: one sentence saying what is being waited for, then
  // the members and their live state.
  return (
    <div
      className={`obj disp ${status === 'running' ? 'running' : 'ok'}`}
      data-call-id={callId}
      data-call-status={status}
      data-step={live ? 'live' : 'settled'}
    >
      <div className="row">
        <b>{head}</b>
        <span className="sp" />
        {status === 'running' || live ? (
          <State kind="run">
            {waited === undefined
              ? t('task.waitingMembers')
              : t('task.waitingStep', { elapsed: `${(waited / 1000).toFixed(1)}s` })}
          </State>
        ) : status === 'ok' ? (
          <span className="ts" title={resultText ?? ''}>
            {resultText ?? ''}
          </span>
        ) : (
          <State kind="wait">{t('task.preparing')}</State>
        )}
      </div>
      <TaskMemberRows rows={rows} onFollow={(sessionId) => onFollow?.(sessionId)} testId="task-dispatch-members" />
    </div>
  );
}
