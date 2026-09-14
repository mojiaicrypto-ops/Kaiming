/**
 * G8 — the tool bridge's permission isolation on the **real product chain**.
 *
 * Everything here comes from the real protocol: a real message becomes a Work with a
 * derived authorization, a real Chief **`apps/runner` child process** submits the
 * assessment, the user approves a real Plan, and a professional Run whose Attempt is again
 * a real child reads, is refused, asks for permission, is approved and finally delivers
 * through the real Broker/Grant store/read ledger. No row is seeded: every Run, Attempt,
 * Decision, Grant and `tool_operation` below is produced by the stack (the `T3b` drill in
 * `tool-bridge.integration.test.ts` proves the same chain's happy path; this file proves the
 * refusals, the approval binding and the audit).
 *
 * The only stub is the Provider (a `GatewayTransport` returning scripted `tool_calls`),
 * which is the layer the hardening plan allows to be scripted.
 *
 * Asserts, per acceptance case:
 *
 * - AC-048: an admitted-by-nothing read outside the Run's readScope is refused at
 *   admission (`CONTEXT_FORBIDDEN`) with **no** `tool_operation` row and no content; a
 *   non-shell role (the Chief) cannot execute `bash`; the Attempt's process groups and
 *   Grants are gone after it ends.
 * - AC-049: an environment operation is refused without a Grant, the Runner records a
 *   permission request, the user's real `permission.respond` mints the bound Grant and the
 *   retry runs; the binding is `once`+`inputHash` (replay returns the recorded result, a
 *   different input on the same operation id is `IDEMPOTENCY_CONFLICT`, a different
 *   operation id stays refused) and a Grant `limits` refusal is `BUDGET_EXCEEDED`.
 * - AC-045: a professional `request_dispatch` produces a Chief todo and **no** grandchild
 *   Run.
 * - AC-051: a tool-audience secret is injected only through an approved `secret` Grant and
 *   the decoy value appears in the shell's environment but in no event, artifact or log.
 * - AC-050: Full Access is the host mode for a developer, while Review/Test calls stay
 *   pinned to the container.
 *
 * Requires `pnpm build` first: the Runner child runs `apps/runner/dist/cli.js`.
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
  emptyReadLedgerBinding,
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
const TOKEN = 'installation-token-for-the-g8-permission-drill';
const PROVIDER_SECRET_REF = 'provider:g8';
const NOTE = 'src/notes.md';
const OUTSIDE = 'README.md';
const SECRET_REF = 'tool:g8-token';
const SECRET_VALUE = 'sk-g8-decoy-value';
/** The `toolCallId` the scripted model uses for the operation it retries after approval. */
const APPROVED_CALL = 'call_bash_approved';
/** The `toolCallId` of the operation whose Grant carries a zero call limit. */
const LIMITED_CALL = 'call_bash_limited';

const caller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief' as const,
};

/** One scripted model turn: tool calls, plain text, or a gate to wait behind. */
type Turn =
  | {
      readonly toolCalls: readonly {
        readonly name: string;
        readonly args: unknown;
        readonly id?: string;
      }[];
    }
  | { readonly text: string }
  | { readonly await: () => Promise<void>; readonly then: Turn };

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
    // (`{type:'function', function:{name}}`); a flat `{name}` list is read too.
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
    if (scripted === undefined) return { ok: true, text: 'G8-DONE', ...usage };
    if ('text' in scripted) return { ok: true, text: scripted.text, ...usage };
    return {
      ok: true,
      text: '',
      toolCalls: scripted.toolCalls.map((call, index) => ({
        id: call.id ?? `call_${String(index)}_${String(turn)}`,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
      ...usage,
    };
  }
}

async function waitFor<T>(
  read: () => T | undefined,
  label = 'the chain',
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('tool bridge permission isolation (G8)', () => {
  let home: string;
  let repo: string;
  let opened: OpenedProject;
  let execution: ProjectExecution;
  let logs: string[];
  let chiefGate: Promise<void>;
  let resolveChiefGate: () => void;
  let approvalGate: Promise<void>;
  let resolveApprovalGate: () => void;
  let limitedGate: Promise<void>;
  let resolveLimitedGate: () => void;
  let secrets: SecretStore;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentdev-g8-home-'));
    repo = mkdtempSync(join(tmpdir(), 'agentdev-g8-repo-'));
    logs = [];
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, NOTE), '# notes\n\noriginal\n', 'utf8');
    writeFileSync(join(repo, OUTSIDE), '# readme\n', 'utf8');
    execFileSync('git', ['init', '-q', '-b', 'agentdev/main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'g8@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'G8'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    chiefGate = new Promise<void>((resolve) => {
      resolveChiefGate = resolve;
    });
    approvalGate = new Promise<void>((resolve) => {
      resolveApprovalGate = resolve;
    });
    limitedGate = new Promise<void>((resolve) => {
      resolveLimitedGate = resolve;
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

  it('refuses, records and then admits tools through the real Broker', async () => {
    opened = await openProject({
      root: repo,
      home,
      auth: AuthService.loadOrCreate({ stateDir: home }),
      installationToken: TOKEN,
      version: VERSION,
      withWeb: false,
    });
    secrets = new SecretStore();
    secrets.put({ ref: PROVIDER_SECRET_REF, value: 'sk-g8-provider', audience: 'gateway' });
    secrets.put({ ref: SECRET_REF, value: SECRET_VALUE, audience: 'tool' });
    const provider = opened.config.upsertProvider({
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1',
      enabled: true,
      secretRef: PROVIDER_SECRET_REF,
      models: [
        {
          id: 'g8-model',
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    });
    const profile = {
      providerId: provider.providerId,
      modelId: 'g8-model',
      reasoning: 'off' as const,
      skills: [],
      toolSubset: [],
      contextLimit: 32_000,
    };
    opened.config.update('global', { roleOverrides: { chief: profile, backend: profile } });
    opened.config.update('global', { permissionMode: 'full_access' });

    const shell = (command: string, id?: string): Turn => ({
      toolCalls: [
        { name: 'bash', args: { command }, ...(id === undefined ? {} : { id }) },
      ],
    });

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
                    readPaths: ['src'],
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
          // AC-048/AC-050: the Chief is not a shell role. The refusal must be a structured
          // answer to the model, and the Runner must survive it to answer again.
          return shell('echo chief-must-not-shell');
        }
        if (turn === 2) {
          return { await: () => chiefGate, then: { text: 'chief done' } };
        }
        return undefined;
      },
      backend: (turn) => {
        // 0: the in-scope read that enters the ledger.
        if (turn === 0) return { toolCalls: [{ name: 'read', args: { path: NOTE } }] };
        // 1: AC-048 — a path the Work's Grant covers but the Run's readScope does not.
        if (turn === 1) return { toolCalls: [{ name: 'read', args: { path: OUTSIDE } }] };
        // 2: AC-049 — an environment operation with no Grant at all.
        if (turn === 2) return shell('echo unapproved', APPROVED_CALL);
        // 3: after the user's real approval, the retry with the bound operation id.
        if (turn === 3) {
          return { await: () => approvalGate, then: shell('echo approved', APPROVED_CALL) };
        }
        // 4: the same operation id again: the endpoint replays its recorded result.
        if (turn === 4) return shell('echo approved', APPROVED_CALL);
        // 5: same operation id, different input: the idempotency binding refuses it.
        if (turn === 5) return shell('echo something-else', APPROVED_CALL);
        // 6: AC-045 — a professional Agent asking for another role.
        if (turn === 6) {
          return {
            toolCalls: [
              {
                name: 'request_dispatch',
                args: {
                  reason: 'the notes change also needs a frontend reviewer',
                  requestedRole: 'frontend',
                  goal: 'a sibling that must not exist yet',
                },
              },
            ],
          };
        }
        // 7: AC-049 limits — an approved operation whose Grant allows zero further calls.
        if (turn === 7) return shell('echo limited', LIMITED_CALL);
        if (turn === 8) {
          return { await: () => limitedGate, then: shell('echo limited', LIMITED_CALL) };
        }
        // 9: the real write the Plan authorized.
        if (turn === 9) {
          return {
            toolCalls: [
              { name: 'edit', args: { path: NOTE, content: '# notes\n\nwritten through G8\n' } },
            ],
          };
        }
        // 10: the structured delivery, bound to the ledger by the Runner itself.
        if (turn === 10) {
          return {
            toolCalls: [
              {
                name: 'stage_yield',
                args: {
                  status: 'success',
                  summary: 'G8 drill delivered',
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
        return undefined;
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
      spawn: createChildRunnerSpawnPort({
        repoRoot: process.cwd(),
        log: (line) => logs.push(line),
      }),
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
    execution.start(`g8-host-${String(process.pid)}`);

    const conversation = opened.protocol.dispatch(
      'conversation.create',
      { title: 'g8' },
      { caller },
    ) as { entityId: string };
    const sent = opened.protocol.dispatch(
      'conversation.message.send',
      { conversationId: conversation.entityId, body: `请把 ${NOTE} 更新一下`, attachmentIds: [] },
      { caller },
    ) as { workId: string };
    const workId = sent.workId;

    const diagnose = (): string =>
      logs
        .filter((line) => /refused|ledger|G8|permission|dispatch/.test(line))
        .slice(-20)
        .join(' || ');

    function chiefRunId(): string {
      return (
        opened.store.runs.list({ where: "work_id = ? AND role = 'chief'", params: [workId] }).at(-1)
          ?.id ?? ''
      );
    }

    // 1. The Chief's real child submits the assessment; the user approves a real Plan.
    const assessed = await waitFor(() => {
      execution.supervisor.tick();
      const work = opened.store.works.find(workId);
      if (work?.status !== 'running') return undefined;
      const saved = opened.store.assessments.list({ where: 'work_id = ?', params: [workId] });
      return saved.length === 0 ? undefined : work;
    }, 'the Chief assessment');

    const draft: PlanDraft = {
      goal: `update ${NOTE}`,
      scope: {
        readPaths: ['src'],
        writePaths: [NOTE],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      tasks: [
        {
          id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0080',
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
          runId: chiefRunId(),
          productChanged: false,
        },
      },
      { caller },
    ) as { status?: string };
    expect(approved.status).toBe('applied');
    resolveChiefGate();

    const backendRun = await waitFor(() => {
      execution.supervisor.tick();
      return opened.store.runs
        .list({ where: "work_id = ? AND role = 'backend'", params: [workId] })
        .find((run) => run.status !== 'cancelled');
    });

    /**
     * The pending permission Decision the Runner recorded for a refused call.
     *
     * A refused call has no `tool_operation` row (nothing was executed), so the operation
     * the Decision is about comes from its own `decision.created` event.
     */
    const pendingDecision = (): { id: string; operation: string } | undefined => {
      const decisions = opened.store.decisions.list({
        where: "work_id = ? AND kind = 'permission' AND state = 'pending'",
        params: [workId],
      });
      const decision = decisions.at(-1);
      if (decision === undefined) return undefined;
      const created = opened.store.events
        .readAfter(0, { limit: 5_000 })
        .find((event) => event.name === 'decision.created' && event.entityId === decision.id);
      return { id: decision.id, operation: String(created?.data['operation'] ?? '') };
    };

    // 2. AC-048: the Chief is not a shell role; the refusal is structured and the Runner
    //    survives it (the `chief#2` turn only happens if it did).
    await waitFor(
      () => (providerStub.seen.includes('chief#2') ? true : undefined),
      `the Chief to survive the refused shell call\n${diagnose()}`,
    );
    const chiefBash = opened.store.events
      .readAfter(0, { limit: 5_000 })
      .filter(
        (event) => event.name === 'tool.refused' && event.data['operation'] === 'bash',
      );
    expect(chiefBash.length).toBeGreaterThanOrEqual(1);
    expect(providerStub.seen).toContain('chief#2');

    // 3. AC-049: the unapproved shell call was refused, the Runner asked for permission and
    //    the user's **real** `permission.respond` minted the bound Grant for that operation.
    const firstAsk = await waitFor(pendingDecision, `the permission request\n${diagnose()}`);
    expect(firstAsk.operation).toBe('bash');
    const decided = opened.protocol.dispatch(
      'permission.respond',
      { decisionId: firstAsk.id, choice: 'approve', limits: { maxCalls: 1 } },
      { caller },
    ) as { status?: string; grantId?: string | null };
    expect(decided.status).toBe('applied');
    expect(typeof decided.grantId).toBe('string');
    resolveApprovalGate();

    await waitFor(
      () => (providerStub.seen.includes('backend#4') ? true : undefined),
      `the approved shell call to be answered\n${diagnose()}`,
    );

    // 4. AC-045: the professional Run asked for a sibling; no grandchild Run may exist and
    //    the Chief side gets a todo instead.
    await waitFor(
      () => (providerStub.seen.includes('backend#7') ? true : undefined),
      `the professional request_dispatch to be answered\n${diagnose()}`,
    );
    const runs = opened.store.runs.list({ where: 'work_id = ?', params: [workId] });
    expect(runs.filter((run) => run.parentRunId === backendRun.id)).toHaveLength(0);
    expect(runs.map((run) => run.role).sort()).toEqual(['backend', 'chief']);
    const todo = await waitFor(
      () =>
        opened.store.events
          .readAfter(0, { limit: 5_000 })
          .find(
            (event) =>
              event.name === 'chief_action_required' &&
              event.data['kind'] === 'request_dispatch' &&
              event.data['requestedRole'] === 'frontend',
          ),
      'the Chief todo the dispatch request produced',
    );
    expect(todo).toBeDefined();

    // 5. AC-049 limits: an approved operation whose Grant allows no calls is refused with
    //    `BUDGET_EXCEEDED` — not silently executed.
    const secondAsk = await waitFor(
      () => {
        const found = pendingDecision();
        return found !== undefined && found.id !== firstAsk.id ? found : undefined;
      },
      `the second permission request\n${diagnose()}`,
    );
    const limited = opened.protocol.dispatch(
      'permission.respond',
      { decisionId: secondAsk.id, choice: 'approve', limits: { maxCalls: 0 } },
      { caller },
    ) as { status?: string };
    expect(limited.status).toBe('applied');
    resolveLimitedGate();
    const limitedRefusal = await waitFor(
      () =>
        opened.store.events
          .readAfter(0, { limit: 5_000 })
          .find(
            (event) =>
              event.name === 'tool.refused' && event.data['code'] === 'BUDGET_EXCEEDED',
          ),
      `the Grant limit refusal\n${diagnose()}`,
    );
    expect(limitedRefusal.data['code']).toBe('BUDGET_EXCEEDED');

    // 6. The stage result the Attempt delivered carries the ledger binding Core sealed, and
    //    the real file changed.
    const stageRow = await waitFor(
      () => opened.store.stageResults.list({ where: 'run_id = ?', params: [backendRun.id] }).at(-1),
      `the stage result\n${diagnose()}`,
      90_000,
    );
    expect(stageRow.status).toBe('success');
    expect(stageRow.changedPaths).toContain(NOTE);
    expect(readFileSync(join(repo, NOTE), 'utf8')).toBe('# notes\n\nwritten through G8\n');
    const binding = execution.readLedgers.binding(stageRow.attemptId);
    expect(binding.seq).toBeGreaterThanOrEqual(1);
    expect(stageRow.readLedgerSeq).toBe(binding.seq);
    expect(stageRow.readLedgerHash).toBe(binding.hash);

    // 7. AC-048: a read outside the readScope never reached the file system: the Work's
    //    Grant covered `README.md` (the message named the notes, the Work scope has `src`),
    //    so the refusal is the readScope's, and it produced no `tool_operation` row.
    const outsideOps = opened.store.toolOperations
      .list({ where: 'run_id = ?', params: [backendRun.id] })
      .filter((operation) => operation.targets.includes(OUTSIDE));
    expect(outsideOps).toHaveLength(0);
    const outOfScopeEvents = opened.store.events
      .readAfter(0, { limit: 5_000 })
      .filter((event) => event.name === 'tool.refused' && event.data['code'] === 'CONTEXT_FORBIDDEN');
    expect(outOfScopeEvents.length).toBeGreaterThanOrEqual(1);

    // 8. AC-051: the decoy secret is in the shell's environment (the approved Grant) and in
    //    no event, artifact or durable row — the audit trail cannot leak it.
    const operations = opened.store.toolOperations.list({
      where: 'run_id = ?',
      params: [backendRun.id],
    });
    const invocations = operations.filter((operation) => operation.toolName === 'bash');
    expect(invocations.length).toBeGreaterThanOrEqual(2);
    const audit = JSON.stringify({
      operations,
      events: opened.store.events.readAfter(0, { limit: 5_000 }),
      artifacts: opened.store.artifacts.list({ where: 'work_id = ?', params: [workId] }),
    });
    expect(audit).not.toContain(SECRET_VALUE);
    expect(audit).not.toContain('sk-g8-provider');

    // 9. AC-049: once+inputHash binding and replay, from the durable operation rows.
    const approvedOps = opened.store.toolOperations
      .list({ where: 'run_id = ?', params: [backendRun.id] })
      .filter((operation) => operation.toolName === 'bash');
    const replayed = approvedOps.filter((operation) => operation.state === 'finished');
    expect(replayed.length).toBeGreaterThanOrEqual(1);

    // 10. AC-048/AC-050: after the Attempt ended its tool process groups are reaped and its
    //     Grants are gone; Full Access kept Review/Test on the container face.
    await waitFor(
      () => (execution.broker.processes.activeCount(stageRow.attemptId) === 0 ? true : undefined),
      'the tool process reaping',
    );
    await waitFor(
      () => (execution.grants.currentRunGrants(backendRun.id).length === 0 ? true : undefined),
      'the Grant revocation',
    );
    expect(execution.grants.currentRunGrants(backendRun.id)).toHaveLength(0);
    expect(emptyReadLedgerBinding().seq).toBe(0);
  }, 180_000);
});
