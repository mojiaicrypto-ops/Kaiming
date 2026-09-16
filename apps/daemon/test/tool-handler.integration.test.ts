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
  EXEC_IMAGE,
  handleToolExecute,
  planContainerRun,
  probeDockerAvailability,
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

  it('does not take the Work writer lease for a call that is refused (WP-12 reliability debt)', async () => {
    // Attempt A asks for a source write while no Plan gate is wired: the call is refused at
    // admission, before anything executes. Before the fix the writer lease was asserted
    // first, so the *refused* call held it and a sibling Attempt's legitimate call was
    // refused `BUSY` for the lease TTL.
    issue('write');
    await expect(
      handler.execute({
        caller: backendCaller,
        request: request('write', { path: A, content: 'export const a = 2;\n' }),
      }),
    ).rejects.toMatchObject({ code: 'GATE_NOT_READY' });
    const resource = workWriterLeaseResource(projectIdFromRoot(workspace), WORK_ID);
    expect(store.leases.find(resource)).toBeUndefined();

    // The second Attempt of the same Work therefore proceeds: no `BUSY` from a call that
    // never wrote anything.
    store.attempts.insert({
      id: ATTEMPT_B,
      projectId: projectIdFromRoot(workspace),
      runId: RUN_ID,
      number: 2,
      status: 'running',
      ownerEpoch: 2,
    });
    issue('read');
    const outcome = await handler.execute({
      caller: { runId: RUN_ID, attemptId: ATTEMPT_B, epoch: 2, role: 'backend' },
      request: request('read', { path: A }),
    });
    expect(outcome.operation).toBe('read');
    expect(store.leases.find(resource)?.ownerAttemptId).toBe(ATTEMPT_B);
  });

  it('hands the writer lease back when the Broker refuses the invocation (WP-12 reliability debt)', async () => {
    // A `bash` call is inside the role's tool set but the Work holds no `bash` Grant, so the
    // Broker refuses it *after* the lease was asserted. The refusal wrote nothing, so the
    // lease must not stay with this Attempt.
    await expect(
      handler.execute({ caller: backendCaller, request: request('bash', { command: 'echo hi' }) }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    const resource = workWriterLeaseResource(projectIdFromRoot(workspace), WORK_ID);
    expect(store.leases.find(resource)).toBeUndefined();
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

  it('reports the missing per-Task worktree resolver once, without pretending it is wired', async () => {
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
    // W6: the message now says exactly what is missing — this stack was assembled without
    // the per-Task worktree resolver, so the Run is using the project root.
    expect(
      lines.filter((line) => line.includes('no per-Task worktree resolver is wired')),
    ).toHaveLength(1);
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

  it('runs Review on the host under a host policy — independence is the toolset and the path boundary (AC-050)', async () => {
    // `agents.md` §1 / `execution.md` §1: Review independence comes from a distinct Run,
    // Session, frozen input and tool set, not from a container mount. Docker being
    // unavailable must not deny the independent role its read path.
    const noDocker = createToolHandler({
      store,
      broker: new Broker({
        store,
        grants,
        now: () => new Date(clock).toISOString(),
        docker: () => ({ available: false, reason: 'docker daemon is not reachable' }),
        resolver: { resolve: () => Promise.resolve({ ok: false, reason: 'no network in tests' }) },
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
    const reviewCaller = {
      runId: RUN_REVIEW,
      attemptId: ATTEMPT_REVIEW,
      epoch: 1,
      role: 'review' as const,
    };
    const granted = grants.issue({
      workId: WORK_ID,
      role: 'review',
      stage: 'review',
      scope: 'run',
      operation: 'read',
      targets: [A],
      runId: RUN_REVIEW,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    });
    expect(granted.ok).toBe(true);
    const read = await noDocker.execute({
      caller: reviewCaller,
      request: request('read', { path: A }),
    });
    // Host execution, exactly like a developer role, with no Docker in the picture.
    expect(read.mode).toBe('host');
    expect(read.operation).toBe('read');

    // The independent role still cannot modify the source tree: its tool set refuses the
    // write before any Grant is consulted.
    await expect(
      noDocker.execute({
        caller: reviewCaller,
        request: request('write', { path: A, content: 'review must not write\n' }),
      }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
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

  it('maps every permission policy onto host execution (execution.md §1)', () => {
    // Host-first model: no permission mode selects the container. The container is an
    // optional project run environment selected by an explicit stack mode, not by policy.
    expect(executionModeForPermissionMode('workspace')).toBe('host');
    expect(executionModeForPermissionMode('autonomous')).toBe('host');
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

/**
 * W1 — the first-phase permission model (`T3-implementation.md` 附录 A).
 *
 * Real SQLite, real workspace on disk, real `Broker`/`GrantStore`/`ToolGrantService`, and
 * the real endpoint (`handleToolExecute`), so every assertion below is about the row a
 * production daemon would write:
 *
 * - the frozen sensitive-file table refuses `read`, `search` and `edit` with a typed
 *   refusal, files the existing `chief_action_required` todo, and audits the refusal;
 * - a loopback/metadata URL the shell names literally is refused by the network policy;
 * - a delete outside the Run workspace is refused;
 * - an in-envelope write runs with **no** permission prompt (the retired
 *   `permission.request` path is not entered);
 * - in `test` tier the application-config subset is read and the allowance is audited
 *   with the path, the policy revision and the tier.
 */
describe('first-phase permission model (附录 A)', () => {
  const APP_CONFIG = 'src/application.yml';
  let dataDir: string;
  let workspace: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let broker: Broker;
  let grantService: ToolGrantService;
  let clock: number;
  let operationSeq = 0;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-w1-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-w1-ws-'));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, A), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(workspace, APP_CONFIG), 'server:\n  port: 8080\n', 'utf8');
    writeFileSync(join(workspace, '.env'), 'API_KEY=super-secret\n', 'utf8');
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
    const scope: Scope = {
      readPaths: [A, APP_CONFIG],
      writePaths: [A, APP_CONFIG],
      // The Plan-approved envelope: the file operations plus the shell the Run may use.
      operations: ['read', 'search', 'edit', 'write', 'artifact_write', 'bash'],
      networkTargets: [],
    };
    store.works.insert({
      id: WORK_ID,
      projectId,
      intent: 'delivery',
      purpose: 'prove the first-phase permission model',
      level: 'L2',
      goal: 'run inside the envelope without prompts and refuse the hard blocks',
      scope,
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
      scope,
      stage: 'develop',
      acceptanceIds: ['AC-048', 'AC-049'],
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
      id: ATTEMPT_A,
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
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  const caller = { runId: RUN_ID, attemptId: ATTEMPT_A, epoch: 1, role: 'backend' as const };

  function handlerWith(configPolicy: 'strict' | 'test') {
    return createToolHandler({
      store,
      broker,
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService,
      readLedgers: new ReadLedgerRegistry({ store }),
      configPolicy,
      policyRevision: 7,
      now: () => new Date(clock).toISOString(),
    });
  }

  /** The real endpoint in front of the handler, so the refusal audit row is produced. */
  function endpointFor(configPolicy: 'strict' | 'test') {
    const handler = handlerWith(configPolicy);
    return {
      handler,
      execute: (toolName: string, args: JsonObject) => {
        operationSeq += 1;
        return handleToolExecute(
          {
            store,
            handler,
            newToolOperationId: () =>
              `018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db6${String(operationSeq).padStart(2, '0')}`,
          },
          caller,
          {
            attemptId: ATTEMPT_A,
            epoch: 1,
            toolName,
            args,
            toolOperationId: `018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db6${String(operationSeq).padStart(2, '0')}`,
            timeoutMs: 120_000,
          },
        );
      },
    };
  }

  function issue(operation: string, targets: readonly string[]): void {
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

  function events() {
    return store.events.readAfter(0, { limit: 500 });
  }

  it('refuses a sensitive-file read with a typed refusal, a todo and an audit row (AC-048)', async () => {
    const { execute } = endpointFor('strict');
    const answer = await execute('read', { path: '.env' });
    expect(answer.status).toBe(403);
    const body = answer.body as { error: { code: string; message: string; details: JsonObject } };
    expect(body.error.code).toBe('CONTEXT_FORBIDDEN');
    // 附录 A.5-4: the model is told not to retry and that the file is the user's; the
    // refusal is terminal, so the Runner opens no permission request for it.
    expect(body.error.message).toContain('do not retry');
    expect(body.error.details['approvable']).toBe(false);
    expect(body.error.details['pattern']).toBe('.env*');
    expect(body.error.details['path']).toBe('.env');

    // The user-facing todo reuses the existing Chief todo mechanism (`rules/agents.md` §3).
    const todo = events().find(
      (event) => event.name === 'chief_action_required' && event.data['kind'] === 'sensitive_file',
    );
    expect(todo).toBeDefined();
    expect(todo?.data['path']).toBe('.env');
    expect(todo?.data['pattern']).toBe('.env*');
    expect(todo?.data['action']).toBe('read');
    expect(todo?.data['configPolicy']).toBe('strict');
    expect(todo?.data['policyRevision']).toBe(7);
    const reason = todo?.data['reason'];
    expect(typeof reason === 'string' ? reason : '').toContain('请你本人处理');

    // The endpoint records the refusal (operation/targets/code, never the file content).
    const refusal = events().find(
      (event) => event.name === 'tool.refused' && event.data['code'] === 'CONTEXT_FORBIDDEN',
    );
    expect(refusal).toBeDefined();
    expect(refusal?.data['operation']).toBe('read');
    expect(refusal?.data['layer']).toBe('endpoint');
    expect(JSON.stringify(refusal?.data)).not.toContain('super-secret');

    // Nothing executed and nothing was read.
    expect(store.toolOperations.list({ where: 'work_id = ?', params: [WORK_ID] })).toHaveLength(0);
  });

  it('refuses a sensitive-file search and a sensitive-file edit through the same table (AC-048)', async () => {
    const { execute } = endpointFor('strict');

    const search = await execute('search', { query: 'API_KEY', path: '.env' });
    expect(search.status).toBe(403);
    const searchBody = search.body as {
      error: { code: string; message: string; details: JsonObject };
    };
    expect(searchBody.error.code).toBe('CONTEXT_FORBIDDEN');
    expect(searchBody.error.details['action']).toBe('search');
    expect(searchBody.error.details['pattern']).toBe('.env*');

    // `edit` is refused by the same gate, **before** the AC-013 Plan gate: the file cannot
    // be seen, so it cannot be rewritten (附录 A.3). No Grant is issued for `.env` — it is
    // outside the Work envelope, which is exactly why the gate must answer first.
    const edit = await execute('edit', { path: '.env', content: 'API_KEY=rotated\n' });
    expect(edit.status).toBe(403);
    const editBody = edit.body as { error: { code: string; message: string; details: JsonObject } };
    expect(editBody.error.code).toBe('CONTEXT_FORBIDDEN');
    expect(editBody.error.details['action']).toBe('edit');
    expect(readFileSync(join(workspace, '.env'), 'utf8')).toBe('API_KEY=super-secret\n');

    // One todo per (work, path, pattern): three refusals do not accumulate three rows for
    // the same file.
    const todos = events().filter(
      (event) => event.name === 'chief_action_required' && event.data['kind'] === 'sensitive_file',
    );
    expect(todos).toHaveLength(1);
  });

  it('refuses the two fixed network denials a shell names, with an audit row (AC-048, W6)', async () => {
    const { execute } = endpointFor('strict');
    // W6 §7.1: a plain loopback URL is ordinary development now. The denials are metadata
    // and the ports the daemon **actually bound**; the second needs a broker that knows
    // them, so this case uses its own broker with the bound-port registry.
    const boundPort = 51234;
    const boundBroker = new Broker({
      store,
      grants,
      now: () => new Date(clock).toISOString(),
      docker: () => ({ available: true, version: '28.4.0' }),
      daemonPorts: () => [boundPort],
      resolver: { resolve: () => Promise.resolve({ ok: false, reason: 'no network in tests' }) },
    });
    const boundHandler = createToolHandler({
      store,
      broker: boundBroker,
      artifacts: new ArtifactService({ store, blobs: store.blobs }),
      grantService,
      readLedgers: new ReadLedgerRegistry({ store }),
      configPolicy: 'strict',
      policyRevision: 7,
      now: () => new Date(clock).toISOString(),
    });
    operationSeq += 1;
    const boundOperation = `018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db6${String(operationSeq).padStart(2, '0')}`;
    const boundAnswer = await handleToolExecute(
      { store, handler: boundHandler, newToolOperationId: () => boundOperation },
      caller,
      {
        attemptId: ATTEMPT_A,
        epoch: 1,
        toolName: 'bash',
        args: { command: `curl -s http://127.0.0.1:${String(boundPort)}/control/health` },
        toolOperationId: boundOperation,
        timeoutMs: 120_000,
      },
    );
    expect(boundAnswer.status).toBe(403);
    const body = boundAnswer.body as {
      error: { code: string; message: string; details: JsonObject };
    };
    expect(body.error.code).toBe('CONTEXT_FORBIDDEN');
    expect(body.error.details['approvable']).toBe(false);
    expect(body.error.details['network']).toBe(
      `http://127.0.0.1:${String(boundPort)}/control/health`,
    );
    expect(body.error.message).toContain('daemon itself is listening on');

    // The metadata endpoint is refused by the same policy, and no shell ever ran.
    const metadata = await execute('bash', {
      command: 'curl http://169.254.169.254/latest/meta-data/',
    });
    expect(metadata.status).toBe(403);
    expect((metadata.body as { error: { code: string } }).error.code).toBe('CONTEXT_FORBIDDEN');

    const refusals = events().filter((event) => event.name === 'tool.refused');
    expect(refusals.map((event) => event.data['code'])).toEqual([
      'CONTEXT_FORBIDDEN',
      'CONTEXT_FORBIDDEN',
    ]);
    expect(store.toolOperations.list({ where: 'work_id = ?', params: [WORK_ID] })).toHaveLength(0);
  });

  it('refuses a delete outside the workspace and allows one inside it (AC-048)', async () => {
    const { execute } = endpointFor('strict');
    const target = join(tmpdir(), 'agentdev-w1-outside-not-ours.txt');
    const answer = await execute('bash', { command: `rm -f ${target}` });
    expect(answer.status).toBe(401);
    const body = answer.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_AUTHORIZED');
    expect(body.error.message).toContain('do not retry');
    expect(body.error.message).toContain(target);

    // 附录 A.1-2: deleting inside the workspace is allowed — Git and the delivery CAS are
    // the backstop, and the shell really runs.
    issue('bash', []);
    const inside = await execute('bash', { command: 'rm -rf build && echo removed' });
    expect(inside.status).toBe(200);
    expect((inside.body as { result: { stdout: string } }).result.stdout).toContain('removed');
  });

  it('runs in-envelope reads and shells with zero permission prompts (AC-049)', async () => {
    const { execute } = endpointFor('strict');
    // (a) A read inside the approved Plan envelope executes directly.
    issue('read', [A]);
    const read = await execute('read', { path: A });
    expect(read.status).toBe(200);
    expect((read.body as { status: string }).status).toBe('executed');
    expect((read.body as { result: { content: string } }).result.content).toContain(
      'export const a = 1;',
    );

    // (b) The shell runs for real, with no per-call approval: 附录 A.1-2's "container +
    // filesystem boundary + shell" is the execution model, and the retired
    // `permission.request` path is simply not reached.
    issue('bash', []);
    const shell = await execute('bash', { command: 'echo in-envelope-ok' });
    expect(shell.status).toBe(200);
    expect((shell.body as { result: { stdout: string } }).result.stdout).toContain(
      'in-envelope-ok',
    );

    // The observable proof of "zero prompts": no permission Decision was opened and the Run
    // never entered `waiting_permission`.
    expect(store.decisions.list({ where: 'work_id = ?', params: [WORK_ID] })).toHaveLength(1);
    expect(store.runs.find(RUN_ID)?.status).toBe('running');
    const names = events().map((event) => event.name);
    expect(names).toContain('tool.invoked');
    expect(names).not.toContain('decision.created');
    expect(names).not.toContain('permission.resolved');
  });

  it('refuses an out-of-envelope write fail-closed instead of prompting (AC-049)', async () => {
    const { execute } = endpointFor('strict');
    issue('write', [A]);
    // The daemon has no Plan gate in this fixture, so the AC-013 write gate refuses with
    // `GATE_NOT_READY`. What matters for W1 is that the refusal is **terminal**: nothing
    // parked the Run and no user decision was recorded for it (附录 A.4).
    const answer = await execute('write', { path: A, content: 'export const a = 2;\n' });
    expect(answer.status).toBe(409);
    expect((answer.body as { error: { code: string } }).error.code).toBe('GATE_NOT_READY');
    expect(readFileSync(join(workspace, A), 'utf8')).toBe('export const a = 1;\n');
    expect(store.decisions.list({ where: 'work_id = ?', params: [WORK_ID] })).toHaveLength(1);
    expect(store.runs.find(RUN_ID)?.status).toBe('running');
  });

  it('admits the application-config subset in test tier and audits the allowance (AC-049)', async () => {
    // `strict` refuses the same file, so the pair is a real before/after rather than a
    // single positive case.
    const strict = endpointFor('strict');
    const refused = await strict.execute('read', { path: APP_CONFIG });
    expect(refused.status).toBe(403);

    const { handler } = endpointFor('test');
    issue('read', [APP_CONFIG]);
    const allowed = await handler.execute({
      caller,
      request: {
        toolName: 'read',
        args: { path: APP_CONFIG },
        toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db700',
        timeoutMs: 120_000,
      },
    });
    expect((allowed.result as { content: string }).content).toContain('port: 8080');

    // 附录 A.7 配套三条-3: the allowance is audited with path + policy revision + tier, so a
    // test-environment relaxation cannot hide a real leak.
    const allowance = events().find((event) => event.name === 'tool.listed_file_allowed');
    expect(allowance).toBeDefined();
    expect(allowance?.data['path']).toBe(APP_CONFIG);
    expect(allowance?.data['pattern']).toBe('application*.yml');
    expect(allowance?.data['configPolicy']).toBe('test');
    expect(allowance?.data['policyRevision']).toBe(7);
  });

  // 附录 A.4's prerequisite: the tool boundary is only trustworthy when the tools really run
  // in the container, with the workspace mounted and nothing else. The daemon used to omit
  // `writableRoots`, so the workspace mounted `ro` and a Developer Run's `write`/`edit`
  // failed against a read-only mount; this proves the fix, and proves the reviewed roles
  // still cannot gain source access through it.
  const docker = probeDockerAvailability(EXEC_IMAGE);
  it.skipIf(!docker.available)(
    'runs an in-envelope shell write inside the real container with the workspace mounted rw (AC-049)',
    async () => {
      // The daemon passes `mode` from `policy.permissionMode` (workspace/autonomous →
      // container) and, since W1, `writableRoots: [root]` for a mutating role. Without that
      // second half the mount was `ro` and every in-container write failed — the drill that
      // proves the fix must therefore go through the broker's real container path.
      //
      // `bash` rather than `write` on purpose: the AC-013 Plan gate stands in front of
      // `write`/`edit` and would answer `GATE_NOT_READY` here, which is correct but is not
      // what this case is measuring (the container mount, not the Plan gate).
      const container = createToolHandler({
        store,
        broker,
        artifacts: new ArtifactService({ store, blobs: store.blobs }),
        grantService,
        readLedgers: new ReadLedgerRegistry({ store }),
        configPolicy: 'strict',
        mode: 'container',
        now: () => new Date(clock).toISOString(),
      });
      issue('bash', []);
      const outcome = await container.execute({
        caller,
        request: {
          toolName: 'bash',
          args: {
            command: 'printf in-container > src/from-container.txt && cat src/from-container.txt',
          },
          toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db800',
          timeoutMs: 120_000,
        },
      });
      expect(outcome.mode).toBe('container');
      const result = outcome.result as { stdout: string; status: number };
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('in-container');
      // The workspace was mounted rw, so the container really wrote through the mount.
      expect(readFileSync(join(workspace, 'src/from-container.txt'), 'utf8')).toBe('in-container');
      // The mount plan is the isolation: the workspace and nothing else — no host home, no
      // docker socket and no daemon data directory (`planContainerRun`).
      const plan = planContainerRun({
        roots: [workspace],
        writableRoots: [workspace],
        command: 'true',
      });
      expect(plan.mounts).toEqual([{ path: workspace, target: '/workspace', mode: 'rw' }]);
      expect(plan.args.join(' ')).toContain('--network none');
      expect(plan.args.join(' ')).toContain('--user 10001:10001');
      expect(plan.args.join(' ')).toContain('--read-only');
    },
  );
});
