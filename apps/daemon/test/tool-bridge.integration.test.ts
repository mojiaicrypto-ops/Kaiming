/**
 * T3b — the tool bridge in a **real vertical chain**.
 *
 * This is the test the T3 plan's exit conditions asked for and the earlier suites could not
 * provide: a real message becomes a real Work, a real **`apps/runner` child process** runs
 * the real Pi session, the model's tool calls travel the real control endpoint into the real
 * Broker, real files change, and the read ledger the stage result reports is the one Core
 * computed. Nothing is seeded: the Work, its authorization, the Tasks and both Runs come
 * from the real protocol/control paths.
 *
 * The only stub is the **Provider** (a `GatewayTransport` returning scripted `tool_calls`) —
 * exactly the layer the plan allows to be scripted. The daemon stack is the real
 * `createProjectExecution` **with the `tools:` factory attached**, which is the composition
 * `apps/daemon/src/main.ts` uses and which no earlier test constructed.
 *
 * Requires `pnpm build` first: the Runner child runs `apps/runner/dist/cli.js`, the shipped
 * path (`apps/daemon/src/runner-spawn.ts`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanDraft } from '@agentdev/core';
import {
  AuthService,
  PlanGateService,
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
import { createToolHandler } from '../src/tool-handler.js';

const VERSION = '0.0.0-test';
const TOKEN = 'installation-token-for-the-t3b-vertical-drill';
const PROVIDER_SECRET_REF = 'provider:t3b';
const PROVIDER_SECRET_VALUE = 'sk-t3b-vertical-secret';
/**
 * The file the whole chain touches.
 *
 * It lives under the Project's `codeRoot` (`src`, `bootstrap.ts`) on purpose: the read
 * ledger's scope is the Run's `(role, stage)` ACL row, and a bridge read outside that
 * scope cannot be recorded. A drill on a path the ACL refuses would seal an empty binding
 * over a read that really happened — the fail-closed path `read-ledger.test.ts` covers —
 * not the positive `AC-085` binding this drill exists to prove.
 */
const NOTE = 'src/notes.md';

const caller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief' as const,
};

/** One scripted model turn: either tool calls or plain text. */
type Turn =
  | {
      readonly toolCalls: readonly { readonly name: string; readonly args: unknown }[];
    }
  | { readonly text: string }
  | { readonly await: () => Promise<void>; readonly then: Turn };

/**
 * The stub Provider.
 *
 * It is the only non-real component: the Runner, the endpoint, the Broker, the Grant store,
 * the ledger and the filesystem are real. Turns are counted per role so the Chief's
 * assessment/dispatch and the professional Run's read/edit/stage sequence are deterministic.
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
    // The gateway forwards the SDK's schemas in the OpenAI shape
    // (`{type:'function', function:{name}}`), and a caller may also hand a flat `{name}`
    // list; both are read here so the drill's script is chosen by the real tool set.
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
    const usage = { inputTokens: 11, outputTokens: 7 };
    if (scripted === undefined) {
      return { ok: true, text: 'T3B-DONE', ...usage };
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
  label = 'the vertical chain',
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('tool bridge vertical drill (T3b)', () => {
  let home: string;
  let repo: string;
  let opened: OpenedProject;
  let execution: ProjectExecution;
  let logs: string[];
  let resolveChiefGate: () => void;
  let chiefGate: Promise<void>;
  let resolveBackendGate: () => void;
  let backendGate: Promise<void>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentdev-t3b-home-'));
    repo = mkdtempSync(join(tmpdir(), 'agentdev-t3b-repo-'));
    logs = [];
    mkdirSync(join(repo, 'docs'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, NOTE), '# notes\n\noriginal\n', 'utf8');
    writeFileSync(join(repo, 'README.md'), '# t3b\n', 'utf8');
    execFileSync('git', ['init', '-q', '-b', 'agentdev/main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't3b@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'T3B'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    chiefGate = new Promise<void>((resolve) => {
      resolveChiefGate = resolve;
    });
    backendGate = new Promise<void>((resolve) => {
      resolveBackendGate = resolve;
    });
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

  it('reads and edits a real file through the Broker, with a real Runner child', async () => {
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
          id: 't3b-model',
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    });
    const profile = {
      providerId: provider.providerId,
      modelId: 't3b-model',
      reasoning: 'off' as const,
      skills: [],
      toolSubset: [],
      contextLimit: 32_000,
    };
    opened.config.update('global', { roleOverrides: { chief: profile, backend: profile } });
    // `execution.md` §1: Full Access is the host-process mode; the container modes need
    // Docker and are covered by their own integration tests.
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
                  reason: 'the user asked for the notes to be updated',
                },
              },
            ],
          };
        }
        if (turn === 1) {
          // Hold the Chief Run open so `plan.approve` (a real user action) has a live parent.
          return { await: () => chiefGate, then: { text: 'waiting for the plan approval' } };
        }
        return undefined;
      },
      backend: (turn) => {
        if (turn === 0) return { toolCalls: [{ name: 'read', args: { path: NOTE } }] };
        if (turn === 1) {
          return {
            toolCalls: [
              {
                name: 'edit',
                args: { path: NOTE, content: '# notes\n\nupdated by the T3b drill\n' },
              },
            ],
          };
        }
        if (turn === 2) {
          return {
            toolCalls: [
              {
                name: 'stage_yield',
                args: {
                  status: 'success',
                  summary: 'the notes were updated through the Broker',
                  artifactRefs: [],
                  evidenceRefs: [],
                  changedPaths: [NOTE],
                  findingIds: [],
                  unknowns: [],
                  requestedActions: [],
                },
              },
            ],
          };
        }
        return { await: () => backendGate, then: { text: 'T3B-DONE' } };
      },
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
        log: (line) => logs.push(line),
      }),
      // The production assembly `main.ts` uses: the stack's Grant store, Broker and ledger
      // handed to the daemon's tool handler, which adds the domain services.
      tools: {
        attach: ({ store, broker, grantService, readLedgers }) =>
          createToolHandler({
            store,
            broker,
            grantService,
            readLedgers,
            artifacts: opened.services.artifacts,
            planGate: new PlanGateService({ store, artifacts: opened.services.artifacts }),
            secrets,
            mode: 'host',
            log: (line) => logs.push(line),
          }),
      },
      broker: {
        dataDir: opened.dataDir,
        writableReportRoots: [join(opened.dataDir, 'tool-reports')],
      },
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
    opened.protocol.attachToolBridge({
      requestPermission: (input) => {
        const decided = execution.grantService.requestPermission(input);
        return {
          decisionId: decided.decisionId,
          version: decided.version,
          state: decided.state,
          blockerAttached: decided.blockerAttached,
          ...(decided.runStatus === undefined ? {} : { runStatus: decided.runStatus }),
        };
      },
      respondPermission: (input) => {
        if (input.choice === 'deny') {
          const denied = execution.grantService.denyPermission(input.decisionId, input.runId);
          return {
            decisionId: denied.decisionId,
            version: denied.version,
            state: denied.state,
            blockerAttached: denied.blockerAttached,
          };
        }
        const approved = execution.grantService.approvePermission({
          decisionId: input.decisionId,
          operation: input.operation,
          runId: input.runId,
          role: input.role,
          stage: input.stage,
          targets: input.targets,
          toolOperationId: input.toolOperationId,
          inputHash: input.inputHash,
          expiresAt: input.expiresAt,
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.limits === undefined ? {} : { limits: input.limits }),
        });
        return {
          decisionId: approved.decisionId,
          version: approved.version,
          state: approved.state,
          blockerAttached: approved.blockerAttached,
          ...(approved.grant === undefined ? {} : { grantId: approved.grant.id }),
        };
      },
      cleanupRun: (runId) => execution.cleanupRun(runId),
    });
    execution.start(`host-t3b-${String(process.pid)}`);

    // 1. A real message becomes a real Work with its authorization and base revision.
    const conversation = opened.protocol.dispatch(
      'conversation.create',
      { title: 't3b' },
      { caller },
    ) as { entityId: string };
    const sent = opened.protocol.dispatch(
      'conversation.message.send',
      { conversationId: conversation.entityId, body: `请把 ${NOTE} 更新一下`, attachmentIds: [] },
      { caller },
    ) as { workId: string };
    const workId = sent.workId;

    // 2. The Chief's real runner child submits the assessment from the scripted Provider.
    const diagnose = (): string =>
      [
        `work=${String(opened.store.works.find(workId)?.status)}`,
        `live=${String(execution?.liveCount())}`,
        `runs=${opened.store.runs
          .list({ where: 'work_id = ?', params: [workId] })
          .map((run) => `${run.role}:${run.status}`)
          .join(',')}`,
        `attempts=${opened.store.attempts
          .list({ where: 'run_id = ?', params: [chiefRunId()] })
          .map((attempt) => attempt.status)
          .join(',')}`,
        `provider=${providerStub.seen.join('|')}`,
        `attemptDiag=${opened.store.attempts
          .list({ where: 'run_id = ?', params: [chiefRunId()] })
          .map(
            (attempt) =>
              `${attempt.status}:${attempt.runnerId ?? '-'}:${attempt.heartbeatAt ?? '-'}`,
          )
          .join(',')}`,
        `logs=${logs.slice(-12).join(' || ')}`,
      ].join('\n');

    function chiefRunId(): string {
      return (
        opened.store.runs.list({ where: "work_id = ? AND role = 'chief'", params: [workId] }).at(-1)
          ?.id ?? ''
      );
    }

    const chiefRun = await waitFor(
      () => {
        // The supervisor's own interval is `unref()`ed (the daemon has other handles); this
        // test process has none, so one nudge per poll keeps the real scheduler running
        // without changing what it does.
        execution.supervisor.tick();
        return opened.store.runs
          .list({ where: "work_id = ? AND role = 'chief'", params: [workId] })
          .find((run) => run.status !== 'cancelled' && run.status !== 'queued');
      },
      'the Chief Run',
      60_000,
    );
    const assessed = await waitFor(() => {
      execution.supervisor.tick();
      const work = opened.store.works.find(workId);
      if (work?.status !== 'running') return undefined;
      if (opened.store.assessments.list({ where: 'work_id = ?', params: [workId] }).length === 0) {
        return undefined;
      }
      return work;
    }, `the Chief assessment\n${diagnose()}`);
    expect(assessed.baseRevision).toBeDefined();
    expect(assessed.authorizationRef).toBeDefined();

    // 3. The user approves a Plan (a real `plan.approve`): Core materialises the Tasks and
    //    queues the professional Run. This is what gives the Run file Grants and a Plan.
    const draft: PlanDraft = {
      goal: `update ${NOTE}`,
      scope: {
        readPaths: [NOTE],
        writePaths: [NOTE],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      tasks: [
        {
          id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0040',
          role: 'backend',
          goal: `update ${NOTE}`,
          paths: [NOTE],
          dependsOn: [],
          acceptanceIds: ['AC-048'],
          checks: ['pnpm test:unit'],
        },
      ],
      interfaceChanges: [],
      dataChanges: [],
      risks: [],
      rollback: [],
    };
    const approved = opened.protocol.dispatch(
      'plan.approve',
      {
        workId,
        revision: assessed.baseRevision ?? '',
        planVersion: 0,
        plan: draft as unknown as Record<string, never>,
        approval: {
          authorizationRef: assessed.authorizationRef ?? '',
          runId: chiefRun.id,
          productChanged: false,
        },
      },
      { caller },
    ) as { status?: string; runId?: string | null };
    expect(approved.status).toBe('applied');
    resolveChiefGate();

    const backendRun = await waitFor(() => {
      execution.supervisor.tick();
      return opened.store.runs
        .list({ where: "work_id = ? AND role = 'backend'", params: [workId] })
        .find((run) => run.status !== 'cancelled');
    }, `the professional Run\n${diagnose()}`);

    // The backend scripted turn after `stage_yield` is held on `backendGate`, so the
    // Attempt — and therefore its read ledger — is still live here: the binding below is
    // read from the real registry, not from a row that could have been written by a stub.
    const stageRow = await waitFor(
      () => opened.store.stageResults.list({ where: 'run_id = ?', params: [backendRun.id] }).at(-1),
      `the stage result\n${diagnose()}`,
      45_000,
    );
    expect(stageRow.status).toBe('success');
    expect(readFileSync(join(repo, NOTE), 'utf8')).toBe('# notes\n\nupdated by the T3b drill\n');
    expect(stageRow.changedPaths).toContain(NOTE);

    // The ledger binding the Runner reported is the one Core sealed: the read the child
    // made through the Broker, and the stage row carries exactly that binding (AC-085).
    const attemptId = stageRow.attemptId;
    const binding = execution.readLedgers.binding(attemptId);
    expect(binding.seq).toBeGreaterThanOrEqual(1);
    expect(stageRow.readLedgerSeq).toBe(binding.seq);
    expect(stageRow.readLedgerHash).toBe(binding.hash);
    expect(execution.readLedgers.entries(attemptId).map((entry) => entry.path)).toContain(NOTE);

    // Audit: the admitted call and the gated one are both visible.
    const events = opened.store.events.readAfter(0, { limit: 1_000 });
    const invoked = events.filter((event) => event.name === 'tool.invoked');
    expect(invoked.length).toBeGreaterThanOrEqual(2);
    expect(invoked.some((event) => event.data['operation'] === 'read')).toBe(true);
    expect(invoked.some((event) => event.data['operation'] === 'edit')).toBe(true);

    // 5. Ending the Attempt reaps its tool process groups and closes its Grants.
    resolveBackendGate();
    await waitFor(
      () => (execution.broker.processes.activeCount(attemptId) === 0 ? true : undefined),
      'the tool process reaping',
    );
    await waitFor(
      () => (execution.grants.currentRunGrants(backendRun.id).length === 0 ? true : undefined),
      'the Grant revocation',
    );
    expect(execution.grants.currentRunGrants(backendRun.id)).toHaveLength(0);
    expect(
      opened.store.toolOperations.list({ where: 'run_id = ?', params: [backendRun.id] }).length,
    ).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
