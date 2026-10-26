import { useCallback, useEffect, useState } from 'react';
import { State } from '../app/State';
import { useI18n } from '../i18n/I18nProvider';
import type { RpcClient } from '../api/rpc';
import { fileKindOf, extensionOf, isMarkdown } from './file-kind';
import { MarkdownView } from './MarkdownView';
import { SourceView } from './SourceView';
import { resolveLink, type LinkTarget } from './link-target';
import { baseDirOf, bytes, bytesUrl, parentOf } from './paths';

interface Entry {
  readonly name: string;
  readonly path: string;
  readonly type: 'directory' | 'file' | 'symlink' | 'other';
  readonly size: number | null;
  readonly updatedAt: string;
}

/** What the server read for one path: text, or the fact that the bytes are not displayable. */
interface FileBody {
  readonly path: string;
  readonly version: string;
  readonly size: number;
  readonly updatedAt: string;
  readonly truncated: boolean;
  readonly binary: boolean;
  readonly mimeType?: string;
  readonly text: string | null;
}

export interface FileViewerProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  /**
   * The file to open. `null` opens the project root listing, which is how the viewer is also a
   * browser: one component, one engine, two entry points.
   */
  readonly path: string | null;
  /** Knowledge entries pinned above the root listing: they are how a new session finds a project. */
  readonly entries: readonly { readonly path: string; readonly present: boolean }[];
  readonly onClose: () => void;
  /** Opening another file replaces this one in place: the canvas stays, only its content changes. */
  readonly onOpenPath: (path: string) => void;
  readonly onDownload: (path: string) => void;
  /** The project's own absolute path: the anchor an absolute link is measured against. */
  readonly projectRealPath: string;
  /** A link that points outside this project: the viewer cannot read it, and says so. */
  readonly onOutside: (path: string) => void;
}

/**
 * The project file viewer: one canvas, a lazy tree on the left, the file on the right.
 *
 * Every file is shown as what it is — source text with a gutter for anything textual (including
 * `.html`), the browser's own player for images and media, and an honest notice plus a download
 * for bytes that cannot be displayed. It renders files; it does not run them.
 */
export function FileViewer({ rpc, projectId, path, entries, onClose, onOpenPath, onDownload, projectRealPath, onOutside }: FileViewerProps) {
  const { t } = useI18n();
  const [body, setBody] = useState<FileBody | null>(null);
  const [listing, setListing] = useState<readonly Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [dir, setDir] = useState('.');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const kind = body === null ? 'text' : fileKindOf(body.path);

  // Opening a path: a directory lists, a file reads. One request tells us which, because the
  // listing method refuses a file and the read method refuses a directory.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    const target = path ?? '.';
    void (async () => {
      try {
        const page = await rpc.call<{ entries: readonly Entry[]; nextCursor: string | null }>('project.files.list', {
          projectId,
          path: target,
          limit: 200,
        });
        if (cancelled) return;
        setDir(target);
        setListing(page.entries);
        setNextCursor(page.nextCursor);
        setBody(null);
      } catch (cause) {
        try {
          const read = await rpc.call<FileBody>('project.files.read', { projectId, path: target });
          if (cancelled) return;
          setBody(read);
        } catch {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, projectId, rpc]);

  const openDirectory = useCallback(
    async (target: string): Promise<void> => {
      onOpenPath(target);
    },
    [onOpenPath],
  );

  const more = async (): Promise<void> => {
    if (nextCursor === null) return;
    const page = await rpc.call<{ entries: readonly Entry[]; nextCursor: string | null }>('project.files.list', {
      projectId,
      path: dir,
      limit: 200,
      cursor: nextCursor,
    });
    setListing((previous) => [...previous, ...page.entries]);
    setNextCursor(page.nextCursor);
  };

  /** Resolve a link the way the document that holds it means it. */
  const resolve = (href: string): LinkTarget => resolveLink(href, projectRealPath, baseDirOf(body === null ? null : body.path));

  const knowledge = entries.filter((entry) => entry.path !== '');
  // A knowledge entry is also a real row in the root listing; showing it twice would read as two
  // different files. The pinned row wins: it carries whether the file is present.
  const pinned = new Set(knowledge.map((entry) => entry.path));
  const listingRows = listing.filter((entry) => !(dir === '.' && pinned.has(entry.path)));
  const name = body === null ? (dir === '.' ? t('files.root') : dir) : body.path;

  return (
    <div className="fileviewer" data-testid="file-viewer" role="dialog" aria-modal="true" aria-label={t('files.browse')}>
      <div className="fv-head">
        <span className="f3">{t('files.readOnly')}</span>
        <span className="mono fv-path" data-testid="file-path">
          {name}
        </span>
        <span className="sp" />
        {body !== null && (
          <>
            <span className="f3">
              {t('files.meta', { size: body.size, version: body.version.slice(0, 8) })}
              {body.truncated ? ` · ${t('files.truncated')}` : ''}
            </span>
            <button type="button" className="btn ghost" onClick={() => onDownload(body.path)} data-testid="file-download">
              {t('files.download')}
            </button>
          </>
        )}
        <button type="button" className="btn ghost" onClick={onClose} data-testid="file-close">
          {t('chat.member.close')}
        </button>
      </div>
      <div className="fv-body">
        <nav className="fv-tree scroll" aria-label={t('files.tree')}>
          {dir !== '.' && (
            <button type="button" className="entry dir" onClick={() => void openDirectory(parentOf(dir))}>
              <span className="ico" aria-hidden="true">↑</span>
              <span className="mono">..</span>
            </button>
          )}
          {dir === '.' &&
            knowledge.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="entry"
                disabled={!entry.present}
                onClick={() => onOpenPath(entry.path)}
                data-testid="knowledge-entry"
              >
                <span className="ico" aria-hidden="true">{entry.present ? '✓' : '·'}</span>
                <span className="mono">{entry.path}</span>
              </button>
            ))}
          {listingRows.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`entry ${entry.type}${entry.path === path ? ' on' : ''}`}
              disabled={entry.type !== 'directory' && entry.type !== 'file'}
              onClick={() => (entry.type === 'directory' ? void openDirectory(entry.path) : onOpenPath(entry.path))}
              data-testid="file-entry"
              data-type={entry.type}
              // The glyph, the trailing slash and the name's weight all say the same thing: a
              // directory opens, a file is read. One of them alone can be missed.
              aria-label={entry.type === 'directory' ? `${entry.name} (${t('files.directory')})` : entry.name}
            >
              <span className="ico" aria-hidden="true">{GLYPH[entry.type]}</span>
              <span className="mono">{entry.type === 'directory' ? `${entry.name}/` : entry.name}</span>
              <span className="sp" />
              <span className="f3">
                {entry.type === 'symlink'
                  ? t('files.symlink')
                  : entry.type === 'other'
                    ? t('files.other')
                    : entry.size === null
                      ? ''
                      : bytes(entry.size)}
              </span>
            </button>
          ))}
          {nextCursor !== null && (
            <button type="button" className="btn ghost" onClick={() => void more()}>
              {t('files.more')}
            </button>
          )}
        </nav>
        <section className="fv-main">
          {error !== null && <State kind="block">{error}</State>}
          {loading && <div className="f3">{t('common.loading')}</div>}
          {!loading && body === null && error === null && (
            <div className="f3">{t('files.pick')}</div>
          )}
          {body !== null && kind === 'text' && body.text !== null && isMarkdown(body.path) && (
            <MarkdownView
              text={body.text}
              path={body.path}
              truncated={body.truncated}
              resolveLink={resolve}
              onOpenProjectFile={onOpenPath}
              onOutside={onOutside}
            />
          )}
          {body !== null && kind === 'text' && body.text !== null && !isMarkdown(body.path) && (
            <SourceView text={body.text} path={body.path} truncated={body.truncated} />
          )}
          {body !== null && kind === 'text' && body.text === null && (
            <State kind="wait">{t('files.binary')}</State>
          )}
          {body !== null && kind === 'image' && (
            // The byte route, not the text: an image read as UTF-8 would be replacement characters.
            <div className="fv-media">
              <img src={bytesUrl(projectId, body.path)} alt={body.path.split('/').pop() ?? ''} />
            </div>
          )}
          {body !== null && kind === 'video' && (
            <div className="fv-media">
              <video src={bytesUrl(projectId, body.path)} controls preload="metadata" />
            </div>
          )}
          {body !== null && kind === 'audio' && (
            <div className="fv-media">
              <audio src={bytesUrl(projectId, body.path)} controls preload="metadata" />
            </div>
          )}
          {body !== null && kind === 'binary' && (
            <div className="fv-notice">
              <State kind="wait">{t('files.noPreview', { ext: extensionOf(body.path) || '—' })}</State>
              <button type="button" className="btn ghost" onClick={() => onDownload(body.path)}>
                {t('files.download')}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** One glyph per entry kind: the tree says what a row is before its name is read. */
const GLYPH: Readonly<Record<Entry['type'], string>> = {
  directory: '▸',
  file: '·',
  symlink: '↗',
  other: '?',
};

