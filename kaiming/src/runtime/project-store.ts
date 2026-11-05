/**
 * Project entry initialization (P3-e, S6/P-02): the fixed knowledge entries a project workspace is
 * usable through.
 *
 * The files are project files written by the host. Each planned file is version-checked against what
 * is really there, written atomically in its own directory, read back, and recorded as a host-owned
 * save so a retry only completes what is still missing. An entry that is already correct is reported
 * as reused instead of being rewritten, and existing content is never silently replaced: the caller
 * must pass the version it read.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface PlannedFile {
  readonly path: string;
  /** null creates the file; otherwise the sha256 the caller read. */
  readonly expectedVersion: string | null;
  readonly content: string;
}

export interface PlannedFileResult {
  readonly path: string;
  readonly outcome: 'created' | 'updated' | 'reused' | 'conflict' | 'failed';
  readonly version: string | null;
  readonly detail?: string;
}

export interface InitializeResult {
  readonly ready: boolean;
  readonly files: readonly PlannedFileResult[];
  readonly missing: readonly string[];
}

export function digestOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A planned path must stay inside the project (K-02 entries are project-relative). */
export function resolveProjectFile(cwd: string, path: string): string | undefined {
  if (path.trim() === '' || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    return undefined;
  }
  const resolved = normalize(join(cwd, path));
  const root = normalize(cwd);
  if (resolved !== root && !resolved.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    return undefined;
  }
  return resolved;
}

/**
 * Write the planned entries. Every file is independent: a conflict or failure leaves the others in
 * place and is reported, so a retry only has to complete the missing ones (S6).
 */
export function initializeProject(params: {
  readonly cwd: string;
  readonly files: readonly PlannedFile[];
  readonly recordSave?: (entry: {
    requestKey: string;
    target: string;
    expectedVersion: string | null;
    contentHash: string;
    content: string;
    state: 'pending' | 'saved' | 'conflict';
    receipt?: string;
  }) => void;
}): InitializeResult {
  const files: PlannedFileResult[] = [];
  const missing: string[] = [];
  for (const planned of params.files) {
    const resolved = resolveProjectFile(params.cwd, planned.path);
    if (resolved === undefined) {
      files.push({ path: planned.path, outcome: 'failed', version: null, detail: 'the path is not project-relative' });
      missing.push(planned.path);
      continue;
    }
    if (planned.content.trim() === '') {
      files.push({ path: planned.path, outcome: 'failed', version: null, detail: 'the content must not be empty' });
      missing.push(planned.path);
      continue;
    }
    const intended = digestOfText(planned.content);
    // Reading the target is part of the per-file work: a directory (or an unreadable file) is one
    // entry's failure, never the whole batch's (S6: report the saved steps and the missing ones).
    let existing: string | undefined;
    try {
      const stats = statSync(resolved);
      if (!stats.isFile()) {
        throw new Error('the entry exists and is not a regular file');
      }
      existing = readFileSync(resolved, 'utf8');
    } catch (error) {
      if (existsSync(resolved)) {
        files.push({
          path: planned.path,
          outcome: 'failed',
          version: null,
          detail: error instanceof Error ? error.message : String(error),
        });
        missing.push(planned.path);
        continue;
      }
      existing = undefined;
    }
    const current = existing === undefined ? null : digestOfText(existing);
    const requestKey = `project-init:${planned.path}`;
    if (existing !== undefined && current === intended) {
      // Already exactly what was planned: nothing to write, and the entry is really there.
      params.recordSave?.({
        requestKey,
        target: resolved,
        expectedVersion: planned.expectedVersion,
        contentHash: intended,
        content: planned.content,
        state: 'saved',
        receipt: current,
      });
      files.push({ path: planned.path, outcome: 'reused', version: current });
      continue;
    }
    if (planned.expectedVersion === null && existing !== undefined) {
      params.recordSave?.({
        requestKey,
        target: resolved,
        expectedVersion: null,
        contentHash: intended,
        content: planned.content,
        state: 'conflict',
        ...(current !== null ? { receipt: current } : {}),
      });
      files.push({
        path: planned.path,
        outcome: 'conflict',
        version: current,
        detail: 'the entry already exists; read it and pass its version to replace it',
      });
      missing.push(planned.path);
      continue;
    }
    if (planned.expectedVersion !== null && current !== planned.expectedVersion) {
      params.recordSave?.({
        requestKey,
        target: resolved,
        expectedVersion: planned.expectedVersion,
        contentHash: intended,
        content: planned.content,
        state: 'conflict',
        ...(current !== null ? { receipt: current } : {}),
      });
      files.push({
        path: planned.path,
        outcome: 'conflict',
        version: current,
        detail: `the entry changed since it was read (expected ${planned.expectedVersion}, found ${current ?? 'nothing'})`,
      });
      missing.push(planned.path);
      continue;
    }
    try {
      mkdirSync(dirname(resolved), { recursive: true });
      const temporary = `${resolved}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(temporary, planned.content, 'utf8');
      try {
        renameSync(temporary, resolved);
      } catch (error) {
        rmSync(temporary, { force: true });
        throw error;
      }
      const saved = readFileSync(resolved, 'utf8');
      if (digestOfText(saved) !== intended) {
        throw new Error('the entry does not read back as written');
      }
      params.recordSave?.({
        requestKey,
        target: resolved,
        expectedVersion: planned.expectedVersion,
        contentHash: intended,
        content: planned.content,
        state: 'saved',
        receipt: intended,
      });
      files.push({ path: planned.path, outcome: existing === undefined ? 'created' : 'updated', version: intended });
    } catch (error) {
      params.recordSave?.({
        requestKey,
        target: resolved,
        expectedVersion: planned.expectedVersion,
        contentHash: intended,
        content: planned.content,
        state: 'pending',
      });
      files.push({
        path: planned.path,
        outcome: 'failed',
        version: current,
        detail: error instanceof Error ? error.message : String(error),
      });
      missing.push(planned.path);
    }
  }
  // `ready` means the entries are really usable, not that the tool ran (P-02).
  for (const entry of params.files) {
    const resolved = resolveProjectFile(params.cwd, entry.path);
    if (resolved === undefined || !existsSync(resolved)) {
      if (!missing.includes(entry.path)) {
        missing.push(entry.path);
      }
      continue;
    }
    try {
      if (!statSync(resolved).isFile()) {
        if (!missing.includes(entry.path)) {
          missing.push(entry.path);
        }
      }
    } catch {
      if (!missing.includes(entry.path)) {
        missing.push(entry.path);
      }
    }
  }
  return { ready: missing.length === 0, files, missing };
}

/** Check the authority a plan claims to reuse: the referenced project files must really be readable. */
export function reusedAuthorityIssues(cwd: string, refs: readonly string[]): string[] {
  const issues: string[] = [];
  for (const ref of refs) {
    const resolved = resolveProjectFile(cwd, ref);
    if (resolved === undefined) {
      issues.push(`${ref} is not a project-relative path`);
      continue;
    }
    try {
      if (!statSync(resolved).isFile()) {
        issues.push(`${ref} is not a file`);
      }
    } catch {
      issues.push(`${ref} does not exist or cannot be read`);
    }
  }
  return issues;
}

/**
 * The knowledge entries a project was initialized with, as project-relative paths. They are the
 * project's memory (written by the settlement after a review), not part of a Task's delivery, so the
 * delivery digest leaves them out.
 */
export function knowledgeEntryPaths(initializationRef: unknown): string[] {
  if (typeof initializationRef !== 'object' || initializationRef === null) {
    return [];
  }
  const files = (initializationRef as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { path?: unknown }).path : undefined))
    .filter((path): path is string => typeof path === 'string' && path.trim() !== '');
}
