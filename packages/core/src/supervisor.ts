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
 * The supervisor owns no *domain verdict* of its own: it hands settlement, cancellation and
 * recovery verdicts to `RunLifecycle` and `RunRecoveryService`, which are the reviewed
 * implementations of those rules. The two transitions it does own are the mechanical start
 * sequence `queued → starting → running` (`reliability.md` §2) and the `interrupted` park of
 * a start that never produced a process. Spawning is an injected port so Core
 * never depends on `apps/runner` and the tests can drive a scripted process.
 */
import { LIMITS, type Attempt, type Run, type RunStatus } from '@agentdev/contracts';
import { canTransitionRun, isTerminalRunStatus } from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';

import { ProtocolError } from './errors.js';
import { scanEvents } from './events.js';
import { RunLifecycle, type RunUsage } from './run-lifecycle.js';
import {
  RUN_RECOVERED_EVENT,
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
  /**
   * Base URL of the Core control endpoint (`protocol.md` §6).
   *
   * Absent means the Runner registers no control tools; a Run without the channel cannot
   * deliver a structured result and is refused by the corrective/`contract_violation` path.
   */
  readonly controlUrl?: string;
  /** The Work this Run belongs to; a Chief assessment must name it. */
  readonly workId?: string;
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
  /**
   * Called when a Runner reports a result, before the Run is settled.
   *
   * This is where the Core learns what the model actually produced: the Attempt's
   * accumulated assistant text plus whether the Attempt delivered through the control
   * channel (`protocol.md` §6 `assessment.submit`/`agent.dispatch`/`stage.submit`).
   * Returning a corrective prompt keeps the Attempt alive and asks the model again; the
   * supervisor re-arms the same Attempt, which is what makes the documented two-strike rule
   * ("普通文本结束没有该结果时Run等待提交提示，连续两次不合规为contract_violation")
   * implementable without a second process.
   *
   * A callback that throws is logged and the result finishes normally, so a handler bug can
   * never strand a Run in `running` (`guarded` semantics).
   */
  readonly onAttemptResult?: (input: AttemptResultInput) => string | undefined;
  /**
   * Called when an Attempt is opened for a Run, before the Runner is prompted.
   *
   * `experience.md` §22 needs the message behind a Run to move `received → processing`
   * when the work actually starts, and only the daemon knows which message a Work came
   * from.
   */
  readonly onAttemptStarted?: (input: {
    readonly runId: string;
    readonly attemptId: string;
  }) => void;
  /**
   * Called after a Run reaches a terminal state, with the status it settled into.
   *
   * The counterpart of `onAttemptStarted`: the message moves to `processed`/`failed` here.
   * A parked Run is not terminal and is deliberately not reported.
   */
  readonly onRunSettled?: (input: { readonly runId: string; readonly status: RunStatus }) => void;
  readonly log?: (line: string) => void;
}

/** What one Attempt result delivered, as the daemon's result handler needs it. */
export interface AttemptResultInput {
  readonly runId: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly role: Run['role'];
  readonly purpose: Run['purpose'];
  readonly stage: string;
  readonly reason: 'result' | 'exit';
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly message: string;
  /** Assistant text accumulated from `text_delta` events, in order. */
  readonly text: string;
  /**
   * Whether this Attempt delivered through the control channel.
   *
   * The semantic question ("was *this* method the compliant one for *this* role") belongs to
   * the handler; the supervisor only reports the mechanical fact.
   */
  readonly submitted: boolean;
  /** 1 on the second result of an Attempt, after one corrective prompt. */
  readonly corrections: number;
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
  /**
   * Set by `attempt.ready`; `reliability.md` §2 makes it the gate for delivery.
   *
   * The Run only becomes Running here, and a `completed` result that arrives earlier is
   * parked instead of settled (T8b P2-1).
   */
  ready: boolean;
  /**
   * The environment the Runner reported in `attempt.ready`.
   *
   * It is the Runner's own process observation, retained so a delivery can freeze a
   * `VerificationManifest.environmentRef` for the Attempt it came from instead of a
   * placeholder (`protocol.md:123`).
   */
  environmentRef: string | undefined;
  lastSeenAt: number;
  lastHeartbeatWritten: number;
  killTimer: NodeJS.Timeout | undefined;
  result: { status: 'completed' | 'failed' | 'cancelled'; message: string } | undefined;
  /** Set as soon as the child process is observed to have exited (WP11R2-01). */
  exited: boolean;
  /**
   * Assistant text the Runner streamed, in arrival order.
   *
   * `protocol.md` §7 keeps `token.delta` a transient stream; the final text is what a
   * contract-checked submission is derived from, so the supervisor keeps it for the Run's
   * result handler instead of dropping every `attempt.event` on the floor (WP11/§6-M4).
   */
  text: string;
  /** How many corrective prompts this Attempt has already been sent. */
  corrections: number;
  /** True once a control-channel submission was accepted for this Attempt. */
  submitted: boolean;
  /**
   * Set while the supervisor waits for another result after a corrective prompt.
   *
   * The Attempt stays live in that window (the Runner is doing a second turn), so the entry
   * must not be finished twice by a late duplicate message.
   */
  correctionPending: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The one corrective prompt's contract line, per role (`protocol.md` §6).
 *
 * The daemon's own correction states the rule ("a spoken success does not change the domain
 * state"); this states the exact tool and field list, so a model that answered with prose gets
 * an unambiguous instruction rather than a restatement of the same request. `execution.md` §7
 * fixes the two tool sets, and `docs/rules/agents.md` §4 makes the structured submission the
 * only delivery.
 */
function contractReminder(role: string): string {
  return role === 'chief'
    ? 'Contract: deliver by calling `assessment_submit` (intent, goal, scope, level, semanticImpact, riskFlags, uncertainties, policyRevision, reason) and then `agent_dispatch` (role, purpose, goal, scope, stage, contextSelection, requiredOutputs, requiredChild, joinPolicy, budgetAllocation). Use the canonical stage of the role you dispatch (product→product/document/document_check; planning→planning/document; backend|frontend→develop-L1/develop-L2/develop-L3; review→review/document_check; test→test; settlement→settlement): any other stage leaves the Run with no readable context, so it can never deliver. Plain text delivers nothing and the Work does not move.'
    : 'Contract: deliver by calling `stage_yield` exactly once with status (success/needs_input/failed), summary, changedPaths, evidenceRefs, unknowns and requestedActions (add artifactRefs/findingIds when they apply). artifactRefs are {id,version,hash} pins and evidenceRefs/findingIds are ids of existing rows, never paths or prose; omit a list when it is empty. Plain text delivers nothing: the stage is judged on that tool call alone, and a `request_dispatch` call does not deliver for you.';
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
  private readonly onAttemptResult: RunnerSupervisorOptions['onAttemptResult'];
  private readonly onAttemptStarted: RunnerSupervisorOptions['onAttemptStarted'];
  private readonly onRunSettled: RunnerSupervisorOptions['onRunSettled'];
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
    this.onAttemptResult = options.onAttemptResult;
    this.onAttemptStarted = options.onAttemptStarted;
    this.onRunSettled = options.onRunSettled;
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
   *   accepted decision covering it (which itself re-checks the real process state);
   * - a Run parked by `abandonUnstarted` (a `prepare`/`spawn` failure before any process
   *   existed) needs no process probe: its verdict records that no writer was ever created.
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
    // reused, and an unconfirmable process must never be replaced (WP11R3-03). The one
    // exception is a park the supervisor itself wrote for a start that never produced a
    // process (`abandonUnstarted`): there is no old writer to confirm, and re-probing the
    // provisional identity would refuse the resume forever (WP11R5-03).
    if (!this.neverStartedVerdict(runId)) {
      const inspection = this.recovery.inspect(runId);
      if (inspection.ok && inspection.inspection.processAlive !== false) {
        return {
          ok: false,
          code: 'RECOVERY_REQUIRED',
          message: `Run ${runId} 的旧执行状态为 ${String(inspection.inspection.processAlive)}；确认终止后才能续跑`,
        };
      }
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

  /**
   * The environment one live Attempt reported in `attempt.ready`, when it is still live.
   *
   * `stage.submit` reads it to freeze the delivery's `VerificationManifest.environmentRef`
   * (`protocol.md:123`). An Attempt that is gone has no environment this process can name,
   * so the caller reports the absence instead of inventing one.
   */
  environmentRefOf(attemptId: string): string | undefined {
    return this.live.get(attemptId)?.environmentRef;
  }

  /**
   * Records that an Attempt delivered through the control channel.
   *
   * The control endpoint (`control-http.ts`) calls this after an accepted
   * `assessment.submit`/`agent.dispatch`/`stage.submit`, so the two-strike rule is decided
   * from a real accepted submission rather than from model text. An attempt the supervisor
   * does not know (a late call from a finished Attempt) is ignored.
   */
  noteSubmitted(runId: string, attemptId: string): void {
    const entry = this.live.get(attemptId);
    if (entry === undefined || entry.runId !== runId) return;
    entry.submitted = true;
  }

  /** Whether an Attempt has delivered through the control channel (`protocol.md` §6). */
  hasSubmitted(attemptId: string): boolean {
    return this.live.get(attemptId)?.submitted === true;
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

  /**
   * Parks a Chief Run whose Attempt ended while its `join=all` children are live.
   *
   * `workflow.md` §5.3 and `rules/agents.md` §3: a `join=all` dispatch suspends the Chief
   * Run until the child settles, and `JoinCoordinator.onChildSettled` moves it back to
   * `running` once the last one is terminal. Without this branch the Attempt's
   * `completed` result tried to settle the Run, `RunLifecycle.end` refused it (it
   * refuses a graceful completion with live join children), and the Run was left in
   * `running` with a live Attempt and no process — the state in which nothing could ever
   * continue the L2 route (WP-12 W4b). Parking it explicitly is what makes the Chief
   * available to trigger the next stage.
   *
   * @returns `true` when the Run was parked and must not be settled.
   */
  private waitForLiveChildren(run: Run): boolean {
    const live = this.store.runs
      .list({ where: 'parent_run_id = ?', params: [run.id] })
      .filter((child) => child.join === 'all' && !isTerminalRunStatus(child.status));
    if (live.length === 0) return false;
    if (run.status === 'running') {
      this.store.runs.update(run.id, { status: 'waiting_children' }, run.version);
      this.log(`supervisor: ${run.id} waits for ${String(live.length)} live join=all child(ren)`);
    }
    const attempt = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] }).at(-1);
    if (attempt !== undefined && (attempt.status === 'starting' || attempt.status === 'running')) {
      this.store.attempts.update(attempt.id, { status: 'completed' }, attempt.version);
    }
    return true;
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
    //
    // A third kind is the *resumed Chief*: `JoinCoordinator.onChildSettled` moves a
    // `waiting_children` Chief Run back to `running` when the last `join=all` child of its
    // route stage settled, and `protocol.md` §6 makes that Run the trigger for the next
    // professional Run. Its previous Attempt closed with a result (one turn), so it is
    // claimable exactly while it has no live Attempt and no live `join=all` child — never
    // for a Run whose process merely died (recovery owns that case).
    const runs = this.store.runs.list({ where: "status IN ('queued', 'running')" });
    const claimable = runs.filter((run) => {
      if ([...this.live.values()].some((entry) => entry.runId === run.id)) return false;
      if (run.status === 'queued') return true;
      const latest = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] }).at(-1);
      if (latest !== undefined && latest.status === 'starting' && latest.runnerId === undefined) {
        return true;
      }
      if (run.role !== 'chief') return false;
      // A Work that already reached a terminal status has no next stage: its Chief Run is
      // leftover bookkeeping (the delivery is complete, and `workflow.md` §5.1 continues it
      // with a new related Work), so it is never claimed for another turn.
      const work = this.store.works.find(run.workId);
      if (
        work !== undefined &&
        (work.status === 'completed' || work.status === 'cancelled' || work.status === 'failed')
      ) {
        return false;
      }
      if (latest === undefined || (latest.status !== 'completed' && latest.status !== 'failed')) {
        return false;
      }
      return this.store.runs
        .list({ where: 'parent_run_id = ?', params: [run.id] })
        .every((child) => child.join !== 'all' || isTerminalRunStatus(child.status));
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
        // behaviour). Anything else reaching here threw before a process existed
        // (`registerLiveAttempt` owns every post-spawn failure): its dangling Attempt is
        // marked failed and the Run is parked in the resumable `interrupted` state, so an
        // operator can retry instead of the engine destroying the work
        // (WP11R4-01/WP11R5-03).
        this.log(`supervisor: cannot start ${run.id}: ${messageOf(error)}`);
        const current = this.store.runs.find(run.id);
        if (current !== undefined && current.status !== 'queued') {
          this.abandonUnstarted(run.id, error);
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
   * dies in that window leaves `pid:pending`, which the probe cannot resolve — a recovery
   * park that withholds a new Attempt, never a confident "the old writer is gone". A
   * *synchronous* start failure is different: `abandonUnstarted` records that no process was
   * ever created.
   */
  private static runnerIdFor(pid: number | null): string {
    return pid === null ? 'pid:pending' : `pid:${String(pid)}`;
  }

  /**
   * Opens the Attempt for a Run about to be spawned and persists `queued → starting`.
   *
   * `reliability.md` §2 is explicit about the order: "持久Starting后启动Runner；ready确认
   * epoch/进程标识/环境后Running". `RunLifecycle.beginAttempt` writes `starting` and
   * `running` in the same transaction, so using it here published a Run as Running before
   * the Runner had confirmed anything (WP-12 T8a residual). The supervisor owns this
   * narrower transition and `attempt.ready` is what completes it; the resume paths still use
   * `beginAttempt`, because `RUN_TRANSITIONS` has no `paused → starting` edge.
   *
   * The admission gate and the transition legality are checked exactly like
   * `beginAttempt` does, so a Run that may not open an Attempt is refused before any row is
   * written.
   */
  private openAttemptForSpawn(run: Run, runnerId: string): Attempt {
    const admission = newAttemptAdmission(this.store, run.id);
    if (!admission.allowed) {
      throw new ProtocolError(
        admission.code ?? 'RECOVERY_REQUIRED',
        admission.message ?? `Run ${run.id} 不能开新 Attempt`,
        { details: { runId: run.id, verdictEventId: admission.verdictEventId } },
      );
    }
    // A Chief Run continued by its route is already `running` (its previous Attempt closed
    // with a result and `JoinCoordinator.onChildSettled` moved it back), and
    // `RUN_TRANSITIONS` has no `running → starting` edge: the Run is not resuming a parked
    // execution, it is taking its next turn. Only that documented case is admitted; every
    // other Run still has to satisfy the transition table.
    const continuedChief = run.role === 'chief' && run.status === 'running';
    if (!continuedChief && !canTransitionRun(run.status, 'starting')) {
      throw new ProtocolError('VALIDATION_ERROR', `Run ${run.id} cannot start from ${run.status}`, {
        details: { runId: run.id, status: run.status },
      });
    }
    return withTransaction(this.store.db, () => {
      const previous = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] });
      const attempt = this.store.attempts.insert({
        runId: run.id,
        number: previous.length + 1,
        status: 'starting',
        // The epoch is the Attempt's position in the Run's history, so it is strictly
        // increasing and a stale capability (`protocol.md` §6) still fails the epoch check.
        ownerEpoch: previous.length,
        runnerId,
      });
      if (!continuedChief) this.store.runs.update(run.id, { status: 'starting' }, run.version);
      return attempt;
    });
  }

  /**
   * Parks a Run whose Attempt never reached a process (`WP11R5-03`).
   *
   * A `prepare`/`spawn` failure has **no** unconfirmed side effect — nothing was ever
   * started — so `recovery_required` (which only a Run-scoped RecoveryDecision can lift) is
   * not the honest state. With the provisional `pid:pending` identity the real process probe
   * can never confirm a termination either, so the Run used to be unrecoverable. The
   * documented outcome is the resumable `interrupted` (`workflow.md` §5.3: "interrupted可
   * 检查后创建新Attempt；不确定副作用为recovery_required") plus a verdict recording that no
   * process was ever created, which `resumeParkedRun` reads instead of probing.
   */
  private abandonUnstarted(runId: string, error: unknown): void {
    const reason = messageOf(error);
    withTransaction(this.store.db, () => {
      const run = this.store.runs.find(runId);
      if (run === undefined || isTerminalRunStatus(run.status)) return;
      const latest = this.store.attempts.list({ where: 'run_id = ?', params: [runId] }).at(-1);
      if (latest !== undefined && (latest.status === 'starting' || latest.status === 'running')) {
        this.store.attempts.update(latest.id, { status: 'failed' }, latest.version);
      }
      if (!canTransitionRun(run.status, 'interrupted')) return;
      const parked = this.store.runs.update(run.id, { status: 'interrupted' }, run.version);
      this.store.events.append({
        name: RUN_RECOVERED_EVENT,
        entityId: parked.id,
        entityVersion: parked.version,
        data: {
          runId: parked.id,
          workId: parked.workId,
          from: run.status,
          to: parked.status,
          path: [run.status, parked.status],
          attemptId: latest?.id ?? null,
          epoch: latest?.ownerEpoch ?? null,
          processAlive: null,
          unknownToolOperations: [],
          requiresRecoveryDecision: false,
          // No process was ever created, so a new Attempt cannot race an old writer.
          newAttemptAllowed: true,
          neverStarted: true,
          releasedLeases: [],
          reason,
        },
      });
      this.log(`supervisor: ${runId} parked interrupted after a failed start: ${reason}`);
    });
  }

  /**
   * Whether the newest recovery verdict for a Run records that no process was ever started.
   *
   * `abandonUnstarted` writes it for a `prepare`/`spawn` failure, where the provisional
   * `pid:pending` identity can never be resolved by the real probe; it is the durable fact
   * that lets the operator resume the Run instead of hitting the WP11R5-03 dead end.
   */
  private neverStartedVerdict(runId: string): boolean {
    const verdicts = scanEvents(this.store, { names: [RUN_RECOVERED_EVENT] });
    let latest: (typeof verdicts)[number] | undefined;
    for (const event of verdicts) if (event.entityId === runId) latest = event;
    return latest?.data['neverStarted'] === true;
  }

  private spawnRun(run: Run): void {
    const runnerId = RunnerSupervisor.runnerIdFor(null);
    // 1. Adopt an Attempt that exists but has no process yet — `FindingsService.resumeWork`
    //    opens one for a resumed Run, and opening a second one would be refused
    //    (`cannot start from running`) and fail the Run (WP11R4-01). Otherwise open a new
    //    Attempt for a queued/parked Run, which persists the documented `starting` state.
    const latest = this.store.attempts.list({ where: 'run_id = ?', params: [run.id] }).at(-1);
    const adopt =
      latest !== undefined && latest.status === 'starting' && latest.runnerId === undefined;
    const attempt = adopt ? latest : this.openAttemptForSpawn(run, runnerId);
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
    // From here a process exists, so a bookkeeping failure is a *lost execution* rather than
    // the `neverStarted` case: the child is terminated and the Run goes through the ordinary
    // recovery park with the child's real identity.
    try {
      this.registerLiveAttempt(run, attempt, epoch, child, invocation);
    } catch (error) {
      this.log(
        `supervisor: ${run.id} attempt ${attempt.id} could not be registered after spawn: ${messageOf(error)}`,
      );
      this.live.delete(attempt.id);
      try {
        child.terminate('SIGTERM');
      } catch {
        // Already gone; `park` still records the recovery verdict.
      }
      this.markAttemptFailed(attempt.id);
      this.park(run.id);
    }
  }

  /** Registers a spawned Runner as live; `spawnRun` owns the failure handling. */
  private registerLiveAttempt(
    run: Run,
    attempt: Attempt,
    epoch: number,
    child: RunnerProcessPort,
    invocation: RunnerInvocation,
  ): void {
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
      environmentRef: undefined,
      lastSeenAt: this.now(),
      lastHeartbeatWritten: 0,
      killTimer: undefined,
      result: undefined,
      exited: false,
      text: '',
      corrections: 0,
      submitted: false,
      correctionPending: false,
    };
    this.live.set(attempt.id, entry);
    this.writeHeartbeat(attempt, entry);
    child.onMessage((message) => this.onMessage(entry, message));
    child.onExit((exit) => this.onExit(entry, exit));
    this.attemptStarted(entry);
    this.log(
      `supervisor: ${run.id} attempt ${attempt.id} started (pid ${String(child.pid)}, epoch ${String(epoch)})`,
    );
  }

  /** Marks a live Attempt failed without letting a terminal status be rewritten. */
  private markAttemptFailed(attemptId: string): void {
    const attempt = this.store.attempts.find(attemptId);
    if (attempt !== undefined && (attempt.status === 'starting' || attempt.status === 'running')) {
      this.store.attempts.update(attempt.id, { status: 'failed' }, attempt.version);
    }
  }

  /**
   * `workflow.md` §5.1 "Work.status：queued→running".
   *
   * A Work is *being executed* as soon as one of its Runs really runs, and the Chief Run is
   * a Run of the Work like any other (`workflow.md` §3: the Chief is one of the Work's
   * agents). Nothing else writes this edge: without it the Work stays `queued` for the whole
   * execution and only jumps to `completed` through the settlement path, so the board (and
   * the acceptance checks that read the row) would show finished work as still queued.
   *
   * Only `queued` is handled here: `blocked`/`paused → running` belong to the resume path
   * (`FindingsService.walkWorkTo`), which owns the blocker bookkeeping that must come with
   * them. The event mirrors that method's shape so the board consumes one message kind.
   */
  private markWorkRunning(run: Run): void {
    const work = this.store.works.find(run.workId);
    if (work === undefined || work.status !== 'queued') return;
    const running = this.store.works.update(work.id, { status: 'running' }, work.version);
    this.store.events.append({
      name: 'work.control_changed',
      entityId: running.id,
      entityVersion: running.version,
      data: {
        workId: running.id,
        control: 'start',
        previousStatus: work.status,
        status: running.status,
        reason: `Run ${run.id} is running`,
      },
    });
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
        entry.environmentRef = message.environmentRef;
        // `workflow.md` §5.1 "Work.status：queued→running", before the daemon's attempt hook
        // runs: that hook mints the run-scope Grants (`execution.ts` `ensureRunGrants`), and
        // a Grant can only be minted for a **running** Work
        // (`GrantStore.issueInTransaction`). Minting first left the first Run of every Work
        // with zero Grants (`Work … is queued; only a running Work may mint a Grant`) — the
        // state in which an L2 route's Planning Run could not store its Plan artifact
        // (WP-12 W4b).
        const readyRun = this.store.runs.find(entry.runId);
        if (readyRun !== undefined) {
          this.markWorkRunning(readyRun);
          this.attemptStarted(entry);
        }
        const attempt = this.store.attempts.find(entry.attemptId);
        if (attempt !== undefined && attempt.status === 'starting') {
          this.store.attempts.update(attempt.id, { status: 'running' }, attempt.version);
        }
        // Only now does the Run claim to be executing. A Run the resume path already put
        // into `running` (there is no `paused → starting` edge) keeps its `run.started`
        // event from that path; a freshly claimed Run publishes it here.
        const run = this.store.runs.find(entry.runId);
        if (run !== undefined && run.status === 'starting') {
          const running = this.store.runs.update(run.id, { status: 'running' }, run.version);
          this.store.events.append({
            name: 'run.started',
            entityId: running.id,
            entityVersion: running.version,
            data: {
              attemptId: entry.attemptId,
              number: attempt?.number ?? null,
              runnerId: entry.runnerId,
              resumed: false,
            },
          });
        }
        this.send(entry, { type: 'attempt.prompt', text: entry.prompt });
        return;
      }
      case 'attempt.event': {
        // Event forwarding is the daemon's job (EventHub/token.delta); the supervisor only
        // keeps liveness and the assistant text a contract check must see, so nothing the
        // model produced is dropped silently on the floor (`protocol.md` §6/§7).
        const event = message.event;
        if (event['type'] === 'text_delta' && typeof event['delta'] === 'string') {
          entry.text += event['delta'];
        }
        return;
      }
      case 'attempt.result': {
        if (!entry.ready && message.status === 'completed') {
          // `reliability.md` §2: the Runner confirms epoch/process/environment with
          // `attempt.ready` before it may deliver. A `completed` result before that can
          // never settle — the Run is still `starting` and `RUN_TRANSITIONS` has no
          // `starting → completed` edge — and the refusal used to be swallowed by `guarded`,
          // stranding the Run with no live Attempt and no action able to pick it up again
          // (T8b P2-1). Park it from the real process state instead. A `failed`/`cancelled`
          // result before ready is a legal transition (and graceful shutdown relies on it),
          // so those keep their documented handling.
          this.failAttempt(entry, 'the Runner reported a completed result before attempt.ready');
          return;
        }
        if (entry.correctionPending) {
          // The second answer of a corrective turn: re-arm the finish path for it.
          entry.correctionPending = false;
        } else if (entry.result !== undefined) {
          // A duplicate result for the same Attempt: the first one was already applied.
          return;
        }
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
    // Every result reaches the handler, compliant or not: the daemon uses a compliant
    // delivery to act on what the model produced (validate the DispatchSpec, file the stage
    // result) and a non-compliant one to answer with the documented corrective prompt
    // (`protocol.md` §6). A handler that returns no correction — or one that throws — lets
    // the result settle normally, so a handler bug never strands a Run.
    if (!entry.submitted && result.status === 'completed') {
      // The one case where "what did the model say instead of submitting" is the whole
      // question: the text is bounded and lives only in the daemon log (WP-12 R9).
      const said = entry.text.replace(/\s+/gu, ' ').trim().slice(0, 400);
      this.log(
        `supervisor: ${entry.runId} attempt ${entry.attemptId} ended without a structured result; model text: ${said === '' ? '(none)' : said}`,
      );
    }
    const corrective =
      !entry.submitted && result.status === 'completed' ? this.correctivePrompt(entry) : undefined;
    if (corrective !== undefined && entry.corrections < 1 && this.correct(entry, corrective)) {
      return;
    }
    if (this.onAttemptResult !== undefined && (entry.submitted || result.status !== 'completed')) {
      // A compliant or failed result still has to reach the daemon: a Chief Run's
      // assessment must be validated and dispatched *after* the model submitted it.
      this.correctivePrompt(entry);
    }
    this.live.delete(entry.attemptId);
    this.ended(entry, 'result');
    if (this.isTerminal(entry.runId)) {
      // A late result never rewrites the Attempt either: `ATTEMPT_TRANSITIONS` makes
      // `stopped`/`lost`/`completed`/`failed` absorbing (`WP11R2-03`).
      const late = this.store.attempts.find(entry.attemptId);
      if (late !== undefined && (late.status === 'starting' || late.status === 'running')) {
        // `lost` here is closing bookkeeping, not a liveness verdict: the Run ended (by the
        // daemon's own handler or a cancel) before this Attempt's result was applied, so the
        // Attempt has no outcome to record. The lease sweep logs its own, different reason
        // (`silent for over …ms`), which is what a reader must look for (WP-12 R9).
        this.store.attempts.update(late.id, { status: 'lost' }, late.version);
        this.log(
          `supervisor: ${entry.runId} attempt ${entry.attemptId} marked lost as closing bookkeeping (Run already ended)`,
        );
      }
      // The user (or a cancel) already ended this Run: the result is late evidence, not a
      // new outcome (`reliability.md` §2), and settling it again would throw (WP11R1-01).
      this.log(`supervisor: ignoring the late result of ${entry.runId} (Run already ended)`);
      this.clearKillTimer(entry);
      // A Run the daemon's own handler ended (a `contract_violation`) still has to be
      // reported: the message behind it must not stay `processing` forever.
      this.reportSettled(entry.runId);
      this.endSettledChild(entry);
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
    // A Chief Run that still has `join=all` children outstanding is not finished: no
    // other stage exists, so it waits instead of ending (`run-lifecycle.ts` `end`
    // already refuses the graceful completion). `protocol.md` §6 makes the Chief the
    // trigger for the next professional Run, which means it must stay alive until every
    // stage of the route has settled (WP-12 W4b).
    let waitingForChildren = false;
    this.guarded('settlement', entry.runId, () => {
      if (result.status === 'cancelled') {
        this.lifecycle.settle(entry.runId, 'cancelled', usage);
      } else if (result.status === 'completed') {
        const run = this.store.runs.find(entry.runId);
        if (run !== undefined && run.role === 'chief' && this.waitForLiveChildren(run)) {
          waitingForChildren = true;
          return;
        }
        this.lifecycle.settle(entry.runId, 'completed', usage);
      } else {
        this.lifecycle.settle(entry.runId, 'failed', usage);
      }
    });
    if (waitingForChildren) return;
    this.clearKillTimer(entry);
    this.reportSettled(entry.runId);
    this.endSettledChild(entry);
  }

  /**
   * Ends the Runner of a Run that is already settled.
   *
   * `protocol.md` §6 keeps a Runner alive after a turn that delivered nothing so the one
   * corrective prompt can be answered, which means Core — not the child — decides when a
   * settled Attempt's process goes away. `attempt.shutdown` is the documented first step, and
   * a child that ignores it is signalled on the same escalation the stop path uses. A child
   * that already exited is unaffected (`send` drops a closed pipe, `terminate` tolerates a
   * gone process).
   */
  private endSettledChild(entry: LiveAttempt): void {
    this.send(entry, { type: 'attempt.shutdown' });
    this.terminate(entry, 'SIGTERM');
  }

  /** Reports an Attempt opening, never letting a callback throw into the spawn path. */
  private attemptStarted(entry: LiveAttempt): void {
    if (this.onAttemptStarted === undefined) return;
    try {
      this.onAttemptStarted({ runId: entry.runId, attemptId: entry.attemptId });
    } catch (error) {
      this.log(`supervisor: onAttemptStarted failed for ${entry.attemptId}: ${messageOf(error)}`);
    }
  }

  /**
   * Reports a terminal Run once, from its persisted status.
   *
   * A Run the daemon's own result handler already ended (a `contract_violation`) is
   * reported here too, so the message state never depends on which layer ended it.
   */
  private reportSettled(runId: string): void {
    if (this.onRunSettled === undefined) return;
    const run = this.store.runs.find(runId);
    if (run === undefined || !isTerminalRunStatus(run.status)) return;
    try {
      this.onRunSettled({ runId, status: run.status });
    } catch (error) {
      this.log(`supervisor: onRunSettled failed for ${runId}: ${messageOf(error)}`);
    }
  }

  /**
   * Asks the Attempt to deliver again instead of settling the Run.
   *
   * `protocol.md` §6: a Run that ends with plain text and no submitted result gets one
   * corrective prompt, and a second non-compliant end is a `contract_violation`. The
   * supervisor implements the mechanical half — keep the Attempt alive, steer it, wait for
   * another result — while the daemon's `onAttemptResult` handler decides what counts as
   * compliant for the Run's role and records the violation through `RunLifecycle`.
   *
   * @returns `true` when the correction was sent and the Run must not be settled.
   */
  private correct(entry: LiveAttempt, corrective: string): boolean {
    entry.corrections += 1;
    entry.correctionPending = true;
    entry.result = undefined;
    // The text buffer restarts: the second answer is what the two-strike verdict and the
    // Core-side parse must read, and keeping the first answer's JSON would make the
    // retry look compliant by accident.
    entry.text = '';
    this.send(entry, {
      type: 'attempt.steer',
      // The daemon's correction names the rule; the contract line names the exact tool and
      // fields, because a model that answered with prose has already shown it did not read
      // the first prompt's contract (WP-12 R7).
      text: `${corrective}\n${contractReminder(entry.role)}`,
    });
    this.log(
      `supervisor: ${entry.runId} attempt ${entry.attemptId} delivered no structured result; corrective prompt sent`,
    );
    return true;
  }

  /** Calls the result handler with the Attempt's own facts, never letting it throw. */
  private correctivePrompt(entry: LiveAttempt): string | undefined {
    if (this.onAttemptResult === undefined) return undefined;
    const run = this.store.runs.find(entry.runId);
    const input: AttemptResultInput = {
      runId: entry.runId,
      attemptId: entry.attemptId,
      epoch: entry.epoch,
      role: entry.role,
      purpose: run?.purpose ?? 'implementation',
      stage: run?.stage ?? '',
      reason: 'result',
      status: entry.result?.status ?? 'completed',
      message: entry.result?.message ?? '',
      text: entry.text,
      submitted: entry.submitted,
      corrections: entry.corrections,
    };
    try {
      return this.onAttemptResult(input);
    } catch (error) {
      this.log(`supervisor: onAttemptResult failed for ${input.attemptId}: ${messageOf(error)}`);
      return undefined;
    }
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
    // A Runner that exits **cleanly** after the one corrective prompt was sent ended the
    // conversation without delivering: the model was asked to submit and the process left
    // instead. `protocol.md` §6 makes two consecutive non-compliant ends a
    // `contract_violation`, and there is no interrupted work to recover, so parking the Run
    // as `interrupted` hid the real verdict behind a state no drill or board can act on
    // (WP-12 R6). A non-zero code or a signal is a real loss — the correction never got its
    // answer for reasons that are not the model's — so that keeps the recovery park below.
    if (entry.correctionPending && exit.code === 0 && this.reportContractViolation(entry)) {
      this.live.delete(entry.attemptId);
      const nonCompliant = this.store.attempts.find(entry.attemptId);
      if (
        nonCompliant !== undefined &&
        nonCompliant.status !== 'completed' &&
        nonCompliant.status !== 'failed'
      ) {
        this.store.attempts.update(nonCompliant.id, { status: 'lost' }, nonCompliant.version);
      }
      this.ended(entry, 'exit');
      this.clearKillTimer(entry);
      this.reportSettled(entry.runId);
      this.log(
        `supervisor: ${entry.runId} runner exited (code 0) after the corrective prompt without a structured result: contract violation`,
      );
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

  /**
   * Records the second non-compliance through the daemon's result handler.
   *
   * The handler is the layer that owns the verdict (`control-handler.ts` calls
   * `lifecycle.contractViolation` for `corrections >= 1`), so this only reports the facts and
   * asks. `true` means the Run really reached a terminal state; anything else — no handler, a
   * handler that declined, a rejected write — leaves the caller on the recovery park, because
   * a verdict nobody recorded must not look settled.
   */
  private reportContractViolation(entry: LiveAttempt): boolean {
    if (this.onAttemptResult === undefined) return false;
    this.correctivePrompt(entry);
    return this.isTerminal(entry.runId);
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
