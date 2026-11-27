/**
 * Read a Task artifact after its worktree may have been removed. New project refs carry a
 * project-relative path; the resolver tries the recorded path, then the main checkout, then the
 * retained branch. Old absolute-only refs keep the original direct-read behavior.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ArtifactRef, Store, TaskRow } from '../store/store.ts';
import { digestOfText } from './plan-store.ts';
import { gitShowFile } from './worktree.ts';

export interface ArtifactText {
  readonly text: string;
  readonly current: boolean;
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

export function readArtifact(store: Store, task: TaskRow, ref: ArtifactRef): ArtifactText {
  const direct = read(ref.path);
  if (direct !== undefined) return { text: direct, current: digestOfText(direct) === ref.sha256 };
  if (ref.relativePath === undefined) return { text: '', current: false };

  const project = store.getProject(task.projectId);
  if (project !== undefined) {
    const main = read(join(project.realPath, ref.relativePath));
    if (main !== undefined) return { text: main, current: digestOfText(main) === ref.sha256 };
    if (task.branchName !== null && task.workspaceRelPath !== null) {
      const repoPath =
        task.workspaceRelPath === '.'
          ? ref.relativePath
          : join(task.workspaceRelPath, ref.relativePath);
      const fromBranch = gitShowFile({
        projectRoot: project.realPath,
        branchName: task.branchName,
        repoRelativePath: repoPath.split(sep).join('/'),
      });
      if (fromBranch !== undefined) {
        return { text: fromBranch, current: digestOfText(fromBranch) === ref.sha256 };
      }
    }
  }
  return { text: '', current: false };
}
