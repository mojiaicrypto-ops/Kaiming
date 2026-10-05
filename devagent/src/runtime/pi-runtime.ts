/**
 * Pi runtime factory (P2): builds the shared ModelRuntime for a config dir and creates one Pi
 * session per logical session with an explicit cwd, model, tool set and session-manager binding.
 *
 * Availability is checked against the SDK's own credential resolution, so an unusable model blocks
 * the input instead of silently falling back to another provider.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type InlineExtension,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { EffectiveConfig, ModelSelection, RuntimeDefaults } from './config.ts';

/** Input-correlation bookmark (design R4); never shown to the model. */
export const INPUT_MARKER_CUSTOM_TYPE = 'agentdev.input-marker';

export class ModelUnavailableError extends Error {
  readonly providerId: string;
  readonly modelId: string;

  constructor(selection: ModelSelection, detail: string) {
    super(`MODEL_UNAVAILABLE: ${selection.providerId}/${selection.modelId} (${detail})`);
    this.name = 'ModelUnavailableError';
    this.providerId = selection.providerId;
    this.modelId = selection.modelId;
  }
}

export interface PiSessionHandle {
  readonly session: AgentSession;
  readonly sessionManager: SessionManager;
  /** The exact Pi file this handle is bound to (empty until Pi persisted the first message). */
  piFile(): string | undefined;
  dispose(): void;
}

export interface CreateSessionOptions {
  readonly cwd: string;
  /** Resume this exact file; must exist (R4: check the specified file before opening). */
  readonly piFile?: string;
  readonly customTools?: ToolDefinition[];
  readonly extensionFactories?: InlineExtension[];
  readonly tools?: readonly string[];
  readonly thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
}

export class PiRuntimeFactory {
  private readonly defaults: RuntimeDefaults;
  private modelRuntime: ModelRuntime | undefined;

  constructor(defaults: RuntimeDefaults) {
    this.defaults = defaults;
  }

  async runtime(): Promise<ModelRuntime> {
    if (this.modelRuntime === undefined) {
      this.modelRuntime = await ModelRuntime.create({
        modelsPath: join(this.defaults.agentDir, 'models.json'),
        authPath: join(this.defaults.agentDir, 'auth.json'),
        allowModelNetwork: false,
      });
    }
    return this.modelRuntime;
  }

  /** True when the SDK reports the selection as usable (credential resolvable, model known). */
  async isAvailable(selection: ModelSelection): Promise<boolean> {
    const runtime = await this.runtime();
    const available = await runtime.getAvailable();
    return available.some(
      (model) => model.provider === selection.providerId && model.id === selection.modelId,
    );
  }

  async create(config: EffectiveConfig, options: CreateSessionOptions): Promise<PiSessionHandle> {
    const runtime = await this.runtime();
    const model = runtime.getModel(config.selection.providerId, config.selection.modelId);
    if (model === undefined) {
      throw new ModelUnavailableError(config.selection, 'model is not in the catalog');
    }
    const sessionDir = join(config.agentDir, 'sessions');
    const sessionManager =
      options.piFile !== undefined
        ? openExistingSession(options.piFile, sessionDir, options.cwd)
        : SessionManager.create(options.cwd, sessionDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: config.agentDir,
      extensionFactories: options.extensionFactories ?? [],
    });
    await resourceLoader.reload();
    const tools = [...(options.tools ?? config.tools)];
    const { session } = await createAgentSession({
      cwd: options.cwd,
      agentDir: config.agentDir,
      modelRuntime: runtime,
      model,
      resourceLoader,
      sessionManager,
      thinkingLevel: options.thinkingLevel ?? 'off',
      ...(tools.length > 0 ? { tools } : {}),
      ...(options.customTools ? { customTools: options.customTools } : {}),
    });
    return {
      session,
      sessionManager,
      piFile: () => sessionManager.getSessionFile(),
      dispose: () => session.dispose(),
    };
  }
}

export class HistoryUnavailableError extends Error {
  readonly piFile: string;

  constructor(piFile: string) {
    super(`HISTORY_UNAVAILABLE: ${piFile} does not exist`);
    this.name = 'HistoryUnavailableError';
    this.piFile = piFile;
  }
}

function openExistingSession(piFile: string, sessionDir: string, cwd: string): SessionManager {
  if (!existsSync(piFile)) {
    throw new HistoryUnavailableError(piFile);
  }
  return SessionManager.open(piFile, sessionDir, cwd);
}