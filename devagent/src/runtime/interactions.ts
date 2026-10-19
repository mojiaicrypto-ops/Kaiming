/**
 * The interaction bridge (M5): Pi asks the user through `ctx.ui.confirm/select/input`, the request is
 * made durable, the browser answers through `interaction.respond`, and the original call continues.
 *
 * The adapter is a *plain object* on purpose: the SDK spreads the uiContext it is given, so a class
 * instance would lose its prototype methods (measured in PI-08). It knows nothing about transport -
 * it hands the request to the host, waits for the durable answer, and returns the native shape.
 */
import { randomUUID } from 'node:crypto';
import { StoreError, type InteractionRow, type Store } from '../store/store.ts';

export interface InteractionWait {
  readonly interactionId: string;
  settle(response: unknown): void;
  fail(error: unknown): void;
}

export interface InteractionBridgeOptions {
  readonly store: Store;
  /** Tell the host a request appeared, was answered, or went stale (an SSE notice, in practice). */
  readonly publish?: (sessionId: string, event: unknown, meta?: { inputId?: string }) => void;
  readonly now?: () => number;
}

/**
 * The in-process side of the bridge: which interactions are still being awaited, and their answers.
 * One bridge serves the whole server; it is the only place that resolves a pending `ctx.ui` call.
 */
export class InteractionBridge {
  private readonly waits = new Map<string, InteractionWait>();
  /** The last interaction created per session: the host-side id the asking tool reports back. */
  private readonly lastIds = new Map<string, string>();
  private readonly options: InteractionBridgeOptions;

  constructor(options: InteractionBridgeOptions) {
    this.options = options;
  }

  get pendingCount(): number {
    return this.waits.size;
  }

  /** The id the host assigned to the most recent question of a session (the tool's visible return). */
  lastInteractionIdFor(sessionId: string): string {
    return this.lastIds.get(sessionId) ?? 'none';
  }

  /**
   * Create one interaction for a session and wait for its answer. The record is written before the
   * wait begins, so a client that reconnects can still see the open question.
   */
  async ask(params: {
    sessionId: string;
    inputId?: string;
    taskId?: string;
    method: 'confirm' | 'select' | 'input';
    title: string;
    message?: string;
    options?: readonly string[];
    placeholder?: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const session = this.options.store.getSession(params.sessionId);
    if (session === undefined) {
      throw new StoreError('NOT_FOUND', 'session does not exist', { sessionId: params.sessionId });
    }
    const interactionId = `q-${randomUUID().slice(0, 8)}`;
    const record = this.options.store.createInteraction({
      interactionId,
      projectId: session.projectId,
      sessionId: params.sessionId,
      ...(params.inputId !== undefined ? { inputId: params.inputId } : {}),
      ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
      method: params.method,
      title: params.title,
      ...(params.message !== undefined ? { message: params.message } : {}),
      ...(params.options !== undefined ? { options: params.options } : {}),
      ...(params.placeholder !== undefined ? { placeholder: params.placeholder } : {}),
      requestKey: interactionId,
    });
    this.lastIds.set(params.sessionId, interactionId);
    // A member's question is presented on the chief's channel (M5): the chief is the only
    // surface the user watches, and the member cannot reach the user itself. Publishing to the
    // member's own stream left the question invisible and the member waiting forever.
    this.options.publish?.(
      this.noticeTarget(params.sessionId, record.taskId),
      { type: 'invalidate', entity: 'interaction', id: record.interactionId, revision: record.revision },
      params.inputId === undefined ? {} : { inputId: params.inputId },
    );
    return this.wait(record, params.signal);
  }

  /**
   * Where an interaction notice belongs: a Task member's question is presented by the Task's
   * chief (M5); a chief's own question stays on its own stream.
   */
  private noticeTarget(sessionId: string, taskId: string | null): string {
    if (taskId === null) return sessionId;
    const task = this.options.store.getTask(taskId);
    return task?.chiefSessionId ?? sessionId;
  }

  /** Wait for the durable answer of one interaction (used by ask and re-attached by the runner). */
  wait(record: InteractionRow, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const settle = (response: unknown): void => {
        this.waits.delete(record.interactionId);
        cleanup();
        resolve(shapeResponse(record.method, response));
      };
      const fail = (error: unknown): void => {
        this.waits.delete(record.interactionId);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const onAbort = (): void => {
        // A stopped input can never be resumed: the question goes stale and the await unwinds.
        this.options.store.staleInteractionsForInput({ inputId: record.inputId ?? '' });
        this.options.publish?.(
          this.noticeTarget(record.sessionId, record.taskId),
          { type: 'invalidate', entity: 'interaction', id: record.interactionId },
        );
        fail(new StoreError('INTERACTION_STALE', 'the interaction was aborted with its input', {
          interactionId: record.interactionId,
        }));
      };
      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort);
      };
      this.waits.set(record.interactionId, { interactionId: record.interactionId, settle, fail });
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Deliver a saved answer to the awaiting call (called after the store accepted the response). */
  resolve(interactionId: string, response: unknown): boolean {
    const waiter = this.waits.get(interactionId);
    if (waiter === undefined) {
      return false;
    }
    waiter.settle(response);
    return true;
  }

  /** Drop every waiter (server shutdown); their inputs stay as they are. */
  clear(): void {
    for (const waiter of [...this.waits.values()]) {
      waiter.fail(new StoreError('INTERACTION_STALE', 'the server is shutting down'));
    }
    this.waits.clear();
  }
}

/** The native return shape of each dialog method (PI's own contract). */
function shapeResponse(method: InteractionRow['method'], response: unknown): unknown {
  if (method === 'confirm') {
    if (typeof response === 'boolean') {
      return response;
    }
    if (typeof response === 'object' && response !== null && typeof (response as { confirmed?: unknown }).confirmed === 'boolean') {
      return (response as { confirmed: boolean }).confirmed;
    }
    return false;
  }
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response === 'object' && response !== null && typeof (response as { value?: unknown }).value === 'string') {
    return (response as { value: string }).value;
  }
  return undefined;
}

/**
 * The plain-object uiContext the SDK binds: `bindExtensions({ uiContext, mode: 'rpc' })`. `notify` and
 * the terminal-only surfaces degrade honestly instead of pretending to work.
 */
export function createUiAdapter(params: {
  bridge: InteractionBridge;
  sessionId: string;
  inputId: string;
  taskId?: string;
  notify?: (message: string, type?: 'info' | 'warning' | 'error') => void;
}): Record<string, unknown> {
  const ask = (method: 'confirm' | 'select' | 'input') =>
    (title: string, second?: unknown, opts?: unknown) => {
      const dialog = (typeof opts === 'object' && opts !== null ? opts : {}) as { signal?: AbortSignal };
      const signal = dialog.signal;
      const shared = {
        sessionId: params.sessionId,
        inputId: params.inputId,
        ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
        title,
        ...(signal !== undefined ? { signal } : {}),
      };
      if (method === 'confirm') {
        return params.bridge.ask({ ...shared, method, message: String(second ?? '') });
      }
      if (method === 'select') {
        return params.bridge.ask({ ...shared, method, options: Array.isArray(second) ? (second as string[]) : [] });
      }
      return params.bridge.ask({
        ...shared,
        method,
        ...(second === undefined ? {} : { placeholder: String(second) }),
      });
    };
  return {
    confirm: ask('confirm'),
    select: ask('select'),
    input: ask('input'),
    notify: (message: string, type?: 'info' | 'warning' | 'error') => {
      params.notify?.(message, type);
    },
    // Terminal-only surfaces are absent by design; callers see them as no-ops (R4/G2).
    setStatus: () => undefined,
    setWorkingMessage: () => undefined,
    setWidget: () => undefined,
    setTitle: () => undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
  };
}
