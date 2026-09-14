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
import type { ProjectStore } from '@agentdev/storage';

import { RunLifecycle } from './run-lifecycle.js';
import { RunRecoveryService, createNodeProcessProbe, type ProcessProbe } from './recovery.js';
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

  /** Stops accepting work and asks every Runner to shut down, then terminates. */
  async stop(options: { readonly graceMs?: number } = {}): Promise<void> {
    this.stopping = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const graceMs = options.graceMs ?? LIMITS.cancelGraceSec.default * 1000;
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
        // The pipe may already be gone; the signal below still covers it.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(graceMs, 200)));
    for (const entry of entries) {
      if (this.live.has(entry.attemptId)) this.terminate(entry, 'SIGTERM');
    }
    for (const entry of entries) this.clearKillTimer(entry);
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
      parked.push(entry.runId);
    }
    return parked;
  }

  private markAttemptLost(entry: LiveAttempt): void {
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt === undefined) return;
    const status: Attempt['status'] = entry.result?.status === 'completed' ? 'completed' : 'lost';
    if (attempt.status === 'completed' || attempt.status === 'failed') return;
    this.store.attempts.update(attempt.id, { status }, attempt.version);
  }

  private park(runId: string): void {
    const outcome = this.recovery.recoverRun(runId);
    if (outcome.changed) this.log(`supervisor: parked ${runId} as ${outcome.to}`);
  }

  // -------------------------------------------------------------------------
  // Claiming
  // -------------------------------------------------------------------------

  private queued(): readonly Run[] {
    const runs = this.store.runs.list({ where: "status = 'queued'" });
    return [...runs].sort((left, right) => {
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
      if (this.live.has(run.id)) continue;
      if (!this.capacityFor(run.role, chiefQueued)) continue;
      try {
        this.spawnRun(run);
        claimed.push(run.id);
      } catch (error) {
        // A Run that was admitted and then failed to prepare fails closed; a Run the
        // admission gate refused stays queued (retrying next tick is the honest
        // behaviour, and the refusal is logged).
        this.log(`supervisor: cannot start ${run.id}: ${messageOf(error)}`);
        const current = this.store.runs.find(run.id);
        if (current !== undefined && current.status !== 'queued') {
          this.lifecycle.settle(run.id, 'failed');
        }
      }
    }
    return claimed;
  }

  private spawnRun(run: Run): void {
    const runnerId = `runner-${String(process.pid)}-${run.id}`;
    // 1. Persist Starting + the Attempt (epoch, runner identity) before any process runs.
    const attempt = this.lifecycle.beginAttempt(run.id, { runnerId });
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
    const entry: LiveAttempt = {
      runId: run.id,
      attemptId: attempt.id,
      epoch,
      role: run.role,
      process: child,
      runnerId,
      prompt: invocation.prompt,
      ready: false,
      lastSeenAt: this.now(),
      lastHeartbeatWritten: 0,
      killTimer: undefined,
      result: undefined,
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
    switch (message.type) {
      case 'attempt.heartbeat': {
        const attempt = this.store.attempts.find(entry.attemptId);
        if (attempt !== undefined && this.now() - entry.lastHeartbeatWritten >= 1_000) {
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
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt !== undefined && attempt.status !== 'completed' && attempt.status !== 'failed') {
      const status: Attempt['status'] =
        result.status === 'completed'
          ? 'completed'
          : result.status === 'cancelled'
            ? 'stopped'
            : 'failed';
      this.store.attempts.update(attempt.id, { status }, attempt.version);
    }
    this.live.delete(entry.attemptId);
    this.clearKillTimer(entry);
    if (result.status === 'cancelled') {
      this.lifecycle.settle(entry.runId, 'cancelled');
    } else if (result.status === 'completed') {
      this.lifecycle.settle(entry.runId, 'completed');
    } else {
      this.lifecycle.settle(entry.runId, 'failed');
    }
  }

  private failAttempt(entry: LiveAttempt, message: string): void {
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt !== undefined) {
      this.store.attempts.update(attempt.id, { status: 'failed' }, attempt.version);
    }
    this.live.delete(entry.attemptId);
    this.terminate(entry, 'SIGTERM');
    this.lifecycle.settle(entry.runId, 'failed');
    this.log(`supervisor: ${entry.runId} attempt ${entry.attemptId} failed: ${message}`);
  }

  private onExit(
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
    this.clearKillTimer(entry);
    const attempt = this.store.attempts.find(entry.attemptId);
    if (attempt !== undefined && attempt.status !== 'completed' && attempt.status !== 'failed') {
      this.store.attempts.update(attempt.id, { status: 'lost' }, attempt.version);
    }
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
