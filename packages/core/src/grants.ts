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
import { canonicalJson } from '@agentdev/contracts';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
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
  type GrantUsage,
  type GrantWorkScope,
} from '@agentdev/domain';
import {
  sha256,
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
  /**
   * Whether a result is recorded for this reference.
   *
   * `get` alone cannot answer this: a legitimate tool result may itself be `null`
   * or `undefined`, and treating that as "missing" refused to replay a recorded
   * result with `RECOVERY_REQUIRED` (W7R2-09). The presence question is therefore
   * separate from the value question.
   */
  has(ref: string): boolean;
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
  /**
   * Encoded byte size of this call's input, checked against the Grant's `maxBytes`.
   *
   * Optional so a caller that has no measured size (a library-level replay probe) is
   * admitted rather than refused for an absent measurement; the Broker always supplies
   * it, because it already canonicalises the input to compute the hash.
   */
  readonly inputBytes?: number;
  /**
   * The deadline this call asks for, in seconds, checked against `maxDurationSec`.
   *
   * The Broker supplies the effective tool deadline (its own `timeoutMs`, or the
   * documented `LIMITS.shellTimeoutSec.default`), so a Grant that authorized a shorter
   * operation cannot be used to run a longer one.
   */
  readonly durationSec?: number;
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

/**
 * The synchronous admission half of a consumption.
 *
 * `outcome` means the call is already decided (a replay or a refusal); `run` means
 * the Grant has been claimed and the `prepared` row written, and the caller must
 * now execute the tool and finish the operation.
 */
type PreparedConsume =
  | { readonly kind: 'outcome'; readonly outcome: GrantConsumeOutcome }
  | { readonly kind: 'run'; readonly grant: Grant; readonly once: boolean };

/**
 * Whether a value is thenable.
 *
 * The synchronous consumption path refuses a thenable executor rather than
 * recording the `Promise` as the tool result (W7R3-02); the asynchronous path
 * awaits it.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  return typeof (value as { then?: unknown }).then === 'function';
}

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
 * The value lives in the same process, and a `once` Grant consumed by one result
 * store cannot be replayed by another that never saw the execution — which is why
 * it is **not** the default for a store-backed `GrantStore` (W7R1-10): a second
 * process would report `RECOVERY_REQUIRED` for a result it cannot resolve. Use it
 * for a single-process lifetime, or to prove the missing-result path in a test.
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

  has(ref: string): boolean {
    return this.values.has(ref);
  }
}

/** Blob subdirectory the durable result store keeps its values in. */
export const DEFERRED_RESULT_BLOB_DIR = 'deferred-results';

/**
 * One file per recorded result: `<ref>.json` under this directory.
 *
 * There is deliberately **no shared index**: a manifest rewritten by every writer
 * was not multi-writer safe (W7R2-04) and made the GC reachable from the blob
 * sweep (W7R2-10). An independent file per result makes `put` a single atomic
 * write, so a stale in-process cache cannot hide another writer's entry and two
 * concurrent writers cannot lose each other's rows.
 */
export const DEFERRED_RESULT_REFS_DIR = `${DEFERRED_RESULT_BLOB_DIR}/refs`;

/**
 * The pre-W7R2 manifest.
 *
 * Still read (never written) so a result recorded by the old layout keeps
 * resolving after an upgrade; {@link ProjectStoreDeferredResultStore.referencedPaths}
 * keeps its blobs alive through an offline GC.
 */
export const DEFERRED_RESULT_MANIFEST = `${DEFERRED_RESULT_BLOB_DIR}/index.json`;

/** What one per-reference result file records. */
interface StoredResultRecord {
  readonly present: true;
  readonly value?: unknown;
  /** `true` when the tool result was literally `undefined`. */
  readonly undefined?: true;
}

/**
 * The durable deferred-result store: the sink `GrantStore` uses by default.
 *
 * The review's cross-process probe (W7R1-10) showed an in-memory sink could only
 * prove "executed once": every other process answered `RECOVERY_REQUIRED` because
 * it had never seen the value. This store is durable and shared through the
 * project state directory instead.
 *
 * Layout (W7R2-04/09/10):
 *
 * - each result is one file `deferred-results/refs/<ref>.json`, written through a
 *   temporary file and an atomic rename — no read-modify-write and no cache, so
 *   any writer's result is immediately resolvable by every process sharing the
 *   directory and concurrent writers cannot lose entries;
 * - the file itself is the presence marker, so a recorded `null` (or `undefined`)
 *   result is replayed rather than reported as missing;
 * - the files live outside `blobs/`, which is the only tree
 *   `BlobStore.collectGarbage` sweeps, so an offline GC can no longer delete a
 *   live deferred result;
 * - `resultRef` stays a UUIDv7 because `tool_operation.resultRef` is an entity
 *   reference in the contract.
 */
export class ProjectStoreDeferredResultStore implements DeferredResultStore {
  private readonly blobs: ProjectStore['blobs'];

  constructor(options: { readonly store: ProjectStore }) {
    this.blobs = options.store.blobs;
  }

  put(value: unknown): string {
    const ref = uuidv7();
    const record: StoredResultRecord =
      value === undefined ? { present: true, undefined: true } : { present: true, value };
    const target = this.blobs.resolve(this.refPath(ref));
    mkdirSync(dirname(target), { recursive: true });
    // A unique temporary name: two writers of the *same* reference still cannot
    // corrupt each other's file, and the rename is atomic on one filesystem.
    const temporary = `${target}.tmp-${String(process.pid)}-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
    writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, target);
    return ref;
  }

  get(ref: string): unknown {
    const record = this.readRecord(ref);
    if (record === undefined) return undefined;
    return record.undefined === true ? undefined : record.value;
  }

  has(ref: string): boolean {
    // A file that cannot be parsed is not a resolvable result, so presence is the
    // same question as "is there a value we can return"; replay then reports
    // `RECOVERY_REQUIRED` instead of inventing one.
    return this.readRecord(ref) !== undefined;
  }

  /**
   * Every stored path that an offline GC must treat as a root (W7R2-10).
   *
   * The per-reference files are already outside `blobs/`; the legacy manifest and
   * the content-addressed blobs it points at are listed too, so an upgrade cannot
   * make the GC delete results recorded by the previous layout.
   */
  referencedPaths(): string[] {
    const paths: string[] = [DEFERRED_RESULT_MANIFEST];
    const refsDir = this.blobs.resolve(DEFERRED_RESULT_REFS_DIR);
    if (existsSync(refsDir)) {
      for (const name of readdirSync(refsDir)) {
        paths.push(`${DEFERRED_RESULT_REFS_DIR}/${name}`);
      }
    }
    for (const relativePath of Object.values(this.readManifest())) {
      paths.push(relativePath);
    }
    return paths;
  }

  private refPath(ref: string): string {
    return `${DEFERRED_RESULT_REFS_DIR}/${ref}.json`;
  }

  private readRecord(ref: string): StoredResultRecord | undefined {
    const target = this.blobs.resolve(this.refPath(ref));
    if (existsSync(target)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // The explicit `present` marker is what distinguishes a stored `null`
          // from a missing record (W7R2-09).
          if ((parsed as { present?: unknown }).present === true) {
            return parsed as StoredResultRecord;
          }
        }
      } catch {
        // A corrupt record is not a result: `has` reports the reference as
        // unresolvable (so replay surfaces `RECOVERY_REQUIRED`) rather than
        // fabricating a value from a half-written file.
      }
    }
    const legacy = this.legacyBlobPath(ref);
    if (legacy === undefined) return undefined;
    try {
      return { present: true, value: JSON.parse(this.blobs.read(legacy).toString('utf8')) };
    } catch {
      return undefined;
    }
  }

  private legacyBlobPath(ref: string): string | undefined {
    const relativePath = this.readManifest()[ref];
    if (relativePath === undefined || !this.blobs.has(relativePath)) return undefined;
    return relativePath;
  }

  /**
   * Reads the legacy manifest from disk every time.
   *
   * There is intentionally no in-process cache: caching it made a second store in
   * the same data directory blind to every entry written after its first `put`
   * (W7R2-04).
   */
  private readManifest(): Record<string, string> {
    if (!this.blobs.has(DEFERRED_RESULT_MANIFEST)) return {};
    try {
      const parsed: unknown = JSON.parse(
        this.blobs.read(DEFERRED_RESULT_MANIFEST).toString('utf8'),
      );
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      const entries: Record<string, string> = {};
      for (const [key, stored] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof stored === 'string') entries[key] = stored;
      }
      return entries;
    } catch {
      // A corrupt manifest is not a result: `get` reports the reference as
      // unresolvable and the caller surfaces `RECOVERY_REQUIRED`, never a value.
      return {};
    }
  }
}

/**
 * The deferred-result records an offline GC must keep (W7R2-10).
 *
 * `data.md` §4 makes `BlobStore.collectGarbage` an offline action over a
 * caller-supplied reference set; before this helper the deferred-result manifest
 * was not part of it and a live result's blob was swept away. Results now live in
 * `deferred-results/` (outside the swept `blobs/` tree), and this function also
 * lists the legacy manifest plus the blobs it references.
 */
export function deferredResultGcRoots(store: ProjectStore): string[] {
  return new ProjectStoreDeferredResultStore({ store }).referencedPaths();
}

/** `BlobStore.collectGarbage` with the deferred-result roots included. */
export function collectProjectGarbage(
  store: ProjectStore,
  referenced: ReadonlySet<string>,
): string[] {
  return store.blobs.collectGarbage(new Set([...referenced, ...deferredResultGcRoots(store)]));
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
    // W7R1-10: the default sink is durable, so a second process replaying the same
    // tool operation resolves the recorded result instead of `RECOVERY_REQUIRED`.
    this.results = options.results ?? new ProjectStoreDeferredResultStore({ store: options.store });
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
    const decision = this.store.decisions.find(input.decisionId);
    if (decision === undefined) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: `Decision ${input.decisionId} does not exist; a Grant must cite its authorization`,
        fields: [],
      };
    }
    // The cited Decision must belong to this Work: another Work's decision is not an
    // authorization for this one, whatever its state (T3 round 4 negative case).
    if (decision.workId !== work.id) {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: `Decision ${decision.id} belongs to Work ${decision.workId}, not ${work.id}`,
        fields: ['decisionId'],
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
    // The stage is the caller's own (the producer emits the canonical `develop-L{level}`;
    // `protocol.ts` `queueApprovedRun`), and an unrecognised spelling fails closed in
    // `roleStages`/`validateGrantIssueRequest` instead of being mapped here.
    const stage = input.stage;
    if (roleStages.length === 0) {
      return {
        ok: false,
        code: 'MISSING_CONTEXT',
        reason: `Work ${work.id} has no Task for role ${input.role}; the role was never dispatched`,
        fields: [],
      };
    }
    const scope = this.workScope(work.id, work.scope);
    // An accepted `permission` Decision is the **user's** authorization for exactly the one
    // operation it was requested for (`permission.request/respond` → Grant, AC-049/AC-080).
    // A message-level authorization may never carry an environment operation
    // (`assertGrantWithinMessage`) and a derived authorization may not either
    // (`assertDerivableScope`), so without this the approval chain could not mint anything.
    //
    // The widening is deliberately minimal, and every clause is a refusal otherwise:
    //  - only `kind='permission'`, `state='accepted'`, `choice='approve'`;
    //  - only a `once` Grant (the user approved one occurrence);
    //  - only an operation that is genuinely outside the Work envelope (a covered
    //    operation keeps using the ordinary path);
    //  - only when the Grant's `(operation, targets, toolOperationId, inputHash)` is exactly
    //    the binding recorded in the Decision's `targetRef.hash`, so an accepted Decision
    //    cannot be re-pointed at another operation, path or input;
    //  - paths and every other envelope dimension stay governed by the Work scope.
    const widening =
      decision.kind === 'permission' &&
      decision.state === 'accepted' &&
      decision.choice === 'approve' &&
      input.scope === 'once' &&
      !scope.operations.includes(input.operation) &&
      decision.targetRef.hash === permissionBindingHash(input)
        ? [input.operation]
        : [];
    const validation = validateGrantIssueRequest(
      {
        workId: work.id,
        role: input.role,
        stage,
        scope: input.scope,
        operation: input.operation,
        targets: input.targets,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.toolOperationId === undefined ? {} : { toolOperationId: input.toolOperationId }),
        ...(input.inputHash === undefined ? {} : { inputHash: input.inputHash }),
        expiresAt: input.expiresAt,
        roleStages,
        // The `limits` envelope is validated here too (`domain/validateGrantLimits`):
        // a malformed ceiling must be refused before the row exists, not silently
        // dropped so that a "narrow" Grant is in fact unbounded.
        limits: input.limits ?? {},
      },
      { ...scope, operations: [...scope.operations, ...widening] },
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
      stage,
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
   * Authorization rows widen the Work's own scope with the paths and **operations**
   * the user explicitly authorized; a revoked authorization contributes nothing.
   * Both halves have to be unioned (D-T3-5): `validateGrantIssueRequest` admits an
   * operation only when it is inside this envelope (`domain/permission.ts`), so a
   * `workScope` that carried only the Work's own `scope.operations` would make a
   * user-approved `bash`/`network`/`secret` Grant impossible to mint — the user could
   * approve an operation the system then refuses to issue.
   */
  private workScope(workId: string, declared: DeclaredWorkScope): GrantWorkScope {
    const read = [...declared.readPaths];
    const write = [...declared.writePaths];
    const operations = [...declared.operations];
    for (const authorization of this.store.authorizations.list({
      where: 'work_id = ?',
      params: [workId],
    })) {
      if (authorization.revokedAt !== undefined) continue;
      read.push(...authorization.scope.readPaths);
      write.push(...authorization.scope.writePaths);
      operations.push(...authorization.operations);
    }
    return {
      workId,
      operations: dedupe(operations),
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
   * The candidate set is pre-filtered by the full binding
   * (operation/role/stage/include work) so a consumed Grant for one operation
   * cannot be reported as covering another (W7R1-06).
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
      .filter(
        (grant) =>
          grant.operation === query.operation &&
          grant.role === query.role &&
          grant.stage === query.stage,
      )
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

  /**
   * The spend a consumption asks of its Grant (`domain/GrantRequest.usage`).
   *
   * `priorCalls` counts the tool operations already recorded against the Grant,
   * excluding this call's own row: a `prepared` row from this same tool operation is
   * this call, not an earlier one, and counting it would make `maxCalls: 1` unusable.
   * The byte and duration halves come from the request, which measured them.
   */
  private usageFor(grant: Grant, request: GrantConsumeRequest): GrantUsage {
    const usage: {
      priorCalls?: number;
      requestedBytes?: number;
      requestedDurationSec?: number;
    } = {};
    usage.priorCalls = this.toolOperations
      .list({ where: 'grant_id = ?', params: [grant.id] })
      .filter((operation) => operation.id !== request.toolOperationId).length;
    if (request.inputBytes !== undefined) usage.requestedBytes = request.inputBytes;
    if (request.durationSec !== undefined) usage.requestedDurationSec = request.durationSec;
    return usage;
  }

  private consumeGrantRequest(grant: Grant, request: GrantConsumeRequest): GrantRequest {
    return { ...this.asGrantRequest(request), usage: this.usageFor(grant, request) };
  }

  // -------------------------------------------------------------------------
  // Consume (once)
  // -------------------------------------------------------------------------

  /**
   * Runs one authorized tool call **synchronously**, or replays the result it
   * already recorded.
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
   *
   * The executor must be **synchronous**: a thenable cannot be awaited here
   * without holding the database write lock across an `await`, and recording the
   * `Promise` itself silently corrupted the result (W7R3-02). Such a body is
   * refused fail-closed and the transaction rolls back; use
   * {@link consumeOnceAsync} for a tool that is genuinely asynchronous.
   */
  consumeOnce(
    request: GrantConsumeRequest,
    options: GrantConsumeOptions = {},
  ): GrantConsumeOutcome {
    const results = options.results ?? this.results;
    return withTransaction(this.db, () => {
      const prepared = this.prepareInTransaction(request, results);
      if (prepared.kind === 'outcome') return prepared.outcome;
      const executed = request.executor();
      if (isThenable(executed)) {
        throw new ProtocolError(
          'INVALID_STATE',
          `the tool body for ${request.operation} returned a Promise; consumeOnceAsync() awaits an asynchronous tool`,
          { details: { toolOperationId: request.toolOperationId } },
        );
      }
      return this.finishOperation(prepared, request, results, executed);
    });
  }

  /**
   * Runs one authorized tool call, awaiting an asynchronous tool body (W7R3-02).
   *
   * The atomic half stays atomic: the `prepared` row and the `once` claim commit
   * together in one transaction, so no second caller can claim the Grant. The tool
   * body then runs **outside** any transaction, and a second transaction records
   * the awaited result and marks the operation `finished`. When the body rejects,
   * a third transaction rolls the claim and the `prepared` row back, so a failed
   * execution consumes nothing, leaves nothing `finished`, and can be retried.
   * The rejection is re-thrown to the caller, which awaits it, so it can never
   * surface as an unhandled rejection.
   */
  async consumeOnceAsync(
    request: GrantConsumeRequest,
    options: GrantConsumeOptions = {},
  ): Promise<GrantConsumeOutcome> {
    const results = options.results ?? this.results;
    const prepared = withTransaction(this.db, () => this.prepareInTransaction(request, results));
    if (prepared.kind === 'outcome') return prepared.outcome;
    let executed: unknown;
    try {
      executed = await request.executor();
    } catch (error) {
      this.rollbackPrepared(prepared, request);
      throw error;
    }
    return withTransaction(this.db, () =>
      this.finishOperation(prepared, request, results, executed),
    );
  }

  /**
   * The synchronous admission half of a consumption.
   *
   * Returns either the final outcome (a replay or a refusal) or the claim the
   * caller must now execute and finish.
   */
  private prepareInTransaction(
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): PreparedConsume {
    const grant = this.boundGrant(request);
    if (grant === undefined) {
      return {
        kind: 'outcome',
        outcome: refuse('NOT_AUTHORIZED', 'no Grant admits this tool call', []),
      };
    }
    const decision = evaluateGrant(grant, this.consumeGrantRequest(grant, request));
    if (!decision.allowed) {
      const field = grantDenialField(
        decision.reason,
        grant,
        this.consumeGrantRequest(grant, request),
      );
      return {
        kind: 'outcome',
        outcome: refuse(
          grantDenialCode(decision.reason),
          decision.reason,
          field === undefined ? [] : [field],
        ),
      };
    }
    if (decision.replay) return { kind: 'outcome', outcome: this.replay(grant, results) };
    if (grant.scope === 'once') return this.prepareOnce(grant, request, results);
    // `run`/`work`/`project` Grants stay usable more than once (AC-080: "work/
    // project-scoped Grants remain usable by both [Runs]"), so they are never
    // marked consumed. `evaluateGrant` already validated the binding; the tool
    // operation row below is the per-invocation record and the replay key.
    return this.prepareReusable(grant, request, results);
  }

  /**
   * Writes the `prepared` row for a `once` Grant and claims it atomically.
   *
   * The binding check and the guarded claim
   * (`UPDATE ... WHERE consumed_at IS NULL AND ...`) commit together, so a retry
   * can never run the tool twice; the claim's row count is what survives a second
   * connection racing on the same row.
   */
  private prepareOnce(
    grant: Grant,
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): PreparedConsume {
    const record = this.prepareOperation(grant, request, results);
    if (record !== undefined) return { kind: 'outcome', outcome: record };
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
      // tool has not run here yet, so the honest answer is a conflict. The
      // `prepared` row written above is still part of this transaction, and the
      // transaction **commits** it: a normal return is not a rollback. That is
      // deliberate — the row records that this attempt claimed nothing, and the
      // Grant's own `consumed_by_operation_id` names the connection that won.
      return {
        kind: 'outcome',
        outcome: refuse('IDEMPOTENCY_CONFLICT', `Grant ${grant.id} was consumed concurrently`, [
          'toolOperationId',
        ]),
      };
    }
    const consumed = this.grants.get(grant.id);
    return { kind: 'run', grant: consumed, once: true };
  }

  /**
   * Writes the `prepared` row for a reusable (`run`/`work`/`project`) Grant.
   *
   * The Grant itself is not consumed; the tool operation row is, so a retry of the
   * same operation is answered from the recorded result while a *different*
   * operation, input or run reuses the Grant legitimately.
   */
  private prepareReusable(
    grant: Grant,
    request: GrantConsumeRequest,
    results: DeferredResultStore,
  ): PreparedConsume {
    const record = this.prepareOperation(grant, request, results);
    if (record !== undefined) return { kind: 'outcome', outcome: record };
    return { kind: 'run', grant, once: false };
  }

  /**
   * Undoes a committed `prepared`/claim pair after the tool body rejected.
   *
   * The claim and the `prepared` row were committed so a concurrent caller could
   * not also execute; rolling both back restores the pre-call state, so a failed
   * execution consumes nothing and a retry can claim the Grant again. The guard on
   * `consumed_by_operation_id` keeps the rollback from clearing a claim another
   * attempt now owns, and the delete only touches a row still `prepared` (never a
   * row another attempt already finished).
   */
  private rollbackPrepared(
    prepared: Extract<PreparedConsume, { kind: 'run' }>,
    request: GrantConsumeRequest,
  ): void {
    withTransaction(this.db, () => {
      if (prepared.once) {
        this.db
          .prepare(
            `UPDATE grant SET consumed_at = NULL, consumed_by_operation_id = NULL,
               version = version + 1, updated_at = ?
             WHERE id = ? AND consumed_by_operation_id = ?`,
          )
          .run(this.now(), prepared.grant.id, request.toolOperationId);
      }
      this.toolOperations.handle
        .prepare("DELETE FROM tool_operation WHERE id = ? AND state = 'prepared'")
        .run(request.toolOperationId);
    });
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
        // The targets are part of the operation's record: a later permission approval mints
        // its Grant from these values instead of guessing (WP-12 T3 轮 2).
        targets: [...request.targets],
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
    if (existing.state === 'prepared' && existing.grantId === undefined) {
      // A `prepared` row with no Grant is **not** an operation in flight: it is the refusal
      // record the permission request wrote so an approval has a binding to read (G8). The
      // user has now approved exactly this operation + input hash, so this retry is the same
      // call being admitted for the first time: attach the approving Grant to the record and
      // let the executor's `finishOperation` update it in place.
      this.toolOperations.update(
        operationId,
        { grantId: grant.id, state: 'prepared' },
        existing.version,
      );
      return undefined;
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

  /**
   * Records an already-executed result and marks the tool operation finished.
   *
   * The value is passed in rather than produced here, so the synchronous and the
   * asynchronous consumption paths share one recording path; the async path has
   * already awaited the body by this point (W7R3-02).
   */
  private finishOperation(
    prepared: Extract<PreparedConsume, { kind: 'run' }>,
    request: GrantConsumeRequest,
    results: DeferredResultStore,
    executed: unknown,
  ): GrantConsumeOutcome {
    const { grant } = prepared;
    const operationId = request.toolOperationId;
    const resultRef = results.put(executed);
    const now = this.now();
    const operation = this.toolOperations.get(operationId);
    const finished = this.toolOperations.update(
      operationId,
      { state: 'finished', startedAt: now, finishedAt: now, resultRef },
      operation.version,
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
    if (!results.has(operation.resultRef)) {
      // The row records a result the store can no longer resolve. Returning
      // `undefined` would present a missing value as the original result, so the
      // honest answer is a recovery state (`reliability.md` §2). A recorded `null`
      // or `undefined` is *present* and replays normally (W7R2-09).
      throw new ProtocolError(
        'RECOVERY_REQUIRED',
        `tool operation ${operation.id} references result ${operation.resultRef}, which the result store cannot resolve`,
        { details: { toolOperationId: operation.id, resultRef: operation.resultRef } },
      );
    }
    const result = results.get(operation.resultRef);
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

/**
 * The binding a `permission` Decision records for exactly one requested operation.
 *
 * `ToolGrantService.requestPermission` stores this digest in `decision.targetRef.hash`; a
 * mint that cites that Decision must reproduce it byte for byte, which is what stops an
 * accepted approval from being re-pointed at another operation, target list or input hash.
 */
export function permissionBindingHash(input: {
  readonly operation: string;
  readonly targets: readonly string[];
  readonly toolOperationId?: string;
  readonly inputHash?: string;
}): string {
  return sha256(
    canonicalJson({
      operation: input.operation,
      targets: [...input.targets],
      toolOperationId: input.toolOperationId,
      inputHash: input.inputHash,
    }),
  );
}
