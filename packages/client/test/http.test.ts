/**
 * The HTTP command path: session cookie, CSRF token, Origin and typed refusals.
 *
 * `docs/architecture/protocol.md` §2: the browser logs in with the installation
 * token, gets an `HttpOnly` cookie plus a CSRF token for same-origin writes, and
 * `docs/architecture/protocol.md` §7 makes `UNAUTHENTICATED`/`AUTH_EXPIRED`/
 * `NOT_AUTHORIZED` terminal. AC-078 requires the failure to be a typed error and
 * the request to never be retried.
 *
 * The server binds 127.0.0.1:0 and the client talks to its real URL, so this is an
 * offline integration test with no external network.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClientError,
  SESSION_COOKIE_NAME,
  cookieValueOf,
  handshakeHeaders,
  httpCommand,
  httpLogin,
  httpLogout,
  httpStatusCode,
  sessionCookieHeader,
} from '../src/index.js';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

interface TestServer {
  readonly baseUrl: string;
  readonly requests: Recorded[];
  readonly close: () => Promise<void>;
}

async function startServer(
  answer: (record: Recorded) => { status: number; body: unknown },
): Promise<TestServer> {
  const requests: Recorded[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const record: Recorded = {
        url: request.url ?? '/',
        method: request.method ?? 'GET',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(record);
      const result = answer(record);
      const payload = JSON.stringify(result.body);
      response.writeHead(result.status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(payload)),
      });
      response.end(payload);
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

const servers: TestServer[] = [];

async function server(
  answer: (record: Recorded) => { status: number; body: unknown },
): Promise<TestServer> {
  const started = await startServer(answer);
  servers.push(started);
  return started;
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe('httpCommand', () => {
  it('sends the session cookie, CSRF token and Origin with a same-origin write', async () => {
    const fake = await server(() => ({
      status: 200,
      body: {
        v: 1,
        type: 'response',
        id: 'client-http-1',
        ok: true,
        result: { status: 'applied' },
      },
    }));
    const result = await httpCommand<{ status: string }>(
      {
        baseUrl: fake.baseUrl,
        session: { cookie: 'session-abc', csrfToken: 'csrf-xyz' },
        origin: 'http://127.0.0.1:4317',
        projectId: '0123456789abcdef0123456789abcdef',
      },
      'work.pause',
      { workId: 'work-1', idempotencyKey: 'idem-1', expectedVersion: 2 },
    );
    expect(result.status).toBe('applied');
    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/rpc');
    expect(request?.headers['cookie']).toBe(`${SESSION_COOKIE_NAME}=session-abc`);
    expect(request?.headers['x-csrf-token']).toBe('csrf-xyz');
    expect(request?.headers['origin']).toBe('http://127.0.0.1:4317');
    const body = JSON.parse(request?.body ?? '{}') as {
      v: number;
      type: string;
      method: string;
      projectId?: string;
      params: Record<string, unknown>;
    };
    expect(body.v).toBe(1);
    expect(body.type).toBe('request');
    expect(body.method).toBe('work.pause');
    expect(body.projectId).toBe('0123456789abcdef0123456789abcdef');
    expect(body.params).toMatchObject({ workId: 'work-1', idempotencyKey: 'idem-1' });
  });

  it('surfaces a 401 as UNAUTHENTICATED without retrying', async () => {
    const fake = await server(() => ({
      status: 401,
      body: {
        v: 1,
        type: 'response',
        id: 'client-http-1',
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'no valid session cookie', retryable: false },
      },
    }));
    let error: ClientError | undefined;
    try {
      await httpCommand(
        { baseUrl: fake.baseUrl, session: { cookie: 'stale' } },
        'project.list',
        {},
      );
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error).toBeInstanceOf(ClientError);
    expect(error?.code).toBe('UNAUTHENTICATED');
    expect(error?.isAuthenticationError).toBe(true);
    expect(error?.retryable).toBe(false);
    // Exactly one attempt: an unauthorised request is never retried (AC-078).
    expect(fake.requests).toHaveLength(1);
  });

  it('surfaces an expired cookie as AUTH_EXPIRED', async () => {
    const fake = await server(() => ({
      status: 401,
      body: {
        v: 1,
        type: 'response',
        id: 'x',
        ok: false,
        error: { code: 'AUTH_EXPIRED', message: 'session expired', retryable: false },
      },
    }));
    let error: ClientError | undefined;
    try {
      await httpCommand({ baseUrl: fake.baseUrl }, 'project.list', {});
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('AUTH_EXPIRED');
    expect(error?.isAuthenticationError).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  it('surfaces a 403 as NOT_AUTHORIZED, which is not retryable', async () => {
    const fake = await server(() => ({
      status: 403,
      body: {
        v: 1,
        type: 'response',
        id: 'x',
        ok: false,
        error: { code: 'NOT_AUTHORIZED', message: 'CSRF token mismatch', retryable: false },
      },
    }));
    let error: ClientError | undefined;
    try {
      await httpCommand({ baseUrl: fake.baseUrl }, 'work.pause', { workId: 'w' });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.isAuthorizationError).toBe(true);
    expect(error?.canRetry).toBe(false);
    expect(fake.requests).toHaveLength(1);
  });

  it('preserves the protocol error code the server sent', async () => {
    const fake = await server(() => ({
      status: 409,
      body: {
        v: 1,
        type: 'response',
        id: 'x',
        ok: false,
        error: {
          code: 'VERSION_CONFLICT',
          message: 'the entity moved on',
          retryable: false,
          details: { currentVersion: 4 },
        },
      },
    }));
    let error: ClientError | undefined;
    try {
      await httpCommand({ baseUrl: fake.baseUrl }, 'work.pause', { workId: 'w' });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('VERSION_CONFLICT');
    expect(error?.details).toEqual({ currentVersion: 4 });
    expect(fake.requests).toHaveLength(1);
  });

  it('reports a transport failure as retryable and a malformed answer as a protocol fault', async () => {
    let error: ClientError | undefined;
    try {
      await httpCommand({ baseUrl: 'http://127.0.0.1:1' }, 'project.list', {});
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('TRANSPORT_LOST');
    expect(error?.canRetry).toBe(true);

    const fake = await server(() => ({ status: 200, body: { not: 'an envelope' } }));
    try {
      await httpCommand({ baseUrl: fake.baseUrl }, 'project.list', {});
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('PROTOCOL_MISMATCH');
    expect(error?.retryable).toBe(false);
  });

  it('builds the WS credential headers the handshake needs', () => {
    expect(sessionCookieHeader({ cookie: 's1' })).toBe('agentdev_session=s1');
    expect(
      handshakeHeaders({
        origin: 'http://127.0.0.1:4317',
        session: { cookie: 's1' },
      }),
    ).toEqual({ Origin: 'http://127.0.0.1:4317', Cookie: 'agentdev_session=s1' });
    expect(handshakeHeaders({ bearer: 'token' })).toEqual({ Authorization: 'Bearer token' });
    expect(handshakeHeaders({})).toEqual({});
  });

  it('maps HTTP statuses onto the protocol code the status implies', () => {
    expect(httpStatusCode(401)).toBe('UNAUTHENTICATED');
    expect(httpStatusCode(403)).toBe('NOT_AUTHORIZED');
    expect(httpStatusCode(500)).toBe('INTERNAL_ERROR');
  });
});

describe('httpLogin and httpLogout', () => {
  it('exchanges the installation token for a session and keeps the CSRF token', async () => {
    // The shared helper cannot set a `Set-Cookie` header, so this case uses a
    // dedicated loopback server that does.
    const requests: Recorded[] = [];
    const dedicated = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
        requests.push({
          url: request.url ?? '/',
          method: request.method ?? 'GET',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `${SESSION_COOKIE_NAME}=session-9; Path=/; HttpOnly; SameSite=Strict`,
        });
        response.end(JSON.stringify({ csrfToken: 'csrf-1' }));
      })();
    });
    await new Promise<void>((resolve) => dedicated.listen(0, '127.0.0.1', () => resolve()));
    const address = dedicated.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const login = await httpLogin({
        baseUrl: `http://127.0.0.1:${port}`,
        token: 'installation-token',
        origin: 'http://127.0.0.1:4317',
      });
      expect(login.session.cookie).toBe('session-9');
      expect(login.session.csrfToken).toBe('csrf-1');
      expect(login.cookieHeader).toContain(`${SESSION_COOKIE_NAME}=session-9`);
      expect(requests[0]?.url).toBe('/auth/login');
      expect(requests[0]?.headers['origin']).toBe('http://127.0.0.1:4317');
      expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ token: 'installation-token' });

      await httpLogout({ baseUrl: `http://127.0.0.1:${port}`, origin: 'http://127.0.0.1:4317' });
      expect(requests).toHaveLength(2);
      expect(requests[1]?.url).toBe('/auth/logout');
      expect(requests[1]?.headers['origin']).toBe('http://127.0.0.1:4317');
    } finally {
      await new Promise<void>((resolve) => dedicated.close(() => resolve()));
    }
  });

  it('surfaces a refused login as a typed error without retrying', async () => {
    const fake = await server(() => ({
      status: 401,
      body: {
        error: { code: 'UNAUTHENTICATED', message: 'invalid installation token', retryable: false },
      },
    }));
    let error: ClientError | undefined;
    try {
      await httpLogin({ baseUrl: fake.baseUrl, token: 'wrong' });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('UNAUTHENTICATED');
    expect(error?.retryable).toBe(false);
    expect(fake.requests).toHaveLength(1);
  });

  it('parses a session cookie out of a Set-Cookie value', () => {
    expect(cookieValueOf('agentdev_session=abc; Path=/; HttpOnly')).toBe('abc');
    expect(cookieValueOf('other=1; agentdev_session=xyz')).toBe('xyz');
    expect(cookieValueOf('other=1')).toBeUndefined();
  });
});
