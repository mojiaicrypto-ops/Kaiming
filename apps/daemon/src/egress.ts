/**
 * The daemon's controlled-egress channel (WP-12 W6).
 *
 * **Host-first revision**: this service is part of the **optional container run
 * environment**, not of the default path. The default host execution uses the host network
 * with the admission-layer guard and audit (`tool-handler.ts` literal-URL `NetworkPolicy`),
 * and nothing here is started for it — {@link ensure} is the only entry point that binds the
 * proxy or creates a container.
 *
 * Two pieces, one policy:
 *
 * 1. {@link EgressProxy} — the Core-side HTTP proxy. It listens on loopback, applies
 *    `NetworkPolicy` (the two fixed denials and nothing else), and is the **only** place a
 *    container's network request is authorised. Its own port is part of the bound-port
 *    registry, so a container cannot proxy to the proxy.
 * 2. A small **sidecar container** that forwards the shared-volume Unix socket to the
 *    proxy. It is deliberately policy-free; it exists because the tool container has no IP
 *    network (`--network none`, always) and therefore needs a peer it can reach over a
 *    named volume rather than over TCP.
 *
 * Why a sidecar instead of a host socket bind mount: Docker Desktop for macOS shares host
 * directories through VirtioFS, which presents a Unix socket file inside the container but
 * cannot relay `connect(2)` to the host process (measured — `w6-implementation.md` §4.1).
 * A named volume lives inside the Docker VM, so container-to-container socket sharing works
 * on macOS and Linux alike, and the sidecar reaches the daemon's loopback listener through
 * `host.docker.internal` — the documented container→host route.
 *
 * Failure is fail-closed in the direction that matters: if the proxy cannot bind or the
 * sidecar cannot be started, {@link available} stays `false`, the Broker refuses a
 * network-covered container call with `PROVIDER_UNAVAILABLE`, and **no container is ever
 * given an IP network**.
 */
import { createHash } from 'node:crypto';

import {
  EGRESS_MOUNT_DIR,
  EGRESS_SIDECAR_SOURCE,
  EGRESS_SOCKET_ENV,
  EGRESS_SOCKET_NAME,
  EGRESS_UPSTREAM_ENV,
  EgressProxy,
  createEgressPolicy,
  defaultProcessRunner,
  EXEC_IMAGE,
  hostInterfaceAddresses,
  type ContainerEgressChannel,
  type EgressProxyAddress,
  type ProcessRunner,
} from '@agentdev/core';

/** The registry of ports the daemon actually bound (first fixed denial). */
export interface EgressPortRegistry {
  add(port: number): void;
  list(): readonly number[];
}

/** A registry backed by a live set; `main.ts` fills it as listeners bind. */
export function createEgressPortRegistry(): EgressPortRegistry {
  const ports = new Set<number>();
  return {
    add: (port) => {
      if (Number.isInteger(port) && port > 0) ports.add(port);
    },
    list: () => [...ports],
  };
}

export interface EgressServiceOptions {
  /** Distinguishes this installation's sidecar and volume. */
  readonly scope: string;
  readonly image?: string;
  readonly process?: ProcessRunner;
  /** The container-visible name of the daemon host; overridable for tests. */
  readonly upstreamHost?: string;
  /** Bound-port registry the policy reads live. */
  readonly ports: EgressPortRegistry;
  readonly log?: (line: string) => void;
}

/**
 * The daemon-wide egress service: one proxy, one sidecar, one volume.
 *
 * One per daemon rather than one per project, because the boundary is "the agent may not
 * reach *this daemon*": a single policy holding every project's bound ports is stricter
 * than a per-project policy that has to be told about its siblings.
 */
export class EgressService implements ContainerEgressChannel {
  readonly volume: string;
  readonly mountPath = EGRESS_MOUNT_DIR;
  private readonly scope: string;
  private readonly image: string;
  private readonly process: ProcessRunner;
  private readonly upstreamHost: string;
  private readonly ports: EgressPortRegistry;
  private readonly log: (line: string) => void;
  private proxy: EgressProxy | null = null;
  private proxyAddress: EgressProxyAddress | null = null;
  private status: 'stopped' | 'starting' | 'ready' | 'failed' = 'stopped';
  private failure: string | null = null;
  private ensuring: Promise<boolean> | null = null;

  constructor(options: EgressServiceOptions) {
    const digest = createHash('sha256').update(options.scope).digest('hex').slice(0, 12);
    this.volume = `agentdev-egress-${digest}`;
    this.scope = digest;
    this.image = options.image ?? EXEC_IMAGE;
    this.process = options.process ?? defaultProcessRunner;
    this.upstreamHost = options.upstreamHost ?? 'host.docker.internal';
    this.ports = options.ports;
    this.log = options.log ?? ((): void => undefined);
  }

  /** The sidecar container's name; deterministic so a crashed daemon's is reaped. */
  get containerName(): string {
    return `agentdev-egress-${this.scope}`;
  }

  /** The Core proxy's bound address, once {@link start} has run. */
  get proxyBound(): EgressProxyAddress | null {
    return this.proxyAddress === null ? null : { ...this.proxyAddress };
  }

  /** Why the channel is not live, when it is not. */
  get reason(): string | null {
    return this.failure;
  }

  /**
   * Starts the Core proxy. The sidecar is started lazily by {@link ensure}, so a daemon
   * that never runs a container tool call never creates a container. Failing to bind is
   * not fatal to the daemon: the channel simply stays unavailable and network-covered
   * container calls are refused.
   */
  async start(): Promise<void> {
    if (this.proxy !== null) return;
    const policy = createEgressPolicy({
      daemonPorts: () => this.ports.list(),
    });
    const proxy = new EgressProxy({ policy, log: this.log });
    const bound = await proxy.listen(0);
    this.proxy = proxy;
    this.proxyAddress = bound;
    // The proxy's own port is a daemon port: an agent must not be able to proxy to the
    // proxy and reach loopback through it a second time.
    this.ports.add(bound.port);
    this.log(
      `egress: core proxy on ${bound.host}:${String(bound.port)} (${hostInterfaceAddresses().length} local addresses, ${String(this.ports.list().length)} denied ports)`,
    );
  }

  /** Whether the sidecar is live and the proxy is bound. */
  available(): boolean {
    return this.status === 'ready';
  }

  /**
   * Starts the channel if it is not running, and reports whether it is usable.
   *
   * Host-first revision: this is the **only** entry point that creates anything. The daemon
   * no longer starts the proxy at boot, so the default host path opens no listener and no
   * container; the Core proxy binds on the first call that asks for the optional container
   * environment, and the sidecar follows. Serialised: concurrent tool calls share one start
   * attempt, so a burst of calls cannot race two `docker run` invocations for the same
   * container name. A proxy that cannot bind leaves the channel unavailable, which the
   * Broker turns into a typed refusal instead of an open network path.
   */
  async ensure(): Promise<boolean> {
    if (this.available()) return true;
    if (this.proxyAddress === null) {
      await this.start().catch((error: unknown) => {
        this.failure = `egress proxy failed to bind: ${
          error instanceof Error ? error.message : String(error)
        }`;
        this.log(`egress: ${this.failure}`);
      });
    }
    if (this.proxyAddress === null) return false;
    this.ensuring ??= this.startSidecar().finally(() => {
      this.ensuring = null;
    });
    return this.ensuring;
  }

  private async startSidecar(): Promise<boolean> {
    this.status = 'starting';
    const upstream = `${this.upstreamHost}:${String(this.proxyAddress?.port ?? 0)}`;
    const volume = this.run(['volume', 'create', this.volume]);
    if (!volume.ok) {
      this.status = 'failed';
      this.failure = `docker volume create failed: ${volume.detail}`;
      this.log(`egress: ${this.failure}`);
      return false;
    }
    // A crashed daemon leaves the sidecar behind; the name is deterministic, so reap it
    // rather than failing on a name conflict.
    this.run(['rm', '-f', this.containerName]);
    const started = this.run([
      'run',
      '-d',
      '--name',
      this.containerName,
      // The sidecar is the only container with a network. It has no host mounts, no docker
      // socket, no capabilities and a read-only root filesystem; its whole job is to pipe
      // bytes from the shared volume to the Core proxy, which is where the policy lives.
      '--network',
      'bridge',
      '--user',
      '0:0',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=32m',
      '--cap-drop=ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '64',
      '--memory',
      '256m',
      '--mount',
      `type=volume,source=${this.volume},target=${this.mountPath}`,
      '--env',
      `${EGRESS_SOCKET_ENV}=${this.mountPath}/${EGRESS_SOCKET_NAME}`,
      '--env',
      `${EGRESS_UPSTREAM_ENV}=${upstream}`,
      '--env',
      `AGENTDEV_EGRESS_SIDECAR_JS=${EGRESS_SIDECAR_SOURCE}`,
      this.image,
      '-lc',
      'node -e "$AGENTDEV_EGRESS_SIDECAR_JS"',
    ]);
    if (!started.ok) {
      this.status = 'failed';
      this.failure = `docker run failed: ${started.detail}`;
      this.log(`egress: ${this.failure}`);
      return false;
    }
    const ready = await this.waitForReady();
    if (!ready.ok) {
      this.status = 'failed';
      this.failure = ready.detail;
      this.log(`egress: ${this.failure}`);
      this.run(['rm', '-f', this.containerName]);
      return false;
    }
    this.status = 'ready';
    this.failure = null;
    this.log(`egress: sidecar ${this.containerName} ready (volume ${this.volume} → ${upstream})`);
    return true;
  }

  /**
   * Waits for the sidecar's readiness line.
   *
   * The socket lives inside the Docker VM's volume, which the host cannot see, so the
   * readiness signal is the process's own stdout: `docker logs` is the one channel that
   * crosses the boundary without publishing a port (a published readiness port would put
   * another daemon-reachable listener on loopback for no benefit).
   */
  private async waitForReady(): Promise<{ ok: true } | { ok: false; detail: string }> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const logs = this.run(['logs', this.containerName]);
      if (logs.ok && logs.stdout.includes('agentdev egress sidecar ready')) return { ok: true };
      const state = this.run(['inspect', '-f', '{{.State.Status}}', this.containerName]);
      if (state.ok && state.stdout.trim() === 'exited') {
        return {
          ok: false,
          detail: `the egress sidecar exited before it was ready: ${logs.detail.trim()}`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, detail: 'the egress sidecar did not become ready within 6s' };
  }

  /** Stops the sidecar, removes the volume and closes the proxy. */
  async stop(): Promise<void> {
    this.status = 'stopped';
    this.run(['rm', '-f', this.containerName]);
    this.run(['volume', 'rm', '-f', this.volume]);
    const proxy = this.proxy;
    this.proxy = null;
    this.proxyAddress = null;
    if (proxy !== null) await proxy.close();
  }

  private run(args: readonly string[]): {
    readonly ok: boolean;
    readonly stdout: string;
    readonly detail: string;
  } {
    const result = this.process.run('docker', [...args], { timeoutMs: 30_000 });
    const detail = (result.stderr.trim() || result.error || '').trim();
    return {
      ok: result.status === 0 && result.error === undefined,
      stdout: result.stdout,
      detail: detail === '' ? `exit ${String(result.status)}` : detail,
    };
  }
}
