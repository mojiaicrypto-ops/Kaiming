/**
 * WP-07 T2 — end-to-end secret isolation (AC-051).
 *
 * The unit suite proves the `SecretStore` rules on their own; this one proves
 * them against the real persistence and a real child process:
 *
 * - the Grants are minted by the real `GrantStore` over a real SQLite
 *   `grant` table, so "authorised" is a persisted fact rather than a fixture;
 * - the environment built for the authorised Run is handed to a real `node`
 *   child, which reports the injected value back — and the unauthorised sibling
 *   Run's child reports it absent;
 * - the decoy is shown to be absent from every serialised surface (grant rows,
 *   Artifact body, UI payload, log line) while `scanForLeaks` still detects it
 *   in the raw forms, so the check cannot pass vacuously.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Grant, Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import {
  GrantStore,
  SECRET_MASK,
  SECRET_OPERATION,
  SecretStore,
  redact,
  redactValue,
  scanForLeaks,
  secretEnvName,
  type SecretAccessContext,
} from '../src/index.js';

const run = promisify(execFile);

const ROOT = '/tmp/agentdev-secrets-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e00';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e10';
const RUN_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e11';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e40';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e30';
const ATTEMPT_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e50';
const ATTEMPT_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e51';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);

const AT = '2026-09-11T00:00:00.000Z';
const DECOY_REF = 'decoy/provider';
const DECOY_VALUE = 'sk-decoy-live-4d21c0-never-in-a-payload';
const DECOY_ENV = secretEnvName(DECOY_REF);

const SCOPE: Scope = {
  readPaths: ['packages/core/src/secrets.ts'],
  writePaths: ['packages/core/src/secrets.ts'],
  // `data.md` §1 `Scope.operations`: the Grant needs `secret` to authorize the
  // operation, exactly as it does for network/push/deploy.
  operations: ['read', 'secret'],
  networkTargets: [],
};

let clock = Date.parse(AT);

function at(offsetMs = 0): string {
  return new Date(clock + offsetMs).toISOString();
}

/**
 * Runs one `node -e` child with exactly the given environment.
 *
 * Only `PATH` is inherited so the process can start; every secret variable is
 * what the caller injected. `process.execPath` is used because the child may not
 * have a usable `node` on its restricted PATH.
 */
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

/** The child's view of one environment variable, or `<absent>`. */
function readEnvVar(env: Readonly<Record<string, string>>, name: string): Promise<string> {
  return runChild(env, [
    '-e',
    'process.stdout.write(process.env[process.argv[1]] ?? "<absent>")',
    name,
  ]);
}

/** A dump of the child's whole environment, for a leak scan. */
function dumpEnv(env: Readonly<Record<string, string>>): Promise<string> {
  return runChild(env, ['-e', 'process.stdout.write(JSON.stringify(process.env))']);
}

describe('SecretStore isolation with a real child process (AC-051)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let secrets: SecretStore;
  let projectId: string;
  let runGrant: Grant;

  function context(overrides: Partial<SecretAccessContext> = {}): SecretAccessContext {
    return {
      audience: 'tool',
      purpose: 'implementation',
      role: 'backend',
      workId: WORK_ID,
      stage: 'develop-L2',
      at: AT,
      runId: RUN_A,
      grants: [runGrant],
      ...overrides,
    };
  }

  beforeEach(() => {
    clock = Date.parse(AT);
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-secrets-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'packages',
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
      purpose: 'isolate WP-07 secrets',
      level: 'L2',
      goal: 'keep the decoy out of every unauthorised surface',
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
      acceptanceIds: ['AC-051'],
    });
    for (const [id, attempt] of [
      [RUN_A, ATTEMPT_A],
      [RUN_B, ATTEMPT_B],
    ] as const) {
      store.runs.insert({
        id,
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
        id: attempt,
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

    grants = new GrantStore({ store });
    secrets = new SecretStore();
    secrets.put({
      ref: DECOY_REF,
      value: DECOY_VALUE,
      audience: 'tool',
      purposes: ['implementation'],
    });

    const issued = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation: SECRET_OPERATION,
      targets: [DECOY_REF],
      runId: RUN_A,
      decisionId: DECISION_ID,
      expiresAt: at(3_600_000),
    });
    if (!issued.ok) throw new Error(`the secret grant must be issuable: ${issued.code}`);
    runGrant = issued.grant;
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('injects the decoy into the authorised child environment only (AC-051)', async () => {
    const injection = secrets.environmentFor(context(), [DECOY_REF]);
    expect(injection.ok).toBe(true);
    if (!injection.ok) throw new Error('unreachable');
    expect(injection.env[DECOY_ENV]).toBe(DECOY_VALUE);

    // A real child process really receives it.
    expect(await readEnvVar(injection.env, DECOY_ENV)).toBe(DECOY_VALUE);

    // The scanner finds it in that exact environment, which is what makes the
    // absence assertion on the sibling Run meaningful rather than vacuous.
    const findings = scanForLeaks(injection.env, [DECOY_VALUE]);
    expect(findings.map((finding) => finding.path)).toEqual([`$.${DECOY_ENV}`]);
  });

  it('keeps the decoy out of the unauthorised sibling Run and its child (AC-051)', async () => {
    const sibling = context({ runId: RUN_B, grants: [runGrant] });
    const injection = secrets.environmentFor(sibling, [DECOY_REF]);
    // The refused injection produces no environment at all; that empty set is
    // exactly what an unauthorised child of the sibling Run would start with.
    const environment: Readonly<Record<string, string>> = injection.ok ? injection.env : {};
    expect(injection.ok).toBe(false);
    if (injection.ok) throw new Error('unreachable');
    expect(injection.code).toBe('NOT_AUTHORIZED');

    // Resolution itself is refused too, so the sibling has no path to the value.
    const resolution = secrets.resolve(DECOY_REF, sibling);
    expect(resolution.ok).toBe(false);

    // A child started for the sibling Run — with the environment that Run may
    // legitimately have — never sees the decoy.
    expect(await readEnvVar(environment, DECOY_ENV)).toBe('<absent>');
    const dumped = await dumpEnv(environment);
    expect(dumped).not.toContain(DECOY_VALUE);
    expect(scanForLeaks(dumped, [DECOY_VALUE])).toEqual([]);
    // The store-scoped audit path agrees with the free scanner.
    expect(secrets.scanAll(dumped)).toEqual([]);
    expect(secrets.maskAll(dumped)).toBe(dumped);
  });

  it('never serialises the decoy into a grant row, log, Artifact or UI payload (AC-051)', () => {
    // The persisted authorization and the store's own query surface are clean.
    expect(JSON.stringify(store.grants.list())).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(grants.grantHistory(WORK_ID))).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(secrets.list())).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(secrets)).not.toContain(DECOY_VALUE);

    // A log line, an Artifact body and a UI payload that raw-carry the decoy are
    // detected by the audit scanner and are removed by the redaction helpers.
    const logLine = `2026-09-11T00:00:01.000Z tool raw output: ${DECOY_VALUE}`;
    const artifact = { kind: 'log' as const, lines: [logLine], meta: { tool: 'bash' } };
    const uiPayload = { card: { title: 'Run output', body: { token: DECOY_VALUE } } };
    expect(scanForLeaks(logLine, [DECOY_VALUE])).toHaveLength(1);
    expect(scanForLeaks(artifact, [DECOY_VALUE]).length).toBeGreaterThanOrEqual(1);
    expect(scanForLeaks(uiPayload, [DECOY_VALUE])).toHaveLength(1);

    const safeLog = redact(logLine, [DECOY_VALUE]);
    const safeArtifact = redactValue(artifact, [DECOY_VALUE]);
    const safeUi = redactValue(uiPayload, [DECOY_VALUE]);
    expect(safeLog).toContain(SECRET_MASK);
    expect(safeLog).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(safeArtifact)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(safeUi)).not.toContain(DECOY_VALUE);
    expect(scanForLeaks(safeArtifact, [DECOY_VALUE])).toEqual([]);
    expect(scanForLeaks(safeUi, [DECOY_VALUE])).toEqual([]);
  });

  it('refuses an expired secret Grant at use time (AC-051)', () => {
    const expired = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation: SECRET_OPERATION,
      targets: [DECOY_REF],
      runId: RUN_A,
      decisionId: DECISION_ID,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(expired.ok).toBe(true);
    if (!expired.ok) throw new Error('unreachable');

    const resolution = secrets.resolve(DECOY_REF, context({ grants: [expired.grant] }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('AUTH_EXPIRED');

    const injection = secrets.environmentFor(context({ grants: [expired.grant] }), [DECOY_REF]);
    expect(injection.ok).toBe(false);
    if (injection.ok) throw new Error('unreachable');
    expect(injection.code).toBe('AUTH_EXPIRED');
  });

  it('resolves the decoy for the credentialed Run through the real Grant row (AC-051)', () => {
    const resolution = secrets.resolve(DECOY_REF, context());
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error('unreachable');
    expect(resolution.value).toBe(DECOY_VALUE);
    // The Grant that authorized it is the persisted run-scoped row.
    expect(runGrant.runId).toBe(RUN_A);
    expect(runGrant.operation).toBe(SECRET_OPERATION);
    expect(runGrant.targets).toEqual([DECOY_REF]);
  });
});
