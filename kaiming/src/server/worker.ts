/**
 * The workbench worker: the one place that turns accepted inputs into real Pi runs.
 *
 * Sessions are independent: one long run must not stop another session's message from starting.
 * The worker therefore starts every session that has no run in flight, while the store still allows
 * at most one processing input per session. A session whose work is blocked (no model, missing
 * directory, a controlled Task) ends its run quickly and never spins the loop.
 */
import type { Store } from '../store/store.ts';
import type { RunOutcome } from '../runtime/runner.ts';

export interface WorkerRunner {
  runNext(sessionId: string): Promise<RunOutcome>;
}

export interface WorkerOptions {
  readonly store: Store;
  readonly runner: WorkerRunner;
  /** How long to wait when nothing is runnable; a notify wakes the loop immediately. */
  readonly idleDelayMs?: number;
  readonly onOutcome?: (sessionId: string, outcome: RunOutcome) => void;
  /** A runner failure for one session must not stop the other sessions. */
  readonly onError?: (sessionId: string, error: unknown) => void;
}

export class WorkbenchWorker {
  private readonly options: WorkerOptions;
  private readonly runs = new Map<string, Promise<void>>();
  private stopped = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(options: WorkerOptions) {
    this.options = options;
  }

  start(): void {
    if (this.loop !== undefined) {
      return;
    }
    this.stopped = false;
    this.loop = this.run();
  }

  /** Wake the loop: an input was accepted, a Task was resumed, or a stop was confirmed. */
  notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.notify();
    await this.loop;
    this.loop = undefined;
    // Runs already started are allowed to finish; closing the store under them would lose the
    // terminal state. Their finalizers notify the loop, which is already stopped.
    await Promise.allSettled([...this.runs.values()]);
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      for (const session of this.options.store.listSessions()) {
        if (this.stopped || this.runs.has(session.id)) continue;
        // Starting is synchronous up to the first await; recording the promise before returning
        // means the next pass cannot start the same session twice.
        const run = this.runOne(session.id);
        this.runs.set(session.id, run);
      }
      // Wait for a completion or new input. The timeout is only a safety net for a runner that
      // returns without notifying; it is not the scheduling interval.
      if (!this.stopped) {
        await this.waitForWork();
      }
    }
  }

  private async runOne(sessionId: string): Promise<void> {
    let progressed = false;
    try {
      const outcome = await this.options.runner.runNext(sessionId);
      this.options.onOutcome?.(sessionId, outcome);
      // Idle/busy/controlled/blocked results are cheap observations, not progress. Waking the
      // loop for them would spin on a session with nothing to do; the idle delay is the retry.
      progressed =
        outcome.kind === 'completed' ||
        outcome.kind === 'failed' ||
        outcome.kind === 'stopped' ||
        outcome.kind === 'interrupted';
    } catch (error) {
      // One session's unexpected failure is local; the remaining sessions must keep running.
      this.options.onError?.(sessionId, error);
    } finally {
      this.runs.delete(sessionId);
      if (progressed) this.notify();
    }
  }

  private waitForWork(): Promise<void> {
    const delay = this.options.idleDelayMs ?? 250;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, delay);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
