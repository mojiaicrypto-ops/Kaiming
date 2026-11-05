/**
 * Report body persistence (S6): the body is written and read back before the result row exists, so a
 * registered report always has real bytes behind it.
 *
 * Read-only reports (investigation/recovery) stay in the host work area
 * (`work/<taskId>/<sessionId>/<resultId>.md`), in a read Task and in a write Task alike: they are
 * evidence, not delivered work. Other write Task reports go into the project
 * (`.dev/work/<taskId>/<sessionId>/<resultId>.md`) because the delivered work travels with the project.
 * The API reads them through the Task/result identity, never by exposing host paths.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digestOfText } from './plan-store.ts';
import type { ArtifactRef, TaskType } from '../store/store.ts';

export interface ReportTarget {
  readonly storage: 'project' | 'server';
  readonly path: string;
}

export function reportTarget(params: {
  taskType: TaskType;
  cwd: string;
  serverWorkDir: string;
  taskId: string;
  sessionId: string;
  kind: string;
  resultId: string;
}): ReportTarget {
  // A settlement report is committed before it is registered (D-07), so its path cannot depend on the
  // body digest the writer cannot know: it is one predictable file per settle step. Other reports keep
  // the content-addressed name, so two reports of one member never overwrite each other.
  const name = params.kind === 'settlement' ? 'settlement.md' : `${params.resultId}.md`;
  const relative = join(params.taskId, params.sessionId, name);
  const readOnly = params.kind === 'investigation' || params.kind === 'recovery';
  return params.taskType === 'read' || readOnly
    ? { storage: 'server', path: join(params.serverWorkDir, relative) }
    : { storage: 'project', path: join(params.cwd, '.dev', 'work', relative) };
}

/** The version this report body *would* have: computed before anything is written. */
export function reportRefFor(target: ReportTarget, markdown: string): ArtifactRef {
  return { storage: target.storage, path: target.path, sha256: digestOfText(markdown) };
}

/** Write the body atomically in its final directory; the caller then reads it back to verify it. */
export function writeReportBody(target: ReportTarget, markdown: string): void {
  mkdirSync(dirname(target.path), { recursive: true });
  const temporary = `${target.path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, markdown, 'utf8');
  try {
    renameSync(temporary, target.path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Read a body back, reporting a missing or changed file instead of guessing (S6). */
export function readReportBody(ref: ArtifactRef): { readonly text: string; readonly current: boolean } {
  try {
    const text = readFileSync(ref.path, 'utf8');
    return { text, current: digestOfText(text) === ref.sha256 };
  } catch {
    return { text: '', current: false };
  }
}
