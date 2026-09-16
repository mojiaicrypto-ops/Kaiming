#!/usr/bin/env node
/**
 * WP-12 macOS Keychain real drill (this machine, real `/usr/bin/security`).
 *
 * `docs/architecture/execution.md` §4 and `docs/architecture/reliability.md` §7 document
 * the Keychain backend as an opt-in (`AGENTDEV_SECRET_BACKEND=keychain`). Before this drill
 * it had only ever been exercised against an injected command runner; this script drives
 * the **real** `security` CLI through the built `@agentdev/core` repository, the built
 * `agentdev` binary and a real daemon.
 *
 * Namespacing: every ref is `<prefix>/...` with a random per-run prefix, so no item this
 * script creates can collide with a real credential. Cleanup deletes every created item
 * directly with `security delete-generic-password` and proves the login keychain no longer
 * has it. The value is random per run and is masked in every printed line.
 *
 * Usage: node .agentdev/work/WP-12/wp12-keychain-drill.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const CLI = join(repoRoot, 'apps/cli/dist/cli.js');
const SECURITY = '/usr/bin/security';
const SERVICE = 'agentdev-secret';

const runId = randomBytes(5).toString('hex');
const PREFIX = `wp12verify-${runId}`;
const VALUE = `sk-wp12-${runId}-${randomBytes(9).toString('base64url')}`;
const ROTATED = `sk-wp12-rot-${randomBytes(9).toString('base64url')}`;
const UNICODE = `值é🔑-${runId}-token`;
const CLI_VALUE = `sk-wp12-cli-${randomBytes(9).toString('base64url')}`;
const CLI_ROTATED = `sk-wp12-clirot-${randomBytes(9).toString('base64url')}`;
const CLI_UNICODE = `秘钥-${runId}-é🔑`;
const MISSING_PROBE = `sk-wp12-missing-${randomBytes(9).toString('base64url')}`;
const GATEWAY_VALUE = `sk-wp12-gw-${randomBytes(9).toString('base64url')}`;
const GATEWAY_ROTATED = `sk-wp12-gwrot-${randomBytes(9).toString('base64url')}`;
const SECRETS = [
  VALUE,
  ROTATED,
  UNICODE,
  CLI_VALUE,
  CLI_ROTATED,
  CLI_UNICODE,
  MISSING_PROBE,
  GATEWAY_VALUE,
  GATEWAY_ROTATED,
];

const mask = (text) =>
  SECRETS.reduce((acc, secret) => acc.split(secret).join('<MASKED>'), String(text));
const say = (text) => process.stdout.write(`${mask(text)}\n`);

let failures = 0;
const check = (name, ok, detail = '') => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${mask(detail)}`}\n`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------------------
// Real `security` helpers plus the cleanup registry
// ---------------------------------------------------------------------------

const accounts = new Set();
const sec = (args) => spawnSync(SECURITY, args, { encoding: 'utf8' });
const findItem = (ref) => sec(['find-generic-password', '-a', ref, '-s', SERVICE, '-w']);
const deleteItem = (ref) => sec(['delete-generic-password', '-a', ref, '-s', SERVICE]);
const readKeychain = (ref) => {
  const result = findItem(ref);
  if (result.status !== 0) return null;
  const text = result.stdout;
  return text.endsWith('\n') ? text.slice(0, -1) : text;
};

/** Every created account, removed from the login keychain even when an assertion throws. */
function cleanupKeychain() {
  let removed = 0;
  for (const account of accounts) if (deleteItem(account).status === 0) removed += 1;
  return removed;
}

/** Temp homes/repos this script created, removed on any exit path. */
const createdDirs = [];
process.on('exit', () => {
  cleanupKeychain();
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: the process is already exiting.
    }
  }
});

/** Whether any file under `root` contains `needle`; skips VCS and dependencies. */
function containsText(root, needle) {
  const walk = (path) => {
    const name = path.split('/').pop() ?? '';
    if (name === '.git' || name === 'node_modules') return false;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return false;
    }
    if (stat.isDirectory()) return readdirSync(path).some((entry) => walk(join(path, entry)));
    if (!stat.isFile()) return false;
    try {
      return readFileSync(path, 'utf8').includes(needle);
    } catch {
      return false;
    }
  };
  return existsSync(root) ? walk(root) : false;
}

const git = (args, cwd) => {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const jsonOf = (text) => JSON.parse(text.slice(text.indexOf('{')));

async function portFree(port) {
  return await new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

// ---------------------------------------------------------------------------
// 0. Build check
// ---------------------------------------------------------------------------

say('# WP-12 macOS Keychain real drill');
say(`host: macOS ${spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim()}`);
say(`run prefix: ${PREFIX}`);
say(`security: ${SECURITY} (${spawnSync(SECURITY, ['-h'], { encoding: 'utf8' }).status === 0 ? 'present' : 'MISSING'})`);
say(`repo: ${repoRoot}`);
say('');

for (const artifact of [CLI, join(repoRoot, 'packages/core/dist/index.js'), join(repoRoot, 'apps/daemon/dist/main.js')]) {
  if (!existsSync(artifact)) {
    say(`build artifact missing: ${artifact}; run \`pnpm build\` first`);
    process.exit(2);
  }
}

const core = await import(pathToFileURL(join(repoRoot, 'packages/core/dist/index.js')).href);

say('## A. Repository-level real verification (built @agentdev/core, real `security`)');
say('');
const homeA = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-wp12-kc-')));
createdDirs.push(homeA);
const pathsA = core.secretRepositoryPaths(homeA);
const repoA = core.createSecretRepository({ home: homeA, backend: 'keychain' });
const refMain = `${PREFIX}/provider-main`;
const refUni = `${PREFIX}/unicode`;
const refStale = `${PREFIX}/stale`;
for (const ref of [refMain, refUni, refStale]) accounts.add(ref);

// A1 — set -> get resolves the same value.
const summary = repoA.set(refMain, VALUE, { audience: 'gateway' });
check(
  'A1 set uses the keychain backend and reports metadata only',
  summary.backend === 'keychain' && summary.configured === true && JSON.stringify(summary).includes(refMain),
  JSON.stringify(summary),
);
check('A1 get resolves exactly the stored value', repoA.get(refMain)?.value === VALUE);
say('');

// A2 — list is metadata only, never a value.
const items = JSON.stringify(repoA.list());
check(
  'A2 list reports one metadata row with health=ok',
  repoA.list().length === 1 && repoA.list()[0].ref === refMain && repoA.list()[0].health === 'ok',
  items,
);
check('A2 list carries no value', !items.includes(VALUE) && !items.includes(UNICODE));
say(`    list() = ${items}`);
say(`    index file = ${pathsA.keychainIndex}`);
say(`    index bytes = ${JSON.stringify(readFileSync(pathsA.keychainIndex, 'utf8').trim())}`);
say('');

// A3 — non-ASCII round-trip: the pre-drill defect.
repoA.set(refUni, UNICODE, { audience: 'tool', envName: 'WP12_UNICODE' });
const unicodeRead = repoA.get(refUni);
check(
  'A3 a non-ASCII value round-trips through the real Keychain',
  unicodeRead?.value === UNICODE,
  `expected-length=${String(UNICODE.length)} read-length=${String(unicodeRead?.value.length ?? -1)}`,
);
say('');

// A4 — overwriting an existing ref is a rotation, not a second record.
repoA.set(refMain, ROTATED, { audience: 'gateway' });
check(
  'A4 overwriting an existing ref keeps one row and the newest value',
  repoA.get(refMain)?.value === ROTATED && repoA.list().filter((row) => row.ref === refMain).length === 1,
);
check('A4 the raw Keychain item holds the newest value', readKeychain(refMain) === ROTATED);
say('');

// A5 — delete removes item and index row.
check(
  'A5 delete removes the Keychain item and its index row',
  repoA.delete(refUni) === true && repoA.get(refUni) === null && findItem(refUni).status === 44,
);
check('A5 deleting an absent ref is an honest false', repoA.delete(refUni) === false);
say('');

// A6 — a missing ref is the documented null, not a value.
check('A6 get of an absent ref returns null (documented)', repoA.get(`${PREFIX}/absent`) === null);
say('');

// A7 — stale index row (item removed by hand) must be reported, never silently skipped.
repoA.set(refStale, VALUE, { audience: 'gateway' });
deleteItem(refStale);
const stale = repoA.list().find((row) => row.ref === refStale);
check(
  'A7 a stale index row is reported health=missing with SECRET_NOT_FOUND',
  stale?.health === 'missing' && stale?.configured === false && stale?.issue?.code === 'SECRET_NOT_FOUND',
  JSON.stringify(stale),
);
check(
  'A7 the stale row is also reported through problems()',
  repoA.problems().some((problem) => problem.code === 'SECRET_NOT_FOUND' && problem.path === pathsA.keychainIndex),
  JSON.stringify(repoA.problems()),
);
const load = core.loadSecretsIntoStore(repoA, new core.SecretStore());
check(
  'A7 startup load counts the stale ref as failed, not as loaded',
  load.loaded === 1 && load.failed.some((failure) => failure.ref === refStale && failure.code === 'SECRET_NOT_FOUND'),
  JSON.stringify(load),
);
check(
  'A7 delete converges the stale row instead of hiding the ref forever',
  repoA.delete(refStale) === true &&
    repoA.list().every((row) => row.ref !== refStale) &&
    repoA.problems().every((problem) => problem.code !== 'SECRET_NOT_FOUND'),
);
say('');

// A8 — corrupt index is reported through problems(), never fatal.
writeFileSync(pathsA.keychainIndex, 'this is not JSON\n', { mode: 0o600 });
check(
  'A8 a corrupt index is reported as a problem, list() stays non-throwing',
  repoA.list().length === 0 && repoA.problems()[0]?.code === 'SECRET_RECORD_INVALID',
  JSON.stringify(repoA.problems()),
);
rmSync(pathsA.keychainIndex, { force: true });
say('');

// A9 — no value anywhere on disk.
check(
  'A9 no value appears in any file under the installation home',
  !containsText(homeA, VALUE) && !containsText(homeA, UNICODE),
);
check('A9 no value appears in the repository working tree', !containsText(repoRoot, VALUE));
say('');

// ---------------------------------------------------------------------------
// B. CLI drill through the built binary
// ---------------------------------------------------------------------------

say('## B. CLI drill (`agentdev secret set/list/rotate/delete`, built binary)');
say('');
const homeB = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-wp12-kccli-')));
createdDirs.push(homeB);
const envB = { ...process.env, AGENTDEV_HOME: homeB, AGENTDEV_SECRET_BACKEND: 'keychain' };
const cli = (args, input) => {
  say(`$ agentdev ${args.join(' ')} <standard input>`);
  const result = spawnSync(process.execPath, [CLI, ...args], { env: envB, input, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(mask(result.stdout));
  if (result.stderr) process.stderr.write(mask(result.stderr));
  say(`[exit ${String(result.status)}]`);
  return result;
};

const cliRef = `${PREFIX}/provider-cli`;
const cliRefOverwrite = `${PREFIX}/provider-cli2`;
accounts.add(cliRef);
accounts.add(cliRefOverwrite);

const setResult = cli(['secret', 'set', cliRef], CLI_VALUE);
const setBody = jsonOf(setResult.stdout);
check(
  'B1 set exits 0 and reports the repository path on the keychain backend',
  setResult.status === 0 && setBody.path === 'repository' && setBody.backend === 'keychain',
  setResult.stdout.trim(),
);
check('B1 the value is absent from stdout and stderr', !setResult.stdout.includes(CLI_VALUE) && !setResult.stderr.includes(CLI_VALUE));
check('B1 the raw Keychain item holds the value', readKeychain(cliRef) === CLI_VALUE);
say('');

const unicodeResult = cli(['secret', 'set', cliRef, '--audience', 'tool'], CLI_UNICODE);
const repoB = core.createSecretRepository({ home: homeB, backend: 'keychain' });
check(
  'B2 a non-ASCII CLI value is stored and read back unchanged by the repository',
  unicodeResult.status === 0 && repoB.get(cliRef)?.value === CLI_UNICODE,
  `expected-length=${String(CLI_UNICODE.length)} read-length=${String(repoB.get(cliRef)?.value.length ?? -1)}`,
);
say('');

const listResult = cli(['secret', 'list']);
check(
  'B3 list reports metadata only and names the ref',
  listResult.status === 0 && listResult.stdout.includes(cliRef) && !listResult.stdout.includes(CLI_UNICODE),
);
check('B3 list never carries the value', !listResult.stdout.includes(CLI_UNICODE));
say('');

const rotateResult = cli(['secret', 'rotate', cliRef], CLI_ROTATED);
const rotateBody = jsonOf(rotateResult.stdout);
check(
  'B4 rotate replaces an existing ref atomically',
  rotateResult.status === 0 && rotateBody.rotated === true && readKeychain(cliRef) === CLI_ROTATED,
  rotateResult.stdout.trim(),
);
check('B4 rotate output never carries the value', !rotateResult.stdout.includes(CLI_ROTATED) && !rotateResult.stderr.includes(CLI_ROTATED));
say('');

// Overwriting an already-registered ref through `set` must also work.
cli(['secret', 'set', cliRefOverwrite], CLI_VALUE);
const overwriteResult = cli(['secret', 'set', cliRefOverwrite], CLI_ROTATED);
check(
  'B5 set over an existing ref overwrites it',
  overwriteResult.status === 0 && readKeychain(cliRefOverwrite) === CLI_ROTATED,
);
say('');

const rotateMissing = cli(['secret', 'rotate', `${PREFIX}/never-registered`], MISSING_PROBE);
check(
  'B6 rotate of an unregistered ref reports the documented SECRET_NOT_FOUND',
  rotateMissing.status !== 0 && rotateMissing.stderr.includes('SECRET_NOT_FOUND'),
  rotateMissing.stderr.trim(),
);
check('B6 the refused rotate never echoes the value', !rotateMissing.stderr.includes(MISSING_PROBE));
say('');

const deleteResult = cli(['secret', 'delete', cliRef]);
check(
  'B7 delete removes the Keychain item',
  deleteResult.status === 0 && jsonOf(deleteResult.stdout).deleted === true && findItem(cliRef).status === 44,
  deleteResult.stdout.trim(),
);
const deleteAgain = cli(['secret', 'delete', cliRef]);
check('B7 deleting again reports deleted=false', deleteAgain.status === 0 && jsonOf(deleteAgain.stdout).deleted === false);
say('');

// B8 — the CLI process argv never carries the value (stdin only).
async function proveCliArgvClean(ref, value) {
  const child = spawn(process.execPath, [CLI, 'secret', 'set', ref], {
    env: envB,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  await new Promise((done) => setTimeout(done, 300));
  const ps = spawnSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' });
  const line = (ps.stdout ?? '').split('\n').find((entry) => entry.trim().startsWith(String(child.pid)));
  const clean = line !== undefined && !line.includes(value);
  child.stdin.end(value);
  const code = await new Promise((done) => child.on('close', done));
  return { clean, line: (line ?? '<process not observed>').trim(), code, stdout };
}
accounts.add(`${PREFIX}/provider-argv`);
const argvProof = await proveCliArgvClean(`${PREFIX}/provider-argv`, CLI_VALUE);
check('B8 the CLI process argv never contains the value (value comes from stdin)', argvProof.clean, argvProof.line);
check('B8 the blocked CLI finished and stored the value', argvProof.code === 0 && readKeychain(`${PREFIX}/provider-argv`) === CLI_VALUE);
say('');

// B9 — the real platform limitation: the value is visible in the short-lived `security`
// child's argv. Reproduce it with repeated calls and sample `ps` until it is observed.
async function proveSecurityArgvExposure(ref, value) {
  const loop = spawn(
    'bash',
    [
      '-c',
      'for i in $(seq 1 400); do /usr/bin/security add-generic-password -a "$KC_REF" -s agentdev-secret -w "$KC_VALUE" -U >/dev/null 2>&1; done',
    ],
    { env: { ...process.env, KC_REF: ref, KC_VALUE: value }, stdio: 'ignore' },
  );
  const deadline = Date.now() + 20_000;
  let seen = null;
  while (Date.now() < deadline) {
    const ps = spawnSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8' });
    seen = (ps.stdout ?? '')
      .split('\n')
      .find((entry) => entry.includes('security add-generic-password') && entry.includes(value));
    if (seen !== undefined) break;
    if (loop.exitCode !== null) break;
  }
  loop.kill('SIGKILL');
  await new Promise((done) => loop.on('close', done));
  return seen ?? null;
}
accounts.add(`${PREFIX}/provider-ps`);
const exposed = await proveSecurityArgvExposure(`${PREFIX}/provider-ps`, CLI_VALUE);
check(
  'B9 the platform limitation is real: `security` argv carries the value (documented, opt-in only)',
  exposed !== null,
  exposed === null ? 'not observed within the sampling window' : exposed,
);
say('');

// ---------------------------------------------------------------------------
// C. Daemon path: a keychain-backed Provider secret resolved by the model gateway
// ---------------------------------------------------------------------------

say('## C. Daemon path (real daemon + loopback stub Provider)');
say('');
for (const port of [4317, 4318]) {
  if (!(await portFree(port))) {
    say(`port ${String(port)} is busy; stop other daemons first (agentdev stop) and re-run`);
    process.exit(2);
  }
}

const dHome = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-wp12-kcdaemon-')));
const dRepo = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-wp12-kcrepo-')));
createdDirs.push(dHome, dRepo);
mkdirSync(join(dHome, 'logs'), { recursive: true, mode: 0o700 });
const envD = { ...process.env, AGENTDEV_HOME: dHome, AGENTDEV_SECRET_BACKEND: 'keychain' };
git(['init', '--quiet', '-b', 'agentdev/main'], dRepo);
writeFileSync(join(dRepo, 'README.md'), '# wp12 keychain drill\n');
git(['add', '-A'], dRepo);
git(
  ['-c', 'user.name=WP12 Drill', '-c', 'user.email=drill@example.invalid', 'commit', '--quiet', '-m', 'chore: seed'],
  dRepo,
);
process.on('exit', () => {
  spawnSync(process.execPath, [CLI, 'stop'], { env: envD, stdio: 'ignore' });
});

const seenAuth = [];
const stub = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    seenAuth.push(request.headers.authorization ?? null);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'wp12-stub-completion',
        object: 'chat.completion',
        model: 'wp12-kc-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'STUB-OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
    );
  });
});
await new Promise((done) => stub.listen(0, '127.0.0.1', done));
const stubBaseUrl = `http://127.0.0.1:${String(stub.address().port)}/v1`;
say(`loopback stub Provider: ${stubBaseUrl}`);

const startDaemon = () => {
  const result = spawnSync(process.execPath, [CLI, 'start', '--root', dRepo], { env: envD, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(mask(result.stdout));
  if (result.stderr) process.stderr.write(mask(result.stderr));
  say(`[agentdev start exit ${String(result.status)}]`);
  return result;
};
const stopDaemon = () => {
  const result = spawnSync(process.execPath, [CLI, 'stop'], { env: envD, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(mask(result.stdout));
  say(`[agentdev stop exit ${String(result.status)}]`);
  return result;
};

const rpcOnce = async (method, params) => {
  const record = jsonOf(readFileSync(join(dHome, 'runtime.json'), 'utf8'));
  const instance = record.instances[0];
  const token = readFileSync(join(dHome, 'installation-token'), 'utf8').trim();
  const payload = JSON.stringify({ v: 1, type: 'request', id: `${method}-${Date.now()}`, method, params });
  const response = await new Promise((done, reject) => {
    const request = httpRequest(
      `http://${instance.daemon.host}:${String(instance.daemon.port)}/rpc`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done({ status: res.statusCode ?? 0, body: jsonOf(Buffer.concat(chunks).toString('utf8')) }));
      },
    );
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
  if (response.body.ok !== true) throw new Error(`${method} refused: ${JSON.stringify(response.body.error)}`);
  return response.body.result;
};

/**
 * `start` returns once the daemon answers `/health`, but the protocol surface can still be
 * a moment from ready (observed as ECONNRESET right after a restart), so a transport-level
 * failure is retried instead of failing the drill.
 */
const rpc = async (method, params) => {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await rpcOnce(method, params);
    } catch (error) {
      lastError = error;
      const code = error?.code;
      if (!['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOENT'].includes(code)) throw error;
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  throw lastError;
};

const waitForAuth = async (expected, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (seenAuth.includes(expected)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
};

startDaemon();
// The settings-page path: `provider.upsert` carries the key as `secret`, so the server
// creates the ref `provider:<id>`, writes it to the durable repository (the real Keychain)
// and registers it in the in-memory store the Gateway resolves against.
const provider = await rpc('provider.upsert', {
  provider: {
    type: 'openai-compatible',
    baseUrl: stubBaseUrl,
    enabled: true,
    models: [
      { id: 'wp12-kc-model', contextWindow: 32_000, maxOutputTokens: 2_048, reasoningLevels: ['off', 'low'], vision: false },
    ],
  },
  secret: GATEWAY_VALUE,
});
const secretRef = `provider:${provider.providerId}`;
accounts.add(secretRef);
say(`provider.upsert -> ${JSON.stringify(provider)}`);
say(`secretRef=${secretRef}`);
check(
  'C1 provider.upsert reports the credential as configured',
  provider.secretConfigured === true,
  JSON.stringify(provider),
);
check('C1 the daemon wrote the credential to the real Keychain', readKeychain(secretRef) === GATEWAY_VALUE);
await rpc('provider.test', { providerId: provider.providerId, modelId: 'wp12-kc-model' });
check(
  'C1 the live gateway resolves the keychain credential for the probe',
  await waitForAuth(`Bearer ${GATEWAY_VALUE}`, 15_000),
  `stub saw ${JSON.stringify(seenAuth.map(mask))}`,
);

// C2 — restart the daemon: the credential now comes from the real Keychain via the
// startup load, proving the persistence path, not the in-memory registration.
stopDaemon();
seenAuth.length = 0;
startDaemon();
await rpc('provider.test', { providerId: provider.providerId, modelId: 'wp12-kc-model' });
check(
  'C2 after a restart the gateway resolves the credential loaded from the real Keychain',
  await waitForAuth(`Bearer ${GATEWAY_VALUE}`, 15_000),
  `stub saw ${JSON.stringify(seenAuth.map(mask))}`,
);

// C3 — rotate through the live admin surface with the CLI: the running daemon registers the
// new value immediately, and the durable copy in the real Keychain is replaced.
seenAuth.length = 0;
const liveSet = spawnSync(process.execPath, [CLI, 'secret', 'set', secretRef], {
  env: envD,
  input: GATEWAY_ROTATED,
  encoding: 'utf8',
});
if (liveSet.stdout) process.stdout.write(mask(liveSet.stdout));
say(`[exit ${String(liveSet.status)}]`);
check(
  'C3 the CLI registers against the live daemon through its admin surface',
  liveSet.status === 0 && jsonOf(liveSet.stdout).path === 'daemon' && jsonOf(liveSet.stdout).backend === 'keychain',
  liveSet.stdout.trim(),
);
check('C3 the real Keychain holds the rotated value', readKeychain(secretRef) === GATEWAY_ROTATED);
await rpc('provider.test', { providerId: provider.providerId, modelId: 'wp12-kc-model' });
check(
  'C3 the live gateway resolves the rotated credential immediately',
  await waitForAuth(`Bearer ${GATEWAY_ROTATED}`, 15_000),
  `stub saw ${JSON.stringify(seenAuth.map(mask))}`,
);
stopDaemon();
await new Promise((done) => stub.close(done));

const daemonLog = join(dHome, 'logs/daemon.log');
check(
  'C4 the credential never appears in the daemon log or the installation home',
  !readFileSync(daemonLog, 'utf8').includes(GATEWAY_VALUE) &&
    !readFileSync(daemonLog, 'utf8').includes(GATEWAY_ROTATED) &&
    !containsText(dHome, GATEWAY_VALUE) &&
    !containsText(dHome, GATEWAY_ROTATED),
);
say('');

// Delete through the stopped repository path, then prove the Keychain item is gone.
const gwDelete = spawnSync(process.execPath, [CLI, 'secret', 'delete', secretRef], { env: envD, encoding: 'utf8' });
check(
  'C5 deleting the keychain credential removes the real Keychain item',
  gwDelete.status === 0 && findItem(secretRef).status === 44,
  gwDelete.stdout.trim(),
);
say('');

// ---------------------------------------------------------------------------
// Cleanup evidence
// ---------------------------------------------------------------------------

say('## D. Cleanup');
say('');
const removed = cleanupKeychain();
say(`deleted ${String(removed)} created Keychain item(s) with \`security delete-generic-password\``);
let leftovers = 0;
for (const account of [...accounts].sort()) {
  const status = findItem(account).status;
  if (status !== 44) leftovers += 1;
  say(`  ${account} -> security find-generic-password exit ${String(status)} (44 = not found)`);
}
check('D every created Keychain item is gone from the login keychain', leftovers === 0, `${String(leftovers)} leftover(s)`);
check('D no value appears anywhere under the temp installation homes', !containsText(homeA, VALUE) && !containsText(homeB, CLI_VALUE) && !containsText(dHome, GATEWAY_VALUE));

for (const dir of [homeA, homeB, dHome, dRepo]) rmSync(dir, { recursive: true, force: true });
say(`removed temp dirs: ${[homeA, homeB, dHome, dRepo].map((dir) => dir.split('/').pop()).join(', ')}`);
check('D the temp installation dirs are gone', [homeA, homeB, dHome, dRepo].every((dir) => !existsSync(dir)));
say('');

say(`# Result: ${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
