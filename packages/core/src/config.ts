/**
 * Role configuration: layered resolution, validated writes, frozen snapshots.
 *
 * `rules/agents.md` §5 fixes the inheritance order — authorized Run parameters →
 * Project role override → global role Profile → global default model — and
 * `ARCHITECTURE.md` §5 fixes the files (`~/.agentdev/config.toml` and
 * `<git-root>/.agentdev/config.toml`). Two invariants are enforced here rather than
 * left to callers:
 *
 * - a named provider/model must exist, be enabled and actually support the requested
 *   reasoning level, and the effective context limit is
 *   `min(profile.contextLimit, model.contextWindow − maxOutputTokens − reserved)`
 *   (`rules/agents.md` §6);
 * - an active Run never observes a later configuration change, because it reads the
 *   frozen `config` snapshot, not the live document (AC-044).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CONTEXT_LIMITS,
  LIMITS,
  configDocumentSchema,
  configPatchSchema,
  profileSchema,
  providerInputSchema,
  type ConfigDocument,
  type ConfigPatch,
  type JsonObject,
  type ModelDescriptor,
  type OverridableLimitName,
  type PolicyConfig,
  type Profile,
  type ProviderConfig,
  type ProviderInput,
  type Role,
} from '@agentdev/contracts';
import { uuidv7 } from '@agentdev/storage';
import { parseToml, stringifyToml, TomlError, type TomlTable, type TomlValue } from './toml.js';
import type { SnapshotWriter } from './snapshots.js';

export const CONFIG_FILE = 'config.toml';
/** Project overrides live in the repository root, not in the state directory. */
export const PROJECT_CONFIG_RELATIVE_PATH = join('.agentdev', CONFIG_FILE);

export type ConfigScope = 'global' | 'project';

/** A configuration failure that must block instead of guessing. */
export class ConfigError extends Error {
  readonly code: 'CONFIG_INVALID' | 'PROVIDER_UNAVAILABLE';

  constructor(code: 'CONFIG_INVALID' | 'PROVIDER_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

/** A partial profile layer; `exactOptionalPropertyTypes` allows explicit undefined. */
export type ProfileLayer = { [K in keyof Profile]?: Profile[K] | undefined };

/**
 * The provider facts a frozen profile carries.
 *
 * A Run only needs where to call and which secret to use, so the snapshot stores
 * this projection rather than the whole `ProviderConfig` (R-09): `enabled` and the
 * model catalogue can change later without altering what the Run was frozen with.
 */
export interface FrozenProvider {
  readonly providerId: string;
  readonly type: ProviderConfig['type'];
  readonly baseUrl: string;
  readonly secretRef?: string;
}

/** Where one resolved profile field came from. */
export type ProfileSource = 'run' | 'project' | 'globalRole' | 'globalDefault';

export interface ProfileResolution {
  readonly profile: Profile;
  readonly sources: Readonly<Partial<Record<keyof Profile, ProfileSource>>>;
  readonly provider: FrozenProvider;
  readonly model: ModelDescriptor;
  /** `min(profile.contextLimit, window − maxOutput − reserved)` (`agents.md` §6). */
  readonly effectiveContextLimit: number;
  readonly revision: number;
}

export type ConfigResolution =
  | { readonly ok: true; readonly resolution: ProfileResolution }
  | { readonly ok: false; readonly code: ConfigError['code']; readonly reason: string };

const DEFAULT_POLICY: PolicyConfig = {
  permissionMode: 'workspace',
  /**
   * The sensitive-file tier defaults to `strict` (`T3-implementation.md` 附录 A.7).
   *
   * Only a human writes the other value, through the same `config.update` patch that
   * carries `permissionMode`; an agent has no entry, and `open` does not exist.
   */
  configPolicy: 'strict',
  l3Paths: [],
  l3Keywords: [],
  testCommands: [],
};

function emptyDocument(): ConfigDocument {
  return {
    version: 0,
    roleProfiles: {},
    providers: [],
    limits: {},
    policy: DEFAULT_POLICY,
  };
}

/** Structural Schema check, so this package never imports zod directly. */
interface ContractSchema<T> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: { readonly issues: readonly { path: PropertyKey[]; message: string }[] };
      };
}

function parseWith<T>(schema: ContractSchema<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError('CONFIG_INVALID', `${what} is invalid: ${issues}`);
  }
  return parsed.data;
}

/** TOML stores only the documented subset; JSON-ish arrays stay arrays. */
function toToml(document: ConfigDocument): TomlTable {
  const providerTables: TomlTable[] = document.providers.map((provider) => ({
    providerId: provider.providerId,
    type: provider.type,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    ...(provider.secretRef === undefined ? {} : { secretRef: provider.secretRef }),
    models: provider.models.map((model): TomlTable => ({
      id: model.id,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      reasoningLevels: [...model.reasoningLevels],
      vision: model.vision,
      ...(model.inputPricePerMTokens === undefined
        ? {}
        : { inputPricePerMTokens: model.inputPricePerMTokens }),
      ...(model.outputPricePerMTokens === undefined
        ? {}
        : { outputPricePerMTokens: model.outputPricePerMTokens }),
    })),
  }));
  const partialProfile = (profile: ProfileLayer | undefined): TomlTable => {
    if (profile === undefined) return {};
    const entries: Record<string, TomlValue> = {};
    for (const [key, value] of Object.entries(profile)) {
      if (value !== undefined) entries[key] = value;
    }
    return entries;
  };
  return {
    version: document.version,
    ...(document.defaultProfile === undefined
      ? {}
      : { defaultProfile: partialProfile(document.defaultProfile) }),
    roleProfiles: Object.fromEntries(
      Object.entries(document.roleProfiles).map(([role, profile]) => [
        role,
        partialProfile(profile),
      ]),
    ),
    limits: { ...document.limits } as TomlTable,
    policy: {
      permissionMode: document.policy.permissionMode,
      configPolicy: document.policy.configPolicy,
      l3Paths: [...document.policy.l3Paths],
      l3Keywords: [...document.policy.l3Keywords],
      testCommands: [...document.policy.testCommands],
    },
    providers: providerTables,
  };
}

/**
 * Backfills the sensitive-file tier on a document written before it existed.
 *
 * The schema keeps `configPolicy` optional so an older `config.toml` still loads; the
 * resolver then reads an absent value as `strict`. Normalising here rather than at every
 * read site means the effective policy a caller sees is always explicit — `strict` is
 * named, not inferred from `undefined` — and the file itself is never rewritten behind
 * the operator's back; the next `update` persists the value.
 */
function normalizePolicyTier(table: TomlTable): TomlTable {
  const policy = table['policy'];
  if (policy === undefined || typeof policy !== 'object' || policy === null) return table;
  const record = policy as Record<string, TomlValue>;
  if (typeof record['configPolicy'] === 'string') return table;
  return { ...table, policy: { ...record, configPolicy: DEFAULT_POLICY.configPolicy } };
}

/** Reads and validates one scope's file; a missing file is the empty document. */
function readDocument(file: string): ConfigDocument {
  if (!existsSync(file)) return emptyDocument();
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new ConfigError('CONFIG_INVALID', `cannot read ${file}: ${String(error)}`);
  }
  let table: TomlTable;
  try {
    table = parseToml(raw);
  } catch (error) {
    const detail = error instanceof TomlError ? error.message : String(error);
    throw new ConfigError('CONFIG_INVALID', `${file} is not readable TOML: ${detail}`);
  }
  return parseWith(configDocumentSchema, normalizePolicyTier(table), file);
}

function writeDocument(file: string, document: ConfigDocument): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, stringifyToml(toToml(document)), { mode: 0o600 });
  renameSync(temporary, file);
}

export interface ConfigStoreOptions {
  /** Directory holding the global `config.toml` (usually `~/.agentdev`). */
  readonly globalDir: string;
  /** Repository root whose `.agentdev/config.toml` overrides the global scope. */
  readonly projectRoot?: string;
  /** Snapshot writer used by `freeze`; absent means freezing is unavailable. */
  readonly snapshots?: SnapshotWriter;
}

/**
 * The two configuration scopes plus resolution and freezing.
 *
 * Writes validate against the shared Schema and the capability rules before
 * touching the file, so a bad document can never reach disk and a later resolve
 * never has to guess.
 */
export class ConfigStore {
  private globalDocument: ConfigDocument;
  private projectDocument: ConfigDocument;
  private readonly globalFile: string;
  private readonly projectFile: string | undefined;
  private readonly snapshots: SnapshotWriter | undefined;

  private constructor(
    options: ConfigStoreOptions,
    global: ConfigDocument,
    project: ConfigDocument,
  ) {
    this.globalFile = join(options.globalDir, CONFIG_FILE);
    this.projectFile =
      options.projectRoot === undefined
        ? undefined
        : join(options.projectRoot, PROJECT_CONFIG_RELATIVE_PATH);
    this.globalDocument = global;
    this.projectDocument = project;
    this.snapshots = options.snapshots;
  }

  static open(options: ConfigStoreOptions): ConfigStore {
    const globalFile = join(options.globalDir, CONFIG_FILE);
    const projectFile =
      options.projectRoot === undefined
        ? undefined
        : join(options.projectRoot, PROJECT_CONFIG_RELATIVE_PATH);
    return new ConfigStore(
      options,
      readDocument(globalFile),
      projectFile === undefined ? emptyDocument() : readDocument(projectFile),
    );
  }

  global(): ConfigDocument {
    return this.globalDocument;
  }

  project(): ConfigDocument {
    return this.projectDocument;
  }

  versionOf(scope: ConfigScope): number {
    return scope === 'global' ? this.globalDocument.version : this.projectDocument.version;
  }

  /**
   * Applies a documented patch and bumps the scope revision.
   *
   * The merged document is validated as a whole, so an update can never leave the
   * scope in a state that `resolve` would reject for a role it already served.
   */
  update(scope: ConfigScope, patch: ConfigPatch): { scope: ConfigScope; version: number } {
    const validated = parseWith(configPatchSchema, patch, 'config patch');
    const current = scope === 'global' ? this.globalDocument : this.projectDocument;
    // Overrides merge field by field inside one scope: a patch that names only
    // `reasoning` must not erase the remaining fields of that role's profile.
    const roleProfiles: Record<string, ProfileLayer> = { ...current.roleProfiles };
    for (const [role, override] of Object.entries(validated.roleOverrides ?? {})) {
      if (override === undefined) continue;
      const merged: ProfileLayer = { ...roleProfiles[role] };
      for (const [key, value] of Object.entries(override)) {
        if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
      }
      roleProfiles[role] = merged;
    }
    const next: ConfigDocument = {
      ...current,
      version: current.version + 1,
      roleProfiles,
      limits: { ...current.limits, ...(validated.limits ?? {}) },
      policy: {
        ...current.policy,
        ...(validated.permissionMode === undefined
          ? {}
          : { permissionMode: validated.permissionMode }),
        ...(validated.configPolicy === undefined ? {} : { configPolicy: validated.configPolicy }),
        ...(validated.l3Paths === undefined ? {} : { l3Paths: validated.l3Paths }),
        ...(validated.l3Keywords === undefined ? {} : { l3Keywords: validated.l3Keywords }),
        ...(validated.testCommands === undefined ? {} : { testCommands: validated.testCommands }),
      },
    };
    const checked = parseWith(configDocumentSchema, next, `${scope} config`);
    if (scope === 'global') {
      writeDocument(this.globalFile, checked);
      this.globalDocument = checked;
    } else {
      if (this.projectFile === undefined) {
        throw new ConfigError('CONFIG_INVALID', 'this store has no project scope');
      }
      writeDocument(this.projectFile, checked);
      this.projectDocument = checked;
    }
    return { scope, version: checked.version };
  }

  /** Registers or replaces a provider; the secret itself is never stored here. */
  upsertProvider(input: ProviderInput): {
    providerId: string;
    version: number;
    secretConfigured: boolean;
  } {
    const validated = parseWith(providerInputSchema, input, 'provider');
    // A provider id is a server-created UUIDv7 (`protocol.md` §5).
    const providerId = validated.providerId ?? uuidv7();
    const provider: ProviderConfig = { ...validated, providerId };
    const others = this.globalDocument.providers.filter((item) => item.providerId !== providerId);
    const next: ConfigDocument = {
      ...this.globalDocument,
      version: this.globalDocument.version + 1,
      providers: [...others, provider],
    };
    const checked = parseWith(configDocumentSchema, next, 'global config');
    writeDocument(this.globalFile, checked);
    this.globalDocument = checked;
    return {
      providerId,
      version: checked.version,
      secretConfigured: provider.secretRef !== undefined,
    };
  }

  provider(providerId: string): ProviderConfig | undefined {
    return this.globalDocument.providers.find((item) => item.providerId === providerId);
  }

  /** Effective limits with the documented defaults for anything not overridden. */
  effectiveLimits(): Record<OverridableLimitName, number> {
    const result = {} as Record<OverridableLimitName, number>;
    for (const [name, bounds] of Object.entries(LIMITS) as [
      OverridableLimitName,
      { default: number; fixed: boolean },
    ][]) {
      if (bounds.fixed) {
        result[name] = bounds.default;
        continue;
      }
      const override = this.projectDocument.limits[name] ?? this.globalDocument.limits[name];
      result[name] = override ?? bounds.default;
    }
    return result;
  }

  /**
   * Resolves one role's profile in the documented order.
   *
   * Returns a typed failure instead of a partial profile: a Work whose role has no
   * usable model fails with `PROVIDER_UNAVAILABLE` (`agents.md` §5) — the Run is
   * never silently downgraded. The Work-level `blocked(provider)` projection is
   * WP-05 (DC-42).
   */
  resolve(role: Role, runParams: ProfileLayer = {}): ConfigResolution {
    const layers: readonly (readonly [ProfileSource, ProfileLayer | undefined])[] = [
      ['run', runParams],
      ['project', this.projectDocument.roleProfiles[role]],
      ['globalRole', this.globalDocument.roleProfiles[role]],
      ['globalDefault', this.globalDocument.defaultProfile],
    ];
    const merged: Record<string, unknown> = {};
    const sources: Partial<Record<keyof Profile, ProfileSource>> = {};
    // Later layers are weaker, so apply the strongest last.
    for (const [source, layer] of [...layers].reverse()) {
      if (layer === undefined) continue;
      for (const [key, value] of Object.entries(layer)) {
        if (value === undefined) continue;
        merged[key] = value;
        sources[key as keyof Profile] = source;
      }
    }
    const profileParse = profileSchema.safeParse(merged);
    if (!profileParse.success) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `role ${role} has no complete model profile (${profileParse.error.issues
          .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
          .join('; ')})`,
      };
    }
    const profile = profileParse.data;
    const provider = this.provider(profile.providerId);
    if (provider === undefined) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `provider ${profile.providerId} is not configured`,
      };
    }
    if (!provider.enabled) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `provider ${provider.providerId} is disabled`,
      };
    }
    const model = provider.models.find((item) => item.id === profile.modelId);
    if (model === undefined) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `model ${profile.modelId} is not configured for ${provider.providerId}`,
      };
    }
    if (!model.reasoningLevels.includes(profile.reasoning)) {
      return {
        ok: false,
        code: 'CONFIG_INVALID',
        reason: `model ${model.id} does not support reasoning ${profile.reasoning} (${model.reasoningLevels.join('/') || 'none'})`,
      };
    }
    const effectiveContextLimit = Math.min(
      profile.contextLimit,
      model.contextWindow - model.maxOutputTokens - CONTEXT_LIMITS.reservedTokens,
    );
    if (effectiveContextLimit < CONTEXT_LIMITS.minTokens) {
      return {
        ok: false,
        code: 'CONFIG_INVALID',
        reason: `effective context ${effectiveContextLimit} is below the ${CONTEXT_LIMITS.minTokens} token floor`,
      };
    }
    const frozenProvider = frozenProviderOf(provider);
    return {
      ok: true,
      resolution: {
        profile,
        sources,
        provider: frozenProvider,
        model,
        effectiveContextLimit,
        revision: layerRevision(this.globalDocument, this.projectDocument),
      },
    };
  }

  /**
   * Freezes the resolved profile into a `config` snapshot (AC-044).
   *
   * Everything a Run needs is in the payload, so the Run never re-reads the live
   * document: editing configuration afterwards affects only new Runs.
   */
  freeze(
    role: Role,
    runParams: ProfileLayer = {},
  ): { snapshotId: string; resolution: ProfileResolution } {
    const resolution = this.resolve(role, runParams);
    if (!resolution.ok) throw new ConfigError(resolution.code, resolution.reason);
    if (this.snapshots === undefined) {
      throw new ConfigError('CONFIG_INVALID', 'this store was opened without a snapshot writer');
    }
    const { profile, sources, provider, model, effectiveContextLimit, revision } =
      resolution.resolution;
    const frozen = this.snapshots.freeze('config', {
      role,
      profile: {
        providerId: profile.providerId,
        modelId: profile.modelId,
        reasoning: profile.reasoning,
        skills: [...profile.skills],
        toolSubset: [...profile.toolSubset],
        contextLimit: profile.contextLimit,
        ...(profile.temperature === undefined ? {} : { temperature: profile.temperature }),
      },
      sources,
      provider: { ...provider },
      model: frozenModelPayload(model),
      effectiveContextLimit,
      revision,
    });
    return { snapshotId: frozen.hash, resolution: resolution.resolution };
  }

  /**
   * Reads a frozen profile back; used when a Run resumes after a restart.
   *
   * The frozen payload is self-contained (profile, provider projection, model,
   * effective limit, revision and per-field provenance), so a restart never has to
   * re-resolve against a configuration that may have moved on (AC-044/AC-082).
   */
  readFrozen(snapshotId: string): ProfileResolution | undefined {
    const snapshot = this.snapshots?.read(snapshotId);
    if (snapshot === undefined || snapshot.type !== 'config') return undefined;
    const payload = snapshot.payload as unknown as {
      profile: Profile;
      sources: Partial<Record<keyof Profile, ProfileSource>>;
      provider: FrozenProvider & { readonly secretRef?: string | null };
      model: ModelDescriptor;
      effectiveContextLimit: number;
      revision: number;
    };
    // Earlier versions froze a missing secretRef as `null`; normalize instead of
    // handing the gateway a value it cannot interpret (R18-02).
    const { secretRef, ...provider } = payload.provider;
    return {
      profile: payload.profile,
      sources: payload.sources ?? {},
      provider:
        secretRef === null || secretRef === undefined ? provider : { ...provider, secretRef },
      model: payload.model,
      effectiveContextLimit: payload.effectiveContextLimit,
      revision: payload.revision,
    };
  }
}

/**
 * The single frozen projection of a Provider inside the `config` snapshot.
 *
 * The projection (not the whole `ProviderConfig`) is what the snapshot stores
 * (R-09); `data.md` does not name this structure, so this comment deliberately
 * avoids a false document anchor (Review 19 adversarial).
 *
 * A Provider without a `secretRef` is a legitimate endpoint (local or
 * unauthenticated) and must not be frozen as `null`: the gateway reads only
 * `undefined` as "no secret", so a stored `null` failed every call (T-01/R18-01).
 */
function frozenProviderOf(provider: ProviderConfig): FrozenProvider {
  return {
    providerId: provider.providerId,
    type: provider.type,
    baseUrl: provider.baseUrl,
    ...(provider.secretRef === undefined ? {} : { secretRef: provider.secretRef }),
  };
}

/**
 * The frozen model descriptor, including the optional price fields.
 *
 * The prices are part of `ModelDescriptor` (`data.md` §3), so dropping them from the
 * frozen payload would make `resolve()` and `readFrozen()` disagree and lose the
 * basis for later cost accounting (R18 latent).
 */
function frozenModelPayload(model: ModelDescriptor): JsonObject {
  const payload: JsonObject = {
    id: model.id,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    reasoningLevels: [...model.reasoningLevels],
    vision: model.vision,
  };
  if (model.inputPricePerMTokens !== undefined) {
    payload['inputPricePerMTokens'] = model.inputPricePerMTokens;
  }
  if (model.outputPricePerMTokens !== undefined) {
    payload['outputPricePerMTokens'] = model.outputPricePerMTokens;
  }
  return payload;
}

/** Deprecated-file cleanup used by tests and the daemon's first start. */
export function removeConfigFile(file: string): void {
  rmSync(file, { force: true });
}

/**
 * One integer naming both scopes' revisions.
 *
 * `DispatchSpec.profileRevision` is a single non-negative integer, so the global
 * revision occupies the high digits and the Project revision the low ones: any
 * change in either scope changes the value, and the mapping stays injective for
 * fewer than a million Project writes.
 */
function layerRevision(global: ConfigDocument, project: ConfigDocument): number {
  return global.version * 1_000_000 + project.version;
}
