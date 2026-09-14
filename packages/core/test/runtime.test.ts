/**
 * Runtime home tests (WP-11 A1).
 *
 * These cover the properties `agentdev start/stop/status` depend on: only one live
 * daemon per home, a stale lock that a crash left behind can be taken over, the live
 * record round-trips, every artifact is private (0600) and the registry is keyed by
 * canonical root so `open` is idempotent.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNTIME_PROTOCOL_VERSION, runtimePaths, type RuntimeRecord } from '@agentdev/contracts';
import {
  RuntimeHomeError,
  acquireDaemonLock,
  clearRuntimeRecord,
  ensureRuntimeHome,
  isProcessAlive,
  readDaemonLock,
  readProjectRegistry,
  readRuntimeRecord,
  registerProject,
  releaseDaemonLock,
  unregisterProject,
  writeRuntimeRecord,
} from '../src/index.js';

let home: string;
const projectId = 'b'.repeat(32);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentdev-runtime-test-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('ensureRuntimeHome', () => {
  it('creates the home, logs and projects directories as 0700', () => {
    const paths = ensureRuntimeHome(home);
    for (const dir of [paths.home, paths.logs, paths.projectsDir]) {
      expect(statSync(dir).isDirectory()).toBe(true);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });
});

describe('single-instance lock', () => {
  it('grants the first owner and refuses a second live owner', () => {
    const first = acquireDaemonLock(home, { pid: process.pid });
    expect(first.acquired).toBe(true);
    if (!first.acquired) throw new Error('unreachable');
    expect(first.lock.epoch).toBe(1);
    expect(first.replacedStale).toBe(false);

    // The test process itself is alive, so the lock is genuinely held.
    const second = acquireDaemonLock(home, { pid: process.pid + 1 });
    expect(second.acquired).toBe(false);
    if (second.acquired) throw new Error('unreachable');
    expect(second.lock.pid).toBe(process.pid);
    expect(readFileSync(runtimePaths(home).lock, 'utf8')).toContain(
      `"pid": ${String(process.pid)}`,
    );
  });

  it('takes over a lock whose process is gone, with the next epoch', () => {
    // A pid that cannot exist: the kernel's pid_max is far below this on every
    // supported platform, so `isProcessAlive` reports false deterministically.
    writeFileSync(
      runtimePaths(home).lock,
      `${JSON.stringify({ v: 1, pid: 9_999_999, epoch: 4, startedAt: '2026-01-01T00:00:00.000Z' })}\n`,
      { mode: 0o600 },
    );
    expect(isProcessAlive(9_999_999)).toBe(false);
    const taken = acquireDaemonLock(home, { pid: process.pid });
    expect(taken.acquired).toBe(true);
    if (!taken.acquired) throw new Error('unreachable');
    expect(taken.replacedStale).toBe(true);
    expect(taken.lock.epoch).toBe(5);
  });

  it('only the owning epoch can release the lock', () => {
    const taken = acquireDaemonLock(home, { pid: process.pid });
    if (!taken.acquired) throw new Error('unreachable');
    expect(releaseDaemonLock(home, taken.lock.epoch + 1)).toBe(false);
    expect(readDaemonLock(home)?.epoch).toBe(taken.lock.epoch);
    expect(releaseDaemonLock(home, taken.lock.epoch)).toBe(true);
    expect(readDaemonLock(home)).toBeNull();
  });

  it('refuses a malformed lock instead of starting a second daemon', () => {
    writeFileSync(runtimePaths(home).lock, '{"v":1,"pid":1}\n', { mode: 0o600 });
    expect(() => readDaemonLock(home)).toThrowError(RuntimeHomeError);
  });
});

describe('live runtime record', () => {
  // Built per test: the home directory only exists once `beforeEach` has run.
  const recordOf = (runtimeHome: string): RuntimeRecord => ({
    v: RUNTIME_PROTOCOL_VERSION,
    pid: 1234,
    epoch: 1,
    startedAt: '2026-09-14T00:00:00.000Z',
    version: '0.0.0',
    home: runtimeHome,
    daemon: { host: '127.0.0.1', port: 4318 },
    web: { host: '127.0.0.1', port: 4317 },
    projects: [projectId],
  });

  it('round-trips as a 0600 file and clears to null', () => {
    const record = recordOf(home);
    expect(readRuntimeRecord(home)).toBeNull();
    writeRuntimeRecord(home, record);
    expect(statSync(runtimePaths(home).runtime).mode & 0o777).toBe(0o600);
    expect(readRuntimeRecord(home)).toEqual(record);
    clearRuntimeRecord(home);
    expect(readRuntimeRecord(home)).toBeNull();
  });

  it('refuses a record that does not match the contract', () => {
    writeFileSync(runtimePaths(home).runtime, '{"pid":1}', { mode: 0o600 });
    expect(() => readRuntimeRecord(home)).toThrowError(/does not match the contract/u);
  });
});

describe('project registry', () => {
  it('starts empty, registers idempotently and unregisters', () => {
    expect(readProjectRegistry(home).projects).toEqual([]);
    registerProject(home, { root: '/repo', projectId, at: '2026-09-14T00:00:00.000Z' });
    registerProject(home, { root: '/repo', projectId, at: '2026-09-14T01:00:00.000Z' });
    const registry = readProjectRegistry(home);
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0]).toMatchObject({
      root: '/repo',
      projectId,
      addedAt: '2026-09-14T00:00:00.000Z',
      lastOpenedAt: '2026-09-14T01:00:00.000Z',
    });
    expect(unregisterProject(home, '/repo').projects).toEqual([]);
  });

  it('keeps the registry file private', () => {
    registerProject(home, { root: '/repo', projectId, at: '2026-09-14T00:00:00.000Z' });
    expect(statSync(runtimePaths(home).projects).mode & 0o777).toBe(0o600);
  });
});
