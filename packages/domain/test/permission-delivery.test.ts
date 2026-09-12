/**
 * WP-07 T1 — Grant admission rules (AC-049, AC-080).
 *
 * `domain/permission.ts` is the single decision point the Core Grant store calls,
 * so these tests pin the rules the store relies on, including the ones a
 * regression would silently relax:
 *
 * - a `once` Grant is bound to the exact tool operation **and** input hash: a
 *   different hash is `IDEMPOTENCY_CONFLICT`, and the reported fields name the
 *   binding that was wrong;
 * - an expired Grant refuses every later use (`AUTH_EXPIRED`), while a `once`
 *   transaction that completed before its expiry keeps replaying;
 * - a `run` Grant is usable only by its own `runId`; a `work` Grant is not;
 * - a malformed target is `VALIDATION_ERROR`, and a target outside the grant is
 *   `NOT_AUTHORIZED`;
 * - issuance refuses an operation outside the Work envelope, a missing scope
 *   binding, a malformed input hash, a target outside the Work's paths, and a
 *   role at a stage it does not operate.
 */
import { describe, expect, it } from 'vitest';
import type { Grant } from '@agentdev/contracts';
import {
  evaluateGrant,
  grantDenialCode,
  grantDenialField,
  isSafeTarget,
  operationWithinWorkScope,
  scopeBindingsSatisfied,
  targetCovers,
  targetWithinWorkScope,
  validateGrantIssueRequest,
  type GrantIssueRequest,
  type GrantWorkScope,
} from '../src/index.js';

const ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const WORK = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e00';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e10';
const RUN_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e11';
const OP = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e20';
const OP_OTHER = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e21';
const HASH = 'a'.repeat(64);
const HASH_OTHER = 'b'.repeat(64);
const AT = '2026-09-11T00:00:00.000Z';
const EXPIRES = '2026-09-11T01:00:00.000Z';

/** A well-formed `once` row; individual tests override one field at a time. */
function onceGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: ID,
    projectId: 'c'.repeat(32),
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    workId: WORK,
    runId: RUN_A,
    toolOperationId: OP,
    scope: 'once',
    role: 'backend',
    stage: 'develop-L2',
    operation: 'edit',
    targets: ['packages/core/src/'],
    expiresAt: EXPIRES,
    limits: {},
    decisionId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e30',
    inputHash: HASH,
    ...overrides,
  };
}

const REQUEST = {
  operation: 'edit',
  role: 'backend',
  stage: 'develop-L2',
  targets: ['packages/core/src/grants.ts'],
  at: AT,
  workId: WORK,
  runId: RUN_A,
  toolOperationId: OP,
  inputHash: HASH,
} as const;

describe('grant admission (AC-049, AC-080)', () => {
  it('admits the exact once binding and reports no replay for a first use', () => {
    const decision = evaluateGrant(onceGrant(), REQUEST);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error('unreachable');
    expect(decision.replay).toBe(false);
  });

  it('replays a consumed once grant for the same operation and input (AC-080)', () => {
    const decision = evaluateGrant(
      onceGrant({ consumedAt: AT, consumedByOperationId: OP }),
      REQUEST,
    );
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error('unreachable');
    expect(decision.replay).toBe(true);
  });

  it('binds a replay to the full operation/role/stage triple, not just the run (W7R1-06)', () => {
    const consumed = onceGrant({ consumedAt: AT, consumedByOperationId: OP });
    // Before the fix the replay branch matched on run/tool-operation/input alone,
    // so each of these answered `{allowed: true, replay: true}` for a Grant that
    // never authorized it. A consumed transaction now answers only its own
    // binding, and every other use is the documented "already consumed" conflict.
    for (const request of [
      { ...REQUEST, operation: 'secret' },
      { ...REQUEST, role: 'review' as const },
      { ...REQUEST, stage: 'review' },
    ]) {
      const decision = evaluateGrant(consumed, request);
      expect(decision.allowed, `${request.operation}/${request.role}/${request.stage}`).toBe(false);
      if (decision.allowed) throw new Error('unreachable');
      expect(grantDenialCode(decision.reason)).toBe('IDEMPOTENCY_CONFLICT');
    }
    // The exact binding still replays.
    const exact = evaluateGrant(consumed, REQUEST);
    expect(exact.allowed).toBe(true);
  });

  it('refuses a different input hash with IDEMPOTENCY_CONFLICT and names the field (AC-080)', () => {
    const decision = evaluateGrant(onceGrant({ consumedAt: AT, consumedByOperationId: OP }), {
      ...REQUEST,
      inputHash: HASH_OTHER,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(grantDenialCode(decision.reason)).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      grantDenialField(decision.reason, onceGrant({ consumedAt: AT }), {
        ...REQUEST,
        inputHash: HASH_OTHER,
      }),
    ).toBe('inputHash');
  });

  it('refuses a different tool operation on a consumed grant with IDEMPOTENCY_CONFLICT (AC-080)', () => {
    const decision = evaluateGrant(onceGrant({ consumedAt: AT, consumedByOperationId: OP }), {
      ...REQUEST,
      toolOperationId: OP_OTHER,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(grantDenialCode(decision.reason)).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      grantDenialField(decision.reason, onceGrant({ consumedAt: AT }), {
        ...REQUEST,
        toolOperationId: OP_OTHER,
      }),
    ).toBe('toolOperationId');
  });

  it('refuses a different operation on a live grant without consuming anything (AC-049)', () => {
    const decision = evaluateGrant(onceGrant(), { ...REQUEST, operation: 'push' });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(grantDenialCode(decision.reason)).toBe('NOT_AUTHORIZED');
    expect(decision.reason).toContain('operation');
  });

  it('refuses the wrong role or stage with NOT_AUTHORIZED (AC-049)', () => {
    const role = evaluateGrant(onceGrant(), { ...REQUEST, role: 'test' });
    expect(role.allowed).toBe(false);
    if (role.allowed) throw new Error('unreachable');
    expect(grantDenialCode(role.reason)).toBe('NOT_AUTHORIZED');

    const stage = evaluateGrant(onceGrant(), { ...REQUEST, stage: 'review' });
    expect(stage.allowed).toBe(false);
    if (stage.allowed) throw new Error('unreachable');
    expect(grantDenialCode(stage.reason)).toBe('NOT_AUTHORIZED');
  });

  it('isolates sibling runs on a run-scoped grant and keeps work-scoped grants shared (AC-080)', () => {
    const runGrant = onceGrant({ scope: 'run', toolOperationId: undefined, inputHash: undefined });
    const sibling = evaluateGrant(runGrant, { ...REQUEST, runId: RUN_B });
    expect(sibling.allowed).toBe(false);
    if (sibling.allowed) throw new Error('unreachable');
    expect(grantDenialCode(sibling.reason)).toBe('NOT_AUTHORIZED');
    expect(
      grantDenialField(sibling.reason, onceGrant({ consumedAt: AT }), {
        ...REQUEST,
        runId: RUN_B,
      }),
    ).toBe('runId');
    expect(evaluateGrant(runGrant, REQUEST).allowed).toBe(true);

    const workGrant = onceGrant({
      scope: 'work',
      runId: undefined,
      toolOperationId: undefined,
      inputHash: undefined,
    });
    for (const runId of [RUN_A, RUN_B]) {
      expect(evaluateGrant(workGrant, { ...REQUEST, runId }).allowed).toBe(true);
    }
  });

  it('refuses every later use of an expired or revoked grant (AC-049)', () => {
    const expired = evaluateGrant(onceGrant(), {
      ...REQUEST,
      at: '2026-09-11T02:00:00.000Z',
    });
    expect(expired.allowed).toBe(false);
    if (expired.allowed) throw new Error('unreachable');
    expect(grantDenialCode(expired.reason)).toBe('AUTH_EXPIRED');

    // Revocation closes the row with `consumedAt` and no consuming operation, so
    // a later use can never replay a stale result.
    const revoked = evaluateGrant(
      onceGrant({ consumedAt: AT, expiresAt: new Date(0).toISOString() }),
      { ...REQUEST, at: '2026-09-11T00:00:01.000Z' },
    );
    expect(revoked.allowed).toBe(false);
    if (revoked.allowed) throw new Error('unreachable');
    expect(grantDenialCode(revoked.reason)).toBe('AUTH_EXPIRED');

    // An unconsumed grant past its time refuses with AUTH_EXPIRED, the documented
    // expiry outcome.
    const expiredUnconsumed = evaluateGrant(onceGrant({ expiresAt: new Date(0).toISOString() }), {
      ...REQUEST,
      at: '2026-09-11T00:00:01.000Z',
    });
    expect(expiredUnconsumed.allowed).toBe(false);
    if (expiredUnconsumed.allowed) throw new Error('unreachable');
    expect(grantDenialCode(expiredUnconsumed.reason)).toBe('AUTH_EXPIRED');
  });

  it('keeps replaying a completed once transaction after its expiry (AC-080)', () => {
    const replay = evaluateGrant(onceGrant({ consumedAt: AT, consumedByOperationId: OP }), {
      ...REQUEST,
      at: '2026-09-11T02:00:00.000Z',
    });
    expect(replay.allowed).toBe(true);
    if (!replay.allowed) throw new Error('unreachable');
    expect(replay.replay).toBe(true);
  });

  it('refuses a sibling run reaching for a consumed once grant (AC-080)', () => {
    const sibling = evaluateGrant(onceGrant({ consumedAt: AT, consumedByOperationId: OP }), {
      ...REQUEST,
      runId: RUN_B,
    });
    expect(sibling.allowed).toBe(false);
    if (sibling.allowed) throw new Error('unreachable');
    expect(grantDenialCode(sibling.reason)).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      grantDenialField(sibling.reason, onceGrant({ consumedAt: AT }), {
        ...REQUEST,
        runId: RUN_B,
      }),
    ).toBe('runId');
  });

  it('refuses a malformed target and an out-of-grant target with the documented codes', () => {
    const unsafe = evaluateGrant(onceGrant(), { ...REQUEST, targets: ['../etc/passwd'] });
    expect(unsafe.allowed).toBe(false);
    if (unsafe.allowed) throw new Error('unreachable');
    expect(grantDenialCode(unsafe.reason)).toBe('VALIDATION_ERROR');

    const outside = evaluateGrant(onceGrant(), {
      ...REQUEST,
      targets: ['packages/storage/src/store.ts'],
    });
    expect(outside.allowed).toBe(false);
    if (outside.allowed) throw new Error('unreachable');
    expect(grantDenialCode(outside.reason)).toBe('NOT_AUTHORIZED');
  });

  it('keeps the target rules the rest of the codebase relies on', () => {
    expect(targetCovers('packages/core/src/', 'packages/core/src/grants.ts')).toBe(true);
    expect(targetCovers('packages/core/src', 'packages/core/src/grants.ts')).toBe(false);
    expect(targetCovers('packages/core/src/', 'packages/core/srcX/grants.ts')).toBe(false);
    expect(isSafeTarget('packages/core/src/grants.ts')).toBe(true);
    expect(isSafeTarget('/etc/passwd')).toBe(false);
    expect(isSafeTarget('..\\windows')).toBe(false);
    expect(isSafeTarget('a/../b')).toBe(false);
  });

  it('derives scope bindings from the request identity fields', () => {
    expect(
      scopeBindingsSatisfied('once', { runId: RUN_A, toolOperationId: OP, inputHash: HASH }),
    ).toBe(true);
    expect(scopeBindingsSatisfied('once', { runId: RUN_A, toolOperationId: OP })).toBe(false);
    expect(scopeBindingsSatisfied('run', { runId: RUN_A })).toBe(true);
    expect(scopeBindingsSatisfied('run', {})).toBe(false);
    expect(scopeBindingsSatisfied('work', { workId: WORK })).toBe(true);
    expect(scopeBindingsSatisfied('work', {})).toBe(false);
    expect(scopeBindingsSatisfied('project', {})).toBe(true);
  });

  describe('issuance validation (AC-049)', () => {
    // `repoPathSchema` forbids a trailing `/`, so the Work's path envelope lists
    // the exact files it authorizes.
    const WORK_SCOPE: GrantWorkScope = {
      workId: WORK,
      operations: ['read', 'edit'],
      readPaths: ['packages/core/src/grants.ts'],
      writePaths: ['packages/core/src/grants.ts'],
    };

    /**
     * A partial request minus the three optional binding fields, which a test may
     * also remove entirely (`exactOptionalPropertyTypes` forbids the inline form).
     */
    type IssueOverrides = Omit<
      Partial<GrantIssueRequest>,
      'runId' | 'toolOperationId' | 'inputHash'
    >;

    /** Overrides that may also *remove* one of the three optional bindings. */
    type BoundIssueOverrides = IssueOverrides & {
      readonly runId?: string | undefined;
      readonly toolOperationId?: string | undefined;
      readonly inputHash?: string | undefined;
    };

    function baseRequest(overrides: BoundIssueOverrides = {}): GrantIssueRequest {
      const input: GrantIssueRequest = {
        workId: WORK,
        role: 'backend',
        stage: 'develop-L2',
        scope: 'once',
        operation: 'edit',
        targets: ['packages/core/src/grants.ts'],
        runId: RUN_A,
        toolOperationId: OP,
        inputHash: HASH,
        expiresAt: EXPIRES,
        roleStages: ['develop-L1', 'develop-L2', 'develop-L3'],
      };
      for (const key of Object.keys(overrides) as (keyof BoundIssueOverrides)[]) {
        const value = overrides[key];
        if (value === undefined) {
          if (key === 'runId' || key === 'toolOperationId' || key === 'inputHash') {
            delete input[key];
          }
          continue;
        }
        Object.assign(input, { [key]: value });
      }
      return input;
    }

    function issueRequest(overrides: BoundIssueOverrides = {}): GrantIssueRequest {
      return baseRequest(overrides);
    }

    /** Removes the once binding: the "missing binding" negative case. */
    function withoutBinding(request: GrantIssueRequest): Record<string, unknown> {
      const output: Record<string, unknown> = { ...request };
      delete output['toolOperationId'];
      delete output['inputHash'];
      return output;
    }

    it('accepts an in-scope request', () => {
      expect(validateGrantIssueRequest(issueRequest(), WORK_SCOPE)).toEqual({ ok: true });
    });

    it('refuses an operation outside the Work envelope', () => {
      const refused = validateGrantIssueRequest(issueRequest({ operation: 'push' }), WORK_SCOPE);
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('unreachable');
      expect(refused.code).toBe('NOT_AUTHORIZED');
      expect(refused.reason).toContain('push');
      expect(operationWithinWorkScope('push', WORK_SCOPE)).toBe(false);
    });

    it('refuses a foreign work id and a role at a stage it does not operate', () => {
      const foreign = validateGrantIssueRequest(
        issueRequest({ workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e99' }),
        WORK_SCOPE,
      );
      expect(foreign.ok).toBe(false);
      if (foreign.ok) throw new Error('unreachable');
      expect(foreign.code).toBe('NOT_AUTHORIZED');

      const stage = validateGrantIssueRequest(issueRequest({ stage: 'review' }), WORK_SCOPE);
      expect(stage.ok).toBe(false);
      if (stage.ok) throw new Error('unreachable');
      expect(stage.code).toBe('MISSING_CONTEXT');
    });

    it('refuses a missing once binding and a malformed input hash with VALIDATION_ERROR', () => {
      const missing = validateGrantIssueRequest(
        withoutBinding(baseRequest()) as unknown as GrantIssueRequest,
        WORK_SCOPE,
      );
      expect(missing.ok).toBe(false);
      if (missing.ok) throw new Error('unreachable');
      expect(missing.code).toBe('VALIDATION_ERROR');

      const malformed = validateGrantIssueRequest(
        issueRequest({ inputHash: 'not-a-hash' }),
        WORK_SCOPE,
      );
      expect(malformed.ok).toBe(false);
      if (malformed.ok) throw new Error('unreachable');
      expect(malformed.code).toBe('VALIDATION_ERROR');
    });

    it('refuses a target outside the Work paths and a malformed target', () => {
      const outside = validateGrantIssueRequest(
        issueRequest({ targets: ['packages/storage/src/store.ts'] }),
        WORK_SCOPE,
      );
      expect(outside.ok).toBe(false);
      if (outside.ok) throw new Error('unreachable');
      expect(grantDenialCode(outside.reason)).toBe('NOT_AUTHORIZED');

      const malformed = validateGrantIssueRequest(
        issueRequest({ targets: ['/etc/passwd'] }),
        WORK_SCOPE,
      );
      expect(malformed.ok).toBe(false);
      if (malformed.ok) throw new Error('unreachable');
      expect(malformed.code).toBe('VALIDATION_ERROR');
    });

    it('does not apply the path envelope to non-path operations', () => {
      const networkWork: GrantWorkScope = { ...WORK_SCOPE, operations: ['network'] };
      expect(
        validateGrantIssueRequest(
          issueRequest({ operation: 'network', targets: ['api.example.com'] }),
          networkWork,
        ),
      ).toEqual({ ok: true });
      expect(targetWithinWorkScope('api.example.com', 'network', networkWork)).toBe(true);
      expect(targetWithinWorkScope('packages/storage/src/store.ts', 'edit', networkWork)).toBe(
        false,
      );
    });
  });
});
