/**
 * The controlled-egress channel: the contract the Broker, the sidecar and the proxy share.
 *
 * Kept apart from `egress.ts` on purpose. `egress.ts` (the proxy) imports `broker.ts`
 * (`NetworkPolicy`), and `broker.ts` needs the channel's constants and wrapper; putting
 * those here means the dependency graph is `channel ← broker ← egress` with no cycle, so a
 * bundler cannot observe either module half-initialised.
 */

/** The socket file the sidecar creates inside the shared volume. */
export const EGRESS_SOCKET_NAME = 'egress.sock';

/** Where the shared volume is mounted in both containers. */
export const EGRESS_MOUNT_DIR = '/run/agentdev';

/** The loopback port the in-container bridge listens on for `HTTP_PROXY`. */
export const EGRESS_BRIDGE_PORT = 3128;

/** The env var naming the socket inside the container. */
export const EGRESS_SOCKET_ENV = 'AGENTDEV_EGRESS_SOCKET';
/** The env var carrying the in-container bridge source. */
export const EGRESS_BRIDGE_SOURCE_ENV = 'AGENTDEV_EGRESS_BRIDGE_JS';
/** The env var naming the in-container bridge port. */
export const EGRESS_BRIDGE_PORT_ENV = 'AGENTDEV_EGRESS_BRIDGE_PORT';
/** The env var carrying the tool command through the wrapper. */
export const EGRESS_COMMAND_ENV = 'AGENTDEV_TOOL_COMMAND';
/** The env var naming the sidecar's upstream (`host:port`) — the Core proxy. */
export const EGRESS_UPSTREAM_ENV = 'AGENTDEV_EGRESS_UPSTREAM';

/** The refusal marker in a proxy response body; also the log line prefix. */
export const EGRESS_REFUSED_MARKER = 'AGENTDEV_EGRESS_REFUSED';

/**
 * The handle a tool container needs to use the controlled channel.
 *
 * The Broker knows nothing about how the channel is built; it only mounts the volume and
 * sets the environment. That keeps the daemon's container lifecycle (the sidecar) out of
 * Core while Core keeps the policy and the proxy.
 */
export interface ContainerEgressChannel {
  /**
   * Starts the channel if it is not running, and reports whether it is usable.
   *
   * Synchronous `available()` is what the container plan reads; `ensure()` is the async
   * half the Broker awaits before it yields a container, so a first call really does get a
   * live channel instead of silently running without one.
   */
  ensure(): Promise<boolean>;
  /** Whether the channel is live **right now**; a dead channel is not mounted. */
  available(): boolean;
  /** Named volume holding the socket; a docker named volume, not a host path. */
  readonly volume: string;
  /** Where the volume is mounted in the tool container. */
  readonly mountPath: string;
}

/**
 * The in-container bridge: TCP on loopback → the named-volume Unix socket.
 *
 * `npm`, `pip`, `curl` and `git` honour `HTTP_PROXY`/`HTTPS_PROXY`, which must be an
 * `http://` URL, so something has to translate TCP to the socket. The bridge is data-only
 * and enforces nothing: every request it relays still meets the Core proxy. It is passed as
 * an env var rather than mounted so a packaged installation needs no extra file.
 */
export const EGRESS_BRIDGE_SOURCE = String.raw`
const net = require('node:net');
const fs = require('node:fs');
const socket = process.env.AGENTDEV_EGRESS_SOCKET || '/run/agentdev/egress.sock';
const port = Number(process.env.AGENTDEV_EGRESS_BRIDGE_PORT || '3128');
const readyFile = '/tmp/agentdev-egress.ready';
const server = net.createServer((client) => {
  const upstream = net.connect(socket);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
});
server.on('error', (error) => {
  console.error('agentdev egress bridge failed: ' + error.message);
  process.exit(2);
});
server.listen(port, '127.0.0.1', () => {
  try { fs.writeFileSync(readyFile, '1'); } catch {}
  console.error('agentdev egress bridge listening on 127.0.0.1:' + port);
});
`;

/** The environment that points a tool container's HTTP clients at the bridge. */
export function egressToolEnv(mountPath: string = EGRESS_MOUNT_DIR): Record<string, string> {
  return {
    [EGRESS_SOCKET_ENV]: `${mountPath}/${EGRESS_SOCKET_NAME}`,
    [EGRESS_BRIDGE_PORT_ENV]: String(EGRESS_BRIDGE_PORT),
    [EGRESS_BRIDGE_SOURCE_ENV]: EGRESS_BRIDGE_SOURCE,
  };
}

/**
 * The shell wrapper that starts the bridge before the tool command.
 *
 * The tool command travels through the environment rather than being interpolated into the
 * wrapper text: it is a model-supplied shell command, and concatenating it into another
 * shell string is exactly the quoting hazard `git`'s argv form exists to avoid. The wrapper
 * waits for the bridge's readiness file (bounded), exports the proxy variables — including
 * an empty `NO_PROXY` so an inherited value cannot punch a hole — and then hands the shell
 * to the original command with `exec`, so signals and exit codes stay the tool's.
 */
export function egressWrapperCommand(): string {
  return [
    'node -e "$' + EGRESS_BRIDGE_SOURCE_ENV + '" >/tmp/agentdev-egress-bridge.log 2>&1 &',
    'i=0; while [ ! -f /tmp/agentdev-egress.ready ] && [ "$i" -lt 200 ]; do i=$((i+1)); sleep 0.05; done',
    'export HTTP_PROXY="http://127.0.0.1:$' + EGRESS_BRIDGE_PORT_ENV + '"',
    'export HTTPS_PROXY="$HTTP_PROXY" http_proxy="$HTTP_PROXY" https_proxy="$HTTP_PROXY"',
    'export ALL_PROXY="$HTTP_PROXY" all_proxy="$HTTP_PROXY" NO_PROXY="" no_proxy=""',
    'exec /bin/bash -lc "$' + EGRESS_COMMAND_ENV + '"',
  ].join('\n');
}
