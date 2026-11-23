/**
 * OS sandbox (P3-1): the probe must reject a real private read/outside write and accept a temp write;
 * role policies must expose the right write scope; the child environment must be an allowlist.
 * Real kernel child processes are used on macOS/Linux; no mock replaces the backend.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSandboxRuntime,
  createSandboxedBashOperations,
  detectSandboxBackend,
  probeSandbox,
  sandboxEnvironment,
  sandboxPolicyFor,
  type SandboxPolicy,
} from '../src/runtime/os-sandbox.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'kaiming-os-sandbox-'));
  roots.push(path);
  return path;
}

function policy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
  return {
    kind: 'read-only',
    cwd: '/project',
    privatePaths: [],
    readablePrivatePaths: [],
    writableRoots: [],
    readOnlySubpaths: [],
    tempDir: '/tmp/kaiming-test',
    allowDockerSocket: false,
    allowSshAgent: true,
    networkAccess: 'allow',
    ...overrides,
  };
}

describe('sandbox policy and environment', () => {
  it('scrubs secrets but keeps the base toolchain environment', () => {
    const env = sandboxEnvironment(
      {
        PATH: '/usr/bin:/bin',
        HOME: '/home/user',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        SSH_AUTH_SOCK: '/tmp/agent.sock',
        HTTP_PROXY: 'http://proxy',
        KAIMING_ACCESS_PASSWORD: 'secret',
        OPENAI_API_KEY: 'sk-secret',
        PI_SESSION_FILE: '/private/session.jsonl',
        NPM_CONFIG_REGISTRY: 'https://token@example.invalid',
      },
      policy({ allowDockerSocket: false }),
    );
    expect(env['PATH']).toBe('/usr/bin:/bin');
    expect(env['HOME']).toBe('/home/user');
    expect(env['LANG']).toBe('en_US.UTF-8');
    expect(env['SSH_AUTH_SOCK']).toBe('/tmp/agent.sock');
    expect(env['HTTP_PROXY']).toBe('http://proxy');
    expect(env['KAIMING_ACCESS_PASSWORD']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['PI_SESSION_FILE']).toBeUndefined();
    expect(env['NPM_CONFIG_REGISTRY']).toBeUndefined();
    expect(env['TMPDIR']).toBe('/tmp/kaiming-test');
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
  });

  it('maps the chief read-only, development workspace and settler git scopes', async () => {
    const dataDir = join(root(), 'data');
    const project = join(root(), 'project');
    const agentDir = join(root(), 'agent');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(project, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    const runtime = await createSandboxRuntime({
      dataDir,
      agentDir,
      tempRoot: join(root(), 'tmp'),
      mode: 'off',
    });
    const chief = sandboxPolicyFor('chief', project, runtime, 'chief-1');
    expect(chief.kind).toBe('read-only');
    expect(chief.writableRoots).toEqual([chief.tempDir]);
    expect(chief.privatePaths).toEqual(expect.arrayContaining([expect.stringContaining('data')]));

    const developer = sandboxPolicyFor('developer', project, runtime, 'dev-1');
    expect(developer.kind).toBe('workspace-write');
    expect(developer.writableRoots).toEqual(expect.arrayContaining([realpathSync(project)]));
    expect(developer.readOnlySubpaths).toEqual([]);

    const settler = sandboxPolicyFor('settler', project, runtime, 'set-1');
    expect(settler.writableRoots).toEqual(expect.arrayContaining([realpathSync(project)]));
  });

  it('fails closed on a missing backend and only off is unsandboxed', async () => {
    const missing = await probeSandbox('auto', {
      privatePaths: [],
      tempRoot: root(),
      backend: 'none',
    });
    expect(missing.active).toBe(false);
    expect(missing.reason).toContain('no OS sandbox backend');
    expect(await probeSandbox('strict', { privatePaths: [], tempRoot: root(), backend: 'none' })).toMatchObject({
      active: false,
      mode: 'strict',
    });
    const off = await probeSandbox('off', { privatePaths: [], tempRoot: root(), backend: 'none' });
    expect(off.active).toBe(false);
    expect(off.reason).toContain('protection is off');
  });

  it('rejects an unisolated executor in the probe', async () => {
    const privatePath = join(root(), 'private');
    mkdirSync(privatePath, { recursive: true });
    writeFileSync(join(privatePath, 'secret.txt'), 'secret');
    const unisolated = async (_policy: SandboxPolicy, command: string, cwd: string) => {
      const result = spawnSync('/bin/bash', ['-c', command], { cwd, stdio: 'ignore' });
      return { exitCode: result.status };
    };
    const status = await probeSandbox('auto', {
      privatePaths: [privatePath],
      tempRoot: root(),
      backend: 'sandbox-exec',
      executor: unisolated,
    });
    expect(status.active).toBe(false);
    expect(status.reason).toContain('could read a private file');
  });
});

const realBackend = detectSandboxBackend();
describe.skipIf(realBackend === 'none')('real kernel boundary', () => {
  it('denies private reads and project writes while allowing the temp dir', async () => {
    const base = root();
    const dataDir = join(base, 'data');
    const agentDir = join(base, 'agent');
    const project = join(base, 'project');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(project, { recursive: true });
    const envFile = join(project, '.env');
    writeFileSync(envFile, 'TOP-SECRET\n');
    const runtime = await createSandboxRuntime({
      dataDir,
      agentDir,
      envFile,
      tempRoot: join(base, 'tmp'),
      mode: 'auto',
    });
    expect(runtime.status.active).toBe(true);
    const chief = sandboxPolicyFor('chief', project, runtime, 'chief-1');
    const operations = createSandboxedBashOperations(chief);
    const run = async (command: string): Promise<number | null> => {
      const result = await operations.exec(command, project, {
        onData: () => undefined,
        timeout: 10,
      });
      return result.exitCode;
    };
    expect(await run(`cat ${JSON.stringify(envFile)}`)).not.toBe(0);
    expect(await run(`printf hacked >> ${JSON.stringify(envFile)}`)).not.toBe(0);
    expect(await run(`cat ${JSON.stringify(join(dataDir, 'state.db'))}`)).not.toBe(0);
    expect(await run(`touch ${JSON.stringify(join(project, 'evil.ts'))}`)).not.toBe(0);
    expect(await run(`touch ${JSON.stringify(join(chief.tempDir, 'ok'))}`)).toBe(0);
    expect(await run('pwd')).toBe(0);
  });

  it('keeps a business .env readable while the loaded workbench .env stays private', async () => {
    const base = root();
    const workbenchData = join(base, 'workbench-data');
    const workbenchAgent = join(base, 'workbench-agent');
    const project = join(base, 'project');
    mkdirSync(workbenchData, { recursive: true });
    mkdirSync(workbenchAgent, { recursive: true });
    mkdirSync(project, { recursive: true });
    const workbenchEnv = join(project, '.env');
    const businessEnv = join(project, 'business.env');
    writeFileSync(workbenchEnv, 'WORKBENCH=1\n');
    writeFileSync(businessEnv, 'BUSINESS=1\n');
    const runtime = await createSandboxRuntime({
      dataDir: workbenchData,
      agentDir: workbenchAgent,
      envFile: workbenchEnv,
      tempRoot: join(base, 'tmp'),
      mode: 'auto',
    });
    const developer = sandboxPolicyFor('developer', project, runtime, 'dev-1');
    const operations = createSandboxedBashOperations(developer);
    const run = async (command: string): Promise<number | null> => {
      const result = await operations.exec(command, project, {
        onData: () => undefined,
        timeout: 10,
      });
      return result.exitCode;
    };
    expect(await run(`cat ${JSON.stringify(workbenchEnv)}`)).not.toBe(0);
    expect(await run(`cat ${JSON.stringify(businessEnv)}`)).toBe(0);
    expect(await run('touch new-file.ts')).toBe(0);
  });

  it('keeps developer .git read-only and lets the settler commit', async () => {
    const base = root();
    const dataDir = join(base, 'data');
    const agentDir = join(base, 'agent');
    const project = join(base, 'project');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(project, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
        stdio: 'ignore',
      });
    };
    git('init', '--quiet');
    writeFileSync(join(project, 'tracked.txt'), 'base\n');
    git('add', '--all');
    git('commit', '--quiet', '-m', 'base');
    const runtime = await createSandboxRuntime({
      dataDir,
      agentDir,
      tempRoot: join(base, 'tmp'),
      mode: 'auto',
    });
    const runFor = async (role: string, command: string): Promise<number | null> => {
      const operations = createSandboxedBashOperations(sandboxPolicyFor(role, project, runtime, role));
      const result = await operations.exec(command, project, {
        onData: () => undefined,
        timeout: 10,
      });
      return result.exitCode;
    };
    expect(await runFor('developer', 'git status --short')).toBe(0);
    expect(await runFor('developer', `printf changed >> ${JSON.stringify(join(project, 'tracked.txt'))}`)).toBe(0);
    expect(
      await runFor('developer', 'git -c user.name=Test -c user.email=test@example.com commit -am changed'),
    ).not.toBe(0);
    expect(await runFor('developer', `printf x > ${JSON.stringify(join(project, '.git', 'hooks', 'pre-commit'))}`)).not.toBe(0);
    expect(await runFor('settler', 'git add -A')).toBe(0);
    expect(
      await runFor('settler', 'git -c user.name=Test -c user.email=test@example.com commit -m settled'),
    ).toBe(0);
    expect(await runFor('settler', `printf x > ${JSON.stringify(join(project, '.git', 'hooks', 'pre-commit'))}`)).not.toBe(0);
  });

  it('denies nested private paths inside a writable project', async () => {
    const base = root();
    const project = join(base, 'project');
    const dataDir = join(project, 'kaiming', '.kaiming-data');
    const agentDir = join(project, 'kaiming', 'agent');
    const envFile = join(project, '.env');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(dataDir, 'state.db'), 'PRIVATE');
    writeFileSync(envFile, 'KAIMING_ACCESS_PASSWORD=secret');
    const runtime = await createSandboxRuntime({
      dataDir,
      agentDir,
      envFile,
      tempRoot: join(base, 'tmp'),
      mode: 'auto',
    });
    const operations = createSandboxedBashOperations(sandboxPolicyFor('developer', project, runtime, 'dev-1'));
    const run = async (command: string): Promise<number | null> => {
      const result = await operations.exec(command, project, {
        onData: () => undefined,
        timeout: 10,
      });
      return result.exitCode;
    };
    expect(await run('touch project-file.ts')).toBe(0);
    expect(await run(`cat ${JSON.stringify(envFile)}`)).not.toBe(0);
    expect(await run(`cat ${JSON.stringify(join(dataDir, 'state.db'))}`)).not.toBe(0);
    expect(await run(`touch ${JSON.stringify(join(dataDir, 'evil'))}`)).not.toBe(0);
  });

  it('blocks a private Unix socket while keeping network allowed', async () => {
    const dir = realpathSync(root());
    const socketPath = join(dir, 'private.sock');
    const server = createServer((client) => client.end('ok'));
    await new Promise<void>((resolve, reject) => {
      server.listen(socketPath, () => resolve());
      server.once('error', reject);
    });
    try {
      const operations = createSandboxedBashOperations({
        kind: 'read-only',
        cwd: dir,
        privatePaths: [socketPath],
        readablePrivatePaths: [],
        writableRoots: [dir],
        readOnlySubpaths: [],
        tempDir: dir,
        allowDockerSocket: false,
        allowSshAgent: false,
        networkAccess: 'allow',
      });
      const code = 'const net=require("net");const c=net.connect(process.argv[1]);c.on("connect",()=>process.exit(0));c.on("error",()=>process.exit(3));';
      const result = await operations.exec(
        `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)} ${JSON.stringify(socketPath)}`,
        dir,
        { onData: () => undefined, timeout: 10 },
      );
      expect(result.exitCode).not.toBe(0);
    } finally {
      server.close();
    }
  });

  it('does not wait for a background descendant that inherited the pipes', async () => {
    const base = root();
    const dataDir = join(base, 'data');
    const agentDir = join(base, 'agent');
    const project = join(base, 'project');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(project, { recursive: true });
    const runtime = await createSandboxRuntime({
      dataDir,
      agentDir,
      tempRoot: join(base, 'tmp'),
      mode: 'auto',
    });
    const operations = createSandboxedBashOperations(sandboxPolicyFor('chief', project, runtime, 'chief-1'));
    const started = Date.now();
    const result = await operations.exec('cd "$TMPDIR" && nohup sleep 2 &', project, {
      onData: () => undefined,
      timeout: 10,
    });
    expect(result.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
  });

  it('lets a settler commit in a linked worktree while hooks stay read-only', async () => {
    const base = root();
    const main = join(base, 'main');
    const worktree = join(base, 'wt');
    mkdirSync(main, { recursive: true });
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
        stdio: 'ignore',
      });
    };
    git(main, 'init', '--quiet');
    writeFileSync(join(main, 'base.txt'), 'base\n');
    git(main, 'add', '--all');
    git(main, 'commit', '--quiet', '-m', 'base');
    git(main, 'worktree', 'add', worktree, '-b', 'wtb');
    writeFileSync(join(worktree, 'change.txt'), 'change\n');
    const runtime = await createSandboxRuntime({
      dataDir: join(base, 'data'),
      agentDir: join(base, 'agent'),
      tempRoot: join(base, 'tmp'),
      mode: 'auto',
    });
    const settler = sandboxPolicyFor('settler', worktree, runtime, 'set-wt');
    const operations = createSandboxedBashOperations(settler);
    const run = async (command: string): Promise<number | null> => {
      const result = await operations.exec(command, worktree, {
        onData: () => undefined,
        timeout: 10,
      });
      return result.exitCode;
    };
    expect(await run('git add -A')).toBe(0);
    expect(
      await run('git -c user.name=Test -c user.email=test@example.com commit -m worktree'),
    ).toBe(0);
    expect(await run(`printf x > ${JSON.stringify(join(main, '.git', 'hooks', 'pre-commit'))}`)).not.toBe(0);
  });
});
