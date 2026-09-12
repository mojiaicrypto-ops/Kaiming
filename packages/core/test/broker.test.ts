/**
 * WP-07 T3 — the tool Broker, the file/network boundaries and the isolated test
 * environment (AC-048, AC-050).
 *
 * The suite drives the real `Broker` against a real SQLite `ProjectStore` and real
 * `GrantStore` rows, and a real temporary workspace on disk, so every claim is
 * about persisted state and real paths rather than a mock:
 *
 * - **Admission (AC-048, AC-080):** a valid Grant runs the tool and writes the
 *   `tool_operation` audit row (operation, input hash, Grant reference, finished
 *   state); an out-of-scope target/operation, an expired Grant, a wrong role and a
 *   sibling Run refuse with the documented code, execute nothing and are recorded
 *   as `tool.refused`.
 * - **No Docker (required failure test):** container mode without a reachable
 *   daemon is refused with the observed reason and never falls back to the host.
 * - **File boundary (required failure test):** a symlink pointing outside the
 *   workspace, a `..` escape and an absolute escape are refused in **both** modes
 *   with no read and no write.
 * - **Host-mode gates (AC-050):** a Review Run gains no write access to source in
 *   host mode, and the run database stays unreadable to it.
 * - **Network policy:** private/loopback/link-local/metadata targets are refused
 *   by default and pass only when exactly authorized; the container plan is
 *   hardened and has no network unless the Grant covers it.
 * - **Test environment (required failure test):** its own DB file and port, never
 *   the reserved development values, and a cleanup that fails is reported as
 *   `RECOVERY_REQUIRED` instead of being swallowed.
 *
 * The real-process and real-HTTP-server scenarios live in
 * `broker.integration.test.ts`.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  Broker,
  GrantStore,
  GuardedRequester,
  NetworkPolicy,
  TestEnvironmentManager,
  TOOL_EVENTS,
  claimedTestPorts,
  classifyAddressLiteral,
  defaultTestEnvironmentPorts,
  hashToolInput,
  isPrivateAddress,
  planContainerRun,
  resolveWithinRoots,
  type BrokerOptions,
  type GrantIssueInput,
  type HostResolver,
  type ProcessResult,
  type ProcessRunner,
  type TestEnvironment,
  type TestEnvironmentPorts,
  type ToolInvocation,
  type ToolOutcome,
} from '../src/index.js';
import { scanEvents } from '../src/events.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e00';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e10';
const RUN_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e11';
const RUN_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e12';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e50';
const ATTEMPT_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e51';
const ATTEMPT_REVIEW = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e52';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e30';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e40';
const REVIEW_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e41';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);
const A = 'src/a.ts';
const B = 'src/b.ts';
const LINK = 'link/secret.txt';
const DEV_DB = 'dev.sqlite';
/** `execution.md` §3: Review owns "自己报告与检查临时目录". */
const REPORT = 'reports/review.md';

const SCOPE: Scope = {
  readPaths: [A, B, LINK, DEV_DB, REPORT],
  writePaths: [A, B, LINK, DEV_DB, REPORT],
  operations: [
    'read',
    'search',
    'write',
    'edit',
    'artifact_write',
    'bash',
    'git',
    'push',
    'network',
  ],
  networkTargets: [],
};

/**
 * A local DNS fixture for the W7R1-01/07 regressions.
 *
 * `localtest.example` resolves to loopback and `public.example` to a public
 * address, both from this stub — so the DNS branch is exercised with no external
 * network. A name the fixture does not know is reported as unresolvable, which the
 * policy refuses rather than admits.
 */
const FIXTURE_RESOLVER: HostResolver = {
  resolve(host) {
    if (host === 'localtest.example') {
      return Promise.resolve({ ok: true, addresses: ['127.0.0.1', '::1'] });
    }
    if (host === 'public.example') {
      return Promise.resolve({ ok: true, addresses: ['93.184.216.34'] });
    }
    return Promise.resolve({ ok: false, reason: `${host} is not in the local fixture` });
  },
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

/** A port the OS just agreed was free (released immediately, so a small race). */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((settle) => {
    server.listen(0, '127.0.0.1', () => {
      settle();
    });
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((settle) => {
    server.close(() => {
      settle();
    });
  });
  return port;
}

describe('Broker (AC-048, AC-050)', () => {
  let dataDir: string;
  let workspace: string;
  let outside: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let broker: Broker;
  let projectId: string;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-broker-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-broker-ws-'));
    outside = mkdtempSync(join(tmpdir(), 'agentdev-broker-out-'));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, A), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(workspace, B), 'export const b = 2;\n', 'utf8');
    writeFileSync(join(outside, 'secret.txt'), 'top-secret\n', 'utf8');
    symlinkSync(outside, join(workspace, 'link'), 'dir');
    mkdirSync(join(workspace, 'reports'), { recursive: true });

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
      purpose: 'deliver WP-07 T3 broker',
      level: 'L2',
      goal: 'make the tool boundary real',
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
      acceptanceIds: ['AC-048', 'AC-080'],
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
    addRun(RUN_A, ATTEMPT_A, 'backend', 'develop-L2');
    addRun(RUN_B, ATTEMPT_B, 'backend', 'develop-L2');
    addRun(RUN_REVIEW, ATTEMPT_REVIEW, 'review', 'review');
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
    broker = makeBroker();
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
      ownerEpoch: 1,
    });
  }

  function makeBroker(overrides: Partial<BrokerOptions> = {}): Broker {
    return new Broker({
      store,
      grants,
      now: () => nextTime(),
      docker: () => ({ available: true, version: '27.0.0' }),
      resolver: FIXTURE_RESOLVER,
      ...overrides,
    });
  }

  function issue(overrides: Partial<GrantIssueInput> = {}): void {
    const outcome = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation: 'read',
      targets: [A],
      runId: RUN_A,
      decisionId: DECISION_ID,
      expiresAt: new Date(clock + 3_600_000).toISOString(),
      ...overrides,
    });
    if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
  }

  function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
    return {
      workId: WORK_ID,
      runId: RUN_A,
      attemptId: ATTEMPT_A,
      epoch: 1,
      role: 'backend',
      stage: 'develop-L2',
      operation: 'read',
      targets: [A],
      input: { path: A },
      roots: [workspace],
      at: nextTime(),
      ...overrides,
    };
  }

  async function invoke(overrides: Partial<ToolInvocation> = {}): Promise<ToolOutcome> {
    return await broker.invoke(invocation(overrides));
  }

  function refusedEvents() {
    return scanEvents(store, { names: [TOOL_EVENTS.refused] });
  }

  // ---------------------------------------------------------------------------
  // Admission
  // ---------------------------------------------------------------------------

  describe('admission through the Grant service (AC-048)', () => {
    it('admits a read and records the tool operation and the audit event (AC-048)', async () => {
      issue();
      const operationId = uuid(0x700000000001);
      const outcome = await invoke({ toolOperationId: operationId });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.result).toContain('export const a = 1;');
      expect(outcome.mode).toBe('host');

      // The audit row is in SQLite: operation, input hash, Grant reference, outcome.
      const row = store.toolOperations.find(operationId);
      expect(row?.state).toBe('finished');
      expect(row?.toolName).toBe('read');
      expect(row?.inputHash).toBe(hashToolInput({ path: A }));
      expect(row?.grantId).toBe(outcome.grantId);
      expect(row?.resultRef).toBeDefined();

      const invoked = scanEvents(store, { names: [TOOL_EVENTS.invoked] });
      expect(invoked).toHaveLength(1);
      expect(invoked[0]?.data['operation']).toBe('read');
      expect(invoked[0]?.data['grantId']).toBe(outcome.grantId);
      expect(invoked[0]?.data['outcome']).toBe('executed');
      // The audit trail never carries the decoded input itself.
      expect(JSON.stringify(invoked[0]?.data)).not.toContain('export const');
    });

    it('refuses an out-of-scope target with no execution and records the refusal (AC-048)', async () => {
      issue({ targets: [A] });
      let executions = 0;
      const outcome = await invoke({
        targets: [B],
        input: { path: B },
        run: () => (executions += 1),
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);

      const refusals = refusedEvents();
      expect(refusals).toHaveLength(1);
      expect(refusals[0]?.data['code']).toBe('NOT_AUTHORIZED');
      expect(refusals[0]?.data['operation']).toBe('read');
    });

    it('refuses an operation the Grant does not cover (AC-048)', async () => {
      issue({ operation: 'read' });
      let executions = 0;
      const outcome = await invoke({ operation: 'write', run: () => (executions += 1) });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('refuses an expired Grant at use time and does not execute (AC-048)', async () => {
      issue({ expiresAt: new Date(clock + 1_000).toISOString() });
      let executions = 0;
      const outcome = await invoke({ at: nextTime(3_600_000), run: () => (executions += 1) });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('AUTH_EXPIRED');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('refuses a role the Grant does not belong to (AC-048)', async () => {
      issue({ role: 'backend', stage: 'develop-L2', runId: RUN_A });
      let executions = 0;
      const outcome = await invoke({
        role: 'review',
        stage: 'review',
        runId: RUN_REVIEW,
        attemptId: ATTEMPT_REVIEW,
        run: () => (executions += 1),
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(executions).toBe(0);
    });

    it('refuses the sibling Run of the same role with no side effect (AC-080)', async () => {
      issue({ scope: 'run', runId: RUN_A });
      let executions = 0;
      const outcome = await invoke({
        runId: RUN_B,
        attemptId: ATTEMPT_B,
        run: () => (executions += 1),
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.fields).toContain('runId');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('replays the recorded result for the same once operation (AC-080)', async () => {
      const operationId = uuid(0x700000000010);
      const input = { path: A };
      issue({
        scope: 'once',
        operation: 'read',
        targets: [A],
        toolOperationId: operationId,
        inputHash: hashToolInput(input),
      });
      let executions = 0;
      const first = await invoke({
        toolOperationId: operationId,
        input,
        run: () => {
          executions += 1;
          return 'original';
        },
      });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error('unreachable');
      expect(first.outcome).toBe('executed');
      expect(first.result).toBe('original');

      const replay = await invoke({
        toolOperationId: operationId,
        input,
        run: () => {
          executions += 1;
          return 'second';
        },
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error('unreachable');
      expect(replay.outcome).toBe('replayed');
      expect(replay.result).toBe('original');
      expect(executions).toBe(1);
      expect(store.toolOperations.count()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // File boundary (required failure test)
  // ---------------------------------------------------------------------------

  describe('file boundary (AC-048)', () => {
    it('refuses a symlink pointing outside the workspace in both modes with no read (AC-048)', async () => {
      issue({ operation: 'read', targets: [LINK] });
      for (const mode of ['host', 'container'] as const) {
        const outcome = await invoke({
          mode,
          operation: 'read',
          targets: [LINK],
          input: { path: LINK },
        });
        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error('unreachable');
        expect(outcome.code).toBe('NOT_AUTHORIZED');
        expect(outcome.reason).toContain('outside the allowed roots');
      }
      // Nothing was read (the secret is still only in the outside directory) and
      // no tool operation was recorded.
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('top-secret\n');
      expect(store.toolOperations.count()).toBe(0);
      expect(refusedEvents()).toHaveLength(2);
    });

    it('refuses a symlink escape for a write in both modes with no write (AC-048)', async () => {
      issue({ operation: 'write', targets: [LINK] });
      for (const mode of ['host', 'container'] as const) {
        const outcome = await invoke({
          mode,
          operation: 'write',
          targets: [LINK],
          input: { path: LINK, content: 'overwritten' },
        });
        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error('unreachable');
        expect(outcome.code).toBe('NOT_AUTHORIZED');
      }
      expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('top-secret\n');
      expect(store.toolOperations.count()).toBe(0);
    });

    it('refuses a .. escape and an absolute escape (AC-048)', async () => {
      const dotdot = await invoke({
        operation: 'read',
        targets: ['../outside/secret.txt'],
        input: {},
      });
      expect(dotdot.ok).toBe(false);
      if (dotdot.ok) throw new Error('unreachable');
      expect(dotdot.code).toBe('NOT_AUTHORIZED');

      const absolute = await invoke({ operation: 'read', targets: ['/etc/passwd'], input: {} });
      expect(absolute.ok).toBe(false);
      if (absolute.ok) throw new Error('unreachable');
      expect(absolute.code).toBe('NOT_AUTHORIZED');

      expect(store.toolOperations.count()).toBe(0);
    });

    it('resolves a legitimate path inside the root (positive control)', () => {
      const decision = resolveWithinRoots({
        path: '../src/a.ts',
        access: 'read',
        roots: [join(workspace, 'src')],
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error('unreachable');
      // The resolved path is canonical (`/tmp` is a symlink to `/private/var` on
      // macOS), which is exactly why the boundary compares real paths.
      expect(decision.realPath).toBe(realpathSync.native(join(workspace, A)));
    });
  });

  // ---------------------------------------------------------------------------
  // No Docker (required failure test)
  // ---------------------------------------------------------------------------

  describe('container mode without a Docker daemon (AC-048)', () => {
    it('refuses with the observed reason and never falls back to host execution (AC-048)', async () => {
      const spawned: string[] = [];
      const runner: ProcessRunner = {
        run(command, args): ProcessResult {
          spawned.push([command, ...args].join(' '));
          return { status: 0, stdout: '', stderr: '', signal: null };
        },
      };
      broker = makeBroker({
        docker: () => ({ available: false, reason: 'Cannot connect to the Docker daemon' }),
        process: runner,
      });
      issue();
      let executions = 0;
      const outcome = await invoke({ mode: 'container', run: () => (executions += 1) });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('PROVIDER_UNAVAILABLE');
      expect(outcome.reason).toContain('Cannot connect to the Docker daemon');
      expect(outcome.reason).toContain('does not fall back to host');
      expect(executions).toBe(0);
      expect(spawned).toEqual([]);
      expect(store.toolOperations.count()).toBe(0);
      expect(refusedEvents()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Host-mode domain gates (AC-050)
  // ---------------------------------------------------------------------------

  describe('host-mode domain gates (AC-050)', () => {
    it('refuses a Review Run write access to source even in host mode (AC-050)', async () => {
      const before = readFileSync(join(workspace, A), 'utf8');
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'write',
        targets: [A],
        runId: RUN_REVIEW,
      });
      let executions = 0;
      const outcome = await invoke({
        mode: 'host',
        role: 'review',
        stage: 'review',
        runId: RUN_REVIEW,
        attemptId: ATTEMPT_REVIEW,
        operation: 'write',
        targets: [A],
        input: { path: A, content: 'mutated' },
        run: () => (executions += 1),
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.reason).toContain('read-only');
      expect(executions).toBe(0);
      expect(readFileSync(join(workspace, A), 'utf8')).toBe(before);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('keeps the run database unreadable to a Review Run in both modes (AC-050)', async () => {
      const devDb = join(workspace, DEV_DB);
      writeFileSync(devDb, 'run database\n', 'utf8');
      broker = makeBroker({ protectedPaths: [devDb] });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'read',
        targets: [DEV_DB],
        runId: RUN_REVIEW,
      });
      for (const mode of ['host', 'container'] as const) {
        const outcome = await invoke({
          mode,
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'read',
          targets: [DEV_DB],
          input: { path: DEV_DB },
        });
        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error('unreachable');
        expect(outcome.code).toBe('NOT_AUTHORIZED');
        expect(outcome.reason).toContain('protected root');
      }
      expect(store.toolOperations.count()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Network boundary
  // ---------------------------------------------------------------------------

  describe('network boundary (AC-048)', () => {
    it('classifies loopback, private, link-local and metadata hosts as internal', () => {
      for (const host of [
        '127.0.0.1',
        'localhost',
        '10.0.0.5',
        '172.16.4.4',
        '192.168.1.10',
        '169.254.169.254',
        '100.64.0.1',
        '::1',
        'fe80::1',
        'fd00::1',
        'metadata.google.internal',
      ]) {
        expect(isPrivateAddress(host), host).toBe(true);
      }
      expect(isPrivateAddress('8.8.8.8')).toBe(false);
      expect(isPrivateAddress('example.com')).toBe(false);
    });

    it('refuses a private target by default and passes an exact authorized target', () => {
      const policy = new NetworkPolicy();
      const refused = policy.checkUrl('http://10.0.0.5/private');
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('NOT_AUTHORIZED');

      const loopback = policy.checkUrl('http://127.0.0.1:8080/');
      expect(loopback.ok).toBe(false);

      const scheme = policy.checkUrl('ftp://example.com/file');
      expect(scheme.ok).toBe(false);

      // W7R1-07: plain http is refused even for a private target the caller
      // authorized, unless plaintext was explicitly enabled for that endpoint.
      const insecure = new NetworkPolicy({ allowedTargets: ['127.0.0.1:8080'] });
      const insecureDecision = insecure.checkUrl('http://127.0.0.1:8080/ok');
      expect(insecureDecision.ok).toBe(false);
      if (insecureDecision.ok) throw new Error('unreachable');
      expect(insecureDecision.reason).toContain('http: is refused');

      const authorized = new NetworkPolicy({
        allowedTargets: ['127.0.0.1:8080'],
        allowInsecureHttp: true,
      });
      expect(authorized.checkUrl('http://127.0.0.1:8080/ok').ok).toBe(true);
      // The authorization is exact: another port of the same host stays refused.
      expect(authorized.checkUrl('http://127.0.0.1:8081/other').ok).toBe(false);
    });

    it('refuses a private network target before any tool runs (AC-048)', async () => {
      let executions = 0;
      const outcome = await invoke({
        operation: 'network',
        targets: [],
        input: { url: 'http://169.254.169.254/latest/meta-data/' },
        network: { url: 'http://169.254.169.254/latest/meta-data/' },
        run: () => (executions += 1),
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(executions).toBe(0);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('refuses a container network call when no Core proxy exists, even if the Grant covers it (AC-048)', async () => {
      issue({ operation: 'network', targets: [], limits: { network: 'proxy' } });
      const outcome = await invoke({
        mode: 'container',
        operation: 'network',
        targets: [],
        input: { url: 'https://public.example/' },
        network: { url: 'https://public.example/' },
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('PROVIDER_UNAVAILABLE');
      expect(outcome.reason).toContain('no Core-controlled proxy');
      expect(store.toolOperations.count()).toBe(0);
    });

    it('refuses an operation with no built-in executor instead of faking a result (AC-048)', async () => {
      const operationId = uuid(0x700000000020);
      const input = { url: 'https://public.example/' };
      issue({
        scope: 'once',
        operation: 'network',
        targets: [],
        limits: { network: 'proxy' },
        toolOperationId: operationId,
        inputHash: hashToolInput(input),
      });
      const outcome = await invoke({
        mode: 'host',
        operation: 'network',
        targets: [],
        input,
        toolOperationId: operationId,
        network: { url: 'https://public.example/' },
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('INVALID_STATE');
      expect(outcome.reason).toContain('no built-in executor');
      // The execution rolled back with its Grant consumption and tool operation.
      expect(store.toolOperations.count()).toBe(0);
      expect(store.grants.list()[0]?.consumedAt).toBeUndefined();
    });

    it('plans the hardened container invocation with no network by default (AC-048)', () => {
      const plan = planContainerRun({ command: 'id -u', roots: ['/tmp/ws'] });
      expect(plan.args).toContain('--read-only');
      expect(plan.args).toContain('--cap-drop=ALL');
      expect(plan.args).toContain('no-new-privileges');
      expect(plan.args).toContain('--tmpfs');
      expect(plan.args.join(' ')).toContain('--user 10001:10001');
      expect(plan.args.join(' ')).toContain('--network none');
      expect(plan.args.join(' ')).toContain('--volume /tmp/ws:/workspace:ro');
      expect(plan.mounts).toEqual([{ path: '/tmp/ws', target: '/workspace', mode: 'ro' }]);

      const proxied = planContainerRun({ command: 'id -u', roots: ['/tmp/ws'], network: 'proxy' });
      expect(proxied.args.join(' ')).toContain('--network bridge');

      const writable = planContainerRun({
        command: 'id -u',
        roots: ['/tmp/ws'],
        writableRoots: ['/tmp/ws'],
      });
      expect(writable.mounts[0]?.mode).toBe('rw');
    });
  });

  // ---------------------------------------------------------------------------
  // Review round 1 regressions (W7R1-01/02/04/07/09/13)
  // ---------------------------------------------------------------------------

  describe('review round 1 regressions (W7R1)', () => {
    it('refuses a hostname that DNS resolves into loopback, with no transport call (W7R1-01)', async () => {
      const policy = new NetworkPolicy({ resolver: FIXTURE_RESOLVER });
      // The literal check cannot see this name; only the resolver can.
      expect(isPrivateAddress('localtest.example')).toBe(false);
      const decision = await policy.decide({ url: 'https://localtest.example/private' });
      expect(decision.ok).toBe(false);
      if (decision.ok) throw new Error('unreachable');
      expect(decision.code).toBe('NOT_AUTHORIZED');
      expect(decision.reason).toContain('loopback/private/link-local');

      // The guarded transport refuses the same name before the transport runs.
      const fetched: string[] = [];
      const requester = new GuardedRequester({
        policy,
        resolver: FIXTURE_RESOLVER,
        fetcher: (url) => {
          fetched.push(url);
          return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () => Promise.resolve('never'),
          });
        },
      });
      const refused = await requester.request('https://localtest.example/private');
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('NOT_AUTHORIZED');
      expect(refused.hops).toEqual([{ url: 'https://localtest.example/private', allowed: false }]);
      expect(fetched).toEqual([]);

      // A redirect to that name is refused at the second hop, not followed: the
      // public origin is fetched exactly once.
      const publicFetched: string[] = [];
      const redirecting = new GuardedRequester({
        policy,
        resolver: FIXTURE_RESOLVER,
        fetcher: (url) => {
          publicFetched.push(url);
          return Promise.resolve({
            status: 302,
            headers: {
              get: (name) =>
                name.toLowerCase() === 'location' ? 'https://localtest.example/private' : null,
            },
            text: () => Promise.resolve(''),
          });
        },
      });
      const redirect = await redirecting.request('https://public.example/start');
      expect(redirect.ok).toBe(false);
      if (redirect.ok) throw new Error('unreachable');
      expect(publicFetched).toEqual(['https://public.example/start']);
      expect(redirect.blockedUrl).toBe('https://localtest.example/private');
      expect(redirect.hops.map((hop) => hop.allowed)).toEqual([true, false]);
    });

    it('refuses an authorized private literal over plain http unless plaintext was enabled (W7R1-07)', () => {
      const secure = new NetworkPolicy({ resolver: FIXTURE_RESOLVER });
      expect(secure.checkUrl('https://public.example/').ok).toBe(true);
      const http = secure.checkUrl('http://public.example/');
      expect(http.ok).toBe(false);
      if (http.ok) throw new Error('unreachable');
      expect(http.reason).toContain('https is required');

      // An explicit local test endpoint: https passes, http needs the opt-in too.
      const local = new NetworkPolicy({ allowedTargets: ['127.0.0.1:8080'] });
      expect(local.checkUrl('https://127.0.0.1:8080/ok').ok).toBe(true);
      expect(local.checkUrl('http://127.0.0.1:8080/ok').ok).toBe(false);
      const optedIn = new NetworkPolicy({
        allowedTargets: ['127.0.0.1:8080'],
        allowInsecureHttp: true,
      });
      expect(optedIn.checkUrl('http://127.0.0.1:8080/ok').ok).toBe(true);
    });

    it('classifies the hexadecimal IPv4-mapped IPv6 forms the URL parser produces (W7R1-02)', () => {
      expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
      for (const host of [
        '::ffff:7f00:1',
        '::ffff:127.0.0.1',
        '::ffff:a00:5',
        '::ffff:10.0.0.5',
        '::ffff:a9fe:a9fe',
        '::ffff:169.254.169.254',
        '::ffff:c0a8:101',
        '::ffff:6440:1',
        '::ffff:0:0',
        '64:ff9b::7f00:1',
      ]) {
        expect(isPrivateAddress(host), host).toBe(true);
        expect(isPrivateAddress(`[${host}]`), host).toBe(true);
      }
      // A public mapped address stays public; only the mapped IPv4 rule applies.
      expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
      expect(isPrivateAddress('::ffff:808:808')).toBe(false);

      const policy = new NetworkPolicy();
      expect(policy.checkUrl('http://[::ffff:7f00:1]/').ok).toBe(false);
      expect(policy.checkUrl('https://[::ffff:7f00:1]/').ok).toBe(false);
    });

    it('protects the run database without any caller-declared protected path (W7R1-04)', async () => {
      // No `protectedPaths` option at all: the roots come from the store.
      expect(broker.protectedRoots).toContain(realpathSync(dataDir));
      const plain: BrokerOptions = { store, grants, now: () => nextTime() };
      expect(new Broker(plain).protectedRoots).toContain(
        realpathSync(join(dataDir, 'project.sqlite')),
      );

      // The run database is refused by the boundary even though the caller
      // declared no protected path and the target sits inside a granted root.
      const dbPath = join(dataDir, 'project.sqlite');
      const decision = resolveWithinRoots({
        path: dbPath,
        access: 'read',
        roots: [dataDir],
        protectedPaths: broker.protectedRoots,
      });
      expect(decision.ok).toBe(false);
      if (decision.ok) throw new Error('unreachable');
      expect(decision.code).toBe('NOT_AUTHORIZED');
      expect(decision.reason).toContain('protected root');
      expect(broker.protectedRoots.some((root) => realpathSync(dbPath).startsWith(root))).toBe(
        true,
      );

      // The same read reaches a real Grant admission and is still refused: the
      // Grant itself is seeded directly because the contract's `targets` are
      // repository-relative, and this fixture deliberately lives outside the
      // repository.
      const grant = store.grants.insert({
        id: uuid(0x700000000041),
        workId: WORK_ID,
        runId: RUN_REVIEW,
        scope: 'run',
        role: 'review',
        stage: 'review',
        operation: 'read',
        targets: [dbPath],
        expiresAt: new Date(clock + 3_600_000).toISOString(),
        limits: {},
        decisionId: DECISION_ID,
      });
      expect(grant.targets).toEqual([dbPath]);
      const outcome = await broker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'read',
          targets: [dbPath],
          input: { path: dbPath },
          roots: [dataDir],
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.reason).toContain('protected root');
      expect(store.toolOperations.count()).toBe(0);
    });

    it('allows a Review report write root while refusing source (W7R1-13)', async () => {
      const reviewBroker = makeBroker({ writableReportRoots: [join(workspace, 'reports')] });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'write',
        targets: [REPORT],
        runId: RUN_REVIEW,
      });
      const allowed = await reviewBroker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'write',
          targets: [REPORT],
          access: 'write',
          input: { path: REPORT, content: '# review report\n' },
        }),
      );
      expect(allowed.ok).toBe(true);
      expect(readFileSync(join(workspace, REPORT), 'utf8')).toBe('# review report\n');

      // The source write the same role may never make stays refused, file intact.
      // It is seeded directly so the file boundary — checked before admission — is
      // what refuses it, not a missing Grant.
      const before = readFileSync(join(workspace, A), 'utf8');
      store.grants.insert({
        id: uuid(0x700000000042),
        workId: WORK_ID,
        runId: RUN_REVIEW,
        scope: 'run',
        role: 'review',
        stage: 'review',
        operation: 'write',
        targets: [A],
        expiresAt: new Date(clock + 3_600_000).toISOString(),
        limits: {},
        decisionId: DECISION_ID,
      });
      const srcInvocation = invocation({
        role: 'review',
        stage: 'review',
        runId: RUN_REVIEW,
        attemptId: ATTEMPT_REVIEW,
        operation: 'write',
        targets: [A],
        access: 'write',
        input: { path: A, content: 'mutated' },
      });
      const refused = await reviewBroker.invoke(srcInvocation);
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('NOT_AUTHORIZED');
      expect(refused.reason).toContain('report/scratch root');
      expect(readFileSync(join(workspace, A), 'utf8')).toBe(before);
    });

    it('passes container content over stdin, so a delimiter line cannot become a command (W7R1-09)', async () => {
      const calls: string[] = [];
      const stdin: (string | undefined)[] = [];
      const runner: ProcessRunner = {
        run(command, args, options): ProcessResult {
          calls.push([command, ...args].join(' '));
          stdin.push(options?.stdin);
          return { status: 0, stdout: '', stderr: '', signal: null };
        },
      };
      const containerBroker = makeBroker({ process: runner, mode: 'container' });
      const payload = `line one\nAGENTDEV_EOF\necho should-not-run\n`;
      issue({
        scope: 'once',
        operation: 'write',
        targets: [A],
        limits: {},
        toolOperationId: uuid(0x700000000030),
        inputHash: hashToolInput({ path: A, content: payload }),
      });
      const outcome = await containerBroker.invoke(
        invocation({
          mode: 'container',
          operation: 'write',
          targets: [A],
          access: 'write',
          input: { path: A, content: payload },
          toolOperationId: uuid(0x700000000030),
        }),
      );
      expect(outcome.ok).toBe(true);
      const command = calls.at(-1) ?? '';
      // The content is not in the command at all — it cannot close a here-doc.
      expect(command).not.toContain('AGENTDEV_EOF');
      expect(command).not.toContain('should-not-run');
      expect(command).toContain('base64 -d >');
      expect(stdin.at(-1)).toBe(Buffer.from(payload, 'utf8').toString('base64'));
    });
  });

  // ---------------------------------------------------------------------------
  // Test environment (required failure test)
  // ---------------------------------------------------------------------------

  describe('test environment', () => {
    it('creates its own database file and port, never the reserved dev values', async () => {
      const manager = new TestEnvironmentManager({ prefix: 'agentdev-broker-env-' });
      const created = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        command: [process.execPath, '-e', 'process.exit(0)'],
        reserved: { port: 4317, dbPath: '/tmp/agentdev-dev.sqlite' },
        portRange: { min: 4700, max: 4709 },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');
      const environment = created.environment;
      expect(environment.port).not.toBe(4317);
      expect(environment.port).toBeGreaterThanOrEqual(4700);
      expect(environment.port).toBeLessThanOrEqual(4709);
      expect(environment.dbPath.startsWith(environment.dir)).toBe(true);
      expect(environment.dbPath).not.toBe('/tmp/agentdev-dev.sqlite');
      expect(existsSync(environment.dbPath)).toBe(true);
      expect(environment.env['AGENTDEV_TEST_DB']).toBe(environment.dbPath);
      expect(environment.env['PORT']).toBe(String(environment.port));

      // A second environment never takes the first one's port.
      const second = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_B,
        command: [process.execPath, '-e', 'process.exit(0)'],
        portRange: { min: 4700, max: 4709 },
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error('unreachable');
      expect(second.environment.port).not.toBe(environment.port);

      const stopped = await manager.cleanup(environment);
      expect(stopped.ok).toBe(true);
      expect(existsSync(environment.dir)).toBe(false);
      await manager.cleanup(second.environment);
    });

    it('refuses to allocate when the only port is the reserved development port', async () => {
      const manager = new TestEnvironmentManager();
      const created = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        command: [process.execPath, '-e', 'process.exit(0)'],
        reserved: { port: 4700 },
        portRange: { min: 4700, max: 4700 },
      });
      expect(created.ok).toBe(false);
      if (created.ok) throw new Error('unreachable');
      expect(created.code).toBe('PROVIDER_UNAVAILABLE');
      expect(created.reason).toContain('refusing to reuse the development port');
    });

    it('reports a temp-directory cleanup failure as RECOVERY_REQUIRED (required failure test)', async () => {
      const ports: TestEnvironmentPorts = {
        ...defaultTestEnvironmentPorts,
        removeDir: () => {
          throw new Error('EBUSY: resource busy or locked');
        },
      };
      const manager = new TestEnvironmentManager({ ports, prefix: 'agentdev-broker-cleanup-' });
      const created = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        command: [process.execPath, '-e', 'process.exit(0)'],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');

      const cleanup = await manager.cleanup(created.environment);
      expect(cleanup.ok).toBe(false);
      if (cleanup.ok) throw new Error('unreachable');
      expect(cleanup.code).toBe('RECOVERY_REQUIRED');
      expect(cleanup.failures.join('; ')).toContain('EBUSY');
      expect(cleanup.environment.state).toBe('cleanup_failed');
      // The state is tracked, so a supervisor can retry the real removal.
      expect(manager.get(created.environment.id)?.state).toBe('cleanup_failed');
      rmSync(created.environment.dir, { recursive: true, force: true });
    });

    it('skips a port the OS has already taken and one a sibling manager holds (W7R1-05)', async () => {
      // An external listener on a port inside the window: the review's failing
      // probe showed `create` handing it out and `start` then reporting running on
      // somebody else's socket.
      const occupied = createServer();
      await new Promise<void>((settle) => {
        occupied.listen(0, '127.0.0.1', () => {
          settle();
        });
      });
      const occupiedPort = (occupied.address() as { port: number }).port;
      const manager = new TestEnvironmentManager({ prefix: 'agentdev-broker-port-' });
      try {
        const created = await manager.create({
          workId: WORK_ID,
          attemptId: ATTEMPT_A,
          command: [process.execPath, '-e', 'process.exit(0)'],
          portRange: { min: occupiedPort, max: occupiedPort + 1 },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) throw new Error('unreachable');
        expect(created.environment.port).toBe(occupiedPort + 1);

        // Two managers never receive the same port, even though each one's own
        // bookkeeping is empty.
        const other = new TestEnvironmentManager({ prefix: 'agentdev-broker-port-b-' });
        const second = await other.create({
          workId: WORK_ID,
          attemptId: ATTEMPT_B,
          command: [process.execPath, '-e', 'process.exit(0)'],
          portRange: { min: created.environment.port, max: created.environment.port + 1 },
        });
        expect(second.ok).toBe(true);
        if (!second.ok) throw new Error('unreachable');
        expect(second.environment.port).not.toBe(created.environment.port);
        expect(claimedTestPorts()).toEqual(
          expect.arrayContaining([created.environment.port, second.environment.port]),
        );

        await manager.cleanup(created.environment);
        await other.cleanup(second.environment);
      } finally {
        await new Promise<void>((settle) => {
          occupied.close(() => {
            settle();
          });
        });
      }
    });

    it('reports a child that dies before readiness as failed, never running (W7R1-05)', async () => {
      const manager = new TestEnvironmentManager({ prefix: 'agentdev-broker-dead-' });
      const created = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        // It exits immediately without ever listening on `$PORT`.
        command: [process.execPath, '-e', 'process.exit(3)'],
        portRange: { min: 4770, max: 4779 },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');

      const started = await manager.start(created.environment, { readinessTimeoutMs: 3_000 });
      expect(started.ok).toBe(false);
      if (started.ok) throw new Error('unreachable');
      expect(started.code).toBe('INVALID_STATE');
      expect(started.reason).toContain('before it owned');
      expect(started.environment.state).toBe('failed');
      // A failed environment never executes commands.
      const run = manager.run(started.environment, [process.execPath, '-e', 'process.exit(0)']);
      expect(run.ok).toBe(false);
      await manager.cleanup(started.environment);
    });

    it('reports a process-group cleanup failure as RECOVERY_REQUIRED (required failure test)', async () => {
      const ports: TestEnvironmentPorts = {
        ...defaultTestEnvironmentPorts,
        signal: () => {
          throw new Error('EPERM: not permitted to signal the group');
        },
        alive: () => true,
      };
      const manager = new TestEnvironmentManager({ ports, stopGraceMs: 60 });
      const environment: TestEnvironment = {
        id: 'env-cleanup-failure',
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        dir: '/tmp/agentdev-does-not-exist',
        dbPath: '/tmp/agentdev-does-not-exist/test.sqlite',
        host: '127.0.0.1',
        port: 4788,
        env: {},
        command: [],
        state: 'running',
        pid: 4_242,
        reserved: {},
      };
      const stopped = await manager.stop(environment);
      expect(stopped.ok).toBe(false);
      if (stopped.ok) throw new Error('unreachable');
      expect(stopped.code).toBe('RECOVERY_REQUIRED');
      expect(stopped.failures.join('; ')).toContain('EPERM');
      expect(stopped.failures.join('; ')).toContain('still alive after SIGKILL');
    });
  });

  // ---------------------------------------------------------------------------
  // Review round 2 (W7R2-01..08)
  // ---------------------------------------------------------------------------

  describe('review round 2 regressions (W7R2)', () => {
    it('refuses a read-only role a host bash write to source, leaving the file intact (W7R2-01)', async () => {
      const before = readFileSync(join(workspace, A), 'utf8');
      // The Grant is issued on purpose: the write channel was authorized, and the
      // refusal must come from the capability gate rather than from a missing Grant.
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'bash',
        targets: [A],
        runId: RUN_REVIEW,
      });
      const outcome = await broker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'bash',
          targets: [A],
          input: { command: `printf 'pwned-by-review' > ${join(workspace, A)}` },
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.reason).toContain('arbitrary command');
      expect(outcome.fields).toContain('operation');
      expect(readFileSync(join(workspace, A), 'utf8')).toBe(before);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('refuses a read-only role a host git write to source (W7R2-01)', async () => {
      const before = readFileSync(join(workspace, A), 'utf8');
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'git',
        targets: [A],
        runId: RUN_REVIEW,
      });
      const outcome = await broker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'git',
          targets: [A],
          input: { command: `git -C ${workspace} add -A` },
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(readFileSync(join(workspace, A), 'utf8')).toBe(before);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('strips caller writableRoots for a read-only role in container mode (W7R2-01)', async () => {
      const runs: string[][] = [];
      const runner: ProcessRunner = {
        run(command, args): ProcessResult {
          runs.push([command, ...args]);
          return { status: 0, stdout: '', stderr: '', signal: null };
        },
      };
      const reportRoot = join(workspace, 'reports');
      const containerBroker = makeBroker({
        mode: 'container',
        process: runner,
        writableReportRoots: [reportRoot],
      });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'write',
        targets: [REPORT],
        runId: RUN_REVIEW,
      });
      const outcome = await containerBroker.invoke(
        invocation({
          mode: 'container',
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'write',
          targets: [REPORT],
          access: 'write',
          input: { path: REPORT, content: '# review report\n' },
          roots: [workspace],
          // A caller asking for the source tree to be writable must be ignored.
          writableRoots: [workspace],
        }),
      );
      expect(outcome.ok).toBe(true);
      const dockerArgs = runs.find((entry) => entry[0] === 'docker') ?? [];
      const volumes = dockerArgs.filter((arg, index) => dockerArgs[index - 1] === '--volume');
      // The report root is the only rw mount; the source root stays ro.
      expect(volumes.some((volume) => volume.endsWith('/mnt/agentdev-1:rw'))).toBe(true);
      expect(volumes.some((volume) => volume.endsWith('/workspace:ro'))).toBe(true);
      expect(volumes.some((volume) => volume.endsWith('/workspace:rw'))).toBe(false);
    });

    it('refuses a read-only role a non-path mutating tool even with a report root (W7R2-01)', async () => {
      const reviewBroker = makeBroker({ writableReportRoots: [join(workspace, 'reports')] });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'push',
        targets: [A],
        runId: RUN_REVIEW,
      });
      const outcome = await reviewBroker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'push',
          targets: [A],
          access: 'write',
          input: {},
          run: () => {
            throw new Error('a read-only role must never reach the tool body');
          },
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.fields).toContain('operation');
      expect(store.toolOperations.count()).toBe(0);
    });

    it('still admits a report write for a read-only role (W7R2-01)', async () => {
      const reviewBroker = makeBroker({ writableReportRoots: [join(workspace, 'reports')] });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'write',
        targets: [REPORT],
        runId: RUN_REVIEW,
      });
      const allowed = await reviewBroker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'write',
          targets: [REPORT],
          access: 'write',
          input: { path: REPORT, content: '# report\n' },
        }),
      );
      expect(allowed.ok).toBe(true);
      expect(readFileSync(join(workspace, REPORT), 'utf8')).toBe('# report\n');
    });

    it('still runs an arbitrary-command tool for a write-capable role (W7R2-01)', async () => {
      issue({ operation: 'bash', targets: [A] });
      const outcome = await broker.invoke(
        invocation({
          operation: 'bash',
          input: { command: `"${process.execPath}" -e 'process.stdout.write("host-ok")'` },
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.reason);
      expect((outcome.result as ProcessResult).stdout).toBe('host-ok');
    });

    it('refuses a target whose DNS answer is private before consuming the Grant (W7R2-02)', async () => {
      const operationId = uuid(0x700000000050);
      const input = { url: 'https://localtest.example/private' };
      issue({
        scope: 'once',
        operation: 'network',
        targets: ['localtest.example'],
        toolOperationId: operationId,
        inputHash: hashToolInput(input),
      });
      const outcome = await broker.invoke(
        invocation({
          operation: 'network',
          targets: ['localtest.example'],
          input,
          toolOperationId: operationId,
          network: { url: 'https://localtest.example/private' },
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      // The refusal happened before admission: no consumption, no audit row.
      expect(store.grants.list()[0]?.consumedAt).toBeUndefined();
      expect(store.toolOperations.count()).toBe(0);
    });

    it('still admits a public address literal at admission (W7R2-02)', async () => {
      issue({ operation: 'network', targets: ['93.184.216.34'] });
      const outcome = await broker.invoke(
        invocation({
          operation: 'network',
          targets: ['93.184.216.34'],
          input: { url: 'https://93.184.216.34/' },
          network: { url: 'https://93.184.216.34/' },
          run: () => 'network-ok',
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.reason);
      expect(outcome.result).toBe('network-ok');
    });

    it('pins the transport to the address the policy validated (W7R2-03)', async () => {
      const resolver: HostResolver = {
        resolve: () => Promise.resolve({ ok: true, addresses: ['93.184.216.34'] }),
      };
      const policy = new NetworkPolicy({ resolver });
      const seen: (readonly string[] | undefined)[] = [];
      const requester = new GuardedRequester({
        policy,
        resolver,
        fetcher: (url, init) => {
          seen.push(init.pinnedAddresses);
          return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () => Promise.resolve('ok'),
          });
        },
      });
      const outcome = await requester.request('https://public.example/');
      expect(outcome.ok).toBe(true);
      expect(seen).toEqual([['93.184.216.34']]);
    });

    it('never lets a rebinding answer reach the second address (W7R2-03)', async () => {
      let lookups = 0;
      const rebinding: HostResolver = {
        resolve: () => {
          lookups += 1;
          return Promise.resolve({
            ok: true,
            addresses: [lookups === 1 ? '93.184.216.34' : '127.0.0.1'],
          });
        },
      };
      const policy = new NetworkPolicy({ resolver: rebinding });
      const connected: string[] = [];
      const requester = new GuardedRequester({
        policy,
        resolver: rebinding,
        fetcher: async (url, init) => {
          const pinned = init.pinnedAddresses?.[0];
          if (pinned !== undefined) {
            connected.push(pinned);
          } else {
            // Models a transport that resolves the name itself: a rebinding stub
            // would hand it the *second* answer.
            const again = await rebinding.resolve(new URL(url).hostname);
            connected.push(again.ok ? (again.addresses[0] ?? '') : '');
          }
          return {
            status: 200,
            headers: { get: () => null },
            text: () => Promise.resolve('ok'),
          };
        },
      });
      const outcome = await requester.request('https://public.example/');
      expect(outcome.ok).toBe(true);
      expect(connected).toEqual(['93.184.216.34']);
      expect(lookups).toBe(1);
    });

    it('connects to the pinned address through the built-in transport (W7R2-03)', async () => {
      const server = createHttpServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('pinned-ok');
      });
      await new Promise<void>((settle) => {
        server.listen(0, '127.0.0.1', () => {
          settle();
        });
      });
      const port = (server.address() as AddressInfo).port;
      const resolver: HostResolver = {
        resolve: () => Promise.resolve({ ok: true, addresses: ['127.0.0.1'] }),
      };
      const policy = new NetworkPolicy({
        resolver,
        allowedTargets: [`rebind.example:${String(port)}`],
        allowInsecureHttp: true,
      });
      const requester = new GuardedRequester({ policy, resolver });
      try {
        // The name is not in DNS at all; only the validated (pinned) address can
        // explain a successful connection.
        const outcome = await requester.request(`http://rebind.example:${String(port)}/`);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) throw new Error(outcome.reason);
        expect(outcome.body).toBe('pinned-ok');
      } finally {
        await new Promise<void>((settle) => {
          server.close(() => {
            settle();
          });
        });
      }
    });

    it('turns a throwing resolver into a refusal instead of an exception (W7R2-05)', async () => {
      const resolver: HostResolver = {
        resolve() {
          throw new Error('resolver exploded');
        },
      };
      const policy = new NetworkPolicy({ resolver });
      const decision = await policy.decide({ url: 'https://public.example/' });
      expect(decision.ok).toBe(false);
      if (decision.ok) throw new Error('unreachable');
      expect(decision.code).toBe('NOT_AUTHORIZED');
      expect(decision.reason).toContain('resolver exploded');

      const requester = new GuardedRequester({
        policy,
        resolver,
        fetcher: () =>
          Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () => Promise.resolve('never'),
          }),
      });
      const outcome = await requester.request('https://public.example/');
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.blockedUrl).toBe('https://public.example/');
    });

    it('decodes local-use NAT64 prefixes and treats undecodable ones as private (W7R2-06)', async () => {
      expect(classifyAddressLiteral('64:ff9b::7f00:1')).toBe(true);
      expect(classifyAddressLiteral('64:ff9b:1::7f00:1')).toBe(true);
      expect(classifyAddressLiteral('64:ff9b:1::a00:1')).toBe(true);
      // The prefix set is configurable for a site-specific translator.
      expect(classifyAddressLiteral('2001:db8:64::7f00:1', ['2001:db8:64::/96'])).toBe(true);
      // A matching NAT64 address whose embedded IPv4 cannot be decoded is private,
      // never public.
      expect(classifyAddressLiteral('64:ff9b:1:1:0:0:7f00:1')).toBe(true);
      // The policy applies the same decoding to literals.
      const policy = new NetworkPolicy({ nat64Prefixes: ['2001:db8:64::/96'] });
      const decision = await policy.decide({ url: 'https://[2001:db8:64::7f00:1]/' });
      expect(decision.ok).toBe(false);
    });

    it('refuses readiness when the port is owned by an external listener (W7R2-07)', async () => {
      const manager = new TestEnvironmentManager({ prefix: 'agentdev-broker-owner-' });
      const probe = await freePort();
      const created = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        // Alive, but it never listens: without an ownership proof the listener
        // below would be reported as this environment's readiness.
        command: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'],
        portRange: { min: probe, max: probe },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');
      const external = createServer();
      await new Promise<void>((settle) => {
        external.listen(created.environment.port, '127.0.0.1', () => {
          settle();
        });
      });
      try {
        const started = await manager.start(created.environment, { readinessTimeoutMs: 3_000 });
        expect(started.ok).toBe(false);
        if (started.ok) throw new Error('unreachable');
        expect(started.code).toBe('INVALID_STATE');
        expect(started.reason).toContain('owned by pid');
      } finally {
        await new Promise<void>((settle) => {
          external.close(() => {
            settle();
          });
        });
        await manager.cleanup(created.environment);
      }
    });

    it('releases a claimed port when create fails, so a later create succeeds (W7R2-08)', async () => {
      const probe = await freePort();
      const ports: TestEnvironmentPorts = {
        ...defaultTestEnvironmentPorts,
        createDir: () => {
          throw new Error('ENOSPC: no space left on device');
        },
      };
      const manager = new TestEnvironmentManager({ ports, prefix: 'agentdev-broker-leak-' });
      const failed = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        command: [process.execPath, '-e', 'process.exit(0)'],
        portRange: { min: probe, max: probe },
      });
      expect(failed.ok).toBe(false);
      if (failed.ok) throw new Error('unreachable');
      expect(failed.code).toBe('PROVIDER_UNAVAILABLE');
      expect(failed.reason).toContain('ENOSPC');
      // The claim did not outlive the failed creation.
      expect(claimedTestPorts()).not.toContain(probe);

      const healthy = new TestEnvironmentManager({ prefix: 'agentdev-broker-leak-b-' });
      const created = await healthy.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_B,
        command: [process.execPath, '-e', 'process.exit(0)'],
        portRange: { min: probe, max: probe },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.reason);
      await healthy.cleanup(created.environment);
    });
  });

  // ---------------------------------------------------------------------------
  // Review round 3 (W7R3-01..05)
  // ---------------------------------------------------------------------------

  describe('review round 3 regressions (W7R3)', () => {
    it('refuses a read-only role writeFile to source from a read body, leaving the file intact (W7R3-01)', async () => {
      const before = readFileSync(join(workspace, A), 'utf8');
      const reviewBroker = makeBroker({ writableReportRoots: [join(workspace, 'reports')] });
      // The Grant is issued on purpose: the refusal must come from the tool
      // context, not from a missing Grant.
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'read',
        targets: [A],
        runId: RUN_REVIEW,
      });
      const outcome = await reviewBroker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'read',
          targets: [A],
          run: (context) => context.writeFile(join(workspace, A), 'pwned-via-run-writeFile'),
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(readFileSync(join(workspace, A), 'utf8')).toBe(before);
      expect(store.grants.list()[0]?.consumedAt).toBeUndefined();
      expect(store.toolOperations.count()).toBe(0);
    });

    it('refuses a read-only role ctx.run from a read body, leaving the file intact (W7R3-01)', async () => {
      const before = readFileSync(join(workspace, A), 'utf8');
      const reviewBroker = makeBroker({ writableReportRoots: [join(workspace, 'reports')] });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'read',
        targets: [A],
        runId: RUN_REVIEW,
      });
      const outcome = await reviewBroker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'read',
          targets: [A],
          run: (context) => context.run(`printf 'pwned-via-run-shell' > ${join(workspace, A)}`),
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.reason).toContain('cannot execute shell commands');
      expect(readFileSync(join(workspace, A), 'utf8')).toBe(before);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('still admits a report-root body write for a read-only role (W7R3-01)', async () => {
      const reviewBroker = makeBroker({ writableReportRoots: [join(workspace, 'reports')] });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'write',
        targets: [REPORT],
        runId: RUN_REVIEW,
      });
      const outcome = await reviewBroker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'write',
          targets: [REPORT],
          access: 'write',
          input: { path: REPORT, content: '# report\n' },
          run: (context) => {
            context.writeFile(join(workspace, REPORT), '# written through the body\n');
            return 'report-written';
          },
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.reason);
      expect(outcome.result).toBe('report-written');
      expect(readFileSync(join(workspace, REPORT), 'utf8')).toBe('# written through the body\n');
    });

    it('refuses ctx.run inside an admitted report write body for a read-only role (W7R3-01)', async () => {
      const before = readFileSync(join(workspace, A), 'utf8');
      const reviewBroker = makeBroker({ writableReportRoots: [join(workspace, 'reports')] });
      issue({
        role: 'review',
        stage: 'review',
        scope: 'run',
        operation: 'write',
        targets: [REPORT],
        runId: RUN_REVIEW,
      });
      const outcome = await reviewBroker.invoke(
        invocation({
          role: 'review',
          stage: 'review',
          runId: RUN_REVIEW,
          attemptId: ATTEMPT_REVIEW,
          operation: 'write',
          targets: [REPORT],
          access: 'write',
          input: { path: REPORT, content: '# report\n' },
          run: (context) => context.run(`printf 'pwned-report-body' > ${join(workspace, A)}`),
        }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(readFileSync(join(workspace, A), 'utf8')).toBe(before);
      expect(store.toolOperations.count()).toBe(0);
    });

    it('still gives a write-capable role both writeFile and run (W7R3-01)', async () => {
      issue({ operation: 'bash', targets: [A] });
      const outcome = await broker.invoke(
        invocation({
          operation: 'bash',
          input: { command: 'true' },
          run: (context) => {
            context.writeFile(join(workspace, B), 'from-body\n');
            return context.run(`"${process.execPath}" -e 'process.stdout.write("body-ok")'`);
          },
        }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.reason);
      expect((outcome.result as ProcessResult).stdout).toBe('body-ok');
      expect(readFileSync(join(workspace, B), 'utf8')).toBe('from-body\n');
    });

    it('turns a transport error into a structured refusal (W7R3-03)', async () => {
      const policy = new NetworkPolicy({ resolver: FIXTURE_RESOLVER });
      const requester = new GuardedRequester({
        policy,
        resolver: FIXTURE_RESOLVER,
        fetcher: () => Promise.reject(new Error('connect ECONNREFUSED 93.184.216.34:443')),
      });
      const outcome = await requester.request('https://public.example/');
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('PROVIDER_UNAVAILABLE');
      expect(outcome.reason).toContain('ECONNREFUSED');
      expect(outcome.blockedUrl).toBe('https://public.example/');
    });

    it('returns a PROVIDER_UNAVAILABLE result when the port probe throws (W7R3-04)', async () => {
      const ports: TestEnvironmentPorts = {
        ...defaultTestEnvironmentPorts,
        portAvailable: () => {
          throw new Error('probe exploded');
        },
      };
      const manager = new TestEnvironmentManager({ ports, prefix: 'agentdev-broker-probe-' });
      const outcome = await manager.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        command: [process.execPath, '-e', 'process.exit(0)'],
        portRange: { min: 4760, max: 4762 },
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('PROVIDER_UNAVAILABLE');
      expect(outcome.reason).toContain('probe exploded');
      // The probe throws before any claim is recorded, so no port leaked.
      expect(claimedTestPorts()).not.toContain(4760);
    });

    it('carries a literal target its own address, pinning the transport (W7R3-05)', async () => {
      const decision = await new NetworkPolicy({}).decide({ url: 'https://93.184.216.34/' });
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error('unreachable');
      expect(decision.addresses).toEqual(['93.184.216.34']);
    });
  });
});
