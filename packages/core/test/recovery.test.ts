/**
 * Lease/epoch supervision, daemon-restart inspection and narrow-scope preservation
 * over a real SQLite ProjectStore (`docs/architecture/reliability.md` §2/§6,
 * AC-057, AC-058, AC-061, AC-082).
 *
 * The persisted rows are real: Runs, Attempts, leases, tool operations and frozen
 * DispatchSnapshots live in a real `project.sqlite`. Only the *process table* is a
 * deterministic probe, because the acceptance criteria are about checking process
 * identity rather than about this host's PID allocation — the real probe
 * (`createNodeProcessProbe`) is exercised for its parsing/failure contract
 * separately.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject, Lease, Run, RunStatus, Scope } from '@agentdev/contracts';
import {
  sha256,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import {
  LATE_RESULT_REJECTED_EVENT,
  RUN_RECOVERED_EVENT,
  createMemoryProcessProbe,
  createNodeProcessProbe,
  parseRunnerPid,
  RunLifecycle,
  RunRecoveryService,
  type ProcessProbe,
} from '../src/index.js';
import { canonicalJson } from '../src/dispatcher.js';
import { professionalSpec, SnapshotWriter } from '../src/index.js';
import { scanEvents } from '../src/events.js';

const ROOT = '/tmp/agentdev-recovery-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e01';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e10';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const SECOND_ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61';
const TOOL_OPERATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70';
const ARGS_REF_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e50';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const FUTURE = '2030-01-01T00:00:00.000Z';
const BASE_MS = Date.parse('2026-09-11T00:00:00.000Z');

const WIDE_SCOPE: Scope = {
  readPaths: ['.', 'src'],
  writePaths: ['src'],
  operations: ['read', 'search', 'edit', 'write'],
  networkTargets: [],
};

const NARROW_SCOPE: Scope = {
  readPaths: ['src/orders.ts'],
  writePaths: ['src/orders.ts'],
  operations: ['read', 'edit'],
  networkTargets: [],
};

describe('Run recovery: leases, epochs and restart inspection (AC-057/058/061/082)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let projectId: string;
  let probe: ReturnType<typeof createMemoryProcessProbe>;
  let service: RunRecoveryService;
  let snapshots: SnapshotWriter;
  let clockMs: number;

  const at = (): string => new Date(clockMs).toISOString();
  const advance = (ms: number): void => {
    clockMs += ms;
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-recovery-'));
    clockMs = BASE_MS;
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
      repository: { now: () => at() },
    });
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    probe = createMemoryProcessProbe();
    service = new RunRecoveryService({ store, probe, now: at, heartbeatTimeoutMs: 20_000 });
    snapshots = new SnapshotWriter({ store });
    addWork(WORK_ID, WIDE_SCOPE);
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function addWork(workId: string, scope: Scope): void {
    const budget = store.budgets.insert({
      projectId,
      workId,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    store.works.insert({
      id: workId,
      projectId,
      intent: 'delivery',
      purpose: 'recover a crashed Run',
      level: 'L2',
      goal: 'recovery',
      scope,
      sourceRef: { kind: 'message', id: workId, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: HASH,
      budgetId: budget.id,
      policyRevision: 1,
    });
  }

  /** Freezes a real DispatchSnapshot and returns its hash. */
  function freezeDispatch(scope: Scope): string {
    const spec = professionalSpec({
      workId: WORK_ID,
      role: 'backend',
      purpose: 'implementation',
      goal: 'investigate one file',
      scope,
      stage: 'develop',
      contextSelection: {
        goal: 'investigate one file',
        sourceRefs: [],
        reasonPerSource: {},
        featureRefs: [],
        codePaths: [...scope.readPaths],
        artifactRefs: [],
        excluded: [],
        unknowns: [],
        readBudget: { initialTokens: 1_000, expansionTokens: 1_000 },
      },
      profileRevision: 1,
      requiredOutputs: ['stage.submit'],
      requiredChild: true,
      joinPolicy: 'all',
      budgetAllocation: 1_000,
      parentRunId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99',
    });
    const withoutHash = {
      dispatchSpec: spec,
      effectiveScope: scope,
      requiredOutputSchemas: [{ kind: 'stage.submit', schemaVersion: 1 as const }],
      profileRevision: 1,
      contextSnapshotId: HASH,
    };
    const hash = sha256(canonicalJson(withoutHash));
    return snapshots.freeze('dispatch', { ...withoutHash, hash } as unknown as JsonObject, {
      identityPayload: withoutHash as unknown as JsonObject,
    }).hash;
  }

  function addRun(input: {
    readonly id?: string;
    readonly status?: RunStatus;
    readonly dispatchSnapshotId?: string;
    readonly workId?: string;
  }): Run {
    return store.runs.insert({
      id: input.id ?? RUN_ID,
      workId: input.workId ?? WORK_ID,
      role: 'backend',
      purpose: 'implementation',
      stage: 'develop',
      status: input.status ?? 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: HASH,
      contextSnapshotId: OTHER_HASH,
      dispatchSnapshotId: input.dispatchSnapshotId ?? HASH,
      budgetAllocation: 1_000,
    });
  }

  function addAttempt(input: {
    readonly id: string;
    readonly runId: string;
    readonly number: number;
    readonly epoch: number;
    readonly runnerId?: string;
    readonly heartbeatAt?: string;
    readonly status?: 'starting' | 'running' | 'lost';
  }): void {
    store.attempts.insert({
      id: input.id,
      runId: input.runId,
      number: input.number,
      status: input.status ?? 'running',
      ownerEpoch: input.epoch,
      ...(input.runnerId === undefined ? {} : { runnerId: input.runnerId }),
      ...(input.heartbeatAt === undefined ? {} : { heartbeatAt: input.heartbeatAt }),
    });
  }

  function addToolOperation(state: 'prepared' | 'started' | 'finished' | 'unknown'): void {
    store.toolOperations.insert({
      id: TOOL_OPERATION_ID,
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      toolName: 'bash',
      inputHash: HASH,
      argsRef: ARGS_REF_ID,
      state,
    });
  }

  function addLease(ownerAttemptId = ATTEMPT_ID, epoch = 0, expiresAt = FUTURE): Lease {
    const result = store.leases.acquire({
      resource: 'worktree:task-1',
      ownerAttemptId,
      epoch,
      expiresAt,
      at: at(),
    });
    if (!result.acquired) throw new Error('lease fixture could not be acquired');
    return result.lease;
  }

  it('parses only real process identities and reports the rest as unconfirmed', () => {
    expect(parseRunnerPid('pid:4242')).toBe(4242);
    expect(parseRunnerPid('4242')).toBe(4242);
    expect(parseRunnerPid('container:abc')).toBeNull();
    expect(parseRunnerPid('')).toBeNull();
    const real: ProcessProbe = createNodeProcessProbe();
    // The current process is certainly alive; an absurd pid certainly is not.
    expect(real.probe(`pid:${process.pid}`)).toBe(true);
    expect(real.probe('container:abc')).toBeNull();
  });

  it('rotates an expired lease to a new owner and revokes it for the old one', () => {
    addRun({});
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 0, runnerId: 'pid:1' });
    addLease(ATTEMPT_ID, 0, new Date(BASE_MS + 60_000).toISOString());

    // A live lease is never shared: the second writer is refused with the holder.
    const blocked = store.leases.acquire({
      resource: 'worktree:task-1',
      ownerAttemptId: 'new-attempt',
      epoch: 1,
      expiresAt: FUTURE,
      at: at(),
    });
    expect(blocked.acquired).toBe(false);
    if (blocked.acquired) throw new Error('unreachable');
    expect(blocked.heldBy.ownerAttemptId).toBe(ATTEMPT_ID);

    // Once it expires, a new owner takes it over explicitly.
    advance(120_000);
    const replaced = store.leases.acquire({
      resource: 'worktree:task-1',
      ownerAttemptId: 'newer-attempt',
      epoch: 2,
      expiresAt: FUTURE,
      at: at(),
    });
    expect(replaced.acquired).toBe(true);
    if (!replaced.acquired) throw new Error('unreachable');
    expect(replaced.replacedExpired).toBe(true);

    // The recovery sweep revokes whatever is still expired.
    advance(10_000);
    store.leases.acquire({
      resource: 'worktree:task-2',
      ownerAttemptId: 'stale-attempt',
      epoch: 5,
      expiresAt: new Date(clockMs - 1_000).toISOString(),
      at: at(),
    });
    const freed = service.expireLeases(at());
    expect(freed).toEqual(['worktree:task-2']);
    expect(store.leases.find('worktree:task-2')).toBeUndefined();
  });

  it('parks a running Run as interrupted when its process is confirmed gone', () => {
    addRun({});
    probe.setAlive('pid:1000', false);
    addAttempt({
      id: ATTEMPT_ID,
      runId: RUN_ID,
      number: 1,
      epoch: 0,
      runnerId: 'pid:1000',
      heartbeatAt: at(),
    });
    addLease();

    const inspected = service.inspect(RUN_ID);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) throw new Error('unreachable');
    expect(inspected.inspection.heartbeatStale).toBe(false);
    expect(inspected.inspection.processAlive).toBe(false);
    expect(inspected.inspection.action).toBe('park_interrupted');
    expect(inspected.inspection.newAttemptAllowed).toBe(true);

    const applied = service.recoverRun(RUN_ID);
    expect(applied.to).toBe('interrupted');
    expect(applied.releasedLeases).toEqual(['worktree:task-1']);
    expect(applied.attemptStatus).toBe('lost');
    expect(store.leases_.list({})).toHaveLength(0);
    // No double writer: the freed resource can be granted to a new epoch.
    const taken = store.leases.acquire({
      resource: 'worktree:task-1',
      ownerAttemptId: 'new-attempt',
      epoch: 1,
      expiresAt: FUTURE,
      at: at(),
    });
    expect(taken.acquired).toBe(true);
    const events = scanEvents(store, { names: [RUN_RECOVERED_EVENT] });
    expect(events).toHaveLength(1);
    expect(events[0]?.data['requiresRecoveryDecision']).toBe(false);

    // A confirmed-dead execution is resumable: a fresh Attempt (next epoch) is the
    // documented continuation, so recovery never blocks safe progress.
    const resumedAttempt = new RunLifecycle({ store }).beginAttempt(RUN_ID);
    expect(resumedAttempt.number).toBe(2);
    expect(resumedAttempt.ownerEpoch).toBe(1);
  });

  it('requires a RecoveryDecision while the old process is alive or unconfirmable', () => {
    addRun({});
    probe.setAlive('pid:1000', true);
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 3, runnerId: 'pid:1000' });
    addLease(ATTEMPT_ID, 3);

    const alive = service.inspect(RUN_ID);
    expect(alive.ok).toBe(true);
    if (!alive.ok) throw new Error('unreachable');
    expect(alive.inspection.action).toBe('park_recovery_required');
    expect(alive.inspection.newAttemptAllowed).toBe(false);
    expect(alive.inspection.requiresRecoveryDecision).toBe(true);

    const parked = service.recoverRun(RUN_ID);
    expect(parked.to).toBe('recovery_required');
    // The old attempt is not declared lost: nothing confirmed it terminated.
    expect(parked.attemptStatus).toBeNull();
    // Recovery itself creates no new Attempt; the old process is not declared lost,
    // and a new Attempt waits for a RecoveryDecision.
    expect(store.attempts.list({ where: 'run_id = ?', params: [RUN_ID] })).toHaveLength(1);

    // An unconfirmable identity is *not* "dead".
    const other = addRun({ id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e11' });
    addAttempt({
      id: SECOND_ATTEMPT_ID,
      runId: other.id,
      number: 1,
      epoch: 0,
      runnerId: 'container:abc',
    });
    const unconfirmed = service.inspect(other.id);
    expect(unconfirmed.ok).toBe(true);
    if (!unconfirmed.ok) throw new Error('unreachable');
    expect(unconfirmed.inspection.processAlive).toBeNull();
    expect(unconfirmed.inspection.requiresRecoveryDecision).toBe(true);
    expect(unconfirmed.inspection.newAttemptAllowed).toBe(false);
  });

  it('requires a RecoveryDecision for an unconfirmed tool side effect', () => {
    addRun({});
    probe.setAlive('pid:1000', false);
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 0, runnerId: 'pid:1000' });
    addToolOperation('started');

    const inspected = service.inspect(RUN_ID);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) throw new Error('unreachable');
    expect(inspected.inspection.unknownToolOperations).toEqual([TOOL_OPERATION_ID]);
    expect(inspected.inspection.action).toBe('park_recovery_required');
    expect(inspected.inspection.newAttemptAllowed).toBe(false);
  });

  it('checks real process state instead of the persisted status (AC-061 matrix)', () => {
    // `starting` with a live process: `recovery_required` is not a legal target from
    // `starting`, so the Run is parked `interrupted` with a new Attempt withheld.
    addRun({ status: 'starting' });
    probe.setAlive('pid:1000', true);
    addAttempt({
      id: ATTEMPT_ID,
      runId: RUN_ID,
      number: 1,
      epoch: 0,
      runnerId: 'pid:1000',
      status: 'starting',
    });
    const starting = service.recoverRun(RUN_ID);
    expect(starting.to).toBe('interrupted');
    expect(starting.inspection.requiresRecoveryDecision).toBe(true);
    expect(starting.inspection.newAttemptAllowed).toBe(false);
    expect(starting.attemptStatus).toBeNull();

    // `starting` with a confirmed-dead process: interrupted and resumable.
    const dead = addRun({ id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e12', status: 'starting' });
    probe.setAlive('pid:2000', false);
    addAttempt({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e62',
      runId: dead.id,
      number: 1,
      epoch: 0,
      runnerId: 'pid:2000',
      status: 'starting',
    });
    const resumed = service.recoverRun(dead.id);
    expect(resumed.to).toBe('interrupted');
    expect(resumed.inspection.newAttemptAllowed).toBe(true);
    expect(resumed.attemptStatus).toBe('lost');

    // `running` with a *fresh* heartbeat and a dead process is still interrupted:
    // the persisted heartbeat is not evidence of a live execution.
    const fresh = addRun({ id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e13' });
    probe.setAlive('pid:3000', false);
    addAttempt({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e63',
      runId: fresh.id,
      number: 1,
      epoch: 0,
      runnerId: 'pid:3000',
      heartbeatAt: at(),
    });
    const inspected = service.inspect(fresh.id);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) throw new Error('unreachable');
    expect(inspected.inspection.heartbeatStale).toBe(false);
    expect(inspected.inspection.action).toBe('park_interrupted');
  });

  it('uses a legal two-step path for a waiting Run', () => {
    addRun({ status: 'waiting_children' });
    probe.setAlive('pid:1000', false);
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 0, runnerId: 'pid:1000' });
    const applied = service.recoverRun(RUN_ID);
    expect(applied.path).toEqual(['waiting_children', 'running', 'interrupted']);
    expect(applied.to).toBe('interrupted');
    const run = store.runs.find(RUN_ID);
    expect(run?.status).toBe('interrupted');
  });

  it('leaves a Run with no live state alone', () => {
    addRun({ status: 'completed' });
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 0, runnerId: 'pid:1000' });
    const applied = service.recoverRun(RUN_ID);
    expect(applied.changed).toBe(false);
    expect(applied.to).toBe('completed');
    expect(applied.inspection.action).toBe('none');
  });

  it('refuses an old-epoch success but keeps its diagnostics (AC-058)', () => {
    addRun({});
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 0 });
    advance(1_000);
    addAttempt({ id: SECOND_ATTEMPT_ID, runId: RUN_ID, number: 2, epoch: 1 });

    const refused = service.acceptAttemptResult({
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      status: 'success',
      summary: '旧 epoch 声称完成',
      evidenceRefs: [HASH],
    });
    expect(refused.accepted).toBe(false);
    if (refused.accepted) throw new Error('unreachable');
    expect(refused.code).toBe('STALE_ARTIFACT');
    expect(refused.supersededBy).toBe('newer_attempt');
    expect(refused.diagnosticsKept).toBe(true);
    expect(refused.diagnosticEventId).not.toBeNull();

    const events = scanEvents(store, { names: [LATE_RESULT_REJECTED_EVENT] });
    expect(events).toHaveLength(1);
    expect(events[0]?.data['summary']).toBe('旧 epoch 声称完成');
    expect(events[0]?.data['supersededBy']).toBe('newer_attempt');
    // Nothing was overwritten.
    expect(store.runs.find(RUN_ID)?.status).toBe('running');
    expect(store.stageResults.list({ where: 'run_id = ?', params: [RUN_ID] })).toHaveLength(0);
  });

  it('refuses a late success after cancellation, keeping diagnostics (AC-058)', () => {
    addRun({ status: 'cancelled' });
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 0 });
    const refused = service.acceptAttemptResult({
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      status: 'success',
      summary: '取消后迟到的成功',
    });
    expect(refused.accepted).toBe(false);
    if (refused.accepted) throw new Error('unreachable');
    expect(refused.code).toBe('INVALID_STATE');
    expect(refused.supersededBy).toBe('cancellation');
    expect(refused.diagnosticsKept).toBe(true);
    expect(store.runs.find(RUN_ID)?.status).toBe('cancelled');
  });

  it('refuses a late success superseded by a newer accepted decision (AC-058)', () => {
    addRun({});
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 0 });
    advance(5_000);
    store.decisions.insert({
      id: DECISION_ID,
      workId: WORK_ID,
      kind: 'risk',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['accept', 'reject'],
      state: 'accepted',
      choice: 'accept',
      actor: 'user',
      effectRefs: [],
    });
    const refused = service.acceptAttemptResult({
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      status: 'success',
      summary: '决定之后迟到的成功',
    });
    expect(refused.accepted).toBe(false);
    if (refused.accepted) throw new Error('unreachable');
    expect(refused.supersededBy).toBe('newer_decision');
    expect(refused.diagnosticsKept).toBe(true);
  });

  it('accepts the current epoch when nothing superseded it', () => {
    addRun({});
    addAttempt({ id: ATTEMPT_ID, runId: RUN_ID, number: 1, epoch: 7 });
    const accepted = service.acceptAttemptResult({
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 7,
      status: 'success',
      summary: '当前 epoch 的正常结果',
      evidenceRefs: [HASH],
    });
    expect(accepted.accepted).toBe(true);
    if (!accepted.accepted) throw new Error('unreachable');
    expect(accepted.epoch).toBe(7);
    expect(scanEvents(store, { names: [LATE_RESULT_REJECTED_EVENT] })).toHaveLength(0);
  });

  it('fences daemon epochs across restarts and records the reports', () => {
    addRun({});
    probe.setAlive('pid:1000', false);
    addAttempt({
      id: ATTEMPT_ID,
      runId: RUN_ID,
      number: 1,
      epoch: 0,
      runnerId: 'pid:1000',
      heartbeatAt: at(),
    });

    const first = service.recoverAfterRestart('2026-09-11T00:00:01.000Z');
    expect(first.applied.map((entry) => entry.to)).toEqual(['interrupted']);
    expect(first.reports).toHaveLength(1);
    expect(first.reports[0]?.hostEpoch).toBe('2026-09-11T00:00:01.000Z');
    expect(service.lastHostEpoch()).toBe('2026-09-11T00:00:01.000Z');

    expect(() => service.recoverAfterRestart('2026-09-11T00:00:01.000Z')).toThrowError(
      /不新于已记录的/,
    );
    const second = service.recoverAfterRestart('2026-09-11T00:00:02.000Z');
    expect(second.previousHostEpoch).toBe('2026-09-11T00:00:01.000Z');
    // Already parked, so the second restart has nothing live to recover.
    expect(second.applied).toEqual([]);
    expect(store.runs.find(RUN_ID)?.status).toBe('interrupted');
  });

  it('builds a RecoveryReport from real runner, lease and tool facts', () => {
    addRun({});
    probe.setAlive('pid:1000', false);
    addAttempt({
      id: ATTEMPT_ID,
      runId: RUN_ID,
      number: 1,
      epoch: 2,
      runnerId: 'pid:1000',
      heartbeatAt: at(),
    });
    addLease(ATTEMPT_ID, 2);
    addToolOperation('started');

    const report = service.buildReport(RUN_ID, 'epoch-9');
    expect(report.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.runnerState.processAlive).toBe(false);
    expect(report.runnerState.epoch).toBe(2);
    expect(report.leases.map((lease) => lease.resource)).toEqual(['worktree:task-1']);
    expect(report.toolOutcomes).toEqual([
      { id: TOOL_OPERATION_ID, toolName: 'bash', state: 'started' },
    ]);
    expect(report.externalEffects).toHaveLength(1);
    expect(report.recommendedActions).toEqual(['park_recovery_required']);
    expect(report.gitHeads['work.baseRevision']).toBe(HASH);
  });

  it('preserves the narrow DispatchSnapshot scope after a restart (AC-082)', () => {
    const dispatchSnapshotId = freezeDispatch(NARROW_SCOPE);
    addRun({ dispatchSnapshotId });

    const scope = service.recoveryScope(RUN_ID);
    expect(scope.ok).toBe(true);
    if (!scope.ok) throw new Error('unreachable');
    expect(scope.dispatchSnapshotId).toBe(dispatchSnapshotId);
    expect(scope.effectiveScope).toEqual(NARROW_SCOPE);
    // The Work scope is wider and is reported as *ignored*, not merged.
    expect(scope.workScopeIgnored).toBe(true);
    expect(scope.workScope?.readPaths).toContain('.');

    expect(
      service.verifyRecoveredScope(RUN_ID, { operation: 'read', path: 'src/orders.ts' }),
    ).toMatchObject({ allowed: true, matched: 'src/orders.ts' });
    // `src/payments.ts` is inside the Work scope but not the snapshot: refused.
    const otherFile = service.verifyRecoveredScope(RUN_ID, {
      operation: 'read',
      path: 'src/payments.ts',
    });
    expect(otherFile.allowed).toBe(false);
    expect(otherFile.code).toBe('NOT_AUTHORIZED');
    // An operation the snapshot does not grant is refused even with a valid path.
    expect(
      service.verifyRecoveredScope(RUN_ID, { operation: 'bash', path: 'src/orders.ts' }).allowed,
    ).toBe(false);
    // Writes are bounded by the snapshot's writePaths, not the Work's `src`.
    expect(
      service.verifyRecoveredScope(RUN_ID, { operation: 'edit', path: 'src/payments.ts' }).allowed,
    ).toBe(false);
    expect(
      service.verifyRecoveredScope(RUN_ID, { operation: 'edit', path: 'src/orders.ts' }).allowed,
    ).toBe(true);
  });

  it('refuses to recover a Run whose dispatch snapshot is missing or tampered with', () => {
    addRun({ dispatchSnapshotId: 'c'.repeat(64) });
    const missing = service.recoveryScope(RUN_ID);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('unreachable');
    expect(missing.code).toBe('STALE_ARTIFACT');

    const tampered = freezeDispatch(NARROW_SCOPE);
    addRun({ id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e14', dispatchSnapshotId: tampered });
    // Point the Run at a *different* snapshot hash than the frozen payload declares.
    store.runs.update(
      '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e14',
      { dispatchSnapshotId: OTHER_HASH },
      1,
    );
    const broken = service.recoveryScope('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e14');
    expect(broken.ok).toBe(false);
  });

  it('reports NOT_FOUND instead of throwing for an unknown Run', () => {
    const inspected = service.inspect('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4eff');
    expect(inspected.ok).toBe(false);
    if (inspected.ok) throw new Error('unreachable');
    expect(inspected.code).toBe('NOT_FOUND');
  });
});
