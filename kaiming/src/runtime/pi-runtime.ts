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
import type { EffectiveConfig, ModelSelection, RuntimeDefaults, ThinkingLevel } from './config.ts';
import { supportedThinkingLevels } from './thinking-levels.ts';

/** Input-correlation bookmark (design R4); never shown to the model. */
export const INPUT_MARKER_CUSTOM_TYPE = 'kaiming.input-marker';

export interface CatalogEntry {
  readonly providerId: string;
  readonly modelId: string;
  /** The catalogue's display name ("Anthropic: Claude Fable 5"), so the picker reads as a list of models. */
  readonly name: string;
  /** The `api` this model speaks; an endpoint id that resolves to it uses that protocol. */
  readonly api: string;
  readonly reasoning: boolean;
  /** Exactly what Pi accepts for it, so the picker lists no level a run would clamp away. */
  readonly thinkingLevels: readonly string[];
  readonly contextWindow: number;
  readonly maxTokens: number;
}

/** What a catalogue model declares; an endpoint id adopting it inherits exactly this, nothing invented. */
export interface ModelFacts {
  readonly providerId: string;
  readonly modelId: string;
  readonly api: string;
  readonly reasoning: boolean;
  readonly thinkingLevelMap?: Readonly<Record<string, string | null>>;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly input?: readonly string[];
}

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
  readonly thinkingLevel?: ThinkingLevel;
  /** Text appended to Pi's own instructions (role bodies); never replaces them. */
  readonly appendSystemPrompt?: readonly string[];
}

export class PiRuntimeFactory {
  private readonly defaults: RuntimeDefaults;
  private modelRuntime: ModelRuntime | undefined;
  /** The in-flight creation: two sessions starting together must share one runtime. */
  private runtimePromise: Promise<ModelRuntime> | undefined;

  constructor(defaults: RuntimeDefaults) {
    this.defaults = defaults;
  }

  async runtime(): Promise<ModelRuntime> {
    if (this.modelRuntime !== undefined) return this.modelRuntime;
    if (this.runtimePromise === undefined) {
      this.runtimePromise = ModelRuntime.create({
        modelsPath: join(this.defaults.agentDir, 'models.json'),
        authPath: join(this.defaults.agentDir, 'auth.json'),
        allowModelNetwork: false,
      }).then((runtime) => {
        this.modelRuntime = runtime;
        return runtime;
      });
    }
    try {
      return await this.runtimePromise;
    } catch (error) {
      // A failed initialization must be retryable; do not cache a rejected promise forever.
      this.runtimePromise = undefined;
      throw error;
    }
  }

  /**
   * Re-read the credential/catalog files after they changed (R5: a saved configuration must reach the
   * next queued input). The SDK keeps one snapshot per runtime, so a provider written after the
   * factory was first used is invisible until this runs - and config.test must not probe a state no
   * run can see.
   */
  async reload(): Promise<void> {
    const runtime = await this.runtime();
    await runtime.refresh({ allowNetwork: false });
  }

  /** True when the SDK reports the selection as usable (credential resolvable, model known). */
  async isAvailable(selection: ModelSelection): Promise<boolean> {
    const runtime = await this.runtime();
    const available = await runtime.getAvailable();
    return available.some(
      (model) => model.provider === selection.providerId && model.id === selection.modelId,
    );
  }

  /**
   * The model provider's own search endpoint and credential, when it has one.
   *
   * `web_search` prefers this over a keyless scraper: the user already configured this key, so a
   * lookup costs them nothing new. It is read through the same runtime a run uses, so a credential
   * added later is visible on the next input without a restart.
   */
  async searchKey(selection: ModelSelection): Promise<{ readonly baseUrl: string; readonly apiKey: string } | undefined> {
    if (selection.providerId !== 'deepseek') {
      return undefined;
    }
    const runtime = await this.runtime();
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (model === undefined) {
      return undefined;
    }
    const resolved = await runtime.getAuth(model);
    const apiKey = resolved?.auth.apiKey;
    if (typeof apiKey !== 'string' || apiKey === '') {
      return undefined;
    }
    return { baseUrl: resolved?.auth.baseUrl ?? 'https://api.deepseek.com', apiKey };
  }

  /**
   * A real trial connection (R5/config.test): refresh the catalog over the network with a bounded
   * timeout and report whether the selection is usable. Nothing is saved and no session is created.
   */
  async probe(selection: ModelSelection): Promise<{ available: boolean; detail: string }> {
    try {
      // The same runtime a run uses (refreshed), so the answer describes the real state, not a
      // second opinion from a runtime only this probe ever sees.
      const runtime = await this.runtime();
      await runtime.refresh({ allowNetwork: true });
      const available = await runtime.getAvailable();
      const known = runtime.getModel(selection.providerId, selection.modelId);
      if (known === undefined) {
        return { available: false, detail: `${selection.providerId}/${selection.modelId} is not in the catalog` };
      }
      if (!available.some((model) => model.provider === selection.providerId && model.id === selection.modelId)) {
        return { available: false, detail: `${selection.providerId}/${selection.modelId} has no usable credential` };
      }
      // The catalog saying "usable" is not the same as the provider answering: ask it for one token,
      // through the same SDK path a run uses, and report what actually came back.
      const answered = runtime.completeSimple(
        known,
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }], timestamp: Date.now() }] },
        { maxTokens: 1 },
      );
      const deadline = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('the provider did not answer within 8000ms')), 8000);
      });
      const message = await Promise.race([answered, deadline]);
      if (message.stopReason === 'error' || (message.errorMessage ?? '') !== '') {
        // A failed request comes back as a message, not as a rejection: the error text is the answer.
        return {
          available: false,
          detail: message.errorMessage ?? `the provider refused the request (${message.stopReason})`,
        };
      }
      return { available: true, detail: `${selection.providerId}/${selection.modelId} answered a one-token request` };
    } catch (error) {
      // The upstream error is the useful part: authentication, DNS, timeout - say it, do not hide it.
      return { available: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * The thinking levels Pi offers for one model (`getAvailableThinkingLevels` on a session uses the
   * same rule). The settings page lists exactly these, so it can never offer a level the run would
   * clamp away. An unknown model gets `['off']`: it is not a choice, it is the absence of one.
   */
  /**
   * The catalogue facts for one model: what a gateway alias has to borrow to behave like the model it
   * really is. `undefined` means the catalogue does not know it, which is different from "it has no
   * capabilities" — the caller must not invent defaults from it.
   */
  async facts(selection: ModelSelection): Promise<ModelFacts | undefined> {
    const runtime = await this.runtime();
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (model === undefined) return undefined;
    return {
      providerId: selection.providerId,
      modelId: selection.modelId,
      api: model.api,
      reasoning: model.reasoning === true,
      ...(model.thinkingLevelMap !== undefined ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(Array.isArray(model.input) ? { input: [...model.input] } : {}),
    };
  }

  /**
   * Every chat model the catalogue knows, for the picker. Name, protocol and accepted levels travel
   * with it: a model the user picks is fully described, so the editor never asks a second question
   * ("does it reason?") whose answer the catalogue already holds.
   */
  async catalog(): Promise<readonly CatalogEntry[]> {
    const runtime = await this.runtime();
    return runtime
      .getModels()
      .map((model) => ({
        providerId: model.provider,
        modelId: model.id,
        name: model.name,
        api: model.api,
        reasoning: model.reasoning === true,
        thinkingLevels: supportedThinkingLevels(model),
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      }))
      .sort((a, b) => a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));
  }

  async levelsFor(selection: ModelSelection): Promise<readonly string[]> {
    const runtime = await this.runtime();
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (model === undefined) return ['off'];
    return supportedThinkingLevels(model);
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
      ...(options.appendSystemPrompt !== undefined && options.appendSystemPrompt.length > 0
        ? { appendSystemPrompt: [...options.appendSystemPrompt] }
        : {}),
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