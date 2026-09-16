import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXEC_IMAGE } from '../src/doctor.js';

/**
 * Optional-container-environment evidence: the execution image must really enforce the
 * boundary the container path relies on — read-only root filesystem, read-only source
 * mounts, non-root uid, dropped capabilities, no network, pid/memory limits.
 *
 * Host-first revision: this is the **optional project run environment**
 * (`docs/architecture/execution.md` §1), no longer the default execution base, so a machine
 * without Docker or without the image skips the suite instead of failing the release. The
 * guardrails that always hold are proven elsewhere (path boundary, hard-refusal list, audit);
 * these are negative tests for the container path when it is enabled, each with a positive
 * control next to it so a broken invocation cannot pass vacuously.
 */
const run = promisify(execFile);
const IMAGE = process.env.AGENTDEV_EXEC_IMAGE ?? EXEC_IMAGE;

const HARDENING = [
  '--rm',
  '--read-only',
  '--tmpfs',
  '/tmp:rw,noexec,nosuid,size=256m',
  '--cap-drop=ALL',
  '--security-opt',
  'no-new-privileges',
  '--pids-limit',
  '256',
  '--memory',
  '2g',
  '--cpus',
  '2',
  '--network',
  'none',
];

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function docker(args: readonly string[]): Promise<Result> {
  try {
    const { stdout, stderr } = await run('docker', [...args], { timeout: 120_000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
    };
  }
}

/** Runs one shell command inside the hardened container. */
function inContainer(command: string, extra: readonly string[] = []): Promise<Result> {
  return docker([...['run'], ...HARDENING, ...extra, IMAGE, '-lc', command]);
}

let shared: string;
let readOnly: string;

// Docker is an optional capability now, so its absence (or a missing image) skips the
// suite rather than failing readiness. Probed once at module load.
const dockerReachable = (await docker(['version', '--format', '{{.Server.Version}}'])).code === 0;
const imagePresent = dockerReachable && (await docker(['image', 'inspect', IMAGE])).code === 0;

beforeAll(async () => {
  shared = await mkdtemp(join(tmpdir(), 'agentdev-image-'));
  await chmod(shared, 0o777);
  readOnly = await mkdtemp(join(tmpdir(), 'agentdev-image-ro-'));
  await chmod(readOnly, 0o777);
});

afterAll(async () => {
  await rm(shared, { recursive: true, force: true });
  await rm(readOnly, { recursive: true, force: true });
});

describe.skipIf(!imagePresent)('execution image (optional container run environment)', () => {
  it('runs as the non-root execution account', async () => {
    const result = await inContainer('id -u');
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('10001');
  });

  it('carries the pinned runtime and build tools', async () => {
    const result = await inContainer('node --version && git --version && make --version | head -1');
    expect(result.stdout).toContain('v24.');
    expect(result.stdout).toContain('git version');
    expect(result.stdout).toContain('GNU Make');
  });

  it('keeps the root filesystem read-only', async () => {
    const result = await inContainer('touch /agentdev-must-not-exist');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Read-only file system');
  });

  it('allows writes only inside the tmpfs', async () => {
    const result = await inContainer('echo ok > /tmp/scratch && cat /tmp/scratch');
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('ok');
  });

  it('refuses writes on a read-only source mount', async () => {
    const result = await inContainer('echo x > /workspace/created-by-test', [
      '--volume',
      `${readOnly}:/workspace:ro`,
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Read-only file system');
  });

  it('permits writes on a writable mount, proving the check above is not vacuous', async () => {
    const result = await inContainer(
      'echo x > /workspace/created-by-test && cat /workspace/created-by-test',
      ['--volume', `${shared}:/workspace:rw`],
    );
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('x');
  });

  it('drops every Linux capability', async () => {
    const result = await inContainer('grep CapEff /proc/self/status');
    expect(result.stdout).toContain('0000000000000000');
  });

  it('has no network access but a working name resolver', async () => {
    // Positive control first: the probe tool itself works, so the failure below
    // is the missing network rather than a missing binary.
    const local = await inContainer('getent hosts localhost');
    expect(local.code).toBe(0);
    expect(local.stdout).toContain('localhost');

    const external = await inContainer('getent hosts registry.npmjs.org');
    expect(external.code).not.toBe(0);
  });

  it('applies the pid and memory limits', async () => {
    const pids = await inContainer('cat /sys/fs/cgroup/pids.max');
    const memory = await inContainer('cat /sys/fs/cgroup/memory.max');
    expect(pids.stdout.trim()).toBe('256');
    expect(memory.stdout.trim()).toBe('2147483648');
  });
});
