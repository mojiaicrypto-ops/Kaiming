/**
 * Attempt capabilities (WP-11 A2-T6).
 *
 * `docs/architecture/execution.md` §2 fixes the design:
 *
 * > Gateway在Core受信侧持有Provider Secret，Runner只持有短期attempt capability；工具容器与
 * > Runner控制连接分离。… Capability绑定attempt/epoch/role/allowed methods/expiry；
 * > Broker重新校验，Runner不能声明自己是Chief。
 *
 * So the Runner never sees a Provider secret. It presents a capability to the Core's
 * model gateway, which resolves the Run's *frozen* configuration and calls the Provider
 * with the real secret. This store is deliberately in-memory: capabilities are short
 * lived, the daemon is the only process that issues or checks them, and a restart
 * re-issues rather than trusting a token minted by a dead process (the durable authority
 * remains the `attempt`/`run` rows plus `ownerEpoch` fencing).
 */
import { randomBytes } from 'node:crypto';

import type { Role } from '@agentdev/contracts';

/** One issued capability; the token itself is the only secret. */
export interface AttemptCapability {
  readonly token: string;
  readonly attemptId: string;
  readonly runId: string;
  /** 1-based Attempt epoch (`attempt.ownerEpoch + 1`). */
  readonly epoch: number;
  readonly role: Role;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type CapabilityVerdict =
  | { readonly ok: true; readonly capability: AttemptCapability }
  | {
      readonly ok: false;
      readonly code: 'NOT_AUTHORIZED' | 'AUTH_EXPIRED';
      readonly message: string;
    };

export interface IssueCapabilityInput {
  readonly attemptId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly role: Role;
  /**
   * Defaults to one hour: long enough for a slow reasoning call, short enough that a
   * forgotten token dies on its own. The Attempt's own state is re-checked on every call,
   * so the TTL is the backstop rather than the primary gate (WP11R1-17).
   */
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/** How long a capability stays valid; long enough for a slow reasoning call. */
export const CAPABILITY_TTL_MS = 3_600_000;

export class AttemptCapabilityStore {
  private readonly byToken = new Map<string, AttemptCapability>();
  private readonly byAttempt = new Map<string, string>();
  private readonly now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Issues one capability for an Attempt and returns it (the only time the token is visible). */
  issue(input: IssueCapabilityInput): AttemptCapability {
    const at = (input.now ?? this.now)();
    const capability: AttemptCapability = {
      token: randomBytes(32).toString('base64url'),
      attemptId: input.attemptId,
      runId: input.runId,
      epoch: input.epoch,
      role: input.role,
      issuedAt: new Date(at).toISOString(),
      expiresAt: new Date(at + (input.ttlMs ?? CAPABILITY_TTL_MS)).toISOString(),
    };
    // One capability per Attempt: re-issuing replaces the previous token so a revoked
    // Attempt cannot keep calling with an older one.
    const previous = this.byAttempt.get(input.attemptId);
    if (previous !== undefined) this.byToken.delete(previous);
    this.byToken.set(capability.token, capability);
    this.byAttempt.set(input.attemptId, capability.token);
    return capability;
  }

  /** Checks a presented token; an expired capability is dropped on the spot. */
  verify(token: string | undefined): CapabilityVerdict {
    if (token === undefined || token.length === 0) {
      return { ok: false, code: 'NOT_AUTHORIZED', message: 'a capability is required' };
    }
    const capability = this.byToken.get(token);
    if (capability === undefined) {
      return { ok: false, code: 'NOT_AUTHORIZED', message: 'the capability is not valid' };
    }
    if (Date.parse(capability.expiresAt) <= this.now()) {
      this.revoke(capability.attemptId);
      return { ok: false, code: 'AUTH_EXPIRED', message: 'the capability has expired' };
    }
    return { ok: true, capability };
  }

  /** Revokes one Attempt's capability; returns `true` when something was removed. */
  revoke(attemptId: string): boolean {
    const token = this.byAttempt.get(attemptId);
    if (token === undefined) return false;
    this.byAttempt.delete(attemptId);
    return this.byToken.delete(token);
  }

  /** Revokes every capability of a Run (cancellation, recovery, terminal state). */
  revokeRun(runId: string): number {
    let removed = 0;
    for (const capability of [...this.byToken.values()]) {
      if (capability.runId !== runId) continue;
      if (this.revoke(capability.attemptId)) removed += 1;
    }
    return removed;
  }

  /** Capability of one Attempt, if it is still held. */
  find(attemptId: string): AttemptCapability | undefined {
    const token = this.byAttempt.get(attemptId);
    return token === undefined ? undefined : this.byToken.get(token);
  }

  get size(): number {
    return this.byToken.size;
  }
}
