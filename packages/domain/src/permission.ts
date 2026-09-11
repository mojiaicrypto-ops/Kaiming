/**
 * Grant admission (`docs/architecture/data.md` §2 grant, `reliability.md` §2).
 *
 * A tool call is admitted only when every documented binding matches
 * ("全匹配后才准入"): scope target, role, stage, operation, expiry, and — for a
 * `once` grant — the exact tool operation and input hash. The same operation with
 * the same hash replays the original result instead of consuming twice; the same
 * operation with a different hash is refused.
 */
import type { Grant, Role } from '@agentdev/contracts';

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

export type GrantDecision =
  | { readonly allowed: true; readonly replay: boolean }
  | { readonly allowed: false; readonly reason: string };

const deny = (reason: string): GrantDecision => ({ allowed: false, reason });

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

export function evaluateGrant(grant: Grant, request: GrantRequest): GrantDecision {
  if (grant.consumedAt !== undefined) {
    // Idempotent replay: same operation, same input hash, same run.
    if (
      grant.scope === 'once' &&
      grant.consumedByOperationId === request.toolOperationId &&
      grant.inputHash === request.inputHash
    ) {
      return { allowed: true, replay: true };
    }
    return deny('grant already consumed');
  }
  if (Date.parse(request.at) > Date.parse(grant.expiresAt)) {
    return deny('grant expired');
  }
  if (grant.role !== request.role) return deny(`grant role ${grant.role} != ${request.role}`);
  if (grant.stage !== request.stage) return deny(`grant stage ${grant.stage} != ${request.stage}`);
  if (grant.operation !== request.operation) {
    return deny(`grant operation ${grant.operation} != ${request.operation}`);
  }
  switch (grant.scope) {
    case 'once': {
      if (grant.runId !== request.runId) return deny('once grant belongs to another run');
      if (grant.toolOperationId !== request.toolOperationId) {
        return deny('once grant belongs to another tool operation');
      }
      if (grant.inputHash !== request.inputHash) {
        return deny('once grant input hash mismatch');
      }
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
    if (!isSafeTarget(target)) return deny(`target ${target} is not a repository-relative path`);
    if (!grant.targets.some((granted) => targetCovers(granted, target))) {
      return deny(`target ${target} is outside the grant`);
    }
  }
  return { allowed: true, replay: false };
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
