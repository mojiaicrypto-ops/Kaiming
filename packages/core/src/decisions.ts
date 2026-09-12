/**
 * Behaviour Decisions and their three branches (`rules/workflow.md` §6,
 * AC-015/016).
 *
 * A behaviour choice found during execution is not a chat message: it is either
 * handled now (a new Product/Plan version, with the affected evidence invalidated),
 * deferred (a Queued Requirement, current acceptance untouched), or declined (the
 * reason is recorded and nothing moves). `@agentdev/domain`'s
 * `evaluateBehaviourChoice`/`requirementStateForChoice` own those rules; this
 * module writes the `decision` row, the version declarations and the queued
 * Requirement, and records exactly which evidence a `now` choice invalidates.
 *
 * ## Where the version state lives
 *
 * The `decision` row is the durable choice record (`data.md` §2), and the
 * Requirement's own `productRef`/`planRef` carry the current versions. The
 * monotonically increasing Product/Plan version *declaration* is frozen in
 * `snapshot` rows of `type=context` — the same content-addressed, immutable table
 * the Plan gate uses for its own records, addressed by a distinct payload
 * `kind`, so neither reader can mistake the other's rows for its own.
 */
import {
  type Decision,
  type JsonObject,
  type Ref,
  type Requirement,
  type RequirementState,
} from '@agentdev/contracts';
import {
  evaluateBehaviourChoice,
  requirementStateForChoice,
  type BehaviourChoice,
  type BehaviourChoiceDecision,
} from '@agentdev/domain';
import { BlobStore, sha256, withTransaction, type ProjectStore } from '@agentdev/storage';
import { ArtifactService } from './artifacts.js';
import { canonicalJson } from './dispatcher.js';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';
import { PlanGateService } from './gates.js';

/** Snapshot type for the Product/Plan version declarations. */
export const VERSION_SNAPSHOT_TYPE = 'context';

/** Snapshot type for the invalidated-evidence records. */
export const INVALIDATED_EVIDENCE_SNAPSHOT_TYPE = 'config';

/** Payload schema version of both records written here. */
export const DECISION_RECORD_VERSION = 1;

export interface RecordBehaviourDecisionInput {
  readonly workId: string;
  readonly choice: BehaviourChoice;
  readonly summary: string;
  readonly decidedAt: string;
  /** The evidence the current Work rests on. */
  readonly evidenceRefs?: readonly string[];
  /** Exactly which of those refs the change invalidates, when the caller knows. */
  readonly affectedEvidenceRefs?: readonly string[];
  /** Or the code paths the change touches, to match against the refs. */
  readonly removeOrChangePaths?: readonly string[];
  /** The Requirement the current acceptance belongs to. */
  readonly sourceRequirementId?: string;
  /** Its lifecycle; the current acceptance is never moved by `later`/`decline`. */
  readonly requirementLifecycle?: RequirementState;
  /** The intent of a Requirement this branch creates (`data.md` §2). */
  readonly queuedIntent?: 'delivery' | 'document';
}

export interface QueuedRequirementRecord {
  readonly requirementId: string;
  readonly title: string;
  readonly goal: string;
  readonly lifecycle: 'queued';
  readonly executionAvailability: 'needs_replan';
  readonly recordVersion: number;
}

export interface RecordBehaviourDecisionResult {
  readonly decisionId: string;
  readonly workId: string;
  readonly choice: BehaviourChoice;
  readonly decisionState: 'accepted' | 'rejected';
  /** The Requirement the current acceptance belongs to. */
  readonly requirementId?: string;
  /** `now` only: the new Product and Plan versions this choice requires. */
  readonly newProductVersion?: Ref;
  readonly newPlanVersion?: Ref;
  /** `now` only: the evidence this choice invalidated. */
  readonly invalidatedEvidenceRefs: readonly string[];
  /** `now` only: the evidence that survives and may be reused. */
  readonly reusableEvidenceRefs: readonly string[];
  /** `later` only. */
  readonly queuedRequirement?: QueuedRequirementRecord;
  /** `decline` only: why the suggestion was not adopted. */
  readonly reason?: string;
  /** `true` for `later`/`decline`: the current acceptance did not move. */
  readonly currentAcceptanceUnchanged: boolean;
  /** The immutable record of the choice itself. */
  readonly record: Decision;
  /** The frozen version/invalidation payload this result was derived from. */
  readonly versionRecordHash?: string;
  readonly evidenceRecordHash?: string;
}

export interface InvalidatedEvidenceRecord {
  readonly decisionId: string;
  readonly workId: string;
  readonly invalidatedEvidenceRefs: readonly string[];
  readonly reusableEvidenceRefs: readonly string[];
  readonly recordedAt: string;
  readonly recordHash: string;
}

export interface ProductVersionRecord {
  readonly workId: string;
  readonly requirementId?: string;
  readonly version: number;
  readonly ref?: Ref;
  readonly source: 'requirement' | 'declaration';
}

export interface PlanVersionRecord {
  readonly workId: string;
  readonly requirementId?: string;
  readonly version: number;
  readonly ref?: Ref;
  readonly source: 'gate' | 'requirement' | 'declaration';
}

interface VersionRecordPayload extends Record<string, unknown> {
  readonly kind: 'product_plan_version';
  readonly schemaVersion: number;
  readonly workId: string;
  readonly decisionId: string;
  readonly productVersion: number;
  readonly planVersion: number;
  readonly requirementId: string | null;
}

interface InvalidatedEvidencePayload extends Record<string, unknown> {
  readonly kind: 'invalidated_evidence';
  readonly schemaVersion: number;
  readonly workId: string;
  readonly decisionId: string;
  readonly invalidatedEvidenceRefs: readonly string[];
  readonly reusableEvidenceRefs: readonly string[];
  readonly recordedAt: string;
}

function fail(code: ProtocolErrorCode, message: string, details?: JsonObject): never {
  throw new ProtocolError(code, message, details === undefined ? {} : { details });
}

function isVersionRecord(payload: JsonObject): payload is JsonObject & VersionRecordPayload {
  return payload['kind'] === 'product_plan_version' && typeof payload['workId'] === 'string';
}

function isInvalidatedEvidence(
  payload: JsonObject,
): payload is JsonObject & InvalidatedEvidencePayload {
  return payload['kind'] === 'invalidated_evidence' && typeof payload['workId'] === 'string';
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Records behaviour Decisions and answers the Product/Plan version queries.
 *
 * The gate service is used only to read the *approved* Plan version: a Product
 * decision bumps the declared version, but the current plan a caller may write
 * against is still whatever the gate approved.
 */
export class DecisionService {
  private readonly store: ProjectStore;
  private readonly artifacts: ArtifactService;
  private readonly gates: PlanGateService;

  constructor(options: {
    readonly store: ProjectStore;
    readonly artifacts?: ArtifactService;
    readonly gates?: PlanGateService;
    readonly blobs?: BlobStore;
  }) {
    this.store = options.store;
    const blobs = options.blobs ?? new BlobStore({ root: options.store.dataDir });
    this.artifacts = options.artifacts ?? new ArtifactService({ store: options.store, blobs });
    this.gates = options.gates ?? new PlanGateService({ store: options.store, blobs });
  }

  /**
   * Records one behaviour Decision and applies its branch.
   *
   * The whole branch — decision row, version declaration, evidence invalidation
   * and any queued Requirement — commits in one transaction, and the events are
   * written with it (`reliability.md` §1).
   */
  recordBehaviourDecision(input: RecordBehaviourDecisionInput): RecordBehaviourDecisionResult {
    return withTransaction(this.store.db, () => this.recordTx(input));
  }

  private recordTx(input: RecordBehaviourDecisionInput): RecordBehaviourDecisionResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${input.workId} does not exist`);
    if (input.summary.trim().length === 0) {
      fail('VALIDATION_ERROR', 'a behaviour Decision needs a summary');
    }
    const requirementId = input.sourceRequirementId ?? work.requirementId;
    const requirement =
      requirementId === undefined ? undefined : this.store.requirements.find(requirementId);
    if (requirementId !== undefined && requirement === undefined) {
      fail('NOT_FOUND', `Requirement ${requirementId} does not exist`, { requirementId });
    }

    const choice: BehaviourChoiceDecision = evaluateBehaviourChoice({
      workId: input.workId,
      choice: input.choice,
      summary: input.summary,
      decidedAt: input.decidedAt,
      ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: input.evidenceRefs }),
      ...(input.affectedEvidenceRefs === undefined
        ? {}
        : { affectedEvidenceRefs: input.affectedEvidenceRefs }),
      ...(input.removeOrChangePaths === undefined
        ? {}
        : { removeOrChangePaths: input.removeOrChangePaths }),
      ...(requirementId === undefined ? {} : { sourceRequirementId: requirementId }),
    });

    // `now` invalidates the approved Plan as well: the Product moved, so the Plan
    // written against the old Product is no longer a valid basis for a write.
    const affected = this.affectedRefsOf(input, requirement);
    const invalidated =
      choice.choice === 'now'
        ? [...new Set([...choice.invalidatedEvidenceRefs, ...affected])]
        : [...choice.invalidatedEvidenceRefs];

    const decision = this.insertDecisionRow(input, choice, requirement);
    // `now` keeps the current Requirement (or queues a fresh one when the record is
    // terminal), `later` queues a new one, and `decline` leaves the current one
    // untouched. The domain rule is the authority for that state; Core only checks
    // the branch is consistent with it before writing.
    const requirementState = requirementStateForChoice(
      input.choice,
      requirement?.lifecycle ?? input.requirementLifecycle ?? 'active',
    );
    if (requirementState.kind === 'queued' && choice.choice === 'decline') {
      fail('INVALID_STATE', 'a declined suggestion cannot queue a Requirement');
    }

    let newProductVersion: Ref | undefined;
    let newPlanVersion: Ref | undefined;
    let versionHash: string | undefined;
    let queuedRequirement: QueuedRequirementRecord | undefined;

    if (input.choice === 'now') {
      const versions = this.nextVersions(input.workId, requirement);
      // `Ref.id` is a UUIDv7 row id (`data.md` §1); the frozen declaration carries
      // the same refs, and the hash pins the content the version stands for.
      newProductVersion = {
        id: this.store.newId(),
        version: versions.product,
        hash: sha256(canonicalJson([decision.id, 'product', versions.product])),
      };
      newPlanVersion = {
        id: this.store.newId(),
        version: versions.plan,
        hash: sha256(canonicalJson([decision.id, 'plan', versions.plan])),
      };
      versionHash = this.appendSnapshot(VERSION_SNAPSHOT_TYPE, {
        kind: 'product_plan_version',
        schemaVersion: DECISION_RECORD_VERSION,
        workId: input.workId,
        decisionId: decision.id,
        productVersion: versions.product,
        planVersion: versions.plan,
        requirementId: requirement?.id ?? null,
      } satisfies VersionRecordPayload);
    }

    const evidenceHash = this.appendInvalidatedEvidence(input, decision, invalidated, choice);

    if (input.choice === 'later') {
      queuedRequirement = this.queueRequirement(input, decision, choice);
    }

    if (input.choice === 'now' && requirement !== undefined) {
      // One Product/Plan step: the Requirement moves back to `product` and carries
      // the newly declared versions. `later` and `decline` never touch it.
      this.store.requirements.update(
        requirement.id,
        {
          ...(newProductVersion === undefined ? {} : { productRef: newProductVersion }),
          ...(newPlanVersion === undefined ? {} : { planRef: newPlanVersion }),
          recordVersion: requirement.recordVersion + 1,
          phase: 'product',
        },
        requirement.version,
      );
    }

    if (invalidated.length > 0) {
      this.invalidateArtifacts(invalidated, decision.id);
    }

    if (input.choice === 'now' && newProductVersion !== undefined) {
      // The Product moved, so the Plan the gate approved against the previous
      // Product is stale: the gate records that itself, and a later
      // `requestCodeWrite` on the old Plan is refused (AC-015).
      const revision = work.baseRevision ?? 'working-tree';
      const approved = this.gates.getCurrentPlanApproval(input.workId, revision);
      if (approved.status === 'approved' && approved.current !== undefined) {
        this.gates.invalidatePlanForProductChange({
          workId: input.workId,
          revision,
          planRef: approved.current.planRef,
          productVersion: newProductVersion.version,
          reason: input.summary,
        });
      }
    }

    this.store.events.append({
      name: 'decision.created',
      entityId: work.id,
      entityVersion: work.version,
      data: {
        workId: work.id,
        decisionId: decision.id,
        choice: input.choice,
        state: decision.state,
        requirementId: requirementId ?? null,
        invalidatedEvidenceRefs: [...invalidated],
        queuedRequirementId: queuedRequirement?.requirementId ?? null,
        productVersion: newProductVersion?.version ?? null,
        planVersion: newPlanVersion?.version ?? null,
      },
    });

    return {
      decisionId: decision.id,
      workId: input.workId,
      choice: choice.choice,
      decisionState: decision.state === 'rejected' ? 'rejected' : 'accepted',
      ...(requirementId === undefined ? {} : { requirementId }),
      ...(newProductVersion === undefined ? {} : { newProductVersion }),
      ...(newPlanVersion === undefined ? {} : { newPlanVersion }),
      invalidatedEvidenceRefs: invalidated,
      reusableEvidenceRefs: choice.reusableEvidenceRefs,
      ...(queuedRequirement === undefined ? {} : { queuedRequirement }),
      ...(choice.reason === undefined ? {} : { reason: choice.reason }),
      currentAcceptanceUnchanged: choice.currentAcceptanceUnchanged,
      record: decision,
      ...(versionHash === undefined ? {} : { versionRecordHash: versionHash }),
      evidenceRecordHash: evidenceHash,
    };
  }

  /** The immutable choice record (`data.md` §2 `decision`). */
  getDecisionRecord(decisionId: string): Decision {
    const decision = this.store.decisions.find(decisionId);
    if (decision === undefined) fail('NOT_FOUND', `Decision ${decisionId} does not exist`);
    return decision;
  }

  /** The evidence a recorded `now` choice invalidated. */
  getInvalidatedEvidence(decisionId: string): InvalidatedEvidenceRecord {
    const decision = this.getDecisionRecord(decisionId);
    const payload = this.snapshotsOf(INVALIDATED_EVIDENCE_SNAPSHOT_TYPE)
      .filter(isInvalidatedEvidence)
      .find((entry) => entry['decisionId'] === decisionId);
    if (payload === undefined) {
      fail('MISSING_CONTEXT', `Decision ${decisionId} has no invalidation record`, { decisionId });
    }
    return {
      decisionId,
      workId: decision.workId,
      invalidatedEvidenceRefs: stringsOf(payload['invalidatedEvidenceRefs']),
      reusableEvidenceRefs: stringsOf(payload['reusableEvidenceRefs']),
      recordedAt: typeof payload['recordedAt'] === 'string' ? payload['recordedAt'] : '',
      recordHash: sha256(canonicalJson(payload)),
    };
  }

  /**
   * The current Product version for a Work.
   *
   * The Requirement's own `productRef` is the authority when it has one; the
   * recorded declaration covers a Work whose Product version was bumped before the
   * Requirement row existed.
   */
  getCurrentProductVersion(workId: string): ProductVersionRecord {
    const requirement = this.requirementOf(workId);
    const declared = this.latestVersionRecord(workId);
    if (requirement?.productRef !== undefined) {
      return {
        workId,
        requirementId: requirement.id,
        version: requirement.productRef.version,
        ref: requirement.productRef,
        source: 'requirement',
      };
    }
    return {
      workId,
      ...(requirement === undefined ? {} : { requirementId: requirement.id }),
      version: declared?.productVersion ?? 0,
      source: 'declaration',
    };
  }

  /**
   * The current Plan version for a Work.
   *
   * A gate-approved Plan is the version a caller may actually write against, so it
   * wins over a bare declaration; a Product decision can never make an approved
   * Plan look current when the gate has none.
   */
  getCurrentPlanVersion(workId: string): PlanVersionRecord {
    const requirement = this.requirementOf(workId);
    const work = this.store.works.find(workId);
    const revision = work?.baseRevision ?? 'working-tree';
    const approved = this.gates.getCurrentPlanApproval(workId, revision);
    if (approved.status === 'approved' && approved.current !== undefined) {
      return {
        workId,
        ...(requirement === undefined ? {} : { requirementId: requirement.id }),
        version: approved.current.planRef.version,
        ref: approved.current.planRef,
        source: 'gate',
      };
    }
    if (requirement?.planRef !== undefined) {
      return {
        workId,
        requirementId: requirement.id,
        version: requirement.planRef.version,
        ref: requirement.planRef,
        source: 'requirement',
      };
    }
    return {
      workId,
      ...(requirement === undefined ? {} : { requirementId: requirement.id }),
      version: this.latestVersionRecord(workId)?.planVersion ?? 0,
      source: 'declaration',
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requirementOf(workId: string): Requirement | undefined {
    const work = this.store.works.find(workId);
    const requirementId = work?.requirementId;
    return requirementId === undefined ? undefined : this.store.requirements.find(requirementId);
  }

  /** The evidence a Product change touches, from the caller or the Plan refs. */
  private affectedRefsOf(
    input: RecordBehaviourDecisionInput,
    requirement: Requirement | undefined,
  ): readonly string[] {
    const refs = new Set<string>(input.affectedEvidenceRefs ?? []);
    if (requirement?.planRef !== undefined) refs.add(requirement.planRef.id);
    if (requirement?.productRef !== undefined) refs.add(requirement.productRef.id);
    return [...refs];
  }

  /** The next Product and Plan version, strictly above every version seen. */
  private nextVersions(
    workId: string,
    requirement: Requirement | undefined,
  ): { product: number; plan: number } {
    const declared = this.latestVersionRecord(workId);
    const requirementProduct = requirement?.productRef?.version ?? 0;
    const requirementPlan = requirement?.planRef?.version ?? 0;
    const planArtifacts = this.store.artifacts
      .list({ where: 'work_id = ? AND kind = ?', params: [workId, 'plan'] })
      .map((artifact) => artifact.artifactVersion);
    return {
      product: Math.max(requirementProduct, declared?.productVersion ?? 0) + 1,
      plan: Math.max(requirementPlan, declared?.planVersion ?? 0, ...planArtifacts) + 1,
    };
  }

  private latestVersionRecord(workId: string): VersionRecordPayload | undefined {
    const records = this.snapshotsOf(VERSION_SNAPSHOT_TYPE)
      .filter(isVersionRecord)
      .filter((entry) => entry['workId'] === workId);
    const latest = records.at(-1);
    if (latest === undefined) return undefined;
    return latest;
  }

  private snapshotsOf(type: string): JsonObject[] {
    const rows = this.store.db
      .prepare('SELECT payload FROM snapshot WHERE type = ? ORDER BY rowid ASC')
      .all(type) as { payload: string }[];
    const payloads: JsonObject[] = [];
    for (const row of rows) {
      try {
        payloads.push(JSON.parse(row.payload) as JsonObject);
      } catch {
        // A row this module did not write: skip it rather than fail the read.
        continue;
      }
    }
    return payloads;
  }

  /**
   * The immutable choice record (`data.md` §2 `decision`).
   *
   * `targetRef` points at the versioned thing the choice is about — the Requirement
   * that carries the acceptance, or the Work when no Requirement is bound yet.
   */
  private insertDecisionRow(
    input: RecordBehaviourDecisionInput,
    choice: BehaviourChoiceDecision,
    requirement: Requirement | undefined,
  ): Decision {
    const choices = [...new Set([input.choice, 'now', 'later', 'decline'])];
    return this.store.decisions.insert({
      workId: input.workId,
      kind: 'product',
      targetRef: {
        id: requirement?.id ?? input.workId,
        version: requirement?.recordVersion ?? 1,
        hash: sha256(canonicalJson([input.workId, input.summary, input.decidedAt])),
      },
      choices,
      state: choice.decision.state,
      choice: input.choice,
      actor: 'user',
      effectRefs: [...choice.invalidatedEvidenceRefs],
    });
  }

  private appendInvalidatedEvidence(
    input: RecordBehaviourDecisionInput,
    decision: Decision,
    invalidated: readonly string[],
    choice: BehaviourChoiceDecision,
  ): string {
    const payload: InvalidatedEvidencePayload = {
      kind: 'invalidated_evidence',
      schemaVersion: DECISION_RECORD_VERSION,
      workId: input.workId,
      decisionId: decision.id,
      invalidatedEvidenceRefs: [...invalidated],
      reusableEvidenceRefs: [...choice.reusableEvidenceRefs],
      recordedAt: input.decidedAt,
    };
    return this.appendSnapshot(
      INVALIDATED_EVIDENCE_SNAPSHOT_TYPE,
      payload as unknown as JsonObject,
    );
  }

  private queueRequirement(
    input: RecordBehaviourDecisionInput,
    decision: Decision,
    choice: BehaviourChoiceDecision,
  ): QueuedRequirementRecord {
    const queued = choice.queuedRequirement;
    if (queued === undefined) {
      fail('INTERNAL_ERROR', 'the `later` branch produced no queued Requirement');
    }
    const id = this.store.newId();
    const row = this.store.requirements.insert({
      id,
      title: queued.title,
      goal: queued.goal,
      lifecycle: 'queued',
      sourceRef: { kind: 'decision', id: decision.id, version: String(decision.version) },
      phase: 'product',
      recordVersion: 1,
      portableRef: {
        path: `.agentdev/requirements/${id}`,
        revision: `decision-${decision.id}`,
        hash: sha256(canonicalJson({ id, summary: input.summary })),
      },
      executionAvailability: 'needs_replan',
      evidenceAvailability: 'summary_only',
    });
    this.store.events.append({
      name: 'requirement.changed',
      entityId: row.id,
      entityVersion: row.version,
      data: {
        workId: input.workId,
        decisionId: decision.id,
        intent: input.queuedIntent ?? 'delivery',
        title: row.title,
        lifecycle: row.lifecycle,
      },
    });
    return {
      requirementId: row.id,
      title: row.title,
      goal: row.goal,
      lifecycle: 'queued',
      executionAvailability: 'needs_replan',
      recordVersion: row.recordVersion,
    };
  }

  /**
   * Marks the invalidated evidence invalid.
   *
   * Only artifacts are invalidated, and only ones that exist: a ref may name a
   * snapshot or an event, which are immutable history rather than a validity flag.
   */
  private invalidateArtifacts(refs: readonly string[], decisionId: string): void {
    for (const ref of refs) {
      const artifact = this.store.artifacts.find(ref);
      if (artifact === undefined || artifact.validity === 'invalid') continue;
      this.artifacts.invalidate(ref, `invalidated by behaviour Decision ${decisionId}`);
    }
  }

  /**
   * Freezes one record in the immutable `snapshot` table.
   *
   * The same payload under the same type is one row (`data.md` §2), so a retried
   * decision cannot accumulate duplicates.
   */
  private appendSnapshot(type: string, payload: JsonObject): string {
    const serialized = canonicalJson(payload);
    const hash = sha256(serialized);
    if (this.snapshotExists(hash)) return hash;
    this.store.db
      .prepare(
        'INSERT INTO snapshot (type, hash, payload, blob_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(type, hash, serialized, `snapshots/${type}/${hash}.json`, this.store.now());
    if (!this.snapshotExists(hash))
      fail('INTERNAL_ERROR', `snapshot ${hash} could not be read back`);
    return hash;
  }

  /** `snapshot` is keyed by hash, so existence is a direct lookup, not a repo find. */
  private snapshotExists(hash: string): boolean {
    const row = this.store.db
      .prepare('SELECT 1 AS present FROM snapshot WHERE hash = ? LIMIT 1')
      .get(hash) as { present: number } | undefined;
    return row !== undefined;
  }
}
