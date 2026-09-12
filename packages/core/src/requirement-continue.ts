/**
 * Continuing a Git-imported `active` Requirement (AC-089,
 * `docs/product/requirements.md` §4, `docs/rules/workflow.md` §5.1).
 *
 * A Requirement that exists in Git as `active` but has no local Work is a real
 * historical state, not a running one: the import keeps it as
 * `executionAvailability='needs_replan'` with no phase and starts nothing. This
 * module owns the two halves of the documented behaviour:
 *
 * - `listContinuable()` reports those records as *waiting to continue*. It is a
 *   pure projection read: no Work, no Run, no snapshot and no event is created by
 *   looking at the queue.
 * - `continueRequirement()` creates the new local Work, records the **local**
 *   authorization the user's continue command grants, moves the Requirement to
 *   `local` and returns every Gate that is still unmet. The previous server's
 *   verification is a Git summary only (`evidenceAvailability='summary_only'`) and
 *   is never reused as this server's evidence: the stage chain is evaluated with
 *   no Manifests, so Plan/Develop/Review/Test/Settlement all come back as
 *   `GATE_NOT_READY` (`requirements.md` §4 "旧Task进度不用于放行").
 */
import {
  LIMITS,
  type Authorization,
  type Level,
  type OperationName,
  type Phase,
  type Requirement,
  type Scope,
  type SourceRef,
  type Work,
} from '@agentdev/contracts';
import { evaluateStageChain, type DeliveryRoute, type StageChainGapCode } from '@agentdev/domain';
import { withTransaction, type ProjectStore } from '@agentdev/storage';

/** One local continuation candidate: an active Git record with no local Work. */
export interface ContinuableRequirement {
  readonly requirementId: string;
  readonly title: string;
  readonly goal: string;
  readonly lifecycle: 'active';
  readonly executionAvailability: 'needs_replan';
  /** The UI state of `requirements.md` §4: "迭代中需求，标待继续". */
  readonly waitingToContinue: true;
  /** Active records imported without a local site have no phase yet. */
  readonly phase: Phase | null;
  readonly recordVersion: number;
  readonly portableRef: Requirement['portableRef'];
  readonly sourceRef: SourceRef;
  readonly evidenceAvailability: Requirement['evidenceAvailability'];
}

export interface ListContinuableResult {
  readonly items: readonly ContinuableRequirement[];
}

export interface ContinueRequirementInput {
  readonly requirementId: string;
  /**
   * The user's continue command.
   *
   * It must resolve to a local `user_action` or user `message` row: the new
   * execution needs a real, local authorization source (`requirements.md` §4
   * "重新取得环境/执行授权"), and an agent cannot forge one.
   */
  readonly authorizationRef: string;
  readonly goal?: string;
  readonly scope?: Scope;
  readonly operations?: readonly OperationName[];
  /** Delivery level of the new Work; `L2` unless the user's command says more. */
  readonly level?: Level;
  /** Delivery route the unmet-Gate evaluation uses; `code` by default. */
  readonly route?: DeliveryRoute;
  readonly baseRevision?: string;
  readonly budget?: {
    readonly tokenLimit?: number;
    readonly activeTimeLimit?: number;
    readonly repairLimit?: number;
  };
  readonly at?: string;
}

/** One Gate that is not satisfied on this server and must be re-run. */
export interface UnmetGate {
  readonly gate: string;
  readonly code: StageChainGapCode;
  readonly message: string;
}

export interface ContinuedRequirement {
  readonly ok: true;
  readonly requirement: Requirement;
  readonly work: Work;
  readonly authorization: Authorization;
  /** Every stage this server must re-plan and re-verify, in route order. */
  readonly unmetGates: readonly UnmetGate[];
  readonly route: DeliveryRoute;
  readonly level: Level;
  /** The first local phase: the Product/Plan baseline has to be re-established. */
  readonly firstGate: 'product';
  readonly requiresReplan: true;
  readonly requiresReverification: true;
  /** Always false: the previous local verification is never imported as evidence. */
  readonly reusedPreviousVerification: false;
  readonly reusedManifestIds: readonly string[];
  readonly evidenceAvailability: Requirement['evidenceAvailability'];
}

export type ContinueRequirementResult =
  | ContinuedRequirement
  | {
      readonly ok: false;
      readonly code: 'NOT_FOUND' | 'INVALID_STATE' | 'NOT_AUTHORIZED' | 'VALIDATION_ERROR';
      readonly message: string;
      readonly gaps: readonly string[];
    };

function refusal(
  code: 'NOT_FOUND' | 'INVALID_STATE' | 'NOT_AUTHORIZED' | 'VALIDATION_ERROR',
  message: string,
): ContinueRequirementResult {
  return { ok: false, code, message, gaps: [message] };
}

/** The default authority a continue command records when the caller names none. */
const DEFAULT_OPERATIONS: readonly OperationName[] = ['read', 'edit'];

/** The service that reads the continuation queue and opens the new local Work. */
export class RequirementContinuation {
  private readonly store: ProjectStore;

  constructor(options: { readonly store: ProjectStore }) {
    this.store = options.store;
  }

  /**
   * The active Git records waiting for a local continuation.
   *
   * Read-only by construction: it lists the Requirement projection and creates
   * nothing (`requirements.md` §4 "导入不自动创建Run、恢复工具或迁移授权").
   */
  listContinuable(): ListContinuableResult {
    const rows = this.store.requirements.list({
      where: "lifecycle = 'active' AND work_id IS NULL AND execution_availability = 'needs_replan'",
      orderBy: 'created_at ASC',
    });
    return {
      items: rows.map((row) => ({
        requirementId: row.id,
        title: row.title,
        goal: row.goal,
        lifecycle: 'active',
        executionAvailability: 'needs_replan',
        waitingToContinue: true,
        phase: row.phase ?? null,
        recordVersion: row.recordVersion,
        portableRef: row.portableRef,
        sourceRef: row.sourceRef,
        evidenceAvailability: row.evidenceAvailability,
      })),
    };
  }

  /**
   * Creates the new local Work for an imported `active` Requirement.
   *
   * Refuses a record that is not `active` and a record that already has a local
   * Work: continuing is a one-way transition that only a `needs_replan` record can
   * take. The Work, its budget, its authorization, the Requirement binding and the
   * event all commit together.
   */
  continueRequirement(input: ContinueRequirementInput): ContinueRequirementResult {
    if (input.authorizationRef.trim().length === 0) {
      return refusal('VALIDATION_ERROR', 'continuing a Requirement needs an authorization source');
    }
    return withTransaction(this.store.db, () => this.continueTx(input));
  }

  private continueTx(input: ContinueRequirementInput): ContinueRequirementResult {
    const requirement = this.store.requirements.find(input.requirementId);
    if (requirement === undefined) {
      return refusal('NOT_FOUND', `Requirement ${input.requirementId} does not exist`);
    }
    if (requirement.lifecycle !== 'active') {
      return refusal(
        'INVALID_STATE',
        `Requirement ${requirement.id} is ${requirement.lifecycle}; only an active Requirement continues`,
      );
    }
    if (requirement.workId !== undefined) {
      return refusal(
        'INVALID_STATE',
        `Requirement ${requirement.id} already has the local Work ${requirement.workId}`,
      );
    }
    const source = this.authorizationSource(input.authorizationRef);
    if (source === undefined) {
      return refusal(
        'NOT_AUTHORIZED',
        `authorization ${input.authorizationRef} is not a local user action or message`,
      );
    }

    const level: Level = input.level ?? 'L2';
    const route: DeliveryRoute = input.route ?? 'code';
    const at = input.at ?? this.store.now();
    const scope: Scope = input.scope ?? {
      readPaths: [],
      writePaths: [],
      operations: [...DEFAULT_OPERATIONS],
      networkTargets: [],
    };
    const operations = [...(input.operations ?? DEFAULT_OPERATIONS)];
    const goal = input.goal ?? requirement.goal;
    const sourceRef: SourceRef = { kind: source.kind, id: source.id, version: '1' };

    // The budget is created first with the pre-generated Work id, because the Work
    // row references it (`data.md` §2, the FK is deferred inside one transaction).
    const workId = this.store.newId();
    const budget = this.store.budgets.insert({
      projectId: this.store.projectId,
      workId,
      tokenLimit: input.budget?.tokenLimit ?? LIMITS.workInputOutputTokens.default,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: input.budget?.activeTimeLimit ?? LIMITS.workActiveTimeSec.default,
      activeTimeUsed: 0,
      repairLimit: input.budget?.repairLimit ?? LIMITS.reviewRepairRounds.default,
      repairUsed: 0,
      costKnown: true,
    });
    const inserted = this.store.works.insert({
      id: workId,
      projectId: this.store.projectId,
      intent: 'delivery',
      purpose: `continue requirement ${requirement.id}`,
      level,
      goal,
      scope,
      ...(source.kind === 'message' ? { sourceMessageId: source.id } : {}),
      sourceRef,
      requirementId: requirement.id,
      status: 'queued',
      blockerIds: [],
      ...(input.baseRevision === undefined ? {} : { baseRevision: input.baseRevision }),
      budgetId: budget.id,
      policyRevision: 1,
    });
    const authorization = this.store.authorizations.insert({
      projectId: this.store.projectId,
      sourceRef,
      workId: inserted.id,
      goal,
      scope,
      operations,
      acceptedAt: at,
    });
    const work = this.store.works.update(
      inserted.id,
      { authorizationRef: authorization.id },
      inserted.version,
    );

    // The Requirement now has a local site: `local` availability, the Product phase
    // first, and a bumped record version so the Git projection can follow.
    const updated = this.store.requirements.update(
      requirement.id,
      {
        workId: work.id,
        executionAvailability: 'local',
        phase: 'product',
        recordVersion: requirement.recordVersion + 1,
      },
      requirement.version,
    );

    // The unmet Gates are evaluated with **no** Manifests: the previous server's
    // Review/Test results are not local evidence, so every stage is `GATE_NOT_READY`
    // and nothing can be reused (`workflow.md` §5.1, AC-089).
    const chain = evaluateStageChain({
      route,
      level,
      manifests: [],
      requirement: { requirementId: requirement.id, previousLevel: level },
    });
    const unmetGates: UnmetGate[] = chain.ok
      ? []
      : chain.gaps.map((gap) => ({
          gate: gap.stage ?? gap.code,
          code: gap.code,
          message: gap.message,
        }));

    this.store.events.append({
      name: 'requirement.changed',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        requirementId: updated.id,
        workId: work.id,
        lifecycle: updated.lifecycle,
        executionAvailability: updated.executionAvailability,
        phase: updated.phase ?? null,
        recordVersion: updated.recordVersion,
        authorizationRef: authorization.id,
        authorizationSource: `${source.kind}:${source.id}`,
        level,
        route,
        unmetGates: unmetGates.map((entry) => ({
          gate: entry.gate,
          code: entry.code,
          message: entry.message,
        })),
        reusedPreviousVerification: false,
        continuedAt: at,
      },
    });

    return {
      ok: true,
      requirement: updated,
      work,
      authorization,
      unmetGates,
      route,
      level,
      firstGate: 'product',
      requiresReplan: true,
      requiresReverification: true,
      reusedPreviousVerification: false,
      reusedManifestIds: [],
      evidenceAvailability: updated.evidenceAvailability,
    };
  }

  /** Resolves the continue command to a local user action or user message. */
  private authorizationSource(
    reference: string,
  ): { readonly kind: 'action' | 'message'; readonly id: string } | undefined {
    if (this.store.userActions.find(reference) !== undefined) {
      return { kind: 'action', id: reference };
    }
    const message = this.store.messages.find(reference);
    if (message !== undefined && message.sender === 'user') {
      return { kind: 'message', id: reference };
    }
    return undefined;
  }
}
