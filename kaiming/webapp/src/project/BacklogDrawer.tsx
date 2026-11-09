import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Drawer } from '../app/Drawer';
import { awaitingDesign, isVersionConflict, parseSpecRefs, type BacklogItemView } from './project-model';

export interface BacklogDrawerProps {
  readonly item: BacklogItemView;
  readonly onClose: () => void;
  readonly onSave: (
    id: string,
    expectedDigest: string,
    patch: { title?: string; body?: string; specRefs?: string[] },
  ) => Promise<BacklogItemView>;
  readonly onCloseItem: (id: string, state: 'done' | 'dropped', note: string) => Promise<BacklogItemView>;
  readonly onReopen: (id: string, expectedDigest: string, note: string) => Promise<BacklogItemView>;
  /** Hands a request to the chief composer: the drawer never starts work by itself. */
  readonly onHandOff: (text: string) => void;
  readonly onOpenRef: (ref: string) => void;
  readonly onOpenTask: (sessionId: string) => void;
  readonly onNotice: (message: string, kind: 'info' | 'success' | 'error') => void;
}

/**
 * Backlog detail and its ordinary editing operations. Saving keeps the user's draft when someone
 * else changed the file: the conflict is a fact to merge, not a reason to discard typing.
 */
export function BacklogDrawer({
  item,
  onClose,
  onSave,
  onCloseItem,
  onReopen,
  onHandOff,
  onOpenRef,
  onOpenTask,
  onNotice,
}: BacklogDrawerProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [specText, setSpecText] = useState(item.specRefs.join('\n'));
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState<{ title: string; digest: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(item.title);
    setBody(item.body);
    setSpecText(item.specRefs.join('\n'));
    setConflict(null);
    setNote('');
  }, [item.id, item.digest]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await onSave(item.id, item.digest, {
        title,
        body,
        specRefs: parseSpecRefs(specText),
      });
      setConflict(null);
      onNotice(t('backlog.saved', { id: item.id }), 'success');
    } catch (error) {
      if (isVersionConflict(error)) {
        const current = (error.details as { current?: { title?: string; digest?: string } } | undefined)?.current;
        setConflict({ title: current?.title ?? '', digest: current?.digest ?? '' });
        onNotice(t('backlog.conflict'), 'error');
      } else {
        onNotice(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const close = async (state: 'done' | 'dropped'): Promise<void> => {
    if (note.trim() === '') {
      onNotice(t('backlog.noteRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      await onCloseItem(item.id, state, note.trim());
      onNotice(t('backlog.closed', { id: item.id }), 'success');
      onClose();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (): Promise<void> => {
    if (note.trim() === '') {
      onNotice(t('backlog.noteRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      await onReopen(item.id, item.digest, note.trim());
      onNotice(t('backlog.reopened', { id: item.id }), 'success');
      onClose();
    } catch (error) {
      if (isVersionConflict(error)) setConflict({ title: '', digest: '' });
      onNotice(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const open = item.state === 'open';
  const waitingDesign = awaitingDesign(item);

  return (
    <Drawer
      eyebrow={`${item.id} · ${open ? t('backlog.stateOpen') : item.state === 'done' ? t('backlog.stateDone') : t('backlog.stateDropped')}`}
      title={item.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => onHandOff(`讨论 ${item.id}：`)}>
            {t('backlog.discuss')}
          </button>
          {open ? (
            <button
              type="button"
              className="btn pri"
              data-testid="backlog-implement"
              disabled={waitingDesign}
              title={waitingDesign ? t('project.awaitingDesign') : undefined}
              onClick={() => onHandOff(`实施 ${item.id}`)}
            >
              {t('backlog.implement')}
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={() => void reopen()}>
              {t('backlog.reopen')}
            </button>
          )}
        </>
      }
    >
      {conflict !== null && (
        <div className="notice" data-testid="backlog-conflict">
          <div>{t('backlog.conflict')}</div>
          {conflict.title !== '' && <div className="f3">{t('backlog.conflictCurrent', { title: conflict.title })}</div>}
        </div>
      )}
      {item.problems.length > 0 && (
        <div className="notice">
          {item.problems.map((problem) => (
            <div key={`${String(problem.line)}-${problem.reason}`} data-testid="backlog-problem">
              {t('backlog.lineReason', { line: problem.line, reason: problem.reason })}
            </div>
          ))}
        </div>
      )}
      {item.warnings.length > 0 && (
        <div className="notice">
          {item.warnings.map((warning) => (
            <div key={`${String(warning.line)}-${warning.reason}`} className="f3">
              {t('backlog.lineReason', { line: warning.line, reason: warning.reason })}
            </div>
          ))}
        </div>
      )}

      <div className="sec">
        <div className="sh">{t('backlog.fieldTitle')}</div>
        <input
          className="inp"
          data-testid="backlog-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={!open}
        />
      </div>
      <div className="sec">
        <div className="sh">{t('backlog.specRefs')}</div>
        <textarea
          className="inp"
          rows={3}
          value={specText}
          onChange={(event) => setSpecText(event.target.value)}
          placeholder={t('backlog.specPlaceholder')}
          disabled={!open}
        />
        {item.specRefs.map((ref) => (
          <button key={ref} type="button" className="lnk" onClick={() => onOpenRef(ref)}>
            {ref}
          </button>
        ))}
      </div>
      <div className="sec">
        <div className="sh">{t('backlog.body')}</div>
        <textarea className="inp" rows={6} value={body} onChange={(event) => setBody(event.target.value)} disabled={!open} />
      </div>
      {open && (
        <button type="button" className="btn" data-testid="backlog-save" disabled={busy} onClick={() => void save()}>
          {t('backlog.save')}
        </button>
      )}

      <div className="sec">
        <div className="sh">{t('backlog.associations')}</div>
        {item.openTasks.length === 0 && item.lastClosedTask === undefined && <div className="f3">{t('backlog.noTasks')}</div>}
        {item.openTasks.map((task) => (
          <div key={task.taskId} className="row">
            <span className="mono">{task.taskId}</span>
            <span className="f3">{task.status}</span>
          </div>
        ))}
        {item.lastClosedTask !== undefined && item.openTasks.length === 0 && (
          <div className="f3">{t('backlog.lastTask', { id: item.lastClosedTask.taskId, status: item.lastClosedTask.status })}</div>
        )}
        {item.note !== undefined && <div className="f3">{t('backlog.noteValue', { note: item.note })}</div>}
        {item.source !== undefined && <div className="f3">{t('backlog.sourceValue', { source: item.source })}</div>}
        {(item.relatedTasks ?? []).length > 0 && (
          <div className="pp-list" data-testid="backlog-lineage">
            {(item.relatedTasks ?? []).map((task) => (
              <button
                key={task.taskId}
                type="button"
                className="lnk"
                onClick={() => {
                  if (task.chiefSessionId !== undefined) onOpenTask(task.chiefSessionId);
                }}
              >
                {task.taskId} ·{' '}
                {t(
                  task.workKind === 'design'
                    ? 'task.kind.design'
                    : task.workKind === 'document'
                      ? 'task.kind.document'
                      : task.workKind === 'investigate'
                        ? 'task.kind.investigate'
                        : 'task.kind.implement',
                )}{' '}
                · {task.status}
                {task.phase === undefined ? '' : ` · ${task.phase}`}
              </button>
            ))}
          </div>
        )}
        {(item.splitInto ?? []).length > 0 && (
          <div className="f3" data-testid="backlog-split-into">
            {t('project.splitInto', { ids: (item.splitInto ?? []).join(', ') })}
          </div>
        )}
      </div>

      {open ? (
        <div className="sec">
          <div className="sh">{t('backlog.closeWithNote')}</div>
          <input
            className="inp"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('backlog.closeNotePlaceholder')}
          />
          <div className="row">
            <button type="button" className="btn" disabled={busy} onClick={() => void close('done')}>
              {t('backlog.complete')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void close('dropped')}>
              {t('backlog.drop')}
            </button>
          </div>
        </div>
      ) : (
        <div className="sec">
          <div className="sh">{t('backlog.reopenWithNote')}</div>
          <input
            className="inp"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('backlog.reopenNotePlaceholder')}
          />
        </div>
      )}
    </Drawer>
  );
}
