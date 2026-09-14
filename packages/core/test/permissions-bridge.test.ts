/**
 * T3.4 — the Grant/permission lifecycle (`ToolGrantService`, AC-049/AC-080).
 *
 * Real SQLite, real Grant rows, real Decisions:
 *
 * - `ensureRunGrants` mints the Run's file-scope Grants from the Work's authorization and
 *   cites an existing Decision (`grant.decision_id` is a foreign key) — the production
 *   caller `GrantStore.issue` never had before;
 * - an environment operation that the Work envelope does not carry cannot be minted even
 *   after approval (the envelope is re-validated), while the same operation **can** be
 *   minted once an authorization row names it (D-T3-5);
 * - `requestPermission` records a pending `permission` Decision and attaches it to the
 *   Work's blockers; `approvePermission` mints a `once` Grant bound to
 *   `(runId, toolOperationId, inputHash)` and lifts the blocker; `denyPermission` mints
 *   nothing;
 * - `revokeRun` closes every live Grant so a later call is refused.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { GrantStore } from '../src/grants.js';
import { ProtocolError } from '../src/errors.js';
import { ToolGrantService, requiresPerOccurrenceApproval } from '../src/permissions.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e00';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e10';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e40';
const HASH = 'a'.repeat(64);
const REVISION = 'c'.repeat(40);
const OP_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e60';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e50';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e30';

/** The Work's own envelope: file operations only; `bash` needs an authorization. */
const SCOPE: Scope = {
  readPaths: ['src/a.ts'],
  writePaths: ['src/a.ts'],
  operations: ['read', 'search', 'write', 'edit', 'artifact_write'],
  networkTargets: [],
};

describe('ToolGrantService', () => {
  let dataDir: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let service: ToolGrantService;
  let clock: number;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-grantbridge-'));
    store = Store.open({
      dataDir,
      canonicalRoot: dataDir,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    const projectId = projectIdFromRoot(dataDir);
    store.projects.insert({
      id: projectId,
      root: dataDir,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    grants = new GrantStore({ store, now: () => new Date(clock).toISOString() });
    service = new ToolGrantService({
      store,
      grants,
      now: () => new Date(clock).toISOString(),
    });
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
      purpose: 'deliver the T3 permission chain',
      level: 'L2',
      goal: 'make the permission chain real',
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
      acceptanceIds: ['AC-049'],
    });
    store.runs.insert({
      id: RUN_ID,
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
      id: ATTEMPT_ID,
      projectId,
      runId: RUN_ID,
      number: 1,
      status: 'running',
      ownerEpoch: 1,
    });
    store.decisions.insert({
      id: DECISION_ID,
      projectId,
      workId: WORK_ID,
      kind: 'risk',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['accepted'],
      state: 'accepted',
      choice: 'accepted',
      actor: 'user',
      effectRefs: [],
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function expiresAt(seconds = 3_600): string {
    return new Date(clock + seconds * 1_000).toISOString();
  }

  it('refuses a permission request that could never be bound (G8)', () => {
    const decisionsBefore = store.decisions.count();
    // A path operation with no targets can never be matched by a Grant, so recording a
    // pending Decision would park the Run in `waiting_permission` forever.
    expect(() =>
      service.requestPermission({
        workId: WORK_ID,
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        operation: 'read',
        targets: [],
        toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc001',
        inputHash: 'a'.repeat(64),
        expiresAt: new Date(clock + 600_000).toISOString(),
      }),
    ).toThrowError(ProtocolError);
    expect(store.decisions.count()).toBe(decisionsBefore);
    expect(store.runs.find(RUN_ID)?.status).toBe('running');
  });

  it('refuses a permission request for a Run whose role has no Task (G8)', () => {
    const decisionsBefore = store.decisions.count();
    // No Task means the role was never dispatched through an approved Plan, so no Grant can
    // ever be minted: the request must be a typed refusal and the Run must keep running
    // instead of stopping in `waiting_permission` with nothing a user could approve.
    const refusal = (() => {
      try {
        service.requestPermission({
          workId: WORK_ID,
          runId: RUN_ID,
          role: 'frontend',
          stage: 'develop-L2',
          operation: 'bash',
          targets: [],
          toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc002',
          inputHash: 'a'.repeat(64),
          expiresAt: new Date(clock + 600_000).toISOString(),
        });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeInstanceOf(ProtocolError);
    expect((refusal as ProtocolError).code).toBe('MISSING_CONTEXT');
    expect(store.decisions.count()).toBe(decisionsBefore);
    expect(store.runs.find(RUN_ID)?.status).toBe('running');
  });

  it('mints the run file-scope Grants and cites a real Decision', () => {
    const result = service.ensureRunGrants({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      expiresAt: expiresAt(),
    });
    expect(result.ok).toBe(true);
    expect(result.created).toBeGreaterThan(0);
    expect(result.decisionId).not.toBe('');
    expect(store.decisions.find(result.decisionId)?.state).toBe('accepted');
    const operations = result.grants.map((grant) => grant.operation).sort();
    expect(operations).toEqual(['artifact_write', 'edit', 'read', 'search', 'write']);
    for (const grant of result.grants) {
      expect(grant.runId).toBe(RUN_ID);
      expect(grant.scope).toBe('run');
      expect(grant.decisionId).toBe(result.decisionId);
      expect(grant.targets).toEqual(['src/a.ts']);
    }
    // `read`/`search` may target the union of read and write paths (writing a file
    // implies being able to read it back); the mutating operations only the write paths.
  });

  it('is idempotent: a second start reuses the Grants instead of widening authority', () => {
    const first = service.ensureRunGrants({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      expiresAt: expiresAt(),
    });
    const second = service.ensureRunGrants({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      expiresAt: expiresAt(),
    });
    expect(second.created).toBe(0);
    expect(second.existing).toBe(first.grants.length);
    expect(second.grants).toHaveLength(first.grants.length);
  });

  /** The environment operation this Work's envelope does not carry. */
  const ask = (overrides: Partial<Parameters<ToolGrantService['requestPermission']>[0]> = {}) =>
    service.requestPermission({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'bash',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      expiresAt: expiresAt(),
      ...overrides,
    });

  function mint(decisionId: string, overrides: Record<string, unknown> = {}) {
    return grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'once',
      operation: 'bash',
      targets: [],
      runId: RUN_ID,
      toolOperationId: OP_ID,
      inputHash: HASH,
      decisionId,
      expiresAt: expiresAt(),
      ...overrides,
    });
  }

  it('refuses an environment operation with no approval at all', () => {
    // The message-derived authorization carries only file operations, so `bash` is outside
    // the Work envelope and an ordinary decision authorizes nothing.
    const refused = mint(DECISION_ID);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('NOT_AUTHORIZED');
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
  });

  it('refuses a pending, a rejected and a non-permission decision', () => {
    const pending = ask();
    // `pending` is not an approval: the decision has not been answered yet.
    const fromPending = mint(pending.decisionId);
    expect(fromPending.ok).toBe(false);
    if (!fromPending.ok) expect(fromPending.code).toBe('NOT_AUTHORIZED');

    const denied = ask({ toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e61' });
    service.denyPermission(denied.decisionId);
    const fromDenied = mint(denied.decisionId, {
      toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e61',
    });
    expect(fromDenied.ok).toBe(false);
    if (!fromDenied.ok) expect(fromDenied.code).toBe('NOT_AUTHORIZED');

    // A `product` decision is not a permission approval, whatever its state.
    const product = store.decisions.insert({
      projectId: projectIdFromRoot(dataDir),
      workId: WORK_ID,
      kind: 'product',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['accept'],
      state: 'accepted',
      choice: 'accept',
      actor: 'user',
      effectRefs: [],
    });
    const fromProduct = mint(product.id);
    expect(fromProduct.ok).toBe(false);
    if (!fromProduct.ok) expect(fromProduct.code).toBe('NOT_AUTHORIZED');
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
  });

  it('refuses a permission decision that belongs to another Work', () => {
    const requested = ask();
    const approved = service.approvePermission({
      decisionId: requested.decisionId,
      operation: 'bash',
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      expiresAt: expiresAt(),
    });
    expect(approved.grant).toBeDefined();
    // The accepted Decision now exists; citing it from another Work must still be refused.
    const otherWork = store.works.insert({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e0f',
      projectId: projectIdFromRoot(dataDir),
      intent: 'delivery',
      purpose: 'another work',
      level: 'L2',
      goal: 'another work',
      scope: SCOPE,
      sourceRef: { kind: 'message', id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e0f', version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      budgetId: store.budgets.list()[0]?.id ?? '',
      policyRevision: 1,
    });
    expect(otherWork.id).toBe('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e0f');
    const foreign = grants.issue({
      workId: otherWork.id,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'once',
      operation: 'bash',
      targets: [],
      runId: RUN_ID,
      toolOperationId: OP_ID,
      inputHash: HASH,
      decisionId: requested.decisionId,
      expiresAt: expiresAt(),
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses to re-point an accepted approval at another operation, target or input', () => {
    const requested = ask();
    service.approvePermission({
      decisionId: requested.decisionId,
      operation: 'bash',
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      expiresAt: expiresAt(),
    });
    // Another operation.
    expect(mint(requested.decisionId, { operation: 'delete_data', targets: ['src/a.ts'] }).ok).toBe(
      false,
    );
    // Another target list.
    expect(mint(requested.decisionId, { targets: ['src/a.ts'] }).ok).toBe(false);
    // Another input hash.
    expect(mint(requested.decisionId, { inputHash: 'c'.repeat(64) }).ok).toBe(false);
    // Another tool operation.
    expect(
      mint(requested.decisionId, { toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e62' }).ok,
    ).toBe(false);
    // Only the exact binding the Decision recorded is admitted, and only once.
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(1);
  });

  it('does not widen the paths the Work authorizes, even with an approval', () => {
    // `delete_data` is path-shaped, so the Work's path envelope still applies: an approval
    // for a path nobody authorized is refused.
    const requested = service.requestPermission({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'delete_data',
      targets: ['secrets/.env'],
      toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e63',
      inputHash: HASH,
      expiresAt: expiresAt(),
    });
    expect(() =>
      service.approvePermission({
        decisionId: requested.decisionId,
        operation: 'delete_data',
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        targets: ['secrets/.env'],
        toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d9e63',
        inputHash: HASH,
        expiresAt: expiresAt(),
      }),
    ).toThrowError(ProtocolError);
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
  });

  it('consumes the approved once Grant exactly once and never replays a different input', () => {
    const requested = ask();
    service.approvePermission({
      decisionId: requested.decisionId,
      operation: 'bash',
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      expiresAt: expiresAt(),
    });
    const consume = (toolOperationId: string, inputHash: string) =>
      grants.consumeOnce({
        workId: WORK_ID,
        role: 'backend',
        stage: 'develop-L2',
        operation: 'bash',
        targets: [],
        at: new Date(clock).toISOString(),
        runId: RUN_ID,
        toolName: 'bash',
        toolOperationId,
        inputHash,
        argsRef: OP_ID,
        attemptId: ATTEMPT_ID,
        epoch: 1,
        executor: () => ({ stdout: 'ok' }),
      });
    const first = consume(OP_ID, HASH);
    expect(first.outcome).toBe('executed');
    // The same operation and hash replays the recorded result...
    expect(consume(OP_ID, HASH).outcome).toBe('replayed');
    // ...while a different input is refused and consumes nothing.
    const different = consume(OP_ID, 'd'.repeat(64));
    expect(different.outcome).toBe('refused');
    if (different.outcome === 'refused') expect(different.code).toBe('IDEMPOTENCY_CONFLICT');
    // A second approval cannot mint a second Grant either.
    expect(() =>
      service.approvePermission({
        decisionId: requested.decisionId,
        operation: 'bash',
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        targets: [],
        toolOperationId: OP_ID,
        inputHash: HASH,
        expiresAt: expiresAt(),
      }),
    ).toThrowError(ProtocolError);
  });

  it('mints the bound once Grant after an approval the Work authorizes', () => {
    store.authorizations.insert({
      projectId: projectIdFromRoot(dataDir),
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'the user approved running the test command once',
      scope: { ...SCOPE, operations: ['bash'] },
      operations: ['bash'],
      acceptedAt: new Date(clock).toISOString(),
    });
    const requested = service.requestPermission({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'bash',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      expiresAt: expiresAt(),
      limits: { maxDurationSec: 60 },
    });
    const approved = service.approvePermission({
      decisionId: requested.decisionId,
      operation: 'bash',
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      expiresAt: expiresAt(),
      limits: { maxDurationSec: 60 },
    });
    expect(approved.state).toBe('accepted');
    expect(approved.grant?.scope).toBe('once');
    expect(approved.grant?.runId).toBe(RUN_ID);
    expect(approved.grant?.toolOperationId).toBe(OP_ID);
    expect(approved.grant?.inputHash).toBe(HASH);
    expect(approved.grant?.decisionId).toBe(requested.decisionId);
    expect(store.works.find(WORK_ID)?.blockerIds).not.toContain(requested.decisionId);
    expect(() =>
      service.approvePermission({
        decisionId: requested.decisionId,
        operation: 'bash',
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        targets: [],
        toolOperationId: OP_ID,
        inputHash: HASH,
        expiresAt: expiresAt(),
      }),
    ).toThrowError(ProtocolError);
  });

  it('denies without minting and lifts the blocker', () => {
    const requested = service.requestPermission({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'bash',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      expiresAt: expiresAt(),
    });
    const denied = service.denyPermission(requested.decisionId);
    expect(denied.state).toBe('rejected');
    expect(denied.grant).toBeUndefined();
    expect(store.works.find(WORK_ID)?.blockerIds).not.toContain(requested.decisionId);
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
  });

  it('revokes the Run Grants so a later call is refused', () => {
    const minted = service.ensureRunGrants({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      expiresAt: expiresAt(),
    });
    expect(minted.grants.length).toBeGreaterThan(0);
    expect(service.revokeRun(RUN_ID, 'attempt ended')).toBe(minted.grants.length);
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
    expect(
      grants.findGrantFor({
        workId: WORK_ID,
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        operation: 'read',
        targets: ['src/a.ts'],
        at: new Date(clock).toISOString(),
      }),
    ).toBeUndefined();
  });

  it('names the operations that are approved per occurrence (Q-T3-3)', () => {
    for (const operation of ['bash', 'network', 'secret', 'push', 'deploy', 'delete_data']) {
      expect(requiresPerOccurrenceApproval(operation)).toBe(true);
    }
    for (const operation of ['read', 'search', 'edit', 'write', 'artifact_write', 'git']) {
      expect(requiresPerOccurrenceApproval(operation)).toBe(false);
    }
  });

  it('refuses a permission request that does not name its tool operation', () => {
    expect(() =>
      service.requestPermission({
        workId: WORK_ID,
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        operation: 'bash',
        targets: [],
        toolOperationId: '',
        inputHash: HASH,
        expiresAt: expiresAt(),
      }),
    ).toThrowError(ProtocolError);
  });
});
