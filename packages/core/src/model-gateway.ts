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
import type { Role, Run } from '@agentdev/contracts';
import { ProtocolError } from './errors.js';
import type { ConfigError, ConfigStore, ProfileLayer, ProfileResolution } from './config.js';
import type { SnapshotWriter } from './snapshots.js';

/** One completion request, already resolved against a frozen profile. */
export interface GatewayRequest {
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoning: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly messages: readonly {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
  }[];
  readonly maxOutputTokens: number;
  /** Effective context limit for this Run (`min(profile, window − output − reserved)`). */
  readonly contextLimit: number;
}

export type GatewayResponse =
  | {
      readonly ok: true;
      readonly text: string;
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
  resolve(secretRef: string): string | undefined;
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
      if (this.secrets.resolve(secretRef) === undefined) {
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
  ): Promise<GatewayResponse> {
    const frozen = this.frozenProfileOf(run);
    // `readFrozen` normalizes legacy `null` values, but a hand-written snapshot must
    // not be able to crash the gateway either (R18-02).
    const secretRef = frozen.provider.secretRef ?? undefined;
    const apiKey = secretRef === undefined ? undefined : this.secrets?.resolve(secretRef);
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
    });
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
    const apiKey =
      provider.secretRef === undefined ? undefined : this.secrets?.resolve(provider.secretRef);
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
