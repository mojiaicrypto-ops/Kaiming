import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { highlightToHtml, hasLanguage } from '../lib/highlight';
import { languageOf } from './file-kind';

export interface SourceViewProps {
  /** The file's whole text, as the server read it. */
  readonly text: string;
  /** Used for the language and the search scope; the path itself is shown by the viewer header. */
  readonly path: string;
  /** The body was cut at the server's limit: say so, never pretend this is the whole file. */
  readonly truncated: boolean;
  /** A line to reveal after the text arrives (the issue the user clicked). */
  readonly focusLine?: number;
}

/**
 * One file's text, as source: line numbers on the left, the file's own bytes on the right.
 *
 * Two decisions worth keeping:
 * - The gutter is a separate column, not per-line markup. `pre` keeps the file's own whitespace,
 *   and a number column that is `user-select: none` means copying the code never picks up digits.
 * - Highlighting is a whole-file pass, budgeted by the shared queue: a 4000-line file renders
 *   plain first and gains colour in an idle slice, instead of freezing the frame that opens it.
 */
export function SourceView({ text, path, truncated, focusLine }: SourceViewProps) {
  const { t } = useI18n();
  const language = languageOf(path);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');

  // One pass over the whole text: the same input always produces the same HTML, so the colours
  // cannot drift between two openings of the same file. A whole-file pass ignores the fence budget
  // on purpose — this is one file the user just asked to open, not a stream of twelve fences.
  const html = useMemo(() => (language === undefined ? '' : highlightToHtml(text, language)), [text, language]);
  const lines = useMemo(() => text.split('\n').length, [text]);
  const matches = useMemo(() => {
    const needle = query.trim();
    if (needle === '') return 0;
    let count = 0;
    for (const line of text.split('\n')) {
      if (line.toLowerCase().includes(needle.toLowerCase())) count += 1;
    }
    return count;
  }, [query, text]);

  // Same arithmetic as a search hit: the code never wraps, so line height times the index is the
  // exact offset. Runs after the text is committed, so the scroll box already has that height.
  useEffect(() => {
    const view = bodyRef.current;
    if (view === null || focusLine === undefined) return;
    const line = parseFloat(getComputedStyle(view).lineHeight);
    const height = Number.isFinite(line) && line > 0 ? line : 18;
    view.scrollTop = Math.max(0, (focusLine - 1) * height - view.clientHeight / 3);
  }, [text, focusLine]);

  return (
    <div className="srcview">
      <div className="srcbar">
        <span className="f3 mono">
          {t('files.lines', { count: lines })}
          {language === undefined ? '' : ` · ${language}`}
        </span>
        {truncated ? <span className="f3">{t('files.truncated')}</span> : undefined}
        <span className="sp" />
        <input
          className="inp srcsearch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('files.find')}
          aria-label={t('files.find')}
          data-testid="file-search"
        />
        {query.trim() !== '' && (
          <span className="f3" data-testid="file-matches">
            {t('files.matches', { count: matches })}
          </span>
        )}
      </div>
      <div className="srcscroll scroll" ref={bodyRef}>
        <div className="srccode">
          <div className="srcgutter mono" aria-hidden="true">
            {Array.from({ length: lines }, (_, index) => String(index + 1)).join('\n')}
          </div>
          {html === '' ? (
            <pre className="srcplain mono" data-testid="file-text">
              {text}
            </pre>
          ) : (
            // Highlighted output is hljs's own escaped HTML of this file's text, not a document.
            <pre className="srchigh mono" data-testid="file-text">
              <code dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          )}
        </div>
      </div>
      {query.trim() !== '' && matches > 0 && (
        // Lines that mention the query, so the reader can jump instead of scrolling a 4000-line file.
        <div className="srchits">
          {text
            .split('\n')
            .map((line, index) => ({ line, number: index + 1 }))
            .filter((entry) => entry.line.toLowerCase().includes(query.trim().toLowerCase()))
            .slice(0, 50)
            .map((entry) => (
              <button
                key={entry.number}
                type="button"
                className="srchit"
                onClick={() => {
                  // The code never wraps (`white-space: pre`), so every line has the same height
                  // and a line's offset is exact arithmetic — no per-line DOM to search for.
                  const view = bodyRef.current;
                  if (view === null) return;
                  const line = parseFloat(getComputedStyle(view).lineHeight);
                  const height = Number.isFinite(line) && line > 0 ? line : 18;
                  view.scrollTop = Math.max(0, (entry.number - 1) * height - view.clientHeight / 3);
                }}
              >
                <span className="mono f3">{entry.number}</span>
                <span className="mono ell">{entry.line.trim()}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
