/**
 * The Grant lifecycle: issue, query, consume (`once`) and revoke.
 *
 * `docs/architecture/data.md` §2 fixes the row and `reliability.md` §2 fixes the
 * transaction: "once Grant的消费与prepared在同一事务保存consumedByOperationId/
 * inputHash；同操作同Hash重取原结果，不重复消费，同操作不同Hash拒绝". This module
 * therefore never decides admission on its own — it loads the persisted Grant and
 * asks `domain/evaluateGrant` — and it never mints a Grant outside the Work's own
 * envelope, which `domain/validateGrantIssueRequest` checks first.
 *
 * Behaviour that matters for AC-049/AC-080:
 *
 * - **Minting** refuses a missing/foreign Work, an operation outside the Work
 *   scope, a target outside the Work's authorized paths, a Run that belongs to
 *   another Work, or a role the Work has not dispatched.
 * - **`once`** is bound to `(runId, toolOperationId, inputHash)` *and* the exact
 *   operation. The first consume executes and stores the result under the tool
 *   operation's `resultRef`; every later consume with the same input returns that
 *   stored result without calling the executor again; a different tool operation,
 *   input hash or run is refused with `IDEMPOTENCY_CONFLICT` and consumes nothing.
 * - **Sibling isolation**: a `run`/`once` Grant carries exactly one `runId`, so a
 *   second Run of the same role in the same Work is refused with
 *   `NOT_AUTHORIZED`; `work`/`project` Grants stay usable by both, and they are
 *   not consumed by a call — every tool operation is instead replay-safe by its
 *   own recorded `inputHash`.
 * - **Expiry/revocation** is evaluated at use time. `revoke` moves `expiresAt`
 *   into the past (`domain/revocationTime`) so a later use refuses, while a `once`
 *   transaction that completed before the revocation keeps replaying its result
 *   for the same input.
 * - **Queries** (`findGrantFor`, `checkCoverage`, `currentRunGrants`,
 *   `currentWorkGrants`, `grantHistory`, `grantForToolOperation`) are read-only
 *   projections: they run the same admission rules and return Grant rows, and a
 *   refusal never carries a secret value.
 */
import type { Grant, GrantScope, JsonObject, Role, ToolOperation } from '@agentdev/contracts';
import {
  evaluateGrant,
  grantDenialCode,
  grantDenialField,
  revocationTime,
  validateGrantIssueRequest,
  type GrantDenialCode,
  type GrantIssueRefusal,
  type GrantRequest,
  type GrantWorkScope,
} from '@agentdev/domain';
import {
  uuidv7,
  withTransaction,
  type EntityRepository,
  type ProjectStore,
  type SqliteDatabase,
} from '@agentdev/storage';
import { ROLE_STAGES } from './context/acl.js';
import { ProtocolError } from './errors.js';

/** Event names this module appends; one per lifecycle transition. */
export const GRANT_EVENTS = {
  issued: 'grant.issued',
  consumed: 'grant.consumed',
  revoked: 'grant.revoked',
} as const;

/** The JSON envelope a Grant carries (`data.md` §2 `limits`). */
export type GrantLimits = Readonly<Record<string, unknown>>;

/** A deferred result store: `resultRef` → the opaque tool result. */
export interface DeferredResultStore {
  /** Stores a result and returns the reference recorded on the tool operation. */
  put(value: unknown): string;
  /** Reads a stored result; `undefined` when the reference is unknown. */
  get(ref: string): unknown;
}

/** What one `once` consumption is asked to do. */
export interface GrantConsumeRequest {
  readonly workId: string;
  readonly role: Role;
  readonly stage: string;
  /** The exact tool operation the Grant is bound to. */
  readonly operation: string;
  readonly targets: readonly string[];
  readonly at: string;
  readonly runId: string;
  readonly toolName: string;
  /** The exact tool-operation id; required, because replay is keyed on it. */
  readonly toolOperationId: string;
  readonly inputHash: string;
  /** Raw-args reference recorded on the `tool_operation` row (`data.md` §2). */
  readonly argsRef: string;
  readonly attemptId: string;
  readonly epoch: number;
  /** Runs the real tool; called at most once per Grant. */
  readonly executor: () => unknown;
}

export interface GrantConsumeOptions {
  /** Persistent sink for the tool result. Defaults to an in-memory store. */
  readonly results?: DeferredResultStore;
}

export type GrantConsumeOutcome =
  | {
      readonly outcome: 'executed';
      readonly grant: Grant;
      readonly toolOperation: ToolOperation;
      readonly result: unknown;
    }
  | {
      readonly outcome: 'replayed';
      readonly grant: Grant;
      readonly toolOperation: ToolOperation;
      readonly resultRef: string;
      readonly result: unknown;
    }
  | {
      readonly outcome: 'refused';
      /** A contracts error code (`WP-07` reports it verbatim). */
      readonly code: GrantDenialCode | 'INVALID_STATE' | 'RECOVERY_REQUIRED';
      readonly reason: string;
      readonly fields: readonly string[];
    };

export type GrantIssueOutcome =
  | { readonly ok: true; readonly grant: Grant }
  | (GrantIssueRefusal & { readonly fields: readonly string[] });

/** A read-only coverage question; it runs the same rules as consumption. */
export interface GrantQuery {
  readonly workId: string;
  readonly operation: string;
  readonly role: Role;
  readonly stage: string;
  readonly targets: readonly string[];
  readonly at: string;
  readonly runId?: string;
  readonly toolOperationId?: string;
  readonly inputHash?: string;
}

export interface GrantStoreOptions {
  readonly store: ProjectStore;
  /** Injectable clock, contracts `Time` form. */
  readonly now?: () => string;
}

/**
 * What `issue` accepts: the identity/scope half of a `GrantRequest` plus the
 * row-only fields.
 *
 * `at` is intentionally absent: minting has no use-time, so there is nothing for
 * a caller to fake by choosing a favourable clock.
 */
export interface GrantIssueInput extends Omit<GrantRequest, 'at'> {
  readonly scope: GrantScope;
  readonly decisionId: string;
  readonly expiresAt: string;
  readonly limits?: GrantLimits;
}

/**
 * In-memory deferred-result store.
 *
 * The default is deliberately explicit rather than silent: the reference and the
 * value live in the same process, and a `once` Grant consumed by one result store
 * cannot be replayed by another that never saw the execution. The daemon wires a
 * blob-backed store; the behaviour under test (execute once, replay the stored
 * value, never re-execute) is identical.
 *
 * References are UUIDv7-form ids because `tool_operation.resultRef` is an entity
 * reference in the contract: a free-form string would fail the row schema, and the
 * column is what a recovery pass would follow.
 */
export class InMemoryDeferredResultStore implements DeferredResultStore {
  private readonly values = new Map<string, unknown>();

  put(value: unknown): string {
    const ref = uuidv7();
    this.values.set(ref, value);
    return ref;
  }

  get(ref: string): unknown {
    return this.values.get(ref);
  }
}

export class GrantStore {
  private readonly store: ProjectStore;
  private readonly grants: EntityRepository<Grant>;
  private readonly toolOperations: EntityRepository<ToolOperation>;
  private readonly db: SqliteDatabase;
  private readonly now: () => string;
  private readonly results: DeferredResultStore;

  constructor(options: GrantStoreOptions & GrantConsumeOptions) {
    this.store = options.store;
    this.grants = options.store.grants;
    this.toolOperations = options.store.toolOperations;
    this.db = options.store.db;
    this.now = options.now ?? (() => options.store.now());
    this.results = options.results ?? new InMemoryDeferredResultStore();
  }

  // -------------------------------------------------------------------------
  // Issue
  // -------------------------------------------------------------------------

  /**
   * Mints a Grant for one Work after validating the whole request envelope.
   *
   * The Work check, the `decision` foreign key, the Run binding, the scope check
   * and the insert share one transaction, so a refused request writes nothing —
   * not even an audit event.
   */
  issue(input: GrantIssueInput): GrantIssueOutcome {
    return withTransaction(this.db, () => this.issueInTransaction(input));
  }

  private issueInTransaction(input: GrantIssueInput): GrantIssueOutcome {
    const workId = input.workId ?? '';
    const work = this.store.works.find(workId);
    if (work === undefined) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: `Work ${workId === '' ? '<missing>' : workId} does not exist; no Grant can be issued`,
        fields: [],
      };
    }
    if (work.status !== 'running') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        reason: `Work ${work.id} is ${work.status}; only a running Work may mint a Grant`,
        fields: [],
      };
    }
    // `grant.decision_id` is a real foreign key, so a Grant without its
    // authorizing Decision would fail the insert instead of failing closed.
    if (this.store.decisions.find(input.decisionId) === undefined) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: `Decision ${input.decisionId} does not exist; a Grant must cite its authorization`,
        fields: [],
      };
    }
    const run = input.runId === undefined ? undefined : this.store.runs.find(input.runId);
    if (input.runId !== undefined && run === undefined) {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: `Run ${input.runId} does not exist`,
        fields: ['runId'],
      };
    }
    if (run !== undefined && run.workId !== work.id) {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: `Run ${run.id} belongs to Work ${run.workId}, not ${work.id}`,
        fields: ['runId'],
      };
    }
    // A Grant is minted for a role the Work actually uses. The Task rows are the
    // record of that: a role the Work never dispatched has nothing to authorize.
    const roleStages = this.roleStages(work.id, input.role);
    if (roleStages.length === 0) {
      return {
        ok: false,
        code: 'MISSING_CONTEXT',
        reason: `Work ${work.id} has no Task for role ${input.role}; the role was never dispatched`,
        fields: [],
      };
    }
    const validation = validateGrantIssueRequest(
      {
        workId: work.id,
        role: input.role,
        stage: input.stage,
        scope: input.scope,
        operation: input.operation,
        targets: input.targets,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.toolOperationId === undefined ? {} : { toolOperationId: input.toolOperationId }),
        ...(input.inputHash === undefined ? {} : { inputHash: input.inputHash }),
        expiresAt: input.expiresAt,
        roleStages,
      },
      this.workScope(work.id, work.scope),
    );
    if (!validation.ok) {
      return { ok: false, code: validation.code, reason: validation.reason, fields: [] };
    }
    const row = this.grants.insert({
      workId: work.id,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      ...(input.toolOperationId === undefined ? {} : { toolOperationId: input.toolOperationId }),
      scope: input.scope,
      role: input.role,
      stage: input.stage,
      operation: input.operation,
      targets: [...input.targets],
      expiresAt: input.expiresAt,
      limits: (input.limits ?? {}) as JsonObject,
      decisionId: input.decisionId,
      ...(input.inputHash === undefined ? {} : { inputHash: input.inputHash }),
    });
    this.store.events.append({
      name: GRANT_EVENTS.issued,
      entityId: row.id,
      entityVersion: row.version,
      data: {
        workId: row.workId ?? '',
        runId: row.runId ?? '',
        scope: row.scope,
        role: row.role,
        stage: row.stage,
        operation: row.operation,
        expiresAt: row.expiresAt,
      },
    });
    return { ok: true, grant: row };
  }

  /**
   * The Work's authorized envelope.
   *
   * Authorization rows widen the Work's own scope with the paths the user
   * explicitly authorized; a revoked authorization contributes nothing. Only
   * paths are unioned — the operation envelope stays the Work's own declaration.
   */
  private workScope(workId: string, declared: DeclaredWorkScope): GrantWorkScope {
    const read = [...declared.readPaths];
    const write = [...declared.writePaths];
    for (const authorization of this.store.authorizations.list({
      where: 'work_id = ?',
      params: [workId],
    })) {
      if (authorization.revokedAt !== undefined) continue;
      read.push(...authorization.scope.readPaths);
      write.push(...authorization.scope.writePaths);
    }
    return {
      workId,
      operations: declared.operations,
      readPaths: dedupe(read),
      writePaths: dedupe(write),
    };
  }

  /**
   * The stages this role may act at for this Work.
   *
   * The role's authorized stages come from the domain Context ACL
   * (`context/acl.ts` `ROLE_STAGES`): `review` may only act at `review`, `test`
   * only at `test`, and so on. The Work must also have dispatched that role.
   */
  private roleStages(workId: string, role: Role): readonly string[] {
    const dispatched = this.store.tasks
      .list({ where: 'work_id = ?', params: [workId] })
      .some((task) => task.role === role);
    return dispatched ? ROLE_STAGES[role] : [];
  }

  // -------------------------------------------------------------------------
  // Queries (read-only)
  // -------------------------------------------------------------------------

  /** Active (`consumedAt` unset) Grants minted for one Run, oldest first. */
  currentRunGrants(runId: string): readonly Grant[] {
    return this.grants.list({
      where: 'run_id = ? AND consumed_at IS NULL',
      params: [runId],
      orderBy: 'created_at ASC',
    });
  }

  /** Active (`consumedAt` unset) Grants minted for one Work, oldest first. */
  currentWorkGrants(workId: string): readonly Grant[] {
    return this.grants.list({
      where: 'work_id = ? AND consumed_at IS NULL',
      params: [workId],
      orderBy: 'created_at ASC',
    });
  }

  /** Every Grant row for one Work, oldest first, including closed ones (audit). */
  grantHistory(workId: string): readonly Grant[] {
    return this.grants.list({
      where: 'work_id = ?',
      params: [workId],
      orderBy: 'created_at ASC',
    });
  }

  /** The tool operation a Grant was consumed by, when it has one. */
  grantForToolOperation(toolOperationId: string): ToolOperation | undefined {
    return this.toolOperations.find(toolOperationId);
  }

  /**
   * The first Grant that admits `query`, or `undefined`.
   *
   * This runs the same rules as consumption, so "covered" can never be wider than
   * "admitted" — a consumed `once` Grant is included, because it still replays its
   * recorded result. The call performs no write and returns the Grant row only.
   */
  findGrantFor(query: GrantQuery): Grant | undefined {
    return this.matchingGrants(query)[0];
  }

  /** Whether some live Grant admits `query`. */
  checkCoverage(query: GrantQuery): boolean {
    return this.findGrantFor(query) !== undefined;
  }

  private matchingGrants(query: GrantQuery): Grant[] {
    return this.grants
      .list({
        where: 'work_id = ?',
        params: [query.workId],
        orderBy: 'created_at ASC',
      })
      .filter((grant) => evaluateGrant(grant, this.asGrantRequest(query)).allowed);
  }

  private asGrantRequest(query: GrantQuery | GrantConsumeRequest): GrantRequest {
    return {
      operation: query.operation,
      role: query.role,
      stage: query.stage,
      targets: query.targets,
      at: query.at,
      workId: query.workId,
      ...(query.runId === undefined ? {} : { runId: query.runId }),
      ...(query.toolOperationId === undefined ? {} : { toolOperationId: query.toolOperationId }),
      ...(query.inputHash === undefined ? {} : { inputHash: query.inputHash }),
    };
  }

  // -------------------------------------------------------------------------
  // Consume (once)
  // -------------------------------------------------------------------------

  /**
   * Runs one authorized tool call, or replays the result it already recorded.
   *
   * Inside a single transaction the method selects the Grant that admits the
   * request, re-reads it through `domain/evaluateGrant`, and then either:
   *
   * - replays the recorded result (a consumed `once` Grant, or a tool operation
   *   that already finished) without calling `executor` again; or
   * - writes the `prepared` tool-operation row, claims a `once` Grant with the
   *   guarded `UPDATE ... WHERE consumed_at IS NULL AND run_id = ? AND
   *   tool_operation_id = ? AND input_hash = ?`, calls `executor`, and marks the
   *   operation `finished` with the result reference.
   *
   * A refusal returns before the claim, so it consumes nothing. A `run`/`work`/
   * `project` Grant is not consumed at all: it stays usable for further calls by
   * its own run or by both runs (`AC-080` sibling isolation), while each tool
   * operation is still replay-safe by its recorded `inputHash`.
   */
  consumeOnce(
    request: GrantConsumeRequest,
    options: GrantConsumeOptions = {},
  ): GrantConsumeOutcome {
    const results = options.results ?? this.results;
    return withTransaction(this.db, () => this.consumeInTransaction(request, results));
  }

  private consumeInTransaction(
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): GrantConsumeOutcome {
    const grant = this.boundGrant(request);
    if (grant === undefined) {
      return refuse('NOT_AUTHORIZED', 'no Grant admits this tool call', []);
    }
    const decision = evaluateGrant(grant, this.asGrantRequest(request));
    if (!decision.allowed) {
      const field = grantDenialField(decision.reason, grant, this.asGrantRequest(request));
      return refuse(
        grantDenialCode(decision.reason),
        decision.reason,
        field === undefined ? [] : [field],
      );
    }
    if (decision.replay) return this.replay(grant, results);
    if (grant.scope === 'once') return this.executeOnce(grant, request, results);
    // `run`/`work`/`project` Grants stay usable more than once (AC-080: "work/
    // project-scoped Grants remain usable by both [Runs]"), so they are never
    // marked consumed. `evaluateGrant` already validated the binding; the tool
    // operation row below is the per-invocation record and the replay key.
    return this.executeReusable(grant, request, results);
  }

  /**
   * Executes one `once` Grant and claims it atomically.
   *
   * The binding check, the guarded claim
   * (`UPDATE ... WHERE consumed_at IS NULL AND ...`), the `prepared`→`finished`
   * tool-operation row and the audit event commit together, so a retry can never
   * run the tool twice. The claim's row count is what survives a second connection
   * racing on the same row.
   */
  private executeOnce(
    grant: Grant,
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): GrantConsumeOutcome {
    const record = this.prepareOperation(grant, request, results);
    if (record !== undefined) return record;
    const operationId = request.toolOperationId;
    const now = this.now();
    // The claim binds exactly the columns the Grant was issued with: a `once`
    // Grant carries both its `runId` and its tool operation, so both are compared;
    // binding a NULL column would make the comparison never true and the claim
    // always lose.
    const bindings: unknown[] = [now, operationId, request.inputHash, now, grant.id];
    const guards = ['id = ?', 'consumed_at IS NULL'];
    if (grant.runId !== undefined) {
      guards.push('run_id = ?');
      bindings.push(request.runId);
    }
    if (grant.toolOperationId !== undefined) {
      guards.push('tool_operation_id = ?');
      bindings.push(operationId);
      guards.push('input_hash = ?');
      bindings.push(request.inputHash);
    }
    const claimed = this.db
      .prepare(
        `UPDATE grant SET consumed_at = ?, consumed_by_operation_id = ?, input_hash = ?,
           version = version + 1, updated_at = ?
         WHERE ${guards.join(' AND ')}`,
      )
      .run(...(bindings as never[]));
    if (claimed.changes !== 1) {
      // Another connection claimed the Grant between the read and the update. The
      // tool has not run here yet, so the honest answer is a conflict and the
      // transaction rolls the prepared row back.
      return refuse('IDEMPOTENCY_CONFLICT', `Grant ${grant.id} was consumed concurrently`, [
        'toolOperationId',
      ]);
    }
    const consumed = this.grants.get(grant.id);
    return this.finishOperation(consumed, request, results);
  }

  /**
   * Executes a reusable (`run`/`work`/`project`) Grant.
   *
   * The Grant itself is not consumed; the tool operation row is, so a retry of the
   * same operation is answered from the recorded result while a *different*
   * operation, input or run reuses the Grant legitimately.
   */
  private executeReusable(
    grant: Grant,
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): GrantConsumeOutcome {
    const record = this.prepareOperation(grant, request, results);
    if (record !== undefined) return record;
    return this.finishOperation(grant, request, results);
  }

  /**
   * Resolves a tool operation that already exists, or writes the `prepared` row.
   *
   * Returns an outcome when the recorded state decides the call; `undefined` when
   * the caller still has to run the tool.
   */
  private prepareOperation(
    grant: Grant,
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): GrantConsumeOutcome | undefined {
    const operationId = request.toolOperationId;
    const existing = this.toolOperations.find(operationId);
    if (existing === undefined) {
      // A plain `prepared` row: `reliability.md` §2 keeps consumption and the
      // prepared state in the same transaction, so this row and the claim (if any)
      // become visible together.
      this.toolOperations.insert({
        id: operationId,
        workId: request.workId,
        runId: request.runId,
        attemptId: request.attemptId,
        epoch: request.epoch,
        toolName: request.toolName,
        inputHash: request.inputHash,
        argsRef: request.argsRef,
        state: 'prepared',
        grantId: grant.id,
      });
      return undefined;
    }
    if (existing.inputHash !== request.inputHash) {
      // `data.md` §2: a repeated operation id with a different input hash is
      // refused, never replayed.
      return refuse(
        'IDEMPOTENCY_CONFLICT',
        `tool operation ${operationId} was recorded with a different input hash`,
        ['inputHash'],
      );
    }
    if (existing.state === 'finished' && existing.resultRef !== undefined) {
      return this.replayOperation(grant, existing, results);
    }
    if (existing.state === 'unknown') {
      // `reliability.md` §2: an operation whose outcome is unknown is never
      // replayed; the caller reconciles it.
      return refuse(
        'RECOVERY_REQUIRED',
        `tool operation ${operationId} has an unknown outcome and must be reconciled`,
        [],
      );
    }
    if (grant.scope === 'once') {
      return refuse(
        'RECOVERY_REQUIRED',
        `tool operation ${operationId} is ${existing.state}; its outcome is unknown and must be reconciled`,
        [],
      );
    }
    // A reusable Grant may still re-run an operation that is only recorded as
    // `prepared`: the previous attempt never produced a result. Remove the stale
    // row so the caller can execute and record a finished one.
    this.toolOperations.handle.prepare('DELETE FROM tool_operation WHERE id = ?').run(operationId);
    return undefined;
  }

  /** Records the executed result and marks the tool operation finished. */
  private finishOperation(
    grant: Grant,
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): GrantConsumeOutcome {
    const operationId = request.toolOperationId;
    const executed = request.executor();
    const resultRef = results.put(executed);
    const now = this.now();
    const prepared = this.toolOperations.get(operationId);
    const finished = this.toolOperations.update(
      operationId,
      { state: 'finished', startedAt: now, finishedAt: now, resultRef },
      prepared.version,
    );
    if (grant.scope === 'once') {
      const consumed = this.grants.get(grant.id);
      this.store.events.append({
        name: GRANT_EVENTS.consumed,
        entityId: consumed.id,
        entityVersion: consumed.version,
        data: {
          toolOperationId: operationId,
          runId: request.runId,
          operation: request.operation,
          inputHash: request.inputHash,
          resultRef,
        },
      });
      return { outcome: 'executed', grant: consumed, toolOperation: finished, result: executed };
    }
    return { outcome: 'executed', grant, toolOperation: finished, result: executed };
  }

  /**
   * The Grant a request is bound to, chosen as narrowly as the data allows.
   *
   * Selection is a deterministic ranking, not an equality test, because more than
   * one Grant may exist for the same `(operation, role, stage)`:
   *
   * 1. an exact `(toolOperationId, runId)` match — the contract binding
   *    (`data.md` §2 "once必须toolOperationId+runId+inputHash");
   * 2. otherwise a Grant for the same run; then one shared by the whole Work or
   *    Project (`work`/`project` carry no run binding, so both Runs may use them —
   *    `AC-080` sibling isolation).
   *
   * A Grant bound to a *different* run is still a candidate, because the caller
   * must then be refused with the precise reason (`NOT_AUTHORIZED` naming `runId`)
   * rather than a generic "no Grant". Candidates are ordered by `created_at`, so a
   * request can never be silently matched to the wrong sibling's result.
   */
  private boundGrant(request: GrantConsumeRequest): Grant | undefined {
    const candidates = this.grants
      .list({ where: 'work_id = ?', params: [request.workId], orderBy: 'created_at ASC' })
      .filter(
        (grant) =>
          grant.operation === request.operation &&
          grant.role === request.role &&
          grant.stage === request.stage,
      );
    const exact = candidates.find(
      (grant) => grant.toolOperationId === request.toolOperationId && grant.runId === request.runId,
    );
    if (exact !== undefined) return exact;
    // No Grant is bound to this exact tool operation. The best remaining candidate
    // is one this run may legitimately use — or, failing that, a consumed Grant
    // that `evaluateGrant` will refuse with the precise reason instead of a generic
    // "no Grant admits this call".
    return (
      candidates.find(
        (grant) =>
          grant.runId === request.runId &&
          (grant.toolOperationId === undefined ||
            grant.toolOperationId === request.toolOperationId),
      ) ??
      candidates.find(
        (grant) =>
          grant.scope === 'work' &&
          (grant.toolOperationId === undefined ||
            grant.toolOperationId === request.toolOperationId),
      ) ??
      candidates.find((grant) => grant.scope === 'project') ??
      candidates.find((grant) => grant.toolOperationId === request.toolOperationId) ??
      candidates[0]
    );
  }

  private replay(grant: Grant, results: DeferredResultStore): GrantConsumeOutcome {
    const operationId = grant.consumedByOperationId;
    const stored = operationId === undefined ? undefined : this.toolOperations.find(operationId);
    if (stored === undefined) {
      throw new ProtocolError(
        'RECOVERY_REQUIRED',
        `Grant ${grant.id} records consumption by ${operationId ?? '<unknown>'}, whose tool operation is missing`,
        { details: { grantId: grant.id } },
      );
    }
    return this.replayOperation(grant, stored, results);
  }

  private replayOperation(
    grant: Grant,
    operation: ToolOperation,
    results: DeferredResultStore,
  ): GrantConsumeOutcome {
    if (operation.resultRef === undefined) {
      throw new ProtocolError(
        'RECOVERY_REQUIRED',
        `tool operation ${operation.id} has no recorded result; the original outcome cannot be replayed`,
        { details: { toolOperationId: operation.id, grantId: grant.id } },
      );
    }
    const result = results.get(operation.resultRef);
    if (result === undefined) {
      // The row records a result the store can no longer resolve. Returning
      // `undefined` would present a missing value as the original result, so the
      // honest answer is a recovery state (`reliability.md` §2).
      throw new ProtocolError(
        'RECOVERY_REQUIRED',
        `tool operation ${operation.id} references result ${operation.resultRef}, which the result store cannot resolve`,
        { details: { toolOperationId: operation.id, resultRef: operation.resultRef } },
      );
    }
    return {
      outcome: 'replayed',
      grant,
      toolOperation: operation,
      resultRef: operation.resultRef,
      result,
    };
  }

  // -------------------------------------------------------------------------
  // Revoke
  // -------------------------------------------------------------------------

  /**
   * Revokes a live Grant.
   *
   * `expiresAt` moves to the epoch (`domain/revocationTime`), which refuses every
   * later use, and `consumedAt` records the revocation so the row is visibly
   * closed. The revocation deliberately leaves `consumedByOperationId` unset: a
   * `once` Grant that already completed has that field, so it keeps replaying its
   * recorded result while a revoked Grant can never produce one.
   */
  revoke(input: {
    readonly grantId: string;
    readonly at: string;
    readonly reason: string;
  }):
    { readonly ok: true; readonly grant: Grant } | { readonly ok: false; readonly reason: string } {
    return withTransaction(this.db, () => {
      const grant = this.grants.find(input.grantId);
      if (grant === undefined) {
        return { ok: false as const, reason: `Grant ${input.grantId} does not exist` };
      }
      if (grant.consumedAt !== undefined) {
        return { ok: false as const, reason: `Grant ${grant.id} is already closed` };
      }
      const revoked = this.grants.update(
        grant.id,
        { consumedAt: input.at, expiresAt: revocationTime() },
        grant.version,
      );
      this.store.events.append({
        name: GRANT_EVENTS.revoked,
        entityId: revoked.id,
        entityVersion: revoked.version,
        data: { reason: input.reason, at: input.at },
      });
      return { ok: true as const, grant: revoked };
    });
  }
}

/** Structural view of `work.scope`; the contract `Scope` satisfies it. */
interface DeclaredWorkScope {
  readonly operations: readonly string[];
  readonly readPaths: readonly string[];
  readonly writePaths: readonly string[];
}

function refuse(
  code: GrantDenialCode | 'INVALID_STATE' | 'RECOVERY_REQUIRED',
  reason: string,
  fields: readonly string[],
): GrantConsumeOutcome {
  return { outcome: 'refused', code, reason, fields };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
