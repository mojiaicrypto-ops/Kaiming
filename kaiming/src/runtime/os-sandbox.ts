/**
 * OS-level execution sandbox for bash (P3-1).
 *
 * The host fixes a role's policy; the model cannot change it. `auto`/`strict` are fail-closed when
 * the platform backend or its startup probe fails. Only `off` executes unsandboxed, and the caller
 * must show that state as "protection off". This is a filesystem boundary, not malware containment:
 * network, SSH agent and the Docker socket (auto only) stay available.
 *
 * No global singleton and no gitignore emulation: a policy is plain data, resolved per session.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { constants as osConstants, homedir, tmpdir } from 'node:os';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { getShellConfig, type BashOperations } from '@earendil-works/pi-coding-agent';

export type SandboxMode = 'auto' | 'strict' | 'off';
export type SandboxProfileKind = 'read-only' | 'workspace-write' | 'workspace-write-git';
export type SandboxBackend = 'sandbox-exec' | 'bwrap' | 'none';

export interface SandboxStatus {
  readonly mode: SandboxMode;
  readonly backend: SandboxBackend;
  readonly active: boolean;
  /** Why bash is refused / protection is off; null when the sandbox is active. */
  readonly reason: string | null;
}

export interface SandboxPolicy {
  readonly kind: SandboxProfileKind;
  readonly cwd: string;
  /** Directories or exact files denied read/write/list for every role. */
  readonly privatePaths: readonly string[];
  /** Private paths that stay readable (<agentDir>/work). */
  readonly readablePrivatePaths: readonly string[];
  /** Directories writable in addition to the per-session temp dir. */
  readonly writableRoots: readonly string[];
  /** Subpaths under a writable root that are forced read-only (.git, hooks). */
  readonly readOnlySubpaths: readonly string[];
  readonly tempDir: string;
  readonly allowDockerSocket: boolean;
  readonly allowSshAgent: boolean;
  /** Structural slot only: this layer is not an egress control. */
  readonly networkAccess: 'allow';
}

export interface SandboxRuntime {
  readonly mode: SandboxMode;
  readonly status: SandboxStatus;
  readonly privatePaths: readonly string[];
  readonly readablePrivatePaths: readonly string[];
  readonly dataDir: string;
  readonly agentDir: string;
  readonly tempRoot: string;
  readonly envFile?: string;
  readonly shellPath?: string;
}

export interface SandboxRuntimeOptions {
  readonly dataDir: string;
  readonly agentDir: string;
  readonly envFile?: string;
  readonly mode?: SandboxMode;
  readonly tempRoot?: string;
  readonly shellPath?: string;
  readonly backend?: SandboxBackend;
}

interface ExecOptions {
  readonly onData?: (data: Buffer) => void;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export type SandboxExecutor = (
  policy: SandboxPolicy,
  command: string,
  cwd: string,
  options?: Pick<ExecOptions, 'onData' | 'signal' | 'timeout' | 'env'>,
  backend?: SandboxBackend,
) => Promise<{ exitCode: number | null }>;

const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_TIMEOUT_MS = 2_147_483_647;

/** The environment variables a child may inherit. Everything else is dropped. */
const BASE_ENV = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TERM',
  'COLORTERM',
  'TZ',
  'PWD',
  'CI',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'PYTHONPATH',
  'NODE_PATH',
  'NODE_OPTIONS',
  'NPM_CONFIG_PREFIX',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'GOPATH',
  'GOROOT',
  'JAVA_HOME',
  'MAVEN_HOME',
  'GRADLE_HOME',
  'PNPM_HOME',
  'NVM_DIR',
  'BUN_INSTALL',
  'DENO_DIR',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'DOCKER_HOST',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]);
const BASE_ENV_PREFIX = ['LC_', 'XDG_'];

/** Read the mode from the service environment; an invalid value is reported as auto. */
export function resolveSandboxMode(value = process.env['KAIMING_SANDBOX']): SandboxMode {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === 'strict' || trimmed === 'off') return trimmed;
  return 'auto';
}

/** The sandbox binary available on this host, or `none`. */
export function detectSandboxBackend(platform = process.platform): SandboxBackend {
  if (platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) return 'sandbox-exec';
  if (platform === 'linux') {
    const probe = spawnSync('bwrap', ['--version'], { stdio: 'ignore', timeout: 5_000 });
    if (probe.status === 0) return 'bwrap';
  }
  return 'none';
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A directory is a subpath; a regular file or socket is an exact path. */
function isExactPath(path: string): boolean {
  try {
    return !statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function within(path: string, root: string): boolean {
  const normalized = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(normalized);
}

/** A host helper directory must not be writable by the sandboxed role. */
function helperBase(policy: SandboxPolicy): string {
  const roots = policy.writableRoots.map(canonical);
  const candidates = [tmpdir(), ...policy.privatePaths.filter(isDirectory)].map(canonical);
  return candidates.find((candidate) => !roots.some((root) => within(candidate, root))) ?? canonical(tmpdir());
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** SBPL and bwrap compare kernel-canonical paths (/var is /private/var on macOS). */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Cache roots that are safe to keep writable for normal development toolchains. */
function cacheRoots(): string[] {
  const candidates = [
    join(homedir(), '.npm'),
    join(homedir(), '.cache'),
    join(homedir(), '.pnpm-store'),
    process.env['XDG_CACHE_HOME'],
  ];
  return [...new Set(candidates.filter((path): path is string => path !== undefined && path !== ''))]
    .filter((path) => existsSync(path) && isDirectory(path));
}

/** The git dirs a project writes through; linked worktrees also have a common dir. */
function gitDirs(cwd: string): { gitDir: string | null; commonDir: string | null } {
  try {
    const gitDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--absolute-git-dir'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return {
      gitDir: gitDir === '' ? null : resolve(gitDir),
      commonDir: common === '' ? null : resolve(cwd, common),
    };
  } catch {
    return { gitDir: null, commonDir: null };
  }
}

function strictDockerSockets(): string[] {
  return ['/var/run/docker.sock', join(homedir(), '.docker', 'run', 'docker.sock')].filter((path) =>
    existsSync(path),
  );
}

/**
 * Resolve the policy for one role. The caller passes the project cwd and a per-session temp root;
 * the host's private paths and the loaded workbench `.env` are shared by every role.
 */
export function sandboxPolicyFor(
  roleId: string,
  cwd: string,
  runtime: SandboxRuntime,
  sessionId: string,
): SandboxPolicy {
  const tempPath = join(runtime.tempRoot, sessionId);
  mkdirSync(tempPath, { recursive: true, mode: 0o700 });
  const tempDir = canonical(tempPath);
  const privatePaths = [
    ...new Set(
      [
        resolve(runtime.dataDir),
        resolve(runtime.agentDir),
        ...(runtime.envFile !== undefined ? [resolve(runtime.envFile)] : []),
        ...(runtime.mode === 'strict' ? strictDockerSockets() : []),
      ].map(canonical),
    ),
  ];
  const projectCwd = canonical(cwd);
  const readablePrivatePaths = [canonical(join(runtime.agentDir, 'work'))];
  const base = {
    cwd: projectCwd,
    privatePaths,
    readablePrivatePaths,
    tempDir,
    allowSshAgent: true,
    networkAccess: 'allow' as const,
  };
  if (roleId === 'chief') {
    return {
      ...base,
      kind: 'read-only',
      writableRoots: [tempDir],
      readOnlySubpaths: [],
      allowDockerSocket: runtime.mode !== 'strict',
    };
  }
  if (roleId === 'settler') {
    const { commonDir, gitDir } = gitDirs(projectCwd);
    const hooks = [commonDir, gitDir]
      .filter((path): path is string => path !== null)
      .map((path) => canonical(join(path, 'hooks')));
    return {
      ...base,
      kind: 'workspace-write-git',
      writableRoots: [
        projectCwd,
        ...(gitDir !== null ? [gitDir] : []),
        ...(commonDir !== null ? [commonDir] : []),
        tempDir,
        ...cacheRoots(),
      ].map(canonical),
      readOnlySubpaths: hooks,
      allowDockerSocket: runtime.mode !== 'strict',
    };
  }
  if (roleId === 'developer' || roleId === 'designer' || roleId === 'tester') {
    const { commonDir, gitDir } = gitDirs(projectCwd);
    return {
      ...base,
      kind: 'workspace-write',
      writableRoots: [projectCwd, tempDir, ...cacheRoots()].map(canonical),
      readOnlySubpaths: [gitDir, commonDir]
        .filter((path): path is string => path !== null)
        .map(canonical),
      allowDockerSocket: runtime.mode !== 'strict',
    };
  }
  // Reviewer/investigator have no bash; a stray policy still must not grant writes.
  return {
    ...base,
    kind: 'read-only',
    writableRoots: [tempDir],
    readOnlySubpaths: [],
    allowDockerSocket: false,
  };
}

/** The child environment allowlist; secrets are never inherited wholesale. */
export function sandboxEnvironment(base: NodeJS.ProcessEnv, policy: SandboxPolicy): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (!BASE_ENV.has(key) && !BASE_ENV_PREFIX.some((prefix) => key.startsWith(prefix))) continue;
    if (key === 'DOCKER_HOST' && !policy.allowDockerSocket) continue;
    if (key === 'SSH_AUTH_SOCK' && !policy.allowSshAgent) continue;
    env[key] = value;
  }
  env['TMPDIR'] = policy.tempDir;
  env['TEMP'] = policy.tempDir;
  env['TMP'] = policy.tempDir;
  env['GIT_TERMINAL_PROMPT'] = '0';
  if (policy.kind === 'workspace-write' || policy.kind === 'workspace-write-git') {
    env['GIT_OPTIONAL_LOCKS'] = '0';
  }
  return env;
}

/** Build a macOS SBPL profile; parameters keep paths out of the profile text. */
function macProfile(policy: SandboxPolicy): { text: string; definitions: Array<[string, string]> } {
  const definitions: Array<[string, string]> = [];
  const lines = ['(version 1)', '(allow default)'];
  const add = (prefix: string, path: string): string => {
    const name = `${prefix}_${String(definitions.length)}`;
    definitions.push([name, path]);
    return name;
  };
  // Later rules win: writable roots are opened first, then read-only subpaths, then the private
  // paths are denied again (so a private file inside the project is not re-opened by the project
  // root), and the readable-private exception is last.
  lines.push('(deny file-write*)');
  lines.push('(allow file-write* (literal "/dev/null"))');
  for (const path of policy.writableRoots) {
    const name = add('WRITABLE', path);
    lines.push(`(allow file-write* (subpath (param "${name}")))`);
  }
  for (const path of policy.readOnlySubpaths) {
    const name = add('READONLY', path);
    lines.push(`(deny file-write* (${isExactPath(path) ? 'literal' : 'subpath'} (param "${name}")))`);
  }
  for (const path of policy.privatePaths) {
    if (isExactPath(path)) {
      const name = add('PRIVATE_FILE', path);
      lines.push(`(deny file-read* (literal (param "${name}")))`);
      lines.push(`(deny file-write* (literal (param "${name}")))`);
      lines.push(`(deny network-outbound (remote unix-socket (path-literal (param "${name}"))))`);
    } else {
      const name = add('PRIVATE_DIR', path);
      lines.push(`(deny file-read* (subpath (param "${name}")))`);
      lines.push(`(deny file-write* (subpath (param "${name}")))`);
    }
  }
  for (const path of policy.readablePrivatePaths) {
    const name = add('READABLE_PRIVATE', path);
    lines.push(`(allow file-read* (subpath (param "${name}")))`);
  }
  return { text: `${lines.join('\n')}\n`, definitions };
}

/** A `chmod 000` stub for an exact private file on Linux. */
function unreadableStub(policy: SandboxPolicy): { readonly stub: string; readonly dir: string } {
  const dir = mkdtempSync(join(helperBase(policy), 'kaiming-sb-stub-'));
  const stub = join(dir, 'stub');
  writeFileSync(stub, '', { mode: 0o000 });
  chmodSync(stub, 0o000);
  return { stub, dir };
}

/** Build the argv and target for one command. */
function sandboxCommand(
  policy: SandboxPolicy,
  command: string,
  backend: SandboxBackend,
  shellPath?: string,
): { file: string; args: string[]; stdin?: boolean; cleanup: () => void } {
  const shell = getShellConfig(shellPath);
  const commandFromStdin = shell.commandTransport === 'stdin';
  const shellArgs = commandFromStdin ? shell.args : [...shell.args, command];
  if (backend === 'sandbox-exec') {
    const profile = macProfile(policy);
    const profileDir = mkdtempSync(join(helperBase(policy), 'kaiming-sb-profile-'));
    const profilePath = join(profileDir, 'policy.sb');
    writeFileSync(profilePath, profile.text, { mode: 0o600 });
    const definitions = profile.definitions.flatMap(([name, value]) => ['-D', `${name}=${value}`]);
    return {
      file: '/usr/bin/sandbox-exec',
      args: ['-f', profilePath, ...definitions, '--', shell.shell, ...shellArgs],
      ...(commandFromStdin ? { stdin: true } : {}),
      cleanup: () => rmSync(profileDir, { recursive: true, force: true }),
    };
  }
  if (backend === 'bwrap') {
    const stubDirs: string[] = [];
    const emptyDirs: string[] = [];
    const args = ['--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
    for (const path of policy.writableRoots) {
      if (existsSync(path)) args.push('--bind', path, path);
    }
    for (const path of policy.privatePaths) {
      if (isExactPath(path)) {
        const { stub, dir } = unreadableStub(policy);
        stubDirs.push(dir);
        args.push('--ro-bind', stub, path);
      } else {
        args.push('--tmpfs', path);
      }
    }
    for (const path of policy.readOnlySubpaths) {
      if (existsSync(path)) {
        args.push('--ro-bind', path, path);
      } else {
        const dir = mkdtempSync(join(helperBase(policy), 'kaiming-sb-empty-'));
        emptyDirs.push(dir);
        args.push('--dir', path, '--ro-bind', dir, path);
      }
    }
    for (const path of policy.readablePrivatePaths) {
      if (existsSync(path)) args.push('--ro-bind', path, path);
    }
    args.push('--', shell.shell, ...shellArgs);
    return {
      file: 'bwrap',
      args,
      ...(commandFromStdin ? { stdin: true } : {}),
      cleanup: () => {
        for (const dir of [...stubDirs, ...emptyDirs]) rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  throw new Error('no OS sandbox backend is available');
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('Invalid timeout: must be a finite number of seconds');
  }
  const ms = timeout * 1000;
  if (ms > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${String(MAX_TIMEOUT_MS / 1000)} seconds`);
  }
  return ms;
}


const EXIT_STDIO_GRACE_MS = 100;

/**
 * Wait for a child without hanging on a detached descendant that inherited its pipes. After
 * `exit`, the streams must fall idle for a grace window; a still-writing descendant re-arms it.
 */
function waitForChildProcess(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let postExitTimer: NodeJS.Timeout | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;
    const cleanup = (): void => {
      clearTimeout(postExitTimer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
      child.stdout?.removeListener('end', onStdoutEnd);
      child.stderr?.removeListener('end', onStderrEnd);
      child.stdout?.removeListener('data', onData);
      child.stderr?.removeListener('data', onData);
    };
    const finalize = (code: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolvePromise(code);
    };
    const maybeFinalizeAfterExit = (): void => {
      if (exited && !settled && stdoutEnded && stderrEnded) finalize(exitCode);
    };
    const armIdleTimer = (): void => {
      clearTimeout(postExitTimer);
      postExitTimer = setTimeout(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
    };
    const onData = (): void => {
      if (exited && !settled) armIdleTimer();
    };
    const onStdoutEnd = (): void => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };
    const onStderrEnd = (): void => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };
    const onError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null): void => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();
      if (!settled) armIdleTimer();
    };
    const onClose = (code: number | null): void => finalize(code);
    child.stdout?.once('end', onStdoutEnd);
    child.stderr?.once('end', onStderrEnd);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('close', onClose);
  });
}
/** Execute one command inside the selected OS sandbox. */
const executeInSandbox: SandboxExecutor = (
  policy,
  command,
  cwd,
  options = {},
  backend = detectSandboxBackend(),
) =>
  new Promise((resolvePromise, reject) => {
    const timeoutMs = resolveTimeoutMs(options.timeout ?? DEFAULT_TIMEOUT_SECONDS);
    if (options.signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    if (!existsSync(cwd)) {
      reject(new Error(`Working directory does not exist: ${cwd}`));
      return;
    }
    let built: ReturnType<typeof sandboxCommand>;
    try {
      built = sandboxCommand(policy, command, backend);
    } catch (error) {
      reject(error);
      return;
    }
    const env = sandboxEnvironment(options.env ?? process.env, policy);
    const child = spawn(built.file, built.args, {
      cwd,
      detached: process.platform !== 'win32',
      env,
      stdio: [built.stdin === true ? 'pipe' : 'ignore', 'pipe', 'pipe'] as const,
      windowsHide: true,
    });
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    const killTree = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const onAbort = (): void => killTree();
    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', onAbort);
      try {
        built.cleanup();
      } catch {
        // A leftover process may still hold a file in the helper dir; cleanup must never kill the host.
      }
    };
    child.stdout?.on('data', (data: Buffer) => options.onData?.(data));
    child.stderr?.on('data', (data: Buffer) => options.onData?.(data));
    if (built.stdin === true) {
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(command);
    }
    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);
    }
    if (options.signal !== undefined) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    void waitForChildProcess(child).then(
      (code) => {
        cleanup();
        if (options.signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        if (timedOut) {
          reject(new Error(`timeout:${String(options.timeout ?? DEFAULT_TIMEOUT_SECONDS)}`));
          return;
        }
        const signal = child.signalCode;
        const signalCode = signal === null ? 0 : (osConstants.signals[signal] ?? 0);
        resolvePromise({ exitCode: code ?? (signalCode === 0 ? 1 : 128 + signalCode) });
      },
      (error: Error) => {
        cleanup();
        reject(error);
      },
    );
  });

/** A BashOperations implementation for a role policy. */
export function createSandboxedBashOperations(policy: SandboxPolicy): BashOperations {
  return { exec: (command, cwd, options) => executeInSandbox(policy, command, cwd, options) };
}

export interface SandboxProbeOptions {
  readonly privatePaths: readonly string[];
  readonly tempRoot: string;
  readonly backend?: SandboxBackend;
  readonly executor?: SandboxExecutor;
}

/**
 * Start-up probe. It proves private reads and outside writes are denied and a temp write succeeds;
 * an unisolated executor therefore fails the probe (it would let both bad operations succeed).
 */
export async function probeSandbox(
  mode: SandboxMode,
  options: SandboxProbeOptions,
): Promise<SandboxStatus> {
  if (mode === 'off') {
    return { mode, backend: 'none', active: false, reason: 'protection is off (KAIMING_SANDBOX=off)' };
  }
  const backend = options.backend ?? detectSandboxBackend();
  if (backend === 'none') {
    return {
      mode,
      backend,
      active: false,
      reason: 'no OS sandbox backend is available (macOS sandbox-exec or Linux bwrap is required)',
    };
  }
  const probePath = mkdtempSync(join(options.tempRoot, 'probe-'));
  const probeRoot = canonical(probePath);
  mkdirSync(join(probeRoot, 'cwd'), { recursive: true });
  mkdirSync(join(probeRoot, 'private'), { recursive: true });
  const probeCwd = canonical(join(probeRoot, 'cwd'));
  const privateDir = canonical(join(probeRoot, 'private'));
  const outside = join(canonical(tmpdir()), `kaiming-probe-outside-${String(process.pid)}-${String(Date.now())}`);
  writeFileSync(join(privateDir, 'secret.txt'), 'secret\n', { mode: 0o600 });
  const policy: SandboxPolicy = {
    kind: 'workspace-write',
    cwd: probeCwd,
    privatePaths: [privateDir, ...options.privatePaths],
    readablePrivatePaths: [],
    writableRoots: [probeCwd, probeRoot].map(canonical),
    readOnlySubpaths: [],
    tempDir: probeRoot,
    allowDockerSocket: false,
    allowSshAgent: false,
    networkAccess: 'allow',
  };
  const execute = options.executor ?? executeInSandbox;
  const failed = (reason: string): SandboxStatus => ({ mode, backend, active: false, reason });
  try {
    const readPrivate = await execute(policy, `cat ${quoteShell(join(privateDir, 'secret.txt'))}`, probeCwd, { timeout: 5 }, backend);
    const writeOutside = await execute(policy, `touch ${quoteShell(outside)}`, probeCwd, { timeout: 5 }, backend);
    const writeTemp = await execute(policy, `touch ${quoteShell(join(probeCwd, 'ok.txt'))}`, probeCwd, { timeout: 5 }, backend);
    if (readPrivate.exitCode === 0) return failed('the probe could read a private file');
    if (writeOutside.exitCode === 0) return failed('the probe could write outside its writable roots');
    if (writeTemp.exitCode !== 0) return failed('the probe could not write its own temp/project root');
    return { mode, backend, active: true, reason: null };
  } catch (error) {
    return failed(`the sandbox probe failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
}

/** Build the host-side sandbox runtime. A failed auto/strict probe disables bash, not the boundary. */
export async function createSandboxRuntime(options: SandboxRuntimeOptions): Promise<SandboxRuntime> {
  const mode = options.mode ?? resolveSandboxMode();
  const tempRootPath = options.tempRoot ?? join(tmpdir(), 'kaiming', `p-${String(process.pid)}`);
  mkdirSync(tempRootPath, { recursive: true, mode: 0o700 });
  const tempRoot = canonical(tempRootPath);
  const dataDir = canonical(options.dataDir);
  const agentDir = canonical(options.agentDir);
  const privatePaths = [
    ...new Set(
      [
        dataDir,
        agentDir,
        ...(options.envFile !== undefined ? [canonical(options.envFile)] : []),
        ...(mode === 'strict' ? strictDockerSockets() : []),
      ].map(canonical),
    ),
  ];
  const status =
    mode === 'off'
      ? { mode, backend: 'none' as const, active: false, reason: 'protection is off (KAIMING_SANDBOX=off)' }
      : await probeSandbox(mode, { privatePaths, tempRoot, ...(options.backend !== undefined ? { backend: options.backend } : {}) });
  return {
    mode,
    status,
    privatePaths,
    readablePrivatePaths: [canonical(join(agentDir, 'work'))],
    dataDir,
    agentDir,
    tempRoot,
    ...(options.envFile !== undefined ? { envFile: canonical(options.envFile) } : {}),
    ...(options.shellPath !== undefined ? { shellPath: options.shellPath } : {}),
  };
}

/** A bash tool result that refuses to execute because the sandbox is not available. */
export function createRefusingBashOperations(reason: string): BashOperations {
  return {
    exec: async () => {
      throw new Error(`bash is not available: ${reason}`);
    },
  };
}

/** The environment scrub used even when the sandbox is off. */
export function scrubbedProcessEnvironment(tempDir: string, allowDockerSocket = true): NodeJS.ProcessEnv {
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const policy: SandboxPolicy = {
    kind: 'workspace-write',
    cwd: tempDir,
    privatePaths: [],
    readablePrivatePaths: [],
    writableRoots: [],
    readOnlySubpaths: [],
    tempDir,
    allowDockerSocket,
    allowSshAgent: true,
    networkAccess: 'allow',
  };
  return sandboxEnvironment(process.env, policy);
}
