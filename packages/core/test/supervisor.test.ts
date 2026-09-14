/**
 * RunnerSupervisor tests (WP-11 A2-T4/T5).
 *
 * The supervisor is driven against a real `ProjectStore` and the real
 * `RunLifecycle`/`RunRecoveryService`, with a scripted `RunnerSpawnPort` standing in for
 * the child process. That is the honest seam: everything the supervisor *decides* is
 * real product state, and only the operating-system process is simulated.
 *
 * Contracts under test (`reliability.md` §1/§2/§3): claim then start, epoch fencing for
 * late messages, heartbeat timeout → Attempt `lost` + Run parked, capacity ceilings with
 * the Chief reserve, result settlement and graceful shutdown.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LIMITS,
  type DistributiveOmit,
  type RunnerCommand,
  type RunnerMessage,
} from '@agentdev/contracts';
import { ProjectStore, projectIdFromRoot } from '@agentdev/storage';
import { scanEvents } from '../src/events.js';
import {
  RunnerSupervisor,
  RunLifecycle,
  RunRecoveryService,
  createMemoryProcessProbe,
  newAttemptAdmission,
  type AttemptResultInput,
  type PrepareRunInput,
  type RunnerProcessPort,
  type RunnerSpawnInput,
} from '../src/index.js';

let store: ProjectStore;
let dataDir: string;
/** The store stamps rows with the id derived from its canonical root. */
const canonicalRoot = '/repo';
const projectId = projectIdFromRoot(canonicalRoot);

/** A scripted Runner process: records commands, replays messages, exits on demand. */
class FakeRunner implements RunnerProcessPort {
  static spawned: FakeRunner[] = [];
  readonly pid: number;
  readonly input: RunnerSpawnInput;
  readonly commands: RunnerCommand[] = [];
  private messageListener: ((message: RunnerMessage) => void) | undefined;
  private exitListener:
    ((exit: { readonly code: number | null; readonly signal: string | null }) => void) | undefined;
  readonly signals: string[] = [];

  constructor(input: RunnerSpawnInput, pid: number) {
    this.input = input;
    this.pid = pid;
  }

  send(command: RunnerCommand): void {
    this.commands.push(command);
    if (command.type === 'attempt.shutdown') {
      // A real Runner answers shutdown with a cancelled result and exits; the fake does
      // the same so the graceful path is exercised instead of the escalation.
      this.emit({ type: 'attempt.result', status: 'cancelled', message: 'shutdown requested' });
      setTimeout(() => this.exit(0, null), 0);
    }
  }

  onMessage(listener: (message: RunnerMessage) => void): void {
    this.messageListener = listener;
  }

  onExit(
    listener: (exit: { readonly code: number | null; readonly signal: string | null }) => void,
  ): void {
    this.exitListener = listener;
  }

  terminate(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.signals.push(signal);
  }

  /** Sends a message as the Runner would, framed with this Attempt's identity. */
  emit(message: DistributiveOmit<RunnerMessage, 'v' | 'attemptId' | 'epoch'>): void {
    this.messageListener?.({
      v: 1,
      attemptId: this.input.attempt.id,
      epoch: this.input.epoch,
      ...message,
    });
  }

  /** Sends a message with a forged (old or future) epoch, to test fencing. */
  emitWithEpoch(
    epoch: number,
    message: DistributiveOmit<RunnerMessage, 'v' | 'attemptId' | 'epoch'>,
  ): void {
    this.messageListener?.({
      v: 1,
      attemptId: this.input.attempt.id,
      epoch,
      ...message,
    });
  }

  exit(code: number | null, signal: string | null = null): void {
    this.exitListener?.({ code, signal });
  }

  get lastCommand(): RunnerCommand | undefined {
    return this.commands.at(-1);
  }
}

let clock = 1_000_000;
const now = (): number => clock;
let probe: ReturnType<typeof createMemoryProcessProbe>;
let supervisor: RunnerSupervisor;

function spawnPort(): { spawn(input: RunnerSpawnInput): RunnerProcessPort } {
  return {
    spawn: (input) => {
      const runner = new FakeRunner(input, 10_000 + FakeRunner.spawned.length);
      FakeRunner.spawned.push(runner);
      return runner;
    },
  };
}

/** Seeds a queued Run directly, as the dispatcher would have. */
function queueRun(
  options: { role?: 'chief' | 'backend'; workId?: string; workStatus?: 'queued' | 'running' } = {},
): string {
  const workId = options.workId ?? store.newId();
  const budget = store.budgets.insert({
    projectId,
    workId,
    tokenLimit: 500_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 7_200,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  store.works.insert({
    id: workId,
    projectId,
    intent: 'delivery',
    purpose: 'implementation',
    level: 'L2',
    goal: 'seed',
    scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
    sourceRef: { kind: 'action', id: store.newId(), version: '1' },
    status: options.workStatus ?? 'running',
    blockerIds: [],
    baseRevision: 'a'.repeat(40),
    budgetId: budget.id,
    policyRevision: 1,
  });
  const run = store.runs.insert({
    projectId,
    workId,
    role: options.role ?? 'backend',
    purpose: 'implementation',
    stage: 'Develop',
    status: 'queued',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: 'c'.repeat(64),
    contextSnapshotId: 'd'.repeat(64),
    dispatchSnapshotId: 'e'.repeat(64),
    budgetAllocation: 1_000,
  });
  return run.id;
}

const invocation = (input: PrepareRunInput) => ({
  cwd: '/tmp/worktree',
  agentDir: '/tmp/agent',
  provider: 'stub',
  modelId: 'stub-model',
  tools: ['read', 'edit'],
  prompt: `goal for ${input.run.id}`,
  capability: `cap-${input.attempt.id}`,
});

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-supervisor-'));
  store = ProjectStore.open({
    dataDir,
    canonicalRoot,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => new Date(clock).toISOString() },
  });
  clock = 1_000_000;
  // The Project row the Work/Budget/Run foreign keys point at (`data.md` §2).
  store.projects.insert({
    id: projectId,
    root: canonicalRoot,
    gitRoot: canonicalRoot,
    codeRoot: 'src',
    documentRoot: 'docs/agentdev',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: 'a'.repeat(40),
  });
  FakeRunner.spawned = [];
  probe = createMemoryProcessProbe();
  const recovery = new RunRecoveryService({
    store,
    probe,
    now: () => new Date(clock).toISOString(),
  });
  supervisor = new RunnerSupervisor({
    store,
    spawn: spawnPort(),
    prepare: invocation,
    recovery,
    lifecycle: new RunLifecycle({ store }),
    now,
    tickMs: 60_000,
    log: () => undefined,
  });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('RunnerSupervisor claiming', () => {
  it('claims a queued Run, starts one Attempt and prompts it after ready', () => {
    const runId = queueRun();
    const tick = supervisor.tick();
    expect(tick.claimed).toEqual([runId]);
    expect(FakeRunner.spawned).toHaveLength(1);
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    expect(runner.input.epoch).toBe(1);
    expect(runner.input.invocation.capability).toBe(`cap-${runner.input.attempt.id}`);

    const run = store.runs.find(runId);
    // The Run is persisted as `starting`; `ready` is what confirms it is Running
    // (`reliability.md` §2, WP-12 T8a).
    expect(run?.status).toBe('starting');
    const attempt = store.attempts.find(runner.input.attempt.id);
    expect(attempt?.status).toBe('starting');
    // The identity is rewritten with the *child* pid after the spawn, in the `pid:<n>`
    // form the recovery probe parses (`WP11R1-02`).
    expect(attempt?.runnerId).toBe(`pid:${String(runner.pid)}`);
    expect(attempt?.heartbeatAt).toBeDefined();
    // The prompt waits for `ready`: the epoch/process/environment is confirmed first.
    expect(runner.commands).toHaveLength(0);

    probe.setAlive(`pid:${String(runner.pid)}`, true);
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: ['read', 'edit'],
      droppedTools: [],
    });
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('running');
    expect(runner.lastCommand).toMatchObject({ type: 'attempt.prompt', text: `goal for ${runId}` });
  });

  it('reports the Run as starting until the Runner confirms ready (reliability.md §2)', () => {
    const runId = queueRun();
    expect(supervisor.tick().claimed).toEqual([runId]);
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');

    // The state is persisted before the process starts, but the Run is not Running yet:
    // `ready` confirms epoch/process/environment first, and until then the Run must not
    // claim more than what happened (WP-12 T8a; `reliability.md` §2).
    expect(store.runs.find(runId)?.status).toBe('starting');
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('starting');
    expect(scanEvents(store, { names: ['run.started'] })).toHaveLength(0);

    probe.setAlive(`pid:${String(runner.pid)}`, true);
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: ['read', 'edit'],
      droppedTools: [],
    });
    expect(store.runs.find(runId)?.status).toBe('running');
    expect(scanEvents(store, { names: ['run.started'] })).toHaveLength(1);
  });

  it('moves its Work queued → running when the first Run really runs (workflow.md §5.1)', () => {
    const runId = queueRun({ workStatus: 'queued' });
    const run = store.runs.find(runId);
    if (run === undefined) throw new Error('unreachable');
    expect(supervisor.tick().claimed).toEqual([runId]);
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');

    // A process exists but has confirmed nothing, so the Work is not being executed yet.
    expect(store.works.find(run.workId)?.status).toBe('queued');

    probe.setAlive(`pid:${String(runner.pid)}`, true);
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: ['read', 'edit'],
      droppedTools: [],
    });
    // Without this edge the Work would stay `queued` for the whole execution — the board
    // would show finished work as still waiting — and jump straight to `completed` at
    // settlement.
    expect(store.works.find(run.workId)?.status).toBe('running');
    const published = scanEvents(store, { names: ['work.control_changed'] });
    expect(published).toHaveLength(1);
    expect(published[0]?.data).toMatchObject({
      workId: run.workId,
      control: 'start',
      previousStatus: 'queued',
      status: 'running',
    });
  });

  it('publishes no work.control_changed for a Work that is already running', () => {
    const runId = queueRun();
    const run = store.runs.find(runId);
    if (run === undefined) throw new Error('unreachable');
    expect(store.works.find(run.workId)?.status).toBe('running');
    expect(supervisor.tick().claimed).toEqual([runId]);
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');

    probe.setAlive(`pid:${String(runner.pid)}`, true);
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: ['read', 'edit'],
      droppedTools: [],
    });
    expect(store.works.find(run.workId)?.status).toBe('running');
    expect(scanEvents(store, { names: ['work.control_changed'] })).toHaveLength(0);
  });

  it('parks a spawn failure as a resumable Run instead of a dead end (WP11R5-03)', () => {
    let failing = true;
    const flaky = new RunnerSupervisor({
      store,
      spawn: {
        spawn: (input) => {
          // The real failure modes: `spawn` ENOENT/EAGAIN, or a prepare that throws before
          // any process exists (the Runner binary is missing, the attempt directory cannot
          // be written).
          if (failing) throw new Error('spawn ENOENT');
          return spawnPort().spawn(input);
        },
      },
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      log: () => undefined,
    });
    const runId = queueRun();
    expect(flaky.tick().claimed).toEqual([]);
    // No Runner ever existed, so there is no unconfirmed side effect: the honest park is
    // the documented resumable `interrupted`, never a `recovery_required` that no operator
    // action can lift (the failed Attempt is the preserved evidence).
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    const attempts = store.attempts.list({ where: 'run_id = ?', params: [runId] });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe('failed');
    expect(newAttemptAdmission(store, runId)).toMatchObject({ allowed: true });

    // The operator's resume opens the next Attempt and the real spawn adopts it.
    failing = false;
    const resumed = flaky.resumeParkedRun(runId);
    expect(resumed.ok).toBe(true);
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(2);
    // The reopened Run is `starting` until its Runner reports ready (`reliability.md` §2).
    expect(store.runs.find(runId)?.status).toBe('starting');
  });

  it('parks a prepare failure as a resumable Run', () => {
    let failing = true;
    const flaky = new RunnerSupervisor({
      store,
      spawn: spawnPort(),
      prepare: (input) => {
        if (failing) throw new Error('attempt directory is not writable');
        return invocation(input);
      },
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      log: () => undefined,
    });
    const runId = queueRun();
    expect(flaky.tick().claimed).toEqual([]);
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })[0]?.status).toBe('failed');

    failing = false;
    expect(flaky.resumeParkedRun(runId).ok).toBe(true);
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(2);
  });

  it('never claims "no process" when the failure happens after the spawn', () => {
    const runId = queueRun();
    const broken = new RunnerSupervisor({
      store,
      spawn: {
        spawn: (input) => {
          const runner = new FakeRunner(input, 40_000);
          // The process exists but its message channel cannot be registered.
          runner.onMessage = () => {
            throw new Error('broken pipe');
          };
          FakeRunner.spawned.push(runner);
          return runner;
        },
      },
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      log: () => undefined,
    });
    broken.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    // A real child was created, so the park must be the ordinary recovery one: the probe
    // reports it unknown, the verdict withholds a new Attempt, and no `neverStarted` fact
    // is recorded (`WP-12 T8a`).
    expect(runner.signals).toContain('SIGTERM');
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    const verdicts = scanEvents(store, { names: ['run.recovered'] });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.data['neverStarted']).toBeUndefined();
    expect(newAttemptAdmission(store, runId).allowed).toBe(false);
  });

  it('parks a Run whose Runner reports a completed result before `ready` (T8b P2-1)', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    // A non-compliant Runner — or the `attempt.ready` line being dropped by the IPC framing
    // layer — delivers `completed` while the Run is still `starting`. Settling that is
    // refused by `RUN_TRANSITIONS` (`starting` has no `completed` edge) and the refusal used
    // to be swallowed by `guarded`, leaving the Run stranded in `starting` with no live
    // Attempt and no action that could pick it up again (T8b P2-1).
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done too early' });

    expect(store.runs.find(runId)?.status).toBe('interrupted');
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('failed');
    expect(supervisor.liveAttempts()).toHaveLength(0);
    // Not stranded: once the old process is confirmed gone, the operator's decision lets the
    // Run open the next Attempt (`newAttemptAdmission` requires the decision to post-date the
    // park verdict, so the injected clock moves one tick).
    probe.setAlive(`pid:${String(runner.pid)}`, false);
    clock += 1_000;
    expect(supervisor.recordResumeDecision(runId).ok).toBe(true);
    expect(supervisor.resumeParkedRun(runId).ok).toBe(true);
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(2);
  });

  it('parks the Run when the Attempt cannot start (dropped tools)', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: ['read'],
      droppedTools: ['edit'],
    });
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('failed');
    // The Attempt never reported a result, so the Run is parked from its real state
    // (`WP11R1-04`); a fake pid cannot be confirmed dead, so a decision is required. The
    // Run never left `starting`, and `RUN_TRANSITIONS` has no `starting → recovery_required`
    // edge, so the park is `interrupted` with the withheld verdict (`recovery.ts`).
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    expect(newAttemptAdmission(store, runId)).toMatchObject({
      allowed: false,
      requiresRecoveryDecision: true,
    });
    expect(supervisor.liveAttempts()).toHaveLength(0);
  });

  it('settles the Run from the Attempt result and frees the slot', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done' });
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('completed');
    expect(store.runs.find(runId)?.status).toBe('completed');
    expect(supervisor.liveAttempts()).toHaveLength(0);
  });

  it('accumulates the assistant text and hands it to the result handler', () => {
    const seen: AttemptResultInput[] = [];
    const withHandler = new RunnerSupervisor({
      store,
      spawn: spawnPort(),
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      onAttemptResult: (input) => {
        seen.push(input);
        return undefined;
      },
      log: () => undefined,
    });
    const runId = queueRun({ role: 'chief' });
    withHandler.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    runner.emit({
      type: 'attempt.event',
      seq: 0,
      event: { type: 'text_delta', delta: '{"intent":' },
    });
    runner.emit({
      type: 'attempt.event',
      seq: 1,
      event: { type: 'text_delta', delta: '"delivery"}' },
    });
    runner.emit({ type: 'attempt.event', seq: 2, event: { type: 'tool_start', toolName: 'read' } });
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      runId,
      role: 'chief',
      status: 'completed',
      text: '{"intent":"delivery"}',
      submitted: false,
      corrections: 0,
    });
    expect(store.runs.find(runId)?.status).toBe('completed');
  });

  it('asks for one corrective prompt, then settles the second result', () => {
    const seen: AttemptResultInput[] = [];
    const withHandler = new RunnerSupervisor({
      store,
      spawn: spawnPort(),
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      onAttemptResult: (input) => {
        seen.push(input);
        return 'Submit through stage_yield; plain text does not deliver.';
      },
      log: () => undefined,
    });
    const runId = queueRun({ role: 'backend' });
    withHandler.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    runner.emit({
      type: 'attempt.event',
      seq: 0,
      event: { type: 'text_delta', delta: 'first answer' },
    });
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done' });
    // The Attempt stays live and is steered instead of settling the Run.
    expect(store.runs.find(runId)?.status).toBe('running');
    expect(withHandler.liveAttempts()).toHaveLength(1);
    expect(runner.lastCommand).toMatchObject({
      type: 'attempt.steer',
      text: 'Submit through stage_yield; plain text does not deliver.',
    });
    // The second answer is what the verdict reads: the first text must not leak into it.
    runner.emit({
      type: 'attempt.event',
      seq: 1,
      event: { type: 'text_delta', delta: 'second answer' },
    });
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done again' });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ text: 'second answer', submitted: false, corrections: 1 });
    expect(store.runs.find(runId)?.status).toBe('completed');
  });

  it('treats an accepted control submission as compliant and never corrects it', () => {
    const seen: AttemptResultInput[] = [];
    const withHandler = new RunnerSupervisor({
      store,
      spawn: spawnPort(),
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      onAttemptResult: (input) => {
        seen.push(input);
        return 'should never be needed';
      },
      log: () => undefined,
    });
    const runId = queueRun({ role: 'backend' });
    withHandler.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    // The control endpoint records the accepted `stage.submit` on the live Attempt.
    withHandler.noteSubmitted(runId, runner.input.attempt.id);
    expect(withHandler.hasSubmitted(runner.input.attempt.id)).toBe(true);
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.submitted).toBe(true);
    expect(runner.commands.some((command) => command.type === 'attempt.steer')).toBe(false);
    expect(store.runs.find(runId)?.status).toBe('completed');
  });

  it('settles normally when the result handler throws', () => {
    const withHandler = new RunnerSupervisor({
      store,
      spawn: spawnPort(),
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      onAttemptResult: () => {
        throw new Error('handler bug');
      },
      log: () => undefined,
    });
    const runId = queueRun({ role: 'backend' });
    withHandler.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done' });
    expect(store.runs.find(runId)?.status).toBe('completed');
    expect(withHandler.liveAttempts()).toHaveLength(0);
  });

  it('ignores a late result carrying another epoch', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    runner.emitWithEpoch(99, { type: 'attempt.result', status: 'failed', message: 'stale' });
    expect(store.runs.find(runId)?.status).toBe('running');
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('running');
  });

  it('holds the project ceiling and keeps a Chief slot for queued Chief work', () => {
    for (let index = 0; index < 3; index += 1) queueRun();
    const chiefRun = queueRun({ role: 'chief' });
    const convex = new RunnerSupervisor({
      store,
      spawn: spawnPort(),
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      log: () => undefined,
      concurrency: { project: 2, role: 2, chiefReserve: 1 },
    });
    const first = convex.tick();
    // Chief work is served first, and one professional fits beside it.
    expect(first.claimed).toHaveLength(2);
    expect(first.claimed[0]).toBe(chiefRun);
    expect(FakeRunner.spawned.map((runner) => runner.input.run.role)).toEqual(['chief', 'backend']);
    // No capacity left, so another tick claims nothing.
    expect(convex.tick().claimed).toEqual([]);
  });
});

/** A Runner that ignores both the shutdown command and SIGTERM. */
class StubbornRunner extends FakeRunner {
  override send(command: RunnerCommand): void {
    this.commands.push(command);
  }
}

describe('RunnerSupervisor heartbeat and recovery', () => {
  it('parks a silent Attempt as lost; a dead process still allows a new Attempt', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    // The process is confirmed gone, so the Run is parked `interrupted` and may be
    // retried (`reliability.md` §6).
    probe.setAlive(`pid:${String(runner.pid)}`, false);
    clock += LIMITS.leaseSec.default * 1000 + 1;
    const tick = supervisor.tick();
    expect(tick.parked).toEqual([runId]);
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('lost');
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    expect(runner.signals).toContain('SIGTERM');
    const admission = newAttemptAdmission(store, runId);
    expect(admission.allowed).toBe(true);
    expect(admission.requiresRecoveryDecision).toBe(false);
  });

  it('requires a recovery decision when the old process cannot be confirmed dead', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    // `null` means "cannot tell": the workspace must not be handed to a new writer
    // (`reliability.md` §2), so the Run needs an explicit recovery decision.
    probe.setAlive(`pid:${String(runner.pid)}`, null);
    clock += LIMITS.leaseSec.default * 1000 + 1;
    const tick = supervisor.tick();
    expect(tick.parked).toEqual([runId]);
    // The Run was still `starting` (the Runner never confirmed ready), so the documented
    // park is `interrupted` with a withheld verdict — the decision requirement below is
    // what keeps the workspace from a second writer.
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    const admission = newAttemptAdmission(store, runId);
    expect(admission.allowed).toBe(false);
    expect(admission.requiresRecoveryDecision).toBe(true);
  });

  it('parks a Run whose Runner exited without a result', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    probe.setAlive(`pid:${String(runner.pid)}`, false);
    runner.exit(1);
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('lost');
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    expect(supervisor.liveAttempts()).toHaveLength(0);
  });

  it('takes a heartbeat as liveness and does not park a quiet-but-beating Attempt', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    // Two lease windows pass, but the Runner keeps beating.
    for (let index = 0; index < 3; index += 1) {
      clock += LIMITS.leaseSec.default * 1000;
      runner.emit({ type: 'attempt.heartbeat', uptimeMs: 1 });
      expect(supervisor.tick().parked).toEqual([]);
    }
    expect(store.runs.find(runId)?.status).toBe('running');
    expect(store.attempts.find(runner.input.attempt.id)?.heartbeatAt).toBeDefined();
  });

  it('stops gracefully: shutdown first, then SIGTERM, and parks the Run', async () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    await supervisor.stop({ graceMs: 500 });
    // A cooperative Runner ends its Attempt on the shutdown command, so no signal is sent
    // (`reliability.md` §7 "请求 Runner 安全停").
    expect(runner.commands.some((command) => command.type === 'attempt.shutdown')).toBe(true);
    expect(runner.signals).toEqual([]);
    // Graceful shutdown is not a cancellation (`reliability.md` §7): the Run is parked for
    // a later Attempt and the Attempt is `stopped`, never settled as cancelled.
    expect(store.attempts.find(runner.input.attempt.id)?.status).toBe('stopped');
    const parked = store.runs.find(runId)?.status;
    expect(['interrupted', 'recovery_required']).toContain(parked);
    // A stopped supervisor claims nothing further.
    expect(supervisor.tick().claimed).toEqual([]);
  });

  it('escalates to SIGKILL when a Runner ignores SIGTERM', async () => {
    const stubborn = new RunnerSupervisor({
      store,
      spawn: {
        spawn: (input) => {
          const runner = new StubbornRunner(input, 20_000);
          FakeRunner.spawned.push(runner);
          return runner;
        },
      },
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      log: () => undefined,
    });
    queueRun();
    stubborn.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    // The stubborn fake never reports exit, so only the escalation can end it.
    await stubborn.stop({ graceMs: 10, killAfterMs: 20 });
    expect(runner.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('retries a parked Run once a resume decision exists', () => {
    const runId = queueRun();
    supervisor.tick();
    const first = FakeRunner.spawned[0];
    if (first === undefined) throw new Error('unreachable');
    // The Runner dies and its pid is confirmed gone: the Run parks as interrupted.
    probe.setAlive(`pid:${String(first.pid)}`, false);
    clock += LIMITS.leaseSec.default * 1000 + 1;
    expect(supervisor.tick().parked).toEqual([runId]);
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    // A crash alone never silently retries (`reliability.md` §6 resumes at a human act):
    // ticks keep finding nothing until the operator resumes.
    supervisor.tick();
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(1);
    // A confirmed-dead interruption is safe to continue, so the explicit resume opens the
    // second Attempt.
    const resumed = supervisor.resumeParkedRun(runId);
    expect(resumed.ok).toBe(true);
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(2);
    // The Run only reaches `running` once the new Runner reports ready (`reliability.md` §2).
    expect(store.runs.find(runId)?.status).toBe('starting');
  });

  it('adopts an Attempt that resumeWork opened instead of failing the Run', () => {
    // `FindingsService.resumeWork` moves the Run to `running` and appends an Attempt with
    // no process; the executor must adopt it (WP11R4-01).
    const runId = queueRun();
    const run = store.runs.find(runId);
    if (run === undefined) throw new Error('unreachable');
    const running = store.runs.update(runId, { status: 'running' }, run.version);
    const opened = store.attempts.insert({
      runId,
      projectId,
      number: 1,
      status: 'starting',
      ownerEpoch: 0,
    });
    const tick = supervisor.tick();
    expect(tick.claimed).toEqual([runId]);
    expect(FakeRunner.spawned).toHaveLength(1);
    const adopted = store.attempts.find(opened.id);
    expect(adopted?.id).toBe(opened.id);
    expect(adopted?.runnerId).toMatch(/^pid:[0-9]+$/u);
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(1);
    expect(store.runs.find(runId)?.status).toBe('running');
    void running;
  });

  it('refuses to resume a Run whose park withheld a new Attempt until the decision covers it', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    // An unconfirmable process parks the Run behind a recovery decision. The Run was still
    // `starting`, so the park is `interrupted` with the verdict withholding a new Attempt.
    probe.setAlive(`pid:${String(runner.pid)}`, null);
    clock += LIMITS.leaseSec.default * 1000 + 1;
    expect(supervisor.tick().parked).toEqual([runId]);
    expect(store.runs.find(runId)?.status).toBe('interrupted');
    expect(newAttemptAdmission(store, runId)).toMatchObject({
      allowed: false,
      requiresRecoveryDecision: true,
    });
    const refused = supervisor.resumeParkedRun(runId);
    expect(refused).toMatchObject({ ok: false, code: 'RECOVERY_REQUIRED' });
    // Recording the decision re-checks the process state: still unconfirmable → refused.
    expect(supervisor.recordResumeDecision(runId)).toMatchObject({
      ok: false,
      code: 'RECOVERY_REQUIRED',
    });
    // Once the process is confirmed gone, the decision is recorded and the resume works.
    probe.setAlive(`pid:${String(runner.pid)}`, false);
    clock += 1_000;
    expect(supervisor.recordResumeDecision(runId).ok).toBe(true);
    expect(supervisor.resumeParkedRun(runId).ok).toBe(true);
    expect(store.attempts.list({ where: 'run_id = ?', params: [runId] })).toHaveLength(2);
  });

  it('revokes the Attempt capability whenever the Attempt stops being live', () => {
    const runId = queueRun();
    const ended: { attemptId: string; reason: string }[] = [];
    const withHook = new RunnerSupervisor({
      store,
      spawn: spawnPort(),
      prepare: invocation,
      recovery: new RunRecoveryService({ store, probe, now: () => new Date(clock).toISOString() }),
      lifecycle: new RunLifecycle({ store }),
      now,
      tickMs: 60_000,
      log: () => undefined,
      onAttemptEnded: (input) => ended.push({ attemptId: input.attemptId, reason: input.reason }),
    });
    withHook.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    probe.setAlive(`pid:${String(runner.pid)}`, true);
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    runner.emit({ type: 'attempt.result', status: 'completed', message: 'done' });
    expect(store.runs.find(runId)?.status).toBe('completed');
    expect(ended).toEqual([{ attemptId: runner.input.attempt.id, reason: 'result' }]);
  });

  it('survives a late result for a Run the user already cancelled', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    probe.setAlive(`pid:${String(runner.pid)}`, true);
    runner.emit({
      type: 'attempt.ready',
      sessionId: 'session-1',
      provider: 'stub',
      modelId: 'stub-model',
      tools: [],
      droppedTools: [],
    });
    // The user cancels while the Runner is still working…
    const run = store.runs.find(runId);
    if (run === undefined) throw new Error('unreachable');
    new RunLifecycle({ store }).cancel(runId);
    expect(store.runs.find(runId)?.status).toBe('cancelled');
    // …and the late result must neither throw into the listener nor change the outcome.
    expect(() =>
      runner.emit({ type: 'attempt.result', status: 'completed', message: 'too late' }),
    ).not.toThrow();
    expect(store.runs.find(runId)?.status).toBe('cancelled');
    expect(supervisor.liveAttempts()).toHaveLength(0);
  });
});
