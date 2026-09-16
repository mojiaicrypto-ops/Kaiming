/**
 * One project's execution stack (WP-11 A2-T6 wiring).
 *
 * `ARCHITECTURE.md` §1 puts the supervisor and the model gateway inside `agentdevd`; this
 * module assembles them for one project so `agentdev start` really executes Runs:
 *
 * ```
 * RunnerSupervisor → apps/runner (child) → Pi session
 *   → gateway endpoint (capability) → ModelGateway (frozen config, real secret)
 *     → OpenAI-compatible transport → the user's Provider
 * ```
 *
 * Two properties the wiring preserves:
 *
 * - **The secret never leaves Core.** The Runner's catalog carries only its Attempt
 *   capability; the Gateway resolves the Provider credential per call through
 *   `SecretStore` under the Run's own grants (no grant ⇒ the call is refused, which is
 *   what `execution.md` §4 requires).
 * - **Usage is booked once.** The endpoint reports what the Provider charged; the ledger
 *   accumulates it and the supervisor settles it with the Run.
 *
 * The spawn port and the invocation builder are injected by `apps/daemon`, so this module
 * stays free of any dependency on an application package.
 */
import { LIMITS, type Grant, type Purpose, type Role } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';

import { Broker, type BrokerOptions } from './broker.js';
import type { ArtifactService } from './artifacts.js';
import { AttemptCapabilityStore } from './capabilities.js';
import type { AttemptResultInput } from './supervisor.js';
import type { ConfigStore } from './config.js';
import {
  createControlEndpoint,
  type ControlEndpoint,
  type ControlHandler,
} from './control-http.js';
import { ProtocolError } from './errors.js';
import { GrantStore } from './grants.js';
import { JoinCoordinator } from './join.js';
import { ToolGrantService, type EnsureRunGrantsResult } from './permissions.js';
import { ReadLedgerRegistry } from './read-ledger.js';
import type { PermissionRequestHandler } from './control-http.js';
import type { ToolExecuteHandler } from './tool-http.js';
import { Orchestrator } from './orchestrator.js';
import { StageGate } from './stage.js';
import type { RunWorkspaceResolver } from './task-workspace.js';
import { createModelGatewayProxy, type ModelGatewayProxy } from './gateway-http.js';
import { ModelGateway, type GatewayTransport } from './model-gateway.js';
import { RunLifecycle } from './run-lifecycle.js';
import { RunRecoveryService, type ProcessProbe } from './recovery.js';
import { readFrozenVerificationManifest } from './settlement.js';
import { gatewaySecretResolver } from './secrets.js';
import type { SecretStore } from './secrets.js';
import type { SnapshotWriter } from './snapshots.js';
import {
  TestEvidenceRegistry,
  boundTestOutput,
  buildBlockedTestCheckResult,
  buildTestCheckResult,
  type DeclaredCommandExecution,
} from './test-environment.js';
import { OpenAiCompatibleTransport } from './transport-http.js';
import {
  RunnerSupervisor,
  createMemoryUsageLedger,
  type PrepareRun,
  type RunnerSpawnPort,
  type RunnerSupervisorOptions,
  type RunUsageLedger,
} from './supervisor.js';

/** The mutable secret-access context one Gateway call runs under. */
class SecretContext {
  /**
   * Mutable on purpose: `ModelGateway` asks its resolver for a credential during
   * `complete()`, so the call site records the Run's facts before the call.
   */
  context: {
    audience: 'gateway';
    purpose: Purpose;
    role: Role;
    workId: string;
    stage: string;
    at: string;
    runId?: string;
    grants: readonly Grant[];
  };

  private readonly store: ProjectStore;

  constructor(store: ProjectStore) {
    this.store = store;
    this.context = {
      audience: 'gateway',
      purpose: 'implementation',
      role: 'chief',
      workId: '',
      stage: 'Develop',
      at: new Date().toISOString(),
      grants: [],
    };
  }

  /**
   * Authorizes one call from the Run's own facts.
   *
   * The grants come from the store, so the Gateway can only read a credential the Run
   * actually holds a grant for; an unauthorized call fails closed.
   */
  authorize(run: {
    readonly id: string;
    readonly workId: string;
    readonly role: Role;
    readonly stage: string;
    readonly purpose: Purpose;
  }): void {
    this.context.role = run.role;
    this.context.purpose = run.purpose;
    this.context.workId = run.workId;
    this.context.stage = run.stage;
    this.context.runId = run.id;
    this.context.at = new Date().toISOString();
    this.context.grants = this.store.grants.list({
      where: 'run_id = ? OR work_id = ?',
      params: [run.id, run.workId],
    });
  }
}

export interface ProjectExecutionOptions {
  readonly store: ProjectStore;
  readonly config: ConfigStore;
  readonly snapshots: SnapshotWriter;
  readonly secrets: SecretStore;
  /**
   * The artifact service a Test Run's executed evidence is stored through (WP-12 W5).
   *
   * Every executed acceptance command's bounded output becomes a real `evidence`
   * artifact, whose id is the `CheckResult` check's `outputRef` (`data.md` §3). A stack
   * without one cannot produce the evidence and the Test stage then records `blocked`
   * rather than a fabricated reference.
   */
  readonly artifacts?: ArtifactService;
  /**
   * The per-Task workspace resolver the declared test commands run against (WP-12 W5).
   *
   * A Test Run executes the project's commands on its own frozen Task worktree, so the
   * evidence binds the tree the Test read; the production daemon and the live drill both
   * pass the same resolver the tool bridge uses. Without it the commands have no root to
   * mount and the Test stage records `blocked`.
   */
  readonly workspace?: RunWorkspaceResolver;
  /**
   * Builds the Runner invocation (the daemon supplies `createPrepareRun`).
   *
   * A factory, because the invocation needs the Attempt capabilities and the gateway URL
   * that this module creates — the context is handed back instead of invented twice. The
   * control URL (`protocol.md` §6) travels with it for the same reason: the Runner's Chief
   * and professional tools must call the endpoint this stack just started.
   */
  readonly prepare: (context: {
    readonly capabilities: AttemptCapabilityStore;
    readonly gatewayUrl: string;
    readonly controlUrl: string;
  }) => PrepareRun;
  /**
   * The `assessment.submit`/`agent.dispatch`/`stage.submit` handlers (`protocol.md` §6).
   *
   * Injected by the daemon. A stack assembled without them still starts the endpoint but
   * refuses every method, which is louder than a silent no-op.
   */
  readonly control?: ProjectExecutionControl;
  /** Starts the Runner process (the daemon supplies the child-process port). */
  readonly spawn: RunnerSpawnPort;
  /**
   * Extra Broker configuration (report/scratch roots, container mode, protected paths).
   *
   * `store` and `grants` belong to this stack and cannot be overridden; everything else
   * the Broker accepts is passed through.
   */
  readonly broker?: Omit<BrokerOptions, 'store' | 'grants'>;
  /**
   * The `tool.execute` bridge (`protocol.md` §6, T3).
   *
   * Core owns the Grant store, the Broker and the permission service, so it hands them to
   * the daemon's factory, which adds the services only the application has: the artifact
   * service, the Plan gate and the per-Task workspace resolver
   * (`apps/daemon/src/tool-handler.ts`). A stack assembled without the factory starts the
   * endpoint but refuses `tool.execute` with `PROVIDER_UNAVAILABLE`, which is louder than
   * a silent no-op.
   */
  readonly tools?: ProjectExecutionTools;
  readonly host?: '127.0.0.1' | '::1' | 'localhost';
  /**
   * Registers the ports this stack binds (WP-12 W6, `w1-implementation.md` §7.2).
   *
   * The control endpoint and the model-gateway proxy take ephemeral ports, so the daemon
   * cannot hard-code them: this stack reports each bound port to the daemon's egress
   * registry, which the network policy reads live as the first fixed denial.
   */
  readonly egressPorts?: EgressPortRegistryPort;
  /** Overridable for tests; defaults to the real OpenAI-compatible transport. */
  readonly transport?: GatewayTransport;
  /** Overridable for tests; defaults to a node process probe. */
  readonly probe?: ProcessProbe;
  readonly tickMs?: number;
  readonly log?: (line: string) => void;
}

/**
 * What the daemon supplies for the Runner→Core control channel.
 *
 * The handlers are built *from the stack's own* `Orchestrator`/`StageGate`, so the control
 * channel and the daemon's `conversation.message.send` path share one lifecycle, one
 * budget ledger and one set of guards.
 */
/** The narrow registry seam: the daemon owns the set, this stack only appends to it. */
export interface EgressPortRegistryPort {
  add(port: number): void;
  list(): readonly number[];
}

export interface ProjectExecutionControl {
  /** Builds the three documented internal methods plus the result hook. */
  readonly attach: (context: {
    readonly orchestrator: Orchestrator;
    readonly stageGate: StageGate;
    /** The Attempt read ledgers, for `context.request` (`AC-032`/`AC-085`). */
    readonly readLedgers: ReadLedgerRegistry;
    /**
     * The execution environment the live Attempt reported in `attempt.ready`.
     *
     * The supervisor owns the live map and is built after the control handler, so this
     * is a lazy lookup rather than the instance itself; `undefined` means the Attempt
     * has not reported ready (a delivery that freezes a manifest must then fail closed).
     */
    readonly environmentRefOf?: (attemptId: string) => string | undefined;
    /**
     * Releases the per-Task worktree lease of one delivered Attempt (WP-12 W4b).
     *
     * The stack owns the resolver, so the control handler receives this port rather than
     * building one: the release must go to the same manager whose lease the Attempt took.
     */
    readonly releaseWorkspaceLease?: (input: {
      readonly taskId: string;
      readonly attemptId: string;
    }) => boolean;
  }) => {
    readonly handler: ControlHandler;
    /**
     * Called when a Runner reports a result, before the Run settles
     * (`supervisor.ts` `AttemptResultInput`). Returning a corrective prompt asks the Attempt
     * for a compliant submission instead of ending the Run.
     */
    readonly onAttemptResult?: (input: AttemptResultInput) => string | undefined;
  };
  /** Message `received → processing` (`experience.md` §22); needs no stack state. */
  readonly onAttemptStarted?: RunnerSupervisorOptions['onAttemptStarted'];
  /** Message `processing → processed/failed`; needs no stack state. */
  readonly onRunSettled?: RunnerSupervisorOptions['onRunSettled'];
  /**
   * The per-Task worktree resolver this stack's tools resolve through
   * (`task-workspace.ts`). Optional: a stack without one runs its tools at the project root,
   * and `context.request` then reads the project root as well.
   */
  readonly workspace?: RunWorkspaceResolver;
  readonly port?: number;
  readonly maxBodyBytes?: number;
}

/**
 * What the daemon contributes to the tool bridge.
 *
 * The daemon builds the handler from the stack's own `Broker`/`GrantStore` (so the
 * capability revocation, the process registry and the Grant rows are one object graph),
 * which is why this is a factory rather than a finished handler.
 */
export interface ProjectExecutionTools {
  readonly attach: (context: {
    readonly store: ProjectStore;
    readonly grants: GrantStore;
    readonly grantService: ToolGrantService;
    readonly broker: Broker;
    /** The Attempt read ledgers (`AC-085`); the factory records reads through it. */
    readonly readLedgers: ReadLedgerRegistry;
  }) => ToolExecuteHandler & PermissionRequestHandler;
}

export interface ProjectExecution {
  readonly capabilities: AttemptCapabilityStore;
  readonly usage: RunUsageLedger;
  /** The stack's Chief orchestrator (`rules/agents.md` §3), shared with the protocol. */
  readonly orchestrator: Orchestrator;
  /** Structured delivery gate over the same lifecycle (`rules/agents.md` §4). */
  readonly stageGate: StageGate;
  readonly gatewayUrl: string;
  /** Base URL of the Runner→Core control endpoint (`protocol.md` §6). */
  readonly controlUrl: string;
  readonly supervisor: RunnerSupervisor;
  readonly proxy: ModelGatewayProxy;
  readonly control: ControlEndpoint;
  /** The stack's model gateway, so `provider.test` can probe the live configuration. */
  readonly gateway: ModelGateway;
  /** The stack's Grant ledger: the permission chain and the run-scope Grants (`T3`). */
  readonly grants: GrantStore;
  /** Mints and revokes tool Grants, and records permission decisions (`T3.4`). */
  readonly grantService: ToolGrantService;
  /** The tool Broker every `tool.execute` passes through (`execution.md` §1–4). */
  readonly broker: Broker;
  /** The Attempt read ledgers of this stack (`AC-085`). */
  readonly readLedgers: ReadLedgerRegistry;
  /**
   * Reaps one cancelled Run: kills its tool process groups and closes its Grants
   * (`reliability.md` §6 "停止新工具→SIGTERM后10秒SIGKILL工具进程树").
   */
  cleanupRun(runId: string): { readonly killed: number; readonly revoked: number };
  /**
   * Mints the Run's file-scope Grants from its authorization (`T3.4`).
   *
   * Called when an Attempt starts, so a professional Run's `read`/`edit`/`write` calls are
   * admitted by the Grant the approved Plan produced rather than by a per-call prompt
   * (Q-T3-3). A Work with no authorization decision yields `ok:false` — logged, not fatal:
   * the Run then simply has no file authority, which is the safe direction.
   */
  ensureRunGrants(runId: string): EnsureRunGrantsResult;
  /** Reconciles what a previous daemon left behind, then starts scheduling. */
  start(hostEpoch: string): ReturnType<RunnerSupervisor['start']>;
  stop(): Promise<void>;
  liveCount(): number;
}

/** Builds the execution stack for one project. */
export async function createProjectExecution(
  options: ProjectExecutionOptions,
): Promise<ProjectExecution> {
  const log = options.log ?? (() => undefined);
  const capabilities = new AttemptCapabilityStore();
  const usage = createMemoryUsageLedger();
  const lifecycle = new RunLifecycle({ store: options.store });
  const secretContext = new SecretContext(options.store);
  const gateway = new ModelGateway({
    config: options.config,
    snapshots: options.snapshots,
    transport: options.transport ?? new OpenAiCompatibleTransport(),
    secrets: gatewaySecretResolver(options.secrets, secretContext.context),
  });
  // One Orchestrator and one StageGate per project stack, over the shared lifecycle: the
  // daemon's protocol and the Runner's control channel must never disagree about a budget
  // reservation, an Attempt or a Run transition (WP-12 T2.1).
  const orchestrator = new Orchestrator({
    store: options.store,
    config: options.config,
    snapshots: options.snapshots,
    gateway,
    lifecycle,
  });
  // One ledger registry per stack: the handler appends to it and `StageGate` verifies the
  // binding a stage result reports (`AC-085`).
  const readLedgers = new ReadLedgerRegistry({ store: options.store });
  // One executed-evidence registry per stack (WP-12 W5): a Test Attempt's declared
  // commands are executed once and the result is bound to that Attempt's stage result.
  const testEvidence = new TestEvidenceRegistry();
  const stageGate = new StageGate({ store: options.store, lifecycle, readLedgers, testEvidence });
  // One JoinCoordinator per stack: the production caller of `onChildSettled` is the
  // supervisor's settled hook below, so an `agents.md` §3 `join=all` parent really moves to
  // `waiting_children` (and back, or to a `chief_action_required` todo) in the daemon path.
  const joins = new JoinCoordinator({ store: options.store });
  const supervisorHolder: { current?: RunnerSupervisor } = {};
  // The per-Task worktree manager the tools resolve through; the control handler needs its
  // lease release, so the resolver is built here and shared by both (`main.ts` passes its
  // own through `tools`/`control` today, which is why both are optional).
  const attached = options.control?.attach({
    orchestrator,
    stageGate,
    readLedgers,
    // The environment the live Attempt reported (`attempt.ready`), which the accepted
    // stage result freezes into its `VerificationManifest` (`control-handler.ts`
    // `commitTaskCandidate`). `supervisorHolder` is filled in below, before any Attempt can
    // start, so the value is always the real one.
    environmentRefOf: (attemptId) => supervisorHolder.current?.environmentRefOf(attemptId),
  });
  // The tool bridge shares this stack's lifecycle and its `GrantStore`: the same rows the
  // permission chain mints are the ones the Broker consumes and `onAttemptEnded` revokes.
  const toolGrants = new GrantStore({ store: options.store });
  const grantService = new ToolGrantService({ store: options.store, grants: toolGrants });
  const broker = new Broker({
    store: options.store,
    grants: toolGrants,
    ...(options.broker ?? {}),
  });
  const toolHandler = options.tools?.attach({
    store: options.store,
    grants: toolGrants,
    grantService,
    broker,
    readLedgers,
  });

  const proxy = await createModelGatewayProxy({
    gateway,
    store: options.store,
    capabilities,
    ...(options.host === undefined ? {} : { host: options.host }),
    port: 0,
    log,
    authorize: ({ run, attemptId }) => {
      log(`execution: ${run.id} attempt ${attemptId} authorized for Provider access`);
      secretContext.authorize({
        id: run.id,
        workId: run.workId,
        role: run.role as Role,
        stage: run.stage,
        purpose: run.purpose as Purpose,
      });
    },
    onUsage: (entry) => {
      usage.record(entry.runId, { tokensUsed: entry.inputTokens + entry.outputTokens });
    },
  });

  // The control endpoint must record accepted submissions on the supervisor, while the
  // supervisor's `prepare` needs the endpoint's URL: the holder breaks the cycle without
  // letting either side observe a half-built object.
  const controlUrl: { value: string | null } = { value: null };
  const control = await createControlEndpoint({
    store: options.store,
    capabilities,
    handler: attached?.handler ?? {
      assessmentSubmit: () => {
        throw new ProtocolError('INTERNAL_ERROR', 'assessment.submit has no handler in this stack');
      },
      agentDispatch: () => {
        throw new ProtocolError('INTERNAL_ERROR', 'agent.dispatch has no handler in this stack');
      },
      stageSubmit: () => {
        throw new ProtocolError('INTERNAL_ERROR', 'stage.submit has no handler in this stack');
      },
    },
    ...(toolHandler === undefined
      ? {}
      : { toolExecute: toolHandler, permissionRequest: toolHandler }),
    noteSubmitted: ({ runId, attemptId }) => {
      supervisor?.noteSubmitted(runId, attemptId);
    },
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.control?.port === undefined ? {} : { port: options.control.port }),
    ...(options.control?.maxBodyBytes === undefined
      ? {}
      : { maxBodyBytes: options.control.maxBodyBytes }),
    log,
  });
  controlUrl.value = control.url;
  registerBoundPort(options.egressPorts, control.port);
  registerBoundPort(options.egressPorts, proxy.port);

  const supervisor: RunnerSupervisor = new RunnerSupervisor({
    store: options.store,
    spawn: options.spawn,
    prepare: options.prepare({
      capabilities,
      gatewayUrl: proxy.url,
      controlUrl: requireControlUrl(controlUrl),
    }),
    lifecycle,
    recovery: new RunRecoveryService({
      store: options.store,
      ...(options.probe === undefined ? {} : { probe: options.probe }),
    }),
    ...(options.tickMs === undefined ? {} : { tickMs: options.tickMs }),
    ...(attached?.onAttemptResult === undefined
      ? {}
      : { onAttemptResult: attached.onAttemptResult }),
    // A starting Attempt first receives the file authority its Work's authorization
    // produced, then the daemon's own bookkeeping runs (`experience.md` §22).
    onAttemptStarted: (input) => {
      try {
        const granted = ensureRunGrants(input.runId);
        log(
          `execution: ${input.runId} run grants created=${String(granted.created)} existing=${String(granted.existing)}${granted.ok ? '' : ` (${granted.reason ?? 'none'})`}`,
        );
      } catch (error) {
        log(
          `execution: ${input.runId} run grants failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // WP-12 W5: a Test Run's own stage result must rest on executed evidence, so Core
      // runs the project's declared acceptance commands as soon as the Attempt is ready.
      // The work happens in the background — the model's turn starts immediately — and the
      // registry holds `pending` until the real exit codes are in, which is what makes a
      // `success` claim before then a typed refusal rather than a recorded victory.
      //
      // `onAttemptStarted` fires twice per Attempt (`supervisor.registerLiveAttempt` at
      // spawn, then again on `attempt.ready`); the environment identity the evidence binds
      // only exists after readiness, so the spawn-time call is skipped and the ready-time
      // call starts the execution.
      const started = options.store.runs.find(input.runId);
      if (started?.role === 'test') {
        if (supervisorHolder.current?.environmentRefOf(input.attemptId) === undefined) {
          log(
            `execution: ${input.runId} attempt ${input.attemptId} has no reported environment yet; the declared test commands wait for attempt.ready`,
          );
        } else {
          void executeTestEvidence(input.runId, input.attemptId).catch((error: unknown) => {
            log(
              `execution: ${input.runId} test evidence failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }
      }
      options.control?.onAttemptStarted?.(input);
    },
    // `agents.md` §3 / `join.ts`: a settled child Run updates its parent Chief Run
    // (`running → waiting_children` while a `join=all` sibling is outstanding, back to
    // `running` once every child is terminal, and a `chief_action_required` event when a
    // required child failed) — the `waiting_children`/join semantics `protocol.md` §6 and
    // `reliability.md` name. The supervisor is the only place the production path observes a
    // child's terminal status, so the trigger is wired here: `JoinCoordinator.onChildSettled`
    // had no production caller. A root Run (or a non-Chief parent) is not a join, so its
    // verdict is reported and never thrown into the settle path.
    onRunSettled: (input) => {
      try {
        const outcome = joins.onChildSettled(input.runId);
        if (outcome.kind !== 'orphan') {
          log(
            `execution: join after ${input.runId} settled → ${outcome.kind} (parent ${outcome.parentRunId})`,
          );
        }
      } catch (error) {
        log(
          `execution: join update failed for ${input.runId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      options.control?.onRunSettled?.(input);
    },
    usage,
    // `reliability.md` §2: revoking the capability is part of ending an Attempt, and the
    // endpoint re-checks the Attempt anyway (defence in depth).
    onAttemptEnded: ({ attemptId, runId }) => {
      capabilities.revoke(attemptId);
      // `reliability.md` §2/§6: ending an Attempt reclaims what it used — the tool process
      // groups it started (the daemon owns them, not the Runner) and the Grants it held. The
      // read ledger is released too: the seal it produced is already durable in
      // `stage_result`, and an Attempt that ends must not keep admitting appends.
      broker.processes.kill(attemptId);
      grantService.revokeRun(runId, 'attempt ended');
      readLedgers.release(attemptId);
      testEvidence.release(attemptId);
    },
    log,
  });
  supervisorHolder.current = supervisor;

  /** The Run's `(work, role, stage)` facts, or `undefined` when the Run is gone. */
  function ensureRunGrants(runId: string): EnsureRunGrantsResult {
    const run = options.store.runs.find(runId);
    if (run === undefined) {
      return {
        ok: false,
        grants: [],
        created: 0,
        existing: 0,
        decisionId: '',
        reason: `Run ${runId} does not exist`,
      };
    }
    return grantService.ensureRunGrants({
      workId: run.workId,
      runId: run.id,
      role: run.role,
      stage: run.stage,
      expiresAt: new Date(Date.now() + LIMITS.workActiveTimeSec.default * 1000).toISOString(),
    });
  }

  /** How long one declared acceptance command may run (`LIMITS.shellTimeoutSec`). */
  const TEST_COMMAND_TIMEOUT_MS = LIMITS.shellTimeoutSec.default * 1000;

  /**
   * The code-tree hash of the frozen candidate a Test Run verifies (`data.md` §3).
   *
   * The evidence must be bound to the tree the commands actually ran against, so the
   * hash comes from the Task's frozen `VerificationManifest` — the exact candidate the
   * develop stage committed. `''` means no frozen tree exists; the caller then records
   * `blocked` rather than binding the evidence to an invented hash.
   */
  function frozenInputTree(taskId: string | undefined): string {
    if (taskId === undefined) return '';
    const task = options.store.tasks.find(taskId);
    if (task?.latestManifestId === undefined) return '';
    return readFrozenVerificationManifest(options.store, task.latestManifestId)?.codeTree ?? '';
  }

  /**
   * Executes the project's declared acceptance commands for one Test Attempt
   * (`execution.md` §5, `workflow.md` §3/§6, WP-12 W5).
   *
   * The commands come from the **project configuration** (`policy.testCommands`, the
   * documented `ConfigPatch` field) — never from the model or the dispatch — and run
   * through {@link Broker.runDeclaredTestCommand}, which pins them to the isolated
   * container, the read-only workspace mount, the `--network none` boundary and the
   * controlled egress channel. Every real exit code is captured with bounded
   * stdout/stderr, one `evidence` artifact is stored per command, and the resulting
   * `CheckResult` is what `StageGate` binds to the stage result: an unconfigured
   * project is `not_covered`, a failed command is `failed`, a refused/blocked execution
   * is `blocked`, and only every-command-exited-0 is `passed`.
   */
  async function executeTestEvidence(runId: string, attemptId: string): Promise<void> {
    const run = options.store.runs.find(runId);
    if (run === undefined || run.role !== 'test') return;
    const acceptanceIds =
      run.taskId === undefined ? [] : (options.store.tasks.find(run.taskId)?.acceptanceIds ?? []);
    testEvidence.begin(attemptId);
    const commands = options.config.project().policy.testCommands;
    const runnerEnvironment = supervisorHolder.current?.environmentRefOf(attemptId);
    // W8-1 (`data.md` §3): the executed check binds the **same** real environment
    // descriptor the frozen `VerificationManifest` names — the Runner's own
    // `attempt.ready` observation `host:<platform>/<arch>/node-<major>` /
    // `container:<image>` — instead of the Attempt id the check used to carry. That is
    // what makes `checkResult.checks[].environmentRef` and
    // `VerificationManifest.environmentRef` one comparable descriptor; the container
    // image and the Runner descriptor are also kept in the human-readable `result`.
    // `executeTestEvidence` only runs after readiness (`onAttemptStarted` skips the
    // spawn-time call until `environmentRefOf` answers), so the descriptor is present on
    // every production path; an id is kept only as a fail-closed fallback for a stack
    // whose supervisor reports nothing (the candidate commit then refuses to freeze a
    // manifest, so the check cannot silently stand in for a verification environment).
    const environmentRef = runnerEnvironment ?? attemptId;
    const executionImage = broker.execImageTag;
    const inputTree = frozenInputTree(run.taskId);
    const workspace = options.workspace;
    const artifacts = options.artifacts;
    try {
      if (commands.length === 0) {
        // The honest empty default (`w4b-implementation.md` §9.8): no command means no
        // executed check, so the stage can only record `not_covered`.
        testEvidence.record(
          attemptId,
          buildTestCheckResult({
            executions: [],
            environmentRef,
            executionImage,
            ...(runnerEnvironment === undefined ? {} : { runnerEnvironment }),
            inputTree,
            acceptanceIds,
            outputRefs: [],
          }),
        );
        log(
          `execution: Run ${runId} declares no policy.testCommands; the Test stage records not_covered`,
        );
        return;
      }
      if (workspace === undefined || artifacts === undefined) {
        testEvidence.record(
          attemptId,
          buildBlockedTestCheckResult({
            reason:
              'this stack has no workspace resolver or artifact service, so the declared acceptance commands cannot be executed',
            acceptanceIds,
          }),
        );
        return;
      }
      if (inputTree === '') {
        testEvidence.record(
          attemptId,
          buildBlockedTestCheckResult({
            reason:
              'the frozen candidate tree hash is unknown, so executed evidence cannot be bound to a tree',
            acceptanceIds,
          }),
        );
        return;
      }
      const epoch = options.store.attempts.find(attemptId)?.ownerEpoch ?? 1;
      const root = workspace.resolve({
        workId: run.workId,
        runId: run.id,
        attemptId,
        epoch,
      }).root;
      const executions: DeclaredCommandExecution[] = [];
      const outputRefs: string[] = [];
      for (const command of commands) {
        const outcome = await broker.runDeclaredTestCommand({
          workId: run.workId,
          runId: run.id,
          attemptId,
          epoch,
          role: 'test',
          stage: run.stage,
          command,
          roots: [root],
          timeoutMs: TEST_COMMAND_TIMEOUT_MS,
        });
        if (!outcome.ok) {
          testEvidence.record(
            attemptId,
            buildBlockedTestCheckResult({
              reason: `${outcome.code}: ${outcome.reason}`,
              acceptanceIds,
            }),
          );
          log(
            `execution: Run ${runId} declared command refused (${outcome.code}): ${outcome.reason}`,
          );
          return;
        }
        executions.push({
          command,
          exitCode: outcome.result.status,
          stdout: outcome.result.stdout,
          stderr: outcome.result.stderr,
          signal: outcome.result.signal,
          durationMs: outcome.durationMs,
          ...(outcome.result.error === undefined ? {} : { error: outcome.result.error }),
        });
        const artifact = artifacts.createAgent({
          run: { id: run.id, workId: run.workId, role: 'test' },
          kind: 'evidence',
          mime: 'text/plain',
          bytes: Buffer.from(
            [
              `$ ${command}`,
              `image ${executionImage}`,
              ...(runnerEnvironment === undefined ? [] : [`runner ${runnerEnvironment}`]),
              `exit ${String(outcome.result.status)}${outcome.result.signal === null ? '' : ` signal=${outcome.result.signal}`} in ${String(outcome.durationMs)}ms`,
              boundTestOutput(outcome.result.stdout),
              boundTestOutput(outcome.result.stderr),
            ].join('\n'),
            'utf8',
          ),
        });
        outputRefs.push(artifact.id);
      }
      const checkResult = buildTestCheckResult({
        executions,
        environmentRef,
        executionImage,
        ...(runnerEnvironment === undefined ? {} : { runnerEnvironment }),
        inputTree,
        acceptanceIds,
        outputRefs,
      });
      testEvidence.record(attemptId, checkResult);
      log(
        `execution: Run ${runId} executed ${String(commands.length)} declared test command(s) → ${checkResult.status} (${executions
          .map((execution) => `exit ${String(execution.exitCode)}`)
          .join(', ')})`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      testEvidence.record(attemptId, buildBlockedTestCheckResult({ reason, acceptanceIds }));
      log(`execution: Run ${runId} test evidence failed: ${reason}`);
    }
  }

  return {
    capabilities,
    usage,
    orchestrator,
    stageGate,
    gatewayUrl: proxy.url,
    controlUrl: control.url,
    supervisor,
    proxy,
    control,
    gateway,
    grants: toolGrants,
    grantService,
    broker,
    readLedgers,
    ensureRunGrants,
    cleanupRun: (runId) => {
      // A cancelled Work's Runs do not all pass through `onAttemptEnded` (the findings
      // service stops the attempt *rows*); the tool processes and Grants that belong to
      // the Run are reaped here so a cancel really stops the tools.
      const attempts = options.store.attempts.list({
        where: 'run_id = ?',
        params: [runId],
        orderBy: 'created_at DESC',
      });
      let killed = 0;
      for (const attempt of attempts) {
        killed += broker.processes.kill(attempt.id);
        readLedgers.release(attempt.id);
      }
      return { killed, revoked: grantService.revokeRun(runId, 'run cancelled') };
    },
    start: (hostEpoch) => supervisor.start(hostEpoch),
    stop: async () => {
      // `reliability.md` §7: stop admission, reap what this process started, then close the
      // endpoints that could start more. Killing the tool groups before `supervisor.stop()`
      // means a Runner's in-flight tool is already dead when its process is asked to end.
      const live = supervisor.liveAttempts();
      for (const entry of live) {
        broker.processes.kill(entry.attemptId);
        grantService.revokeRun(entry.runId, 'daemon stopped');
        readLedgers.release(entry.attemptId);
      }
      broker.processes.killAll();
      await supervisor.stop();
      await Promise.all([proxy.close(), control.close()]);
    },
    liveCount: () => supervisor.liveAttempts().length,
  };
}

/** Reports one bound listener port to the daemon's egress registry, when it has one. */
function registerBoundPort(registry: EgressPortRegistryPort | undefined, port: number): void {
  if (registry === undefined) return;
  registry.add(port);
}

/**
 * The control URL as a late-bound value.
 *
 * `prepare` runs during supervisor construction, after the endpoint started, so the value is
 * always set by then; a `null` here would be a wiring bug, and saying so beats handing the
 * Runner a URL of `'null'`.
 */
function requireControlUrl(holder: { value: string | null }): string {
  if (holder.value === null) {
    throw new Error('the control endpoint URL was not set before the supervisor was built');
  }
  return holder.value;
}
