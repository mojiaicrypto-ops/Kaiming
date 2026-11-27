import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createTaskWithWorkspace } from '../src/tools/task-creation.ts';
import { createTaskTool } from '../src/tools/task-tools.ts';
import { snapshotDelivery } from '../src/runtime/deliverable.ts';
import { readArtifact } from '../src/runtime/artifact-reader.ts';
import {
  createWorktree,
  gitShowFile,
  landWorktree,
  removeWorktree,
  WorktreeError,
} from '../src/runtime/worktree.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function repo(): { root: string; project: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-worktree-'));
  dirs.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  git(project, 'init', '--quiet');
  writeFileSync(join(project, 'base.txt'), 'base\n');
  git(project, 'add', '--all');
  git(project, 'commit', '--quiet', '-m', 'base');
  return { root, project, base: git(project, 'rev-parse', 'HEAD') };
}

describe('task worktrees', () => {
  it('creates, commits, fast-forwards and removes a worktree', () => {
    const { root, project } = repo();
    const layout = createWorktree({
      projectRoot: project,
      projectId: 'p-1',
      taskId: 't-1',
      root: join(root, 'worktrees'),
    });
    expect(layout.branchName).toBe('kaiming/t-1');
    expect(layout.workspacePath).toBe(layout.worktreeRoot);
    writeFileSync(join(layout.workspacePath, 'change.txt'), 'change\n');
    git(layout.workspacePath, 'add', '--all');
    git(layout.workspacePath, 'commit', '--quiet', '-m', 'change');

    expect(
      landWorktree({
        projectRoot: project,
        worktreeRoot: layout.worktreeRoot,
        branchName: layout.branchName,
        baseCommit: layout.baseCommit,
        baseBranch: layout.baseBranch,
      }).outcome,
    ).toBe('merged');
    expect(readFileSync(join(project, 'change.txt'), 'utf8')).toBe('change\n');

    removeWorktree({
      projectRoot: project,
      worktreeRoot: layout.worktreeRoot,
      branchName: layout.branchName,
      deleteBranch: true,
    });
    expect(existsSync(layout.worktreeRoot)).toBe(false);
  });

  it('keeps the branch when main moved and can read it without a worktree', () => {
    const { root, project } = repo();
    const layout = createWorktree({
      projectRoot: project,
      projectId: 'p-1',
      taskId: 't-2',
      root: join(root, 'worktrees'),
    });
    writeFileSync(join(layout.workspacePath, 'branch-only.txt'), 'branch\n');
    git(layout.workspacePath, 'add', '--all');
    git(layout.workspacePath, 'commit', '--quiet', '-m', 'branch');

    writeFileSync(join(project, 'main.txt'), 'main\n');
    git(project, 'add', '--all');
    git(project, 'commit', '--quiet', '-m', 'main moved');

    expect(
      landWorktree({
        projectRoot: project,
        worktreeRoot: layout.worktreeRoot,
        branchName: layout.branchName,
        baseCommit: layout.baseCommit,
        baseBranch: layout.baseBranch,
      }).outcome,
    ).toBe('branch_kept');
    expect(existsSync(join(project, 'branch-only.txt'))).toBe(false);
    expect(
      gitShowFile({ projectRoot: project, branchName: layout.branchName, repoRelativePath: 'branch-only.txt' }),
    ).toBe('branch\n');

    removeWorktree({
      projectRoot: project,
      worktreeRoot: layout.worktreeRoot,
      branchName: layout.branchName,
      deleteBranch: false,
    });
    expect(
      gitShowFile({ projectRoot: project, branchName: layout.branchName, repoRelativePath: 'branch-only.txt' }),
    ).toBe('branch\n');
  });

  it('maps a project subdirectory inside the worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'kaiming-worktree-mono-'));
    dirs.push(root);
    const project = join(root, 'repo');
    mkdirSync(join(project, 'packages', 'app'), { recursive: true });
    git(project, 'init', '--quiet');
    writeFileSync(join(project, 'packages', 'app', 'base.txt'), 'base\n');
    git(project, 'add', '--all');
    git(project, 'commit', '--quiet', '-m', 'base');

    const layout = createWorktree({
      projectRoot: join(project, 'packages', 'app'),
      projectId: 'p-1',
      taskId: 't-mono',
      root: join(root, 'worktrees'),
    });
    expect(layout.relativeProjectPath).toBe(join('packages', 'app'));
    expect(layout.workspacePath).toBe(join(layout.worktreeRoot, 'packages', 'app'));
    expect(readFileSync(join(layout.workspacePath, 'base.txt'), 'utf8')).toBe('base\n');
  });

  it('refuses a root inside the project or a private directory', () => {
    const { root, project } = repo();
    expect(() =>
      createWorktree({
        projectRoot: project,
        projectId: 'p-1',
        taskId: 't-bad',
        root: join(project, 'worktrees'),
      }),
    ).toThrowError(WorktreeError);
    expect(existsSync(join(project, 'worktrees'))).toBe(false);
    expect(() =>
      createWorktree({
        projectRoot: project,
        projectId: 'p-1',
        taskId: 't-private',
        root,
        privateDirs: [root],
      }),
    ).toThrowError(WorktreeError);
    expect(() =>
      createWorktree({
        projectRoot: project,
        projectId: 'p-1',
        taskId: 't-relative',
        root: 'relative-root',
      }),
    ).toThrowError(WorktreeError);
  });

  it('keeps the branch when the main checkout is dirty', () => {
    const { root, project } = repo();
    const layout = createWorktree({
      projectRoot: project,
      projectId: 'p-1',
      taskId: 't-dirty',
      root: join(root, 'worktrees'),
    });
    writeFileSync(join(layout.workspacePath, 'branch.txt'), 'branch\n');
    git(layout.workspacePath, 'add', '--all');
    git(layout.workspacePath, 'commit', '--quiet', '-m', 'branch');
    writeFileSync(join(project, 'dirty.txt'), 'dirty\n');

    expect(
      landWorktree({
        projectRoot: project,
        worktreeRoot: layout.worktreeRoot,
        branchName: layout.branchName,
        baseBranch: layout.baseBranch,
        baseCommit: layout.baseCommit,
      }).outcome,
    ).toBe('branch_kept');
    removeWorktree({
      projectRoot: project,
      worktreeRoot: layout.worktreeRoot,
      branchName: layout.branchName,
      deleteBranch: true,
    });
  });

  it('keeps the branch when the main checkout switched branches', () => {
    const { root, project } = repo();
    const layout = createWorktree({
      projectRoot: project,
      projectId: 'p-1',
      taskId: 't-switched',
      root: join(root, 'worktrees'),
    });
    writeFileSync(join(layout.workspacePath, 'branch.txt'), 'branch\n');
    git(layout.workspacePath, 'add', '--all');
    git(layout.workspacePath, 'commit', '--quiet', '-m', 'branch');
    git(project, 'checkout', '-b', 'other');

    expect(
      landWorktree({
        projectRoot: project,
        worktreeRoot: layout.worktreeRoot,
        branchName: layout.branchName,
        baseBranch: layout.baseBranch,
        baseCommit: layout.baseCommit,
      }).outcome,
    ).toBe('branch_kept');
    removeWorktree({
      projectRoot: project,
      worktreeRoot: layout.worktreeRoot,
      branchName: layout.branchName,
      deleteBranch: true,
    });
  });

  it('forces only the explicitly requested provisioning cleanup', () => {
    const { root, project } = repo();
    const layout = createWorktree({
      projectRoot: project,
      projectId: 'p-1',
      taskId: 't-force',
      root: join(root, 'worktrees'),
    });
    writeFileSync(join(layout.workspacePath, 'untracked.txt'), 'x\n');
    expect(() =>
      removeWorktree({
        projectRoot: project,
        worktreeRoot: layout.worktreeRoot,
        branchName: layout.branchName,
        deleteBranch: true,
      }),
    ).toThrowError(WorktreeError);
    removeWorktree({
      projectRoot: project,
      worktreeRoot: layout.worktreeRoot,
      branchName: layout.branchName,
      deleteBranch: true,
      force: true,
    });
    expect(existsSync(layout.worktreeRoot)).toBe(false);
  });

  it('allocates one in-place Task and a second Task to a worktree', () => {
    const { root, project } = repo();
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    stores.push(store);
    store.createProject({ id: 'p-1', realPath: project });
    store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd: project });
    store.createSession({ id: 'c-2', projectId: 'p-1', roleId: 'chief', cwd: project });
    const markdown = '# Plan\n\n## 验收\n- observable\n';
    const base = {
      store,
      projectId: 'p-1',
      cwd: project,
      serverWorkDir: join(root, 'server-work'),
      worktreeRoot: join(root, 'worktrees'),
      type: 'write' as const,
      workKind: 'document' as const,
      requiresTest: false,
      goal: 'workspace allocation',
      scope: 'docs',
      acceptanceRefs: [],
      basisRefs: [],
      backlogIds: [],
      authorizationRefs: [],
      planMarkdown: markdown,
      explicitIsolation: false,
    };
    const first = createTaskWithWorkspace({ ...base, chiefSessionId: 'c-1', inputId: 'i-1' });
    const second = createTaskWithWorkspace({ ...base, chiefSessionId: 'c-2', inputId: 'i-2' });

    expect(first.task.workspaceState).toBe('in_place');
    expect(second.task.workspaceState).toBe('active');
    expect(second.task.worktreeRoot).not.toBeNull();
    expect(second.task.workspacePath).not.toBeNull();
    expect(existsSync(second.target.path)).toBe(true);
    rmSync(join(second.task.workspacePath as string, '.dev'), { recursive: true, force: true });
    expect(second.task.branchName).toMatch(/^kaiming\//);

    removeWorktree({
      projectRoot: project,
      worktreeRoot: second.task.worktreeRoot as string,
      branchName: second.task.branchName as string,
      deleteBranch: true,
    });
  });


  it('cleans up a provisioning failure without a zombie Task', () => {
    const { root, project } = repo();
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    stores.push(store);
    store.createProject({ id: 'p-1', realPath: project });
    store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd: project });
    const original = store.registerFileSave.bind(store);
    store.registerFileSave = () => {
      throw new Error('injected save failure');
    };
    try {
      expect(() =>
        createTaskWithWorkspace({
          store,
          projectId: 'p-1',
          chiefSessionId: 'c-1',
          inputId: 'i-1',
          cwd: project,
          serverWorkDir: join(root, 'server-work'),
          worktreeRoot: join(root, 'worktrees'),
          type: 'write',
          workKind: 'document',
          requiresTest: false,
          goal: 'fail provisioning',
          scope: 'docs',
          acceptanceRefs: [],
          basisRefs: [],
          backlogIds: [],
          authorizationRefs: [],
          planMarkdown: '# Plan\n\n## 验收\n- observable\n',
          explicitIsolation: true,
        }),
      ).toThrow();
    } finally {
      store.registerFileSave = original;
    }
    expect(store.listTasks('p-1')).toHaveLength(0);
    expect(store.getSession('c-1')?.currentTaskId).toBeNull();
    expect(git(project, 'branch', '--list', 'kaiming/*')).toBe('');
    expect(existsSync(join(root, 'worktrees', 'p-1'))).toBe(true);
    expect(readdirSync(join(root, 'worktrees', 'p-1'))).toEqual([]);
  });
  it('lands a completed worktree Task through task end', async () => {
    const { root, project } = repo();
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    stores.push(store);
    store.createProject({ id: 'p-1', realPath: project });
    store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd: project });
    const created = createTaskWithWorkspace({
      store,
      projectId: 'p-1',
      chiefSessionId: 'c-1',
      inputId: 'i-1',
      cwd: project,
      serverWorkDir: join(root, 'server-work'),
      worktreeRoot: join(root, 'worktrees'),
      type: 'write',
      workKind: 'document',
      requiresTest: false,
      goal: 'document the change',
      scope: 'docs',
      acceptanceRefs: [],
      basisRefs: [],
      backlogIds: [],
      authorizationRefs: [],
      planMarkdown: '# Plan\n\n## 验收\n- observable\n',
      explicitIsolation: true,
    });
    const workspace = created.task.workspacePath as string;
    git(workspace, 'add', '--all');
    git(workspace, 'commit', '--quiet', '-m', 'worktree delivery');
    const delivery = snapshotDelivery(workspace);
    const body = { storage: 'server' as const, path: join(root, 'body.md'), sha256: 'x' };
    store.updateTask({ taskId: created.task.id, phase: 'review' });
    store.createTaskSessions({
      taskId: created.task.id,
      members: [{
        sessionId: 'm-review',
        taskId: created.task.id,
        roleId: 'reviewer',
        phase: 'review',
        label: 'review',
        instructions: 'review it',
        refs: [],
        dependencies: [],
        expectedKind: 'review',
        inputId: 'i-review',
        inputPayload: { content: [{ type: 'text', text: 'review it' }] },
      }],
    });
    const reviewClaim = store.claimNextInput('m-review');
    if (reviewClaim.kind !== 'claimed') throw new Error('review input was not claimed');
    const reviewInput = store.getInput('i-review');
    if (reviewInput === undefined) throw new Error('review input missing');
    store.finishInput({ inputId: 'i-review', expectedRevision: reviewInput.revision, status: 'completed' });
    store.recordResult({
      resultId: 'r-review',
      taskId: created.task.id,
      sessionId: 'm-review',
      inputId: 'i-review',
      roleId: 'reviewer',
      kind: 'review',
      summary: 'pass',
      verdict: 'passed',
      deliveryState: delivery,
      bodyRef: body,
      basisRefs: [],
      checks: [],
    });
    store.updateTask({ taskId: created.task.id, phase: 'settle' });
    store.createTaskSessions({
      taskId: created.task.id,
      members: [{
        sessionId: 'm-settle',
        taskId: created.task.id,
        roleId: 'settler',
        phase: 'settle',
        label: 'settle',
        instructions: 'settle it',
        refs: [],
        dependencies: [],
        expectedKind: 'settlement',
        inputId: 'i-settle',
        inputPayload: { content: [{ type: 'text', text: 'settle it' }] },
      }],
    });
    const settleClaim = store.claimNextInput('m-settle');
    if (settleClaim.kind !== 'claimed') throw new Error('settle input was not claimed');
    const settleInput = store.getInput('i-settle');
    if (settleInput === undefined) throw new Error('settle input missing');
    store.finishInput({ inputId: 'i-settle', expectedRevision: settleInput.revision, status: 'completed' });
    store.recordResult({
      resultId: 'r-settle',
      taskId: created.task.id,
      sessionId: 'm-settle',
      inputId: 'i-settle',
      roleId: 'settler',
      kind: 'settlement',
      summary: 'settled',
      bodyRef: body,
      basisRefs: [],
      checks: [],
    });
    const tool = createTaskTool(
      () => ({
        store,
        sessionId: 'c-1',
        projectId: 'p-1',
        cwd: project,
        roleId: 'chief',
        inputId: 'i-1',
        serverWorkDir: join(root, 'server-work'),
      }),
      { chief: true },
    );
    const ended = await tool.execute('c-end', {
      op: 'end',
      taskId: created.task.id,
      completionResultId: 'r-settle',
    });
    expect(ended.isError).toBe(false);
    expect(store.getTask(created.task.id)?.workspaceState).toBe('merged');
    expect(store.getTask(created.task.id)?.status).toBe('completed');
    expect(existsSync(join(project, '.dev', 'work', created.task.id, 'plan.md'))).toBe(true);
    const completed = store.getTask(created.task.id);
    if (completed === undefined || completed.planRef === null) throw new Error('completed Task missing plan');
    expect(readArtifact(store, completed, completed.planRef).current).toBe(true);
    expect(existsSync(created.task.worktreeRoot as string)).toBe(false);
  });
});
