/**
 * The method handlers this server ships (R1's table). Later slices add the project/session/task/
 * requirement/interaction methods; this file stays the one place that binds a public method name to
 * its handler, so the contract's table and the code cannot drift apart silently.
 */
import { RpcError, type RpcRouter } from './rpc.ts';
import { redactEffectiveConfig, resolveStoredConfig, type RuntimeDefaults } from '../runtime/config.ts';
import { credentialRefFor, writeProvider } from '../runtime/provider-store.ts';
import { PiRuntimeFactory } from '../runtime/pi-runtime.ts';
import type { Store } from '../store/store.ts';

export interface CoreMethodsOptions {
  readonly store: Store;
  /** The server-level default configuration this installation runs with. */
  readonly server: RuntimeDefaults;
  /** Per-role model overrides configured on this installation. */
  readonly roleOverrides?: Readonly<Record<string, { providerId: string; modelId: string }>>;
}

/**
 * The effective configuration (R5): the role override wins over the project override, which wins over
 * the server default. Keys never travel - a provider is described by where its credential lives.
 */
function readConfig(options: CoreMethodsOptions, roleId: string, projectId: string | undefined): unknown {
  const effective = resolveStoredConfig({
    roleId,
    ...(projectId !== undefined ? { projectId } : {}),
    server: options.server,
    store: options.store,
    ...(options.roleOverrides !== undefined ? { roleOverrides: options.roleOverrides } : {}),
  });
  return {
    roleId,
    ...(projectId !== undefined ? { projectId } : {}),
    effective: redactEffectiveConfig(effective),
    providers: options.store.listProviders().map((provider) => ({
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
      api: provider.api,
      models: JSON.parse(provider.models) as Array<{ id: string; name: string }>,
      credentialRef: provider.credentialRef,
      revision: provider.revision,
      // Availability, never the key: the caller can tell configured from usable.
      credentialConfigured: provider.credentialRef !== null,
    })),
    // Secrets are referenced, never echoed: only availability travels.
    credentials: { mode: 'reference', inResponse: false },
  };
}

export function registerCoreMethods(router: RpcRouter, options: CoreMethodsOptions): void {
  router.register('config.get', {
    write: false,
    run: (params): unknown => {
      const roleId = typeof params['roleId'] === 'string' && params['roleId'] !== '' ? params['roleId'] : 'chief';
      const projectId = typeof params['projectId'] === 'string' && params['projectId'] !== '' ? params['projectId'] : undefined;
      if (projectId !== undefined && options.store.getProject(projectId) === undefined) {
        throw new RpcError('NOT_FOUND', `project ${projectId} does not exist`, { projectId });
      }
      return readConfig(options, roleId, projectId);
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
      const factory = new PiRuntimeFactory(options.server);
      const probed = await factory.probe(selection);
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
    run: (params): unknown => {
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
        return saveModelAssignment(
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
}

/** Save a provider definition: the key goes to the private store, the database keeps its reference. */
function saveProvider(
  options: CoreMethodsOptions,
  value: Record<string, unknown>,
  expectedRevision: number | null,
): unknown {
  const providerId = typeof value['providerId'] === 'string' ? value['providerId'] : '';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(providerId)) {
    throw new RpcError('INVALID_ARGUMENT', 'providerId has an invalid form', { providerId });
  }
  const baseUrl = typeof value['baseUrl'] === 'string' ? value['baseUrl'] : '';
  if (baseUrl === '') {
    throw new RpcError('INVALID_ARGUMENT', 'baseUrl is required', { providerId });
  }
  const api = typeof value['api'] === 'string' && value['api'] !== '' ? value['api'] : undefined;
  const modelsRaw = Array.isArray(value['models']) ? value['models'] : undefined;
  if (modelsRaw === undefined || modelsRaw.length === 0) {
    throw new RpcError('INVALID_ARGUMENT', 'models must be a non-empty list of { id, name }', { providerId });
  }
  const models = modelsRaw.map((entry) => {
    const model = entry as Record<string, unknown>;
    const id = typeof model['id'] === 'string' ? model['id'] : '';
    if (id === '') {
      throw new RpcError('INVALID_ARGUMENT', 'every model needs an id', { providerId });
    }
    return { id, name: typeof model['name'] === 'string' && model['name'] !== '' ? model['name'] : id };
  });
  const apiKey = typeof value['apiKey'] === 'string' && value['apiKey'] !== '' ? value['apiKey'] : undefined;
  const written = writeProvider(options.server.agentDir, {
    providerId,
    baseUrl,
    ...(api !== undefined ? { api } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    models,
  });
  if (!written.ok) {
    throw new RpcError('INVALID_ARGUMENT', written.message, { providerId });
  }
  const provider = options.store.saveProvider({
    providerId,
    baseUrl,
    ...(api !== undefined ? { api } : {}),
    models,
    credentialRef: written.credentialRef,
    expectedRevision,
  });
  return {
    providerId: provider.providerId,
    revision: provider.revision,
    credentialRef: provider.credentialRef,
    models,
    // The key itself is never part of the answer.
    credentials: { mode: 'reference', inResponse: false },
  };
}

/** Assign a provider/model to one role or one project; exactly one scope must be named. */
function saveModelAssignment(
  options: CoreMethodsOptions,
  value: Record<string, unknown>,
  scope: { roleId?: string; projectId?: string },
  expectedRevision: number | null,
): unknown {
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
  if ((scope.roleId === undefined) === (scope.projectId === undefined)) {
    throw new RpcError('INVALID_ARGUMENT', 'exactly one of roleId or projectId must name the override', {});
  }
  if (scope.projectId !== undefined && options.store.getProject(scope.projectId) === undefined) {
    throw new RpcError('NOT_FOUND', `project ${scope.projectId} does not exist`, { projectId: scope.projectId });
  }
  const saved = options.store.saveModelOverride({
    scope: scope.roleId !== undefined ? 'role' : 'project',
    scopeId: (scope.roleId ?? scope.projectId) as string,
    providerId,
    modelId,
    expectedRevision,
  });
  return {
    scope: saved.scope,
    scopeId: saved.scopeId,
    providerId: saved.providerId,
    modelId: saved.modelId,
    revision: saved.revision,
  };
}
