/**
 * Overall Plan persistence (P3): the one file a Task's work is organized around.
 *
 * Ordering (S6, and the reason a losing writer must not touch the file): the intended version is
 * computed first (path + digest), the store's version-checked update is applied second, and only then
 * is the file written atomically, read back and registered. A call that fails its revision check
 * therefore never replaces another writer's Plan, and a file write that fails after the store update
 * is reported as pending rather than silently claiming success.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StoreError, type ArtifactRef, type Store, type TaskType } from '../store/store.ts';

export interface PlanTarget {
  readonly storage: 'project' | 'server';
  readonly path: string;
}

/**
 * Where a Task's Plan lives: read Tasks keep it in the host's own work area, write Tasks in the project
 * (`.dev/work/<taskId>/plan.md`) so the plan travels with the project.
 */
export function planTarget(params: {
  taskId: string;
  type: TaskType;
  projectCwd: string;
  serverWorkDir: string;
}): PlanTarget {
  return params.type === 'write'
    ? { storage: 'project', path: join(params.projectCwd, '.dev', 'work', params.taskId, 'plan.md') }
    : { storage: 'server', path: join(params.serverWorkDir, params.taskId, 'plan.md') };
}

export function digestOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The version a Plan write *would* produce: computed before anything is written. */
export function planRefFor(target: PlanTarget, markdown: string): ArtifactRef {
  return { storage: target.storage, path: target.path, sha256: digestOfText(markdown) };
}

export interface PlanCommitResult {
  readonly ref: ArtifactRef;
  /** True when the recorded save already described exactly these bytes. */
  readonly reused: boolean;
}

/**
 * Write the Plan, verify it on disk and register the receipt. Retrying the same request key is
 * idempotent, but only when the bytes on disk really are the recorded ones: a foreign edit turns into
 * VERSION_CONFLICT instead of being overwritten (S6).
 */
export function commitPlan(params: {
  store: Store;
  requestKey: string;
  target: PlanTarget;
  markdown: string;
}): PlanCommitResult {
  const ref = planRefFor(params.target, params.markdown);
  const existing = params.store.getFileSave(params.requestKey);
  if (existing !== undefined) {
    const onDisk = readFile(params.target.path);
    const diskHash = onDisk === undefined ? undefined : digestOfText(onDisk);
    if (diskHash === ref.sha256) {
      // Already exactly this version on disk: only re-register so the receipt describes the bytes.
      params.store.registerFileSave({
        requestKey: params.requestKey,
        target: params.target.path,
        contentHash: ref.sha256,
        content: params.markdown,
        state: 'saved',
        receipt: JSON.stringify(ref),
      });
      return { ref, reused: true };
    }
    if (diskHash === existing.contentHash) {
      // The recorded version is still on disk; the caller asks for a different one, which is a change,
      // not a retry: write it (the store CAS already accepted the new version).
      params.store.registerFileSave({
        requestKey: params.requestKey,
        target: params.target.path,
        contentHash: existing.contentHash,
        content: existing.content,
        state: 'saved',
        receipt: existing.receipt ?? JSON.stringify(ref),
      });
    } else {
      throw new StoreError('VERSION_CONFLICT', 'the Plan file on disk is neither the recorded nor the requested version', {
        target: params.target.path,
        recorded: existing.contentHash,
        requested: ref.sha256,
        onDisk: diskHash ?? 'missing',
      });
    }
  }
  mkdirSync(dirname(params.target.path), { recursive: true });
  const temporary = `${params.target.path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, params.markdown, 'utf8');
    renameSync(temporary, params.target.path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  const written = readFile(params.target.path);
  if (written === undefined || digestOfText(written) !== ref.sha256) {
    throw new StoreError('STORAGE_UNAVAILABLE', 'the Plan write could not be verified on disk', {
      target: params.target.path,
    });
  }
  params.store.registerFileSave({
    requestKey: params.requestKey,
    target: params.target.path,
    contentHash: ref.sha256,
    content: params.markdown,
    state: 'saved',
    receipt: JSON.stringify(ref),
  });
  return { ref, reused: false };
}

/** Read a Plan back for task.get, reporting a missing or changed file instead of guessing. */
export function readPlan(ref: ArtifactRef): { readonly text: string; readonly current: boolean } {
  const text = readFile(ref.path);
  if (text === undefined) {
    return { text: '', current: false };
  }
  return { text, current: digestOfText(text) === ref.sha256 };
}

function readFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}