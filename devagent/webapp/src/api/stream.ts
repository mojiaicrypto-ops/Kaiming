/**
 * The live stream client (M4 semantics, TS port of web/core/stream.js): prepare first, then follow
 * the session's events from the boundary. The client never replays: a resync frame (overflow, epoch
 * change, or an unknown subscription) means "prepare again" — the slot reducer merges the fresh
 * snapshot with the live tail (see state/slot.ts) so the in-flight message survives.
 */
import type { HistoryMessage } from '../state/slot';

/** One vocabulary for a session's live state, shared by the snapshot, the reads and the views. */
export type SessionActivity = 'idle' | 'queued' | 'processing' | 'stopping';

export interface PreparedSnapshot {
  sessionId: string;
  projectId: string;
  roleId: string;
  activity: SessionActivity;
  /** What the running input was configured with; null while nothing is running. */
  config?: { providerId: string; modelId: string; source: string } | null;
  /** Why the session cannot run, as of the snapshot; null when nothing is blocked. */
  blocked?: { code: string; detail: string } | null;
  currentInputId: string | null;
  inputs: ReadonlyArray<{ inputId: string; kind: string; status: string; revision: number; errorCode: string | null }>;
  messages: readonly HistoryMessage[];
  interactions: ReadonlyArray<PendingInteraction>;
  historyLeaf: string | null;
  historyProblems: readonly string[];
}

export interface PendingInteraction {
  interactionId: string;
  method: string;
  title: string;
  message: string | null;
  options: string[] | null;
  placeholder: string | null;
  inputId: string | null;
  taskId: string | null;
  /** The session that asked (a member session when the chief is presenting it). */
  sourceSessionId?: string;
  revision: number;
  createdAt: string;
  /** Local-only: an optimistically answered card stays until the authoritative refresh. */
  resolved?: boolean;
}

export interface StreamFrame {
  type: 'pi' | 'invalidate' | 'blocked' | 'resync';
  seq?: number;
  inputId?: string;
  event?: { type: string; [key: string]: unknown };
  snapshot?: PreparedSnapshot;
  code?: string;
  detail?: string;
}

export class SessionStream {
  private controller: AbortController | null = null;
  private closed = false;
  private resyncing = false;
  private attempts = 0;

  constructor(
    private readonly rpc: import('./rpc').RpcClient,
    private readonly projectId: string,
    private readonly sessionId: string,
    private readonly handlers: {
      onFrame: (frame: StreamFrame) => void;
      onSnapshot: (snapshot: PreparedSnapshot, reason: 'initial' | 'resync') => void;
      onError: (error: unknown) => void;
    },
  ) {}

  stop(): void {
    this.closed = true;
    this.controller?.abort();
    this.controller = null;
  }

  async start(): Promise<void> {
    this.closed = false;
    this.attempts = 0;
    await this.prepare('initial');
  }

  private async prepare(reason: 'initial' | 'resync'): Promise<void> {
    const prepared = (await this.rpc.call('session.stream.prepare', {
      projectId: this.projectId,
      sessionId: this.sessionId,
    })) as { subscriptionId: string; streamPath: string; snapshot: PreparedSnapshot };
    // A prepare in flight while the caller switched sessions must not deliver into the new
    // slot: the effect already dispatched reset for the next session.
    if (this.closed) return;
    this.handlers.onSnapshot(prepared.snapshot, reason);
    if (!this.closed) {
      void this.connect(prepared.streamPath);
    }
  }

  private async connect(streamPath: string): Promise<void> {
    this.controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(streamPath, {
        headers: { accept: 'text/event-stream' },
        credentials: 'same-origin',
        signal: this.controller.signal,
      });
    } catch (error) {
      if (!this.closed) this.handlers.onError(error);
      return;
    }
    if (response.status !== 200) {
      await this.resync(`http-${response.status}`);
      return;
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      for (;;) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done === true) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        let boundary = buffered.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          this.handleFrame(frame);
          boundary = buffered.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!this.closed && !this.resyncing) this.handlers.onError(error);
    }
    if (!this.closed && !this.resyncing) {
      // The server closed a healthy stream: reconnect from a fresh boundary rather than guessing.
      await this.resync('closed');
    }
  }

  private handleFrame(raw: string): void {
    const eventName = /^event: (.+)$/m.exec(raw)?.[1];
    const data = /^data: (.+)$/m.exec(raw)?.[1];
    if (data === undefined) return;
    let payload: StreamFrame;
    try {
      payload = JSON.parse(data) as StreamFrame;
    } catch {
      return;
    }
    if (eventName === 'resync' || (payload as { type?: string }).type === 'stream.resync') {
      void this.resync('resync-frame');
      return;
    }
    this.handlers.onFrame(payload);
  }

  private async resync(reason: string): Promise<void> {
    if (this.closed || this.resyncing) return;
    this.resyncing = true;
    this.controller?.abort();
    this.attempts += 1;
    const delay = Math.min(200 * this.attempts, 1_000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await this.prepare('resync');
      this.resyncing = false;
    } catch (error) {
      this.resyncing = false;
      this.handlers.onError(error);
      void reason;
    }
  }
}
