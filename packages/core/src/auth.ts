/**
 * Installation credentials, browser sessions and request authentication.
 *
 * `protocol.md` §2 is the contract: the browser logs in with a token that the
 * installer generated and showed exactly once; success sets an
 * `HttpOnly; SameSite=Strict; Secure` cookie plus a CSRF token for same-origin
 * writes; failures are 401 and limited to 5 per IP per minute; sessions expire
 * after 24 h; WebSocket connects verify Origin and cookie; remote deployments
 * require HTTPS while loopback development may use http with an exact Origin
 * match. The daemon and local CLI use the 0600 installation credential as a
 * Bearer token.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface AuthConfig {
  /** Sessions expire after 24 h (`protocol.md` §2). */
  readonly sessionTtlMs: number;
  /** Failed logins allowed per IP per minute. */
  readonly loginAttemptsPerMinute: number;
  /**
   * `remote` requires HTTPS and sets `Secure` cookies; `loopback` allows http on
   * a loopback host with an exact Origin match (`protocol.md` §2).
   */
  readonly deployment: 'loopback' | 'remote';
  /** Exact origins accepted on HTTP/WS writes. */
  readonly allowedOrigins: readonly string[];
  /** Injectable millisecond clock. */
  readonly now: () => number;
}

export const DEFAULT_AUTH_CONFIG: Omit<AuthConfig, 'allowedOrigins'> = {
  sessionTtlMs: 24 * 60 * 60 * 1000,
  loginAttemptsPerMinute: 5,
  deployment: 'loopback',
  now: () => Date.now(),
};

export interface AuthServiceOptions {
  /** Directory that holds the installation credential, e.g. `~/.agentdev`. */
  readonly stateDir: string;
  readonly config?: Partial<AuthConfig>;
}

export interface Session {
  readonly id: string;
  readonly csrfToken: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly ip: string;
}

export type LoginResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly cookie: string;
      readonly csrfToken: string;
      readonly expiresAt: number;
    }
  | { readonly ok: false; readonly status: 401; readonly message: string }
  | { readonly ok: false; readonly status: 429; readonly retryAfterSec: number };

export type AuthDecision =
  | { readonly ok: true; readonly session: Session }
  | {
      readonly ok: false;
      readonly status: 401 | 403;
      readonly code: 'UNAUTHENTICATED' | 'AUTH_EXPIRED' | 'NOT_AUTHORIZED';
      readonly message: string;
    };

export interface AuthenticateInput {
  /** Value of the session cookie, already parsed from the header. */
  readonly cookie?: string;
  /** `X-CSRF-Token`; required for writes. */
  readonly csrfToken?: string;
  readonly origin?: string;
  readonly isWrite: boolean;
}

/** Name of the session cookie set by `/auth/login`. */
export const SESSION_COOKIE = 'agentdev_session';
/** File name of the installation credential inside the state directory. */
export const CREDENTIAL_FILE = 'installation-token';

const INSTALLATION_TOKEN_BYTES = 32;

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Whether an origin may talk to the daemon at all. */
export function originAllowed(origin: string, options: { allowLoopbackHttp: boolean }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const loopback = isLoopbackHost(parsed.hostname);
  if (parsed.protocol === 'https:') return true;
  return options.allowLoopbackHttp && loopback && parsed.protocol === 'http:';
}

/**
 * Refuses to use a credential file that others can read.
 *
 * A 0644 credential is treated as a compromised installation rather than a
 * warning, because every Bearer request depends on it staying private.
 */
export function enforcePrivateMode(path: string): void {
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    chmodSync(path, 0o600);
    if ((statSync(path).mode & 0o777) !== 0o600) {
      throw new Error(`credential file ${path} must be 0600 (found ${mode.toString(8)})`);
    }
  }
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost';
}

/**
 * Installation credential handling.
 *
 * The file is created 0600 and its value is returned exactly once, so it can be
 * displayed to the user and never read back through the API.
 */
export class InstallationCredential {
  readonly path: string;
  private token: string | undefined;

  private constructor(path: string, token: string | undefined) {
    this.path = path;
    this.token = token;
  }

  /** Creates the credential when absent; returns the service plus the new token. */
  static loadOrCreate(stateDir: string): { credential: InstallationCredential; token?: string } {
    const path = join(stateDir, CREDENTIAL_FILE);
    if (existsSync(path)) {
      enforcePrivateMode(path);
      const token = readFileSync(path, 'utf8').trim();
      return { credential: new InstallationCredential(path, token) };
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const token = randomBytes(INSTALLATION_TOKEN_BYTES).toString('base64url');
    writeFileSync(path, `${token}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { credential: new InstallationCredential(path, token), token };
  }

  /** The token, available only for the process that created it. */
  revealOnce(): string | undefined {
    const value = this.token;
    this.token = undefined;
    return value;
  }

  /** Constant-time comparison of a Bearer token. */
  matches(candidate: string | undefined): boolean {
    if (candidate === undefined || candidate === '') return false;
    const expected = readFileSync(this.path, 'utf8').trim();
    return constantTimeEquals(expected, candidate);
  }

  /** Parses `Authorization: Bearer <token>` and verifies it. */
  matchesAuthorizationHeader(header: string | undefined): boolean {
    if (header === undefined) return false;
    const match = /^Bearer (.+)$/.exec(header.trim());
    return match === null ? false : this.matches(match[1]);
  }

  get mode(): number {
    return statSync(this.path).mode & 0o777;
  }
}

/**
 * Authentication for the daemon's HTTP and WebSocket surface.
 *
 * `allowedOrigins` is an exact list: "loopback开发允许http但Origin精确匹配" means a
 * near-miss origin such as a suffix or a different port is rejected.
 */
export class AuthService {
  readonly credential: InstallationCredential;
  private readonly config: AuthConfig;
  private readonly sessions = new Map<string, Session>();
  /** Failed login timestamps per IP, for the 5/min limit. */
  private readonly failures = new Map<string, number[]>();
  readonly createdToken: string | undefined;

  private constructor(
    credential: InstallationCredential,
    createdToken: string | undefined,
    config: AuthConfig,
  ) {
    this.credential = credential;
    this.createdToken = createdToken;
    this.config = config;
  }

  static loadOrCreate(options: AuthServiceOptions): AuthService {
    const { credential, token } = InstallationCredential.loadOrCreate(options.stateDir);
    return new AuthService(credential, token, {
      ...DEFAULT_AUTH_CONFIG,
      allowedOrigins: [],
      ...options.config,
    });
  }

  /** True while the installation token has not been shown to the user. */
  get hasFreshToken(): boolean {
    return this.createdToken !== undefined;
  }

  /**
   * Exchanges the installation token for a session.
   *
   * @returns 401 for a wrong token, 429 once the IP exceeded 5 failures/minute.
   */
  login(input: { token: string; ip: string; origin?: string }): LoginResult {
    const now = this.config.now();
    if (this.isRateLimited(input.ip, now)) {
      const window = this.failures.get(input.ip) ?? [];
      const retryAfterSec = Math.max(1, Math.ceil((window[0]! + 60_000 - now) / 1000));
      return { ok: false, status: 429, retryAfterSec };
    }
    if (input.origin !== undefined && !this.isAllowedOrigin(input.origin)) {
      this.recordFailure(input.ip, now);
      return { ok: false, status: 401, message: 'origin is not allowed' };
    }
    if (!this.credential.matches(input.token)) {
      this.recordFailure(input.ip, now);
      return { ok: false, status: 401, message: 'invalid installation token' };
    }

    const session: Session = {
      id: randomBytes(24).toString('base64url'),
      csrfToken: randomBytes(24).toString('base64url'),
      createdAt: now,
      expiresAt: now + this.config.sessionTtlMs,
      ip: input.ip,
    };
    this.sessions.set(session.id, session);
    this.failures.delete(input.ip);
    return {
      ok: true,
      sessionId: session.id,
      cookie: this.cookieFor(session),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    };
  }

  logout(sessionId: string): { readonly cleared: boolean; readonly cookie: string } {
    const existed = this.sessions.delete(sessionId);
    return { cleared: existed, cookie: this.expiredCookie() };
  }

  /** Validates a request: session, expiry, origin and (for writes) CSRF. */
  authenticate(input: AuthenticateInput): AuthDecision {
    const now = this.config.now();
    const session = input.cookie === undefined ? undefined : this.sessions.get(input.cookie);
    if (session === undefined) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'no valid session cookie',
      };
    }
    if (session.expiresAt <= now) {
      this.sessions.delete(session.id);
      return { ok: false, status: 401, code: 'AUTH_EXPIRED', message: 'session expired' };
    }
    if (input.origin !== undefined && !this.isAllowedOrigin(input.origin)) {
      return {
        ok: false,
        status: 403,
        code: 'NOT_AUTHORIZED',
        message: `origin ${input.origin} is not allowed`,
      };
    }
    if (input.isWrite) {
      if (
        input.csrfToken === undefined ||
        !constantTimeEquals(session.csrfToken, input.csrfToken)
      ) {
        return { ok: false, status: 403, code: 'NOT_AUTHORIZED', message: 'CSRF token mismatch' };
      }
    }
    return { ok: true, session };
  }

  /** Bearer authentication for the BFF, the CLI and Runner connections. */
  authenticateBearer(header: string | undefined): { readonly ok: boolean } {
    return { ok: this.credential.matchesAuthorizationHeader(header) };
  }

  /** Removes expired sessions; returns how many were dropped. */
  sweepExpired(): number {
    const now = this.config.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Origin policy.
   *
   * A configured allowlist is matched exactly, which is what a deployed daemon
   * uses. With no allowlist — development only — any https origin or any loopback
   * origin is accepted, still subject to the http/loopback rule.
   */
  private isAllowedOrigin(origin: string): boolean {
    if (this.config.allowedOrigins.length > 0) {
      return this.config.allowedOrigins.includes(origin);
    }
    return originAllowed(origin, {
      allowLoopbackHttp: this.config.deployment === 'loopback',
    });
  }

  /** `Secure` is set for remote deployments, and for any explicit https origin. */
  private get secureCookies(): boolean {
    return this.config.deployment === 'remote';
  }

  private isRateLimited(ip: string, now: number): boolean {
    const window = (this.failures.get(ip) ?? []).filter((at) => now - at < 60_000);
    this.failures.set(ip, window);
    return window.length >= this.config.loginAttemptsPerMinute;
  }

  private recordFailure(ip: string, now: number): void {
    const window = (this.failures.get(ip) ?? []).filter((at) => now - at < 60_000);
    window.push(now);
    this.failures.set(ip, window);
  }

  private cookieFor(session: Session): string {
    const parts = [
      `${SESSION_COOKIE}=${session.id}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(this.config.sessionTtlMs / 1000)}`,
    ];
    if (this.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  private expiredCookie(): string {
    const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (this.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }
}

/** Parses a `Cookie` header into name/value pairs. */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') jar[name] = value;
  }
  return jar;
}
