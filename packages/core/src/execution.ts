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
import type { Grant, Purpose, Role } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';

import { AttemptCapabilityStore } from './capabilities.js';
import type { ConfigStore } from './config.js';
import { createModelGatewayProxy, type ModelGatewayProxy } from './gateway-http.js';
import { ModelGateway, type GatewayTransport } from './model-gateway.js';
import { RunLifecycle } from './run-lifecycle.js';
import { RunRecoveryService, type ProcessProbe } from './recovery.js';
import { gatewaySecretResolver } from './secrets.js';
import type { SecretStore } from './secrets.js';
import type { SnapshotWriter } from './snapshots.js';
import { OpenAiCompatibleTransport } from './transport-http.js';
import {
  RunnerSupervisor,
  createMemoryUsageLedger,
  type PrepareRun,
  type RunnerSpawnPort,
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
   * Builds the Runner invocation (the daemon supplies `createPrepareRun`).
   *
   * A factory, because the invocation needs the Attempt capabilities and the gateway URL
   * that this module creates — the context is handed back instead of invented twice.
   */
  readonly prepare: (context: {
    readonly capabilities: AttemptCapabilityStore;
    readonly gatewayUrl: string;
  }) => PrepareRun;
  /** Starts the Runner process (the daemon supplies the child-process port). */
  readonly spawn: RunnerSpawnPort;
  readonly host?: '127.0.0.1' | '::1' | 'localhost';
  /** Overridable for tests; defaults to the real OpenAI-compatible transport. */
  readonly transport?: GatewayTransport;
  /** Overridable for tests; defaults to a node process probe. */
  readonly probe?: ProcessProbe;
  readonly tickMs?: number;
  readonly log?: (line: string) => void;
}

export interface ProjectExecution {
  readonly capabilities: AttemptCapabilityStore;
  readonly usage: RunUsageLedger;
  readonly gatewayUrl: string;
  readonly supervisor: RunnerSupervisor;
  readonly proxy: ModelGatewayProxy;
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

  const supervisor = new RunnerSupervisor({
    store: options.store,
    spawn: options.spawn,
    prepare: options.prepare({
      capabilities,
      gatewayUrl: proxy.url,
    }),
    lifecycle,
    recovery: new RunRecoveryService({
      store: options.store,
      ...(options.probe === undefined ? {} : { probe: options.probe }),
    }),
    ...(options.tickMs === undefined ? {} : { tickMs: options.tickMs }),
    usage,
    // `reliability.md` §2: revoking the capability is part of ending an Attempt, and the
    // endpoint re-checks the Attempt anyway (defence in depth).
    onAttemptEnded: ({ attemptId }) => {
      capabilities.revoke(attemptId);
    },
    log,
  });

  return {
    capabilities,
    usage,
    gatewayUrl: proxy.url,
    supervisor,
    proxy,
    start: (hostEpoch) => supervisor.start(hostEpoch),
    stop: async () => {
      await supervisor.stop();
      await proxy.close();
    },
    liveCount: () => supervisor.liveAttempts().length,
  };
}
