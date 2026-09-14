/** T3 轮 2 改动人：T3（父代理 session-2bf56aa1）——把 stage 结果里的占位 readLedgerHash
 * （`'a'.repeat(64)`）换成真实空账本 seal `31ea900c…927`；原因：`StageGate.submit` 现在按
 * `AC-085` 用 Core 的 `ReadLedgerRegistry` 重算并校验该绑定，占位值会被 `STALE_ARTIFACT` 拒绝。
 * 该 Attempt 不走工具桥，确实 0 条读取，空 seal 就是它的真实取值。请勿回填占位值。 */
/**
 * WP-12 T2.4/T2.5 end-to-end integration: one user message drives the real path
 * message → Chief assessment → DispatchSpec → Requirement/Work → queued professional Run →
 * Supervisor spawn → stage result, **with no seeded row**.
 *
 * The stack is the production one: real SQLite, real `openProject`, real
 * `createProjectExecution` (supervisor + capability store + model-gateway endpoint + control
 * endpoint), real child-process spawn of `apps/runner`, and a real Git repository for the
 * Requirement record. Only the *model* is scripted: the Runner entry below is a tiny program
 * that speaks the documented `protocol.md` §6 control channel with the Attempt capability it
 * was actually issued — so the channel, the capability check, the Orchestrator guards and the
 * Requirement save are all exercised for real.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthService,
  SecretStore,
  createProjectExecution,
  userIdFromSubject,
  type ProjectExecution,
} from '@agentdev/core';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';

import { openProject, type OpenedProject } from '../src/bootstrap.js';
import { createControlHandlers } from '../src/control-handler.js';
import { markMessageProcessing, markMessageSettled } from '../src/message-state.js';
import { createPrepareRun } from '../src/prepare-run.js';
import { createChildRunnerSpawnPort } from '../src/runner-spawn.js';

const VERSION = '0.0.0-test';
const TOKEN = 'installation-token-for-the-control-drill';
/** The credential the real `gatewaySecretResolver` must resolve (no stub resolver). */
const PROVIDER_SECRET_REF = 'provider:drill';
const PROVIDER_SECRET_VALUE = 'sk-drill-vertical-secret';
const gitPort = createNodeWorktreeGitPort();

/**
 * The scripted Runner.
 *
 * It behaves like the real one in the only ways this drill depends on: it answers `ready`
 * with the tools it was asked for, and on `attempt.prompt` it delivers through the control
 * channel using the capability from its 0600 catalog. `AGENTDEV_DRILL_MODE` selects the
 * scenario (`happy` / `out-of-envelope` / `silent`).
 */
function scriptedRunnerSource(mode: string): string {
  return `
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const attemptId = arg('--attempt-id');
const epoch = Number(arg('--epoch'));
const role = arg('--role') ?? 'chief';
const workId = arg('--work-id');
const controlUrl = arg('--control-url');
const catalogPath = arg('--models-path');
const mode = ${JSON.stringify(mode)};
const capability = JSON.parse(readFileSync(catalogPath, 'utf8')).providers['agentdev-gateway'].apiKey;

const out = (message) => process.stdout.write(JSON.stringify({ v: 1, attemptId, epoch, ...message }) + '\\n');
const post = async (path, body) => {
  const response = await fetch(controlUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + capability },
    body: JSON.stringify({ attemptId, epoch, ...body }),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep null */ }
  return { status: response.status, body: parsed };
};

const assessmentScope = { readPaths: ['src'], writePaths: ['src/theme'], operations: [], networkTargets: [] };
const dispatchScope = mode === 'out-of-envelope'
  ? { readPaths: ['src'], writePaths: ['src/elsewhere'], operations: [], networkTargets: [] }
  : assessmentScope;

const op = (name) => 'op-' + name + '-' + attemptId;
let replied = false;
const deliver = async () => {
  if (mode === 'l1' && role === 'chief') {
    // The L1 route: a delivery assessment that must NOT create a Requirement (AC-007).
    const assessment = await post('/control/assessment.submit', {
      workId,
      assessment: {
        intent: 'delivery',
        goal: 'fix the typo in the README',
        scope: assessmentScope,
        level: 'L1',
        semanticImpact: false,
        riskFlags: [],
        uncertainties: [],
        policyRevision: 1,
        reason: 'a presentation-only change',
      },
    });
    if (assessment.status !== 200) {
      process.stderr.write('DRILL_L1_REFUSED ' + JSON.stringify(assessment.body) + String.fromCharCode(10));
      out({ type: 'attempt.error', code: 'DRILL_L1_REFUSED', message: JSON.stringify(assessment.body) });
      return;
    }
    out({ type: 'attempt.result', status: 'completed', message: 'l1 assessment submitted' });
    process.exit(0);
  }
  if (mode === 'replay' && role === 'chief') {
    const body = {
      workId,
      assessment: {
        intent: 'delivery',
        goal: 'implement the dark theme',
        scope: assessmentScope,
        level: 'L2',
        semanticImpact: false,
        riskFlags: [],
        uncertainties: [],
        policyRevision: 1,
        reason: 'replay drill',
      },
    };
    const first = await post('/control/assessment.submit', { ...body, operationId: op('assess') });
    const again = await post('/control/assessment.submit', { ...body, operationId: op('assess') });
    if (first.status !== 200 || again.status !== 200 || first.body.assessmentId !== again.body.assessmentId) {
      process.stderr.write('DRILL_DEDUP_FAIL assessment ' + JSON.stringify([first, again]) + String.fromCharCode(10));
      out({ type: 'attempt.error', code: 'DRILL_DEDUP_FAIL', message: 'assessment replay' });
      return;
    }
    const changed = await post('/control/assessment.submit', {
      ...body,
      assessment: { ...body.assessment, goal: 'a different goal' },
      operationId: op('assess'),
    });
    if (changed.status !== 409) {
      process.stderr.write('DRILL_DEDUP_FAIL conflict ' + JSON.stringify(changed) + String.fromCharCode(10));
      out({ type: 'attempt.error', code: 'DRILL_DEDUP_FAIL', message: 'same key, different payload' });
      return;
    }
    const spec = {
      role: 'backend',
      purpose: 'implementation',
      goal: 'implement the dark theme',
      scope: dispatchScope,
      stage: 'develop',
      contextSelection: {
        goal: 'implement the dark theme',
        sourceRefs: [{ kind: 'message', id: workId, version: '1' }],
        reasonPerSource: { ['message:' + workId]: 'the user message' },
        featureRefs: [],
        codePaths: ['src/theme'],
        artifactRefs: [],
        excluded: [],
        unknowns: [],
        readBudget: { initialTokens: 24000, expansionTokens: 16000 },
      },
      requiredOutputs: ['stage_result'],
      requiredChild: false,
      joinPolicy: 'none',
      budgetAllocation: 5000,
    };
    const d1 = await post('/control/agent.dispatch', { spec, operationId: op('dispatch') });
    const d2 = await post('/control/agent.dispatch', { spec, operationId: op('dispatch') });
    if (d1.status !== 200 || d2.status !== 200 || d1.body.runId !== d2.body.runId) {
      process.stderr.write('DRILL_DEDUP_FAIL dispatch ' + JSON.stringify([d1, d2]) + String.fromCharCode(10));
      out({ type: 'attempt.error', code: 'DRILL_DEDUP_FAIL', message: 'dispatch replay' });
      return;
    }
    replied = true;
    out({ type: 'attempt.result', status: 'completed', message: 'replay drill complete' });
    process.exit(0);
  }
  if (role === 'chief') {
    const assessment = await post('/control/assessment.submit', {
      workId,
      assessment: {
        intent: 'delivery',
        goal: 'implement the dark theme',
        scope: assessmentScope,
        level: 'L2',
        semanticImpact: false,
        riskFlags: [],
        uncertainties: [],
        policyRevision: 1,
        reason: 'the user asked for the dark theme in plain language',
      },
    });
    if (assessment.status !== 200) {
      process.stderr.write('DRILL_ASSESSMENT_REFUSED ' + JSON.stringify(assessment.body) + String.fromCharCode(10));
      out({ type: 'attempt.error', code: 'DRILL_ASSESSMENT_REFUSED', message: JSON.stringify(assessment.body) });
      return;
    }
    const dispatch = await post('/control/agent.dispatch', {
      spec: {
        role: 'backend',
        purpose: 'implementation',
        goal: 'implement the dark theme',
        scope: dispatchScope,
        stage: 'develop',
        contextSelection: {
          goal: 'implement the dark theme',
          sourceRefs: [{ kind: 'message', id: workId, version: '1' }],
          reasonPerSource: { ['message:' + workId]: 'the user message' },
          featureRefs: [],
          codePaths: ['src/theme'],
          artifactRefs: [],
          excluded: [],
          unknowns: [],
          readBudget: { initialTokens: 24000, expansionTokens: 16000 },
        },
        requiredOutputs: ['stage_result'],
        requiredChild: false,
        joinPolicy: 'none',
        budgetAllocation: 5000,
      },
    });
    if (dispatch.status !== 200) {
      process.stderr.write('DRILL_DISPATCH_REFUSED ' + dispatch.status + ' ' + JSON.stringify(dispatch.body) + String.fromCharCode(10));
      out({ type: 'attempt.error', code: 'DRILL_DISPATCH_REFUSED', message: JSON.stringify(dispatch.body) });
      return;
    }
  } else {
    const stageBody = {
      status: 'success',
        summary: 'the dark theme is implemented',
        artifactRefs: [],
        evidenceRefs: [],
        changedPaths: ['src/theme.ts'],
        findingIds: [],
        unknowns: [],
        requestedActions: [],
        readLedgerSeq: 0,
        // The documented empty read-ledger seal for an Attempt that read nothing through the
        // tool bridge: sha256 of the genesis string with seq 0 (AC-085). Core recomputes the
        // binding and refuses a placeholder, so the drill reports the real value.
        readLedgerHash: '31ea900cb3853503cb15a97fe4e36abe3d337b4d0b834549de2bdcfb53d2e927',
      };
    const first = await post('/control/stage.submit', { result: stageBody, operationId: op('stage') });
    const result =
      mode === 'replay'
        ? await post('/control/stage.submit', { result: stageBody, operationId: op('stage') })
        : first;
    if (mode === 'replay' && first.body.stageResultId !== result.body.stageResultId) {
      process.stderr.write('DRILL_DEDUP_FAIL stage ' + JSON.stringify([first, result]) + String.fromCharCode(10));
      out({ type: 'attempt.error', code: 'DRILL_DEDUP_FAIL', message: 'stage replay' });
      return;
    }
    if (result.status !== 200 || result.body.accepted !== true) {
      out({ type: 'attempt.error', code: 'DRILL_STAGE_REFUSED', message: JSON.stringify(result.body) });
      return;
    }
  }
  replied = true;
  out({ type: 'attempt.result', status: 'completed', message: 'drill complete' });
  process.exit(0);
};

out({
  type: 'attempt.ready',
  sessionId: 'drill-session',
  provider: 'agentdev-gateway',
  modelId: 'drill-model',
  tools: role === 'chief' ? ['assessment_submit', 'agent_dispatch'] : ['stage_yield'],
  droppedTools: [],
  environmentRef: 'host:test/test/node-0',
});

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim() === '') continue;
    const command = JSON.parse(line);
    if (command.type === 'attempt.prompt' && !replied) {
      if (mode === 'silent') {
        out({ type: 'attempt.result', status: 'completed', message: 'plain text, no submission' });
        continue;
      }
      void deliver();
    }
    if (command.type === 'attempt.steer' && mode === 'silent') {
      out({ type: 'attempt.result', status: 'completed', message: 'still plain text' });
      process.exit(0);
    }
    if (command.type === 'attempt.abort' || command.type === 'attempt.shutdown') {
      out({ type: 'attempt.result', status: 'cancelled', message: 'stopped' });
      process.exit(0);
    }
  }
});
setInterval(() => out({ type: 'attempt.heartbeat', uptimeMs: 1 }), 1_000);
`;
}

let home: string;
let repo: string;
let project: OpenedProject | undefined;
let execution: ProjectExecution | undefined;
let runnerEntry: string;
/** Every completion request the recording transport saw (the real resolver's output). */
let completions: { apiKey?: string; providerId: string }[];
/** The real credential store one drill booted with (for the `tool`-audience regression). */
let drillSecrets: SecretStore;
/** Every diagnostic the daemon and the control endpoint emitted during one test. */
let logs: string[];

const caller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief' as const,
};

function seedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdev-t2-repo-'));
  const init = gitPort.initRepository(dir, { branch: 'agentdev/main' });
  if (!init.ok) throw new Error(`git init failed: ${init.errors[0]?.message ?? 'unknown'}`);
  writeFileSync(join(dir, 'README.md'), '# seeded\n');
  const commit = gitPort.commitPaths(dir, 'chore: seed', ['README.md']);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.errors[0]?.message ?? 'unknown'}`);
  return dir;
}

/** Waits for a predicate over the real store, bounded. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`the drill did not reach the expected state\n${logs.slice(-40).join('\n')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function bootStack(mode: string): Promise<void> {
  project = await openProject({
    root: repo,
    home,
    auth: AuthService.loadOrCreate({ stateDir: home }),
    installationToken: TOKEN,
    version: VERSION,
    withWeb: false,
  });
  // The credential is registered in a real `SecretStore`, and the provider names it: the
  // production `gatewaySecretResolver` must resolve it without any stub resolver
  // (WP-12 fix round 2, G1).
  const secrets = new SecretStore();
  secrets.put({ ref: PROVIDER_SECRET_REF, value: PROVIDER_SECRET_VALUE, audience: 'gateway' });
  drillSecrets = secrets;
  const provider = project.config.upsertProvider({
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1',
    enabled: true,
    secretRef: PROVIDER_SECRET_REF,
    models: [
      {
        id: 'drill-model',
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        reasoningLevels: ['off'],
        vision: false,
      },
    ],
  });
  project.config.update('global', {
    roleOverrides: {
      chief: {
        providerId: provider.providerId,
        modelId: 'drill-model',
        reasoning: 'off',
        skills: [],
        toolSubset: [],
        contextLimit: 32_000,
      },
      backend: {
        providerId: provider.providerId,
        modelId: 'drill-model',
        reasoning: 'off',
        skills: [],
        toolSubset: [],
        contextLimit: 32_000,
      },
    },
  });
  runnerEntry = join(home, 'drill-runner.mjs');
  writeFileSync(runnerEntry, scriptedRunnerSource(mode));
  const opened = project;
  execution = await createProjectExecution({
    store: opened.store,
    config: opened.config,
    snapshots: opened.snapshots,
    secrets,
    // A recording transport: it never leaves the process, and it proves which credential the
    // real resolver produced for the Run.
    transport: {
      complete: (request) => {
        completions.push({
          providerId: request.providerId,
          ...(request.apiKey === undefined ? {} : { apiKey: request.apiKey }),
        });
        return Promise.resolve({ ok: true, text: 'pong', inputTokens: 1, outputTokens: 1 });
      },
    },
    prepare: ({ capabilities, gatewayUrl, controlUrl }) =>
      createPrepareRun({
        store: opened.store,
        config: opened.config,
        capabilities,
        gatewayUrl,
        controlUrl,
        projectRoot: opened.root,
        attemptsDir: join(opened.dataDir, 'attempts'),
        log: (line) => logs.push(line),
      }),
    spawn: createChildRunnerSpawnPort({
      repoRoot: process.cwd(),
      // The child environment is the shipped allowlist, so the scenario is baked into the
      // generated entry rather than smuggled through an env var the allowlist drops.
      env: { ...process.env, AGENTDEV_RUNNER_ENTRY: runnerEntry },
      log: (line) => logs.push(line),
    }),
    control: {
      attach: ({ orchestrator, stageGate }) =>
        createControlHandlers({
          store: opened.store,
          orchestrator,
          stageGate,
          requirementSaves: opened.services.requirementSaves,
          log: (line) => logs.push(line),
        }),
      onAttemptStarted: ({ runId }) => markMessageProcessing(opened.store, runId),
      onRunSettled: ({ runId, status }) => markMessageSettled(opened.store, runId, status),
    },
    tickMs: 25,
    log: (line) => logs.push(line),
  });
  opened.protocol.attachOrchestrator(execution.orchestrator);
  opened.protocol.attachGateway(execution.gateway);
  execution.start('host-drill-1');
}

/** Sends one message through the real protocol command, exactly as the composer does. */
function sendMessage(body: string): { messageId: string; workId: string } {
  const opened = project;
  if (opened === undefined) throw new Error('the project is not open');
  const conversation = opened.protocol.dispatch(
    'conversation.create',
    { title: 'drill' },
    { caller },
  ) as { entityId: string };
  const sent = opened.protocol.dispatch(
    'conversation.message.send',
    { conversationId: conversation.entityId, body, attachmentIds: [] },
    { caller },
  ) as { messageId: string; workId: string };
  return sent;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-t2-home-'));
  repo = seedRepo();
  logs = [];
  completions = [];
});

/** Waits until a diagnostic line matches, so a refusal is observed rather than assumed. */
async function waitForLog(pattern: RegExp, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = logs.find((line) => pattern.test(line));
    if (found !== undefined) return found;
    if (Date.now() > deadline)
      throw new Error(`no log line matched ${String(pattern)}\n${logs.join('\n')}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

afterEach(async () => {
  await execution?.stop();
  execution = undefined;
  await project?.close();
  project = undefined;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2)', () => {
  it('runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069)', async () => {
    await bootStack('happy');
    const opened = project;
    const running = execution;
    if (opened === undefined || running === undefined) throw new Error('unreachable');

    const sent = sendMessage('please implement the dark theme in src/theme');
    const store = opened.store;

    // 1. The message queued a real Chief Run: no seeding, and `run.queued` is on the log.
    const chiefRun = await waitFor(() =>
      store.runs.list({ where: "work_id = ? AND role = 'chief'", params: [sent.workId] }).at(-1),
    );
    await waitFor(() =>
      store.attempts
        .list({ where: 'run_id = ?', params: [chiefRun.id] })
        .find((attempt) => attempt.status === 'running'),
    );
    expect(chiefRun.dispatchSnapshotId).toMatch(/^[0-9a-f]{64}$/u);
    expect(chiefRun.parentRunId).toBeUndefined();
    const queued = store.events
      .readAfter(0, { limit: 500 })
      .filter((event) => event.name === 'run.queued' && event.entityId === chiefRun.id);
    expect(queued).toHaveLength(1);
    // The claimed Attempt moved the message to `processing` (experience.md §22).
    expect(store.messages.find(sent.messageId)?.state).toBe('processing');

    // 2. The Chief's control calls created the assessment, the derived authorization, the
    //    Work level/scope and the Requirement — all from the message, none seeded.
    const work = await waitFor(() => {
      const row = store.works.find(sent.workId);
      return row?.level === 'L2' ? row : undefined;
    });
    expect(work.authorizationRef).toBeDefined();
    expect(work.scope.writePaths).toEqual(['src/theme']);
    expect(store.assessments.list({ where: 'work_id = ?', params: [sent.workId] }).length).toBe(1);
    const authorization = store.authorizations.find(work.authorizationRef ?? '');
    expect(authorization?.sourceRef.id).toBe(sent.messageId);
    expect(authorization?.operations).toEqual(['read', 'edit', 'write']);
    expect(authorization?.operations).not.toContain('bash');

    const requirement = await waitFor(
      () => store.requirements.list({ where: 'work_id = ?', params: [sent.workId] })[0],
    );
    expect(requirement.lifecycle).toBe('active');
    expect(requirement.phase).toBe('plan');
    expect(requirement.goal).toContain('dark theme');
    // The record is a real Git-backed projection: `recordVersion`/`portableRef` only
    // exist once RequirementSaveService committed the pair (`requirements.md` §6).
    expect(requirement.recordVersion).toBe(1);
    expect(requirement.portableRef.revision).toMatch(/^[0-9a-f]{40}$/u);
    expect(requirement.workId).toBe(sent.workId);

    // 3. `agent.dispatch` queued the professional Run as a real Chief child, with the
    //    Core-injected revision and a budget capped by the parent's allocation.
    const professional = await waitFor(() =>
      store.runs
        .list({ where: 'work_id = ?', params: [sent.workId] })
        .find((run) => run.role === 'backend'),
    );
    expect(professional.parentRunId).toBe(chiefRun.id);
    expect(
      store.events
        .readAfter(0, { limit: 1_000 })
        .filter((event) => event.name === 'run.queued' && event.entityId === professional.id),
    ).toHaveLength(1);
    expect(professional.budgetAllocation).toBeLessThanOrEqual(5_000);
    expect(professional.budgetAllocation).toBeGreaterThan(0);
    const frozen = opened.snapshots.read(professional.dispatchSnapshotId);
    const resolution = opened.config.resolve('backend');
    expect(resolution.ok).toBe(true);
    // The frozen revision is the *current* resolved one, injected by Core — the draft
    // cannot name it (`data.md` §3).
    if (resolution.ok) {
      expect(frozen?.payload['profileRevision']).toBe(resolution.resolution.revision);
    }

    // 4. The professional Runner delivered through `stage.submit`: a real stage_result row
    //    and the documented `stage.completed` event.
    const stageResult = await waitFor(
      () => store.stageResults.list({ where: 'run_id = ?', params: [professional.id] })[0],
    );
    expect(stageResult.status).toBe('success');
    expect(stageResult.changedPaths).toEqual(['src/theme.ts']);
    const completed = store.events
      .readAfter(0, { limit: 1_000 })
      .filter((event) => event.name === 'stage.completed' && event.entityId === professional.id);
    expect(completed).toHaveLength(1);

    // 5. Both Runs settled, and the message followed the Chief Run to `processed`.
    const settled = await waitFor(() => {
      const row = store.runs.find(professional.id);
      return row?.status === 'completed' ? row : undefined;
    });
    expect(settled.status).toBe('completed');
    expect(store.runs.find(chiefRun.id)?.status).toBe('completed');
    expect(store.messages.find(sent.messageId)?.state).toBe('processed');
    const processed = store.events
      .readAfter(0, { limit: 2_000 })
      .filter((event) => event.name === 'message.processed' && event.entityId === sent.messageId);
    expect(processed).toHaveLength(1);

    // 6. The board shows the requirement in its active column.
    const board = opened.protocol.dispatch('board', {}, { caller }) as { columns?: unknown };
    expect(JSON.stringify(board)).toContain(requirement.id);
  });

  it('refuses an out-of-envelope agent.dispatch with zero residue', async () => {
    await bootStack('out-of-envelope');
    const opened = project;
    if (opened === undefined) throw new Error('unreachable');
    const sent = sendMessage('please implement the dark theme in src/theme');
    const store = opened.store;

    // The assessment derived the `src/theme` envelope; the dispatch then reached for
    // `src/elsewhere`, so it was refused and no professional Run exists.
    await waitFor(() => (store.works.find(sent.workId)?.level === 'L2' ? true : undefined));
    // The control endpoint's own refusal line: the spec was rejected, not silently ignored.
    const refusal = await waitForLog(/control-endpoint: refused 401 NOT_AUTHORIZED/);
    expect(refusal).toContain('does not cover the declared scope');
    expect(
      store.runs
        .list({ where: 'work_id = ?', params: [sent.workId] })
        .filter((run) => run.role !== 'chief'),
    ).toHaveLength(0);
    expect(store.authorizations.list({ where: 'work_id = ?', params: [sent.workId] })).toHaveLength(
      1,
    );
    expect(store.works.find(sent.workId)?.scope.writePaths).toEqual(['src/theme']);
  });

  it('resolves the frozen provider credential through the real resolver (AC-005, G1)', async () => {
    await bootStack('happy');
    const opened = project;
    const running = execution;
    if (opened === undefined || running === undefined) throw new Error('unreachable');
    const store = opened.store;
    const sent = sendMessage('please implement the dark theme in src/theme');

    // `message.send` queued a Chief Run even though the provider carries a `secretRef` and no
    // `secret` Grant exists anywhere: admission only needs "a credential is registered"
    // (this is exactly the failure the security review found).
    const chiefRun = await waitFor(() =>
      store.runs.list({ where: "work_id = ? AND role = 'chief'", params: [sent.workId] }).at(-1),
    );
    const completion = await running.gateway.complete(chiefRun, [
      { role: 'user', content: 'ping' },
    ]);
    expect(completion.ok).toBe(true);
    expect(completions).toHaveLength(1);
    // The real `gatewaySecretResolver` produced the registered value for this Run.
    expect(completions[0]?.apiKey).toBe(PROVIDER_SECRET_VALUE);

    // The allowance is `gateway`-only: the same ref with no Grant is still refused for tools.
    const toolVerdict = drillSecrets.resolve(PROVIDER_SECRET_REF, {
      audience: 'tool',
      purpose: 'implementation',
      role: 'backend',
      workId: sent.workId,
      stage: 'develop',
      at: new Date().toISOString(),
      grants: [],
    });
    expect(toolVerdict.ok).toBe(false);
  });

  it('deduplicates control replays by (attempt, method, operationId)', async () => {
    await bootStack('replay');
    const opened = project;
    if (opened === undefined) throw new Error('unreachable');
    const sent = sendMessage('please implement the dark theme in src/theme');
    const store = opened.store;

    // The scripted Runner posted each control call twice with the same key; the ledger must
    // have produced one assessment, one professional Run and one stage result, and the
    // same key with a different payload must be a conflict.
    await waitFor(() =>
      store.stageResults.list({ where: 'run_id != ?', params: [''] }).length > 0 ? true : undefined,
    );
    await waitForLog(/message\.processed|stage\.submit/);
    const assessments = store.assessments.list({ where: 'work_id = ?', params: [sent.workId] });
    const professional = store.runs
      .list({ where: 'work_id = ?', params: [sent.workId] })
      .filter((run) => run.role !== 'chief');
    expect(assessments).toHaveLength(1);
    expect(professional).toHaveLength(1);
    expect(
      store.stageResults.list({ where: 'run_id = ?', params: [professional[0]?.id ?? ''] }),
    ).toHaveLength(1);
    expect(
      store.events
        .readAfter(0, { limit: 2_000 })
        .filter((event) => event.name === 'stage.completed'),
    ).toHaveLength(1);
  });

  it('never puts an L1 assessment on the board (AC-007/AC-068)', async () => {
    await bootStack('l1');
    const opened = project;
    if (opened === undefined) throw new Error('unreachable');
    const sent = sendMessage('fix the typo in the README');
    const store = opened.store;

    // The L1 assessment must not create a Requirement (no row, no Git record, no card).
    await waitFor(() =>
      store.assessments.list({ where: 'work_id = ?', params: [sent.workId] }).length > 0
        ? true
        : undefined,
    );
    expect(store.requirements.list({ where: 'work_id = ?', params: [sent.workId] })).toHaveLength(
      0,
    );
    const board = opened.protocol.dispatch('board', {}, { caller }) as {
      columns: Record<string, unknown[]>;
      requirementIds: string[];
      excludedWorkIds: string[];
    };
    // No card in any column, and the L1 Work is explicitly excluded from the board.
    expect(Object.values(board.columns).flat()).toHaveLength(0);
    expect(board.requirementIds).toHaveLength(0);
    expect(board.excludedWorkIds).toContain(sent.workId);
  });

  it('asks for one correction, then records a contract violation on a second miss', async () => {
    await bootStack('silent');
    const opened = project;
    if (opened === undefined) throw new Error('unreachable');
    const sent = sendMessage('please implement the dark theme in src/theme');
    const store = opened.store;

    const chiefRun = await waitFor(() =>
      store.runs.list({ where: "work_id = ? AND role = 'chief'", params: [sent.workId] }).at(-1),
    );
    // `protocol.md` §6: plain text earns one corrective prompt, then a contract violation.
    const violated = await waitFor(() => {
      const row = store.runs.find(chiefRun.id);
      return row?.status === 'contract_violation' ? row : undefined;
    });
    expect(violated.status).toBe('contract_violation');
    await waitForLog(/delivered no structured result; corrective prompt sent/);
    const ended = store.events
      .readAfter(0, { limit: 2_000 })
      .filter((event) => event.name === 'run.ended' && event.entityId === chiefRun.id);
    expect(ended.length).toBeGreaterThanOrEqual(1);
    // The message is `failed`, and nothing was dispatched.
    expect(store.messages.find(sent.messageId)?.state).toBe('failed');
    expect(
      store.runs
        .list({ where: 'work_id = ?', params: [sent.workId] })
        .filter((run) => run.role !== 'chief'),
    ).toHaveLength(0);
  });
});
