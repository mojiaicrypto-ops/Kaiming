/**
 * `npm run mcp` — the stdio MCP server a coding agent launches as a child process.
 *
 * It owns at most one workbench: if nothing is serving the configured port it starts the workbench
 * in this process (loopback, ephemeral port); if something already serves it, it attaches to that
 * one instead. Two processes never open the same store, because two dispatchers on one database would
 * run the same input twice.
 *
 * stdout carries protocol messages only; every diagnostic goes to stderr (stdio transport rule).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorkbench } from '../server/main.ts';
import { httpControl, workbenchServing } from './control.ts';
import { RunTools } from './runs.ts';
import { createMcpProtocol, type JsonRpcRequest } from './protocol.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function log(line: string): void {
  process.stderr.write(`[agentdev-mcp] ${line}\n`);
}

function fail(line: string): never {
  log(line);
  process.exit(2);
}

function packageVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const password = process.env['AGENTDEV_ACCESS_PASSWORD'] ?? '';
if (password.trim() === '') {
  fail('AGENTDEV_ACCESS_PASSWORD is required: it is the same access password the workbench uses');
}

const projectPath = resolve(process.env['AGENTDEV_MCP_PROJECT'] ?? process.cwd());
const attachUrl = process.env['AGENTDEV_MCP_URL'];
const port = Number(process.env['AGENTDEV_PORT'] ?? 4173);
const defaultOrigin = `http://127.0.0.1:${String(port)}`;
const dataDir = resolve(process.cwd(), process.env['AGENTDEV_DATA_DIR'] ?? '.agentdev-data');
const lockPath = join(dataDir, 'mcp-instance.json');

interface InstanceLock {
  readonly pid: number;
  readonly origin: string;
}

function readLock(): InstanceLock | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<InstanceLock>;
    if (typeof parsed.pid !== 'number' || typeof parsed.origin !== 'string') return undefined;
    return { pid: parsed.pid, origin: parsed.origin };
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else: still alive for our purpose.
    return (error as { code?: string }).code === 'EPERM';
  }
}

function writeLock(origin: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, origin })}\n`, 'utf8');
}

function clearLock(): void {
  const current = readLock();
  if (current !== undefined && current.pid === process.pid) {
    rmSync(lockPath, { force: true });
  }
}

let owned: Awaited<ReturnType<typeof startWorkbench>> | null = null;
let origin: string;

/**
 * Attach to the workbench that already serves this installation, or start one. Two MCP clients (or a
 * client plus the browser) must end up on ONE store: a second dispatcher would open the same inputs,
 * and a second epoch would declare the first client's live run interrupted.
 */
async function openWorkbench(): Promise<string> {
  if (attachUrl !== undefined && attachUrl.trim() !== '') {
    const target = attachUrl.replace(/\/+$/, '');
    if (!(await workbenchServing(target))) {
      fail(`no workbench answers at ${target}; start it (AGENTDEV_ACCESS_PASSWORD=… npm start) or unset AGENTDEV_MCP_URL`);
    }
    log(`attached to the workbench at ${target}`);
    return target;
  }
  const recorded = readLock();
  if (recorded !== undefined && alive(recorded.pid) && (await workbenchServing(recorded.origin))) {
    log(`attached to the workbench this installation already runs at ${recorded.origin} (pid ${String(recorded.pid)})`);
    return recorded.origin;
  }
  if (await workbenchServing(defaultOrigin)) {
    log(`attached to the workbench already serving ${defaultOrigin}`);
    return defaultOrigin;
  }
  if (recorded !== undefined && alive(recorded.pid)) {
    // The recorded process is alive but not answering: do not open a second store behind its back.
    fail(
      `a workbench for ${dataDir} is recorded as pid ${String(recorded.pid)} but does not answer at ${recorded.origin}; ` +
        'stop it or remove ' +
        lockPath,
    );
  }
  let started: Awaited<ReturnType<typeof startWorkbench>>;
  try {
    started = await startWorkbench({
      dataDir,
      accessPassword: password,
      port,
      host: '127.0.0.1',
      log: (line) => log(line),
    });
  } catch (error) {
    fail(
      `could not start a workbench on ${defaultOrigin} (${error instanceof Error ? error.message : String(error)}); ` +
        `start one yourself and pass AGENTDEV_MCP_URL=${defaultOrigin}`,
    );
  }
  owned = started;
  writeLock(started.origin);
  log(`started a workbench for this MCP connection at ${started.origin} (data: ${dataDir})`);
  return started.origin;
}

origin = await openWorkbench();

let callerName = 'an MCP client';
const tools = new RunTools({
  control: httpControl({ origin, password }),
  defaultProjectPath: projectPath,
  caller: () => callerName,
});

const protocol = createMcpProtocol({
  tools,
  info: { name: 'agentdev', title: 'AgentDev', version: packageVersion() },
  notifyProgress: (progressToken, progress, total, message) => {
    write({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken, progress, ...(total === undefined ? {} : { total }), message },
    });
  },
  log: (line) => log(line),
});

// Serialise handling: one message at a time keeps `session/update`-like ordering unambiguous for
// clients that pipeline, and tool calls are independent anyway.
let queue: Promise<void> = Promise.resolve();
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;
  queue = queue.then(async () => {
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    if (message.method === 'initialize') {
      const info = (message.params?.['clientInfo'] ?? null) as { name?: unknown; version?: unknown } | null;
      if (info !== null && typeof info.name === 'string') {
        callerName = `${info.name}${typeof info.version === 'string' ? ` ${info.version}` : ''}`;
      }
    }
    try {
      const answer = await protocol.handle(message);
      if (answer !== null) write(answer);
    } catch (error) {
      log(`unhandled: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (message.id !== undefined) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'internal error' } });
      }
    }
  });
});
lines.on('close', () => {
  queue
    .then(async () => {
      if (owned !== null) {
        await owned.close();
        clearLock();
      }
      process.exit(0);
    })
    .catch(() => process.exit(1));
});

const shutdown = (): void => {
  void (owned === null ? Promise.resolve() : owned.close())
    .then(() => {
      clearLock();
      process.exit(0);
    })
    .catch(() => process.exit(1));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
