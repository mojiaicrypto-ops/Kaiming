/**
 * Environment probing for `agentdev doctor`.
 *
 * AC-048 ("Workspace边界") requires the product to refuse a missing
 * environment, and its evidence line names `doctor` plus the container checks.
 * Every probe here reports what it actually observed: a probe that cannot run
 * returns `unavailable`, never a passing value.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NODE_MINIMUM, PACKAGE_MANAGER, satisfiesMinimum } from '@agentdev/contracts';

const run = promisify(execFile);

export type ProbeStatus = 'ok' | 'mismatch' | 'unavailable';

export interface VersionProbe {
  readonly status: ProbeStatus;
  readonly version?: string | undefined;
  readonly expected?: string | undefined;
  readonly detail?: string | undefined;
}

export interface DockerProbe extends VersionProbe {
  /** Digest of the fixed execution image, when it exists locally. */
  readonly imageDigest?: string | undefined;
  readonly imageId?: string | undefined;
  readonly imageTag: string;
}

export interface DirectoryProbe {
  readonly path: string;
  readonly writable: boolean;
  readonly detail?: string | undefined;
}

export interface PortProbe {
  readonly port: number;
  readonly inUse: boolean;
}

export interface DoctorReport {
  readonly node: VersionProbe;
  readonly pnpm: VersionProbe & { readonly path?: string | undefined };
  readonly git: VersionProbe;
  readonly pi: VersionProbe & { readonly path?: string | undefined };
  readonly docker: DockerProbe;
  readonly directories: readonly DirectoryProbe[];
  readonly ports: readonly PortProbe[];
  /** `true` only when every capability an Attempt needs is really present. */
  readonly executionReady: boolean;
  readonly blockers: readonly string[];
}

export const DEFAULT_PORTS = [4317, 4318] as const;
export const EXEC_IMAGE = 'agentdev/exec:0.0.0';

async function version(cmd: string, args: readonly string[]): Promise<VersionProbe> {
  try {
    const { stdout } = await run(cmd, [...args], { timeout: 15_000 });
    return { status: 'ok', version: stdout.trim().split('\n')[0]?.trim() };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Resolves the installed Pi SDK version by reading its package manifest. */
export async function resolvePiSdk(startDir: string): Promise<{
  version?: string | undefined;
  path?: string | undefined;
  error?: string | undefined;
}> {
  const candidates = ['packages/pi-runtime/node_modules', 'node_modules'];
  let dir = resolve(startDir);
  for (;;) {
    for (const candidate of candidates) {
      const manifest = join(dir, candidate, '@earendil-works/pi-coding-agent/package.json');
      try {
        const parsed = JSON.parse(await readFile(manifest, 'utf8')) as { version?: string };
        return { version: parsed.version, path: manifest };
      } catch {
        // try the next candidate
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return { error: 'the Pi SDK is not installed in this workspace' };
    dir = parent;
  }
}

/** Checks that a directory exists and accepts a write. */
export async function probeDirectory(
  path: string,
  options: { readonly create?: boolean } = {},
): Promise<DirectoryProbe> {
  try {
    if (options.create === true) await mkdir(path, { recursive: true });
    await access(path, constants.W_OK);
    const scratch = await mkdtemp(join(path, '.agentdev-doctor-'));
    try {
      await writeFile(join(scratch, 'probe'), 'ok', 'utf8');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    return { path, writable: true };
  } catch (error) {
    return {
      path,
      writable: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** A TCP probe: a refused connection means nothing is listening. */
export function probePort(port: number, host = '127.0.0.1'): Promise<PortProbe> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ port, host });
    const done = (inUse: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveProbe({ port, inUse });
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Proves the tagged image really runs the execution contract instead of
 * trusting its tag: it must start, carry the pinned Node line and run as the
 * non-root execution account.
 *
 * Scope note: this checks *capability*, not hardening. That the container is
 * additionally read-only, capability-free, network-free and pid/memory limited
 * is proven by `apps/cli/test/container.integration.test.ts`, which runs the
 * image with the exact Supervisor flags.
 *
 * @returns a failure reason, or `undefined` when the probe passes.
 */
export async function probeImageCapability(imageTag: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(
      'docker',
      ['run', '--rm', '--network', 'none', imageTag, '-lc', 'node --version && id -u'],
      { timeout: 60_000 },
    );
    const lines = stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const nodeVersion = lines[0] ?? '';
    const uid = lines[lines.length - 1] ?? '';
    if (!nodeVersion.startsWith('v24.')) {
      return `image reports node ${nodeVersion === '' ? '<none>' : nodeVersion}, expected v24.x`;
    }
    if (uid !== '10001') {
      return `image runs as uid ${uid === '' ? '<unknown>' : uid}, expected 10001`;
    }
    return undefined;
  } catch (error) {
    // Distinguish "the image could not run the probe at all" (missing shell or
    // entrypoint — e.g. an imported empty image) from a wrong-version/wrong-user
    // result, so the operator knows what to fix.
    const stderr = (error as { stderr?: string }).stderr?.trim().split('\n')[0];
    const first = error instanceof Error ? error.message.split('\n')[0] : String(error);
    const detail = stderr === undefined || stderr === '' ? first : stderr;
    return `image cannot run the execution probe: ${detail ?? 'unknown error'}`;
  }
}

/** Probes Docker: daemon reachability, the fixed image digest and its runtime. */
export async function probeDocker(imageTag = EXEC_IMAGE): Promise<DockerProbe> {
  const server = await version('docker', ['version', '--format', '{{.Server.Version}}']);
  if (server.status !== 'ok') {
    return { ...server, expected: 'docker daemon reachable', imageTag };
  }
  try {
    const { stdout } = await run(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}|{{index .RepoDigests 0}}', imageTag],
      { timeout: 15_000 },
    );
    const [imageId = '', repoDigest = ''] = stdout.trim().split('|');
    const imageDigest = repoDigest === '<none>' || repoDigest === '' ? undefined : repoDigest;
    // A tag alone proves nothing: an unrelated image can carry the same tag
    // (observed with `docker import`). The image must run the execution probe.
    const capabilityFailure = await probeImageCapability(imageTag);
    return capabilityFailure === undefined
      ? {
          status: 'ok',
          version: server.version,
          expected: 'docker daemon reachable',
          imageTag,
          imageId,
          imageDigest,
        }
      : {
          status: 'mismatch',
          version: server.version,
          expected: `image ${imageTag} runs the execution contract`,
          imageTag,
          imageId,
          imageDigest,
          detail: capabilityFailure,
        };
  } catch (error) {
    return {
      status: 'mismatch',
      version: server.version,
      expected: `image ${imageTag} built`,
      imageTag,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface DoctorOptions {
  /** Directory the CLI was launched from; used to locate the workspace. */
  readonly startDir?: string;
  /** Data directory checked for writability. */
  readonly dataDir?: string;
  readonly ports?: readonly number[];
  readonly imageTag?: string;
}

/** Runs every probe and derives the readiness verdict. */
export async function buildDoctorReport(options: DoctorOptions = {}): Promise<DoctorReport> {
  const startDir = options.startDir ?? process.cwd();
  const dataDir = options.dataDir ?? join(homedir(), '.agentdev');
  const ports = options.ports ?? DEFAULT_PORTS;

  const nodeProbe: VersionProbe = {
    status: satisfiesMinimum(process.versions.node, NODE_MINIMUM) ? 'ok' : 'mismatch',
    version: process.versions.node,
    expected: `>= ${NODE_MINIMUM}`,
  };

  const pnpmProbe = await probePnpm();
  const gitProbe = await version('git', ['--version']);
  const pi = await resolvePiSdk(startDir);
  const piProbe: VersionProbe & { path?: string | undefined } =
    pi.version === undefined
      ? {
          status: 'unavailable',
          expected: '0.85.1',
          ...(pi.error === undefined ? {} : { detail: pi.error }),
        }
      : {
          status: pi.version === '0.85.1' ? 'ok' : 'mismatch',
          version: pi.version,
          expected: '0.85.1',
          ...(pi.path === undefined ? {} : { path: pi.path }),
        };

  const docker = await probeDocker(options.imageTag ?? EXEC_IMAGE);
  // The product's own data directory is created on first use; the workspace
  // directory must already exist and be writable.
  const directories = [
    await probeDirectory(dataDir, { create: true }),
    await probeDirectory(startDir),
  ];
  const portProbes = await Promise.all(ports.map((port) => probePort(port)));

  const blockers: string[] = [];
  if (nodeProbe.status !== 'ok') blockers.push(`node ${process.versions.node} < ${NODE_MINIMUM}`);
  if (pnpmProbe.status !== 'ok') {
    blockers.push(`pnpm ${pnpmProbe.version ?? 'missing'} != ${PACKAGE_MANAGER.version}`);
  }
  if (gitProbe.status !== 'ok') blockers.push('git is unavailable');
  if (piProbe.status !== 'ok') blockers.push(`Pi SDK ${piProbe.version ?? 'missing'} != 0.85.1`);
  if (docker.status !== 'ok') blockers.push(`docker: ${docker.detail ?? 'daemon unavailable'}`);
  else if (docker.imageId === undefined)
    blockers.push(`docker image ${docker.imageTag} is missing`);
  for (const dir of directories) {
    if (!dir.writable) blockers.push(`directory not writable: ${dir.path}`);
  }

  return {
    node: nodeProbe,
    pnpm: pnpmProbe,
    git: gitProbe,
    pi: piProbe,
    docker,
    directories,
    ports: portProbes,
    executionReady: blockers.length === 0,
    blockers,
  };
}

/**
 * Resolves pnpm.
 *
 * The product pins pnpm exactly, so a different version on `PATH` is a
 * mismatch even when it runs. Note the common failure mode: a corepack shim
 * that cannot launch the pinned pnpm at all.
 */
export async function probePnpm(): Promise<VersionProbe & { path?: string | undefined }> {
  const candidates = [`${homedir()}/.local/bin/pnpm`, 'pnpm'];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ['--version'], { timeout: 15_000 });
      const found = stdout.trim();
      if (found === PACKAGE_MANAGER.version) {
        return {
          status: 'ok',
          version: found,
          expected: PACKAGE_MANAGER.version,
          ...(candidate === 'pnpm' ? {} : { path: candidate }),
        };
      }
      failures.push(`${candidate} reports ${found}`);
    } catch (error) {
      failures.push(
        `${candidate}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );
    }
  }
  return {
    status: 'mismatch',
    expected: PACKAGE_MANAGER.version,
    detail: failures.join('; '),
  };
}

/** Renders the report for humans; the JSON form is the machine-readable one. */
export function renderDoctorReport(report: DoctorReport): string {
  const line = (label: string, probe: VersionProbe, extra = ''): string =>
    `${probe.status === 'ok' ? 'ok  ' : 'FAIL'} ${label.padEnd(10)} ${probe.version ?? '-'}${
      probe.expected === undefined ? '' : ` (expected ${probe.expected})`
    }${extra}${probe.detail === undefined ? '' : ` — ${probe.detail}`}`;

  const lines = [
    'agentdev doctor',
    line('node', report.node),
    line('pnpm', report.pnpm, report.pnpm.path === undefined ? '' : ` [${report.pnpm.path}]`),
    line('git', report.git),
    line('pi-sdk', report.pi, report.pi.path === undefined ? '' : ` [${report.pi.path}]`),
    line(
      'docker',
      report.docker,
      ` [image ${report.docker.imageTag}${
        report.docker.imageId === undefined ? '' : ` ${report.docker.imageId.slice(0, 19)}`
      }${report.docker.imageDigest === undefined ? '' : ` digest ${report.docker.imageDigest}`}]`,
    ),
  ];
  for (const dir of report.directories) {
    lines.push(
      `${dir.writable ? 'ok  ' : 'FAIL'} dir        ${dir.path}${dir.detail === undefined ? '' : ` — ${dir.detail}`}`,
    );
  }
  for (const port of report.ports) {
    lines.push(`info port       ${port.port} ${port.inUse ? 'in use' : 'free'}`);
  }
  lines.push(
    report.executionReady
      ? 'execution ready: yes'
      : `execution ready: no\nblockers:\n${report.blockers.map((entry) => `  - ${entry}`).join('\n')}`,
  );
  return lines.join('\n');
}

/** Absolute path of the repository root, derived from this module's location. */
export function repoRootFrom(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', '..');
}
