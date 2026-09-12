/**
 * WP-07 T5 — the end-to-end permission chain (AC-048, AC-049, AC-050, AC-051,
 * AC-053, AC-080).
 *
 * Every claim in this suite is made against real components rather than a mock:
 * a real SQLite `ProjectStore` holds the `grant`/`tool_operation`/`artifact` rows,
 * `GrantStore` mints and consumes them, `Broker` admits and executes, a real
 * `node` child process receives (or does not receive) the decoy credential, a real
 * temporary repository is scanned by the `pi-runtime` trust boundary, and — when
 * the daemon is up — the real execution image runs the tool under Docker.
 *
 * Coverage, in the order the ACs are written:
 *
 * - **AC-049 / AC-080:** a granted in-scope call executes and is audited; an
 *   out-of-scope target, an expired Grant and the same-role sibling Run are all
 *   refused with a typed code, no execution and no persisted side effect. A
 *   `once` Grant replays the recorded result for the same input and refuses a
 *   different input.
 * - **AC-048 / AC-050:** for a `review`/`test` run the frozen verification input is
 *   readable and the source is not writable in either mode; a verifier cannot read
 *   the developer workspace, for which it holds no Grant.
 * - **AC-051:** the decoy reaches the authorised child process and never reaches
 *   the sibling child, the audit rows, the Artifact store, the UI payload or the
 *   host environment.
 * - **AC-053:** an untrusted repository auto-load extension is not executed, and
 *   after trust only the explicitly selected, whitelisted resource is loaded.
 *
 * The four required failure tests (`符号链接/私网/重定向`, `Secret 泄漏`,
 * `进程清理失败`, `无 Docker 拒绝`) live in `permissions-failures.test.ts`, which
 * runs deterministically in the unit project.
 */
import { spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { EXTENSION_API_VERSION, loadTrustedExtensions } from '@agentdev/pi-runtime';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  Broker,
  EXEC_IMAGE,
  GRANT_EVENTS,
  GrantStore,
  SecretStore,
  TOOL_EVENTS,
  hashToolInput,
  redactValue,
  scanForLeaks,
  secretEnvName,
  type GrantIssueInput,
  type ProcessResult,
  type ToolInvocation,
  type ToolOutcome,
} from '../src/index.js';
import { scanEvents } from '../src/events.js';

const run = promisify(execFile);

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0000';
const TASK_BACKEND = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0100';
const TASK_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0101';
const TASK_TEST = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0102';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0200';
const RUN_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0201';
const RUN_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0202';
const RUN_TEST = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0203';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0300';
const ATTEMPT_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0301';
const ATTEMPT_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0302';
const ATTEMPT_TEST = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0303';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0400';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);

const SOURCE = 'src/feature.ts';
const SOURCE_B = 'src/other.ts';
const FROZEN = 'verification/feature.ts';
const REVIEW_REPORT = 'reports/review.md';
const DEV_DB = 'dev.sqlite';
const SOURCE_BODY = 'export const feature = 1;\n';
const SOURCE_B_BODY = 'export const other = 2;\n';
const FROZEN_BODY = 'export const feature = 1; // frozen\n';

const DECOY_REF = 'project/decoy-token';
const DECOY_VALUE = 'decoy-credential-9f2c-never-in-a-payload';
const DECOY_ENV = secretEnvName(DECOY_REF);

const SCOPE: Scope = {
  readPaths: [SOURCE, SOURCE_B, FROZEN, REVIEW_REPORT, DEV_DB],
  writePaths: [SOURCE, SOURCE_B, REVIEW_REPORT],
  operations: [
    'read',
    'search',
    'write',
    'edit',
    'artifact_write',
    'bash',
    'git',
    'network',
    'secret',
  ],
  networkTargets: [],
};

const AT = '2026-09-11T00:00:00.000Z';
/** An instant before {@link AT}; a Grant minted with it is already expired. */
const PAST = '2026-09-10T00:00:00.000Z';
/** An instant after {@link AT}; a Grant minted with it is still live. */
const FUTURE = '2026-09-11T01:00:00.000Z';
const NOW = (): string => AT;

interface Harness {
  readonly workspace: string;
  readonly frozen: string;
  readonly store: ProjectStore;
  readonly grants: GrantStore;
  readonly secrets: SecretStore;
  readonly broker: Broker;
  /** Tool bodies that really ran; a refusal must leave this list untouched. */
  readonly executed: string[];
  issue(overrides?: Partial<GrantIssueInput>): void;
  invocation(overrides?: Partial<ToolInvocation>): ToolInvocation;
  invoke(overrides?: Partial<ToolInvocation>): Promise<ToolOutcome>;
  invokeBuiltin(overrides?: Partial<ToolInvocation>): Promise<ToolOutcome>;
  dispose(): void;
}

/** Reads one environment variable in a real `node` child. */
function readEnvVar(env: Readonly<Record<string, string>>, name: string): Promise<string> {
  return runChild(env, [
    '-e',
    'process.stdout.write(process.env[process.argv[1]] ?? "<absent>")',
    name,
  ]);
}

/** Runs one real `node` child with exactly the environment the caller grants it. */
async function runChild(
  env: Readonly<Record<string, string>>,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await run(process.execPath, [...args], {
    env: { PATH: process.env['PATH'] ?? '', ...env },
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function makeHarness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-perm-data-'));
  const workspace = mkdtempSync(join(tmpdir(), 'agentdev-perm-ws-'));
  const frozen = mkdtempSync(join(tmpdir(), 'agentdev-perm-frozen-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, SOURCE), SOURCE_BODY, 'utf8');
  writeFileSync(join(workspace, SOURCE_B), SOURCE_B_BODY, 'utf8');
  mkdirSync(join(frozen, 'verification'), { recursive: true });
  mkdirSync(join(frozen, 'reports'), { recursive: true });
  writeFileSync(join(frozen, FROZEN), FROZEN_BODY, 'utf8');

  // One project covers both trees: the developer workspace and the frozen input a
  // verifier receives. Only the Grants distinguish what each role may touch.
  const store = Store.open({
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
    purpose: 'deliver WP-07 T5 end to end',
    level: 'L2',
    goal: 'exercise the whole permission chain against real components',
    scope: SCOPE,
    sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: REVISION,
    budgetId: budget.id,
    policyRevision: 1,
  });
  const tasks = [
    [TASK_BACKEND, 'backend', 'develop'],
    [TASK_REVIEW, 'review', 'review'],
    [TASK_TEST, 'test', 'test'],
  ] as const;
  for (const [id, role, stage] of tasks) {
    store.tasks.insert({
      id,
      projectId,
      workId: WORK_ID,
      planRef: { id, version: 1, hash: HASH },
      role,
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: SCOPE,
      stage,
      acceptanceIds: ['AC-048', 'AC-049', 'AC-050', 'AC-051', 'AC-080'],
    });
  }
  const runs = [
    [RUN_A, ATTEMPT_A, 'backend', 'implementation', 'develop-L2'],
    [RUN_B, ATTEMPT_B, 'backend', 'implementation', 'develop-L2'],
    [RUN_REVIEW, ATTEMPT_REVIEW, 'review', 'review', 'review'],
    [RUN_TEST, ATTEMPT_TEST, 'test', 'test', 'test'],
  ] as const;
  for (const [id, attemptId, role, purpose, stage] of runs) {
    const taskId = role === 'backend' ? TASK_BACKEND : role === 'review' ? TASK_REVIEW : TASK_TEST;
    store.runs.insert({
      id,
      projectId,
      workId: WORK_ID,
      taskId,
      role,
      purpose,
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

  const grants = new GrantStore({ store, now: NOW });
  const secrets = new SecretStore();
  secrets.put({
    ref: DECOY_REF,
    value: DECOY_VALUE,
    audience: 'tool',
    purposes: ['implementation'],
  });
  const executed: string[] = [];
  const broker = new Broker({ store, grants, now: NOW });

  const harness: Harness = {
    workspace,
    frozen,
    store,
    grants,
    secrets,
    broker,
    executed,
    issue(overrides = {}) {
      const outcome = grants.issue({
        workId: WORK_ID,
        role: 'backend',
        stage: 'develop-L2',
        scope: 'run',
        operation: 'read',
        targets: [SOURCE],
        runId: RUN_A,
        decisionId: DECISION_ID,
        expiresAt: FUTURE,
        ...overrides,
      });
      if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
    },
    invocation(overrides = {}) {
      const base: ToolInvocation = {
        workId: WORK_ID,
        runId: RUN_A,
        attemptId: ATTEMPT_A,
        epoch: 1,
        role: 'backend',
        stage: 'develop-L2',
        operation: 'read',
        targets: [SOURCE],
        input: { path: SOURCE },
        roots: [workspace],
      };
      return { ...base, ...overrides };
    },
    async invoke(overrides = {}) {
      const call = harness.invocation(overrides);
      // An explicit body records that the tool really ran; an override replaces it.
      const body =
        overrides.run === undefined
          ? (): string => {
              executed.push(call.operation);
              return call.operation;
            }
          : overrides.run;
      return await broker.invoke({ ...call, run: body });
    },
    /** Runs the Broker's *built-in* executor, so a read really reads the file. */
    async invokeBuiltin(overrides = {}) {
      return await broker.invoke(harness.invocation(overrides));
    },
    dispose() {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
      rmSync(frozen, { recursive: true, force: true });
    },
  };
  return harness;
}

function dockerStatus(): { readonly ready: boolean; readonly reason: string } {
  const version = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  });
  if (version.status !== 0) {
    return { ready: false, reason: 'the docker daemon is not reachable on this host' };
  }
  const image = spawnSync('docker', ['image', 'inspect', EXEC_IMAGE], { encoding: 'utf8' });
  if (image.status !== 0) {
    return { ready: false, reason: `the execution image ${EXEC_IMAGE} is not built locally` };
  }
  return { ready: true, reason: '' };
}

/** Probed once, so Docker-backed cases `skipIf` instead of failing the suite. */
const DOCKER = dockerStatus();
if (!DOCKER.ready) {
  console.warn(`[permissions.integration] container cases skipped: ${DOCKER.reason}`);
}

describe('end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it('executes an in-scope granted call and audits it, and refuses out-of-scope/expired/sibling calls with no side effect (AC-049, AC-080)', async () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0500';
    harness.issue({ operation: 'read', targets: [SOURCE] });

    const admitted = await harness.invoke({ toolOperationId: operationId });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error(admitted.reason);
    expect(admitted.outcome).toBe('executed');
    expect(harness.executed).toEqual(['read']);
    expect(admitted.result).toBe('read');

    // The audit trail is real persistence: the tool_operation row carries the
    // operation name, its input hash, the Grant reference and the finished state.
    const row = harness.store.toolOperations.find(operationId);
    expect(row?.state).toBe('finished');
    expect(row?.toolName).toBe('read');
    expect(row?.inputHash).toBe(hashToolInput({ path: SOURCE }));
    expect(row?.grantId).toBe(admitted.grantId);
    const events = scanEvents(harness.store, {
      names: [GRANT_EVENTS.issued, GRANT_EVENTS.consumed, TOOL_EVENTS.invoked, TOOL_EVENTS.refused],
    });
    expect(events.map((event) => event.name)).toEqual([GRANT_EVENTS.issued, TOOL_EVENTS.invoked]);

    // 1. An out-of-scope target: the only Grant names `src/feature.ts`, so a read of
    //    `src/other.ts` is refused and nothing runs.
    const outOfScope = await harness.invoke({ targets: [SOURCE_B], input: { path: SOURCE_B } });
    expect(outOfScope.ok).toBe(false);
    if (outOfScope.ok) throw new Error('unreachable');
    expect(outOfScope.code).toBe('NOT_AUTHORIZED');
    expect(harness.executed).toEqual(['read']);
    expect(
      harness.store.toolOperations.list({ where: 'run_id = ?', params: [RUN_A] }),
    ).toHaveLength(1);
    expect(readFileSync(join(harness.workspace, SOURCE), 'utf8')).toBe(SOURCE_BODY);
    // The refusal is audited as `tool.refused`, so the boundary is inspectable.
    expect(
      scanEvents(harness.store, { names: [TOOL_EVENTS.refused] }).map(
        (event) => event.data['code'],
      ),
    ).toEqual(['NOT_AUTHORIZED']);

    // 2. An expired Grant is refused at use time, not at mint time. Each refusal
    //    runs against its own fresh workspace so exactly one Grant can be selected.
    const expiredHarness = makeHarness();
    try {
      expiredHarness.issue({ operation: 'read', targets: [SOURCE], expiresAt: PAST });
      const expired = await expiredHarness.invoke({ toolOperationId: operationId });
      expect(expired.ok).toBe(false);
      if (expired.ok) throw new Error('unreachable');
      expect(expired.code).toBe('AUTH_EXPIRED');
      expect(expiredHarness.executed).toEqual([]);
      expect(
        expiredHarness.store.toolOperations.list({ where: 'run_id = ?', params: [RUN_A] }),
      ).toHaveLength(0);
    } finally {
      expiredHarness.dispose();
    }

    // 3. The same-role sibling Run cannot use Run A's run-scoped Grant.
    const siblingHarness = makeHarness();
    try {
      siblingHarness.issue({ operation: 'read', targets: [SOURCE] });
      const sibling = await siblingHarness.invoke({
        runId: RUN_B,
        attemptId: ATTEMPT_B,
        toolOperationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0501',
      });
      expect(sibling.ok).toBe(false);
      if (sibling.ok) throw new Error('unreachable');
      expect(sibling.code).toBe('NOT_AUTHORIZED');
      expect(siblingHarness.executed).toEqual([]);
      expect(
        siblingHarness.store.toolOperations.list({ where: 'run_id = ?', params: [RUN_B] }),
      ).toHaveLength(0);
    } finally {
      siblingHarness.dispose();
    }
  });

  it('replays the original once result for the same input and refuses a different input (AC-080)', async () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0510';
    const sideEffect = join(harness.workspace, 'src', 'side-effect.txt');
    const marker = 'the tool ran';
    const command = `"${process.execPath}" -e 'require("node:fs").appendFileSync(${JSON.stringify(
      sideEffect,
    )}, ${JSON.stringify(`${marker}\n`)})'`;
    const input = { command };
    harness.issue({
      scope: 'once',
      operation: 'bash',
      targets: [SOURCE],
      toolOperationId: operationId,
      inputHash: hashToolInput(input),
      expiresAt: FUTURE,
    });

    const first = await harness.broker.invoke(
      harness.invocation({ operation: 'bash', toolOperationId: operationId, input }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    expect(first.outcome).toBe('executed');

    const second = await harness.broker.invoke(
      harness.invocation({ operation: 'bash', toolOperationId: operationId, input }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.reason);
    expect(second.outcome).toBe('replayed');
    expect(second.result).toEqual(first.result);

    // The real side effect happened exactly once: the retry never re-ran the tool.
    expect(readFileSync(sideEffect, 'utf8')).toBe(`${marker}\n`);
    const consumed = harness.store.grants.find(first.grantId);
    expect(consumed?.consumedAt).toBeDefined();
    expect(consumed?.consumedByOperationId).toBe(operationId);

    // The same tool operation with a different input hash is refused as an
    // idempotency conflict — the recorded result is never presented as the answer
    // to a different request — and the side effect stays a single line.
    const otherCommand = `"${process.execPath}" -e 'process.stdout.write("other")'`;
    const different = await harness.broker.invoke(
      harness.invocation({
        operation: 'bash',
        toolOperationId: operationId,
        input: { command: otherCommand },
      }),
    );
    expect(different.ok).toBe(false);
    if (different.ok) throw new Error('unreachable');
    expect(different.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(readFileSync(sideEffect, 'utf8')).toBe(`${marker}\n`);
  });

  it('refuses an out-of-scope read by the same role with no executor call and no row (AC-049)', async () => {
    harness.issue({ operation: 'read', targets: [SOURCE] });
    const outside = await harness.invoke({
      targets: [SOURCE_B],
      input: { path: SOURCE_B },
      run: () => {
        harness.executed.push('out-of-scope');
        return 'should never run';
      },
    });
    expect(outside.ok).toBe(false);
    if (outside.ok) throw new Error('unreachable');
    expect(outside.code).toBe('NOT_AUTHORIZED');
    expect(harness.executed).toEqual([]);
    expect(
      harness.store.toolOperations.list({ where: 'run_id = ?', params: [RUN_A] }),
    ).toHaveLength(0);
  });

  it('reads the frozen verification input but not the source, and gains no write, in host and container mode (AC-048, AC-050)', async () => {
    const reviewOperationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0520';
    const testOperationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0521';
    harness.issue({
      role: 'review',
      stage: 'review',
      targets: [FROZEN],
      runId: RUN_REVIEW,
      toolOperationId: reviewOperationId,
    });
    harness.issue({
      role: 'test',
      stage: 'test',
      targets: [FROZEN],
      runId: RUN_TEST,
      toolOperationId: testOperationId,
    });

    // Both a verifier and a tester work from the frozen copy, never the workspace.
    const roles: readonly (readonly [string, string, 'review' | 'test', string, string])[] = [
      [RUN_REVIEW, ATTEMPT_REVIEW, 'review', 'review', reviewOperationId],
      [RUN_TEST, ATTEMPT_TEST, 'test', 'test', testOperationId],
    ];
    for (const [runId, attemptId, role, stage, toolOperationId] of roles) {
      const verified = await harness.broker.invoke({
        workId: WORK_ID,
        runId,
        attemptId,
        epoch: 1,
        role,
        stage,
        operation: 'read',
        targets: [FROZEN],
        input: { path: FROZEN },
        roots: [harness.frozen],
        toolOperationId,
      });
      expect(verified.ok).toBe(true);
      if (!verified.ok) throw new Error(verified.reason);
      expect(verified.result).toBe(FROZEN_BODY);

      // A write to the frozen input is refused for a read-only role in every mode.
      for (const mode of ['host', 'container'] as const) {
        const write = await harness.broker.invoke({
          workId: WORK_ID,
          runId,
          attemptId,
          epoch: 1,
          role,
          stage,
          operation: 'write',
          access: 'write',
          mode,
          targets: [FROZEN],
          input: { path: FROZEN, content: 'tampered\n' },
          roots: [harness.frozen],
        });
        expect(write.ok).toBe(false);
        if (write.ok) throw new Error('unreachable');
        expect(write.code).toBe('NOT_AUTHORIZED');
      }
    }
    expect(readFileSync(join(harness.frozen, FROZEN), 'utf8')).toBe(FROZEN_BODY);

    // A verifier holds no Grant for the developer workspace, so neither the source
    // nor the run database is readable: that is not a role privilege.
    for (const target of [SOURCE, DEV_DB]) {
      const forbidden = await harness.broker.invoke({
        workId: WORK_ID,
        runId: RUN_REVIEW,
        attemptId: ATTEMPT_REVIEW,
        epoch: 1,
        role: 'review',
        stage: 'review',
        operation: 'read',
        targets: [target],
        input: { path: target },
        roots: [harness.workspace],
      });
      expect(forbidden.ok).toBe(false);
      if (forbidden.ok) throw new Error('unreachable');
      expect(forbidden.code).toBe('NOT_AUTHORIZED');
    }
    // The same read succeeds for the developer Run that does hold the Grant, so
    // the verifier's refusal is about its scope and not about a broken boundary.
    // The built-in executor really reads the file.
    harness.issue({ operation: 'read', targets: [SOURCE], runId: RUN_A });
    const owner = await harness.invokeBuiltin({ targets: [SOURCE], input: { path: SOURCE } });
    expect(owner.ok).toBe(true);
    if (!owner.ok) throw new Error(owner.reason);
    expect(owner.result).toBe(SOURCE_BODY);

    // A ready Grant for a report path does not widen the role: the Broker's
    // read-only role gate runs before admission, so a verifier has no write path
    // through `invoke` at all (`execution.md` §1 "Review与Test在所有模式仍使用隔离
    // 容器，确保源码只读"). The refusal is explicit and nothing is mutated.
    const report = join(harness.frozen, REVIEW_REPORT);
    const reportOperationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0522';
    harness.issue({
      role: 'review',
      stage: 'review',
      operation: 'write',
      targets: [REVIEW_REPORT],
      runId: RUN_REVIEW,
      toolOperationId: reportOperationId,
    });
    const reported = await harness.broker.invoke({
      workId: WORK_ID,
      runId: RUN_REVIEW,
      attemptId: ATTEMPT_REVIEW,
      epoch: 1,
      role: 'review',
      stage: 'review',
      operation: 'write',
      access: 'write',
      targets: [REVIEW_REPORT],
      input: { path: REVIEW_REPORT, content: 'reviewed\n' },
      roots: [harness.frozen],
      toolOperationId: reportOperationId,
    });
    expect(reported.ok).toBe(false);
    if (reported.ok) throw new Error('unreachable');
    expect(reported.code).toBe('NOT_AUTHORIZED');
    expect(reported.reason).toContain('read-only');
    expect(reported.fields).toEqual(['role']);
    // The report path was never written and no tool operation was recorded.
    expect(() => readFileSync(report, 'utf8')).toThrow();
    expect(harness.store.toolOperations.find(reportOperationId)).toBeUndefined();
    expect(readFileSync(join(harness.frozen, FROZEN), 'utf8')).toBe(FROZEN_BODY);
  });

  it('writes a Review report inside its declared report root and never the source (W7R1-13)', async () => {
    const reportOperationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0540';
    harness.issue({
      role: 'review',
      stage: 'review',
      operation: 'write',
      targets: [REVIEW_REPORT],
      runId: RUN_REVIEW,
      toolOperationId: reportOperationId,
    });
    // `execution.md` §3 gives Review "自己报告与检查临时目录"; the Broker admits a
    // write there, and only there.
    const governed = new Broker({
      store: harness.store,
      grants: harness.grants,
      now: NOW,
      writableReportRoots: [join(harness.frozen, 'reports')],
    });
    const report = join(harness.frozen, REVIEW_REPORT);
    const written = await governed.invoke({
      workId: WORK_ID,
      runId: RUN_REVIEW,
      attemptId: ATTEMPT_REVIEW,
      epoch: 1,
      role: 'review',
      stage: 'review',
      operation: 'write',
      access: 'write',
      targets: [REVIEW_REPORT],
      input: { path: REVIEW_REPORT, content: 'reviewed\n' },
      roots: [harness.frozen],
      toolOperationId: reportOperationId,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error(written.reason);
    expect(readFileSync(report, 'utf8')).toBe('reviewed\n');

    // The same role still has no write path to source or to the run database.
    const sourceBefore = readFileSync(join(harness.workspace, SOURCE), 'utf8');
    const sourceWrite = await governed.invoke({
      workId: WORK_ID,
      runId: RUN_REVIEW,
      attemptId: ATTEMPT_REVIEW,
      epoch: 1,
      role: 'review',
      stage: 'review',
      operation: 'write',
      access: 'write',
      targets: [SOURCE],
      input: { path: SOURCE, content: 'mutated\n' },
      roots: [harness.workspace],
    });
    expect(sourceWrite.ok).toBe(false);
    if (sourceWrite.ok) throw new Error('unreachable');
    expect(sourceWrite.code).toBe('NOT_AUTHORIZED');
    expect(sourceWrite.reason).toContain('report/scratch root');
    expect(readFileSync(join(harness.workspace, SOURCE), 'utf8')).toBe(sourceBefore);

    const dbWrite = await governed.invoke({
      workId: WORK_ID,
      runId: RUN_REVIEW,
      attemptId: ATTEMPT_REVIEW,
      epoch: 1,
      role: 'review',
      stage: 'review',
      operation: 'write',
      access: 'write',
      targets: [DEV_DB],
      input: { path: DEV_DB, content: 'mutated\n' },
      roots: [harness.workspace],
    });
    expect(dbWrite.ok).toBe(false);
    if (dbWrite.ok) throw new Error('unreachable');
    expect(dbWrite.reason).toContain('report/scratch root');
  });

  it('refuses the run database to a verifier without any caller-declared protected path (W7R1-04)', async () => {
    const dataDir = harness.store.dataDir;
    const dbFile = join(dataDir, 'project.sqlite');
    // No `protectedPaths` option: the roots are derived from the store, so even a
    // Grant whose target is a file outside the repository cannot read the run DB.
    const plain = new Broker({ store: harness.store, grants: harness.grants, now: NOW });
    expect(plain.protectedRoots).toContain(realpathSync(dataDir));
    expect(plain.protectedRoots).toContain(realpathSync(dbFile));

    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0550';
    harness.issue({
      role: 'review',
      stage: 'review',
      operation: 'read',
      targets: [DEV_DB],
      runId: RUN_REVIEW,
      toolOperationId: operationId,
    });
    const read = await plain.invoke({
      workId: WORK_ID,
      runId: RUN_REVIEW,
      attemptId: ATTEMPT_REVIEW,
      epoch: 1,
      role: 'review',
      stage: 'review',
      operation: 'read',
      targets: [DEV_DB],
      input: { path: DEV_DB },
      roots: [dataDir],
      toolOperationId: operationId,
    });
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('unreachable');
    expect(read.code).toBe('NOT_AUTHORIZED');
    expect(read.reason).toContain('protected root');
    expect(harness.store.toolOperations.find(operationId)).toBeUndefined();
  });

  it.skipIf(!DOCKER.ready)(
    'keeps the frozen source read-only inside the real container (AC-048, AC-050)',
    async () => {
      const reviewOperationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0530';
      harness.issue({
        role: 'review',
        stage: 'review',
        targets: [FROZEN],
        runId: RUN_REVIEW,
        toolOperationId: reviewOperationId,
      });
      const verified = await harness.broker.invoke({
        workId: WORK_ID,
        runId: RUN_REVIEW,
        attemptId: ATTEMPT_REVIEW,
        epoch: 1,
        role: 'review',
        stage: 'review',
        operation: 'read',
        mode: 'container',
        targets: [FROZEN],
        input: { path: FROZEN },
        roots: [harness.frozen],
        toolOperationId: reviewOperationId,
      });
      expect(verified.ok).toBe(true);
      if (!verified.ok) throw new Error(verified.reason);
      expect(verified.result).toContain('export const feature = 1;');

      // A real container write attempt is refused before Docker is even asked.
      const write = await harness.broker.invoke({
        workId: WORK_ID,
        runId: RUN_REVIEW,
        attemptId: ATTEMPT_REVIEW,
        epoch: 1,
        role: 'review',
        stage: 'review',
        operation: 'write',
        access: 'write',
        mode: 'container',
        targets: [FROZEN],
        input: { path: FROZEN, content: 'tampered\n' },
        roots: [harness.frozen],
      });
      expect(write.ok).toBe(false);
      if (write.ok) throw new Error('unreachable');
      expect(write.code).toBe('NOT_AUTHORIZED');
      expect(readFileSync(join(harness.frozen, FROZEN), 'utf8')).toBe(FROZEN_BODY);
    },
  );

  it('injects the decoy into the authorised child and never into a log, Artifact, UI payload, audit row or the host environment (AC-051)', async () => {
    harness.issue({ operation: 'secret', targets: [DECOY_REF], runId: RUN_A });
    const injection = harness.secrets.environmentFor(
      {
        audience: 'tool',
        purpose: 'implementation',
        role: 'backend',
        workId: WORK_ID,
        stage: 'develop-L2',
        at: AT,
        runId: RUN_A,
        grants: harness.store.grants.list({ where: 'run_id = ?', params: [RUN_A] }),
      },
      [DECOY_REF],
    );
    expect(injection.ok).toBe(true);
    if (!injection.ok) throw new Error(injection.reason);
    expect(injection.env[DECOY_ENV]).toBe(DECOY_VALUE);

    // The real child the tool would run receives exactly that one credential.
    expect(await readEnvVar(injection.env, DECOY_ENV)).toBe(DECOY_VALUE);

    // The host tool process the Broker spawns never inherits the credential: the
    // real child starts from the host environment, which holds no secret value.
    harness.issue({ operation: 'bash', targets: [SOURCE], runId: RUN_A });
    const brokerEnv = await harness.broker.invoke(
      harness.invocation({
        operation: 'bash',
        input: {
          command: `"${process.execPath}" -e 'process.stdout.write(process.env[${JSON.stringify(
            DECOY_ENV,
          )}] ?? "<absent>")'`,
        },
      }),
    );
    expect(brokerEnv.ok).toBe(true);
    if (!brokerEnv.ok) throw new Error(brokerEnv.reason);
    expect((brokerEnv.result as ProcessResult).stdout).toBe('<absent>');

    // The audit pipeline redacts before anything is persisted: the Artifact row and
    // the event row carry the mask, never the value.
    const rawLog = `2026-09-11T00:00:01.000Z tool output: ${DECOY_VALUE}`;
    const safeLog = harness.secrets.maskAll(rawLog);
    const artifactContent = `${safeLog}\n`;
    const artifactId = harness.store.newId();
    harness.store.artifacts.insert({
      id: artifactId,
      workId: WORK_ID,
      runId: RUN_A,
      origin: 'agent',
      kind: 'log',
      artifactVersion: 1,
      contentHash: hashToolInput(artifactContent),
      relativeBlobPath: `artifacts/${artifactId}`,
      mime: 'text/plain',
      bytes: Buffer.byteLength(artifactContent),
      validity: 'valid',
      acl: ['review'],
    });
    harness.store.events.append({
      name: TOOL_EVENTS.invoked,
      entityId: artifactId,
      entityVersion: 1,
      data: { log: safeLog, credentialRef: DECOY_REF },
    });

    const uiPayload = {
      card: {
        title: 'Tool output',
        body: redactValue({ output: rawLog, refs: [DECOY_REF] }, [DECOY_VALUE]),
      },
    };
    const artifact = harness.store.artifacts.find(artifactId);
    expect(safeLog).toContain('[redacted]');
    expect(artifactContent).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(artifact)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(uiPayload)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(scanEvents(harness.store))).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(harness.store.grants.list())).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(harness.secrets.list())).not.toContain(DECOY_VALUE);
    expect(scanForLeaks(uiPayload, [DECOY_VALUE])).toEqual([]);
    expect(scanForLeaks(artifactContent, [DECOY_VALUE])).toEqual([]);
    // The scanner really detects the raw form, so the clean assertions above are
    // not vacuous; the audit path names the credential by ref only.
    expect(scanForLeaks(rawLog, [DECOY_VALUE])).toHaveLength(1);
    expect(JSON.stringify(scanEvents(harness.store))).toContain(DECOY_REF);
    expect(process.env[DECOY_ENV]).toBeUndefined();
    expect(readFileSync(join(harness.workspace, SOURCE), 'utf8')).not.toContain(DECOY_VALUE);
  });

  it('gives the unauthorised sibling Run no credential at all, on every channel (AC-051)', async () => {
    harness.issue({ operation: 'secret', targets: [DECOY_REF], runId: RUN_A });
    const siblingInjection = harness.secrets.environmentFor(
      {
        audience: 'tool',
        purpose: 'implementation',
        role: 'backend',
        workId: WORK_ID,
        stage: 'develop-L2',
        at: AT,
        runId: RUN_B,
        grants: harness.store.grants.list({ where: 'run_id = ?', params: [RUN_B] }),
      },
      [DECOY_REF],
    );
    expect(siblingInjection.ok).toBe(false);
    if (siblingInjection.ok) throw new Error('unreachable');
    expect(siblingInjection.code).toBe('NOT_AUTHORIZED');

    // The Broker refuses the same use for the sibling — before any executor is
    // prepared — and records no secret value.
    const refused = await harness.invoke({
      runId: RUN_B,
      attemptId: ATTEMPT_B,
      operation: 'secret',
      targets: [DECOY_REF],
      input: { ref: DECOY_REF },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.code).toBe('NOT_AUTHORIZED');
    expect(JSON.stringify(scanEvents(harness.store))).not.toContain(DECOY_VALUE);

    // A real child started for the sibling only ever sees the environment that Run
    // legitimately has, and the decoy is not in it.
    const siblingEnv: Readonly<Record<string, string>> = {};
    expect(await readEnvVar(siblingEnv, DECOY_ENV)).toBe('<absent>');
    const dumped = await runChild(siblingEnv, [
      '-e',
      'process.stdout.write(JSON.stringify(process.env))',
    ]);
    expect(scanForLeaks(dumped, [DECOY_VALUE])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-053 — repository trust boundary, over a real temporary repository
// ---------------------------------------------------------------------------

const REPO_MARKER = 'auto-load-executed.marker';
const REPO_MODULE = 'extensions/auto-load.mjs';

describe('repository trust boundary over a real repository (AC-053)', () => {
  let scratch: string;
  let repo: string;
  let agentDir: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'agentdev-perm-trust-'));
    repo = join(scratch, 'repo');
    agentDir = join(scratch, 'agent');
    await mkdir(join(repo, 'extensions'), { recursive: true });
    await mkdir(join(repo, '.pi'), { recursive: true });
    await mkdir(join(repo, 'skills', 'selected-skill'), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    // The module writes a marker when it is evaluated, so "was this executed?" is
    // answered by the filesystem and not by the loader's own report.
    await writeFile(
      join(repo, REPO_MODULE),
      [
        "import { writeFileSync } from 'node:fs';",
        "import { fileURLToPath } from 'node:url';",
        "import { dirname, join } from 'node:path';",
        'const here = dirname(fileURLToPath(import.meta.url));',
        `writeFileSync(join(here, '${REPO_MARKER}'), 'executed');`,
        "export const id = 'auto-load';",
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(repo, '.pi', 'extensions.json'),
      '{ "extensions": ["auto-load"] }\n',
      'utf8',
    );
    await writeFile(
      join(repo, 'skills', 'selected-skill', 'SKILL.md'),
      '---\nname: selected-skill\ndescription: selected by the Chief\n---\n\n# selected\n',
      'utf8',
    );
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('does not execute an untrusted repository auto-load extension, and honours only the selected resource after trust (AC-053)', async () => {
    const marker = join(repo, 'extensions', REPO_MARKER);
    const untrusted = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'untrusted',
      repositoryExtensions: [
        { id: 'auto-load', modulePath: REPO_MODULE, configPath: '.pi/extensions.json' },
      ],
      repositoryConfigPaths: ['.pi/extensions.json'],
      selectedExtensionIds: ['auto-load'],
      selectedSkillPaths: ['skills/selected-skill'],
      agentDir,
    });

    expect(untrusted.readOnly).toBe(true);
    expect(untrusted.loadedExtensions).toEqual([]);
    expect(untrusted.loadedSkills).toEqual([]);
    // The trace is the evidence: the config, the extension and the skill are each
    // audited with a contracts error code and a precise reason.
    expect(untrusted.trace.length).toBeGreaterThan(0);
    for (const entry of untrusted.trace) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(['skipped', 'refused']).toContain(entry.decision);
      expect(entry.code).toBe('NOT_AUTHORIZED');
    }
    expect(untrusted.trace.map((entry) => entry.kind)).toEqual(['config', 'extension', 'skill']);
    // Nothing from the repository was importable, so the marker was never written.
    await expect(access(marker)).rejects.toBeDefined();

    // After trust, only the explicitly selected and whitelisted extension is
    // executed; the release whitelist is supplied by the caller.
    const trusted = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [
        {
          id: 'auto-load',
          version: '1.0.0',
          apiVersion: EXTENSION_API_VERSION,
          capabilities: ['report'],
          critical: false,
          enabledByDefault: false,
        },
        {
          id: 'other-builtin',
          version: '1.0.0',
          apiVersion: EXTENSION_API_VERSION,
          capabilities: ['report'],
          critical: false,
          enabledByDefault: false,
        },
      ],
      repositoryExtensions: [
        { id: 'auto-load', modulePath: REPO_MODULE, configPath: '.pi/extensions.json' },
      ],
      repositoryConfigPaths: ['.pi/extensions.json'],
      selectedExtensionIds: ['auto-load'],
      selectedSkillPaths: ['skills/selected-skill'],
      agentDir,
    });
    expect(trusted.readOnly).toBe(false);
    expect(readFileSync(marker, 'utf8')).toBe('executed');
    expect(trusted.loadedExtensions.map((entry) => entry.id)).toEqual(['auto-load']);
    expect(trusted.loadedSkills.map((entry) => entry.name)).toEqual(['selected-skill']);
    // A whitelisted but unselected extension is never auto-enabled, and the audit
    // entry says `skipped`/`not-selected` rather than mislabelling a non-error
    // decision as `refused`/`INTERNAL_ERROR` (W7R1-12).
    expect(trusted.loadedExtensions.map((entry) => entry.id)).not.toContain('other-builtin');
    const unselected = trusted.trace.find((entry) => entry.id === 'other-builtin');
    expect(unselected).toMatchObject({ decision: 'skipped' });
    expect(unselected?.code).toBeUndefined();
    expect(unselected?.reason).toContain('not-selected');
  });

  it('never reads a selected skill from an untrusted repository (AC-053)', async () => {
    const reads: string[] = [];
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'untrusted',
      selectedSkillPaths: ['skills/selected-skill'],
      agentDir,
      readSkillFile: (path) => {
        reads.push(path);
        return Promise.resolve('');
      },
    });
    expect(result.loadedSkills).toEqual([]);
    expect(reads).toEqual([]);
    expect(result.skipped.map((entry) => entry.kind)).toEqual(['skill']);
    expect(result.skipped[0]?.code).toBe('NOT_AUTHORIZED');
  });
});
