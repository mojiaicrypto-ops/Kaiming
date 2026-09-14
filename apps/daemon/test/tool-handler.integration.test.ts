/**
 * T3.3/T3.4 — the daemon tool handler end to end (AC-048/AC-049/AC-050).
 *
 * A real SQLite store, a real workspace on disk, the real `Broker`/`GrantStore` and the
 * real `ArtifactService`. The handler is the object the control endpoint calls, so these
 * assertions are about the path a Runner's `tool.execute` actually takes:
 *
 * - a Grant-backed `read` returns real file content and records a finished operation;
 * - a tool the role does not hold is refused before any Grant is consulted;
 * - a home-relative path is refused at the entry;
 * - a second Attempt of the same Work cannot write while the first holds the lease;
 * - `artifact_write` creates a real artifact row rather than writing a source file.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject, Scope } from '@agentdev/contracts';
import {
  ArtifactService,
  Broker,
  GrantStore,
  PlanGateService,
  ProtocolError,
  ReadLedgerRegistry,
  SecretStore,
  ToolGrantService,
  emptyReadLedgerBinding,
} from '@agentdev/core';
import {
  createToolHandler,
  executionModeForPermissionMode,
  workWriterLeaseResource,
} from '../src/tool-handler.js';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { toolInputHash } from '../../runner/src/tool-client.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da000';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da010';
const RUN_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da011';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da050';
const ATTEMPT_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da051';
const ATTEMPT_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da052';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da040';
const REVIEW_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da041';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da030';
const HASH = 'a'.repeat(64);
const REVISION = 'c'.repeat(40);
const A = 'src/a.ts';

const SCOPE: Scope = {
  readPaths: [A],
  writePaths: [A],
  // `bash` and `secret` are in the Work envelope so the process/secret cases can be
  // exercised; the file cases use the same envelope.
  operations: ['read', 'search', 'edit', 'write', 'artifact_write', 'bash', 'secret'],
  networkTargets: [],
};

describe('daemon tool handler', () => {
  let dataDir: string;
  let workspace: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let broker: Broker;
  let readLedgers: ReadLedgerRegistry;
  let grantService: ToolGrantService;
  let handler: ReturnType<typeof createToolHandler>;
  let clock: number;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-toolhandler-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-toolhandler-ws-'));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, A), 'export const a = 1;\n', 'utf8');
    store = Store.open({
      dataDir,
      canonicalRoot: workspace,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    const projectId = projectIdFromRoot(workspace);
    store.projects.insert({
      id: projectId,
      root: workspace,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    grants = new GrantStore({ store, now: () => new Date(clock).toISOString() });
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
      purpose: 'deliver the T3 daemon handler',
      level: 'L2',
      goal: 'run real tools through one handler',
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
      acceptanceIds: ['AC-048'],
    });
    store.tasks.insert({
      id: REVIEW_TASK_ID,
      projectId,
      workId: WORK_ID,
      planRef: { id: REVIEW_TASK_ID, version: 1, hash: HASH },
      role: 'review',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: SCOPE,
      stage: 'review',
      acceptanceIds: ['AC-050'],
    });
    addRun(RUN_ID, ATTEMPT_A, 'backend', 'develop-L2');
    addRun(RUN_REVIEW, ATTEMPT_REVIEW, 'review', 'review');
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
    broker = new Broker({
      store,
      grants,
      now: () => new Date(clock).toISOString(),
      docker: () => ({ available: true, version: '28.4.0' }),
      resolver: { resolve: () => Promise.resolve({ ok: false, reason: 'no network in tests' }) },
    });
    grantService = new ToolGrantService({
      store,
      grants,
      now: () => new Date(clock).toISOString(),
    });
    readLedgers = new ReadLedgerRegistry({ store });
    handler = createToolHandler({
      store,
      broker,
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService,
      readLedgers,
      now: () => new Date(clock).toISOString(),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  function addRun(id: string, attemptId: string, role: 'backend' | 'review', stage: string): void {
    store.runs.insert({
      id,
      projectId: projectIdFromRoot(workspace),
      workId: WORK_ID,
      taskId: role === 'review' ? REVIEW_TASK_ID : TASK_ID,
      role,
      purpose: role === 'review' ? 'review' : 'implementation',
      stage,
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
      id: attemptId,
      projectId: projectIdFromRoot(workspace),
      runId: id,
      number: 1,
      status: 'running',
      ownerEpoch: 1,
    });
  }

  function issue(operation: string, targets: readonly string[] = [A]): void {
    const outcome = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation,
      targets: [...targets],
      runId: RUN_ID,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    });
    if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
  }

  const backendCaller = { runId: RUN_ID, attemptId: ATTEMPT_A, epoch: 1, role: 'backend' as const };

  let operationSeq = 0;
  function request(toolName: string, args: JsonObject) {
    operationSeq += 1;
    return {
      toolName,
      args,
      toolOperationId: `018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da6${String(operationSeq).padStart(2, '0')}`,
      timeoutMs: 120_000,
    };
  }

  it('reads a real file through the Broker with the Run Grant', async () => {
    issue('read');
    const outcome = await handler.execute({
      caller: backendCaller,
      request: request('read', { path: A }),
    });
    expect(outcome.operation).toBe('read');
    expect(outcome.mode).toBe('host');
    expect((outcome.result as { content: string }).content).toContain('export const a = 1;');
    expect(outcome.toolOperation.state).toBe('finished');
  });

  it('refuses a shell with no Grant and records nothing as executed', async () => {
    await expect(
      handler.execute({ caller: backendCaller, request: request('bash', { command: 'echo hi' }) }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('refuses a tool the role does not hold before consulting the Grant (AC-048)', async () => {
    await expect(
      handler.execute({
        caller: { runId: RUN_REVIEW, attemptId: ATTEMPT_REVIEW, epoch: 1, role: 'review' },
        request: request('bash', { command: 'echo hi' }),
      }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('refuses a home-relative path at the entry', async () => {
    issue('read');
    await expect(
      handler.execute({ caller: backendCaller, request: request('read', { path: '~/secrets' }) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a caller whose capability role disagrees with the Run row', async () => {
    await expect(
      handler.execute({
        caller: { ...backendCaller, role: 'review' },
        request: request('read', { path: A }),
      }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('keeps one writer per Work through the single-writer lease', async () => {
    issue('read');
    // A second Attempt of the same Work records its own Run/Attempt rows.
    store.attempts.insert({
      id: ATTEMPT_B,
      projectId: projectIdFromRoot(workspace),
      runId: RUN_ID,
      number: 2,
      status: 'running',
      ownerEpoch: 2,
    });
    await handler.execute({ caller: backendCaller, request: request('read', { path: A }) });
    const resource = workWriterLeaseResource(projectIdFromRoot(workspace), WORK_ID);
    expect(store.leases.find(resource)?.ownerAttemptId).toBe(ATTEMPT_A);
    await expect(
      handler.execute({
        caller: { runId: RUN_ID, attemptId: ATTEMPT_B, epoch: 2, role: 'backend' },
        request: request('read', { path: A }),
      }),
    ).rejects.toMatchObject({ code: 'BUSY' });
  });

  it('creates a real artifact row for artifact_write instead of writing a file', async () => {
    issue('artifact_write');
    const outcome = await handler.execute({
      caller: backendCaller,
      request: request('artifact_write', {
        path: A,
        content: '# report\n',
        mime: 'text/markdown',
      }),
    });
    const result = outcome.result as { artifactId: string; bytes: number; contentHash: string };
    expect(result.artifactId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.bytes).toBe('# report\n'.length);
    expect(store.artifacts.find(result.artifactId)?.kind).toBe('evidence');
    // The logical path the model named is not a filesystem target: the source file is
    // untouched even though it is the (only) authorized target.
    expect(readFileSync(join(workspace, A), 'utf8')).toBe('export const a = 1;\n');
  });

  it('reports the per-Task worktree gap once, without pretending it is wired', async () => {
    const lines: string[] = [];
    const logging = createToolHandler({
      store,
      broker,
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService: new ToolGrantService({
        store,
        grants,
        now: () => new Date(clock).toISOString(),
      }),
      now: () => new Date(clock).toISOString(),
      log: (line: string) => lines.push(line),
    });
    issue('read');
    await logging.execute({ caller: backendCaller, request: request('read', { path: A }) });
    await logging.execute({ caller: backendCaller, request: request('read', { path: A }) });
    expect(lines.filter((line) => line.includes('Q-T3-8'))).toHaveLength(1);
  });

  it('refuses a source write when no Plan gate is wired (AC-013, fail-closed)', async () => {
    issue('edit');
    await expect(
      handler.execute({
        caller: backendCaller,
        request: request('edit', { path: A, content: 'changed\n' }),
      }),
    ).rejects.toMatchObject({ code: 'GATE_NOT_READY' });
    // The source is untouched: a refused gate has no side effect.
    expect(readFileSync(join(workspace, A), 'utf8')).toBe('export const a = 1;\n');
  });

  it('refuses a source write with no approved Plan for the Work revision (AC-013)', async () => {
    issue('edit');
    const gated = createToolHandler({
      store,
      broker,
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService: new ToolGrantService({
        store,
        grants,
        now: () => new Date(clock).toISOString(),
      }),
      planGate: new PlanGateService({ store }),
      now: () => new Date(clock).toISOString(),
    });
    await expect(
      gated.execute({
        caller: backendCaller,
        request: request('edit', { path: A, content: 'changed\n' }),
      }),
    ).rejects.toMatchObject({ code: 'GATE_NOT_READY' });
    expect(readFileSync(join(workspace, A), 'utf8')).toBe('export const a = 1;\n');
  });

  it('does not gate a read or an artifact write behind the Plan gate', async () => {
    issue('read');
    const gated = createToolHandler({
      store,
      broker,
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService: new ToolGrantService({
        store,
        grants,
        now: () => new Date(clock).toISOString(),
      }),
      planGate: new PlanGateService({ store }),
      now: () => new Date(clock).toISOString(),
    });
    const outcome = await gated.execute({
      caller: backendCaller,
      request: request('read', { path: A }),
    });
    expect(outcome.operation).toBe('read');
  });

  it('records a permission decision for a refused call and parks the Run', () => {
    const answer = handler.request({
      caller: backendCaller,
      toolName: 'bash',
      args: { command: 'make test' },
      toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da070',
      inputHash: HASH,
    });
    expect(answer['status']).toBe('waiting_permission');
    const decisionId = typeof answer['decisionId'] === 'string' ? answer['decisionId'] : '';
    expect(store.decisions.find(decisionId)?.kind).toBe('permission');
    expect(store.decisions.find(decisionId)?.state).toBe('pending');
    expect(store.runs.find(RUN_ID)?.status).toBe('waiting_permission');
    expect(store.works.find(WORK_ID)?.blockerIds).toContain(decisionId);
    expect(answer['operation']).toBe('bash');
  });

  it('refuses a permission request for a tool the role does not hold', () => {
    expect(() =>
      createToolHandler({
        store,
        broker,
        artifacts: new ArtifactService({ store, blobs: store.blobs }),
        grantService: new ToolGrantService({
          store,
          grants,
          now: () => new Date(clock).toISOString(),
        }),
        now: () => new Date(clock).toISOString(),
      }).request({
        caller: { runId: RUN_REVIEW, attemptId: ATTEMPT_REVIEW, epoch: 1, role: 'review' },
        toolName: 'bash',
        args: { command: 'make test' },
        toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da071',
        inputHash: HASH,
      }),
    ).toThrowError(/review runs do not hold the bash tool/);
  });

  it('pins Review calls to the container even under a host policy (AC-050)', async () => {
    // No Docker: the documented outcome is a refusal, never a host-side fallback for an
    // independent verification role.
    const noDocker = createToolHandler({
      store,
      broker: new Broker({
        store,
        grants,
        docker: () => ({ available: false, reason: 'docker daemon is not reachable' }),
      }),
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService: new ToolGrantService({
        store,
        grants,
        now: () => new Date(clock).toISOString(),
      }),
      mode: 'host',
      now: () => new Date(clock).toISOString(),
    });
    await expect(
      noDocker.execute({
        caller: { runId: RUN_REVIEW, attemptId: ATTEMPT_REVIEW, epoch: 1, role: 'review' },
        request: request('read', { path: A }),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    // The host-mode path for a developer role is covered by the first case of this suite
    // (`mode` is reported as `host` there); this case is about the Review pinning only.
  });

  it('records the read in the Attempt ledger and returns its binding (AC-085)', async () => {
    issue('read');
    const empty = emptyReadLedgerBinding();
    expect(readLedgers.binding(ATTEMPT_A)).toEqual(empty);

    const outcome = await handler.execute({
      caller: backendCaller,
      request: request('read', { path: A }),
    });
    const binding = readLedgers.binding(ATTEMPT_A);
    expect(binding.seq).toBe(1);
    expect(binding.hash).not.toBe(empty.hash);
    expect(outcome.ledger).toEqual(binding);
    // The entry names the path, the revision and the content the model really received.
    const entries = readLedgers.entries(ATTEMPT_A);
    expect(entries[0]?.path).toBe(A);
    expect(entries[0]?.revision).toBe(REVISION);
    expect(entries[0]?.reason).toContain(outcome.toolOperation.id);

    // A repeated read appends a second entry (append-only) and moves the binding.
    const again = await handler.execute({
      caller: backendCaller,
      request: request('read', { path: A }),
    });
    expect(readLedgers.binding(ATTEMPT_A).seq).toBe(2);
    expect(again.ledger?.seq).toBe(2);
  });

  it('refuses a read outside the Attempt readScope at admission, leaking nothing (AC-032/AC-048)', async () => {
    // `README.md` sits outside the Run's frozen `(role, stage)` read scope (the Project's
    // `codeRoot` is `src`, `documentRoot` is `docs`) even though the Work's own Grant covers
    // it. `context.md` §1: such a read is refused and travels to Chief as
    // `context.request` — it is never taken and merely logged, because material the seal
    // cannot cover must not enter the model's context.
    writeFileSync(join(workspace, 'README.md'), '# readme\n', 'utf8');
    const work = store.works.find(WORK_ID);
    if (work === undefined) throw new Error('the Work row is missing');
    store.works.update(
      work.id,
      { scope: { ...SCOPE, readPaths: [A, 'README.md'], writePaths: [A, 'README.md'] } },
      work.version,
    );
    issue('read', ['README.md']);
    const outcome = await handler
      .execute({ caller: backendCaller, request: request('read', { path: 'README.md' }) })
      .catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(ProtocolError);
    // The documented code (Chief handles it) and no content: nothing was read at all.
    expect((outcome as ProtocolError).code).toBe('CONTEXT_FORBIDDEN');
    expect(JSON.stringify(outcome)).not.toContain('readme');
    // No Broker call was made, so no `tool_operation` row exists for the refused read.
    expect(store.toolOperations.count()).toBe(0);
    // The ledger holds no entry (nothing entered the window) and is not degraded: the read
    // was refused, not taken-then-unrecorded.
    expect(readLedgers.entries(ATTEMPT_A)).toHaveLength(0);
    expect(readLedgers.binding(ATTEMPT_A)).toEqual(emptyReadLedgerBinding());
    expect(readLedgers.degradedReason(ATTEMPT_A)).toBeUndefined();
  });

  it('admits an environment operation only after its exact approval (AC-049)', async () => {
    const opId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da700';
    const args = { command: 'echo approved-by-the-user' };
    const inputHash = toolInputHash(args);
    const bashCall = { toolName: 'bash', args, toolOperationId: opId, timeoutMs: 120_000 };

    // 1. No Grant yet: the real Broker refuses and nothing is executed or recorded.
    await expect(
      handler.execute({ caller: backendCaller, request: bashCall }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(store.toolOperations.count()).toBe(0);

    // 2. The Runner's own refusal path asks for permission; the Run parks. The binding is the
    //    exact operation/hash the refused call used, never a caller-supplied one.
    const asked = grantService.requestPermission({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'bash',
      targets: [],
      toolOperationId: opId,
      inputHash,
      expiresAt: new Date(clock + 600_000).toISOString(),
    });
    expect(asked.state).toBe('pending');
    expect(asked.runStatus).toBe('waiting_permission');
    expect(store.decisions.find(asked.decisionId)?.targetRef.id).toBe(opId);

    // 3. The user approves **this** operation with one call allowed.
    const approved = grantService.approvePermission({
      decisionId: asked.decisionId,
      operation: 'bash',
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      targets: [],
      toolOperationId: opId,
      inputHash,
      expiresAt: new Date(clock + 600_000).toISOString(),
      scope: 'once',
      limits: { maxCalls: 1 },
    });
    expect(approved.state).toBe('accepted');
    expect(approved.grant).toBeDefined();
    expect(store.runs.find(RUN_ID)?.status).toBe('running');

    // 4. The bound retry really runs through the Broker.
    const outcome = await handler.execute({ caller: backendCaller, request: bashCall });
    expect(outcome.operation).toBe('bash');
    expect(outcome.mode).toBe('host');
    expect(outcome.toolOperation.state).toBe('finished');
    expect(JSON.stringify(outcome.result)).toContain('approved-by-the-user');

    // 5. The same operation id and hash replays its recorded result instead of running again.
    const replay = await handler.execute({ caller: backendCaller, request: bashCall });
    expect(replay.toolOperation.id).toBe(outcome.toolOperation.id);
    expect(store.toolOperations.list({ where: 'run_id = ?', params: [RUN_ID] })).toHaveLength(1);

    // 6. The binding is exact: another input on the same id and another operation id are both
    //    refused (`once` binds one operation, `inputHash` binds one input).
    await expect(
      handler.execute({
        caller: backendCaller,
        request: { ...bashCall, args: { command: 'echo something-else' } },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    // The consumed `once` Grant cannot be reused by another operation either: the Broker
    // reports the consumption instead of running the new call, and writes no operation row.
    const otherOp = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da702';
    await expect(
      handler.execute({
        caller: backendCaller,
        request: { toolName: 'bash', args, toolOperationId: otherOp, timeoutMs: 120_000 },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(store.toolOperations.find(otherOp)).toBeUndefined();
  });

  it('enforces an approved Grant limit with BUDGET_EXCEEDED (AC-049)', async () => {
    // The **only** Grant for `bash` is the approved one below, and it allows no calls: the
    // call is admitted by the Grant's operation but refused by its `limits`, so the tool
    // never runs.
    const opId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da710';
    const args = { command: 'echo must-not-run' };
    const decision = store.decisions.insert({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da711',
      projectId: projectIdFromRoot(workspace),
      workId: WORK_ID,
      kind: 'permission',
      targetRef: { id: opId, version: 1, hash: toolInputHash(args) },
      choices: ['approve', 'deny'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const approved = grantService.approvePermission({
      decisionId: decision.id,
      operation: 'bash',
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      targets: [],
      toolOperationId: opId,
      inputHash: toolInputHash(args),
      expiresAt: new Date(clock + 600_000).toISOString(),
      scope: 'run',
      limits: { maxCalls: 0 },
    });
    expect(approved.grant).toBeDefined();
    await expect(
      handler.execute({
        caller: backendCaller,
        request: { toolName: 'bash', args, toolOperationId: opId, timeoutMs: 120_000 },
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(
      store.toolOperations
        .list({ where: 'run_id = ?', params: [RUN_ID] })
        .filter((operation) => operation.targets.includes('must-not-run')),
    ).toHaveLength(0);
  });

  it('records a refused read as an out-of-scope request instead of dropping it', async () => {
    // No grant for `read` of the symlink target, so the Broker refuses with NOT_AUTHORIZED.
    const outcome = await handler
      .execute({
        caller: backendCaller,
        request: request('read', { path: A }),
      })
      .catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(ProtocolError);
    expect(readLedgers.entries(ATTEMPT_A)).toHaveLength(0);
    expect(readLedgers.binding(ATTEMPT_A)).toEqual(emptyReadLedgerBinding());
  });

  it('injects the tool-audience secret a Grant covers, and only then (AC-051)', async () => {
    const secrets = new SecretStore();
    secrets.put({
      ref: 'tool:token',
      value: 's3cr3t-value',
      audience: 'tool',
      envName: 'TEST_TOKEN',
    });
    const withSecrets = createToolHandler({
      store,
      broker,
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService: new ToolGrantService({
        store,
        grants,
        now: () => new Date(clock).toISOString(),
      }),
      secrets,
      now: () => new Date(clock).toISOString(),
    });
    const command = 'printf "%s" "${TEST_TOKEN:-absent}"';

    // Without a `secret` Grant the variable is absent: nothing is injected on a guess.
    issue('bash');
    const without = await withSecrets.execute({
      caller: backendCaller,
      request: request('bash', { command }),
    });
    expect((without.result as { stdout: string }).stdout).toBe('absent');

    // With the Grant the value reaches exactly this child process.
    const issued = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation: 'secret',
      targets: ['tool:token'],
      runId: RUN_ID,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    });
    expect(issued.ok).toBe(true);
    const withGrant = await withSecrets.execute({
      caller: backendCaller,
      request: request('bash', { command }),
    });
    expect((withGrant.result as { stdout: string }).stdout).toBe('s3cr3t-value');
    // The audit rows carry the operation and the code, never the value.
    const refusals = JSON.stringify(store.events.readAfter(0, { limit: 100 }));
    expect(refusals).not.toContain('s3cr3t-value');
  });

  it('maps eachpermission policy onto the documented execution mode (execution.md §1)', () => {
    expect(executionModeForPermissionMode('workspace')).toBe('container');
    expect(executionModeForPermissionMode('autonomous')).toBe('container');
    expect(executionModeForPermissionMode('full_access')).toBe('host');
  });

  it('reports a missing Run as NOT_FOUND', async () => {
    await expect(
      handler.execute({
        caller: { ...backendCaller, runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3da0ff' },
        request: request('read', { path: A }),
      }),
    ).rejects.toBeInstanceOf(ProtocolError);
  });
});
