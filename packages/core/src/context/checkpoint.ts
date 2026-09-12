/**
 * The Run Checkpoint (`docs/architecture/context.md` §5, `docs/architecture/data.md`
 * §2 `attempt.checkpoint_ref`, `docs/rules/agents.md` §6).
 *
 * `context.md` §5 fixes both the field list and the ownership rule:
 *
 * > 跨物理Session保存Checkpoint字段：work/task/stage、有效Manifest、pending
 * > decisions、artifact refs、last tool outcome、next action、recent messages refs。
 * > Checkpoint仅来自当前Run，用于暂停/恢复；正式事实总是从有效引用重建。
 * > …权限、规则和阶段所需事实由新Snapshot重建，Compaction不能改变批准状态。
 * > Reviewer不能访问其他Run的Session/Checkpoint。
 *
 * The module therefore does three things and nothing else:
 *
 * 1. **`checkpoint.ts` owns the shape.** `Checkpoint` carries exactly the documented
 *    fields plus the Run/role/session identity a reader needs to answer "may I read
 *    this?" without a database. `validateCheckpoint` refuses a malformed checkpoint
 *    with `VALIDATION_ERROR` and never repairs one.
 * 2. **Ownership is enforced on both directions.** `CheckpointStore.save` refuses a
 *    checkpoint whose `runId` is not the saving Run (`CONTEXT_FORBIDDEN`), and
 *    `CheckpointStore.load` answers `CONTEXT_FORBIDDEN` with **no content** for a
 *    different Run, a different Project or a different role — a Reviewer/Test Run
 *    therefore cannot read another Run's checkpoint or its session refs
 *    (`AC-033`, `AC-034`, `AC-035`).
 * 3. **Compaction is a lossy summary, never an authority.** `compactCheckpoint`
 *    drops the oldest message refs and *nothing else*: the valid Manifest,
 *    pending decisions and `approval` state come through by identity, so a
 *    compaction/summary step cannot flip an approval (`AC-035`). `summaryOf`
 *    deliberately does not expose `approval` at all.
 *
 * The store keeps the same frozen objects in memory (the `attempt.checkpoint_ref`
 * pointer in production is the snapshot hash `checkpointHash` returns), so a
 * session rotation only changes *which physical session* reads the checkpoint, not
 * what the checkpoint says.
 */
import type { DecisionState, Hash, Ref, Role, SourceRef, Time } from '@agentdev/contracts';
import { nowIso, sha256 } from '@agentdev/storage';
import { canonicalJson } from '../dispatcher.js';
import type { ContextError, ContextResult, ContextStage } from './types.js';

/** Lowercase SHA256, the only hash form `data.md` §1 admits. */
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

/** UTC ISO8601 with millisecond precision (`data.md` §1). */
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Project ids are 32 lowercase hex (`data.md` §1/§2). */
const PROJECT_ID_PATTERN = /^[0-9a-f]{32}$/u;

/** Business decision states (`contracts.DecisionState`). */
const DECISION_STATES: readonly DecisionState[] = ['pending', 'accepted', 'rejected', 'expired'];

/** The approval dimension a summary/compaction must never change (`§5`). */
export const APPROVAL_STATES = ['pending', 'approved', 'rejected'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/**
 * The explicit approval record a checkpoint carries.
 *
 * `context.md` §5 says compaction cannot change 批准状态, so the state is a field of
 * the checkpoint rather than something inferred from the message list a compaction
 * rewrites. `authorizationRef` is the Work/Decision authorization the approval
 * belongs to, so a rotated session can prove *what* was approved.
 */
export interface CheckpointApproval {
  readonly state: ApprovalState;
  /** `authorizationRef`/Decision the approval came from, when there is one. */
  readonly authorizationRef?: Ref;
  /** Last change of this field; a compaction never updates it. */
  readonly decidedAt: Time;
  /** The role whose model/plan approval this is. */
  readonly role: Role;
}

/** One open product/permission/risk/budget decision carried across a session. */
export interface CheckpointDecision {
  readonly id: string;
  readonly kind: 'product' | 'start' | 'permission' | 'risk' | 'budget' | 'recovery';
  readonly state: DecisionState;
  readonly summary: string;
  readonly targetRef?: Ref;
  readonly requestedAt: Time;
}

/** One Artifact the resumed Run still needs, with its frozen version pin. */
export interface CheckpointArtifactRef {
  readonly ref: Ref;
  /** Artifact class (`data.md` §3 `ArtifactKind`), when known. */
  readonly kind?: string;
  readonly summary?: string;
}

/** The last tool outcome, so a resumed Run does not re-run a finished tool. */
export interface CheckpointToolOutcome {
  readonly operationId: string;
  readonly toolName: string;
  readonly state: 'finished' | 'unknown' | 'rejected';
  /** Hash of the tool's input, so a retry can detect a different input. */
  readonly inputHash: Hash;
  readonly resultHash?: Hash;
  readonly message?: string;
  readonly at: Time;
}

/** A reference to one message of the *current* Conversation (`data.md` §2). */
export interface CheckpointMessageRef {
  readonly conversationId: string;
  readonly seq: number;
  readonly bodyRef: string;
  readonly role?: Role;
  readonly summary?: string;
}

/**
 * One Run's resumable position (`context.md` §5).
 *
 * `runId`/`role`/`projectId`/`sessionRef` are the ownership identity the store
 * checks; every other field is the documented checkpoint content. `manifest` is the
 * one *valid* Manifest ref (a `Ref`, so id+version+hash) and is why a resumed Run
 * rebuilds its formal facts from references instead of from the summary.
 */
export interface Checkpoint {
  /** The Run that owns this checkpoint; a different Run is refused. */
  readonly runId: string;
  /** Project the Run belongs to; a different Project is refused (`AC-034`). */
  readonly projectId: string;
  readonly role: Role;
  /** The physical session that wrote this checkpoint. */
  readonly sessionRef: string;
  /**
   * The session this checkpoint was rotated away from, once it has been.
   *
   * A rotation keeps the same Run, so `sessionRef` alone cannot tell a resumed
   * session that the physical session changed; this records it explicitly
   * (`attempt.checkpoint_ref` + `attempt.session_ref` in production).
   */
  readonly rotatedFromSessionRef?: string;
  readonly workId: string;
  readonly taskId?: string;
  readonly stage: ContextStage;
  /** The valid Manifest ref; formal facts are rebuilt from it (`§5`). */
  readonly manifest: Ref;
  readonly pendingDecisions: readonly CheckpointDecision[];
  readonly artifactRefs: readonly CheckpointArtifactRef[];
  readonly lastToolOutcome?: CheckpointToolOutcome;
  readonly nextAction: string;
  readonly recentMessages: readonly CheckpointMessageRef[];
  /** Explicit approval state a compaction/summary must never change (`§5`). */
  readonly approval: CheckpointApproval;
  /** Immutable provenance of the sources the Run was dispatched with. */
  readonly sourceRefs: readonly SourceRef[];
  readonly createdAt: Time;
  readonly updatedAt: Time;
}

/** What a caller supplies to `save`; the store stamps `createdAt`/`updatedAt`. */
export type CheckpointDraft = Omit<Checkpoint, 'createdAt' | 'updatedAt'> &
  Partial<Pick<Checkpoint, 'createdAt' | 'updatedAt'>>;

/**
 * The Project/Work binding a caller must present to read a checkpoint.
 *
 * The *role* the caller claims is a separate argument of `load`/`rotateSession`/
 * `compact`, so a Reviewer Run can present the same Project and still be refused
 * (`AC-033`).
 */
export interface CheckpointRunScope {
  readonly projectId: string;
  readonly workId?: string;
}

/** What the registry knows about one Run, including its current session. */
export interface CheckpointRun {
  readonly runId: string;
  readonly role: Role;
  readonly projectId: string;
  readonly workId: string;
  /** The physical session currently bound to the Run. */
  readonly sessionRef: string;
}

export interface SaveCheckpointInput {
  readonly runId: string;
  readonly checkpoint: CheckpointDraft;
}

export interface LoadCheckpointInput {
  readonly runId: string;
  readonly role: Role;
  readonly runScope: CheckpointRunScope;
}

/** A loaded checkpoint plus its content identity (the `checkpoint_ref` value). */
export interface LoadedCheckpoint {
  readonly checkpoint: Checkpoint;
  /** `sha256(canonicalJson(checkpoint))`; what `attempt.checkpoint_ref` stores. */
  readonly checkpointHash: Hash;
  /** The Run's current physical session, restated so a caller can compare ids. */
  readonly sessionRef: string;
  /** `true` once this checkpoint was rotated to a new physical session. */
  readonly rotated: boolean;
}

/** What a compaction removed and what it provably kept (`AC-035`). */
export interface CompactedCheckpoint {
  readonly checkpoint: Checkpoint;
  /** Message refs removed; `recentMessages` are the newest `keep` entries. */
  readonly droppedMessages: number;
  /** The Manifest ref of the input, restated so a caller can assert it directly. */
  readonly manifest: Ref;
  /** The approval state of the input, restated so a caller can assert it directly. */
  readonly approval: ApprovalState;
}

/** The approval-free view a summary/compaction step is allowed to produce. */
export interface CheckpointSummary {
  readonly runId: string;
  readonly workId: string;
  readonly taskId?: string;
  readonly stage: ContextStage;
  readonly manifest: Ref;
  readonly pendingDecisionIds: readonly string[];
  readonly artifactRefs: readonly CheckpointArtifactRef[];
  readonly nextAction: string;
  readonly messageRefs: readonly CheckpointMessageRef[];
}

export interface CheckpointStore {
  /** Binds a Run to its role/Project/Work and first physical session. */
  registerRun(run: CheckpointRun): ContextResult<{ readonly run: CheckpointRun }>;
  save(input: SaveCheckpointInput): ContextResult<{ readonly checkpoint: Checkpoint }>;
  load(input: LoadCheckpointInput): ContextResult<LoadedCheckpoint>;
  /** The Run's current registration, or `undefined`. */
  runOf(runId: string): CheckpointRun | undefined;
  /**
   * Binds a new physical session to the same Run (session rotation) and re-stamps
   * the stored checkpoint with it. Role/task/permission/sources are unchanged.
   */
  rotateSession(input: {
    readonly runId: string;
    readonly fromSessionRef: string;
    readonly toSessionRef: string;
    readonly role: Role;
    readonly runScope: CheckpointRunScope;
    readonly at?: Time;
  }): ContextResult<{ readonly run: CheckpointRun; readonly checkpoint: Checkpoint }>;
  /** Compacts the stored checkpoint in place through `compactCheckpoint`. */
  compact(input: {
    readonly runId: string;
    readonly role: Role;
    readonly runScope: CheckpointRunScope;
    readonly keep?: number;
  }): ContextResult<CompactedCheckpoint>;
}

/** Content identity of a checkpoint; the `attempt.checkpoint_ref` value. */
export function checkpointHash(checkpoint: Checkpoint): Hash {
  return sha256(canonicalJson(checkpoint));
}

/** `true` when the string is a lowercase SHA256. */
function isHash(value: unknown): value is Hash {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

/**
 * `true` when the string is a UTC ISO8601 instant with millisecond precision.
 *
 * The glyph pattern alone only checks the shape: `2026-13-45T99:99:99.999Z` has
 * every documented character yet names no instant, and `2026-02-30T10:00:00.000Z`
 * names a day February does not have. A real instant is required as well, which the
 * `Date.parse` + `toISOString()` round trip proves: month 13, day 45, hour 99, an
 * absent calendar day and leap seconds all fail it (`data.md` §1, W5R3-02).
 */
function isTime(value: unknown): value is Time {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * Reads the injected clock without letting a port failure escape.
 *
 * `null` means the clock threw or returned a non-UTC timestamp; the caller turns
 * that into a closed `INTERNAL_ERROR` that carries no port message
 * (`reliability.md` §1, W5R2-08).
 */
function safeClock(clock: () => Time): Time | null {
  try {
    const value = clock();
    return isTime(value) ? value : null;
  } catch {
    return null;
  }
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Validates one version pin, appending one error per problem. */
function checkRef(value: unknown, field: string, errors: ContextError[]): void {
  const ref = value as Partial<Ref> | null | undefined;
  if (ref === null || ref === undefined || typeof ref !== 'object') {
    errors.push({ code: 'VALIDATION_ERROR', message: `${field} 必须是 Ref（id/version/hash）` });
    return;
  }
  if (!isNonEmpty(ref.id)) {
    errors.push({ code: 'VALIDATION_ERROR', message: `${field}.id 必须是非空字符串` });
  }
  if (!Number.isInteger(ref.version) || (ref.version ?? 0) <= 0) {
    errors.push({ code: 'VALIDATION_ERROR', message: `${field}.version 必须是正整数` });
  }
  if (!isHash(ref.hash)) {
    errors.push({ code: 'VALIDATION_ERROR', message: `${field}.hash 必须是 64 位小写 SHA256` });
  }
}

/** Validates one recorded `SourceRef` of the Run's dispatch provenance. */
function checkSourceRef(value: unknown, index: number, errors: ContextError[]): void {
  const ref = value as Partial<SourceRef> | null | undefined;
  if (ref === null || ref === undefined || typeof ref !== 'object') {
    errors.push({ code: 'VALIDATION_ERROR', message: `sourceRefs[${index}] 必须是 SourceRef` });
    return;
  }
  if (!isNonEmpty(ref.kind) || !isNonEmpty(ref.id) || !isNonEmpty(ref.version)) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `sourceRefs[${index}] 需要 kind/id/version`,
    });
  }
}

/**
 * The four rules a checkpoint cannot break, independent of any store.
 *
 * They are exactly the fields `context.md` §5 requires a resumed Run to trust: the
 * ownership identity, the stage, the valid Manifest and the explicit approval. A
 * malformed checkpoint is refused rather than repaired, so a resume can never
 * proceed on a half-written position.
 */
export function validateCheckpoint(draft: CheckpointDraft): readonly ContextError[] {
  const errors: ContextError[] = [];
  if (!isNonEmpty(draft.runId)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.runId 必须是非空字符串' });
  }
  if (!isNonEmpty(draft.projectId) || !PROJECT_ID_PATTERN.test(draft.projectId)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.projectId 必须是 32 位小写 hex' });
  }
  if (!isNonEmpty(draft.role)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.role 必须是非空角色' });
  }
  if (!isNonEmpty(draft.sessionRef)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.sessionRef 必须是非空字符串' });
  }
  if (draft.rotatedFromSessionRef !== undefined && !isNonEmpty(draft.rotatedFromSessionRef)) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: 'checkpoint.rotatedFromSessionRef 必须是非空字符串',
    });
  }
  if (!isNonEmpty(draft.workId)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.workId 必须是非空字符串' });
  }
  if (!isNonEmpty(draft.stage)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.stage 必须是非空阶段' });
  }
  checkRef(draft.manifest, 'checkpoint.manifest', errors);
  if (!isNonEmpty(draft.nextAction)) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: 'checkpoint.nextAction 必须非空（恢复下一步）',
    });
  }
  const decisions: unknown = draft.pendingDecisions;
  if (!Array.isArray(decisions)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.pendingDecisions 必须是数组' });
  } else {
    for (const [index, decision] of decisions.entries()) {
      const place = `checkpoint.pendingDecisions[${index}]`;
      if (!isRecord(decision)) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place} 必须是对象` });
        continue;
      }
      if (!isNonEmpty(decision['id'])) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place}.id 必须非空` });
      }
      if (!isDecisionState(decision['state'])) {
        errors.push({
          code: 'VALIDATION_ERROR',
          message: `${place}.state 必须是 ${DECISION_STATES.join('/')}`,
        });
      }
      if (!isNonEmpty(decision['summary'])) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place}.summary 必须非空` });
      }
      if (!isTime(decision['requestedAt'])) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place}.requestedAt 必须是 UTC 时间` });
      }
      if (decision['targetRef'] !== undefined) {
        checkRef(decision['targetRef'], `${place}.targetRef`, errors);
      }
    }
  }
  const artifacts: unknown = draft.artifactRefs;
  if (!Array.isArray(artifacts)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.artifactRefs 必须是数组' });
  } else {
    for (const [index, artifact] of artifacts.entries()) {
      const ref = isRecord(artifact) ? artifact['ref'] : undefined;
      checkRef(ref, `checkpoint.artifactRefs[${index}].ref`, errors);
    }
  }
  const messages: unknown = draft.recentMessages;
  if (!Array.isArray(messages)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.recentMessages 必须是数组' });
  } else {
    for (const [index, message] of messages.entries()) {
      const place = `checkpoint.recentMessages[${index}]`;
      if (!isRecord(message)) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place} 必须是对象` });
        continue;
      }
      if (!isNonEmpty(message['conversationId'])) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place}.conversationId 必须非空` });
      }
      const seq = message['seq'];
      if (!Number.isInteger(seq) || (typeof seq === 'number' && seq <= 0)) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place}.seq 必须是正整数` });
      }
      if (!isNonEmpty(message['bodyRef'])) {
        errors.push({ code: 'VALIDATION_ERROR', message: `${place}.bodyRef 必须非空` });
      }
    }
  }
  const approval: unknown = draft.approval;
  if (!isRecord(approval)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.approval 必须显式给出（§5）' });
  } else {
    if (!APPROVAL_STATES.includes(approval['state'] as ApprovalState)) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: `checkpoint.approval.state 必须是 ${APPROVAL_STATES.join('/')}`,
      });
    }
    if (!isNonEmpty(approval['role'])) {
      errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.approval.role 必须非空' });
    }
    if (!isTime(approval['decidedAt'])) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: 'checkpoint.approval.decidedAt 必须是 UTC 时间',
      });
    }
    if (approval['authorizationRef'] !== undefined) {
      checkRef(approval['authorizationRef'], 'checkpoint.approval.authorizationRef', errors);
    }
  }
  const sourceRefs: unknown = draft.sourceRefs;
  if (!Array.isArray(sourceRefs)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.sourceRefs 必须是数组' });
  } else {
    for (const [index, source] of sourceRefs.entries()) checkSourceRef(source, index, errors);
  }
  if (draft.taskId !== undefined && !isNonEmpty(draft.taskId)) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.taskId 必须是非空字符串' });
  }
  const outcome: unknown = draft.lastToolOutcome;
  if (outcome !== undefined) {
    if (!isRecord(outcome)) {
      errors.push({ code: 'VALIDATION_ERROR', message: 'checkpoint.lastToolOutcome 必须是对象' });
    } else {
      if (!isNonEmpty(outcome['operationId']) || !isNonEmpty(outcome['toolName'])) {
        errors.push({
          code: 'VALIDATION_ERROR',
          message: 'checkpoint.lastToolOutcome 需要 operationId/toolName',
        });
      }
      if (!isHash(outcome['inputHash'])) {
        errors.push({
          code: 'VALIDATION_ERROR',
          message: 'checkpoint.lastToolOutcome.inputHash 必须是 64 位小写 SHA256',
        });
      }
      if (
        typeof outcome['state'] !== 'string' ||
        !['finished', 'unknown', 'rejected'].includes(outcome['state'])
      ) {
        errors.push({
          code: 'VALIDATION_ERROR',
          message: 'checkpoint.lastToolOutcome.state 必须是 finished/unknown/rejected',
        });
      }
      if (!isTime(outcome['at'])) {
        errors.push({
          code: 'VALIDATION_ERROR',
          message: 'checkpoint.lastToolOutcome.at 必须是 UTC 时间',
        });
      }
    }
  }
  return errors;
}

/** `true` when the value is a plain record, so its fields can be probed safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `true` when the value is one of the business decision states. */
function isDecisionState(value: unknown): value is DecisionState {
  return typeof value === 'string' && (DECISION_STATES as readonly string[]).includes(value);
}

/** Freezes a checkpoint-like value into the immutable `Checkpoint` shape. */
function freezeCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return Object.freeze({
    ...checkpoint,
    manifest: Object.freeze({ ...checkpoint.manifest }),
    pendingDecisions: Object.freeze(
      checkpoint.pendingDecisions.map((decision) =>
        Object.freeze({
          ...decision,
          ...(decision.targetRef === undefined
            ? {}
            : { targetRef: Object.freeze({ ...decision.targetRef }) }),
        }),
      ),
    ),
    artifactRefs: Object.freeze(
      checkpoint.artifactRefs.map((artifact) =>
        Object.freeze({ ...artifact, ref: Object.freeze({ ...artifact.ref }) }),
      ),
    ),
    ...(checkpoint.lastToolOutcome === undefined
      ? {}
      : { lastToolOutcome: Object.freeze({ ...checkpoint.lastToolOutcome }) }),
    recentMessages: Object.freeze(
      checkpoint.recentMessages.map((message) => Object.freeze({ ...message })),
    ),
    approval: Object.freeze({
      ...checkpoint.approval,
      ...(checkpoint.approval.authorizationRef === undefined
        ? {}
        : { authorizationRef: Object.freeze({ ...checkpoint.approval.authorizationRef }) }),
    }),
    sourceRefs: Object.freeze(checkpoint.sourceRefs.map((source) => Object.freeze({ ...source }))),
  });
}

/** Builds the one `VALIDATION_ERROR` refusal a malformed checkpoint produces. */
function invalid(errors: readonly ContextError[]): {
  readonly ok: false;
  readonly errors: readonly ContextError[];
} {
  return { ok: false, errors };
}

/**
 * Compacts the recent-message list and changes nothing else (`context.md` §5).
 *
 * The Manifest ref, the pending decisions and the approval state are carried by
 * identity — not re-derived from the messages being dropped — so no compaction step
 * can quietly flip an approval. `keep` defaults to the ten newest refs.
 */
export function compactCheckpoint(checkpoint: Checkpoint, keep = 10): CompactedCheckpoint {
  const bounded = Number.isInteger(keep) && keep >= 0 ? keep : 0;
  const recent = checkpoint.recentMessages.slice(
    Math.max(0, checkpoint.recentMessages.length - bounded),
  );
  return Object.freeze({
    checkpoint: freezeCheckpoint({ ...checkpoint, recentMessages: recent }),
    droppedMessages: checkpoint.recentMessages.length - recent.length,
    manifest: Object.freeze({ ...checkpoint.manifest }),
    approval: checkpoint.approval.state,
  });
}

/**
 * The approval-free summary of a checkpoint.
 *
 * A summary is derived from the checkpoint (never the other way round), and it has
 * no approval field at all: the type makes "the summary changed the approval"
 * unrepresentable, which is what `AC-035` asserts.
 */
export function summaryOf(checkpoint: Checkpoint): CheckpointSummary {
  return Object.freeze({
    runId: checkpoint.runId,
    workId: checkpoint.workId,
    ...(checkpoint.taskId === undefined ? {} : { taskId: checkpoint.taskId }),
    stage: checkpoint.stage,
    manifest: Object.freeze({ ...checkpoint.manifest }),
    pendingDecisionIds: Object.freeze(checkpoint.pendingDecisions.map((decision) => decision.id)),
    artifactRefs: Object.freeze(
      checkpoint.artifactRefs.map((artifact) =>
        Object.freeze({ ...artifact, ref: Object.freeze({ ...artifact.ref }) }),
      ),
    ),
    nextAction: checkpoint.nextAction,
    messageRefs: Object.freeze(
      checkpoint.recentMessages.map((message) => Object.freeze({ ...message })),
    ),
  });
}

/**
 * The in-memory `CheckpointStore`; `attempt.checkpoint_ref` is `checkpointHash`.
 *
 * The store is deliberately the only place that decides whether a Run may read a
 * checkpoint: `load` returns `{ok:false}` with `CONTEXT_FORBIDDEN` and no
 * `checkpoint` field for a foreign Run/Project/role, so a caller cannot recover the
 * content by ignoring an `excluded` list (`AC-033`, `AC-034`).
 */
export function createCheckpointStore(
  options: { readonly now?: () => Time } = {},
): CheckpointStore {
  const clock = options.now ?? nowIso;
  const runs = new Map<string, CheckpointRun>();
  const store = new Map<string, Checkpoint>();

  const forbidden = (
    message: string,
  ): { readonly ok: false; readonly errors: readonly ContextError[] } =>
    invalid([{ code: 'CONTEXT_FORBIDDEN', message }]);

  /** Ownership check shared by load/rotate/compact; `null` means "allowed". */
  const ownershipOf = (
    scope: CheckpointRunScope,
    role: Role,
    runId: string,
  ): ContextError | null => {
    const run = runs.get(runId);
    if (run === undefined) {
      return { code: 'NOT_FOUND', message: `未登记的 Run：${runId}` };
    }
    if (run.projectId !== scope.projectId) {
      return {
        code: 'CONTEXT_FORBIDDEN',
        message: `Run ${runId} 属于其他 Project：${run.projectId}`,
      };
    }
    if (scope.workId !== undefined && scope.workId !== run.workId) {
      return { code: 'CONTEXT_FORBIDDEN', message: `Run ${runId} 属于其他 Work：${run.workId}` };
    }
    if (run.role !== role) {
      return {
        code: 'CONTEXT_FORBIDDEN',
        message: `${role} 不能读取 ${run.role} Run 的 Checkpoint/Session（§5）`,
      };
    }
    return null;
  };

  /** The one read path; every entry point shares it, so no caller can bypass it. */
  const load = (input: LoadCheckpointInput): ContextResult<LoadedCheckpoint> => {
    const denial = ownershipOf(input.runScope, input.role, input.runId);
    if (denial !== null) {
      return invalid([denial]);
    }
    const run = runs.get(input.runId);
    const checkpoint = store.get(input.runId);
    if (run === undefined) {
      return invalid([{ code: 'NOT_FOUND', message: `未登记的 Run：${input.runId}` }]);
    }
    if (checkpoint === undefined) {
      return invalid([{ code: 'NOT_FOUND', message: `Run ${input.runId} 没有 Checkpoint` }]);
    }
    return {
      ok: true,
      checkpoint,
      checkpointHash: checkpointHash(checkpoint),
      sessionRef: run.sessionRef,
      rotated: checkpoint.rotatedFromSessionRef !== undefined,
    };
  };

  return {
    registerRun(run) {
      if (!isNonEmpty(run.runId) || !isNonEmpty(run.sessionRef) || !isNonEmpty(run.workId)) {
        return invalid([
          { code: 'VALIDATION_ERROR', message: 'registerRun 需要 runId/sessionRef/workId' },
        ]);
      }
      if (runs.has(run.runId)) {
        return invalid([{ code: 'INVALID_STATE', message: `Run 已登记：${run.runId}` }]);
      }
      const frozen = Object.freeze({ ...run });
      runs.set(run.runId, frozen);
      return { ok: true, run: frozen };
    },

    save(input) {
      const errors = validateCheckpoint(input.checkpoint);
      if (errors.length > 0) return invalid(errors);
      const run = runs.get(input.runId);
      // `Checkpoint仅来自当前Run`: a checkpoint naming a different Run is refused
      // before anything is stored, so one Run can never plant state in another.
      if (input.checkpoint.runId !== input.runId) {
        return forbidden(
          `Checkpoint 属于 Run ${input.checkpoint.runId}，不能由 Run ${input.runId} 写入（AC-035）`,
        );
      }
      if (run === undefined) {
        return invalid([{ code: 'NOT_FOUND', message: `未登记的 Run：${input.runId}` }]);
      }
      if (input.checkpoint.projectId !== run.projectId) {
        return forbidden(
          `Checkpoint 声明的 Project ${input.checkpoint.projectId} 与 Run ${run.projectId} 不一致（AC-034）`,
        );
      }
      if (input.checkpoint.role !== run.role) {
        return forbidden(
          `Checkpoint 声明的角色 ${input.checkpoint.role} 与 Run 的 ${run.role} 不一致（AC-035）`,
        );
      }
      // `Checkpoint仅来自当前Run` covers the Work identity too: a Run bound to
      // WP-05 may not store a position claiming WP-99, or the cold-start seed
      // would resume at a Work this Run never ran (context.md §5).
      if (input.checkpoint.workId !== run.workId) {
        return invalid([
          {
            code: 'VALIDATION_ERROR',
            message: `Checkpoint 声明的 Work ${input.checkpoint.workId} 与 Run ${run.workId} 不一致（§5）`,
          },
        ]);
      }
      const previous = store.get(input.runId);
      if (input.checkpoint.sessionRef !== run.sessionRef) {
        return invalid([
          {
            code: 'INVALID_STATE',
            message: `Checkpoint 的 sessionRef ${input.checkpoint.sessionRef} 不是当前 Session ${run.sessionRef}（AC-035）`,
          },
        ]);
      }
      const now = safeClock(clock);
      // A throwing or malformed clock is a closed failure: it must not escape with
      // the port's raw message, and it must not have written anything (W5R2-08).
      if (now === null) {
        return invalid([{ code: 'INTERNAL_ERROR', message: 'Checkpoint 时钟调用失败' }]);
      }
      const stamps = {
        createdAt: input.checkpoint.createdAt ?? previous?.createdAt ?? now,
        updatedAt: input.checkpoint.updatedAt ?? now,
      };
      if (!isTime(stamps.createdAt) || !isTime(stamps.updatedAt)) {
        return invalid([
          { code: 'VALIDATION_ERROR', message: 'checkpoint.createdAt/updatedAt 必须是 UTC 时间' },
        ]);
      }
      const checkpoint = freezeCheckpoint({ ...input.checkpoint, ...stamps });
      store.set(input.runId, checkpoint);
      return { ok: true, checkpoint };
    },

    load,

    runOf(runId) {
      return runs.get(runId);
    },

    rotateSession(input) {
      const denial = ownershipOf(input.runScope, input.role, input.runId);
      if (denial !== null) {
        return invalid([denial]);
      }
      if (!isNonEmpty(input.toSessionRef) || !isNonEmpty(input.fromSessionRef)) {
        return invalid([
          { code: 'VALIDATION_ERROR', message: 'rotateSession 需要 from/to Session 标识' },
        ]);
      }
      const run = runs.get(input.runId);
      if (run === undefined) {
        return invalid([{ code: 'NOT_FOUND', message: `未登记的 Run：${input.runId}` }]);
      }
      if (run.sessionRef !== input.fromSessionRef) {
        return invalid([
          {
            code: 'INVALID_STATE',
            message: `Run 当前 Session 是 ${run.sessionRef}，不是 ${input.fromSessionRef}`,
          },
        ]);
      }
      if (input.toSessionRef === input.fromSessionRef) {
        return invalid([{ code: 'VALIDATION_ERROR', message: '新 Session 不能与旧 Session 相同' }]);
      }
      // Validate first, mutate last (`reliability.md` §1): a rotation of a Run
      // that has no checkpoint must fail without binding the new session, so the
      // rejected operation leaves no partial state behind.
      const previous = store.get(input.runId);
      if (previous === undefined) {
        return invalid([{ code: 'NOT_FOUND', message: `Run ${input.runId} 没有 Checkpoint` }]);
      }
      // The rotation timestamp is part of the stored Checkpoint (`data.md` §1: UTC
      // ISO8601 milliseconds), so an explicit `at` is validated before anything is
      // written; an absent `at` comes from the wrapped clock (W5R2-08/W5R2-11).
      let updatedAt: Time;
      if (input.at !== undefined) {
        if (!isTime(input.at)) {
          return invalid([
            { code: 'VALIDATION_ERROR', message: 'rotateSession.at 必须是 UTC 时间（data.md §1）' },
          ]);
        }
        updatedAt = input.at;
      } else {
        const clocked = safeClock(clock);
        if (clocked === null) {
          return invalid([{ code: 'INTERNAL_ERROR', message: 'Checkpoint 时钟调用失败' }]);
        }
        updatedAt = clocked;
      }
      const rotated = Object.freeze({ ...run, sessionRef: input.toSessionRef });
      runs.set(input.runId, rotated);
      // Role, task, permissions, sources and approval survive the rotation: only
      // the physical session changes (`context.md` §5 会话轮换).
      const checkpoint = freezeCheckpoint({
        ...previous,
        sessionRef: input.toSessionRef,
        rotatedFromSessionRef: previous.sessionRef,
        updatedAt,
      });
      store.set(input.runId, checkpoint);
      return { ok: true, run: rotated, checkpoint };
    },

    compact(input) {
      const loaded = load(input);
      if (!loaded.ok) return loaded;
      const compacted = compactCheckpoint(loaded.checkpoint, input.keep ?? 10);
      store.set(input.runId, compacted.checkpoint);
      return {
        ok: true,
        checkpoint: compacted.checkpoint,
        droppedMessages: compacted.droppedMessages,
        manifest: compacted.manifest,
        approval: compacted.approval,
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The bound convenience API
 * ------------------------------------------------------------------ */

/**
 * `saveCheckpoint({runId, checkpoint}, store)`.
 *
 * The requested API shape (`saveCheckpoint`/`loadCheckpoint`) over the store, so a
 * caller that already holds one store can write the two calls directly. Both are
 * thin: every rule lives in `CheckpointStore` and is therefore enforced whichever
 * entry point is used.
 */
export function saveCheckpoint(
  input: SaveCheckpointInput,
  store: CheckpointStore,
): ContextResult<{ readonly checkpoint: Checkpoint; readonly checkpointHash: Hash }> {
  const saved = store.save(input);
  if (!saved.ok) return saved;
  return {
    ok: true,
    checkpoint: saved.checkpoint,
    checkpointHash: checkpointHash(saved.checkpoint),
  };
}

/** `loadCheckpoint({runId, role, runScope}, store)`; a foreign Run gets no content. */
export function loadCheckpoint(
  input: LoadCheckpointInput,
  store: CheckpointStore,
): ContextResult<LoadedCheckpoint> {
  return store.load(input);
}
