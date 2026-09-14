/**
 * Run recovery: lease/epoch supervision, daemon-restart inspection and
 * backup/restore/relocate (`docs/architecture/reliability.md` §2/§6/§7/§8,
 * AC-057, AC-058, AC-061, AC-064, AC-082).
 *
 * Three rules from the architecture drive every decision in this module:
 *
 * - **A persisted field is never evidence that an execution is alive.** After a
 *   daemon crash the supervisor *checks* the real process identity and the attempt
 *   epoch (`AC-061`) instead of trusting `run.status`/`attempt.heartbeat_at`; a
 *   `running` Run whose process is gone becomes `interrupted`, never "still
 *   running".
 * - **A lease is one owner, and an old owner is not a second writer.** An expired
 *   lease is revoked before anything is re-granted, and while the old process
 *   cannot be confirmed terminated the Run is `recovery_required` so no new writer
 *   receives the workspace (`reliability.md` §2, AC-057).
 * - **A late result never overwrites newer authority, but its diagnostics are
 *   kept.** An old epoch — or a result arriving after a cancellation/newer
 *   decision — is refused with the reason recorded as evidence (`AC-058`).
 *
 * The same module owns the Project data-directory lifecycle: snapshotting SQLite
 * plus blobs plus knowledge into a self-describing, hash-verified backup,
 * restoring it into a *new* directory, and relocating a project; a restored or
 * relocated project always comes back with every old lease and capability revoked
 * and every previously active Run parked for recovery (`reliability.md` §8,
 * AC-064). Provider credentials are deliberately not part of a backup, so a
 * restore that cannot resolve a required Secret is reported `blocked` instead of
 * being presented as runnable.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  dispatchSnapshotSchema,
  type Attempt,
  type AttemptStatus,
  type JsonObject,
  type Lease,
  type Project,
  type Run,
  type RunStatus,
  type Scope,
  type ToolOperation,
} from '@agentdev/contracts';
import { canTransitionRun } from '@agentdev/domain';
import {
  ProjectStore,
  backupDatabase,
  nowIso,
  openDatabase,
  parseJson,
  sha256,
  withTransaction,
  type ProjectStore as ProjectStoreType,
} from '@agentdev/storage';
import { runGit, type GitResult, type WorkspaceDiagnostic } from '@agentdev/workspace';
import { canonicalJson } from './dispatcher.js';
import { scanEvents } from './events.js';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';

/** Heartbeat budget before a Run is considered no longer live (`reliability.md` §2). */
export const RUN_HEARTBEAT_TIMEOUT_MS = 20_000;

/** `operation.kind` of a persisted recovery report (`data.md` §2). */
export const RECOVERY_OPERATION_KIND = 'recover';

/** Event emitted when a Run is parked for recovery. */
export const RUN_RECOVERED_EVENT = 'run.recovered';

/**
 * `Event.name` of a `RecoveryReport` that has become ready (`protocol.md` §4
 * `recovery.inspect`, §7).
 *
 * A report is "ready" once it is durable: `recoverAfterRestart` records every
 * report it built in the `recover` operation row, and this event is appended in
 * the *same* transaction with the report's reference (`reportRef`), so a reader
 * can resolve the exact report version a later `recovery.resolve` must honour.
 * An ad-hoc `buildReport` never emits: it persists nothing to resolve against.
 */
export const RECOVERY_REPORT_READY_EVENT = 'recovery.report_ready';

/** Event that carries the diagnostics of a refused late result (`AC-058`). */
export const LATE_RESULT_REJECTED_EVENT = 'stage.result_rejected';

/** File name of the self-describing backup manifest. */
export const BACKUP_MANIFEST_NAME = 'backup.json';

/** Backup format version; a restore refuses anything it does not understand. */
export const BACKUP_SCHEMA_VERSION = 1;

/** Entries inside a backup directory. */
export const BACKUP_DATABASE_PATH = 'project.sqlite';
export const BACKUP_BLOBS_PATH = 'blobs';
export const BACKUP_KNOWLEDGE_PATH = 'knowledge';
export const BACKUP_GIT_PATH = 'git.bundle';

function protocolFail(code: ProtocolErrorCode, message: string, details?: JsonObject): never {
  throw new ProtocolError(code, message, details === undefined ? {} : { details });
}

// ---------------------------------------------------------------------------
// Process identity
// ---------------------------------------------------------------------------

/**
 * Real process state of one Runner identity.
 *
 * `true` alive, `false` confirmed gone, `null` **cannot be established** — a
 * foreign or malformed identity. `null` is not "dead": an unconfirmable old
 * process must never be treated as terminated (`reliability.md` §2).
 */
export interface ProcessProbe {
  readonly kind: string;
  /** The process identity an Attempt recorded in `attempt.runner_id`. */
  probe(runnerId: string): boolean | null;
}

/** Parses `pid:<n>` or a bare positive integer; `null` for anything else. */
export function parseRunnerPid(runnerId: string): number | null {
  const match = /^(?:pid:)?([0-9]+)$/u.exec(runnerId.trim());
  if (match === null) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Real probe over the host process table.
 *
 * `kill(pid, 0)` performs the permission/existence check without signalling:
 * `ESRCH` means the process is gone, `EPERM` means it exists but belongs to
 * another user (still alive), and any other error is reported as unknown rather
 * than guessed.
 */
export function createNodeProcessProbe(): ProcessProbe {
  return {
    kind: 'node-process',
    probe(runnerId) {
      const pid = parseRunnerPid(runnerId);
      if (pid === null) return null;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as { readonly code?: unknown }).code;
        if (code === 'ESRCH') return false;
        if (code === 'EPERM') return true;
        return null;
      }
    },
  };
}

export interface MemoryProcessProbe extends ProcessProbe {
  setAlive(runnerId: string, alive: boolean | null): void;
}

/** Deterministic probe for tests: only explicitly known identities answer. */
export function createMemoryProcessProbe(
  initial: Readonly<Record<string, boolean | null>> = {},
): MemoryProcessProbe {
  const state = new Map<string, boolean | null>(Object.entries(initial));
  return {
    kind: 'memory-process',
    probe(runnerId) {
      return state.get(runnerId) ?? null;
    },
    setAlive(runnerId, alive) {
      state.set(runnerId, alive);
    },
  };
}

// ---------------------------------------------------------------------------
// Inspection (AC-057, AC-061)
// ---------------------------------------------------------------------------

/** What the supervisor may do with one Run after inspecting it. */
export type RunRecoveryAction = 'none' | 'park_interrupted' | 'park_recovery_required';

/** The inspected, *real* state of one Run — never just its persisted fields. */
export interface RunRecoveryInspection {
  readonly runId: string;
  readonly workId: string;
  readonly status: RunStatus;
  readonly attemptId: string | null;
  readonly epoch: number | null;
  readonly runnerId: string | null;
  readonly heartbeatAt: string | null;
  readonly heartbeatAgeMs: number | null;
  readonly heartbeatStale: boolean;
  /** `null` when no process identity could be checked. */
  readonly processAlive: boolean | null;
  readonly processChecked: boolean;
  /** Tool operations that started but have no confirmed result. */
  readonly unknownToolOperations: readonly string[];
  readonly leases: readonly Lease[];
  readonly action: RunRecoveryAction;
  readonly requiresRecoveryDecision: boolean;
  readonly newAttemptAllowed: boolean;
  readonly reasons: readonly string[];
}

export interface RunInspectionResult {
  readonly ok: true;
  readonly inspection: RunRecoveryInspection;
}

export interface RunInspectionFailure {
  readonly ok: false;
  readonly code: ProtocolErrorCode;
  readonly message: string;
}

export type RunInspectionOutcome = RunInspectionResult | RunInspectionFailure;

/** Run states the supervisor may still have to park after a restart. */
const RESUMABLE_STATUSES: readonly RunStatus[] = [
  'starting',
  'running',
  'waiting_permission',
  'waiting_children',
];

/** Tool-operation states whose outcome is not confirmed. */
const UNCONFIRMED_TOOL_STATES: readonly ToolOperation['state'][] = ['started', 'unknown'];

export interface RunRecoveryOptions {
  readonly store: ProjectStoreType;
  readonly probe?: ProcessProbe;
  readonly now?: () => string;
  readonly heartbeatTimeoutMs?: number;
}

export interface RunRecoveryApplyResult {
  readonly runId: string;
  readonly changed: boolean;
  readonly from: RunStatus;
  readonly to: RunStatus;
  /** Legally applied transition path (`[from]` when nothing changed). */
  readonly path: readonly RunStatus[];
  readonly releasedLeases: readonly string[];
  readonly attemptStatus: AttemptStatus | null;
  readonly inspection: RunRecoveryInspection;
}

/** `decision.kind` of the recovery decision that resolves a parked Run. */
export const RECOVERY_DECISION_KIND = 'recovery';

/** What the persisted recovery evidence says about opening a new Attempt. */
export interface NewAttemptAdmission {
  /** `true` when a new Attempt may open for the Run. */
  readonly allowed: boolean;
  /** `run.recovered` id of the verdict that decided this answer, or `null`. */
  readonly verdictEventId: string | null;
  /** `true` when the blocking verdict explicitly demands a RecoveryDecision. */
  readonly requiresRecoveryDecision: boolean;
  /** The recovery decision (`choice: 'resume'`) that lifted the block, if any. */
  readonly resolvedByDecisionId: string | null;
  readonly code: ProtocolErrorCode | null;
  readonly message: string | null;
}

/**
 * Whether a Run may open a new Attempt, read from **persisted** recovery evidence
 * (`W8R1-04`, AC-057).
 *
 * The recovery report's `newAttemptAllowed:false` used to live only in the return
 * value, so nothing stopped `RunLifecycle.beginAttempt`/`resumeWork` from starting a
 * second writer beside an old process that was never confirmed terminated. The
 * verdict is durable in the `run.recovered` event; this function is the single
 * admission rule every Attempt-opening path consults:
 *
 * - no recovery verdict, or a verdict that allowed a new Attempt → **allowed** (a
 *   process confirmed gone is the documented "safe to resume" case);
 * - a verdict that withheld it → **refused** until an operator records a recovery
 *   decision with `choice: 'resume'` **that covers this Run** and post-dates its own
 *   verdict — the explicit, auditable "the old execution is dealt with, proceed" act.
 *
 * `W8R2-03`: the decision must be bound to the Run (or to the persisted verdict event
 * id). A decision written for a *sibling* Run of the same Work used to lift this Run's
 * block as well, because the lookup was Work-scoped; "every blocked Run needs its own
 * decision" is the rule that keeps AC-057's no-double-writer guarantee.
 */
export function newAttemptAdmission(store: ProjectStoreType, runId: string): NewAttemptAdmission {
  const verdicts = scanEvents(store, { names: [RUN_RECOVERED_EVENT] });
  let verdict: (typeof verdicts)[number] | undefined;
  for (const event of verdicts) {
    if (event.entityId === runId) verdict = event;
  }
  const allowed: NewAttemptAdmission = {
    allowed: true,
    verdictEventId: verdict?.eventId ?? null,
    requiresRecoveryDecision: false,
    resolvedByDecisionId: null,
    code: null,
    message: null,
  };
  if (verdict === undefined || verdict.data['newAttemptAllowed'] !== false) return allowed;
  const requiresRecoveryDecision = verdict.data['requiresRecoveryDecision'] === true;
  const run = store.runs.find(runId);
  const resolved =
    run === undefined
      ? undefined
      : store.decisions
          .list({
            // `W8R3-04`: bind the Run/verdict to the query. Scanning only the newest
            // 25 Work-scoped decisions meant unrelated recovery decisions recorded
            // later could push the decision that actually covers this Run out of the
            // window, silently re-blocking a Run that had been released.
            where: "work_id = ? AND kind = ? AND json_extract(target_ref, '$.id') IN (?, ?)",
            params: [run.workId, RECOVERY_DECISION_KIND, runId, verdict.eventId],
            orderBy: 'created_at DESC',
          })
          .find(
            (decision) =>
              decision.choice === 'resume' &&
              Date.parse(decision.createdAt) > Date.parse(verdict.occurredAt),
          );
  if (resolved !== undefined) {
    return { ...allowed, requiresRecoveryDecision, resolvedByDecisionId: resolved.id };
  }
  return {
    allowed: false,
    verdictEventId: verdict.eventId,
    requiresRecoveryDecision,
    resolvedByDecisionId: null,
    code: 'RECOVERY_REQUIRED',
    message: requiresRecoveryDecision
      ? `Run ${runId} 的旧执行未确认终止（或存在未确认副作用），恢复判定禁止开新 Attempt；先记录针对本 Run（targetRef.id=${runId}）的 RecoveryDecision（AC-057）`
      : `Run ${runId} 的恢复判定未放行新 Attempt（旧工作区可能仍有写者）；先记录针对本 Run（targetRef.id=${runId}）的 RecoveryDecision（AC-057）`,
  };
}

/**
 * Lease/epoch supervision and daemon-restart inspection for one Project.
 *
 * The service is deliberately narrow: it inspects, it parks, and it fences late
 * results. It never starts an Attempt — it persists the `newAttemptAllowed` verdict
 * (see `newAttemptAdmission`), and every Attempt-opening path must consult it.
 */
export class RunRecoveryService {
  private readonly store: ProjectStoreType;
  private readonly probe: ProcessProbe;
  private readonly now: () => string;
  private readonly heartbeatTimeoutMs: number;

  constructor(options: RunRecoveryOptions) {
    this.store = options.store;
    this.probe = options.probe ?? createNodeProcessProbe();
    this.now = options.now ?? (() => nowIso());
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? RUN_HEARTBEAT_TIMEOUT_MS;
  }

  /** Inspects one Run against real process/epoch state (`AC-057`, `AC-061`). */
  inspect(runId: string): RunInspectionOutcome {
    const run = this.store.runs.find(runId);
    if (run === undefined) {
      return { ok: false, code: 'NOT_FOUND', message: `Run ${runId} does not exist` };
    }
    return { ok: true, inspection: this.inspectRun(run) };
  }

  /**
   * Records the operator's "resume this Run" decision after a park (`AC-057`).
   *
   * A Run parked as `recovery_required` had **no** product path forward: the durable
   * admission refuses a new Attempt, `pauseWork` refuses a Work with unresolved side
   * effects, and `resume` only applies to a paused Work (`WP11R2-02`). This is that path,
   * and it is deliberately guarded:
   *
   * - the Run must currently be parked (`interrupted`/`recovery_required`);
   * - the *real* process state is re-checked: while the old Runner is alive or
   *   unconfirmable, or while a tool operation's result is unknown, the decision is refused
   *   (recording it would lift the write barrier over a possible second writer);
   * - only then is an accepted `kind='recovery'`, `choice='resume'` decision written for
   *   this Run, which is what `newAttemptAdmission` reads.
   *
   * The caller (the daemon's protocol surface) may then let the supervisor open the next
   * Attempt; the supervisor picks a parked Run up on its next tick once this decision
   * exists.
   */
  recordResumeDecision(input: {
    readonly runId: string;
    readonly sourceMessageId?: string;
  }):
    | { readonly ok: true; readonly decisionId: string; readonly inspection: RunRecoveryInspection }
    | { readonly ok: false; readonly code: ProtocolErrorCode; readonly message: string } {
    const run = this.store.runs.find(input.runId);
    if (run === undefined) {
      return { ok: false, code: 'NOT_FOUND', message: `Run ${input.runId} does not exist` };
    }
    if (run.status !== 'interrupted' && run.status !== 'recovery_required') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Run ${run.id} is ${run.status}; only a parked Run needs a resume decision`,
      };
    }
    const inspection = this.inspectRun(run);
    if (!inspection.processChecked || inspection.processAlive !== false) {
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: `Run ${run.id} 的旧执行（${inspection.runnerId ?? '未知进程'}）未确认终止；先终止该进程再记录恢复决定`,
      };
    }
    if (inspection.unknownToolOperations.length > 0) {
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: `Run ${run.id} 有 ${String(inspection.unknownToolOperations.length)} 个工具操作结果未知；需先处置这些副作用`,
      };
    }
    const at = this.now();
    // The reference names the Run *and* the version it was decided against, with a hash of
    // the facts the decision rests on (WP11R3-05).
    const decision = this.store.decisions.insert({
      workId: run.workId,
      kind: RECOVERY_DECISION_KIND,
      targetRef: {
        id: run.id,
        version: run.version,
        hash: sha256(
          canonicalJson({
            runId: run.id,
            status: run.status,
            runnerId: inspection.runnerId,
            heartbeatAt: inspection.heartbeatAt,
          }),
        ),
      },
      choices: ['resume', 'abandon'],
      state: 'accepted',
      choice: 'resume',
      actor: 'user',
      effectRefs: [],
      ...(input.sourceMessageId === undefined ? {} : { sourceMessageId: input.sourceMessageId }),
      createdAt: at,
      updatedAt: at,
    });
    return { ok: true, decisionId: decision.id, inspection };
  }

  /** Every Run that may still be live, in creation order. */
  inspectActive(): readonly RunRecoveryInspection[] {
    return this.store.runs
      .list({ orderBy: 'created_at ASC, id ASC' })
      .filter((run) => RESUMABLE_STATUSES.includes(run.status))
      .map((run) => this.inspectRun(run));
  }

  /**
   * Parks one Run according to its inspected state.
   *
   * A Run whose previous execution cannot be confirmed terminated is moved to
   * `recovery_required` (when that target is legal) and no new Attempt is
   * allowed. A confirmed-dead execution without unconfirmed side effects is
   * `interrupted`, which may start a new Attempt (`workflow.md` §5.3).
   */
  recoverRun(runId: string, options: { readonly hostEpoch?: string } = {}): RunRecoveryApplyResult {
    const inspected = this.inspect(runId);
    if (!inspected.ok) protocolFail(inspected.code, inspected.message, { runId });
    return this.apply(inspected.inspection, options.hostEpoch ?? this.now());
  }

  /**
   * The restart path (`reliability.md` §2/§7, AC-061).
   *
   * A host epoch is required and must be strictly newer than the newest recorded
   * one: a restarted daemon that reuses an epoch could otherwise be mistaken for
   * the process it replaced. Every still-live Run is inspected and parked; the
   * persisted status is only reported, never resumed.
   */
  recoverAfterRestart(hostEpoch: string): RestartRecoveryResult {
    if (hostEpoch.trim() === '') {
      protocolFail('VALIDATION_ERROR', 'daemon restart recovery needs a non-empty host epoch');
    }
    const previous = this.lastHostEpoch();
    if (previous !== null && hostEpoch <= previous) {
      protocolFail(
        'VERSION_CONFLICT',
        `daemon epoch ${hostEpoch} 不新于已记录的 ${previous}；拒绝用旧 epoch 恢复`,
        { hostEpoch, previousHostEpoch: previous },
      );
    }
    const inspections = this.inspectActive();
    // Reports describe the state the restart *found*, so they are built before any
    // Run is parked.
    const reports = inspections.map((inspection) => this.buildReport(inspection.runId, hostEpoch));
    const applied = inspections.map((inspection) => this.apply(inspection, hostEpoch));
    this.recordRestart(hostEpoch, applied, reports);
    return {
      hostEpoch,
      previousHostEpoch: previous,
      inspections,
      applied,
      requiresDecision: applied
        .filter((entry) => entry.inspection.requiresRecoveryDecision)
        .map((entry) => entry.runId),
      reports,
    };
  }

  /** Releases every expired lease and reports the resources that were freed. */
  expireLeases(at?: string): readonly string[] {
    return this.store.leases.releaseExpired(at ?? this.now());
  }

  /**
   * A late result is refused when its epoch is not the current one, when the Run
   * has left the executing state, or when a newer user decision supersedes it —
   * and the diagnostics are persisted either way (`AC-058`).
   */
  acceptAttemptResult(input: AttemptResultSubmission): AttemptResultDisposition {
    const run = this.store.runs.find(input.runId);
    if (run === undefined) {
      return {
        accepted: false,
        code: 'NOT_FOUND',
        message: `Run ${input.runId} does not exist`,
        diagnosticsKept: false,
        diagnosticEventId: null,
        currentEpoch: null,
        currentStatus: null,
        supersededBy: null,
      };
    }
    const attempt = this.store.attempts.find(input.attemptId);
    const latest = this.latestAttempt(run.id);
    const currentEpoch = latest?.ownerEpoch ?? null;
    const currentStatus = run.status;

    const refuse = (
      code: ProtocolErrorCode,
      message: string,
      supersededBy: SupersededBy,
    ): AttemptResultDisposition => {
      const event = this.store.events.append({
        name: LATE_RESULT_REJECTED_EVENT,
        entityId: run.id,
        entityVersion: run.version,
        data: {
          attemptId: input.attemptId,
          submittedEpoch: input.epoch,
          currentEpoch,
          runStatus: currentStatus,
          outcome: input.status,
          summary: input.summary,
          evidenceRefs: [...(input.evidenceRefs ?? [])],
          reason: message,
          supersededBy,
        },
      });
      return {
        accepted: false,
        code,
        message,
        diagnosticsKept: true,
        diagnosticEventId: event.eventId,
        currentEpoch,
        currentStatus,
        supersededBy,
      };
    };

    if (attempt === undefined || attempt.runId !== run.id) {
      return refuse(
        'STALE_ARTIFACT',
        `Attempt ${input.attemptId} 不属于 Run ${run.id}，结果被拒绝`,
        'newer_attempt',
      );
    }
    if (currentStatus !== 'running') {
      return refuse(
        'INVALID_STATE',
        `Run ${run.id} 当前为 ${currentStatus}，迟到的 ${input.status} 结果不得覆盖`,
        currentStatus === 'cancelled' ? 'cancellation' : 'terminal',
      );
    }
    if (currentEpoch !== null && input.epoch !== currentEpoch) {
      return refuse(
        'STALE_ARTIFACT',
        `epoch ${input.epoch} 不是当前 epoch ${currentEpoch}，旧 epoch 结果被拒绝`,
        'newer_attempt',
      );
    }
    if (latest !== undefined && latest.id !== attempt.id) {
      return refuse(
        'STALE_ARTIFACT',
        `Attempt ${attempt.id} 已被 ${latest.id} 取代，结果被拒绝`,
        'newer_attempt',
      );
    }
    const newer = this.newerAcceptedDecision(run.workId, attempt.createdAt);
    if (newer !== null) {
      return refuse(
        'STALE_ARTIFACT',
        `Decision ${newer} 在本次 Attempt 之后生效，旧结果被拒绝`,
        'newer_decision',
      );
    }
    return {
      accepted: true,
      runId: run.id,
      attemptId: attempt.id,
      epoch: input.epoch,
      status: input.status,
      summary: input.summary,
      evidenceRefs: [...(input.evidenceRefs ?? [])],
    };
  }

  /**
   * The frozen authority a restarted Run must honour (`AC-082`).
   *
   * The scope and output schemas come from the Run's own `DispatchSnapshot`;
   * the wider Work scope is reported only so a caller can see it was *not* used.
   */
  recoveryScope(runId: string): RecoveryScopeResult {
    const run = this.store.runs.find(runId);
    if (run === undefined) {
      return { ok: false, code: 'NOT_FOUND', message: `Run ${runId} does not exist` };
    }
    const snapshot = this.dispatchSnapshotOf(run);
    if (!snapshot.ok) return snapshot;
    const work = this.store.works.find(run.workId);
    const workloadScope = work?.scope ?? null;
    return {
      ok: true,
      runId: run.id,
      dispatchSnapshotId: run.dispatchSnapshotId,
      source: 'dispatch_snapshot',
      effectiveScope: snapshot.effectiveScope,
      requiredOutputSchemas: snapshot.requiredOutputSchemas,
      workScope: workloadScope,
      workScopeIgnored:
        workloadScope !== null && !sameScope(workloadScope, snapshot.effectiveScope),
    };
  }

  /**
   * Whether a restarted Run may still touch `path` (`AC-082`).
   *
   * The check is made against the frozen snapshot only. A path the Work scope
   * contains but the snapshot does not is refused: a restart may not widen
   * authority.
   */
  verifyRecoveredScope(runId: string, request: RecoveredScopeRequest): RecoveredScopeDecision {
    const scope = this.recoveryScope(runId);
    if (!scope.ok) {
      return { allowed: false, code: scope.code, message: scope.message, matched: null };
    }
    const operation = request.operation;
    const write = operation === 'edit' || operation === 'write';
    const read = operation === 'read' || operation === 'search';
    if (!write && !read) {
      return {
        allowed: false,
        code: 'NOT_AUTHORIZED',
        message: `恢复后的 Run 不接受操作 ${operation} 的路径校验`,
        matched: null,
      };
    }
    if (!scope.effectiveScope.operations.includes(operation)) {
      return {
        allowed: false,
        code: 'NOT_AUTHORIZED',
        message: `DispatchSnapshot 未授权操作 ${operation}（AC-082）`,
        matched: null,
      };
    }
    const paths = write ? scope.effectiveScope.writePaths : scope.effectiveScope.readPaths;
    const path = request.path;
    if (path === undefined) {
      return {
        allowed: true,
        code: 'MISSING_CONTEXT',
        message: `允许 ${operation}`,
        matched: null,
      };
    }
    const matched = paths.find((prefix) => pathInPrefix(path, prefix)) ?? null;
    if (matched === null) {
      return {
        allowed: false,
        code: 'NOT_AUTHORIZED',
        message: `路径 ${path} 不在恢复后 DispatchSnapshot 的 ${write ? 'writePaths' : 'readPaths'} 内；Work 宽范围不能替代（AC-082）`,
        matched: null,
      };
    }
    return {
      allowed: true,
      code: 'MISSING_CONTEXT',
      message: `路径 ${path} 命中快照范围 ${matched}`,
      matched,
    };
  }

  /** Builds the `RecoveryReport` of `reliability.md` §6 for one Run. */
  buildReport(runId: string, hostEpoch?: string): RecoveryReport {
    const run = this.store.runs.find(runId);
    if (run === undefined) protocolFail('NOT_FOUND', `Run ${runId} does not exist`, { runId });
    const inspection = this.inspectRun(run);
    const work = this.store.works.find(run.workId);
    const attempt =
      inspection.attemptId === null ? undefined : this.store.attempts.find(inspection.attemptId);
    const operations =
      inspection.attemptId === null ? [] : this.toolOperationsOf(inspection.attemptId);
    const externalEffects = operations
      .filter((operation) => UNCONFIRMED_TOOL_STATES.includes(operation.state))
      .map((operation) => `tool ${operation.toolName} (${operation.id}) 结果未知`);
    const project = this.store.projects.find(this.store.projectId);
    const gitHeads: Record<string, string | null> = {
      delivery: this.currentDeliveryRevision(project),
    };
    if (work?.baseRevision !== undefined) gitHeads['work.baseRevision'] = work.baseRevision;
    const body: Omit<RecoveryReport, 'hash'> = {
      workId: run.workId,
      operationId: run.id,
      hostEpoch: hostEpoch ?? null,
      expectedVersions: {
        run: run.version,
        attempt: attempt?.version ?? null,
        work: work?.version ?? null,
      },
      runnerState: {
        status: run.status,
        attemptId: inspection.attemptId,
        epoch: inspection.epoch,
        runnerId: inspection.runnerId,
        processAlive: inspection.processAlive,
        heartbeatAt: inspection.heartbeatAt,
        heartbeatStale: inspection.heartbeatStale,
      },
      leases: inspection.leases.map((lease) => ({
        resource: lease.resource,
        ownerAttemptId: lease.ownerAttemptId,
        epoch: lease.epoch,
        expiresAt: lease.expiresAt,
      })),
      gitHeads,
      diffRefs: this.diffRefs(run),
      toolOutcomes: operations.map((operation) => ({
        id: operation.id,
        toolName: operation.toolName,
        state: operation.state,
      })),
      externalEffects,
      unknowns: inspection.reasons,
      recommendedActions: [inspection.action],
    };
    return { ...body, hash: sha256(canonicalJson(body)) };
  }

  /** The newest host epoch recorded by a previous restart, when there is one. */
  lastHostEpoch(): string | null {
    const rows = this.store.operations.list({
      where: 'kind = ?',
      params: [RECOVERY_OPERATION_KIND],
      orderBy: 'created_at DESC',
      limit: 25,
    });
    for (const row of rows) {
      const step = row.stepResults['hostEpoch'];
      if (typeof step === 'string' && step !== '') return step;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private inspectRun(run: Run): RunRecoveryInspection {
    const latest = this.latestAttempt(run.id);
    const at = this.now();
    const heartbeatAt = latest?.heartbeatAt ?? null;
    const heartbeatAgeMs =
      heartbeatAt === null ? null : Math.max(0, Date.parse(at) - Date.parse(heartbeatAt));
    const heartbeatStale = heartbeatAgeMs === null || heartbeatAgeMs >= this.heartbeatTimeoutMs;
    const runnerId = latest?.runnerId ?? null;
    const processAlive = runnerId === null ? null : this.probe.probe(runnerId);
    const unknownToolOperations =
      latest === undefined
        ? []
        : this.toolOperationsOf(latest.id)
            .filter((operation) => UNCONFIRMED_TOOL_STATES.includes(operation.state))
            .map((operation) => operation.id);
    const leases = latest === undefined ? [] : this.leasesOf(latest.id);

    const reasons: string[] = [];
    if (latest === undefined) reasons.push('Run 无 Attempt 记录，按未开始处理');
    if (runnerId === null) {
      reasons.push('Attempt 未记录可检查的进程标识，旧执行是否终止无法确认');
    } else if (processAlive === true) {
      reasons.push(`旧执行进程 ${runnerId} 仍存活，未确认终止前不把工作区授予新写者`);
    } else if (processAlive === null) {
      reasons.push(`进程 ${runnerId} 状态无法确认（非本机 PID），按未确认终止处理`);
    } else {
      reasons.push(`旧执行进程 ${runnerId} 已确认终止`);
    }
    if (unknownToolOperations.length > 0) {
      reasons.push(
        `${String(unknownToolOperations.length)} 个工具操作结果未知，需 RecoveryDecision`,
      );
    }
    if (heartbeatStale) {
      reasons.push(
        heartbeatAgeMs === null
          ? '无心跳记录，超过心跳预算'
          : `心跳已过期 ${String(heartbeatAgeMs)}ms（预算 ${String(this.heartbeatTimeoutMs)}ms）`,
      );
    } else {
      reasons.push('心跳时间戳仍是新的，但daemon重启后不得据此直接继续运行');
    }

    if (!RESUMABLE_STATUSES.includes(run.status)) {
      return {
        runId: run.id,
        workId: run.workId,
        status: run.status,
        attemptId: latest?.id ?? null,
        epoch: latest?.ownerEpoch ?? null,
        runnerId,
        heartbeatAt,
        heartbeatAgeMs,
        heartbeatStale,
        processAlive,
        processChecked: runnerId !== null,
        unknownToolOperations,
        leases,
        action: 'none',
        requiresRecoveryDecision: false,
        newAttemptAllowed: false,
        reasons: [`Run 处于 ${run.status}，无需恢复`, ...reasons],
      };
    }

    // The old execution is only confirmed terminated when a real process identity
    // was checked and reported gone. Anything else — alive or unconfirmable — is a
    // double-writer risk and requires a RecoveryDecision.
    const confirmedTerminated = latest !== undefined && runnerId !== null && processAlive === false;
    const risky = !confirmedTerminated || unknownToolOperations.length > 0;
    const action: RunRecoveryAction = risky
      ? canTransitionRun(run.status, 'recovery_required')
        ? 'park_recovery_required'
        : // `starting` cannot jump to `recovery_required`; it is parked as
          // `interrupted` with a new Attempt still withheld.
          canTransitionRun(run.status, 'interrupted')
          ? 'park_interrupted'
          : 'none'
      : 'park_interrupted';
    return {
      runId: run.id,
      workId: run.workId,
      status: run.status,
      attemptId: latest?.id ?? null,
      epoch: latest?.ownerEpoch ?? null,
      runnerId,
      heartbeatAt,
      heartbeatAgeMs,
      heartbeatStale,
      processAlive,
      processChecked: runnerId !== null,
      unknownToolOperations,
      leases,
      action,
      requiresRecoveryDecision: risky,
      newAttemptAllowed: action === 'park_interrupted' && !risky,
      reasons,
    };
  }
  private apply(inspection: RunRecoveryInspection, hostEpoch: string): RunRecoveryApplyResult {
    const run = this.store.runs.find(inspection.runId);
    if (run === undefined) {
      protocolFail('NOT_FOUND', `Run ${inspection.runId} does not exist`, {
        runId: inspection.runId,
      });
    }
    const from = run.status;
    if (inspection.action === 'none') {
      return {
        runId: run.id,
        changed: false,
        from,
        to: from,
        path: [from],
        releasedLeases: [],
        attemptStatus: null,
        inspection,
      };
    }
    const target: RunStatus =
      inspection.action === 'park_recovery_required' ? 'recovery_required' : 'interrupted';
    return withTransaction(this.store.db, () => {
      const path = this.transitionPath(run, target);
      let current = run;
      for (const step of path.slice(1)) {
        current = this.store.runs.update(current.id, { status: step }, current.version);
      }
      const at = this.now();
      // Revoke the capability the parked execution could still hold
      // (`reliability.md` §2: "撤销Capability并终止旧执行").
      const released: string[] = [];
      for (const lease of inspection.leases) {
        if (this.store.leases.release(lease.resource, lease.ownerAttemptId, lease.epoch)) {
          released.push(lease.resource);
        }
      }
      let attemptStatus: AttemptStatus | null = null;
      if (inspection.attemptId !== null && inspection.processAlive === false) {
        const attempt = this.store.attempts.find(inspection.attemptId);
        if (
          attempt !== undefined &&
          (attempt.status === 'starting' || attempt.status === 'running')
        ) {
          const next = this.store.attempts.update(
            attempt.id,
            { status: 'lost', heartbeatAt: at },
            attempt.version,
          );
          attemptStatus = next.status;
        }
      }
      this.store.events.append({
        name: RUN_RECOVERED_EVENT,
        entityId: current.id,
        entityVersion: current.version,
        data: {
          runId: current.id,
          workId: current.workId,
          from,
          to: current.status,
          path: [...path],
          attemptId: inspection.attemptId,
          epoch: inspection.epoch,
          processAlive: inspection.processAlive,
          unknownToolOperations: [...inspection.unknownToolOperations],
          requiresRecoveryDecision: inspection.requiresRecoveryDecision,
          newAttemptAllowed: inspection.newAttemptAllowed,
          releasedLeases: released,
          hostEpoch,
          reasons: [...inspection.reasons],
        },
      });
      return {
        runId: run.id,
        changed: current.status !== from,
        from,
        to: current.status,
        path,
        releasedLeases: released,
        attemptStatus,
        inspection,
      };
    });
  }

  /** A legal transition path from the current state to `target`. */
  private transitionPath(run: Run, target: RunStatus): readonly RunStatus[] {
    if (run.status === target) return [run.status];
    if (canTransitionRun(run.status, target)) return [run.status, target];
    if (canTransitionRun(run.status, 'running') && canTransitionRun('running', target)) {
      return [run.status, 'running', target];
    }
    protocolFail(
      'INVALID_STATE',
      `Run ${run.id} 无法从 ${run.status} 停到 ${target}（不合法状态转换）`,
      { runId: run.id, from: run.status, to: target },
    );
  }

  private recordRestart(
    hostEpoch: string,
    applied: readonly RunRecoveryApplyResult[],
    reports: readonly RecoveryReport[],
  ): void {
    const operationRowId = this.store.newId();
    // `reportRef` is the addressable handle `recovery.resolve` checks a decision
    // against: the `recover` operation row that records the reports, plus the
    // report's own content hash (a report is content-addressed, `reliability.md` §6).
    const addresses = reports.map((report) => ({
      runId: report.operationId,
      workId: report.workId,
      hash: report.hash,
      reportRef: { id: operationRowId, version: 1, hash: report.hash },
    }));
    const byRun = new Map(applied.map((entry) => [entry.runId, entry]));
    const body: JsonObject = {
      hostEpoch,
      recovered: applied.map((entry) => ({
        runId: entry.runId,
        from: entry.from,
        to: entry.to,
        changed: entry.changed,
        requiresRecoveryDecision: entry.inspection.requiresRecoveryDecision,
        newAttemptAllowed: entry.inspection.newAttemptAllowed,
      })),
      reportHashes: reports.map((report) => report.hash),
      reports: addresses,
    };
    withTransaction(this.store.db, () => {
      this.store.operations.insert({
        id: operationRowId,
        projectId: this.store.projectId,
        sourceRef: { kind: 'action', id: `daemon-restart:${hostEpoch}`, version: '1' },
        kind: RECOVERY_OPERATION_KIND,
        state: 'completed',
        stepResults: body,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      // `protocol.md` §7: the report is ready in the same transaction that records
      // it. `data` carries the summary and the report reference; the full report is
      // fetched through its address, never copied into the event.
      reports.forEach((report, index) => {
        const address = addresses[index];
        const entry = byRun.get(report.operationId);
        if (address === undefined) return;
        this.store.events.append({
          name: RECOVERY_REPORT_READY_EVENT,
          // The report is about one Run; the envelope reports that Run's version at
          // the moment the restart found it (the report's own `expectedVersions.run`).
          entityId: report.operationId,
          entityVersion: report.expectedVersions.run,
          data: {
            runId: report.operationId,
            workId: report.workId,
            hostEpoch,
            reportRef: { ...address.reportRef },
            reportHash: report.hash,
            expectedVersions: { ...report.expectedVersions },
            runnerState: { ...report.runnerState },
            recommendedActions: [...report.recommendedActions],
            requiresRecoveryDecision: entry?.inspection.requiresRecoveryDecision ?? false,
            newAttemptAllowed: entry?.inspection.newAttemptAllowed ?? false,
            unknownCount: report.unknowns.length,
            externalEffectCount: report.externalEffects.length,
          },
        });
      });
    });
  }

  private latestAttempt(runId: string): Attempt | undefined {
    return this.store.attempts.list({
      where: 'run_id = ?',
      params: [runId],
      orderBy: 'number DESC',
      limit: 1,
    })[0];
  }

  private toolOperationsOf(attemptId: string): readonly ToolOperation[] {
    return this.store.toolOperations.list({
      where: 'attempt_id = ?',
      params: [attemptId],
      orderBy: 'created_at ASC',
    });
  }

  private leasesOf(attemptId: string): readonly Lease[] {
    return this.store.leases_.list({
      where: 'owner_attempt_id = ?',
      params: [attemptId],
      orderBy: 'resource ASC',
    });
  }

  private newerAcceptedDecision(workId: string, after: string): string | null {
    const rows = this.store.decisions.list({
      where: 'work_id = ? AND state = ?',
      params: [workId, 'accepted'],
      orderBy: 'created_at DESC',
      limit: 25,
    });
    const found = rows.find((decision) => Date.parse(decision.createdAt) > Date.parse(after));
    return found?.id ?? null;
  }

  private dispatchSnapshotOf(run: Run): DispatchSnapshotRead | RecoveryScopeFailure {
    const row = this.store.db
      .prepare('SELECT type, hash, payload FROM snapshot WHERE hash = ? LIMIT 1')
      .get(run.dispatchSnapshotId) as Record<string, unknown> | undefined;
    if (row === undefined) {
      return {
        ok: false,
        code: 'STALE_ARTIFACT',
        message: `Run ${run.id} 的 DispatchSnapshot ${run.dispatchSnapshotId} 不存在`,
      };
    }
    if (row['type'] !== 'dispatch') {
      return {
        ok: false,
        code: 'STALE_ARTIFACT',
        message: `快照 ${run.dispatchSnapshotId} 不是 dispatch 快照`,
      };
    }
    const payload = parseJson(row['payload'], 'snapshot.payload');
    const parsed = dispatchSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'STALE_ARTIFACT',
        message: `DispatchSnapshot ${run.dispatchSnapshotId} 不符合契约`,
      };
    }
    if (parsed.data.hash !== run.dispatchSnapshotId) {
      return {
        ok: false,
        code: 'STALE_ARTIFACT',
        message: `DispatchSnapshot 哈希与 Run 记录不一致（${parsed.data.hash}）`,
      };
    }
    return {
      ok: true,
      effectiveScope: parsed.data.effectiveScope,
      requiredOutputSchemas: parsed.data.requiredOutputSchemas,
    };
  }

  private currentDeliveryRevision(project: Project | undefined): string | null {
    if (project === undefined) return null;
    return readRefRevision(project.gitRoot ?? project.root, `refs/heads/${project.deliveryBranch}`);
  }

  private diffRefs(run: Run): readonly string[] {
    const refs = this.store.artifacts
      .list({ where: 'run_id = ?', params: [run.id], orderBy: 'created_at ASC' })
      .filter((artifact) => artifact.kind === 'diff' || artifact.kind === 'evidence')
      .map((artifact) => artifact.id);
    if (run.taskId !== undefined) refs.push(`task:${run.taskId}`);
    return refs;
  }
}

/** Reads a ref through the real `git` binary; `null` when it does not resolve. */
function readRefRevision(repoRoot: string, ref: string): string | null {
  const result = runGit(['rev-parse', '--verify', '--quiet', ref], { cwd: repoRoot });
  if (!result.ok) return null;
  const revision = result.stdout.trim();
  return revision === '' ? null : revision;
}

/** `null` when `attempt.runner_id` cannot be checked at all. */
export type ProcessAliveState = boolean | null;

/** What superseded a refused late result (`AC-058`). */
export type SupersededBy = 'newer_attempt' | 'cancellation' | 'newer_decision' | 'terminal' | null;

export interface AttemptResultSubmission {
  readonly runId: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly status: 'success' | 'needs_input' | 'failed';
  readonly summary: string;
  readonly evidenceRefs?: readonly string[];
}

export type AttemptResultDisposition =
  | {
      readonly accepted: true;
      readonly runId: string;
      readonly attemptId: string;
      readonly epoch: number;
      readonly status: AttemptResultSubmission['status'];
      readonly summary: string;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly accepted: false;
      readonly code: ProtocolErrorCode;
      readonly message: string;
      /** Always `true` for a late result: the refusal itself is evidence. */
      readonly diagnosticsKept: boolean;
      readonly diagnosticEventId: string | null;
      readonly currentEpoch: number | null;
      readonly currentStatus: RunStatus | null;
      readonly supersededBy: SupersededBy;
    };

export interface RecoveryScopeSuccess {
  readonly ok: true;
  readonly runId: string;
  readonly dispatchSnapshotId: string;
  readonly source: 'dispatch_snapshot';
  readonly effectiveScope: Scope;
  readonly requiredOutputSchemas: readonly { readonly kind: string; readonly schemaVersion: 1 }[];
  /** The Work's own (possibly wider) scope, reported for the audit trail only. */
  readonly workScope: Scope | null;
  /** `true` when the Work scope would have allowed more than the snapshot does. */
  readonly workScopeIgnored: boolean;
}

export interface RecoveryScopeFailure {
  readonly ok: false;
  readonly code: ProtocolErrorCode;
  readonly message: string;
}

export type RecoveryScopeResult = RecoveryScopeSuccess | RecoveryScopeFailure;

interface DispatchSnapshotRead {
  readonly ok: true;
  readonly effectiveScope: Scope;
  readonly requiredOutputSchemas: readonly { readonly kind: string; readonly schemaVersion: 1 }[];
}

export interface RecoveredScopeRequest {
  readonly operation: string;
  readonly path?: string;
}

export interface RecoveredScopeDecision {
  readonly allowed: boolean;
  readonly code: ProtocolErrorCode;
  readonly message: string;
  /** The scope prefix that admitted the path, when one did. */
  readonly matched: string | null;
}

/** `reliability.md` §6 `RecoveryReport`. */
export interface RecoveryReport {
  readonly workId: string;
  readonly operationId: string;
  /** The daemon epoch that produced this report; `null` for an ad-hoc report. */
  readonly hostEpoch: string | null;
  readonly expectedVersions: {
    readonly run: number;
    readonly attempt: number | null;
    readonly work: number | null;
  };
  readonly runnerState: {
    readonly status: RunStatus;
    readonly attemptId: string | null;
    readonly epoch: number | null;
    readonly runnerId: string | null;
    readonly processAlive: ProcessAliveState;
    readonly heartbeatAt: string | null;
    readonly heartbeatStale: boolean;
  };
  readonly leases: readonly {
    readonly resource: string;
    readonly ownerAttemptId: string;
    readonly epoch: number;
    readonly expiresAt: string;
  }[];
  readonly gitHeads: Readonly<Record<string, string | null>>;
  readonly diffRefs: readonly string[];
  readonly toolOutcomes: readonly {
    readonly id: string;
    readonly toolName: string;
    readonly state: ToolOperation['state'];
  }[];
  readonly externalEffects: readonly string[];
  readonly unknowns: readonly string[];
  readonly recommendedActions: readonly string[];
  readonly hash: string;
}

export interface RestartRecoveryResult {
  readonly hostEpoch: string;
  readonly previousHostEpoch: string | null;
  readonly inspections: readonly RunRecoveryInspection[];
  readonly applied: readonly RunRecoveryApplyResult[];
  /** Runs that need a user/Core RecoveryDecision before a new Attempt. */
  readonly requiresDecision: readonly string[];
  readonly reports: readonly RecoveryReport[];
}

/** `.`/`./` and the empty prefix mean the whole repository (mirrors `acl.ts`). */
function pathInPrefix(path: string, prefix: string): boolean {
  if (prefix === '' || prefix === '.' || prefix === './') return true;
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const normalized = path.replaceAll('\\', '/');
  return normalized === base || normalized.startsWith(`${base}/`);
}

function sameScope(left: Scope, right: Scope): boolean {
  const sorted = (values: readonly string[]): string => [...values].sort().join('\u0000');
  return (
    sorted(left.readPaths) === sorted(right.readPaths) &&
    sorted(left.writePaths) === sorted(right.writePaths) &&
    sorted(left.operations) === sorted(right.operations) &&
    sorted(left.networkTargets) === sorted(right.networkTargets)
  );
}

// ---------------------------------------------------------------------------
// Backup / restore / relocate (AC-064)
// ---------------------------------------------------------------------------

/** One file entry of a backup manifest. */
export interface BackupFileEntry {
  /** Path relative to the backup directory, `/`-separated. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** One referenced evidence blob, recorded so a restore can prove it is present. */
export interface BackupEvidenceEntry {
  readonly artifactId: string;
  readonly relativeBlobPath: string;
  readonly contentHash: string;
  readonly bytes: number;
}

/** The self-describing backup manifest (`reliability.md` §8). */
export interface BackupManifest {
  readonly schemaVersion: number;
  readonly backupId: string;
  readonly projectId: string;
  readonly createdAt: string;
  /** Canonical root the backup was taken at; the restore target may differ. */
  readonly canonicalRoot: string;
  readonly deliveryBranch: string;
  readonly ref: string;
  /** Delivery revision and tree at backup time; `null` for an unborn branch. */
  readonly revision: string | null;
  readonly tree: string | null;
  readonly documentRoot: string;
  /** `false` until every file is present and hashed; a restore refuses `false`. */
  readonly complete: boolean;
  readonly database: BackupFileEntry;
  readonly blobs: readonly BackupFileEntry[];
  readonly knowledge: {
    readonly root: string;
    readonly treeHash: string;
    readonly files: readonly BackupFileEntry[];
  };
  readonly git: { readonly path: string; readonly bytes: number; readonly sha256: string } | null;
  /** Secret *identifiers* the project needs; values are never backed up. */
  readonly secretRefs: readonly string[];
  readonly evidence: readonly BackupEvidenceEntry[];
  readonly files: readonly BackupFileEntry[];
  readonly operationId: string;
}

export type BackupOutcome =
  | {
      readonly ok: true;
      readonly backupId: string;
      readonly directory: string;
      readonly manifest: BackupManifest;
      readonly manifestPath: string;
    }
  | {
      readonly ok: false;
      readonly code: ProtocolErrorCode;
      readonly message: string;
      readonly reasons: readonly string[];
      /** `true` when an incomplete backup directory was left behind. */
      readonly incomplete: boolean;
    };

/** Git operations a backup/restore needs; the real port runs the `git` binary. */
export interface BackupGitPort {
  readonly kind: string;
  bundle(repoRoot: string, outputPath: string): GitResult<{ readonly bytes: number }>;
  /** Restores a bundle (or creates an empty repo) and checks out `branch`. */
  materialize(input: {
    readonly repoRoot: string;
    readonly branch: string;
    readonly bundlePath?: string;
  }): GitResult<{ readonly revision: string | null }>;
  revision(repoRoot: string, ref: string): GitResult<string | null>;
  tree(repoRoot: string, revision: string): GitResult<string | null>;
  isClean(repoRoot: string): GitResult<boolean>;
}

function gitDiagnostic(
  repoRoot: string,
  args: readonly string[],
  message: string,
  detail: string,
): WorkspaceDiagnostic {
  return {
    code: 'INTERNAL_ERROR',
    message: detail.trim() === '' ? message : `${message}：${detail.trim()}`,
    path: repoRoot,
    command: args,
  };
}

/** Real `git` implementation of `BackupGitPort` (explicit argv, no shell). */
export function createNodeBackupGitPort(): BackupGitPort {
  const run = (cwd: string, args: readonly string[]): ReturnType<typeof runGit> =>
    runGit(args, { cwd });
  return {
    kind: 'node-git',
    bundle(repoRoot, outputPath) {
      const head = run(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
      if (!head.ok || head.stdout.trim() === '') {
        return {
          ok: false,
          errors: [gitDiagnostic(repoRoot, ['rev-parse', 'HEAD'], '仓库没有可打包的提交', '')],
        };
      }
      const args = ['bundle', 'create', outputPath, '--all'];
      const outcome = run(repoRoot, args);
      if (!outcome.ok) {
        return {
          ok: false,
          errors: [gitDiagnostic(repoRoot, args, 'git bundle 失败', outcome.stderr)],
        };
      }
      return { ok: true, value: { bytes: statSync(outputPath).size } };
    },
    materialize(input) {
      if (!existsSync(input.repoRoot)) mkdirSync(input.repoRoot, { recursive: true });
      const initArgs = ['init', '--quiet', '-b', input.branch];
      const init = run(input.repoRoot, initArgs);
      if (!init.ok) {
        return {
          ok: false,
          errors: [gitDiagnostic(input.repoRoot, initArgs, 'git init 失败', init.stderr)],
        };
      }
      if (input.bundlePath !== undefined) {
        const fetchArgs = [
          'fetch',
          '--quiet',
          '--update-head-ok',
          input.bundlePath,
          '+refs/heads/*:refs/heads/*',
        ];
        const fetched = run(input.repoRoot, fetchArgs);
        if (!fetched.ok) {
          return {
            ok: false,
            errors: [
              gitDiagnostic(input.repoRoot, fetchArgs, 'git fetch <bundle> 失败', fetched.stderr),
            ],
          };
        }
        const checkoutArgs = ['checkout', '--quiet', '--force', input.branch];
        const checked = run(input.repoRoot, checkoutArgs);
        if (!checked.ok) {
          return {
            ok: false,
            errors: [
              gitDiagnostic(input.repoRoot, checkoutArgs, 'git checkout 失败', checked.stderr),
            ],
          };
        }
      }
      const head = run(input.repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
      if (!head.ok) return { ok: true, value: { revision: null } };
      const revision = head.stdout.trim();
      return { ok: true, value: { revision: revision === '' ? null : revision } };
    },
    revision(repoRoot, ref) {
      const outcome = run(repoRoot, ['rev-parse', '--verify', '--quiet', ref]);
      if (!outcome.ok) return { ok: true, value: null };
      const revision = outcome.stdout.trim();
      return { ok: true, value: revision === '' ? null : revision };
    },
    tree(repoRoot, revision) {
      const args = ['rev-parse', `${revision}^{tree}`];
      const outcome = run(repoRoot, args);
      if (!outcome.ok) {
        return {
          ok: false,
          errors: [gitDiagnostic(repoRoot, args, '读取 tree 失败', outcome.stderr)],
        };
      }
      const tree = outcome.stdout.trim();
      return { ok: true, value: tree === '' ? null : tree };
    },
    isClean(repoRoot) {
      const args = ['status', '--porcelain=v1', '--untracked-files=all'];
      const outcome = run(repoRoot, args);
      if (!outcome.ok) {
        return {
          ok: false,
          errors: [gitDiagnostic(repoRoot, args, 'git status 失败', outcome.stderr)],
        };
      }
      return { ok: true, value: outcome.stdout.trim() === '' };
    },
  };
}

export interface BackupProjectInput {
  readonly store: ProjectStoreType;
  readonly git: BackupGitPort;
  /** Destination directory; must be absent or empty unless `replace`. */
  readonly outputDir: string;
  /** Repository to bundle; defaults to the Project's `gitRoot`/`root`. */
  readonly repoRoot?: string;
  readonly deliveryBranch?: string;
  readonly documentRoot?: string;
  /** Secret identifiers the project needs; values are never written. */
  readonly secretRefs?: readonly string[];
  readonly replace?: boolean;
  readonly now?: () => string;
}

function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        walk(child);
      } else if (entry.isFile()) {
        found.push(child);
      }
    }
  };
  walk(root);
  return found.sort();
}

function fileEntry(absolute: string, path: string): BackupFileEntry {
  const content = readFileSync(absolute);
  return { path, sha256: sha256(content), bytes: content.byteLength };
}

/** Copies the *contents* of `source` into `dest`, creating `dest` as needed. */
function copyTreeContents(source: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTreeContents(from, to);
    else if (entry.isFile()) cpSync(from, to);
  }
}

/** The knowledge tree hash: sorted `path\0hash\n` over the copied documents. */
export function knowledgeTreeHash(files: readonly BackupFileEntry[]): string {
  const normalized = [...files]
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return sha256(normalized.map((file) => `${file.path}\u0000${file.sha256}\n`).join(''));
}

/**
 * Snapshots one Project into `outputDir` (`reliability.md` §8).
 *
 * The manifest is written only after the database snapshot, the blobs, the
 * knowledge copy and the Git bundle are all present and hashed, so an interrupted
 * backup is either absent or explicitly `complete:false` and can never be
 * restored by accident.
 */
export function backupProject(input: BackupProjectInput): BackupOutcome {
  const project = input.store.projects.find(input.store.projectId);
  if (project === undefined) {
    return backupRefusal('INVALID_STATE', `Project ${input.store.projectId} 不存在`, false);
  }
  const repoRoot = input.repoRoot ?? project.gitRoot ?? project.root;
  const branch = input.deliveryBranch ?? project.deliveryBranch;
  const documentRoot = input.documentRoot ?? project.documentRoot;
  const ref = `refs/heads/${branch}`;
  const now = input.now ?? (() => nowIso());
  const outputDir = resolve(input.outputDir);

  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    if (input.replace !== true) {
      return backupRefusal(
        'INVALID_STATE',
        `备份目标 ${outputDir} 非空；只允许写入空目录（或显式 replace）`,
        false,
      );
    }
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });

  // Every referenced evidence blob must exist before a backup may claim to be
  // complete; a missing artifact is `ARTIFACT_MISSING`, not a silent omission.
  const evidence: BackupEvidenceEntry[] = [];
  const missingEvidence: string[] = [];
  for (const artifact of input.store.artifacts.list({ orderBy: 'created_at ASC' })) {
    const absolute = join(input.store.dataDir, artifact.relativeBlobPath);
    if (!existsSync(absolute)) {
      missingEvidence.push(`${artifact.id}:${artifact.relativeBlobPath}`);
      continue;
    }
    const content = readFileSync(absolute);
    if (sha256(content) !== artifact.contentHash) {
      missingEvidence.push(`${artifact.id}:hash-mismatch`);
      continue;
    }
    evidence.push({
      artifactId: artifact.id,
      relativeBlobPath: artifact.relativeBlobPath,
      contentHash: artifact.contentHash,
      bytes: content.byteLength,
    });
  }
  if (missingEvidence.length > 0) {
    return backupRefusal(
      'ARTIFACT_MISSING',
      `备份发现 ${String(missingEvidence.length)} 个缺失/损坏的证据 blob，拒绝生成不完整备份`,
      false,
    );
  }

  const backupId = input.store.newId();
  const manifestPath = join(outputDir, BACKUP_MANIFEST_NAME);
  const databasePath = join(outputDir, BACKUP_DATABASE_PATH);
  const blobsDir = join(outputDir, BACKUP_BLOBS_PATH);
  const knowledgeDir = join(outputDir, BACKUP_KNOWLEDGE_PATH);

  try {
    // 1. A consistent SQLite snapshot without stopping writers. `backupDatabase`
    //    is SQLite's documented online-consistent `VACUUM INTO` copy; the result is
    //    then verified with `PRAGMA integrity_check` before it is trusted.
    backupDatabase(input.store.db, databasePath);
    verifyDatabaseCopy(databasePath);

    // 2. Blobs (artifact/evidence/message content).
    const blobsSource = join(input.store.dataDir, BACKUP_BLOBS_PATH);
    if (existsSync(blobsSource)) cpSync(blobsSource, blobsDir, { recursive: true });

    // 3. Knowledge: the document tree exactly as it exists on disk.
    const knowledgeSource = join(repoRoot, documentRoot);
    const knowledgeFiles: BackupFileEntry[] = [];
    for (const absolute of listFilesRecursive(knowledgeSource)) {
      const rel = relative(knowledgeSource, absolute).split(sep).join('/');
      const destination = join(knowledgeDir, rel);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(absolute, destination);
      knowledgeFiles.push(fileEntry(destination, rel));
    }

    // 4. Git bundle of every AgentDev ref.
    const gitPath = join(outputDir, BACKUP_GIT_PATH);
    const bundled = input.git.bundle(repoRoot, gitPath);
    let gitEntry: BackupManifest['git'] = null;
    if (bundled.ok) {
      gitEntry = {
        path: BACKUP_GIT_PATH,
        bytes: bundled.value.bytes,
        sha256: sha256(readFileSync(gitPath)),
      };
    } else {
      rmSync(gitPath, { force: true });
    }

    const revisionResult = input.git.revision(repoRoot, ref);
    const deliveryRevision = revisionResult.ok ? revisionResult.value : null;
    const treeResult =
      deliveryRevision === null ? null : input.git.tree(repoRoot, deliveryRevision);
    const tree = treeResult !== null && treeResult.ok ? treeResult.value : null;

    // 5. Manifest with hashes over everything that was copied.
    const database: BackupFileEntry = fileEntry(databasePath, BACKUP_DATABASE_PATH);
    const blobs = listFilesRecursive(blobsDir).map((absolute) =>
      fileEntry(absolute, relative(outputDir, absolute).split(sep).join('/')),
    );
    const knowledge = knowledgeFiles.map((entry) => ({
      ...entry,
      path: `${BACKUP_KNOWLEDGE_PATH}/${entry.path}`,
    }));
    const gitFiles = gitEntry === null ? [] : [fileEntry(gitPath, gitEntry.path)];
    const manifest: BackupManifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      backupId,
      projectId: project.id,
      createdAt: now(),
      canonicalRoot: repoRoot,
      deliveryBranch: branch,
      ref,
      revision: deliveryRevision,
      tree,
      documentRoot,
      complete: true,
      database,
      blobs,
      knowledge: {
        root: BACKUP_KNOWLEDGE_PATH,
        treeHash: knowledgeTreeHash(knowledgeFiles),
        files: knowledgeFiles,
      },
      git: gitEntry,
      secretRefs: [...(input.secretRefs ?? [])],
      evidence,
      files: [database, ...blobs, ...knowledge, ...gitFiles],
      operationId: input.store.newId(),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { ok: true, backupId, directory: outputDir, manifest, manifestPath };
  } catch (error) {
    return backupRefusal(
      'INTERNAL_ERROR',
      `备份失败：${error instanceof Error ? error.message : String(error)}`,
      existsSync(outputDir),
    );
  }
}

function backupRefusal(
  code: ProtocolErrorCode,
  message: string,
  incomplete: boolean,
): Extract<BackupOutcome, { ok: false }> {
  return { ok: false, code, message, reasons: [message], incomplete };
}

/** Opens a copied database read-only and runs SQLite's own integrity check. */
function verifyDatabaseCopy(file: string): void {
  const db = openDatabase({ file, readOnly: true });
  try {
    const rows = db.pragma('integrity_check') as readonly Record<string, unknown>[];
    const first = rows[0];
    const value = first === undefined ? '' : Object.values(first)[0];
    if (value !== 'ok') {
      throw new ProtocolError('INTERNAL_ERROR', `SQLite 备份完整性检查失败：${String(value)}`);
    }
  } finally {
    db.close();
  }
}

export interface RestoreDoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RestoreDoctorReport {
  readonly ok: boolean;
  readonly checks: readonly RestoreDoctorCheck[];
  /** `true` only when every check passed and no Provider Secret is missing. */
  readonly executionReady: boolean;
}

export interface RestoreProjectInput {
  readonly backupDir: string;
  /** New directory the project is restored into (repository + state). */
  readonly targetDir: string;
  readonly git: BackupGitPort;
  /** State directory; defaults to `<targetDir>/state`. */
  readonly dataDir?: string;
  /** Repository directory; defaults to `<targetDir>/repo`. */
  readonly repoRoot?: string;
  /** Secret identifiers the caller can actually resolve right now. */
  readonly secretAvailable?: (ref: string) => boolean;
  /** Deterministic process probe; defaults to the real host process table. */
  readonly probe?: ProcessProbe;
  readonly replace?: boolean;
  readonly now?: () => string;
}

export interface ParkedRun {
  readonly runId: string;
  readonly from: RunStatus;
  readonly to: RunStatus;
  readonly path: readonly RunStatus[];
}

export interface RestoreOutcome {
  readonly ok: true;
  /**
   * `blocked` means the files are restored but the project must not execute:
   * a required Provider Secret is missing (`reliability.md` §8).
   */
  readonly status: 'ready' | 'blocked';
  readonly projectId: string;
  readonly dataDir: string;
  readonly repoRoot: string;
  readonly revision: string | null;
  readonly tree: string | null;
  readonly consistency: {
    readonly filesVerified: number;
    readonly blobsVerified: number;
    readonly knowledgeVerified: number;
    readonly evidenceVerified: number;
    readonly treeMatches: boolean;
    readonly knowledgeMatchesTree: boolean;
  };
  readonly recovery: {
    readonly parked: readonly ParkedRun[];
    readonly interruptedRunIds: readonly string[];
    readonly revokedLeases: number;
    readonly revokedGrants: number;
  };
  readonly doctor: RestoreDoctorReport;
  readonly provider: { readonly blocked: boolean; readonly missingSecretRefs: readonly string[] };
}

export interface RestoreFailure {
  readonly ok: false;
  readonly code: ProtocolErrorCode;
  readonly message: string;
  readonly reasons: readonly string[];
  /** `true` when a partial restore was left behind and must be inspected. */
  readonly partial: boolean;
}

export type RestoreResult = RestoreOutcome | RestoreFailure;

function readManifest(backupDir: string): BackupManifest | RestoreFailure {
  const path = join(backupDir, BACKUP_MANIFEST_NAME);
  if (!existsSync(path)) {
    return restoreFailure('NOT_FOUND', `备份缺少 ${BACKUP_MANIFEST_NAME}：${backupDir}`, false);
  }
  const raw = parseJson(readFileSync(path, 'utf8'), BACKUP_MANIFEST_NAME);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return restoreFailure('VALIDATION_ERROR', '备份清单必须是对象', false);
  }
  const manifest = raw as BackupManifest;
  if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return restoreFailure(
      'VALIDATION_ERROR',
      `不支持的备份格式版本 ${String(manifest.schemaVersion)}`,
      false,
    );
  }
  if (manifest.complete !== true) {
    return restoreFailure(
      'INVALID_STATE',
      '备份标记为 incomplete（生成中断）；restore 拒绝不完整备份',
      false,
    );
  }
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.knowledge?.files)) {
    return restoreFailure('VALIDATION_ERROR', '备份清单缺少文件清单', false);
  }
  return manifest;
}

function restoreFailure(
  code: ProtocolErrorCode,
  message: string,
  partial: boolean,
): RestoreFailure {
  return { ok: false, code, message, reasons: [message], partial };
}

/**
 * Restores a backup into a brand-new directory (`reliability.md` §8, AC-064).
 *
 * The restore is deliberately conservative: the manifest and every hash are
 * verified first, the Project's old leases and capabilities are revoked, every
 * previously active Run is parked for recovery, and a missing Provider Secret
 * leaves the result `blocked` rather than silently runnable.
 */
export function restoreProject(input: RestoreProjectInput): RestoreResult {
  const backupDir = resolve(input.backupDir);
  const manifest = readManifest(backupDir);
  if ('ok' in manifest) return manifest;

  const targetDir = resolve(input.targetDir);
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    if (input.replace !== true) {
      return restoreFailure(
        'INVALID_STATE',
        `恢复目标 ${targetDir} 非空；只允许恢复到新目录（或显式 replace）`,
        false,
      );
    }
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const dataDir = resolve(input.dataDir ?? join(targetDir, 'state'));
  const repoRoot = resolve(input.repoRoot ?? join(targetDir, 'repo'));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  // 1. Every hashed file must match before anything is written.
  const mismatched: string[] = [];
  for (const entry of manifest.files) {
    const absolute = join(backupDir, entry.path);
    if (!existsSync(absolute)) {
      mismatched.push(`${entry.path}:missing`);
      continue;
    }
    const content = readFileSync(absolute);
    if (sha256(content) !== entry.sha256 || content.byteLength !== entry.bytes) {
      mismatched.push(`${entry.path}:hash`);
    }
  }
  if (mismatched.length > 0) {
    return restoreFailure(
      'STALE_ARTIFACT',
      `备份校验失败（${String(mismatched.length)} 项）：${mismatched.slice(0, 5).join('、')}`,
      false,
    );
  }

  try {
    // 2. Repository first (fetch from the bundle), then the recorded knowledge
    //    bytes on top; the working tree must end up clean, which is the proof that
    //    the knowledge copy and the committed tree agree.
    const bundlePath = manifest.git === null ? undefined : join(backupDir, manifest.git.path);
    const materialized = input.git.materialize({
      repoRoot,
      branch: manifest.deliveryBranch,
      ...(bundlePath === undefined ? {} : { bundlePath }),
    });
    if (!materialized.ok) {
      return restoreFailure('INTERNAL_ERROR', '从备份恢复 Git 仓库失败', true);
    }
    const knowledgeSource = join(backupDir, BACKUP_KNOWLEDGE_PATH);
    if (existsSync(knowledgeSource)) {
      // The checkout already created the document root, so the recorded bytes are
      // merged *into* it; a directory-into-directory `cpSync` would nest them.
      copyTreeContents(knowledgeSource, join(repoRoot, manifest.documentRoot));
    }

    // 3. Database + blobs.
    cpSync(join(backupDir, BACKUP_DATABASE_PATH), join(dataDir, BACKUP_DATABASE_PATH));
    verifyDatabaseCopy(join(dataDir, BACKUP_DATABASE_PATH));
    const blobsSource = join(backupDir, BACKUP_BLOBS_PATH);
    if (existsSync(blobsSource)) {
      cpSync(blobsSource, join(dataDir, BACKUP_BLOBS_PATH), { recursive: true });
    }

    // 4. Open the restored store, remap the canonical root, revoke old authority
    //    and park the previously active Runs.
    const store = ProjectStore.open({
      dataDir,
      canonicalRoot: repoRoot,
      projectId: manifest.projectId,
    });
    let recovery: RestoreOutcome['recovery'];
    let knowledgeMatchesTree = false;
    let treeMatches = false;
    let evidenceVerified = 0;
    let evidenceMissing: readonly string[] = [];
    let doctor: RestoreDoctorReport;
    try {
      const project = store.projects.find(store.projectId);
      if (project === undefined) {
        return restoreFailure('INVALID_STATE', '恢复后的数据库中找不到 Project 行', true);
      }
      store.projects.update(project.id, { root: repoRoot, gitRoot: repoRoot }, project.version);
      const service = new RunRecoveryService({
        store,
        ...(input.probe === undefined ? {} : { probe: input.probe }),
        ...(input.now === undefined ? {} : { now: input.now }),
      });
      recovery = parkAll(store, service);
      const evidence = inspectRestoredEvidence(store);
      evidenceVerified = evidence.verified;
      evidenceMissing = evidence.missing;
      const restoredRef = input.git.revision(repoRoot, manifest.ref);
      const revision = restoredRef.ok ? restoredRef.value : null;
      if (revision !== null) {
        const tree = input.git.tree(repoRoot, revision);
        treeMatches = tree.ok && tree.value !== null && tree.value === manifest.tree;
      }
      const clean = input.git.isClean(repoRoot);
      knowledgeMatchesTree = clean.ok && clean.value;
      doctor = doctorReport(store, {
        repoRoot,
        dataDir,
        revision,
        expectedTree: manifest.tree,
        treeMatches,
        knowledgeMatchesTree,
        evidenceVerified,
        evidenceExpected: manifest.evidence.length,
      });
    } finally {
      store.close();
    }

    if (evidenceMissing.length > 0) {
      return restoreFailure(
        'ARTIFACT_MISSING',
        `恢复后 ${String(evidenceMissing.length)} 个证据 blob 缺失/损坏：${evidenceMissing.slice(0, 3).join('、')}`,
        true,
      );
    }

    const secretAvailable = input.secretAvailable ?? (() => false);
    const missingSecretRefs = manifest.secretRefs.filter((ref) => !secretAvailable(ref));
    const providerBlocked = missingSecretRefs.length > 0;
    const status: RestoreOutcome['status'] = providerBlocked ? 'blocked' : 'ready';
    const finalDoctor: RestoreDoctorReport = {
      ...doctor,
      executionReady: doctor.ok && !providerBlocked,
    };
    recordRestoreOperation(dataDir, {
      status,
      projectId: manifest.projectId,
      backupId: manifest.backupId,
      missingSecretRefs,
      recovery,
      ...(input.now === undefined ? {} : { now: input.now }),
    });

    return {
      ok: true,
      status,
      projectId: manifest.projectId,
      dataDir,
      repoRoot,
      revision: manifest.revision,
      tree: manifest.tree,
      consistency: {
        filesVerified: manifest.files.length,
        blobsVerified: manifest.blobs.length,
        knowledgeVerified: manifest.knowledge.files.length,
        evidenceVerified,
        treeMatches,
        knowledgeMatchesTree,
      },
      recovery,
      doctor: finalDoctor,
      provider: { blocked: providerBlocked, missingSecretRefs },
    };
  } catch (error) {
    return restoreFailure(
      'INTERNAL_ERROR',
      `恢复失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

function parkAll(store: ProjectStoreType, service: RunRecoveryService): RestoreOutcome['recovery'] {
  const parked: ParkedRun[] = [];
  let revokedLeases = 0;
  for (const inspection of service.inspectActive()) {
    const applied = service.recoverRun(inspection.runId);
    if (applied.changed) {
      parked.push({
        runId: applied.runId,
        from: applied.from,
        to: applied.to,
        path: applied.path,
      });
    }
    revokedLeases += applied.releasedLeases.length;
  }
  // Whatever the parking left behind (a stale row whose owner never parked), every
  // old lease is revoked after a restore (`reliability.md` §8 "撤销所有旧租约").
  revokedLeases += store.leases.releaseAll();
  const revokedGrants = revokeAllGrants(store);
  return {
    parked,
    interruptedRunIds: parked
      .filter((entry) => entry.to === 'interrupted')
      .map((entry) => entry.runId),
    revokedLeases,
    revokedGrants,
  };
}

/**
 * Expires every grant that has not been consumed yet.
 *
 * A restored database must not carry a capability issued before the restore: the
 * decision behind it belonged to another host/session. Grants are immutable
 * history, so they are superseded by setting `consumed_at` rather than deleted.
 */
function revokeAllGrants(store: ProjectStoreType): number {
  const at = nowIso();
  let revoked = 0;
  for (const grant of store.grants.list({ orderBy: 'created_at ASC' })) {
    if (grant.consumedAt !== undefined) continue;
    store.grants.update(grant.id, { consumedAt: at }, grant.version);
    revoked += 1;
  }
  return revoked;
}

function inspectRestoredEvidence(store: ProjectStoreType): {
  readonly verified: number;
  readonly missing: readonly string[];
} {
  let verified = 0;
  const missing: string[] = [];
  for (const artifact of store.artifacts.list({ orderBy: 'created_at ASC' })) {
    const absolute = join(store.dataDir, artifact.relativeBlobPath);
    if (!existsSync(absolute)) {
      missing.push(`${artifact.id}:missing`);
      continue;
    }
    if (sha256(readFileSync(absolute)) !== artifact.contentHash) {
      missing.push(`${artifact.id}:hash`);
      continue;
    }
    verified += 1;
  }
  return { verified, missing };
}

function doctorReport(
  store: ProjectStoreType,
  facts: {
    readonly repoRoot: string;
    readonly dataDir: string;
    readonly revision: string | null;
    readonly expectedTree: string | null;
    readonly treeMatches: boolean;
    readonly knowledgeMatchesTree: boolean;
    readonly evidenceVerified: number;
    readonly evidenceExpected: number;
  },
): RestoreDoctorReport {
  const checks: RestoreDoctorCheck[] = [];
  const project = store.projects.find(store.projectId);
  checks.push({
    name: 'project-row',
    ok: project !== undefined,
    detail: project === undefined ? '缺少 Project 行' : `project ${project.id}`,
  });
  checks.push({
    name: 'state-directory',
    ok: existsSync(facts.dataDir),
    detail: facts.dataDir,
  });
  const pragmas = store.db.pragma('integrity_check') as readonly Record<string, unknown>[];
  const integrity = pragmas[0] === undefined ? '' : String(Object.values(pragmas[0])[0]);
  checks.push({ name: 'sqlite-integrity', ok: integrity === 'ok', detail: integrity });
  checks.push({
    name: 'delivery-ref',
    ok: facts.revision !== null,
    detail: facts.revision ?? '交付 ref 不存在',
  });
  checks.push({
    name: 'tree-binding',
    ok: facts.treeMatches,
    detail: facts.treeMatches
      ? `${facts.revision ?? ''} tree ${facts.expectedTree ?? ''}`
      : `tree 与备份记录不一致（期望 ${facts.expectedTree ?? 'none'}）`,
  });
  checks.push({
    name: 'knowledge-clean',
    ok: facts.knowledgeMatchesTree,
    detail: facts.knowledgeMatchesTree ? '知识文件与提交树一致' : '工作树存在未提交差异',
  });
  checks.push({
    name: 'evidence',
    ok: facts.evidenceVerified === facts.evidenceExpected,
    detail: `${String(facts.evidenceVerified)}/${String(facts.evidenceExpected)} 证据 blob 校验通过`,
  });
  const remainingLeases = store.leases_.list({}).length;
  checks.push({
    name: 'leases-revoked',
    ok: remainingLeases === 0,
    detail: remainingLeases === 0 ? '无残留租约' : `${String(remainingLeases)} 条租约未撤销`,
  });
  const liveGrants = store.grants
    .list({ orderBy: 'created_at ASC' })
    .filter((grant) => grant.consumedAt === undefined).length;
  checks.push({
    name: 'capabilities-revoked',
    ok: liveGrants === 0,
    detail: liveGrants === 0 ? '无未消费 Grant' : `${String(liveGrants)} 个 Grant 未撤销`,
  });
  const ok = checks.every((check) => check.ok);
  return { ok, checks, executionReady: ok };
}

function recordRestoreOperation(
  dataDir: string,
  facts: {
    readonly status: 'ready' | 'blocked';
    readonly projectId: string;
    readonly backupId: string;
    readonly missingSecretRefs: readonly string[];
    readonly recovery: RestoreOutcome['recovery'];
    readonly now?: () => string;
  },
): void {
  const store = ProjectStore.open({ dataDir, projectId: facts.projectId });
  try {
    const at = facts.now ?? (() => nowIso());
    store.operations.insert({
      id: store.newId(),
      projectId: store.projectId,
      sourceRef: { kind: 'action', id: `backup:${facts.backupId}`, version: '1' },
      kind: 'recover',
      state: facts.status === 'ready' ? 'completed' : 'failed',
      stepResults: {
        backupId: facts.backupId,
        status: facts.status,
        parked: facts.recovery.parked.map((entry) => ({ runId: entry.runId, to: entry.to })),
        revokedLeases: facts.recovery.revokedLeases,
        revokedGrants: facts.recovery.revokedGrants,
      },
      ...(facts.status === 'ready'
        ? {}
        : {
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: `缺少 Provider Secret：${facts.missingSecretRefs.join('、')}`,
            },
          }),
      createdAt: at(),
      updatedAt: at(),
    });
  } finally {
    store.close();
  }
}

export interface RelocateProjectInput {
  readonly dataDir: string;
  /** The project's new canonical repository root. */
  readonly newRoot: string;
  /** `true` moves the existing repository directory to `newRoot`. */
  readonly move?: boolean;
  readonly secretAvailable?: (ref: string) => boolean;
  readonly secretRefs?: readonly string[];
  readonly probe?: ProcessProbe;
  readonly now?: () => string;
}

export interface RelocateOutcome {
  readonly ok: true;
  readonly projectId: string;
  readonly dataDir: string;
  readonly repoRoot: string;
  readonly previousRoot: string;
  readonly recovery: RestoreOutcome['recovery'];
  readonly doctor: RestoreDoctorReport;
}

export type RelocateResult = RelocateOutcome | RestoreFailure;

/**
 * Relocates an existing project to a new root (`reliability.md` §7 CLI
 * `relocate <projectId> --root <path>`).
 *
 * The target is validated **before** the root mapping is touched (`W8R1-05`): it must
 * be the same Git repository as the recorded one — the delivery ref at the recorded
 * revision and tree with a clean knowledge tree — otherwise the relocate is refused
 * and the Project row keeps pointing at the old root. Once the mapping is rewritten,
 * any later failure rolls it back, so a half-relocated project cannot be left behind.
 */
export function relocateProject(input: RelocateProjectInput): RelocateResult {
  const dataDir = resolve(input.dataDir);
  if (!existsSync(join(dataDir, BACKUP_DATABASE_PATH))) {
    return restoreFailure('NOT_FOUND', `状态目录缺少 ${BACKUP_DATABASE_PATH}：${dataDir}`, false);
  }
  const newRoot = resolve(input.newRoot);
  const knownProjectId = readProjectId(dataDir);
  if (knownProjectId === null) {
    return restoreFailure('INVALID_STATE', '状态数据库中没有 Project 行', false);
  }
  const git = createNodeBackupGitPort();
  const store = ProjectStore.open({ dataDir, projectId: knownProjectId, canonicalRoot: newRoot });
  try {
    const project = store.projects.find(store.projectId);
    if (project === undefined) {
      return restoreFailure('INVALID_STATE', '找不到 Project 行', false);
    }
    const previousRoot = project.gitRoot ?? project.root;
    const ref = `refs/heads/${project.deliveryBranch}`;
    // 1. The recorded binding, read from the current repository *before* anything
    //    moves. A relocation may only land on the same revision/tree.
    const recorded = readRelocatedBinding(git, previousRoot, ref);
    if (recorded === null) {
      return restoreFailure(
        'INVALID_STATE',
        `原仓库 ${previousRoot} 的交付 ref ${ref} 不可读，拒绝 relocate`,
        false,
      );
    }
    const relocatedRoot = relocateRoot(previousRoot, newRoot, input.move === true);
    if (relocatedRoot === null) {
      return restoreFailure(
        'NOT_FOUND',
        `relocate 目标 ${newRoot} 不存在或已存在，拒绝覆盖`,
        false,
      );
    }
    // 2. Validate the target *before* rewriting the root mapping, and undo a `move`
    //    that landed on something other than this project's repository.
    const target = readRelocatedBinding(git, relocatedRoot, ref);
    const sameBinding =
      target !== null &&
      target.revision === recorded.revision &&
      target.tree === recorded.tree &&
      recorded.revision !== null;
    if (!sameBinding) {
      rollbackRelocateRoot(relocatedRoot, previousRoot, input.move === true);
      return restoreFailure(
        'INVALID_STATE',
        `relocate 目标 ${relocatedRoot} 不是同一交付仓库（记录 ${ref}@${recorded.revision ?? 'unborn'}/tree ${recorded.tree ?? 'none'}，目标 ${target?.revision ?? 'unborn'}/tree ${target?.tree ?? 'none'}）；根映射未改写`,
        false,
      );
    }
    if (target.clean !== true) {
      rollbackRelocateRoot(relocatedRoot, previousRoot, input.move === true);
      return restoreFailure(
        'INVALID_STATE',
        `relocate 目标 ${relocatedRoot} 的工作树有未提交差异，知识文件与提交树不一致；根映射未改写`,
        false,
      );
    }

    // 3. Only now rewrite the mapping — and roll it back if anything after it fails.
    let mappedVersion = project.version;
    let mappingRewritten = false;
    try {
      const updated = store.projects.update(
        project.id,
        { root: relocatedRoot, gitRoot: relocatedRoot },
        project.version,
      );
      mappedVersion = updated.version;
      mappingRewritten = true;
      const service = new RunRecoveryService({
        store,
        ...(input.probe === undefined ? {} : { probe: input.probe }),
        ...(input.now === undefined ? {} : { now: input.now }),
      });
      const recovery = parkAll(store, service);
      const revision = target.revision;
      const evidence = inspectRestoredEvidence(store);
      const doctor = doctorReport(store, {
        repoRoot: relocatedRoot,
        dataDir,
        revision,
        expectedTree: recorded.tree,
        treeMatches: sameBinding,
        knowledgeMatchesTree: target.clean,
        evidenceVerified: evidence.verified,
        evidenceExpected: store.artifacts.list().length,
      });
      const missing = (input.secretRefs ?? []).filter(
        (ref) => !(input.secretAvailable ?? (() => false))(ref),
      );
      return {
        ok: true,
        projectId: store.projectId,
        dataDir,
        repoRoot: relocatedRoot,
        previousRoot,
        recovery,
        doctor: {
          ...doctor,
          executionReady: doctor.ok && missing.length === 0 && evidence.missing.length === 0,
        },
      };
    } catch (error) {
      if (mappingRewritten) {
        store.projects.update(
          project.id,
          { root: previousRoot, gitRoot: previousRoot },
          mappedVersion,
        );
      }
      return restoreFailure(
        'INTERNAL_ERROR',
        `relocate 失败（根映射已回滚）：${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  } catch (error) {
    return restoreFailure(
      'INTERNAL_ERROR',
      `relocate 失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    store.close();
  }
}

/** The delivery binding a relocate target must match, or `null` when unreadable. */
function readRelocatedBinding(
  git: BackupGitPort,
  root: string,
  ref: string,
): {
  readonly revision: string | null;
  readonly tree: string | null;
  readonly clean: boolean;
} | null {
  if (!existsSync(root)) return null;
  const revisionResult = git.revision(root, ref);
  if (!revisionResult.ok) return null;
  const revision = revisionResult.value;
  if (revision === null) return { revision: null, tree: null, clean: false };
  const treeResult = git.tree(root, revision);
  if (!treeResult.ok) return null;
  const cleanResult = git.isClean(root);
  return { revision, tree: treeResult.value, clean: cleanResult.ok && cleanResult.value };
}

/** Undoes the directory move of a failed `move: true` relocate. */
function rollbackRelocateRoot(relocatedRoot: string, previousRoot: string, move: boolean): void {
  if (!move || relocatedRoot === previousRoot) return;
  if (!existsSync(relocatedRoot) || existsSync(previousRoot)) return;
  renameSync(relocatedRoot, previousRoot);
}

/** Moves the repository to `newRoot`; `null` when the target already exists. */
function relocateRoot(previousRoot: string, newRoot: string, move: boolean): string | null {
  if (previousRoot === newRoot) return newRoot;
  if (move) {
    if (existsSync(newRoot)) return null;
    mkdirSync(dirname(newRoot), { recursive: true });
    renameSync(previousRoot, newRoot);
    return newRoot;
  }
  return existsSync(newRoot) ? newRoot : null;
}

/** Reads the single Project row's id straight from the state database. */
function readProjectId(dataDir: string): string | null {
  const db = openDatabase({ file: join(dataDir, BACKUP_DATABASE_PATH), readOnly: true });
  try {
    const row = db.prepare('SELECT id FROM project LIMIT 1').get() as
      Record<string, unknown> | undefined;
    if (row === undefined) return null;
    const id = row['id'];
    return typeof id === 'string' && id !== '' ? id : null;
  } finally {
    db.close();
  }
}
