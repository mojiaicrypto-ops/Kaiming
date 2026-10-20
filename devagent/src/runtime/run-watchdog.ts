/**
 * Run watchdog (async fault tolerance): a run that stops producing activity, or that never
 * ends, must reach a terminal state instead of waiting forever.
 *
 * Peer agents bound every request/stream and convert a hang into an explicit error
 * (Claude Code: request/stream timeouts + retries; Codex: per-request timeout). A coding run
 * is a long-lived stream, so the bound here is two-fold:
 *   - stall window: no Pi activity at all for this long (a dead provider/stream);
 *   - total window: the run exceeds this duration outright.
 * Both abort the real run and raise `RunWatchdogError`; the caller records a verifiable
 * terminal state (interrupted) rather than leaving the input `processing` forever.
 */

export type RunWatchdogCode = 'RUN_STALLED' | 'RUN_TIMEOUT';

export class RunWatchdogError extends Error {
  readonly code: RunWatchdogCode;
  readonly detail: string;

  constructor(code: RunWatchdogCode, detail: string) {
    super(detail);
    this.name = 'RunWatchdogError';
    this.code = code;
    this.detail = detail;
  }
}

export interface WatchdogOptions {
  /** Start the real run; resolves when Pi settles (including after an abort). */
  readonly prompt: () => Promise<void>;
  /** Abort the run; the watchdog calls this once when a window is exceeded. */
  readonly abort: () => Promise<void>;
  /** Epoch millis of the last observed Pi activity for this run. */
  readonly activityAt: () => number;
  /**
   * True while the run waits for the user (a pending question). Human time is not a stall and does
   * not count against the total window either: an unanswered question must not kill the run.
   */
  readonly waiting?: () => boolean;
  readonly stallMs: number;
  readonly totalMs: number;
  readonly now?: () => number;
  /** How often the windows are checked (defaults to a quarter of the stall window). */
  readonly tickMs?: number;
}

/** Run `prompt` under the watchdog. Throws RunWatchdogError when a window trips. */
export async function runWithWatchdog(options: WatchdogOptions): Promise<void> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  let trip: { code: RunWatchdogCode; detail: string } | null = null;
  let waitedMs = 0;
  let lastTick = startedAt;
  const check = (): void => {
    if (trip !== null) return;
    const current = now();
    const delta = current - lastTick;
    lastTick = current;
    if (options.waiting?.() === true) {
      // Frozen, not tripped: the same wait must not be charged twice across ticks.
      waitedMs += Math.max(0, delta);
      return;
    }
    const silentMs = current - Math.max(options.activityAt(), startedAt) - waitedMs;
    if (silentMs >= options.stallMs) {
      trip = {
        code: 'RUN_STALLED',
        detail: `no run activity for ${Math.round(silentMs / 1000)}s (limit ${Math.round(options.stallMs / 1000)}s); the run was aborted`,
      };
    } else if (current - startedAt - waitedMs >= options.totalMs) {
      trip = {
        code: 'RUN_TIMEOUT',
        detail: `run exceeded ${Math.round(options.totalMs / 1000)}s; the run was aborted`,
      };
    }
    if (trip !== null) {
      void options.abort().catch(() => undefined);
    }
  };
  const tick = options.tickMs ?? Math.max(25, Math.min(15_000, Math.floor(options.stallMs / 4)));
  const timer = setInterval(check, tick);
  timer.unref?.();
  try {
    await options.prompt();
    if (trip !== null) {
      const decided: { code: RunWatchdogCode; detail: string } = trip;
      throw new RunWatchdogError(decided.code, decided.detail);
    }
  } finally {
    clearInterval(timer);
  }
}
