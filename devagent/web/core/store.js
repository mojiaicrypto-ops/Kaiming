/**
 * The client-side entity layer: one cache per entity, invalidation as the only refresh trigger, and a
 * server-truth rule - a notice makes us re-read, it never patches what we think the server holds.
 *
 * Update kinds the views are allowed to use (see the P4 plan §5):
 *  - append-only regions (transcript, logs) are appended to and never re-rendered;
 *  - list/detail regions are replaced when their entity is invalidated;
 *  - everything else (dialogs, collapse, scroll, selection) stays local to the view.
 */

export class WorkbenchStore {
  constructor({ rpc, streamFactory }) {
    this.rpc = rpc;
    this.streamFactory = streamFactory ?? null;
    this.projectId = null;
    this.sessionId = null;
    this.tasks = [];
    this.requirements = [];
    this.sessions = [];
    this.pendingInteractions = [];
    this.sessionStream = null;
    this.listeners = new Map();
    this.sessionListeners = new Set();
    this.onNotice = () => undefined;
  }

  subscribe(entity, listener) {
    const set = this.listeners.get(entity) ?? new Set();
    set.add(listener);
    this.listeners.set(entity, set);
    return () => set.delete(listener);
  }

  /** Subscribe to the live session view (activity, pending interactions, stream frames). */
  subscribeSession(listener) {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  #emit(entity, id) {
    for (const listener of this.listeners.get(entity) ?? []) {
      listener(id);
    }
  }

  #emitSession(frame) {
    for (const listener of this.sessionListeners) {
      listener(frame);
    }
  }

  /** A business notice from the stream: re-read the entity it names (M4). */
  async handleNotice(notice) {
    if (notice?.type !== 'invalidate') {
      return;
    }
    const entity = notice.entity;
    if (entity === 'input' || entity === 'task' || entity === 'session' || entity === 'interaction') {
      if (entity === 'interaction') {
        await this.refreshInteractions();
      } else {
        this.#emit(entity, notice.id);
      }
      return;
    }
    if (entity === 'requirement') {
      await this.refreshRequirements();
    }
  }

  async openProject(path) {
    const opened = await this.rpc.call('project.open', { path });
    this.projectId = opened.project.projectId;
    this.#emit('project', this.projectId);
    return opened.project;
  }

  async registerProject(projectId) {
    this.projectId = projectId;
    const read = await this.rpc.call('project.get', { projectId });
    this.#emit('project', projectId);
    return read.project;
  }

  async refreshSessions() {
    const read = await this.rpc.call('project.get', { projectId: this.projectId });
    this.sessions = read.project.sessions;
    this.#emit('session', null);
    return this.sessions;
  }

  async refreshTasks() {
    const read = await this.rpc.call('task.list', { projectId: this.projectId });
    this.tasks = read.tasks;
    this.#emit('task', null);
    return this.tasks;
  }

  async refreshRequirements() {
    const read = await this.rpc.call('requirement.list', { projectId: this.projectId });
    this.requirements = read.items;
    this.invalidRequirementFiles = read.invalidFiles;
    this.#emit('requirement', null);
    return this.requirements;
  }

  async refreshInteractions() {
    if (this.sessionId === null || this.projectId === null) {
      return [];
    }
    const read = await this.rpc.call('session.stream.prepare', {
      projectId: this.projectId,
      sessionId: this.sessionId,
    });
    this.pendingInteractions = read.snapshot.interactions ?? [];
    this.#emit('interaction', null);
    return this.pendingInteractions;
  }

  /** Start following the current session live; the snapshot is applied through the frame pipeline. */
  async startSession(sessionId) {
    this.stopSession();
    this.sessionId = sessionId;
    if (this.streamFactory === null) {
      return null;
    }
    const stream = this.streamFactory({
      projectId: this.projectId,
      sessionId,
      onFrame: (frame) => {
        if (frame.type === 'invalidate') {
          void this.handleNotice(frame);
        }
        this.#emitSession(frame);
      },
      onResync: (_reason, snapshot) => {
        this.pendingInteractions = snapshot.interactions ?? [];
        this.#emit('interaction', null);
        this.#emitSession({ type: 'resync', snapshot });
      },
      onError: (error) => {
        this.#emitSession({ type: 'stream-error', error });
      },
    });
    this.sessionStream = stream;
    const snapshot = await stream.start();
    this.pendingInteractions = snapshot.interactions ?? [];
    this.#emit('interaction', null);
    this.#emitSession({ type: 'snapshot', snapshot });
    return snapshot;
  }

  stopSession() {
    this.sessionStream?.stop();
    this.sessionStream = null;
  }

  /** Answer an open question; the revision guards against answering a stale request. */
  async answerInteraction(interactionId, expectedRevision, response) {
    const result = await this.rpc.call('interaction.respond', {
      projectId: this.projectId,
      chiefSessionId: this.sessionId,
      interactionId,
      expectedRevision,
      response,
    });
    this.pendingInteractions = this.pendingInteractions.filter((entry) => entry.interactionId !== interactionId);
    this.#emit('interaction', null);
    return result;
  }

  /** Submit a user input; the id is generated here so a retry reuses it (R1). */
  async submit(content, options = {}) {
    const requestId = options.requestId ?? undefined;
    const result = await this.rpc.call(
      'session.input.submit',
      {
        projectId: this.projectId,
        sessionId: this.sessionId,
        content,
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
      },
      requestId === undefined ? {} : { requestId },
    );
    this.#emit('input', result.inputId);
    return result;
  }
}
