/**
 * One way to reach the workbench, two transports: the in-process router (the `/mcp` endpoint, which
 * already runs inside the server) and a loopback HTTP client (the stdio process, which either owns a
 * workbench it started or attaches to the one already serving). Tool code never knows which.
 */
import { randomUUID } from 'node:crypto';
import { RPC_PATH, type RpcContext, type RpcResponse, type RpcRouter } from '../server/rpc.ts';
import { CSRF_HEADER } from '../server/auth.ts';
import type { Store } from '../store/store.ts';

/** A business refusal, carrying the R6 code so the tool layer can map it to a JSON-RPC error. */
export class ControlError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface Control {
  /** Call a public RPC method. `requestId` makes a write idempotent across retries. */
  call(method: string, params: Record<string, unknown>, requestId?: string): Promise<unknown>;
}

export interface InProcessControlOptions {
  readonly router: RpcRouter;
  readonly store: Store;
  /** Who the caller is; the MCP endpoint uses a name derived from its own authentication. */
  readonly actor: string;
}

/** The `/mcp` mount talks to the router directly: same process, same store, no HTTP round trip. */
export function inProcessControl(options: InProcessControlOptions): Control {
  return {
    async call(method, params, requestId) {
      const id = requestId ?? randomUUID();
      const context: RpcContext = {
        store: options.store,
        actor: options.actor,
        requestId: id,
      };
      const response = await options.router.handle({ requestId: id, method, params }, context, () => randomUUID());
      if (response.error !== undefined) {
        throw new ControlError(response.error.code, response.error.message, response.error.details as Record<string, unknown> | undefined);
      }
      return response.result;
    },
  };
}

export interface HttpControlOptions {
  readonly origin: string;
  /** The workbench access password; exchanged for a cookie before the first call. */
  readonly password: string;
}

interface HttpControlState {
  cookie: string | null;
  csrf: string | null;
}

function failureOf(response: RpcResponse): ControlError {
  const error = response.error;
  return new ControlError(
    error?.code ?? 'STORAGE_UNAVAILABLE',
    error?.message ?? 'the workbench did not answer',
    (error?.details as Record<string, unknown> | undefined) ?? undefined,
  );
}

/**
 * Loopback HTTP control. Authenticates once with the access password, then reuses the cookie and the
 * CSRF token; a rejected cookie (the server restarted) is refreshed once, transparently.
 */
export function httpControl(options: HttpControlOptions): Control {
  const state: HttpControlState = { cookie: null, csrf: null };
  const origin = options.origin.replace(/\/+$/, '');

  const post = async (body: unknown, headers: Record<string, string>): Promise<{ response: Response; text: string }> => {
    const response = await fetch(`${origin}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return { response, text: await response.text() };
  };

  const login = async (): Promise<void> => {
    const { response, text } = await post(
      { requestId: `mcp-login-${randomUUID()}`, method: 'auth.login', params: { password: options.password } },
      {},
    );
    if (response.status === 401) {
      throw new ControlError('UNAUTHORIZED', 'the workbench rejected the access password');
    }
    const parsed = JSON.parse(text) as RpcResponse;
    if (parsed.error !== undefined) {
      throw failureOf(parsed);
    }
    const setCookie = response.headers.getSetCookie?.() ?? [];
    const cookie = setCookie.map((value) => value.split(';')[0]).find((value) => value !== undefined);
    if (cookie === undefined) {
      throw new ControlError('STORAGE_UNAVAILABLE', 'the workbench did not issue a session cookie');
    }
    state.cookie = cookie;
    state.csrf = (parsed.result as { csrfToken?: string } | undefined)?.csrfToken ?? null;
  };

  const call = async (method: string, params: Record<string, unknown>, requestId?: string): Promise<unknown> => {
    if (state.cookie === null) await login();
    const send = async (): Promise<{ response: Response; text: string }> =>
      post(
        { requestId: requestId ?? randomUUID(), method, params },
        {
          cookie: state.cookie ?? '',
          ...(state.csrf !== null ? { [CSRF_HEADER]: state.csrf } : {}),
        },
      );
    let { response, text } = await send();
    if (response.status === 401) {
      // The server restarted and forgot the cookie: one fresh login, then the same call again.
      await login();
      ({ response, text } = await send());
    }
    if (response.status >= 500 || text === '') {
      throw new ControlError('STORAGE_UNAVAILABLE', `the workbench answered ${String(response.status)}`);
    }
    const parsed = JSON.parse(text) as RpcResponse;
    if (parsed.error !== undefined) throw failureOf(parsed);
    return parsed.result;
  };

  return { call };
}

/** Is a workbench already serving this origin? Probed without credentials (any JSON answer counts). */
export async function workbenchServing(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin.replace(/\/+$/, '')}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'mcp-probe', method: 'project.list', params: {} }),
      signal: AbortSignal.timeout(1500),
    });
    const text = await response.text();
    return text.includes('"requestId"');
  } catch {
    return false;
  }
}
