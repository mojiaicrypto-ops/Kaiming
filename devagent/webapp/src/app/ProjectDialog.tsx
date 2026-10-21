import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { ProjectSummary } from '../state/useWorkspace';

export interface ProjectDialogProps {
  readonly current: ProjectSummary | null;
  readonly recent: ReadonlyArray<{ path: string; name: string }>;
  readonly onOpen: (path: string) => Promise<void>;
  readonly onClose: () => void;
}

/**
 * The project switcher: recent directories plus a path field. There is no `project.list` on the
 * server, so the recent list is this browser's own memory and the field is the only way to reach
 * a directory it has never seen. Esc closes it; the dialog is the prototype's, not a redesign.
 */
export function ProjectDialog({ current, recent, onOpen, onClose }: ProjectDialogProps) {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (target: string): Promise<void> => {
    if (target.trim() === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(target.trim());
      onClose();
    } catch (cause) {
      setError(t('project.openFailed', { reason: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label={t('project.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{t('project.title')}</h2>
        <div>
          <div className="f3" style={{ marginBottom: 'var(--s1)' }}>
            {t('project.recent')}
          </div>
          <div className="plist">
            {recent.length === 0 && <div className="f3">{t('project.noRecent')}</div>}
            {recent.map((entry) => (
              <button
                key={entry.path}
                type="button"
                aria-current={current?.realPath === entry.path ? 'true' : undefined}
                onClick={() => void submit(entry.path)}
                data-testid="project-recent"
              >
                <b>{entry.name}</b>
                <span className="f3 ell">{entry.path}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="f3" style={{ marginBottom: 'var(--s1)' }}>
            {t('project.add')}
          </div>
          <input
            ref={inputRef}
            className="inp"
            placeholder={t('project.addPlaceholder')}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit(path);
            }}
            data-testid="project-path"
          />
          {error !== null && <div className="st block" style={{ marginTop: 'var(--s2)' }}>{error}</div>}
        </div>
        <div className="btns" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('project.cancel')}
          </button>
          <button type="button" className="btn pri" onClick={() => void submit(path)} disabled={busy}>
            {t('project.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
