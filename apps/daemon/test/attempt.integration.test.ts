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
  createControlEndpoint,
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
  type ControlEndpoint,
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
let controlEndpoint: ControlEndpoint | undefined;
let providerPort = 0;
let supervisor: RunnerSupervisor | undefined;
const projectId = projectIdFromRoot('/placeholder');
let providerCalls = 0;
/** Every completion body the stub provider received, for the tool round-trip assertion. */
let providerRequests: { messages?: { role?: string; tool_call_id?: string }[] }[] = [];

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  return address !== null && typeof address === 'object' ? address.port : 0;
}

/** Seeds the Project/Work/Budget/Run rows the dispatcher will own in a later slice. */
function seedRun(config: ConfigStore, role: 'chief' | 'backend' = 'backend'): string {
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
  const frozen = config.freeze(role, {});
  const run = store.runs.insert({
    projectId: store.projectId,
    workId,
    role,
    purpose: role === 'chief' ? 'analysis' : 'implementation',
    stage: role === 'chief' ? 'coordinate' : 'Develop',
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
  providerRequests = [];
  // The Provider stub: a real OpenAI-compatible endpoint on loopback. When
  // `AGENTDEV_STUB_TOOL_CALLS` is set it answers the first call with a tool call and plain
  // text afterwards, so a real Pi session must execute the tool and send its result back.
  providerStub = createServer((request, response) => {
    providerCalls += 1;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages?: { role?: string; tool_call_id?: string }[];
      };
      providerRequests.push(body);
      const callId = 'call_drill_1';
      const withTool = process.env.AGENTDEV_STUB_TOOL_CALLS === '1';
      const payload =
        withTool && providerCalls === 1
          ? {
              id: 'stub-completion',
              object: 'chat.completion',
              model: 'stub-provider-model',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                      {
                        id: callId,
                        type: 'function',
                        function: {
                          name: 'assessment_submit',
                          arguments: JSON.stringify({
                            intent: 'delivery',
                            goal: 'the stub goal',
                            scope: {
                              readPaths: [],
                              writePaths: [],
                              operations: [],
                              networkTargets: [],
                            },
                            level: 'L2',
                            semanticImpact: false,
                            riskFlags: [],
                            uncertainties: [],
                            policyRevision: 1,
                            reason: 'the stub provider asked for it',
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
            }
          : {
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
            };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
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
  await controlEndpoint?.close();
  controlEndpoint = undefined;
  await new Promise<void>((resolve) => providerStub.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('a real Attempt through the daemon-side execution path', () => {
  it('forwards a Provider tool call to a real Pi session and round-trips its result (AC-003)', async () => {
    process.env.AGENTDEV_STUB_TOOL_CALLS = '1';
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
        chief: {
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
    const gateway = new ModelGateway({
      config,
      snapshots,
      transport: new OpenAiCompatibleTransport(),
      secrets: { resolve: () => 'stub-secret-value' },
    });
    proxy = await createModelGatewayProxy({ gateway, store, capabilities, port: 0 });

    // The daemon's control channel: the tool call the model makes must land here.
    const submitted: { workId: string; assessment: unknown }[] = [];
    const control = await createControlEndpoint({
      store,
      capabilities,
      handler: {
        assessmentSubmit: (input) => {
          submitted.push({ workId: input.workId, assessment: input.assessment });
          return { saved: true, workId: input.workId };
        },
        agentDispatch: () => ({ runId: 'unused', status: 'queued' }),
        stageSubmit: () => ({ accepted: true }),
      },
    });
    controlEndpoint = control;

    const prepare = createPrepareRun({
      store,
      config,
      capabilities,
      gatewayUrl: proxy.url,
      controlUrl: control.url,
      projectRoot: repo,
      attemptsDir: join(dataDir, 'attempts'),
    });
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
      recovery: new RunRecoveryService({ store, probe: createMemoryProcessProbe() }),
      lifecycle: new RunLifecycle({ store }),
      spawn: createChildRunnerSpawnPort({
        repoRoot,
        env: { ...process.env, AGENTDEV_RUNNER_ENTRY: runnerEntry },
      }),
      prepare,
      tickMs: 60_000,
      log: () => undefined,
    });

    const runId = seedRun(config, 'chief');
    supervisor.tick();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const run = store.runs.find(runId);
      if (run !== undefined && (run.status === 'completed' || run.status === 'failed')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 1. The tool call reached the real Pi session and executed: the control endpoint
    //    received the assessment the stub Provider asked for.
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.workId).toBe(store.runs.find(runId)?.workId);
    expect((submitted[0]?.assessment as { goal?: string }).goal).toBe('the stub goal');
    // 2. The second Provider call carried the tool result back (`tool` role + call id).
    expect(providerCalls).toBeGreaterThanOrEqual(2);
    const second = providerRequests.at(-1);
    const toolMessage = second?.messages?.find((message) => message.role === 'tool');
    expect(toolMessage?.tool_call_id).toBe('call_drill_1');
    delete process.env.AGENTDEV_STUB_TOOL_CALLS;
  });

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
