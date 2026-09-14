/**
 * Message lifecycle around a Run (`docs/product/experience.md` §22).
 *
 * The experience document requires a user message to move `received → processing →
 * processed/failed`: the composer's state is not decoration, it is what tells the operator
 * whether the system picked the message up and whether it finished. `WP-12` Q4 puts the
 * transition here rather than in the message command, because only the supervisor knows when
 * a Run was really claimed and when it reached its terminal state.
 *
 * Only a **Chief** Run moves its message: a professional Run shares its Work but not the
 * user's turn, so it must never rewrite the state of the message that started the work.
 */
import type { Message, RunStatus } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';

/** The message one Run's Work came from, when there is one. */
function sourceMessage(store: ProjectStore, runId: string): Message | undefined {
  const run = store.runs.find(runId);
  if (run === undefined || run.role !== 'chief') return undefined;
  const work = store.works.find(run.workId);
  if (work === undefined || work.sourceRef.kind !== 'message') return undefined;
  return store.messages.find(work.sourceRef.id);
}

/**
 * `received → processing` when the Chief Run's Attempt is opened.
 *
 * A message that is already terminal is left alone: a retried Attempt must not move a
 * finished turn backwards.
 */
export function markMessageProcessing(store: ProjectStore, runId: string): void {
  const message = sourceMessage(store, runId);
  if (message === undefined || message.state !== 'received') return;
  store.messages.update(message.id, { state: 'processing' }, message.version);
}

/**
 * `processing → processed/failed` when the Chief Run settles.
 *
 * `protocol.md` §7 names both persistent events; every non-`completed` terminal status is a
 * failure of the turn, including `contract_violation` and `cancelled`.
 */
export function markMessageSettled(store: ProjectStore, runId: string, status: RunStatus): void {
  const message = sourceMessage(store, runId);
  if (message === undefined) return;
  const state: Message['state'] = status === 'completed' ? 'processed' : 'failed';
  // Idempotent: a second report for the same terminal Run must not append a second
  // `message.processed`/`message.failed` row (WP-12 fix round 2, review P3).
  if (message.state === state) return;
  const updated = store.messages.update(message.id, { state }, message.version);
  store.events.append({
    name: state === 'processed' ? 'message.processed' : 'message.failed',
    entityId: updated.id,
    entityVersion: updated.version,
    data: {
      messageId: updated.id,
      runId,
      state,
      outcome: status,
    },
  });
}
