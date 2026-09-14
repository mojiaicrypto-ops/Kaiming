/**
 * `agentdev backup|restore|relocate` integration test (WP-12 T6).
 *
 * The CLI is driven exactly as an operator drives it, against a **real temporary Git
 * repository**, a **real SQLite state directory** and a **real installation home**
 * (`AGENTDEV_HOME`). `docs/architecture/reliability.md` §7/§8 fix what is asserted:
 *
 * - backup is refused on a non-empty output directory without `--replace`, and a good
 *   backup records the delivery revision, the knowledge tree hash and the required Secret
 *   *identifiers* (never values);
 * - restore is refused for a missing/incomplete/tampered manifest, for a target that already
 *   holds an active Project, and for a non-empty target without explicit replacement;
 * - a restore whose required Secret cannot be resolved comes back `blocked` with the ref to
 *   re-enter, while the same restore is `ready` once `agentdev secret set` registered it;
 * - a restored installation has the original SQLite rows, the recorded Git revision, no old
 *   lease/capability and the previously active Run marked `interrupted`, and the
 *   installation-level `projects.json` mapping points at the restored root;
 * - relocate rewrites the mapping and the registry and refuses a target that is not the same
 *   delivery repository.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigStore,
  createSecretRepository,
  readProjectRegistry,
  registerProject,
} from '@agentdev/core';
import { ProjectStore, projectIdFromRoot } from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';

import { main } from '../src/cli.js';

const git = createNodeWorktreeGitPort();
const repoRoot = join(import.meta.dirname, '..', '..', '..');
const DELIVERY_REF = 'refs/heads/agentdev/main';
const SECRET_REF = 'provider/ops-drill';
/** The credential value whose absence from every backup artefact is asserted. */
const SECRET_VALUE = 'sk-ops-drill-value';
const FEATURE_PATH = 'docs/agentdev/features/F-0a1b2c3d/README.md';
const WORK_ACTIVE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e02';
const RUN_ACTIVE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e21';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const HASH = 'a'.repeat(64);
const TIME = '2026-09-14T00:00:00.000Z';
/** A pid that is not the test process, so the recovery probe confirms it is gone. */
const DEAD_RUNNER = 'pid:999999';
/** Never let a test touch the real macOS Keychain (`execution.md` §4). */
const originalEnv = { ...process.env };

interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Runs the CLI in-process with captured IO and a scripted stdin. */
async function runCli(args: readonly string[], input = ''): Promise<RunResult> {
  let out = '';
  let err = '';
  let code = 0;
  await main(args, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    exit: (value) => {
      code = value;
    },
    readStdin: () => Promise.resolve(input),
  });
  return { code, out, err };
}

/**
 * Parses the JSON result out of a command's stdout.
 *
 * Successful `backup`/`restore` print operator-facing `WARNING [CODE] …` lines *before* the
 * JSON so a human cannot miss a blocked Provider; an unattended script reads from the first
 * `{` (`docs/operations/installation.md` §6).
 */
function body(result: RunResult): Record<string, unknown> {
  const start = result.out.indexOf('{');
  if (start < 0) throw new Error(`no JSON in stdout: ${result.out}`);
  return JSON.parse(result.out.slice(start)) as Record<string, unknown>;
}

/** Whether any file under `root` contains `needle` (used to prove no value leaked). */
function containsText(root: string, needle: string): boolean {
  const walk = (path: string): boolean => {
    const stat = statSync(path);
    if (stat.isDirectory()) return readdirSync(path).some((entry) => walk(join(path, entry)));
    if (!stat.isFile()) return false;
    return readFileSync(path, 'utf8').includes(needle);
  };
  return existsSync(root) ? walk(root) : false;
}

function failureCode(result: RunResult): string {
  return (JSON.parse(result.err.trim()) as { error: { code: string } }).error.code;
}

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
  process.env = { ...originalEnv };
});

interface Harness {
  readonly home: string;
  readonly repo: string;
  readonly dataDir: string;
  readonly projectId: string;
  readonly revision: string;
}

/** Builds a real Git repository plus an installation state directory with live rows. */
function harness(options: { readonly withSecretRef?: boolean } = {}): Harness {
  const home = tempDir('agentdev-cli-ops-home-');
  const repo = tempDir('agentdev-cli-ops-repo-');
  const init = git.initRepository(repo, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error(`git init failed: ${init.errors[0]?.message ?? 'unknown'}`);
  writeFileSync(join(repo, 'README.md'), '# ops drill\n', 'utf8');
  mkdirSync(join(repo, 'docs/agentdev/features/F-0a1b2c3d'), { recursive: true });
  writeFileSync(join(repo, FEATURE_PATH), '# 订单取消\n', 'utf8');
  const seed = git.commitPaths(repo, 'chore: seed', ['README.md', FEATURE_PATH]);
  if (!seed.ok) throw new Error(`git commit failed: ${seed.errors[0]?.message ?? 'unknown'}`);

  const projectId = projectIdFromRoot(repo);
  const dataDir = join(home, 'projects', projectId);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const store = ProjectStore.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => TIME },
  });
  store.projects.insert({
    id: projectId,
    root: repo,
    gitRoot: repo,
    codeRoot: 'src',
    documentRoot: 'docs/agentdev',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
  });
  const budget = store.budgets.insert({
    projectId,
    workId: WORK_ACTIVE_ID,
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
    id: WORK_ACTIVE_ID,
    projectId,
    intent: 'delivery',
    purpose: 'ops drill',
    level: 'L2',
    goal: 'backup and restore',
    scope: { readPaths: ['src'], writePaths: ['src'], operations: ['read'], networkTargets: [] },
    sourceRef: { kind: 'message', id: WORK_ACTIVE_ID, version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: HASH,
    budgetId: budget.id,
    policyRevision: 1,
  });
  store.runs.insert({
    id: RUN_ACTIVE_ID,
    workId: WORK_ACTIVE_ID,
    role: 'backend',
    purpose: 'implementation',
    stage: 'develop',
    status: 'running',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: HASH,
    contextSnapshotId: HASH,
    dispatchSnapshotId: HASH,
    budgetAllocation: 1_000,
  });
  const blob = store.blobs.write('verification evidence\n');
  store.artifacts.insert({
    projectId,
    workId: WORK_ACTIVE_ID,
    runId: RUN_ACTIVE_ID,
    origin: 'agent',
    kind: 'evidence',
    artifactVersion: 1,
    contentHash: blob.hash,
    relativeBlobPath: blob.relativePath,
    mime: 'text/plain',
    bytes: blob.bytes,
    validity: 'valid',
    acl: [],
  });
  store.attempts.insert({
    id: ATTEMPT_ID,
    runId: RUN_ACTIVE_ID,
    number: 1,
    status: 'running',
    ownerEpoch: 0,
    runnerId: DEAD_RUNNER,
    heartbeatAt: TIME,
  });
  store.leases.acquire({
    resource: `worktree:${RUN_ACTIVE_ID}`,
    ownerAttemptId: ATTEMPT_ID,
    epoch: 0,
    expiresAt: '2030-01-01T00:00:00.000Z',
    at: TIME,
  });
  if (options.withSecretRef !== false) {
    // A Provider whose credential is required: the backup must record the *identifier*.
    const config = ConfigStore.open({ globalDir: home });
    config.upsertProvider({
      providerId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      enabled: true,
      secretRef: SECRET_REF,
      models: [
        {
          id: 'ops-drill-model',
          contextWindow: 8_192,
          maxOutputTokens: 1_024,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    });
    // The credential really resolves here, so a restore into *this* installation is
    // `ready`; the credential-loss case uses a different home (see its own test).
    createSecretRepository({ home }).set(SECRET_REF, SECRET_VALUE, {
      audience: 'gateway',
    });
  }
  store.close();
  registerProject(home, { root: repo, projectId, at: TIME });
  return { home, repo, dataDir, projectId, revision: seed.value.revision };
}

beforeEach(() => {
  process.env.AGENTDEV_SECRET_BACKEND = 'file';
});

describe('agentdev backup', () => {
  it('snapshots a project and refuses a non-empty output directory without --replace', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const out = tempDir('agentdev-cli-ops-backup-');

    const backup = await runCli(['backup', '--output', out]);
    expect(backup.code).toBe(0);
    const result = body(backup);
    expect(result).toMatchObject({
      ok: true,
      command: 'backup',
      projectId: h.projectId,
      ref: DELIVERY_REF,
      revision: h.revision,
      complete: true,
      gitIncluded: true,
      paused: false,
    });
    expect(result['secretRefs']).toEqual([SECRET_REF]);
    expect(result['evidence']).toBe(1);
    expect(typeof result['operationId']).toBe('string');
    const manifest = JSON.parse(readFileSync(join(out, 'backup.json'), 'utf8')) as {
      complete: boolean;
      revision: string;
      secretRefs: string[];
      files: unknown[];
    };
    expect(manifest.complete).toBe(true);
    expect(manifest.revision).toBe(h.revision);
    expect(manifest.secretRefs).toEqual([SECRET_REF]);
    expect(manifest.files.length).toBeGreaterThan(0);

    // The same directory again: an explicit replacement is required (`reliability.md` §8).
    const refused = await runCli(['backup', '--out', out]);
    expect(refused.code).toBe(1);
    expect(failureCode(refused)).toBe('INVALID_STATE');

    const replaced = await runCli(['backup', '--out', out, '--replace']);
    expect(replaced.code).toBe(0);
    expect(body(replaced)).toMatchObject({ ok: true, complete: true });
  }, 60_000);

  it('refuses an unknown project and an installation with several projects', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const out = tempDir('agentdev-cli-ops-backup-');

    const unknown = await runCli(['backup', 'f'.repeat(32), '--output', out]);
    expect(unknown.code).toBe(1);
    expect(failureCode(unknown)).toBe('NOT_FOUND');

    const second = tempDir('agentdev-cli-ops-repo2-');
    const init = git.initRepository(second, { branch: 'agentdev/main' });
    if (!init.ok) throw new Error('git init failed');
    writeFileSync(join(second, 'README.md'), '# second\n', 'utf8');
    const commit = git.commitPaths(second, 'chore: seed', ['README.md']);
    if (!commit.ok) throw new Error('git commit failed');
    registerProject(h.home, {
      root: second,
      projectId: projectIdFromRoot(second),
      at: TIME,
    });

    const ambiguous = await runCli(['backup', '--output', out]);
    expect(ambiguous.code).toBe(1);
    expect(failureCode(ambiguous)).toBe('VALIDATION_ERROR');
    const details = (
      JSON.parse(ambiguous.err.trim()) as { error: { details: { known: unknown[] } } }
    ).error.details;
    expect(details.known).toHaveLength(2);
  }, 60_000);
});

describe('agentdev restore', () => {
  it('restores a damaged installation and proves rows, revision and recovery state', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const out = tempDir('agentdev-cli-ops-backup-');
    const backup = await runCli(['backup', '--output', out]);
    expect(backup.code).toBe(0);

    // A non-empty target without explicit authorization is refused first.
    const refused = await runCli(['restore', out, '--root', h.repo]);
    expect(refused.code).toBe(1);
    expect(failureCode(refused)).toBe('INVALID_STATE');
    expect(refused.err).toContain('--replace');

    // Damage: remove the installation state and the project data entirely.
    rmSync(h.dataDir, { recursive: true, force: true });
    rmSync(h.repo, { recursive: true, force: true });
    expect(existsSync(h.dataDir)).toBe(false);
    expect(existsSync(h.repo)).toBe(false);

    const restored = await runCli(['restore', out, '--root', h.repo]);
    expect(restored.code).toBe(0);
    const result = body(restored);
    expect(result).toMatchObject({
      ok: true,
      command: 'restore',
      projectId: h.projectId,
      repoRoot: h.repo,
      revision: h.revision,
      status: 'ready',
      registryUpdated: true,
      daemonOpenable: true,
    });
    const recovery = result['recovery'] as {
      interruptedRunIds: string[];
      revokedLeases: number;
      revokedGrants: number;
    };
    expect(recovery.interruptedRunIds).toContain(RUN_ACTIVE_ID);
    expect(recovery.revokedLeases).toBeGreaterThanOrEqual(1);
    expect(recovery.revokedGrants).toBe(0);
    const doctor = result['doctor'] as { ok: boolean; checks: { name: string; ok: boolean }[] };
    expect(doctor.ok).toBe(true);
    expect(doctor.checks.map((check) => check.name)).toContain('leases-revoked');
    expect((result['consistency'] as { treeMatches: boolean }).treeMatches).toBe(true);

    // The installation registry points at the restored root.
    const registry = readProjectRegistry(h.home);
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0]).toMatchObject({ root: h.repo, projectId: h.projectId });

    // Re-open the restored state: the rows and the previously active Run are consistent.
    const reopened = ProjectStore.open({ dataDir: h.dataDir, projectId: h.projectId });
    try {
      expect(reopened.projects.find(h.projectId)?.root).toBe(h.repo);
      expect(reopened.runs.find(RUN_ACTIVE_ID)?.status).toBe('interrupted');
      expect(reopened.leases_.list({})).toHaveLength(0);
      expect(reopened.artifacts.list()).toHaveLength(1);
    } finally {
      reopened.close();
    }
    const head = git.headRevision(h.repo);
    expect(head.ok && head.value).toBe(h.revision);
  }, 60_000);

  it('refuses a missing, incomplete or unsupported manifest', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;

    const empty = tempDir('agentdev-cli-ops-not-a-backup-');
    const missing = await runCli(['restore', empty, '--root', h.repo]);
    expect(missing.code).toBe(1);
    expect(failureCode(missing)).toBe('NOT_FOUND');

    const wrongVersion = tempDir('agentdev-cli-ops-wrong-version-');
    writeFileSync(
      join(wrongVersion, 'backup.json'),
      `${JSON.stringify({ schemaVersion: 2, complete: true, projectId: h.projectId })}\n`,
    );
    const unsupported = await runCli(['restore', wrongVersion, '--root', h.repo]);
    expect(unsupported.code).toBe(1);
    expect(failureCode(unsupported)).toBe('VALIDATION_ERROR');

    const incomplete = tempDir('agentdev-cli-ops-incomplete-');
    writeFileSync(
      join(incomplete, 'backup.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        complete: false,
        projectId: h.projectId,
        canonicalRoot: h.repo,
      })}\n`,
    );
    const refused = await runCli(['restore', incomplete, '--root', h.repo]);
    expect(refused.code).toBe(1);
    expect(failureCode(refused)).toBe('INVALID_STATE');
  }, 60_000);

  it('blocks a restore whose required credential is missing, and clears once it is set', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const out = tempDir('agentdev-cli-ops-backup-');
    expect((await runCli(['backup', '--output', out])).code).toBe(0);

    // A different installation: the backup's required Secret is not registered there.
    const freshHome = tempDir('agentdev-cli-ops-fresh-home-');
    const freshRepo = join(tempDir('agentdev-cli-ops-fresh-parent-'), 'repo');
    process.env.AGENTDEV_HOME = freshHome;

    const blocked = await runCli(['restore', out, '--root', freshRepo]);
    expect(blocked.code).toBe(0);
    const blockedBody = body(blocked);
    expect(blockedBody).toMatchObject({
      ok: true,
      status: 'blocked',
      daemonOpenable: false,
      provider: { blocked: true, missingSecretRefs: [SECRET_REF] },
      doctor: { executionReady: false },
    });
    expect(blockedBody['nextSteps']).toEqual([
      `agentdev secret set ${SECRET_REF}   # 值从 stdin 读入`,
    ]);
    expect((blockedBody['warnings'] as { code: string }[]).map((w) => w.code)).toContain(
      'PROVIDER_BLOCKED',
    );
    // (b) the blocked Provider is a leading stdout warning line, not only a JSON field.
    expect(blocked.out).toContain('WARNING [PROVIDER_BLOCKED]');
    expect(blocked.out.split('\n')[0]).toContain('WARNING [PROVIDER_BLOCKED]');

    const set = await runCli(['secret', 'set', SECRET_REF], `${SECRET_VALUE}\n`);
    expect(set.code).toBe(0);

    const ready = await runCli(['restore', out, '--root', freshRepo, '--replace']);
    expect(ready.code).toBe(0);
    expect(body(ready)).toMatchObject({
      ok: true,
      status: 'ready',
      provider: { blocked: false, missingSecretRefs: [] },
    });
    expect((body(ready)['nextSteps'] as unknown[]).length).toBe(0);
  }, 60_000);
});

describe('agentdev backup of the installation configuration', () => {
  it('carries Provider definitions into a fresh installation, never a secret value', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const out = tempDir('agentdev-cli-ops-backup-');
    const backup = await runCli(['backup', '--output', out]);
    expect(backup.code).toBe(0);
    const backupBody = body(backup);
    expect(backupBody['installation']).toMatchObject({
      configCopied: true,
      containsSecretValues: false,
    });
    expect(existsSync(join(out, 'installation', 'config.toml'))).toBe(true);
    expect(existsSync(join(out, 'installation', 'installation.json'))).toBe(true);
    expect(containsText(out, SECRET_VALUE)).toBe(false);

    // A fresh installation: the Provider definition must come back, the value must not.
    const freshHome = tempDir('agentdev-cli-ops-fresh-home-');
    const freshRepo = join(tempDir('agentdev-cli-ops-fresh-parent-'), 'repo');
    process.env.AGENTDEV_HOME = freshHome;
    const restored = await runCli(['restore', out, '--root', freshRepo]);
    expect(restored.code).toBe(0);
    const installation = body(restored)['installation'] as {
      configRestored: boolean;
      configPath: string;
      providers: { providerId: string; enabled: boolean; models: string[]; secretRef?: string }[];
      secretRefs: string[];
      resolvableSecretRefs: string[];
      containsSecretValues: boolean;
    };
    expect(installation.configRestored).toBe(true);
    expect(installation.configPath).toBe(join(freshHome, 'config.toml'));
    expect(installation.providers).toEqual([
      {
        providerId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99',
        enabled: true,
        models: ['ops-drill-model'],
        secretRef: SECRET_REF,
      },
    ]);
    expect(installation.secretRefs).toEqual([SECRET_REF]);
    // The credential is not resolvable in the fresh installation, and no plaintext leaked.
    expect(installation.resolvableSecretRefs).toEqual([]);
    expect(installation.containsSecretValues).toBe(false);
    const configText = readFileSync(join(freshHome, 'config.toml'), 'utf8');
    expect(configText).toContain('ops-drill-model');
    expect(configText).toContain(SECRET_REF);
    expect(containsText(out, SECRET_VALUE)).toBe(false);
    expect(containsText(freshHome, SECRET_VALUE)).toBe(false);
    expect(
      (JSON.parse((await runCli(['secret', 'list'])).out) as { items: unknown[] }).items,
    ).toEqual([]);
    // The fresh installation has the definition but a blocked Provider, not a hidden value.
    expect(body(restored)['provider']).toMatchObject({
      blocked: true,
      missingSecretRefs: [SECRET_REF],
    });
  }, 60_000);
});

describe('agentdev backup refuses to carry a credential value', () => {
  it('refuses a configuration that contains a registered secret value', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    // The value is appended to the global configuration, exactly the mistake the scan exists
    // for: a credential that would otherwise travel inside the backup directory.
    appendFileSync(join(h.home, 'config.toml'), `leaked = "${SECRET_VALUE}"\n`);
    const out = tempDir('agentdev-cli-ops-backup-');

    const refused = await runCli(['backup', '--output', out]);
    expect(refused.code).toBe(1);
    expect(failureCode(refused)).toBe('SECRET_VALUE_IN_CONFIG');
    expect(refused.out).not.toContain(SECRET_VALUE);
    expect(containsText(out, SECRET_VALUE)).toBe(false);
    const record = JSON.parse(
      readFileSync(join(out, 'installation', 'installation.json'), 'utf8'),
    ) as { complete: boolean; containsSecretValues: boolean };
    expect(record).toMatchObject({ complete: false, containsSecretValues: true });
  }, 60_000);
});

describe('agentdev restore validates the installation sidecar before writing', () => {
  it('refuses a tampered installation config without touching the target', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const out = tempDir('agentdev-cli-ops-backup-');
    expect((await runCli(['backup', '--output', out])).code).toBe(0);
    appendFileSync(join(out, 'installation', 'config.toml'), '# tampered\n');

    const freshHome = tempDir('agentdev-cli-ops-fresh-home-');
    const freshRepo = join(tempDir('agentdev-cli-ops-fresh-parent-'), 'repo');
    process.env.AGENTDEV_HOME = freshHome;
    const refused = await runCli(['restore', out, '--root', freshRepo]);
    expect(refused.code).toBe(1);
    expect(failureCode(refused)).toBe('STALE_ARTIFACT');
    expect(existsSync(freshRepo)).toBe(false);
    expect(existsSync(join(freshHome, 'config.toml'))).toBe(false);
    expect(existsSync(join(freshHome, 'projects', h.projectId))).toBe(false);
  }, 60_000);

  it('refuses an incomplete installation sidecar', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const out = tempDir('agentdev-cli-ops-backup-');
    expect((await runCli(['backup', '--output', out])).code).toBe(0);
    const recordPath = join(out, 'installation', 'installation.json');
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(recordPath, `${JSON.stringify({ ...record, complete: false })}\n`);

    const refused = await runCli(['restore', out, '--root', h.repo]);
    expect(refused.code).toBe(1);
    expect(failureCode(refused)).toBe('INVALID_STATE');
  }, 60_000);
});

describe('agentdev relocate', () => {
  it('refuses a cross-root move that would change the Project identity', async () => {
    const h = harness({ withSecretRef: false });
    process.env.AGENTDEV_HOME = h.home;
    const newRoot = join(tempDir('agentdev-cli-ops-relocate-'), 'moved');

    const relocated = await runCli(['relocate', h.projectId, '--root', newRoot, '--move']);
    expect(relocated.code).toBe(1);
    expect(failureCode(relocated)).toBe('PROJECT_IDENTITY_MOVE_UNSUPPORTED');
    expect(relocated.err).toContain('尚不支持迁移 Project 身份');
    expect(relocated.err).toContain('derivedProjectId');
    // Nothing moved and nothing was rewritten.
    expect(existsSync(join(newRoot, 'README.md'))).toBe(false);
    expect(existsSync(join(h.repo, 'README.md'))).toBe(true);
    expect(readProjectRegistry(h.home).projects[0]?.root).toBe(h.repo);
    const reopened = ProjectStore.open({ dataDir: h.dataDir, projectId: h.projectId });
    try {
      expect(reopened.projects.find(h.projectId)?.gitRoot).toBe(h.repo);
    } finally {
      reopened.close();
    }
  }, 60_000);

  it('accepts a target that resolves to the same canonical root (identity preserved)', async () => {
    const h = harness({ withSecretRef: false });
    process.env.AGENTDEV_HOME = h.home;
    const aliasParent = tempDir('agentdev-cli-ops-relocate-alias-');
    const alias = join(aliasParent, 'repo-alias');
    symlinkSync(h.repo, alias);

    const relocated = await runCli(['relocate', h.projectId, '--root', alias]);
    expect(relocated.code).toBe(0);
    const result = body(relocated);
    expect(result).toMatchObject({
      ok: true,
      command: 'relocate',
      projectId: h.projectId,
      identityPreserved: true,
      daemonOpenable: true,
      registryUpdated: true,
    });
    expect((result['doctor'] as { ok: boolean }).ok).toBe(true);
    expect(readProjectRegistry(h.home).projects[0]?.root).toBe(h.repo);
  }, 60_000);

  it('refuses a target that is not this delivery repository and leaves the mapping unchanged', async () => {
    const h = harness();
    process.env.AGENTDEV_HOME = h.home;
    const notARepo = tempDir('agentdev-cli-ops-not-a-repo-');

    const refused = await runCli(['relocate', h.projectId, '--root', notARepo]);
    expect(refused.code).toBe(1);
    // A non-repository target also derives another projectId, so the identity refusal is the
    // one that fires — before Core would even validate the delivery binding.
    expect(failureCode(refused)).toBe('PROJECT_IDENTITY_MOVE_UNSUPPORTED');

    const reopened = ProjectStore.open({ dataDir: h.dataDir, projectId: h.projectId });
    try {
      expect(reopened.projects.find(h.projectId)?.root).toBe(h.repo);
    } finally {
      reopened.close();
    }
    expect(readProjectRegistry(h.home).projects[0]?.root).toBe(h.repo);
  }, 60_000);

  it('parses the work-package shorthand `relocate <newRoot>` and still fails closed', async () => {
    const h = harness({ withSecretRef: false });
    process.env.AGENTDEV_HOME = h.home;
    const newRoot = join(tempDir('agentdev-cli-ops-relocate-short-'), 'moved');

    const relocated = await runCli(['relocate', newRoot, '--move']);
    expect(relocated.code).toBe(1);
    expect(failureCode(relocated)).toBe('PROJECT_IDENTITY_MOVE_UNSUPPORTED');
    expect(existsSync(newRoot)).toBe(false);
  }, 60_000);
});

describe('agentdev restore with a live daemon', () => {
  let home: string;
  let repo: string;
  let projectId: string;

  beforeEach(() => {
    const h = harness();
    home = h.home;
    repo = h.repo;
    projectId = h.projectId;
    // Point the CLI at the daemon's *source* entry, exactly like the runtime CLI test.
    const bootstrap = join(home, 'daemon-entry.mjs');
    writeFileSync(
      bootstrap,
      [
        `import { installSourceResolver } from ${JSON.stringify(join(repoRoot, 'scripts/lib/e2e-runtime.mjs'))};`,
        'installSourceResolver();',
        `const { runAsProcess } = await import(${JSON.stringify(join(repoRoot, 'apps/daemon/src/main.ts'))});`,
        'process.exit(await runAsProcess(process.argv.slice(2), process.env));',
        '',
      ].join('\n'),
    );
    process.env.AGENTDEV_HOME = home;
    process.env.AGENTDEV_DAEMON_ENTRY = bootstrap;
  });

  afterEach(async () => {
    await runCli(['stop']);
  });

  it('refuses a restore whose target already holds an active Project', async () => {
    const out = tempDir('agentdev-cli-ops-live-backup-');
    expect((await runCli(['backup', '--output', out])).code).toBe(0);

    const started = await runCli(['start', '--root', repo]);
    expect(started.code).toBe(0);

    const refused = await runCli(['restore', out, '--root', repo, '--replace']);
    expect(refused.code).toBe(1);
    expect(failureCode(refused)).toBe('INVALID_STATE');
    expect(refused.err).toContain('活动 Project');

    const relocated = await runCli(['relocate', projectId, '--root', repo]);
    expect(relocated.code).toBe(1);
    expect(failureCode(relocated)).toBe('INVALID_STATE');
    expect(relocated.err).toContain('agentdev stop');
  }, 120_000);
});
