/**
 * The explicit L3 confirmation interaction (`docs/rules/workflow.md` §2.3/§3,
 * `docs/product/experience.md` §5, AC-011).
 *
 * `workflow.md` §2.3 routes identity/permission, Secret, security-boundary, data
 * deletion/migration, payment, incompatible public protocol, deploy/release and
 * project-gate-rule work to **L3**, and §3 makes the L3 code route
 * `Plan → Develop → Review → Test → Recovery → Settlement`. The product model in
 * force (`9c10d93`) keeps the agent on the host and reserves the approval
 * interaction for **irreversible operations**; an L3 delivery is exactly that: the
 * routing already decided the risk, and the user has to see what was routed before
 * the high-risk step is implemented.
 *
 * This module implements that interaction on the documented decision machinery —
 * no new protocol method:
 *
 * - **Detect**: an assessment whose level is `L3` is the routing decision the
 *   documented risk rules produced (`@agentdev/domain` `decideLevel`, re-applied
 *   by the orchestrator as a floor). The risk flags the routing carried are the
 *   evidence, and they are copied verbatim into the confirmation.
 * - **Raise**: one `kind='product'` Decision whose `targetRef` points at a real
 *   `kind='decision'` Artifact carrying the question (operation, Work, risk flags,
 *   what confirm/decline do). This is the same shape `protocol.md` §6 gives a Chief
 *   question, so the Inbox's existing `product`-decision card renders it with no
 *   parallel surface.
 * - **Hold**: the Decision is acknowledged as a blocker of the Work (the same
 *   `work.blockerIds` bookkeeping `permission.request` uses), and the Orchestrator
 *   refuses any professional Run of the Work until an accepted confirmation exists
 *   (`Orchestrator.confirmedL3`). Nothing about an L3 Work begins executing — not
 *   even the Plan stage — while the question is unanswered.
 * - **Answer**: `decision.resolve` with `confirm`/`decline` (the existing entry
 *   point, with its `expectedVersion` and idempotency semantics). Accepting clears
 *   the blocker and emits `work.control_changed(control='l3-confirmed')` so the
 *   route's next step can be queued by the ordinary continuation path; declining
 *   records the reason and leaves the Work `blocked` — a documented state
 *   (`workflow.md` §5.1) with a real recovery path, not a silent refusal.
 *
 * The frozen snapshot (`type='context'`, `payload.kind='l3_confirmation'`) is the
 * confirmation's own durable record: it pins the Decision, the question Artifact and
 * the exact risk flags/scope the user saw, so the audit can read user → decision →
 * execution in that order.
 */
import type { JsonObject, Requirement, Role, Work } from '@agentdev/contracts';
import { canTransitionWork } from '@agentdev/domain';
import { BlobStore, withTransaction, type ProjectStore } from '@agentdev/storage';
import { ArtifactService } from './artifacts.js';
import { canonicalJson } from './dispatcher.js';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';
import { SnapshotWriter } from './snapshots.js';

/** The snapshot type the confirmation record is frozen under. */
export const L3_CONFIRMATION_SNAPSHOT_TYPE = 'context';

/** The snapshot payload's own discriminator, so no other reader mistakes the row. */
export const L3_CONFIRMATION_RECORD_KIND = 'l3_confirmation';

/** The two answers the confirmation offers. */
export const L3_CONFIRMATION_CHOICES = ['confirm', 'decline'] as const;

/** Roles allowed to read the confirmation question (every role of the Work). */
const CONFIRMATION_ACL: readonly Role[] = [
  'chief',
  'product',
  'planning',
  'backend',
  'frontend',
  'review',
  'test',
  'settlement',
];

export type L3ConfirmationState = 'none' | 'pending' | 'accepted' | 'rejected';

export interface L3ConfirmationRecord {
  readonly workId: string;
  readonly decisionId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly artifactHash: string;
  /** The Work's revision when the confirmation was raised, for the audit trail. */
  readonly revision: string;
  /** The documented risk flags the routing produced, exactly as submitted. */
  readonly riskFlags: readonly string[];
  readonly reason: string;
  readonly scope: {
    readonly readPaths: readonly string[];
    readonly writePaths: readonly string[];
    readonly operations: readonly string[];
    readonly networkTargets: readonly string[];
  };
  readonly requirementId: string | null;
  readonly runId: string | null;
  readonly recordedAt: string;
}

export interface L3ConfirmationView extends L3ConfirmationRecord {
  /** The Decision's current state, read from the durable Decision row. */
  readonly state: L3ConfirmationState;
  readonly decisionVersion: number;
  /** `decline` only: the reason the user recorded. */
  readonly declineReason: string | null;
  /** The question text the user is answering. */
  readonly question: string;
}

export interface RaiseL3ConfirmationInput {
  readonly workId: string;
  readonly runId?: string;
  readonly riskFlags: readonly string[];
  readonly reason: string;
  readonly revision?: string;
  readonly scope: {
    readonly readPaths: readonly string[];
    readonly writePaths: readonly string[];
    readonly operations: readonly string[];
    readonly networkTargets: readonly string[];
  };
}

export interface L3DispatchVerdict {
  readonly allowed: boolean;
  /** Machine-readable reason: `none`/`pending`/`rejected` when `allowed` is false. */
  readonly state: L3ConfirmationState;
  readonly message: string;
  readonly decisionId: string | null;
}

interface ConfirmationPayload extends Record<string, unknown> {
  readonly kind: typeof L3_CONFIRMATION_RECORD_KIND;
  readonly schemaVersion: number;
  readonly workId: string;
  readonly decisionId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly artifactHash: string;
  readonly revision: string;
  readonly riskFlags: readonly string[];
  readonly reason: string;
  readonly scope: {
    readonly readPaths: readonly string[];
    readonly writePaths: readonly string[];
    readonly operations: readonly string[];
    readonly networkTargets: readonly string[];
  };
  readonly requirementId: string | null;
  readonly runId: string | null;
  readonly recordedAt: string;
  /**
   * The user's answer, frozen when it was applied.
   *
   * The Decision row holds `state`/`choice`, but a decline's *reason* is user input the
   * row has no column for: freezing it here (with the answer time) is what lets the
   * Inbox and the audit report why a high-risk delivery was refused after the fact.
   */
  readonly answer?: {
    readonly choice: string;
    readonly reason: string | null;
    readonly answeredAt: string;
  };
}

function fail(code: ProtocolErrorCode, message: string, details?: JsonObject): never {
  throw new ProtocolError(code, message, details === undefined ? {} : { details });
}

function isConfirmationPayload(payload: JsonObject): payload is JsonObject & ConfirmationPayload {
  return (
    payload['kind'] === L3_CONFIRMATION_RECORD_KIND &&
    typeof payload['workId'] === 'string' &&
    typeof payload['decisionId'] === 'string'
  );
}

/**
 * The question text one L3 confirmation asks (`experience.md` §5).
 *
 * It states the four facts the decision needs — what is being confirmed, which
 * Work/Requirement, why the routing calls it high risk, and what each answer does —
 * because the Inbox renders this body as the card's question and nothing else on the
 * page explains the L3 route.
 */
export function l3ConfirmationQuestion(input: {
  readonly workId: string;
  readonly goal: string;
  readonly requirementId: string | null;
  readonly level: string;
  readonly riskFlags: readonly string[];
  readonly reason: string;
  readonly revision: string;
  readonly scope: {
    readonly readPaths: readonly string[];
    readonly writePaths: readonly string[];
    readonly operations: readonly string[];
    readonly networkTargets: readonly string[];
  };
}): string {
  const list = (values: readonly string[], empty: string): string =>
    values.length === 0 ? empty : values.map((value) => `\`${value}\``).join('、');
  return [
    '# 请确认这次 L3 高风险交付',
    '',
    `路由把 Work \`${input.workId}\` 判为 **L3**（${input.level}）：${input.reason}`,
    '',
    '## 将要实施的范围',
    `- 目标：${input.goal}`,
    `- 写路径：${list(input.scope.writePaths, '（无显式写路径）')}`,
    `- 读路径：${list(input.scope.readPaths, '（无显式读路径）')}`,
    `- 操作：${list(input.scope.operations, '（无显式操作）')}`,
    `- 网络目标：${list(input.scope.networkTargets, '（无）')}`,
    '',
    '## 为什么是高风险',
    `命中的风险标记：${list(input.riskFlags, '（路由给出的等级为 L3，但未带风险标记）')}`,
    '',
    '## 关联对象',
    `- Work：\`${input.workId}\``,
    `- Requirement：${input.requirementId === null ? '（本 Work 尚无 Requirement）' : `\`${input.requirementId}\``}`,
    `- 修订：\`${input.revision}\``,
    '',
    '## 你的选择',
    '- **confirm**：确认这次 L3 高风险交付，路由继续，我按已批准的范围实施。',
    '- **decline**：拒绝这次交付；请说明原因（例如风险不可接受），Work 停在 `blocked(decision)`，不会实施。',
    '',
    '在确认之前，本 Work 不会开始执行（Plan/Develop 等步骤都不会入队）。',
  ].join('\n');
}

/**
 * The L3 confirmation's durable record, decision row and blocker bookkeeping.
 *
 * Every write here is transactional with its event, like the rest of Core
 * (`reliability.md` §1). The service holds no state: the frozen snapshot plus the
 * Decision row are the whole record.
 */
export class L3ConfirmationService {
  private readonly store: ProjectStore;
  private readonly artifacts: ArtifactService;
  private readonly snapshots: SnapshotWriter;

  constructor(options: {
    readonly store: ProjectStore;
    readonly artifacts?: ArtifactService;
    readonly blobs?: BlobStore;
    readonly snapshots?: SnapshotWriter;
  }) {
    this.store = options.store;
    const blobs = options.blobs ?? new BlobStore({ root: options.store.dataDir });
    this.artifacts = options.artifacts ?? new ArtifactService({ store: options.store, blobs });
    this.snapshots = options.snapshots ?? new SnapshotWriter({ store: options.store });
  }

  /** Whether the documented risk rules routed this Work to L3. */
  requiresConfirmation(workId: string): boolean {
    const work = this.store.works.find(workId);
    return work !== undefined && work.level === 'L3';
  }

  /**
   * The confirmation record currently standing for one Work, newest first.
   *
   * A Work may accumulate more than one record (a re-assessment after a declined or
   * expired confirmation raises a fresh question), so the latest one is the one the
   * gate and the Inbox read.
   */
  latest(workId: string): L3ConfirmationView | undefined {
    const payload = this.latestPayload(workId);
    if (payload === undefined) return undefined;
    const decision = this.store.decisions.find(payload.decisionId);
    const state: L3ConfirmationState =
      decision === undefined
        ? // A record whose Decision row is gone can never be accepted again: reading
          // it as `none` would re-raise the question, which is the fail-closed answer.
          'none'
        : decision.state === 'pending'
          ? 'pending'
          : decision.state === 'accepted'
            ? 'accepted'
            : 'rejected';
    const artifact = this.store.artifacts.find(payload.artifactId);
    return {
      workId: payload.workId,
      decisionId: payload.decisionId,
      artifactId: payload.artifactId,
      artifactVersion: payload.artifactVersion,
      artifactHash: payload.artifactHash,
      revision: payload.revision,
      riskFlags: [...payload.riskFlags],
      reason: payload.reason,
      scope: {
        readPaths: [...payload.scope.readPaths],
        writePaths: [...payload.scope.writePaths],
        operations: [...payload.scope.operations],
        networkTargets: [...payload.scope.networkTargets],
      },
      requirementId: payload.requirementId,
      runId: payload.runId,
      recordedAt: payload.recordedAt,
      state,
      decisionVersion: decision?.version ?? 1,
      declineReason:
        decision?.state === 'rejected' ? (payload.answer?.reason ?? decision.choice ?? null) : null,
      question:
        artifact === undefined ? '' : Buffer.from(this.artifacts.read(artifact)).toString('utf8'),
    };
  }

  /** `true` when the Work is L3 and no accepted confirmation stands for it. */
  pending(workId: string): boolean {
    if (!this.requiresConfirmation(workId)) return false;
    return this.latest(workId)?.state !== 'accepted';
  }

  /**
   * The confirmation record behind one Decision id, when there is one.
   *
   * This is how a caller that only holds a Decision — the Inbox's `decision.resolve`
   * — tells an L3 confirmation apart from the other `product` Decisions, without a
   * second registry: the record is the same frozen payload the gate reads.
   */
  find(decisionId: string): L3ConfirmationView | undefined {
    const payload = this.payloadForDecision(decisionId);
    if (payload === undefined) return undefined;
    const decision = this.store.decisions.find(decisionId);
    const state: L3ConfirmationState =
      decision === undefined
        ? 'none'
        : decision.state === 'pending'
          ? 'pending'
          : decision.state === 'accepted'
            ? 'accepted'
            : 'rejected';
    return this.view(payload, state, decision?.version ?? 1, decision?.choice ?? null);
  }

  /**
   * The Orchestrator's admission question: may this Work's high-risk step run?
   *
   * `allowed` is true for every Work the risk rules did not route to L3, so the
   * guard costs L1/L2 nothing. For an L3 Work the answer is `false` until a
   * confirmation is accepted, and the message names the exact next action.
   */
  admitDispatch(workId: string): L3DispatchVerdict {
    if (!this.requiresConfirmation(workId)) {
      return { allowed: true, state: 'none', message: '', decisionId: null };
    }
    const latest = this.latest(workId);
    if (latest === undefined || latest.state === 'none') {
      return {
        allowed: false,
        state: latest?.state ?? 'none',
        message: `Work ${workId} routes L3 (high-risk delivery) and has no explicit user confirmation yet; Core raised the confirmation Decision when the routing assessment was recorded, and will admit the implementation once it is accepted`,
        decisionId: latest?.decisionId ?? null,
      };
    }
    if (latest.state === 'pending') {
      return {
        allowed: false,
        state: 'pending',
        message: `Work ${workId} routes L3 and its confirmation Decision ${latest.decisionId} is still pending; resolve it in the Inbox (confirm/decline) before the implementation is admitted`,
        decisionId: latest.decisionId,
      };
    }
    if (latest.state === 'rejected') {
      return {
        allowed: false,
        state: 'rejected',
        message: `Work ${workId} routes L3 and the user declined confirmation ${latest.decisionId}; the Work stays blocked and the high-risk step is not implemented`,
        decisionId: latest.decisionId,
      };
    }
    return { allowed: true, state: 'accepted', message: '', decisionId: latest.decisionId };
  }

  /**
   * Raises the confirmation for one L3 Work when none is pending.
   *
   * Called from the orchestrator's assessment transaction: the routing decision is
   * what makes the question real, so the question and the routing commit together.
   * An existing pending confirmation is left alone, so a re-assessment cannot mint a
   * second question for the same hold.
   */
  sync(
    input: RaiseL3ConfirmationInput & { readonly goal: string },
  ): L3ConfirmationView | undefined {
    if (!this.requiresConfirmation(input.workId)) return undefined;
    const existing = this.latest(input.workId);
    if (existing !== undefined && (existing.state === 'pending' || existing.state === 'accepted')) {
      return existing;
    }
    return this.raise(input);
  }

  /**
   * Raises one confirmation question and parks the Work on it.
   *
   * The Work is moved to `blocked` (the documented state for a Work waiting on a
   * Decision, `workflow.md` §5.1) and the Decision is recorded in `blockerIds` — the
   * same bookkeeping `permission.request` uses, so the Work's own row shows why it
   * is parked.
   */
  raise(input: RaiseL3ConfirmationInput & { readonly goal: string }): L3ConfirmationView {
    return withTransaction(this.store.db, () => this.raiseTx(input));
  }

  private raiseTx(input: RaiseL3ConfirmationInput & { readonly goal: string }): L3ConfirmationView {
    const work = this.store.works.find(input.workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${input.workId} does not exist`);
    if (work.level !== 'L3') {
      fail(
        'INVALID_STATE',
        `Work ${work.id} is ${work.level}; only an L3 Work needs confirmation`,
        {
          workId: work.id,
          level: work.level,
        },
      );
    }
    const requirement = this.requirementOf(work);
    const revision = input.revision ?? work.baseRevision ?? 'working-tree';
    const recordedAt = this.store.now();
    const scope = {
      readPaths: [...input.scope.readPaths],
      writePaths: [...input.scope.writePaths],
      operations: [...input.scope.operations],
      networkTargets: [...input.scope.networkTargets],
    };
    const question = l3ConfirmationQuestion({
      workId: work.id,
      goal: input.goal,
      requirementId: requirement?.id ?? null,
      level: work.level,
      riskFlags: [...input.riskFlags],
      reason: input.reason,
      revision,
      scope,
    });
    const runId = this.producingRunId(work, input.runId);
    if (runId === undefined) {
      // `origin=agent` requires the producing Run (`data.md` §2), and a routing
      // assessment always arrives from the Work's Chief Run. A Work without any Chief
      // Run is a stack that never routed anything, so the confirmation is refused
      // rather than written with a dangling producer.
      fail(
        'MISSING_CONTEXT',
        `Work ${work.id} routes L3 but has no Chief Run to raise the confirmation from`,
        { workId: work.id },
      );
    }
    const artifact = this.artifacts.createAgent({
      run: { id: runId, workId: work.id, role: 'chief' },
      kind: 'decision',
      mime: 'text/markdown',
      bytes: Buffer.from(question, 'utf8'),
      acl: CONFIRMATION_ACL,
    });
    const decision = this.store.decisions.insert({
      projectId: work.projectId,
      workId: work.id,
      kind: 'product',
      targetRef: { id: artifact.id, version: artifact.version, hash: artifact.contentHash },
      choices: [...L3_CONFIRMATION_CHOICES],
      state: 'pending',
      actor: 'user',
      effectRefs: [artifact.id],
    });
    const payload: ConfirmationPayload = {
      kind: L3_CONFIRMATION_RECORD_KIND,
      schemaVersion: 1,
      workId: work.id,
      decisionId: decision.id,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      artifactHash: artifact.contentHash,
      revision,
      riskFlags: [...input.riskFlags],
      reason: input.reason,
      scope,
      requirementId: requirement?.id ?? null,
      runId: input.runId ?? null,
      recordedAt,
    };
    this.freezeConfirmation(payload);
    // The Work is parked on the Decision. `running → blocked` is the documented
    // transition for a Work waiting on a Decision, and a Work whose routing has only
    // just been recorded is parked from `queued`; both are real edges of
    // `WORK_TRANSITIONS` (`workflow.md` §5.1). A Work already parked or cancelling is
    // left in its own state rather than pushed across an illegal edge, and the blocker
    // plus the dispatch guard still hold it.
    const parked =
      (work.status === 'running' && canTransitionWork('running', 'blocked')) ||
      (work.status === 'queued' && canTransitionWork('queued', 'blocked'))
        ? this.store.works.update(work.id, { status: 'blocked' }, work.version)
        : work;
    const blocked = parked.blockerIds.includes(decision.id)
      ? parked
      : this.store.works.update(
          parked.id,
          { blockerIds: [...parked.blockerIds, decision.id] },
          parked.version,
        );
    this.store.events.append({
      name: 'decision.created',
      entityId: decision.id,
      entityVersion: decision.version,
      data: {
        workId: work.id,
        decisionId: decision.id,
        kind: 'l3_confirmation',
        level: work.level,
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        choices: [...L3_CONFIRMATION_CHOICES],
        riskFlags: [...input.riskFlags],
        reason: input.reason,
        revision,
        requirementId: requirement?.id ?? null,
      },
    });
    this.store.events.append({
      name: 'work.control_changed',
      entityId: blocked.id,
      entityVersion: blocked.version,
      data: {
        workId: work.id,
        control: 'l3-confirmation-required',
        status: blocked.status,
        decisionId: decision.id,
        reason: input.reason,
        riskFlags: [...input.riskFlags],
      },
    });
    return {
      workId: work.id,
      decisionId: decision.id,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      artifactHash: artifact.contentHash,
      revision,
      riskFlags: [...input.riskFlags],
      reason: input.reason,
      scope,
      requirementId: requirement?.id ?? null,
      runId: input.runId ?? null,
      recordedAt,
      state: 'pending',
      decisionVersion: decision.version,
      declineReason: null,
      question,
    };
  }

  /**
   * Applies the user's answer to one confirmation Decision.
   *
   * `confirm` accepts the Decision, clears the blocker and resumes the Work; the
   * route's next step is then queued by the ordinary continuation path, so no manual
   * restart exists. `decline` rejects the Decision, records the reason on the
   * `decision.resolved` event (the frozen `reason` column is not the audit channel
   * for an answer) and leaves the Work `blocked`.
   *
   * @returns the resolved record and whether the Work may now execute.
   */
  resolve(input: {
    readonly decisionId: string;
    readonly choice: string;
    readonly reason?: string;
    readonly at?: string;
  }): {
    readonly confirmation: L3ConfirmationView;
    readonly accepted: boolean;
    readonly work: Work;
  } {
    return withTransaction(this.store.db, () => this.resolveTx(input));
  }

  private resolveTx(input: {
    readonly decisionId: string;
    readonly choice: string;
    readonly reason?: string;
    readonly at?: string;
  }): {
    readonly confirmation: L3ConfirmationView;
    readonly accepted: boolean;
    readonly work: Work;
  } {
    const decision = this.store.decisions.find(input.decisionId);
    if (decision === undefined) {
      fail('NOT_FOUND', `Decision ${input.decisionId} does not exist`, {
        decisionId: input.decisionId,
      });
    }
    const payload = this.payloadForDecision(decision.id);
    if (payload === undefined) {
      fail('INVALID_STATE', `Decision ${decision.id} is not an L3 confirmation`, {
        decisionId: decision.id,
      });
    }
    if (decision.state !== 'pending') {
      fail('INVALID_STATE', `Decision ${decision.id} is already ${decision.state}`, {
        decisionId: decision.id,
        state: decision.state,
      });
    }
    const accepted = input.choice === 'confirm';
    const work = this.store.works.find(payload.workId);
    if (work === undefined) fail('NOT_FOUND', `Work ${payload.workId} does not exist`);
    const answeredAt = new Date().toISOString();
    const resolved = this.store.decisions.update(
      decision.id,
      { state: accepted ? 'accepted' : 'rejected', choice: input.choice },
      decision.version,
    );
    // The answer becomes part of the immutable record: `confirm` stores the acceptance,
    // `decline` stores the reason the user gave, so both survive a later re-read.
    const answered: ConfirmationPayload = {
      ...payload,
      answer: {
        choice: input.choice,
        reason: accepted ? null : (input.reason ?? null),
        answeredAt,
      },
    };
    this.freezeConfirmation(answered);
    // Accepting lifts the hold: the Decision leaves the Work's blockers and a parked
    // Work resumes. Declining leaves the blocker in place (the Work is still blocked on
    // this refused Decision, `workflow.md` §5.1) and makes sure the Work is `blocked`
    // rather than looking runnable.
    let resumed: Work;
    if (accepted) {
      const cleared =
        work.blockerIds.length === 0
          ? work
          : this.store.works.update(
              work.id,
              { blockerIds: work.blockerIds.filter((id) => id !== decision.id) },
              work.version,
            );
      resumed =
        cleared.status === 'blocked' || cleared.status === 'paused'
          ? this.store.works.update(cleared.id, { status: 'running' }, cleared.version)
          : cleared;
    } else {
      resumed =
        (work.status === 'running' && canTransitionWork('running', 'blocked')) ||
        (work.status === 'queued' && canTransitionWork('queued', 'blocked'))
          ? this.store.works.update(work.id, { status: 'blocked' }, work.version)
          : work;
    }
    this.store.events.append({
      name: 'decision.resolved',
      entityId: resolved.id,
      entityVersion: resolved.version,
      data: {
        decisionId: resolved.id,
        workId: payload.workId,
        kind: 'l3_confirmation',
        choice: input.choice,
        state: resolved.state,
        targetVersion: resolved.targetRef.version,
        // `decline` must record why (`experience.md` §5); `confirm` carries none.
        reason: input.reason ?? null,
      },
    });
    this.store.events.append({
      name: 'work.control_changed',
      entityId: resumed.id,
      entityVersion: resumed.version,
      data: {
        workId: payload.workId,
        control: accepted ? 'l3-confirmed' : 'l3-declined',
        status: resumed.status,
        decisionId: resolved.id,
        reason: input.reason ?? null,
      },
    });
    return {
      confirmation: {
        ...this.view(
          answered,
          // The transaction just wrote the state, so it is one of the two answers;
          // `expired` cannot be produced here.
          accepted ? 'accepted' : 'rejected',
          resolved.version,
          resolved.choice ?? null,
        ),
      },
      accepted,
      work: resumed,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private view(
    payload: ConfirmationPayload,
    state: L3ConfirmationState,
    decisionVersion: number,
    declineReason: string | null,
  ): L3ConfirmationView {
    return {
      workId: payload.workId,
      decisionId: payload.decisionId,
      artifactId: payload.artifactId,
      artifactVersion: payload.artifactVersion,
      artifactHash: payload.artifactHash,
      revision: payload.revision,
      riskFlags: [...payload.riskFlags],
      reason: payload.reason,
      scope: {
        readPaths: [...payload.scope.readPaths],
        writePaths: [...payload.scope.writePaths],
        operations: [...payload.scope.operations],
        networkTargets: [...payload.scope.networkTargets],
      },
      requirementId: payload.requirementId,
      runId: payload.runId,
      recordedAt: payload.recordedAt,
      state,
      decisionVersion,
      declineReason: payload.answer?.reason ?? declineReason,
      question: this.questionOf(payload.artifactId),
    };
  }

  private questionOf(artifactId: string): string {
    const artifact = this.store.artifacts.find(artifactId);
    return artifact === undefined
      ? ''
      : Buffer.from(this.artifacts.read(artifact)).toString('utf8');
  }

  private requirementOf(work: Work): Requirement | undefined {
    return work.requirementId === undefined
      ? undefined
      : this.store.requirements.find(work.requirementId);
  }

  /**
   * The Run the question Artifact is attributed to: the Chief Run when it is known.
   *
   * An `origin=agent` Artifact references the producing Run (`data.md` §2), so a Work
   * whose Chief Run is not readable (a fixture, or a stack that predates it) gets an
   * unattributed question rather than a row that violates that reference. A real
   * assessment always arrives from the Work's own Chief Run, which is the first branch.
   */
  private producingRunId(work: Work, runId: string | undefined): string | undefined {
    if (runId !== undefined && this.store.runs.find(runId) !== undefined) return runId;
    const chief = this.store.runs
      .list({ where: "work_id = ? AND role = 'chief'", params: [work.id] })
      .at(-1);
    return chief?.id;
  }

  /**
   * The newest record for one Decision.
   *
   * A resolved confirmation is re-frozen with its answer, so a Decision can have two
   * rows (the raised question and the answered record); the newest one is the record
   * that states why the user answered as they did.
   */
  private payloadForDecision(decisionId: string): ConfirmationPayload | undefined {
    let latest: ConfirmationPayload | undefined;
    for (const payload of this.confirmationRows()) {
      if (payload.decisionId === decisionId) latest = payload;
    }
    return latest;
  }

  private latestPayload(workId: string): ConfirmationPayload | undefined {
    let latest: ConfirmationPayload | undefined;
    for (const payload of this.confirmationRows()) {
      if (payload.workId !== workId) continue;
      latest = payload;
    }
    return latest;
  }

  /** Every frozen confirmation record, oldest first. */
  private confirmationRows(): ConfirmationPayload[] {
    const rows: ConfirmationPayload[] = [];
    for (const row of this.store.snapshots.list({
      where: 'type = ?',
      params: [L3_CONFIRMATION_SNAPSHOT_TYPE],
      orderBy: 'rowid ASC',
    })) {
      if (isConfirmationPayload(row.payload)) rows.push(row.payload);
    }
    return rows;
  }

  /** Freezes one confirmation record in the immutable `snapshot` table. */
  private freezeConfirmation(payload: ConfirmationPayload): string {
    return this.snapshots.freeze(
      L3_CONFIRMATION_SNAPSHOT_TYPE,
      JSON.parse(canonicalJson(payload)) as JsonObject,
    ).hash;
  }
}
