import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Profile, ProviderInput, Run } from '@agentdev/contracts';
import { ProjectStore as Store, type ProjectStore } from '@agentdev/storage';
import {
  ConfigStore,
  ModelGateway,
  ProtocolError,
  SnapshotWriter,
  type GatewayRequest,
  type GatewayTransport,
} from '../src/index.js';

const ROOT = '/tmp/agentdev-gateway-root';
const PROVIDER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70';
const MODEL_ID = 'test-model';

function provider(overrides: Partial<ProviderInput> = {}): ProviderInput {
  return {
    providerId: PROVIDER_ID,
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234',
    enabled: true,
    secretRef: 'local-secret',
    models: [
      {
        id: MODEL_ID,
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
        reasoningLevels: ['off', 'low', 'medium'],
        vision: false,
      },
    ],
    ...overrides,
  };
}

/** Records every request so tests can prove which model actually ran. */
class StubTransport implements GatewayTransport {
  readonly requests: GatewayRequest[] = [];
  private readonly reply: 'ok' | 'error';

  constructor(reply: 'ok' | 'error' = 'ok') {
    this.reply = reply;
  }

  complete(request: GatewayRequest): Promise<
    | { ok: true; text: string; inputTokens: number; outputTokens: number }
    | {
        ok: false;
        code: 'PROVIDER_UNAVAILABLE' | 'CONFIG_INVALID' | 'INTERNAL_ERROR';
        retryable: boolean;
        message: string;
      }
  > {
    this.requests.push(request);
    return Promise.resolve(
      this.reply === 'ok'
        ? { ok: true, text: 'pong', inputTokens: 3, outputTokens: 1 }
        : {
            ok: false,
            code: 'PROVIDER_UNAVAILABLE',
            retryable: true,
            message: 'connection refused',
          },
    );
  }
}

describe('model gateway (AC-043, AC-044, AC-045)', () => {
  let globalDir: string;
  let projectRoot: string;
  let store: ProjectStore;
  let config: ConfigStore;
  let transport: StubTransport;
  let gateway: ModelGateway;

  const roleProfile: Profile = {
    providerId: PROVIDER_ID,
    modelId: MODEL_ID,
    reasoning: 'medium',
    skills: [],
    toolSubset: ['read'],
    contextLimit: 64_000,
  };

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), 'agentdev-gateway-global-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'agentdev-gateway-project-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-gateway-store-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    const writer = new SnapshotWriter({ store });
    config = ConfigStore.open({ globalDir, projectRoot, snapshots: writer });
    transport = new StubTransport();
    gateway = new ModelGateway({
      config,
      snapshots: writer,
      transport,
      secrets: { resolve: (ref) => (ref === 'local-secret' ? 'sk-test' : undefined) },
    });
  });

  afterEach(() => {
    store.close();
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function configure(role: 'chief' | 'backend' = 'backend'): Run {
    config.upsertProvider(provider());
    config.update('global', { roleOverrides: { [role]: roleProfile } });
    const frozen = config.freeze(role);
    return {
      role,
      configSnapshotId: frozen.snapshotId,
    } as unknown as Run;
  }

  it('runs through the frozen profile of the Run', async () => {
    const run = configure();
    const response = await gateway.complete(run, [{ role: 'user', content: 'hi' }]);
    expect(response).toMatchObject({ ok: true, text: 'pong' });
    expect(transport.requests[0]).toMatchObject({
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      reasoning: 'medium',
      baseUrl: 'http://127.0.0.1:1234',
      apiKey: 'sk-test',
      contextLimit: 64_000,
    });
    expect(ModelGateway.tokensOf(response)).toEqual({ input: 3, output: 1 });
  });

  it('never switches model for an active Run when configuration changes', async () => {
    const run = configure();
    // A new default model appears while the Run is active.
    config.upsertProvider(
      provider({
        models: [
          {
            id: 'other-model',
            contextWindow: 100_000,
            maxOutputTokens: 4_000,
            reasoningLevels: ['off'],
            vision: false,
          },
        ],
      }),
    );
    config.update('global', {
      roleOverrides: { backend: { modelId: 'other-model', reasoning: 'off' } },
    });

    const response = await gateway.complete(run, [{ role: 'user', content: 'hi' }]);
    expect(response.ok).toBe(true);
    expect(transport.requests[0]?.modelId).toBe(MODEL_ID);
    expect(transport.requests[0]?.reasoning).toBe('medium');

    // The new configuration applies to Runs frozen after it, and only those.
    const fresh = { role: 'backend', configSnapshotId: config.freeze('backend').snapshotId } as Run;
    await gateway.complete(fresh, [{ role: 'user', content: 'hi' }]);
    expect(transport.requests[1]?.modelId).toBe('other-model');
  });

  it('blocks a role with no usable model instead of falling back', () => {
    expect(gateway.availability('backend')).toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
    });

    config.upsertProvider(provider());
    config.update('global', { roleOverrides: { backend: roleProfile } });
    expect(gateway.availability('backend')).toMatchObject({ ok: true });

    // A disabled provider is unavailable, not a reason to use another one.
    config.upsertProvider(provider({ enabled: false }));
    expect(gateway.availability('backend')).toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('refuses to run when the frozen snapshot is gone or the secret is missing', async () => {
    const run = configure();
    const orphan = { ...run, configSnapshotId: 'f'.repeat(64) } as Run;
    expect(() => gateway.frozenProfileOf(orphan)).toThrowError(ProtocolError);

    const withoutSecret = new ModelGateway({
      config,
      snapshots: new SnapshotWriter({ store }),
      transport,
      secrets: { resolve: () => undefined },
    });
    await expect(
      withoutSecret.complete(run, [{ role: 'user', content: 'hi' }]),
    ).resolves.toMatchObject({ ok: false, code: 'CONFIG_INVALID', retryable: false });
    expect(transport.requests).toHaveLength(0);
  });

  it('reports a provider failure without hiding it', async () => {
    const run = configure();
    const failing = new ModelGateway({
      config,
      snapshots: new SnapshotWriter({ store }),
      transport: new StubTransport('error'),
      secrets: { resolve: () => 'sk-test' },
    });
    await expect(failing.complete(run, [{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('tests a configured provider against the live document', async () => {
    config.upsertProvider(provider());
    const result = await gateway.testConnection(PROVIDER_ID, MODEL_ID);
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const unknown = await gateway.testConnection(PROVIDER_ID, 'nope');
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain('not configured');
  });
});
