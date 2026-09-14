/**
 * One Attempt, one process, one writer.
 *
 * Sources: `docs/architecture/ARCHITECTURE.md` §2 lists `apps/runner` as
 * "单Attempt、Pi Adapter、IPC", and §3 requires each Run to own its session and
 * adapter subscription ("会话恢复通过保存的SessionManager与新Factory实例，事件订阅
 * 每次重新建立"). `docs/architecture/reliability.md` §2 binds an Attempt to a
 * monotonically increasing epoch and one writer; `docs/architecture/execution.md`
 * §7 makes a failed critical capability stop the Run before it starts, rejects an
 * unknown extension id, and disables a failed optional extension on its own.
 *
 * The class below owns exactly those responsibilities and never touches SQLite:
 * it reports facts to the Core and lets the daemon be the single writer of
 * business state.
 */
import {
  PiSessionFactory,
  PiRuntimeError,
  activateExtensions,
  createExplicitResources,
  type BuiltinExtensionSpec,
  type ExtensionRequest,
  type PiSessionEvent,
  type PiSessionHandle,
  type ExplicitResources,
  type PiToolSpec,
} from '@agentdev/pi-runtime';
import { LIMITS, type Role } from '@agentdev/contracts';
import { controlTools, createControlClient, type ControlClient } from './control-client.js';
import { environmentRef } from './environment.js';
import { createReadLedger } from './read-ledger.js';
import {
  parseCommand,
  writeMessage,
  type DistributiveOmit,
  type RunnerCommand,
  type RunnerMessage,
  type RunnerOutput,
} from './ipc.js';

/**
 * Critical capabilities the Core itself provides
 * (`execution.md` §7: "Core Critical能力：policy/context/artifact/events/dispatch").
 * Extensions are optional additions; the shipped whitelist is empty for this
 * release, and any configured id outside it is rejected.
 */
export const CORE_CAPABILITIES = ['policy', 'context', 'artifact', 'events', 'dispatch'] as const;

export interface AttemptRunnerOptions {
  readonly attemptId: string;
  readonly epoch: number;
  readonly cwd: string;
  readonly agentDir: string;
  readonly provider: string;
  readonly modelId: string;
  readonly toolNames: readonly string[];
  readonly customTools?: readonly PiToolSpec[];
  readonly skillPaths?: readonly string[];
  readonly trusted: boolean;
  readonly systemPrompt?: string;
  readonly modelsPath?: string | null;
  /** Short-lived attempt capability the control endpoint authenticates (`protocol.md` §6). */
  readonly capability: string;
  /**
   * The role this Attempt runs as (`rules/agents.md` §1).
   *
   * It decides which control tools are registered: the Chief submits its assessment and
   * dispatches through `assessment_submit`/`agent_dispatch`, a professional Run delivers
   * through `stage_yield` (`execution.md` §7, `protocol.md` §6).
   */
  readonly role?: Role;
  /** Base URL of the Core control endpoint; absent means no control tools are registered. */
  readonly controlUrl?: string;
  /** The Work a Chief assessment must name. */
  readonly workId?: string;
  /**
   * How long the Runner waits for a control submission to land after a turn ends.
   *
   * This is a grace period, not a gate: a turn whose tool call is still in flight reports
   * its result anyway, and the supervisor's corrective prompt
   * (`protocol.md` §6) is the authority on compliance.
   */
  readonly submissionGraceMs?: number;
  /** Test seam: replaces the control client (a real loopback client by default). */
  readonly controlClient?: ControlClient;
  /**
   * The Attempt's read-ledger binding (`AC-085`), injected into `stage_yield`.
   *
   * Supplied by the process entry point from the tool bridge, which learned the binding
   * from Core's own `tool.execute` answers. Absent means the Runner has no ledger to report.
   */
  readonly readLedgerBinding?: () => { readonly seq: number; readonly hash: string };
  /** Extension ids configured for this Attempt; unknown ids are rejected. */
  readonly extensionRequests?: readonly ExtensionRequest[];
  /** Test seam: replaces the shipped whitelist. */
  readonly extensionManifest?: readonly BuiltinExtensionSpec[];
  /** Test seam: per-extension activation hook. */
  readonly activateExtension?: (spec: BuiltinExtensionSpec) => void | Promise<void>;
}

/** What the session builder receives; the resources are already explicit. */
export interface AttemptSessionRequest {
  readonly options: AttemptRunnerOptions;
  readonly resources: ExplicitResources;
}

export type AttemptSessionBuilder = (request: AttemptSessionRequest) => Promise<PiSessionHandle>;

export interface AttemptRunnerDeps {
  readonly output: RunnerOutput;
  /** Terminates the process when the attempt reaches a terminal state. */
  readonly exit: (code: number) => void;
  /** Test seam: builds the session instead of the real Pi runtime. */
  readonly buildSession?: AttemptSessionBuilder;
}

/** Builds a real Pi session over the attempt's explicit resources. */
async function createPiSession(request: AttemptSessionRequest): Promise<PiSessionHandle> {
  const { options, resources } = request;
  const factory = await PiSessionFactory.create({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelsPath: options.modelsPath === undefined ? null : options.modelsPath,
  });
  return factory.createSession({
    provider: options.provider,
    modelId: options.modelId,
    resourceLoader: resources.loader,
    toolNames: [...options.toolNames],
    customTools: [...(options.customTools ?? [])],
  });
}

/** Runs one Attempt and reports its lifecycle to the Core. */
export class AttemptRunner {
  private readonly options: AttemptRunnerOptions;
  private readonly deps: AttemptRunnerDeps;
  private session: PiSessionHandle | undefined;
  private unsubscribe: (() => void) | undefined;
  private seq = 0;
  private terminal = false;
  private heartbeat: NodeJS.Timeout | undefined;
  private readonly startedAt = Date.now();
  /**
   * The reads this Attempt really performed (`AC-085`); T2 runs no file tools, so the seal
   * is the empty-ledger value until the T3 tool bridge records a read.
   */
  private readonly readLedger = createReadLedger();
  /** What this Attempt delivered through the Core control channel (`protocol.md` §6). */
  private readonly submission = {
    assessment: false,
    dispatch: false,
    stage: false,
  };

  constructor(options: AttemptRunnerOptions, deps: AttemptRunnerDeps) {
    const control =
      options.controlClient ??
      (options.controlUrl === undefined
        ? undefined
        : createControlClient({
            url: options.controlUrl,
            capability: options.capability,
            attemptId: options.attemptId,
            epoch: options.epoch,
          }));
    const submission = this.submission;
    const customTools = [
      ...(options.customTools ?? []),
      ...(control === undefined
        ? []
        : controlTools({
            client: control,
            role: options.role ?? 'backend',
            ...(options.workId === undefined ? {} : { workId: options.workId }),
            ...(options.readLedgerBinding === undefined
              ? {}
              : { readLedgerBinding: options.readLedgerBinding }),
            readLedger: this.readLedger,
            onStageSubmitted: () => {
              submission.stage = true;
            },
            onAssessmentSubmitted: () => {
              submission.assessment = true;
            },
            onDispatchSubmitted: () => {
              submission.dispatch = true;
            },
          })),
    ];
    // Pi SDK 0.85.1: `tools` is BOTH the allowlist and the initial active set
    // (`dist/core/sdk.js:141` `allowedToolNames = options.tools`, `:144`
    // `initialActiveToolNames = options.tools ?? …`), and `_refreshToolRegistry` filters
    // `customTools` through that allowlist (`dist/core/agent-session.js:2112-2118`). A custom
    // tool that is not named in `tools` is therefore discarded, so the role's registry — not
    // the (possibly empty) `frozen.profile.toolSubset` — must be the session's allowlist
    // (T3.1 handoff).
    const registeredNames = customTools.map((tool) => tool.name);
    this.options = {
      ...options,
      customTools,
      toolNames: [...new Set([...options.toolNames, ...registeredNames])],
    };
    this.deps = deps;
  }

  /**
   * Prepares the runtime: extension gate, explicit resources, Pi session.
   *
   * @returns the process exit code; a non-zero code means the Attempt must not
   * start, exactly as `execution.md` §7 requires for a failed critical extension
   * or an unknown extension id.
   */
  async start(): Promise<number> {
    try {
      const extensions = await activateExtensions({
        ...(this.options.extensionManifest === undefined
          ? {}
          : { manifest: this.options.extensionManifest }),
        ...(this.options.extensionRequests === undefined
          ? {}
          : { requested: this.options.extensionRequests }),
        ...(this.options.activateExtension === undefined
          ? {}
          : { activate: this.options.activateExtension }),
        providedCapabilities: [...CORE_CAPABILITIES],
      });
      if (extensions.startupBlocked) {
        this.fail(
          'CRITICAL_EXTENSION_FAILED',
          `critical extension failed: ${extensions.disabled
            .filter((entry) => entry.critical)
            .map((entry) => entry.id)
            .join(', ')}`,
        );
        return 1;
      }

      const resources = createExplicitResources({
        cwd: this.options.cwd,
        agentDir: this.options.agentDir,
        trusted: this.options.trusted,
        skillPaths: [...(this.options.skillPaths ?? [])],
        ...(this.options.systemPrompt === undefined
          ? {}
          : { systemPrompt: this.options.systemPrompt }),
      });

      const session = await (this.deps.buildSession ?? createPiSession)({
        options: this.options,
        resources,
      });
      this.session = session;
      this.unsubscribe = session.subscribe((event) => this.emit(event));
      // `reliability.md` §2: "心跳每5秒，20秒无心跳标interrupted". A model call can run
      // far longer than that, so the Runner proves liveness independently of the work.
      this.heartbeat = setInterval(() => {
        if (this.terminal) return;
        this.send({ type: 'attempt.heartbeat', uptimeMs: Date.now() - this.startedAt });
      }, LIMITS.heartbeatSec.default * 1000);
      this.heartbeat.unref();

      const active = session.activeToolNames();
      this.send({
        type: 'attempt.ready',
        sessionId: session.sessionId,
        provider: session.provider,
        modelId: session.modelId,
        tools: active,
        // A requested tool the session did not activate is a configuration error; it is
        // reported instead of being dropped silently. The list is the union of the profile's
        // subset and the role's control tools, so a control tool the SDK refused to activate
        // fails the Attempt loudly rather than leaving the model unable to deliver.
        droppedTools: this.options.toolNames.filter((name) => !active.includes(name)),
        // The environment this Attempt really runs in, so `stage.submit` can freeze a
        // manifest that names it instead of a placeholder (`protocol.md:123`).
        environmentRef: environmentRef(),
      });
      return 0;
    } catch (error) {
      if (error instanceof PiRuntimeError) {
        this.fail(error.code, error.message);
      } else {
        this.fail('ATTEMPT_START_FAILED', error instanceof Error ? error.message : String(error));
      }
      return 1;
    }
  }

  /**
   * Handles one inbound command.
   *
   * @returns `true` when the Runner should keep running.
   */
  async handle(command: RunnerCommand): Promise<boolean> {
    if (command.attemptId !== this.options.attemptId || command.epoch !== this.options.epoch) {
      // Stale or foreign message: dropped, never applied to this Attempt.
      return !this.terminal;
    }
    switch (command.type) {
      case 'attempt.prompt': {
        try {
          const session = this.session;
          if (session === undefined) {
            this.finish('failed', 'the Attempt has no session');
            return false;
          }
          await session.prompt(command.text);
          await this.settleTurn(session);
        } catch (error) {
          this.finish('failed', error instanceof Error ? error.message : String(error));
        }
        return !this.terminal;
      }
      case 'attempt.steer': {
        // `protocol.md` §6: after a turn that delivered nothing the Run **waits for the
        // submission prompt** rather than ending, and this is that prompt. It arrives after
        // the previous turn already ended, so a plain `steer()` would only queue a message
        // for a run that will never start again (the SDK drains its steering queue inside
        // the prompt loop, `pi-agent-core` `Agent.continue`): an idle session therefore gets
        // a real new turn with the correction as its input.
        const session = this.session;
        if (session === undefined) return !this.terminal;
        try {
          if (session.isIdle()) await session.prompt(command.text);
          else await session.steer(command.text);
          await this.settleTurn(session);
        } catch (error) {
          this.finish('failed', error instanceof Error ? error.message : String(error));
        }
        return !this.terminal;
      }
      case 'attempt.abort': {
        await this.session?.abort();
        this.finish('cancelled', 'aborted by the Core');
        return false;
      }
      case 'attempt.shutdown': {
        this.finish('cancelled', 'shutdown requested');
        return false;
      }
    }
  }

  /** Handles one raw stdin line. */
  async handleLine(line: string): Promise<boolean> {
    const command = parseCommand(line);
    if (command === undefined) return !this.terminal;
    return this.handle(command);
  }

  /** Waits for the session to finish its turn, bounded so a hung turn cannot hang the Run. */
  private async awaitIdle(session: PiSessionHandle, timeoutMs = 600_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!session.isIdle()) {
      if (Date.now() > deadline) throw new Error('the session did not become idle in time');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Waits out one turn and reports what it produced.
   *
   * `prompt()` resolves when the turn is *accepted*, so the Attempt is only complete once the
   * session is idle again: exiting earlier would abandon the model call (`reliability.md` §5).
   * A turn that delivered nothing does **not** end the Attempt — `protocol.md` §6 makes the
   * Run wait for the one correction, and Core turns a second empty turn into a
   * `contract_violation`. Exiting here is what made that correction undeliverable: the
   * supervisor's `attempt.steer` reached a process that had already reported and left
   * (WP-12 R7, `drill.message-to-stage` under acceptance load).
   */
  private async settleTurn(session: PiSessionHandle): Promise<void> {
    await this.awaitIdle(session);
    // The turn is done; give a control submission still in flight a moment to land before
    // reporting. The supervisor's corrective prompt (`protocol.md` §6) is the authority on
    // compliance, so this wait never blocks the result forever.
    await this.awaitSubmission();
    if (this.delivered()) {
      this.finish('completed', 'prompt completed');
      return;
    }
    this.send({ type: 'attempt.result', status: 'completed', message: 'prompt completed' });
    // stderr, never stdout: the IPC channel carries framed JSON only.
    process.stderr.write(
      `runner: ${this.options.attemptId} delivered nothing; waiting for the correction or a shutdown\n`,
    );
  }

  /**
   * True when this Attempt delivered the structured result its role owes Core.
   *
   * A Chief Run submits an assessment and/or a dispatch; a professional Run submits a
   * stage result (`execution.md` §7). This is the Runner's own view; the supervisor
   * re-checks the same fact independently, because a real control call can still be in
   * flight when the turn ends.
   */
  private delivered(): boolean {
    return this.options.role === 'chief'
      ? this.submission.assessment || this.submission.dispatch
      : this.submission.stage;
  }

  /**
   * Waits `submissionGraceMs` for the control call of this turn to be accepted.
   *
   * Returns as soon as anything was delivered, so a compliant Run exits immediately; a
   * plain-text answer costs the grace period once and is then answered with the
   * supervisor's corrective prompt.
   */
  private async awaitSubmission(): Promise<void> {
    const graceMs = this.options.submissionGraceMs ?? 5_000;
    if (graceMs <= 0 || this.delivered()) return;
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (this.delivered()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Releases the session and stops the heartbeat; safe to call more than once. */
  dispose(): void {
    if (this.heartbeat !== undefined) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.session !== undefined && !this.session.disposed()) this.session.dispose();
  }

  /** Emits one already-mapped session event with the next sequence number. */
  private emit(event: PiSessionEvent): void {
    this.send({
      type: 'attempt.event',
      seq: this.seq++,
      event: { ...event },
    });
  }

  private finish(status: 'completed' | 'failed' | 'cancelled', message: string): void {
    if (this.terminal) return;
    this.terminal = true;
    this.send({ type: 'attempt.result', status, message });
    this.dispose();
    this.deps.exit(status === 'completed' ? 0 : 1);
  }

  private fail(code: string, message: string): void {
    this.terminal = true;
    this.send({ type: 'attempt.error', code, message });
    this.dispose();
  }

  private send(message: DistributiveOmit<RunnerMessage, 'v' | 'attemptId' | 'epoch'>): void {
    writeMessage(this.deps.output, {
      v: 1,
      attemptId: this.options.attemptId,
      epoch: this.options.epoch,
      ...message,
    });
  }
}
