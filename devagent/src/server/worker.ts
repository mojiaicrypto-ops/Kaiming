/**
 * The workbench worker: the one place that turns accepted inputs into real Pi runs.
 *
 * It walks the sessions fairly (R3: the dispatcher rotates, one claim per pass) and lets the runner
 * claim - so a session that has nothing consumable is simply skipped, and a session whose work is
 * blocked (no model, missing directory, a controlled Task) never spins: when nothing ran the loop
 * sleeps until a caller wakes it or the idle delay expires.
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
}

/** Outcomes that mean an input was really processed (and therefore the rotation should move on). */
const RAN: readonly RunOutcome['kind'][] = ['completed', 'failed', 'stopped', 'interrupted'];

export class WorkbenchWorker {
  private readonly options: WorkerOptions;
  private cursor = 0;
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
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const sessions = this.options.store.listSessions().map((session) => session.id);
      let ran = false;
      for (let step = 0; step < sessions.length && !this.stopped; step += 1) {
        const index = (this.cursor + step) % sessions.length;
        const sessionId = sessions[index];
        if (sessionId === undefined) {
          continue;
        }
        const outcome = await this.options.runner.runNext(sessionId);
        this.options.onOutcome?.(sessionId, outcome);
        if (RAN.includes(outcome.kind)) {
          // One input per claim (R3); the next turn starts after this session.
          this.cursor = (index + 1) % sessions.length;
          ran = true;
          break;
        }
      }
      if (!ran && !this.stopped) {
        await this.waitForWork();
      }
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
