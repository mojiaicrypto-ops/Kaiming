/**
 * T3 — the Broker's asynchronous tool process path and Grant `limits` (AC-048/AC-049).
 *
 * The suite drives the real `Broker` + `GrantStore` against a real SQLite store, a real
 * temporary workspace and **real child processes**, because the claims are about
 * behaviour a stub cannot exhibit:
 *
 * - a `bash` call runs through the async port, so the daemon's event loop keeps turning
 *   while the shell runs (`reliability.md` §2/§5);
 * - a timeout or a registry cancel reaps the whole process group and the result says so
 *   instead of pretending the command finished;
 * - an argv call is spawned directly, so an argument containing shell syntax stays an
 *   argument;
 * - a `cwd` outside the authorized roots is refused by the Broker, not only by a caller;
 * - a Grant's `maxCalls`/`maxBytes`/`maxDurationSec` refuse an overspend with
 *   `BUDGET_EXCEEDED` (`domain/evaluateGrant`), which was previously ignored;
 * - an authorization row's `operations` widen the Work envelope
 *   (`GrantStore.workScope`, D-T3-5), so a user-approved environment operation can
 *   actually mint the Grant the approval promised.
 */
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { Broker, GrantStore, type GrantIssueInput, type ToolInvocation } from '../src/index.js';
import { ToolProcessRegistry } from '../src/tool-processes.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e00';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e10';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e50';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e30';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e40';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);
const A = 'src/a.ts';

/** The Work's own envelope: file operations only, no `bash` (T3 D-T3-5 pre-state). */
const SCOPE: Scope = {
  readPaths: [A],
  writePaths: [A],
  operations: ['read', 'search', 'write', 'edit', 'artifact_write'],
  networkTargets: [],
};

/** The same envelope widened for the process tests, which need `bash`/`git`. */
const SCOPE_WITH_ENV: Scope = {
  ...SCOPE,
  operations: [...SCOPE.operations, 'bash', 'git'],
};

let clock = Date.parse('2026-09-11T00:00:00.000Z');

function nextTime(stepMs = 1_000): string {
  clock += stepMs;
  return new Date(clock).toISOString();
}

describe('Broker asynchronous tool processes (T3.2/T3.6)', () => {
  let dataDir: string;
  let workspace: string;
  let outside: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let broker: Broker;
  let projectId: string;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-toolbroker-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-toolbroker-ws-'));
    outside = mkdtempSync(join(tmpdir(), 'agentdev-toolbroker-out-'));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, A), 'export const a = 1;\n', 'utf8');

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
      purpose: 'deliver T3 tool bridge',
      level: 'L2',
      goal: 'make tool execution real',
      scope: SCOPE_WITH_ENV,
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
      now: () => nextTime(),
      docker: () => ({ available: true, version: '28.4.0' }),
      resolver: { resolve: () => Promise.resolve({ ok: false, reason: 'no network in tests' }) },
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function issue(overrides: Partial<GrantIssueInput> = {}): void {
    const outcome = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation: 'bash',
      targets: [],
      runId: RUN_ID,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
      ...overrides,
    });
    if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
  }

  function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
    return {
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 1,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'bash',
      targets: [],
      input: { command: 'printf hello' },
      mode: 'host',
      roots: [workspace],
      ...overrides,
    };
  }

  it('runs a real shell asynchronously and records the finished operation', async () => {
    issue();
    const outcome = await broker.invoke(invocation());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = outcome.result as { stdout: string; status: number; pid?: number };
    expect(result.stdout).toBe('hello');
    expect(result.status).toBe(0);
    expect(typeof result.pid).toBe('number');
    expect(outcome.toolOperation.state).toBe('finished');
  });

  it('does not block the daemon event loop while the shell runs', async () => {
    issue();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 25);
    try {
      const outcome = await broker.invoke(
        invocation({ input: { command: 'sleep 0.4; printf slow' }, timeoutMs: 10_000 }),
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect((outcome.result as { stdout: string }).stdout).toBe('slow');
      }
    } finally {
      clearInterval(timer);
    }
    // A `spawnSync` implementation would return with zero ticks; the async port lets
    // the timer fire while the child is alive.
    expect(ticks).toBeGreaterThan(3);
  });

  it('reports a timeout instead of a successful run', async () => {
    issue();
    const outcome = await broker.invoke(
      invocation({ input: { command: 'sleep 30' }, timeoutMs: 250 }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = outcome.result as { timedOut?: boolean; signal: string | null };
    expect(result.timedOut).toBe(true);
    expect(['SIGTERM', 'SIGKILL']).toContain(result.signal);
    expect(outcome.toolOperation.state).toBe('finished');
  });

  it('cancels a live tool process group through the registry', async () => {
    issue();
    const pending = broker.invoke(
      invocation({ input: { command: 'sleep 30' }, timeoutMs: 60_000 }),
    );
    // Wait until the process is actually registered.
    const deadline = Date.now() + 5_000;
    while (broker.processes.activeCount(ATTEMPT_ID) === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(broker.processes.activeCount(ATTEMPT_ID)).toBe(1);
    expect(broker.processes.kill(ATTEMPT_ID)).toBe(1);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.result as { cancelled?: boolean }).cancelled).toBe(true);
    }
    expect(broker.processes.activeCount()).toBe(0);
  });

  it('spawns an argv call without a shell, so syntax in an argument stays data', async () => {
    issue();
    const marker = join(workspace, 'pwned.txt');
    const outcome = await broker.invoke(
      invocation({
        input: { command: 'printf unused' },
        run: (context) => context.runAsync({ program: '/bin/echo', args: [`x; touch ${marker}`] }),
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect((outcome.result as { stdout: string }).stdout.trim()).toBe(`x; touch ${marker}`);
    }
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses a cwd outside the authorized roots', async () => {
    issue();
    const outcome = await broker.invoke(
      invocation({ cwd: join(outside, '..'), input: { command: 'printf nope' } }),
    );
    // `join(outside, '..')` is a real directory outside the workspace.
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses a shell for a read-only role even through the async port', async () => {
    const outcome = await broker.invoke(
      invocation({
        run: (context) => context.runAsync('printf nope'),
      }),
    );
    // No Grant exists at all, so admission refuses before the body runs.
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('NOT_AUTHORIZED');
  });

  it('honours a Grant maxDurationSec instead of silently running longer', async () => {
    issue({ limits: { maxDurationSec: 60 } });
    const refused = await broker.invoke(invocation({ timeoutMs: 120_000 }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('BUDGET_EXCEEDED');
      expect(refused.reason).toContain('maxDurationSec');
    }
    const allowed = await broker.invoke(
      invocation({ input: { command: 'printf ok' }, timeoutMs: 30_000 }),
    );
    expect(allowed.ok).toBe(true);
  });

  it('honours a Grant maxBytes on one call input', async () => {
    issue({ limits: { maxBytes: 8 } });
    const refused = await broker.invoke(invocation());
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('BUDGET_EXCEEDED');
      expect(refused.reason).toContain('maxBytes');
    }
  });

  it('honours a Grant maxCalls across two different tool operations', async () => {
    issue({ limits: { maxCalls: 1 } });
    const first = await broker.invoke(
      invocation({ toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e60' }),
    );
    expect(first.ok).toBe(true);
    const second = await broker.invoke(
      invocation({
        toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e61',
        input: { command: 'printf second' },
      }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe('BUDGET_EXCEEDED');
      expect(second.reason).toContain('maxCalls');
    }
  });

  it('refuses a malformed Grant limit at mint time instead of ignoring it', () => {
    const outcome = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation: 'read',
      targets: [A],
      runId: RUN_ID,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
      limits: { maxCalls: 'many' },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('VALIDATION_ERROR');
  });

  it('exposes the shared registry the daemon injects', () => {
    const registry = new ToolProcessRegistry();
    const shared = new Broker({ store, grants, toolProcesses: registry });
    expect(shared.processes).toBe(registry);
  });
});

describe('GrantStore.workScope unions authorized operations (D-T3-5)', () => {
  let dataDir: string;
  let workspace: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let projectId: string;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-workscope-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-workscope-ws-'));
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
      purpose: 'deliver T3 tool bridge',
      level: 'L2',
      goal: 'make tool execution real',
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
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  function mint(operation: string) {
    return grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'once',
      operation,
      targets: [],
      runId: RUN_ID,
      toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e60',
      inputHash: 'b'.repeat(64),
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
    });
  }

  it('refuses an authorization that the Work envelope does not carry', () => {
    const refused = mint('bash');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('NOT_AUTHORIZED');
  });

  it('admits the operation once an authorization row authorizes it', () => {
    store.authorizations.insert({
      projectId,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'the user approved running the test command',
      scope: { ...SCOPE, operations: ['bash'] },
      operations: ['bash'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
    const granted = mint('bash');
    expect(granted.ok).toBe(true);
    if (granted.ok) expect(granted.grant.operation).toBe('bash');
  });

  it('ignores a revoked authorization', () => {
    const row = store.authorizations.insert({
      projectId,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'the user approved running the test command',
      scope: { ...SCOPE, operations: ['bash'] },
      operations: ['bash'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
      revokedAt: '2026-09-11T00:01:00.000Z',
    });
    expect(row.revokedAt).toBeDefined();
    const refused = mint('bash');
    expect(refused.ok).toBe(false);
  });
});
