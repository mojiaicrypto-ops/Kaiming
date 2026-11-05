/**
 * Task state belongs to one session. A refresh, poll, or stream callback from the previous session
 * must never paint the new one; ownership is kept beside the detail so a render can reject it before
 * the next effect runs.
 */
export function taskForSession<T>(
  value: T | null,
  taskSessionId: string | null,
  sessionId: string | null,
): T | null {
  return taskSessionId !== null && taskSessionId === sessionId ? value : null;
}
