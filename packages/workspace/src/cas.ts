/**
 * Compare-and-swap integration of Task results (`docs/architecture/reliability.md`
 * §4/§5, AC-062/AC-081/AC-094).
 *
 * `reliability.md` §4 gives the integration algorithm and §5 gives the recovery
 * rule; this module implements both halves as one machine:
 *
 * - **Dependency lineage** (`prepareDependencies`): a Task with dependencies starts
 *   only from the frozen result of its ancestors — `dependencyRevision` is the merge
 *   of the ancestors' own revisions (delivery-branch commits are folded in first,
 *   so no ancestor is re-applied), and `dependencyManifestRefs` names the manifest
 *   of every verified ancestor. A Task whose recorded dependency revision no longer
 *   holds is invalidated: its snapshot and its verification cannot be reused.
 * - **CAS integration** (`integrate`): the expected delivery-branch revision is
 *   compared with the current one, the caller-supplied candidate commit (with its
 *   requirement-pool files, AC-091) is installed, and the ref is moved only with
 *   `git update-ref <ref> <new> <expected>`. A moved branch yields `VERSION_CONFLICT`
 *   or `STALE_ARTIFACT` and the branch is left exactly as it was. There is no force
 *   push path anywhere, and no `git commit` in the delivery working tree.
 * - **Idempotent retry** (AC-063/AC-094): the operation's step results are journaled
 *   before and after the ref update, so a crash between `commit` and the status write
 *   re-uses the original commit and emits exactly one completion event.
 * - **Final integration** (`planIntegration`): every already-merged ancestor is
 *   skipped (commit identity first, ancestry second) instead of being cherry-picked
 *   again, and a conflict between two already-passed Tasks produces an independent
 *   repair Task plus a required fresh verification of the final combination.
 */
import type { JsonObject } from '@agentdev/contracts';
import { REQUIREMENTS_ROOT } from '@agentdev/knowledge';
import { WorkspaceError, canonicalPath, sha256Hex, type WorkspaceDiagnostic } from './git-port.js';
import { gitDiagnostics, requireGit, type WorktreeGitPort } from './worktree.js';

/** Full Git OID: sha1 (40) or sha256 (64) repositories. */
const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** Steps a CAS integration persists so a restart can resume instead of repeating. */
export const CAS_JOURNAL_STATES = ['pending', 'committed', 'completed'] as const;
export type CasJournalState = (typeof CAS_JOURNAL_STATES)[number];

export const CAS_OPERATION_KINDS = ['integrate', 'requirement_save', 'settle'] as const;
export type CasOperationKind = (typeof CAS_OPERATION_KINDS)[number];

/** What one CAS integration has durably done so far. */
export interface CasJournalRecord {
  readonly operationId: string;
  readonly kind: CasOperationKind;
  readonly repoRoot: string;
  readonly ref: string;
  readonly expectedRevision: string;
  readonly state: CasJournalState;
  /** Full OID of the created commit, once it exists. */
  readonly targetRevision?: string;
  /** Tree of the created commit; the "code tree + knowledge tree" anchor. */
  readonly targetTree?: string;
  /** `true` when the operation reused an already-created commit. */
  readonly reused?: boolean;
  /** Deterministic id of the single completion event. */
  readonly completionEventId?: string;
  readonly stepResults: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Persistence seam for CAS step results.
 *
 * `reliability.md` §5 requires the operation's intent, input hash, output reference
 * and state to survive a crash; the daemon backs this with the `operation` table
 * (`data.md` §2), tests may use the in-memory or JSON-file store.
 */
export interface CasJournal {
  load(operationId: string): CasJournalRecord | null;
  save(record: CasJournalRecord): void;
  list(): readonly CasJournalRecord[];
}

/** In-memory journal for tests and for callers that own no database. */
export function createMemoryCasJournal(): CasJournal {
  const records = new Map<string, CasJournalRecord>();
  return {
    load(operationId) {
      const record = records.get(operationId);
      return record === undefined ? null : structuredClone(record);
    },
    save(record) {
      records.set(record.operationId, structuredClone(record));
    },
    list() {
      return [...records.values()].map((record) => structuredClone(record));
    },
  };
}

/** One requirement record that must travel with the commit (AC-091, AC-093, AC-094). */
export interface RequirementPoolCommit {
  /** Repository-relative record directory, e.g. `.agentdev/requirements/<id>`. */
  readonly recordPath: string;
  /** `recordPath/requirement.json`. */
  readonly metadataPath: string;
  /** `recordPath/content.md`. */
  readonly contentPath: string;
  /** `recordHash` of the two files together (`requirements.md` §6). */
  readonly recordHash: string;
  /** `PortableRequirement.version` the two files carry. */
  readonly version: number;
  /** Rebuildable navigation index, when the caller wants it committed too. */
  readonly readmePath?: string;
}

export interface CasRequest {
  readonly operationId: string;
  readonly kind: CasOperationKind;
  readonly repoRoot: string;
  /** Full ref name, e.g. `refs/heads/agentdev/main`. */
  readonly ref: string;
  /** The delivery revision the caller believes is current. */
  readonly expectedRevision: string;
  /**
   * The commit the operation wants the ref to point at. **Required**: the candidate
   * must already exist (created in a detached integration worktree or by the
   * caller), so this service never runs `git commit` in the delivery working tree
   * and the ref only ever moves through `update-ref <ref> <new> <old>`.
   */
  readonly candidateRevision?: string;
  readonly message: string;
  /** `git rev-parse <candidateRevision>^{tree}`, when the caller measured it. */
  readonly candidateTree?: string;
  /** Worktrees that must be clean before anything is written. */
  readonly worktreePaths?: readonly string[];
  readonly requirementPool?: readonly RequirementPoolCommit[];
  /** Task ids this integration carries, for the completion event. */
  readonly taskIds?: readonly string[];
  readonly workId?: string;
  readonly requirementId?: string;
}

export type CasFailureCode =
  | 'VERSION_CONFLICT'
  | 'STALE_ARTIFACT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export type CasOutcome =
  | {
      readonly ok: true;
      readonly operationId: string;
      readonly state: 'completed';
      readonly previousRevision: string;
      readonly revision: string;
      /** The created commit; identical on every retry (AC-063). */
      readonly targetRevision: string;
      readonly targetTree: string;
      /**
       * `true` when the target commit already existed: this call created no new
       * commit. A requirement save that creates its commit in an integration worktree
       * and then CASes the ref is therefore `reused: true` with `refUpdated: true`.
       */
      readonly reused: boolean;
      readonly refUpdated: boolean;
      readonly completionEventId: string;
      /** `true` when this call appended the completion event. */
      readonly emittedCompletionEvent: boolean;
      /** The requirement record hashes this commit carries. */
      readonly requirementRecordHashes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: CasFailureCode;
      /** The revision the ref actually holds, when it could be read. */
      readonly actualRevision: string | null;
      readonly expectedRevision: string;
      readonly message: string;
      /** Always `true` for a refusal: the branch was not touched. */
      readonly branchUntouched: boolean;
      readonly errors: readonly WorkspaceDiagnostic[];
    };

/** The events a CAS integration must emit exactly once. */
export interface CasCompletionEvent {
  readonly eventId: string;
  readonly operationId: string;
  readonly kind: CasOperationKind;
  readonly revision: string;
  readonly tree: string;
  readonly workId: string | null;
  readonly requirementId: string | null;
  readonly taskIds: readonly string[];
  readonly reused: boolean;
}

export interface CasEventPort {
  /** Appends the completion event and returns its id. Called at most once. */
  appendCompletion(event: CasCompletionEvent): string;
}

/** `true` when the completion event has already been appended for `operationId`. */
export interface CasEventSink {
  readonly appended: readonly CasCompletionEvent[];
}

/** In-memory event sink for tests: it records and hands back deterministic ids. */
export function createMemoryCasEvents(): CasEventPort & CasEventSink {
  const appended: CasCompletionEvent[] = [];
  return {
    appendCompletion(event) {
      appended.push(structuredClone(event));
      return event.eventId;
    },
    appended,
  };
}

// ---------------------------------------------------------------------------
// Dependency lineage (AC-081)
// ---------------------------------------------------------------------------

/** The task fields dependency resolution reads. */
export interface TaskNode {
  readonly id: string;
  readonly dependsOn: readonly string[];
  /** The Task's own code revision once it passed; `null` while still open. */
  readonly revision: string | null;
  /** `dependencyRevision` recorded on the Task, when it has one. */
  readonly recordedDependencyRevision?: string;
  /** `dependencyManifestRefs` recorded on the Task. */
  readonly recordedDependencyManifestRefs: readonly string[];
}

/** The task-manifest accessors a real caller backs with the `task` table. */
export interface TaskDependencyPort {
  /** Every Task that shares `dependsOn`'s Work, keyed by Task id. */
  tasksForWork(workId: string): readonly TaskNode[];
  /** `latestManifestId` of a Task, or `null` when it has no manifest yet. */
  latestManifestId(taskId: string): string | null;
  /** The `codeRevision` a manifest froze, or `null` when it is unknown. */
  manifestCodeRevision?(manifestId: string): string | null;
}

/** What one Task must freeze before it may start (AC-081). */
export interface DependencyResolution {
  readonly taskId: string;
  /** `dependencyRevision`: `null` only for a dependency-free Task. */
  readonly dependencyRevision: string | null;
  /** `dependencyManifestRefs`: one entry per verified ancestor. */
  readonly dependencyManifestRefs: readonly string[];
  readonly ancestorTaskIds: readonly string[];
}

export interface DependencyPlan {
  /** Plan order: dependencies first, ties broken by Task id (`reliability.md` §4). */
  readonly order: readonly string[];
  readonly resolutions: readonly DependencyResolution[];
}

/**
 * Deterministic topological order of a Work's plan DAG.
 *
 * `reliability.md` §4 applies same-layer Tasks "按Task ID稳定排序", and
 * `data.md` §2 requires the DAG to have no cycle, so a cycle is an `INVALID_STATE`
 * refusal rather than an arbitrary order.
 */
export function orderTasks(tasks: readonly TaskNode[]): readonly string[] {
  const byId = new Map<string, TaskNode>();
  for (const task of tasks) byId.set(task.id, task);
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency)) {
        throw new WorkspaceError(
          'INVALID_STATE',
          `Task ${task.id} 依赖不存在的 Task ${dependency}`,
          { details: { taskId: task.id, dependency } },
        );
      }
    }
  }
  const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (task: TaskNode): void => {
    const current = state.get(task.id);
    if (current === 'done') return;
    if (current === 'visiting') {
      throw new WorkspaceError('INVALID_STATE', `Task 依赖图存在环，无法确定集成顺序：${task.id}`, {
        details: { taskId: task.id },
      });
    }
    state.set(task.id, 'visiting');
    for (const dependency of [...task.dependsOn].sort()) {
      const node = byId.get(dependency);
      if (node !== undefined) visit(node);
    }
    state.set(task.id, 'done');
    order.push(task.id);
  };
  for (const task of sorted) visit(task);
  return order;
}

/**
 * Resolves `dependencyRevision`/`dependencyManifestRefs` for every Task of a Work.
 *
 * The merge base of the dependency revisions is folded in first: when a dependency is
 * already contained in another (A merged into B as a fast-forward, or two Tasks
 * sharing the same parent), `mergeRevision(base, dependency)` is the dependency
 * itself, so an already-merged ancestor is never re-applied — the property AC-081
 * demands from the final integration.
 */
export function planDependencies(input: {
  readonly tasks: readonly TaskNode[];
  readonly port: TaskDependencyPort;
  readonly mergeRevision: (base: string | null, revision: string) => string;
}): DependencyPlan {
  const order = orderTasks(input.tasks);
  const byId = new Map(input.tasks.map((task) => [task.id, task]));
  const resolutions: DependencyResolution[] = [];
  const resolved = new Map<string, DependencyResolution>();

  for (const taskId of order) {
    const task = byId.get(taskId);
    if (task === undefined) continue;
    const ancestors = new Map<string, TaskNode>();
    let dependencyRevision: string | null = null;
    for (const dependencyId of [...task.dependsOn].sort()) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined) {
        throw new WorkspaceError(
          'INVALID_STATE',
          `Task ${taskId} 依赖不存在的 Task ${dependencyId}`,
          {
            details: { taskId, dependency: dependencyId },
          },
        );
      }
      const inherited = resolved.get(dependencyId);
      if (inherited !== undefined) {
        for (const ancestorId of inherited.ancestorTaskIds) {
          const ancestor = byId.get(ancestorId);
          if (ancestor !== undefined) ancestors.set(ancestorId, ancestor);
        }
      }
      ancestors.set(dependencyId, dependency);
      if (dependency.revision === null) {
        throw new WorkspaceError(
          'INVALID_STATE',
          `Task ${taskId} 依赖的 Task ${dependencyId} 还没有冻结的代码版本`,
          { details: { taskId, dependency: dependencyId } },
        );
      }
      dependencyRevision =
        dependencyRevision === null
          ? dependency.revision
          : input.mergeRevision(dependencyRevision, dependency.revision);
    }

    const ancestorIds = [...ancestors.keys()].sort();
    const dependencyManifestRefs = ancestorIds
      .map((ancestorId) => ({
        taskId: ancestorId,
        manifestId: input.port.latestManifestId(ancestorId),
      }))
      .filter((entry): entry is { taskId: string; manifestId: string } => entry.manifestId !== null)
      .map((entry) => entry.manifestId)
      .sort();

    const resolution: DependencyResolution = {
      taskId,
      dependencyRevision: task.dependsOn.length === 0 ? null : dependencyRevision,
      dependencyManifestRefs,
      ancestorTaskIds: ancestorIds,
    };
    resolved.set(taskId, resolution);
    resolutions.push(resolution);
  }

  return { order, resolutions };
}

/** Convenience: resolves a Work's dependencies straight from a `TaskDependencyPort`. */
export function prepareDependencies(input: {
  readonly workId: string;
  readonly port: TaskDependencyPort;
  readonly mergeRevision: (base: string | null, revision: string) => string;
}): DependencyPlan {
  return planDependencies({
    tasks: input.port.tasksForWork(input.workId),
    port: input.port,
    mergeRevision: input.mergeRevision,
  });
}

export type DependencyStartCode =
  'GATE_NOT_READY' | 'STALE_ARTIFACT' | 'VALIDATION_ERROR' | 'INVALID_STATE' | 'INTERNAL_ERROR';

export type DependencyStartCheck =
  | {
      readonly ok: true;
      readonly taskId: string;
      readonly dependencyRevision: string;
      readonly dependencyManifestRefs: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: DependencyStartCode;
      readonly taskId: string;
      /** Why the Task may not start, or why its verification is no longer reusable. */
      readonly message: string;
      /** Recorded values, for the diagnosis the caller reports. */
      readonly recordedDependencyRevision: string | null;
      readonly expectedDependencyRevision: string | null;
      readonly invalidated: boolean;
      readonly errors: readonly WorkspaceDiagnostic[];
    };

/**
 * The start gate for a dependent Task (AC-081).
 *
 * Starting requires the frozen result of every ancestor (the revision must still
 * exist in the repository) *and* the Task's recorded `dependencyRevision` /
 * `dependencyManifestRefs` must equal the ones the ancestors produce now. A mismatch
 * is the documented invalidation: the ancestor changed, so this Task's snapshot and
 * verification are stale and must be rebuilt.
 */
export function verifyTaskStart(input: {
  readonly task: TaskNode;
  /** The resolution `planDependencies` produced for this Task. */
  readonly expected: DependencyResolution;
  readonly git: WorktreeGitPort;
  readonly repoRoot: string;
  readonly workId: string;
}): DependencyStartCheck {
  const { task, expected } = input;
  const recordedRevision = task.recordedDependencyRevision ?? null;
  const recordedRefs = [...task.recordedDependencyManifestRefs];

  if (expected.dependencyRevision === null) {
    if (task.dependsOn.length === 0) {
      // A dependency-free Task has no dependency input; `data.md` §3 requires the
      // arrays to stay empty rather than carry a leftover manifest.
      if (recordedRefs.length > 0) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          taskId: task.id,
          message: `无依赖 Task ${task.id} 不应携带 dependencyManifestRefs`,
          recordedDependencyRevision: recordedRevision,
          expectedDependencyRevision: null,
          invalidated: false,
          errors: [],
        };
      }
      return {
        ok: false,
        code: 'INVALID_STATE',
        taskId: task.id,
        message: `Task ${task.id} 无依赖，应由 Work.baseRevision 直接创建`,
        recordedDependencyRevision: recordedRevision,
        expectedDependencyRevision: null,
        invalidated: false,
        errors: [],
      };
    }
    return {
      ok: false,
      code: 'GATE_NOT_READY',
      taskId: task.id,
      message: `Task ${task.id} 的前置 Task 尚未产出可冻结的代码版本`,
      recordedDependencyRevision: recordedRevision,
      expectedDependencyRevision: null,
      invalidated: false,
      errors: [],
    };
  }

  const known = input.git.resolveRevision(input.repoRoot, expected.dependencyRevision);
  if (!known.ok) {
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      taskId: task.id,
      message: `dependencyRevision 校验失败：${expected.dependencyRevision}`,
      recordedDependencyRevision: recordedRevision,
      expectedDependencyRevision: expected.dependencyRevision,
      invalidated: false,
      errors: known.errors,
    };
  }
  if (known.value === null) {
    return {
      ok: false,
      code: 'STALE_ARTIFACT',
      taskId: task.id,
      message: `前置结果已不可用：仓库中不存在 ${expected.dependencyRevision}`,
      recordedDependencyRevision: recordedRevision,
      expectedDependencyRevision: expected.dependencyRevision,
      invalidated: true,
      errors: [],
    };
  }

  const refsMatch =
    recordedRefs.length === expected.dependencyManifestRefs.length &&
    [...recordedRefs]
      .sort()
      .every((ref, index) => ref === [...expected.dependencyManifestRefs].sort()[index]);
  const revisionMatches = recordedRevision === expected.dependencyRevision;

  if (!refsMatch) {
    return {
      ok: false,
      code: 'GATE_NOT_READY',
      taskId: task.id,
      message: `Task ${task.id} 缺少前置验证 Manifest（recorded=[${recordedRefs.join(', ')}] expected=[${expected.dependencyManifestRefs.join(', ')}]）`,
      recordedDependencyRevision: recordedRevision,
      expectedDependencyRevision: expected.dependencyRevision,
      invalidated: false,
      errors: [],
    };
  }
  if (!revisionMatches) {
    return {
      ok: false,
      code: 'STALE_ARTIFACT',
      taskId: task.id,
      message: `Task ${task.id} 的 dependencyRevision 已过期：recorded=${recordedRevision ?? 'none'} expected=${expected.dependencyRevision}；祖先结果变化使 Snapshot 与验证失效，必须重建`,
      recordedDependencyRevision: recordedRevision,
      expectedDependencyRevision: expected.dependencyRevision,
      invalidated: true,
      errors: [],
    };
  }
  return {
    ok: true,
    taskId: task.id,
    dependencyRevision: expected.dependencyRevision,
    dependencyManifestRefs: expected.dependencyManifestRefs,
  };
}

/**
 * Assigns the frozen dependency fields of a Task that is about to start (AC-081).
 *
 * `data.md` §3: the fields must be filled before Develop, before a worktree exists
 * and before any VerificationManifest; an unresolved dependency is `GATE_NOT_READY`.
 */
export function applyDependencyInputs<T extends TaskNode>(
  task: T,
  resolution: DependencyResolution,
): T {
  if (task.dependsOn.length > 0 && resolution.dependencyRevision === null) {
    throw new WorkspaceError(
      'GATE_NOT_READY',
      `Task ${task.id} 的前置结果尚未冻结，不能写入 dependencyRevision`,
      { details: { taskId: task.id } },
    );
  }
  return {
    ...task,
    ...(resolution.dependencyRevision === null
      ? {}
      : { recordedDependencyRevision: resolution.dependencyRevision }),
    recordedDependencyManifestRefs: [...resolution.dependencyManifestRefs],
  };
}

// ---------------------------------------------------------------------------
// Integration planning (AC-062, AC-081)
// ---------------------------------------------------------------------------

/** One Task result the final integration applies. */
export interface IntegrationTask {
  readonly taskId: string;
  /** Task ids this Task depends on (`task.dependsOn`). */
  readonly dependsOn: readonly string[];
  /** The Task's own code revision once it passed. */
  readonly revision: string;
  /** `dependencyRevision` the Task was developed from. */
  readonly dependencyRevision: string | null;
  readonly role?: string;
  readonly acceptanceIds?: readonly string[];
}

export interface IntegrationRequest {
  readonly repoRoot: string;
  readonly ref: string;
  /** The delivery revision the integration starts from. */
  readonly targetRevision: string;
  readonly tasks: readonly IntegrationTask[];
  /** Paths (repository-relative) the integration already contains. */
  readonly requirementPoolPaths?: readonly string[];
}

export interface AppliedIntegrationTask {
  readonly taskId: string;
  readonly revision: string;
  readonly dependencyRevision: string | null;
  /** `true` when the Task's own commit already existed in the target. */
  readonly alreadyMerged: boolean;
  /** The commit the integration created for this Task; `null` when skipped. */
  readonly commit: string | null;
  readonly reusedManifestIds: readonly string[];
}

export interface IntegrationConflict {
  readonly kind: 'task-merge-conflict';
  /** `git` when Git reported unmerged paths, `revision` for a missing revision. */
  readonly reason: 'git' | 'revision';
  readonly paths: readonly string[];
  readonly message: string;
  readonly taskId: string | null;
  readonly mergeBase: string | null;
}

export interface IntegrationPlan {
  /** Deterministic order: dependencies first, ties by Task id. */
  readonly order: readonly string[];
  readonly applied: readonly AppliedIntegrationTask[];
  /** Revisions the integration skipped because the target already contained them. */
  readonly skippedTaskIds: readonly string[];
  readonly conflict: IntegrationConflict | null;
  /** Merge base of the target and the Task dependency revisions, when one exists. */
  readonly mergeBase: string | null;
  /** The revision the integration worktree is at when the plan stops. */
  readonly tip: string;
}

/**
 * Plans the final integration without writing a ref.
 *
 * Every Task revision that is already contained in the target (identity first, then
 * ancestry) is skipped rather than cherry-picked again — `reliability.md` §4
 * "避免重复cherry-pick祖先". A conflict stops the plan with the offending paths and
 * the merge base, which is exactly what the independent repair Task needs.
 */
export function planIntegration(input: {
  readonly request: IntegrationRequest;
  readonly git: WorktreeGitPort;
}): IntegrationPlan {
  const { request, git } = input;
  const order = orderTasks(
    request.tasks.map((task) => ({
      id: task.taskId,
      dependsOn: [...task.dependsOn],
      revision: task.revision,
      ...(task.dependencyRevision === null
        ? {}
        : { recordedDependencyRevision: task.dependencyRevision }),
      recordedDependencyManifestRefs: [],
    })),
  );
  const byId = new Map(request.tasks.map((task) => [task.taskId, task]));
  const applied: AppliedIntegrationTask[] = [];
  const skipped: string[] = [];

  const contains = (revision: string): boolean => {
    if (revision === request.targetRevision) return true;
    const result = git.isAncestor(request.repoRoot, revision, request.targetRevision);
    return result.ok && result.value;
  };

  let conflict: IntegrationConflict | null = null;
  for (const taskId of order) {
    const task = byId.get(taskId);
    if (task === undefined) continue;

    // `reliability.md` §4: a commit the delivery branch already contains is never
    // cherry-picked again ("避免重复cherry-pick祖先"). Identity and ancestry are both
    // checks against the frozen target, so the answer cannot drift mid-plan.
    if (contains(task.revision)) {
      skipped.push(taskId);
      applied.push({
        taskId,
        revision: task.revision,
        dependencyRevision: task.dependencyRevision,
        alreadyMerged: true,
        commit: null,
        reusedManifestIds: [],
      });
      continue;
    }

    const known = git.resolveRevision(request.repoRoot, task.revision);
    if (!known.ok || known.value === null) {
      conflict = {
        kind: 'task-merge-conflict',
        reason: 'revision',
        paths: [],
        message: `Task ${taskId} 的结果版本不在仓库中：${task.revision}`,
        taskId,
        mergeBase: null,
      };
      break;
    }

    applied.push({
      taskId,
      revision: task.revision,
      dependencyRevision: task.dependencyRevision,
      alreadyMerged: false,
      commit: null,
      reusedManifestIds: [],
    });
  }

  // The merge base of the target and every not-yet-merged Task dependency is what the
  // integration replays from; reporting it here is what lets a caller explain exactly
  // which ancestor is being reused.
  const mergeBase =
    request.tasks
      .map((task) => task.dependencyRevision)
      .filter((revision): revision is string => revision !== null)
      .map((revision) => {
        const base = git.mergeBase(request.repoRoot, request.targetRevision, revision);
        return base.ok ? base.value : null;
      })
      .find((value): value is string => value !== null) ?? null;

  return {
    order,
    applied,
    skippedTaskIds: skipped,
    conflict,
    mergeBase,
    tip: request.targetRevision,
  };
}

/** A repair Task the Chief dispatches when the final integration conflicts. */
export interface RepairTask {
  readonly id: string;
  readonly workId: string;
  readonly title: string;
  readonly role: 'backend' | 'frontend';
  readonly dependsOn: readonly string[];
  readonly dependencyRevision: string;
  readonly dependencyManifestRefs: readonly string[];
  readonly acceptanceIds: readonly string[];
  readonly conflictPaths: readonly string[];
  readonly mergeBase: string | null;
  /** The conflict report artifact the repair Task reads first. */
  readonly conflictArtifactPath: string;
  /** Always `true`: the final combination must be verified again, not reused. */
  readonly requiresFreshVerification: true;
  /** Always `false`: an integration conflict must not reuse the Task evidence. */
  readonly committed: false;
  readonly message: string;
}

export interface RepairPlan {
  readonly conflict: IntegrationConflict;
  readonly repairTask: RepairTask;
  readonly artifact: {
    readonly path: string;
    readonly markdown: string;
    readonly sha256: string;
  };
}

/**
 * The deterministic repair-task id for one integration conflict.
 *
 * Deterministic so a retried integration produces the *same* repair Task instead of a
 * second one; shaped as a lowercase UUIDv7 because every entity id must be one
 * (`data.md` §1).
 */
export function repairTaskId(input: {
  readonly workId: string;
  readonly taskIds: readonly string[];
  readonly revision: string;
}): string {
  const digest = sha256Hex(
    [
      'integration-conflict',
      input.workId,
      [...input.taskIds].sort().join(','),
      input.revision,
    ].join('\0'),
  );
  // Disjoint slices with version nibble 7 and RFC 4122 variant bits, so the id is a
  // lowercase UUIDv7 (`data.md` §1) and stays identical for the same conflict.
  const version = `7${digest.slice(8, 11)}`;
  const variant = (Number.parseInt(digest[15] ?? '8', 16) & 0x3) | 0x8;
  return [
    digest.slice(0, 8),
    digest.slice(4, 8),
    version,
    `${variant.toString(16)}${digest.slice(16, 19)}`,
    digest.slice(20, 32),
  ].join('-');
}

/**
 * The conflict report the repair Task reads first.
 *
 * The artifact is written to `artifactPath` by the caller (the integration worktree
 * owns the write); this function is the single source of its content and hash.
 */
export function integrationConflictArtifact(input: { readonly repair: RepairPlan }): {
  readonly path: string;
  readonly markdown: string;
  readonly sha256: string;
} {
  return input.repair.artifact;
}

/**
 * The shared Project integration lock (`reliability.md` §4/§9, AC-091).
 *
 * A structural port: core's `ProjectIntegrationLock` satisfies it, and both sides
 * contend for the same `lease.resource` (`integration:<projectId>`). Requirement
 * saving and code delivery must therefore agree on this interface for the mutex to
 * be mutual rather than merely two independent serializations (`W8R2-02`).
 */
export interface CasIntegrationLockHolder {
  readonly ownerAttemptId: string;
  readonly epoch: number;
  readonly expiresAt: string;
}

export interface CasAcquireIntegrationLockRequest {
  readonly ownerAttemptId: string;
  readonly epoch: number;
  readonly ttlMs?: number;
  readonly at?: string;
}

export type CasIntegrationLockResult =
  | { readonly acquired: true; readonly resource: string; readonly replacedExpired: boolean }
  | {
      readonly acquired: false;
      readonly code: 'BUSY';
      readonly heldBy: CasIntegrationLockHolder;
    };

export interface CasIntegrationLock {
  readonly resource: string;
  acquire(request: CasAcquireIntegrationLockRequest): CasIntegrationLockResult;
  release(ownerAttemptId: string, epoch: number): boolean;
}

/** In-memory integration lock for tests and callers that own no database. */
export function createMemoryIntegrationLock(projectId: string): CasIntegrationLock {
  const resource = `integration:${projectId}`;
  let holder: CasIntegrationLockHolder | null = null;
  return {
    resource,
    acquire(request) {
      const at = request.at ?? new Date().toISOString();
      if (
        holder !== null &&
        holder.ownerAttemptId !== request.ownerAttemptId &&
        Date.parse(holder.expiresAt) > Date.parse(at)
      ) {
        return { acquired: false, code: 'BUSY', heldBy: { ...holder } };
      }
      const replacedExpired =
        holder !== null &&
        Date.parse(holder.expiresAt) <= Date.parse(at) &&
        holder.ownerAttemptId !== request.ownerAttemptId;
      holder = {
        ownerAttemptId: request.ownerAttemptId,
        epoch: request.epoch,
        expiresAt: new Date(Date.parse(at) + (request.ttlMs ?? 60_000)).toISOString(),
      };
      return { acquired: true, resource, replacedExpired };
    },
    release(ownerAttemptId, epoch) {
      if (holder === null || holder.ownerAttemptId !== ownerAttemptId || holder.epoch !== epoch) {
        return false;
      }
      holder = null;
      return true;
    },
  };
}

export interface RunIntegrationOptions {
  readonly git: WorktreeGitPort;
  /** Repository the integration worktree is linked to. */
  readonly repoRoot: string;
  /** The CAS service that installs the candidate. */
  readonly cas: CasService;
  /** The integration worktree path (a real `git worktree`, never the delivery root). */
  readonly worktreePath: string;
  readonly operationId: string;
  readonly ref: string;
  /** The delivery revision the integration starts from. */
  readonly targetRevision: string;
  readonly tasks: readonly IntegrationTask[];
  readonly workId: string;
  readonly requirementId?: string;
  /** Manifest refs of the verified ancestors, for the repair Task. */
  readonly dependencyManifestRefs?: readonly string[];
  readonly acceptanceIds?: readonly string[];
  readonly requirementPool?: readonly RequirementPoolCommit[];
  readonly message?: string;
  readonly branch?: string;
  /**
   * The shared `integration:<projectId>` lock (`W8R2-02`). **Required**: the delivery
   * path must take the same mutex requirement saving takes, or the two writers are
   * only individually serialized and AC-091's "same lock" guarantee is not met.
   */
  readonly lock: CasIntegrationLock;
  /** Lock owner; defaults to `operationId` (the CAS idempotency key). */
  readonly ownerAttemptId?: string;
  readonly epoch?: number;
  readonly ttlMs?: number;
  readonly leaseAt?: string;
}

export type RunIntegrationResult =
  | {
      readonly ok: true;
      readonly appliedTaskIds: readonly string[];
      readonly skippedTaskIds: readonly string[];
      /** One entry per Task: what was replayed and what was already present. */
      readonly applied: readonly AppliedIntegrationTask[];
      readonly revision: string;
      readonly cas: Extract<CasOutcome, { ok: true }>;
      readonly outcome: 'integrated' | 'noop';
    }
  | {
      /** Two already-passed Tasks conflict: an independent repair Task is required. */
      readonly ok: false;
      readonly code: 'TASK_MERGE_CONFLICT';
      readonly conflict: IntegrationConflict;
      readonly repair: RepairPlan;
      /** The delivery branch was never touched (CAS protects HEAD). */
      readonly branchUntouched: true;
      readonly appliedTaskIds: readonly string[];
      readonly applied: readonly AppliedIntegrationTask[];
    }
  | {
      /** A requirement save (or another delivery) holds the shared Project lock. */
      readonly ok: false;
      readonly code: 'BUSY';
      readonly message: string;
      readonly heldBy: CasIntegrationLockHolder;
      readonly branchUntouched: true;
      readonly appliedTaskIds: readonly string[];
      readonly applied: readonly AppliedIntegrationTask[];
    }
  | {
      readonly ok: false;
      readonly code: Exclude<CasFailureCode, 'VERSION_CONFLICT' | 'STALE_ARTIFACT'>;
      readonly message: string;
      readonly branchUntouched: true;
      readonly appliedTaskIds: readonly string[];
      readonly applied: readonly AppliedIntegrationTask[];
    }
  | Extract<CasOutcome, { ok: false }>;

/**
 * Runs the whole final-integration step of `reliability.md` §4 on a real worktree,
 * under the shared Project integration lock (`AC-091`, `W8R2-02`).
 *
 * The integration worktree is checked out at the frozen target revision; each Task is
 * replayed from *its own* commits (`git cherry <dependencyRevision> <taskRevision>`),
 * already-merged ancestors are skipped, and a conflict between two already-passed
 * Tasks stops with the independent repair Task and a fresh-verification requirement.
 * The delivery ref is moved only by the CAS step, so a conflicting attempt can never
 * corrupt the branch. A held lock refuses with `BUSY` before any worktree is touched,
 * and the lock is always released — the integration path owns the same mutex a
 * requirement save takes.
 */
export function runIntegration(options: RunIntegrationOptions): RunIntegrationResult {
  const ownerAttemptId = options.ownerAttemptId ?? options.operationId;
  const epoch = options.epoch ?? 1;
  const taken = options.lock.acquire({
    ownerAttemptId,
    epoch,
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.leaseAt === undefined ? {} : { at: options.leaseAt }),
  });
  if (!taken.acquired) {
    return {
      ok: false,
      code: 'BUSY',
      message: `Project 集成锁由 ${taken.heldBy.ownerAttemptId} 持有（epoch ${taken.heldBy.epoch}，到期 ${taken.heldBy.expiresAt}），代码交付未开始`,
      heldBy: taken.heldBy,
      branchUntouched: true,
      appliedTaskIds: [],
      applied: [],
    };
  }
  try {
    return integrateTasks(options);
  } finally {
    options.lock.release(ownerAttemptId, epoch);
  }
}

/** The task replay itself; `runIntegration` owns the lock around it. */
function integrateTasks(options: RunIntegrationOptions): RunIntegrationResult {
  const { git } = options;
  const appliedTaskIds: string[] = [];
  const applied: AppliedIntegrationTask[] = [];

  const conflictResult = (input: {
    readonly taskId: string;
    readonly paths: readonly string[];
    readonly message: string;
    readonly mergeBase: string | null;
    readonly conflictingTaskIds: readonly string[];
  }): RunIntegrationResult => {
    const conflict: IntegrationConflict = {
      kind: 'task-merge-conflict',
      reason: 'git',
      paths: [...input.paths],
      message: input.message,
      taskId: input.taskId,
      mergeBase: input.mergeBase,
    };
    const repair = createRepairTask({
      conflict,
      workId: options.workId,
      ...(options.requirementId === undefined ? {} : { requirementId: options.requirementId }),
      dependencyRevision: options.targetRevision,
      dependencyManifestRefs: options.dependencyManifestRefs ?? [],
      conflictingTaskIds: input.conflictingTaskIds,
      acceptanceIds: options.acceptanceIds ?? [],
    });
    return {
      ok: false,
      code: 'TASK_MERGE_CONFLICT',
      conflict,
      repair,
      branchUntouched: true,
      appliedTaskIds,
      applied,
    };
  };

  const failure = (
    message: string,
    appliedTaskIdsValue: readonly string[],
  ): RunIntegrationResult => ({
    ok: false,
    code: 'INVALID_STATE',
    message,
    branchUntouched: true,
    appliedTaskIds: appliedTaskIdsValue,
    applied,
  });

  const plan = planIntegration({
    request: {
      repoRoot: options.repoRoot,
      ref: options.ref,
      targetRevision: options.targetRevision,
      tasks: options.tasks,
    },
    git,
  });

  for (const taskId of plan.order) {
    const task = options.tasks.find((entry) => entry.taskId === taskId);
    if (task === undefined) continue;

    if (plan.skippedTaskIds.includes(taskId)) {
      applied.push({
        taskId,
        revision: task.revision,
        dependencyRevision: task.dependencyRevision,
        alreadyMerged: true,
        commit: null,
        reusedManifestIds: options.dependencyManifestRefs ?? [],
      });
      continue;
    }

    // Only the Task's own commits, computed against its dependency revision, so an
    // already-merged ancestor is never replayed (`reliability.md` §4).
    const upstream = task.dependencyRevision ?? options.targetRevision;
    const cherries = git.cherry(options.worktreePath, upstream, task.revision);
    if (!cherries.ok) {
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: `git cherry 失败：Task ${taskId}`,
        branchUntouched: true,
        appliedTaskIds,
        applied,
      };
    }
    for (const revision of cherries.value) {
      const picked = git.cherryPick(options.worktreePath, revision);
      if (!picked.ok) {
        const status = git.statusPorcelain(options.worktreePath);
        const paths = status.ok
          ? status.value.flatMap((line) => {
              const code = line.slice(0, 2);
              if (code !== 'UU' && code !== 'AA' && code !== 'AU' && code !== 'UA') return [];
              return [line.slice(3).trim()];
            })
          : [];
        if (paths.length === 0) {
          requireGit(
            git.cherryPickAbort(options.worktreePath),
            'INTERNAL_ERROR',
            'cherry-pick --abort',
          );
          // A cherry-pick that produced neither a change nor a conflict is Git's way
          // of saying the change is already present in the worktree. That is a skip:
          // replaying an already-applied change must never invalidate the run.
          applied.push({
            taskId,
            revision,
            dependencyRevision: task.dependencyRevision,
            alreadyMerged: true,
            commit: null,
            reusedManifestIds: options.dependencyManifestRefs ?? [],
          });
          break;
        }
        // A conflict stops the run and leaves the worktree as Git left it, so the
        // repair Task can resolve it; the delivery branch is untouched.
        const mergeBase = task.dependencyRevision ?? options.targetRevision;
        // The repair Task depends on the failing Task plus everything already
        // integrated in this run: that is exactly the combination that must be
        // re-verified after the fix.
        return conflictResult({
          taskId,
          paths,
          message: `Task ${taskId} 与已集成的 Task 在 ${paths.join('、')} 冲突`,
          mergeBase,
          conflictingTaskIds: [...new Set([...applied.map((entry) => entry.taskId), taskId])],
        });
      }
      const committed = git.commitPaths(
        options.worktreePath,
        `feat: integrate ${taskId} (${revision.slice(0, 12)})`,
        [],
      );
      if (!committed.ok) {
        return {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: `集成提交失败：Task ${taskId}`,
          branchUntouched: true,
          appliedTaskIds,
          applied,
        };
      }
      applied.push({
        taskId,
        revision,
        dependencyRevision: task.dependencyRevision,
        alreadyMerged: false,
        commit: committed.value.revision,
        reusedManifestIds: [],
      });
      appliedTaskIds.push(taskId);
    }
    if (cherries.value.length === 0) {
      // Git reports the Task's change as already present: the delivery branch reached
      // it through an equivalent commit, so there is nothing to replay.
      applied.push({
        taskId,
        revision: task.revision,
        dependencyRevision: task.dependencyRevision,
        alreadyMerged: true,
        commit: null,
        reusedManifestIds: options.dependencyManifestRefs ?? [],
      });
    }
  }

  const head = git.headRevision(options.worktreePath);
  if (!head.ok || head.value === null) {
    return failure('读取集成 worktree HEAD 失败', appliedTaskIds);
  }
  if (
    head.value === options.targetRevision &&
    applied.length === 0 &&
    (options.requirementPool ?? []).length === 0
  ) {
    return {
      ok: true,
      appliedTaskIds,
      skippedTaskIds: plan.skippedTaskIds,
      applied,
      revision: options.targetRevision,
      outcome: 'noop',
      cas: {
        ok: true,
        operationId: options.operationId,
        state: 'completed',
        previousRevision: options.targetRevision,
        revision: options.targetRevision,
        targetRevision: options.targetRevision,
        targetTree:
          requireGit(
            git.mergeTree(options.repoRoot, options.targetRevision),
            'INTERNAL_ERROR',
            '读取 target tree 失败',
          ) ?? '',
        reused: true,
        refUpdated: false,
        completionEventId: completionId(options.operationId),
        emittedCompletionEvent: false,
        requirementRecordHashes: [],
      },
    };
  }

  const cas = options.cas.integrate({
    operationId: options.operationId,
    kind: 'integrate',
    repoRoot: options.repoRoot,
    ref: options.ref,
    expectedRevision: options.targetRevision,
    candidateRevision: head.value,
    message: options.message ?? `feat: 集成 ${appliedTaskIds.join('、') || '需求'} 的交付`,
    worktreePaths: [options.worktreePath],
    ...(options.requirementPool === undefined ? {} : { requirementPool: options.requirementPool }),
    taskIds: appliedTaskIds,
    workId: options.workId,
    ...(options.requirementId === undefined ? {} : { requirementId: options.requirementId }),
  });
  if (!cas.ok) return cas;
  // Nothing new was replayed (every Task was already present), so the integration is a
  // no-op even though the completion event was recorded.
  const replayedCommit = applied.some((entry) => entry.commit !== null);
  return {
    ok: true,
    appliedTaskIds,
    skippedTaskIds: plan.skippedTaskIds,
    applied,
    revision: cas.targetRevision,
    outcome: replayedCommit ? 'integrated' : 'noop',
    cas,
  };
}

/**
 * Creates the independent repair Task for a conflict between already-passed Tasks
 * (AC-062).
 *
 * The Task is a *new* unit of work: it depends on both conflicting Tasks, carries the
 * frozen dependency revision the integration was at, and states that the final
 * combination must be verified again (`workflow.md` §6/§7 "最终新目标再次独立Review").
 */
export function createRepairTask(input: {
  readonly conflict: IntegrationConflict;
  readonly workId: string;
  readonly requirementId?: string;
  readonly dependencyRevision: string;
  readonly dependencyManifestRefs: readonly string[];
  readonly conflictingTaskIds: readonly string[];
  readonly acceptanceIds: readonly string[];
  readonly role?: 'backend' | 'frontend';
  readonly language?: 'typescript' | 'other';
}): RepairPlan {
  const taskIds = [...input.conflictingTaskIds].sort();
  const id = repairTaskId({
    workId: input.workId,
    taskIds,
    revision: input.dependencyRevision,
  });
  const artifactPath = `.agentdev/integration/conflicts/${input.workId}-${id.slice(0, 8)}.md`;
  const role = input.role ?? 'backend';
  const message = `最终集成在 Task ${taskIds.join(' 与 ')} 之间冲突（${input.conflict.paths.join('、') || input.conflict.message}）；CAS 保护 HEAD，交付分支未被修改`;
  const markdown = [
    `# 集成冲突修复 Task ${id}`,
    '',
    `- workId: ${input.workId}`,
    input.requirementId === undefined ? null : `- requirementId: ${input.requirementId}`,
    `- 冲突 Task: ${taskIds.join('、')}`,
    `- dependencyRevision: ${input.dependencyRevision}`,
    `- mergeBase: ${input.conflict.mergeBase ?? 'none'}`,
    `- 冲突路径: ${input.conflict.paths.join('、') || '（无路径级冲突）'}`,
    `- 说明: ${input.conflict.message}`,
    '',
    '## 要求',
    '',
    '1. 只解决两路线之间的冲突，不改变任一路线已验收的行为。',
    '2. 修复后必须对**最终组合**重新独立 Review/Test；不得复用任一 Task 的既有验证证据。',
    '3. 交付分支由 CAS（`git update-ref <ref> <new> <expected>`）更新；禁止 force push。',
    '4. 完成后由 Chief 将本 Task 与两路线一起重新集成。',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const repairTask: RepairTask = {
    id,
    workId: input.workId,
    title: `修复集成冲突：${taskIds.join(' × ')}`,
    role,
    dependsOn: taskIds,
    dependencyRevision: input.dependencyRevision,
    dependencyManifestRefs: [...input.dependencyManifestRefs],
    acceptanceIds: [...input.acceptanceIds],
    conflictPaths: [...input.conflict.paths],
    mergeBase: input.conflict.mergeBase,
    conflictArtifactPath: artifactPath,
    requiresFreshVerification: true,
    committed: false,
    message,
  };
  return {
    conflict: input.conflict,
    repairTask,
    artifact: { path: artifactPath, markdown, sha256: sha256Hex(markdown) },
  };
}

// ---------------------------------------------------------------------------
// CAS integration (AC-062, AC-063, AC-094)
// ---------------------------------------------------------------------------

export interface CasOptions {
  readonly git: WorktreeGitPort;
  readonly journal: CasJournal;
  readonly events: CasEventPort;
  /** Frozen tree of the candidate, when the caller measured it itself. */
  readonly candidateTree?: string;
  /** Injected by the requirement-save owner so the pool layout is validated once. */
  readonly validateRequirementPool?: (pool: readonly RequirementPoolCommit[]) => readonly string[];
  readonly now?: () => string;
  /** Commit author/message override for the "committer" line. */
  readonly committer?: string;
}

export interface CasService {
  integrate(request: CasRequest): CasOutcome;
  /** The journal row for an operation, when one exists. */
  journalFor(operationId: string): CasJournalRecord | null;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function isRepoPath(path: string): boolean {
  if (path === '' || path.includes('\0') || path.includes('\\')) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/u.test(path)) return false;
  return !path.split('/').some((segment) => segment === '' || segment === '..');
}

function refusal(
  code: CasFailureCode,
  message: string,
  details: {
    readonly expectedRevision: string;
    readonly actualRevision?: string | null;
    readonly errors?: readonly WorkspaceDiagnostic[];
  },
): CasOutcome {
  return {
    ok: false,
    code,
    actualRevision: details.actualRevision ?? null,
    expectedRevision: details.expectedRevision,
    message,
    branchUntouched: true,
    errors: details.errors ?? [],
  };
}

/** Validates one requirement record's file set before it may be committed. */
export function requirementPoolPaths(pool: readonly RequirementPoolCommit[]): readonly string[] {
  const paths: string[] = [];
  for (const record of pool) {
    if (
      !isRepoPath(record.recordPath) ||
      !isRepoPath(record.metadataPath) ||
      !isRepoPath(record.contentPath)
    ) {
      throw new WorkspaceError('VALIDATION_ERROR', `需求记录路径非法：${record.recordPath}`, {
        details: { recordPath: record.recordPath },
      });
    }
    if (!record.recordPath.startsWith(`${REQUIREMENTS_ROOT}/`)) {
      throw new WorkspaceError(
        'VALIDATION_ERROR',
        `需求记录目录必须位于 ${REQUIREMENTS_ROOT} 下：${record.recordPath}`,
        { details: { recordPath: record.recordPath } },
      );
    }
    const expectedMetadata = `${record.recordPath}/${'requirement.json'}`;
    const expectedContent = `${record.recordPath}/${'content.md'}`;
    if (record.metadataPath !== expectedMetadata || record.contentPath !== expectedContent) {
      throw new WorkspaceError(
        'VALIDATION_ERROR',
        `需求记录必须同时提交 requirement.json 与 content.md：${record.recordPath}`,
        {
          details: {
            recordPath: record.recordPath,
            metadataPath: record.metadataPath,
            contentPath: record.contentPath,
          },
        },
      );
    }
    paths.push(record.metadataPath, record.contentPath);
    if (record.readmePath !== undefined) {
      if (!isRepoPath(record.readmePath)) {
        throw new WorkspaceError('VALIDATION_ERROR', `README 路径非法：${record.readmePath}`, {
          details: { readmePath: record.readmePath },
        });
      }
      paths.push(record.readmePath);
    }
  }
  return paths;
}

export function createCasService(options: CasOptions): CasService {
  const git = options.git;
  const journal = options.journal;
  const events = options.events;
  const now = options.now ?? defaultNow;

  const knownRevision = (repoRoot: string, revision: string): boolean => {
    const result = git.resolveRevision(repoRoot, revision);
    return result.ok && result.value !== null;
  };

  /** The revision a ref currently holds; `null` when the ref does not exist. */
  const refRevision = (repoRoot: string, ref: string): string | null => {
    const resolved = git.resolveRevision(repoRoot, ref);
    return resolved.ok ? resolved.value : null;
  };

  const save = (
    record: CasJournalRecord,
    state: CasJournalState,
    patch: Partial<CasJournalRecord>,
  ): CasJournalRecord => {
    const next: CasJournalRecord = { ...record, ...patch, state, updatedAt: now() };
    journal.save(next);
    return next;
  };

  /**
   * Emits the single completion event and marks the operation completed.
   *
   * `reliability.md` §5: "用相同operationId恢复不产生重复完成事件". The journal state
   * is the guard, so re-entering this function for an already completed operation
   * restores the original event id instead of appending a second event.
   */
  const complete = (
    request: CasRequest,
    record: CasJournalRecord,
    refUpdated: boolean,
  ): CasOutcome => {
    const targetRevision = record.targetRevision;
    const targetTree = record.targetTree;
    if (targetRevision === undefined || targetTree === undefined) {
      return refusal('INTERNAL_ERROR', 'CAS 记录缺少已提交版本，无法完成', {
        expectedRevision: request.expectedRevision,
      });
    }
    const eventId = record.completionEventId ?? completionId(request.operationId);
    const alreadyEmitted = record.state === 'completed';
    if (!alreadyEmitted) {
      events.appendCompletion({
        eventId,
        operationId: request.operationId,
        kind: request.kind,
        revision: targetRevision,
        tree: targetTree,
        workId: request.workId ?? null,
        requirementId: request.requirementId ?? null,
        taskIds: [...(request.taskIds ?? [])],
        reused: record.state !== 'pending' || !refUpdated,
      });
    }
    const finished = save(record, 'completed', { completionEventId: eventId });
    return {
      ok: true,
      operationId: request.operationId,
      state: 'completed',
      previousRevision: finished.expectedRevision,
      revision: targetRevision,
      targetRevision,
      targetTree,
      reused: alreadyEmitted || record.state !== 'pending' || !refUpdated,
      refUpdated,
      completionEventId: eventId,
      emittedCompletionEvent: !alreadyEmitted,
      requirementRecordHashes: (request.requirementPool ?? []).map((entry) => entry.recordHash),
    };
  };

  const integrate = (request: CasRequest): CasOutcome => {
    const repoRoot = canonicalPath(request.repoRoot) ?? request.repoRoot;

    if (request.operationId.trim() === '') {
      return refusal('VALIDATION_ERROR', 'CAS 操作缺少 operationId', {
        expectedRevision: request.expectedRevision,
      });
    }
    if (!request.ref.startsWith('refs/')) {
      return refusal('VALIDATION_ERROR', `ref 必须是完整 ref 名：${request.ref}`, {
        expectedRevision: request.expectedRevision,
      });
    }
    if (!FULL_OID.test(request.expectedRevision)) {
      return refusal(
        'VALIDATION_ERROR',
        `expectedRevision 不是完整 Git OID：${request.expectedRevision}`,
        { expectedRevision: request.expectedRevision },
      );
    }
    if (request.candidateRevision === undefined) {
      // The candidate is always produced outside this service; committing here would
      // move the delivery branch without the expected-old protection (`W8R1-01`).
      return refusal(
        'VALIDATION_ERROR',
        'CAS 需要 candidateRevision：交付提交必须在集成 worktree 中创建，ref 只由 CAS 的 update-ref 移动',
        { expectedRevision: request.expectedRevision },
      );
    }
    if (!FULL_OID.test(request.candidateRevision)) {
      return refusal(
        'VALIDATION_ERROR',
        `candidateRevision 不是完整 Git OID：${request.candidateRevision}`,
        { expectedRevision: request.expectedRevision },
      );
    }
    if (request.message.trim() === '') {
      return refusal('VALIDATION_ERROR', 'CAS 提交信息不得为空', {
        expectedRevision: request.expectedRevision,
      });
    }

    try {
      // Validated even though the commit is produced elsewhere: a half record pair
      // must be refused before the ref can move (`AC-093`).
      requirementPoolPaths(request.requirementPool ?? []);
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return refusal('VALIDATION_ERROR', error.message, {
          expectedRevision: request.expectedRevision,
        });
      }
      throw error;
    }
    const customIssues = options.validateRequirementPool?.(request.requirementPool ?? []) ?? [];
    if (customIssues.length > 0) {
      return refusal('VALIDATION_ERROR', customIssues.join('；'), {
        expectedRevision: request.expectedRevision,
      });
    }

    for (const worktreePath of request.worktreePaths ?? []) {
      const status = git.statusPorcelain(worktreePath);
      if (!status.ok) {
        return refusal('INTERNAL_ERROR', `无法核对 worktree 状态：${worktreePath}`, {
          expectedRevision: request.expectedRevision,
          errors: status.errors,
        });
      }
      if (status.value.length > 0) {
        return refusal(
          'INVALID_STATE',
          `worktree ${worktreePath} 有 ${status.value.length} 个未提交路径，集成前必须干净`,
          { expectedRevision: request.expectedRevision },
        );
      }
    }

    if (!knownRevision(repoRoot, request.expectedRevision)) {
      return refusal(
        'STALE_ARTIFACT',
        `交付基线 ${request.expectedRevision} 已不存在于仓库，无法在其上集成`,
        { expectedRevision: request.expectedRevision },
      );
    }
    if (
      request.candidateRevision !== undefined &&
      !knownRevision(repoRoot, request.candidateRevision)
    ) {
      return refusal('STALE_ARTIFACT', `候选版本 ${request.candidateRevision} 不存在于仓库`, {
        expectedRevision: request.expectedRevision,
        actualRevision: refRevision(repoRoot, request.ref),
      });
    }

    const actual = refRevision(repoRoot, request.ref);

    // 1. Operation reuse: the same operation id may only resume the same work.
    const existing = journal.load(request.operationId);
    if (existing !== null) {
      if (existing.ref !== request.ref || existing.kind !== request.kind) {
        return refusal(
          'IDEMPOTENCY_CONFLICT',
          `operationId ${request.operationId} 已用于 ${existing.kind} ${existing.ref}`,
          { expectedRevision: request.expectedRevision, actualRevision: actual },
        );
      }
      if (existing.expectedRevision !== request.expectedRevision) {
        return refusal(
          'IDEMPOTENCY_CONFLICT',
          `operationId ${request.operationId} 记录的 expectedRevision=${existing.expectedRevision} 与本次 ${request.expectedRevision} 不一致`,
          { expectedRevision: request.expectedRevision, actualRevision: actual },
        );
      }
      if (
        existing.targetRevision !== undefined &&
        request.candidateRevision !== undefined &&
        existing.targetRevision !== request.candidateRevision
      ) {
        return refusal(
          'IDEMPOTENCY_CONFLICT',
          `operationId ${request.operationId} 已提交 ${existing.targetRevision}，与本次候选 ${request.candidateRevision} 不一致`,
          { expectedRevision: request.expectedRevision, actualRevision: actual },
        );
      }

      if (existing.state === 'completed') {
        if (existing.targetRevision !== undefined && actual === existing.targetRevision) {
          return complete(request, existing, false);
        }
        return refusal(
          'VERSION_CONFLICT',
          `交付分支 ${request.ref} 当前为 ${actual ?? 'unborn'}，不再是本操作完成的 ${existing.targetRevision ?? 'none'}`,
          { expectedRevision: request.expectedRevision, actualRevision: actual },
        );
      }
      if (existing.targetRevision !== undefined) {
        // The commit exists (state `committed`, or `pending` when the crash landed
        // between the commit and the status write). It is reused, never recreated.
        if (actual === existing.targetRevision) return complete(request, existing, false);
        // `W8R2-05`: a `pending` journal whose target the ref never received is the
        // crash window between journaling the commit and the swap. A retry that names
        // exactly that commit may install it — the swap below still carries the
        // expected-old protection, so a competing move is refused, not absorbed.
        const installable =
          existing.state === 'pending' &&
          actual !== null &&
          actual === existing.expectedRevision &&
          request.candidateRevision === existing.targetRevision;
        if (!installable) {
          return refusal(
            'STALE_ARTIFACT',
            `提交 ${existing.targetRevision} 已存在但 ${request.ref} 为 ${actual ?? 'unborn'}；拒绝在其上重试`,
            { expectedRevision: request.expectedRevision, actualRevision: actual },
          );
        }
      }
      if (actual !== request.expectedRevision) {
        return refusal(
          'VERSION_CONFLICT',
          `交付基线已改变：期望 ${request.expectedRevision}，实际 ${actual ?? 'unborn'}`,
          { expectedRevision: request.expectedRevision, actualRevision: actual },
        );
      }
    }

    // 2. First attempt for this operation: the branch must still be where the caller
    //    believes it is. This is the compare half of compare-and-swap.
    if (actual !== request.expectedRevision) {
      return refusal(
        actual === null ? 'STALE_ARTIFACT' : 'VERSION_CONFLICT',
        actual === null
          ? `交付分支 ${request.ref} 不存在，期望 ${request.expectedRevision}`
          : `交付分支已移动：期望 ${request.expectedRevision}，实际 ${actual}`,
        { expectedRevision: request.expectedRevision, actualRevision: actual },
      );
    }

    // 2b. The candidate must *extend* the expected revision (`W8R2-01`). `update-ref`
    //     with the expected old value only proves the ref has not moved; without this
    //     check a crash-retry that reuses a worktree parked at an older base would
    //     install a commit whose parent is not the expected revision, silently
    //     discarding every commit integrated in between while still reporting success.
    const targetRevision = request.candidateRevision;
    const descends = git.isAncestor(repoRoot, request.expectedRevision, targetRevision);
    if (!descends.ok) {
      return refusal(
        'INTERNAL_ERROR',
        `无法校验候选 ${targetRevision} 是否为期望基线 ${request.expectedRevision} 的后代`,
        {
          expectedRevision: request.expectedRevision,
          actualRevision: actual,
          errors: descends.errors,
        },
      );
    }
    if (!descends.value) {
      return refusal(
        'STALE_ARTIFACT',
        `候选 ${targetRevision} 不是期望基线 ${request.expectedRevision} 的后代；拒绝用陈旧候选移动 ${request.ref}`,
        { expectedRevision: request.expectedRevision, actualRevision: actual },
      );
    }

    let record: CasJournalRecord = existing ?? {
      operationId: request.operationId,
      kind: request.kind,
      repoRoot,
      ref: request.ref,
      expectedRevision: request.expectedRevision,
      state: 'pending',
      stepResults: {
        expectedRevision: request.expectedRevision,
        candidateRevision: request.candidateRevision ?? null,
        requirementRecords: (request.requirementPool ?? []).map((entry) => ({
          recordPath: entry.recordPath,
          recordHash: entry.recordHash,
          version: entry.version,
        })),
      },
      createdAt: now(),
      updatedAt: now(),
    };
    record = save(record, 'pending', {});

    // 3. The commit. The candidate is always produced *outside* this service — in a
    //    detached integration worktree or by the caller's own commit step — and this
    //    service only ever installs it with `update-ref <ref> <new> <old>`. Committing
    //    here would move the delivery branch without the expected-old protection
    //    (silently absorbing a competing move), so the fallback was removed and the
    //    candidate revision is validated before the journal is touched.
    let targetTree = options.candidateTree;
    if (targetTree === undefined) {
      const measured = git.mergeTree(repoRoot, targetRevision);
      if (!measured.ok) {
        // `W8R2-04`: failing to read the candidate's tree is a structured refusal like
        // every other failure of this function. Throwing here escaped the advertised
        // `CasOutcome` union and made `settle()` an exception path.
        return refusal('INTERNAL_ERROR', `读取候选 ${targetRevision} 的 tree 失败`, {
          expectedRevision: request.expectedRevision,
          actualRevision: actual,
          errors: measured.errors,
        });
      }
      targetTree = measured.value ?? undefined;
    }
    if (targetTree === undefined) {
      return refusal('INTERNAL_ERROR', `无法读取候选 ${targetRevision} 的 tree`, {
        expectedRevision: request.expectedRevision,
        actualRevision: actual,
      });
    }

    // 4. Journal the commit *before* moving the ref: a crash here is recoverable and
    //    must not create a second commit (AC-063).
    record = save(record, 'pending', { targetRevision, targetTree, reused: false });

    // 5. The compare-and-swap itself. `update-ref` with the expected old value is the
    //    only way this ref is ever written; there is no force update path.
    const swap = git.updateRef({
      repoRoot,
      ref: request.ref,
      newRevision: targetRevision,
      expectedOldRevision: request.expectedRevision,
    });
    if (!swap.ok) {
      const raced = refRevision(repoRoot, request.ref);
      if (raced === targetRevision) {
        // Somebody else already installed exactly this commit; the operation is done.
        return complete(request, record, false);
      }
      if (raced === request.expectedRevision) {
        return refusal('INTERNAL_ERROR', `git update-ref 失败：${request.ref}`, {
          expectedRevision: request.expectedRevision,
          actualRevision: raced,
          errors: swap.errors,
        });
      }
      return refusal(
        raced === null ? 'STALE_ARTIFACT' : 'VERSION_CONFLICT',
        `CAS 失败：期望 ${request.expectedRevision}，实际 ${raced ?? 'unborn'}；交付基线已改变，本次集成作废`,
        { expectedRevision: request.expectedRevision, actualRevision: raced, errors: swap.errors },
      );
    }

    record = save(record, 'committed', {});
    return complete(request, record, true);
  };

  return {
    integrate,
    journalFor(operationId) {
      return journal.load(operationId);
    },
  };
}

/** The one completion event id for an operation (`reliability.md` §5). */
export function completionId(operationId: string): string {
  return `cas-completed:${operationId}`;
}

/** Exposes the diagnostics of a Git failure for a caller that wants to report them. */
export function casDiagnostics(errors: readonly WorkspaceDiagnostic[]): JsonObject {
  return gitDiagnostics(errors);
}
