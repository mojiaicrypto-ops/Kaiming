/**
 * The context meter in the status bar: how much of the model's window the next request would carry.
 *
 * It is deliberately text, not a colour-only bar: `617k / 1M · 61.7%` reads at a glance and survives
 * a monochrome theme. The percentage is the part kept on narrow screens; the absolute figures and
 * the tooltip explain what the number means (an estimate, not a provider bill).
 *
 * States: normal, warning (≥70%), danger (≥90%), unknown. Unknown has two causes that must not be
 * conflated: a live session right after compaction (`?`, measured after the next response) and a
 * session with no Pi instance in this process (`—`, only the window is known).
 */
import { useI18n } from '../i18n/I18nProvider';
import type { ContextView } from '../api/stream';

type MeterState = 'normal' | 'warn' | 'danger' | 'unknown';

/** Counts are read at a glance: 1.2M and 480k, never 1200000. */
function compact(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Number((count / 1_000).toFixed(1))}k`;
  return String(count);
}

export function ContextMeter({ context }: { context: ContextView }) {
  const { t } = useI18n();
  if (context.contextWindow <= 0) return null;

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

  return (
    <span
      className="ctx mono"
      data-state={state}
      data-known={known ? 'true' : 'false'}
      data-testid="status-context"
      title={title}
      aria-label={title}
      {...meter}
    >
      <span className="ctx-abs">{used} / {window}</span>
      {percent !== null && (
        <>
          <span className="ctx-sep" aria-hidden="true">·</span>
          <span className="ctx-pct">{percent}</span>
        </>
      )}
    </span>
  );
}
