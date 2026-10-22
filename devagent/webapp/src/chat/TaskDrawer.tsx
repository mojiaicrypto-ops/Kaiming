import { useEffect, useState } from 'react';
import { Drawer } from '../app/Drawer';
import { State } from '../app/State';
import { Markdown } from './Markdown';
import { useI18n } from '../i18n/I18nProvider';
import type { RpcClient } from '../api/rpc';
import type { TaskDetail } from '../state/useSession';

export interface TaskDrawerProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly detail: TaskDetail;
  readonly onClose: () => void;
}

/**
 * What the Task strip cannot hold: the goal, the scope, and the reports a Task produced.
 *
 * A report is opened here, through `task.report.get`: the body comes from the reference the server
 * recorded, so the user reads the file the Task really produced — no model retelling, no path
 * supplied by the page.
 */
export function TaskDrawer({ rpc, projectId, detail, onClose }: TaskDrawerProps) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const [body, setBody] = useState<{ text: string; truncated: boolean; path: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (openId === null) return;
    let cancelled = false;
    // The previous result's body must not linger under the new title while this one loads.
    setBody(null);
    setLoading(true);
    setError(null);
    void rpc
      .call<{ text: string; truncated: boolean; path: string }>('task.report.get', {
        projectId,
        taskId: detail.task.taskId,
        resultId: openId,
      })
      .then((read) => {
        if (!cancelled) setBody({ text: read.text, truncated: read.truncated, path: read.path });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId, projectId, detail.task.taskId, rpc]);

  if (openId !== null && (loading || body !== null || error !== null)) {
    const result = detail.results.find((entry) => entry.resultId === openId);
    return (
      <Drawer eyebrow={`${detail.task.taskId} · ${t('task.openReport')}`} title={result?.summary ?? openId} onClose={onClose}>
        <div className="sec">
          <div className="sh">{result?.kind ?? ''}</div>
          {/* A project report has a path the reader can also open in the file viewer; a read Task's
              report lives in the server's own work area, and printing that absolute path would
              show server layout the browser cannot use. */}
          <div className="f3 mono">
            {body === null ? '' : body.path.startsWith('/') ? t('task.serverCopy') : body.path}
          </div>
        </div>
        {error !== null && <State kind="block">{t('task.reportStale')}</State>}
        {body !== null && (
          <>
            {body.truncated && <div className="f3">{t('files.truncated')}</div>}
            <div className="md">
              <Markdown text={body.text} />
            </div>
          </>
        )}
      </Drawer>
    );
  }

  return (
    <Drawer
      eyebrow={`${detail.task.taskId} · ${detail.task.phase}`}
      title={t('task.detail')}
      onClose={onClose}
    >
      <div className="sec">
        <div className="sh">{t('task.goal')}</div>
        <div>{detail.task.goal}</div>
      </div>
      <div className="sec">
        <div className="sh">{t('task.scope')}</div>
        <div>{detail.task.scope}</div>
      </div>
      {detail.task.nextStep !== null && detail.task.nextStep !== '' && (
        <div className="sec">
          <div className="sh">{t('task.nextStep')}</div>
          <div>{detail.task.nextStep}</div>
        </div>
      )}
      <div className="sec">
        <div className="sh">{t('task.results')}</div>
        {detail.results.length === 0 && <div className="f3">{t('task.noResults')}</div>}
        {detail.results.map((result) => (
          <button
            key={result.resultId}
            type="button"
            className="entry"
            onClick={() => setOpenId(result.resultId)}
            data-testid="result-open"
          >
            <State kind={result.verdict === 'pass' ? 'done' : result.verdict === 'fail' ? 'block' : 'idle'} />
            <span className="ell">{result.summary ?? result.label ?? result.resultId}</span>
            <span className="sp" />
            <span className="f3 mono">{result.kind}</span>
          </button>
        ))}
      </div>
    </Drawer>
  );
}
