/**
 * The context occupancy one live Pi session reports (M4): how many estimated tokens its next request
 * would carry, how large its model's window is, and whether Pi will compact by itself. The number is
 * an estimate, not a provider bill - the UI must say so and never present it as exact usage.
 *
 * `tokens` and `percent` are null right after compaction, until the next assistant response exists:
 * the previous usage describes the pre-compaction context and would be a lie. `live: false` means
 * the session has no Pi instance in this process, so only the window is known.
 */
import type { AgentSession } from '@earendil-works/pi-coding-agent';

export interface ContextUsageView {
  /** Estimated tokens of the next request; null when unknown (right after compaction). */
  readonly tokens: number | null;
  readonly contextWindow: number;
  /** `tokens / contextWindow` as a percentage; null when `tokens` is unknown. */
  readonly percent: number | null;
  /** Pi's auto-compaction setting; null when no live instance can report it. */
  readonly autoCompaction: boolean | null;
  /** Whether this reading came from a live instance (tokens known/unknown) or the model catalogue. */
  readonly live: boolean;
}

/** What a live session reports, or null when the model declares no context window. */
export function contextUsageOf(
  session: Pick<AgentSession, 'getContextUsage' | 'autoCompactionEnabled'>,
): ContextUsageView | null {
  const usage = session.getContextUsage();
  if (usage === undefined) return null;
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
    autoCompaction: session.autoCompactionEnabled,
    live: true,
  };
}

/**
 * The occupancy update a Pi event warrants: an assistant response moved the context, a compaction
 * invalidated the previous reading (tokens become unknown until the next response). Every other
 * event changes nothing, so it produces no notice.
 */
export function contextNoticeOf(
  event: unknown,
  session: Pick<AgentSession, 'getContextUsage' | 'autoCompactionEnabled'> | undefined,
): { readonly type: 'context'; readonly context: ContextUsageView } | null {
  const type = (event as { type?: unknown } | null)?.type;
  const role = (event as { message?: { role?: unknown } } | null)?.message?.role;
  const moved = (type === 'message_end' && role === 'assistant') || type === 'compaction_end';
  if (!moved || session === undefined) return null;
  const context = contextUsageOf(session);
  return context === null ? null : { type: 'context', context };
}

/** The window alone, for a session with no live instance: tokens/percent stay unknown. */
export function windowOnlyContext(contextWindow: number | undefined): ContextUsageView | null {
  if (contextWindow === undefined || contextWindow <= 0) return null;
  return { tokens: null, contextWindow, percent: null, autoCompaction: null, live: false };
}
