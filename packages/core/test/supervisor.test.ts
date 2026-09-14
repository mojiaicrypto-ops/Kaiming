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
import {
  RunnerSupervisor,
  RunLifecycle,
  RunRecoveryService,
  createMemoryProcessProbe,
  newAttemptAdmission,
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
function queueRun(options: { role?: 'chief' | 'backend'; workId?: string } = {}): string {
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
    status: 'running',
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
    expect(run?.status).toBe('running');
    const attempt = store.attempts.find(runner.input.attempt.id);
    expect(attempt?.status).toBe('starting');
    expect(attempt?.runnerId).toBe(runner.input.runnerId);
    expect(attempt?.heartbeatAt).toBeDefined();
    // The prompt waits for `ready`: the epoch/process/environment is confirmed first.
    expect(runner.commands).toHaveLength(0);

    probe.setAlive(runner.input.runnerId, true);
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

  it('fails an Attempt whose requested tools were not activated', () => {
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
    expect(store.runs.find(runId)?.status).toBe('failed');
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

describe('RunnerSupervisor heartbeat and recovery', () => {
  it('parks a silent Attempt as lost; a dead process still allows a new Attempt', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    // The process is confirmed gone, so the Run is parked `interrupted` and may be
    // retried (`reliability.md` §6).
    probe.setAlive(runner.input.runnerId, false);
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
    probe.setAlive(runner.input.runnerId, null);
    clock += LIMITS.leaseSec.default * 1000 + 1;
    const tick = supervisor.tick();
    expect(tick.parked).toEqual([runId]);
    expect(store.runs.find(runId)?.status).toBe('recovery_required');
    const admission = newAttemptAdmission(store, runId);
    expect(admission.allowed).toBe(false);
    expect(admission.requiresRecoveryDecision).toBe(true);
  });

  it('parks a Run whose Runner exited without a result', () => {
    const runId = queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    probe.setAlive(runner.input.runnerId, false);
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

  it('stops gracefully: shutdown first, then SIGTERM', async () => {
    queueRun();
    supervisor.tick();
    const runner = FakeRunner.spawned[0];
    if (runner === undefined) throw new Error('unreachable');
    await supervisor.stop();
    expect(runner.commands.some((command) => command.type === 'attempt.shutdown')).toBe(true);
    expect(runner.signals).toContain('SIGTERM');
    // A stopped supervisor claims nothing further.
    expect(supervisor.tick().claimed).toEqual([]);
  });
});
