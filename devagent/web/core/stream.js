/**
 * The live stream client (M4): prepare first, then follow the session's events from the boundary.
 *
 * The client never replays: a resync frame (overflow, epoch change, or a subscription the server no
 * longer knows) means "prepare again", not "ask for the missed events". Closing the stream destroys
 * only our buffer on the server; the work keeps running.
 */

export class SessionStream {
  constructor({ rpc, projectId, sessionId, onFrame, onResync, onError }) {
    this.rpc = rpc;
    this.projectId = projectId;
    this.sessionId = sessionId;
    this.onFrame = onFrame ?? (() => undefined);
    this.onResync = onResync ?? (() => undefined);
    this.onError = onError ?? (() => undefined);
    this.controller = null;
    this.closed = false;
    this.attempts = 0;
    this.snapshot = null;
    this.subscriptionId = null;
  }

  /** Prepare and connect. Resolves with the snapshot the boundary was taken at. */
  async start() {
    this.closed = false;
    this.attempts = 0;
    const prepared = await this.rpc.call('session.stream.prepare', {
      projectId: this.projectId,
      sessionId: this.sessionId,
    });
    this.snapshot = prepared.snapshot;
    this.subscriptionId = prepared.subscriptionId;
    void this.#connect(prepared.streamPath);
    return prepared.snapshot;
  }

  stop() {
    this.closed = true;
    this.controller?.abort();
    this.controller = null;
  }

  async #connect(streamPath) {
    this.controller = new AbortController();
    let response;
    try {
      response = await fetch(streamPath, {
        headers: { accept: 'text/event-stream' },
        credentials: 'same-origin',
        signal: this.controller.signal,
      });
    } catch (error) {
      if (!this.closed) {
        this.onError(error);
      }
      return;
    }
    if (response.status !== 200) {
      // 409 STREAM_RESYNC_REQUIRED (or any refusal): prepare again from a fresh boundary.
      await this.#resync(`http-${response.status}`);
      return;
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      for (;;) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done === true) {
          break;
        }
        buffered += decoder.decode(chunk.value, { stream: true });
        let boundary = buffered.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          this.#handleFrame(frame);
          boundary = buffered.indexOf('\n\n');
        }
      }
    } catch (error) {
      // An abort we caused (resync) is not a stream error.
      if (!this.closed && this.resyncing !== true) {
        this.onError(error);
      }
    }
    if (!this.closed && !this.resyncing) {
      // The server closed a healthy stream: reconnect from a fresh boundary rather than guessing.
      await this.#resync('closed');
    }
  }

  #handleFrame(frame) {
    const eventName = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (data === undefined) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (eventName === 'resync' || payload.type === 'stream.resync') {
      void this.#resync(payload.reason ?? 'resync');
      return;
    }
    this.onFrame(payload);
  }

  async #resync(reason) {
    if (this.closed || this.resyncing === true) {
      return;
    }
    this.resyncing = true;
    this.controller?.abort();
    // A short, bounded backoff: a burst of resyncs must not become a request loop.
    this.attempts += 1;
    const delay = Math.min(200 * this.attempts, 1_000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const prepared = await this.rpc.call('session.stream.prepare', {
        projectId: this.projectId,
        sessionId: this.sessionId,
      });
      this.snapshot = prepared.snapshot;
      this.subscriptionId = prepared.subscriptionId;
      this.resyncing = false;
      this.onResync(reason, prepared.snapshot);
      if (!this.closed) {
        void this.#connect(prepared.streamPath);
      }
    } catch (error) {
      this.resyncing = false;
      this.onError(error);
    }
  }
}
