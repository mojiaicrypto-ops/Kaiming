import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { AuthService, SESSION_COOKIE, CSRF_HEADER } from '../src/server/auth.ts';
import { RpcError, RpcRouter } from '../src/server/rpc.ts';
import { createWorkbenchServer, type WorkbenchServer } from '../src/server/http.ts';
import { registerCoreMethods } from '../src/server/methods.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'correct horse battery staple';

interface Harness {
  readonly origin: string;
  readonly store: Store;
  readonly calls: string[];
  readonly staticDir: string;
  readonly appStaticDir: string;
  call(method: string, params?: Record<string, unknown>, init?: { requestId?: string; cookie?: string; csrf?: string; origin?: string; raw?: string }): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }>;
}

async function harness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-server-'));
  const staticDir = join(root, 'web');
  const appStaticDir = join(root, 'app');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  const auth = new AuthService({ accessPassword: PASSWORD });
  const router = new RpcRouter();
  const calls: string[] = [];
  registerCoreMethods(router, {
    store,
    server: {
      model: { providerId: 'stub', modelId: 'stub-1' },
      agentDir: join(root, 'agent'),
      promptDir: join(root, 'prompts'),
      tools: ['read'],
    },
  });
  // A probe write method: it exercises the envelope rules with a controllable side effect.
  router.register('probe.write', {
    write: true,
    run: (params) => {
      calls.push(String(params['value'] ?? ''));
      if (params['fail'] === true) {
        throw new RpcError('VERSION_CONFLICT', 'the probe always fails here');
      }
      return { echoed: params['value'] ?? null, calls: calls.length };
    },
  });
  const workbench: WorkbenchServer = createWorkbenchServer({ store, auth, router, staticDir, appStaticDir });
  const { origin } = await workbench.listen(0);
  cleanups.push(async () => {
    await workbench.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    origin,
    store,
    calls,
    staticDir,
    appStaticDir,
    async call(method, params = {}, init = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (init.cookie !== undefined) {
        headers['cookie'] = `${SESSION_COOKIE}=${init.cookie}`;
      }
      if (init.csrf !== undefined) {
        headers[CSRF_HEADER] = init.csrf;
      }
      if (init.origin !== undefined) {
        headers['origin'] = init.origin;
      }
      const response = await fetch(`${origin}/api/v1/rpc`, {
        method: 'POST',
        headers,
        body:
          init.raw ??
          JSON.stringify({
            ...(init.requestId !== undefined ? { requestId: init.requestId } : {}),
            method,
            params,
          }),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
        setCookie: response.headers.get('set-cookie'),
      };
    },
  };
}

interface Login {
  readonly cookie: string;
  readonly csrf: string;
}

/** A second login helper so a test can log in twice without the cookie juggling. */
async function login2(h: Harness): Promise<Login> {
  return login(h);
}

async function login(h: Harness): Promise<Login> {
  const response = await h.call('auth.login', { password: PASSWORD });
  expect(response.status).toBe(200);
  const cookie = /agentdev_session=([0-9a-f]+)/.exec(response.setCookie ?? '')?.[1] ?? '';
  return { cookie, csrf: String((response.body['result'] as { csrfToken: string }).csrfToken) };
}

describe('workbench RPC entry', () => {
  it('exchanges the access password for an HttpOnly same-site cookie and never echoes it', async () => {
    const h = await harness();

    const wrong = await h.call('auth.login', { password: 'nope' });
    expect(wrong.status).toBe(401);
    expect((wrong.body['error'] as { code: string }).code).toBe('UNAUTHORIZED');
    expect(wrong.setCookie).toBeNull();

    const right = await h.call('auth.login', { password: PASSWORD });

    expect(right.status).toBe(200);
    expect(right.setCookie).toContain('HttpOnly');
    expect(right.setCookie).toContain('SameSite=Strict');
    expect(right.setCookie).toContain('Path=/');
    const body = JSON.stringify(right.body);
    expect(body).not.toContain(PASSWORD);
    expect((right.body['result'] as { csrfToken: string }).csrfToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses calls without a session and after logout', async () => {
    const h = await harness();

    const anonymous = await h.call('config.get');
    expect(anonymous.status).toBe(401);
    expect((anonymous.body['error'] as { code: string }).code).toBe('UNAUTHORIZED');

    const { cookie, csrf } = await login(h);
    const authed = await h.call('config.get', {}, { cookie });
    expect(authed.status).toBe(200);

    const logout = await h.call('auth.logout', {}, { cookie });
    expect(logout.status).toBe(200);
    expect((logout.body['result'] as { revoked: boolean }).revoked).toBe(true);

    const afterLogout = await h.call('config.get', {}, { cookie });
    expect(afterLogout.status).toBe(401);
    expect(csrf).not.toBe('');
  });

  it('requires the CSRF token for writes, even with a valid cookie', async () => {
    const h = await harness();
    const { cookie, csrf } = await login(h);

    const missing = await h.call('probe.write', { value: 'a' }, { cookie, requestId: 'w-1' });
    expect(missing.status).toBe(403);
    expect((missing.body['error'] as { code: string }).code).toBe('FORBIDDEN');

    const wrong = await h.call('probe.write', { value: 'a' }, { cookie, requestId: 'w-1', csrf: 'deadbeef' });
    expect(wrong.status).toBe(403);

    const ok = await h.call('probe.write', { value: 'a' }, { cookie, requestId: 'w-1', csrf });
    expect(ok.status).toBe(200);
    expect(h.calls).toEqual(['a']);
  });

  it('never records a login in the receipt table and keys write receipts in their own space', async () => {
    const h = await harness();

    const login = await h.call('auth.login', { password: PASSWORD }, { requestId: 'login-1' });

    expect(login.status).toBe(200);
    // A pre-auth call must not persist a caller-supplied parameter digest (here: the password guess).
    expect(h.store.getRequestReceipt('login-1')).toBeUndefined();
    expect(h.store.getRequestReceipt('rpc:login-1')).toBeUndefined();

    const { cookie, csrf } = await login2(h);
    await h.call('probe.write', { value: 'a' }, { cookie, requestId: 'w-space', csrf });

    // The router's receipt lives under its own key; the client's id is not consumed in the store space.
    expect(h.store.getRequestReceipt('rpc:w-space')).toMatchObject({ method: 'probe.write', status: 'committed' });
    expect(h.store.getRequestReceipt('w-space')).toBeUndefined();
  });

  it('replays a recorded outcome for the same requestId and refuses a reused id with new parameters', async () => {
    const h = await harness();
    const { cookie, csrf } = await login(h);

    const first = await h.call('probe.write', { value: 'a' }, { cookie, requestId: 'w-2', csrf });
    const retry = await h.call('probe.write', { value: 'a' }, { cookie, requestId: 'w-2', csrf });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body['result']).toEqual(first.body['result']);
    // The side effect happened once: a retry replays the receipt instead of running again.
    expect(h.calls).toEqual(['a']);

    const conflict = await h.call('probe.write', { value: 'b' }, { cookie, requestId: 'w-2', csrf });
    expect(conflict.status).toBe(409);
    expect((conflict.body['error'] as { code: string }).code).toBe('REQUEST_CONFLICT');
    expect(h.calls).toEqual(['a']);
  });

  it('records a failure as truthfully as a success, so a retry replays the same refusal', async () => {
    const h = await harness();
    const { cookie, csrf } = await login(h);

    const failed = await h.call('probe.write', { value: 'x', fail: true }, { cookie, requestId: 'w-3', csrf });
    const retried = await h.call('probe.write', { value: 'x', fail: true }, { cookie, requestId: 'w-3', csrf });

    expect(failed.status).toBe(409);
    expect((failed.body['error'] as { code: string; message: string }).code).toBe('VERSION_CONFLICT');
    expect(retried.status).toBe(409);
    expect(retried.body['error']).toEqual(failed.body['error']);
    // The handler ran exactly once: a failed request is a recorded outcome, not a retry loop.
    expect(h.calls).toEqual(['x']);
  });

  it('validates the envelope: method, params, requestId on writes and the body itself', async () => {
    const h = await harness();
    const { cookie, csrf } = await login(h);

    const unknown = await h.call('nope.nope', {}, { cookie });
    expect(unknown.status).toBe(400);
    expect((unknown.body['error'] as { code: string }).code).toBe('INVALID_ARGUMENT');

    const arrayParams = await fetch(`${h.origin}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${cookie}` },
      body: JSON.stringify({ method: 'config.get', params: [1, 2] }),
    });
    expect(arrayParams.status).toBe(400);

    const noId = await h.call('probe.write', { value: 'a' }, { cookie, csrf });
    expect(noId.status).toBe(400);
    expect((noId.body['error'] as { code: string }).code).toBe('INVALID_ARGUMENT');

    const badJson = await h.call('config.get', {}, { cookie, raw: '{not json' });
    expect(badJson.status).toBe(400);
    expect((badJson.body['error'] as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('rejects a cross-origin call and reports the requestId it was given', async () => {
    const h = await harness();
    const { cookie } = await login(h);

    const cross = await h.call('config.get', {}, { cookie, origin: 'http://evil.example' });

    expect(cross.status).toBe(403);
    expect((cross.body['error'] as { code: string }).code).toBe('FORBIDDEN');

    const same = await h.call('config.get', {}, { cookie, origin: h.origin, requestId: 'r-9' });
    expect(same.status).toBe(200);
    expect(same.body['requestId']).toBe('r-9');
  });

  it('serves the redacted effective configuration and refuses an unknown project', async () => {
    const h = await harness();
    const { cookie } = await login(h);

    const config = await h.call('config.get', { roleId: 'reviewer' }, { cookie });

    expect(config.status).toBe(200);
    const result = config.body['result'] as {
      roleId: string;
      effective: { providerId: string; modelId: string; source: string };
      credentials: { inResponse: boolean };
    };
    expect(result.roleId).toBe('reviewer');
    expect(result.effective).toMatchObject({ providerId: 'stub', modelId: 'stub-1', source: 'server' });
    expect(result.credentials.inResponse).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/apiKey|secret|token/i);

    const unknown = await h.call('config.get', { projectId: 'p-nope' }, { cookie });
    expect(unknown.status).toBe(404);
    expect((unknown.body['error'] as { code: string }).code).toBe('NOT_FOUND');
  });

  it('serves static files without escaping the web root', async () => {
    const h = await harness();
    mkdirSync(h.staticDir, { recursive: true });
    writeFileSync(join(h.staticDir, 'index.html'), '<html>workbench</html>');

    const page = await fetch(`${h.origin}/`);
    const content = await page.text();

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(content).toContain('workbench');

    // WHATWG URL strips `..` segments before the request is sent, so the surviving traversal vector is
    // the percent-encoded one. A sentinel just outside the web root makes the assertion real: without
    // the root guard the file would be served and this test would fail.
    writeFileSync(join(h.staticDir, '..', 'sentinel-outside.txt'), 'TOP_SECRET');
    const escaped = await fetch(`${h.origin}/%2e%2e%2fsentinel-outside.txt`);
    expect([400, 404]).toContain(escaped.status);
    expect(await escaped.text()).not.toContain('TOP_SECRET');
    const deeperEscape = await fetch(`${h.origin}/%2e%2e%2f%2e%2e%2fetc/passwd`);
    expect([400, 404]).toContain(deeperEscape.status);

    // A malformed percent-encoding is a client error, not a storage failure.
    const malformed = await fetch(`${h.origin}/%`);
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe('INVALID_ARGUMENT');
  });
});

describe('the /app surface (React shell build)', () => {
  it('serves the shell and assets, falls back for deep paths, refuses traversal, 404s unbuilt', async () => {
    const h = await harness();
    // Shell + deep path both serve index.html (SPA fallback).
    mkdirSync(h.appStaticDir, { recursive: true });
    writeFileSync(join(h.appStaticDir, 'index.html'), '<html id="app-shell">');
    mkdirSync(join(h.appStaticDir, 'assets'), { recursive: true });
    writeFileSync(join(h.appStaticDir, 'assets', 'app.js'), 'export {}');
    const shell = await fetch(`${h.origin}/app/`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('app-shell');
    const deep = await fetch(`${h.origin}/app/does-not-exist.js`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('app-shell');
    const asset = await fetch(`${h.origin}/app/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('export {}');
    // Traversal out of the app root is refused even through /app/.
    const escape = await fetch(`${h.origin}/app/../${basename(h.staticDir)}/index.html`);
    expect(escape.status).toBe(404);
    // No root escape via encoded dot segments either.
    const encoded = await fetch(`${h.origin}/app/%2e%2e/${basename(h.staticDir)}/index.html`);
    expect(encoded.status).toBe(404);
  });

  it('an absent build yields the explicit not-built error', async () => {
    const h = await harness();
    const unbuilt = await fetch(`${h.origin}/app/`);
    expect(unbuilt.status).toBe(404);
    const body = (await unbuilt.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('not built');
  });
});
