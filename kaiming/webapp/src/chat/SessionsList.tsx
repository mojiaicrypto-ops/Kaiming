import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { SessionRow } from '../state/useWorkspace';
import { relativeDay } from './transcript-model';
import { externalChannelKey, isExternalSession } from './session-channel';

export interface SessionsListProps {
  readonly rows: readonly SessionRow[];
  readonly current: string;
  readonly onSelect: (sessionId: string) => void;
  readonly onCreate: () => void;
  readonly questionCount: (sessionId: string) => number;
  /** True when the server reported another page: the rail must not silently stop at one page. */
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  /**
   * Remove a settled session. The server refuses a session that still owes work or is referenced,
   * and says why; this callback carries that reason back to the user.
   */
  readonly onCleanup: (sessionId: string, revision: number) => Promise<boolean>;
  /** Archive or restore a conversation; archived rows stay readable but leave the main list. */
  readonly onArchive: (sessionId: string, revision: number, archived: boolean) => Promise<boolean>;
  /**
   * Name a conversation. The server stores the name; an empty string restores the derived title.
   * Returns false when the write was refused, so the caller can explain why.
   */
  readonly onRename: (sessionId: string, title: string, revision: number) => Promise<boolean>;
  /** Sheet form (compact viewports): the same rows, opened over the transcript. */
  readonly className?: string;
}

/**
 * The session rail. Each row's glyph is the state that matters most for picking a conversation:
 * a waiting question beats a running Task, which beats "done". A row shows the name the user gave
 * it, or else the first user message the server derives it from, so a fresh session reads as
 * "New session" instead of exposing an id nobody recognises.
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

export function SessionsList({
  rows,
  current,
  onSelect,
  onCreate,
  questionCount,
  hasMore,
  onLoadMore,
  onCleanup,
  onArchive,
  onRename,
  className,
}: SessionsListProps) {
  const { t } = useI18n();
  // Two steps, because deleting a conversation has no undo: the first click only arms the row.
  const [armed, setArmed] = useState<string | null>(null);
  /** The row being renamed and what the input holds; null means no row is in edit mode. */
  const [renaming, setRenaming] = useState<{ sessionId: string; revision: number } | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const commitRename = async (): Promise<void> => {
    if (renaming === null) return;
    const target = renaming;
    setRenaming(null);
    await onRename(target.sessionId, nameDraft, target.revision);
  };
  return (
    <aside className={`sessions${className === undefined ? '' : ` ${className}`}`} aria-label={t('aria.sessionList')}>
      <div className="h">{t('chat.sessions')}</div>
      {rows.filter((row) => row.archivedAt === null).map((row) => {
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
          <div key={row.sessionId} className={`srow${armed === row.sessionId ? ' armed' : ''}`}>
            {renaming !== null && renaming.sessionId === row.sessionId ? (
              <input
                className="inp srn"
                autoFocus
                value={nameDraft}
                maxLength={60}
                aria-label={t('session.rename')}
                data-testid="session-rename-input"
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitRename();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setRenaming(null);
                  }
                }}
                onBlur={() => setRenaming(null)}
              />
            ) : (
              <button
                type="button"
                className="s"
                aria-current={row.sessionId === current ? 'true' : undefined}
                onClick={() => onSelect(row.sessionId)}
                data-testid="session-row"
              >
                <State kind={glyph} />
                <span className="ell">{row.title === null || row.title === '' ? t('chat.untitled') : row.title}</span>
                {isExternalSession(row.channel) && (
                  <span className="tag" data-testid="session-external" title={t('session.externalHint')}>
                    {t(externalChannelKey(row.channel ?? ''))}
                  </span>
                )}
                <span className="f3 sess-time">{dayLabel(row.updatedAt, t)}</span>
              </button>
            )}
            <button
              type="button"
              className="sx"
              aria-label={t('session.rename')}
              title={`${t('session.rename')} — ${t('session.renameHint')}`}
              data-testid="session-rename"
              onClick={() => {
                setArmed(null);
                setNameDraft(row.title ?? '');
                setRenaming({ sessionId: row.sessionId, revision: row.revision });
              }}
            >
              ✎
            </button>
            {row.sessionId !== current && (
              <button
                type="button"
                className="sx"
                aria-label={t('session.archive')}
                title={t('session.archive')}
                data-testid="session-archive"
                onClick={() => void onArchive(row.sessionId, row.revision, true)}
              >
                ⌄
              </button>
            )}
            {/* The open session is not offered: deleting what is on screen would leave the shell
                pointing at nothing, and the reader is already there to decide. */}
            {row.sessionId !== current && (
              <button
                type="button"
                className="sx"
                aria-label={t('session.cleanup')}
                title={t('session.cleanup')}
                data-testid="session-cleanup"
                onClick={() => {
                  if (armed !== row.sessionId) {
                    setArmed(row.sessionId);
                    return;
                  }
                  setArmed(null);
                  void onCleanup(row.sessionId, row.revision).then((removed) => {
                    if (removed) onSelect(current);
                  });
                }}
              >
                {armed === row.sessionId ? t('session.cleanupConfirm') : '×'}
              </button>
            )}
          </div>
        );
      })}
      {rows.some((row) => row.archivedAt !== null) && (
        <>
          <button
            type="button"
            className="s more"
            data-testid="session-archived-toggle"
            onClick={() => setShowArchived((open) => !open)}
          >
            <span className="f3">
              {t('session.archivedCount', { count: rows.filter((row) => row.archivedAt !== null).length })}
            </span>
          </button>
          {showArchived &&
            rows
              .filter((row) => row.archivedAt !== null)
              .map((row) => (
                <div key={row.sessionId} className="srow" data-testid="session-archived-row">
                  <button
                    type="button"
                    className="s"
                    aria-current={row.sessionId === current ? 'true' : undefined}
                    onClick={() => onSelect(row.sessionId)}
                  >
                    <State kind="idle" />
                    <span className="ell">{row.title === null || row.title === '' ? t('chat.untitled') : row.title}</span>
                    <span className="f3 sess-time">{t('session.archived')}</span>
                  </button>
                  <button
                    type="button"
                    className="sx"
                    aria-label={t('session.unarchive')}
                    title={t('session.unarchive')}
                    data-testid="session-unarchive"
                    onClick={() => void onArchive(row.sessionId, row.revision, false)}
                  >
                    ↥
                  </button>
                </div>
              ))}
        </>
      )}
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
