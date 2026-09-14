/**
 * WP-12 T4b round 3 (i): a real Run's ContextBuilder assembly.
 *
 * A real temporary Git repository, a real SQLite store, the real `ArtifactService`,
 * `BlobStore` and `SnapshotWriter`, and the real `createPrepareRun`; only the frozen
 * config profile is a stub, because this test is about the Context plane rather than
 * the Provider path. The assertions are the documented facts: the Attempt prompt is
 * built from the *resolved* selection, the frozen `ContextSnapshot` carries the real
 * git hash, and its immutable directory exists on disk.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArtifactService,
  SnapshotWriter,
  type AttemptCapabilityStore,
  type ConfigStore,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';
import { createContextAssembly, sha256Hex } from '../src/context-ports.js';
import { createPrepareRun } from '../src/prepare-run.js';

const created: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

function writeFileAt(root: string, relativePath: string, content: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const gitPort = createNodeWorktreeGitPort();

describe('a real Run assembles its context through the Context plane (context.md §1)', () => {
  it('freezes the resolved selection and builds the prompt from it', () => {
    const repo = makeTempDir('agentdev-pr-context-repo-');
    writeFileAt(repo, 'src/orders.ts', 'export const orders = [];\n');
    writeFileAt(repo, 'docs/rules/agents.md', '# Agent 固定规则\n\nChief 决定上下文。\n');
    const init = gitPort.initRepository(repo, { branch: 'agentdev/main' });
    if (!init.ok) throw new Error('git init failed');
    const seed = gitPort.commitPaths(repo, 'chore: seed', [
      'src/orders.ts',
      'docs/rules/agents.md',
    ]);
    if (!seed.ok) throw new Error('seed commit failed');

    const dataDir = makeTempDir('agentdev-pr-context-state-');
    const projectId = projectIdFromRoot(repo);
    const store = ProjectStore.open({
      dataDir,
      canonicalRoot: repo,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    store.projects.insert({
      id: projectId,
      root: repo,
      gitRoot: repo,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
      head: seed.value.revision,
    });
    const blobs = new BlobStore({ root: dataDir });
    const artifacts = new ArtifactService({ store, blobs });
    const snapshots = new SnapshotWriter({ store });

    const workId = store.newId();
    const budget = store.budgets.insert({
      projectId,
      workId,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 3_600,
      activeTimeUsed: 0,
      repairLimit: 2,
      repairUsed: 0,
      costKnown: true,
    });
    store.works.insert({
      id: workId,
      projectId,
      intent: 'delivery',
      purpose: 'prepare context',
      level: 'L2',
      goal: 'implement the orders change',
      scope: { readPaths: ['src'], writePaths: [], operations: ['read'], networkTargets: [] },
      sourceRef: { kind: 'message', id: store.newId(), version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: seed.value.revision,
      budgetId: budget.id,
      policyRevision: 1,
    });
    const selection = {
      goal: 'read the orders module',
      sourceRefs: [
        { kind: 'git', id: 'src/orders.ts', version: seed.value.revision, path: 'src/orders.ts' },
      ],
      reasonPerSource: { 'git:src/orders.ts': 'the module under implementation' },
      featureRefs: [],
      codePaths: ['src/orders.ts'],
      artifactRefs: [],
      excluded: [],
      unknowns: [],
      readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
    };
    const contextSnapshot = snapshots.freeze('context', {
      contextSelection: selection,
      goal: 'implement the orders change',
      workId,
    });
    const configSnapshot = snapshots.freeze('config', { profile: 'stub' });
    // A Chief assist Run: its documented required inputs (roleContract, userRequest,
    // workGoal) are exactly the ones the store really holds, so the assembly is
    // exercised end to end instead of stopping at MISSING_CONTEXT.
    const run = store.runs.insert({
      projectId,
      workId,
      role: 'chief',
      purpose: 'analysis',
      stage: 'assist',
      status: 'queued',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: configSnapshot.hash,
      contextSnapshotId: contextSnapshot.hash,
      dispatchSnapshotId: sha256('dispatch'),
      budgetAllocation: 100,
    });
    const attempt = store.attempts.insert({
      runId: run.id,
      number: 1,
      status: 'starting',
      ownerEpoch: 0,
    });

    // A minimal frozen profile: the Provider path is covered by its own suites.
    const config = {
      readFrozen: () => ({
        provider: { providerId: 'stub-provider' },
        model: { id: 'stub-model', contextWindow: 128_000, maxOutputTokens: 4_096 },
        profile: { reasoning: 'off', toolSubset: [] },
      }),
      project: () => ({
        policy: { permissionMode: 'auto', l3Paths: [], l3Keywords: [], testCommands: [] },
      }),
    } as unknown as ConfigStore;
    const capabilities = {
      issue: () => ({ token: 'cap-token' }),
    } as unknown as AttemptCapabilityStore;

    const prepare = createPrepareRun({
      store,
      config,
      capabilities,
      gatewayUrl: 'http://127.0.0.1:1',
      projectRoot: repo,
      attemptsDir: join(dataDir, 'attempts'),
      artifacts,
      gitReader: gitPort,
      snapshots,
      snapshotRoot: dataDir,
      projectId,
      readMessageBody: () => null,
    });
    const invocation = prepare({ run, attempt, epoch: 1 });

    // The prompt is the real assembly, not the goal+contract shell.
    expect(invocation.prompt).toContain('Frozen context');
    expect(invocation.prompt).toContain('src/orders.ts');
    expect(invocation.prompt).toContain(
      sha256Hex(Buffer.from('export const orders = [];\n')).slice(0, 12),
    );
    // The frozen snapshot is durable and carries the real resolved source.
    const frozen = store.snapshots
      .list({ where: "type = 'context'" })
      .find((row) => Array.isArray((row.payload as { resolvedSources?: unknown }).resolvedSources));
    expect(frozen).toBeDefined();
    const snapshotRef = (frozen?.payload as { snapshotRef?: string }).snapshotRef ?? '';
    expect(snapshotRef).toMatch(/^[0-9a-f]{64}$/u);
    // The immutable content directory really exists on disk.
    expect(existsSync(join(dataDir, 'snapshots', 'context', snapshotRef))).toBe(true);
    expect(
      store.snapshots
        .list({ where: "type = 'context'" })
        .some(
          (row) => (row.payload as { resolvedSources?: unknown }).resolvedSources !== undefined,
        ),
    ).toBe(true);
    store.close();
  });

  it('fails closed on a forbidden source instead of inventing a hash', () => {
    const repo = makeTempDir('agentdev-pr-context-refuse-');
    writeFileAt(repo, 'src/orders.ts', 'export const orders = [];\n');
    const init = gitPort.initRepository(repo, { branch: 'agentdev/main' });
    if (!init.ok) throw new Error('git init failed');
    const seed = gitPort.commitPaths(repo, 'chore: seed', ['src/orders.ts']);
    if (!seed.ok) throw new Error('seed commit failed');
    const dataDir = makeTempDir('agentdev-pr-context-refuse-state-');
    const store = ProjectStore.open({
      dataDir,
      canonicalRoot: repo,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    const projectId = projectIdFromRoot(repo);
    store.projects.insert({
      id: projectId,
      root: repo,
      gitRoot: repo,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    const blobs = new BlobStore({ root: dataDir });
    const assembly = createContextAssembly({
      store,
      artifacts: new ArtifactService({ store, blobs }),
      config: {
        project: () => ({ policy: {} }),
      } as unknown as ConfigStore,
      git: gitPort,
      projectId,
      workId: store.newId(),
      role: 'backend',
      policyRevision: 1,
      stage: 'develop-L2',
      baseRevision: seed.value.revision,
      snapshotRoot: dataDir,
    });
    const resolved = assembly.resolver.resolve({
      ref: { kind: 'transcript', id: 'nope', version: '1' },
      role: 'backend',
      stage: 'develop-L2',
      scope: {} as never,
      reader: {},
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error('unreachable');
    expect(resolved.code).toBe('CONTEXT_FORBIDDEN');
    // A path that is not committed is missing, never fabricated.
    const missing = assembly.resolver.resolve({
      ref: { kind: 'git', id: 'src/nope.ts', version: seed.value.revision, path: 'src/nope.ts' },
      role: 'backend',
      stage: 'develop-L2',
      scope: {} as never,
      reader: {},
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('unreachable');
    expect(missing.code).toBe('NOT_FOUND');
    store.close();
  });
});
