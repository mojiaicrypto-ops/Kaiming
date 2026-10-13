/**
 * RPC client (R1 semantics, TS port of web/core/rpc.js): one envelope, one error catalogue,
 * one stable request id per user action. The CSRF token from the login response travels with
 * every call; writes require it (the server refuses otherwise).
 */
export class RpcError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.details = details;
  }
}

let sequence = 0;

export function newRequestId(prefix = 'c'): string {
  sequence += 1;
  const random = Math.random().toString(16).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${sequence}-${random}`;
}

const CSRF_KEY = 'agentdev.csrf';

export class RpcClient {
  private csrfToken: string | null = null;
  private onUnauthorized: (() => void) | null = null;

  constructor(options: { onUnauthorized?: () => void } = {}) {
    this.onUnauthorized = options.onUnauthorized ?? null;
    const stored = localStorage.getItem(CSRF_KEY);
    this.csrfToken = stored === null ? null : stored;
  }

  async login(password: string, requestId = newRequestId('login')): Promise<void> {
    const body = await this.send(requestId, 'auth.login', { password }, false);
    const result = body.result as { csrfToken?: string };
    if (typeof result.csrfToken === 'string') {
      this.csrfToken = result.csrfToken;
      localStorage.setItem(CSRF_KEY, result.csrfToken);
    }
  }

  async logout(): Promise<void> {
    await this.send(newRequestId('logout'), 'auth.logout', {}, true);
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    options: { requestId?: string } = {},
  ): Promise<T> {
    const body = await this.send(options.requestId ?? newRequestId(), method, params, true);
    return body.result as T;
  }

  private async send(
    requestId: string,
    method: string,
    params: Record<string, unknown>,
    requiresAuth: boolean,
  ): Promise<{ result: unknown }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (requiresAuth && this.csrfToken !== null) {
      headers['x-agentdev-csrf'] = this.csrfToken;
    }
    const response = await fetch('/api/v1/rpc', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ requestId, method, params }),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RpcError('BAD_RESPONSE', `the server returned a non-JSON body (${response.status})`);
    }
    const envelope = payload as { result?: unknown; error?: { code: string; message: string; details?: unknown } };
    if (envelope.error !== undefined) {
      const error = envelope.error;
      if (error.code === 'UNAUTHORIZED') {
        this.onUnauthorized?.();
      }
      throw new RpcError(error.code, error.message, error.details);
    }
    if (response.status !== 200) {
      throw new RpcError('BAD_RESPONSE', `unexpected status ${response.status}`);
    }
    return envelope as { result: unknown };
  }
}
