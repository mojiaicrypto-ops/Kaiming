/**
 * The method handlers this server ships (R1's table). Later slices add the project/session/task/
 * requirement/interaction methods; this file stays the one place that binds a public method name to
 * its handler, so the contract's table and the code cannot drift apart silently.
 */
import { RpcError, type RpcRouter } from './rpc.ts';
import { redactEffectiveConfig, resolveStoredConfig, type RuntimeDefaults } from '../runtime/config.ts';
import { credentialRefFor, writeProvider } from '../runtime/provider-store.ts';
import { PiRuntimeFactory, type ModelFacts } from '../runtime/pi-runtime.ts';
import type { Store } from '../store/store.ts';

export interface CoreMethodsOptions {
  readonly store: Store;
  /** The server-level default configuration this installation runs with. */
  readonly server: RuntimeDefaults;
  /** Per-role model overrides configured on this installation. */
  readonly roleOverrides?: Readonly<Record<string, { providerId: string; modelId: string }>>;
  /**
   * Made visible to the runtime after a provider is written, so the next claimed input can use what
   * the caller just saved instead of waiting for a restart (R5).
   */
  readonly reloadRuntime?: () => Promise<void>;
  /**
   * The runner's own runtime probe: `config.test` must describe the state a run will see, not a
   * second opinion from a runtime only the probe ever built.
   */
  readonly probeModel?: (selection: { providerId: string; modelId: string }) => Promise<{
    available: boolean;
    detail: string;
  }>;
  /**
   * The thinking levels Pi offers for one model. The page lists what a run would accept instead of
   * guessing from the model id; a missing runtime answers with the one level that always exists.
   */
  readonly modelLevels?: (selection: { providerId: string; modelId: string }) => Promise<readonly string[]>;
  /** The catalogue facts of one model; `undefined` when the catalogue does not know it. */
  readonly modelFacts?: (selection: { providerId: string; modelId: string }) => Promise<ModelFacts | undefined>;
  /**
   * Every chat model the catalogue knows, for the model picker. Each entry carries the protocol it
   * really speaks and the levels Pi accepts for it, so choosing a model is one control instead of an
   * alias plus a checkbox nobody can verify.
   */
  readonly catalogModels?: () => Promise<readonly CatalogModelFacts[]>;
}

/** One catalogue model as the picker shows it. */
export interface CatalogModelFacts {
  readonly providerId: string;
  readonly modelId: string;
  readonly name: string;
  /** The `api` Pi would use for this model (`anthropic-messages`, `openai-completions`, …). */
  readonly api: string;
  readonly reasoning: boolean;
  /** Exactly `supportedThinkingLevels`: the picker never invents a level. */
  readonly thinkingLevels: readonly string[];
  readonly contextWindow: number;
  readonly maxTokens: number;
}

/**
 * The protocols this workbench offers. Pi knows more, but these three cover the endpoints the product
 * supports, and a closed list turns a typo into a clear refusal instead of a provider that never
 * loads. Values are Pi's own `api` identifiers in `models.json`.
 */
export const PROVIDER_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;
export type ProviderApi = (typeof PROVIDER_APIS)[number];

/**
 * The effective configuration (R5): the role override wins over the project override, which wins over
 * the server default. Keys never travel - a provider is described by where its credential lives.
 */
async function readConfig(options: CoreMethodsOptions, roleId: string, projectId: string | undefined): Promise<unknown> {
  const effective = resolveStoredConfig({
    roleId,
    ...(projectId !== undefined ? { projectId } : {}),
    server: options.server,
    store: options.store,
    ...(options.roleOverrides !== undefined ? { roleOverrides: options.roleOverrides } : {}),
  });
  // The stored layers, so a settings row can show what IT holds instead of guessing from the
  // effective value: an inherited model is not a saved choice, and a project default is invisible
  // while a narrower layer wins.
  const layer = (
    row: { providerId: string; modelId: string; thinkingLevel: string; revision: number } | undefined,
  ): { providerId: string; modelId: string; thinkingLevel: string; revision: number } | null =>
    row === undefined
      ? null
      : {
          providerId: row.providerId,
          modelId: row.modelId,
          thinkingLevel: row.thinkingLevel,
          revision: row.revision,
        };
  // One read per (provider, model) pair actually assigned, not per role: the page shows a list per
  // model and the same model appears in several rows.
  const levels = new Map<string, readonly string[]>();
  const levelsOf = async (selection: { providerId: string; modelId: string }): Promise<readonly string[]> => {
    const key = `${selection.providerId}\u0000${selection.modelId}`;
    const cached = levels.get(key);
    if (cached !== undefined) return cached;
    const read = await (options.modelLevels?.(selection) ?? Promise.resolve(['off'])).catch(() => ['off']);
    levels.set(key, read);
    return read;
  };
  const effectiveLevels = await levelsOf(effective.selection);
  return {
    roleId,
    ...(projectId !== undefined ? { projectId } : {}),
    overrides: {
      role: layer(options.store.getModelOverride('role', roleId)),
      project: projectId === undefined ? null : layer(options.store.getModelOverride('project', projectId)),
      projectRole:
        projectId === undefined ? null : layer(options.store.getModelOverride('project', projectId, roleId)),
    },
    // The levels for the model this configuration resolves to, so a row can say what will really run.
    effective: { ...redactEffectiveConfig(effective), thinkingLevels: effectiveLevels },
    providers: await Promise.all(
      options.store.listProviders().map(async (provider) => {
        const models = JSON.parse(provider.models) as Array<{
          id: string;
          name: string;
          upstream?: { providerId: string; modelId: string; api?: string };
          reasoning?: boolean;
          baseModel?: { providerId: string; modelId: string };
          thinkingLevelMap?: Readonly<Record<string, string | null>>;
          contextWindow?: number;
          maxTokens?: number;
        }>;
        return {
          providerId: provider.providerId,
          // The label the user sees; the id stays the technical identity everything else refers to.
          name: provider.name ?? provider.providerId,
          baseUrl: provider.baseUrl,
          api: provider.api,
          // Pi decides the choices; the page renders them rather than keeping a second list.
          models: await Promise.all(
            models.map(async (model) => ({
              ...model,
              thinkingLevels: await levelsOf({ providerId: provider.providerId, modelId: model.id }),
            })),
          ),
          credentialRef: provider.credentialRef,
          revision: provider.revision,
          // Availability, never the key: the caller can tell configured from usable.
          credentialConfigured: provider.credentialRef !== null,
        };
      }),
    ),
    // Secrets are referenced, never echoed: only availability travels.
    credentials: { mode: 'reference', inResponse: false },
  };
}

export function registerCoreMethods(router: RpcRouter, options: CoreMethodsOptions): void {
  router.register('config.get', {
    write: false,
    run: async (params): Promise<unknown> => {
      const roleId = typeof params['roleId'] === 'string' && params['roleId'] !== '' ? params['roleId'] : 'chief';
      const projectId = typeof params['projectId'] === 'string' && params['projectId'] !== '' ? params['projectId'] : undefined;
      if (projectId !== undefined && options.store.getProject(projectId) === undefined) {
        throw new RpcError('NOT_FOUND', `project ${projectId} does not exist`, { projectId });
      }
      return await readConfig(options, roleId, projectId);
    },
  });

  // The model picker needs the catalogue. It is its own read because the list is long and only the
  // provider editor needs it: folding it into config.get would ship it on every settings row.
  router.register('config.catalog', {
    write: false,
    run: async (): Promise<unknown> => {
      const models = (await options.catalogModels?.()) ?? [];
      const byProvider = new Map<string, Array<Omit<CatalogModelFacts, 'providerId'>>>();
      for (const model of models) {
        const list = byProvider.get(model.providerId) ?? [];
        list.push({
          modelId: model.modelId,
          name: model.name,
          api: model.api,
          reasoning: model.reasoning,
          thinkingLevels: model.thinkingLevels,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        });
        byProvider.set(model.providerId, list);
      }
      return {
        providers: [...byProvider].map(([providerId, list]) => ({ providerId, models: list })),
        count: models.length,
      };
    },
  });

  router.register('config.test', {
    write: false,
    run: async (params): Promise<unknown> => {
      const roleId = typeof params['roleId'] === 'string' && params['roleId'] !== '' ? params['roleId'] : 'chief';
      const projectId =
        typeof params['projectId'] === 'string' && params['projectId'] !== '' ? params['projectId'] : undefined;
      if (projectId !== undefined && options.store.getProject(projectId) === undefined) {
        throw new RpcError('NOT_FOUND', `project ${projectId} does not exist`, { projectId });
      }
      // An explicit selection is tried as given; otherwise the effective configuration is probed.
      const explicit =
        typeof params['providerId'] === 'string' && typeof params['modelId'] === 'string'
          ? { providerId: params['providerId'], modelId: params['modelId'] }
          : undefined;
      const effective = resolveStoredConfig({
        roleId,
        ...(projectId !== undefined ? { projectId } : {}),
        server: options.server,
        store: options.store,
        ...(options.roleOverrides !== undefined ? { roleOverrides: options.roleOverrides } : {}),
      });
      const selection = explicit ?? effective.selection;
      await options.reloadRuntime?.().catch(() => undefined);
      const probed =
        options.probeModel === undefined
          ? await (async () => {
              // No shared runtime was injected (tests assemble their own): build one for this probe.
              const factory = new PiRuntimeFactory(options.server);
              await factory.reload().catch(() => undefined);
              return factory.probe(selection);
            })()
          : await options.probeModel(selection);
      return {
        roleId,
        ...(projectId !== undefined ? { projectId } : {}),
        probed: { providerId: selection.providerId, modelId: selection.modelId },
        source: explicit !== undefined ? 'explicit' : effective.source,
        available: probed.available,
        detail: probed.detail,
        // A probe reports reachability; it never echoes what the credential is.
        credentials: { mode: 'reference', inResponse: false },
      };
    },
  });

  router.register('config.save', {
    write: true,
    run: async (params): Promise<unknown> => {
      const expectedRevision =
        params['expectedRevision'] === null || params['expectedRevision'] === undefined
          ? null
          : Number(params['expectedRevision']);
      if (expectedRevision !== null && !Number.isInteger(expectedRevision)) {
        throw new RpcError('INVALID_ARGUMENT', 'expectedRevision must be an integer or null', {
          expectedRevision: params['expectedRevision'],
        });
      }
      const roleId = typeof params['roleId'] === 'string' && params['roleId'] !== '' ? params['roleId'] : undefined;
      const projectId =
        typeof params['projectId'] === 'string' && params['projectId'] !== '' ? params['projectId'] : undefined;
      const value = params['value'];
      if (typeof value !== 'object' || value === null) {
        throw new RpcError('INVALID_ARGUMENT', 'value must be an object', { value });
      }
      const record = value as Record<string, unknown>;
      if (record['kind'] === 'provider') {
        return saveProvider(options, record, expectedRevision);
      }
      if (record['kind'] === 'model') {
        return await saveModelAssignment(
          options,
          record,
          {
            ...(roleId !== undefined ? { roleId } : {}),
            ...(projectId !== undefined ? { projectId } : {}),
          },
          expectedRevision,
        );
      }
      throw new RpcError('INVALID_ARGUMENT', "value.kind must be 'provider' or 'model'", {
        kind: record['kind'],
      });
    },
  });

  // Removing a layer is a different intent from setting a value: the page offers "default" and the
  // server must actually drop the row, otherwise the control lies. Idempotent by design - clearing a
  // layer that is not set is a no-op, not an error.
  router.register('config.clear', {
    write: true,
    run: (params): unknown => {
      const roleId = typeof params['roleId'] === 'string' && params['roleId'] !== '' ? params['roleId'] : undefined;
      const projectId =
        typeof params['projectId'] === 'string' && params['projectId'] !== '' ? params['projectId'] : undefined;
      if (roleId === undefined && projectId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'roleId, projectId, or both must name the override', {});
      }
      if (projectId !== undefined && options.store.getProject(projectId) === undefined) {
        throw new RpcError('NOT_FOUND', `project ${projectId} does not exist`, { projectId });
      }
      const scope = projectId === undefined ? 'role' : 'project';
      const scopeId = (projectId ?? roleId) as string;
      const cleared = options.store.deleteModelOverride(
        scope,
        scopeId,
        projectId === undefined ? '' : (roleId ?? ''),
      );
      return { scope, scopeId, roleId: projectId === undefined ? '' : (roleId ?? ''), cleared };
    },
  });
}

/** Save a provider definition: the key goes to the private store, the database keeps its reference. */
async function saveProvider(
  options: CoreMethodsOptions,
  value: Record<string, unknown>,
  expectedRevision: number | null,
): Promise<unknown> {
  const providerId = typeof value['providerId'] === 'string' ? value['providerId'] : '';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(providerId)) {
    throw new RpcError('INVALID_ARGUMENT', 'providerId has an invalid form', { providerId });
  }
  const baseUrl = typeof value['baseUrl'] === 'string' ? value['baseUrl'] : '';
  if (baseUrl === '') {
    throw new RpcError('INVALID_ARGUMENT', 'baseUrl is required', { providerId });
  }
  // The protocol is chosen, never inferred: Pi falls back to the catalog entry of a same-named
  // builtin provider, or refuses to load the model at all, and neither failure is visible here.
  const apiRaw = typeof value['api'] === 'string' ? value['api'] : '';
  const api = PROVIDER_APIS.find((known) => known === apiRaw);
  if (api === undefined) {
    throw new RpcError('INVALID_ARGUMENT', `api must be one of ${PROVIDER_APIS.join(', ')}`, {
      api: apiRaw,
      providerId,
    });
  }
  const nameRaw = typeof value['name'] === 'string' ? value['name'].trim() : '';
  if (nameRaw.length > 80) {
    throw new RpcError('INVALID_ARGUMENT', 'a provider name is at most 80 characters', { providerId });
  }
  const name = nameRaw === '' ? undefined : nameRaw;
  const modelsRaw = Array.isArray(value['models']) ? value['models'] : undefined;
  if (modelsRaw === undefined || modelsRaw.length === 0) {
    throw new RpcError('INVALID_ARGUMENT', 'models must be a non-empty list of { id, name }', { providerId });
  }
  /*
   * Two ways to declare a model, one of them now the ordinary one:
   *
   * - `catalog` names a catalogue model outright (the picker). The id defaults to the catalogue's own
   *   name, and reasoning, the thinking-level map, both limits and the input modalities are copied
   *   from it — there is nothing to tick by hand, so nothing can be ticked wrong.
   * - `baseModel` keeps working for an id a gateway invented ("group/auto-…"): same borrowed facts,
   *   but the id stays the endpoint's own.
   *
   * Either way the catalogue is the only source of the facts; the operator only names the model.
   */
  const models: Array<{
    id: string;
    name: string;
    upstream?: { providerId: string; modelId: string; api: string };
    reasoning: boolean;
    baseModel?: { providerId: string; modelId: string };
    contextWindow?: number;
    maxTokens?: number;
    thinkingLevelMap?: Readonly<Record<string, string | null>>;
    input?: readonly string[];
  }> = [];
  for (const entry of modelsRaw) {
    const model = entry as Record<string, unknown>;
    const chosen = await resolveAlias(options, model['catalog'] ?? undefined, providerId);
    const chosenId = typeof model['id'] === 'string' ? model['id'].trim() : '';
    const id = chosenId !== '' ? chosenId : (chosen?.modelId ?? '');
    if (id === '') {
      throw new RpcError('INVALID_ARGUMENT', 'every model needs an id', { providerId });
    }
    const named = await resolveAlias(options, model['baseModel'], providerId);
    if (chosen !== undefined && named !== undefined) {
      throw new RpcError('INVALID_ARGUMENT', 'name a model with catalog or baseModel, not both', {
        providerId,
        id,
      });
    }
    const facts = chosen ?? named;
    models.push({
      id,
      name: typeof model['name'] === 'string' && model['name'] !== '' ? model['name'] : id,
      // Pi routes an id that resolves to a catalogue model through that model's own protocol. Naming
      // the model through `baseModel` gets the same treatment: borrowing the facts while keeping the
      // endpoint's wire format would describe a model this id is not.
      ...(facts !== undefined
        ? { upstream: { providerId: facts.providerId, modelId: facts.modelId, api: facts.api ?? api } }
        : {}),
      // The catalogue knows nothing about an endpoint the operator typed in, so either the model is
      // resolved (facts borrowed from it) or the operator declares reasoning itself.
      reasoning: facts?.reasoning === true || model['reasoning'] === true,
      ...(facts !== undefined ? { baseModel: { providerId: facts.providerId, modelId: facts.modelId } } : {}),
      ...(facts?.contextWindow !== undefined ? { contextWindow: facts.contextWindow } : {}),
      ...(facts?.maxTokens !== undefined ? { maxTokens: facts.maxTokens } : {}),
      ...(facts?.thinkingLevelMap !== undefined ? { thinkingLevelMap: facts.thinkingLevelMap } : {}),
      ...(facts?.input !== undefined ? { input: facts.input } : {}),
    });
  }
  const apiKey = typeof value['apiKey'] === 'string' && value['apiKey'] !== '' ? value['apiKey'] : undefined;
  const written = writeProvider(options.server.agentDir, {
    providerId,
    baseUrl,
    api,
    ...(name !== undefined ? { name } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    // `models.json` needs the vendor each id really is; the database row only records the identity the
    // configuration page shows back, so the two are mapped separately instead of one blob twice.
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.upstream !== undefined ? { upstream: model.upstream } : {}),
      ...(model.reasoning ? { reasoning: true } : {}),
      ...(model.thinkingLevelMap !== undefined ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
      ...(model.input !== undefined ? { input: model.input } : {}),
    })),
  });
  if (!written.ok) {
    throw new RpcError('INVALID_ARGUMENT', written.message, { providerId });
  }
  const provider = options.store.saveProvider({
    providerId,
    baseUrl,
    api,
    ...(name !== undefined ? { name } : {}),
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.upstream !== undefined ? { upstream: `${model.upstream.providerId}/${model.upstream.modelId}` } : {}),
      reasoning: model.reasoning,
      ...(model.thinkingLevelMap !== undefined ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
    })),
    credentialRef: written.credentialRef,
    expectedRevision,
  });
  // The runner's runtime caches one snapshot: without this the next claimed input would block until
  // the process restarted, even though the configuration was saved successfully (R5). Awaiting it
  // means the answer describes a state a run can already use.
  await options.reloadRuntime?.();
  return {
    providerId: provider.providerId,
    name: provider.name ?? provider.providerId,
    revision: provider.revision,
    credentialRef: provider.credentialRef,
    models,
    // The key itself is never part of the answer.
    credentials: { mode: 'reference', inResponse: false },
  };
}

/**
 * The catalogue model an alias stands for.
 *
 * A gateway names models its own way, so the operator says which real model an id is. The identity is
 * resolved against the catalogue and never guessed: an unknown or ambiguous name is refused with the
 * candidates, because borrowing the wrong model's context window silently changes when sessions
 * compact.
 */
async function resolveAlias(
  options: CoreMethodsOptions,
  raw: unknown,
  editingProviderId: string,
): Promise<ModelFacts | undefined> {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const asked: { kind: 'pair'; providerId: string; modelId: string } | { kind: 'bare'; name: string } | undefined =
    typeof raw === 'string'
      ? raw.includes('/')
        ? {
            kind: 'pair',
            providerId: raw.slice(0, raw.indexOf('/')),
            modelId: raw.slice(raw.indexOf('/') + 1),
          }
        : { kind: 'bare', name: raw }
      : (() => {
          const record = raw as Record<string, unknown>;
          const providerId = typeof record['providerId'] === 'string' ? record['providerId'] : '';
          const modelId = typeof record['modelId'] === 'string' ? record['modelId'] : '';
          return providerId !== '' && modelId !== '' ? { kind: 'pair', providerId, modelId } : undefined;
        })();
  if (asked === undefined) {
    throw new RpcError('INVALID_ARGUMENT', 'baseModel must be "provider/model" or {providerId, modelId}', {
      baseModel: raw,
    });
  }
  if (options.modelFacts === undefined) return undefined;
  // The installation's own entries live in the same catalogue (models.json is the catalogue's input),
  // so an alias must not point back at the provider being saved: that would record the fallback as if
  // it were the real model's facts, which is the mistake this mapping exists to prevent.
  if (asked.kind === 'pair' && asked.providerId === editingProviderId) {
    throw new RpcError(
      'INVALID_ARGUMENT',
      `baseModel must name a catalogue model, not ${editingProviderId} itself`,
      { baseModel: raw },
    );
  }
  if (asked.kind === 'pair') {
    const facts = await options.modelFacts({ providerId: asked.providerId, modelId: asked.modelId });
    if (facts === undefined) {
      throw new RpcError('INVALID_ARGUMENT', `the catalogue has no model ${asked.providerId}/${asked.modelId}`, {
        baseModel: raw,
      });
    }
    return facts;
  }
  // A bare name is accepted only when it is unambiguous: the same id exists in several providers with
  // different limits, and picking one silently would change when sessions compact.
  const all = (await options.catalogModels?.()) ?? [];
  const matches = all.filter((model) => model.modelId.toLowerCase() === asked.name.toLowerCase());
  if (matches.length === 0) {
    throw new RpcError('INVALID_ARGUMENT', `the catalogue has no model named ${asked.name}; give "provider/model"`, {
      baseModel: raw,
    });
  }
  if (matches.length > 1) {
    throw new RpcError('INVALID_ARGUMENT', `${asked.name} exists in several providers; name one of them`, {
      baseModel: raw,
      candidates: matches.map((model) => `${model.providerId}/${model.modelId}`),
    });
  }
  const only = matches[0] as { providerId: string; modelId: string };
  return await options.modelFacts(only);
}

/**
 * Assign a provider/model. Three shapes: a role globally (`roleId`), a project's default (`projectId`),
 * or one role inside a project (`roleId` + `projectId` — the most specific layer).
 */
async function saveModelAssignment(
  options: CoreMethodsOptions,
  value: Record<string, unknown>,
  scope: { roleId?: string; projectId?: string },
  expectedRevision: number | null,
): Promise<unknown> {
  const providerId = typeof value['providerId'] === 'string' ? value['providerId'] : '';
  const modelId = typeof value['modelId'] === 'string' ? value['modelId'] : '';
  const provider = providerId === '' ? undefined : options.store.getProvider(providerId);
  if (provider === undefined) {
    throw new RpcError('INVALID_ARGUMENT', `provider ${providerId || '(missing)'} is not configured`, { providerId });
  }
  const models = JSON.parse(provider.models) as Array<{ id: string }>;
  if (!models.some((model) => model.id === modelId)) {
    throw new RpcError('INVALID_ARGUMENT', `model ${modelId || '(missing)'} is not offered by ${providerId}`, {
      providerId,
      modelId,
    });
  }
  if (scope.roleId === undefined && scope.projectId === undefined) {
    throw new RpcError('INVALID_ARGUMENT', 'roleId, projectId, or both must name the override', {});
  }
  if (scope.projectId !== undefined && options.store.getProject(scope.projectId) === undefined) {
    throw new RpcError('NOT_FOUND', `project ${scope.projectId} does not exist`, { projectId: scope.projectId });
  }
  // The level is saved with the model because the levels are the model's own: validated against what
  // Pi reports for THIS model, so a value that a run would clamp away is refused here with the real
  // list instead of being stored and silently ignored.
  const levelRaw = value['thinkingLevel'];
  if (levelRaw !== undefined && typeof levelRaw !== 'string') {
    throw new RpcError('INVALID_ARGUMENT', 'thinkingLevel must be a string', { thinkingLevel: levelRaw });
  }
  const thinkingLevel = typeof levelRaw === 'string' ? levelRaw : '';
  if (thinkingLevel !== '') {
    const allowed = await (options.modelLevels?.({ providerId, modelId }) ?? Promise.resolve(['off']));
    if (!allowed.includes(thinkingLevel)) {
      throw new RpcError(
        'INVALID_ARGUMENT',
        `model ${modelId} does not support thinking level ${thinkingLevel}`,
        { providerId, modelId, thinkingLevel, allowed },
      );
    }
  }
  const saved = options.store.saveModelOverride({
    scope: scope.projectId === undefined ? 'role' : 'project',
    scopeId: (scope.projectId ?? scope.roleId) as string,
    ...(scope.projectId !== undefined && scope.roleId !== undefined ? { roleId: scope.roleId } : {}),
    providerId,
    modelId,
    thinkingLevel,
    expectedRevision,
  });
  return {
    scope: saved.scope,
    scopeId: saved.scopeId,
    roleId: saved.roleId,
    providerId: saved.providerId,
    modelId: saved.modelId,
    thinkingLevel: saved.thinkingLevel,
    revision: saved.revision,
  };
}
