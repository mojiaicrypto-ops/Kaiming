import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Markdown } from '../chat/Markdown';
import { extensionOf } from './file-kind';
import { hrefOfEvent, type LinkTarget } from './link-target';
import { SourceView } from './SourceView';

export interface MarkdownViewProps {
  readonly text: string;
  readonly path: string;
  readonly truncated: boolean;
  /** Resolve one link against the project root; the caller decides what opening it means. */
  readonly resolveLink: (href: string) => LinkTarget;
  readonly onOpenProjectFile: (path: string) => void;
  readonly onOutside: (path: string) => void;
}

/** Markdown is a document, not code: it is the one kind that is read formatted, with the source
 *  one click away. The two views are the same bytes — only the reading differs. */
export function MarkdownView({ text, path, truncated, resolveLink, onOpenProjectFile, onOutside }: MarkdownViewProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');

  // A different file starts rendered again: the mode belongs to the file, not to the panel.
  useEffect(() => {
    setMode('rendered');
  }, [path]);

  return (
    <div className="mdview">
      <div className="mdbar">
        <button
          type="button"
          className={`tab${mode === 'rendered' ? ' on' : ''}`}
          onClick={() => setMode('rendered')}
          data-testid="md-rendered"
        >
          {t('files.rendered')}
        </button>
        <button
          type="button"
          className={`tab${mode === 'source' ? ' on' : ''}`}
          onClick={() => setMode('source')}
          data-testid="md-source"
        >
          {t('files.source')}
        </button>
        <span className="sp" />
        <span className="f3 mono">{extensionOf(path) === '' ? path : `.${extensionOf(path)}`}</span>
      </div>
      {mode === 'rendered' ? (
        <div
          className="md fv-md scroll"
          data-testid="md-body"
          onClick={(event) => {
            const href = hrefOfEvent(event.target);
            if (href === undefined) return;
            // A link in a report is a reference to a file on this machine, not a route: never let
            // the browser navigate away from the workbench for it.
            event.preventDefault();
            const target = resolveLink(href);
            if (target.kind === 'project') onOpenProjectFile(target.path);
            else if (target.kind === 'outside') onOutside(target.path);
            else if (target.kind === 'external') window.open(target.href, '_blank', 'noopener,noreferrer');
          }}
        >
          <Markdown text={text} />
        </div>
      ) : (
        <SourceView text={text} path={path} truncated={truncated} />
      )}
    </div>
  );
}
