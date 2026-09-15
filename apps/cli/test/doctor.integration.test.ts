import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigStore } from '@agentdev/core';
import {
  DEFAULT_PORTS,
  EXEC_IMAGE,
  buildDoctorReport,
  probeDirectory,
  probeImageCapability,
  probePnpm,
  probePolicy,
  probePort,
  probeRuntime,
  renderDoctorReport,
  repoRootFrom,
} from '../src/doctor.js';

const exec = promisify(execFile);

/**
 * AC-048 evidence: the doctor probe must report the real environment.
 *
 * These assertions run against this machine, so they intentionally fail when a
 * required capability is missing — that failure is the product behaviour the
 * acceptance case asks for ("缺环境拒绝").
 */
const repoRoot = repoRootFrom(import.meta.url);
let dataDir: string;
let busyServer: Awaited<ReturnType<typeof listen>>;
let busyPort: number;

function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'agentdev-doctor-'));
  busyServer = await listen();
  busyPort = busyServer.port;
});

afterAll(async () => {
  await busyServer.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('probe primitives', () => {
  it('reports a listening port as in use and an unbound one as free', async () => {
    await expect(probePort(busyPort)).resolves.toEqual({ port: busyPort, inUse: true });
    const free = await listen();
    const freePort = free.port;
    await free.close();
    await expect(probePort(freePort)).resolves.toEqual({ port: freePort, inUse: false });
  });

  it('reports a writable directory', async () => {
    await expect(probeDirectory(dataDir)).resolves.toMatchObject({ writable: true });
  });

  it('reports a missing directory as not writable', async () => {
    const probe = await probeDirectory(join(dataDir, 'does-not-exist', 'deeper'));
    expect(probe.writable).toBe(false);
  });

  it('finds the pinned pnpm', async () => {
    const probe = await probePnpm();
    expect(probe.status).toBe('ok');
    expect(probe.version).toBe('12.3.4');
  });
});

describe('doctor report', () => {
  it('reports this workspace as execution ready', async () => {
    const report = await buildDoctorReport({
      startDir: repoRoot,
      dataDir,
      ports: [...DEFAULT_PORTS, busyPort],
    });

    expect(report.node.status).toBe('ok');
    expect(report.pnpm.status).toBe('ok');
    expect(report.git.status).toBe('ok');
    expect(report.pi).toMatchObject({ status: 'ok', version: '0.85.1' });
    expect(report.docker.status).toBe('ok');
    expect(report.docker.imageId).toBeDefined();
    expect(report.directories.every((dir) => dir.writable)).toBe(true);
    expect(report.ports.find((port) => port.port === busyPort)?.inUse).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.executionReady).toBe(true);
  });

  it('refuses readiness when the execution image is absent', async () => {
    const report = await buildDoctorReport({
      startDir: repoRoot,
      dataDir,
      ports: [],
      imageTag: `${EXEC_IMAGE}-definitely-missing`,
    });
    expect(report.executionReady).toBe(false);
    expect(report.blockers.some((entry) => entry.includes('definitely-missing'))).toBe(true);
  });

  it('refuses an image that carries the tag but not the execution contract', async () => {
    const tag = 'agentdev/exec:doctor-negative';
    // `docker import` produces a runnable image with no node, no bash and no
    // non-root user: exactly the case a tag-only check would accept.
    const tar = join(dataDir, 'empty.tar');
    await writeFile(tar, '');
    await exec('docker', ['import', tar, tag], { timeout: 60_000 });
    try {
      const reason = await probeImageCapability(tag);
      expect(reason).toBeDefined();

      const report = await buildDoctorReport({
        startDir: repoRoot,
        dataDir,
        ports: [],
        imageTag: tag,
      });
      expect(report.docker.imageId).toBeDefined();
      expect(report.docker.status).toBe('mismatch');
      expect(report.executionReady).toBe(false);
    } finally {
      await exec('docker', ['rmi', '--force', tag], { timeout: 60_000 }).catch(() => undefined);
    }
  });

  it('refuses readiness when the data directory cannot be created', async () => {
    // A regular file stands in the way, so the directory cannot be created.
    const blocked = join(dataDir, 'blocker');
    await writeFile(blocked, 'not a directory', 'utf8');
    const report = await buildDoctorReport({
      startDir: repoRoot,
      dataDir: join(blocked, 'nested'),
      ports: [],
    });
    expect(report.executionReady).toBe(false);
    expect(report.blockers.some((entry) => entry.includes('not writable'))).toBe(true);
  });

  it('reports the runtime home: missing credential, live daemon and an insecure mode', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agentdev-doctor-runtime-'));

    // A fresh home has no credential yet; the daemon creates it on first start.
    const fresh = probeRuntime(home);
    expect(fresh).toMatchObject({ home, installationToken: 'missing', running: false });

    // A 0600 credential plus a live record naming this process.
    await writeFile(join(home, 'installation-token'), 'token\n', { mode: 0o600 });
    await writeFile(
      join(home, 'runtime.json'),
      JSON.stringify({
        v: 1,
        pid: process.pid,
        epoch: 3,
        startedAt: '2026-09-14T00:00:00.000Z',
        version: '0.0.0',
        home,
        admin: { host: '127.0.0.1', port: 4319 },
        instances: [],
      }),
      { mode: 0o600 },
    );
    expect(probeRuntime(home)).toMatchObject({
      installationToken: 'ok',
      running: true,
      epoch: 3,
      instances: 0,
    });

    // A world-readable credential is a compromised installation, not a warning.
    await chmod(join(home, 'installation-token'), 0o644);
    const insecure = probeRuntime(home);
    expect(insecure.installationToken).toBe('insecure');
    const report = await buildDoctorReport({ startDir: repoRoot, dataDir: home, ports: [] });
    expect(report.blockers.some((entry) => entry.includes('readable by others'))).toBe(true);

    // A 0600 *directory* is not a usable credential: a failed `start` leaves one behind
    // (`enforcePrivateMode` chmods whatever is at the path to 0600 before reading it), and
    // doctor used to call it `ok` while the next `start` failed with EISDIR (T8b P3-2).
    await rm(join(home, 'installation-token'), { force: true });
    await mkdir(join(home, 'installation-token'), { recursive: true, mode: 0o700 });
    await chmod(join(home, 'installation-token'), 0o600);
    expect(probeRuntime(home).installationToken).toBe('insecure');

    // A malformed record is reported instead of pretending the runtime is healthy.
    await writeFile(join(home, 'runtime.json'), '{"pid":1}\n', { mode: 0o600 });
    const broken = probeRuntime(home);
    expect(broken.running).toBe(false);
    expect(broken.detail).toContain('unreadable');
    // The human-readable report carries the same detail as `--json` (T8b P3-2).
    const rendered = renderDoctorReport(
      await buildDoctorReport({ startDir: repoRoot, dataDir: home, ports: [] }),
    );
    expect(rendered).toContain('runtime.json is unreadable');

    await rm(home, { recursive: true, force: true });
  });
});

/**
 * AC-048 / 附录 A.7 — the doctor must make a non-`strict` sensitive-file tier visible.
 *
 * "不得静默开启": a project whose `.agentdev/config.toml` allows the application-config
 * subset is reported as such, and the absence of an override reads as the documented global
 * default rather than as an error.
 */
describe('doctor policy probe', () => {
  it('reports strict as the default when the project has no override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentdev-doctor-policy-'));
    try {
      const probe = probePolicy(root);
      expect(probe.configPolicy).toBe('strict');
      expect(probe.source).toBe('global');
      expect(probe.allowsApplicationConfig).toBe(false);
      const rendered = renderDoctorReport(
        await buildDoctorReport({ startDir: root, dataDir, ports: [] }),
      );
      expect(rendered).toContain('configPolicy strict');
      expect(rendered).not.toContain('本项目允许读取应用配置');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks a project that allows the application-config subset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentdev-doctor-policy-test-'));
    try {
      // The fixture is written by the real `ConfigStore`, so its shape is the one the
      // product writes rather than a hand-rolled TOML the doctor might accept by accident.
      const store = ConfigStore.open({ globalDir: root, projectRoot: root });
      store.update('project', {
        permissionMode: 'autonomous',
        configPolicy: 'test',
      });
      const probe = probePolicy(root);
      expect(probe.configPolicy).toBe('test');
      expect(probe.source).toBe('project');
      expect(probe.permissionMode).toBe('autonomous');
      expect(probe.allowsApplicationConfig).toBe(true);
      const rendered = renderDoctorReport(
        await buildDoctorReport({ startDir: root, dataDir, ports: [] }),
      );
      expect(rendered).toContain('WARN policy');
      expect(rendered).toContain('configPolicy test (project)');
      expect(rendered).toContain('本项目允许读取应用配置');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('names an unreadable project policy instead of silently defaulting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentdev-doctor-policy-bad-'));
    try {
      await mkdir(join(root, '.agentdev'), { recursive: true });
      await writeFile(join(root, '.agentdev', 'config.toml'), 'policy = "not a table"\n', 'utf8');
      const probe = probePolicy(root);
      expect(probe.configPolicy).toBe('strict');
      expect(probe.detail).toContain('config.toml');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
