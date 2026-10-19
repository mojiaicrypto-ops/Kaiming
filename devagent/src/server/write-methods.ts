/**
 * The write surface (R1's P4-c methods): accepting a user input, stopping one, and - in this slice -
 * nothing else yet. Handlers only do what the contract says: they verify identity and state, hand the
 * real work to the worker, and report the stored facts.
 */
import { RpcError, type RpcRouter } from './rpc.ts';
import type { InputRow, Store } from '../store/store.ts';

export interface WriteMethodsOptions {
  readonly store: Store;
  /** Wakes the worker so an accepted input actually runs. */
  readonly notify: () => void;
  /** Stops a live run and waits for it to be idle. */
  readonly stopInput: (
    sessionId: string,
    params: { inputId: string; requestKey: string; reason: string },
  ) => Promise<{ readonly status: InputRow['status']; readonly stopRequested: boolean }>;
  /** Business invalidation (M4): the caller's pages re-read the named entity. */
  readonly invalidate?: (sessionId: string, entity: 'input' | 'task' | 'session' | 'interaction', id: string) => void;
  /** Deliver a saved answer to the awaiting Pi call (M5); without a bridge the answer is only stored. */
  readonly resolveInteraction?: (interactionId: string, response: unknown) => boolean;
  /** The same Task control path the chief's own tool uses (pause/resume/cancel + stop flow). */
  readonly controlTask: (params: {
    taskId: string;
    expectedRevision: number;
    command: 'pause' | 'resume' | 'cancel';
  }) => Promise<{ readonly status: string; readonly revision: number; readonly currentSessionIds: readonly string[] }>;
}

export function registerWriteMethods(router: RpcRouter, options: WriteMethodsOptions): void {
  const { store } = options;

  router.register('session.input.submit', {
    write: true,
    run: (params, context): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      if (sessionId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId is required');
      }
      const session = store.getSession(sessionId);
      if (session === undefined || session.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `session ${sessionId} does not exist in this project`, { sessionId });
      }
      if (session.roleId !== 'chief') {
        // User input goes to the chief; a professional session only runs what it was delegated.
        throw new RpcError('FORBIDDEN', `session ${sessionId} is a ${session.roleId} session; user input goes to the chief`, {
          sessionId,
        });
      }
      const content = params['content'];
      if (!Array.isArray(content) || content.length === 0) {
        throw new RpcError('INVALID_ARGUMENT', 'content must be a non-empty array of content blocks');
      }
      const taskId = readString(params, 'taskId');
      if (taskId !== undefined && taskId !== session.currentTaskId) {
        throw new RpcError('INVALID_ARGUMENT', 'the cited Task is not the Task this session is coordinating', {
          cited: taskId,
          currentTaskId: session.currentTaskId,
        });
      }
      if (taskId !== undefined && store.getTask(taskId) === undefined) {
        throw new RpcError('NOT_FOUND', `Task ${taskId} does not exist`, { taskId });
      }
      const inputId = context.requestId;
      if (inputId === '') {
        throw new RpcError('INVALID_ARGUMENT', 'a stable requestId is required');
      }
      const accepted = store.acceptInput({
        inputId,
        projectId: project.id,
        sessionId,
        // Only the running Task's own work is consumable, so an unassociated input waits for it.
        ...(taskId !== undefined ? { taskId } : {}),
        sourceKey: `${sessionId}:${inputId}`,
        requestKey: inputId,
        method: 'session.input.submit',
        kind: 'user',
        payload: { content },
      });
      // The input is stored; the worker is only a hint to run it now.
      options.invalidate?.(sessionId, 'input', accepted.inputId);
      options.notify();
      return {
        inputId: accepted.inputId,
        status: accepted.status,
        revision: accepted.revision,
        ...(taskId === undefined && session.currentTaskId !== null
          ? { waitingForTask: session.currentTaskId }
          : {}),
      };
    },
  });

  router.register('session.input.stop', {
    write: true,
    run: (params, context): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      const inputId = readString(params, 'inputId');
      if (sessionId === undefined || inputId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId and inputId are required');
      }
      const session = store.getSession(sessionId);
      if (session === undefined || session.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `session ${sessionId} does not exist in this project`, { sessionId });
      }
      const input = store.getInput(inputId);
      if (input === undefined || input.sessionId !== sessionId) {
        throw new RpcError('NOT_FOUND', `input ${inputId} does not exist in this session`, { inputId });
      }
      if (input.status === 'processing') {
        // Record the intent, abort the real run and wait until it is idle before reporting.
        const stopped = options.stopInput(sessionId, {
          inputId,
          requestKey: context.requestId === '' ? `stop:${inputId}` : `stop:${context.requestId}`,
          reason: 'user',
        });
        return stopped.then((result) =>
          stopResult(store, sessionId, inputId, result.status, result.stopRequested, options.invalidate),
        );
      }
      if (input.status === 'queued') {
        const result = store.requestStop({
          inputId,
          requestKey: context.requestId === '' ? `stop:${inputId}` : `stop:${context.requestId}`,
          reason: 'user',
        });
        return stopResult(store, sessionId, inputId, result.status, result.stopRequested, options.invalidate);
      }
      // Already settled: stopping is idempotent and reports the current state unchanged.
      return stopResult(store, sessionId, inputId, input.status, false, options.invalidate);
    },
  });

  router.register('task.control', {
    write: true,
    run: async (params): Promise<unknown> => {
      const project = requireProject(store, params);
      const taskId = readString(params, 'taskId');
      const command = params['command'];
      const expectedRevision = params['expectedRevision'];
      if (taskId === undefined || typeof expectedRevision !== 'number') {
        throw new RpcError('INVALID_ARGUMENT', 'taskId and expectedRevision are required');
      }
      if (command !== 'pause' && command !== 'resume' && command !== 'cancel') {
        throw new RpcError('INVALID_ARGUMENT', 'command must be pause, resume or cancel');
      }
      const task = store.getTask(taskId);
      if (task === undefined || task.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `Task ${taskId} does not exist in this project`, { taskId });
      }
      // The stop flow lives in the runner: the final status is written only after the work stopped.
      const controlled = await options.controlTask({ taskId, expectedRevision, command });
      options.invalidate?.(task.chiefSessionId, 'task', taskId);
      options.notify();
      return {
        taskId,
        command,
        status: controlled.status,
        revision: controlled.revision,
        currentSessionIds: controlled.currentSessionIds,
      };
    },
  });

  router.register('session.cleanup', {
    write: true,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      const expectedRevision = params['expectedRevision'];
      if (sessionId === undefined || typeof expectedRevision !== 'number') {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId and expectedRevision are required');
      }
      const session = store.getSession(sessionId);
      if (session === undefined || session.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `session ${sessionId} does not exist in this project`, { sessionId });
      }
      const gaps = store.sessionCleanupGaps(sessionId);
      if (gaps.length > 0) {
        // A referenced or still-working session is never deleted: the reasons are the answer.
        throw new RpcError('WORKSPACE_BUSY', 'the session is still referenced or has unfinished work', { gaps });
      }
      options.invalidate?.(sessionId, 'session', sessionId);
      store.deleteSession({ sessionId, expectedRevision });
      return { sessionId, deleted: true };
    },
  });

  router.register('session.recovery.resolve', {
    write: true,
    run: (params, context): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      const inputId = readString(params, 'inputId');
      const expectedRevision = params['expectedRevision'];
      const resolution = params['resolution'];
      if (sessionId === undefined || inputId === undefined || typeof expectedRevision !== 'number') {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId, inputId and expectedRevision are required');
      }
      if (resolution !== 'completed' && resolution !== 'failed' && resolution !== 'stopped') {
        throw new RpcError('INVALID_ARGUMENT', 'resolution must be completed, failed or stopped');
      }
      const session = store.getSession(sessionId);
      if (session === undefined || session.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `session ${sessionId} does not exist in this project`, { sessionId });
      }
      const evidenceRefs = params['evidenceRefs'];
      // No evidence, no closure: the input stays interrupted and the caller brings real verification.
      if (
        !Array.isArray(evidenceRefs) ||
        evidenceRefs.length === 0 ||
        evidenceRefs.some((entry) => typeof entry !== 'string' || entry.trim() === '')
      ) {
        throw new RpcError('PI_INPUT_UNCONFIRMED', 'resolution needs evidenceRefs describing what was verified', {
          inputId,
        });
      }
      const resolved = store.resolveInterruptedInput({
        sessionId,
        inputId,
        expectedRevision,
        resolution,
        evidenceRefs: evidenceRefs as string[],
        resolvedBy: context.actor,
      });
      // The session may now consume its remaining work.
      options.invalidate?.(sessionId, 'input', inputId);
      options.notify();
      return {
        inputId: resolved.inputId,
        status: resolved.status,
        revision: resolved.revision,
        recovery: resolved.recovery,
      };
    },
  });

  router.register('interaction.respond', {
    write: true,
    run: (params, context): unknown => {
      const project = requireProject(store, params);
      const interactionId = readString(params, 'interactionId');
      const expectedRevision = params['expectedRevision'];
      if (interactionId === undefined || typeof expectedRevision !== 'number') {
        throw new RpcError('INVALID_ARGUMENT', 'interactionId and expectedRevision are required');
      }
      if (!Object.hasOwn(params, 'response')) {
        throw new RpcError('INVALID_ARGUMENT', 'response is required');
      }
      const interaction = store.getInteraction(interactionId);
      if (interaction === undefined || interaction.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `interaction ${interactionId} does not exist in this project`, {
          interactionId,
        });
      }
      const chiefSessionId = readString(params, 'chiefSessionId');
      // A page answers on the channel it watches: the interaction's own session, or the chief
      // of the Task that member question belongs to (M5: members present through the chief).
      const ownerTask = interaction.taskId === null ? undefined : store.getTask(interaction.taskId);
      const ownsIt = chiefSessionId === undefined
        || interaction.sessionId === chiefSessionId
        || ownerTask?.chiefSessionId === chiefSessionId;
      if (!ownsIt) {
        throw new RpcError('FORBIDDEN', 'this interaction belongs to another chief session', {
          interactionId,
          sessionId: interaction.sessionId,
        });
      }
      const saved = store.resolveInteraction({
        interactionId,
        expectedRevision,
        response: params['response'],
        answeredBy: context.actor,
        requestKey: context.requestId === '' ? `answer:${interactionId}` : context.requestId,
      });
      // The answer is durable before it is handed back to the model.
      options.resolveInteraction?.(interactionId, saved.response === null ? null : JSON.parse(saved.response));
      options.invalidate?.(interaction.sessionId, 'interaction', interactionId);
      // A member's question is presented on the chief's channel (M5), so the chief's pending
      // list must learn that it left: otherwise the answered card stays visible there.
      const taskChiefSessionId = interaction.taskId === null
        ? null
        : (store.getTask(interaction.taskId)?.chiefSessionId ?? null);
      if (taskChiefSessionId !== null && taskChiefSessionId !== interaction.sessionId) {
        options.invalidate?.(taskChiefSessionId, 'interaction', interactionId);
      }
      return {
        interactionId,
        state: saved.state,
        revision: saved.revision,
        response: saved.response === null ? null : (JSON.parse(saved.response) as unknown),
      };
    },
  });
}

function stopResult(
  store: Store,
  sessionId: string,
  inputId: string,
  status: InputRow['status'],
  stopRequested: boolean,
  invalidate?: (sessionId: string, entity: 'input' | 'task' | 'session' | 'interaction', id: string) => void,
): Record<string, unknown> {
  const input = store.getInput(inputId);
  const running = store.listInputs(sessionId).some((entry) => entry.status === 'processing');
  invalidate?.(sessionId, 'input', inputId);
  return {
    inputId,
    // The row is the truth: the value from requestStop is the pre-abort status and would contradict
    // an activity that already says the run settled.
    status: input?.status ?? status,
    revision: input?.revision ?? 0,
    stopRequested,
    // Until the run really settles the session is stopping; the client must not assume it stopped.
    activity: running ? 'stopping' : 'idle',
  };
}

function requireProject(store: Store, params: Record<string, unknown>) {
  const projectId = readString(params, 'projectId');
  if (projectId === undefined) {
    throw new RpcError('INVALID_ARGUMENT', 'projectId is required');
  }
  const project = store.getProject(projectId);
  if (project === undefined) {
    throw new RpcError('NOT_FOUND', `project ${projectId} does not exist`, { projectId });
  }
  return project;
}

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
