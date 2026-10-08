/**
 * Decision references (G2/S6): a Task or a requirement save cites the real user decision it acts on.
 *
 * The program checks the subject (this project), the source (really an input) and its state - it never
 * interprets what the user meant. Interactions arrive with the native question wiring (P4); until there
 * is a real interaction store, citing one is refused instead of silently accepted.
 */
import type { Store } from '../store/store.ts';

export function resolveAuthorizationRefs(
  store: Store,
  projectId: string,
  value: unknown,
): { readonly ok: true; readonly refs: string[] } | { readonly ok: false; readonly message: string } {
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) {
    return { ok: false, message: 'authorizationRef is required' };
  }
  const refs: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, message: 'authorizationRef must be {inputId} or {interactionId}' };
    }
    const record = entry as Record<string, unknown>;
    const inputId = record['inputId'];
    const interactionId = record['interactionId'];
    if (typeof inputId === 'string' && interactionId === undefined) {
      const input = store.getInput(inputId);
      if (input === undefined || input.projectId !== projectId) {
        return { ok: false, message: `no input ${inputId} in this project` };
      }
      if (input.status === 'failed' || input.status === 'interrupted') {
        return { ok: false, message: `input ${inputId} is ${input.status}, not a usable decision` };
      }
      refs.push(`input:${inputId}`);
      continue;
    }
    if (typeof interactionId === 'string') {
      return { ok: false, message: 'interaction decisions are not available yet' };
    }
    return { ok: false, message: 'authorizationRef must be {inputId} or {interactionId}' };
  }
  return { ok: true, refs };
}
