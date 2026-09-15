/**
 * The per-Task workspace: a Task's tools run in the Task's own Git worktree (WP-12 W6).
 *
 * `reliability.md` §4 gives every Task its own external worktree created from the Work's
 * `baseRevision` (or the Task's `dependencyRevision`), and §3 gives it a single writer.
 * Until this module existed the tool bridge resolved **every** Run to the project root and
 * reported the gap (`T3 Q-T3-8`), which made the phase-1 decision "deleting inside the
 * workspace is allowed, Git + the per-Task workspace + the delivery CAS are the backstop"
 * half true: the second backstop did not exist, so a delete could reach uncommitted work
 * that belonged to another Task.
 *
 * What this module adds:
 *
 * - **A real root per Task.** A professional Run's `read`/`write`/`edit`/`search`/`bash`
 *   calls are rooted at `<worktreeRoot>/tasks/<taskId>`, created from the Task's own base
 *   revision. The Broker's path boundary then confines every path to that tree, so one
 *   Task's delete cannot name another Task's file — it is not merely refused, it does not
 *   exist in that root.
 * - **The documented single-writer lease, twice.** The worktree manager takes a lease
 *   bound to `(attemptId, epoch)` for the whole Run, so a second Attempt of the same Task is
 *   refused with `BUSY`; the tool bridge additionally renews the Work-level writer lease on
 *   every call (`tool-handler.ts`), which is the durable half that survives a daemon
 *   restart.
 * - **Fail closed.** A Run whose Task cannot get a worktree is refused rather than silently
 *   rooted at the project root: falling back would hand back exactly the isolation the
 *   caller asked for.
 *
 * A Chief Run (no `taskId`) keeps the project root, because a Chief's tools read the
 * project and write artifacts rather than a Task tree.
 */
import {
  createMemoryWorktreeLeaseStore,
  createWorktreeManager,
  taskWorktreePath,
  type WorktreeGitPort,
  type WorktreeLeaseStore,
} from '@agentdev/workspace';
import type { ProjectStore } from '@agentdev/storage';

import { ProtocolError } from './errors.js';

/** The workspace root one Run may write to. */
export interface RunWorkspace {
  /** Absolute path handed to the Broker as the only allowed root. */
  readonly root: string;
  /** `true` when `root` is the Run's own Task worktree. */
  readonly taskWorktree: boolean;
  /** The Task the root belongs to; absent for a Chief Run. */
  readonly taskId?: string;
}

/**
 * Chooses the root a Run's tools operate in.
 *
 * The Attempt identity travels with the request because the worktree lease is bound to
 * `(attemptId, epoch)`: a resolver that could not name the writer could not enforce one
 * writer per worktree.
 */
export interface RunWorkspaceResolver {
  resolve(input: {
    readonly workId: string;
    readonly runId: string;
    readonly attemptId: string;
    readonly epoch: number;
  }): RunWorkspace;
  /**
   * Releases the Task worktree the Attempt was writing in (WP-12 W4b).
   *
   * `reliability.md` §3 keeps one writer per Task worktree, and the lease is bound to
   * `(attemptId, epoch)` with a one-hour TTL. A delivery ends the Attempt's *writing* while
   * its process is still finishing the turn, so the next stage of the route (Review, on the
   * same Task) resolved the tree and got `BUSY` — it then had to fall back to the project
   * root and honestly rejected the delivery because the change was not in that tree. The
   * caller releases the lease at exactly the point it released the Work-level writer lease
   * (`control-handler.ts`, after the candidate commit read the files), so no authority moves
   * to another writer: the released lease is the caller's own.
   */
  release(input: { readonly taskId: string; readonly attemptId: string }): boolean;
}

export interface TaskWorktreeWorkspaceOptions {
  readonly store: Pick<ProjectStore, 'runs' | 'works' | 'projects' | 'tasks'>;
  readonly git: WorktreeGitPort;
  /** Root directory the persistent per-Task worktrees live under. */
  readonly worktreeRoot: string;
  /** The delivery repository the worktrees are linked to. */
  readonly repoRoot: string;
  /** Lease ledger; defaults to an in-process one (see the module note). */
  readonly leases?: WorktreeLeaseStore;
  /** How long a worktree lease stays live; defaults to one hour. */
  readonly leaseTtlMs?: number;
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

/**
 * Builds the production resolver.
 *
 * The lease ledger defaults to an in-process store because the worktree *records* the
 * manager keeps are themselves process-scoped; the durable guarantee is the Work-level
 * writer lease the tool bridge holds in the database, which is re-asserted on every call
 * with the caller's attempt and epoch. A daemon restart therefore cannot hand one worktree
 * to two writers: the new Attempt must acquire the Work lease before its first tool call.
 */
export function createTaskWorktreeWorkspaceResolver(
  options: TaskWorktreeWorkspaceOptions,
): RunWorkspaceResolver {
  const leases = options.leases ?? createMemoryWorktreeLeaseStore();
  const manager = createWorktreeManager({
    git: options.git,
    leases,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.leaseTtlMs === undefined ? {} : { leaseTtlMs: options.leaseTtlMs }),
  });
  const log = options.log ?? ((): void => undefined);

  return {
    resolve: ({ workId, runId, attemptId, epoch }) => {
      const run = options.store.runs.find(runId);
      if (run === undefined) {
        throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`);
      }
      const work = options.store.works.find(workId);
      if (work === undefined) {
        throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
      }
      const project = options.store.projects.find(work.projectId);
      if (project === undefined) {
        throw new ProtocolError('NOT_FOUND', `Project ${work.projectId} is not open`);
      }
      if (run.taskId === undefined) {
        // A Chief Run: the project is what it reads, and its only write is an artifact.
        return { root: project.root, taskWorktree: false };
      }
      const task = options.store.tasks.find(run.taskId);
      if (task === undefined) {
        throw new ProtocolError('NOT_FOUND', `Task ${run.taskId} does not exist`);
      }
      const baseRevision = task.dependencyRevision ?? work.baseRevision;
      const outcome = manager.create({
        taskId: task.id,
        repoRoot: options.repoRoot,
        path: taskWorktreePath(options.worktreeRoot, task.id),
        ...(baseRevision === undefined ? {} : { baseRevision }),
        worktreeId: task.id,
        ownerAttemptId: attemptId,
        epoch,
        ...(options.leaseTtlMs === undefined ? {} : { ttlMs: options.leaseTtlMs }),
      });
      if (!outcome.ok) {
        throw new ProtocolError(
          outcome.code === 'BUSY' ? 'BUSY' : 'INVALID_STATE',
          `the per-Task worktree for Task ${task.id} is unavailable: ${outcome.message}`,
          {
            details: {
              taskId: task.id,
              runId: run.id,
              worktreeId: task.id,
              heldBy: outcome.heldBy?.ownerAttemptId ?? null,
            },
          },
        );
      }
      if (task.worktreeId !== outcome.record.id) {
        options.store.tasks.update(task.id, { worktreeId: outcome.record.id }, task.version);
      }
      log(
        `task-workspace: Run ${run.id} → Task ${task.id} worktree ${outcome.record.path}${outcome.reused ? ' (reused)' : ''}`,
      );
      return { root: outcome.record.path, taskWorktree: true, taskId: task.id };
    },
    release: ({ taskId, attemptId }) => {
      // The worktree id is the Task id here (`create` is called with `worktreeId: task.id`),
      // and the lease store releases only the caller's own lease.
      const released = leases.release(taskId, attemptId);
      if (released) {
        log(`task-workspace: Task ${taskId} worktree lease released by attempt ${attemptId}`);
      }
      return released;
    },
  };
}
