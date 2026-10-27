/**
 * Model configuration (R5): the provider definitions the installation knows and the role/project
 * assignments that pick one - saved with revisions, with the key kept in the private store only.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, StoreError } from '../src/store/store.ts';
import { credentialRefFor, modelsPathFor, writeProvider } from '../src/runtime/provider-store.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { createStubEnv } from '../spikes/harness/pi-env.ts';
import { AuthService, CSRF_HEADER, SESSION_COOKIE } from '../src/server/auth.ts';
import { RpcRouter } from '../src/server/rpc.ts';
import { createWorkbenchServer } from '../src/server/http.ts';
import { registerCoreMethods, type CatalogModelFacts } from '../src/server/methods.ts';
import { resolveStoredConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import type { ModelFacts } from '../src/runtime/pi-runtime.ts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'model-config-secret';

interface Harness {
  readonly store: Store;
  readonly agentDir: string;
  /** The database file, so a test can prove a key never reached it. */
  readonly dbPath: string;
  call(method: string, params?: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
}

async function harness(
  options: {
    modelLevels?: (selection: { providerId: string; modelId: string }) => Promise<readonly string[]>;
    modelFacts?: (selection: { providerId: string; modelId: string }) => Promise<ModelFacts | undefined>;
    catalogModels?: () => Promise<readonly CatalogModelFacts[]>;
  } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-config-'));
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  store.createProject({ id: 'p-1', realPath: join(root, 'project') });
  const agentDir = join(root, 'agent');
  const server: RuntimeDefaults = {
    model: { providerId: 'server-default', modelId: 'default-model' },
    agentDir,
    promptDir: join(root, 'prompts'),
    tools: [],
  };
  const auth = new AuthService({ accessPassword: PASSWORD });
  const router = new RpcRouter();
  registerCoreMethods(router, {
    store,
    server,
    ...(options.modelLevels !== undefined ? { modelLevels: options.modelLevels } : {}),
    ...(options.modelFacts !== undefined ? { modelFacts: options.modelFacts } : {}),
    ...(options.catalogModels !== undefined ? { catalogModels: options.catalogModels } : {}),
  });
  const workbench = createWorkbenchServer({ store, auth, router });
  const { origin } = await workbench.listen(0);
  cleanups.push(async () => {
    await workbench.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const login = await fetch(`${origin}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'auth.login', params: { password: PASSWORD } }),
  });
  const cookie = /agentdev_session=([0-9a-f]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const csrf = String(((await login.json()) as { result: { csrfToken: string } }).result.csrfToken);
  return {
    store,
    agentDir,
    dbPath: join(root, 'state.db'),
    async call(method, params = {}) {
      const response = await fetch(`${origin}/api/v1/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE}=${cookie}`,
          [CSRF_HEADER]: csrf,
        },
        body: JSON.stringify({ requestId: `req-${Math.random().toString(16).slice(2)}`, method, params }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

/** The levels a run would accept, as the runtime would report them for a reasoning-capable model. */
const reasoningLevels = async (): Promise<readonly string[]> => ['off', 'minimal', 'low', 'medium', 'high'];

const provider = (overrides: Record<string, unknown> = {}) => ({
  kind: 'provider',
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  api: 'openai-completions',
  apiKey: 'sk-secret-value',
  models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }],
  ...overrides,
});

const resultOf = <T>(body: Record<string, unknown>): T => body['result'] as T;
const errorCode = (body: Record<string, unknown>): string => (body['error'] as { code: string }).code;

describe('provider storage', () => {
  it('creates, versions and reads a provider while keeping the key out of the database', async () => {
    const h = await harness();

    const created = await h.call('config.save', { expectedRevision: null, value: provider() });
    expect(created.status).toBe(200);
    const saved = resultOf<{ providerId: string; revision: number; credentialRef: string }>(created.body);
    expect(saved).toMatchObject({ providerId: 'deepseek', revision: 1, credentialRef: credentialRefFor('deepseek') });
    // The key is in the private file, not in the answer and not in the database.
    expect(JSON.stringify(created.body)).not.toContain('sk-secret-value');
    const file = modelsPathFor(h.agentDir);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      providers: { deepseek: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-secret-value' } },
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = readFileSync(h.dbPath, 'utf8');
    expect(raw).not.toContain('sk-secret-value');

    // A second create with the same id conflicts; an update needs the right revision.
    expect(errorCode((await h.call('config.save', { expectedRevision: null, value: provider() })).body)).toBe(
      'VERSION_CONFLICT',
    );
    expect(
      errorCode((await h.call('config.save', { expectedRevision: 7, value: provider({ baseUrl: 'https://x/v1' }) })).body),
    ).toBe('VERSION_CONFLICT');
    // An update that keeps the key keeps working: the private file is merged, not replaced.
    const updated = await h.call('config.save', {
      expectedRevision: 1,
      value: { ...provider(), apiKey: undefined, models: [{ id: 'deepseek-flash', name: 'fast' }] },
    });
    expect(resultOf<{ revision: number }>(updated.body).revision).toBe(2);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      providers: { deepseek: { apiKey: 'sk-secret-value' } },
    });

    const read = await h.call('config.get', {});
    const providers = resultOf<{ providers: Array<Record<string, unknown>> }>(read.body).providers;
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      providerId: 'deepseek',
      credentialRef: credentialRefFor('deepseek'),
      credentialConfigured: true,
      revision: 2,
    });
    expect(JSON.stringify(read.body)).not.toContain('sk-secret-value');
  });

  it('refuses a provider without a key or without models', async () => {
    const h = await harness();
    expect(
      errorCode((await h.call('config.save', { expectedRevision: null, value: provider({ apiKey: undefined }) })).body),
    ).toBe('INVALID_ARGUMENT');
    expect(
      errorCode((await h.call('config.save', { expectedRevision: null, value: provider({ models: [] }) })).body),
    ).toBe('INVALID_ARGUMENT');
  });
});

describe('role and project model assignments', () => {
  it('assigns a configured model to a role and to a project, and reports where the choice came from', async () => {
    const h = await harness();
    await h.call('config.save', { expectedRevision: null, value: provider() });

    const role = await h.call('config.save', {
      expectedRevision: null,
      roleId: 'reviewer',
      value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash' },
    });
    expect(resultOf<{ scope: string; revision: number }>(role.body)).toMatchObject({ scope: 'role', revision: 1 });
    const project = await h.call('config.save', {
      expectedRevision: null,
      projectId: 'p-1',
      value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash' },
    });
    expect(resultOf<{ scope: string }>(project.body).scope).toBe('project');

    // Resolution order: role wins over project, project wins over the server default.
    const asReviewer = resultOf<{ effective: { providerId: string; source: string } }>(
      (await h.call('config.get', { roleId: 'reviewer', projectId: 'p-1' })).body,
    ).effective;
    expect(asReviewer).toMatchObject({ providerId: 'deepseek', source: 'role' });
    const asDeveloperInProject = resultOf<{ effective: { providerId: string; source: string } }>(
      (await h.call('config.get', { roleId: 'developer', projectId: 'p-1' })).body,
    ).effective;
    expect(asDeveloperInProject).toMatchObject({ providerId: 'deepseek', source: 'project' });
    const withoutOverride = resultOf<{ effective: { providerId: string; source: string } }>(
      (await h.call('config.get', { roleId: 'developer' })).body,
    ).effective;
    expect(withoutOverride).toMatchObject({ providerId: 'server-default', source: 'server' });

    // Revisions guard a concurrent edit.
    expect(
      errorCode(
        (
          await h.call('config.save', {
            expectedRevision: 5,
            roleId: 'reviewer',
            value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash' },
          })
        ).body,
      ),
    ).toBe('VERSION_CONFLICT');
  });

  it('refuses an unknown provider, an unknown model and a missing scope', async () => {
    const h = await harness();
    await h.call('config.save', { expectedRevision: null, value: provider() });

    expect(
      errorCode(
        (
          await h.call('config.save', {
            expectedRevision: null,
            roleId: 'chief',
            value: { kind: 'model', providerId: 'nope', modelId: 'x' },
          })
        ).body,
      ),
    ).toBe('INVALID_ARGUMENT');
    expect(
      errorCode(
        (
          await h.call('config.save', {
            expectedRevision: null,
            roleId: 'chief',
            value: { kind: 'model', providerId: 'deepseek', modelId: 'nope' },
          })
        ).body,
      ),
    ).toBe('INVALID_ARGUMENT');
    expect(
      errorCode(
        (
          await h.call('config.save', {
            expectedRevision: null,
            value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash' },
          })
        ).body,
      ),
    ).toBe('INVALID_ARGUMENT');
    expect(
      errorCode(
        (
          await h.call('config.save', {
            expectedRevision: null,
            projectId: 'p-missing',
            value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash' },
          })
        ).body,
      ),
    ).toBe('NOT_FOUND');
  });

  it('narrows an override to one role inside a project and clears it back to the inherited layer', async () => {
    const h = await harness();
    await h.call('config.save', { expectedRevision: null, value: provider() });
    await h.call('config.save', {
      expectedRevision: null,
      value: provider({
        providerId: 'alt',
        baseUrl: 'https://alt.example/v1',
        models: [{ id: 'alt-1', name: 'alt-1' }],
      }),
    });
    const assign = async (params: Record<string, unknown>, modelId: string): Promise<void> => {
      const providerId = modelId === 'alt-1' ? 'alt' : 'deepseek';
      const saved = await h.call('config.save', {
        ...params,
        value: { kind: 'model', providerId, modelId },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    };
    const cfg = async (roleId: string, projectId?: string) => {
      const read = await h.call('config.get', { roleId, ...(projectId === undefined ? {} : { projectId }) });
      return resultOf<{
        effective: { providerId: string; modelId: string; source: string };
        overrides: {
          role: { modelId: string } | null;
          project: { modelId: string } | null;
          projectRole: { modelId: string; revision: number } | null;
        };
      }>(read.body);
    };

    await assign({ expectedRevision: null, roleId: 'chief' }, 'deepseek-flash');
    await assign({ expectedRevision: null, projectId: 'p-1' }, 'deepseek-flash');
    // Both ids at once is the layer this feature adds: that role, in that project.
    await assign({ expectedRevision: null, roleId: 'chief', projectId: 'p-1' }, 'alt-1');

    expect((await cfg('chief', 'p-1')).effective).toMatchObject({
      providerId: 'alt',
      modelId: 'alt-1',
      source: 'project-role',
    });
    expect((await cfg('chief', 'p-1')).overrides.projectRole?.modelId).toBe('alt-1');
    // The same role outside that project keeps its global choice.
    expect((await cfg('chief')).effective).toMatchObject({ modelId: 'deepseek-flash', source: 'role' });
    // Another role in the project inherits the project default; the project default therefore
    // reaches every role that has no narrower choice.
    expect((await cfg('developer', 'p-1')).effective.source).toBe('project');
    expect((await cfg('reviewer', 'p-1')).effective.source).toBe('project');

    // Changing an existing layer needs its revision; a second save with null would be a conflict.
    const stored = await cfg('chief', 'p-1');
    await assign(
      { expectedRevision: stored.overrides.projectRole?.revision ?? null, roleId: 'chief', projectId: 'p-1' },
      'deepseek-flash',
    );
    expect((await cfg('chief', 'p-1')).effective).toMatchObject({ modelId: 'deepseek-flash', source: 'project-role' });

    // Clearing walks back down the layers: project role → role → project → server.
    await h.call('config.clear', { roleId: 'chief', projectId: 'p-1' });
    expect((await cfg('chief', 'p-1')).effective.source).toBe('role');
    await h.call('config.clear', { roleId: 'chief' });
    expect((await cfg('chief', 'p-1')).effective.source).toBe('project');
    await h.call('config.clear', { projectId: 'p-1' });
    expect((await cfg('chief', 'p-1')).effective.source).toBe('server');
    expect((await cfg('chief', 'p-1')).overrides).toEqual({ role: null, project: null, projectRole: null });
  }, 30_000);
});

describe('provider name and protocol', () => {
  it('keeps the id as the identity and stores the display name and protocol beside it', async () => {
    const h = await harness();
    const created = await h.call('config.save', {
      expectedRevision: null,
      value: provider({ name: 'DeepSeek 官方', api: 'openai-completions' }),
    });
    expect(created.status).toBe(200);
    expect(resultOf<{ name: string }>(created.body).name).toBe('DeepSeek 官方');

    // The display name travels to the credential store too, and the id stays the key there.
    const file = JSON.parse(readFileSync(modelsPathFor(h.agentDir), 'utf8')) as {
      providers: Record<string, { name?: string; api?: string }>;
    };
    expect(file.providers['deepseek']).toMatchObject({ name: 'DeepSeek 官方', api: 'openai-completions' });

    const read = await h.call('config.get', {});
    expect(resultOf<{ providers: Array<Record<string, unknown>> }>(read.body).providers[0]).toMatchObject({
      providerId: 'deepseek',
      name: 'DeepSeek 官方',
      api: 'openai-completions',
    });

    // Renaming is an edit of the same provider: the id in the answer does not move, and a legacy
    // credential reference still points at it.
    const renamed = await h.call('config.save', {
      expectedRevision: 1,
      value: provider({ name: '本地代理', api: 'anthropic-messages' }),
    });
    expect(resultOf<{ providerId: string; name: string }>(renamed.body)).toMatchObject({
      providerId: 'deepseek',
      name: '本地代理',
    });
    expect(h.store.getProvider('deepseek')?.credentialRef).toBe(credentialRefFor('deepseek'));
  }, 30_000);

  it('refuses a save without a supported protocol instead of letting Pi guess one', async () => {
    const h = await harness();
    const missing = await h.call('config.save', {
      expectedRevision: null,
      value: { ...provider(), api: undefined },
    });
    expect(missing.status).toBe(400);
    expect(errorCode(missing.body)).toBe('INVALID_ARGUMENT');
    expect((missing.body['error'] as { message: string }).message).toContain('openai-completions');

    const bogus = await h.call('config.save', { expectedRevision: null, value: provider({ api: 'openai' }) });
    expect(bogus.status).toBe(400);
    expect(errorCode(bogus.body)).toBe('INVALID_ARGUMENT');

    // Neither refusal left anything behind: no database row, no credential file entry.
    expect(h.store.getProvider('deepseek')).toBeUndefined();
    expect(existsSync(modelsPathFor(h.agentDir))).toBe(false);
  }, 30_000);

  it('falls back to the id when no display name was given', async () => {
    const h = await harness();
    const created = await h.call('config.save', { expectedRevision: null, value: provider({ name: undefined }) });
    expect(resultOf<{ name: string }>(created.body).name).toBe('deepseek');
    expect(h.store.getProvider('deepseek')?.name).toBeNull();
  }, 30_000);
});

describe('provider storage in the store itself', () => {
  it('enforces the revision discipline without the RPC layer', () => {
    const root = mkdtempSync(join(tmpdir(), 'devagent-config-store-'));
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    try {
      store.saveProvider({
        providerId: 'p',
        baseUrl: 'https://x/v1',
        models: [{ id: 'm', name: 'm' }],
        expectedRevision: null,
      });
      expect(store.getProvider('p')?.revision).toBe(1);
      expect(() =>
        store.saveProvider({
          providerId: 'p',
          baseUrl: 'https://x/v1',
          models: [{ id: 'm', name: 'm' }],
          expectedRevision: null,
        }),
      ).toThrow(StoreError);
      expect(
        store.saveProvider({
          providerId: 'p',
          baseUrl: 'https://y/v1',
          models: [{ id: 'm', name: 'm' }],
          expectedRevision: 1,
        }).revision,
      ).toBe(2);
      expect(store.listProviders().map((entry) => entry.providerId)).toEqual(['p']);
      expect(store.saveModelOverride({ scope: 'role', scopeId: 'tester', providerId: 'p', modelId: 'm', expectedRevision: null }).revision).toBe(1);
      expect(store.getModelOverride('role', 'tester')).toMatchObject({ providerId: 'p', modelId: 'm' });
      expect(store.listModelOverrides('role').map((entry) => entry.scopeId)).toEqual(['tester']);
      expect(store.listModelOverrides('project')).toEqual([]);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('config.test', () => {
  it('reports the resolved selection and an unreachable provider without echoing a key', async () => {
    const h = await harness();
    // A provider whose endpoint cannot answer: the probe must say so rather than pretend.
    await h.call('config.save', {
      expectedRevision: null,
      value: {
        kind: 'provider',
        providerId: 'dead',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        apiKey: 'sk-dead',
        models: [{ id: 'dead-1', name: 'dead-1' }],
      },
    });
    await h.call('config.save', {
      expectedRevision: null,
      roleId: 'tester',
      value: { kind: 'model', providerId: 'dead', modelId: 'dead-1' },
    });

    const probed = await h.call('config.test', { roleId: 'tester' });
    expect(probed.status).toBe(200);
    const result = resultOf<{ probed: { providerId: string; modelId: string }; source: string; available: boolean; detail: string }>(probed.body);
    expect(result).toMatchObject({ probed: { providerId: 'dead', modelId: 'dead-1' }, source: 'role', available: false });
    expect(result.detail.length).toBeGreaterThan(0);
    expect(JSON.stringify(probed.body)).not.toContain('sk-dead');
  }, 30_000);

  it('probes the effective configuration for a role and for a project', async () => {
    const h = await harness();
    const asServerDefault = resultOf<{ source: string }>((await h.call('config.test', {})).body);
    expect(asServerDefault.source).toBe('server');
    expect((await h.call('config.test', { projectId: 'p-missing' })).status).toBe(404);
  }, 30_000);
});

describe('one resolver for the surface and the run', () => {
  it('resolves stored overrides by role and by project, the way a claimed input does', () => {
    const root = mkdtempSync(join(tmpdir(), 'devagent-resolver-'));
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    try {
      store.saveProvider({
        providerId: 'p',
        baseUrl: 'https://x/v1',
        models: [{ id: 'm', name: 'm' }],
        expectedRevision: null,
      });
      const server: RuntimeDefaults = {
        model: { providerId: 'default', modelId: 'd' },
        agentDir: '/tmp/agent',
        promptDir: '/tmp/prompts',
        tools: [],
      };
      expect(resolveStoredConfig({ roleId: 'chief', server, store }).source).toBe('server');
      store.saveModelOverride({ scope: 'role', scopeId: 'chief', providerId: 'p', modelId: 'm', expectedRevision: null });
      expect(resolveStoredConfig({ roleId: 'chief', server, store })).toMatchObject({
        source: 'role',
        selection: { providerId: 'p', modelId: 'm' },
      });
      store.saveModelOverride({ scope: 'project', scopeId: 'proj', providerId: 'p', modelId: 'm', expectedRevision: null });
      // Without the project the role still wins; with it, the project override is what a run gets.
      expect(resolveStoredConfig({ roleId: 'developer', server, store }).source).toBe('server');
      expect(resolveStoredConfig({ roleId: 'developer', projectId: 'proj', server, store }).source).toBe('project');
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('a saved provider reaches the running runtime', () => {
  it('makes a provider written after the factory was first used available without a restart', async () => {
    const env = await createStubEnv(undefined, {
      providers: {
        first: {
          baseUrl: 'http://127.0.0.1:1/v1',
          api: 'openai-completions',
          apiKey: 'k-first',
          models: [{ id: 'first-1', name: 'first-1' }],
        },
      },
    });
    try {
      const factory = new PiRuntimeFactory({
        model: { providerId: 'first', modelId: 'first-1' },
        agentDir: env.agentDir,
        promptDir: '/tmp/prompts',
        tools: [],
      });
      // Warm the cache, exactly as the first run of a process does.
      expect(await factory.isAvailable({ providerId: 'second', modelId: 'second-1' })).toBe(false);

      const written = writeProvider(env.agentDir, {
        providerId: 'second',
        baseUrl: 'http://127.0.0.1:2/v1',
        api: 'openai-completions',
        apiKey: 'k-second',
        models: [{ id: 'second-1', name: 'second-1' }],
      });
      expect(written.ok).toBe(true);
      // The cache still says no (this is the defect the reload exists for)...
      expect(await factory.isAvailable({ providerId: 'second', modelId: 'second-1' })).toBe(false);
      // ...and after the reload a run can use it, without restarting the process.
      await factory.reload();
      expect(await factory.isAvailable({ providerId: 'second', modelId: 'second-1' })).toBe(true);
    } finally {
      rmSync(env.root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('thinking level, saved with the model it belongs to', () => {
  it('saves a level the model accepts and reports it on the layer and the effective config', async () => {
    const h = await harness({ modelLevels: reasoningLevels });
    await h.call('config.save', { expectedRevision: null, value: provider() });

    const saved = await h.call('config.save', {
      expectedRevision: null,
      value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash', thinkingLevel: 'high' },
      roleId: 'developer',
    });
    expect(saved.status).toBe(200);
    expect(resultOf<{ thinkingLevel: string }>(saved.body).thinkingLevel).toBe('high');

    const read = resultOf<{
      effective: { thinkingLevel: string; thinkingLevels: string[] };
      overrides: { role: { thinkingLevel: string } | null };
    }>((await h.call('config.get', { roleId: 'developer' })).body);
    expect(read.overrides.role?.thinkingLevel).toBe('high');
    expect(read.effective.thinkingLevel).toBe('high');
    // The page lists what a run would accept, so it cannot offer a level that gets clamped away.
    expect(read.effective.thinkingLevels).toEqual(['off', 'minimal', 'low', 'medium', 'high']);
  });

  it('refuses a level the model does not accept, and writes nothing', async () => {
    const h = await harness({ modelLevels: async () => ['off'] });
    await h.call('config.save', { expectedRevision: null, value: provider() });

    const refused = await h.call('config.save', {
      expectedRevision: null,
      value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash', thinkingLevel: 'high' },
      roleId: 'developer',
    });

    expect(errorCode(refused.body)).toBe('INVALID_ARGUMENT');
    expect((refused.body['error'] as { details: { allowed: string[] } }).details.allowed).toEqual(['off']);
    expect(h.store.getModelOverride('role', 'developer')).toBeUndefined();
  });

  it('keeps the level of the winning layer only, and an unset row runs at off', async () => {
    const h = await harness({ modelLevels: reasoningLevels });
    await h.call('config.save', { expectedRevision: null, value: provider() });
    // The role globally asks for medium...
    await h.call('config.save', {
      expectedRevision: null,
      value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash', thinkingLevel: 'medium' },
      roleId: 'developer',
    });
    // ...and the narrower layer names the same model without an effort: no cross-layer mixing.
    const narrow = await h.call('config.save', {
      expectedRevision: null,
      value: { kind: 'model', providerId: 'deepseek', modelId: 'deepseek-flash' },
      roleId: 'developer',
      projectId: 'p-1',
    });
    expect(narrow.status).toBe(200);

    const read = resultOf<{ effective: { source: string; thinkingLevel: string } }>(
      (await h.call('config.get', { roleId: 'developer', projectId: 'p-1' })).body,
    );
    expect(read.effective.source).toBe('project-role');
    expect(read.effective.thinkingLevel).toBe('off');

    // Clearing the narrower layer hands the model (and its level) back.
    await h.call('config.clear', { roleId: 'developer', projectId: 'p-1' });
    const back = resultOf<{ effective: { source: string; thinkingLevel: string } }>(
      (await h.call('config.get', { roleId: 'developer', projectId: 'p-1' })).body,
    );
    expect(back.effective).toMatchObject({ source: 'role', thinkingLevel: 'medium' });
  });

  it('records the reasoning declaration on the provider and reads it back', async () => {
    const h = await harness({ modelLevels: reasoningLevels });
    const created = await h.call('config.save', {
      expectedRevision: null,
      value: provider({
        models: [
          { id: 'deepseek-flash', name: 'deepseek-flash' },
          { id: 'deepseek-reasoner', name: 'deepseek-reasoner', reasoning: true },
        ],
      }),
    });
    expect(created.status).toBe(200);

    // Pi reads this file: a declaration that never reaches it would leave the levels inert.
    const written = JSON.parse(readFileSync(modelsPathFor(h.agentDir), 'utf8')) as {
      providers: { deepseek: { models: Array<{ id: string; reasoning?: boolean }> } };
    };
    expect(written.providers.deepseek.models.find((model) => model.id === 'deepseek-reasoner')?.reasoning).toBe(true);
    expect(written.providers.deepseek.models.find((model) => model.id === 'deepseek-flash')?.reasoning).toBeUndefined();

    const read = resultOf<{ providers: Array<{ models: Array<{ id: string; reasoning: boolean; thinkingLevels: string[] }> }> }>(
      (await h.call('config.get', {})).body,
    );
    const models = read.providers[0]?.models ?? [];
    expect(models.find((model) => model.id === 'deepseek-reasoner')).toMatchObject({
      reasoning: true,
      thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
    });
  });
});

describe('a gateway alias borrows the real model\'s facts', () => {
  /** One catalogue: a reasoning model with real limits, and a small one. */
  const entry = (
    providerId: string,
    modelId: string,
    reasoning: boolean,
    api = 'openai-completions',
  ): CatalogModelFacts => ({
    providerId,
    modelId,
    name: modelId,
    api,
    reasoning,
    thinkingLevels: reasoning ? ['off', 'low', 'high'] : ['off'],
    contextWindow: reasoning ? 200_000 : 128_000,
    maxTokens: reasoning ? 128_000 : 16_384,
  });
  const catalog: readonly CatalogModelFacts[] = [
    entry('zai', 'glm-5-3', true),
    // The same id on a second provider: a bare name is then ambiguous.
    entry('zai-cn', 'glm-5-3', true),
    entry('baseten', 'zai-org/GLM-5.3', true),
    entry('openai', 'gpt-4o', false),
  ];
  const facts =
    (levelMap: Readonly<Record<string, string | null>> = {}) =>
    async (selection: { providerId: string; modelId: string }): Promise<ModelFacts | undefined> => {
      const found = catalog.find((row) => row.providerId === selection.providerId && row.modelId === selection.modelId);
      if (found === undefined) return undefined;
      return {
        providerId: found.providerId,
        modelId: found.modelId,
        api: found.api,
        reasoning: found.reasoning,
        contextWindow: found.contextWindow,
        maxTokens: found.maxTokens,
        thinkingLevelMap: levelMap,
        input: ['text', 'image'],
      };
    };
  const gateway = (models: unknown[]): Record<string, unknown> => ({
    kind: 'provider',
    providerId: 'my-gateway',
    baseUrl: 'https://gw.example/v1',
    api: 'openai-completions',
    apiKey: 'gw-key',
    models,
  });

  it('writes the catalogue numbers into models.json, not Pi\'s 128k/16k fallback', async () => {
    const h = await harness({ modelFacts: facts({ high: 'high' }), catalogModels: async () => catalog });

    const saved = await h.call('config.save', {
      expectedRevision: null,
      value: gateway([{ id: 'auto-glm-5-3', name: 'auto-glm-5-3', baseModel: 'zai/glm-5-3' }]),
    });
    expect(saved.status).toBe(200);

    const written = JSON.parse(readFileSync(modelsPathFor(h.agentDir), 'utf8')) as {
      providers: {
        'my-gateway': {
          models: Array<{ id: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number; thinkingLevelMap?: Record<string, string> }>;
        };
      };
    };
    const model = written.providers['my-gateway'].models[0];
    expect(model).toMatchObject({
      id: 'auto-glm-5-3',
      reasoning: true,
      contextWindow: 200_000,
      maxTokens: 128_000,
      thinkingLevelMap: { high: 'high' },
    });

    // The page shows the mapping it saved, so the operator can see the alias took effect. The copied
    // numbers live in models.json (asserted above); the row keeps the identity and the declaration.
    const read = resultOf<{
      providers: Array<{ models: Array<{ id: string; upstream?: string; reasoning: boolean }> }>;
    }>((await h.call('config.get', {})).body);
    expect(read.providers[0]?.models[0]).toMatchObject({
      id: 'auto-glm-5-3',
      upstream: 'zai/glm-5-3',
      reasoning: true,
    });
  });

  it('refuses a name the catalogue does not know, and an ambiguous one, before anything is written', async () => {
    const h = await harness({ modelFacts: facts(), catalogModels: async () => catalog });

    const unknown = await h.call('config.save', {
      expectedRevision: null,
      value: gateway([{ id: 'auto-x', baseModel: 'zai/not-a-model' }]),
    });
    expect(errorCode(unknown.body)).toBe('INVALID_ARGUMENT');
    expect(String((unknown.body['error'] as { message: string }).message)).toContain('no model zai/not-a-model');

    // The same id lives in two providers with different limits: picking one silently would change
    // when a session compacts, so the caller has to say which.
    const ambiguous = await h.call('config.save', {
      expectedRevision: null,
      value: gateway([{ id: 'auto-glm', baseModel: 'glm-5-3' }]),
    });
    expect(errorCode(ambiguous.body)).toBe('INVALID_ARGUMENT');
    expect((ambiguous.body['error'] as { details: { candidates: string[] } }).details.candidates).toEqual([
      'zai/glm-5-3',
      'zai-cn/glm-5-3',
    ]);
    expect(h.store.listProviders()).toEqual([]);
  });

  it('accepts a bare name when only one provider has it, and keeps the reasoning box for unmapped ids', async () => {
    const h = await harness({ modelFacts: facts(), catalogModels: async () => catalog });

    const bare = await h.call('config.save', {
      expectedRevision: null,
      value: gateway([
        { id: 'my-gpt', baseModel: 'gpt-4o' },
        { id: 'my-plain', reasoning: true },
      ]),
    });
    expect(bare.status).toBe(200);

    const written = JSON.parse(readFileSync(modelsPathFor(h.agentDir), 'utf8')) as {
      providers: { 'my-gateway': { models: Array<{ id: string; reasoning?: boolean; contextWindow?: number }> } };
    };
    expect(written.providers['my-gateway'].models[0]).toMatchObject({
      id: 'my-gpt',
      contextWindow: 128_000,
      maxTokens: 16_384,
    });
    // Absence is the same statement to Pi, and it keeps the file free of values that are not facts.
    expect(written.providers['my-gateway'].models[0]).not.toHaveProperty('reasoning', true);
    // No alias: the operator's own declaration is what travels, and no numbers are invented.
    expect(written.providers['my-gateway'].models[1]).toMatchObject({ id: 'my-plain', reasoning: true });
    expect(written.providers['my-gateway'].models[1]?.contextWindow).toBeUndefined();
  });

  it('refuses an alias that points back at the provider being saved', async () => {
    // The installation's own entries are in the same catalogue, so this mistake is easy to make —
    // and it would record Pi's fallback numbers as if they were the real model's.
    const h = await harness({
      modelFacts: async (selection) => ({
        providerId: selection.providerId,
        modelId: selection.modelId,
        api: 'openai-completions',
        reasoning: false,
        contextWindow: 128_000,
        maxTokens: 16_384,
      }),
      catalogModels: async () => [entry('my-gateway', 'auto-model', false)],
    });

    const refused = await h.call('config.save', {
      expectedRevision: null,
      value: gateway([{ id: 'auto-model', baseModel: 'my-gateway/auto-model' }]),
    });

    expect(errorCode(refused.body)).toBe('INVALID_ARGUMENT');
    expect(String((refused.body['error'] as { message: string }).message)).toContain('not my-gateway itself');
    expect(h.store.listProviders()).toEqual([]);
  });

  it('serves the catalogue for the picker, grouped by provider', async () => {
    const h = await harness({ catalogModels: async () => catalog });

    const read = resultOf<{
      providers: Array<{ providerId: string; models: Array<CatalogModelFacts> }>;
      count: number;
    }>((await h.call('config.catalog', {})).body);
    expect(read.count).toBe(4);
    expect(read.providers.map((row) => row.providerId)).toEqual(
      expect.arrayContaining(['zai', 'zai-cn', 'baseten', 'openai']),
    );
    // The picker needs the levels too: choosing a model then asking "does it reason?" is a question
    // the catalogue already answers.
    const glm = read.providers.find((row) => row.providerId === 'zai')?.models[0];
    expect(glm).toMatchObject({ modelId: 'glm-5-3', api: 'openai-completions', thinkingLevels: ['off', 'low', 'high'] });
  });
});
