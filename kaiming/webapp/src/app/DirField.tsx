import { useEffect, useRef, useState, type RefObject } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { errorText } from '../lib/errors';

/** One answer from `fs.browse`: where we are, where Up goes, and which children are directories. */
export interface BrowseEntry {
  readonly path: string;
  readonly parent: string | null;
  readonly directories: readonly string[];
}

/** Ask the server for one host directory's navigable subdirectories. No argument means "home". */
export type Browse = (path?: string) => Promise<BrowseEntry>;

export interface DirFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Enter in the input submits — the caller decides what submitting means (open, rebind). */
  readonly onEnter?: () => void;
  readonly placeholder: string;
  /** The caller's own operation (opening, rebinding) blocks browsing too. */
  readonly busy?: boolean;
  /** Stable test id; the picker appends `-browse`, `-list`, `-up`, `-use`. */
  readonly testId: string;
  readonly browse: Browse;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * An absolute host path, either typed or picked. The browser cannot reach the server's filesystem,
 * so the picker navigates `fs.browse` answers instead: descend into a name, go up, then "use this
 * directory" writes the chosen path back into the field. Typing stays available — a picker is an
 * alternative to the keyboard, never a replacement.
 */
export function DirField({ value, onChange, onEnter, placeholder, busy = false, testId, browse, inputRef }: DirFieldProps) {
  const { t } = useI18n();
  /** null means the plain input; an entry means the picker is showing that directory. */
  const [entry, setEntry] = useState<BrowseEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The picker replaces the input, so whatever had focus (the Browse button) is gone the moment it
  // opens; focus would fall to <body> and Escape would sail past this div to the dialog's window
  // listener. Holding focus on the container keeps every key here, on open and on every navigate.
  useEffect(() => {
    if (entry !== null) containerRef.current?.focus();
  }, [entry?.path]);

  const leave = (): void => {
    setEntry(null);
    inputRef?.current?.focus();
  };
  const go = async (path?: string): Promise<void> => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      setEntry(await browse(path));
    } catch (cause) {
      // The listing failed, not the picker: keep the current directory so the user can go elsewhere.
      setError(t('dir.failed', { reason: errorText(cause, t) }));
    } finally {
      setLoading(false);
    }
  };

  const childOf = (name: string): string => (entry !== null && entry.path === '/' ? `/${name}` : `${entry?.path ?? ''}/${name}`);

  if (entry === null) {
    return (
      <div className="dirfield">
        <div className="row">
          <input
            ref={inputRef}
            className="inp"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) onEnter?.();
            }}
            data-testid={testId}
          />
          <button
            type="button"
            className="btn ghost"
            onClick={() => void go()}
            disabled={busy || loading}
            data-testid={`${testId}-browse`}
          >
            {t('dir.browse')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dirfield">
      <div
        className="dirpick"
        tabIndex={-1}
        ref={containerRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Escape leaves the picker, not the dialog behind it (the typed path is still work to lose).
            event.preventDefault();
            event.stopPropagation();
            leave();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            // Move DOM focus between the directory buttons; Enter then activates the focused one.
            event.preventDefault();
            const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-dir]') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
            buttons[next]?.focus();
          }
        }}
      >
        <div className="row">
          <span className="mono ell">{entry.path}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void go(entry.parent ?? undefined)}
            disabled={loading || entry.parent === null}
            data-testid={`${testId}-up`}
          >
            {t('dir.up')}
          </button>
        </div>
        <div className="dirlist" ref={listRef} data-testid={`${testId}-list`}>
          {entry.directories.length === 0 && <div className="f3 dir-empty">{t('dir.empty')}</div>}
          {entry.directories.map((name) => (
            <button key={name} type="button" data-dir="" onClick={() => void go(childOf(name))} disabled={loading}>
              <span className="mono ell">{name}</span>
            </button>
          ))}
        </div>
        {error !== null && (
          <div className="st block" data-testid={`${testId}-error`}>
            {error}
          </div>
        )}
        <div className="btns">
          <button type="button" className="btn ghost" onClick={leave} data-testid={`${testId}-back`}>
            {t('dir.back')}
          </button>
          <button
            type="button"
            className="btn pri"
            onClick={() => {
              onChange(entry.path);
              leave();
            }}
            disabled={loading}
            data-testid={`${testId}-use`}
          >
            {t('dir.use')}
          </button>
        </div>
      </div>
    </div>
  );
}
