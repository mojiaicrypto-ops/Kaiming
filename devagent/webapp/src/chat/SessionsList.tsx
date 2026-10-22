import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { SessionRow } from '../state/useWorkspace';
import { relativeDay } from './transcript-model';

export interface SessionsListProps {
  readonly rows: readonly SessionRow[];
  readonly current: string;
  readonly onSelect: (sessionId: string) => void;
  readonly onCreate: () => void;
  readonly questionCount: (sessionId: string) => number;
  /** True when the server reported another page: the rail must not silently stop at one page. */
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  /** Sheet form (compact viewports): the same rows, opened over the transcript. */
  readonly className?: string;
}

/**
 * The session rail. Each row's glyph is the state that matters most for picking a conversation:
 * a waiting question beats a running Task, which beats "done". Titles are derived from the first
 * user message (the server keeps no title), so a fresh session reads as "New session" instead of
 * exposing an id nobody recognises.
 */
/** Today shows a clock, yesterday its word, anything older a short date; unknown stays blank. */
function dayLabel(iso: string | null, t: (key: 'chat.today' | 'chat.yesterday') => string): string {
  if (iso === null || iso === '') return '';
  const bucket = relativeDay(iso);
  if (bucket === 'today') {
    const date = new Date(iso);
    return t('chat.today').replace('{time}', `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
  }
  if (bucket === 'yesterday') return t('chat.yesterday');
  if (bucket === 'older') {
    const date = new Date(iso);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return '';
}

export function SessionsList({ rows, current, onSelect, onCreate, questionCount, hasMore, onLoadMore, className }: SessionsListProps) {
  const { t } = useI18n();
  return (
    <aside className={`sessions${className === undefined ? '' : ` ${className}`}`} aria-label={t('aria.sessionList')}>
      <div className="h">{t('chat.sessions')}</div>
      {rows.map((row) => {
        const questions = questionCount(row.sessionId);
        // The glyph is the state that matters most for picking a conversation: a question, then a
        // Task, then a running or stopping input, then idle.
        const glyph =
          questions > 0
            ? 'decide'
            : row.currentTaskId !== null || row.activity === 'processing'
              ? 'run'
              : row.activity === 'stopping'
                ? 'paused'
                : row.activity === 'queued'
                  ? 'wait'
                  : 'idle';
        return (
          <button
            key={row.sessionId}
            type="button"
            className="s"
            aria-current={row.sessionId === current ? 'true' : undefined}
            onClick={() => onSelect(row.sessionId)}
            data-testid="session-row"
          >
            <State kind={glyph} />
            <span className="ell">{row.title === null || row.title === '' ? t('chat.untitled') : row.title}</span>
            <span className="f3 sess-time">{dayLabel(row.updatedAt, t)}</span>
          </button>
        );
      })}
      {hasMore && (
        <button type="button" className="s more" onClick={onLoadMore} data-testid="session-more">
          <span className="f3">{t('chat.moreSessions')}</span>
        </button>
      )}
      <button type="button" className="new" onClick={onCreate} data-testid="new-session">
        {t('chat.newSession')}
      </button>
    </aside>
  );
}
