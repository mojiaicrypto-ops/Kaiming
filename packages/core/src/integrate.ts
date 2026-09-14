/**
 * The Accept/Integrate step of the L2 delivery route (`reliability.md` §4/§9,
 * `workflow.md` §3/§7, AC-010/AC-012/AC-081).
 *
 * `workflow.md` §3 puts Integrate between the verified Task results and Settlement: every
 * `done` Task contributes its own candidate commit, the combination is applied in dependency
 * order, and only then does the delivery ref move. `packages/workspace` already owns that
 * algorithm (`runIntegration`, `planIntegration`, the shared `integration:<projectId>` lock),
 * but it consumes `IntegrationTask[]` — the producer of those per-Task revisions is
 * `task-candidate.ts`, which freezes a `VerificationManifest` and records it as
 * `Task.latestManifestId`.
 *
 * This service is the missing adapter:
 *
 * 1. it reads each Task's frozen `VerificationManifest` and refuses with `MISSING_CONTEXT`
 *    when a Task has none (`reliability.md` §4 step 1: the integration captures "所有Task结果";
 *    an unfrozen result is not a result), so a stack that lost the candidate can never
 *    silently integrate a subset;
 * 2. it creates the integration worktree as a real `git worktree` at the target revision —
 *    `integrateTasks` calls `git.cherry(worktreePath)`, so the worktree must exist first;
 * 3. it runs the Workspace/CAS integration under the **shared** Project lock, so the delivery
 *    ref moves only through `git update-ref <ref> <new> <old>` (`AC-012`) and WS failures
 *    (`TASK_MERGE_CONFLICT`/`GATE_NOT_READY`/`BUSY`) surface unchanged;
 * 4. when the integrated tree is *identical* to an already verified Task tree, it freezes the
 *    integration-level `VerificationManifest` that records the reuse
 *    (`reliability.md` §4 step 4 "单Task代码树及语义依据完全一致可复用该路线证据并记录reuse来源")
 *    and hands its id to Settlement. When no verified tree matches, no integration manifest is
 *    frozen and settlement fails closed instead of claiming an unverified combination.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { VerificationManifest } from '@agentdev/contracts';
import { sha256, type ProjectStore } from '@agentdev/storage';
import {
  runIntegration,
  type AppliedIntegrationTask,
  type CasService,
  type IntegrationTask,
  type RunIntegrationResult,
  type WorktreeGitPort,
} from '@agentdev/workspace';
import {
  deliveredCodeTreeHash,
  INTEGRATION_OPERATION_KIND,
  readFrozenVerificationManifest,
} from './settlement.js';
import type { ProjectIntegrationLock } from './requirement-save.js';
import type { SnapshotWriter } from './snapshots.js';

const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** Snapshot payload `kind` of a frozen integration `VerificationManifest`. */
export const INTEGRATION_MANIFEST_KIND = 'verification_manifest';

/** One Task result the integration replays, with the manifest it was frozen under. */
export interface IntegrationTaskResult {
  readonly taskId: string;
  readonly revision: string;
  readonly manifestId: string;
  readonly manifest: VerificationManifest;
}

export interface IntegrateRequest {
  readonly workId: string;
  /** Idempotency key of the integration; also names the `kind='integrate'` operation. */
  readonly operationId: string;
  /** The delivery revision to integrate onto; defaults to the delivery ref's head. */
  readonly targetRevision?: string;
  readonly message?: string;
  readonly ownerAttemptId?: string;
  readonly epoch?: number;
  readonly ttlMs?: number;
  readonly leaseAt?: string;
}

export type IntegrateOutcome =
  | {
      readonly ok: true;
      readonly operationId: string;
      readonly operationRowId: string;
      readonly workId: string;
      readonly ref: string;
      readonly targetRevision: string;
      /** The integrated candidate; the delivery ref now points at it. */
      readonly revision: string;
      readonly outcome: 'integrated' | 'noop';
      readonly appliedTaskIds: readonly string[];
      readonly skippedTaskIds: readonly string[];
      readonly supersededTaskIds: readonly string[];
      readonly applied: readonly AppliedIntegrationTask[];
      readonly tasks: readonly IntegrationTaskResult[];
      /**
       * The frozen integration `VerificationManifest` that records the reused Task
       * evidence; `null` when the integrated tree matches no verified Task tree.
       */
      readonly verificationManifestId: string | null;
      /** `true` when the integration replayed at least one Task commit. */
      readonly replayed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      /** Always `true`: a refusal writes no operation, no manifest and no ref. */
      readonly branchUntouched: true;
      readonly details: Record<string, unknown>;
    };

export interface IntegrateServiceOptions {
  readonly store: ProjectStore;
  readonly worktrees: WorktreeGitPort;
  readonly cas: CasService;
  /** The shared `integration:<projectId>` lock (`AC-091`, `W8R2-02`). */
  readonly lock: ProjectIntegrationLock;
  readonly projectId: string;
  readonly repoRoot: string;
  /** Root for the temporary integration worktree. */
  readonly worktreeRoot: string;
  readonly snapshots: SnapshotWriter;
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

export interface IntegrateService {
  integrate(request: IntegrateRequest): IntegrateOutcome;
}

/** A refusal with no side effect: no worktree, no operation row, no manifest, no ref move. */
function refusal(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): IntegrateOutcome {
  return { ok: false, code, message, branchUntouched: true, details };
}

/** The message of any `RunIntegrationResult` failure, wherever the union carries it. */
function integrationFailureMessage(result: Extract<RunIntegrationResult, { ok: false }>): string {
  if ('message' in result && typeof result.message === 'string' && result.message !== '') {
    return result.message;
  }
  return `集成失败（${result.code}）`;
}

/** The typed detail a Workspace failure carries, kept as JSON-safe data. */
function integrationFailureDetails(
  result: Extract<RunIntegrationResult, { ok: false }>,
): Record<string, unknown> {
  if (result.code === 'TASK_MERGE_CONFLICT') {
    return {
      conflict: {
        reason: result.conflict.reason,
        paths: [...result.conflict.paths],
        taskId: result.conflict.taskId,
        mergeBase: result.conflict.mergeBase,
      },
      repairTaskId: result.repair.repairTask.id,
    };
  }
  if (result.code === 'BUSY') {
    return { heldBy: { ...result.heldBy } };
  }
  if ('actualRevision' in result) {
    return { actualRevision: result.actualRevision, expectedRevision: result.expectedRevision };
  }
  return {};
}

/**
 * Builds the integration service over one Project's real Git, CAS and lock.
 */
export function createIntegrateService(options: IntegrateServiceOptions): IntegrateService {
  const now = options.now ?? (() => new Date().toISOString());
  const log = options.log ?? (() => undefined);

  return {
    integrate(request: IntegrateRequest): IntegrateOutcome {
      const { store, worktrees } = options;
      if (request.operationId.trim() === '') {
        return refusal('VALIDATION_ERROR', '集成需要 operationId');
      }
      const work = store.works.find(request.workId);
      if (work === undefined) {
        return refusal('NOT_FOUND', `Work ${request.workId} 不存在`, { workId: request.workId });
      }
      const project = store.projects.find(options.projectId);
      if (project === undefined) {
        return refusal('INVALID_STATE', `Project ${options.projectId} 不存在`);
      }
      const ref = `refs/heads/${project.deliveryBranch}`;

      // `reliability.md` §4 step 1: capture the expected head. An explicit target wins;
      // otherwise the delivery ref's real head, then the Work's frozen base revision.
      const head = worktrees.resolveRevision(options.repoRoot, ref);
      const targetRevision =
        request.targetRevision ?? (head.ok ? head.value : null) ?? work.baseRevision;
      if (
        targetRevision === undefined ||
        targetRevision === null ||
        !FULL_OID.test(targetRevision)
      ) {
        return refusal('GATE_NOT_READY', `无法确定 ${ref} 的集成基线，不能集成`, { ref });
      }

      const taskRows = store.tasks.list({ where: 'work_id = ?', params: [work.id] });
      if (taskRows.length === 0) {
        return refusal('GATE_NOT_READY', `Work ${work.id} 没有可集成的 Task`, { workId: work.id });
      }

      // Every Task must have a frozen result before anything is written
      // (`reliability.md` §4 step 1). A missing manifest is `MISSING_CONTEXT`, never a
      // silently smaller integration.
      const tasks: IntegrationTask[] = [];
      const results: IntegrationTaskResult[] = [];
      for (const task of taskRows) {
        if (task.latestManifestId === undefined) {
          return refusal(
            'MISSING_CONTEXT',
            `Task ${task.id} 没有 VerificationManifest，不能在未验证的结果上集成`,
            { taskId: task.id, workId: work.id },
          );
        }
        const manifest = readFrozenVerificationManifest(store, task.latestManifestId);
        if (manifest === null) {
          return refusal(
            'MISSING_CONTEXT',
            `Task ${task.id} 的 VerificationManifest ${task.latestManifestId} 不存在`,
            { taskId: task.id, manifestId: task.latestManifestId },
          );
        }
        if (manifest.workId !== work.id) {
          return refusal(
            'MISSING_CONTEXT',
            `Task ${task.id} 的 VerificationManifest 属于其他 Work ${manifest.workId}`,
            { taskId: task.id, manifestId: task.latestManifestId },
          );
        }
        const known = worktrees.resolveRevision(options.repoRoot, manifest.codeRevision);
        if (!known.ok || known.value === null) {
          return refusal(
            'GATE_NOT_READY',
            `Task ${task.id} 的冻结版本 ${manifest.codeRevision} 不在仓库中`,
            { taskId: task.id, revision: manifest.codeRevision },
          );
        }
        tasks.push({
          taskId: task.id,
          revision: manifest.codeRevision,
          dependsOn: [...task.dependsOn],
          dependencyRevision: task.dependencyRevision ?? null,
          role: task.role,
          acceptanceIds: [...task.acceptanceIds],
        });
        results.push({
          taskId: task.id,
          revision: manifest.codeRevision,
          manifestId: task.latestManifestId,
          manifest,
        });
      }

      // `integrateTasks` runs `git cherry` *in* the worktree, so the real worktree must
      // exist before the call. A deterministic path lets a crashed integration's residue
      // be recognised and removed instead of accumulating.
      const worktreePath = join(
        options.worktreeRoot,
        `integration-${sha256(request.operationId).slice(0, 16)}`,
      );
      try {
        if (existsSync(worktreePath)) {
          worktrees.removeWorktree(options.repoRoot, worktreePath, true);
          rmSync(worktreePath, { recursive: true, force: true });
        }
        const added = worktrees.addWorktree({
          repoRoot: options.repoRoot,
          path: worktreePath,
          baseRevision: targetRevision,
        });
        if (!added.ok) {
          return refusal(
            'INTERNAL_ERROR',
            `无法创建集成 worktree：${added.errors[0]?.message ?? 'unknown'}`,
            { worktreePath },
          );
        }

        const result = runIntegration({
          git: worktrees,
          repoRoot: options.repoRoot,
          cas: options.cas,
          worktreePath,
          operationId: request.operationId,
          ref,
          targetRevision,
          tasks,
          workId: work.id,
          ...(work.requirementId === undefined ? {} : { requirementId: work.requirementId }),
          ...(request.message === undefined ? {} : { message: request.message }),
          lock: options.lock,
          projectId: options.projectId,
          ...(request.ownerAttemptId === undefined
            ? {}
            : { ownerAttemptId: request.ownerAttemptId }),
          ...(request.epoch === undefined ? {} : { epoch: request.epoch }),
          ...(request.ttlMs === undefined ? {} : { ttlMs: request.ttlMs }),
          ...(request.leaseAt === undefined ? {} : { leaseAt: request.leaseAt }),
        });
        if (!result.ok) {
          // Surface the Workspace/CAS failure unchanged (`TASK_MERGE_CONFLICT`,
          // `GATE_NOT_READY`, `BUSY`, or a CAS refusal). The ref was never touched and
          // nothing was written here.
          const details = integrationFailureDetails(result);
          log(
            `integrate: Work ${work.id} refused (${result.code}): ${integrationFailureMessage(result)}`,
          );
          return refusal(result.code, integrationFailureMessage(result), details);
        }

        const codeTree = deliveredCodeTreeHash({
          repoRoot: options.repoRoot,
          revision: result.revision,
        });
        // `reliability.md` §4 step 4: evidence may be reused only when the code tree is
        // *identical*. The integration manifest records the reused manifest ids so the
        // reuse source is auditable; with no identical tree nothing is frozen and
        // settlement will refuse the unverified combination.
        const reused = results.filter((entry) => entry.manifest.codeTree === codeTree);
        let verificationManifestId: string | null = null;
        const manifestRefs: string[] = [];
        if (reused.length > 0) {
          const source = reused[reused.length - 1];
          if (source !== undefined) {
            const manifestId = store.newId();
            const acceptanceIds = [
              ...new Set([
                ...reused.flatMap((entry) => [...entry.manifest.acceptanceIds]),
                ...results.flatMap((entry) => [...entry.manifest.acceptanceIds]),
              ]),
            ].sort();
            options.snapshots.freeze('verification', {
              kind: INTEGRATION_MANIFEST_KIND,
              manifestId,
              workId: work.id,
              createdAt: now(),
              manifest: {
                workId: work.id,
                level: work.level,
                route: work.level,
                planRef: source.manifest.planRef,
                dependencyRevision: targetRevision,
                dependencyManifestRefs: reused.map((entry) => entry.manifestId),
                codeRevision: result.revision,
                codeTree,
                policyHash: source.manifest.policyHash,
                contextSnapshotId: source.manifest.contextSnapshotId,
                readLedgerSeq: source.manifest.readLedgerSeq,
                readLedgerHash: source.manifest.readLedgerHash,
                configHash: source.manifest.configHash,
                environmentRef: source.manifest.environmentRef,
                acceptanceIds,
              },
            });
            verificationManifestId = manifestId;
            manifestRefs.push(...reused.map((entry) => entry.manifestId));
          }
        }

        const commitTree = worktrees.mergeTree(options.repoRoot, result.revision);
        const operationRowId = store.newId();
        store.operations.insert({
          id: operationRowId,
          projectId: options.projectId,
          workId: work.id,
          ...(work.requirementId === undefined ? {} : { requirementId: work.requirementId }),
          sourceRef: { kind: 'action', id: request.operationId, version: '1' },
          kind: INTEGRATION_OPERATION_KIND,
          state: 'completed',
          expectedHead: targetRevision,
          candidateRevision: result.revision,
          stepResults: {
            operationId: request.operationId,
            workId: work.id,
            ref,
            targetRevision,
            candidateRevision: result.revision,
            // A Git tree *OID*, deliberately distinct from the SHA256 `codeTree`
            // (`data.md` §3, `W8R1-08`).
            commitTree: commitTree.ok ? commitTree.value : null,
            codeTree,
            outcome: result.outcome,
            appliedTaskIds: [...result.appliedTaskIds],
            skippedTaskIds: [...result.skippedTaskIds],
            supersededTaskIds: [...result.supersededTaskIds],
            verificationManifestId,
            verificationManifestRefs: [...manifestRefs],
          },
          createdAt: now(),
          updatedAt: now(),
        });
        log(
          `integrate: Work ${work.id} candidate ${result.revision} (${result.outcome}) applied ${result.appliedTaskIds.join('、') || 'none'}`,
        );
        return {
          ok: true,
          operationId: request.operationId,
          operationRowId,
          workId: work.id,
          ref,
          targetRevision,
          revision: result.revision,
          outcome: result.outcome,
          appliedTaskIds: [...result.appliedTaskIds],
          skippedTaskIds: [...result.skippedTaskIds],
          supersededTaskIds: [...result.supersededTaskIds],
          applied: [...result.applied],
          tasks: [...results],
          verificationManifestId,
          replayed: result.applied.some((entry) => entry.commit !== null),
        };
      } finally {
        // The candidate is kept alive by the delivery ref (and the CAS journal), so the
        // temporary worktree goes away immediately.
        try {
          worktrees.removeWorktree(options.repoRoot, worktreePath, true);
          rmSync(worktreePath, { recursive: true, force: true });
        } catch {
          // A failed cleanup is crash residue the next integration recognises by path; it
          // must never mask the integration result.
        }
      }
    },
  };
}
