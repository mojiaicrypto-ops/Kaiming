import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTEXT_LIMITS, type ProviderInput } from '@agentdev/contracts';
import { ProjectStore as Store, type ProjectStore } from '@agentdev/storage';
import {
  ConfigError,
  ConfigStore,
  SnapshotWriter,
  parseToml,
  stringifyToml,
} from '../src/index.js';

/** TOML subset used for `config.toml` (`ARCHITECTURE.md` §5). */
describe('toml subset', () => {
  it('round-trips tables, dotted keys, arrays and arrays of tables', () => {
    const source = [
      'version = 3',
      'title = "a \\"quoted\\" value" # trailing comment',
      'enabled = true',
      'ratio = 1.5',
      'tags = ["a", "b"]',
      '',
      '[defaultProfile]',
      'modelId = "m1"',
      'contextLimit = 64000',
      '',
      '[[providers]]',
      'providerId = "p1"',
      'type = "openai-compatible"',
      'baseUrl = "http://127.0.0.1:1234"',
      'enabled = true',
      'models = ["m1"]',
      '',
      '[[providers]]',
      'providerId = "p2"',
      'type = "anthropic"',
      'baseUrl = "https://example.test"',
      'enabled = false',
      'models = []',
      '',
    ].join('\n');
    const parsed = parseToml(source);
    expect(parsed['version']).toBe(3);
    expect(parsed['title']).toBe('a "quoted" value');
    expect(parsed['enabled']).toBe(true);
    expect(parsed['ratio']).toBe(1.5);
    expect(parsed['tags']).toEqual(['a', 'b']);
    expect(parsed['defaultProfile']).toEqual({ modelId: 'm1', contextLimit: 64_000 });
    const providers = parsed['providers'];
    expect(Array.isArray(providers)).toBe(true);
    expect((providers as unknown[]).length).toBe(2);
    expect((providers as { providerId: string }[])[1]?.providerId).toBe('p2');

    // Serializing and re-parsing must be lossless for the subset.
    expect(parseToml(stringifyToml(parsed))).toEqual(parsed);
  });

  it('rejects anything outside the subset instead of guessing', () => {
    expect(() => parseToml('a = "x"\n[[a]]\nb = 1')).toThrowError(/not an array of tables/);
    expect(() => parseToml('a = [[1], [2]]')).toThrowError(/nested arrays/);
    expect(() => parseToml('a = "unterminated')).toThrowError(/unterminated string/);
    expect(() => parseToml('a = 2026-09-11')).toThrowError(/unsupported value/);
    expect(() => parseToml('a = """multi"""')).toThrowError(/multi-line/);
    expect(() => parseToml('a = "1"\na = "2"')).toThrowError(/duplicate key/);
    expect(() => parseToml('key without equals')).toThrowError(/expected "key = value"/);
    expect(() => parseToml('a = "x"\n[a]\nb = 1')).toThrowError(/not a table/);
  });
});

const ROOT = '/tmp/agentdev-config-root';
const MODEL_ID = 'test-model';
const PROVIDER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70';
const OFF_PROVIDER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71';

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

describe('role configuration (AC-043, AC-044)', () => {
  let globalDir: string;
  let projectRoot: string;
  let store: ProjectStore;
  let writer: SnapshotWriter;
  let config: ConfigStore;

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), 'agentdev-config-global-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'agentdev-config-project-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-config-store-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    writer = new SnapshotWriter({ store });
    config = ConfigStore.open({ globalDir, projectRoot, snapshots: writer });
  });

  afterEach(() => {
    store.close();
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('inherits run → project → global role → global default in order', () => {
    config.upsertProvider(provider());
    // An operator may also write the file directly; a global default model, a
    // global review override and a project override exercise every layer.
    const written = {
      version: 1,
      defaultProfile: {
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        reasoning: 'low',
        skills: [],
        toolSubset: ['read'],
        contextLimit: 50_000,
      },
      roleProfiles: { review: { reasoning: 'medium', contextLimit: 20_000 } },
      providers: config.global().providers,
      limits: {},
      policy: config.global().policy,
    };
    writeFileSync(join(globalDir, 'config.toml'), stringifyToml(written as never));
    config = ConfigStore.open({ globalDir, projectRoot, snapshots: writer });
    config.update('project', { roleOverrides: { review: { modelId: MODEL_ID } } });

    const review = config.resolve('review');
    expect(review.ok).toBe(true);
    if (!review.ok) throw new Error(review.reason);
    expect(review.resolution.profile).toMatchObject({
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      reasoning: 'medium', // global role layer
      toolSubset: ['read'], // global default layer
      contextLimit: 20_000, // global role layer
    });
    expect(review.resolution.sources).toMatchObject({
      reasoning: 'globalRole',
      toolSubset: 'globalDefault',
      modelId: 'project',
    });

    const withRun = config.resolve('review', { reasoning: 'off', contextLimit: 10_000 });
    if (!withRun.ok) throw new Error(withRun.reason);
    expect(withRun.resolution.sources).toMatchObject({ reasoning: 'run', contextLimit: 'run' });
    expect(withRun.resolution.profile.reasoning).toBe('off');

    // Effective context = min(profile, window − output − reserved).
    expect(withRun.resolution.effectiveContextLimit).toBe(
      Math.min(10_000, 200_000 - 8_000 - CONTEXT_LIMITS.reservedTokens),
    );
  });

  it('blocks a role whose model is missing or unsupported instead of downgrading', () => {
    const noModel = config.resolve('backend');
    expect(noModel).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });

    config.upsertProvider(provider());
    config.update('global', {
      roleOverrides: {
        backend: {
          providerId: PROVIDER_ID,
          modelId: MODEL_ID,
          reasoning: 'high', // the model only declares off/low/medium
          skills: [],
          toolSubset: [],
          contextLimit: 64_000,
        },
      },
    });
    const unsupported = config.resolve('backend');
    expect(unsupported).toMatchObject({ ok: false, code: 'CONFIG_INVALID' });
    if (!unsupported.ok) expect(unsupported.reason).toMatch(/does not support reasoning high/);

    // An unknown provider is a missing model, not a silent fallback.
    config.update('global', {
      roleOverrides: { test: { providerId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e72' } },
    });
    const unknownProvider = config.resolve('test');
    expect(unknownProvider).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });

    config.upsertProvider(provider({ providerId: OFF_PROVIDER_ID, enabled: false }));
    config.update('global', { roleOverrides: { test: { providerId: OFF_PROVIDER_ID } } });
    expect(config.resolve('test')).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  });

  it('freezes a profile into an immutable snapshot and keeps it stable', () => {
    config.upsertProvider(provider());
    config.update('global', {
      roleOverrides: {
        planning: {
          providerId: PROVIDER_ID,
          modelId: MODEL_ID,
          reasoning: 'medium',
          skills: ['docs'],
          toolSubset: ['read'],
          contextLimit: 64_000,
        },
      },
    });
    const frozen = config.freeze('planning');
    const snapshot = writer.read(frozen.snapshotId);
    expect(snapshot?.type).toBe('config');
    expect(snapshot?.payload).toMatchObject({ role: 'planning', effectiveContextLimit: 64_000 });

    // Editing configuration afterwards must not touch the frozen payload.
    config.update('global', { roleOverrides: { planning: { reasoning: 'off' } } });
    const reloaded = config.readFrozen(frozen.snapshotId);
    expect(reloaded?.profile.reasoning).toBe('medium');
    const now = config.resolve('planning');
    if (!now.ok) throw new Error(now.reason);
    expect(now.resolution.profile.reasoning).toBe('off');

    // Immutability is enforced by storage, not by convention.
    expect(() =>
      store.db
        .prepare('UPDATE snapshot SET payload = ? WHERE hash = ?')
        .run('{}', frozen.snapshotId),
    ).toThrowError(/immutable/);
  });

  it('validates patch values and never widens fixed limits', () => {
    expect(() => config.update('global', { limits: { globalConcurrentRunners: 99 } })).toThrowError(
      ConfigError,
    );
    // A fixed constant cannot be smuggled in through the file either.
    writeFileSync(join(globalDir, 'config.toml'), '[limits]\ntaskWriterCount = 2\n');
    expect(() => ConfigStore.open({ globalDir, projectRoot, snapshots: writer })).toThrowError(
      /is invalid/,
    );
    rmSync(join(globalDir, 'config.toml'), { force: true });

    config.update('global', { limits: { globalConcurrentRunners: 4 } });
    config.update('project', { limits: { globalConcurrentRunners: 2 } });
    expect(config.effectiveLimits().globalConcurrentRunners).toBe(2);
    // A fixed limit still resolves to its documented value.
    expect(config.effectiveLimits().reviewRepairRounds).toBe(3);
    expect(config.versionOf('global')).toBe(1);
    expect(config.versionOf('project')).toBe(1);
  });

  it('refuses an unreadable file instead of starting with defaults', () => {
    writeFileSync(join(globalDir, 'config.toml'), 'roleProfiles = 3\n');
    expect(() => ConfigStore.open({ globalDir, projectRoot, snapshots: writer })).toThrowError(
      /is invalid/,
    );
    writeFileSync(join(globalDir, 'config.toml'), 'broken = [\n');
    expect(() => ConfigStore.open({ globalDir, projectRoot, snapshots: writer })).toThrowError(
      /not readable TOML/,
    );
  });

  it('persists across reopen with the same versions', () => {
    config.upsertProvider(provider());
    config.update('global', { limits: { shellTimeoutSec: 300 } });
    const reopened = ConfigStore.open({ globalDir, projectRoot, snapshots: writer });
    expect(reopened.global().providers).toHaveLength(1);
    expect(reopened.provider(PROVIDER_ID)?.models[0]?.id).toBe(MODEL_ID);
    expect(reopened.effectiveLimits().shellTimeoutSec).toBe(300);
    expect(reopened.versionOf('global')).toBe(2);
    expect(readFileSync(join(globalDir, 'config.toml'), 'utf8')).toContain('[[providers]]');
  });
});
