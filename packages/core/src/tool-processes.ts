/**
 * The live tool processes of every Attempt, so cancellation can reach them.
 *
 * `docs/architecture/reliability.md` §6 requires that a cancel "停止新工具→SIGTERM后
 * 10秒SIGKILL工具进程树", and §2 that a lost heartbeat freezes new tools and the
 * supervisor terminates the old execution. A Runner subprocess is not the process
 * running the tools — the daemon is (`execution.md` §2: "Shell请求由Supervisor另起
 * 工具容器") — so the daemon must own a registry of the child processes it started on
 * behalf of each Attempt. This is that registry:
 *
 * - the Broker registers every handle it starts, keyed by `attemptId`;
 * - `kill(attemptId)` terminates that Attempt's whole set with the escalating
 *   SIGTERM→SIGKILL the process port implements;
 * - a handle removes itself when it settles, so the registry never grows without bound
 *   and a killed pid is never signalled twice.
 *
 * The registry holds no persistent state: it is process-local runtime bookkeeping, and
 * a daemon restart has no surviving children by definition. The durable half of the
 * same story is the `tool_operation` row (`reliability.md` §2), which is why an
 * interrupted process leaves its operation `prepared`/`unknown` for recovery rather
 * than pretending it finished.
 */
import type { AsyncProcessHandle } from './process-async.js';

/** What one `kill` call did, for the audit line the caller writes. */
export interface ToolProcessKillReport {
  readonly attemptId: string;
  readonly killed: number;
}

export class ToolProcessRegistry {
  private readonly byAttempt = new Map<string, Set<AsyncProcessHandle>>();

  /**
   * Records one started process under an Attempt.
   *
   * The handle is removed automatically when it settles. A handle that already settled
   * before registration is dropped instead of stored, so a fast command never leaves a
   * live-looking entry behind.
   */
  register(attemptId: string, handle: AsyncProcessHandle): () => void {
    const unregister = (): void => {
      const handles = this.byAttempt.get(attemptId);
      if (handles === undefined) return;
      handles.delete(handle);
      if (handles.size === 0) this.byAttempt.delete(attemptId);
    };
    if (handle.settled) return unregister;
    const handles = this.byAttempt.get(attemptId) ?? new Set<AsyncProcessHandle>();
    handles.add(handle);
    this.byAttempt.set(attemptId, handles);
    void handle.done.then(unregister, unregister);
    return unregister;
  }

  /**
   * Terminates every live process of one Attempt.
   *
   * @returns how many handles were signalled; `0` means the Attempt had none running,
   * which is the normal case for a cancel between tool calls.
   */
  kill(attemptId: string, reason: 'timeout' | 'cancelled' = 'cancelled'): number {
    const handles = this.byAttempt.get(attemptId);
    if (handles === undefined) return 0;
    let killed = 0;
    for (const handle of [...handles]) {
      if (handle.settled) continue;
      handle.cancel(reason);
      killed += 1;
    }
    return killed;
  }

  /** Terminates every live tool process; used by graceful shutdown (`reliability.md` §7). */
  killAll(reason: 'timeout' | 'cancelled' = 'cancelled'): readonly ToolProcessKillReport[] {
    const reports: ToolProcessKillReport[] = [];
    for (const attemptId of [...this.byAttempt.keys()]) {
      reports.push({ attemptId, killed: this.kill(attemptId, reason) });
    }
    return reports;
  }

  /** The Attempt ids with at least one live process (diagnostics and tests). */
  activeAttempts(): string[] {
    return [...this.byAttempt.keys()];
  }

  /** How many live processes one Attempt owns, or every Attempt when omitted. */
  activeCount(attemptId?: string): number {
    if (attemptId !== undefined) return this.byAttempt.get(attemptId)?.size ?? 0;
    let total = 0;
    for (const handles of this.byAttempt.values()) total += handles.size;
    return total;
  }
}
