/**
 * Responsiveness probe for a running workbench.
 *
 * Purpose: when the interface feels slow and then recovers, the question is *where* the time went.
 * This answers the half that leaves no trace: are the server's own calls fast at that moment? It
 * measures the two calls the shell makes when it switches project (`project.list`, `session.list`)
 * and the one it makes when it follows a session (`session.stream.prepare`), then prints percentiles
 * next to the server process's CPU and memory.
 *
 * Run it while the interface is slow:
 *
 *   node checks/latency.ts            # 30 samples, report and exit
 *   node checks/latency.ts --watch    # keep going until Ctrl-C, printing a line per slow call
 *
 * Fast calls here + a frozen interface means the cost is in the browser (render or main thread).
 * Slow calls here mean the server (SQLite, transcript IO, event loop) is the bottleneck.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(HERE, '..', '.env');

function envValue(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  try {
    const line = readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .find((entry) => entry.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const port = envValue('KAIMING_PORT') ?? '4173';
const origin = `http://127.0.0.1:${port}`;
const password = envValue('KAIMING_ACCESS_PASSWORD');
if (password === undefined) {
  console.error('KAIMING_ACCESS_PASSWORD is not set (env or kaiming/.env)');
  process.exit(2);
}
const watch = process.argv.includes('--watch');
const samples = Number(process.env['PROBE_SAMPLES'] ?? 30);
const SLOW_MS = 250;

interface Call {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const response = await fetch(`${origin}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'auth.login', params: { password } }),
  });
  const cookie = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0]).join('; ');
  const body = (await response.json()) as { result?: { csrfToken?: string } };
  const csrf = body.result?.csrfToken;
  if (cookie === '' || csrf === undefined) throw new Error(`login failed: ${JSON.stringify(body).slice(0, 200)}`);
  return { cookie, csrf };
}

async function call(session: { cookie: string; csrf: string }, method: string, params: Record<string, unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  const response = await fetch(`${origin}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: session.cookie, 'x-csrf-token': session.csrf },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
  });
  await response.json();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function serverProcess(): string {
  let pid = '';
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    pid = out.trim().split('\n')[0] ?? '';
  } catch {
    return 'server process not found (is the workbench on another port?)';
  }
  if (pid === '') return 'server process not found';
  try {
    const out = execFileSync('ps', ['-o', 'pid=,%cpu=,rss=,etime=', '-p', pid], { encoding: 'utf8' }).trim();
    const [id, cpu, rss, etime] = out.split(/\s+/);
    return `server pid ${id ?? '?'}: cpu ${cpu ?? '?'}%, rss ${Math.round(Number(rss ?? 0) / 1024)}MB, up ${etime ?? '?'}`;
  } catch {
    return `server pid ${pid}`;
  }
}

function percentiles(values: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

async function main(): Promise<void> {
  const session = await login();
  const projects = (await fetch(`${origin}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: session.cookie, 'x-csrf-token': session.csrf },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'project.list', params: {} }),
  }).then((response) => response.json())) as {
    result?: { projects?: ReadonlyArray<{ projectId: string; realPath: string }> };
  };
  const list = projects.result?.projects ?? [];
  console.log(`${serverProcess()}`);
  console.log(`projects: ${list.map((entry) => entry.realPath).join(', ') || '(none)'}`);

  // The calls the shell makes when someone switches project or follows a session.
  const work: Call[] = [{ method: 'project.list', params: {} }];
  for (const project of list.slice(0, 3)) {
    work.push({ method: 'session.list', params: { projectId: project.projectId } });
    const sessions = (await fetch(`${origin}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session.cookie, 'x-csrf-token': session.csrf },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'session.list', params: { projectId: project.projectId } }),
    }).then((response) => response.json())) as { result?: { sessions?: ReadonlyArray<{ sessionId: string }> } };
    const first = sessions.result?.sessions?.[0];
    if (first !== undefined) {
      work.push({ method: 'session.stream.prepare', params: { projectId: project.projectId, sessionId: first.sessionId } });
    }
  }

  const recorded = new Map<string, number[]>();
  const label = (entry: Call): string => `${entry.method}${entry.params['sessionId'] === undefined ? '' : ` ${String(entry.params['sessionId']).slice(0, 6)}`}`;
  const failures: string[] = [];
  let pass = 0;
  for (;;) {
    pass += 1;
    for (const entry of work) {
      let ms = 0;
      try {
        ms = await call(session, entry.method, entry.params);
      } catch (error) {
        failures.push(`${new Date().toISOString()} ${entry.method}: ${(error as Error).message}`);
        continue;
      }
      const key = label(entry);
      recorded.set(key, [...(recorded.get(key) ?? []), ms]);
      if (watch && ms > SLOW_MS) console.log(`${new Date().toISOString()} SLOW #${pass} ${key} ${round(ms)}ms`);
    }
    if (!watch && pass >= samples) break;
  }
  const table = [...recorded.entries()].map(([key, values]) => ({ key, ...percentiles(values), n: values.length }));
  for (const row of table) {
    console.log(`${row.key.padEnd(28)} n=${String(row.n).padStart(3)} p50=${round(row.p50)}ms p95=${round(row.p95)}ms max=${round(row.max)}ms`);
  }
  for (const failure of failures) console.log(`FAILED ${failure}`);
  const worst = Math.max(0, ...table.map((row) => row.max));
  console.log(worst > 1000 ? `VERDICT: the server stalled (worst ${round(worst)}ms)` : `VERDICT: the server answered throughout (worst ${round(worst)}ms)`);
  process.exit(worst > 1000 || failures.length > 0 ? 1 : 0);
}

await main();
