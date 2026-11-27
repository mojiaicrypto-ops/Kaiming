/**
 * Task creation after the tool has validated its arguments. Kept beside the task tool so the
 * in_place/worktree allocation and its compensation live in one place.
 */
import { randomUUID } from 'node:crypto';
import {
  StoreError,
  type Store,
  type TaskRow,
  type TaskType,
  type VerificationProfile,
  type WorkKind,
} from '../store/store.ts';
import { commitPlan, planRefFor, planTarget, type PlanTarget } from '../runtime/plan-store.ts';
import { captureDirtyBaseline } from '../runtime/deliverable.ts';
import { createWorktree, defaultWorktreeRoot, removeWorktree, WorktreeError } from '../runtime/worktree.ts';
import type { WorktreeLayout } from '../runtime/worktree.ts';
import { runWorktreeSetup } from '../runtime/worktree.ts';
import type { SandboxRuntime } from '../runtime/os-sandbox.ts';

export interface CreateTaskWithWorkspaceParams {
  readonly store: Store;
  readonly projectId: string;
  readonly chiefSessionId: string;
  readonly inputId: string;
  readonly cwd: string;
  readonly serverWorkDir: string;
  readonly worktreeRoot?: string;
  readonly privateDirs?: readonly string[];
  readonly sandbox?: SandboxRuntime;
  readonly type: TaskType;
  readonly workKind: WorkKind;
  readonly requiresTest: boolean;
  readonly verificationProfile?: VerificationProfile | null;
  readonly goal: string;
  readonly scope: string;
  readonly acceptanceRefs: readonly string[];
  readonly basisRefs: readonly string[];
  readonly backlogIds: readonly string[];
  readonly authorizationRefs: readonly string[];
  readonly planMarkdown: string;
  readonly explicitIsolation: boolean;
}

export interface CreatedTask {
  readonly task: TaskRow;
  readonly target: PlanTarget;
  readonly taskCwd: string;
  readonly planState: 'saved' | 'pending';
}

export function createTaskWithWorkspace(params: CreateTaskWithWorkspaceParams): CreatedTask {
  const taskId = `t-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const root = params.worktreeRoot ?? defaultWorktreeRoot();
  const base = {
    id: taskId,
    projectId: params.projectId,
    chiefSessionId: params.chiefSessionId,
    ownerEpoch: params.store.epoch,
    ...(params.backlogIds.length > 0 ? { backlogIds: params.backlogIds } : {}),
    type: params.type,
    workKind: params.workKind,
    flowVersion: 1,
    initialPhase: params.workKind === 'design' ? 'design' : 'plan',
    requiresTest: params.requiresTest,
    verificationProfile: params.verificationProfile ?? null,
    goal: params.goal,
    scope: params.scope,
    acceptanceRefs: params.acceptanceRefs,
    basisRefs: params.basisRefs,
    authorizationRefs: params.authorizationRefs,
    sourceInputId: params.inputId,
    summary: `created (${params.workKind})`,
  } as const;
  const mustIsolate =
    params.type === 'write' &&
    (params.explicitIsolation || params.store.hasOpenWriteTask(params.projectId));
  let layout: WorktreeLayout | undefined;
  const cleanup = (): void => {
    if (layout === undefined) return;
    try {
      removeWorktree({
        projectRoot: params.cwd,
        worktreeRoot: layout.worktreeRoot,
        branchName: layout.branchName,
        deleteBranch: true,
        force: true,
      });
    } catch {
      // The row is gone or will be aborted; scanStartup reports an orphan.
    }
  };
  const isolated = (): { task: TaskRow; target: PlanTarget } => {
    layout = createWorktree({
      projectRoot: params.cwd,
      projectId: params.projectId,
      taskId,
      root,
      ...(params.privateDirs !== undefined ? { privateDirs: params.privateDirs } : {}),
    });
    runWorktreeSetup({
      layout,
      taskId,
      mainWorktree: params.cwd,
      ...(params.sandbox !== undefined ? { sandbox: params.sandbox } : {}),
    });
    const target = planTarget({
      taskId,
      type: params.type,
      projectCwd: layout.workspacePath,
      serverWorkDir: params.serverWorkDir,
    });
    const task = params.store.createTask({
      ...base,
      planRef: planRefFor(target, params.planMarkdown),
      dirtyBaseline: {},
      workspaceState: 'provisioning',
      worktreeRoot: layout.worktreeRoot,
      workspacePath: layout.workspacePath,
      workspaceRelPath: layout.relativeProjectPath,
      branchName: layout.branchName,
      baseCommit: layout.baseCommit,
      baseBranch: layout.baseBranch,
    });
    return { task, target };
  };
  const inPlace = (): { task: TaskRow; target: PlanTarget } => {
    const target = planTarget({
      taskId,
      type: params.type,
      projectCwd: params.cwd,
      serverWorkDir: params.serverWorkDir,
    });
    const dirtyBaseline =
      params.type === 'write' ? captureDirtyBaseline(params.cwd, { design: params.workKind === 'design' }) : null;
    const task = params.store.createTask({
      ...base,
      planRef: planRefFor(target, params.planMarkdown),
      ...(dirtyBaseline !== null && Object.keys(dirtyBaseline).length > 0 ? { dirtyBaseline } : {}),
      workspaceState: 'in_place',
    });
    return { task, target };
  };

  let allocated: { task: TaskRow; target: PlanTarget };
  try {
    if (mustIsolate) {
      allocated = isolated();
    } else {
      try {
        allocated = inPlace();
      } catch (error) {
        if (error instanceof StoreError && error.code === 'IN_PLACE_BUSY') {
          allocated = isolated();
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  const taskCwd = layout?.workspacePath ?? params.cwd;
  try {
    commitPlan({
      store: params.store,
      requestKey: `${params.inputId}:plan:${taskId}`,
      target: allocated.target,
      markdown: params.planMarkdown,
    });
  } catch (error) {
    if (allocated.task.workspaceState === 'provisioning') {
      try {
        params.store.abortProvisioningTask(allocated.task.id);
      } catch {
        // Preserve the original failure; scanStartup can reconcile a remaining row.
      }
      cleanup();
      throw error;
    }
    return { ...allocated, taskCwd, planState: 'pending' };
  }
  if (allocated.task.workspaceState === 'provisioning') {
    try {
      allocated = { ...allocated, task: params.store.activateTaskWorkspace(allocated.task.id) };
    } catch (error) {
      try {
        params.store.abortProvisioningTask(allocated.task.id);
      } catch {
        // Preserve the original failure; scanStartup can reconcile a remaining row.
      }
      cleanup();
      throw error;
    }
  }
  return { ...allocated, taskCwd, planState: 'saved' };
}
