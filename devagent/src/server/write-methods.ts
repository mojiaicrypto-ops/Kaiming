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
        return stopped.then((result) => stopResult(store, sessionId, inputId, result.status, result.stopRequested));
      }
      if (input.status === 'queued') {
        const result = store.requestStop({
          inputId,
          requestKey: context.requestId === '' ? `stop:${inputId}` : `stop:${context.requestId}`,
          reason: 'user',
        });
        return stopResult(store, sessionId, inputId, result.status, result.stopRequested);
      }
      // Already settled: stopping is idempotent and reports the current state unchanged.
      return stopResult(store, sessionId, inputId, input.status, false);
    },
  });
}

function stopResult(
  store: Store,
  sessionId: string,
  inputId: string,
  status: InputRow['status'],
  stopRequested: boolean,
): Record<string, unknown> {
  const input = store.getInput(inputId);
  const running = store.listInputs(sessionId).some((entry) => entry.status === 'processing');
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
