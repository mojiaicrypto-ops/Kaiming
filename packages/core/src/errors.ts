/**
 * Protocol error vocabulary (`docs/architecture/protocol.md` §7).
 *
 * The error table is a contract, so the codes live in one union and the retry
 * policy is explicit: "仅BUSY和已知无副作用的Provider瞬时错误retryable=true".
 */
import type { JsonObject } from '@agentdev/contracts';

export const PROTOCOL_ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_STATE',
  'UNAUTHENTICATED',
  'AUTH_EXPIRED',
  'NOT_FOUND',
  'NOT_AUTHORIZED',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'GATE_NOT_READY',
  'MISSING_CONTEXT',
  'CONTEXT_FORBIDDEN',
  'STALE_ARTIFACT',
  'BUDGET_EXCEEDED',
  'BUSY',
  'RECOVERY_REQUIRED',
  'ATTACHMENT_ALREADY_BOUND',
  'ARTIFACT_MISSING',
  'KNOWLEDGE_INVALID',
  'PROVIDER_UNAVAILABLE',
  'PROTOCOL_MISMATCH',
  'RESYNC_REQUIRED',
  'REQUIREMENT_CONFLICT',
  'REQUIREMENT_PATH_IGNORED',
  'LEGACY_REQUIREMENT_FORMAT',
  'INTERNAL_ERROR',
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export interface ProtocolErrorBody {
  readonly code: ProtocolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

/** A request-level failure that maps onto one response envelope. */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly retryable: boolean;
  readonly details: JsonObject | undefined;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    options: { retryable?: boolean; details?: JsonObject } = {},
  ) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.retryable = options.retryable ?? code === 'BUSY';
    this.details = options.details;
  }

  /** Serialises to the `error` member of a failed response. */
  toBody(): ProtocolErrorBody {
    // Two literal shapes so `exactOptionalPropertyTypes` sees a defined `details`.
    return this.details === undefined
      ? { code: this.code, message: this.message, retryable: this.retryable }
      : {
          code: this.code,
          message: this.message,
          retryable: this.retryable,
          details: this.details,
        };
  }
}

export interface RequestEnvelope {
  readonly v: 1;
  readonly type: 'request';
  readonly id: string;
  readonly method: string;
  readonly projectId?: string;
  readonly params?: JsonObject;
  /** Required for every write method: 1–128 characters. */
  readonly idempotencyKey?: string;
  /** Target entity version; 0 means "expect absent" (`protocol.md` §1). */
  readonly expectedVersion?: number;
}

export type ResponseEnvelope =
  | {
      readonly v: 1;
      readonly type: 'response';
      readonly id: string;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly v: 1;
      readonly type: 'response';
      readonly id: string;
      readonly ok: false;
      readonly error: ProtocolErrorBody;
    };

export const okResponse = (id: string, result: unknown): ResponseEnvelope => ({
  v: 1,
  type: 'response',
  id,
  ok: true,
  result,
});

export const errorResponse = (
  id: string,
  error: ProtocolError | ProtocolErrorBody,
): ResponseEnvelope => ({
  v: 1,
  type: 'response',
  id,
  ok: false,
  error: error instanceof ProtocolError ? error.toBody() : error,
});
