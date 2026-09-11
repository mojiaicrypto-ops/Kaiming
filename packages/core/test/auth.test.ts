import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthService,
  CREDENTIAL_FILE,
  InstallationCredential,
  SESSION_COOKIE,
  isLoopbackHost,
  originAllowed,
  parseCookies,
} from '../src/index.js';

/**
 * AC-078 (auth lifecycle): unauthenticated, expired-cookie, wrong-Origin and
 * CSRF-less writes are refused, sessions expire, and the write limit for failed
 * logins is enforced per IP.
 */
let stateDir: string;
let auth: AuthService;

function create(overrides: Record<string, unknown> = {}): AuthService {
  return AuthService.loadOrCreate({ stateDir, config: { now: () => clock, ...overrides } });
}

let clock = 1_000_000;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'agentdev-auth-'));
  clock = 1_000_000;
  auth = create();
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('installation credential', () => {
  it('is created 0600 and shown exactly once', () => {
    const token = auth.createdToken;
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(43);
    const path = join(stateDir, CREDENTIAL_FILE);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    // A second process loads the credential but never sees the value.
    const reloaded = create();
    expect(reloaded.createdToken).toBeUndefined();
    // Neither the service nor the credential can reproduce the secret.
    expect(reloaded.credential.revealOnce()).toBeUndefined();
    expect(reloaded.credential.matches(token)).toBe(true);
    expect(reloaded.credential.matches('not-the-token')).toBe(false);
  });

  it('re-tightens a credential file whose mode was loosened', () => {
    const path = join(stateDir, CREDENTIAL_FILE);
    chmodSync(path, 0o644);
    const { credential } = InstallationCredential.loadOrCreate(stateDir);
    expect(credential.mode).toBe(0o600);
  });

  it('verifies the Bearer header and rejects malformed ones', () => {
    const token = auth.createdToken as string;
    expect(auth.credential.matchesAuthorizationHeader(`Bearer ${token}`)).toBe(true);
    expect(auth.credential.matchesAuthorizationHeader(`Bearer ${token} `)).toBe(true);
    expect(auth.credential.matchesAuthorizationHeader('Bearer wrong')).toBe(false);
    expect(auth.credential.matchesAuthorizationHeader(token)).toBe(false);
    expect(auth.credential.matchesAuthorizationHeader(undefined)).toBe(false);
    expect(auth.authenticateBearer(`Bearer ${token}`)).toEqual({ ok: true });
    expect(auth.authenticateBearer('Basic x')).toEqual({ ok: false });
  });
});

describe('login', () => {
  it('exchanges the installation token for a strict session cookie', () => {
    const token = auth.createdToken as string;
    const result = auth.login({ token, ip: '127.0.0.1', origin: 'http://127.0.0.1:4317' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('login failed');
    expect(result.cookie).toContain('HttpOnly');
    expect(result.cookie).toContain('SameSite=Strict');
    expect(result.cookie).toContain(`${SESSION_COOKIE}=`);
    // A loopback http deployment cannot use a Secure cookie; remote must.
    expect(result.cookie).not.toContain('Secure');
    expect(result.expiresAt).toBe(clock + 24 * 60 * 60 * 1000);
    expect(result.csrfToken).not.toBe(result.sessionId);
    expect(parseCookies(result.cookie)[SESSION_COOKIE]).toBe(result.sessionId);
  });

  it('marks the cookie Secure on a remote deployment', () => {
    const remote = create({ deployment: 'remote' });
    const result = remote.login({
      token: auth.createdToken as string,
      ip: '10.0.0.1',
      origin: 'https://dev.example.com',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('login failed');
    expect(result.cookie).toContain('Secure');
  });

  it('rejects a wrong token with 401', () => {
    const result = auth.login({ token: 'nope', ip: '10.0.0.1' });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(auth.sessionCount()).toBe(0);
  });

  it('limits failures to five per IP per minute', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(auth.login({ token: 'nope', ip: '10.0.0.1' })).toMatchObject({ status: 401 });
    }
    const limited = auth.login({ token: 'nope', ip: '10.0.0.1' });
    expect(limited).toMatchObject({ ok: false, status: 429 });
    if (!limited.ok && limited.status === 429) expect(limited.retryAfterSec).toBeGreaterThan(0);

    // Another IP is unaffected, and the window slides.
    expect(auth.login({ token: 'nope', ip: '10.0.0.2' })).toMatchObject({ status: 401 });
    clock += 61_000;
    expect(auth.login({ token: auth.createdToken as string, ip: '10.0.0.1' })).toMatchObject({
      ok: true,
    });
  });

  it('refuses a non-loopback http origin but accepts https', () => {
    const token = auth.createdToken as string;
    expect(auth.login({ token, ip: '10.0.0.1', origin: 'http://evil.example.com' })).toMatchObject({
      status: 401,
    });
    expect(auth.login({ token, ip: '10.0.0.1', origin: 'https://dev.example.com' })).toMatchObject({
      ok: true,
    });
  });
});

describe('request authentication', () => {
  function session(): { id: string; csrfToken: string } {
    const result = auth.login({ token: auth.createdToken as string, ip: '127.0.0.1' });
    if (!result.ok) throw new Error('login failed');
    return { id: result.sessionId, csrfToken: result.csrfToken };
  }

  it('accepts a read with a valid cookie and no CSRF token', () => {
    const { id } = session();
    expect(auth.authenticate({ cookie: id, isWrite: false })).toMatchObject({ ok: true });
  });

  it('requires a matching CSRF token for writes', () => {
    const { id, csrfToken } = session();
    expect(auth.authenticate({ cookie: id, isWrite: true })).toMatchObject({
      ok: false,
      status: 403,
      code: 'NOT_AUTHORIZED',
    });
    expect(auth.authenticate({ cookie: id, csrfToken: 'wrong', isWrite: true })).toMatchObject({
      ok: false,
      code: 'NOT_AUTHORIZED',
    });
    expect(auth.authenticate({ cookie: id, csrfToken, isWrite: true })).toMatchObject({ ok: true });
  });

  it('refuses an unknown cookie and an expired session', () => {
    expect(auth.authenticate({ cookie: 'nope', isWrite: false })).toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(auth.authenticate({ isWrite: false })).toMatchObject({ code: 'UNAUTHENTICATED' });

    const { id } = session();
    clock += 24 * 60 * 60 * 1000 + 1;
    expect(auth.authenticate({ cookie: id, isWrite: false })).toMatchObject({
      code: 'AUTH_EXPIRED',
      status: 401,
    });
    // The expired session is dropped rather than lingering.
    expect(auth.sessionCount()).toBe(0);
    expect(auth.sweepExpired()).toBe(0);
  });

  it('rejects a mismatched Origin against the configured allowlist', () => {
    const scoped = create({ allowedOrigins: ['http://127.0.0.1:4317'] });
    const login = scoped.login({ token: auth.createdToken as string, ip: '127.0.0.1' });
    if (!login.ok) throw new Error('login failed');
    expect(
      scoped.authenticate({
        cookie: login.sessionId,
        csrfToken: login.csrfToken,
        origin: 'http://127.0.0.1:4317',
        isWrite: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      scoped.authenticate({
        cookie: login.sessionId,
        csrfToken: login.csrfToken,
        origin: 'http://127.0.0.1:4318',
        isWrite: true,
      }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      scoped.authenticate({
        cookie: login.sessionId,
        csrfToken: login.csrfToken,
        origin: 'http://127.0.0.1:4317.evil.com',
        isWrite: true,
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('honours an explicit origin allowlist', () => {
    const strict = create({ allowedOrigins: ['https://ui.example.com'] });
    const login = strict.login({ token: auth.createdToken as string, ip: '127.0.0.1' });
    if (!login.ok) throw new Error('login failed');
    expect(
      strict.authenticate({
        cookie: login.sessionId,
        origin: 'https://ui.example.com',
        isWrite: false,
      }),
    ).toMatchObject({ ok: true });
    expect(
      strict.authenticate({
        cookie: login.sessionId,
        origin: 'http://127.0.0.1:4317',
        isWrite: false,
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('clears the session on logout and expires the cookie', () => {
    const { id } = session();
    const result = auth.logout(id);
    expect(result.cleared).toBe(true);
    expect(result.cookie).toContain('Max-Age=0');
    expect(auth.authenticate({ cookie: id, isWrite: false })).toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(auth.logout(id).cleared).toBe(false);
  });

  it('drops only expired sessions when sweeping', () => {
    const first = auth.login({ token: auth.createdToken as string, ip: '127.0.0.1' });
    clock += 1000;
    const second = auth.login({ token: auth.createdToken as string, ip: '10.0.0.2' });
    if (!first.ok || !second.ok) throw new Error('login failed');
    clock += 24 * 60 * 60 * 1000;
    expect(auth.sweepExpired()).toBe(2);
    expect(auth.sessionCount()).toBe(0);
  });
});

describe('origin policy helpers', () => {
  it('allows loopback http only in development mode', () => {
    expect(originAllowed('http://127.0.0.1:4317', { allowLoopbackHttp: true })).toBe(true);
    expect(originAllowed('http://localhost:4317', { allowLoopbackHttp: true })).toBe(true);
    expect(originAllowed('http://127.0.0.1:4317', { allowLoopbackHttp: false })).toBe(false);
    expect(originAllowed('https://127.0.0.1:4317', { allowLoopbackHttp: false })).toBe(true);
    expect(originAllowed('http://evil.example.com', { allowLoopbackHttp: true })).toBe(false);
    expect(originAllowed('not a url', { allowLoopbackHttp: true })).toBe(false);
  });

  it('recognises loopback hosts', () => {
    for (const host of ['127.0.0.1', '::1', '[::1]', 'localhost']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
  });

  it('parses cookie headers defensively', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
    expect(parseCookies('novalue; c=3')).toEqual({ c: '3' });
    expect(parseCookies(undefined)).toEqual({});
  });
});
