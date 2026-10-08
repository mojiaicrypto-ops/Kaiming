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
import { RPC_PATH, RpcError, RpcRouter, statusFor, toRpcError, type RpcContext, type RpcResponse } from './rpc.ts';
import type { Store } from '../store/store.ts';

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

export interface WorkbenchServerOptions {
  readonly store: Store;
  readonly auth: AuthService;
  readonly router: RpcRouter;
  /** Directory served at `/` (the workbench UI); absent means no static surface yet. */
  readonly staticDir?: string;
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
    if (request.method === 'GET' || request.method === 'HEAD') {
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
          error: { code: 'FORBIDDEN', message: 'the CSRF token is missing or wrong' },
        });
        return;
      }
    }

    const pendingCookies: string[] = [];
    const context: RpcContext = {
      store: options.store,
      actor: session?.value ?? 'anonymous',
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

  async function serveStatic(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> {
    if (options.staticDir === undefined) {
      return false;
    }
    const root = resolve(options.staticDir);
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
