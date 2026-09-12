/**
 * Grant admission (`docs/architecture/data.md` §2 grant, `reliability.md` §2).
 *
 * A tool call is admitted only when every documented binding matches
 * ("全匹配后才准入"): scope target, role, stage, operation, expiry, and — for a
 * `once` grant — the exact tool operation and input hash. The same operation with
 * the same hash replays the original result instead of consuming twice; the same
 * operation with a different hash is refused.
 *
 * The decision is a `{allowed, reason}` pair; `grantDenialCode` maps that reason
 * onto the contracts vocabulary so the caller (`core/grants.ts`) can surface the
 * documented error instead of guessing from prose: `NOT_AUTHORIZED` for a
 * binding/scope mismatch, `AUTH_EXPIRED` for a grant past its expiry or revoked,
 * and `IDEMPOTENCY_CONFLICT` for a `once` grant reused with a different input
 * hash, tool operation or run. A malformed request (`VALIDATION_ERROR`) is refused
 * by `validateGrantIssueRequest` before any row is written.
 *
 * This module is also the one place the **issuance** rules live: a Grant may only
 * be minted inside the Work's own operation envelope, with a known role/stage and
 * requested targets that stay inside the Work's authorized paths. That keeps
 * "超范围权限决定" (`acceptance.md` AC-049) a front-end refusal rather than a
 * tool-boundary surprise.
 */
import type { ErrorCode, Grant, Role } from '@agentdev/contracts';

export interface GrantRequest {
  readonly operation: string;
  readonly role: Role;
  readonly stage: string;
  readonly targets: readonly string[];
  readonly at: string;
  readonly workId?: string;
  readonly runId?: string;
  readonly toolOperationId?: string;
  readonly inputHash?: string;
}

/** Codes a grant decision can carry; a subset of the contracts error set. */
export type GrantDenialCode = Extract<
  ErrorCode,
  | 'NOT_AUTHORIZED'
  | 'AUTH_EXPIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'MISSING_CONTEXT'
>;

/** Codes a mint request can be refused with; wider than a use-time denial. */
export type GrantIssueCode = GrantDenialCode | 'INVALID_STATE';

export type GrantDecision =
  | { readonly allowed: true; readonly replay: boolean }
  | { readonly allowed: false; readonly reason: string };

/**
 * The refusal code that belongs to one admission reason.
 *
 * The decision itself stays a `{allowed, reason}` pair, so the error code is
 * derived from the reason the rule produced; prefixing (not keyword matching) is
 * used so that editing a message cannot silently change its code. Callers that
 * need the precise cause read `reason`, and `grantDenialField` names the binding
 * that differed.
 */
export function grantDenialCode(reason: string): GrantDenialCode {
  if (reason.startsWith('grant expired') || reason.startsWith('grant revoked')) {
    return 'AUTH_EXPIRED';
  }
  if (reason.startsWith('grant already consumed')) return 'IDEMPOTENCY_CONFLICT';
  if (reason.endsWith('is not a repository-relative path')) return 'VALIDATION_ERROR';
  return 'NOT_AUTHORIZED';
}

/**
 * The binding field an admission reason is about, for audit.
 *
 * When the grant and request are both available the mismatch is measured directly,
 * because a "already consumed" refusal does not name the binding that differed.
 */
export function grantDenialField(
  reason: string,
  grant?: Grant,
  request?: GrantRequest,
): string | undefined {
  if (grant !== undefined && request !== undefined) {
    if (grant.runId !== request.runId) return 'runId';
    if (grant.toolOperationId !== request.toolOperationId) return 'toolOperationId';
    if (grant.inputHash !== request.inputHash) return 'inputHash';
  }
  if (reason.includes('another run') || reason.includes('belongs to another work')) return 'runId';
  if (reason.includes('another tool operation')) return 'toolOperationId';
  if (reason.includes('input hash')) return 'inputHash';
  if (reason.includes('operation')) return 'operation';
  if (reason.includes('role')) return 'role';
  if (reason.includes('stage')) return 'stage';
  if (reason.includes('target')) return 'targets';
  return undefined;
}

/**
 * The instant used to revoke a Grant.
 *
 * A revoked Grant must refuse every later use, while a `once` transaction that
 * already completed still replays its original result (`WP-07` requirement 4).
 * The contract has no `revokedAt` column, so revocation is expressed with the two
 * fields that already carry that meaning: `consumedAt` records the revocation and
 * `expiresAt` is moved before the epoch. The two cases stay distinguishable
 * because revocation never sets `consumedByOperationId`, and `evaluateGrant`
 * requires a recorded consumption for replay.
 *
 * This is the single place that knows the encoding; callers use this function.
 */
export function revocationTime(): string {
  return new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// Target and path rules
// ---------------------------------------------------------------------------

/**
 * Whether a requested target is a well-formed repository-relative path.
 *
 * The contract schema already rejects `..` and absolute paths, but a Grant is
 * evaluated at the tool boundary on decoded input, so the check is repeated here
 * rather than trusting the caller.
 */
export function isSafeTarget(target: string): boolean {
  if (target === '' || target.includes('\0') || target.includes('\\')) return false;
  if (target.startsWith('/') || /^[A-Za-z]:/.test(target)) return false;
  return !target.split('/').includes('..');
}

/** A target covers a request when it is equal, or a path prefix of it. */
export function targetCovers(granted: string, requested: string): boolean {
  if (granted === requested) return true;
  if (!granted.endsWith('/')) return false;
  return requested.startsWith(granted);
}

// ---------------------------------------------------------------------------
// Admission (use time)
// ---------------------------------------------------------------------------

/**
 * Decides whether one Grant admits one request.
 *
 * The replay branch is decided from the immutable `consumedAt`/`inputHash`/`runId`
 * binding and **before** the expiry check: a `once` transaction that completed
 * keeps returning its original result even after the Grant's time has passed
 * (`AC-080` — "重试原操作返回原结果"), which is what makes a lost tool response
 * recoverable. Every other use is evaluated against `request.at`, so an expired or
 * revoked Grant refuses and a consumed Grant answers `IDEMPOTENCY_CONFLICT`.
 *
 * A replay needs a *recorded* consumption (`consumedByOperationId`): revocation
 * closes an unconsumed Grant by setting `consumedAt` alone
 * (`domain/revocationTime`), so a revoked Grant can never replay a stale result.
 * A replay is also bound to the run, so a sibling Run cannot claim another Run's
 * result (`AC-080` sibling isolation).
 */
export function evaluateGrant(grant: Grant, request: GrantRequest): GrantDecision {
  if (grant.consumedAt !== undefined) {
    // Idempotent replay: the same run, tool operation and input hash, recorded.
    // A completed `once` transaction outlives its expiry, so this is checked before
    // the clock — that is what makes a lost tool response recoverable.
    if (
      grant.scope === 'once' &&
      grant.consumedByOperationId !== undefined &&
      grant.runId === request.runId &&
      grant.toolOperationId === request.toolOperationId &&
      grant.inputHash === request.inputHash
    ) {
      return { allowed: true, replay: true };
    }
  }
  if (Date.parse(request.at) > Date.parse(grant.expiresAt)) {
    return deny(
      revocationTime() === new Date(grant.expiresAt).toISOString()
        ? 'grant revoked'
        : 'grant expired',
    );
  }
  if (grant.consumedAt !== undefined) {
    return deny(
      `grant already consumed by ${grant.consumedByOperationId ?? 'an unknown operation'}`,
    );
  }
  if (grant.role !== request.role) {
    return deny(`grant role ${grant.role} != ${request.role}`);
  }
  if (grant.stage !== request.stage) {
    return deny(`grant stage ${grant.stage} != ${request.stage}`);
  }
  if (grant.operation !== request.operation) {
    return deny(`grant operation ${grant.operation} != ${request.operation}`);
  }
  switch (grant.scope) {
    case 'once': {
      if (grant.runId !== request.runId) return deny('once grant belongs to another run');
      if (grant.toolOperationId !== request.toolOperationId) {
        return deny('once grant belongs to another tool operation');
      }
      if (grant.inputHash !== request.inputHash) return deny('once grant input hash mismatch');
      break;
    }
    case 'run': {
      if (grant.runId !== request.runId) return deny('run grant belongs to another run');
      break;
    }
    case 'work': {
      if (grant.workId !== request.workId) return deny('work grant belongs to another work');
      break;
    }
    case 'project':
      // Bound by the row's project; nothing further to compare.
      break;
  }
  for (const target of request.targets) {
    if (!isSafeTarget(target)) {
      return deny(`target ${target} is not a repository-relative path`);
    }
    if (!grant.targets.some((granted) => targetCovers(granted, target))) {
      return deny(`target ${target} is outside the grant`);
    }
  }
  return { allowed: true, replay: false };
}

function deny(reason: string): GrantDecision {
  return { allowed: false, reason };
}

/** Whether a scope may be satisfied by the request's identity fields. */
export function scopeBindingsSatisfied(
  scope: Grant['scope'],
  request: Pick<GrantRequest, 'workId' | 'runId' | 'toolOperationId' | 'inputHash'>,
): boolean {
  switch (scope) {
    case 'once':
      return (
        request.runId !== undefined &&
        request.toolOperationId !== undefined &&
        request.inputHash !== undefined
      );
    case 'run':
      return request.runId !== undefined;
    case 'work':
      return request.workId !== undefined;
    case 'project':
      return true;
  }
}

// ---------------------------------------------------------------------------
// Issuance (mint time)
// ---------------------------------------------------------------------------

/** The declared envelope a Grant is minted inside. */
export interface GrantWorkScope {
  readonly workId: string;
  /** `work.scope.operations`; an operation outside this list is refused. */
  readonly operations: readonly string[];
  /** `work.scope.readPaths` plus the authorization rows' read paths. */
  readonly readPaths: readonly string[];
  /** `work.scope.writePaths` plus the authorization rows' write paths. */
  readonly writePaths: readonly string[];
}

/** A request to mint one Grant for one Work. */
export interface GrantIssueRequest {
  readonly workId: string;
  readonly role: Role;
  readonly stage: string;
  readonly scope: Grant['scope'];
  readonly operation: string;
  readonly targets: readonly string[];
  /** Required for `once` and `run` scopes; must be a run of `workId`. */
  readonly runId?: string;
  /** Required for `once`; the exact tool-operation id the Grant is bound to. */
  readonly toolOperationId?: string;
  /** Required for `once`; the SHA256 of the decoded tool input. */
  readonly inputHash?: string;
  readonly expiresAt: string;
  /** The identities allowed to perform this role at this stage. */
  readonly roleStages: readonly string[];
  readonly limits?: Readonly<Record<string, unknown>>;
}

function issueDeny(
  code: GrantIssueCode,
  reason: string,
): {
  readonly ok: false;
  readonly code: GrantIssueCode;
  readonly reason: string;
} {
  return { ok: false, code, reason };
}

/** The outcome shape shared by issuance validation helpers. */
export interface GrantIssueRefusal {
  readonly ok: false;
  readonly code: GrantIssueCode;
  readonly reason: string;
}

/**
 * Validates a mint request against the Work envelope and the role/stage table.
 *
 * Nothing is written here: the caller runs this inside its own transaction before
 * inserting the row, so an out-of-scope request cannot leave a Grant behind.
 */
export function validateGrantIssueRequest(
  request: GrantIssueRequest,
  work: GrantWorkScope,
): GrantIssueRefusal | { readonly ok: true } {
  if (request.workId !== work.workId) {
    return issueDeny(
      'NOT_AUTHORIZED',
      `grant work ${request.workId} does not match the request work ${work.workId}`,
    );
  }
  if (request.operation.trim() === '') {
    return issueDeny('VALIDATION_ERROR', 'grant operation must not be empty');
  }
  if (!work.operations.includes(request.operation)) {
    return issueDeny(
      'NOT_AUTHORIZED',
      `operation ${request.operation} is outside the Work scope (${[...work.operations].join(', ')})`,
    );
  }
  if (!scopeBindingsSatisfied(request.scope, request)) {
    return issueDeny(
      'VALIDATION_ERROR',
      `${request.scope} grant is missing its runId/toolOperationId/inputHash binding`,
    );
  }
  if (request.scope === 'once' && !HASH_PATTERN.test(request.inputHash ?? '')) {
    return issueDeny('VALIDATION_ERROR', 'once grant requires a lowercase SHA256 input hash');
  }
  if (!request.roleStages.includes(request.stage)) {
    return issueDeny(
      'MISSING_CONTEXT',
      `role ${request.role} is not authorized at stage ${request.stage}`,
    );
  }
  if (request.targets.length > MAX_TARGETS) {
    return issueDeny('VALIDATION_ERROR', `a grant carries at most ${MAX_TARGETS} targets`);
  }
  for (const target of request.targets) {
    if (!isSafeTarget(target)) {
      return issueDeny('VALIDATION_ERROR', `target ${target} is not a repository-relative path`);
    }
    if (!targetWithinWorkScope(target, request.operation, work)) {
      return issueDeny('NOT_AUTHORIZED', `target ${target} is outside the Work scope`);
    }
  }
  return { ok: true };
}

/** `data.md` §1 bounds every array at 1000 items. */
const MAX_TARGETS = 1000;

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Path-shaped tool operations.
 *
 * Network/secret/push/deploy carry non-path targets (hosts, secret names), so the
 * Work path envelope does not apply to them; they are constrained by the
 * operation envelope and the authorization rows instead.
 */
const PATH_OPERATIONS: readonly string[] = [
  'read',
  'search',
  'artifact_write',
  'edit',
  'write',
  'bash',
  'git',
  'delete_data',
];

/**
 * Whether a target stays inside the Work's authorized paths.
 *
 * A *total operation* rule: a target is authorized when it sits inside any
 * recommended read or write path. Directory prefixes (`a/b/`) cover descendants;
 * `a/b` does not cover `a/bc`.
 */
export function targetWithinWorkScope(
  target: string,
  operation: string,
  work: GrantWorkScope,
): boolean {
  if (!PATH_OPERATIONS.includes(operation)) return true;
  const authorized = [...work.readPaths, ...work.writePaths];
  return authorized.some((granted) => targetCovers(granted, target));
}

/** Whether one operation is inside the Work's declared operation envelope. */
export function operationWithinWorkScope(operation: string, work: GrantWorkScope): boolean {
  return work.operations.includes(operation);
}
