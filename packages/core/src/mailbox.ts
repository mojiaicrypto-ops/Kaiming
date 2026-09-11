/**
 * The serial short-command mailbox.
 *
 * `reliability.md` §1 defines the split this class enforces: business commands
 * run one at a time inside a transaction ("所有业务事务由ProjectMailbox串行提交"),
 * while model calls, shell, Git, downloads and Child waits execute asynchronously
 * *outside* the transaction. That is what makes AC-056 true — a message or cancel
 * arriving while a long model call is in flight is admitted and answered instead
 * of queueing behind it.
 *
 * Queue limits are the AC-059 back-pressure rule; a rejected command is answered
 * `BUSY` so the client can retry the same idempotency key.
 */
import type { JsonObject } from '@agentdev/contracts';

export interface MailboxLimits {
  /** Maximum queued commands; `data.md`/WP-01 use 256. */
  readonly queueItems: number;
  /** Maximum queued bytes; WP-01 uses 4 MiB. */
  readonly queueBytes: number;
  /** A transaction slower than this is reported as a diagnostic. */
  readonly slowCommandMs: number;
}

export const DEFAULT_MAILBOX_LIMITS: MailboxLimits = {
  queueItems: 256,
  queueBytes: 4 * 1024 * 1024,
  slowCommandMs: 100,
};

export interface CommandTask<T> {
  readonly subject: string;
  readonly operation: string;
  /** Approximate size of the command payload, for queue accounting. */
  readonly bytes?: number;
  readonly run: () => T;
}

export interface EffectTask<T> {
  readonly label: string;
  readonly run: () => Promise<T>;
}

export type CommandAdmission<T> =
  | { readonly accepted: true; readonly id: string; readonly completion: Promise<T> }
  | {
      readonly accepted: false;
      readonly code: 'BUSY';
      readonly reason: 'QUEUE_ITEMS' | 'QUEUE_BYTES' | 'CLOSED';
      readonly queueItems: number;
      readonly queueBytes: number;
      readonly limits: MailboxLimits;
    };

export interface MailboxDiagnostic {
  readonly code:
    'SLOW_COMMAND' | 'COMMAND_REJECTED' | 'EFFECT_STARTED' | 'EFFECT_FINISHED' | 'EFFECT_FAILED';
  readonly at: string;
  readonly operation: string;
  readonly durationMs?: number;
  readonly queueItems: number;
  readonly queueBytes: number;
  readonly details?: JsonObject;
}

export interface MailboxStats {
  readonly queueItems: number;
  readonly queueBytes: number;
  readonly processed: number;
  readonly rejected: number;
  readonly running: boolean;
  readonly activeEffects: number;
  readonly limits: MailboxLimits;
}

export interface MailboxOptions {
  readonly limits?: Partial<MailboxLimits>;
  /** Wall clock in milliseconds; injectable so diagnostics are testable. */
  readonly now?: () => number;
  /** ISO timestamp clock for diagnostics. */
  readonly timestamp?: () => string;
  readonly onDiagnostic?: (diagnostic: MailboxDiagnostic) => void;
}

interface QueuedItem {
  readonly id: string;
  readonly operation: string;
  readonly bytes: number;
  readonly run: () => unknown;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

let sequence = 0;

/**
 * Serialised command execution for one Project.
 *
 * Instances never wait on each other: one Project owns one mailbox, and an effect
 * started here does not hold the queue.
 */
export class ProjectMailbox {
  private readonly limits: MailboxLimits;
  private readonly now: () => number;
  private readonly timestamp: () => string;
  private readonly onDiagnostic: (diagnostic: MailboxDiagnostic) => void;
  private readonly queue: QueuedItem[] = [];
  private readonly effects = new Map<string, { label: string; startedAt: number }>();
  private tail: Promise<void> = Promise.resolve();
  private running = false;
  private queueBytes = 0;
  private processed = 0;
  private rejected = 0;
  private closed = false;

  constructor(options: MailboxOptions = {}) {
    this.limits = { ...DEFAULT_MAILBOX_LIMITS, ...options.limits };
    this.now = options.now ?? (() => Date.now());
    this.timestamp = options.timestamp ?? (() => new Date().toISOString());
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
  }

  /**
   * Admits a short command and returns its completion promise.
   *
   * Admission is synchronous so a caller answers `BUSY` immediately; the command
   * itself runs after every command admitted before it.
   */
  submitCommand<T>(task: CommandTask<T>): CommandAdmission<T> {
    const bytes = task.bytes ?? 0;
    if (this.closed) return this.reject('CLOSED', task.operation, bytes);
    if (this.queue.length >= this.limits.queueItems) {
      return this.reject('QUEUE_ITEMS', task.operation, bytes);
    }
    if (this.queueBytes + bytes > this.limits.queueBytes) {
      return this.reject('QUEUE_BYTES', task.operation, bytes);
    }

    sequence += 1;
    const id = `mailbox-${sequence}`;
    this.queueBytes += bytes;
    const completion = new Promise<unknown>((resolve, reject) => {
      this.queue.push({ id, operation: task.operation, bytes, run: task.run, resolve, reject });
    });
    this.tail = this.tail.then(() => this.step());
    return { accepted: true, id, completion: completion as Promise<T> };
  }

  /**
   * Runs a long operation outside the queue.
   *
   * Used for model calls, shell, Git, downloads and Child waits. Only the label
   * and lifetime are tracked, so diagnostics can show that work is in flight
   * without that work ever delaying a command.
   */
  async runEffect<T>(task: EffectTask<T>): Promise<T> {
    this.effects.set(task.label, { label: task.label, startedAt: this.now() });
    this.emit('EFFECT_STARTED', task.label, {
      queueItems: this.queue.length,
      queueBytes: this.queueBytes,
    });
    try {
      const result = await task.run();
      const started = this.effects.get(task.label)?.startedAt ?? this.now();
      this.effects.delete(task.label);
      this.emit('EFFECT_FINISHED', task.label, {
        durationMs: this.now() - started,
        queueItems: this.queue.length,
        queueBytes: this.queueBytes,
      });
      return result;
    } catch (error) {
      const started = this.effects.get(task.label)?.startedAt ?? this.now();
      this.effects.delete(task.label);
      this.emit('EFFECT_FAILED', task.label, {
        durationMs: this.now() - started,
        queueItems: this.queue.length,
        queueBytes: this.queueBytes,
        details: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /** Labels of the long operations currently running outside the queue. */
  activeEffects(): string[] {
    return [...this.effects.keys()];
  }

  stats(): MailboxStats {
    return {
      queueItems: this.queue.length,
      queueBytes: this.queueBytes,
      processed: this.processed,
      rejected: this.rejected,
      running: this.running,
      activeEffects: this.effects.size,
      limits: this.limits,
    };
  }

  /** Waits until every admitted command has run. */
  async drain(): Promise<void> {
    // Each round may append more work to `tail`, so loop until it is quiet.
    let previous = -1;
    while (previous !== this.processed) {
      previous = this.processed;
      await this.tail;
    }
  }

  /** Refuses new commands; in-flight work still finishes. */
  async close(): Promise<void> {
    this.closed = true;
    await this.drain();
  }

  private reject<T>(
    reason: 'QUEUE_ITEMS' | 'QUEUE_BYTES' | 'CLOSED',
    operation: string,
    bytes: number,
  ): CommandAdmission<T> {
    this.rejected += 1;
    this.emit('COMMAND_REJECTED', operation, {
      queueItems: this.queue.length,
      queueBytes: this.queueBytes,
      details: { reason, bytes },
    });
    return {
      accepted: false,
      code: 'BUSY',
      reason,
      queueItems: this.queue.length,
      queueBytes: this.queueBytes,
      limits: this.limits,
    };
  }

  /** Runs exactly one queued command; the chain awaits this between items. */
  private step(): void {
    const item = this.queue.shift();
    if (item === undefined) return;
    this.queueBytes -= item.bytes;
    this.running = true;
    const started = this.now();
    try {
      const result = item.run();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.running = false;
      this.processed += 1;
      const durationMs = this.now() - started;
      if (durationMs > this.limits.slowCommandMs) {
        this.emit('SLOW_COMMAND', item.operation, {
          durationMs,
          queueItems: this.queue.length,
          queueBytes: this.queueBytes,
        });
      }
    }
  }

  private emit(
    code: MailboxDiagnostic['code'],
    operation: string,
    extra: {
      durationMs?: number;
      queueItems: number;
      queueBytes: number;
      details?: JsonObject;
    },
  ): void {
    this.onDiagnostic({
      code,
      at: this.timestamp(),
      operation,
      queueItems: extra.queueItems,
      queueBytes: extra.queueBytes,
      ...(extra.durationMs === undefined ? {} : { durationMs: extra.durationMs }),
      ...(extra.details === undefined ? {} : { details: extra.details }),
    });
  }
}
