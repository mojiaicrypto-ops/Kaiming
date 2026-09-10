import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_PORTS,
  EXEC_IMAGE,
  buildDoctorReport,
  probeDirectory,
  probeImageCapability,
  probePnpm,
  probePort,
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
});
