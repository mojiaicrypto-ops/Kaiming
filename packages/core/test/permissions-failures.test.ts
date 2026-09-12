/**
 * WP-07 T5 — the four required failure tests (`docs/delivery/implementation.md`
 * WP-07 "必需失败测试").
 *
 * Each required failure is its own test, named exactly as the plan names it, so a
 * single command shows whether the boundary refuses what it must:
 *
 * | required failure test | what is proved |
 * |---|---|
 * | 符号链接/私网/重定向 | a symlink escaping the workspace, a private-address request and a redirect to a private address are each refused with no read and no request |
 * | Secret 泄漏 | a leaked decoy is detected by the scanner and removed before it can be emitted to a log, Artifact or UI payload |
 * | 进程清理失败 | a cleanup failure is detected and reported as `RECOVERY_REQUIRED`, never swallowed |
 * | 无 Docker 拒绝 | container mode refuses with a precise reason when Docker is unavailable and never falls back to the host |
 *
 * The suite runs in the **unit** project (`pnpm test:unit`) on purpose: every case
 * is deterministic and offline, so the required failures never depend on this
 * host's Docker daemon or network. Real path resolution, a real SQLite store and
 * real `Grant` rows are still used wherever the boundary touches them.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  Broker,
  GrantStore,
  NetworkPolicy,
  SECRET_MASK,
  SecretStore,
  TestEnvironmentManager,
  containsSecret,
  defaultTestEnvironmentPorts,
  isPrivateAddress,
  planContainerRun,
  redact,
  redactValue,
  resolveWithinRoots,
  scanForLeaks,
  secretEnvName,
  type BrokerOptions,
  type DockerProbe,
  type GrantIssueInput,
  type HostResolver,
  type ProcessResult,
  type ProcessRunner,
  type TestEnvironmentPorts,
  type ToolInvocation,
  type ToolOutcome,
} from '../src/index.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c4f0000';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c4f0100';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c4f0200';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c4f0300';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c4f0400';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);

const TARGET = 'src/a.ts';
const ESCAPE = 'escape/secret.txt';
const TARGET_BODY = 'export const a = 1;\n';
const OUTSIDE_BODY = 'outside-the-workspace\n';

const PUBLIC_URL = 'https://api.example.test/v1/data';
const REDIRECT_URL = 'https://decoy.example.test/r';
const PRIVATE_URL = 'http://10.0.0.5/private';
const LINK_LOCAL_URL = 'http://169.254.169.254/latest/meta-data/';

const DECOY_REF = 'project/decoy-token';
const DECOY_VALUE = 'decoy-credential-7b31-must-be-detected';

/**
 * A stub DNS port for the "public" fixtures.
 *
 * The suite stays offline: the only public names resolve through this local
 * fixture instead of a real lookup, and every name it does not know is reported as
 * unresolvable (which the policy refuses, never admits).
 */
const PUBLIC_FIXTURE_RESOLVER: HostResolver = {
  resolve(host) {
    if (host === 'api.example.test' || host === 'decoy.example.test') {
      return Promise.resolve({ ok: true, addresses: ['93.184.216.34'] });
    }
    return Promise.resolve({ ok: false, reason: `${host} is not in the local fixture` });
  },
};

const SCOPE: Scope = {
  readPaths: [TARGET, ESCAPE],
  writePaths: [TARGET, ESCAPE],
  operations: ['read', 'write', 'bash', 'network'],
  networkTargets: [],
};

const AT = '2026-09-11T00:00:00.000Z';
/** An instant after {@link AT}; a Grant minted with it is still live. */
const FUTURE = '2026-09-11T01:00:00.000Z';
const NOW = (): string => AT;

/** A recording runner: any call is proof that a process really started. */
function recordingRunner(): ProcessRunner & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  return {
    calls,
    run(command, args): ProcessResult {
      calls.push([command, ...args].join(' '));
      return { status: 0, stdout: '', stderr: '', signal: null };
    },
  };
}

interface StubbedResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Installs a `fetch` stub and returns the list of URLs it was asked for.
 *
 * The Broker's default requester resolves `fetch` at call time, so stubbing the
 * global is what the real code path sees; the recorded URLs are the transport
 * evidence that a refused target was never contacted.
 */
function stubFetch(responses: readonly StubbedResponse[]): string[] {
  const calls: string[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<{
      status: number;
      headers: { get(name: string): string | null };
      text(): Promise<string>;
    }> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next === undefined) throw new Error('no stubbed response');
      const lower = new Map(
        Object.entries(next.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      );
      return Promise.resolve({
        status: next.status,
        headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
        text: () => Promise.resolve(next.body ?? ''),
      });
    },
  );
  return calls;
}

interface Harness {
  readonly workspace: string;
  readonly outside: string;
  readonly store: ProjectStore;
  readonly grants: GrantStore;
  issue(overrides?: Partial<GrantIssueInput>): void;
  broker(overrides?: Partial<BrokerOptions>): Broker;
  invocation(overrides?: Partial<ToolInvocation>): ToolInvocation;
  dispose(): void;
}

function makeHarness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-permfail-data-'));
  const workspace = mkdtempSync(join(tmpdir(), 'agentdev-permfail-ws-'));
  const outside = mkdtempSync(join(tmpdir(), 'agentdev-permfail-out-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, TARGET), TARGET_BODY, 'utf8');
  writeFileSync(join(outside, 'secret.txt'), OUTSIDE_BODY, 'utf8');
  // A real symlink: `escape/` points at a directory outside the workspace.
  symlinkSync(outside, join(workspace, 'escape'), 'dir');

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
    purpose: 'deliver WP-07 T5 required failure tests',
    level: 'L2',
    goal: 'refuse every documented escape',
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
    acceptanceIds: ['AC-048', 'AC-049', 'AC-050', 'AC-051', 'AC-053', 'AC-080'],
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

  const grants = new GrantStore({ store, now: NOW });
  const harness: Harness = {
    workspace,
    outside,
    store,
    grants,
    issue(overrides = {}) {
      const outcome = grants.issue({
        workId: WORK_ID,
        role: 'backend',
        stage: 'develop-L2',
        scope: 'run',
        operation: 'read',
        targets: [TARGET],
        runId: RUN_A,
        decisionId: DECISION_ID,
        expiresAt: FUTURE,
        ...overrides,
      });
      if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
    },
    broker(overrides = {}) {
      return new Broker({
        store,
        grants,
        now: NOW,
        resolver: PUBLIC_FIXTURE_RESOLVER,
        ...overrides,
      });
    },
    invocation(overrides = {}) {
      return {
        workId: WORK_ID,
        runId: RUN_A,
        attemptId: ATTEMPT_A,
        epoch: 1,
        role: 'backend',
        stage: 'develop-L2',
        operation: 'read',
        targets: [TARGET],
        input: { path: TARGET },
        roots: [workspace],
        ...overrides,
      };
    },
    dispose() {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    },
  };
  return harness;
}

describe('WP-07 required failure tests', () => {
  let harness: Harness;

  beforeEach(() => {
    // Time is fixed: {@link AT} is "now", {@link FUTURE} is live and any expired
    // Grant is expressed with its own past instant.
    harness = makeHarness();
  });

  afterEach(() => {
    harness.dispose();
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // 符号链接/私网/重定向
  // -------------------------------------------------------------------------

  it('符号链接/私网/重定向: a symlink escape, a private-address request and a redirect to a private address are all refused with no read and no request', async () => {
    // 1. Symlink escape: the Grant names `escape/secret.txt`, so only the resolved
    //    real path can refuse it. The tool body must never run, and nothing may be
    //    read out of the workspace.
    harness.issue({ operation: 'read', targets: [ESCAPE] });
    let readBodyRan = false;
    const read = await harness.broker().invoke(
      harness.invocation({
        targets: [ESCAPE],
        input: { path: ESCAPE },
        run: () => {
          readBodyRan = true;
          return readFileSync(join(harness.workspace, ESCAPE), 'utf8');
        },
      }),
    );
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('unreachable');
    expect(read.code).toBe('NOT_AUTHORIZED');
    expect(read.reason).toContain('outside the allowed roots');
    expect(readBodyRan).toBe(false);
    expect(
      harness.store.toolOperations.list({ where: 'run_id = ?', params: [RUN_A] }),
    ).toHaveLength(0);

    // A write through the same symlink is refused as well, and the outside file is
    // byte-for-byte untouched.
    harness.issue({ operation: 'write', targets: [ESCAPE] });
    let writeBodyRan = false;
    const write = await harness.broker().invoke(
      harness.invocation({
        operation: 'write',
        access: 'write',
        targets: [ESCAPE],
        input: { path: ESCAPE, content: 'tampered\n' },
        run: () => {
          writeBodyRan = true;
          return 'should never run';
        },
      }),
    );
    expect(write.ok).toBe(false);
    if (write.ok) throw new Error('unreachable');
    expect(write.code).toBe('NOT_AUTHORIZED');
    expect(writeBodyRan).toBe(false);
    expect(readFileSync(join(harness.outside, 'secret.txt'), 'utf8')).toBe(OUTSIDE_BODY);

    // The real path resolver is what makes the difference: the same relative
    // request inside the root is authorized.
    const inside = resolveWithinRoots({
      path: TARGET,
      access: 'read',
      roots: [harness.workspace],
    });
    expect(inside.ok).toBe(true);

    // 2. A private-address request. The Broker refuses it before admission, so the
    //    real transport is never called.
    harness.issue({ operation: 'network', targets: [PRIVATE_URL] });
    const privateCalls = stubFetch([{ status: 200, body: 'never fetched' }]);
    const privateCall = await harness
      .broker()
      .networkRequester({ allowedNetworkTargets: [] })
      .request(PRIVATE_URL);
    expect(privateCall.ok).toBe(false);
    if (privateCall.ok) throw new Error('unreachable');
    expect(privateCall.code).toBe('NOT_AUTHORIZED');
    expect(privateCall.blockedUrl).toBe(PRIVATE_URL);
    expect(privateCall.reason).toContain('10.0.0.5');
    // The refused hop is recorded as refused, and the transport was never called.
    expect(privateCall.hops).toEqual([{ url: PRIVATE_URL, allowed: false }]);
    expect(privateCalls).toEqual([]);

    // 3. A redirect to a private address: the public origin is fetched once, the
    //    Location is refused *before* the second fetch, and the recorded hops show
    //    exactly that.
    const redirectCalls = stubFetch([
      { status: 302, headers: { Location: LINK_LOCAL_URL } },
      { status: 200, body: 'private payload' },
    ]);
    const redirect = await harness
      .broker()
      .networkRequester({ allowedNetworkTargets: [] })
      .request(REDIRECT_URL);
    expect(redirect.ok).toBe(false);
    if (redirect.ok) throw new Error('unreachable');
    expect(redirect.code).toBe('NOT_AUTHORIZED');
    expect(redirect.blockedUrl).toContain('169.254.169.254');
    expect(redirect.hops.map((hop) => hop.allowed)).toEqual([true, false]);
    expect(redirectCalls).toEqual([REDIRECT_URL]);

    // The policy itself classifies the refused targets as internal, so the
    // refusals are about the boundary rather than about a broken URL.
    const policy = new NetworkPolicy();
    expect(policy.checkUrl(PRIVATE_URL).ok).toBe(false);
    expect(policy.checkUrl(LINK_LOCAL_URL).ok).toBe(false);
    expect(policy.checkUrl(PUBLIC_URL).ok).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('10.0.0.5')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Secret 泄漏
  // -------------------------------------------------------------------------

  it('Secret 泄漏: a leak is detected by the scanner and never emitted into a log, Artifact or UI payload', () => {
    const secrets = new SecretStore();
    secrets.put({ ref: DECOY_REF, value: DECOY_VALUE, audience: 'tool' });
    const envName = secretEnvName(DECOY_REF);

    // The scanner detects the decoy in every surface it must never reach, so the
    // clean assertions that follow cannot pass vacuously.
    const rawLog = `2026-09-11T00:00:01.000Z stdout: ${DECOY_VALUE}`;
    const rawArtifact = { kind: 'log', lines: [rawLog], meta: { env: envName } };
    const rawUi = { card: { body: { value: DECOY_VALUE } } };
    expect(secrets.scanAll(rawLog)).toHaveLength(1);
    expect(secrets.scanAll(rawArtifact).length).toBeGreaterThanOrEqual(1);
    expect(secrets.scanAll(rawUi)).toHaveLength(1);
    // The scanner reports where it leaked without echoing the value itself.
    const finding = secrets.scanAll(rawLog)[0];
    expect(finding?.preview).toContain(SECRET_MASK);
    expect(finding?.preview).not.toContain(DECOY_VALUE);
    expect(containsSecret(rawLog, [DECOY_VALUE])).toBe(true);

    // The emit path masks before writing, so what is actually persisted is clean.
    const emittedLog = secrets.maskAll(rawLog);
    const emittedArtifact = redactValue(rawArtifact, [DECOY_VALUE]);
    const emittedUi = redactValue(rawUi, [DECOY_VALUE]);
    expect(emittedLog).toContain(SECRET_MASK);
    expect(emittedLog).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(emittedArtifact)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(emittedUi)).not.toContain(DECOY_VALUE);
    expect(secrets.scanAll(emittedLog)).toEqual([]);
    expect(secrets.scanAll(emittedArtifact)).toEqual([]);
    expect(secrets.scanAll(emittedUi)).toEqual([]);

    // Querying the store never reveals a value either, and the known-value scan of
    // a serialized store stays empty.
    expect(JSON.stringify(secrets.list())).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(secrets)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(secrets.refs())).not.toContain(DECOY_VALUE);
    expect(scanForLeaks(secrets.list(), [DECOY_VALUE])).toEqual([]);

    // An error that carries the decoy is redacted too, which is what a thrown tool
    // failure would otherwise leak through its message and stack.
    const failure = new Error(`tool failed with ${DECOY_VALUE}`);
    const safeFailure = redactValue(failure, [DECOY_VALUE]);
    expect(JSON.stringify(safeFailure)).not.toContain(DECOY_VALUE);
    expect(scanForLeaks(safeFailure, [DECOY_VALUE])).toEqual([]);
    expect(scanForLeaks(failure, [DECOY_VALUE]).length).toBeGreaterThanOrEqual(1);
    expect(redact(rawLog, [DECOY_VALUE])).toContain(SECRET_MASK);
  });

  // -------------------------------------------------------------------------
  // 进程清理失败
  // -------------------------------------------------------------------------

  it('进程清理失败: a cleanup failure is detected and reported as recoverable, never swallowed', async () => {
    // The broken host is injected deterministically: the environment looks started
    // (its port answers and it reports a live pid), but the port that owns it can
    // neither signal the group nor remove the temporary directory, and the group
    // never dies. Every failed step must be reported, never swallowed.
    const removeFailures: string[] = [];
    const signalFailures: string[] = [];
    const port = 9_999_999;
    const ports: TestEnvironmentPorts = {
      ...defaultTestEnvironmentPorts,
      spawn: () => ({
        pid: port,
        exited: () => false,
        exitCode: () => null,
        stdout: () => '',
        stderr: () => '',
        onExit: () => undefined,
      }),
      alive: () => true,
      // The fake child cannot really bind, so ownership of the injected listener
      // is proved by the fake probe: this fixture exercises the cleanup path, while
      // W7R2-07 owns the proof of a *real* child's socket.
      listeningPid: () => port,
      processDescends: () => false,
      signal: (pid) => {
        signalFailures.push(String(pid));
        throw new Error('ESRCH: the process group is already gone');
      },
      removeDir: (path) => {
        removeFailures.push(path);
        throw new Error('EACCES: the temporary directory is still mounted');
      },
    };
    const manager = new TestEnvironmentManager({ ports, stopGraceMs: 20 });
    const created = await manager.create({
      workId: WORK_ID,
      attemptId: ATTEMPT_A,
      command: [process.execPath, '-e', 'process.exit(0)'],
      reserved: { port: 4317, dbPath: '/tmp/agentdev-dev.sqlite' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.reason);

    // The environment's own port really accepts a connection, so `start` observes
    // readiness exactly as it would for a real service.
    const listener = createServer();
    await new Promise<void>((settle) => {
      listener.listen(created.environment.port, '127.0.0.1', () => {
        settle();
      });
    });
    try {
      const brokenStart = await manager.start(created.environment);
      expect(brokenStart.ok).toBe(true);
      if (!brokenStart.ok) throw new Error(brokenStart.reason);
      const environment = brokenStart.environment;
      expect(environment.pid).toBe(port);

      const cleaned = await manager.cleanup(environment);
      expect(cleaned.ok).toBe(false);
      if (cleaned.ok) throw new Error('unreachable');
      expect(cleaned.code).toBe('RECOVERY_REQUIRED');
      expect(cleaned.reason).toContain('was not cleaned up');
      // Both failed signals and the surviving group are reported: one failure never
      // hides another, and a still-alive process is never presented as stopped.
      expect(cleaned.failures.length).toBeGreaterThanOrEqual(2);
      expect(cleaned.failures.some((failure) => failure.includes('SIGTERM'))).toBe(true);
      expect(cleaned.failures.some((failure) => failure.includes('SIGKILL'))).toBe(true);
      expect(
        cleaned.failures.some((failure) => failure.includes('still alive after SIGKILL')),
      ).toBe(true);
      expect(removeFailures).toHaveLength(1);
      expect(signalFailures).toEqual([String(port), String(port)]);
      // The environment is visibly in the recoverable state, not reported stopped.
      expect(cleaned.environment.state).toBe('cleanup_failed');
      expect(manager.get(environment.id)?.state).toBe('cleanup_failed');
    } finally {
      await new Promise<void>((settle) => {
        listener.close(() => {
          settle();
        });
      });
      // The injected `removeDir` only pretends to fail: remove what it really left
      // behind so the host keeps no residue after the suite.
      defaultTestEnvironmentPorts.removeDir(created.environment.dir);
    }

    // A real child process inside a real environment is still cleaned up, so the
    // failure above is about the injected host, not about cleanup never working.
    const realManager = new TestEnvironmentManager({ prefix: 'agentdev-perm-cleanup-' });
    const script =
      "const http=require('http');http.createServer((q,r)=>{r.end('ok')}).listen(Number(process.env.PORT),'127.0.0.1');";
    const realCreated = await realManager.create({
      workId: WORK_ID,
      attemptId: ATTEMPT_A,
      command: [process.execPath, '-e', script],
      portRange: { min: 4740, max: 4749 },
    });
    expect(realCreated.ok).toBe(true);
    if (!realCreated.ok) throw new Error(realCreated.reason);
    const started = await realManager.start(realCreated.environment);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.reason);
    const realEnv = started.environment;
    try {
      const stopped = await realManager.stop(realEnv);
      expect(stopped.ok).toBe(true);
    } finally {
      const done = await realManager.cleanup(realEnv);
      expect(done.ok).toBe(true);
      expect(done.environment.state).toBe('stopped');
    }
  });

  // -------------------------------------------------------------------------
  // 无 Docker 拒绝
  // -------------------------------------------------------------------------

  it('无 Docker 拒绝: container mode refuses with a precise reason when Docker is unavailable and never falls back to the host', async () => {
    const probe: DockerProbe = () => ({
      available: false,
      reason: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
    });
    const runner = recordingRunner();
    harness.issue({ operation: 'bash', targets: [TARGET] });
    const outcome: ToolOutcome = await harness.broker({ docker: probe, process: runner }).invoke(
      harness.invocation({
        mode: 'container',
        operation: 'bash',
        input: { command: 'echo should-never-run' },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.code).toBe('PROVIDER_UNAVAILABLE');
    // The observed reason is carried verbatim, not replaced with prose.
    expect(outcome.reason).toContain('Cannot connect to the Docker daemon');
    expect(outcome.reason).toContain('does not fall back to host execution');
    expect(outcome.fields).toEqual(['mode']);
    // No process was started at all: no docker call, and no host execution either.
    expect(runner.calls).toEqual([]);
    expect(
      harness.store.toolOperations.list({ where: 'run_id = ?', params: [RUN_A] }),
    ).toHaveLength(0);

    // The container plan that would have run is still hardened and has no network,
    // so the refusal is the only thing standing between the call and isolation —
    // and it is the only reason this host did not run the command.
    const plan = planContainerRun({ command: 'id -u', roots: [harness.workspace] });
    expect(plan.network).toBe('none');
    expect(plan.args).toContain('--read-only');
    expect(plan.args).toContain('--cap-drop=ALL');
    expect(plan.args).toContain('no-new-privileges');
    expect(plan.args.join(' ')).toContain('--user 10001:10001');
    expect(plan.mounts).toEqual([{ path: harness.workspace, target: '/workspace', mode: 'ro' }]);
  });
});
