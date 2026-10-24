/**
 * The git fact of completion: is the delivery the last passed review covered actually committed?
 *
 * The paths come from the review row, which the program observed when the review was recorded - not
 * from an argument a model passed. Only write Tasks with a passed review have an answer; everything
 * else returns no gaps, so read Tasks and no-git projects keep the behaviour they had.
 */
import type { Store, TaskRow } from '../store/store.ts';
import { commitGaps, observeCommit } from '../runtime/git-delivery.ts';

export function deliveryCommitGaps(store: Store, task: TaskRow): string[] {
  if (task.type !== 'write') return [];
  // The latest passed review is the evidence of what was delivered; its paths are what must be
  // committed. A review recorded before delivery binding existed has no paths and cannot be checked.
  const review = store
    .listTaskResults(task.id)
    .filter((entry) => entry.kind === 'review' && entry.verdict === 'passed')
    .at(-1);
  const paths = review?.deliveryState?.paths ?? [];
  if (paths.length === 0) return [];
  const cwd = store.getSession(task.chiefSessionId)?.cwd;
  if (cwd === undefined) {
    // Unreachable through today's store (a session always has a cwd), but silence here would be the
    // same "cannot verify, so pass" that the rest of this gate refuses.
    return ['the project directory of this Task is unknown, so its delivery could not be checked against git; end again once the directory is known'];
  }
  return [...commitGaps(observeCommit(cwd, paths))];
}
