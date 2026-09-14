/**
 * The Model Gateway: everything a Run may ask a model, always through the frozen
 * configuration of that Run.
 *
 * `rules/agents.md` §5 forbids two things that are easy to get wrong, so both are
 * structural here rather than conventional: a running call never silently switches
 * provider or lowers the model, and a role with no usable model fails with
 * `PROVIDER_UNAVAILABLE` instead of silently falling back (the Work-level
 * `blocked(provider)` projection is WP-05, DC-42). `complete()` therefore takes a Run (not
 * a role or a model id) and reads the provider/model from the Run's frozen `config`
 * snapshot; there is no parameter through which a caller could choose another one.
 *
 * The transport is injected: WP-02 exercises the whole path with a stub, and the
 * real HTTP clients land in WP-10 with the Provider vertical run.
 */
import type { JsonValue, Role, Run } from '@agentdev/contracts';
import { ProtocolError } from './errors.js';
import type { ConfigError, ConfigStore, ProfileLayer, ProfileResolution } from './config.js';
import type { SnapshotWriter } from './snapshots.js';

/**
 * One tool call an OpenAI-compatible Provider asked for.
 *
 * The Pi session executes these through its registered tools; the gateway must carry them
 * end to end or a real model can never deliver `assessment_submit`/`stage_yield`
 * (WP-12 fix round 3, R3-1).
 */
export interface GatewayToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** One message the Provider sees; a `tool` message carries its call's result. */
export interface GatewayMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Set on an assistant message that asked for tools. */
  readonly toolCalls?: readonly GatewayToolCall[];
  /** Set on a `tool` message: the call it answers. */
  readonly toolCallId?: string;
}

/** One completion request, already resolved against a frozen profile. */
export interface GatewayRequest {
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoning: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly messages: readonly GatewayMessage[];
  readonly maxOutputTokens: number;
  /** Effective context limit for this Run (`min(profile, window − output − reserved)`). */
  readonly contextLimit: number;
  /**
   * The tool schemas the model may call, passed through untouched.
   *
   * The Pi session decides which tools exist; dropping them here would leave a real model
   * unable to call anything (WP-12 R3-2c, request direction of the tool round trip).
   */
  readonly tools?: readonly JsonValue[];
}

export type GatewayResponse =
  | {
      readonly ok: true;
      readonly text: string;
      readonly toolCalls?: readonly GatewayToolCall[];
      readonly inputTokens: number;
      readonly outputTokens: number;
    }
  | {
      readonly ok: false;
      readonly code: 'PROVIDER_UNAVAILABLE' | 'CONFIG_INVALID' | 'INTERNAL_ERROR';
      readonly retryable: boolean;
      readonly message: string;
    };

export interface GatewayTransport {
  complete(request: GatewayRequest): Promise<GatewayResponse>;
}

/** Resolves a `secretRef` to the secret value; the Secret store lands in WP-07. */
export interface SecretResolver {
  /**
   * Whether the ref is registered at all, without reading its value.
   *
   * Admission (`availability`) only needs "a credential exists"; the value is read when a
   * call is really made (WP-12 fix round 2). Optional so a test resolver may implement only
   * `resolve`, in which case the gateway falls back to resolving.
   */
  has?(secretRef: string): boolean;
  /**
   * The value, or `undefined` when the Run may not use it.
   *
   * `options.allowRef` is the ref the caller is resolving *for this call*; the real resolver
   * narrows the Run's secret access to exactly that one (frozen snapshot or role resolution),
   * never to a model-supplied `runParams` layer.
   */
  resolve(secretRef: string, options?: { readonly allowRef?: string }): string | undefined;
}

export interface ModelGatewayOptions {
  readonly config: ConfigStore;
  readonly snapshots: SnapshotWriter;
  readonly transport: GatewayTransport;
  readonly secrets?: SecretResolver;
}

/** The outcome of asking whether a role can run at all (admission decision). */
export type GatewayAvailability =
  | { readonly ok: true; readonly resolution: ProfileResolution }
  | { readonly ok: false; readonly code: ConfigError['code']; readonly reason: string };

export class ModelGateway {
  private readonly config: ConfigStore;
  private readonly snapshots: SnapshotWriter;
  private readonly transport: GatewayTransport;
  private readonly secrets: SecretResolver | undefined;

  constructor(options: ModelGatewayOptions) {
    this.config = options.config;
    this.snapshots = options.snapshots;
    this.transport = options.transport;
    this.secrets = options.secrets;
  }

  /**
   * Admission check for one role.
   *
   * A failure here is what keeps a Run queued with `PROVIDER_UNAVAILABLE`
   * (`agents.md` §5; the Work-level blocker is WP-05, DC-42) — the
   * caller must not queue a Run that cannot be served.
   */
  availability(role: Role, runParams: ProfileLayer = {}): GatewayAvailability {
    const resolution = this.config.resolve(role, runParams);
    if (!resolution.ok) return resolution;
    // A Provider whose `secretRef` cannot be resolved can never serve a call, so the
    // Run must not be queued in the first place (`agents.md` §5). Without an injected
    // resolver the secret store is unknown (WP-07, DC-31), so the check is skipped.
    const secretRef = resolution.resolution.provider.secretRef;
    if (secretRef !== undefined && this.secrets !== undefined) {
      // Registration only: reading the value here needed an authorization the admission
      // step has no Run for yet, which is exactly what made a real installation unable to
      // queue its first Chief Run (WP-12 fix round 2, G1).
      const registered =
        this.secrets.has !== undefined
          ? this.secrets.has(secretRef)
          : this.secrets.resolve(secretRef) !== undefined;
      if (!registered) {
        return {
          ok: false,
          code: 'CONFIG_INVALID',
          reason: `secret ${secretRef} is not available`,
        };
      }
    }
    return { ok: true, resolution: resolution.resolution };
  }

  /** Reads the frozen profile of a Run; missing means the snapshot is gone. */
  frozenProfileOf(run: Pick<Run, 'configSnapshotId' | 'role'>): ProfileResolution {
    const frozen = this.config.readFrozen(run.configSnapshotId);
    if (frozen === undefined) {
      throw new ProtocolError(
        'STALE_ARTIFACT',
        `config snapshot ${run.configSnapshotId} is missing`,
        {
          details: { runRole: run.role },
        },
      );
    }
    return frozen;
  }

  /**
   * Sends one completion for a Run.
   *
   * The model, reasoning level and context limit come from the Run's frozen
   * snapshot, so a later `config.update` cannot change an active Run (AC-044).
   */
  async complete(
    run: Pick<Run, 'configSnapshotId' | 'role'>,
    messages: GatewayRequest['messages'],
    tools?: readonly JsonValue[],
  ): Promise<GatewayResponse> {
    const frozen = this.frozenProfileOf(run);
    // `readFrozen` normalizes legacy `null` values, but a hand-written snapshot must
    // not be able to crash the gateway either (R18-02).
    const secretRef = frozen.provider.secretRef ?? undefined;
    // The ref must come from the Run's *frozen* snapshot; it is the only credential this
    // call may read, and the resolver enforces exactly that.
    const apiKey =
      secretRef === undefined
        ? undefined
        : this.secrets?.resolve(secretRef, { allowRef: secretRef });
    if (secretRef !== undefined && apiKey === undefined) {
      return {
        ok: false,
        code: 'CONFIG_INVALID',
        retryable: false,
        message: `secret ${secretRef} is not available`,
      };
    }
    return this.transport.complete({
      providerId: frozen.provider.providerId,
      modelId: frozen.model.id,
      reasoning: frozen.profile.reasoning,
      baseUrl: frozen.provider.baseUrl,
      ...(apiKey === undefined ? {} : { apiKey }),
      messages,
      // The completion budget is the model's configured `maxOutputTokens`; capping it at
      // a hard-coded 4096 silently truncated long answers and exhausted the whole budget
      // of a reasoning model before it emitted any final text (found by the WP-10 real
      // Provider drill).
      maxOutputTokens: frozen.model.maxOutputTokens,
      contextLimit: frozen.effectiveContextLimit,
      ...(tools === undefined || tools.length === 0 ? {} : { tools }),
    });
  }

  /**
   * The frozen configuration a Run must run under (`execution.md` §2).
   *
   * Exposed so the Core-side model gateway endpoint (WP-11) can enforce the frozen
   * provider/model pair without reaching into private state: the Runner may name a
   * model, but only this snapshot decides which one actually runs.
   */
  frozenFor(run: Pick<Run, 'configSnapshotId'>): ReturnType<ConfigStore['readFrozen']> {
    return this.config.readFrozen(run.configSnapshotId);
  }

  /**
   * Minimal request used by `provider.test` (`protocol.md` §5).
   *
   * It runs against the live configuration because no Run exists yet, and reports
   * the latency so "connected" is demonstrated rather than assumed.
   */
  async testConnection(
    providerId: string,
    modelId: string,
    now: () => number = () => Date.now(),
  ): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const provider = this.config.provider(providerId);
    const started = now();
    if (provider === undefined) {
      return { ok: false, latencyMs: 0, error: `provider ${providerId} is not configured` };
    }
    const model = provider.models.find((item) => item.id === modelId);
    if (model === undefined) {
      return { ok: false, latencyMs: 0, error: `model ${modelId} is not configured` };
    }
    // An installation-level probe of one named Provider: only that Provider's own ref is
    // allowed, and it comes from the live configuration rather than any caller input.
    const apiKey =
      provider.secretRef === undefined
        ? undefined
        : this.secrets?.resolve(provider.secretRef, { allowRef: provider.secretRef });
    if (provider.secretRef !== undefined && apiKey === undefined) {
      return { ok: false, latencyMs: 0, error: `secret ${provider.secretRef} is not available` };
    }
    const response = await this.transport.complete({
      providerId,
      modelId,
      reasoning: model.reasoningLevels[0] ?? 'off',
      baseUrl: provider.baseUrl,
      ...(apiKey === undefined ? {} : { apiKey }),
      messages: [{ role: 'user', content: 'ping' }],
      // A one-token probe makes a reasoning model spend its whole budget thinking and
      // answer nothing, so the connectivity check gets a small but real budget.
      maxOutputTokens: Math.min(64, model.maxOutputTokens),
      contextLimit: Math.min(4096, model.contextWindow),
    });
    const latencyMs = now() - started;
    return response.ok
      ? { ok: true, latencyMs }
      : { ok: false, latencyMs, error: `${response.code}: ${response.message}` };
  }

  /** Usage accounting hint for the budget layer (`reliability.md` §3). */
  static tokensOf(response: GatewayResponse): { input: number; output: number } {
    return response.ok
      ? { input: response.inputTokens, output: response.outputTokens }
      : { input: 0, output: 0 };
  }
}
