/**
 * Pi session factory and handle.
 *
 * `docs/architecture/ARCHITECTURE.md` §3 constrains the shape:
 * "Pi采用独立Session Factory、显式ResourceLoader和自定义工具；只在pi-runtime引用
 *  SDK类型。Adapter暴露create/prompt/steer/followUp/abort/compact/dispose/subscribe；
 *  会话恢复通过保存的SessionManager与新Factory实例，事件订阅每次重新建立。外部API不
 *  使用Pi内部字段。"
 *
 * Everything the SDK owns stays inside this module: callers receive
 * {@link PiSessionEvent} values and a handle whose methods mirror the contract.
 * Only `@agentdev/pi-runtime` imports `@earendil-works/pi-coding-agent`.
 */
import {
  ModelRuntime,
  SettingsManager,
  SessionManager,
  createAgentSession,
  defineTool,
  type AgentSession,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import type { TSchema } from 'typebox';
import { PiRuntimeError } from './errors.js';
import { type PiSessionListener, toPiSessionEvent } from './events.js';
import type { ResourceLoader } from '@earendil-works/pi-coding-agent';

/** A tool the Runner exposes to the model, described without SDK types. */
export interface PiToolSpec {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TSchema;
  execute(
    params: Record<string, unknown>,
    context: { readonly signal: AbortSignal | undefined },
  ): Promise<{ text: string; isError?: boolean }>;
}

export interface PiRuntimeConfig {
  /** Working directory the session is bound to. */
  readonly cwd: string;
  /** Agent config directory for the Pi runtime. */
  readonly agentDir: string;
  /**
   * Model catalog path. `null` disables reading any user catalog, leaving the
   * statically bundled models — the deterministic default for a Runner.
   */
  readonly modelsPath?: string | null;
  /** Credential source; defaults to an in-memory store (no user auth.json). */
  readonly useInMemoryCredentials?: boolean;
  /** Allow catalog refreshes over the network. Defaults to `false`. */
  readonly allowModelNetwork?: boolean;
}

export interface CreatePiSessionOptions {
  /** Provider id of the configured role model. */
  readonly provider: string;
  /** Model id of the configured role model. */
  readonly modelId: string;
  /** Explicit resource loader; required, so no default discovery can occur. */
  readonly resourceLoader: ResourceLoader;
  /** Allowlist of tool names this role may use. */
  readonly toolNames: readonly string[];
  /** Custom tools referenced by `toolNames`. */
  readonly customTools?: readonly PiToolSpec[];
  /** Load a stored session instead of starting an empty one. */
  readonly resumeFrom?: string;
  /** Directory a new session is persisted into; omitted means in-memory. */
  readonly sessionDir?: string;
  /** Settings manager override; defaults to in-memory settings. */
  readonly settingsManager?: SettingsManager;
  /** Thinking level forwarded to the SDK. */
  readonly thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
}

/** The Runner-facing handle around one Pi session. */
export interface PiSessionHandle {
  readonly sessionId: string;
  readonly provider: string;
  readonly modelId: string;
  /** Persisted session file, when the session is file-backed. */
  sessionFile(): string | undefined;
  /** Names the SDK reports as active — the enforced allowlist result. */
  activeToolNames(): string[];
  /** Establishes a fresh subscription; every new Attempt subscribes again. */
  subscribe(listener: PiSessionListener): () => void;
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  compact(instructions?: string): Promise<void>;
  disposed(): boolean;
  dispose(): void;
}

function toToolDefinition(spec: PiToolSpec): ToolDefinition {
  return defineTool({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId, params, signal) => {
      const result = await spec.execute(params as Record<string, unknown>, { signal });
      const content = [{ type: 'text' as const, text: result.text }];
      return result.isError === true
        ? { content, details: undefined, isError: true }
        : { content, details: undefined };
    },
  });
}

/**
 * Builds Pi sessions for one Runner attempt at a time.
 *
 * A factory owns the model runtime; each attempt creates a session and its own
 * subscription, and resuming reuses the saved session file with a new factory.
 */
export class PiSessionFactory {
  private readonly runtime: ModelRuntime;
  private readonly config: PiRuntimeConfig;

  private constructor(config: PiRuntimeConfig, runtime: ModelRuntime) {
    this.config = config;
    this.runtime = runtime;
  }

  /**
   * Creates a factory.
   *
   * @throws PiRuntimeError when the catalog cannot be created at all.
   */
  static async create(config: PiRuntimeConfig): Promise<PiSessionFactory> {
    const runtime = await ModelRuntime.create({
      allowModelNetwork: config.allowModelNetwork ?? false,
      refreshOnCreate: false,
      modelsPath: config.modelsPath === undefined ? null : config.modelsPath,
      ...(config.useInMemoryCredentials === false
        ? {}
        : { credentials: new InMemoryCredentialStore() }),
    });
    return new PiSessionFactory(config, runtime);
  }

  /** Every model the offline catalog knows, for configuration and tests. */
  listModels(): Array<{ provider: string; id: string }> {
    return this.runtime.getModels().map((model) => ({ provider: model.provider, id: model.id }));
  }

  /** Model ids of one provider. */
  listModelsOf(provider: string): string[] {
    return this.listModels()
      .filter((model) => model.provider === provider)
      .map((model) => model.id);
  }

  /**
   * Creates one session.
   *
   * @throws PiRuntimeError `MODEL_UNAVAILABLE` when the configured pair is not
   * in the catalog — a role's configured model is never silently substituted.
   */
  async createSession(options: CreatePiSessionOptions): Promise<PiSessionHandle> {
    const model = this.runtime.getModel(options.provider, options.modelId);
    if (model === undefined) {
      throw new PiRuntimeError(
        'MODEL_UNAVAILABLE',
        `model ${options.provider}/${options.modelId} is not in the catalog`,
        { provider: options.provider, modelId: options.modelId },
      );
    }

    const settingsManager = options.settingsManager ?? SettingsManager.inMemory();
    const sessionManager =
      options.resumeFrom !== undefined
        ? SessionManager.open(options.resumeFrom, options.sessionDir, this.config.cwd)
        : options.sessionDir === undefined
          ? SessionManager.inMemory(this.config.cwd)
          : SessionManager.create(this.config.cwd, options.sessionDir);

    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      model,
      modelRuntime: this.runtime,
      settingsManager,
      sessionManager,
      resourceLoader: options.resourceLoader,
      customTools: (options.customTools ?? []).map(toToolDefinition),
      tools: [...options.toolNames],
      ...(options.thinkingLevel === undefined ? {} : { thinkingLevel: options.thinkingLevel }),
    });

    return new PiSessionHandleImpl(session, options.provider, options.modelId);
  }
}

class PiSessionHandleImpl implements PiSessionHandle {
  private readonly session: AgentSession;
  private isDisposed = false;

  constructor(session: AgentSession, provider: string, modelId: string) {
    this.session = session;
    this.provider = provider;
    this.modelId = modelId;
  }

  readonly provider: string;
  readonly modelId: string;

  get sessionId(): string {
    return this.session.sessionId;
  }

  sessionFile(): string | undefined {
    return this.session.sessionFile;
  }

  activeToolNames(): string[] {
    this.assertOpen();
    return this.session.getActiveToolNames();
  }

  subscribe(listener: PiSessionListener): () => void {
    this.assertOpen();
    const unsubscribe = this.session.subscribe((event) => {
      listener(toPiSessionEvent(event));
    });
    return () => {
      unsubscribe();
    };
  }

  async prompt(text: string): Promise<void> {
    this.assertOpen();
    await this.session.prompt(text, { expandPromptTemplates: false });
  }

  async steer(text: string): Promise<void> {
    this.assertOpen();
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    this.assertOpen();
    await this.session.followUp(text);
  }

  async abort(): Promise<void> {
    this.assertOpen();
    await this.session.abort();
  }

  async compact(instructions?: string): Promise<void> {
    this.assertOpen();
    await this.session.compact(instructions);
  }

  disposed(): boolean {
    return this.isDisposed;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.session.dispose();
  }

  private assertOpen(): void {
    if (this.isDisposed) {
      throw new PiRuntimeError('SESSION_CLOSED', 'the session handle is already disposed');
    }
  }
}
