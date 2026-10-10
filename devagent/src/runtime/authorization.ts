/**
 * Decision references (G2/S6): a Task or a requirement save cites the real user decision it acts on.
 *
 * The program checks the subject (this project), the source (really a user input, or an interaction the
 * user answered in the browser) and its state - it never interprets what the user meant. A declined or
 * cancelled answer is not a decision, so it is refused rather than silently accepted.
 */
import type { Store, InteractionRow } from '../store/store.ts';

/**
 * The decision a resolved interaction carries: a confirmation must be an explicit yes; a choice or an
 * answer must carry the user's own value. Cancelled or declined answers yield nothing.
 */
function interactionDecision(interaction: InteractionRow): string | undefined {
  if (interaction.response === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(interaction.response);
  } catch {
    return undefined;
  }
  if (typeof parsed === 'object' && parsed !== null && (parsed as { cancelled?: unknown }).cancelled === true) {
    return undefined;
  }
  if (interaction.method === 'confirm') {
    const confirmed =
      typeof parsed === 'boolean' ? parsed : (parsed as { confirmed?: unknown } | null)?.confirmed;
    return confirmed === true ? 'confirmed' : undefined;
  }
  if (typeof parsed === 'string') {
    return parsed === '' ? undefined : parsed;
  }
  const value = (parsed as { value?: unknown } | null)?.value;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

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
      if (input.kind !== 'user') {
        // A decision is a real user input: a delegated instruction is the chief's, not the user's.
        return { ok: false, message: `input ${inputId} is a ${input.kind} input, not a user decision` };
      }
      if (input.status === 'failed' || input.status === 'interrupted') {
        return { ok: false, message: `input ${inputId} is ${input.status}, not a usable decision` };
      }
      refs.push(`input:${inputId}`);
      continue;
    }
    if (typeof interactionId === 'string') {
      // A question the user answered in the browser is as real a decision as a submitted input: the
      // interaction store holds its state and the answer's own shape, and both are checked here.
      const interaction = store.getInteraction(interactionId);
      if (interaction === undefined || interaction.projectId !== projectId) {
        return { ok: false, message: `no interaction ${interactionId} in this project` };
      }
      if (interaction.state !== 'resolved') {
        return { ok: false, message: `interaction ${interactionId} is ${interaction.state}, not a decision` };
      }
      if (interactionDecision(interaction) === undefined) {
        return { ok: false, message: `interaction ${interactionId} carries no positive decision` };
      }
      refs.push(`interaction:${interactionId}`);
      continue;
    }
    return { ok: false, message: 'authorizationRef must be {inputId} or {interactionId}' };
  }
  return { ok: true, refs };
}
