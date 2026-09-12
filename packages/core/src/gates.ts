/**
 * Gate persistence and Plan approval (`rules/workflow.md` §2/§4, AC-009/013/014).
 *
 * The domain owns every *decision* (`@agentdev/domain` `delivery.ts`): whether a
 * Plan may be auto-approved, whether a code write is admitted, whether the level
 * must rise. This module owns the durable half — the frozen Plan reference, who
 * approved it and on what basis, and the explicit staleness marker that makes an
 * older Plan unusable after an upgrade.
 *
 * ## Where the evidence lives
 *
 * A Plan is persisted exactly like every other artifact: an `artifact` row of
 * `kind=plan` whose `content_hash` is the Plan's identity, with the bytes in the
 * content-addressed `BlobStore` so the stored Plan can be re-read and verified
 * (`data.md` §4). The approval record is a `snapshot` row of
 * `type=verification` — a frozen, content-addressed payload, which is what
 * `data.md` §2 says a snapshot is for — carrying the approver, the basis
 * (authorization ref + write scope + revision) and the Plan ref.
 *
 * Both tables are immutable (`schema.ts` `UPDATE_BLOCKED_TABLES`), so neither the
 * artifact row nor the snapshot can be narrowed or "un-approved" later. Staleness
 * is therefore *additive*: `upgradeLevel` appends a `plan_stale` marker, and a
 * write is refused when the newest marker for a revision names the Plan under
 * request. A gate refusal writes nothing at all, which is what lets the caller
 * compare the measured source hash before and after and see it unchanged
 * (AC-013).
 */
import {
  planSchema,
  type Authorization,
  type JsonObject,
  type Level,
  type Plan,
  type PlanTask,
  type Ref,
  type Requirement,
  type Scope,
  type Snapshot,
  type Work,
} from '@agentdev/contracts';
import {
  evaluateLevelUpgrade,
  evaluatePlanApproval,
  evaluateWriteGate,
  isWithinScope,
  workWriteBarrier,
  type ChangeDiff,
  type PlanApprovalEvidence,
  type PlanRevision,
} from '@agentdev/domain';
import { BlobStore, sha256, withTransaction, type ProjectStore } from '@agentdev/storage';
import { ArtifactService } from './artifacts.js';
import { canonicalJson } from './dispatcher.js';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';

/** The snapshot type the approval/staleness records are frozen under. */
export const PLAN_GATE_SNAPSHOT_TYPE = 'verification';

/** Payload schema version of the frozen gate record. */
export const PLAN_GATE_RECORD_VERSION = 1;

/** The Plan content a caller submits for approval (`data.md` §3 `Plan`). */
export interface PlanDraft {
  readonly goal: string;
  readonly scope: Scope;
  readonly tasks: readonly PlanTask[];
  readonly interfaceChanges?: readonly string[];
  readonly dataChanges?: readonly string[];
  readonly risks?: readonly string[];
  readonly rollback?: readonly string[];
  /** The Product version this Plan implements, when the route has one. */
  readonly productRef?: Ref;
}

export interface PlanApprovalRequest {
  /**
   * The user-sourced authority the Plan rests on.
   *
   * Core re-reads the `authorization` row rather than trusting the text, so a Plan
   * cannot name an authorization that does not exist, is revoked, or belongs to
   * another Work (`data.md` §2).
   */
  readonly authorizationRef: string;
  /** The Planning Run that produced the Plan; it is the artifact's producer. */
  readonly runId: string;
  /** `true` when the Plan selects product behaviour the definition does not have. */
  readonly productChanged: boolean;
  /** Tokens the Plan needs, checked against the Work budget when present. */
  readonly requestedTokens?: number;
  readonly at: string;
}

export interface SubmitPlanInput {
  readonly workId: string;
  /** The Work revision the Plan was written against. */
  readonly revision: string;
  readonly plan: PlanDraft;
  readonly approval: PlanApprovalRequest;
  /** The Requirement to associate; defaults to `work.requirementId`. */
  readonly requirementId?: string;
  /**
   * The measurement port used to freeze the source the Plan was approved against.
   *
   * The recorded hash is what `requestCodeWrite` compares the live source with, so
   * "the source moved after the Plan was approved" is a real measurement instead
   * of a comparison of one value with itself (W6R1-07).
   */
  readonly sourceHashPort?: SourceHashPort;
}

export interface ApprovedPlanRecord {
  readonly planRef: Ref;
  readonly revision: string;
  readonly workId: string;
  readonly approval: PlanApprovalEvidence;
  /** The immutable approval snapshot this record was read from. */
  readonly approvalRecordHash: string;
  /** The source hash measured when the Plan was approved (see `SubmitPlanInput`). */
  readonly sourceHash: string;
}

export type PlanStatus = 'missing' | 'approved' | 'stale';

export interface CurrentPlanApproval {
  readonly workId: string;
  /** The Work revision the lookup was made for. */
  readonly revision: string;
  readonly status: PlanStatus;
  readonly current?: ApprovedPlanRecord;
  /** Present when `status='stale'`: the Plan the caller still holds. */
  readonly stalePlanRef?: Ref;
}

export type PlanApprovalFailureCode =
  'VALIDATION_ERROR' | 'NOT_AUTHORIZED' | 'MISSING_CONTEXT' | 'BUDGET_EXCEEDED' | 'GATE_NOT_READY';

export type SubmitPlanResult =
  | {
      readonly approved: true;
      readonly planRef: Ref;
      readonly planArtifactId: string;
      readonly evidence: PlanApprovalEvidence;
      readonly approvalRecordHash: string;
      readonly revision: string;
    }
  | {
      readonly approved: false;
      readonly code: PlanApprovalFailureCode;
      readonly message: string;
      /** `true` when only the user may decide (a product choice), not a retry. */
      readonly decisionRequired: boolean;
      readonly gaps: readonly string[];
    };

/**
 * The measured source hash port.
 *
 * AC-013 requires the caller to show that a refused write changed no source. The
 * port is what "the source" means operationally: content (a Git tree hash) plus
 * the persistent rows a write would have touched. The gate calls it before and
 * after every decision, so the equality is a measurement, not a claim.
 */
export interface SourceHashPort {
  measure(workId: string): string;
  /**
   * The content half of the measurement, when the port can separate it.
   *
   * `measure` deliberately folds in the rows a gate can write, so a refusal is
   * provably side-effect free. An admitted write appends its own audit event, and
   * this is the half that must still be identical across it.
   */
  contentHash?(workId: string): string;
}

export interface SourceSnapshot {
  /** The measured source content hash (a Git tree OID or equivalent). */
  readonly sourceHash: string;
  /** Row counts of the tables a gate writes, in a stable order. */
  readonly storeCounts: Readonly<Record<string, number>>;
  /** One deterministic digest over both halves. */
  readonly digest: string;
}

/** Tables a gate can write; the proof covers exactly these. */
const GATE_TABLES = ['artifact', 'snapshot', 'requirement', 'work', 'decision', 'event'] as const;

/**
 * A `SourceHashPort` over a real store: the caller's measured content hash plus
 * the row counts of everything a gate may write.
 *
 * Comparing `digest` before and after a refusal is then a real statement — "this
 * call wrote no row and appended no event" — rather than a restatement of the
 * input. A caller with a real Git worktree supplies the content hash itself.
 */
export class StoreSourceHashPort implements SourceHashPort {
  private readonly store: ProjectStore;
  private readonly measureContentHash: (workId: string) => string;

  constructor(options: {
    readonly store: ProjectStore;
    readonly contentHash?: (workId: string) => string;
  }) {
    this.store = options.store;
    this.measureContentHash =
      options.contentHash ??
      ((workId) => {
        const work = this.store.works.find(workId);
        return work?.baseRevision ?? 'unversioned';
      });
  }

  measure(workId: string): string {
    return this.snapshot(workId).digest;
  }

  /**
   * The measured *content* source hash alone.
   *
   * `measure` also folds in the rows a gate may write, which is what makes a
   * refusal provably side-effect free. After an *admitted* write the audit event
   * legitimately changes the row counts, so `requestCodeWrite` reports this half
   * for `sourceHash`/`sourceHashAfter` and leaves the counts to `measure`.
   */
  contentHashOf(workId: string): string {
    return this.snapshot(workId).sourceHash;
  }

  /** `SourceHashPort.contentHash` conformance. */
  contentHash(workId: string): string {
    return this.contentHashOf(workId);
  }

  /** The full measurement, so a caller can assert on its parts. */
  snapshot(workId: string): SourceSnapshot {
    const storeCounts: Record<string, number> = {};
    for (const table of GATE_TABLES) {
      const row = this.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      };
      storeCounts[table] = row.n;
    }
    const sourceHash = this.measureContentHash(workId);
    return {
      sourceHash,
      storeCounts,
      digest: sha256(canonicalJson({ sourceHash, storeCounts })),
    };
  }
}

export interface RequestCodeWriteInput {
  readonly workId: string;
  /** The Work revision the caller wants to write against. */
  readonly revision: string;
  /** Paths the write will touch; each must sit inside the approved Plan's scope. */
  readonly targets?: readonly string[];
  /** The Plan the caller is holding; a mismatching one is a stale Plan. */
  readonly planRef?: Ref;
  /** Measurement port; defaults to a `StoreSourceHashPort` over the store. */
  readonly sourceHashPort?: SourceHashPort;
  /**
   * The source hash the caller measured *before* asking for admission (W6R1-07).
   *
   * The gate compares it with the hash it measures now, so a source that moved
   * between the caller's measurement and the admission is refused. Without one,
   * the approval record's own `sourceHash` is the expectation.
   */
  readonly expectedSourceHash?: string;
}

export type CodeWriteRefusalCode =
  | 'GATE_NOT_READY'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'STALE_ARTIFACT'
  | 'NOT_AUTHORIZED'
  /** The Work is paused/cancelling/cancelled: the pause barrier admits no write (W6R2-07). */
  | 'INVALID_STATE';

export type RequestCodeWriteResult =
  | {
      readonly allowed: true;
      readonly sourceHash: string;
      /** Measured after the admission; equal to `sourceHash`. */
      readonly sourceHashAfter: string;
      readonly planRef: Ref;
      readonly evidenceRefs: readonly string[];
      readonly workLevel: Level;
    }
  | {
      readonly allowed: false;
      readonly code: CodeWriteRefusalCode;
      readonly message: string;
      readonly gaps: readonly string[];
      readonly sourceHash: string;
      /** Must equal `sourceHash`: a refusal changes no source (AC-013). */
      readonly sourceHashAfter: string;
      /** `true` when the Plan the caller held is no longer current. */
      readonly stalePlan: boolean;
      /** The Plan that *is* current, when one exists. */
      readonly currentPlanRef?: Ref;
    };

export type UpgradeLevelCode =
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'GATE_NOT_READY' | 'STALE_ARTIFACT' | 'MISSING_CONTEXT';

/**
 * Which outcome `upgradeLevel` reached (W6R1-06).
 *
 * `noop` means the recorded level already covers the diff and *nothing* moved;
 * `downgrade_refused` means the new classification is below the recorded level, so
 * the level stays and the current Plan is still valid; `refused` is a precondition
 * failure before the domain was consulted. Only `upgraded` may mark an old Plan
 * stale or invalidate its artifact.
 */
export type UpgradeLevelOutcome = 'upgraded' | 'noop' | 'downgrade_refused' | 'refused';

export type UpgradeLevelResult =
  | {
      readonly upgraded: true;
      readonly outcome: 'upgraded';
      readonly previousLevel: Level;
      readonly level: Level;
      readonly requirementId?: string;
      readonly stalePlanRefs: readonly string[];
      readonly currentPlanRef: Ref;
      readonly reasons: readonly string[];
    }
  | {
      readonly upgraded: false;
      readonly outcome: Exclude<UpgradeLevelOutcome, 'upgraded'>;
      readonly code: UpgradeLevelCode;
      readonly message: string;
      readonly level: Level;
      readonly reasons: readonly string[];
    };

export interface UpgradeLevelInput {
  readonly workId: string;
  /** The real diff measured after development started. */
  readonly diff: ChangeDiff;
  /** An executed inspection found a behaviour change the size did not show. */
  readonly logicChange: boolean;
  readonly riskFlags?: readonly string[];
  /** The replacement Plan, already approved for the raised level. */
  readonly newPlanRef: Ref;
  /** The Requirement to associate; defaults to `work.requirementId`. */
  readonly requirementId?: string;
}

/** One frozen gate record (`snapshot.payload`), discriminated by `status`. */
interface PlanGateBase {
  readonly schemaVersion: number;
  readonly workId: string;
  readonly revision: string;
}

interface PlanApprovalRecord extends PlanGateBase {
  readonly status: 'approved';
  readonly planRef: Ref;
  readonly planHash: string;
  readonly approval: PlanApprovalEvidence;
  /**
   * The Product version in force when the Plan was approved.
   *
   * `workflow.md` §6 makes a `now` product choice invalidate the affected
   * evidence, so a Plan approved against an older Product cannot gate a write
   * once the Product moves on.
   */
  readonly productVersion: number;
  /**
   * The measured source content hash at approval time (W6R1-07).
   *
   * Recorded so the write gate compares the live tree against the tree the Plan
   * was approved for, instead of comparing one measurement with itself.
   */
  readonly sourceHash: string;
}

interface PlanStaleRecord extends PlanGateBase {
  readonly status: 'plan_stale';
  readonly stalePlanRef: Ref;
  readonly reason: string;
}

type PlanGateRecord = PlanApprovalRecord | PlanStaleRecord;

/** A Product/Plan version declaration, as `DecisionService` freezes it. */
interface VersionDeclaration {
  readonly kind: 'product_plan_version';
  readonly workId: string;
  readonly productVersion: number;
  readonly planVersion: number;
}

/**
 * Reads the Product/Plan version declarations out of the `context` snapshots.
 *
 * The declarations belong to the Decision layer (`decisions.ts` writes them), and
 * the Plan gate reads them to know which Product a Plan was approved against.
 */
function versionDeclarations(store: ProjectStore, workId: string): VersionDeclaration[] {
  const rows = store.db
    .prepare("SELECT payload FROM snapshot WHERE type = 'context' ORDER BY rowid ASC")
    .all() as { payload: string }[];
  const declarations: VersionDeclaration[] = [];
  for (const row of rows) {
    let payload: JsonObject;
    try {
      payload = JSON.parse(row.payload) as JsonObject;
    } catch {
      continue;
    }
    if (
      payload['kind'] === 'product_plan_version' &&
      payload['workId'] === workId &&
      typeof payload['productVersion'] === 'number' &&
      typeof payload['planVersion'] === 'number'
    ) {
      declarations.push({
        kind: 'product_plan_version',
        workId,
        productVersion: payload['productVersion'],
        planVersion: payload['planVersion'],
      });
    }
  }
  return declarations;
}

function fail(code: ProtocolErrorCode, message: string, details?: JsonObject): never {
  throw new ProtocolError(code, message, details === undefined ? {} : { details });
}

/** Narrow a `JsonObject` back into a typed gate record; fail closed on garbage. */
function decodeGateRecord(payload: JsonObject): PlanGateRecord | undefined {
  const status = payload['status'];
  const workId = payload['workId'];
  const revision = payload['revision'];
  if (typeof status !== 'string' || typeof workId !== 'string' || typeof revision !== 'string') {
    return undefined;
  }
  if (status === 'approved') {
    const planRef = payload['planRef'] as Ref | undefined;
    const approval = payload['approval'] as PlanApprovalEvidence | undefined;
    const planHash = payload['planHash'];
    if (planRef === undefined || approval === undefined || typeof planHash !== 'string') {
      return undefined;
    }
    return {
      schemaVersion: PLAN_GATE_RECORD_VERSION,
      status: 'approved',
      workId,
      revision,
      planRef,
      planHash,
      approval,
      productVersion: typeof payload['productVersion'] === 'number' ? payload['productVersion'] : 0,
      // A record written before the field existed has no source hash; `''` keeps it
      // decodable and the write gate then falls back to the caller's measurement.
      sourceHash: typeof payload['sourceHash'] === 'string' ? payload['sourceHash'] : '',
    };
  }
  if (status === 'plan_stale') {
    const stalePlanRef = payload['stalePlanRef'] as Ref | undefined;
    const reason = payload['reason'];
    if (stalePlanRef === undefined || typeof reason !== 'string') return undefined;
    return {
      schemaVersion: PLAN_GATE_RECORD_VERSION,
      status: 'plan_stale',
      workId,
      revision,
      stalePlanRef,
      reason,
    };
  }
  return undefined;
}

/** The canonical single-line JSON of a validated Plan; this is what is hashed. */
export function canonicalPlanJson(plan: Plan): string {
  return canonicalJson(plan);
}

/** Normalises a submitted draft into the documented `Plan` shape. */
export function normalizePlan(draft: PlanDraft, version: number, authorizationRef: string): Plan {
  return {
    version,
    ...(draft.productRef === undefined ? {} : { productRef: draft.productRef }),
    goal: draft.goal,
    scope: draft.scope,
    tasks: draft.tasks.map((task) => ({
      id: task.id,
      role: task.role,
      goal: task.goal,
      paths: [...task.paths],
      dependsOn: [...task.dependsOn],
      acceptanceIds: [...task.acceptanceIds],
      checks: [...task.checks],
    })),
    interfaceChanges: [...(draft.interfaceChanges ?? [])],
    dataChanges: [...(draft.dataChanges ?? [])],
    risks: [...(draft.risks ?? [])],
    rollback: [...(draft.rollback ?? [])],
    approval: 'auto',
    authorizationRef,
  };
}

/** Maps a domain approval failure onto the gate's own refusal vocabulary. */
function asSubmitCode(code: string): PlanApprovalFailureCode {
  switch (code) {
    case 'NOT_AUTHORIZED':
    case 'BUDGET_EXCEEDED':
    case 'MISSING_CONTEXT':
    case 'VALIDATION_ERROR':
    case 'GATE_NOT_READY':
      return code;
    default:
      return 'GATE_NOT_READY';
  }
}

/**
 * Persists Plan approvals and answers the write gate for one Project.
 *
 * Every mutation runs in one immediate transaction together with its event
 * (`reliability.md` §1); every refusal returns a result object and writes nothing.
 */
export class PlanGateService {
  private readonly store: ProjectStore;
  private readonly artifacts: ArtifactService;

  constructor(options: {
    readonly store: ProjectStore;
    readonly artifacts?: ArtifactService;
    readonly blobs?: BlobStore;
  }) {
    this.store = options.store;
    // The producer of a Plan artifact is the Planning Run, so the same artifact
    // rules (blob + content hash + ACL) apply as to every other delivery artifact.
    this.artifacts =
      options.artifacts ??
      new ArtifactService({
        store: options.store,
        blobs: options.blobs ?? new BlobStore({ root: options.store.dataDir }),
      });
  }

  // -------------------------------------------------------------------------
  // Plan submission (AC-014)
  // -------------------------------------------------------------------------

  /**
   * Submits a Plan for approval.
   *
   * The decision is `@agentdev/domain`'s `evaluatePlanApproval`; Core only
   * assembles the real inputs (the stored authorization envelope, the Work budget,
   * the current revision) and persists the outcome. A non-compliant Plan is
   * rejected before anything is written.
   */
  submitPlan(input: SubmitPlanInput): SubmitPlanResult {
    return withTransaction(this.store.db, () => this.submitPlanTx(input));
  }

  private submitPlanTx(input: SubmitPlanInput): SubmitPlanResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${input.workId} does not exist`);
    const authorization = this.authorizationOrRefusal(input.approval.authorizationRef, work.id);
    if ('code' in authorization) {
      return {
        approved: false,
        code: 'NOT_AUTHORIZED',
        message: authorization.message,
        decisionRequired: false,
        gaps: [authorization.message],
      };
    }
    if (work.baseRevision !== undefined && input.revision !== work.baseRevision) {
      return {
        approved: false,
        code: 'VALIDATION_ERROR',
        message: `revision ${input.revision} is not the Work's current revision ${work.baseRevision}`,
        decisionRequired: false,
        gaps: ['the Plan must be written against the current Work revision'],
      };
    }
    if (input.plan.tasks.length === 0) {
      return {
        approved: false,
        code: 'VALIDATION_ERROR',
        message: 'a Plan needs at least one task',
        decisionRequired: false,
        gaps: ['empty task DAG'],
      };
    }

    // The Plan's version is its position in this Work's Plan chain; a new Plan can
    // never move the chain backwards (monotonic, see `nextPlanVersion`).
    const version = this.nextPlanVersion(work.id);
    const content = normalizePlan(input.plan, version, input.approval.authorizationRef);
    const contentJson = canonicalPlanJson(content);
    const planHash = sha256(contentJson);
    const planRevision: PlanRevision = {
      id: planHash,
      version,
      hash: planHash,
      revision: input.revision,
      stage: 'Plan',
    };
    const requirementId = input.requirementId ?? work.requirementId;
    const budget = this.store.budgets.find(work.budgetId);
    const requestedTokens = input.approval.requestedTokens;
    if (requestedTokens !== undefined && budget === undefined) {
      // Fail closed: a Plan that asks for tokens with no budget row to charge them
      // to would approve an unbounded reservation (W6R2-06).
      return {
        approved: false,
        code: 'GATE_NOT_READY',
        message: `Work ${work.id} has no budget row; the Plan's token request cannot be reserved`,
        decisionRequired: false,
        gaps: ['no budget row to reserve the requested tokens against'],
      };
    }
    const decision = evaluatePlanApproval({
      plan: planRevision,
      revision: input.revision,
      selection: {
        authorizationRef: input.approval.authorizationRef,
        authorizedTargets: [...authorization.scope.writePaths],
        authorizedOperations: [...authorization.operations],
        workId: work.id,
        ...(requirementId === undefined ? {} : { requirementId }),
      },
      scope: content.scope,
      productChanged: input.approval.productChanged,
      at: input.approval.at,
      ...(requestedTokens === undefined || budget === undefined
        ? {}
        : {
            budget: {
              tokenLimit: budget.tokenLimit,
              // The Work's *real* usage: passing 0 here approved Plans that exceeded
              // the budget (W6R1-03).
              used: budget.tokensUsed,
              // Tokens already reserved by earlier approvals count too, so a second
              // approval cannot consume the same headroom twice (W6R2-06).
              reserved: budget.tokensReserved,
              requested: requestedTokens,
            },
          }),
    });
    if (!decision.ok) {
      return {
        approved: false,
        code: asSubmitCode(decision.code),
        message: decision.message,
        decisionRequired: decision.decisionRequired,
        gaps: [decision.message],
      };
    }

    // Artifact rows are immutable and hash-addressed, so the same Plan content
    // submitted twice resolves to one artifact (`data.md` §2 "修改新版本").
    const artifact = this.artifacts.createAgent({
      run: this.planningRun(input.approval.runId, work.id),
      kind: 'plan',
      mime: 'application/json',
      bytes: Buffer.from(contentJson, 'utf8'),
      acl: ['chief', 'planning', 'backend', 'frontend', 'review', 'test', 'settlement'],
    });
    // `Ref.id` is a UUIDv7 row id (`data.md` §1, enforced by `requirement.planRef`),
    // so the Artifact row carries it and the content hash is the immutable half of
    // the pin (`data.md` §4: the transaction references the hash).
    const planRef: Ref = { id: artifact.id, version, hash: artifact.contentHash };
    const approval = this.appendApprovalRecord(
      work.id,
      input.revision,
      planRef,
      decision.evidence,
      this.currentProductVersion(work.id),
      this.measureSourceHash(work.id, input.sourceHashPort),
    );
    this.linkRequirementPlan(work, requirementId, planRef);
    // W6R2-06: an approval reserves the tokens it was approved for, in the same
    // transaction as the approval record. Without this, two Plans of 60 tokens
    // against a 100-token limit were both approved because `tokensReserved` stayed
    // 0; with it, the second sees the first's reservation and is refused by the
    // domain rule (`used + reserved + requested <= limit`, AC-022). Tokens actually
    // spent are settled by the Run lifecycle, which is out of this package's scope;
    // the reservation is what makes the approval path accountable in the meantime.
    if (requestedTokens !== undefined && budget !== undefined) {
      this.store.budgets.update(
        budget.id,
        { tokensReserved: budget.tokensReserved + requestedTokens },
        budget.version,
      );
    }
    this.store.events.append({
      // `decision.created` is the documented name for a recorded Plan approval
      // (`protocol.md` §7); the other names below are this module's own domain
      // events, which no other package depends on yet.
      name: 'decision.created',
      entityId: work.id,
      entityVersion: work.version,
      data: {
        workId: work.id,
        revision: input.revision,
        planId: planRef.id,
        planVersion: planRef.version,
        planHash: planRef.hash,
        approvedBy: decision.evidence.approvedBy,
        authorizationRef: decision.evidence.authorizationRef ?? null,
        approvalRecordHash: approval.hash,
        requestedTokens: requestedTokens ?? null,
        tokensReserved:
          budget === undefined ? null : budget.tokensReserved + (requestedTokens ?? 0),
      },
    });
    return {
      approved: true,
      planRef,
      planArtifactId: artifact.id,
      evidence: decision.evidence,
      approvalRecordHash: approval.hash,
      revision: input.revision,
    };
  }

  // -------------------------------------------------------------------------
  // Write gate (AC-013)
  // -------------------------------------------------------------------------

  /**
   * Admits (or refuses) a code write.
   *
   * The `SourceHashPort` is measured before and after the decision and both
   * measurements are returned, so the caller can show the source did not move: a
   * refused write touches no row and appends no event.
   */
  requestCodeWrite(input: RequestCodeWriteInput): RequestCodeWriteResult {
    const port = input.sourceHashPort ?? new StoreSourceHashPort({ store: this.store });
    // `sourceHash`/`sourceHashAfter` are the content measurement, which must be
    // identical around the admission; the refusal tests additionally compare
    // `port.measure` (content + row counts) before and after to prove that a
    // refused gate wrote no row and appended no event.
    const before = port.measure(input.workId);
    const contentBefore = port.contentHash?.(input.workId) ?? before;
    const contentAfter = (): string =>
      port.contentHash?.(input.workId) ?? port.measure(input.workId);
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      return {
        allowed: false,
        code: 'NOT_FOUND',
        message: `Work ${input.workId} does not exist`,
        gaps: ['unknown Work'],
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: false,
      };
    }
    if (work.baseRevision !== undefined && input.revision !== work.baseRevision) {
      return {
        allowed: false,
        code: 'VALIDATION_ERROR',
        message: `revision ${input.revision} is not the Work's current revision ${work.baseRevision}`,
        gaps: ['stale revision'],
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: false,
      };
    }
    // W6R2-07: the Plan gate reads the Work status too. `workflow.md` §7 makes a
    // pause stop new admission and AC-021 keeps a cancelled Work from writing; the
    // Run-level `writeAdmission` already refuses these statuses, so the two gates
    // share one rule (`workWriteBarrier`) instead of disagreeing.
    const barrier = workWriteBarrier(work.status);
    if (barrier.blocked) {
      return {
        allowed: false,
        code: barrier.code,
        message: `Work ${work.id}: ${barrier.message}`,
        gaps: [barrier.message],
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: false,
      };
    }

    const current = this.getCurrentPlanApproval(work.id, input.revision);
    const requested = input.planRef;
    const staleByRequest =
      requested !== undefined &&
      current.current !== undefined &&
      requested.hash !== current.current.planRef.hash;

    if (current.status !== 'approved' || current.current === undefined) {
      const gaps =
        current.status === 'stale'
          ? ['the Plan held for this revision is stale']
          : ['no approved Plan for this revision'];
      return {
        allowed: false,
        code: 'GATE_NOT_READY',
        message: gaps[0] ?? 'the write gate is not ready',
        gaps,
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: current.status === 'stale' || staleByRequest,
        ...(current.current === undefined ? {} : { currentPlanRef: current.current.planRef }),
      };
    }
    if (staleByRequest) {
      // The caller still holds the superseded Plan: the Work revision is never
      // writable on a Plan that is no longer the approved one, so the gate code is
      // the same `GATE_NOT_READY` an absent Plan produces (AC-009).
      return {
        allowed: false,
        code: 'GATE_NOT_READY',
        message: 'the Plan under request is no longer the approved Plan for this revision',
        gaps: ['the Plan under request is stale'],
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: true,
        currentPlanRef: current.current.planRef,
      };
    }

    const planContent = this.readPlanContent(current.current.planRef.id);
    const approvedPaths = planContent.scope.writePaths;
    // The authorization envelope is re-read *at write time* (W6R1-05): a Plan
    // approved yesterday must not keep writing through an envelope the user has
    // revoked or narrowed since. The approval record names the envelope it used.
    const authorization = this.writeAuthorization(
      current.current,
      work.id,
      planContent.scope.writePaths,
      planContent.scope.operations,
    );
    if ('code' in authorization) {
      return {
        allowed: false,
        code: 'NOT_AUTHORIZED',
        message: authorization.message,
        gaps: [authorization.message],
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: false,
        currentPlanRef: current.current.planRef,
      };
    }
    const outside = (input.targets ?? []).filter((target) => !isWithinScope(target, approvedPaths));
    if (outside.length > 0) {
      return {
        allowed: false,
        code: 'NOT_AUTHORIZED',
        message: `write targets are outside the approved Plan: ${outside.join(', ')}`,
        gaps: ['write target outside the Plan scope'],
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: false,
        currentPlanRef: current.current.planRef,
      };
    }

    // W6R2-02: the approved record's hash is the authority and is compared with the
    // live measurement *unconditionally*. A caller-supplied expectation is only a
    // second requirement (`callerExpectedSourceHash`), so a moved source cannot be
    // "selected out" by handing the gate the moved value as the expectation.
    const recordedSourceHash = current.current.sourceHash;
    if (recordedSourceHash === '') {
      // Fail closed: an approval without a recorded source cannot bind the write to
      // any tree. `submitPlan` always records one, so this is a legacy/garbage row.
      return {
        allowed: false,
        code: 'GATE_NOT_READY',
        message: 'the approved Plan records no source hash; the write cannot be bound to a tree',
        gaps: ['the approval record has no source hash'],
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: false,
        currentPlanRef: current.current.planRef,
      };
    }
    const decision = evaluateWriteGate({
      plan: {
        id: current.current.planRef.id,
        version: current.current.planRef.version,
        hash: current.current.planRef.hash,
        revision: current.current.revision,
        stage: 'Plan',
        approval: current.current.approval.approvedBy,
        approvedAt: current.current.approval.at,
      },
      revision: input.revision,
      work: { id: work.id, revision: input.revision, level: work.level },
      authorizedTargets: approvedPaths,
      expectedSourceHash: recordedSourceHash,
      actualSourceHash: contentBefore,
      ...(input.expectedSourceHash === undefined
        ? {}
        : { callerExpectedSourceHash: input.expectedSourceHash }),
      planHash: current.current.planRef.hash,
      diffHash: '',
    });
    if (!decision.ok) {
      return {
        allowed: false,
        code: 'GATE_NOT_READY',
        message: decision.message,
        gaps: decision.gaps,
        sourceHash: contentBefore,
        sourceHashAfter: contentAfter(),
        stalePlan: false,
        currentPlanRef: current.current.planRef,
      };
    }
    this.store.events.append({
      name: 'delivery.write_admitted',
      entityId: work.id,
      entityVersion: work.version,
      data: {
        workId: work.id,
        revision: input.revision,
        planId: decision.approvals.planRef.id,
        planHash: decision.approvals.planRef.hash,
        targets: [...(input.targets ?? [])],
      },
    });
    return {
      allowed: true,
      sourceHash: contentBefore,
      sourceHashAfter: contentAfter(),
      planRef: decision.approvals.planRef,
      evidenceRefs: [
        current.current.planRef.id,
        current.current.approvalRecordHash,
        ...(current.current.approval.authorizationRef === undefined
          ? []
          : [current.current.approval.authorizationRef]),
      ],
      workLevel: work.level,
    };
  }

  // -------------------------------------------------------------------------
  // Level upgrade (AC-009)
  // -------------------------------------------------------------------------

  /**
   * Applies an evaluated level upgrade.
   *
   * `evaluateLevelUpgrade` decides the new level (never a downgrade); Core then
   * updates the Work, re-associates the Requirement, marks the previous Plan
   * stale and installs the already-approved replacement Plan.
   */
  upgradeLevel(input: UpgradeLevelInput): UpgradeLevelResult {
    return withTransaction(this.store.db, () => this.upgradeLevelTx(input));
  }

  private upgradeLevelTx(input: UpgradeLevelInput): UpgradeLevelResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${input.workId} does not exist`);
    const revision = work.baseRevision ?? 'working-tree';
    /**
     * The Plan the Work is upgrading *away from*.
     *
     * The replacement Plan is approved before the upgrade is applied (the raised
     * level needs its own Plan), so the newest record is the replacement; the Plan
     * that must go stale is the newest approved one that is not it.
     */
    const previous = this.findPreviousApprovedPlan(work.id, revision, input.newPlanRef.hash);
    const replacement = this.findApprovedPlanByRef(work.id, input.newPlanRef);
    if (replacement === undefined) {
      return {
        upgraded: false,
        // A precondition failure, not one of the domain's three level outcomes:
        // the evaluation never ran, so nothing was promoted or invalidated.
        outcome: 'refused',
        code: 'GATE_NOT_READY',
        message: `the replacement Plan ${input.newPlanRef.id} has no approval record for ${work.id}`,
        level: work.level,
        reasons: ['the raised level needs its own approved Plan'],
      };
    }
    const decision = evaluateLevelUpgrade({
      previousLevel: work.level,
      diff: input.diff,
      logicChange: input.logicChange,
      ...(input.riskFlags === undefined ? {} : { riskFlags: input.riskFlags }),
      // The level re-evaluation consults the shared evidence rule: only a Plan that
      // is still valid and bound to the Work's current revision is superseded
      // (W6R2-06 lineage, `evaluateEvidenceValidity`).
      workRevision: revision,
      ...(previous === undefined
        ? {}
        : {
            plan: {
              id: previous.planRef.id,
              version: previous.planRef.version,
              hash: previous.planRef.hash,
              revision: previous.revision,
              stage: 'Plan',
              approval: previous.approval.approvedBy,
              approvedAt: previous.approval.at,
              validity: this.store.artifacts.find(previous.planRef.id)?.validity ?? 'valid',
            } satisfies PlanRevision,
          }),
    });
    if (decision.outcome === 'noop') {
      // The recorded level already covers this diff: no Work, Plan or artifact
      // state moves at all (W6R1-06).
      return {
        upgraded: false,
        outcome: 'noop',
        code: 'GATE_NOT_READY',
        message: 'no upgrade is required for this diff',
        level: work.level,
        reasons: decision.reasons,
      };
    }
    if (decision.outcome === 'downgrade_refused') {
      // The classification is below the recorded level. The Work keeps its level
      // and the current Plan stays valid: nothing is marked stale or invalidated.
      return {
        upgraded: false,
        outcome: 'downgrade_refused',
        code: 'STALE_ARTIFACT',
        message: `a downgrade to ${decision.level} is refused; the Work keeps ${work.level}`,
        level: work.level,
        reasons: decision.reasons,
      };
    }

    const stalePlanRefs: string[] = [];
    if (decision.stalePlan && previous !== undefined) {
      const reason =
        decision.reasons.join('; ') || 'the level rose and the old Plan no longer covers the scope';
      this.appendStaleRecord(work.id, revision, previous.planRef, reason);
      this.artifacts.invalidate(
        previous.planRef.id,
        `level upgrade to ${decision.level}: ${reason}`,
      );
      // The stale marker names the Plan by content: an id the caller may hold is a
      // row id, but the Plan identity a write is refused on is the hash.
      stalePlanRefs.push(previous.planRef.hash);
    }

    const requirementId = input.requirementId ?? work.requirementId;
    const updated = this.store.works.update(
      work.id,
      {
        level: decision.level,
        ...(requirementId === undefined ? {} : { requirementId }),
      },
      work.version,
    );
    if (requirementId !== undefined) {
      this.linkRequirementPlan(updated, requirementId, input.newPlanRef);
    }
    this.store.events.append({
      name: 'delivery.level_upgraded',
      entityId: work.id,
      entityVersion: updated.version,
      data: {
        workId: work.id,
        previousLevel: work.level,
        level: decision.level,
        logicChange: input.logicChange,
        stalePlanRefs,
        newPlanId: input.newPlanRef.id,
        requirementId: requirementId ?? null,
        reasons: [...decision.reasons],
      },
    });
    return {
      upgraded: true,
      outcome: 'upgraded',
      previousLevel: work.level,
      level: decision.level,
      ...(requirementId === undefined ? {} : { requirementId }),
      stalePlanRefs,
      currentPlanRef: input.newPlanRef,
      reasons: decision.reasons,
    };
  }

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  /** The Work's persisted level (`work.level`), not an in-memory guess. */
  getWorkLevel(workId: string): Level {
    const work = this.store.works.find(workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${workId} does not exist`);
    return work.level;
  }

  /** The approved Plan plus its evidence for one Work revision. */
  getCurrentPlanApproval(workId: string, revision: string): CurrentPlanApproval {
    const records = this.gateRecords(workId);
    const approval = [...records]
      .reverse()
      .find(
        (record): record is PlanApprovalRecord =>
          record.status === 'approved' && record.revision === revision,
      );
    if (approval === undefined) return { workId, revision, status: 'missing' };
    const staleMarker = [...records]
      .reverse()
      .find(
        (record): record is PlanStaleRecord =>
          record.status === 'plan_stale' && record.stalePlanRef.hash === approval.planRef.hash,
      );
    const current: ApprovedPlanRecord = {
      planRef: approval.planRef,
      revision: approval.revision,
      workId: approval.workId,
      approval: approval.approval,
      approvalRecordHash: this.snapshotHashOf(approval),
      sourceHash: approval.sourceHash,
    };
    if (staleMarker !== undefined) {
      return { workId, revision, status: 'stale', current, stalePlanRef: staleMarker.stalePlanRef };
    }
    // A `now` product choice moves the Product on (`workflow.md` §6), and the Plan
    // approved against the previous Product revision cannot gate a write any more.
    if (this.currentProductVersion(workId) > approval.productVersion) {
      return { workId, revision, status: 'stale', current, stalePlanRef: approval.planRef };
    }
    return { workId, revision, status: 'approved', current };
  }

  /**
   * The current Product version.
   *
   * The Requirement's own `productRef` is the authority when it has one; the
   * Decision layer's declaration covers a Work whose Product moved on before the
   * Requirement row carried a version. 0 means "no Product version yet".
   */
  currentProductVersion(workId: string): number {
    const requirement = this.requirementOf(workId);
    const declared = this.latestVersionDeclaration(workId);
    return Math.max(requirement?.productRef?.version ?? 0, declared?.productVersion ?? 0);
  }

  /**
   * Marks the approved Plan for a revision stale because the Product moved on.
   *
   * `DecisionService` calls this for the `now` branch of a behaviour Decision. The
   * marker is what a caller can point at, and the durable reason the gate then
   * refuses the old Plan comes from comparing the approval's recorded
   * `productVersion` with the current one.
   */
  invalidatePlanForProductChange(input: {
    readonly workId: string;
    readonly revision: string;
    readonly planRef: Ref;
    readonly productVersion: number;
    readonly reason: string;
  }): { readonly staleRecordHash: string; readonly invalidatedArtifact: boolean } {
    return withTransaction(this.store.db, () => {
      const marker = this.appendStaleRecord(
        input.workId,
        input.revision,
        input.planRef,
        input.reason,
      );
      const artifact = this.store.artifacts.find(input.planRef.id);
      if (artifact !== undefined && artifact.validity === 'valid') {
        this.artifacts.invalidate(
          input.planRef.id,
          `product changed to version ${input.productVersion}: ${input.reason}`,
        );
        return { staleRecordHash: marker.hash, invalidatedArtifact: true };
      }
      return { staleRecordHash: marker.hash, invalidatedArtifact: false };
    });
  }

  /** Reads an approved Plan back from its blob and re-validates the contract shape. */
  readPlanContent(artifactId: string): Plan {
    const stored = this.store.artifacts.find(artifactId);
    if (stored === undefined) fail('NOT_FOUND', `Plan artifact ${artifactId} does not exist`);
    const bytes = this.artifacts.read(stored);
    const parsed = planSchema.safeParse(JSON.parse(Buffer.from(bytes).toString('utf8')));
    if (!parsed.success) {
      fail('STALE_ARTIFACT', `Plan artifact ${artifactId} is not a valid Plan`, { artifactId });
    }
    return parsed.data;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private planningRun(
    runId: string,
    workId: string,
  ): { id: string; workId: string; role: 'planning' } {
    const run = this.store.runs.find(runId);
    if (run === undefined) fail('NOT_FOUND', `Run ${runId} does not exist`, { runId });
    if (run.workId !== workId) {
      fail('NOT_AUTHORIZED', `Run ${runId} belongs to another Work`, { runId, workId });
    }
    return { id: run.id, workId: run.workId, role: 'planning' };
  }

  /**
   * Loads the authorization a Plan rests on.
   *
   * A missing, foreign or revoked envelope is a *refusal result* rather than a
   * thrown error: `submitPlan` answers `NOT_AUTHORIZED` without writing anything,
   * so the caller sees a gate verdict instead of an exception.
   */
  private authorizationOrRefusal(
    authorizationRef: string,
    workId: string,
  ): Authorization | { readonly code: 'NOT_AUTHORIZED'; readonly message: string } {
    const authorization = this.store.authorizations.find(authorizationRef);
    if (authorization === undefined) {
      return {
        code: 'NOT_AUTHORIZED',
        message: `authorization ${authorizationRef} does not exist`,
      };
    }
    if (authorization.workId !== workId) {
      return {
        code: 'NOT_AUTHORIZED',
        message: `authorization ${authorizationRef} belongs to another Work`,
      };
    }
    if (authorization.revokedAt !== undefined) {
      return { code: 'NOT_AUTHORIZED', message: `authorization ${authorizationRef} is revoked` };
    }
    return authorization;
  }

  /**
   * Re-reads the authorization an approved Plan rests on, at write time (W6R1-05).
   *
   * `submitPlan` validates the envelope once; a write that happens later must not
   * inherit that verdict, because the user can revoke or narrow an authorization
   * while an approved Plan is still on file. The Plan's own scope is re-checked
   * against the envelope as well, so a narrowed authorization refuses a Plan that
   * has left it.
   */
  private writeAuthorization(
    record: ApprovedPlanRecord,
    workId: string,
    planPaths: readonly string[],
    planOperations: readonly string[],
  ): Authorization | { readonly code: 'NOT_AUTHORIZED'; readonly message: string } {
    const authorizationRef = record.approval.authorizationRef;
    if (authorizationRef === undefined || authorizationRef === '') {
      return {
        code: 'NOT_AUTHORIZED',
        message: 'the approved Plan records no authorization envelope',
      };
    }
    const authorization = this.authorizationOrRefusal(authorizationRef, workId);
    if ('code' in authorization) return authorization;
    const outside = planPaths.filter(
      (path) => !isWithinScope(path, authorization.scope.writePaths),
    );
    if (outside.length > 0) {
      return {
        code: 'NOT_AUTHORIZED',
        message: `authorization ${authorizationRef} no longer covers the Plan write scope: ${outside.join(', ')}`,
      };
    }
    const ungranted = planOperations.filter(
      (operation) => !(authorization.operations as readonly string[]).includes(operation),
    );
    if (ungranted.length > 0) {
      return {
        code: 'NOT_AUTHORIZED',
        message: `authorization ${authorizationRef} no longer grants Plan operations: ${ungranted.join(', ')}`,
      };
    }
    return authorization;
  }

  /** The next Plan version for a Work: strictly greater than every version seen. */
  private nextPlanVersion(workId: string): number {
    const planVersions = this.store.artifacts
      .list({ where: 'work_id = ? AND kind = ?', params: [workId, 'plan'] })
      .map((artifact) => artifact.artifactVersion);
    const requirement = this.requirementOf(workId);
    const requirementVersion = requirement?.planRef?.version ?? 0;
    return Math.max(0, ...planVersions, requirementVersion) + 1;
  }

  private requirementOf(workId: string): Requirement | undefined {
    const work = this.store.works.find(workId);
    const requirementId = work?.requirementId;
    return requirementId === undefined ? undefined : this.store.requirements.find(requirementId);
  }

  /** Points the Requirement's `planRef` at the approved Plan and bumps the record. */
  private linkRequirementPlan(
    work: Work,
    requirementId: string | undefined,
    planRef: Ref,
  ): Requirement | undefined {
    if (requirementId === undefined) return undefined;
    const requirement = this.store.requirements.find(requirementId);
    if (requirement === undefined) {
      fail('NOT_FOUND', `Requirement ${requirementId} does not exist`, { requirementId });
    }
    const updated = this.store.requirements.update(
      requirement.id,
      { planRef, recordVersion: requirement.recordVersion + 1, phase: 'plan' },
      requirement.version,
    );
    this.store.events.append({
      name: 'requirement.changed',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        workId: work.id,
        requirementId: updated.id,
        planId: planRef.id,
        planVersion: planRef.version,
        planHash: planRef.hash,
        recordVersion: updated.recordVersion,
      },
    });
    return updated;
  }

  /** Every approval record for a Work, newest last. */
  private approvedRecords(workId: string): PlanApprovalRecord[] {
    return this.gateRecords(workId).filter(
      (record): record is PlanApprovalRecord => record.status === 'approved',
    );
  }

  private toApprovedPlanRecord(match: PlanApprovalRecord): ApprovedPlanRecord {
    return {
      planRef: match.planRef,
      revision: match.revision,
      workId: match.workId,
      approval: match.approval,
      approvalRecordHash: this.snapshotHashOf(match),
      sourceHash: match.sourceHash,
    };
  }

  /** Finds an approval record by Plan ref across the Work's revisions. */
  private findApprovedPlanByRef(workId: string, planRef: Ref): ApprovedPlanRecord | undefined {
    const match = this.approvedRecords(workId).find(
      (record) => record.planRef.hash === planRef.hash,
    );
    return match === undefined ? undefined : this.toApprovedPlanRecord(match);
  }

  /**
   * The newest approved Plan for a revision that is not the replacement.
   *
   * This is the Plan the level upgrade supersedes; `undefined` means the Work had
   * no prior approved Plan, so there is nothing to mark stale.
   */
  private findPreviousApprovedPlan(
    workId: string,
    revision: string,
    replacementHash: string,
  ): ApprovedPlanRecord | undefined {
    const match = [...this.approvedRecords(workId)]
      .reverse()
      .find((record) => record.revision === revision && record.planRef.hash !== replacementHash);
    return match === undefined ? undefined : this.toApprovedPlanRecord(match);
  }

  private latestVersionDeclaration(workId: string): VersionDeclaration | undefined {
    return versionDeclarations(this.store, workId).at(-1);
  }

  private appendApprovalRecord(
    workId: string,
    revision: string,
    planRef: Ref,
    approval: PlanApprovalEvidence,
    productVersion: number,
    sourceHash: string,
  ): Snapshot {
    const payload: PlanApprovalRecord = {
      schemaVersion: PLAN_GATE_RECORD_VERSION,
      status: 'approved',
      workId,
      revision,
      planRef,
      planHash: planRef.hash,
      approval,
      productVersion,
      sourceHash,
    };
    return this.appendSnapshot(payload as unknown as JsonObject);
  }

  /**
   * Measures the source content hash a Plan approval is frozen against.
   *
   * The default port reads the Work's `baseRevision`, which is what a real caller
   * with a Git worktree replaces with the tree OID it measured itself.
   */
  private measureSourceHash(workId: string, port?: SourceHashPort): string {
    const measured = port ?? new StoreSourceHashPort({ store: this.store });
    return measured.contentHash?.(workId) ?? measured.measure(workId);
  }

  private appendStaleRecord(
    workId: string,
    revision: string,
    stalePlanRef: Ref,
    reason: string,
  ): Snapshot {
    const payload: PlanStaleRecord = {
      schemaVersion: PLAN_GATE_RECORD_VERSION,
      status: 'plan_stale',
      workId,
      revision,
      stalePlanRef,
      reason,
    };
    return this.appendSnapshot(payload as unknown as JsonObject);
  }

  /**
   * Freezes one gate record.
   *
   * `snapshot` is content-addressed and immutable, so re-appending an identical
   * record is a no-op and the table can never be rewritten
   * (`schema.ts` `UPDATE_BLOCKED_TABLES`).
   */
  private appendSnapshot(payload: JsonObject): Snapshot {
    const serialized = canonicalJson(payload);
    const hash = sha256(serialized);
    const existing = this.snapshotRow(hash);
    if (existing !== undefined) return existing;
    this.store.db
      .prepare(
        'INSERT INTO snapshot (type, hash, payload, blob_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        PLAN_GATE_SNAPSHOT_TYPE,
        hash,
        serialized,
        `snapshots/${PLAN_GATE_SNAPSHOT_TYPE}/${hash}.json`,
        this.store.now(),
      );
    const written = this.snapshotRow(hash);
    if (written === undefined) {
      fail('INTERNAL_ERROR', `gate snapshot ${hash} could not be read back`);
    }
    return written;
  }

  /** Reads one frozen row straight from `snapshot` (`data.md` §2 identity is the hash). */
  private snapshotRow(hash: string): Snapshot | undefined {
    const row = this.store.db
      .prepare(
        'SELECT type, hash, payload, blob_path AS blobPath, created_at AS createdAt FROM snapshot WHERE hash = ? LIMIT 1',
      )
      .get(hash) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      type: row['type'] as Snapshot['type'],
      hash: row['hash'] as string,
      payload: JSON.parse(row['payload'] as string) as JsonObject,
      blobPath: row['blobPath'] as string,
      createdAt: row['createdAt'] as string,
    };
  }

  private snapshotHashOf(record: PlanGateRecord): string {
    return sha256(canonicalJson(record));
  }

  /** Every gate record for a Work, in insertion order. */
  private gateRecords(workId: string): PlanGateRecord[] {
    const rows = this.store.db
      .prepare('SELECT payload FROM snapshot WHERE type = ? ORDER BY rowid ASC')
      .all(PLAN_GATE_SNAPSHOT_TYPE) as { payload: string }[];
    const records: PlanGateRecord[] = [];
    for (const row of rows) {
      let payload: JsonObject;
      try {
        payload = JSON.parse(row.payload) as JsonObject;
      } catch {
        // A snapshot the gate did not write: skip it rather than crash the gate.
        continue;
      }
      const record = decodeGateRecord(payload);
      if (record !== undefined && record.workId === workId) records.push(record);
    }
    return records;
  }
}
