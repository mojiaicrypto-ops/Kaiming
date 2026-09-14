/**
 * T3.4/S3 — the permission chain over the real workbench protocol (AC-049/AC-080).
 *
 * A real `WorkbenchProtocol` over a real SQLite store, with the real `ToolGrantService` +
 * `GrantStore` attached through `attachToolBridge`. The assertions are about what the
 * protocol layer really does for `permission.request`/`permission.respond`:
 *
 * - the request must name a **real** `tool_operation` of the same Run, and the recorded
 *   `inputHash` is what the eventual Grant binds to (the caller cannot substitute one);
 * - the request parks the Run in `waiting_permission` and attaches a blocker to the Work;
 * - an approval mints the `once` Grant, emits `permission.resolved` and returns the Run to
 *   `running`; a denial mints nothing and does the same;
 * - the web Inbox's existing `decision.resolve` button routes a permission decision
 *   through the same path, so approving from the UI is not a second implementation.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject, Scope } from '@agentdev/contracts';
import { userIdFromSubject } from '@agentdev/core';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import {
  ArtifactService,
  AttachmentService,
  DownloadTokenStore,
  EventHub,
  GrantStore,
  PERMISSION_EVENTS,
  ToolGrantService,
} from '@agentdev/core';
import { scanEvents } from '../../../packages/core/src/events.js';
import { WorkbenchProtocol } from '../src/protocol.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc000';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc010';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc050';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc040';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc030';
const OP_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc060';
const A = 'src/a.ts';
const HASH = 'a'.repeat(64);
const REVISION = 'c'.repeat(40);

const SCOPE: Scope = {
  readPaths: [A],
  writePaths: [A],
  operations: ['read', 'search', 'edit', 'write', 'artifact_write'],
  networkTargets: [],
};

const caller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief' as const,
};

describe('permission.request / permission.respond over the workbench protocol', () => {
  let dataDir: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let grantService: ToolGrantService;
  let protocol: WorkbenchProtocol;
  let clock: number;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-perm-proto-'));
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
    const blobs = new BlobStore({ root: dataDir });
    grants = new GrantStore({ store, now: () => new Date(clock).toISOString() });
    grantService = new ToolGrantService({
      store,
      grants,
      now: () => new Date(clock).toISOString(),
    });
    protocol = new WorkbenchProtocol({
      store,
      blobs,
      events: new EventHub({ store }),
      attachments: new AttachmentService({ store, blobs }),
      artifacts: new ArtifactService({ store, blobs }),
      tokens: new DownloadTokenStore(),
      version: '0.0.0-test',
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
      goal: 'approve an environment operation',
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
      ownerEpoch: 0,
    });
    store.decisions.insert({
      id: DECISION_ID,
      projectId,
      workId: WORK_ID,
      kind: 'permission',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['approve', 'deny'],
      state: 'accepted',
      choice: 'approve',
      actor: 'user',
      effectRefs: [],
    });
    // The refused `bash` call the permission request is about: the protocol resolves the
    // real binding from this row, never from the request body.
    store.toolOperations.insert({
      id: OP_ID,
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      toolName: 'bash',
      inputHash: HASH,
      argsRef: OP_ID,
      targets: [],
      state: 'finished',
    });
    protocol.attachToolBridge({
      requestPermission: (input) => {
        const decided = grantService.requestPermission(input);
        return {
          decisionId: decided.decisionId,
          version: decided.version,
          state: decided.state,
          blockerAttached: decided.blockerAttached,
          ...(decided.runStatus === undefined ? {} : { runStatus: decided.runStatus }),
        };
      },
      respondPermission: (input) => {
        if (input.choice === 'deny') {
          const denied = grantService.denyPermission(input.decisionId, input.runId, input.reason);
          return {
            decisionId: denied.decisionId,
            version: denied.version,
            state: denied.state,
            blockerAttached: denied.blockerAttached,
            ...(denied.runStatus === undefined ? {} : { runStatus: denied.runStatus }),
          };
        }
        const approved = grantService.approvePermission({
          decisionId: input.decisionId,
          operation: input.operation,
          runId: input.runId,
          role: input.role,
          stage: input.stage,
          targets: input.targets,
          toolOperationId: input.toolOperationId,
          inputHash: input.inputHash,
          expiresAt: input.expiresAt,
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.limits === undefined ? {} : { limits: input.limits }),
        });
        return {
          decisionId: approved.decisionId,
          version: approved.version,
          state: approved.state,
          blockerAttached: approved.blockerAttached,
          ...(approved.grant === undefined ? {} : { grantId: approved.grant.id }),
          ...(approved.runStatus === undefined ? {} : { runStatus: approved.runStatus }),
        };
      },
      cleanupRun: (runId) => {
        const attempts = store.attempts.list({ where: 'run_id = ?', params: [runId] });
        return { killed: attempts.length, revoked: grantService.revokeRun(runId, 'cancelled') };
      },
    });
    // The Work's envelope gains `bash` through an authorization row, exactly as a user
    // approval would (`D-T3-5`).
    store.authorizations.insert({
      projectId,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'the user approved running the test command',
      scope: { ...SCOPE, operations: ['bash'] },
      operations: ['bash'],
      acceptedAt: new Date(clock).toISOString(),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** A JSON member read as text; a non-string is the empty string, never "[object Object]". */
  function textOf(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  function dispatch(method: string, params: JsonObject): JsonObject {
    return protocol.dispatch(method, params, { caller }) as JsonObject;
  }

  function requestBash(overrides: JsonObject = {}): JsonObject {
    return dispatch('permission.request', {
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'bash',
      targets: [],
      toolOperationId: OP_ID,
      inputHash: HASH,
      scope: 'once',
      expiry: new Date(clock + 3_600_000).toISOString(),
      ...overrides,
    });
  }

  it('records the decision, parks the Run and attaches the Work blocker', () => {
    const answer = requestBash();
    expect(answer['status']).toBe('accepted');
    expect(textOf(answer['decisionId'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(answer['runStatus']).toBe('waiting_permission');
    expect(answer['blockerAttached']).toBe(true);
    const decisionId = textOf(answer['decisionId']);
    expect(store.decisions.find(decisionId)?.state).toBe('pending');
    expect(store.works.find(WORK_ID)?.blockerIds).toContain(decisionId);
    expect(store.runs.find(RUN_ID)?.status).toBe('waiting_permission');
    expect(
      scanEvents(store, { names: ['decision.created'] }).some(
        (event) => event.entityId === decisionId,
      ),
    ).toBe(true);
  });

  it('approves into a bound once Grant and emits permission.resolved', () => {
    const requested = requestBash();
    const decisionId = textOf(requested['decisionId']);
    const answer = dispatch('permission.respond', { decisionId, choice: 'approve' });
    expect(answer['status']).toBe('applied');
    expect(answer['state']).toBe('accepted');
    expect(answer['runStatus']).toBe('running');
    const granted = grants.currentRunGrants(RUN_ID);
    expect(granted).toHaveLength(1);
    expect(granted[0]?.operation).toBe('bash');
    expect(granted[0]?.scope).toBe('once');
    expect(granted[0]?.toolOperationId).toBe(OP_ID);
    expect(granted[0]?.inputHash).toBe(HASH);
    expect(granted[0]?.decisionId).toBe(decisionId);
    expect(answer['grantId']).toBe(granted[0]?.id);
    expect(store.works.find(WORK_ID)?.blockerIds).not.toContain(decisionId);
    expect(store.runs.find(RUN_ID)?.status).toBe('running');
    expect(scanEvents(store, { names: [PERMISSION_EVENTS.resolved] })).toHaveLength(1);
  });

  it('routes the Inbox decision.resolve button through the same approval', () => {
    const requested = requestBash();
    const decisionId = textOf(requested['decisionId']);
    const answer = dispatch('decision.resolve', {
      decisionId,
      choice: 'approve',
      targetVersion: 1,
    });
    expect(answer['status']).toBe('applied');
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(1);
    expect(scanEvents(store, { names: [PERMISSION_EVENTS.resolved] })).toHaveLength(1);
    // Answering again with the same choice is idempotent, not a second Grant.
    const again = dispatch('permission.respond', { decisionId, choice: 'approve' });
    expect(again['idempotent']).toBe(true);
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(1);
  });

  it('denies without minting, resumes the Run and records the refusal', () => {
    const requested = requestBash();
    const decisionId = textOf(requested['decisionId']);
    const answer = dispatch('permission.respond', { decisionId, choice: 'deny' });
    expect(answer['state']).toBe('rejected');
    expect(answer['runStatus']).toBe('running');
    expect(answer['grantId']).toBeUndefined();
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
    expect(store.runs.find(RUN_ID)?.status).toBe('running');
    expect(store.works.find(WORK_ID)?.blockerIds).not.toContain(decisionId);
    expect(scanEvents(store, { names: [PERMISSION_EVENTS.resolved] })).toHaveLength(1);
  });

  it('records the denial reason on the durable permission.resolved event (protocol.md §4)', () => {
    const requested = requestBash();
    const decisionId = textOf(requested['decisionId']);
    const answer = dispatch('permission.respond', {
      decisionId,
      choice: 'deny',
      reason: 'the operator does not allow this command',
    });
    expect(answer['reason']).toBe('the operator does not allow this command');
    const event = scanEvents(store, { names: [PERMISSION_EVENTS.resolved] }).at(-1);
    expect(event?.data['choice']).toBe('deny');
    expect(event?.data['reason']).toBe('the operator does not allow this command');

    // An approval carries no reason, and an omitted reason is not persisted as null.
    const second = requestBash();
    const approved = dispatch('permission.respond', {
      decisionId: textOf(second['decisionId']),
      choice: 'approve',
    });
    expect(approved['reason']).toBeUndefined();
  });

  it('reports the bound tool call on the Inbox so approve is never a dead button (protocol.md §4/§6)', () => {
    const requested = requestBash();
    const decisionId = textOf(requested['decisionId']);
    const inbox = dispatch('inbox', {});
    const permission = (inbox['items'] as JsonObject[]).find((item) => item['id'] === decisionId);
    expect(permission).toBeDefined();
    expect(permission?.['decisionKind']).toBe('permission');
    // The four binding fields come from the recorded `tool_operation`, the same source
    // `permission.request` and `tool.refused` use.
    expect(permission?.['operation']).toBe('bash');
    expect(permission?.['targets']).toEqual([]);
    expect(permission?.['runId']).toBe(RUN_ID);
    expect(permission?.['inputHash']).toBe(HASH);
    expect(permission?.['id']).toBe(decisionId);
    expect(permission?.['actionable']).toBe(true);
  });

  it('refuses a request that names no real tool operation or a substituted hash', () => {
    expect(() =>
      requestBash({ toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc0ff' }),
    ).toThrowError(/has not been attempted/);
    expect(() => requestBash({ inputHash: 'b'.repeat(64) })).toThrowError(
      /is not the hash recorded/,
    );
    expect(() => requestBash({ runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc0fe' })).toThrowError(
      /does not exist/,
    );
  });

  it('mints the Grant with the targets the tool operation really recorded (T3 轮 2)', () => {
    store.toolOperations.insert({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc061',
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      toolName: 'edit',
      inputHash: HASH,
      argsRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc061',
      targets: [A],
      state: 'finished',
    });
    const requested = dispatch('permission.request', {
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'edit',
      targets: [],
      toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc061',
      inputHash: HASH,
      scope: 'once',
      expiry: new Date(clock + 3_600_000).toISOString(),
    });
    const approved = dispatch('permission.respond', {
      decisionId: textOf(requested['decisionId']),
      choice: 'approve',
    });
    expect(approved['status']).toBe('applied');
    const granted = grants.currentRunGrants(RUN_ID);
    expect(granted).toHaveLength(1);
    // The recorded targets, not an empty default: the Grant admits exactly the path the
    // Broker admitted the call for.
    expect(granted[0]?.targets).toEqual([A]);
  });

  it('refuses a path-shaped permission.request with no targets before any decision exists (AC-049)', () => {
    // A path operation with no targets can never be matched by a Grant, so the request must
    // be refused **before** a Decision exists: recording one would park the Run in
    // `waiting_permission` with nothing any approval could bind (G8 ruling).
    const decisionsBefore = store.decisions.count();
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc062';
    // The call was attempted (the protocol requires a real `tool_operation`), but the
    // recorded row carries no targets, which is exactly the unusable binding.
    store.toolOperations.insert({
      id: operationId,
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      toolName: 'edit',
      inputHash: HASH,
      argsRef: operationId,
      targets: [],
      state: 'finished',
    });
    const operationsBefore = store.toolOperations.count();
    const refusal = (() => {
      try {
        dispatch('permission.request', {
          workId: WORK_ID,
          runId: RUN_ID,
          role: 'backend',
          stage: 'develop-L2',
          operation: 'edit',
          targets: [],
          toolOperationId: operationId,
          inputHash: HASH,
          scope: 'once',
          expiry: new Date(clock + 3_600_000).toISOString(),
        });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeDefined();
    expect((refusal as { code?: string }).code).toBe('VALIDATION_ERROR');
    expect(String((refusal as Error).message)).toContain('no targets');
    // No pending Decision, no moved Run, and no `tool_operation` row for the refused call.
    expect(store.decisions.count()).toBe(decisionsBefore);
    expect(
      store.decisions.list({
        where: "work_id = ? AND kind = 'permission' AND state = 'pending'",
        params: [WORK_ID],
      }),
    ).toHaveLength(0);
    expect(store.runs.find(RUN_ID)?.status).not.toBe('waiting_permission');
    // The refusal writes no row of its own: the recorded operation count does not grow.
    expect(store.toolOperations.count()).toBe(operationsBefore);
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
  });

  it('refuses to approve a path-shaped operation whose recorded binding has no targets (AC-049)', () => {
    // The other half: the Decision exists, but the recorded operation cannot supply the
    // targets a path-shaped Grant needs, so the approval is refused with a typed error
    // instead of minting a Grant that authorizes nothing.
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc063';
    store.toolOperations.insert({
      id: operationId,
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      toolName: 'edit',
      inputHash: HASH,
      argsRef: operationId,
      targets: [],
      state: 'finished',
    });
    const decision = store.decisions.insert({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dc064',
      projectId: projectIdFromRoot(dataDir),
      workId: WORK_ID,
      kind: 'permission',
      targetRef: { id: operationId, version: 1, hash: HASH },
      choices: ['approve', 'deny'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const refusal = (() => {
      try {
        dispatch('permission.respond', { decisionId: decision.id, choice: 'approve' });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeDefined();
    expect((refusal as { code?: string }).code).toBe('MISSING_CONTEXT');
    expect(String((refusal as Error).message)).toMatch(/recorded no targets/);
    expect(grants.currentRunGrants(RUN_ID)).toHaveLength(0);
    // The Decision is untouched: a refused approval resolves nothing.
    expect(store.decisions.find(decision.id)?.state).toBe('pending');
  });

  it('refuses a decision that is not a permission decision', () => {
    const other = store.decisions.insert({
      projectId: projectIdFromRoot(dataDir),
      workId: WORK_ID,
      kind: 'product',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['approve'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    expect(() =>
      dispatch('permission.respond', { decisionId: other.id, choice: 'approve' }),
    ).toThrowError(/use decision.resolve for it/);
  });

  it('refuses permission.* when no tool bridge is attached', () => {
    const bare = new WorkbenchProtocol({
      store,
      blobs: new BlobStore({ root: dataDir }),
      events: new EventHub({ store }),
      attachments: new AttachmentService({ store, blobs: new BlobStore({ root: dataDir }) }),
      artifacts: new ArtifactService({ store, blobs: new BlobStore({ root: dataDir }) }),
      tokens: new DownloadTokenStore(),
      version: '0.0.0-test',
    });
    expect(() => bare.dispatch('permission.request', { workId: WORK_ID }, { caller })).toThrowError(
      /tool bridge/,
    );
  });
});
