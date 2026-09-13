/**
 * The BFF's own browser session, and its client for the daemon.
 *
 * The browser never holds a daemon credential: it holds one `HttpOnly;
 * SameSite=Strict` cookie whose value is a random id, and the daemon session cookie
 * plus CSRF token live in this process's memory. That is what makes AC-078 a
 * server-side check rather than a client courtesy — a logout deletes the record, and
 * a stale browser cookie can only produce `UNAUTHENTICATED`.
 *
 * Sessions are deliberately **not** persisted: a BFF restart requires a new sign-in,
 * while every durable Work/Run fact stays in the daemon's store and keeps running
 * (AC-078 "后台Work保留").
 */
import { randomBytes } from 'node:crypto';
import { DEFAULT_AUTH_CONFIG, type AuthenticateInput, type AuthService } from '@agentdev/core';

/** Cookie name of the BFF's own browser session (distinct from the daemon's). */
export const WEB_SESSION_COOKIE = 'agentdev_web';

export interface WebSession {
  readonly id: string;
  /** The daemon session id this web session signs in as. */
  readonly daemonSessionId: string;
  /** Cookie value for the daemon (`agentdev_session`); never sent to the browser. */
  readonly daemonCookie: string;
  /** CSRF token the daemon requires on writes; sent only to the browser as a header. */
  readonly csrfToken: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface WebSessionOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  /** Random id length in bytes; 32 keeps a session id unguessable. */
  readonly idBytes?: number;
}

/**
 * In-memory browser sessions keyed by cookie value.
 *
 * Expiry is evaluated on every read, so an expired cookie is refused even without a
 * sweep, and `sweepExpired` is available for a caller that wants to bound memory.
 */
export class WebSessionStore {
  private readonly sessions = new Map<string, WebSession>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly idBytes: number;

  constructor(options: WebSessionOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_AUTH_CONFIG.sessionTtlMs;
    this.now = options.now ?? (() => Date.now());
    this.idBytes = options.idBytes ?? 32;
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Records a session the daemon just created. */
  create(input: {
    readonly daemonSessionId?: string;
    readonly daemonCookie: string;
    readonly csrfToken: string;
  }): WebSession {
    const createdAt = this.now();
    const session: WebSession = {
      id: randomBytes(this.idBytes).toString('base64url'),
      daemonSessionId: input.daemonSessionId ?? input.daemonCookie,
      daemonCookie: input.daemonCookie,
      csrfToken: input.csrfToken,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Reads a live session; an unknown or expired id resolves to `undefined`. */
  get(id: string | undefined): WebSession | undefined {
    if (id === undefined) return undefined;
    const session = this.sessions.get(id);
    if (session === undefined) return undefined;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(session.id);
      return undefined;
    }
    return session;
  }

  /** Forgets a session; the answer says whether anything was removed. */
  remove(id: string | undefined): boolean {
    return id === undefined ? false : this.sessions.delete(id);
  }

  /** Drops every expired session; returns how many were forgotten. */
  sweepExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

/** Every cookie pair in a `Cookie` header, without decoding. */
export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  if (header === undefined) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === '') continue;
    result[name] = value;
  }
  return result;
}

/** Reads one cookie out of a header. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  return parseCookies(header)[name];
}

export interface SessionCookieOptions {
  /** `__Host-`-style hardening is applied when the deployment serves HTTPS. */
  readonly secure?: boolean;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/** Builds the `Set-Cookie` value for a live web session. */
export function sessionSetCookie(id: string, options: SessionCookieOptions = {}): string {
  const ttlSec = Math.floor((options.ttlMs ?? DEFAULT_AUTH_CONFIG.sessionTtlMs) / 1000);
  return [
    `${WEB_SESSION_COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    options.secure === true ? 'Secure' : '',
    `Max-Age=${String(ttlSec)}`,
  ]
    .filter((part) => part !== '')
    .join('; ');
}

/** Builds the `Set-Cookie` value that removes the browser session. */
export function sessionClearCookie(options: { readonly secure?: boolean } = {}): string {
  return [
    `${WEB_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    options.secure === true ? 'Secure' : '',
    'Max-Age=0',
  ]
    .filter((part) => part !== '')
    .join('; ');
}

/**
 * Refuses a state-changing request whose `Origin` the deployment does not allow.
 *
 * A write with no `Origin` at all is refused too: a browser always sends one, so its
 * absence means the request did not come from the application. `allowedOrigins` is an
 * exact list, which is what "Origin 精确匹配" requires (`protocol.md` §2).
 */
export function originAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin === undefined || origin === '') return false;
  return allowedOrigins.includes(origin);
}

/** The origin a browser navigation came from, as the daemon must see it. */
export function forwardedOrigin(request: {
  readonly headers: { readonly origin?: unknown };
}): string | undefined {
  const origin = request.headers.origin;
  return typeof origin === 'string' && origin !== '' ? origin : undefined;
}

/** Re-validates the daemon session behind one web session. */
export function authenticateDaemon(
  auth: AuthService,
  session: WebSession,
  input: { readonly isWrite: boolean; readonly origin?: string },
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    } {
  const decision = auth.authenticate({
    cookie: session.daemonCookie,
    csrfToken: session.csrfToken,
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    isWrite: input.isWrite,
  });
  return decision.ok
    ? { ok: true }
    : { ok: false, status: decision.status, code: decision.code, message: decision.message };
}

/** Builds the daemon authenticate input for one forwarded request. */
export function daemonAuthInput(
  session: Pick<WebSession, 'daemonCookie' | 'csrfToken'>,
  input: { readonly origin?: string; readonly isWrite: boolean },
): AuthenticateInput {
  return {
    cookie: session.daemonCookie,
    csrfToken: session.csrfToken,
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    isWrite: input.isWrite,
  };
}
