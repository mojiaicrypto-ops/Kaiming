/**
 * RunnerSupervisor — the daemon's Run executor (WP-11 A2).
 *
 * `docs/architecture/ARCHITECTURE.md` §1 puts the supervisor inside `agentdevd`
 * ("RunnerSupervisor → 独立Runner → Pi Session"), and `reliability.md` §1/§2/§3 fix what
 * it must do:
 *
 * - a Claim gets a 30s lease, and restart re-checks unfinished claims ("每次Claim设30秒
 *   lease，进程重启后重新核对未完成claim；无幂等证明的副作用进入recovery_required");
 * - every Attempt gets an递增 epoch and a Capability; the Runner is started only after
 *   the state is persisted, and `ready` confirms epoch/process/environment before the
 *   Run is considered Running;
 * - heartbeats arrive every 5s and 20s of silence marks the Attempt `lost` and parks the
 *   Run (`interrupted`, or `recovery_required` when an effect is unconfirmed);
 * - Chief slots are served before professional slots, with `projectConcurrentRunners`
 *   and `roleConcurrency` as the ceilings.
 *
 * The supervisor deliberately owns **no** state transitions of its own: it claims and
 * spawns, then hands every verdict to `RunLifecycle` and `RunRecoveryService`, which are
 * the reviewed implementations of those rules. Spawning is an injected port so Core
 * never depends on `apps/runner` and the tests can drive a scripted process.
 */
import { LIMITS, type Attempt, type Run, type RunStatus } from '@agentdev/contracts';
import { isTerminalRunStatus } from '@agentdev/domain';
import type { ProjectStore } from '@agentdev/storage';

import { RunLifecycle, type RunUsage } from './run-lifecycle.js';
import {
  RunRecoveryService,
  createNodeProcessProbe,
  newAttemptAdmission,
  type ProcessProbe,
} from './recovery.js';
import type { DistributiveOmit, RunnerCommand, RunnerMessage } from '@agentdev/contracts';

/** The environment one Runner process is started with. */
export interface RunnerInvocation {
  /** Working directory the session is bound to (a Task worktree, or the project root). */
  readonly cwd: string;
  /** Pi agent directory (`<state>/projects/<id>/agent`). */
  readonly agentDir: string;
  readonly provider: string;
  readonly modelId: string;
  readonly tools: readonly string[];
  readonly prompt: string;
  readonly systemPrompt?: string;
  /** Short-lived attempt capability the Runner presents to the model gateway. */
  readonly capability: string;
  /** Per-Attempt `models.json` the Runner passes as `--models-path`. */
  readonly catalogPath?: string;
}

export interface RunnerSpawnInput {
  readonly run: Run;
  readonly attempt: Attempt;
  /** 1-based epoch of this Attempt (`attempt.ownerEpoch + 1`). */
  readonly epoch: number;
  readonly runnerId: string;
  readonly invocation: RunnerInvocation;
}

/** One live Runner process, as the supervisor sees it. */
export interface RunnerProcessPort {
  readonly pid: number;
  send(command: RunnerCommand): void;
  onMessage(listener: (message: RunnerMessage) => void): void;
  onExit(
    listener: (exit: { readonly code: number | null; readonly signal: string | null }) => void,
  ): void;
  terminate(signal: 'SIGTERM' | 'SIGKILL'): void;
}

/** Starts one Runner process. The daemon injects the real `child_process` version. */
export interface RunnerSpawnPort {
  spawn(input: RunnerSpawnInput): RunnerProcessPort;
}

/**
 * Accumulates the token usage a Run's Attempts reported during execution.
 *
 * `reliability.md` §3 books usage at settlement (`RunLifecycle.reconcile` refuses a
 * non-terminal Run), so the supervisor records what the gateway endpoint observed and
 * hands the total to `settle`.
 */
export interface RunUsageLedger {
  record(runId: string, usage: { readonly tokensUsed: number; readonly cost?: number }): void;
  /** Returns and clears the accumulated usage of one Run, shaped for `settle`. */
  take(runId: string): RunUsage | undefined;
}

/** The in-process ledger the daemon uses; a crash loses only unbooked usage. */
export function createMemoryUsageLedger(): RunUsageLedger {
  const byRun = new Map<string, { tokensUsed: number; cost: number }>();
  return {
    record: (runId, usage) => {
      const current = byRun.get(runId) ?? { tokensUsed: 0, cost: 0 };
      current.tokensUsed += usage.tokensUsed;
      current.cost += usage.cost ?? 0;
      byRun.set(runId, current);
    },
    take: (runId) => {
      const current = byRun.get(runId);
      if (current === undefined) return undefined;
      byRun.delete(runId);
      // `measured: true`: the numbers come from real Provider usage, not an estimate.
      return current.cost > 0
        ? { tokensUsed: current.tokensUsed, cost: current.cost, measured: true }
        : { tokensUsed: current.tokensUsed, measured: true };
    },
  };
}

export interface PrepareRunInput {
  readonly run: Run;
  readonly attempt: Attempt;
  readonly epoch: number;
}

/** Builds the Runner invocation for one Attempt (frozen profile, cwd, prompt, tools). */
export type PrepareRun = (input: PrepareRunInput) => RunnerInvocation;

export interface SupervisorConcurrency {
  /** `ARCHITECTURE.md` §5 `projectConcurrentRunners`. */
  readonly project: number;
  /** `ARCHITECTURE.md` §5 `roleConcurrency`. */
  readonly role: number;
  /** Slots kept free for Chief work while professionals are queued. */
  readonly chiefReserve: number;
}

export interface RunnerSupervisorOptions {
  readonly store: ProjectStore;
  readonly spawn: RunnerSpawnPort;
  readonly prepare: PrepareRun;
  /** Shared lifecycle; defaults to a new one over the same store. */
  readonly lifecycle?: RunLifecycle;
  /** Shared recovery service; defaults to one over the same store and process probe. */
  readonly recovery?: RunRecoveryService;
  /** Process probe the recovery service uses to decide if a Runner is still alive. */
  readonly probe?: ProcessProbe;
  readonly now?: () => number;
  readonly concurrency?: Partial<SupervisorConcurrency>;
  /** How often `tick()` runs while the supervisor is started. */
  readonly tickMs?: number;
  /** Usage reported by the model gateway endpoint, settled with the Run. */
  readonly usage?: RunUsageLedger;
  /**
   * Called whenever an Attempt stops being live, whatever the reason.
   *
   * The daemon revokes the Attempt's capability here (`reliability.md` §2 "撤销Capability"),
   * so a parked or finished Attempt can never call the model gateway again.
   */
  readonly onAttemptEnded?: (input: {
    readonly runId: string;
    readonly attemptId: string;
    readonly reason: 'result' | 'error' | 'exit' | 'timeout' | 'shutdown';
  }) => void;
  readonly log?: (line: string) => void;
}

/** What one `tick()` did; the tests and the daemon's log both read this. */
export interface SupervisorTick {
  readonly claimed: readonly string[];
  readonly parked: readonly string[];
  readonly live: number;
}

interface LiveAttempt {
  readonly runId: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly role: Run['role'];
  readonly process: RunnerProcessPort;
  readonly runnerId: string;
  prompt: string;
  ready: boolean;
  lastSeenAt: number;
  lastHeartbeatWritten: number;
  killTimer: NodeJS.Timeout | undefined;
  result: { status: 'completed' | 'failed' | 'cancelled'; message: string } | undefined;
  /** Set as soon as the child process is observed to have exited (WP11R2-01). */
  exited: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RunnerSupervisor {
  private readonly store: ProjectStore;
  private readonly lifecycle: RunLifecycle;
  private readonly recovery: RunRecoveryService;
  private readonly spawn: RunnerSpawnPort;
  private readonly prepare: PrepareRun;
  private readonly now: () => number;
  private readonly concurrency: SupervisorConcurrency;
  private readonly tickMs: number;
  private readonly usage: RunUsageLedger | undefined;
  private readonly onAttemptEnded: RunnerSupervisorOptions['onAttemptEnded'];
  private readonly log: (line: string) => void;
  private readonly live = new Map<string, LiveAttempt>();
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;
  private runsStarted = 0;

  constructor(options: RunnerSupervisorOptions) {
    this.store = options.store;
    this.lifecycle = options.lifecycle ?? new RunLifecycle({ store: options.store });
    this.recovery =
      options.recovery ??
      new RunRecoveryService({
        store: options.store,
        probe: options.probe ?? createNodeProcessProbe(),
      });
    this.spawn = options.spawn;
    this.prepare = options.prepare;
    this.now = options.now ?? (() => Date.now());
    this.concurrency = {
      project: options.concurrency?.project ?? LIMITS.projectConcurrentRunners.default,
      role: options.concurrency?.role ?? LIMITS.roleConcurrency.default,
      chiefReserve: options.concurrency?.chiefReserve ?? 1,
    };
    this.tickMs = options.tickMs ?? 1_000;
    this.usage = options.usage;
    this.onAttemptEnded = options.onAttemptEnded;
    this.log = options.log ?? (() => undefined);
  }

  /**
   * Reconciles what a previous process left behind, then starts ticking.
   *
   * `reliability.md` §7: a `SIGKILL`ed daemon must not leave a Run looking "still
   * running" — every resumable Run is inspected against real process state and parked
   * with a recovery verdict before any new Attempt may open (`newAttemptAdmission`).
   */
  start(hostEpoch: string): ReturnType<RunRecoveryService['recoverAfterRestart']> {
    this.stopping = false;
    const result = this.recovery.recoverAfterRestart(hostEpoch);
    for (const parked of result.applied) {
      if (!parked.changed) continue;
      this.log(`supervisor: ${parked.runId} ${parked.from} → ${parked.to}`);
    }
    for (const runId of result.requiresDecision) {
      this.log(`supervisor: ${runId} needs a recovery decision before a new Attempt`);
    }
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
    return result;
  }

  /** One scheduling pass: sweep stale Attempts, then claim what capacity allows. */
  tick(): SupervisorTick {
    if (this.stopping) return { claimed: [], parked: [], live: this.live.size };
    const parked = this.sweep();
    const claimed = this.claim();
    return { claimed, parked, live: this.live.size };
  }

  /**
   * Stops accepting work and asks every Runner to shut down.
   *
   * `reliability.md` §7's graceful stop is "请求 Runner 安全停 → 保存 Checkpoint": a Run
   * that is mid-Attempt is therefore parked for recovery, not settled as a terminal
   * cancellation (the daemon is going away, the work is not). A Runner that ignores the
   * request is SIGTERMed and, after `cancelGraceSec`, SIGKILLed — the escalation timer is
   * *kept*, so no orphan is left behind.
   */
  async stop(
    options: { readonly graceMs?: number; readonly killAfterMs?: number } = {},
  ): Promise<void> {
    this.stopping = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const entries = [...this.live.values()];
    for (const entry of entries) {
      try {
        entry.process.send({
          v: 1,
          attemptId: entry.attemptId,
          epoch: entry.epoch,
          type: 'attempt.shutdown',
        });
      } catch {
        // The pipe may already be gone; the signals below still cover it.
      }
    }
    // Give a cooperative Runner a moment to end its Attempt by itself.
    // Real wall-clock wait: the injected clock is for domain timestamps, not for waiting.
    const graceMs = options.graceMs ?? 3_000;
    const deadline = Date.now() + graceMs;
    for (const entry of entries) {
      while (!entry.exited && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    // Then escalate: SIGTERM, wait `cancelGraceSec`, SIGKILL, and confirm. `stop()` only
    // returns once every child is gone, so the daemon never exits over a live Runner
    // (`reliability.md` §7 "回收容器/进程"; WP11R2-01).
    const killAfterMs = options.killAfterMs ?? LIMITS.cancelGraceSec.default * 1000;
    const stragglers = entries.filter((entry) => !entry.exited);
    for (const entry of stragglers) {
      this.log(`supervisor: ${entry.runId} did not stop in time; terminating`);
      this.terminate(entry, 'SIGTERM');
    }
    for (const entry of stragglers) {
      const signalDeadline = Date.now() + killAfterMs;
      while (!entry.exited && Date.now() < signalDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!entry.exited) {
        this.log(`supervisor: ${entry.runId} ignored SIGTERM; sending SIGKILL`);
        this.terminate(entry, 'SIGKILL');
        const killDeadline = Date.now() + 2_000;
        while (!entry.exited && Date.now() < killDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      if (this.live.has(entry.attemptId)) this.live.delete(entry.attemptId);
      this.markAttemptStopped(entry);
      this.park(entry.runId);
      this.ended(entry, 'shutdown');
      if (entry.killTimer !== undefined) {
        clearTimeout(entry.killTimer);
        entry.killTimer = undefined;
      }
    }
    const survivors = entries.filter((entry) => !entry.exited);
    if (survivors.length > 0) {
      // Nothing else can be done from here; reporting the pids is the honest outcome
      // instead of claiming a clean stop.
      this.log(
        `supervisor: ${String(survivors.length)} Runner process(es) did not confirm exit: ${survivors
          .map((entry) => `${entry.runId}#${String(entry.process.pid)}`)
          .join(', ')}`,
      );
    }
  }

  /**
   * Records the operator's resume decision for a parked Run (`reliability.md` §6).
   *
   * Delegates to `RunRecoveryService.recordResumeDecision`, which re-checks the real
   * process state before writing the accepted decision the admission reads.
   */
  recordResumeDecision(
    runId: string,
    options: { readonly sourceMessageId?: string } = {},
  ): ReturnType<RunRecoveryService['recordResumeDecision']> {
    return this.recovery.recordResumeDecision({ runId, ...options });
  }

  /**
   * Resumes one parked Run: records nothing by itself, but opens the next Attempt.
   *
   * `reliability.md` §6 resumes a parked Run at a human act, so this is the action a
   * `work.control resume`/operator command calls. The durable admission is the gate:
   *
   * - an `interrupted` Run whose old process was confirmed terminated may continue with a
   *   new Attempt;
   * - a `recovery_required` Run is refused until `recordResumeDecision` recorded the
   *   accepted decision covering it (which itself re-checks the real process state).
   */
  resumeParkedRun(
    runId: string,
  ):
    | { readonly ok: true; readonly attemptId: string }
    | { readonly ok: false; readonly code: string; readonly message: string } {
    const run = this.store.runs.find(runId);
    if (run === undefined)
      return { ok: false, code: 'NOT_FOUND', message: `Run ${runId} does not exist` };
    if (run.status !== 'interrupted' && run.status !== 'recovery_required') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Run ${runId} is ${run.status}; only a parked Run can be resumed`,
      };
    }
    if ([...this.live.values()].some((entry) => entry.runId === runId)) {
      return { ok: false, code: 'INVALID_STATE', message: `Run ${runId} still has a live Attempt` };
    }
    // Re-inspect the *real* state instead of trusting the persisted park: a pid can be
    // reused, and an unconfirmable process must never be replaced (WP11R3-03).
    const inspection = this.recovery.inspect(runId);
    if (inspection.ok && inspection.inspection.processAlive !== false) {
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: `Run ${runId} 的旧执行状态为 ${String(inspection.inspection.processAlive)}；确认终止后才能续跑`,
      };
    }
    if (
      !this.capacityFor(
        run.role,
        this.queued().some((entry) => entry.role === 'chief'),
      )
    ) {
      return {
        ok: false,
        code: 'BUSY',
        message: `Run ${runId} 无法续跑：项目/角色并发上限已满`,
      };
    }
    const admission = newAttemptAdmission(this.store, runId);
    if (!admission.allowed) {
      return {
        ok: false,
        code: admission.code ?? 'RECOVERY_REQUIRED',
        message: admission.message ?? `Run ${runId} may not open a new Attempt yet`,
      };
    }
    try {
      this.spawnRun(run);
    } catch (error) {
      return { ok: false, code: 'START_FAILED', message: messageOf(error) };
    }
    const latest = this.store.attempts.list({ where: 'run_id = ?', params: [runId] }).at(-1);
    return { ok: true, attemptId: latest?.id ?? '' };
  }

  /** Live Attempts, for the daemon's status view and the tests. */
  liveAttempts(): readonly {
    readonly runId: string;
    readonly attemptId: string;
    readonly pid: number;
  }[] {
    return [...this.live.values()].map((entry) => ({
      runId: entry.runId,
      attemptId: entry.attemptId,
      pid: entry.process.pid,
    }));
  }

  get startedCount(): number {
    return this.runsStarted;
  }

  // -------------------------------------------------------------------------
  // Sweeping: heartbeat timeout and process exit
  // -------------------------------------------------------------------------

  private sweep(): readonly string[] {
    const parked: string[] = [];
    const idleMs = LIMITS.leaseSec.default * 1000;
    const now = this.now();
    for (const entry of [...this.live.values()]) {
      if (entry.result !== undefined) continue;
      if (now - entry.lastSeenAt <= idleMs) continue;
      // 20s of silence: freeze the Attempt, then park the Run from its real state.
      this.log(`supervisor: ${entry.runId} attempt ${entry.attemptId} silent for over ${idleMs}ms`);
      this.terminate(entry, 'SIGTERM');
      this.live.delete(entry.attemptId);
      this.markAttemptLost(entry);
      this.park(entry.runId);
      this.ended(entry, 'timeout');
      parked.push(entry.runId);
    }
    return parked;
  }

  /** Reports an Attempt that is no longer live, so its capability can be revoked. */
  private ended(
    entry: LiveAttempt,
    reason: 'result' | 'error' | 'exit' | 'timeout' | 'shutdown',
  ): void {
    try {
      this.onAttemptEnded?.({ runId: entry.runId, attemptId: entry.attemptId, reason });
    } catch (error) {
      this.log(`supervisor: onAttemptEnded failed for ${entry.attemptId}: ${messageOf(error)}`);
    }
  }

  /**
   * Runs one state transition without letting a callback throw into the child process
   * listeners.
   *
   * A late `attempt.result` for a Run the user already cancelled is normal (`reliability.md`
   * §2: late events are checked against the current state), and the daemon must stay up:
   * the transition is logged and dropped instead.
   */
  private guarded(what: string, runId: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.log(`supervisor: ${what} refused for ${runId}: ${messageOf(error)}`);
    }
  }

  private markAttemptLost(entry: LiveAttempt): void {
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt === undefined) return;
    const status: Attempt['status'] = entry.result?.status === 'completed' ? 'completed' : 'lost';
    if (attempt.status === 'completed' || attempt.status === 'failed') return;
    this.store.attempts.update(attempt.id, { status }, attempt.version);
  }

  private park(runId: string): void {
    this.guarded('recovery', runId, () => {
      const outcome = this.recovery.recoverRun(runId);
      if (outcome.changed) this.log(`supervisor: parked ${runId} as ${outcome.to}`);
    });
  }

  /** True when the Run has already ended, so a late result must not settle it again. */
  private isTerminal(runId: string): boolean {
    const run = this.store.runs.find(runId);
    return run === undefined || isTerminalRunStatus(run.status);
  }

  // -------------------------------------------------------------------------
  // Claiming
  // -------------------------------------------------------------------------

  /**
   * Runs that may be attempted now.
   *
   * Only `queued` Runs are claimed here; a parked Run is resumed by the explicit
   * `resumeParkedRun` action (`WP11R2-02`).
   */
  private queued(): readonly Run[] {
    // Two kinds of work: freshly queued Runs, and Runs whose Attempt exists but has no
    // process yet — the latter is how `FindingsService.resumeWork` hands a resumed Run to
    // the executor (WP11R3-01). A crash never retries by itself: an Attempt that recorded
    // a process identity (`runnerId`) is not adopted again.
    const runs = this.store.runs.list({ where: "status IN ('queued', 'running')" });
    const claimable = runs.filter((run) => {
      if ([...this.live.values()].some((entry) => entry.runId === run.id)) return false;
      if (run.status === 'queued') return true;
      const latest = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] }).at(-1);
      return latest !== undefined && latest.status === 'starting' && latest.runnerId === undefined;
    });
    return [...claimable].sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
      return left.id < right.id ? -1 : 1;
    });
  }

  private roleCount(role: Run['role']): number {
    let count = 0;
    for (const entry of this.live.values()) if (entry.role === role) count += 1;
    return count;
  }

  private capacityFor(role: Run['role'], chiefQueued: boolean): boolean {
    const limit = this.concurrency.project;
    if (this.live.size >= limit) return false;
    if (role !== 'chief') {
      // `ARCHITECTURE.md` §5: a project keeps one slot for Chief work. The reserve only
      // holds while a Chief Run is still waiting and none is running yet — once the
      // Chief has its slot, the remaining capacity is ordinary capacity.
      const chiefRunning = this.roleCount('chief') > 0;
      const professionalCap =
        chiefQueued && !chiefRunning ? limit - this.concurrency.chiefReserve : limit;
      if (this.live.size >= professionalCap) return false;
    }
    return this.roleCount(role) < this.concurrency.role;
  }

  private claim(): readonly string[] {
    const claimed: string[] = [];
    const queued = this.queued();
    if (queued.length === 0) return claimed;
    const chiefQueued = queued.some((run) => run.role === 'chief');
    const ordered = [
      ...queued.filter((run) => run.role === 'chief'),
      ...queued.filter((run) => run.role !== 'chief'),
    ];
    for (const run of ordered) {
      if (this.stopping) break;
      if ([...this.live.values()].some((entry) => entry.runId === run.id)) continue;
      if (!this.capacityFor(run.role, chiefQueued)) continue;
      try {
        this.spawnRun(run);
        claimed.push(run.id);
      } catch (error) {
        // A Run the admission gate refused stays queued (retrying next tick is the honest
        // behaviour). A Run whose spawn/prepare failed never got a process: its dangling
        // Attempt is marked failed and the Run is parked, so an operator can retry instead
        // of the engine destroying the work (WP11R4-01).
        this.log(`supervisor: cannot start ${run.id}: ${messageOf(error)}`);
        const current = this.store.runs.find(run.id);
        if (current !== undefined && current.status !== 'queued') {
          const dangling = this.store.attempts
            .list({ where: 'run_id = ?', params: [run.id] })
            .at(-1);
          if (
            dangling !== undefined &&
            (dangling.status === 'starting' || dangling.status === 'running')
          ) {
            this.store.attempts.update(dangling.id, { status: 'failed' }, dangling.version);
          }
          this.park(run.id);
        }
      }
    }
    return claimed;
  }

  /**
   * Runner identity in the form the recovery probe parses (`recovery.ts`: `pid:<n>` or a
   * bare pid).
   *
   * The Attempt row is created before the process exists, so the identity is written
   * provisionally and replaced with the child's pid right after the spawn. A daemon that
   * dies in that window leaves `pid:pending`, which the probe cannot resolve — the honest
   * `recovery_required` outcome, never a confident "the old writer is gone".
   */
  private static runnerIdFor(pid: number | null): string {
    return pid === null ? 'pid:pending' : `pid:${String(pid)}`;
  }

  private spawnRun(run: Run): void {
    const runnerId = RunnerSupervisor.runnerIdFor(null);
    // 1. Adopt an Attempt that exists but has no process yet — `FindingsService.resumeWork`
    //    opens one for a resumed Run, and calling `beginAttempt` again would be refused
    //    (`cannot start from running`) and fail the Run (WP11R4-01). Otherwise open a new
    //    Attempt for a queued/parked Run, which is what `beginAttempt` is for.
    const latest = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] }).at(-1);
    const adopt =
      latest !== undefined && latest.status === 'starting' && latest.runnerId === undefined;
    const attempt = adopt ? latest : this.lifecycle.beginAttempt(run.id, { runnerId });
    const epoch = attempt.ownerEpoch + 1;
    const invocation = this.prepare({ run, attempt, epoch });
    this.runsStarted += 1;
    // 2. Start the process only after the state exists.
    const child = this.spawn.spawn({
      run,
      attempt,
      epoch,
      runnerId,
      invocation,
    });
    const realRunnerId = RunnerSupervisor.runnerIdFor(child.pid);
    const stored = this.store.attempts.find(attempt.id);
    if (stored !== undefined) {
      this.store.attempts.update(stored.id, { runnerId: realRunnerId }, stored.version);
    }
    const entry: LiveAttempt = {
      runId: run.id,
      attemptId: attempt.id,
      epoch,
      role: run.role,
      process: child,
      runnerId: realRunnerId,
      prompt: invocation.prompt,
      ready: false,
      lastSeenAt: this.now(),
      lastHeartbeatWritten: 0,
      killTimer: undefined,
      result: undefined,
      exited: false,
    };
    this.live.set(attempt.id, entry);
    this.writeHeartbeat(attempt, entry);
    child.onMessage((message) => this.onMessage(entry, message));
    child.onExit((exit) => this.onExit(entry, exit));
    this.log(
      `supervisor: ${run.id} attempt ${attempt.id} started (pid ${String(child.pid)}, epoch ${String(epoch)})`,
    );
  }

  private writeHeartbeat(attempt: Attempt, entry: LiveAttempt): void {
    const current = this.store.attempts.find(attempt.id);
    if (current === undefined) return;
    const at = new Date(this.now()).toISOString();
    this.store.attempts.update(current.id, { heartbeatAt: at }, current.version);
    entry.lastHeartbeatWritten = this.now();
  }

  private onMessage(entry: LiveAttempt, message: RunnerMessage): void {
    // Late/foreign messages never steer a newer Attempt (`reliability.md` §2).
    if (message.attemptId !== entry.attemptId || message.epoch !== entry.epoch) return;
    entry.lastSeenAt = this.now();
    try {
      this.applyMessage(entry, message);
    } catch (error) {
      // A listener must never throw: the daemon would die with the Runner's pipe still
      // open (`WP11R1-01`). The refusal is logged and the Attempt is parked instead.
      this.log(`supervisor: ${entry.runId} message ${message.type} failed: ${messageOf(error)}`);
    }
  }

  private applyMessage(entry: LiveAttempt, message: RunnerMessage): void {
    if (!this.live.has(entry.attemptId)) return;
    switch (message.type) {
      case 'attempt.heartbeat': {
        const attempt = this.store.attempts.find(entry.attemptId);
        // A terminal Attempt's `heartbeat_at` is history, not liveness.
        if (
          attempt !== undefined &&
          (attempt.status === 'starting' || attempt.status === 'running') &&
          this.now() - entry.lastHeartbeatWritten >= 1_000
        ) {
          this.writeHeartbeat(attempt, entry);
        }
        return;
      }
      case 'attempt.ready': {
        // `ready` confirms epoch/process/environment before the Run is Running (§2).
        if (message.droppedTools.length > 0) {
          this.failAttempt(
            entry,
            `requested tools were not activated: ${message.droppedTools.join(', ')}`,
          );
          return;
        }
        entry.ready = true;
        const attempt = this.store.attempts.find(entry.attemptId);
        if (attempt !== undefined && attempt.status === 'starting') {
          this.store.attempts.update(attempt.id, { status: 'running' }, attempt.version);
        }
        this.send(entry, { type: 'attempt.prompt', text: entry.prompt });
        return;
      }
      case 'attempt.event': {
        // Event forwarding is the daemon's job (EventHub/token.delta); the supervisor
        // only keeps liveness here, so nothing is dropped silently on the floor.
        return;
      }
      case 'attempt.result': {
        entry.result = { status: message.status, message: message.message };
        this.finishFromResult(entry);
        return;
      }
      case 'attempt.error': {
        this.failAttempt(entry, `${message.code}: ${message.message}`);
        return;
      }
    }
  }

  private send(
    entry: LiveAttempt,
    message: DistributiveOmit<RunnerCommand, 'v' | 'attemptId' | 'epoch'>,
  ): void {
    entry.process.send({
      v: 1,
      attemptId: entry.attemptId,
      epoch: entry.epoch,
      ...message,
    });
  }

  private finishFromResult(entry: LiveAttempt): void {
    const result = entry.result;
    if (result === undefined) return;
    this.live.delete(entry.attemptId);
    this.ended(entry, 'result');
    if (this.isTerminal(entry.runId)) {
      // A late result never rewrites the Attempt either: `ATTEMPT_TRANSITIONS` makes
      // `stopped`/`lost`/`completed`/`failed` absorbing (`WP11R2-03`).
      const late = this.store.attempts.find(entry.attemptId);
      if (late !== undefined && (late.status === 'starting' || late.status === 'running')) {
        this.store.attempts.update(late.id, { status: 'lost' }, late.version);
      }
      // The user (or a cancel) already ended this Run: the result is late evidence, not a
      // new outcome (`reliability.md` §2), and settling it again would throw (WP11R1-01).
      this.log(`supervisor: ignoring the late result of ${entry.runId} (Run already ended)`);
      this.clearKillTimer(entry);
      return;
    }
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt !== undefined && (attempt.status === 'starting' || attempt.status === 'running')) {
      const status: Attempt['status'] =
        result.status === 'completed'
          ? 'completed'
          : result.status === 'cancelled'
            ? 'stopped'
            : 'failed';
      this.store.attempts.update(attempt.id, { status }, attempt.version);
    }
    if (this.stopping && result.status === 'cancelled') {
      // Graceful daemon shutdown parks the Run for a later Attempt instead of ending it.
      this.markAttemptStopped(entry);
      this.park(entry.runId);
      this.clearKillTimer(entry);
      return;
    }
    const usage = this.usage?.take(entry.runId);
    this.guarded('settlement', entry.runId, () => {
      if (result.status === 'cancelled') {
        this.lifecycle.settle(entry.runId, 'cancelled', usage);
      } else if (result.status === 'completed') {
        this.lifecycle.settle(entry.runId, 'completed', usage);
      } else {
        this.lifecycle.settle(entry.runId, 'failed', usage);
      }
    });
    this.clearKillTimer(entry);
  }

  /** Marks an Attempt the daemon asked to stop (a shutdown, not a failure). */
  private markAttemptStopped(entry: LiveAttempt): void {
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt === undefined) return;
    if (attempt.status === 'starting' || attempt.status === 'running') {
      this.store.attempts.update(attempt.id, { status: 'stopped' }, attempt.version);
    }
  }

  private failAttempt(entry: LiveAttempt, message: string): void {
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt !== undefined) {
      this.store.attempts.update(attempt.id, { status: 'failed' }, attempt.version);
    }
    this.live.delete(entry.attemptId);
    this.terminate(entry, 'SIGTERM');
    this.ended(entry, 'error');
    // An Attempt that could not report a result is a *lost* Attempt: the Run is parked
    // from its real state (`interrupted` / `recovery_required`) instead of being settled
    // as a product failure (`WP11R1-04`).
    this.park(entry.runId);
    this.log(`supervisor: ${entry.runId} attempt ${entry.attemptId} failed: ${message}`);
  }

  private onExit(
    entry: LiveAttempt,
    exit: { readonly code: number | null; readonly signal: string | null },
  ): void {
    // Recorded first: `stop()` waits on this flag even after the entry left `live`.
    entry.exited = true;
    try {
      this.handleExit(entry, exit);
    } catch (error) {
      this.log(`supervisor: exit handling failed for ${entry.runId}: ${messageOf(error)}`);
    }
  }

  private handleExit(
    entry: LiveAttempt,
    exit: { readonly code: number | null; readonly signal: string | null },
  ): void {
    if (!this.live.has(entry.attemptId)) return;
    if (entry.result !== undefined) {
      this.finishFromResult(entry);
      return;
    }
    // The process died without a result: park the Run from its real state instead of
    // guessing an outcome (`reliability.md` §7).
    this.live.delete(entry.attemptId);
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt !== undefined && attempt.status !== 'completed' && attempt.status !== 'failed') {
      this.store.attempts.update(attempt.id, { status: 'lost' }, attempt.version);
    }
    this.ended(entry, 'exit');
    this.clearKillTimer(entry);
    this.park(entry.runId);
    this.log(
      `supervisor: ${entry.runId} runner exited (code ${String(exit.code)}, signal ${String(exit.signal)}) without a result`,
    );
  }

  private terminate(entry: LiveAttempt, signal: 'SIGTERM' | 'SIGKILL'): void {
    try {
      entry.process.terminate(signal);
    } catch {
      // Already gone.
    }
    if (signal === 'SIGTERM' && entry.killTimer === undefined) {
      // `cancelGraceSec` then SIGKILL: an unconfirmed process must never be treated as
      // stopped, but it also must not be left running.
      entry.killTimer = setTimeout(() => {
        entry.killTimer = undefined;
        try {
          entry.process.terminate('SIGKILL');
        } catch {
          // Already gone.
        }
      }, LIMITS.cancelGraceSec.default * 1000);
      entry.killTimer.unref();
    }
  }

  private clearKillTimer(entry: LiveAttempt): void {
    if (entry.killTimer === undefined) return;
    clearTimeout(entry.killTimer);
    entry.killTimer = undefined;
  }
}

/** Convenience for the daemon: the statuses a supervisor may park a Run into. */
export const SUPERVISOR_PARKED_STATUSES: readonly RunStatus[] = [
  'interrupted',
  'recovery_required',
];
