/**
 * Same-origin HTTP entry (R1): one JSON request route, static files for the workbench, and the access
 * rules around them. The browser talks only to this surface - never to Pi and never with a credential
 * in a URL.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthService, CSRF_HEADER } from './auth.ts';
import { SessionEventHub, type StreamEvent } from './hub.ts';
import { RPC_PATH, RpcError, RpcRouter, statusFor, toRpcError, type RpcContext, type RpcResponse } from './rpc.ts';
import type { Store } from '../store/store.ts';

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

export interface WorkbenchServerOptions {
  readonly store: Store;
  readonly auth: AuthService;
  readonly router: RpcRouter;
  /** Live session events (M4); without a hub the stream route is not mounted. */
  readonly hub?: SessionEventHub;
  /** Directory served at `/` (the workbench UI); absent means no static surface yet. */
  readonly staticDir?: string;
  /** Directory served at `/app/` (the React shell build); absent means the route is not mounted. */
  readonly appStaticDir?: string;
  readonly bodyLimitBytes?: number;
  /** Origin allowed to call this server; defaults to the request's own host (same-origin). */
  readonly allowedOrigin?: (requestOrigin: string, host: string | undefined) => boolean;
}

export interface WorkbenchServer {
  readonly server: Server;
  listen(port: number, host?: string): Promise<{ readonly port: number; readonly origin: string }>;
  close(): Promise<void>;
}

export function createWorkbenchServer(options: WorkbenchServerOptions): WorkbenchServer {
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const sameOrigin =
    options.allowedOrigin ??
    ((requestOrigin: string, host: string | undefined): boolean =>
      host !== undefined && (requestOrigin === `http://${host}` || requestOrigin === `https://${host}`));

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      // A handler that fails after a response was sent cannot be reported; keep the log honest.
      if (!response.headersSent) {
        const rpcError = toRpcError(error);
        const body = { requestId: 'unknown', error: { code: rpcError.code, message: rpcError.message } };
        writeJson(response, statusFor(body), body);
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '/';
    const path = url.split('?')[0] ?? '/';
    if (request.method === 'POST' && path === RPC_PATH) {
      await handleRpc(request, response);
      return;
    }
    const stream = /^\/api\/v1\/sessions\/([^/]+)\/stream$/.exec(path);
    if (request.method === 'GET' && stream !== null && options.hub !== undefined) {
      await handleStream(request, response, decodeURIComponent(stream[1] ?? ''), url);
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (path === '/app' || path.startsWith('/app/')) {
        if (options.appStaticDir !== undefined) {
          // '/app' and '/app/' both resolve to the shell; deeper paths map below the app root.
          const subPath = path === '/app' || path === '/app/' ? '/index.html' : path.slice('/app'.length);
          if (await serveStatic(request, response, subPath, options.appStaticDir)) {
            return;
          }
          // SPA fallback: the client router owns sub-paths; the shell is always index.html.
          if (await serveStatic(request, response, '/index.html', options.appStaticDir)) {
            return;
          }
        }
        writeJson(response, 404, { requestId: 'unknown', error: { code: 'NOT_FOUND', message: 'the /app surface is not built' } });
        return;
      }
      if (await serveStatic(request, response, path)) {
        return;
      }
    }
    writeJson(response, 404, {
      requestId: 'unknown',
      error: { code: 'NOT_FOUND', message: `${request.method ?? 'GET'} ${path} is not available` },
    });
  }

  async function handleRpc(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && !sameOrigin(origin, request.headers.host)) {
      writeJson(response, 403, {
        requestId: 'unknown',
        error: { code: 'FORBIDDEN', message: 'cross-origin calls are not accepted' },
      });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(request, bodyLimit);
    } catch (error) {
      const rpcError = error instanceof RpcError ? error : new RpcError('INVALID_ARGUMENT', 'the request body is not JSON');
      writeJson(response, statusFor({ requestId: 'unknown', error: { code: rpcError.code, message: rpcError.message } }), {
        requestId: 'unknown',
        error: { code: rpcError.code, message: rpcError.message },
      });
      return;
    }
    const envelope = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const method = typeof envelope['method'] === 'string' ? envelope['method'] : undefined;
    const session = options.auth.resolve(request.headers.cookie);

    if (method === undefined) {
      writeJson(
        response,
        statusFor({ requestId: 'unknown', error: { code: 'INVALID_ARGUMENT', message: 'method is required' } }),
        { requestId: 'unknown', error: { code: 'INVALID_ARGUMENT', message: 'method is required' } },
      );
      return;
    }
    if (method !== 'auth.login' && session === undefined) {
      writeJson(
        response,
        401,
        { requestId: 'unknown', error: { code: 'UNAUTHORIZED', message: 'log in first' } },
      );
      return;
    }
    // A write needs the session's CSRF token even though the cookie was accepted (R1).
    if (options.router.requiresWrite(method)) {
      const csrf = request.headers[CSRF_HEADER];
      if (!options.auth.verifyWrite(session, typeof csrf === 'string' ? csrf : undefined)) {
        writeJson(response, 403, {
          requestId: typeof envelope['requestId'] === 'string' ? envelope['requestId'] : 'unknown',
          // The marker is what lets a client tell a CSRF refusal from a business refusal.
          error: { code: 'FORBIDDEN', message: 'the CSRF token is missing or wrong', details: { csrf: true } },
        });
        return;
      }
    }

    const pendingCookies: string[] = [];
    const incomingId = typeof envelope['requestId'] === 'string' ? envelope['requestId'] : '';
    const context: RpcContext = {
      store: options.store,
      actor: session?.value ?? 'anonymous',
      requestId: incomingId,
      setCookie: (cookie: string) => pendingCookies.push(cookie),
    };
    const result = await options.router.handle(envelope, context, () => randomUUID());
    if (pendingCookies.length > 0) {
      response.setHeader('set-cookie', pendingCookies);
    }
    writeJson(response, statusFor(result), result);
  }

  // Auth is the only area that touches the cookie; its handlers stay transport-agnostic.
  options.router.register('auth.login', {
    write: false,
    run: (params, context): unknown => {
      const password = params['password'];
      if (typeof password !== 'string' || password === '') {
        throw new RpcError('INVALID_ARGUMENT', 'password is required');
      }
      const outcome = options.auth.login(password);
      if (outcome === undefined) {
        throw new RpcError('UNAUTHORIZED', 'the access password is wrong');
      }
      // The token is returned to the page; the cookie itself is HttpOnly.
      context.setCookie?.(outcome.cookie);
      return { csrfToken: outcome.csrfToken };
    },
  });
  options.router.register('auth.logout', {
    write: false,
    run: (_params, context): unknown => ({
      revoked: context.actor === 'anonymous' ? false : options.auth.logoutValue(context.actor),
    }),
  });

  /**
   * The live stream (M4): the cookie authenticates it (never a URL credential), the prepared
   * subscription is taken over, buffered events after its boundary are sent, and a reader that fell
   * behind or crossed a generation is told to resync instead of being fed a gap.
   */
  async function handleStream(
    request: IncomingMessage,
    response: ServerResponse,
    sessionId: string,
    url: string,
  ): Promise<void> {
    const hub = options.hub;
    if (hub === undefined) {
      writeJson(response, 404, { requestId: 'unknown', error: { code: 'NOT_FOUND', message: 'streaming is not enabled' } });
      return;
    }
    const session = options.auth.resolve(request.headers.cookie);
    if (session === undefined) {
      writeJson(response, 401, { requestId: 'unknown', error: { code: 'UNAUTHORIZED', message: 'log in first' } });
      return;
    }
    const subscriptionId = new URLSearchParams(url.split('?')[1] ?? '').get('subscriptionId') ?? '';
    const taken = hub.take({ subscriptionId, sessionId, actor: session.value });
    if (taken.kind === 'resync') {
      writeJson(response, 409, {
        requestId: 'unknown',
        error: {
          code: 'STREAM_RESYNC_REQUIRED',
          message: `prepare the stream again (${taken.reason})`,
          details: { reason: taken.reason },
        },
      });
      return;
    }
    const subscription = taken.subscription;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
      'x-accel-buffering': 'no',
    });
    response.flushHeaders?.();
    let closed = false;
    const close = (resync: { reason: string } | undefined): void => {
      if (closed) {
        return;
      }
      closed = true;
      if (resync !== undefined) {
        response.write(`event: resync\ndata: ${JSON.stringify({ type: 'stream.resync', reason: resync.reason })}\n\n`);
      }
      hub.release(subscription.subscriptionId);
      response.end();
    };
    // Back-pressure: Node buffers, and only a reader that is really far behind (past the cap) is told
    // to resync. Awaiting 'drain' here would block the work that produced the event (M4).
    // pendingBytes tracks UNFLUSHED bytes: response.write() returning false means the kernel
    // buffer is full; 'drain' clears it. Counting every byte ever written instead would kill
    // a healthy long-lived reader (a long turn streams hundreds of KB cumulative) mid-turn.
    const pendingCap = 512 * 1024;
    let pendingBytes = 0;
    response.on('drain', () => {
      pendingBytes = 0;
    });
    const send = (event: StreamEvent): void => {
      if (closed) {
        return;
      }
      if (event.epoch !== undefined && !subscription.adopted) {
        // The boundary was taken before an instance existed: the first real one becomes the epoch.
        subscription.epoch = event.epoch;
        subscription.adopted = true;
      }
      if (event.epoch !== undefined && event.epoch !== subscription.epoch) {
        // The instance generation changed: the boundary no longer describes the same Pi session.
        close({ reason: 'epoch' });
        return;
      }
      // A Pi event keeps its own shape; a business notice is the frame's own type (M4).
      const notice =
        typeof event.event === 'object' && event.event !== null && (event.event as { type?: unknown }).type === 'invalidate';
      // message_update resends the FULL accumulated message twice per delta — event.message
      // and assistantMessageEvent.partial (Pi's shape). No client reads either there — the
      // slot consumes only assistantMessageEvent.delta/contentIndex — so streaming them
      // makes frame sizes grow linearly and overflow this reader's 512KB cap mid-turn: the
      // client loses message_end/agent_end and freezes at a partial render. Strip both;
      // message_start/message_end still carry complete content.
      let payload = event.event;
      if (typeof payload === 'object' && payload !== null && (payload as { type?: unknown }).type === 'message_update') {
        const record = payload as Record<string, unknown>;
        const { message: _m, ...rest } = record;
        void _m;
        const delta = rest.assistantMessageEvent as Record<string, unknown> | undefined;
        if (typeof delta === 'object' && delta !== null && 'partial' in delta) {
          const { partial: _p, ...deltaRest } = delta;
          void _p;
          rest.assistantMessageEvent = deltaRest;
        }
        payload = rest;
      }
      const frame = `id: ${event.seq}\ndata: ${JSON.stringify(
        notice
          ? {
              seq: event.seq,
              sessionId,
              ...(event.epoch !== undefined ? { epoch: event.epoch } : {}),
              ...(event.event as Record<string, unknown>),
            }
          : {
              seq: event.seq,
              type: 'pi',
              sessionId,
              ...(event.inputId !== undefined ? { inputId: event.inputId } : {}),
              ...(event.epoch !== undefined ? { epoch: event.epoch } : {}),
              event: payload,
            },
      )}\n\n`;
      const flushed = response.write(frame);
      if (!flushed) {
        // Node is buffering: these bytes are pending until 'drain'.
        pendingBytes += Buffer.byteLength(frame);
      }
      if (pendingBytes > pendingCap) {
        // Far behind: this reader resyncs instead of holding the work (or its memory) back.
        close({ reason: 'overflow' });
      }
    };
    request.on('close', () => close(undefined));
    response.on('error', () => close(undefined));
    if (subscription.overflowed) {
      close({ reason: 'overflow' });
      return;
    }
    for (const buffered of subscription.buffer) {
      send(buffered);
    }
    subscription.buffer.length = 0;
    subscription.deliver = send;
  }

  async function serveStatic(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    rootOverride?: string,
  ): Promise<boolean> {
    const chosen = rootOverride ?? options.staticDir;
    if (chosen === undefined) {
      return false;
    }
    const root = resolve(chosen);
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // A malformed percent-encoding is a bad request, not a storage failure.
      writeJson(response, 400, { requestId: 'unknown', error: { code: 'INVALID_ARGUMENT', message: 'the path is malformed' } });
      return true;
    }
    const relative = decoded.replace(/^([/\\])+/, '');
    // `resolve` keeps `..` segments meaningful, so the containment check below is the load-bearing
    // guard: an escaping path really resolves outside the root and is refused.
    const target = resolve(root, relative === '' ? 'index.html' : relative);
    if (target !== root && !target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      writeJson(response, 404, { requestId: 'unknown', error: { code: 'NOT_FOUND', message: 'no such file' } });
      return true;
    }
    try {
      const info = await stat(target);
      if (!info.isFile()) {
        return false;
      }
      const content = await readFile(target);
      response.writeHead(200, {
        'content-type': contentTypeFor(target),
        'content-length': content.byteLength,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
      return true;
    } catch {
      return false;
    }
  }

  return {
    server,
    listen: (port, host = '127.0.0.1') =>
      new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          const bound = typeof address === 'object' && address !== null ? address.port : port;
          resolveListen({ port: bound, origin: `http://${host}:${bound}` });
        });
      }),
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections?.();
      }),
  };
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) {
      throw new RpcError('INVALID_ARGUMENT', 'the request body is too large', { limit });
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RpcError('INVALID_ARGUMENT', 'the request body is not JSON');
  }
}

function writeJson(response: ServerResponse, status: number, body: RpcResponse | Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function contentTypeFor(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}
