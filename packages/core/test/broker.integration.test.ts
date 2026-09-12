/**
 * WP-07 T3 integration — real child processes, a real loopback HTTP server and
 * the real Docker execution image (AC-048, AC-050).
 *
 * This suite is deliberately offline: the only network endpoints it touches are a
 * server it starts on `127.0.0.1`, and the "external" address it refuses is a
 * link-local address that is never contacted.
 *
 * Docker-backed cases skip with a clear message when the daemon is down or the
 * execution image is missing. The **no-Docker refusal** is not tested here: it
 * runs deterministically with an injected probe in `broker.test.ts`, so the
 * required failure test never depends on this host's daemon.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  Broker,
  EXEC_IMAGE,
  GrantStore,
  NetworkPolicy,
  TestEnvironmentManager,
  hashToolInput,
  portOpen,
  type GrantIssueInput,
  type ProcessResult,
  type ToolInvocation,
  type ToolOutcome,
} from '../src/index.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e00';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e10';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e50';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e40';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e30';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);
const A = 'src/a.ts';

const SCOPE: Scope = {
  readPaths: [A],
  writePaths: [A],
  operations: ['read', 'bash'],
  networkTargets: [],
};

interface Harness {
  readonly workspace: string;
  readonly store: ProjectStore;
  readonly grants: GrantStore;
  readonly broker: Broker;
  dispose(): void;
}

function makeHarness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-broker-int-data-'));
  const workspace = mkdtempSync(join(tmpdir(), 'agentdev-broker-int-ws-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, A), 'export const a = 1;\n', 'utf8');
  // The container runs as uid 10001; the bind mount must be traversable by it.
  chmodSync(workspace, 0o755);
  chmodSync(join(workspace, 'src'), 0o755);
  chmodSync(join(workspace, A), 0o644);

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
    purpose: 'deliver WP-07 T3 broker integration',
    level: 'L2',
    goal: 'exercise the real tool boundary',
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
  store.runs.insert({
    id: RUN_A,
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
    runId: RUN_A,
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
    choices: ['allow', 'deny'],
    state: 'accepted',
    choice: 'allow',
    actor: 'user',
    effectRefs: [],
  });
  const grants = new GrantStore({ store });
  const broker = new Broker({ store, grants });
  return {
    workspace,
    store,
    grants,
    broker,
    dispose: () => {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
    },
  };
}

function issue(harness: Harness, overrides: Partial<GrantIssueInput> = {}): void {
  const outcome = harness.grants.issue({
    workId: WORK_ID,
    role: 'backend',
    stage: 'develop-L2',
    scope: 'run',
    operation: 'read',
    targets: [A],
    runId: RUN_A,
    decisionId: DECISION_ID,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  });
  if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
}

function invocation(harness: Harness, overrides: Partial<ToolInvocation> = {}): ToolInvocation {
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
    roots: [harness.workspace],
    ...overrides,
  };
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

/**
 * Probed once, before any test runs, so the Docker-backed case can `skipIf`
 * instead of failing the suite when this host has no daemon (the no-Docker
 * refusal itself is covered deterministically in `broker.test.ts`).
 */
const DOCKER = dockerStatus();
if (!DOCKER.ready) {
  console.warn(`[broker.integration] container cases skipped: ${DOCKER.reason}`);
}

describe('Broker integration (AC-048, AC-050)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it('runs a real host child process through an admitted Grant (AC-048)', () => {
    issue(harness, { operation: 'bash', targets: [A] });
    const command = `"${process.execPath}" -e 'process.stdout.write("host-ok")'`;
    const outcome: ToolOutcome = harness.broker.invoke(
      invocation(harness, { operation: 'bash', input: { command } }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    const result = outcome.result as ProcessResult;
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('host-ok');
    expect(harness.store.toolOperations.find(outcome.toolOperationId)?.state).toBe('finished');
  });

  it('refuses a redirect to a link-local address without following it (required failure test)', async () => {
    const hits: string[] = [];
    const server = createServer((request, response) => {
      hits.push(request.url ?? '');
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('hello');
    });
    await new Promise<void>((settle) => {
      server.listen(0, '127.0.0.1', () => {
        settle();
      });
    });
    const { port } = server.address() as AddressInfo;
    try {
      // The loopback origin is explicitly authorized, so the first hop is legal.
      const requester = harness.broker.networkRequester({
        allowedNetworkTargets: [`127.0.0.1:${port}`],
      });

      const positive = await requester.request(`http://127.0.0.1:${port}/ok`);
      expect(positive.ok).toBe(true);
      if (!positive.ok) throw new Error('unreachable');
      expect(positive.body).toBe('hello');

      const outcome = await requester.request(`http://127.0.0.1:${port}/redirect`);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.code).toBe('NOT_AUTHORIZED');
      expect(outcome.blockedUrl).toContain('169.254.169.254');
      // Exactly one request reached the server: the disallowed hop was never fetched.
      expect(hits.filter((hit) => hit === '/redirect')).toHaveLength(1);
      expect(hits).toHaveLength(2);
      expect(outcome.hops.map((hop) => hop.allowed)).toEqual([true, false]);
    } finally {
      await new Promise<void>((settle) => {
        server.close(() => {
          settle();
        });
      });
    }
  });

  it('refuses a private network target before any request (required failure test)', () => {
    const policy = new NetworkPolicy();
    const decision = policy.checkUrl('http://10.0.0.5/private');
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('unreachable');
    expect(decision.code).toBe('NOT_AUTHORIZED');
    expect(decision.reason).toContain('10.0.0.5');
  });

  it('runs a command inside a real isolated test environment and cleans it up', async () => {
    const manager = new TestEnvironmentManager({ prefix: 'agentdev-broker-int-env-' });
    const script =
      "const http=require('http');const s=http.createServer((q,r)=>{r.end('env-ok')});s.listen(Number(process.env.PORT),'127.0.0.1');";
    const created = manager.create({
      workId: WORK_ID,
      attemptId: ATTEMPT_A,
      command: [process.execPath, '-e', script],
      reserved: { port: 4317, dbPath: '/tmp/agentdev-dev.sqlite' },
      portRange: { min: 4710, max: 4719 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    const environment = created.environment;

    const started = await manager.start(environment);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.reason);
    const running = started.environment;
    expect(running.state).toBe('running');
    expect(running.pid).toBeDefined();

    try {
      // The environment really listens on its own port.
      const response = await fetch(`http://127.0.0.1:${String(running.port)}/`);
      expect(await response.text()).toBe('env-ok');
      expect(await portOpen(running.host, running.port)).toBe(true);

      // A command run inside it sees only this environment's database.
      const command = manager.run(running, [
        process.execPath,
        '-e',
        'process.stdout.write(process.env.AGENTDEV_TEST_DB)',
      ]);
      expect(command.ok).toBe(true);
      if (!command.ok) throw new Error(command.reason);
      expect(command.result.stdout).toBe(running.dbPath);
      expect(command.result.stdout).not.toBe('/tmp/agentdev-dev.sqlite');
    } finally {
      const cleaned = await manager.cleanup(running);
      expect(cleaned.ok).toBe(true);
      expect(cleaned.environment.state).toBe('stopped');
    }
    expect(await portOpen(running.host, running.port)).toBe(false);
  });

  it.skipIf(!DOCKER.ready)(
    'runs a container read through Docker and reports the real non-root account',
    () => {
      issue(harness, { operation: 'read', targets: [A] });
      const read = harness.broker.invoke(
        invocation(harness, { mode: 'container', operation: 'read', input: { path: A } }),
      );
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error(read.reason);
      expect(read.result).toContain('export const a = 1;');
      // The read-only source mount was not modified by the container.
      expect(readFileSync(join(harness.workspace, A), 'utf8')).toBe('export const a = 1;\n');

      issue(harness, { operation: 'bash', targets: [A] });
      const identity = harness.broker.invoke(
        invocation(harness, { mode: 'container', operation: 'bash', input: { command: 'id -u' } }),
      );
      expect(identity.ok).toBe(true);
      if (!identity.ok) throw new Error(identity.reason);
      expect((identity.result as ProcessResult).stdout.trim()).toBe('10001');
    },
  );

  it('keeps the once result replayable across a real execution (AC-080)', () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e70';
    const input = { path: A };
    issue(harness, {
      scope: 'once',
      operation: 'read',
      targets: [A],
      toolOperationId: operationId,
      inputHash: hashToolInput(input),
    });
    const first = harness.broker.invoke(
      invocation(harness, { toolOperationId: operationId, input }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    const second = harness.broker.invoke(
      invocation(harness, { toolOperationId: operationId, input }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.outcome).toBe('replayed');
    expect(second.result).toBe(first.result);
  });
});
