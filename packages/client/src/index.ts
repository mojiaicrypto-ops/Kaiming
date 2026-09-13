/**
 * `@agentdev/client` — the browser-side protocol client.
 *
 * `docs/architecture/ARCHITECTURE.md` §2 gives this package the WebSocket
 * connection, commands and subscriptions; `docs/architecture/protocol.md` §1/§2/§7
 * fixes the envelopes, the watermark rules and the error table. The package is
 * consumed by the BFF, the local CLI and tests, so it assumes no browser: the
 * socket lives behind the `Transport` seam and the clock behind `Timers`.
 *
 * No third-party dependency is added (no `ws`): the wire is Node's global
 * `WebSocket` plus the shared `@agentdev/contracts` envelopes.
 */
import type { EventEnvelope, JsonObject } from '@agentdev/contracts';
import { ClientError, type ConnectionState, type SocketSession } from './connection.js';
import { ProtocolConnection, type ProtocolConnectionOptions } from './commands.js';
import {
  SubscriptionManager,
  parseEventFrame,
  type Subscription,
  type SubscriptionAuthOptions,
  type SubscriptionHost,
  type SubscriptionBatch,
  type SubscriptionOptions,
  type SubscriptionScope,
} from './subscriptions.js';

export {
  ClientError,
  DEFAULT_BACKOFF,
  REQUEST_ID_PREFIX,
  SocketSession,
  TRANSPORT_ERROR_CODES,
  WebSocketTransport,
  asClientError,
  backoffDelay,
  closeCodeToError,
  systemTimers,
  type BackoffPolicy,
  type ClientErrorCode,
  type CommandSender,
  type ConnectionState,
  type ConnectionStatus,
  type HandshakeHeaders,
  type RetryResolver,
  type SentHook,
  type SocketSessionOptions,
  type Timers,
  type Transport,
  type TransportErrorCode,
  type TransportListener,
  type TransportState,
  type TransportStatus,
  type WebSocketTransportOptions,
} from './connection.js';

export {
  DEFAULT_PROTOCOL_OPTIONS,
  ProtocolConnection,
  READ_ONLY_METHODS,
  SESSION_COOKIE_NAME,
  cookieValueOf,
  handshakeHeaders,
  httpCommand,
  httpLogin,
  httpLogout,
  httpStatusCode,
  isReadOnlyMethod,
  sessionCookieHeader,
  validateWriteOptions,
  type HttpAuthOptions,
  type HttpCommandOptions,
  type HttpLoginOptions,
  type LoginSession,
  type ProtocolConnectionOptions,
  type SessionCookie,
  type WriteOptions,
  type WriteReceipt,
} from './commands.js';

export {
  CLIENT_PROTOCOL_VERSION,
  SCOPE_KINDS,
  Subscription,
  SubscriptionManager,
  isResyncRequired,
  parseEventFrame,
  sameScope,
  scopeKey,
  validateScope,
  type AckResult,
  type ScopeKind,
  type SubscribeResult,
  type SubscriptionAuthOptions,
  type SubscriptionBatch,
  type SubscriptionHost,
  type SubscriptionManagerOptions,
  type SubscriptionOptions,
  type SubscriptionScope,
} from './subscriptions.js';

export type { EventEnvelope, JsonObject, JsonValue } from '@agentdev/contracts';

/** The subset of `ProtocolConnection` a subscription host needs. */
interface HostConnection {
  readonly state: ConnectionState;
  currentSession(): SocketSession | undefined;
  sendRead<T>(method: string, params: JsonObject, projectId?: string): Promise<T>;
}

/**
 * Builds the subscription host for one connection.
 *
 * Free of `this` capture: the getter reads the connection's live state, so the
 * manager never observes a stale value after a reconnect.
 */
function subscriptionHost(connection: HostConnection): SubscriptionHost {
  return {
    get state(): ConnectionState {
      return connection.state;
    },
    currentSession: () => connection.currentSession(),
    sendRead: <T = unknown>(method: string, params: JsonObject, projectId?: string) =>
      connection.sendRead<T>(method, params, projectId),
  };
}

export interface ProtocolClientOptions extends ProtocolConnectionOptions, SubscriptionAuthOptions {
  /** Redirects every live event to the caller, in addition to subscriptions. */
  readonly onEvent?: (event: EventEnvelope) => void;
}

/**
 * The complete client: connection state machine plus subscriptions.
 *
 * `subscribe()` is the documented way in: it carries the `since` watermark, and
 * after a reconnect every active subscription is re-attached from that watermark
 * so the caller sees each event exactly once.
 */
export class ProtocolClient extends ProtocolConnection {
  private readonly manager: SubscriptionManager;

  constructor(options: ProtocolClientOptions) {
    super(options);
    this.manager = new SubscriptionManager({
      host: subscriptionHost(this),
      ...(options.isProjectAuthorized === undefined
        ? {}
        : { isProjectAuthorized: options.isProjectAuthorized }),
      ...(options.isScopeAuthorized === undefined
        ? {}
        : { isScopeAuthorized: options.isScopeAuthorized }),
      ...(options.allowedKinds === undefined ? {} : { allowedKinds: options.allowedKinds }),
      ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    });
  }

  /** Every subscription this client owns. */
  get subscriptions(): readonly Subscription[] {
    return this.manager.list();
  }

  /** `RESYNC_REQUIRED` answers handled by re-snapshotting (a health signal). */
  get resyncCount(): number {
    return this.manager.resyncCount;
  }

  /**
   * Subscribes to a Project scope.
   *
   * Passing `since` resumes from that watermark; omitting it asks for a snapshot.
   * A scope change (`setScope`) always asks for a fresh snapshot, and a scope the
   * caller is not authorised for is refused before the request is sent.
   */
  subscribe(options: SubscriptionOptions): Promise<Subscription> {
    return this.manager.subscribe(options);
  }

  /** Replaces a subscription's scope; always answers a fresh snapshot. */
  setScope(subscription: Subscription, scope: SubscriptionScope): Promise<Subscription> {
    return this.manager.setScope(subscription, scope);
  }

  /** Removes a subscription from the server and this client. */
  remove(subscription: Subscription): Promise<boolean> {
    return this.manager.remove(subscription);
  }

  /** Acknowledges a cursor after the caller applied the whole batch. */
  ack(subscription: Subscription, cursor: number): Promise<number> {
    return this.manager.ack(subscription, cursor);
  }

  /** Replays exactly the events after `since` (defaults to the subscription watermark). */
  resume(subscription: Subscription, since?: number): Promise<SubscriptionBatch> {
    return this.manager.resume(subscription, since);
  }

  /** Re-attaches every active subscription from its watermark; used after a reconnect. */
  reattach(): Promise<void> {
    return this.manager.reattach();
  }

  /** Ends the connection and fails every subscription. */
  override end(): void {
    this.manager.closeAll();
    super.end();
  }

  protected override async afterOpen(): Promise<void> {
    await this.manager.reattach();
  }

  /** Events, batch watermarks and transient frames this client does not own. */
  protected override onOtherFrame(payload: string): void {
    const event = parseEventFrame(payload);
    if (event !== undefined) {
      this.manager.handleEvent(event);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as {
      type?: unknown;
      subscriptionId?: unknown;
      scannedThrough?: unknown;
    };
    if (
      frame.type === 'batch_end' &&
      typeof frame.subscriptionId === 'string' &&
      typeof frame.scannedThrough === 'number'
    ) {
      this.manager.handleBatchEnd(frame.subscriptionId, frame.scannedThrough);
      return;
    }
    if (frame.type === 'close') {
      // `protocol.md` §2: an expired session closes the socket with AUTH_EXPIRED.
      const written = (parsed as { reason?: unknown }).reason;
      const reason = typeof written === 'string' && written !== '' ? written : 'session expired';
      this.onSessionExpired(reason);
    }
  }

  /**
   * Ends an expired session.
   *
   * `protocol.md` §2/§7: an expired session sends `AUTH_EXPIRED` and closes; the
   * client surfaces the typed `lastError` and does not reconnect, because a repeat
   * attempt can only fail the same way.
   */
  protected onSessionExpired(reason: string): void {
    const failure = new ClientError({
      code: 'AUTH_EXPIRED',
      message: reason,
      retryable: false,
    });
    this.halted = true;
    this.started = false;
    this.lastError = failure;
    this.manager.closeAll(failure);
    this.setState('closed');
    this.rejectOpenWaiters(failure);
    this.transport.close(1000, reason);
  }

  /** The most recent failure, including an expired session seen on the wire. */
  get lastFailure(): ClientError | undefined {
    return this.lastError;
  }
}
