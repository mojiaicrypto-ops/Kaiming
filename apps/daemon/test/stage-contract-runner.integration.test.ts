/**
 * Structured delivery with a real `apps/runner` child (`AC-047`).
 *
 * `protocol.md` §6: "普通文本结束没有该结果时Run等待提交提示，连续两次不合规为contract_violation" —
 * a professional Run that only *says* it finished delivered nothing, so Core answers the
 * first documented empty turn with the corrective prompt and keeps the Attempt alive; a
 * second empty turn is recorded as a `contract_violation`. `packages/core/test/join.test.ts`
 * proves the Core rule at the library layer (two schema rejections), and this drill proves
 * the **product path**: a real message → real Chief child → real `agent.dispatch` → a real
 * professional Runner child whose model never calls `stage_yield`, through the real
 * supervisor, control endpoint and `RunLifecycle`.
 *
 * The only stub is the Provider (`ScriptedProvider`); the Runner, endpoint, supervisor,
 * worktree-less Attempt, stage gate and Run rows are real. Requires `pnpm build` first: the
 * child runs the shipped `apps/runner/dist/cli.js`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthService,
  SecretStore,
  createProjectExecution,
  userIdFromSubject,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayTransport,
  type ProjectExecution,
} from '@agentdev/core';
import { openProject, type OpenedProject } from '../src/bootstrap.js';
import { createControlHandlers } from '../src/control-handler.js';
import { markMessageProcessing, markMessageSettled } from '../src/message-state.js';
import { createPrepareRun } from '../src/prepare-run.js';
import { createChildRunnerSpawnPort } from '../src/runner-spawn.js';

const VERSION = '0.0.0-test';
const TOKEN = 'installation-token-for-the-ac047-vertical-drill';
const PROVIDER_SECRET_REF = 'provider:ac047';
const PROVIDER_SECRET_VALUE = 'sk-ac047-vertical-secret';
/** A path the message names, so the assessment derives a real authorization. */
const NOTE = 'src/notes.ts';

const caller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief' as const,
};

/** One scripted model turn: tool calls, plain text, or a gated turn. */
type Turn =
  | { readonly toolCalls: readonly { readonly name: string; readonly args: unknown }[] }
  | { readonly text: string }
  | { readonly await: () => Promise<void>; readonly then: Turn };

/**
 * The stub Provider: the running model is the one input a test machine does not have.
 *
 * Turns are counted per role so the Chief's assessment/dispatch and the professional Run's
 * non-delivery are deterministic; a professional turn always answers with prose and never
 * calls `stage_yield`.
 */
class ScriptedProvider implements GatewayTransport {
  private chief = 0;
  private backend = 0;
  readonly seen: string[] = [];

  constructor(
    private readonly scripts: {
      readonly chief: (turn: number) => Turn | undefined;
      readonly backend: (turn: number) => Turn | undefined;
    },
  ) {}

  async complete(request: GatewayRequest): Promise<GatewayResponse> {
    const tools = (request.tools ?? []).map((tool) => {
      if (typeof tool !== 'object' || tool === null) return '';
      const direct = (tool as { name?: unknown }).name;
      if (typeof direct === 'string') return direct;
      const fn = (tool as { function?: { name?: unknown } }).function;
      return typeof fn?.name === 'string' ? fn.name : '';
    });
    const isChief = tools.includes('assessment_submit');
    const turn = isChief ? this.chief++ : this.backend++;
    this.seen.push(`${isChief ? 'chief' : 'backend'}#${String(turn)}`);
    let scripted = (isChief ? this.scripts.chief : this.scripts.backend)(turn);
    while (scripted !== undefined && 'await' in scripted) {
      await scripted.await();
      scripted = scripted.then;
    }
    const usage = { inputTokens: 13, outputTokens: 5 };
    if (scripted === undefined) {
      return { ok: true, text: 'ac047-fallback', ...usage };
    }
    if ('text' in scripted) {
      return { ok: true, text: scripted.text, ...usage };
    }
    return {
      ok: true,
      text: '',
      toolCalls: scripted.toolCalls.map((call, index) => ({
        id: `call_${String(index)}_${String(turn)}`,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
      ...usage,
    };
  }
}

async function waitFor<T>(
  read: () => T | undefined,
  label: string | (() => string) = 'the vertical chain',
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${typeof label === 'function' ? label() : label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('structured delivery with a real Runner child (AC-047)', () => {
  let home: string;
  let repo: string;
  let opened: OpenedProject;
  let execution: ProjectExecution;
  let logs: string[];
  let runnerIpc: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentdev-ac047-home-'));
    repo = mkdtempSync(join(tmpdir(), 'agentdev-ac047-repo-'));
    logs = [];
    runnerIpc = [];
    mkdirSync(join(repo, 'docs'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, NOTE), 'export const notes = 1;\n', 'utf8');
    writeFileSync(join(repo, 'README.md'), '# ac047\n', 'utf8');
    execFileSync('git', ['init', '-q', '-b', 'agentdev/main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'ac047@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'AC047'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  });

  afterEach(async () => {
    try {
      await execution?.stop();
    } catch {
      // A half-built stack has nothing to stop.
    }
    opened?.store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('refuses a spoken completion, then records the second non-compliance as a contract violation (AC-047)', async () => {
    opened = await openProject({
      root: repo,
      home,
      auth: AuthService.loadOrCreate({ stateDir: home }),
      installationToken: TOKEN,
      version: VERSION,
      withWeb: false,
    });
    const secrets = new SecretStore();
    secrets.put({ ref: PROVIDER_SECRET_REF, value: PROVIDER_SECRET_VALUE, audience: 'gateway' });
    const provider = opened.config.upsertProvider({
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1',
      enabled: true,
      secretRef: PROVIDER_SECRET_REF,
      models: [
        {
          id: 'ac047-model',
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    });
    const profile = {
      providerId: provider.providerId,
      modelId: 'ac047-model',
      reasoning: 'off' as const,
      skills: [],
      toolSubset: [],
      contextLimit: 32_000,
    };
    opened.config.update('global', { roleOverrides: { chief: profile, backend: profile } });
    opened.config.update('global', { permissionMode: 'full_access' });

    const providerStub = new ScriptedProvider({
      chief: (turn) => {
        if (turn === 0) {
          return {
            toolCalls: [
              {
                name: 'assessment_submit',
                args: {
                  intent: 'delivery',
                  goal: `update ${NOTE}`,
                  scope: {
                    readPaths: [NOTE],
                    writePaths: [NOTE],
                    operations: ['read', 'edit'],
                    networkTargets: [],
                  },
                  level: 'L2',
                  semanticImpact: false,
                  riskFlags: [],
                  uncertainties: [],
                  policyRevision: 1,
                  reason: 'the user named the notes file',
                },
              },
            ],
          };
        }
        if (turn === 1) {
          return {
            toolCalls: [
              {
                name: 'agent_dispatch',
                args: {
                  role: 'backend',
                  purpose: 'implementation',
                  goal: `update ${NOTE}`,
                  scope: {
                    readPaths: [NOTE],
                    writePaths: [NOTE],
                    operations: ['read', 'edit'],
                    networkTargets: [],
                  },
                  stage: 'develop-L2',
                  contextSelection: {
                    goal: `update ${NOTE}`,
                    sourceRefs: [],
                    reasonPerSource: {},
                    featureRefs: [],
                    codePaths: [NOTE],
                    artifactRefs: [],
                    excluded: [],
                    unknowns: [],
                    readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
                  },
                  requiredOutputs: ['stage_result'],
                  requiredChild: false,
                  joinPolicy: 'none',
                  budgetAllocation: 20_000,
                },
              },
            ],
          };
        }
        return { text: 'the chief finished' };
      },
      // The whole point: the professional model only ever *says* it is done. It never
      // calls `stage_yield`, on any turn, including the corrective one.
      backend: () => ({ text: '我已完成全部工作，任务已完成。' }),
    });

    execution = await createProjectExecution({
      store: opened.store,
      config: opened.config,
      snapshots: opened.snapshots,
      secrets,
      transport: providerStub,
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
      // The real Runner child: the shipped `apps/runner/dist/cli.js`, no override.
      spawn: createChildRunnerSpawnPort({
        repoRoot: process.cwd(),
        log: (line) => {
          logs.push(line);
          runnerIpc.push(line);
        },
      }),
      control: {
        attach: ({ orchestrator, stageGate, readLedgers }) =>
          createControlHandlers({
            store: opened.store,
            orchestrator,
            stageGate,
            readLedgers,
            artifacts: opened.services.artifacts,
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
    execution.start(`host-ac047-${String(process.pid)}`);

    // 1. A real message becomes a real Work; the real Chief child assesses and dispatches.
    const conversation = opened.protocol.dispatch(
      'conversation.create',
      { title: 'ac047' },
      { caller },
    ) as { entityId: string };
    const sent = opened.protocol.dispatch(
      'conversation.message.send',
      { conversationId: conversation.entityId, body: `请更新 ${NOTE}`, attachmentIds: [] },
      { caller },
    ) as { workId: string; messageId: string };
    const workId = sent.workId;

    const professional = await waitFor(
      () => {
        execution.supervisor.tick();
        return opened.store.runs
          .list({ where: "work_id = ? AND role = 'backend'", params: [workId] })
          .find((run) => run.status !== 'cancelled');
      },
      () =>
        [
          `runs=${opened.store.runs
            .list({ where: 'work_id = ?', params: [workId] })
            .map((run) => `${run.role}:${run.status}`)
            .join(',')}`,
          `provider=${providerStub.seen.join('|')}`,
          `logs=${logs.slice(-8).join(' ~ ')}`,
        ].join('\n'),
    );

    // 2. The first spoken turn is refused: Core sends the corrective prompt and keeps the
    //    Attempt alive instead of accepting "I finished" as a delivery.
    await waitFor(
      () =>
        logs.some((line) => line.includes('delivered no structured result; corrective prompt sent'))
          ? true
          : undefined,
      () =>
        `the corrective prompt for ${professional.id}\nprovider=${providerStub.seen.join('|')}\nlogs=${logs.slice(-14).join('\n')}`,
      60_000,
    );
    expect(
      logs.some((line) => line.includes('delivered no structured result; corrective prompt sent')),
    ).toBe(true);
    // The corrective prompt really reached the child and it answered a second time.
    await waitFor(
      () =>
        providerStub.seen.filter((entry) => entry.startsWith('backend')).length >= 2
          ? true
          : undefined,
      () => `the corrected second model turn\nprovider=${providerStub.seen.join('|')}`,
      60_000,
    );

    // 3. The second spoken end is the documented contract violation.
    const settled = await waitFor(
      () => {
        execution.supervisor.tick();
        const current = opened.store.runs.find(professional.id);
        if (current === undefined) return undefined;
        return ['contract_violation', 'failed', 'cancelled', 'completed'].includes(current.status)
          ? current
          : undefined;
      },
      () =>
        `the settled professional Run\nstatus=${String(opened.store.runs.find(professional.id)?.status)}\nprovider=${providerStub.seen.join('|')}\nlogs=${logs.slice(-10).join('\n')}`,
      60_000,
    );
    expect(settled.status).toBe('contract_violation');

    // 4. The violation is recorded with its own facts, not silently parked.
    const ended = opened.store.events
      .readAfter(0, { limit: 10_000 })
      .filter((event) => event.name === 'run.ended' && event.entityId === professional.id);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.data).toMatchObject({
      outcome: 'contract_violation',
      rejections: 2,
      reason: 'the Attempt ended twice without a structured submission',
    });
    // A spoken success never stands in for the structure: no stage result was recorded.
    expect(
      opened.store.stageResults.list({ where: 'run_id = ?', params: [professional.id] }),
    ).toHaveLength(0);
    // The turn is not left `processing`: the Run ended and its message reached a terminal state.
    const message = opened.store.messages.find(sent.messageId);
    expect(['processed', 'failed']).toContain(message?.state);

    const attemptStates = opened.store.attempts
      .list({ where: 'run_id = ?', params: [professional.id] })
      .map((attempt) => attempt.status);
    expect(attemptStates).not.toContain('running');
    expect(attemptStates).not.toContain('starting');
    // The child's own words travelled to stderr (diagnosis), never into a delivery.
    expect(runnerIpc.some((line) => line.includes('delivered nothing'))).toBe(true);
  }, 180_000);
});
