/**
 * Per-Task candidate commits (`reliability.md` §4, `workflow.md` §3 L2).
 *
 * The delivery route needs one code commit per Task before anything is integrated:
 * `packages/workspace` `runIntegration` consumes `IntegrationTask.revision` and
 * cherry-picks it onto the integration worktree, and `CompletionManifest.finalRevision`
 * must bind the *verified* candidate rather than a caller-supplied guess.
 *
 * This service is that producer. It gives the Task its own worktree at the Task's
 * frozen dependency revision, commits the Run's changed files there as a real
 * candidate (a `refs/agentdev/tasks/<taskId>/<runId>` ref keeps the object alive),
 * measures the delivery facts (`commitTree` the Git OID, `codeTree` the SHA256 tree
 * hash), freezes the `VerificationManifest` and records it as the Task's
 * `latestManifestId`. The `environmentRef` is the one value the caller must supply
 * because it is a property of the execution environment, not of this commit.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Level, Role } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';
import { deliveredCodeTreeHash } from './settlement.js';
import type { SnapshotWriter } from './snapshots.js';
import type { WorktreeGitPort } from '@agentdev/workspace';

/** What one Task candidate commit is built from. */
export interface TaskCandidateInput {
  readonly workId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly role: Role;
  readonly level: Level;
  /** The delivery route the Task was verified under (`L1`/`L2`/`L3`). */
  readonly route: string;
  readonly planRef: { readonly id: string; readonly version: number; readonly hash: string };
  /** The revision the Task's work started from (`Task.dependencyRevision`). */
  readonly dependencyRevision: string;
  readonly dependencyManifestRefs: readonly string[];
  readonly acceptanceIds: readonly string[];
  readonly policyHash: string;
  readonly configHash: string;
  readonly contextSnapshotId: string;
  readonly readLedgerSeq: number;
  readonly readLedgerHash: string;
  /** The real execution environment (`container:<image>` / `host:<platform>`). */
  readonly environmentRef: string;
  /** The paths the Run changed, relative to the repository. */
  readonly changedPaths: readonly string[];
  /** Working copy holding the Run's edits; defaults to the repository root. */
  readonly sourceRoot?: string;
  readonly message?: string;
}

export type TaskCandidateResult =
  | {
      readonly ok: true;
      readonly taskId: string;
      readonly revision: string;
      /** Git tree OID of `revision` (`W8R1-08`: not the SHA256 code tree). */
      readonly commitTree: string;
      /** SHA256 over the recursive tree listing (`data.md` §3 `codeTree`). */
      readonly codeTree: string;
      /** The `VerificationManifest` id recorded on the Task. */
      readonly manifestId: string;
      /** Snapshot hash the manifest was frozen under. */
      readonly manifestHash: string;
      readonly worktreePath: string;
      readonly ref: string;
      /** `true` when the Task changed nothing and the base revision was reused. */
      readonly reusedBase: boolean;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface TaskCandidateServiceOptions {
  readonly store: ProjectStore;
  readonly worktrees: WorktreeGitPort;
  readonly snapshots: SnapshotWriter;
  /** Repository the candidate is committed in. */
  readonly repoRoot: string;
  /** Root directory for temporary per-Task worktrees. */
  readonly worktreeRoot: string;
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

export interface TaskCandidateService {
  commit(input: TaskCandidateInput): TaskCandidateResult;
}

/** The candidate ref one Task Run keeps its commit alive under. */
export function taskCandidateRef(taskId: string, runId: string): string {
  return `refs/agentdev/tasks/${taskId}/${runId}`;
}

export function createTaskCandidateService(
  options: TaskCandidateServiceOptions,
): TaskCandidateService {
  const now = options.now ?? (() => new Date().toISOString());
  const log = options.log ?? (() => undefined);
  return {
    commit(input: TaskCandidateInput): TaskCandidateResult {
      if (input.environmentRef.trim() === '') {
        return {
          ok: false,
          code: 'MISSING_CONTEXT',
          message: `Task ${input.taskId} has no execution environmentRef; the VerificationManifest cannot be frozen`,
        };
      }
      const task = options.store.tasks.find(input.taskId);
      if (task === undefined) {
        return { ok: false, code: 'NOT_FOUND', message: `Task ${input.taskId} does not exist` };
      }
      if (task.workId !== input.workId) {
        return {
          ok: false,
          code: 'NOT_AUTHORIZED',
          message: `Task ${input.taskId} belongs to Work ${task.workId}`,
        };
      }
      const worktreePath = join(options.worktreeRoot, input.taskId, input.runId);
      const ref = taskCandidateRef(input.taskId, input.runId);
      try {
        if (existsSync(worktreePath)) {
          // A leftover worktree at this exact path is crash residue, not reuse
          // material (`W8R2-01`); it is removed before the fresh checkout.
          options.worktrees.removeWorktree(options.repoRoot, worktreePath, true);
          rmSync(worktreePath, { recursive: true, force: true });
        }
        const added = options.worktrees.addWorktree({
          repoRoot: options.repoRoot,
          path: worktreePath,
          baseRevision: input.dependencyRevision,
        });
        if (!added.ok) {
          return {
            ok: false,
            code: 'INTERNAL_ERROR',
            message: `无法为 Task ${input.taskId} 创建工作树：${added.errors[0]?.message ?? 'unknown'}`,
          };
        }
        const sourceRoot = input.sourceRoot ?? options.repoRoot;
        for (const path of input.changedPaths) {
          copyWorkingCopyFile(sourceRoot, worktreePath, path);
        }
        const status = options.worktrees.statusPorcelain(worktreePath);
        const dirty = status.ok && status.value.length > 0;
        let revision = input.dependencyRevision;
        let reusedBase = true;
        if (dirty) {
          // The Run's paths must be **staged**: `commitPaths` with an empty path list
          // commits the index as-is (`--allow-empty`), which would create an empty
          // candidate whose tree still equals the base — the integration would then find
          // nothing to apply. Passing the same paths that were copied stages the
          // modifications, additions and real deletions (`W8R2-01`).
          const committed = options.worktrees.commitPaths(
            worktreePath,
            input.message ?? `feat(task): ${input.taskId} 的候选提交`,
            [...input.changedPaths],
          );
          if (!committed.ok) {
            return {
              ok: false,
              code: 'INTERNAL_ERROR',
              message: `Task ${input.taskId} 的候选提交失败：${committed.errors[0]?.message ?? 'unknown'}`,
            };
          }
          revision = committed.value.revision;
          reusedBase = false;
          const refUpdated = options.worktrees.updateRef({
            repoRoot: options.repoRoot,
            ref,
            newRevision: revision,
            expectedOldRevision: null,
          });
          if (!refUpdated.ok) {
            return {
              ok: false,
              code: 'INTERNAL_ERROR',
              message: `候选提交 ${revision} 的 ref 更新失败：${refUpdated.errors[0]?.message ?? 'unknown'}`,
            };
          }
        }
        const commitTree = options.worktrees.mergeTree(options.repoRoot, revision);
        if (!commitTree.ok || commitTree.value === null) {
          return {
            ok: false,
            code: 'INTERNAL_ERROR',
            message: `无法读取候选 ${revision} 的 Git tree`,
          };
        }
        const codeTree = deliveredCodeTreeHash({
          repoRoot: options.repoRoot,
          revision,
        });
        const manifestId = options.store.newId();
        const manifest = {
          workId: input.workId,
          taskId: input.taskId,
          level: input.level,
          route: input.route,
          planRef: input.planRef,
          dependencyRevision: input.dependencyRevision,
          dependencyManifestRefs: [...input.dependencyManifestRefs],
          codeRevision: revision,
          codeTree,
          policyHash: input.policyHash,
          contextSnapshotId: input.contextSnapshotId,
          readLedgerSeq: input.readLedgerSeq,
          readLedgerHash: input.readLedgerHash,
          configHash: input.configHash,
          environmentRef: input.environmentRef,
          acceptanceIds: [...input.acceptanceIds],
        };
        const frozen = options.snapshots.freeze('verification', {
          kind: 'verification_manifest',
          manifestId,
          workId: input.workId,
          taskId: input.taskId,
          createdAt: now(),
          manifest,
        });
        const current = options.store.tasks.find(input.taskId);
        if (current !== undefined) {
          options.store.tasks.update(
            input.taskId,
            { latestManifestId: manifestId },
            current.version,
          );
        }
        log(
          `task-candidate: Task ${input.taskId} candidate ${revision} (tree ${commitTree.value}, codeTree ${codeTree}) manifest ${manifestId}`,
        );
        return {
          ok: true,
          taskId: input.taskId,
          revision,
          commitTree: commitTree.value,
          codeTree,
          manifestId,
          manifestHash: frozen.hash,
          worktreePath,
          ref,
          reusedBase,
        };
      } finally {
        // The candidate commit is kept alive by its ref, so the temporary worktree
        // can go away immediately (it is crash residue otherwise).
        try {
          options.worktrees.removeWorktree(options.repoRoot, worktreePath, true);
          rmSync(worktreePath, { recursive: true, force: true });
        } catch {
          // A failed cleanup is reported by the next save/integration's own status
          // read; it must never mask the commit result.
        }
      }
    },
  };
}

/** Copies one changed file from the Run's working copy into the Task worktree. */
function copyWorkingCopyFile(sourceRoot: string, worktreePath: string, path: string): void {
  const source = join(sourceRoot, path);
  const target = join(worktreePath, path);
  let bytes: Buffer;
  try {
    bytes = readFileSync(source);
  } catch {
    // A path the Run reported but that no longer exists is a deletion: the base
    // revision already holds the old content, so removing the target records it.
    rmSync(target, { force: true });
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}
