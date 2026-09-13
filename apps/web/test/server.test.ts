/**
 * WP-09 T3 unit coverage for the BFF itself (AC-078).
 *
 * A fake upstream stands in for the daemon so the BFF's own security decisions are
 * isolated and deterministic: which cookie it sends, which `Origin` it sends, when it
 * refuses before forwarding, and how it reports an expired session. The upstream is a
 * real HTTP server on loopback port 0 that records what it received.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '@agentdev/core';
import { createWebApp, defaultPublicDir } from '../src/app.js';
import {
  WebSessionStore,
  cookieValue,
  originAllowed,
  parseCookies,
  sessionClearCookie,
  sessionSetCookie,
} from '../src/sessions.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';
const INSTALLATION_TOKEN = 'installation-token-for-tests';

interface Upstream {
  readonly server: Server;
  readonly baseUrl: string;
  readonly calls: {
    readonly method: string;
    readonly path: string;
    readonly cookie: string | undefined;
    readonly csrf: string | undefined;
    readonly origin: string | undefined;
    readonly body: string;
  }[];
  close(): Promise<void>;
}

/**
 * A recording stand-in for the daemon's `/rpc` and `/auth` routes.
 *
 * `/auth/login` and `/auth/logout` go through a real `AuthService`, so the BFF stores
 * a session the same way it does in production and the expiry path is genuine.
 */
async function startUpstream(auth: AuthService): Promise<Upstream> {
  const calls: Upstream['calls'] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const body = Buffer.concat(chunks).toString('utf8');
      calls.push({
        method: request.method ?? 'GET',
        path: request.url ?? '/',
        cookie: typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
        csrf:
          typeof request.headers['x-csrf-token'] === 'string'
            ? request.headers['x-csrf-token']
            : undefined,
        origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
        body,
      });
      if (request.url === '/auth/login') {
        const parsed = JSON.parse(body) as { token?: unknown };
        const result = auth.login({
          token: typeof parsed.token === 'string' ? parsed.token : '',
          ip: '127.0.0.1',
          ...(typeof request.headers.origin === 'string' ? { origin: request.headers.origin } : {}),
        });
        if (!result.ok) {
          response.writeHead(result.status, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED' } }));
          return;
        }
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': result.cookie,
        });
        response.end(JSON.stringify({ csrfToken: result.csrfToken }));
        return;
      }
      if (request.url === '/auth/logout') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'applied' }));
        return;
      }
      if (request.url === '/rpc') {
        const envelope = JSON.parse(body) as { id: string; method: string };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            v: 1,
            type: 'response',
            id: envelope.id,
            ok: true,
            result: { echoed: envelope.method },
          }),
        );
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND' } }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address !== 'object') throw new Error('no address');
  return {
    server,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('BFF session store', () => {
  it('expires a session on the clock and never returns it again', () => {
    let now = 1_000;
    const store = new WebSessionStore({ ttlMs: 1_000, now: () => now });
    const session = store.create({ daemonCookie: 'daemon-1', csrfToken: 'csrf-1' });
    expect(store.get(session.id)?.daemonCookie).toBe('daemon-1');
    now = 2_001;
    expect(store.get(session.id)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('removes a session on logout and sweeps expired ones', () => {
    let now = 0;
    const store = new WebSessionStore({ ttlMs: 10, now: () => now });
    const first = store.create({ daemonCookie: 'a', csrfToken: 'x' });
    const second = store.create({ daemonCookie: 'b', csrfToken: 'y' });
    expect(store.remove(first.id)).toBe(true);
    expect(store.get(first.id)).toBeUndefined();
    now = 11;
    expect(store.sweepExpired()).toBe(1);
    expect(store.get(second.id)).toBeUndefined();
  });

  it('sets an HttpOnly, SameSite=Strict cookie and clears it with Max-Age=0', () => {
    const set = sessionSetCookie('abc', { secure: true, ttlMs: 60_000 });
    expect(set).toContain('agentdev_web=abc');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Strict');
    expect(set).toContain('Secure');
    expect(set).toContain('Max-Age=60');
    const clear = sessionClearCookie({ secure: true });
    expect(clear).toContain('Max-Age=0');
    expect(clear).toContain('HttpOnly');
  });

  it('parses cookies and checks origins exactly', () => {
    expect(parseCookies('a=1; agentdev_web=xyz')).toMatchObject({ a: '1', agentdev_web: 'xyz' });
    expect(cookieValue('a=1; agentdev_web=xyz', 'agentdev_web')).toBe('xyz');
    expect(originAllowed(WEB_ORIGIN, [WEB_ORIGIN])).toBe(true);
    expect(originAllowed('http://127.0.0.1:4318', [WEB_ORIGIN])).toBe(false);
    expect(originAllowed(undefined, [WEB_ORIGIN])).toBe(false);
    expect(originAllowed('', [WEB_ORIGIN])).toBe(false);
  });
});

describe('BFF HTTP surface (AC-078)', () => {
  let upstream: Upstream;
  let stateDir: string;
  let auth: AuthService;
  let app: ReturnType<typeof createWebApp>;
  let baseUrl: string;
  let webCookie: string;
  let csrfToken: string;
  let now: number;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'agentdev-web-bff-'));
    now = 1_000_000;
    auth = AuthService.loadOrCreate({
      stateDir,
      config: {
        deployment: 'loopback',
        allowedOrigins: [WEB_ORIGIN],
        // The daemon session expires before the BFF's browser cookie does, so an
        // expired daemon session is observable while the cookie is still live.
        sessionTtlMs: 60_000,
        now: () => now,
      },
    });
    upstream = await startUpstream(auth);
    app = createWebApp({
      daemon: { baseUrl: upstream.baseUrl, origin: WEB_ORIGIN, bearer: INSTALLATION_TOKEN },
      auth,
      allowedOrigins: [WEB_ORIGIN],
      sessions: new WebSessionStore({ ttlMs: 3_600_000, now: () => now }),
      version: '0.0.0-test',
      publicDir: defaultPublicDir(),
    });
    const listening = await new Promise<{ url: string; close: () => Promise<void> }>(
      (resolve, reject) => {
        app.server.once('error', reject);
        app.server.listen(0, '127.0.0.1', () => {
          const address = app.server.address();
          if (address === null || typeof address !== 'object') {
            reject(new Error('no address'));
            return;
          }
          resolve({
            url: `http://127.0.0.1:${String(address.port)}`,
            close: () => new Promise<void>((done) => app.server.close(() => done())),
          });
        });
      },
    );
    baseUrl = listening.url;

    // A real sign-in through the fake upstream: the daemon session is created by the
    // upstream `/auth/login`, so the BFF stores the cookie the upstream returned.
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token: auth.createdToken ?? '' }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    webCookie = setCookie.split(';')[0] ?? '';
    const body = (await login.json()) as { csrfToken: string };
    csrfToken = body.csrfToken;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await upstream.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  const rpc = (
    options: {
      readonly cookie?: string;
      readonly origin?: string;
      readonly method?: string;
      readonly params?: unknown;
      readonly csrf?: string;
    } = {},
  ) =>
    fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.cookie === undefined ? { cookie: webCookie } : { cookie: options.cookie }),
        ...(options.origin === undefined ? { origin: WEB_ORIGIN } : { origin: options.origin }),
        ...(options.csrf === undefined ? {} : { 'x-csrf-token': options.csrf }),
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: 'r1',
        method: options.method ?? 'board',
        params: options.params ?? {},
      }),
    });

  it('accepts a read through the BFF cookie and forwards the daemon session', async () => {
    const response = await rpc({ method: 'board' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; result: { echoed: string } };
    expect(body.ok).toBe(true);
    expect(body.result.echoed).toBe('board');
    const forwarded = upstream.calls.at(-1);
    // The browser's cookie is not what reaches the daemon.
    expect(forwarded?.cookie).toContain('agentdev_session=');
    expect(forwarded?.cookie).not.toContain('agentdev_web=');
    expect(forwarded?.origin).toBe(WEB_ORIGIN);
  });

  it('refuses an unauthenticated write with UNAUTHENTICATED and does not forward it', async () => {
    const before = upstream.calls.length;
    const response = await rpc({
      cookie: '',
      method: 'conversation.message.send',
      params: { body: 'hi' },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(upstream.calls.length).toBe(before);
  });

  it('refuses a wrong-Origin write with NOT_AUTHORIZED while reads stay allowed', async () => {
    const read = await rpc({ origin: 'http://evil.example', method: 'board' });
    expect(read.status).toBe(200);
    const write = await rpc({
      origin: 'http://evil.example',
      method: 'conversation.message.send',
      params: { conversationId: 'c', body: 'hi', attachmentIds: [] },
    });
    expect(write.status).toBe(403);
    const body = (await write.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses a write with no Origin at all', async () => {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: webCookie },
      body: JSON.stringify({ v: 1, type: 'request', id: 'r2', method: 'work.control', params: {} }),
    });
    expect(response.status).toBe(403);
  });

  it('refuses an expired daemon session and forgets the browser session', async () => {
    // Expire the daemon session behind the BFF's cookie.
    now += 120_000;
    const response = await rpc({ method: 'board' });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_EXPIRED');
    // The BFF dropped its own record, so a later call is unauthenticated.
    const second = await rpc({ method: 'board' });
    expect(second.status).toBe(401);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('answers /api/session only for a live cookie and never exposes the daemon cookie', async () => {
    const refused = await fetch(`${baseUrl}/api/session`);
    expect(refused.status).toBe(401);
    const ok = await fetch(`${baseUrl}/api/session`, { headers: { cookie: webCookie } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body['authenticated']).toBe(true);
    expect(body['csrfToken']).toBe(csrfToken);
    expect(JSON.stringify(body)).not.toContain(webCookie);
  });

  it('clears the browser session on logout and refuses the old cookie afterwards', async () => {
    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, cookie: webCookie, accept: 'application/json' },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    // The daemon session was ended too, so a reused cookie cannot write even if the
    // browser kept it.
    const write = await rpc({
      cookie: webCookie,
      method: 'work.control',
      params: { action: 'pause' },
    });
    expect(write.status).toBe(401);
  });

  it('refuses a login from a disallowed origin and a wrong token', async () => {
    const wrongOrigin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ token: 'x' }),
    });
    expect(wrongOrigin.status).toBe(403);
    const missing = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(422);
  });

  it('renders the sign-in page instead of any workbench page without a session', async () => {
    const response = await fetch(`${baseUrl}/projects/proj-1/chief`, {
      headers: { accept: 'text/html' },
    });
    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain('id="loginForm"');
    expect(html).toContain('data-i18n="auth.token"');
    expect(html).not.toContain('id="composer"');
  });

  it('serves the static assets and refuses a traversal path', async () => {
    const script = await fetch(`${baseUrl}/assets/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(await script.text()).toContain('liveDockToggle');
    const css = await fetch(`${baseUrl}/assets/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    const escaped = await fetch(`${baseUrl}/assets/..%2F..%2Fpackage.json`);
    expect(escaped.status).toBe(404);
  });

  it('reports health without a path or a secret', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['ready']).toBe(true);
    expect(body['version']).toBe('0.0.0-test');
    expect(JSON.stringify(body)).not.toContain('/');
  });
});
