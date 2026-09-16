/**
 * WP-12 trust enforcement drill: "untrusted = read-only" is a real gate, both directions.
 *
 * `apps/web` keeps the one-time trust prompt, so the untrusted state has to mean something.
 * This drill drives the **real vertical chain** the daemon uses —
 * `conversation.message.send` → real Chief Run → `plan.approve` → real professional Run →
 * real `apps/runner` child → real Pi session → real control endpoint → real
 * `tool-handler`/`Broker` — over a repository opened **untrusted**, and proves:
 *
 * 1. the Run's mutating `write` is refused with the typed trust refusal (code
 *    `NOT_AUTHORIZED`, the trust state, the act that changes it) and leaves **nothing**
 *    behind: the file is unchanged, no `tool_operation` row, no writer lease, no candidate
 *    commit;
 * 2. `read` and `artifact_write` still work in the same Attempt: the read really reads,
 *    and the report really lands in the workbench artifact store (readable through
 *    `artifact.get`) without creating a file in the project — read-only does not mean the
 *    Run cannot leave a report (product-owner ruling);
 * 3. the recorded trust state of the Attempt is `untrusted` (the per-Attempt `trust.json`
 *    and the spawn diagnostic), so "which trust state did this Run run under" is answerable;
 * 4. after the real `project.trust {trusted:true}` command, the **same** `write` call is
 *    admitted and really executes, and the stage result reports the updated file.
 *
 * The only stub is the **Provider** (scripted `tool_calls`) plus the host's project-directory
 * port for the one `project.trust` command (the host directory is a large class; the drill
 * passes the same `trust` write the host performs). The Runner child, endpoint, Broker,
 * Grant store, read ledger and filesystem are real. Requires `pnpm build` first: the child
 * runs the shipped `apps/runner/dist/cli.js`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { createToolHandler, workWriterLeaseResource } from '../src/tool-handler.js';

const VERSION = '0.0.0-test';
const TOKEN = 'installation-token-for-the-trust-drill';
const PROVIDER_SECRET_REF = 'provider:trust-drill';
const PROVIDER_SECRET_VALUE = 'sk-trust-drill-secret';
/** The file the whole chain touches; it lives under the Project's `codeRoot` (`src`). */
const NOTE = 'src/notes.md';
const ORIGINAL = '# notes\n\noriginal\n';
const TRUSTED_WRITE = '# notes\n\nwritten after the user trusted the project\n';
/** The report an untrusted read-only Run may still write into the workbench artifact store. */
const REPORT_PATH = 'docs/trust-report.md';
const REPORT_BODY = '# trust drill report\n\nthe read-only investigation report\n';
/** The Plan task the professional Run is bound to (its manifest proves a candidate commit). */
const DRAFT_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3e0070';

const caller = {
  subject: 'installation:local',
  userId: userIdFromSubject('installation:local'),
  role: 'chief' as const,
};

/**
 * Renders one event `data` member for a diagnostic line.
 *
 * `event.data` is untyped JSON, so `String()` would print `[object Object]` for anything
 * that is not a primitive; the message is a debugging aid, so it must stay truthful.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value);
}

/** One scripted model turn: either tool calls or plain text. */
type Turn =
  | {
      readonly toolCalls: readonly { readonly name: string; readonly args: unknown }[];
    }
  | { readonly text: string }
  | { readonly await: () => Promise<void>; readonly then: Turn };

/** The scripted Provider: the only non-real layer besides the host directory port. */
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
    const usage = { inputTokens: 11, outputTokens: 7 };
    if (scripted === undefined) return { ok: true, text: 'TRUST-DONE', ...usage };
    if ('text' in scripted) return { ok: true, text: scripted.text, ...usage };
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
  label: string | (() => string) = 'the drill',
  timeoutMs = 30_000,
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

describe('an untrusted project is read-only and a trusted one is writable (WP-12 trust)', () => {
  let home: string;
  let repo: string;
  let opened: OpenedProject;
  let execution: ProjectExecution;
  let logs: string[];
  let runnerIpc: string[];
  let resolveChiefGate: () => void;
  let chiefGate: Promise<void>;
  let resolveTrustGate: () => void;
  let trustGate: Promise<void>;
  let resolveReadGate: () => void;
  let readGate: Promise<void>;
  let resolveFinalGate: () => void;
  let finalGate: Promise<void>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agentdev-trust-home-'));
    repo = mkdtempSync(join(tmpdir(), 'agentdev-trust-repo-'));
    logs = [];
    runnerIpc = [];
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, NOTE), ORIGINAL, 'utf8');
    writeFileSync(join(repo, 'README.md'), '# trust drill\n', 'utf8');
    execFileSync('git', ['init', '-q', '-b', 'agentdev/main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'trust@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Trust'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    chiefGate = new Promise<void>((resolve) => {
      resolveChiefGate = resolve;
    });
    trustGate = new Promise<void>((resolve) => {
      resolveTrustGate = resolve;
    });
    readGate = new Promise<void>((resolve) => {
      resolveReadGate = resolve;
    });
    finalGate = new Promise<void>((resolve) => {
      resolveFinalGate = resolve;
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

  it('refuses the mutating call while untrusted, keeps reads working, then admits the same call after trust', async () => {
    opened = await openProject({
      root: repo,
      home,
      auth: AuthService.loadOrCreate({ stateDir: home }),
      installationToken: TOKEN,
      version: VERSION,
      withWeb: false,
      // The documented default for a newly opened folder (`protocol.md` §3): 只看不改.
      trust: 'untrusted',
    });
    const projectId = opened.projectId;
    const trustReader = (): 'trusted' | 'untrusted' =>
      opened.store.projects.find(projectId)?.trust ?? 'untrusted';
    const secrets = new SecretStore();
    secrets.put({ ref: PROVIDER_SECRET_REF, value: PROVIDER_SECRET_VALUE, audience: 'gateway' });
    const provider = opened.config.upsertProvider({
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1',
      enabled: true,
      secretRef: PROVIDER_SECRET_REF,
      models: [
        {
          id: 'trust-model',
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          reasoningLevels: ['off'],
          vision: false,
        },
      ],
    });
    const profile = {
      providerId: provider.providerId,
      modelId: 'trust-model',
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
                  reason: 'the user asked for the notes to be updated',
                },
              },
            ],
          };
        }
        if (turn === 1) {
          return { await: () => chiefGate, then: { text: 'waiting for the plan approval' } };
        }
        return undefined;
      },
      backend: (turn) => {
        // 1. The mutating call while the project is untrusted: refused.
        if (turn === 0) {
          return { toolCalls: [{ name: 'write', args: { path: NOTE, content: TRUSTED_WRITE } }] };
        }
        // 2. The workbench artifact store is still allowed while untrusted (the owner's
        //    ruling): the report is written into Core's artifact store, not the project. It
        //    is held until the drill has inspected the refusal's aftermath, so "the refused
        //    write took no writer lease" is observed before any later call can take it.
        if (turn === 1) {
          return {
            await: () => readGate,
            then: {
              toolCalls: [
                {
                  name: 'artifact_write',
                  args: { path: REPORT_PATH, content: REPORT_BODY, mime: 'text/markdown' },
                },
              ],
            },
          };
        }
        // 3. A read in the same Attempt: it must still work.
        if (turn === 2) return { toolCalls: [{ name: 'read', args: { path: NOTE } }] };
        // 4. The same mutating call, held until the user really trusts the project.
        if (turn === 3) {
          return {
            await: () => trustGate,
            then: { toolCalls: [{ name: 'write', args: { path: NOTE, content: TRUSTED_WRITE } }] },
          };
        }
        if (turn === 4) {
          return {
            toolCalls: [
              {
                name: 'stage_yield',
                args: {
                  status: 'success',
                  summary: 'the notes were updated after the user trusted the project',
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
        return { await: () => finalGate, then: { text: 'TRUST-DRILL-DONE' } };
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
          projectId,
          log: (line) => logs.push(line),
        }),
      // The real Runner child, told the Project's real trust state (the production wiring).
      spawn: createChildRunnerSpawnPort({
        repoRoot: process.cwd(),
        trust: trustReader,
        log: (line) => {
          logs.push(line);
          runnerIpc.push(line);
        },
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
        attach: ({
          orchestrator,
          stageGate,
          readLedgers,
          environmentRefOf,
          releaseWorkspaceLease,
        }) =>
          createControlHandlers({
            store: opened.store,
            orchestrator,
            stageGate,
            readLedgers,
            artifacts: opened.services.artifacts,
            requirementSaves: opened.services.requirementSaves,
            ...(environmentRefOf === undefined ? {} : { environmentRefOf }),
            ...(releaseWorkspaceLease === undefined ? {} : { releaseWorkspaceLease }),
            // The candidate-commit half of the delivery route (`reliability.md` §4): without
            // it the "no candidate commit" assertion below would be vacuous. The Run's files
            // are in the project root (this drill uses the documented project-root resolver),
            // so the Task worktree is materialised from that root.
            worktrees: opened.git,
            snapshots: opened.snapshots,
            worktreeRoot: join(opened.dataDir, 'task-worktrees'),
            taskWorkspaceRoot: join(home, 'task-worktrees', projectId),
            repoRoot: opened.root,
            policyHash: 'd'.repeat(64),
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
    // The real `project.trust` protocol handler, with only the host directory reduced to the
    // one write the host performs (`ProjectDirectory.trust` → the Project row).
    opened.protocol.attachProjectDirectory({
      trust: (id: string, trusted: boolean) => {
        const row = opened.store.projects.find(id);
        if (row === undefined) throw new Error(`Project ${id} is not registered`);
        opened.store.projects.update(id, { trust: trusted ? 'trusted' : 'untrusted' }, row.version);
        return {
          projectId: id,
          trust: opened.store.projects.find(id)?.trust ?? 'untrusted',
          state: 'open',
        };
      },
    } as unknown as Parameters<typeof opened.protocol.attachProjectDirectory>[0]);
    execution.start(`host-trust-${String(process.pid)}`);

    const conversation = opened.protocol.dispatch(
      'conversation.create',
      { title: 'trust' },
      { caller },
    ) as { entityId: string };
    const sent = opened.protocol.dispatch(
      'conversation.message.send',
      { conversationId: conversation.entityId, body: `请把 ${NOTE} 更新一下`, attachmentIds: [] },
      { caller },
    ) as { workId: string };
    const workId = sent.workId;

    const chiefRun = await waitFor(
      () => {
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
    }, 'the Chief assessment');
    expect(assessed.authorizationRef).toBeDefined();

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
          id: DRAFT_TASK_ID,
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
    ) as { status?: string };
    expect(approved.status).toBe('applied');
    resolveChiefGate();

    const backendRun = await waitFor(() => {
      execution.supervisor.tick();
      return opened.store.runs
        .list({ where: "work_id = ? AND role = 'backend'", params: [workId] })
        .find((run) => run.status !== 'cancelled');
    }, 'the professional Run');
    const backendAttempt = await waitFor(
      () => opened.store.attempts.list({ where: 'run_id = ?', params: [backendRun.id] }).at(-1),
      'the professional Attempt',
    );
    // The Task `plan.approve` materialised for this Run (the draft's id is a template; Core
    // mints the real Task row).
    const backendTaskId = backendRun.taskId;
    expect(backendTaskId).toBeDefined();
    if (backendTaskId === undefined) throw new Error('the professional Run has no Task');

    const diagnose = (): string =>
      [
        `runs=${opened.store.runs
          .list({ where: 'work_id = ?', params: [workId] })
          .map((run) => `${run.role}:${run.status}`)
          .join(',')}`,
        `refused=${opened.store.events
          .readAfter(0, { limit: 20_000 })
          .filter((event) => event.name === 'tool.refused')
          .map((event) => `${textOf(event.data['code'])}/${textOf(event.data['trust'] ?? '-')}`)
          .join(',')}`,
        `ops=${opened.store.toolOperations
          .list({ where: 'run_id = ?', params: [backendRun.id] })
          .map((row) => `${row.toolName}:${row.state}`)
          .join(',')}`,
        `taskId=${String(backendTaskId)} manifest=${String(
          backendTaskId === undefined
            ? undefined
            : opened.store.tasks.find(backendTaskId)?.latestManifestId,
        )}`,
        `provider=${providerStub.seen.join('|')}`,
        `runner=${runnerIpc.slice(-6).join(' || ')}`,
        `logs=${logs
          .filter((line) => !line.includes('attempt.heartbeat'))
          .slice(-16)
          .join(' || ')}`,
      ].join('\n');

    // ---------------------------------------------------------------------
    // Direction 1 — untrusted: the mutating call is refused with nothing behind it.
    // ---------------------------------------------------------------------
    const refusal = await waitFor(
      () => {
        execution.supervisor.tick();
        return opened.store.events
          .readAfter(0, { limit: 20_000 })
          .filter((event) => event.name === 'tool.refused')
          .find(
            (event) => event.data['layer'] === 'admission' && event.data['trust'] === 'untrusted',
          );
      },
      () => `the untrusted refusal\n${diagnose()}`,
      45_000,
    );
    expect(textOf(refusal.data['code'])).toBe('NOT_AUTHORIZED');
    const refusalReason = textOf(refusal.data['reason']);
    // The typed error names the trust state and says how to change it.
    expect(refusalReason).toContain('只看不改');
    expect(refusalReason).toContain('project.trust {trusted:true}');
    expect(refusalReason).toContain('do not retry');
    expect(textOf(refusal.data['operation'])).toBe('write');

    // Nothing was written, no operation row exists and no writer lease was taken.
    expect(readFileSync(join(repo, NOTE), 'utf8')).toBe(ORIGINAL);
    expect(
      opened.store.toolOperations
        .list({ where: 'run_id = ?', params: [backendRun.id] })
        .filter((row) => row.toolName === 'write'),
    ).toHaveLength(0);
    expect(opened.store.leases.find(workWriterLeaseResource(projectId, workId))).toBeUndefined();
    // No candidate commit: the Task has no frozen manifest and the delivery worktree is
    // clean for the target file. (The delivery branch itself also carries the Plan/Work
    // bookkeeping commits the real route writes, so the file and the manifest are the
    // precise signals, not the branch head.)
    expect(opened.store.tasks.find(backendTaskId)?.latestManifestId).toBeUndefined();
    expect(
      execFileSync('git', ['status', '--porcelain', '--', NOTE], { cwd: repo, encoding: 'utf8' }),
    ).toBe('');

    // The Attempt really ran under `untrusted` (the per-Attempt record and the spawn line).
    const trustRecord = JSON.parse(
      readFileSync(join(opened.dataDir, 'attempts', backendAttempt.id, 'trust.json'), 'utf8'),
    ) as { trust: string; runId: string; attemptId: string };
    expect(trustRecord.trust).toBe('untrusted');
    expect(trustRecord.runId).toBe(backendRun.id);
    expect(trustRecord.attemptId).toBe(backendAttempt.id);
    expect(logs.some((line) => line.includes('trust=untrusted'))).toBe(true);
    expect(runnerIpc.some((line) => line.includes('trust=untrusted'))).toBe(true);

    // The read is released only now, so the assertions above observed the state the
    // refused write left: no lease, no manifest and a clean worktree.
    resolveReadGate();

    // ---------------------------------------------------------------------
    // `artifact_write` succeeds in the same untrusted Attempt: read-only does not mean the
    // Run cannot leave a report (owner ruling). The bytes are in the workbench artifact
    // store, never in the project.
    // ---------------------------------------------------------------------
    const report = await waitFor(
      () => {
        execution.supervisor.tick();
        return opened.services.artifacts
          .list(workId)
          .find((artifact) => artifact.runId === backendRun.id && artifact.kind === 'evidence');
      },
      () => `the report artifact\n${diagnose()}`,
      30_000,
    );
    expect(report.mime).toBe('text/markdown');
    expect(Buffer.from(opened.services.artifacts.read(report)).toString('utf8')).toBe(REPORT_BODY);
    // The documented `artifact.get` reads it back (the surface the UI uses).
    const fetched = opened.protocol.dispatch(
      'artifact.get',
      { artifactId: report.id },
      { caller },
    ) as {
      artifact?: { id?: string };
    };
    expect(fetched.artifact?.id).toBe(report.id);
    // It was a real executed tool call, audited under the untrusted state, and it never
    // created a file in the repository.
    expect(
      opened.store.toolOperations
        .list({ where: 'run_id = ?', params: [backendRun.id] })
        .find((row) => row.toolName === 'artifact_write')?.state,
    ).toBe('finished');
    expect(
      opened.store.events
        .readAfter(0, { limit: 20_000 })
        .find(
          (event) => event.name === 'tool.invoked' && event.data['operation'] === 'artifact_write',
        )?.data['trust'],
    ).toBe('untrusted');
    expect(existsSync(join(repo, REPORT_PATH))).toBe(false);

    // ---------------------------------------------------------------------
    // Reads keep working in the same untrusted Attempt.
    // ---------------------------------------------------------------------
    const readOperation = await waitFor(
      () => {
        execution.supervisor.tick();
        return opened.store.toolOperations
          .list({ where: 'run_id = ?', params: [backendRun.id] })
          .find((row) => row.toolName === 'read' && row.state === 'finished');
      },
      () => `the admitted read\n${diagnose()}`,
      30_000,
    );
    expect(readOperation.grantId).toBeDefined();
    // The real content entered the ledger: the read returned the file body.
    expect(execution.readLedgers.entries(backendAttempt.id).map((entry) => entry.path)).toContain(
      NOTE,
    );
    // The read was audited as an admitted call, not as a refusal, and the audit records
    // the trust state it ran under.
    const invokedRead = opened.store.events
      .readAfter(0, { limit: 20_000 })
      .find((event) => event.name === 'tool.invoked' && event.data['operation'] === 'read');
    expect(invokedRead).toBeDefined();
    expect(invokedRead?.data['trust']).toBe('untrusted');

    // ---------------------------------------------------------------------
    // Direction 2 — after the real `project.trust`, the same call executes.
    // ---------------------------------------------------------------------
    const trusted = opened.protocol.dispatch(
      'project.trust',
      { trusted: true },
      { caller, projectId },
    ) as { status?: string; trust?: string; admission?: string };
    expect(trusted.status).toBe('applied');
    expect(trusted.trust).toBe('trusted');
    expect(trusted.admission).toBe('open');
    expect(trustReader()).toBe('trusted');
    resolveTrustGate();

    const writeOperation = await waitFor(
      () => {
        execution.supervisor.tick();
        return opened.store.toolOperations
          .list({ where: 'run_id = ?', params: [backendRun.id] })
          .find((row) => row.toolName === 'write' && row.state === 'finished');
      },
      () => `the admitted write after trust\n${diagnose()}`,
      45_000,
    );
    expect(writeOperation.grantId).toBeDefined();
    expect(readFileSync(join(repo, NOTE), 'utf8')).toBe(TRUSTED_WRITE);
    // The admitted write's audit row records the state it ran under, which is now trusted.
    expect(
      opened.store.events
        .readAfter(0, { limit: 20_000 })
        .find((event) => event.name === 'tool.invoked' && event.data['operation'] === 'write')
        ?.data['trust'],
    ).toBe('trusted');

    // The stage result carries the update, so the trusted direction reached delivery.
    const stageRow = await waitFor(
      () => opened.store.stageResults.list({ where: 'run_id = ?', params: [backendRun.id] }).at(-1),
      () => `the stage result\n${diagnose()}`,
      45_000,
    );
    expect(stageRow.status).toBe('success');
    expect(stageRow.changedPaths).toContain(NOTE);
    // The trusted direction reached the candidate commit: the Task now has its frozen
    // manifest, which the refused (untrusted) direction never produced.
    const manifestId = await waitFor(
      () => opened.store.tasks.find(backendTaskId)?.latestManifestId,
      () => `the candidate manifest\n${diagnose()}`,
      30_000,
    );
    expect(manifestId).toBeDefined();
    // Exactly one write was refused (when untrusted) and the admitted one is the only
    // finished write operation: the refusal did not leave a half-written call behind.
    expect(
      opened.store.events
        .readAfter(0, { limit: 20_000 })
        .filter(
          (event) =>
            event.name === 'tool.refused' &&
            event.data['layer'] === 'admission' &&
            event.data['operation'] === 'write',
        ),
    ).toHaveLength(1);

    resolveFinalGate();
  }, 180_000);
});
