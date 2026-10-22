import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { ProjectRow, ProjectSummary } from '../state/useWorkspace';

export interface ProjectDialogProps {
  readonly current: ProjectSummary | null;
  readonly projects: readonly ProjectRow[];
  readonly onOpen: (path: string) => Promise<void>;
  readonly onRebind: (projectId: string, path: string) => Promise<void>;
  /** Opens a project file in the read-only viewer. */
  readonly onOpenFile: (path: string) => void;
  readonly onClose: () => void;
}

/**
 * The project switcher: the server's registered projects plus a path field for a directory it has
 * never seen. A project whose directory disappeared keeps its row and offers a rebind instead of
 * pretending it is gone; a rebound project keeps its id, sessions and records.
 */
export function ProjectDialog({ current, projects, onOpen, onRebind, onOpenFile, onClose }: ProjectDialogProps) {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The project a rebind is being prepared for, and the directory it should point at. */
  const [rebindFor, setRebindFor] = useState<string | null>(null);
  const [rebindPath, setRebindPath] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

  const submit = async (target: string): Promise<void> => {
    if (target.trim() === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(target.trim());
      onClose();
    } catch (cause) {
      setError(t('project.openFailed', { reason: reason(cause) }));
    } finally {
      setBusy(false);
    }
  };

  const rebind = async (): Promise<void> => {
    if (rebindFor === null || rebindPath.trim() === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRebind(rebindFor, rebindPath.trim());
      setRebindFor(null);
      setRebindPath('');
    } catch (cause) {
      // A refused rebind says why (work still running, directory belongs to another project).
      setError(t('project.openFailed', { reason: reason(cause) }));
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
            {t('project.registered')}
          </div>
          <div className="plist">
            {projects.length === 0 && <div className="f3">{t('project.noRecent')}</div>}
            {projects.map((entry) => {
              const name = entry.realPath.split('/').filter(Boolean).pop() ?? entry.realPath;
              const active = current?.projectId === entry.projectId;
              return (
                <div key={entry.projectId} className={`prow${entry.directoryExists ? '' : ' missing'}`}>
                  <button
                    type="button"
                    className="popen"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => void submit(entry.realPath)}
                    disabled={!entry.directoryExists}
                    data-testid="project-row"
                  >
                    <b>{name}</b>
                    <span className="f3 ell">{entry.realPath}</span>
                    <span className="f3">
                      {t('project.sessions', { count: entry.sessionCount })} · {t('project.tasks', { count: entry.taskCount })}
                    </span>
                    {!entry.directoryExists && <span className="st block">{t('project.missing')}</span>}
                  </button>
                  {!entry.directoryExists && rebindFor !== entry.projectId && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setRebindFor(entry.projectId);
                        setRebindPath('');
                      }}
                      data-testid="project-rebind"
                    >
                      {t('project.rebind')}
                    </button>
                  )}
                  {rebindFor === entry.projectId && (
                    <div className="rebind">
                      <div className="f3">{t('project.rebindHint')}</div>
                      <div className="row">
                        <input
                          className="inp"
                          value={rebindPath}
                          onChange={(event) => setRebindPath(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void rebind();
                          }}
                          placeholder={t('project.addPlaceholder')}
                          data-testid="project-rebind-path"
                        />
                        <button type="button" className="btn pri" onClick={() => void rebind()} disabled={busy}>
                          {t('project.rebindConfirm')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="f3" style={{ marginBottom: 'var(--s1)' }}>
            {t('files.knowledge')}
          </div>
          <div className="plist">
            {(current?.entries ?? []).map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => onOpenFile(entry.path)}
                disabled={!entry.present}
                data-testid="project-entry"
              >
                <span className="mono">{entry.path}</span>
                <span className="sp" />
                <span className="f3">{entry.present ? t('files.present') : t('files.missing')}</span>
              </button>
            ))}
            <button type="button" onClick={() => onOpenFile('.')} data-testid="project-browse">
              <span>{t('files.browse')}</span>
            </button>
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
          {error !== null && (
            <div className="st block" style={{ marginTop: 'var(--s2)' }} data-testid="project-error">
              {error}
            </div>
          )}
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
