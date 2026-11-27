/**
 * P3-2 Task-level Git worktrees. The host owns the filesystem/Git operations; tools work in the
 * returned workspace directory. Nothing here trusts a model-supplied path.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class WorktreeError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
    this.details = details;
  }
}

export interface WorktreeLayout {
  readonly projectRoot: string;
  readonly repoRoot: string;
  readonly relativeProjectPath: string;
  readonly worktreeRoot: string;
  readonly workspacePath: string;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly baseCommit: string;
}

export interface CreateWorktreeParams {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly root?: string;
  /** Host data/credential directories a worktree must never be placed inside. */
  readonly privateDirs?: readonly string[];
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export function defaultWorktreeRoot(value = process.env['KAIMING_WORKTREE_ROOT']): string {
  const candidate = value ?? join(homedir(), '.kaiming-worktrees');
  if (!isAbsolute(candidate)) {
    throw new WorktreeError('INVALID_ARGUMENT', 'the worktree root must be absolute', { root: candidate });
  }
  return resolve(candidate);
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  }).trim();
}

function canonical(path: string): string {
  let current = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    suffix.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  try {
    return join(realpathSync(current), ...suffix);
  } catch {
    return resolve(path);
  }
}
function within(path: string, root: string): boolean {
  const base = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(base);
}

function safeSegment(value: string, label: string): string {
  if (!SAFE_ID.test(value) || value === '.' || value === '..') {
    throw new WorktreeError('INVALID_ARGUMENT', `${label} is not a safe path segment`, { [label]: value });
  }
  return value;
}

/** Validate a target before any git/filesystem mutation. */
export function validateWorktreeTarget(params: {
  readonly target: string;
  readonly projectRoot: string;
  readonly repoRoot: string;
  readonly privateDirs?: readonly string[];
}): string {
  const target = canonical(params.target);
  const project = canonical(params.projectRoot);
  const repo = canonical(params.repoRoot);
  const denied = [
    project,
    join(repo, '.git'),
    ...(params.privateDirs ?? []).map(canonical),
  ];
  for (const path of denied) {
    if (within(target, path)) {
      throw new WorktreeError('WORKSPACE_UNSUPPORTED', 'the worktree target is inside a protected path', {
        target,
        protectedPath: path,
      });
    }
  }
  return target;
}

export function createWorktree(params: CreateWorktreeParams): WorktreeLayout {
  const projectRoot = canonical(params.projectRoot);
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new WorktreeError('WORKSPACE_UNSUPPORTED', 'the project directory is not available', { projectRoot });
  }
  let repoRoot: string;
  let baseCommit: string;
  let baseBranch = '';
  try {
    repoRoot = canonical(git(projectRoot, ['rev-parse', '--show-toplevel']));
    baseCommit = git(projectRoot, ['rev-parse', 'HEAD']);
    baseBranch = git(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  } catch (error) {
    throw new WorktreeError('WORKSPACE_UNSUPPORTED', 'the project is not a Git repository with a commit', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const suppliedRoot = params.root ?? defaultWorktreeRoot();
  if (!isAbsolute(suppliedRoot)) {
    throw new WorktreeError('INVALID_ARGUMENT', 'the worktree root must be absolute', { root: suppliedRoot });
  }
  const root = resolve(suppliedRoot);
  const projectId = safeSegment(params.projectId, 'projectId');
  const taskId = safeSegment(params.taskId, 'taskId');
  const target = validateWorktreeTarget({
    target: join(root, projectId, taskId),
    projectRoot,
    repoRoot,
    ...(params.privateDirs !== undefined ? { privateDirs: params.privateDirs } : {}),
  });
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  if (existsSync(target)) {
    throw new WorktreeError('WORKSPACE_UNSUPPORTED', 'the worktree target already exists', { target });
  }
  const branchName = `kaiming/${taskId}`;
  try {
    git(projectRoot, ['worktree', 'add', '-b', branchName, target, baseCommit]);
  } catch (error) {
    throw new WorktreeError('WORKSPACE_UNSUPPORTED', 'the worktree could not be created', {
      target,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const rel = relative(repoRoot, projectRoot);
  const relativeProjectPath = rel === '' ? '.' : rel;
  const workspacePath = relativeProjectPath === '.' ? target : join(target, relativeProjectPath);
  return {
    projectRoot,
    repoRoot,
    relativeProjectPath,
    worktreeRoot: target,
    workspacePath,
    branchName,
    baseBranch,
    baseCommit,
  };
}

export function removeWorktree(params: {
  readonly projectRoot: string;
  readonly worktreeRoot: string;
  readonly branchName: string;
  readonly deleteBranch?: boolean;
  readonly force?: boolean;
}): void {
  const projectRoot = canonical(params.projectRoot);
  try {
    git(projectRoot, ['worktree', 'remove', ...(params.force === true ? ['--force'] : []), params.worktreeRoot]);
  } catch (error) {
    throw new WorktreeError('WORKSPACE_REMOVE_FAILED', 'the worktree could not be removed', {
      target: params.worktreeRoot,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (params.deleteBranch === true) {
    try {
      git(projectRoot, ['branch', '-D', params.branchName]);
    } catch (error) {
      throw new WorktreeError('WORKSPACE_REMOVE_FAILED', 'the worktree branch could not be removed', {
        branch: params.branchName,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export type LandingOutcome = { readonly outcome: 'merged' | 'branch_kept'; readonly detail: string };

/**
 * Honest landing check. ff-only is the only automatic merge: the reviewed tree is byte-identical
 * to the main tree. A moved or dirty main checkout keeps the branch for the user; never rebase.
 */
export function landWorktree(params: {
  readonly projectRoot: string;
  readonly worktreeRoot: string;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly baseCommit: string;
}): LandingOutcome {
  const projectRoot = canonical(params.projectRoot);
  const head = git(projectRoot, ['rev-parse', 'HEAD']);
  const dirty = git(projectRoot, ['status', '--porcelain']);
  let currentBranch = '';
  try {
    currentBranch = git(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  } catch {
    return { outcome: 'branch_kept', detail: 'the main checkout is detached' };
  }
  if (currentBranch !== params.baseBranch) {
    return { outcome: 'branch_kept', detail: 'the main checkout switched branches' };
  }
  if (head !== params.baseCommit) {
    return { outcome: 'branch_kept', detail: 'main moved after the worktree was created' };
  }
  if (dirty !== '') {
    return { outcome: 'branch_kept', detail: 'the main checkout has uncommitted changes' };
  }
  try {
    git(projectRoot, ['merge', '--ff-only', params.branchName]);
  } catch (error) {
    throw new WorktreeError('COMPLETION_INCOMPLETE', 'the reviewed branch could not fast-forward main', {
      branch: params.branchName,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return { outcome: 'merged', detail: 'main fast-forwarded to the reviewed branch' };
}

/** Read a committed project file from a retained branch; used by the branch_kept fallback. */
export function gitShowFile(params: {
  readonly projectRoot: string;
  readonly branchName: string;
  readonly repoRelativePath: string;
}): string | undefined {
  try {
    return execFileSync(
      'git',
      ['-C', canonical(params.projectRoot), 'show', `${params.branchName}:${params.repoRelativePath}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    );
  } catch {
    return undefined;
  }
}
