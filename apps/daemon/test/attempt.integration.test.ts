/**
 * Real Attempt integration test (WP-11 A2-T6).
 *
 * This is the first test where the *daemon side* of an Attempt is real end to end:
 *
 *   RunnerSupervisor → real `apps/runner` child process → real Pi session
 *     → Core model gateway (`createModelGatewayProxy`) → real `ModelGateway`
 *       → real HTTP transport → loopback Provider stub
 *
 * Only the model endpoint is a stub (the repository has no paid Provider in CI); no test
 * builds messages for the Runner, no test calls the model gateway directly, and the
 * Runner never sees the Provider credential — it presents the Attempt capability it was
 * given through its per-Attempt `models.json`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ProjectStore, projectIdFromRoot } from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';
import {
  AttemptCapabilityStore,
  ConfigStore,
  ModelGateway,
  OpenAiCompatibleTransport,
  RunLifecycle,
  RunRecoveryService,
  RunnerSupervisor,
  SnapshotWriter,
  createMemoryProcessProbe,
  createMemoryUsageLedger,
  createModelGatewayProxy,
  type ModelGatewayProxy,
} from '@agentdev/core';

import { createChildRunnerSpawnPort } from '../src/runner-spawn.js';
import { createPrepareRun } from '../src/prepare-run.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const gitPort = createNodeWorktreeGitPort();

let home: string;
let dataDir: string;
let repo: string;
let store: ProjectStore;
let providerStub: Server;
let proxy: ModelGatewayProxy | undefined;
let providerPort = 0;
let supervisor: RunnerSupervisor | undefined;
const projectId = projectIdFromRoot('/placeholder');
let providerCalls = 0;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  return address !== null && typeof address === 'object' ? address.port : 0;
}

/** Seeds the Project/Work/Budget/Run rows the dispatcher will own in a later slice. */
function seedRun(config: ConfigStore): string {
  const workId = store.newId();
  const budget = store.budgets.insert({
    projectId: store.projectId,
    workId,
    tokenLimit: 500_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 7_200,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  store.works.insert({
    id: workId,
    projectId: store.projectId,
    intent: 'delivery',
    purpose: 'implementation',
    level: 'L2',
    goal: 'make the unpaid order cancellable',
    scope: { readPaths: ['src'], writePaths: ['src'], operations: ['read'], networkTargets: [] },
    sourceRef: { kind: 'action', id: store.newId(), version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: 'a'.repeat(40),
    budgetId: budget.id,
    policyRevision: 1,
  });
  const frozen = config.freeze('backend', {});
  const run = store.runs.insert({
    projectId: store.projectId,
    workId,
    role: 'backend',
    purpose: 'implementation',
    stage: 'Develop',
    status: 'queued',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: frozen.snapshotId,
    contextSnapshotId: 'd'.repeat(64),
    dispatchSnapshotId: 'e'.repeat(64),
    budgetAllocation: 1_000,
  });
  return run.id;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-attempt-home-'));
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-attempt-data-'));
  repo = mkdtempSync(join(tmpdir(), 'agentdev-attempt-repo-'));
  const init = gitPort.initRepository(repo, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error('git init failed');
  writeFileSync(join(repo, 'README.md'), '# seeded\n');
  const commit = gitPort.commitPaths(repo, 'chore: seed', ['README.md']);
  if (!commit.ok) throw new Error('git commit failed');
  providerCalls = 0;
  // The Provider stub: a real OpenAI-compatible endpoint on loopback.
  providerStub = createServer((request, response) => {
    providerCalls += 1;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'stub-completion',
          object: 'chat.completion',
          model: 'stub-provider-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'STUB-ANSWER: the stage result' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
        }),
      );
    });
  });
  providerPort = await listen(providerStub);
  store = ProjectStore.open({
    dataDir: join(dataDir, 'project'),
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => new Date().toISOString() },
  });
  store.projects.insert({
    id: store.projectId,
    root: repo,
    gitRoot: repo,
    codeRoot: 'src',
    documentRoot: 'docs/agentdev',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: commit.value.revision,
  });
  void projectId;
});

afterEach(async () => {
  await supervisor?.stop();
  await proxy?.close();
  await new Promise<void>((resolve) => providerStub.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('a real Attempt through the daemon-side execution path', () => {
  it('starts apps/runner, calls the Provider through the Core gateway and settles the Run', async () => {
    const snapshots = new SnapshotWriter({ store });
    const config = ConfigStore.open({ globalDir: home, projectRoot: dataDir, snapshots });
    const provider = config.upsertProvider({
      type: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${String(providerPort)}`,
      enabled: true,
      secretRef: 'stub-provider-secret',
      models: [
        {
          id: 'stub-provider-model',
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    });
    config.update('global', {
      roleOverrides: {
        backend: {
          providerId: provider.providerId,
          modelId: 'stub-provider-model',
          reasoning: 'off',
          skills: [],
          toolSubset: [],
          contextLimit: 32_000,
        },
      },
    });

    const capabilities = new AttemptCapabilityStore();
    const lifecycle = new RunLifecycle({ store });
    // The real transport reaches the stub; the secret resolver stands in for the
    // secret store, which the daemon wires through its grant path.
    const gateway = new ModelGateway({
      config,
      snapshots,
      transport: new OpenAiCompatibleTransport(),
      secrets: { resolve: () => 'stub-secret-value' },
    });
    const usages: { runId: string; inputTokens: number; outputTokens: number }[] = [];
    const usageLedger = createMemoryUsageLedger();
    proxy = await createModelGatewayProxy({
      gateway,
      store,
      capabilities,
      port: 0,
      onUsage: (usage) => {
        usages.push({
          runId: usage.runId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        // Usage is booked at settlement (`reconcile` refuses a running Run).
        usageLedger.record(usage.runId, { tokensUsed: usage.inputTokens + usage.outputTokens });
      },
    });

    const prepare = createPrepareRun({
      store,
      config,
      capabilities,
      gatewayUrl: proxy.url,
      projectRoot: repo,
      attemptsDir: join(dataDir, 'attempts'),
    });
    // A source-mode Runner entry, so the test needs no prior build.
    const runnerEntry = join(home, 'runner-entry.mjs');
    writeFileSync(
      runnerEntry,
      [
        `import { installSourceResolver } from ${JSON.stringify(join(repoRoot, 'scripts/lib/e2e-runtime.mjs'))};`,
        'installSourceResolver();',
        `const { main } = await import(${JSON.stringify(join(repoRoot, 'apps/runner/src/cli.ts'))});`,
        'await main(process.argv.slice(2), {',
        '  output: { write: (line) => process.stdout.write(line) },',
        '  exit: (code) => process.exit(code),',
        '});',
        '',
      ].join('\n'),
    );
    supervisor = new RunnerSupervisor({
      store,
      // The real `RunRecoveryService` cannot confirm a *stub* pid alive, so the test uses
      // the memory probe: the production wiring uses the node probe.
      recovery: new RunRecoveryService({
        store,
        probe: createMemoryProcessProbe(),
      }),
      lifecycle,
      spawn: createChildRunnerSpawnPort({
        repoRoot,
        env: { ...process.env, AGENTDEV_RUNNER_ENTRY: runnerEntry },
      }),
      prepare,
      tickMs: 60_000,
      usage: usageLedger,
      log: () => undefined,
    });

    const runId = seedRun(config);
    supervisor.tick();
    expect(supervisor.liveAttempts()).toHaveLength(1);

    // Wait for the real process to finish the real session round trip.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const run = store.runs.find(runId);
      if (run !== undefined && (run.status === 'completed' || run.status === 'failed')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const run = store.runs.find(runId);
    expect(run?.status).toBe('completed');
    const attempt = store.attempts.list({ where: 'run_id = ?', params: [runId] }).at(0);
    expect(attempt?.status).toBe('completed');
    // The Provider really answered through the Core gateway, and the usage was reconciled.
    expect(providerCalls).toBe(1);
    expect(usages).toEqual([{ runId, inputTokens: 11, outputTokens: 5 }]);
    const budget = store.budgets.list({ where: 'work_id = ?', params: [run?.workId ?? ''] }).at(0);
    expect(budget?.tokensUsed).toBe(16);
    // The Attempt records the *Runner* pid (not the daemon's), which is what recovery
    // probes after a restart or a heartbeat timeout.
    expect(attempt?.runnerId).toMatch(/^pid:[0-9]+$/u);
    // The Runner's catalog carried the capability, never the Provider secret.
    const attemptId = attempt?.id ?? '';
    const catalog = readFileSync(join(dataDir, 'attempts', attemptId, 'models.json'), 'utf8');
    expect(catalog).toContain('http://127.0.0.1:');
    expect(catalog).not.toContain('stub-secret-value');
  }, 120_000);
});
