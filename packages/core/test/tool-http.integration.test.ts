/**
 * T3.2 — `tool.execute` over the **real** control endpoint (AC-048/AC-080).
 *
 * A real `node:http` endpoint, the real `Broker` + `GrantStore` against a real SQLite
 * store, a real workspace on disk (including a symlink that escapes it) and a real Grant
 * row. The handler in this test is the same composition the daemon uses — `planToolCall`
 * plus `Broker.invoke` — so the assertions are about the path a Runner's tool call takes,
 * not about a stub.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Grant, Scope, ToolOperation } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  AttemptCapabilityStore,
  Broker,
  EXEC_IMAGE,
  GrantStore,
  TOOL_EVENTS,
  createControlEndpoint,
  planToolCall,
  probeDockerAvailability,
  runReadTool,
  ToolGrantService,
  type ControlEndpoint,
  type ToolSuccess,
} from '../src/index.js';
import { scanEvents } from '../src/events.js';
import { hashToolInput } from '../src/broker.js';
import type { ToolExecuteHandler } from '../src/tool-http.js';
import { TOOL_EXECUTE_PATH } from '../src/tool-http.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db000';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db010';
const RUN_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db011';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db050';
const ATTEMPT_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db052';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db040';
const REVIEW_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db041';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db030';
const OP_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3db060';
const HASH = 'a'.repeat(64);
const REVISION = 'c'.repeat(40);
const A = 'src/a.ts';

const SCOPE: Scope = {
  readPaths: [A],
  writePaths: [A],
  // The approved coding envelope (`docs/architecture/execution.md` §2): the shell/git/network
  // surface runs unprompted inside it. The irreversible operations (`push`/`deploy`/
  // `delete_data`) stay outside and are the only ones `permission.request` still serves.
  operations: ['read', 'search', 'edit', 'write', 'artifact_write', 'bash', 'git', 'network'],
  networkTargets: [],
};

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('tool.execute over the real control endpoint (T3.2)', () => {
  let dataDir: string;
  let workspace: string;
  let outside: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let broker: Broker;
  let capabilities: AttemptCapabilityStore;
  let endpoint: ControlEndpoint;
  let projectId: string;
  let clock: number;

  beforeEach(async () => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-toolhttp-int-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-toolhttp-int-ws-'));
    outside = mkdtempSync(join(tmpdir(), 'agentdev-toolhttp-int-out-'));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, A), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(outside, 'secret.txt'), 'top-secret\n', 'utf8');
    symlinkSync(outside, join(workspace, 'link'), 'dir');

    store = Store.open({
      dataDir,
      canonicalRoot: workspace,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(workspace);
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
      purpose: 'deliver T3.2 endpoint evidence',
      level: 'L2',
      goal: 'prove the tool endpoint',
      scope: SCOPE,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      budgetId: budget.id,
      policyRevision: 1,
    });
    for (const [taskId, role, stage] of [
      [TASK_ID, 'backend', 'develop'],
      [REVIEW_TASK_ID, 'review', 'review'],
    ] as const) {
      store.tasks.insert({
        id: taskId,
        projectId,
        workId: WORK_ID,
        planRef: { id: taskId, version: 1, hash: HASH },
        role,
        dependsOn: [],
        dependencyManifestRefs: [],
        scope: SCOPE,
        stage,
        acceptanceIds: ['AC-048'],
      });
    }
    addRun(RUN_ID, ATTEMPT_ID, 'backend', 'develop-L2');
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
    capabilities = new AttemptCapabilityStore({ now: () => clock });
    endpoint = await createControlEndpoint({
      store,
      capabilities,
      handler: {
        assessmentSubmit: () => ({}),
        agentDispatch: () => ({}),
        stageSubmit: () => ({ accepted: true }),
      },
      toolExecute: buildToolHandler(),
    });
  });

  afterEach(async () => {
    await endpoint.close();
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function addRun(id: string, attemptId: string, role: 'backend' | 'review', stage: string): void {
    store.runs.insert({
      id,
      projectId,
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
      projectId,
      runId: id,
      number: 1,
      status: 'running',
      ownerEpoch: 0,
    });
  }

  /** The daemon's composition, kept here so the endpoint has a real handler. */
  function buildToolHandler(
    options: {
      readonly mode?: 'host' | 'container';
      readonly writableRoots?: readonly string[];
    } = {},
  ): ToolExecuteHandler {
    const mode = options.mode ?? 'host';
    return {
      execute: async ({ caller, request, signal }): Promise<ToolSuccess> => {
        const run = store.runs.get(caller.runId);
        const planned = planToolCall({
          toolName: request.toolName,
          args: request.args,
          cwdRoot: workspace,
          role: caller.role,
        });
        if (!planned.ok) {
          const { ProtocolError } = await import('../src/errors.js');
          throw new ProtocolError(planned.code, planned.reason);
        }
        const plan = planned.plan;
        const body =
          plan.toolName === 'read'
            ? (context: Parameters<typeof runReadTool>[0]) => runReadTool(context, request.args)
            : plan.run;
        const outcome = await broker.invoke({
          workId: run.workId,
          runId: run.id,
          attemptId: caller.attemptId,
          epoch: caller.epoch,
          role: run.role,
          stage: run.stage,
          operation: plan.operation,
          targets: plan.targets,
          input: plan.input,
          // The endpoint's operation id is the ledger key; the daemon handler passes it too.
          toolOperationId: request.toolOperationId,
          mode,
          roots: [workspace],
          ...(options.writableRoots === undefined ? {} : { writableRoots: options.writableRoots }),
          ...(body === undefined ? {} : { run: body }),
          timeoutMs: request.timeoutMs,
          ...(signal === undefined ? {} : { signal }),
        });
        if (!outcome.ok) {
          const { ProtocolError } = await import('../src/errors.js');
          throw new ProtocolError(outcome.code, outcome.reason);
        }
        return outcome;
      },
    };
  }

  function issue(operation: string, role: 'backend' | 'review' = 'backend'): Grant {
    const outcome = grants.issue({
      workId: WORK_ID,
      role,
      stage: role === 'review' ? 'review' : 'develop-L2',
      scope: 'run',
      operation,
      targets: [A],
      runId: role === 'review' ? RUN_REVIEW : RUN_ID,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    });
    if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
    return outcome.grant;
  }

  /**
   * Mints a `bash` Grant the way the product does: the user approves a pending permission
   * request, and that accepted Decision is what widens the Work envelope for exactly this
   * operation (`grants.ts` `issue`).
   */
  function approveBash(
    limits: Record<string, unknown> = {},
    binding = { toolOperationId: OP_ID, inputHash: hashToolInput({ command: 'printf hi' }) },
  ): Grant {
    const service = new ToolGrantService({
      store,
      grants,
      now: () => new Date(clock).toISOString(),
    });
    const asked = service.requestPermission({
      workId: WORK_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'bash',
      targets: [],
      toolOperationId: binding.toolOperationId,
      inputHash: binding.inputHash,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
      limits,
    });
    const approved = service.approvePermission({
      decisionId: asked.decisionId,
      operation: 'bash',
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      targets: [],
      toolOperationId: binding.toolOperationId,
      inputHash: binding.inputHash,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
      limits,
    });
    if (approved.grant === undefined) throw new Error('the approval minted no Grant');
    return approved.grant;
  }

  function tokenFor(role: 'backend' | 'review'): string {
    return capabilities.issue({
      attemptId: role === 'review' ? ATTEMPT_REVIEW : ATTEMPT_ID,
      runId: role === 'review' ? RUN_REVIEW : RUN_ID,
      epoch: 1,
      role,
    }).token;
  }

  async function post(
    token: string | undefined,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${endpoint.url}${TOOL_EXECUTE_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ attemptId: ATTEMPT_ID, epoch: 0, ...body }),
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  }

  it('reads a real file and records the audit trail', async () => {
    const grant = issue('read');
    const token = tokenFor('backend');
    const answer = await post(token, {
      toolName: 'read',
      args: { path: A },
      toolOperationId: OP_ID,
      expectedInputHash: hashToolInput({ path: A }),
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      v: 1,
      status: 'executed',
      mode: 'host',
      operation: 'read',
      toolName: 'read',
      toolOperationId: OP_ID,
      grantId: grant.id,
      resultRef: null,
      truncated: false,
    });
    expect((answer.body['result'] as { content: string }).content).toContain('export const a = 1;');
    const invoked = scanEvents(store, { names: [TOOL_EVENTS.invoked] });
    expect(invoked.length).toBe(1);
    const operation = store.toolOperations.find(OP_ID) as ToolOperation;
    expect(operation.state).toBe('finished');
    expect(operation.grantId).toBe(grant.id);
  });

  it('replays the recorded result for the same tool operation and refuses a different input', async () => {
    issue('read');
    const token = tokenFor('backend');
    const first = await post(token, {
      toolName: 'read',
      args: { path: A },
      toolOperationId: OP_ID,
      expectedInputHash: hashToolInput({ path: A }),
    });
    const second = await post(token, {
      toolName: 'read',
      args: { path: A },
      toolOperationId: OP_ID,
      expectedInputHash: hashToolInput({ path: A }),
    });
    expect(first.body['status']).toBe('executed');
    expect(second.status).toBe(200);
    expect(second.body['status']).toBe('replayed');
    expect(second.body['result']).toEqual(first.body['result']);
    // One operation row: the replay did not run the tool a second time.
    expect(store.toolOperations.list({ where: 'run_id = ?', params: [RUN_ID] })).toHaveLength(1);

    const conflict = await post(token, {
      toolName: 'read',
      args: { path: A, offset: 1 },
      toolOperationId: OP_ID,
      expectedInputHash: hashToolInput({ path: A, offset: 1 }),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('refuses a hash the Runner and Core disagree about', async () => {
    issue('read');
    const answer = await post(tokenFor('backend'), {
      toolName: 'read',
      args: { path: A },
      toolOperationId: OP_ID,
      expectedInputHash: 'b'.repeat(64),
    });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('refuses a symlink escape with NOT_AUTHORIZED and leaves the target unchanged', async () => {
    issue('read');
    const before = digest(join(outside, 'secret.txt'));
    const answer = await post(tokenFor('backend'), {
      toolName: 'read',
      args: { path: 'link/secret.txt' },
      toolOperationId: OP_ID,
    });
    expect(answer.status).toBe(401);
    expect(answer.body).toMatchObject({ error: { code: 'NOT_AUTHORIZED' } });
    expect(digest(join(outside, 'secret.txt'))).toBe(before);
    // The refusal is audited by the endpoint layer or the Broker, never silent.
    expect(scanEvents(store, { names: [TOOL_EVENTS.refused] }).length).toBeGreaterThan(0);
  });

  it('refuses a review Run writing source and leaves the file unchanged', async () => {
    issue('edit', 'review');
    const before = digest(join(workspace, A));
    const answer = await post(tokenFor('review'), {
      toolName: 'edit',
      args: { path: A, content: 'pwned\n' },
      toolOperationId: OP_ID,
    });
    expect(answer.status).toBe(401);
    expect(answer.body).toMatchObject({ error: { code: 'NOT_AUTHORIZED' } });
    expect(digest(join(workspace, A))).toBe(before);
  });

  it('refuses an unauthenticated, unknown-tool or malformed call with an audited refusal', async () => {
    issue('read');
    const unauthenticated = await post(undefined, { toolName: 'read', args: { path: A } });
    expect(unauthenticated.status).toBe(401);

    const unknown = await post(tokenFor('backend'), {
      toolName: 'rm_rf',
      args: {},
      toolOperationId: OP_ID,
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const unknownField = await post(tokenFor('backend'), {
      toolName: 'read',
      args: { path: A },
      shell: true,
      toolOperationId: OP_ID,
    });
    expect(unknownField.status).toBe(400);

    const tooLong = await post(tokenFor('backend'), {
      toolName: 'read',
      args: { path: A },
      timeoutMs: 3_600_000,
      toolOperationId: OP_ID,
    });
    expect(tooLong.status).toBe(400);

    // Every one of those refusals is in the ledger.
    expect(scanEvents(store, { names: [TOOL_EVENTS.refused] }).length).toBeGreaterThanOrEqual(3);
  });

  it('generates the tool-operation id when the Runner omits one', async () => {
    issue('read');
    const answer = await post(tokenFor('backend'), { toolName: 'read', args: { path: A } });
    expect(answer.status).toBe(200);
    expect(String(answer.body['toolOperationId'])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('answers BUDGET_EXCEEDED when a real Grant limit is exceeded over the endpoint', async () => {
    // A Grant that authorized a 30-second operation cannot be used to run a 120-second one.
    approveBash({ maxDurationSec: 30 });
    const refused = await post(tokenFor('backend'), {
      toolName: 'bash',
      args: { command: 'printf hi' },
      toolOperationId: OP_ID,
      timeoutMs: 120_000,
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: 'BUDGET_EXCEEDED' } });
    expect(String((refused.body['error'] as { message?: string }).message)).toContain(
      'maxDurationSec',
    );
    // The same Grant admits the call once the deadline fits inside it.
    const allowed = await post(tokenFor('backend'), {
      toolName: 'bash',
      args: { command: 'printf hi' },
      toolOperationId: OP_ID,
      timeoutMs: 20_000,
    });
    expect(allowed.status).toBe(200);
    expect((allowed.body['result'] as { stdout: string }).stdout).toBe('hi');
  });

  const docker = probeDockerAvailability(EXEC_IMAGE);
  it.skipIf(!docker.available)(
    'runs a shell inside the real container image with no network (T3.5)',
    async () => {
      // A second endpoint whose handler runs tools in the documented container mode, over
      // the real `agentdev/exec:0.0.0` image and a really mounted workspace.
      const containerEndpoint = await createControlEndpoint({
        store,
        capabilities,
        handler: {
          assessmentSubmit: () => ({}),
          agentDispatch: () => ({}),
          stageSubmit: () => ({ accepted: true }),
        },
        toolExecute: buildToolHandler({ mode: 'container', writableRoots: [workspace] }),
      });
      try {
        approveBash(
          { maxDurationSec: 300 },
          {
            toolOperationId: OP_ID,
            inputHash: hashToolInput({
              command:
                'printf container-wrote-this > src/from-container.txt; ' +
                'command -v curl >/dev/null && curl -s -m 2 http://example.com || echo NO_NET',
            }),
          },
        );
        const response = await fetch(`${containerEndpoint.url}${TOOL_EXECUTE_PATH}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${tokenFor('backend')}`,
          },
          body: JSON.stringify({
            attemptId: ATTEMPT_ID,
            epoch: 0,
            toolName: 'bash',
            args: {
              command:
                'printf container-wrote-this > src/from-container.txt; ' +
                'command -v curl >/dev/null && curl -s -m 2 http://example.com || echo NO_NET',
            },
            toolOperationId: OP_ID,
            timeoutMs: 120_000,
          }),
        });
        const text = await response.text();
        expect(response.status).toBe(200);
        const body = JSON.parse(text) as { result: { stdout: string; status: number } };
        expect(body.result.status).toBe(0);
        expect(body.result.stdout).toContain('NO_NET');
        // The workspace was mounted rw, so the container really wrote through the mount.
        expect(readFileSync(join(workspace, 'src/from-container.txt'), 'utf8')).toBe(
          'container-wrote-this',
        );
      } finally {
        await containerEndpoint.close();
      }
    },
  );

  it('serves permission.request on the same capability channel (T3.4)', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const permissionEndpoint = await createControlEndpoint({
      store,
      capabilities,
      handler: {
        assessmentSubmit: () => ({}),
        agentDispatch: () => ({}),
        stageSubmit: () => ({ accepted: true }),
      },
      permissionRequest: {
        request: (input) => {
          requests.push({ ...input, callerRole: input.caller.role });
          return { status: 'waiting_permission', decisionId: OP_ID, operation: 'bash' };
        },
      },
    });
    try {
      const response = await fetch(`${permissionEndpoint.url}/control/permission.request`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokenFor('backend')}`,
        },
        body: JSON.stringify({
          attemptId: ATTEMPT_ID,
          epoch: 0,
          toolName: 'bash',
          args: { command: 'make test' },
          toolOperationId: OP_ID,
          inputHash: HASH,
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ status: 'waiting_permission', decisionId: OP_ID });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ toolName: 'bash', callerRole: 'backend' });

      // An unauthenticated call is refused before the handler sees it.
      const anonymous = await fetch(`${permissionEndpoint.url}/control/permission.request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolName: 'bash', args: {} }),
      });
      expect(anonymous.status).toBe(401);

      // An unknown body field is a validation error, not a silent extra binding.
      const unknown = await fetch(`${permissionEndpoint.url}/control/permission.request`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokenFor('backend')}`,
        },
        body: JSON.stringify({
          toolName: 'bash',
          args: {},
          toolOperationId: OP_ID,
          inputHash: HASH,
          scope: 'project',
        }),
      });
      expect(unknown.status).toBe(400);
    } finally {
      await permissionEndpoint.close();
    }
  });

  it('runs an in-envelope shell with no permission prompt and keeps the once binding exact (AC-049/AC-080)', async () => {
    // Host-first model (`execution.md` §1/§2): `bash` is part of the approved envelope, so
    // the envelope's own run Grant admits it and no new `permission` Decision is created.
    // Before the envelope Grant exists the call is refused, which is the boundary that
    // remains.
    const permissionDecisionsBefore = store.decisions.list({ where: "kind = 'permission'" }).length;
    const refused = await post(tokenFor('backend'), {
      toolName: 'bash',
      args: { command: 'printf hi' },
      toolOperationId: OP_ID,
    });
    expect(refused.status).toBe(401);
    expect(refused.body).toMatchObject({ error: { code: 'NOT_AUTHORIZED' } });
    expect(store.decisions.list({ where: "kind = 'permission'" })).toHaveLength(
      permissionDecisionsBefore,
    );

    issue('bash');
    const admitted = await post(tokenFor('backend'), {
      toolName: 'bash',
      args: { command: 'printf hi' },
      toolOperationId: OP_ID,
      expectedInputHash: hashToolInput({ command: 'printf hi' }),
    });
    expect(admitted.status).toBe(200);
    expect((admitted.body['result'] as { stdout: string }).stdout).toBe('hi');
    // Unprompted: no new decision, and the Run never parked in `waiting_permission`.
    expect(store.decisions.list({ where: "kind = 'permission'" })).toHaveLength(
      permissionDecisionsBefore,
    );
    expect(store.runs.find(RUN_ID)?.status).not.toBe('waiting_permission');

    // AC-080's binding still holds for the ledger: the same tool operation with a
    // different input hash is a conflict, so an admitted call cannot be re-pointed.
    const second = await post(tokenFor('backend'), {
      toolName: 'bash',
      args: { command: 'printf different' },
      toolOperationId: OP_ID,
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('rejects an oversized body without running anything', async () => {
    issue('read');
    const response = await fetch(`${endpoint.url}${TOOL_EXECUTE_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokenFor('backend')}`,
      },
      body: JSON.stringify({ toolName: 'read', args: { path: 'x'.repeat(2 * 1024 * 1024) } }),
    });
    expect(response.status).toBe(413);
  });
});
