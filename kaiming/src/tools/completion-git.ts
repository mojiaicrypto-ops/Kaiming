/**
 * The git fact of completion: is the delivery the last passed review covered actually committed?
 *
 * The paths come from the review row, which the program observed when the review was recorded - not
 * from an argument a model passed. Only write Tasks with a passed review have an answer; everything
 * else returns no gaps, so read Tasks and no-git projects keep the behaviour they had.
 */
import type { Store, TaskRow } from '../store/store.ts';
import { commitGaps, ignoredProjectPaths, observeCommit } from '../runtime/git-delivery.ts';
import { changedInheritedPaths, isCodeDeliveryPath, isUnchangedBaselineDirty } from '../runtime/deliverable.ts';
import { knowledgeEntryPaths } from '../runtime/project-store.ts';

export function deliveryCommitGaps(store: Store, task: TaskRow): string[] {
  if (task.type !== 'write') return [];
  // The latest passed review is the evidence of what was delivered; its paths are what must be
  // committed. A review recorded before delivery binding existed has no paths and cannot be checked.
  const review = store
    .listTaskResults(task.id)
    .filter((entry) => entry.kind === 'review' && entry.verdict === 'passed')
    .at(-1);
  const reviewed = review?.deliveryState?.paths ?? [];
  if (reviewed.length === 0) return [];
  let cwd: string;
  try {
    cwd = store.resolveTaskCwd(task);
  } catch {
    // Unreachable through today's store (a session always has a cwd), but silence here would be the
    // same "cannot verify, so pass" that the rest of this gate refuses.
    return ['the project directory of this Task is unknown, so its delivery could not be checked against git; end again once the directory is known'];
  }
  // A review recorded before ignored files were filtered may still list build outputs or the user's
  // own excluded files. They are not delivery: no commit can carry them, so check only the rest.
  const observation = ignoredProjectPaths(cwd, reviewed);
  if (observation.detail !== undefined) {
    return [
      `the reviewed delivery's ignored paths could not be checked (${observation.detail}); restore git, then end again`,
    ];
  }
  const committed = observation.ignored.size === 0 ? reviewed : reviewed.filter((path) => !observation.ignored.has(path));
  // A file that was already dirty when the Task was created and whose bytes did not change is the
  // user's own work: never a reason to refuse completion (P1-1). This also covers a review row
  // recorded before the baseline existed.
  const reviewedPaths = committed.filter((path) => !isUnchangedBaselineDirty(cwd, path, task.dirtyBaseline));
  // An inherited file that changed after the review was never in the reviewed list; it is this
  // Task's delivery now, so its commit state is checked as well (only where a review could bind it).
  const changedInherited = changedInheritedPaths(cwd, task.dirtyBaseline, reviewed, {
    design: task.workKind === 'design' && task.flowVersion >= 1,
    codeBound: reviewed.some((path) => isCodeDeliveryPath(path)),
    excluded: new Set(knowledgeEntryPaths(store.getProject(task.projectId)?.initializationRef)),
  });
  return [...commitGaps(observeCommit(cwd, [...reviewedPaths, ...changedInherited]))];
}
