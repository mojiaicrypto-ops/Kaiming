/**
 * The RPC client (R1): one envelope, one error catalogue, one stable request id per user action.
 *
 * Nothing here knows business meaning. A write call carries the id the caller generated for that
 * action and reuses it on retry, so a double click or a reconnect cannot submit the same work twice;
 * the CSRF token from the login response travels with every call and is required by the server for
 * writes.
 */

export class RpcError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.details = details;
  }
}

let sequence = 0;

/** A fresh id for one user action (keep it and reuse it when retrying that action). */
export function newRequestId(prefix = 'c') {
  sequence += 1;
  const random = Math.random().toString(16).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${sequence}-${random}`;
}

export class RpcClient {
  constructor(options = {}) {
    this.base = options.base ?? '';
    this.path = options.path ?? '/api/v1/rpc';
    this.csrfToken = null;
    this.onUnauthorized = options.onUnauthorized ?? (() => undefined);
    this.pending = new Map();
  }

  /** Exchange the access password for a session; the cookie is HttpOnly, the token goes in the body. */
  async login(password, requestId = newRequestId('login')) {
    const response = await this.#send(requestId, 'auth.login', { password }, false);
    this.csrfToken = response.csrfToken;
    return response;
  }

  async logout() {
    const response = await this.call('auth.logout', {});
    this.csrfToken = null;
    return response;
  }

  /**
   * Call one method. `requestId` defaults to a new id: pass the id you generated for the user action
   * when the call may be retried.
   */
  async call(method, params = {}, options = {}) {
    return this.#send(options.requestId ?? newRequestId(), method, params, true);
  }

  async #send(requestId, method, params, requiresAuth) {
    // One in-flight call per requestId: a retry while the first is running reuses that promise.
    const existing = this.pending.get(requestId);
    if (existing !== undefined) {
      return existing;
    }
    const headers = { 'content-type': 'application/json' };
    if (this.csrfToken !== null) {
      headers['x-agentdev-csrf'] = this.csrfToken;
    }
    const attempt = (async () => {
      let response;
      try {
        response = await fetch(`${this.base}${this.path}`, {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({ requestId, method, params }),
        });
      } catch (error) {
        throw new RpcError('NETWORK', `the workbench is unreachable (${error.message})`, { method });
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new RpcError('NETWORK', `the workbench answered ${response.status} without JSON`, {
          method,
          status: response.status,
        });
      }
      if (body.error !== undefined) {
        if (body.error.code === 'UNAUTHORIZED' && requiresAuth) {
          this.onUnauthorized();
        }
        throw new RpcError(body.error.code, body.error.message, body.error.details);
      }
      return body.result;
    })();
    this.pending.set(requestId, attempt);
    try {
      return await attempt;
    } finally {
      this.pending.delete(requestId);
    }
  }
}
