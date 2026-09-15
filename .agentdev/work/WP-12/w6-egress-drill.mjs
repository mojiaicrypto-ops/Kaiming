#!/usr/bin/env node
/**
 * WP-12 W6 controlled-egress drill (real containers, real network, real npm install).
 *
 * Proves the W6 boundary on this machine with the **real** pieces:
 *
 *   Core Egress proxy (loopback TCP) → egress sidecar container (bridge network, dumb
 *   forwarder) → named-volume Unix socket → in-container bridge (127.0.0.1:3128) →
 *   `npm`/raw HTTP clients.
 *
 * and asserts, from **inside** the tool container:
 *
 *   1. a real public fetch and a real `npm install` succeed through the egress;
 *   2. a local dev server on loopback is reachable by default;
 *   3. the daemon's actually-bound port is refused — directly, via `host.docker.internal`,
 *      and via the docker bridge gateway route;
 *   4. a metadata address is refused;
 *   5. a name that DNS resolves to a metadata address is refused;
 *   6. a redirect that lands on a metadata address is refused at the second hop;
 *   7. a raw socket from the container to the host reaches nothing at all (`--network none`).
 *
 * Usage: node .agentdev/work/WP-12/w6-egress-drill.mjs
 * Exit code 0 only when every assertion passes.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const core = await import(pathToFileURL(join(repoRoot, 'packages/core/dist/index.js')).href);
const IMAGE = process.env.AGENTDEV_EXEC_IMAGE ?? 'agentdev/exec:0.0.0';
const SIDECAR = `agentdev-w6-drill-${String(process.pid)}`;
const VOLUME = `agentdev-w6-drill-${String(process.pid)}`;

let failures = 0;
let checks = 0;

function record(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  if (detail !== undefined && detail !== '') console.log(detail.trimEnd());
}

/**
 * Runs a child process **asynchronously**.
 *
 * This matters: the Core egress proxy runs inside this same Node process, so a synchronous
 * `spawnSync` would block the event loop for the whole container run and the proxy could not
 * answer the very request the container is waiting for. The real daemon has the same
 * property for the same reason (`reliability.md` §5: tool shells never block the event loop).
 */
function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 300_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({ status: null, stdout, stderr, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ status: code, stdout, stderr, error: null });
    });
  });
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: server.address().port };
}

/** The in-container client: explicit HTTP-proxy requests through the bridge on :3128. */
const CLIENT = String.raw`
const http = require('node:http');
const net = require('node:net');
const target = process.env.DRILL_TARGET;
const follow = process.env.DRILL_FOLLOW === '1';
function proxyRequest(url) {
  return new Promise((done) => {
    const parsed = new URL(url);
    const request = http.request(
      { host: '127.0.0.1', port: 3128, method: 'GET', path: url, headers: { host: parsed.host } },
      (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => done({ status: response.statusCode, location: response.headers.location, body }));
      },
    );
    request.on('error', (error) => done({ status: 0, body: 'CLIENT_ERROR ' + error.code }));
    request.setTimeout(25_000, () => {
      request.destroy();
      done({ status: 0, body: 'CLIENT_TIMEOUT' });
    });
    request.end();
  });
}
(async () => {
  let result = await proxyRequest(target);
  if (follow && result.status >= 300 && result.status < 400 && result.location) {
    console.log('hop1 ' + result.status + ' -> ' + result.location);
    result = await proxyRequest(result.location);
    console.log('hop2 ' + result.status);
  }
  console.log('STATUS ' + result.status);
  console.log('BODY ' + String(result.body).replace(/\s+/g, ' ').slice(0, 300));
})();
`;

const DIRECT = String.raw`
const net = require('node:net');
const host = process.env.DRILL_HOST;
const port = Number(process.env.DRILL_PORT);
const socket = net.connect({ host, port });
socket.setTimeout(4000);
socket.on('connect', () => { console.log('DIRECT CONNECTED ' + host + ':' + port); socket.destroy(); });
socket.on('timeout', () => { console.log('DIRECT TIMEOUT ' + host + ':' + port); socket.destroy(); });
socket.on('error', (error) => console.log('DIRECT ERROR ' + host + ':' + port + ' ' + error.code));
`;

function container(args, env, command) {
  const dockerArgs = [
    'run',
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
    '--user',
    '10001:10001',
    '--mount',
    `type=volume,source=${VOLUME},target=/run/agentdev,readonly`,
    '--env',
    'AGENTDEV_EGRESS_SOCKET=/run/agentdev/egress.sock',
    '--env',
    'AGENTDEV_EGRESS_BRIDGE_PORT=3128',
    '--env',
    `AGENTDEV_EGRESS_BRIDGE_JS=${core.EGRESS_BRIDGE_SOURCE}`,
    '--env',
    `AGENTDEV_TOOL_COMMAND=${command}`,
    ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    IMAGE,
    '-lc',
    core.egressWrapperCommand(),
  ];
  return run('docker', dockerArgs, args[0] ?? {});
}

async function main() {
  // -------------------------------------------------------------------------
  // The three real host endpoints the drill decides about.
  // -------------------------------------------------------------------------
  const daemonStandIn = await listen((_request, response) => {
    response.end('DAEMON-ENDPOINT-REACHED');
  });
  const localDev = await listen((_request, response) => {
    response.end('LOCAL-DEV-SERVER-OK');
  });
  const redirector = await listen((_request, response) => {
    response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    response.end('redirecting');
  });
  console.log('drill: daemon stand-in on 127.0.0.1:%d, local dev on 127.0.0.1:%d, redirector on %d',
    daemonStandIn.port, localDev.port, redirector.port);

  // -------------------------------------------------------------------------
  // The Core proxy + the sidecar channel (the real EgressService pieces).
  // -------------------------------------------------------------------------
  const ports = [daemonStandIn.port];
  const proxy = new core.EgressProxy({
    policy: core.createEgressPolicy({ daemonPorts: () => ports }),
    log: (line) => console.log(`  core ${line}`),
  });
  const bound = await proxy.listen(0);
  ports.push(bound.port);
  console.log('drill: core proxy on 127.0.0.1:%d (denied ports: %j)', bound.port, ports);

  await run('docker', ['rm', '-f', SIDECAR]);
  await run('docker', ['volume', 'create', VOLUME]);
  const sidecar = await run('docker', [
    'run',
    '-d',
    '--name',
    SIDECAR,
    '--network',
    'bridge',
    '--user',
    '0:0',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=32m',
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
    '--mount',
    `type=volume,source=${VOLUME},target=/run/agentdev`,
    '--env',
    'AGENTDEV_EGRESS_SOCKET=/run/agentdev/egress.sock',
    '--env',
    `AGENTDEV_EGRESS_UPSTREAM=host.docker.internal:${String(bound.port)}`,
    '--env',
    `AGENTDEV_EGRESS_SIDECAR_JS=${core.EGRESS_SIDECAR_SOURCE}`,
    IMAGE,
    '-lc',
    'node -e "$AGENTDEV_EGRESS_SIDECAR_JS"',
  ]);
  if (sidecar.status !== 0) throw new Error(`sidecar failed to start: ${sidecar.stderr}`);
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    const logs = await run('docker', ['logs', SIDECAR]);
    ready = logs.stdout.includes('agentdev egress sidecar ready');
    if (!ready) await new Promise((done) => setTimeout(done, 100));
  }
  const sidecarLogs = await run('docker', ['logs', SIDECAR]);
  record('sidecar channel is live', ready, sidecarLogs.stdout + sidecarLogs.stderr);
  if (!ready) throw new Error('the egress sidecar never became ready');

  // The bridge gateway the container would use if it had a network: read from the sidecar's
  // own routing table, because on Docker Desktop it is a VM-internal address.
  const route = await run('docker', ['exec', SIDECAR, 'cat', '/proc/net/route']);
  let gateway = '';
  for (const line of route.stdout.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[1] !== '00000000') continue;
    const value = Number.parseInt(fields[2], 16);
    gateway = [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >>> 24) & 255].join('.');
  }
  console.log('drill: docker bridge gateway is %s', gateway === '' ? '(unknown)' : gateway);

  const probe = (env, command, timeoutMs) =>
    container([{ timeoutMs }], { DRILL_CLIENT_JS: CLIENT, DRILL_DIRECT_JS: DIRECT, ...env }, command);

  // 1. A real public HTTPS fetch through the egress (npm speaks HTTPS via CONNECT).
  const view = await probe(
    {},
    'cd /tmp && npm view is-number version --cache /tmp/npm --no-update-notifier',
    300_000,
  );
  record(
    'public fetch through the egress (npm view over HTTPS/CONNECT)',
    view.status === 0 && /\d+\.\d+\.\d+/.test(view.stdout),
    `exit=${String(view.status)}\n${view.stdout}\n${view.stderr}`,
  );

  // 2. A real dependency install through the egress.
  const install = await probe(
    {},
    'mkdir -p /tmp/proj && cd /tmp/proj && npm install is-number --no-save --cache /tmp/npm --no-update-notifier >/tmp/npm-install.log 2>&1; echo "npm-exit=$?"; ls -la /tmp/proj/node_modules/is-number/package.json 2>&1; tail -40 /tmp/npm-install.log',
    600_000,
  );
  record(
    'real npm install through the egress',
    install.stdout.includes('npm-exit=0') && install.stdout.includes('is-number/package.json'),
    install.stdout,
  );

  // 3. Loopback is open by default (a local dev server), including by name.
  const local = await probe({ DRILL_TARGET: `http://127.0.0.1:${String(localDev.port)}/` }, `node -e "$DRILL_CLIENT_JS"`, 60_000);
  record(
    'loopback target allowed by default',
    local.stdout.includes('STATUS 200') && local.stdout.includes('LOCAL-DEV-SERVER-OK'),
    local.stdout + local.stderr,
  );
  const localByName = await probe(
    { DRILL_TARGET: `http://127.0.0.1.nip.io:${String(localDev.port)}/` },
    `node -e "$DRILL_CLIENT_JS"`,
    60_000,
  );
  record(
    'a DNS name resolving to loopback is allowed by default',
    localByName.stdout.includes('STATUS 200'),
    localByName.stdout + localByName.stderr,
  );

  // 4. The daemon's actually-bound port, three ways.
  const daemonDirect = await probe(
    { DRILL_TARGET: `http://127.0.0.1:${String(daemonStandIn.port)}/` },
    `node -e "$DRILL_CLIENT_JS"`,
    60_000,
  );
  record(
    'daemon-bound port refused at the egress',
    daemonDirect.stdout.includes('STATUS 403') && daemonDirect.stdout.includes('AGENTDEV_EGRESS_REFUSED'),
    daemonDirect.stdout + daemonDirect.stderr,
  );
  const daemonByAlias = await probe(
    { DRILL_TARGET: `http://host.docker.internal:${String(daemonStandIn.port)}/` },
    `node -e "$DRILL_CLIENT_JS"`,
    60_000,
  );
  record(
    'daemon-bound port refused via host.docker.internal',
    daemonByAlias.stdout.includes('STATUS 403'),
    daemonByAlias.stdout + daemonByAlias.stderr,
  );
  if (gateway !== '') {
    const daemonByGateway = await probe(
      { DRILL_TARGET: `http://${gateway}:${String(daemonStandIn.port)}/` },
      `node -e "$DRILL_CLIENT_JS"`,
      60_000,
    );
    const refusedByPolicy = daemonByGateway.stdout.includes('STATUS 403');
    const unreachable = daemonByGateway.stdout.includes('STATUS 502') ||
      daemonByGateway.stdout.includes('STATUS 0');
    record(
      'daemon-bound port via the docker bridge gateway is not admitted',
      refusedByPolicy || unreachable,
      daemonByGateway.stdout + daemonByGateway.stderr,
    );
  }

  // 5/6. Metadata literal, metadata by DNS, and a redirect into metadata.
  const metadata = await probe(
    { DRILL_TARGET: 'http://169.254.169.254/latest/meta-data/' },
    `node -e "$DRILL_CLIENT_JS"`,
    60_000,
  );
  record(
    'metadata address refused',
    metadata.stdout.includes('STATUS 403') && metadata.stdout.includes('metadata'),
    metadata.stdout + metadata.stderr,
  );
  const metadataDns = await probe(
    { DRILL_TARGET: 'http://169.254.169.254.nip.io/latest/meta-data/' },
    `node -e "$DRILL_CLIENT_JS"`,
    60_000,
  );
  record(
    'DNS name resolving to metadata refused',
    metadataDns.stdout.includes('STATUS 403'),
    metadataDns.stdout + metadataDns.stderr,
  );
  const redirect = await probe(
    { DRILL_TARGET: `http://127.0.0.1:${String(redirector.port)}/go`, DRILL_FOLLOW: '1' },
    `node -e "$DRILL_CLIENT_JS"`,
    60_000,
  );
  record(
    'redirect landing on metadata refused at the second hop',
    redirect.stdout.includes('hop1 302') && redirect.stdout.includes('hop2 403'),
    redirect.stdout + redirect.stderr,
  );

  // 7. Raw sockets from the container reach nothing at all.
  const rawHost = await probe(
    { DRILL_HOST: 'host.docker.internal', DRILL_PORT: String(daemonStandIn.port) },
    `node -e "$DRILL_DIRECT_JS"`,
    60_000,
  );
  record(
    'raw socket from the container to host.docker.internal fails (no IP network)',
    rawHost.stdout.includes('DIRECT ERROR'),
    rawHost.stdout + rawHost.stderr,
  );
  if (gateway !== '') {
    const rawGateway = await probe(
      { DRILL_HOST: gateway, DRILL_PORT: String(daemonStandIn.port) },
      `node -e "$DRILL_DIRECT_JS"`,
      60_000,
    );
    record(
      'raw socket from the container to the bridge gateway fails',
      rawGateway.stdout.includes('DIRECT ERROR') || rawGateway.stdout.includes('DIRECT TIMEOUT'),
      rawGateway.stdout + rawGateway.stderr,
    );
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  await run('docker', ['rm', '-f', SIDECAR]);
  await run('docker', ['volume', 'rm', '-f', VOLUME]);
  await proxy.close();
  for (const endpoint of [daemonStandIn, localDev, redirector]) {
    await new Promise((done) => endpoint.server.close(done));
  }

  console.log(`\n=== W6 egress drill: ${String(checks - failures)}/${String(checks)} checks passed ===`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  await main();
} catch (error) {
  console.error(`drill aborted: ${error instanceof Error ? error.stack : String(error)}`);
  await run('docker', ['rm', '-f', SIDECAR]);
  await run('docker', ['volume', 'rm', '-f', VOLUME]);
  process.exit(1);
}
