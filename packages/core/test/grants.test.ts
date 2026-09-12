/**
 * WP-07 T1 — the Grant lifecycle over a real SQLite ProjectStore (AC-049, AC-080).
 *
 * The suite drives `GrantStore` against the real `grant`/`tool_operation` tables
 * (`packages/storage/src/schema.ts`) with a real database file, so every claim is
 * about persisted state rather than about a mock:
 *
 * - the issue/refuse matrix (missing Work, foreign Run, operation outside the
 *   Work, target outside the Work paths, malformed `once` binding, role never
 *   dispatched);
 * - `once` execute-then-replay: the executor runs exactly once, the retry gets the
 *   stored result, and a different input hash, tool operation or sibling Run is
 *   refused with `IDEMPOTENCY_CONFLICT` and creates no second execution;
 * - sibling isolation: a `run`/`once` Grant is refused for the other Run of the
 *   same role with no side effect, while a `work` Grant serves both;
 * - expiry at use time and revocation;
 * - the read-only query helpers, which never mutate the rows they read;
 * - concurrent double-consume: a second SQLite connection racing for the same
 *   Grant fails its guarded claim, so exactly one execution happens and the retry
 *   replays the recorded result.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Grant, Scope, ToolOperation } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  GrantStore,
  InMemoryDeferredResultStore,
  type DeferredResultStore,
  type GrantConsumeRequest,
  type GrantIssueInput,
  type GrantIssueOutcome,
} from '../src/index.js';
import { scanEvents } from '../src/events.js';

const ROOT = '/tmp/agentdev-grants-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e00';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e10';
const RUN_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e11';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e40';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e30';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e50';
const ATTEMPT_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e51';
const PHANTOM = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e99';
const TARGET = 'packages/core/src/grants.ts';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);
const HASH_OTHER = 'b'.repeat(64);

/**
 * The Work's authorized envelope.
 *
 * `repoPathSchema` forbids a trailing `/`, so a directory authorization is
 * expressed as the exact file paths it covers — the same convention
 * `isWithinScope` documents.
 */
const SCOPE: Scope = {
  readPaths: [TARGET, 'packages/core/src/store.ts'],
  writePaths: [TARGET, 'packages/core/src/store.ts'],
  operations: ['read', 'edit', 'write'],
  networkTargets: [],
};

let clock = Date.parse('2026-09-11T00:00:00.000Z');

function nextTime(stepMs = 1_000): string {
  clock += stepMs;
  return new Date(clock).toISOString();
}

/** A deterministic lowercase UUIDv7-ish id; the schema only checks the form. */
function uuid(sequence: number): string {
  const tail = sequence.toString(16).padStart(12, '0');
  return `018f2c1e-9a4b-7c3d-8e5f-${tail}`;
}

function operationId(sequence: number): string {
  return uuid(0x700000000000 + sequence);
}

/** Fields a test may override, minus the three optional binding fields. */
type IssueOverrides = Omit<Partial<GrantIssueInput>, 'runId' | 'toolOperationId' | 'inputHash'>;

/**
 * Bindings a test may override *or* remove.
 *
 * Writing the optional members in the target type again (instead of intersecting
 * with `GrantIssueInput`) is what lets `{ toolOperationId: undefined }` through
 * `exactOptionalPropertyTypes` while a real value still narrows to `string`.
 */
type BoundIssueOverrides = IssueOverrides & {
  readonly runId?: string | undefined;
  readonly toolOperationId?: string | undefined;
  readonly inputHash?: string | undefined;
};

/** The bindings a request may deliberately leave out (the "missing binding" case). */
interface IssueRemovals {
  readonly runId?: true;
  readonly toolOperationId?: true;
  readonly inputHash?: true;
}

/**
 * Removes the bindings named in `removals` from a whole request.
 *
 * The result is cast at the single call site: `exactOptionalPropertyTypes` cannot
 * express "this required key is absent" in an object literal, and the point of the
 * case is that `issue` must refuse exactly that shape.
 */
function without(input: GrantIssueInput, removals: IssueRemovals): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };
  for (const key of ['runId', 'toolOperationId', 'inputHash'] as const) {
    if (removals[key] === true) delete output[key];
  }
  return output;
}

describe('GrantStore (AC-049, AC-080)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let results: InMemoryDeferredResultStore;
  let projectId: string;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-grants-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'packages',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    results = new InMemoryDeferredResultStore();
    grants = new GrantStore({ store, now: () => nextTime() });

    const budget = store.budgets.insert({
      projectId,
      workId: WORK_ID,
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
      id: WORK_ID,
      projectId,
      intent: 'delivery',
      purpose: 'deliver WP-07 T1 grants',
      level: 'L2',
      goal: 'make the grant lifecycle real',
      scope: SCOPE,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      budgetId: budget.id,
      policyRevision: 1,
    });
    store.tasks.insert({
      id: TASK_ID,
      projectId,
      workId: WORK_ID,
      planRef: { id: TASK_ID, version: 1, hash: HASH },
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: SCOPE,
      stage: 'develop',
      acceptanceIds: ['AC-049', 'AC-080'],
    });
    for (const [id, attempt] of [
      [RUN_A, ATTEMPT_A],
      [RUN_B, ATTEMPT_B],
    ] as const) {
      store.runs.insert({
        id,
        projectId,
        workId: WORK_ID,
        taskId: TASK_ID,
        role: 'backend',
        purpose: 'implementation',
        stage: 'develop-L2',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: '1'.repeat(64),
        contextSnapshotId: '2'.repeat(64),
        dispatchSnapshotId: '3'.repeat(64),
        budgetAllocation: 1_000,
      });
      store.attempts.insert({
        id: attempt,
        projectId,
        runId: id,
        number: 1,
        status: 'running',
        ownerEpoch: 1,
      });
    }
    store.decisions.insert({
      id: DECISION_ID,
      projectId,
      workId: WORK_ID,
      kind: 'permission',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['allow', 'deny'],
      state: 'accepted',
      choice: 'allow',
      actor: 'user',
      effectRefs: [],
    });
    store.authorizations.insert({
      projectId,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorize the core edit scope',
      scope: SCOPE,
      operations: ['read', 'edit'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function baseOnce(overrides: BoundIssueOverrides = {}): GrantIssueInput {
    const input: GrantIssueInput = {
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'once',
      operation: 'edit',
      targets: [TARGET],
      runId: RUN_A,
      toolOperationId: operationId(1),
      inputHash: HASH,
      decisionId: DECISION_ID,
      // Issuing does not move the clock: expiry is measured from "now", so a
      // request issued later in a test still starts inside its window.
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    };
    return applyOverrides(input, overrides);
  }

  /**
   * Applies test overrides while allowing one of the optionals to be removed.
   *
   * `exactOptionalPropertyTypes` rejects `{ inputHash: undefined }`, yet "the once
   * binding is absent" is exactly the case under test, so the assigned properties
   * are handled one by one and `undefined` means *delete*.
   */
  function applyOverrides(input: GrantIssueInput, overrides: BoundIssueOverrides): GrantIssueInput {
    for (const key of Object.keys(overrides) as (keyof BoundIssueOverrides)[]) {
      const value = overrides[key];
      if (value !== undefined) {
        Object.assign(input, { [key]: value });
        continue;
      }
      // The three bindings under test are the only optional ones; removing any
      // other key would be a test bug.
      if (key === 'runId' || key === 'toolOperationId' || key === 'inputHash') {
        delete input[key];
      }
    }
    return input;
  }

  function issueOnce(overrides: BoundIssueOverrides = {}) {
    return grants.issue(baseOnce(overrides));
  }

  function issueRun(overrides: IssueOverrides = {}) {
    return grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation: 'edit',
      targets: [TARGET],
      runId: RUN_A,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
      ...overrides,
    });
  }

  function issueWork(overrides: IssueOverrides = {}) {
    return grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'work',
      operation: 'edit',
      targets: [TARGET],
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
      ...overrides,
    });
  }

  function consume(
    overrides: Partial<GrantConsumeRequest> = {},
    options: { readonly results?: DeferredResultStore } = {},
  ) {
    const request: GrantConsumeRequest = {
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'edit',
      targets: [TARGET],
      at: nextTime(),
      runId: RUN_A,
      toolName: 'edit',
      toolOperationId: operationId(1),
      inputHash: HASH,
      argsRef: uuid(0x900),
      attemptId: ATTEMPT_A,
      epoch: 1,
      executor: () => 'executed-result',
      ...overrides,
    };
    return grants.consumeOnce(request, options);
  }

  function force(decision: GrantIssueOutcome): asserts decision is { ok: true; grant: Grant } {
    if (!decision.ok) throw new Error(`expected the grant to be issued: ${decision.code}`);
  }

  // ---------------------------------------------------------------------------
  // Issuing
  // ---------------------------------------------------------------------------

  describe('issuing', () => {
    it('mints a grant that carries every documented binding and audits it (AC-049)', () => {
      const inputHash = HASH;
      const op = operationId(11);
      const outcome = issueOnce({
        toolOperationId: op,
        inputHash,
        limits: { maxBytes: 1_024, secretRef: 'provider/main' },
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      const grant = outcome.grant;
      expect(grant.workId).toBe(WORK_ID);
      expect(grant.runId).toBe(RUN_A);
      expect(grant.role).toBe('backend');
      expect(grant.stage).toBe('develop-L2');
      expect(grant.operation).toBe('edit');
      expect(grant.targets).toEqual([TARGET]);
      expect(grant.scope).toBe('once');
      expect(grant.toolOperationId).toBe(op);
      expect(grant.inputHash).toBe(inputHash);
      expect(grant.decisionId).toBe(DECISION_ID);
      expect(grant.expiresAt).toBeTruthy();
      // The row really is in SQLite, not only in the returned value.
      expect(store.grants.find(grant.id)?.operation).toBe('edit');

      const events = scanEvents(store, { names: ['grant.issued'] });
      expect(events).toHaveLength(1);
      // The audit trail names the binding, never a secret value.
      expect(events[0]?.data['operation']).toBe('edit');
      expect(JSON.stringify(events[0]?.data)).not.toContain('provider/main');
    });

    it('refuses an unknown Work without writing a row (AC-049)', () => {
      const before = store.grants.count();
      const outcome = issueOnce({ workId: PHANTOM });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('VALIDATION_ERROR');
      expect(store.grants.count()).toBe(before);
    });

    it('refuses an operation and a target outside the Work scope (AC-049)', () => {
      const operation = issueOnce({ operation: 'push' });
      expect(operation.ok).toBe(false);
      if (operation.ok) throw new Error('unreachable');
      expect(operation.code).toBe('NOT_AUTHORIZED');

      const target = issueOnce({ targets: ['packages/storage/src/store.ts'] });
      expect(target.ok).toBe(false);
      if (target.ok) throw new Error('unreachable');
      expect(target.code).toBe('NOT_AUTHORIZED');
      expect(store.grants.count()).toBe(0);
    });

    it('refuses a Run from another Work and a role that was never dispatched (AC-049)', () => {
      // A second Work with its own Run: the Run exists but belongs elsewhere.
      const otherWork = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e00';
      const otherRun = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e10';
      const budget = store.budgets.insert({
        projectId,
        workId: otherWork,
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
        id: otherWork,
        projectId,
        intent: 'delivery',
        purpose: 'other',
        level: 'L2',
        goal: 'other work',
        scope: SCOPE,
        sourceRef: { kind: 'message', id: otherWork, version: '1' },
        status: 'running',
        blockerIds: [],
        baseRevision: REVISION,
        budgetId: budget.id,
        policyRevision: 1,
      });
      store.runs.insert({
        id: otherRun,
        projectId,
        workId: otherWork,
        role: 'backend',
        purpose: 'implementation',
        stage: 'develop-L2',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: '1'.repeat(64),
        contextSnapshotId: '2'.repeat(64),
        dispatchSnapshotId: '3'.repeat(64),
        budgetAllocation: 1_000,
      });

      const foreign = issueOnce({ runId: otherRun });
      expect(foreign.ok).toBe(false);
      if (foreign.ok) throw new Error('unreachable');
      expect(foreign.code).toBe('NOT_AUTHORIZED');

      const undispatched = issueOnce({ role: 'test', stage: 'test' });
      expect(undispatched.ok).toBe(false);
      if (undispatched.ok) throw new Error('unreachable');
      expect(undispatched.code).toBe('MISSING_CONTEXT');
      expect(store.grants.count()).toBe(0);
    });

    it('refuses a once request without its operation/input binding (AC-080)', () => {
      const missing = grants.issue(
        without(baseOnce(), {
          toolOperationId: true,
          inputHash: true,
        }) as unknown as GrantIssueInput,
      );
      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error('unreachable');
      expect(missing.code).toBe('VALIDATION_ERROR');

      const malformed = issueOnce({ inputHash: 'not-a-hash' });
      expect(malformed.ok).toBe(false);
      if (malformed.ok) throw new Error('unreachable');
      expect(malformed.code).toBe('VALIDATION_ERROR');
      expect(store.grants.count()).toBe(0);
    });

    it('refuses to mint for a Work that is not running (AC-049)', () => {
      const work = store.works.get(WORK_ID);
      store.works.update(WORK_ID, { status: 'completed' }, work.version);
      const outcome = issueOnce();
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('INVALID_STATE');
      expect(store.grants.count()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // once: execute, replay, refuse
  // ---------------------------------------------------------------------------

  describe('once consumption (AC-080)', () => {
    it('executes once and replays the original result for the same input (AC-080)', () => {
      force(issueOnce());
      let executions = 0;
      const executor = (): string => {
        executions += 1;
        return 'original-result';
      };

      const first = consume({ executor }, { results });
      expect(first.outcome).toBe('executed');
      if (first.outcome !== 'executed') throw new Error('unreachable');
      expect(first.result).toBe('original-result');
      expect(first.toolOperation.state).toBe('finished');
      expect(first.toolOperation.resultRef).toBeDefined();
      expect(executions).toBe(1);

      // The persisted row records the consumption in the same row as its input hash.
      const consumed = store.grants.get(first.grant.id);
      expect(consumed.consumedAt).toBeDefined();
      expect(consumed.consumedByOperationId).toBe(operationId(1));
      expect(consumed.inputHash).toBe(HASH);

      const replay = consume({ executor }, { results });
      expect(replay.outcome).toBe('replayed');
      if (replay.outcome !== 'replayed') throw new Error('unreachable');
      expect(replay.result).toBe('original-result');
      expect(replay.resultRef).toBe(first.toolOperation.resultRef);
      // The tool was never run a second time.
      expect(executions).toBe(1);
      expect(store.toolOperations.count()).toBe(1);

      const consumedEvents = scanEvents(store, { names: ['grant.consumed'] });
      expect(consumedEvents).toHaveLength(1);
    });

    it('leaves the grant unconsumed and rolls the tool operation back when the tool fails (AC-080)', () => {
      force(issueOnce());
      let executions = 0;
      expect(() =>
        consume({
          executor: () => {
            executions += 1;
            throw new Error('tool crashed');
          },
        }),
      ).toThrowError(/tool crashed/);

      // A failed execution is not a consumption: the grant is still usable and no
      // half-written tool operation survives.
      expect(executions).toBe(1);
      expect(store.grants.list()[0]?.consumedAt).toBeUndefined();
      expect(store.toolOperations.count()).toBe(0);

      const retry = consume({ executor: () => 'eventual-result' }, { results });
      expect(retry.outcome).toBe('executed');
      if (retry.outcome !== 'executed') throw new Error('unreachable');
      expect(retry.result).toBe('eventual-result');
      expect(store.toolOperations.count()).toBe(1);
    });

    it('replays after the grant has expired, because the result is the recorded fact (AC-080)', () => {
      force(issueOnce({ expiresAt: new Date(clock + 60_000).toISOString() }));
      const first = consume({}, { results });
      expect(first.outcome).toBe('executed');

      const replay = consume({ at: new Date(clock + 3_600_000).toISOString() }, { results });
      expect(replay.outcome).toBe('replayed');
      if (replay.outcome !== 'replayed') throw new Error('unreachable');
      expect(replay.result).toBe('executed-result');
    });

    it('refuses a different input hash with IDEMPOTENCY_CONFLICT and consumes nothing (AC-080)', () => {
      force(issueOnce());
      let executions = 0;
      const first = consume({ executor: () => (executions += 1) }, { results });
      expect(first.outcome).toBe('executed');

      const conflict = consume(
        {
          inputHash: HASH_OTHER,
          // `data.md` §2: a repeated operation id with a different input hash is
          // refused, never replayed.
          toolOperationId: operationId(1),
          executor: () => (executions += 1),
        },
        { results },
      );
      expect(conflict.outcome).toBe('refused');
      if (conflict.outcome !== 'refused') throw new Error('unreachable');
      expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflict.fields).toContain('inputHash');
      expect(executions).toBe(1);
      expect(store.toolOperations.count()).toBe(1);
    });

    it('refuses a different tool operation with IDEMPOTENCY_CONFLICT (AC-080)', () => {
      force(issueOnce());
      let executions = 0;
      const first = consume({ executor: () => (executions += 1) }, { results });
      expect(first.outcome).toBe('executed');

      const conflict = consume(
        { toolOperationId: operationId(2), executor: () => (executions += 1) },
        { results },
      );
      expect(conflict.outcome).toBe('refused');
      if (conflict.outcome !== 'refused') throw new Error('unreachable');
      expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflict.fields).toContain('toolOperationId');
      expect(executions).toBe(1);
    });

    it('refuses a different operation than the grant was issued for (AC-049)', () => {
      force(issueOnce());
      let executions = 0;
      const refused = consume(
        { operation: 'write', executor: () => (executions += 1) },
        { results },
      );
      expect(refused.outcome).toBe('refused');
      if (refused.outcome !== 'refused') throw new Error('unreachable');
      expect(refused.code).toBe('NOT_AUTHORIZED');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);
      expect(store.grants.get(store.grants.list()[0]?.id ?? '').consumedAt).toBeUndefined();
    });

    it('refuses a replayed reference whose result cannot be resolved as RECOVERY_REQUIRED (AC-080)', () => {
      force(issueOnce());
      const first = consume({}, { results });
      expect(first.outcome).toBe('executed');

      // A sink that never saw the execution cannot resolve the reference. The row
      // is the recorded fact, so the honest answer is a recovery state rather than
      // a silent `undefined` presented as the original result.
      expect(() => consume({}, { results: new InMemoryDeferredResultStore() })).toThrowError(
        /cannot resolve/,
      );
      expect(store.toolOperations.count()).toBe(1);
    });

    it('reports RECOVERY_REQUIRED when a started tool operation has no recorded result (AC-080)', () => {
      const op = operationId(44);
      force(issueOnce({ toolOperationId: op }));
      store.toolOperations.insert({
        id: op,
        workId: WORK_ID,
        runId: RUN_A,
        attemptId: ATTEMPT_A,
        epoch: 1,
        toolName: 'edit',
        inputHash: HASH,
        argsRef: uuid(0x901),
        state: 'started',
        grantId: store.grants.list()[0]?.id ?? '',
      });
      let executions = 0;
      const outcome = consume({ toolOperationId: op, executor: () => (executions += 1) });
      expect(outcome.outcome).toBe('refused');
      if (outcome.outcome !== 'refused') throw new Error('unreachable');
      expect(outcome.code).toBe('RECOVERY_REQUIRED');
      expect(executions).toBe(0);
    });

    it('refuses a recorded tool operation id reused with a different input hash (AC-080)', () => {
      const op = operationId(45);
      force(issueOnce({ toolOperationId: op }));
      const first = consume({ toolOperationId: op }, { results });
      expect(first.outcome).toBe('executed');

      // A second Grant bound to the same operation id with a different input is
      // the documented IDEMPOTENCY_CONFLICT (`data.md` §2), not a replay.
      force(
        grants.issue({
          workId: WORK_ID,
          role: 'backend',
          stage: 'develop-L2',
          scope: 'once',
          operation: 'edit',
          targets: [TARGET],
          runId: RUN_A,
          toolOperationId: op,
          inputHash: HASH_OTHER,
          decisionId: DECISION_ID,
          expiresAt: new Date(clock + 3_600_000).toISOString(),
        }),
      );
      const refused = consume({ toolOperationId: op, inputHash: HASH_OTHER });
      expect(refused.outcome).toBe('refused');
      if (refused.outcome !== 'refused') throw new Error('unreachable');
      expect(refused.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(store.toolOperations.count()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Sibling isolation
  // ---------------------------------------------------------------------------

  describe('sibling run isolation (AC-080)', () => {
    it('refuses the sibling Run on a run-scoped grant with no side effect (AC-080)', () => {
      force(issueRun());
      let executions = 0;
      const refused = consume(
        {
          runId: RUN_B,
          attemptId: ATTEMPT_B,
          executor: () => (executions += 1),
        },
        { results },
      );
      expect(refused.outcome).toBe('refused');
      if (refused.outcome !== 'refused') throw new Error('unreachable');
      expect(refused.code).toBe('NOT_AUTHORIZED');
      expect(refused.fields).toContain('runId');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);

      // The owner Run still uses it.
      const owner = consume({ executor: () => (executions += 1) }, { results });
      expect(owner.outcome).toBe('executed');
      expect(executions).toBe(1);
    });

    it('refuses the sibling Run reaching for a consumed once grant (AC-080)', () => {
      force(issueOnce());
      const first = consume({}, { results });
      expect(first.outcome).toBe('executed');

      const sibling = consume({ runId: RUN_B, attemptId: ATTEMPT_B }, { results });
      expect(sibling.outcome).toBe('refused');
      if (sibling.outcome !== 'refused') throw new Error('unreachable');
      expect(sibling.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(sibling.fields).toContain('runId');
    });

    it('keeps a work-scoped grant usable by both Runs (AC-080)', () => {
      force(issueWork());
      const grantId = store.grants.list()[0]?.id ?? '';

      const first = consume(
        { toolOperationId: operationId(60), executor: () => 'run-a-result' },
        { results },
      );
      expect(first.outcome).toBe('executed');
      if (first.outcome !== 'executed') throw new Error('unreachable');

      const second = consume(
        {
          runId: RUN_B,
          attemptId: ATTEMPT_B,
          toolOperationId: operationId(61),
          executor: () => 'run-b-result',
        },
        { results },
      );
      expect(second.outcome).toBe('executed');
      if (second.outcome !== 'executed') throw new Error('unreachable');
      expect(second.result).toBe('run-b-result');
      // The work-scoped grant itself carries no run binding.
      expect(store.grants.get(grantId)?.runId).toBeUndefined();
      expect(store.toolOperations.count()).toBe(2);
    });

    it('refuses a request claiming another Work, with no row written (AC-080)', () => {
      force(issueOnce());
      const otherWork = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e00';
      let executions = 0;
      const refused = consume(
        {
          workId: otherWork,
          executor: () => (executions += 1),
        },
        { results },
      );
      expect(refused.outcome).toBe('refused');
      if (refused.outcome !== 'refused') throw new Error('unreachable');
      expect(refused.code).toBe('NOT_AUTHORIZED');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);
      expect(store.grants.list()[0]?.consumedAt).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Expiry and revocation
  // ---------------------------------------------------------------------------

  describe('expiry and revocation (AC-049)', () => {
    it('refuses an expired grant at use time and does not execute (AC-049)', () => {
      force(issueOnce({ expiresAt: nextTime(1_000) }));
      let executions = 0;
      const refused = consume(
        { at: nextTime(3_600_000), executor: () => (executions += 1) },
        { results },
      );
      expect(refused.outcome).toBe('refused');
      if (refused.outcome !== 'refused') throw new Error('unreachable');
      expect(refused.code).toBe('AUTH_EXPIRED');
      expect(executions).toBe(0);
      expect(store.grants.list()[0]?.consumedAt).toBeUndefined();
    });

    it('refuses every later use after revoke, while a completed once still replays (AC-049, AC-080)', () => {
      force(issueOnce());
      const grantId = store.grants.list()[0]?.id ?? '';
      const revoked = grants.revoke({ grantId, at: nextTime(), reason: 'user withdrew it' });
      expect(revoked.ok).toBe(true);
      if (!revoked.ok) throw new Error('unreachable');
      // The row is closed and its expiry sits before every later use.
      expect(revoked.grant.consumedAt).toBeDefined();
      expect(Date.parse(revoked.grant.expiresAt)).toBe(0);

      let executions = 0;
      const refused = consume({ executor: () => (executions += 1) }, { results });
      expect(refused.outcome).toBe('refused');
      if (refused.outcome !== 'refused') throw new Error('unreachable');
      expect(refused.code).toBe('AUTH_EXPIRED');
      expect(executions).toBe(0);
      // Nothing was consumed by the attempt.
      expect(store.toolOperations.count()).toBe(0);

      expect(scanEvents(store, { names: ['grant.revoked'] })).toHaveLength(1);

      // A completed transaction is unaffected by a later revocation of another
      // grant: the recorded result still replays.
      force(issueOnce({ toolOperationId: operationId(70), inputHash: HASH }));
      const first = consume({ toolOperationId: operationId(70) }, { results });
      expect(first.outcome).toBe('executed');
      const replay = consume({ toolOperationId: operationId(70) }, { results });
      expect(replay.outcome).toBe('replayed');
    });

    it('refuses to revoke a grant that is already closed', () => {
      force(issueOnce());
      const grantId = store.grants.list()[0]?.id ?? '';
      expect(grants.revoke({ grantId, at: nextTime(), reason: 'first' }).ok).toBe(true);
      const second = grants.revoke({ grantId, at: nextTime(), reason: 'second' });
      expect(second.ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  describe('query helpers (AC-049)', () => {
    it('reports the current grants of a run and a work, and removes a consumed one', () => {
      force(issueRun());
      const runGrants = grants.currentRunGrants(RUN_A);
      expect(runGrants).toHaveLength(1);
      expect(runGrants[0]?.scope).toBe('run');
      expect(runGrants[0]?.consumedAt).toBeUndefined();
      expect(grants.currentWorkGrants(WORK_ID)).toHaveLength(1);
      // A run grant is not another run's current grant.
      expect(grants.currentRunGrants(RUN_B)).toEqual([]);

      const outcome = consume({}, { results });
      expect(outcome.outcome).toBe('executed');
      // A `run` grant stays current: it is reusable by its own run for further
      // operations (`AC-080`), so it is never marked consumed.
      expect(grants.currentRunGrants(RUN_A)).toHaveLength(1);
      expect(grants.grantHistory(WORK_ID)).toHaveLength(1);
      // The recorded tool operation is what makes the first call replay-safe.
      expect(grants.grantForToolOperation(operationId(1))?.state).toBe('finished');

      // A `once` grant, by contrast, leaves the current set after consumption.
      force(issueOnce({ toolOperationId: operationId(80), inputHash: HASH }));
      const consumed = consume({ toolOperationId: operationId(80) }, { results });
      expect(consumed.outcome).toBe('executed');
      expect(grants.currentWorkGrants(WORK_ID).map((grant) => grant.scope)).toEqual(['run']);
      expect(grants.grantHistory(WORK_ID)).toHaveLength(2);
    });

    it('keeps a consumed once grant visible to coverage, because it still replays (AC-080)', () => {
      force(issueOnce());
      const query = {
        workId: WORK_ID,
        operation: 'edit',
        role: 'backend' as const,
        stage: 'develop-L2',
        targets: [TARGET],
        at: nextTime(),
        runId: RUN_A,
        toolOperationId: operationId(1),
        inputHash: HASH,
      };
      const first = consume({ toolOperationId: operationId(1) }, { results });
      expect(first.outcome).toBe('executed');
      // The recorded binding still answers the same query, and a different input
      // hash no longer matches it.
      expect(grants.checkCoverage(query)).toBe(true);
      expect(grants.checkCoverage({ ...query, inputHash: HASH_OTHER })).toBe(false);
      expect(grants.currentWorkGrants(WORK_ID)).toEqual([]);
    });

    it('answers coverage with the same rules consumption would apply', () => {
      force(issueOnce());
      const query = {
        workId: WORK_ID,
        operation: 'edit',
        role: 'backend' as const,
        stage: 'develop-L2',
        targets: [TARGET],
        at: nextTime(),
        runId: RUN_A,
        toolOperationId: operationId(1),
        inputHash: HASH,
      };
      expect(grants.checkCoverage(query)).toBe(true);
      expect(grants.findGrantFor(query)?.operation).toBe('edit');

      // Out of target, wrong role, sibling run and wrong input all mean "not covered".
      expect(grants.checkCoverage({ ...query, targets: ['packages/storage/src/store.ts'] })).toBe(
        false,
      );
      expect(grants.checkCoverage({ ...query, role: 'test' })).toBe(false);
      expect(grants.checkCoverage({ ...query, runId: RUN_B })).toBe(false);
      expect(grants.checkCoverage({ ...query, inputHash: HASH_OTHER })).toBe(false);
    });

    it('never mutates the rows it reads', () => {
      force(issueOnce());
      const before = JSON.stringify(store.grants.list({ orderBy: 'created_at ASC' }));
      const eventsBefore = store.events.latestCursor();
      const query = {
        workId: WORK_ID,
        operation: 'edit',
        role: 'backend' as const,
        stage: 'develop-L2',
        targets: [TARGET],
        at: nextTime(),
        runId: RUN_A,
        toolOperationId: operationId(1),
        inputHash: HASH,
      };
      grants.currentRunGrants(RUN_A);
      grants.currentWorkGrants(WORK_ID);
      grants.grantHistory(WORK_ID);
      grants.findGrantFor(query);
      grants.checkCoverage(query);
      expect(JSON.stringify(store.grants.list({ orderBy: 'created_at ASC' }))).toBe(before);
      expect(store.events.latestCursor()).toBe(eventsBefore);
    });

    it('surfaces the tool operation a grant was consumed by', () => {
      force(issueOnce());
      const outcome = consume({}, { results });
      expect(outcome.outcome).toBe('executed');
      if (outcome.outcome !== 'executed') throw new Error('unreachable');
      const operation: ToolOperation | undefined = grants.grantForToolOperation(operationId(1));
      expect(operation?.id).toBe(operationId(1));
      expect(operation?.grantId).toBe(outcome.grant.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------------

  describe('concurrent double-consume (AC-080)', () => {
    it('lets exactly one of two connections claim the grant, and executes once (AC-080)', async () => {
      force(issueOnce());
      const grantId = store.grants.list()[0]?.id ?? '';
      const databaseFile = join(dataDir, 'project.sqlite');
      const op = operationId(1);

      // Handshake buffers: the worker parks *inside* its wait and only claims once
      // the in-process execution has started, so the ordering is deterministic
      // rather than a timing race. `gate` releases the worker; `started` is the
      // signal from the executor.
      const gate = new Int32Array(new SharedArrayBuffer(4));
      const started = new Int32Array(new SharedArrayBuffer(4));

      // A second connection runs the exact guarded UPDATE the store uses for its
      // atomic claim, on the same Grant and the same tool operation.
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads');
        const Database = require('better-sqlite3');
        const gate = new Int32Array(workerData.gate);
        const started = new Int32Array(workerData.started);
        const db = new Database(workerData.file);
        db.pragma('busy_timeout = 5000');
        const claim = db.prepare(
          'UPDATE grant SET consumed_at = ?, consumed_by_operation_id = ?, input_hash = ?, ' +
          'version = version + 1, updated_at = ? ' +
          'WHERE id = ? AND consumed_at IS NULL AND run_id = ? AND tool_operation_id = ? AND input_hash = ?'
        );
        parentPort.postMessage('waiting');
        Atomics.wait(gate, 0, 0, 10000);
        const result = claim.run(
          workerData.at, workerData.op, workerData.hash, workerData.at,
          workerData.grantId, workerData.runId, workerData.op, workerData.hash
        );
        db.close();
        parentPort.postMessage({ changes: result.changes, started: Atomics.load(started, 0) });
        `,
        {
          eval: true,
          workerData: {
            file: databaseFile,
            grantId,
            runId: RUN_A,
            op,
            hash: HASH,
            at: nextTime(),
            gate: gate.buffer,
            started: started.buffer,
          },
        },
      );

      const workerResult = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker timed out')), 20_000);
        worker.on('message', (message: unknown) => {
          if (message === 'waiting') return;
          const { changes } = message as { changes?: number };
          if (typeof changes !== 'number') return;
          clearTimeout(timer);
          resolve(changes);
        });
        worker.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      // The in-process consume claims the Grant and runs the tool once.
      let executions = 0;
      const outcome = consume(
        {
          toolOperationId: op,
          executor: () => {
            executions += 1;
            // The racing connection has been waiting for exactly this moment: it
            // runs its claim while this transaction still holds the write lock.
            Atomics.store(started, 0, 1);
            Atomics.store(gate, 0, 1);
            Atomics.notify(gate, 0);
            return 'only-result';
          },
        },
        { results },
      );
      expect(outcome.outcome).toBe('executed');
      expect(executions).toBe(1);

      // The racing connection can never have claimed it: its guarded UPDATE no-ops
      // once the in-process transaction committed.
      expect(await workerResult).toBe(0);
      expect(store.toolOperations.count()).toBe(1);
      expect(store.grants.get(grantId)?.consumedByOperationId).toBe(op);

      // A retry after the race replays the recorded result; nothing runs again.
      const replay = consume({ toolOperationId: op }, { results });
      expect(replay.outcome).toBe('replayed');
      if (replay.outcome !== 'replayed') throw new Error('unreachable');
      expect(replay.result).toBe('only-result');
      expect(executions).toBe(1);
    });
  });
});
