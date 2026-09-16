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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  Broker,
  EXEC_IMAGE,
  GrantStore,
  NetworkPolicy,
  StageGate,
  TestEnvironmentManager,
  TestEvidenceRegistry,
  buildTestCheckResult,
  hashToolInput,
  portOpen,
  probeDockerAvailability,
  type DockerAvailability,
  type GrantIssueInput,
  type ProcessResult,
  type ToolInvocation,
  type ToolOutcome,
} from '../src/index.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e00';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e10';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e50';
const ATTEMPT_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e51';
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
  readonly dataDir: string;
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
  // `allowInsecureHttp` is the explicit opt-in W7R1-07 requires for the plaintext
  // loopback test endpoint this suite starts; the target still has to be
  // authorized per call, so no other host gains a plaintext path.
  const broker = new Broker({
    store,
    grants,
    allowInsecureHttp: true,
    // The file measured availability once with a bounded wait on the real probe
    // (`measureDocker`); the Broker's per-call re-probe is the timing assumption that
    // made `:505` flip under load. Execution stays real: `docker run` still runs here.
    docker: () => DOCKER.availability,
  });
  return {
    workspace,
    dataDir,
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

/**
 * The built entry point of a workspace package, for a real child process.
 *
 * `vitest` aliases `@agentdev/*` to sources for the test process, but a spawned
 * `node` has no such alias, so the cross-process case imports the compiled
 * package. When the build is missing or stale, `pnpm build` is run once first, so
 * the case tests the code under review instead of an older build.
 */
function builtEntry(name: 'core' | 'storage'): string {
  const root = process.cwd();
  const entry = join(root, 'packages', name, 'dist', 'index.js');
  // The whole source directory counts: a change to `grants.ts` does not touch
  // `index.ts`, so comparing only the entry file would test a stale build.
  const sourceRoot = join(root, 'packages', name, 'src');
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) sources.push(path);
    }
  };
  walk(sourceRoot);
  const newestSource = Math.max(...sources.map((file) => statSync(file).mtimeMs));
  const stale = !existsSync(entry) || statSync(entry).mtimeMs < newestSource;
  if (stale) {
    const built = spawnSync('pnpm', ['build'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 300_000,
    });
    if (built.status !== 0 || !existsSync(entry)) {
      throw new Error(`pnpm build is required for the cross-process case: ${built.stderr}`);
    }
  }
  return pathToFileURL(entry).href;
}

interface DockerState {
  readonly ready: boolean;
  readonly reason: string;
  /** The measured availability the harness hands to the Broker's injectable probe. */
  readonly availability: DockerAvailability;
}

/** How long the file waits for a real `docker version` answer before skipping. */
const DOCKER_PROBE_DEADLINE_MS = 60_000;
/** Interval between real probes while the daemon is slow; never a substitute for one. */
const DOCKER_PROBE_INTERVAL_MS = 1_000;

/** Blocks the calling thread; module scope cannot await. */
function waitMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Measures real Docker availability **once**, with a bounded wait on the real probe.
 *
 * The Broker re-probes `docker version` on *every* container call through
 * `probeDockerAvailability`, with its own 15 s budget, and refuses the call with
 * `PROVIDER_UNAVAILABLE` **before** executing anything when that probe does not answer
 * in time. A Docker VM under load can answer later than 15 s: with the probe delayed
 * past its budget this file failed at `broker.integration.test.ts:505` with
 * `spawnSync docker ETIMEDOUT` — the per-call probe, not the container behavior under
 * test. So availability is measured here (the product's own probe, retried until the
 * daemon answers or the deadline passes) and the measurement is handed to the Broker
 * through its injectable `docker` seam, so the container path still executes for real.
 *
 * The refusal path keeps deterministic coverage in `broker.test.ts` (W7R3-04) and the
 * probe itself in the `apps/cli` doctor integration.
 */
function measureDocker(): DockerState {
  const imagePresent = (): boolean =>
    spawnSync('docker', ['image', 'inspect', EXEC_IMAGE], { encoding: 'utf8' }).status === 0;
  const deadline = Date.now() + DOCKER_PROBE_DEADLINE_MS;
  for (;;) {
    const last = probeDockerAvailability(EXEC_IMAGE);
    if (last.available) {
      return imagePresent()
        ? { ready: true, reason: '', availability: last }
        : {
            ready: false,
            reason: `the execution image ${EXEC_IMAGE} is not built locally`,
            availability: last,
          };
    }
    // A daemon that is *down* fails fast and must not hold the suite for a minute;
    // only a probe that timed out is worth waiting on (that is the load condition).
    const timedOut = last.reason.includes('ETIMEDOUT');
    if (!timedOut || Date.now() >= deadline) {
      return { ready: false, reason: last.reason, availability: last };
    }
    waitMs(DOCKER_PROBE_INTERVAL_MS);
  }
}

/**
 * Probed once, before any test runs, so the Docker-backed case can `skipIf`
 * instead of failing the suite when this host has no daemon (the no-Docker
 * refusal itself is covered deterministically in `broker.test.ts`).
 */
const DOCKER = measureDocker();
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

  it('runs a real host child process through an admitted Grant (AC-048)', async () => {
    issue(harness, { operation: 'bash', targets: [A] });
    const command = `"${process.execPath}" -e 'process.stdout.write("host-ok")'`;
    const outcome: ToolOutcome = await harness.broker.invoke(
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

  it('refuses the two fixed network denials before any request (required failure test, W6)', () => {
    const policy = new NetworkPolicy({ daemonPorts: () => [4318] });
    // §7.1: a private address is ordinary development and is admitted.
    expect(policy.checkUrl('http://10.0.0.5/private').ok).toBe(true);
    // The fixed denials are the metadata space and the daemon's own bound ports.
    const metadata = policy.checkUrl('http://169.254.169.254/latest/meta-data/');
    expect(metadata.ok).toBe(false);
    if (metadata.ok) throw new Error('unreachable');
    expect(metadata.code).toBe('NOT_AUTHORIZED');
    expect(metadata.reason).toContain('metadata');
    const daemonPort = policy.checkUrl('http://127.0.0.1:4318/control');
    expect(daemonPort.ok).toBe(false);
    if (daemonPort.ok) throw new Error('unreachable');
    expect(daemonPort.reason).toContain('daemon itself is listening on');
  });

  it('runs a command inside a real isolated test environment and cleans it up', async () => {
    const manager = new TestEnvironmentManager({ prefix: 'agentdev-broker-int-env-' });
    const script =
      "const http=require('http');const s=http.createServer((q,r)=>{r.end('env-ok')});s.listen(Number(process.env.PORT),'127.0.0.1');";
    const created = await manager.create({
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

  it('never hands the same port to a second manager, and skips an occupied one (W7R1-05)', async () => {
    const script =
      "const http=require('http');const s=http.createServer((q,r)=>{r.end('env-ok')});s.listen(Number(process.env.PORT),'127.0.0.1');";
    const first = new TestEnvironmentManager({ prefix: 'agentdev-broker-int-port-a-' });
    const second = new TestEnvironmentManager({ prefix: 'agentdev-broker-int-port-b-' });
    const range = { min: 4720, max: 4729 };
    const createdA = await first.create({
      workId: WORK_ID,
      attemptId: ATTEMPT_A,
      command: [process.execPath, '-e', script],
      portRange: range,
    });
    const createdB = await second.create({
      workId: WORK_ID,
      attemptId: ATTEMPT_B,
      command: [process.execPath, '-e', script],
      portRange: range,
    });
    expect(createdA.ok && createdB.ok).toBe(true);
    if (!createdA.ok || !createdB.ok) throw new Error('unreachable');
    expect(createdA.environment.port).not.toBe(createdB.environment.port);

    const startedA = await first.start(createdA.environment);
    const startedB = await second.start(createdB.environment);
    expect(startedA.ok && startedB.ok).toBe(true);
    if (!startedA.ok || !startedB.ok) {
      throw new Error(
        `${startedA.ok ? '' : startedA.reason} ${startedB.ok ? '' : startedB.reason}`,
      );
    }
    try {
      // Each environment answers on its own port; neither sees the other's socket.
      const [bodyA, bodyB] = await Promise.all([
        fetch(`http://127.0.0.1:${String(startedA.environment.port)}/`).then((r) => r.text()),
        fetch(`http://127.0.0.1:${String(startedB.environment.port)}/`).then((r) => r.text()),
      ]);
      expect(bodyA).toBe('env-ok');
      expect(bodyB).toBe('env-ok');
    } finally {
      await first.cleanup(startedA.environment);
      await second.cleanup(startedB.environment);
    }

    // An OS-occupied port is skipped rather than handed out.
    const occupied = createServer();
    await new Promise<void>((settle) => {
      occupied.listen(0, '127.0.0.1', () => {
        settle();
      });
    });
    const occupiedPort = (occupied.address() as AddressInfo).port;
    try {
      const third = new TestEnvironmentManager({ prefix: 'agentdev-broker-int-port-c-' });
      const created = await third.create({
        workId: WORK_ID,
        attemptId: ATTEMPT_A,
        command: [process.execPath, '-e', 'process.exit(0)'],
        portRange: { min: occupiedPort, max: occupiedPort + 1 },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');
      expect(created.environment.port).toBe(occupiedPort + 1);
      await third.cleanup(created.environment);
    } finally {
      await new Promise<void>((settle) => {
        occupied.close(() => {
          settle();
        });
      });
    }
  });

  it('executes a declared acceptance command on the host by default and refuses an undeclared one (WP-12 W5)', async () => {
    const declared = 'node -e "process.exit(7)"';
    const testRunId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e20';
    const testAttemptId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e60';
    harness.store.runs.insert({
      id: testRunId,
      projectId: projectIdFromRoot(harness.workspace),
      workId: WORK_ID,
      taskId: TASK_ID,
      role: 'test',
      purpose: 'test',
      stage: 'test',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: '4'.repeat(64),
      contextSnapshotId: '5'.repeat(64),
      dispatchSnapshotId: '6'.repeat(64),
      budgetAllocation: 1_000,
    });
    harness.store.attempts.insert({
      id: testAttemptId,
      projectId: projectIdFromRoot(harness.workspace),
      runId: testRunId,
      number: 1,
      status: 'running',
      ownerEpoch: 4,
    });
    const broker = new Broker({
      store: harness.store,
      grants: harness.grants,
      docker: () => DOCKER.availability,
      declaredTestCommands: () => [declared],
    });
    const run = (command: string) =>
      broker.runDeclaredTestCommand({
        workId: WORK_ID,
        runId: testRunId,
        attemptId: testAttemptId,
        epoch: 4,
        role: 'test',
        stage: 'test',
        command,
        roots: [harness.workspace],
      });

    const executed = await run(declared);
    expect(executed.ok).toBe(true);
    if (!executed.ok) throw new Error(executed.reason);
    // The host reported the command's own exit status, not a wrapper's, and Docker being
    // unavailable would not have changed the answer (`execution.md` §1/§5).
    expect(executed.result.status).toBe(7);
    expect(executed.mode).toBe('host');

    // A command the project did not declare is refused before any container starts.
    const undeclared = await run('node -e "process.exit(0)"');
    expect(undeclared.ok).toBe(false);
    if (undeclared.ok) throw new Error('unreachable');
    expect(undeclared.code).toBe('NOT_AUTHORIZED');
    expect(undeclared.reason).toContain('declared testCommands');

    // A daemon with no declared set has no such path at all (fail closed).
    const bare = new Broker({
      store: harness.store,
      grants: harness.grants,
      docker: () => DOCKER.availability,
    });
    const refused = await bare.runDeclaredTestCommand({
      workId: WORK_ID,
      runId: testRunId,
      attemptId: testAttemptId,
      epoch: 4,
      role: 'test',
      stage: 'test',
      command: declared,
      roots: [harness.workspace],
    });
    expect(refused.ok).toBe(false);

    // The real command, its exit code and the environment it ran in are auditable
    // (`data.md` §3 `Env`).
    const events = harness.store.events
      .readAfter(0, { limit: 10_000 })
      .filter((event) => event.name === 'test.command_executed');
    expect(
      events.some(
        (event) =>
          event.data['command'] === declared &&
          event.data['exitCode'] === 7 &&
          event.data['mode'] === 'host',
      ),
    ).toBe(true);

    // The negative proof, end to end at the library layer: the real exit code becomes a
    // `failed` CheckResult and the stage gate then refuses a `success` claim that the
    // executed evidence does not support (WP-12 W5, `workflow.md` §6).
    const checkResult = buildTestCheckResult({
      executions: [
        {
          command: declared,
          exitCode: executed.result.status,
          stdout: executed.result.stdout,
          stderr: executed.result.stderr,
          signal: executed.result.signal,
          durationMs: executed.durationMs,
        },
      ],
      environmentRef: ATTEMPT_A,
      inputTree: HASH,
      acceptanceIds: ['AC-048'],
      outputRefs: [ATTEMPT_A],
    });
    expect(checkResult.status).toBe('failed');
    expect(checkResult.checks[0]?.exitCode).toBe(7);
    const registry = new TestEvidenceRegistry();
    registry.record(testAttemptId, checkResult);
    const gate = new StageGate({ store: harness.store, testEvidence: registry });
    expect(() =>
      gate.submit({
        runId: testRunId,
        attemptId: testAttemptId,
        epoch: 4,
        payload: {
          status: 'success',
          summary: 'the declared command passed',
          artifactRefs: [],
          evidenceRefs: [],
          changedPaths: [],
          findingIds: [],
          unknowns: [],
          requestedActions: [],
          readLedgerSeq: 0,
          readLedgerHash: '0'.repeat(64),
        },
      }),
    ).toThrowError(/exit 7/);
    expect(harness.store.stageResults.list({ where: 'run_id = ?', params: [testRunId] })).toEqual(
      [],
    );
  });

  it.skipIf(!DOCKER.ready)(
    'runs a declared acceptance command inside the explicit container environment (WP-12 W5)',
    async () => {
      const declared = 'node -e "process.exit(7)"';
      const testRunId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e21';
      const testAttemptId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e61';
      harness.store.runs.insert({
        id: testRunId,
        projectId: projectIdFromRoot(harness.workspace),
        workId: WORK_ID,
        taskId: TASK_ID,
        role: 'test',
        purpose: 'test',
        stage: 'test',
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: '4'.repeat(64),
        contextSnapshotId: '5'.repeat(64),
        dispatchSnapshotId: '6'.repeat(64),
        budgetAllocation: 1_000,
      });
      harness.store.attempts.insert({
        id: testAttemptId,
        projectId: projectIdFromRoot(harness.workspace),
        runId: testRunId,
        number: 1,
        status: 'running',
        ownerEpoch: 4,
      });
      const broker = new Broker({
        store: harness.store,
        grants: harness.grants,
        docker: () => DOCKER.availability,
        declaredTestCommands: () => [declared],
      });
      const executed = await broker.runDeclaredTestCommand({
        workId: WORK_ID,
        runId: testRunId,
        attemptId: testAttemptId,
        epoch: 4,
        role: 'test',
        stage: 'test',
        command: declared,
        roots: [harness.workspace],
        // The explicit opt-in is the only thing that selects the container now.
        mode: 'container',
      });
      expect(executed.ok).toBe(true);
      if (!executed.ok) throw new Error(executed.reason);
      expect(executed.result.status).toBe(7);
      expect(executed.mode).toBe('container');
      const events = harness.store.events
        .readAfter(0, { limit: 10_000 })
        .filter((event) => event.name === 'test.command_executed');
      expect(
        events.some(
          (event) => event.data['command'] === declared && event.data['mode'] === 'container',
        ),
      ).toBe(true);
    },
  );

  it.skipIf(!DOCKER.ready)(
    'runs a container read through Docker and reports the real non-root account',
    async () => {
      issue(harness, { operation: 'read', targets: [A] });
      const read = await harness.broker.invoke(
        invocation(harness, { mode: 'container', operation: 'read', input: { path: A } }),
      );
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error(read.reason);
      expect(read.result).toContain('export const a = 1;');
      // The read-only source mount was not modified by the container.
      expect(readFileSync(join(harness.workspace, A), 'utf8')).toBe('export const a = 1;\n');

      issue(harness, { operation: 'bash', targets: [A] });
      const identity = await harness.broker.invoke(
        invocation(harness, { mode: 'container', operation: 'bash', input: { command: 'id -u' } }),
      );
      expect(identity.ok).toBe(true);
      if (!identity.ok) throw new Error(identity.reason);
      expect((identity.result as ProcessResult).stdout.trim()).toBe('10001');
    },
  );

  it('replays a once result in a separate OS process through the durable store (W7R1-10)', async () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e70';
    const input = { path: A };
    issue(harness, {
      scope: 'once',
      operation: 'read',
      targets: [A],
      toolOperationId: operationId,
      inputHash: hashToolInput(input),
    });
    let executions = 0;
    const first = await harness.broker.invoke(
      invocation(harness, {
        toolOperationId: operationId,
        input,
        run: () => {
          executions += 1;
          return { tool: 'read', executions };
        },
      }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    expect(executions).toBe(1);

    const dataDir = harness.dataDir;
    const workspace = harness.workspace;
    const script = `
      import { GrantStore } from '${builtEntry('core')}';
      import { ProjectStore } from '${builtEntry('storage')}';
      const { AGENTDEV_CASE_DATA_DIR: dataDir, AGENTDEV_CASE_WORKSPACE: workspace, AGENTDEV_CASE_OP: operationId } = process.env;
      const store = ProjectStore.open({
        dataDir,
        canonicalRoot: workspace,
        migrations: { backup: () => undefined, backupPath: dataDir + '/pre.sqlite' },
      });
      try {
        const grants = new GrantStore({ store });
        let executed = 0;
        const outcome = grants.consumeOnce({
          workId: ${JSON.stringify(WORK_ID)},
          role: 'backend',
          stage: 'develop-L2',
          operation: 'read',
          targets: [${JSON.stringify(A)}],
          at: new Date(Date.now() + 60_000).toISOString(),
          runId: ${JSON.stringify(RUN_A)},
          toolName: 'read',
          toolOperationId: operationId,
          inputHash: ${JSON.stringify(hashToolInput(input))},
          argsRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e71',
          attemptId: ${JSON.stringify(ATTEMPT_A)},
          epoch: 1,
          executor: () => {
            executed += 1;
            return { tool: 'read', executions: 999 };
          },
        });
        process.stdout.write(
          JSON.stringify({ outcome: outcome.outcome, executed, result: outcome.result, dbg: [store.projectId, store.dataDir, store.db.prepare('SELECT COUNT(*) AS n FROM grant').get(), process.argv.slice(2)] }),
        );
      } finally {
        store.close();
      }
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      cwd: process.cwd(),
      timeout: 60_000,
      env: {
        ...process.env,
        AGENTDEV_CASE_DATA_DIR: dataDir,
        AGENTDEV_CASE_WORKSPACE: workspace,
        AGENTDEV_CASE_OP: operationId,
      },
    });
    expect(child.status, child.stderr).toBe(0);
    const reported = JSON.parse(child.stdout.trim()) as {
      readonly outcome: string;
      readonly executed: number;
      readonly result: unknown;
    };
    // A different OS process replays the recorded result instead of executing.
    expect(reported.outcome, JSON.stringify(reported)).toBe('replayed');
    expect(reported.executed).toBe(0);
    expect(reported.result).toEqual({ tool: 'read', executions: 1 });
    expect(executions).toBe(1);
    expect(harness.store.toolOperations.count()).toBe(1);
  });

  it('keeps the once result replayable across a real execution (AC-080)', async () => {
    const operationId = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e70';
    const input = { path: A };
    issue(harness, {
      scope: 'once',
      operation: 'read',
      targets: [A],
      toolOperationId: operationId,
      inputHash: hashToolInput(input),
    });
    const first = await harness.broker.invoke(
      invocation(harness, { toolOperationId: operationId, input }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    const second = await harness.broker.invoke(
      invocation(harness, { toolOperationId: operationId, input }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.outcome).toBe('replayed');
    expect(second.result).toBe(first.result);
  });
});
