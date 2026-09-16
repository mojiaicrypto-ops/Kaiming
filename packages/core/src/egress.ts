/**
 * The controlled network egress (`w1-implementation.md` §7, `execution.md` §2/§4).
 *
 * **Host-first revision**: this module serves the **optional container run environment**.
 * The default execution is the host, whose network is the host's: the admission layer
 * (`tool-handler.ts` literal-URL `NetworkPolicy`) and the audit are the guardrails there,
 * and a raw socket can bypass them (residual risk registered in `execution.md` 附录 A.5).
 * Nothing here is required for the default path. What is kept for both paths is
 * {@link NetworkPolicy}: the two fixed denials (the daemon's own bound ports and the cloud
 * metadata addresses) and nothing else.
 *
 * When a project does opt into the container environment, the container has **no IP
 * network**: `planContainerRun` keeps `--network none` even when
 * the call may reach the network. Its whole network path is a Unix socket in a named volume
 * mounted read-only, which a small dumb forwarder inside a sidecar container relays to this
 * Core-side proxy. Every byte of egress therefore crosses {@link EgressProxy}, which applies
 * {@link NetworkPolicy} — the two fixed denials (`w1-implementation.md` §7.2) and nothing
 * else — before it opens a connection.
 *
 * Why a sidecar and not a mounted host socket: the daemon must run on Linux **and** macOS.
 * Docker Desktop for macOS shares host directories through VirtioFS, which presents a Unix
 * socket inode but cannot relay `connect(2)` to it — measured, see
 * `w6-implementation.md` §4.1. A named volume lives inside the Docker VM, so a
 * container-to-container socket over it works on both platforms, and the sidecar reaches
 * the daemon's loopback listener the same way any container reaches its host
 * (`host.docker.internal`).
 *
 * The consequence for the boundary is favourable and is stated plainly in
 * `docs/architecture/execution.md` §3: the tool container has no route to the daemon, to
 * `host.docker.internal`, to the docker bridge gateway, to the LAN or to the public
 * internet. A raw socket from an arbitrary tool inside it (`node net`, `nc`, a compiled
 * binary) cannot reach anything at all; the mounted socket is the only egress, and it
 * terminates at the policy. A tool that speaks HTTP to the socket directly — instead of
 * through the in-container bridge — still reaches the same policy, so the enforcement point
 * is not the bridge.
 */
import {
  request as httpRequest,
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect as netConnect } from 'node:net';
import type { Duplex } from 'node:stream';

import { NetworkPolicy, hostInterfaceAddresses, type HostResolver } from './broker.js';
import { EGRESS_REFUSED_MARKER } from './egress-channel.js';

/**
 * How long the proxy waits for an upstream connection before it gives up.
 *
 * Long enough for a real origin, short enough that a route which cannot exist (the docker
 * bridge gateway as seen from the host) is reported instead of hanging.
 */
export const EGRESS_CONNECT_TIMEOUT_MS = 15_000;

export {
  EGRESS_BRIDGE_PORT,
  EGRESS_BRIDGE_SOURCE,
  EGRESS_MOUNT_DIR,
  EGRESS_REFUSED_MARKER,
  EGRESS_SOCKET_NAME,
  EGRESS_UPSTREAM_ENV,
  egressToolEnv,
  egressWrapperCommand,
  type ContainerEgressChannel,
} from './egress-channel.js';

/**
 * The sidecar forwarder: the named-volume Unix socket → the Core proxy.
 *
 * It is deliberately policy-free. Its only job is to give the tool container a peer it can
 * reach without an IP network. The upstream host is `host.docker.internal` (Docker
 * Desktop's documented container→host route); on a Linux engine that name usually does not
 * resolve, so the forwarder falls back to its own default gateway read from
 * `/proc/net/route` — which is the host on a default bridge. The Core proxy is what decides
 * whether anything may leave, and it denies the daemon's own ports whichever spelling
 * arrived.
 */
export const EGRESS_SIDECAR_SOURCE = String.raw`
const net = require('node:net');
const fs = require('node:fs');
const socket = process.env.AGENTDEV_EGRESS_SOCKET || '/run/agentdev/egress.sock';
const target = process.env.AGENTDEV_EGRESS_UPSTREAM || 'host.docker.internal:1';
const separator = target.lastIndexOf(':');
const named = target.slice(0, separator);
const port = Number(target.slice(separator + 1));
function defaultGateway() {
  try {
    const lines = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      if (fields[1] !== '00000000') continue;
      const value = parseInt(fields[2], 16);
      if (!Number.isInteger(value)) continue;
      return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >>> 24) & 255].join('.');
    }
  } catch {}
  return null;
}
function reachable(host, callback) {
  const probe = net.connect(port, host);
  probe.setTimeout(1500);
  probe.once('connect', () => { probe.destroy(); callback(host); });
  probe.once('timeout', () => { probe.destroy(); callback(null); });
  probe.once('error', () => { callback(null); });
}
reachable(named, (first) => {
  const host = first === null ? defaultGateway() : first;
  if (host === null) {
    console.error('agentdev egress sidecar: no route to the Core proxy (' + named + ')');
    process.exit(3);
  }
  try { fs.unlinkSync(socket); } catch {}
  const server = net.createServer((client) => {
    const out = net.connect(port, host);
    client.on('error', () => out.destroy());
    out.on('error', () => client.destroy());
    client.pipe(out);
    out.pipe(client);
  });
  server.on('error', (error) => {
    console.error('agentdev egress sidecar failed: ' + error.message);
    process.exit(2);
  });
  server.listen(socket, () => {
    try { fs.chmodSync(socket, 0o666); } catch {}
    console.log('agentdev egress sidecar ready on ' + socket + ' -> ' + host + ':' + port);
  });
});
`;

/**
 * The Core-side proxy: an HTTP proxy on loopback that applies {@link NetworkPolicy}.
 *
 * It speaks the two shapes a proxy sees — an absolute-URI request (`GET http://host/…`) and
 * `CONNECT host:port` — and validates each one **independently**, so a redirect is decided
 * at the hop it targets rather than at the origin that produced it. The connection is then
 * pinned to an address the policy returned, so a second lookup cannot rebind the name to a
 * metadata address between the decision and the connect (W7R2-03).
 */
export interface EgressProxyOptions {
  readonly policy: NetworkPolicy;
  readonly host?: string;
  readonly log?: (line: string) => void;
}

export interface EgressProxyAddress {
  readonly host: string;
  readonly port: number;
}

export class EgressProxy {
  private readonly policy: NetworkPolicy;
  private readonly host: string;
  private readonly log: (line: string) => void;
  private server: Server | null = null;
  private address: EgressProxyAddress | null = null;

  constructor(options: EgressProxyOptions) {
    this.policy = options.policy;
    this.host = options.host ?? '127.0.0.1';
    this.log = options.log ?? ((): void => undefined);
  }

  /** The bound address, after {@link listen}. */
  get bound(): EgressProxyAddress | null {
    return this.address === null ? null : { ...this.address };
  }

  /** Binds the proxy on loopback and returns its address. */
  async listen(port = 0): Promise<EgressProxyAddress> {
    const server = createHttpServer();
    server.on('request', (request, response) => {
      void this.handleRequest(request.url ?? '/', request, response);
    });
    // A `CONNECT` is a request to tunnel arbitrary bytes; only the authority is decidable,
    // and that is exactly the hop that matters (`https://` origins open one CONNECT each).
    server.on('connect', (request, client, head) => {
      void this.handleConnect(request.url ?? '', client, head);
    });
    server.on('clientError', (_error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, this.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const bound = server.address();
    if (bound === null || typeof bound === 'string') {
      server.close();
      throw new Error('the egress proxy did not bind a TCP address');
    }
    this.server = server;
    this.address = { host: this.host, port: bound.port };
    this.log(`egress: proxy listening on ${this.host}:${String(bound.port)}`);
    return this.address;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.address = null;
    if (server === null) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private refuseResponse(response: ServerResponse, reason: string): void {
    this.log(`egress: refused — ${reason}`);
    const body = `${EGRESS_REFUSED_MARKER}: ${reason}\n`;
    response.writeHead(403, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(Buffer.byteLength(body, 'utf8')),
      connection: 'close',
      'x-agentdev-egress': 'refused',
    });
    response.end(body);
  }

  private refuseSocket(client: Duplex, reason: string): void {
    this.log(`egress: refused — ${reason}`);
    const body = `${EGRESS_REFUSED_MARKER}: ${reason}\n`;
    client.end(
      `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${String(Buffer.byteLength(body, 'utf8'))}\r\nConnection: close\r\n\r\n${body}`,
    );
  }

  private async handleRequest(
    target: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = this.absoluteUrl(target, request.headers.host);
    if (url === null) {
      this.refuseResponse(response, `proxy request without an absolute target: ${target}`);
      return;
    }
    const decision = await this.policy.decide({ url: url.toString() });
    if (!decision.ok) {
      this.refuseResponse(response, decision.reason);
      return;
    }
    const port = url.port === '' ? 80 : Number.parseInt(url.port, 10);
    this.forwardPlain(url, port, decision.addresses ?? [url.hostname], request, response);
  }

  /**
   * Forwards one plaintext request to the pinned address.
   *
   * The `Host` header keeps the name the client asked for (a virtual host needs it), while
   * the socket goes to an address the policy validated.
   */
  private forwardPlain(
    url: URL,
    port: number,
    addresses: readonly string[],
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const attempt = (index: number): void => {
      const address = addresses[index];
      if (address === undefined) {
        if (!response.headersSent) response.writeHead(502, { connection: 'close' });
        response.end(`${EGRESS_REFUSED_MARKER}: no validated address for ${url.hostname}\n`);
        return;
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (key === 'proxy-connection') continue;
        if (typeof value === 'string') headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value.join(', ');
      }
      headers['host'] = url.host;
      delete headers['proxy-connection'];
      const upstream = httpRequest(
        {
          host: address,
          port,
          method: request.method ?? 'GET',
          path: `${url.pathname}${url.search}`,
          headers,
          // A target that blackholes (an address the host has no route to) must not hold
          // the request open forever: the whole point of deciding before connecting is that
          // the answer comes from the policy, and a transport that never answers looks like
          // a hang rather than a decision.
          timeout: EGRESS_CONNECT_TIMEOUT_MS,
        },
        (upstreamResponse) => {
          if (!response.headersSent) {
            response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          }
          upstreamResponse.pipe(response);
        },
      );
      upstream.on('timeout', () => upstream.destroy(new Error('connect timeout')));
      upstream.on('error', (error) => {
        this.log(`egress: forward to ${url.host} failed (${error.message})`);
        attempt(index + 1);
      });
      request.pipe(upstream);
    };
    attempt(0);
  }

  private async handleConnect(target: string, client: Duplex, head: Buffer): Promise<void> {
    const separator = target.lastIndexOf(':');
    const host = separator === -1 ? target : target.slice(0, separator);
    const port = separator === -1 ? 443 : Number.parseInt(target.slice(separator + 1), 10);
    if (host === '' || !Number.isInteger(port)) {
      this.refuseSocket(client, `CONNECT target ${target} is not host:port`);
      return;
    }
    const decision = await this.policy.decide({ host, port });
    if (!decision.ok) {
      this.refuseSocket(client, decision.reason);
      return;
    }
    const addresses = decision.addresses ?? [host];
    const tunnel = (index: number): void => {
      const address = addresses[index];
      if (address === undefined) {
        this.refuseSocket(client, `no validated address for ${host}`);
        return;
      }
      const upstream = netConnect({ host: address, port });
      // The timeout is an *inactivity* timeout, so it is cleared once the tunnel is up and
      // the bytes are the client's business.
      upstream.setTimeout(EGRESS_CONNECT_TIMEOUT_MS, () =>
        upstream.destroy(new Error('connect timeout')),
      );
      upstream.once('connect', () => {
        upstream.setTimeout(0);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', (error) => {
        this.log(`egress: CONNECT to ${host}:${String(port)} failed (${error.message})`);
        if (index === addresses.length - 1) {
          client.destroy();
          return;
        }
        upstream.destroy();
        tunnel(index + 1);
      });
    };
    tunnel(0);
  }

  private absoluteUrl(target: string, hostHeader: string | undefined): URL | null {
    try {
      if (/^https?:\/\//i.test(target)) return new URL(target);
      if (hostHeader === undefined || hostHeader === '') return null;
      return new URL(`http://${hostHeader}${target.startsWith('/') ? target : `/${target}`}`);
    } catch {
      return null;
    }
  }
}

/**
 * The address a container uses to reach its host.
 *
 * `host.docker.internal` is Docker Desktop's documented name; on Linux it is usually absent
 * and the bridge gateway is the route. The sidecar is given the name and, when it cannot
 * resolve it, falls back to the gateway it reads from its own routing table — the proxy
 * applies the daemon-port denial to both spellings either way, so the fallback cannot widen
 * the boundary.
 */
export const DEFAULT_EGRESS_UPSTREAM_HOST = 'host.docker.internal';

/**
 * Builds the container-network policy the daemon uses.
 *
 * One place, so the admission layer (`tool-handler.ts`), the Broker and the Egress proxy all
 * consult the same two fixed denials and the same live bound-port registry.
 */
export function createEgressPolicy(options: {
  readonly daemonPorts: () => readonly number[];
  readonly resolver?: HostResolver;
  readonly nat64Prefixes?: readonly string[];
}): NetworkPolicy {
  return new NetworkPolicy({
    daemonPorts: options.daemonPorts,
    localAddresses: () => hostInterfaceAddresses(),
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    ...(options.nat64Prefixes === undefined ? {} : { nat64Prefixes: options.nat64Prefixes }),
  });
}
