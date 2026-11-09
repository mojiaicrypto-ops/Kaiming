/**
 * Completion facts for a main design Task (D-09): the review covered the design artifacts, the
 * original item was closed, and every slice the design produced is open with a spec reference.
 * These are observable facts, not a quality judgment; Review and the user still decide the content.
 */
import type { Store, TaskRow } from '../store/store.ts';
import { readBacklog } from './backlog-store.ts';
import { snapshotDesignDelivery } from './deliverable.ts';
import { join } from 'node:path';
import { knowledgeEntryPaths } from './project-store.ts';

export function designCompletionGaps(store: Store, cwd: string, task: TaskRow): string[] {
  if (task.workKind !== 'design' || task.flowVersion < 1) return [];
  const gaps: string[] = [];
  const review = store
    .listTaskResults(task.id)
    .filter((result) => result.kind === 'review' && result.verdict === 'passed')
    .at(-1);
  const reviewed = review?.deliveryState ?? null;
  if (reviewed === null || reviewed.paths.length === 0) {
    gaps.push('the design review covered no design artifacts; review the specs/module map before settlement');
  } else {
    const project = store.getProject(task.projectId);
    const knowledge = knowledgeEntryPaths(project?.initializationRef).map((path) => join(cwd, path));
    const current = snapshotDesignDelivery(cwd, knowledge);
    if (current.digest !== reviewed.digest) {
      gaps.push(`the design artifacts changed after the last passed review (${review?.resultId ?? 'review'}); review them again`);
    }
  }

  const read = readBacklog(cwd);
  for (const id of task.backlogIds) {
    const item = read.items.find((entry) => entry.id === id);
    if (item === undefined) {
      gaps.push(`the original backlog item ${id} does not exist`);
      continue;
    }
    if (read.issues.some((issue) => issue.id === id)) {
      gaps.push(`the original backlog item ${id} needs repair`);
    } else if (item.state !== 'done') {
      gaps.push(`the original backlog item ${id} is ${item.state}; close it as done after recording the split`);
    }
  }

  for (const slice of read.items.filter((entry) => entry.taskIds.includes(task.id) && entry.state === 'open')) {
    if (slice.specRefs.length === 0) {
      gaps.push(`slice ${slice.id} has no spec reference; a ready slice must point at its spec`);
    }
  }
  return gaps;
}
