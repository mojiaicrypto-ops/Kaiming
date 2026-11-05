/**
 * Access control for the local workbench (R1): one access password issued by the machine, exchanged for
 * a same-origin session cookie; writes additionally carry a CSRF token bound to that session; logout
 * revokes the session immediately. This is access and data protection for a single-user workbench, not
 * a multi-user permission system.
 *
 * Credentials never appear in responses, logs or URLs: the cookie is HttpOnly + SameSite=Strict, and a
 * stream authenticates with the cookie too (the contract forbids credentials in the SSE URL).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'kaiming_session';
export const CSRF_HEADER = 'x-kaiming-csrf';

const DEFAULT_IDLE_TTL_MS = 12 * 60 * 60 * 1000;

interface SessionRecord {
  readonly csrfToken: string;
  lastSeenAt: number;
}

export interface AuthOptions {
  /** The access password configured on this machine. Never logged or returned. */
  readonly accessPassword: string;
  /** How long an idle session stays valid; a request refreshes it. */
  readonly idleTtlMs?: number;
  /** Mark the cookie Secure (set this when the workbench is served over HTTPS). */
  readonly secureCookie?: boolean;
  readonly now?: () => number;
}

export interface LoginResult {
  readonly cookie: string;
  readonly csrfToken: string;
}

export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly passwordDigest: Buffer;
  private readonly idleTtlMs: number;
  private readonly secureCookie: boolean;
  private readonly now: () => number;

  constructor(options: AuthOptions) {
    if (options.accessPassword.trim() === '') {
      throw new Error('an access password is required to start the workbench');
    }
    this.passwordDigest = digest(options.accessPassword);
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.secureCookie = options.secureCookie ?? false;
    this.now = options.now ?? (() => Date.now());
  }

  /** Exchange the access password for a session; a wrong password is one indistinguishable refusal. */
  login(password: string): LoginResult | undefined {
    if (!safeEqual(digest(password), this.passwordDigest)) {
      return undefined;
    }
    const value = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(16).toString('hex');
    this.sessions.set(value, { csrfToken, lastSeenAt: this.now() });
    return { cookie: this.cookieFor(value), csrfToken };
  }

  /**
   * Check the access password without creating a session. Machine callers (the `/mcp` endpoint) present
   * it as a bearer token on every request; they do not hold a browser cookie.
   */
  verifyPassword(password: string): boolean {
    return safeEqual(digest(password), this.passwordDigest);
  }

  /** Resolve a session from a Cookie header, refreshing its idle window. Expired sessions are dropped. */
  resolve(cookieHeader: string | undefined): { readonly value: string; readonly csrfToken: string } | undefined {
    const value = cookieValue(cookieHeader);
    if (value === undefined) {
      return undefined;
    }
    const session = this.sessions.get(value);
    if (session === undefined) {
      return undefined;
    }
    const now = this.now();
    if (now - session.lastSeenAt > this.idleTtlMs) {
      this.sessions.delete(value);
      return undefined;
    }
    session.lastSeenAt = now;
    return { value, csrfToken: session.csrfToken };
  }

  /** A write needs both the session and its CSRF token (R1: 写入校验来源/CSRF). */
  verifyWrite(
    session: { readonly csrfToken: string } | undefined,
    csrfHeader: string | undefined,
  ): boolean {
    if (session === undefined || csrfHeader === undefined) {
      return false;
    }
    return safeEqual(Buffer.from(session.csrfToken, 'utf8'), Buffer.from(csrfHeader, 'utf8'));
  }

  /** Revoke one session (logout); its cookie is refused from then on. */
  logout(cookieHeader: string | undefined): boolean {
    const value = cookieValue(cookieHeader);
    return value === undefined ? false : this.logoutValue(value);
  }

  logoutValue(value: string): boolean {
    return this.sessions.delete(value);
  }

  /** Revoke everything (server shutdown). */
  revokeAll(): void {
    this.sessions.clear();
  }

  private cookieFor(value: string): string {
    const attributes = ['HttpOnly', 'SameSite=Strict', 'Path=/'];
    if (this.secureCookie) {
      attributes.push('Secure');
    }
    return `${SESSION_COOKIE}=${value}; ${attributes.join('; ')}`;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}
