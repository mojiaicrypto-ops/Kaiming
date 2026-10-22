import { readStored, writeStored } from '../lib/storage';
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
  /** The write token; null before login. Read-only for callers (the acceptance harness checks it). */
  csrfToken: string | null = null;
  /** Set by the shell: a 401 means the cookie is gone and the login screen must take over. */
  onUnauthorized: (() => void) | null = null;

  constructor(options: { onUnauthorized?: () => void } = {}) {
    this.onUnauthorized = options.onUnauthorized ?? null;
    this.csrfToken = readStored(CSRF_KEY);
  }

  /** Re-read the stored token: a parallel client (login view) may have refreshed it. */
  refreshCsrf(): void {
    this.csrfToken = readStored(CSRF_KEY);
  }

  async login(password: string, requestId = newRequestId('login')): Promise<void> {
    const body = await this.send(requestId, 'auth.login', { password }, false);
    const result = body.result as { csrfToken?: string };
    if (typeof result.csrfToken === 'string') {
      this.csrfToken = result.csrfToken;
      writeStored(CSRF_KEY, result.csrfToken);
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

  /**
   * Upload one image as raw bytes (not JSON, so the envelope limit does not apply). The cookie
   * authenticates and the CSRF header proves the page; the response names the stored attachment.
   */
  async upload(file: File): Promise<{ id: string; url: string; mimeType: string; bytes: number }> {
    const headers: Record<string, string> = {
      'content-type': file.type === '' ? 'application/octet-stream' : file.type,
    };
    if (this.csrfToken !== null) {
      headers['x-agentdev-csrf'] = this.csrfToken;
    }
    const response = await fetch('/api/v1/uploads', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: file,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RpcError('BAD_RESPONSE', `the server returned a non-JSON body (${response.status})`);
    }
    const envelope = payload as {
      result?: { id: string; url: string; mimeType: string; bytes: number };
      error?: { code: string; message: string; details?: unknown };
    };
    if (envelope.error !== undefined) {
      if (envelope.error.code === 'UNAUTHORIZED') {
        this.onUnauthorized?.();
      }
      throw new RpcError(envelope.error.code, envelope.error.message, envelope.error.details);
    }
    if (response.status !== 200 || envelope.result === undefined) {
      throw new RpcError('BAD_RESPONSE', `unexpected status ${response.status}`);
    }
    return envelope.result;
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
