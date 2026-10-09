/**
 * The stream preparation method (M4): `session.stream.prepare` opens a subscription *before* the
 * snapshot is read, then hands the browser one consistent picture - where the live stream starts
 * (boundary + epoch) and what is already true at that moment.
 */
import { RpcError, type RpcRouter } from './rpc.ts';
import { pageHistory, readPiHistory } from './history.ts';
import type { SessionEventHub } from './hub.ts';
import type { Store } from '../store/store.ts';

const SNAPSHOT_MESSAGES = 100;

export interface StreamMethodsOptions {
  readonly store: Store;
  readonly hub: SessionEventHub;
  /** serverEpoch and the current Pi instance generation, as a single epoch string. */
  readonly epochOf: (sessionId: string) => string;
}

export function registerStreamMethods(router: RpcRouter, options: StreamMethodsOptions): void {
  const { store, hub } = options;

  router.register('session.stream.prepare', {
    write: false,
    run: (params, context): unknown => {
      const projectId = typeof params['projectId'] === 'string' ? params['projectId'] : undefined;
      const sessionId = typeof params['sessionId'] === 'string' ? params['sessionId'] : undefined;
      if (projectId === undefined || sessionId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'projectId and sessionId are required');
      }
      const session = store.getSession(sessionId);
      if (session === undefined || session.projectId !== projectId) {
        throw new RpcError('NOT_FOUND', `session ${sessionId} does not exist in this project`, { sessionId });
      }
      // 1. Start buffering first: nothing published after this point can be missed.
      const subscription = hub.prepare({ sessionId, actor: context.actor, epoch: options.epochOf(sessionId) });

      // 2. Then read one in-memory boundary: inputs, the running Task, resources and the history leaf.
      const inputs = store.listInputs(sessionId);
      const task = session.currentTaskId === null ? undefined : store.getTask(session.currentTaskId);
      const binding = store.getSessionBinding(sessionId);
      const history = readPiHistory(binding?.piFile);
      const messages = pageHistory(history, undefined, SNAPSHOT_MESSAGES);
      const sessionRow = store.getSession(sessionId);

      return {
        subscriptionId: subscription.subscriptionId,
        // The stream URL carries the subscription, never a credential (R1).
        streamPath: `/api/v1/sessions/${sessionId}/stream?subscriptionId=${subscription.subscriptionId}`,
        epoch: subscription.epoch,
        boundary: subscription.boundary,
        snapshot: {
          sessionId,
          projectId,
          roleId: sessionRow?.roleId ?? 'chief',
          activity: activityOf(inputs),
          currentInputId: inputs.find((input) => input.status === 'processing')?.inputId ?? null,
          inputs: inputs.slice(-20).map((input) => ({
            inputId: input.inputId,
            kind: input.kind,
            status: input.status,
            revision: input.revision,
            errorCode: input.errorCode,
          })),
          task:
            task === undefined
              ? null
              : { taskId: task.id, type: task.type, phase: task.phase, status: task.status, revision: task.revision },
          // Pending interactions are part of the boundary copy (M5): a reconnecting page sees the
          // open questions again instead of losing them.
          interactions: store.listPendingInteractions(sessionId).map((interaction) => ({
            interactionId: interaction.interactionId,
            method: interaction.method,
            title: interaction.title,
            message: interaction.message,
            options: interaction.options === null ? null : (JSON.parse(interaction.options) as string[]),
            placeholder: interaction.placeholder,
            inputId: interaction.inputId,
            taskId: interaction.taskId,
            revision: interaction.revision,
            createdAt: interaction.createdAt,
          })),
          messages: messages.records.map((record) => ({
            entryId: record.id,
            role: record.role,
            content: record.content,
            inputId: record.inputId,
          })),
          historyLeaf: branchLeaf(history),
          historyProblems: history.problems,
        },
      };
    },
  });
}

function activityOf(inputs: readonly { readonly status: string }[]): string {
  if (inputs.some((input) => input.status === 'processing')) {
    return 'processing';
  }
  if (inputs.some((input) => input.status === 'queued')) {
    return 'queued';
  }
  return 'idle';
}

function branchLeaf(history: ReturnType<typeof readPiHistory>): string | null {
  const last = history.records[history.records.length - 1];
  return last?.id ?? null;
}
