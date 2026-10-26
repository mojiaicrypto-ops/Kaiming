import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { Markdown } from './Markdown';
import { parseArgs } from './transcript-model';
import { ToolCard } from './ToolCard';
import type { ToolStatus } from './ToolCard';

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
  /** Kept for the transcript call site; live member state lives in the task list, not here. */
  readonly members?: readonly unknown[] | undefined;
  readonly liveSessions?: ReadonlySet<string> | undefined;
  readonly onFollow?: ((sessionId: string) => void) | undefined;
  readonly phase: string;
  readonly summaryText?: string | undefined;
}

/**
 * The four task tool calls, each exactly one line in the transcript (D3/D5/D6/D7, Q3): `create`
 * folds its plan behind the line, `dispatch` names who was sent and hides its raw result behind
 * the same disclosure, `update`/`end` are event lines. The ROSTER is not here: the task list
 * block in the conversation owns live member state, so a member is never described twice.
 */
export function ToolTask({ callId, op, args, status, resultText, elapsedMs, taskId, planMarkdown, onFollow: _onFollow, phase, summaryText }: ToolTaskProps) {
  const { t } = useI18n();
  const phaseLabelOf = (name: string): string => t(`task.${name}` as 'task.plan');
  const parsed = parseArgs(args) ?? {};
  const phaseName = typeof parsed['phase'] === 'string' ? parsed['phase'] : phase;

  if (op === 'update' && status === 'ok') {
    const text = typeof parsed['summary'] === 'string' ? parsed['summary'] : summaryText ?? '';
    return (
      <div className="ev">
        {t('task.entered', { phase: phaseLabelOf(phaseName) })}
        {text === '' ? '' : ` · ${text}`}
      </div>
    );
  }

  if (op === 'end' && status === 'ok') {
    return <div className="ev">{t('task.ended')}</div>;
  }

  if (op === 'create' && status === 'ok') {
    const lines = planMarkdown === undefined ? 0 : planMarkdown.split('\n').filter((line) => line.trim() !== '').length;
    return (
      <details className="fold" data-call-id={callId} data-testid="task-create">
        <summary className="tline">
          <State kind="done" />
          <span className="tn">
            {t('task.created')} {taskId ?? ''}
          </span>
          <span className="ts">{lines > 0 ? t('task.planLines', { count: lines }) : ''}</span>
          <span className="tt">{elapsedMs === undefined ? '' : `${(elapsedMs / 1000).toFixed(1)}s`}</span>
        </summary>
        {planMarkdown !== undefined && planMarkdown !== '' && (
          <div className="obj-b">
            <Markdown text={planMarkdown} />
          </div>
        )}
      </details>
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

  if (op === 'dispatch') {
    // Always one line, whatever the call's state: while it runs the task list below carries the
    // live roster; once it returns, this line is the record of who was ordered, when.
    return (
      <details className="fold" data-call-id={callId}>
        <summary className="tline" data-call-status={status}>
          {status === 'running' ? <State kind="run" /> : status === 'failed' ? <State kind="block" /> : <State kind="done" />}
          <span className="tn">{head}</span>
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

  // Anything the shapes above do not cover — a failed create, an unknown op, an argument set the
  // server rejected — still has to be visible: a tool call that vanishes takes its error with it.
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
