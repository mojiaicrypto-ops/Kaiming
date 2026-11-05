/**
 * The Task's recorded execution window. `createdAt` is when the chief created it; a finished or
 * paused Task stops at its last recorded state, so the number does not keep growing while nothing
 * is moving. A live Task has no end yet.
 */
export interface TaskTimingView {
  readonly status: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function taskEndedAt(task: TaskTimingView): string | null {
  if (task.updatedAt === undefined || task.updatedAt === '') return null;
  return task.status === 'completed' || task.status === 'cancelled' || task.status === 'paused'
    ? task.updatedAt
    : null;
}
