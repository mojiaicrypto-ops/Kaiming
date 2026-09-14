/**
 * Runtime home contract tests (WP-11 A1).
 *
 * The runtime records are read by two different programs (the daemon host and the
 * CLI), so the shapes have to reject anything unexpected instead of coercing it: a
 * hand-edited `runtime.json` must fail loudly rather than make `status` lie.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENTDEV_HOME_ENV,
  DEFAULT_DAEMON_PORT,
  DEFAULT_LISTENERS,
  DEFAULT_WEB_PORT,
  RUNTIME_HOME_DIR,
  RUNTIME_PROTOCOL_VERSION,
  daemonLockSchema,
  emptyProjectRegistry,
  projectRegistrySchema,
  projectStateDir,
  runtimeHomePath,
  runtimePaths,
  runtimeRecordSchema,
} from '../src/index.js';

const hexId = 'a'.repeat(32);

describe('runtimeHomePath', () => {
  it('defaults to ~/.agentdev inside the user home', () => {
    expect(runtimeHomePath({}, '/Users/agent')).toBe(`/Users/agent/${RUNTIME_HOME_DIR}`);
  });

  it('honours AGENTDEV_HOME so tests never touch the user state', () => {
    expect(runtimeHomePath({ [AGENTDEV_HOME_ENV]: '/tmp/agentdev-home' }, '/Users/agent')).toBe(
      '/tmp/agentdev-home',
    );
    // An empty override is ignored instead of producing a relative path.
    expect(runtimeHomePath({ [AGENTDEV_HOME_ENV]: '   ' }, '/Users/agent')).toBe(
      '/Users/agent/.agentdev',
    );
  });
});

describe('runtimePaths', () => {
  it('exposes one path per documented file', () => {
    const paths = runtimePaths('/home/.agentdev');
    expect(paths).toMatchObject({
      home: '/home/.agentdev',
      installationCredential: '/home/.agentdev/installation-token',
      runtime: '/home/.agentdev/runtime.json',
      lock: '/home/.agentdev/daemon.lock',
      projects: '/home/.agentdev/projects.json',
      config: '/home/.agentdev/config.toml',
      logs: '/home/.agentdev/logs',
    });
    expect(projectStateDir('/home/.agentdev', hexId)).toBe(`/home/.agentdev/projects/${hexId}`);
  });

  it('does not double a trailing slash', () => {
    expect(runtimePaths('/home/.agentdev/').runtime).toBe('/home/.agentdev/runtime.json');
  });
});

describe('runtime record schemas', () => {
  const record = {
    v: RUNTIME_PROTOCOL_VERSION,
    pid: 4321,
    epoch: 2,
    startedAt: '2026-09-14T00:00:00.000Z',
    version: '0.0.0',
    home: '/home/.agentdev',
    daemon: { host: '127.0.0.1', port: DEFAULT_LISTENERS.daemon.port },
    web: { host: '127.0.0.1', port: DEFAULT_LISTENERS.web.port },
    projects: [hexId],
  };

  it('accepts the documented record and refuses unknown keys', () => {
    expect(runtimeRecordSchema.parse(record)).toEqual(record);
    expect(() => runtimeRecordSchema.parse({ ...record, extra: true })).toThrow();
  });

  it('refuses a non-loopback listener and an out-of-range port', () => {
    expect(() =>
      runtimeRecordSchema.parse({ ...record, daemon: { host: '0.0.0.0', port: 4318 } }),
    ).toThrow();
    expect(() =>
      runtimeRecordSchema.parse({ ...record, daemon: { host: '127.0.0.1', port: 70_000 } }),
    ).toThrow();
  });

  it('keeps the documented defaults visible to callers', () => {
    expect(DEFAULT_LISTENERS.daemon.port).toBe(DEFAULT_DAEMON_PORT);
    expect(DEFAULT_LISTENERS.web.port).toBe(DEFAULT_WEB_PORT);
    expect(DEFAULT_WEB_PORT).toBe(4317);
    expect(DEFAULT_DAEMON_PORT).toBe(4318);
  });

  it('accepts a headless runtime without the BFF', () => {
    expect(runtimeRecordSchema.parse({ ...record, web: null }).web).toBeNull();
  });

  it('requires a positive pid and epoch in the lock', () => {
    expect(
      daemonLockSchema.parse({
        v: RUNTIME_PROTOCOL_VERSION,
        pid: 1,
        epoch: 1,
        startedAt: '2026-09-14T00:00:00.000Z',
      }).epoch,
    ).toBe(1);
    expect(() =>
      daemonLockSchema.parse({
        v: RUNTIME_PROTOCOL_VERSION,
        pid: 0,
        epoch: 1,
        startedAt: '2026-09-14T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('project registry schema', () => {
  it('starts empty and only accepts a 32-hex project id', () => {
    expect(emptyProjectRegistry()).toEqual({ v: RUNTIME_PROTOCOL_VERSION, projects: [] });
    expect(() =>
      projectRegistrySchema.parse({
        v: RUNTIME_PROTOCOL_VERSION,
        projects: [{ root: '/repo', projectId: 'NOT-HEX', addedAt: 'a', lastOpenedAt: 'b' }],
      }),
    ).toThrow();
  });

  it('accepts a registered root', () => {
    const registry = projectRegistrySchema.parse({
      v: RUNTIME_PROTOCOL_VERSION,
      projects: [
        {
          root: '/repo',
          projectId: hexId,
          addedAt: '2026-09-14T00:00:00.000Z',
          lastOpenedAt: '2026-09-14T00:00:00.000Z',
        },
      ],
    });
    expect(registry.projects).toHaveLength(1);
  });
});
