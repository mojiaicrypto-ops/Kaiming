/**
 * Runtime-layer failures.
 *
 * These are internal to `@agentdev/pi-runtime`; the protocol codes in
 * `@agentdev/contracts` are what reaches a client. Each code names a condition
 * the Runner must react to, never a message to show a user verbatim.
 */
export type PiRuntimeErrorCode =
  /** A configured extension id is not in the built-in whitelist. */
  | 'UNKNOWN_EXTENSION'
  /** A critical capability or extension failed; the Run must not start. */
  | 'CRITICAL_EXTENSION_FAILED'
  /** A resource (skill, project file) came from an untrusted project. */
  | 'UNTRUSTED_RESOURCE'
  /** The requested provider/model pair does not exist in the runtime catalog. */
  | 'MODEL_UNAVAILABLE'
  /** The session handle was disposed or never created. */
  | 'SESSION_CLOSED'
  /** A stage result was submitted outside the allowed shape or twice. */
  | 'CONTRACT_VIOLATION';

export class PiRuntimeError extends Error {
  readonly code: PiRuntimeErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: PiRuntimeErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'PiRuntimeError';
    this.code = code;
    this.details = details;
  }
}
