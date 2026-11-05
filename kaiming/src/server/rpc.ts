/**
 * The public RPC entry (R1): one envelope, one error catalogue, one receipt per write.
 *
 * A method is registered with its write flag; the router validates the envelope, claims the request
 * key (so a retry replays the recorded outcome and a reused id with different parameters is a
 * conflict), runs the handler and records the real outcome - a failure as truthfully as a success.
 * Handlers are the only place that knows business semantics; the router knows identity, schema and
 * receipts.
 */
import { StoreError, digestOf, type Store } from '../store/store.ts';

export const RPC_PATH = '/api/v1/rpc';

/** The public error catalogue (R6). Adding a code is a contract change. */
export const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_ARGUMENT',
  'REQUEST_CONFLICT',
  'VERSION_CONFLICT',
  'PROJECT_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'HISTORY_UNAVAILABLE',
  'PI_INPUT_UNCONFIRMED',
  'STORAGE_UNAVAILABLE',
  'EFFECT_UNCONFIRMED',
  'WORKSPACE_BUSY',
  'TASK_BUSY',
  'TASK_CONTROLLED',
  'STAGE_NOT_READY',
  'REPORT_MISSING',
  'REPORT_STALE',
  'COMPLETION_INCOMPLETE',
  'INTERACTION_STALE',
  'STREAM_RESYNC_REQUIRED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class RpcError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface RpcEnvelope {
  readonly requestId?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

export interface RpcResponse {
  readonly requestId: string;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string; readonly details?: unknown };
}

export interface RpcContext {
  readonly store: Store;
  /** Who is calling: the cookie session this connection authenticated with. */
  readonly actor: string;
  /** Lets an auth handler attach its cookie without the router knowing about transport. */
  readonly setCookie?: (cookie: string) => void;
  /** The request id the caller used: store-level idempotency keys must be stable across retries. */
  readonly requestId: string;
}

export interface RpcHandler {
  /** A write needs a caller-supplied requestId and its outcome is recorded as a receipt. */
  readonly write: boolean;
  run(params: Record<string, unknown>, context: RpcContext): Promise<unknown> | unknown;
}

export class RpcRouter {
  private readonly methods = new Map<string, RpcHandler>();

  register(name: string, handler: RpcHandler): void {
    this.methods.set(name, handler);
  }

  has(name: string): boolean {
    return this.methods.has(name);
  }

  /** Whether this method mutates state (writes need a requestId and the CSRF token). */
  requiresWrite(name: string): boolean {
    return this.methods.get(name)?.write ?? false;
  }

  /**
   * Handle one envelope. Returns the response body; the caller decides the HTTP status from it.
   * `idFactory` supplies a request id for reads that did not bring one.
   */
  async handle(envelope: RpcEnvelope, context: RpcContext, idFactory: () => string): Promise<RpcResponse> {
    const method = typeof envelope.method === 'string' ? envelope.method : undefined;
    const givenId = typeof envelope.requestId === 'string' && envelope.requestId.trim() !== '' ? envelope.requestId : undefined;
    const requestId = givenId ?? idFactory();
    if (method === undefined) {
      return failure(requestId, new RpcError('INVALID_ARGUMENT', 'method is required'));
    }
    const handler = this.methods.get(method);
    if (handler === undefined) {
      return failure(requestId, new RpcError('INVALID_ARGUMENT', `unknown method ${method}`, { method }));
    }
    if (envelope.params !== undefined && (typeof envelope.params !== 'object' || envelope.params === null || Array.isArray(envelope.params))) {
      return failure(requestId, new RpcError('INVALID_ARGUMENT', 'params must be an object'));
    }
    const params = normalizeParams((envelope.params ?? {}) as Record<string, unknown>);
    if (handler.write && givenId === undefined) {
      return failure(requestId, new RpcError('INVALID_ARGUMENT', 'a write call needs a stable requestId', { method }));
    }

    // A receipt keys a write request: only a write may claim one, so no pre-auth call (login) can
    // persist a caller-supplied parameter digest, and the id the client reuses is honoured.
    const paramsDigest = digestOf({ method, params });
    let claimed = false;
    if (givenId !== undefined && handler.write) {
      let claim;
      try {
        claim = context.store.beginRequest({ requestKey: receiptKey(requestId), method, paramsDigest });
      } catch (error) {
        return failure(requestId, toRpcError(error));
      }
      if (claim.kind === 'replay') {
        if (claim.error === undefined) {
          return { requestId, result: claim.result };
        }
        return { requestId, error: claim.error as NonNullable<RpcResponse['error']> };
      }
      claimed = true;
    }

    try {
      const result = await handler.run(params, context);
      if (claimed) {
        context.store.commitRequest({ requestKey: receiptKey(requestId), result });
      }
      return { requestId, result };
    } catch (error) {
      const rpcError = toRpcError(error);
      if (claimed) {
        // A refused call is a real outcome: recording it makes a retry replay the same refusal.
        context.store.commitRequest({
          requestKey: receiptKey(requestId),
          error: { code: rpcError.code, message: rpcError.message, ...(rpcError.details !== undefined ? { details: rpcError.details } : {}) },
        });
      }
      return failure(requestId, rpcError);
    }
  }
}

/**
 * The RPC receipt lives in its own key space: store-level receipts (an accepted input) keep the raw
 * key, so one client requestId can key both without two incompatible digests on one row (S2).
 */
export function receiptKey(requestId: string): string {
  return `rpc:${requestId}`;
}

function failure(requestId: string, error: RpcError): RpcResponse {
  return {
    requestId,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
}

/** Store errors already use the public catalogue; anything else is a host failure, never a guess. */
export function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcError) {
    return error;
  }
  if (error instanceof StoreError) {
    if (error.code === 'RECOVERY_REQUIRED') {
      // The storage layer asks for verification; the public meaning is "the input is unconfirmed".
      return new RpcError('PI_INPUT_UNCONFIRMED', error.message, error.details);
    }
    const code = (ERROR_CODES as readonly string[]).includes(error.code)
      ? (error.code as ErrorCode)
      : 'STORAGE_UNAVAILABLE';
    return new RpcError(code, error.message, error.details);
  }
  return new RpcError('STORAGE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
}

/**
 * Normalization only touches Schema defaults and object key order (R1): it never merges natural
 * language or invents values. `undefined` members are absent, not defaulted.
 */
export function normalizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** HTTP status for one response: the body always carries the catalogue code. */
export function statusFor(response: RpcResponse): number {
  if (response.error === undefined) {
    return 200;
  }
  switch (response.error.code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'REQUEST_CONFLICT':
    case 'VERSION_CONFLICT':
    case 'WORKSPACE_BUSY':
    case 'TASK_BUSY':
    case 'TASK_CONTROLLED':
    case 'INTERACTION_STALE':
    case 'STREAM_RESYNC_REQUIRED':
    case 'HISTORY_UNAVAILABLE':
    case 'PI_INPUT_UNCONFIRMED':
    case 'REPORT_MISSING':
    case 'REPORT_STALE':
    case 'COMPLETION_INCOMPLETE':
      return 409;
    case 'STORAGE_UNAVAILABLE':
    case 'EFFECT_UNCONFIRMED':
    case 'MODEL_UNAVAILABLE':
    case 'PROJECT_UNAVAILABLE':
      return 503;
    default:
      return 400;
  }
}
