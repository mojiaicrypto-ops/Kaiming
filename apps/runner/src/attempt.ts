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
import { LIMITS } from '@agentdev/contracts';
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

  constructor(options: AttemptRunnerOptions, deps: AttemptRunnerDeps) {
    this.options = options;
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
        // A requested tool the session did not activate is a configuration
        // error; it is reported instead of being dropped silently.
        droppedTools: this.options.toolNames.filter((name) => !active.includes(name)),
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
          await this.session?.prompt(command.text);
          this.finish('completed', 'prompt completed');
        } catch (error) {
          this.finish('failed', error instanceof Error ? error.message : String(error));
        }
        return false;
      }
      case 'attempt.steer': {
        await this.session?.steer(command.text);
        return true;
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
