/**
 * The stream preparation method (M4): `session.stream.prepare` opens a subscription *before* the
 * snapshot is read, then hands the browser one consistent picture - where the live stream starts
 * (boundary + epoch) and what is already true at that moment.
 */
import { RpcError, type RpcRouter } from './rpc.ts';
import { tailHistory, readPiHistory, type HistoryRecord } from './history.ts';
import { liveHistoryRead } from './live-snapshot.ts';
import type { SessionEventHub } from './hub.ts';
import type { Store } from '../store/store.ts';
import { recordedConfigOf, summarizeRecordedConfig } from '../runtime/recorded-config.ts';

const SNAPSHOT_MESSAGES = 100;

export interface StreamMethodsOptions {
  readonly store: Store;
  readonly hub: SessionEventHub;
  /** serverEpoch and the current Pi instance generation, as a single epoch string. */
  readonly epochOf: (sessionId: string) => string;
  /**
   * Reads a session's CURRENT history: a live Pi instance projects its in-memory entries (the
   * history file lags the stream — an in-flight message only lands on disk when it completes),
   * and a finished session falls back to its file. Without this the prepare snapshot cannot
   * describe what is on screen and a resync made the live message vanish.
   */
  /** Why the session cannot run right now, if it cannot: a snapshot must not lose a block. */
  readonly blockedOf?: (sessionId: string) => { code: string; detail: string } | null;
  readonly currentHistory?: (sessionId: string) => {
    records: readonly HistoryRecord[];
    problems?: readonly string[];
  } | undefined;
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
      // Live instance first (in-flight entries visible); file fallback for idle sessions.
      // Both shapes reduce to records + problems; the live read is problem-free by construction.
      const live = options.currentHistory?.(sessionId);
      const history = live !== undefined
        ? live
        : readPiHistory(binding?.piFile);
      const problems: readonly string[] = history.problems ?? [];
      const messages = tailHistory({ records: history.records }, SNAPSHOT_MESSAGES);
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
          // What this session is running with, from the claim's own record: while a run is live
          // that is the running configuration, and after it ends it is what the last run really
          // used — which is how a reader notices that the settings no longer match the work.
          config: summarizeRecordedConfig(recordedConfigOf(inputs)),
          // A blocked run is state, not an event: a reader who connects after it happened still
          // has to see why nothing is running.
          blocked: options.blockedOf?.(sessionId) ?? null,
          // Pending interactions are part of the boundary copy (M5): a reconnecting page sees the
          // open questions again instead of losing them.
          interactions: (session.roleId === 'chief'
            ? store.listPendingInteractionsForChief(sessionId)
            : store.listPendingInteractions(sessionId)).map((interaction) => ({
            interactionId: interaction.interactionId,
            method: interaction.method,
            title: interaction.title,
            message: interaction.message,
            options: interaction.options === null ? null : (JSON.parse(interaction.options) as string[]),
            placeholder: interaction.placeholder,
            inputId: interaction.inputId,
            taskId: interaction.taskId,
            // The asking session travels with the request: the chief channel keeps the
            // professional origin visible (M5).
            sourceSessionId: interaction.sessionId,
            revision: interaction.revision,
            createdAt: interaction.createdAt,
          })),
          messages: messages.records.map((record) => ({
            entryId: record.id,
            role: record.role,
            content: record.content,
            inputId: record.inputId,
            // A tool result must keep the identity of the call it answers, in the snapshot too.
            ...(record.toolCallId !== null ? { toolCallId: record.toolCallId } : {}),
            ...(record.toolName !== null ? { toolName: record.toolName } : {}),
            ...(record.isError !== null ? { isError: record.isError } : {}),
          })),
          historyLeaf: branchLeaf(history),
          historyProblems: problems,
        },
      };
    },
  });
}

function activityOf(inputs: readonly { readonly status: string; readonly stopRequestKey?: string | null }[]): string {
  if (inputs.some((input) => input.status === 'processing')) {
    // A stop was requested but the run has not settled: the same word session.get uses.
    return inputs.some((input) => input.status === 'processing' && (input.stopRequestKey ?? null) !== null)
      ? 'stopping'
      : 'processing';
  }
  if (inputs.some((input) => input.status === 'queued')) {
    return 'queued';
  }
  return 'idle';
}

function branchLeaf(history: { records: readonly HistoryRecord[] }): string | null {
  const last = history.records[history.records.length - 1];
  return last?.id ?? null;
}
