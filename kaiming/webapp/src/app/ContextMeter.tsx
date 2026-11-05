/**
 * The context meter in the status bar: how much of the model's window the next request would carry.
 *
 * It is deliberately text, not a colour-only bar: `617k / 1M · 61.7%` reads at a glance and survives
 * a monochrome theme. The percentage is the part kept on narrow screens; the absolute figures and
 * the tooltip explain what the number means (an estimate, not a provider bill).
 *
 * The meter is also the manual-compaction entry: clicking it opens a small panel with the reading and
 * "Compact now". The panel is portaled to the body because the status bar clips its own overflow.
 *
 * States: normal, warning (≥70%), danger (≥90%), unknown. Unknown has two causes that must not be
 * conflated: a live session right after compaction (`?`, measured after the next response) and a
 * session with no Pi instance in this process (`—`, only the window is known).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import type { ContextView, SessionActivity } from '../api/stream';
import type { CompactionResult } from '../state/useSession';

type MeterState = 'normal' | 'warn' | 'danger' | 'unknown';

/** Counts are read at a glance: 1.2M and 480k, never 1200000. */
function compact(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Number((count / 1_000).toFixed(1))}k`;
  return String(count);
}

export function ContextMeter({
  context,
  activity,
  compacting,
  onCompact,
}: {
  context: ContextView;
  activity: SessionActivity;
  compacting: boolean;
  onCompact: () => Promise<CompactionResult>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompactionResult | null>(null);
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const known = context.tokens !== null && context.percent !== null;
  const used = known ? compact(context.tokens ?? 0) : context.live ? '?' : '—';
  const window = compact(context.contextWindow);
  const percent = known ? `${(context.percent ?? 0).toFixed(1)}%` : null;
  const state: MeterState = !known
    ? 'unknown'
    : (context.percent ?? 0) >= 90
      ? 'danger'
      : (context.percent ?? 0) >= 70
        ? 'warn'
        : 'normal';

  const base = known
    ? t('shell.contextKnown', { used, window, percent: percent ?? '' })
    : context.live
      ? t('shell.contextCompacted', { window })
      : t('shell.contextUnknown', { window });
  const auto =
    context.autoCompaction === null
      ? null
      : context.autoCompaction
        ? t('shell.contextAutoOn')
        : t('shell.contextAutoOff');
  const title = auto === null ? base : `${base} · ${auto}`;
  // A real meter only when a value exists; otherwise the label still describes the unknown state.
  const meter =
    known && context.percent !== null
      ? {
          role: 'meter' as const,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.min(Math.round(context.percent), 100),
          'aria-valuetext': title,
        }
      : {};

  const running = activity === 'processing' || activity === 'stopping';
  const pending = busy || compacting;
  const disabled = !context.live || running || compacting || busy;
  const reason = !context.live
    ? t('shell.compactNoInstance')
    : running
      ? t('shell.compactRunning')
      : null;

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Hooks above always run; only the render is conditional.
  if (context.contextWindow <= 0) return null;

  const run = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await onCompact());
    } catch (error) {
      setResult({ status: 'failed', detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const outcome = (): string | null => {
    if (result === null) return null;
    switch (result.status) {
      case 'compacted': {
        const before = result.tokensBefore === undefined ? '?' : compact(result.tokensBefore);
        const after =
          result.estimatedTokensAfter === undefined || result.estimatedTokensAfter === null
            ? '?'
            : compact(result.estimatedTokensAfter);
        return t('shell.compactDone', { before, after });
      }
      case 'nothing':
        return t('shell.compactNothing');
      case 'busy':
        return t('shell.compactRunning');
      case 'recovery':
        return t('shell.compactRecovery');
      case 'unavailable':
        return t('shell.compactNoInstance');
      case 'failed':
        return t('shell.compactFailed', { reason: result.detail ?? '' });
    }
  };

  const note = outcome();

  return (
    <>
      <button
        ref={rootRef}
        type="button"
        className="ctx-btn"
        data-state={state}
        data-testid="status-context"
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setResult(null);
        }}
      >
        <span className="ctx mono" data-known={known ? 'true' : 'false'} {...meter}>
          <span className="ctx-abs">{used} / {window}</span>
          {percent !== null && (
            <>
              <span className="ctx-sep" aria-hidden="true">·</span>
              <span className="ctx-pct">{percent}</span>
            </>
          )}
        </span>
        <span className="ctx-caret" aria-hidden="true">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="ctx-pop"
            role="group"
            aria-label={t('shell.context')}
            data-testid="context-panel"
          >
            <div className="ctx-pop-h">{t('shell.context')}</div>
            <dl className="ctx-pop-rows">
              <div>
                <dt>{t('shell.contextUsed')}</dt>
                <dd className="mono">{used}</dd>
              </div>
              <div>
                <dt>{t('shell.contextWindow')}</dt>
                <dd className="mono">{window}</dd>
              </div>
              <div>
                <dt>{t('shell.contextPercent')}</dt>
                <dd className="mono">{percent ?? '?'}</dd>
              </div>
              <div>
                <dt>{t('shell.contextAuto')}</dt>
                <dd>{auto === null ? '?' : auto}</dd>
              </div>
            </dl>
            <p className="f3 ctx-pop-note">{t('shell.contextEstimate')}</p>
            <button
              type="button"
              className="btn pri ctx-compact"
              onClick={() => void run()}
              disabled={disabled}
              aria-busy={pending}
              data-testid="context-compact"
            >
              {pending ? t('shell.compactBusy') : t('shell.compactNow')}
            </button>
            {reason !== null && <p className="f3 ctx-pop-note">{reason}</p>}
            {note !== null && (
              <p className="f3 ctx-pop-note" data-testid="context-compact-result">
                {note}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
