import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { parseArgs, streamedField } from './transcript-model';

export type ToolStatus = 'running' | 'ok' | 'failed' | 'waiting';

export interface ToolCardProps {
  readonly name: string;
  readonly callId: string;
  readonly args: string;
  readonly status: ToolStatus;
  readonly resultText?: string | undefined;
  readonly elapsedMs?: number | undefined;
  readonly liveTail?: string | undefined;
}

/**
 * A generic tool call, collapsed to one line: state glyph, tool name, the one argument that says
 * what it acts on, and how long it took. Expanding shows the full arguments and the output — the
 * structural equivalent of the previous card, drawn in the prototype's vocabulary (D1/D2).
 */
export function ToolCard({ name, callId, args, status, resultText, elapsedMs, liveTail }: ToolCardProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const parsed = parseArgs(args);
  const summary =
    parsed === null
      ? ['command', 'path', 'pattern', 'query'].map((key) => streamedField(args, key)).find((value) => value !== '') ?? args.slice(0, 60)
      : (['command', 'path', 'pattern', 'query', 'title']
          .map((key) => parsed[key])
          .find((value): value is string => typeof value === 'string' && value !== '') ?? '');
  const duration = status === 'running' ? '' : elapsedMs === undefined ? '' : `${(elapsedMs / 1000).toFixed(1)}s`;
  const glyph = status === 'running' ? 'run' : status === 'failed' ? 'block' : status === 'waiting' ? 'wait' : 'done';

  return (
    <>
      <details
        className={`tc ${status === 'running' ? 'running' : status === 'failed' ? 'failed' : ''}`}
        data-call-id={callId}
        open={open}
        onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <State kind={glyph} />
          <span className="tn">{name}</span>
          <span className="ts">{summary}</span>
          <span className="tt">
            {status === 'failed' ? t('tool.failedLead') : ''}
            {duration}
          </span>
        </summary>
        <div className="tc-sec">{t('tool.arguments')}</div>
        <pre>{parsed === null ? args : JSON.stringify(parsed, null, 2)}</pre>
        {resultText !== undefined && resultText !== '' && (
          <>
            <div className="tc-sec">{status === 'failed' ? t('tool.error') : t('tool.output')}</div>
            <pre className={status === 'failed' ? 'err' : ''}>{resultText}</pre>
          </>
        )}
      </details>
      {status === 'running' && liveTail !== undefined && liveTail !== '' && <pre className="tc-tail">{liveTail}</pre>}
    </>
  );
}
