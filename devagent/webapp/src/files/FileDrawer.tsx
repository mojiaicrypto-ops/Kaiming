import { useCallback, useEffect, useState } from 'react';
import { Drawer } from '../app/Drawer';
import { State } from '../app/State';
import { useI18n } from '../i18n/I18nProvider';
import type { RpcClient } from '../api/rpc';

interface Entry {
  readonly name: string;
  readonly path: string;
  readonly type: 'directory' | 'file' | 'symlink' | 'other';
  readonly size: number | null;
  readonly updatedAt: string;
}

interface FileBody {
  readonly path: string;
  readonly version: string;
  readonly size: number;
  readonly updatedAt: string;
  readonly truncated: boolean;
  readonly binary: boolean;
  readonly text: string | null;
}

export interface FileDrawerProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  /** The file or directory to open first; null means the project root. */
  readonly path: string | null;
  /** Knowledge entries, shown as a fixed group: they are how a new session finds the project. */
  readonly entries: readonly { readonly path: string; readonly present: boolean }[];
  readonly onClose: () => void;
}

/**
 * One read-only viewer for the project's own files: a directory listing, then a file's text.
 *
 * It exists because the product promises that a user can browse the project and read a file
 * without asking a model to retell it ("查看不需要模型转述"). It never writes: a file is shown with
 * its version and size, and editing stays with the work that owns it.
 */
export function FileDrawer({ rpc, projectId, path, entries, onClose }: FileDrawerProps) {
  const { t } = useI18n();
  const [dir, setDir] = useState<string>(path === null ? '.' : path);
  const [listing, setListing] = useState<readonly Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [body, setBody] = useState<FileBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDirectory = useCallback(
    async (target: string, cursor?: string): Promise<{ rows: readonly Entry[]; next: string | null }> => {
      const read = await rpc.call<{ entries: readonly Entry[]; nextCursor: string | null }>('project.files.list', {
        projectId,
        path: target,
        limit: 200,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return { rows: read.entries, next: read.nextCursor };
    },
    [rpc, projectId],
  );

  // Open the requested path: a file shows its text, a directory shows its entries.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setBody(null);
    setLoading(true);
    const open = async (): Promise<void> => {
      const target = path ?? '.';
      try {
        const page = await loadDirectory(target);
        if (cancelled) return;
        setDir(target);
        setListing(page.rows);
        setNextCursor(page.next);
      } catch (cause) {
        // The path may be a file: ask for its body instead of guessing from the name.
        try {
          const read = await rpc.call<FileBody>('project.files.read', { projectId, path: target });
          if (cancelled) return;
          setBody(read);
          setDir(parentOf(target));
        } catch {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [path, projectId, rpc, loadDirectory]);

  const go = async (target: string): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      const page = await loadDirectory(target);
      setDir(target);
      setListing(page.rows);
      setNextCursor(page.next);
      setBody(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const openFile = async (target: string): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      const read = await rpc.call<FileBody>('project.files.read', { projectId, path: target });
      setBody(read);
      setDir(parentOf(target));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const more = async (): Promise<void> => {
    if (nextCursor === null) return;
    const page = await loadDirectory(dir, nextCursor);
    setListing((previous) => [...previous, ...page.rows]);
    setNextCursor(page.next);
  };

  const knowledge = entries.filter((entry) => entry.path !== '');

  return (
    <Drawer
      eyebrow={body === null ? t('files.browse') : t('files.readOnly')}
      title={
        body === null ? (
          <span className="mono">{dir === '.' ? t('files.root') : dir}</span>
        ) : (
          <span className="mono">{body.path}</span>
        )
      }
      onClose={onClose}
      footer={
        body !== null ? (
          <button type="button" className="btn ghost" onClick={() => void go(dir)}>
            {t('files.back')}
          </button>
        ) : undefined
      }
    >
      {error !== null && <State kind="block">{error}</State>}
      {loading && body === null && <div className="f3">{t('common.loading')}</div>}
      {body !== null ? (
        <>
          <div className="f3">
            {t('files.meta', { size: body.size, version: body.version.slice(0, 8) })}
            {body.truncated ? ` · ${t('files.truncated')}` : ''}
          </div>
          {body.binary ? (
            <State kind="wait">{t('files.binary')}</State>
          ) : (
            <pre className="fileread" data-testid="file-text">
              {body.text ?? ''}
            </pre>
          )}
        </>
      ) : (
        <>
          {dir !== '.' && (
            <button type="button" className="entry dir" onClick={() => void go(parentOf(dir))}>
              <span className="mono">..</span>
            </button>
          )}
          {dir === '.' && knowledge.length > 0 && (
            <>
              <div className="sh">{t('files.knowledge')}</div>
              {knowledge.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="entry"
                  onClick={() => void openFile(entry.path)}
                  data-testid="knowledge-entry"
                >
                  <State kind={entry.present ? 'done' : 'wait'} />
                  <span className="mono">{entry.path}</span>
                  <span className="sp" />
                  <span className="f3">{entry.present ? t('files.present') : t('files.missing')}</span>
                </button>
              ))}
            </>
          )}
          {listing.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`entry${entry.type === 'directory' ? ' dir' : ''}`}
              onClick={() => (entry.type === 'directory' ? void go(entry.path) : void openFile(entry.path))}
              data-testid="file-entry"
            >
              <span className="mono">{entry.type === 'directory' ? `${entry.name}/` : entry.name}</span>
              <span className="sp" />
              <span className="f3">
                {entry.type === 'symlink'
                  ? t('files.symlink')
                  : entry.type === 'other'
                    ? t('files.other')
                    : entry.size === null
                      ? ''
                      : `${entry.size} B`}
              </span>
            </button>
          ))}
          {nextCursor !== null && (
            <button type="button" className="btn ghost" onClick={() => void more()}>
              {t('files.more')}
            </button>
          )}
        </>
      )}
    </Drawer>
  );
}

/** The directory a path lives in; the root is '.', which the server understands. */
function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '.' : parts.join('/');
}
