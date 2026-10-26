import { useEffect, useState } from 'react';
import { Drawer } from '../app/Drawer';
import { State } from '../app/State';
import { MarkdownView } from '../files/MarkdownView';
import { baseDirOf } from '../files/paths';
import { resolveLink } from '../files/link-target';
import { useI18n } from '../i18n/I18nProvider';
import type { RpcClient } from '../api/rpc';
import type { TaskDetail } from '../state/useSession';

export interface TaskDrawerProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly detail: TaskDetail;
  /** Open one project file in the same viewer the project browser uses. */
  readonly onOpenFile: (path: string) => void;
  /** The project's absolute path: what an absolute link inside the body is measured against. */
  readonly projectRealPath: string;
  /** A link that leaves the project: the drawer cannot read it, and says so. */
  readonly onOutside: (path: string) => void;
  readonly onClose: () => void;
}

/**
 * What the Task strip cannot hold: the goal, the scope, and the reports a Task produced.
 *
 * A report is opened here, through `task.report.get`: the body comes from the reference the server
 * recorded, so the user reads the file the Task really produced — no model retelling, no path
 * supplied by the page.
 */
export function TaskDrawer({ rpc, projectId, detail, onOpenFile, projectRealPath, onOutside, onClose }: TaskDrawerProps) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const [body, setBody] = useState<{ text: string; truncated: boolean; path: string; relativePath: string | null } | null>(null);
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
      .call<{ text: string; truncated: boolean; path: string; relativePath?: string | null }>('task.report.get', {
        projectId,
        taskId: detail.task.taskId,
        resultId: openId,
      })
      .then((read) => {
        if (!cancelled) {
          setBody({ text: read.text, truncated: read.truncated, path: read.path, relativePath: read.relativePath ?? null });
        }
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
          {/* A project report has a path the reader can open in the viewer; a read Task's report
              lives in the server's own work area, and printing that absolute path would show
              server layout the browser cannot reach. */}
          {body === null ? undefined : body.relativePath === null ? (
            <div className="f3">{t('task.serverCopy')}</div>
          ) : (
            <button
              type="button"
              className="entry"
              onClick={() => onOpenFile(body.relativePath ?? '')}
              data-testid="report-open-file"
            >
              <span className="mono ell">{body.relativePath}</span>
              <span className="sp" />
              <span className="f3">{t('files.openInViewer')}</span>
            </button>
          )}
        </div>
        {error !== null && <State kind="block">{t('task.reportStale')}</State>}
        {body !== null && (
          <>
            {body.truncated && <div className="f3">{t('files.truncated')}</div>}
            {/* A report is a markdown document: read formatted, with its source one click away.
                Links in it point at files on this machine and open in the same viewer. */}
            <MarkdownView
              text={body.text}
              path={body.relativePath ?? body.path}
              truncated={body.truncated}
              resolveLink={(href) => resolveLink(href, projectRealPath, baseDirOf(body.relativePath))}
              onOpenProjectFile={onOpenFile}
              onOutside={onOutside}
            />
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
