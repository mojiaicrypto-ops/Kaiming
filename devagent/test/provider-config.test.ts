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
import { registerCoreMethods } from '../src/server/methods.ts';
import { resolveStoredConfig, type RuntimeDefaults } from '../src/runtime/config.ts';

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

async function harness(): Promise<Harness> {
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
  registerCoreMethods(router, { store, server });
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

  it('refuses an unknown provider, an unknown model and an ambiguous or missing scope', async () => {
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
            roleId: 'chief',
            projectId: 'p-1',
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
