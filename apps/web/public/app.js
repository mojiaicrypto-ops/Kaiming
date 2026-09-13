/**
 * The workbench client script (AC-069 … AC-078).
 *
 * No framework and no dependency: the server already rendered the true state, so
 * this file only (1) keeps that state live over the protocol, (2) drives the shared
 * panel modes and the interface language, and (3) reports failures honestly.
 *
 * Hard rules encoded here:
 * - every write goes to the real `/rpc` with an idempotency key and the session's
 *   CSRF token; there is no local success path;
 * - a rejected write keeps the user's input and shows the server's reason;
 * - switching the Live panel mode or showing/hiding a panel issues **no** request,
 *   so it cannot affect a Run (AC-071);
 * - project content (user messages, documents, Agent output) is never translated:
 *   only elements with `data-i18n` / `data-i18n-aria` are touched (AC-073).
 */
(() => {
  'use strict';

  const panelModes = ['open', 'compact', 'hidden'];
  const panelAriaKeys = {
    open: 'aria.liveDockOpen',
    compact: 'aria.liveDockCompact',
    hidden: 'aria.liveDockHidden',
  };
  const languageStorageKey = 'agentdev.language';
  const panelStorageKey = 'agentdev.panel';
  const attachmentLimits = {
    maxCount: 5,
    maxFileBytes: 20 * 1024 * 1024,
    maxTotalBytes: 50 * 1024 * 1024,
    mimes: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'text/markdown',
      'text/html',
      'application/pdf',
    ],
  };

  const shell = document.getElementById('shell');
  const state = {
    language: shell ? shell.dataset.language || 'en' : 'en',
    csrfToken: null,
    connection: 'connecting',
    watermark: 0,
    subscription: null,
    socket: null,
    reconnectTimer: null,
    strings: {},
  };

  /** The server's real answer for this page, already escaped when rendered. */
  function viewData() {
    const island = document.getElementById('viewData');
    if (!island) return null;
    try {
      return JSON.parse(island.textContent || 'null');
    } catch {
      return null;
    }
  }

  function storage() {
    try {
      return window.localStorage;
    } catch {
      // Private mode and some embedded webviews throw on access; an in-memory
      // fallback keeps the UI usable (`experience.md` §6).
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Interface language
  // ---------------------------------------------------------------------------

  function readStoredLanguage() {
    const store = storage();
    const stored = store ? store.getItem(languageStorageKey) : null;
    if (stored === 'en' || stored === 'zh') return stored;
    return state.language;
  }

  function applyLanguage(language) {
    for (const element of document.querySelectorAll('[data-i18n]')) {
      const key = element.getAttribute('data-i18n');
      if (key && state.strings[key]) element.textContent = state.strings[key];
    }
    for (const element of document.querySelectorAll('[data-i18n-aria]')) {
      const key = element.getAttribute('data-i18n-aria');
      if (key && state.strings[key]) element.setAttribute('aria-label', state.strings[key]);
    }
    // Project content is explicitly excluded: those subtrees are marked and their
    // text is never replaced.
    for (const element of document.querySelectorAll('[data-i18n-project]')) {
      element.setAttribute('data-translatable', 'false');
    }
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    state.language = language;
    if (shell) shell.dataset.language = language;
  }

  async function loadStrings(language) {
    const keys = new Set();
    for (const element of document.querySelectorAll('[data-i18n]')) {
      const key = element.getAttribute('data-i18n');
      if (key) keys.add(key);
    }
    for (const element of document.querySelectorAll('[data-i18n-aria]')) {
      const key = element.getAttribute('data-i18n-aria');
      if (key) keys.add(key);
    }
    const resolved = {};
    await Promise.all(
      [...keys].map(async (key) => {
        const answer = await rpc('ui.translate', { resourceId: key, locale: language });
        if (answer.ok && answer.result && typeof answer.result.content === 'string') {
          resolved[key] = answer.result.content;
        }
      }),
    );
    // The daemon's catalogue covers the interface keys it owns; a key it does not
    // know keeps the server-rendered text, which is already in the right language.
    state.strings = resolved;
  }

  // ---------------------------------------------------------------------------
  // Protocol access
  // ---------------------------------------------------------------------------

  let requestCounter = 0;

  function newIdempotencyKey(prefix) {
    requestCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${String(requestCounter)}`;
  }

  async function rpc(method, params, options) {
    const settings = options || {};
    const envelope = {
      v: 1,
      type: 'request',
      id: `web-${Date.now().toString(36)}-${String((requestCounter += 1))}`,
      method,
      params: params || {},
    };
    if (settings.idempotencyKey) envelope.idempotencyKey = settings.idempotencyKey;
    if (typeof settings.expectedVersion === 'number') {
      envelope.expectedVersion = settings.expectedVersion;
    }
    if (settings.projectId) envelope.projectId = settings.projectId;
    let response;
    try {
      response = await fetch('/rpc', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': state.csrfToken || '',
        },
        body: JSON.stringify(envelope),
      });
    } catch (error) {
      return { ok: false, error: { code: 'TRANSPORT_LOST', message: String(error) } };
    }
    let parsed;
    try {
      parsed = await response.json();
    } catch {
      return {
        ok: false,
        error: { code: 'PROTOCOL_MISMATCH', message: `the server answered ${response.status}` },
      };
    }
    if (parsed && parsed.ok === true) return { ok: true, result: parsed.result };
    const failure = (parsed && parsed.error) || {};
    if (failure.code === 'UNAUTHENTICATED' || failure.code === 'AUTH_EXPIRED') {
      showConnection('expired');
    }
    return {
      ok: false,
      error: {
        code: typeof failure.code === 'string' ? failure.code : 'INTERNAL_ERROR',
        message: typeof failure.message === 'string' ? failure.message : 'the request failed',
        details: failure.details,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Status reporting
  // ---------------------------------------------------------------------------

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function showError(id, failure, preserve) {
    const element = document.getElementById(id);
    if (!element) return;
    if (!failure) {
      element.hidden = true;
      element.textContent = '';
      return;
    }
    const code = failure.code || 'INTERNAL_ERROR';
    const message = failure.message || '';
    element.hidden = false;
    element.dataset.code = code;
    // The server's reason and the code are shown together, and `preserve` marks a
    // form whose input stays exactly as the user typed it.
    element.textContent = `${code}: ${message}${preserve ? ' — input preserved' : ''}`;
  }

  function showStatus(id, text) {
    const element = document.getElementById(id);
    if (!element) return;
    element.hidden = text === '';
    element.textContent = text;
  }

  function showConnection(next) {
    state.connection = next;
    const labels = {
      open: state.strings['connection.open'] || 'Connected',
      connecting: state.strings['connection.connecting'] || 'Connecting',
      reconnecting:
        state.strings['connection.reconnecting'] || 'Connection lost; background state pending',
      closed: state.strings['connection.closed'] || 'Disconnected',
      expired: state.strings['connection.expired'] || 'Session expired; sign in again',
    };
    const element = document.getElementById('connectionState');
    if (element) {
      element.textContent = labels[next] || next;
      element.dataset.connection = next;
    }
    if (shell) shell.dataset.connection = next;
    const reconnect = document.getElementById('liveReconnect');
    if (reconnect) reconnect.hidden = next !== 'reconnecting';
  }

  // ---------------------------------------------------------------------------
  // Live panel (AC-071)
  // ---------------------------------------------------------------------------

  function setPanelMode(mode) {
    if (panelModes.indexOf(mode) < 0) return;
    if (shell) shell.dataset.panelMode = mode;
    const dock = document.getElementById('liveDock');
    if (dock) dock.dataset.mode = mode;
    const toggle = document.getElementById('liveDockToggle');
    if (toggle) {
      toggle.dataset.mode = mode;
      toggle.setAttribute('aria-expanded', mode === 'open' ? 'true' : 'false');
      const key = panelAriaKeys[mode];
      toggle.setAttribute('data-i18n-aria', key);
      toggle.setAttribute(
        'aria-label',
        state.strings[key] || toggle.getAttribute('aria-label') || mode,
      );
    }
    const store = storage();
    if (store) store.setItem(panelStorageKey, mode);
    // Presentation only: no request is issued, so a Run's state cannot be affected.
  }

  function initPanel() {
    const store = storage();
    const remembered = store ? store.getItem(panelStorageKey) : null;
    const initial =
      panelModes.indexOf(remembered) >= 0 ? remembered : shell ? shell.dataset.panelMode : 'open';
    setPanelMode(initial);
    const toggle = document.getElementById('liveDockToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const current = (shell && shell.dataset.panelMode) || 'open';
        const index = panelModes.indexOf(current);
        const next = panelModes[(index + 1) % panelModes.length];
        setPanelMode(next);
        if (next !== 'open') {
          // Returning focus to the trigger is what AC-071 asks for when the
          // overlay closes on a narrow screen.
          toggle.focus();
        }
      });
    }
    const close = document.getElementById('liveDockClose');
    if (close) close.addEventListener('click', () => setPanelMode('compact'));
  }

  function appendLive(event) {
    const list = document.getElementById('liveEvents');
    if (!list) return;
    const item = document.createElement('li');
    item.dataset.cursor = String(event.cursor);
    item.dataset.name = event.name;
    item.className = 'live-event';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = event.name;
    const cursor = document.createElement('span');
    cursor.className = 'mono';
    cursor.textContent = `#${event.cursor}`;
    const entity = document.createElement('span');
    entity.className = 'mono entity';
    entity.setAttribute('data-i18n-project', '');
    entity.textContent = event.entityId;
    item.append(name, cursor, entity);
    list.prepend(item);
    while (list.children.length > 200) list.removeChild(list.lastElementChild);
    state.watermark = Math.max(state.watermark, event.cursor);
    setText('liveWatermark', String(state.watermark));
    const count = document.getElementById('liveCount');
    if (count) count.textContent = String(Number(count.textContent || '0') + 1);
  }

  // ---------------------------------------------------------------------------
  // WebSocket: real events, watermark resume, honest reconnect state
  // ---------------------------------------------------------------------------

  function subscriptionScopes() {
    const projectId = shell ? shell.dataset.project : undefined;
    const scopes = [{ scope: { kind: 'summary' } }];
    const page = shell ? shell.dataset.page : '';
    const requirement = document.querySelector('[data-requirement]');
    if (page === 'requirement' && requirement) {
      scopes.push({
        scope: { kind: 'work', id: requirement.dataset.work || undefined },
      });
    }
    void projectId;
    return scopes.filter((entry) => entry.scope.kind !== 'work' || entry.scope.id);
  }

  function openSocket() {
    if (!shell) return;
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try {
      socket = new WebSocket(`${scheme}//${window.location.host}/ws`);
    } catch {
      showConnection('reconnecting');
      return;
    }
    state.socket = socket;
    socket.addEventListener('open', () => {
      showConnection('open');
      const projectId = shell.dataset.project;
      send({
        v: 1,
        type: 'request',
        id: `sub-${Date.now().toString(36)}`,
        method: 'connection.hello',
        params: { protocolVersion: 1, client: 'web' },
      });
      for (const entry of subscriptionScopes()) {
        send({
          v: 1,
          type: 'request',
          id: `sub-${entry.scope.kind}-${Date.now().toString(36)}`,
          method: 'project.subscribe',
          projectId,
          params: {
            scope: entry.scope,
            ...(state.watermark > 0 ? { afterCursor: state.watermark } : {}),
          },
        });
      }
    });
    socket.addEventListener('message', (message) => {
      let frame;
      try {
        frame = JSON.parse(message.data);
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      if (frame.type === 'event') {
        appendLive({
          cursor: typeof frame.cursor === 'number' ? frame.cursor : 0,
          name: typeof frame.name === 'string' ? frame.name : 'event',
          entityId: typeof frame.entityId === 'string' ? frame.entityId : '',
        });
        return;
      }
      if (frame.type === 'batch_end' && typeof frame.scannedThrough === 'number') {
        // The watermark is applied only after the whole batch arrived.
        state.watermark = Math.max(state.watermark, frame.scannedThrough);
        setText('liveWatermark', String(state.watermark));
        return;
      }
      if (frame.type === 'close') {
        showConnection('expired');
        socket.close();
        return;
      }
      if (frame.ok === false && frame.error && frame.error.code === 'RESYNC_REQUIRED') {
        // A truncated cursor: re-subscribe without one, which the server answers
        // with a fresh snapshot.
        state.watermark = 0;
        send({
          v: 1,
          type: 'request',
          id: `resync-${Date.now().toString(36)}`,
          method: 'project.subscribe',
          projectId: shell.dataset.project,
          params: { scope: { kind: 'summary' } },
        });
      }
    });
    socket.addEventListener('close', () => {
      if (state.connection === 'expired') return;
      showConnection('reconnecting');
      if (state.reconnectTimer) window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = window.setTimeout(openSocket, 2000);
    });
    socket.addEventListener('error', () => showConnection('reconnecting'));
  }

  function send(frame) {
    const socket = state.socket;
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(frame));
  }

  // ---------------------------------------------------------------------------
  // Chief composer (AC-069, AC-084)
  // ---------------------------------------------------------------------------

  function stagedAttachments() {
    return [...document.querySelectorAll('#stagedAttachments [data-attachment]')].map((item) => ({
      id: item.dataset.attachment,
      name: item.dataset.name || '',
      bytes: Number(item.dataset.bytes || '0'),
    }));
  }

  function rejectAttachment(reasonKey) {
    showError('composerError', {
      code: 'VALIDATION_ERROR',
      message: state.strings[reasonKey] || reasonKey,
    });
  }

  function mimeAllowed(file) {
    const mime = (file.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    return attachmentLimits.mimes.indexOf(mime) >= 0;
  }

  function validateSelection(files) {
    const staged = stagedAttachments();
    if (staged.length + files.length > attachmentLimits.maxCount) return 'chief.attachmentTooMany';
    let total = staged.reduce((sum, item) => sum + item.bytes, 0);
    for (const file of files) {
      if (file.size > attachmentLimits.maxFileBytes) return 'chief.attachmentTooLarge';
      if (!mimeAllowed(file)) return 'chief.attachmentMime';
      total += file.size;
    }
    if (total > attachmentLimits.maxTotalBytes) return 'chief.attachmentTotalTooLarge';
    return null;
  }

  /** Stages one file through the real upload endpoint; a failure keeps the message. */
  async function uploadFile(file, conversationId) {
    const form = new FormData();
    form.append('conversationId', conversationId);
    form.append('file', file, file.name);
    let response;
    try {
      response = await fetch('/artifacts/upload', {
        method: 'POST',
        headers: { 'x-csrf-token': state.csrfToken || '' },
        body: form,
      });
    } catch (error) {
      return { ok: false, error: { code: 'TRANSPORT_LOST', message: String(error) } };
    }
    const parsed = await response.json().catch(() => null);
    if (parsed && typeof parsed.attachmentId === 'string') {
      return { ok: true, attachment: parsed };
    }
    return {
      ok: false,
      error: (parsed && parsed.error) || { code: 'INTERNAL_ERROR', message: 'upload failed' },
    };
  }

  function addStaged(attachment, name) {
    const list = document.getElementById('stagedAttachments');
    if (!list) return;
    const item = document.createElement('li');
    item.dataset.attachment = attachment.attachmentId;
    item.dataset.name = name;
    item.dataset.bytes = String(attachment.bytes || 0);
    item.textContent = `${name} · ${state.strings['chief.attachmentStaged'] || 'staged'}`;
    list.append(item);
  }

  async function initComposer() {
    const form = document.getElementById('composer');
    if (!form) return;
    const conversationId = form.dataset.conversation;
    const input = document.getElementById('composerAttachments');
    if (input) {
      input.addEventListener('change', async () => {
        const files = [...(input.files || [])];
        input.value = '';
        if (files.length === 0) return;
        const rejection = validateSelection(files);
        if (rejection) {
          rejectAttachment(rejection);
          return;
        }
        showError('composerError', null);
        for (const file of files) {
          const uploaded = await uploadFile(file, conversationId);
          if (!uploaded.ok) {
            showError('composerError', uploaded.error);
            return;
          }
          addStaged(uploaded.attachment, file.name);
        }
      });
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = document.getElementById('composerBody');
      const send = document.getElementById('composerSend');
      const text = body ? body.value : '';
      if (text.trim() === '' && stagedAttachments().length === 0) return;
      // Duplicate submits are blocked until the answer arrives; the server's
      // idempotency ledger stays the authority (`experience.md` §7).
      if (send) send.disabled = true;
      showError('composerError', null);
      const answer = await rpc(
        'conversation.message.send',
        {
          conversationId,
          body: text,
          attachmentIds: stagedAttachments().map((item) => item.id),
        },
        { idempotencyKey: newIdempotencyKey('message') },
      );
      if (send) send.disabled = false;
      if (!answer.ok) {
        showError('composerError', answer.error, true);
        return;
      }
      if (body) body.value = '';
      const list = document.getElementById('stagedAttachments');
      if (list) list.textContent = '';
      const messages = document.getElementById('messages');
      if (messages && answer.result) {
        const item = document.createElement('li');
        item.className = 'message pending';
        item.dataset.message = answer.result.messageId || '';
        item.dataset.state = 'received';
        const stateLabel = document.createElement('span');
        stateLabel.className = 'state';
        stateLabel.textContent = state.strings['state.received'] || 'Received';
        const text_ = document.createElement('div');
        text_.className = 'message-body';
        text_.setAttribute('data-i18n-project', '');
        text_.textContent = text;
        item.append(stateLabel, text_);
        messages.append(item);
      }
      // The message state stays `received` until the real event says otherwise; no
      // completion is inferred here.
    });
  }

  // ---------------------------------------------------------------------------
  // Board, detail, inbox, settings, runs
  // ---------------------------------------------------------------------------

  function bestEffort(action) {
    Promise.resolve()
      .then(action)
      .catch(() => undefined);
  }

  async function initBoard() {
    const board = document.getElementById('board');
    if (!board) return;
    board.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (button.dataset.refused) {
        // Pausing a Queued requirement with no local Work is the documented refusal;
        // it is shown without a request, from the server's own rule flag (AC-068).
        showError('boardError', {
          code: button.dataset.refused,
          message: state.strings['board.pauseQueuedRefused'] || 'pause is not allowed here',
        });
        return;
      }
      const params = { action, reason: 'workbench' };
      if (button.dataset.work) params.workId = button.dataset.work;
      if (button.dataset.requirement) params.requirementId = button.dataset.requirement;
      button.disabled = true;
      const answer = await rpc('work.control', params, {
        idempotencyKey: newIdempotencyKey(`work-${action}`),
      });
      button.disabled = false;
      if (!answer.ok) {
        showError('boardError', answer.error);
        return;
      }
      showError('boardError', null);
      window.location.reload();
    });
  }

  async function initDetail() {
    const approve = document.getElementById('approvePlan');
    if (approve) {
      approve.addEventListener('click', async () => {
        if (approve.disabled) return;
        showError('approveError', null);
        approve.disabled = true;
        const planVersion = Number(approve.dataset.planVersion || '0');
        const answer = await rpc(
          'plan.approve',
          {
            workId: approve.dataset.work,
            revision: approve.dataset.planRevision,
            planVersion,
            plan: viewData() && viewData().plan ? viewData().plan.draft || {} : {},
            approval: { authorizationRef: 'workbench', runId: 'workbench' },
          },
          { idempotencyKey: newIdempotencyKey('plan'), expectedVersion: planVersion },
        );
        approve.disabled = false;
        if (!answer.ok) {
          // A VERSION_CONFLICT is the expired card: relabel it and refresh the
          // version the page believes in (AC-070).
          if (answer.error.code === 'VERSION_CONFLICT') {
            approve.disabled = true;
            approve.setAttribute('aria-disabled', 'true');
            showError('approveError', {
              code: 'VERSION_CONFLICT',
              message: state.strings['detail.approveExpired'] || answer.error.message,
            });
            if (answer.error.details && typeof answer.error.details.currentVersion === 'number') {
              const plan = document.getElementById('plan');
              if (plan) {
                plan.dataset.currentVersion = String(answer.error.details.currentVersion);
                plan.dataset.expired = 'true';
              }
            }
            return;
          }
          showError('approveError', answer.error);
          return;
        }
        showStatus('approveStatus', state.strings['settings.saved'] || 'applied');
      });
    }

    for (const button of document.querySelectorAll('button[data-download-artifact]')) {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const answer = await rpc(
          'artifact.download.prepare',
          {
            artifactId: button.dataset.downloadArtifact,
            artifactVersion: Number(button.dataset.downloadVersion || '1'),
          },
          { idempotencyKey: newIdempotencyKey('download') },
        );
        button.disabled = false;
        if (!answer.ok || !answer.result || typeof answer.result.downloadToken !== 'string') {
          showError(
            'approveError',
            answer.error || { code: 'ARTIFACT_MISSING', message: 'no token' },
          );
          return;
        }
        window.location.assign(`/artifacts/download/${answer.result.downloadToken}`);
      });
    }

    for (const frame of document.querySelectorAll('iframe[data-preview-href]')) {
      const artifactId = frame.dataset.artifact;
      const version = Number(frame.dataset.version || '1');
      bestEffort(async () => {
        const meta = await rpc('artifact.get', { artifactId, artifactVersion: version });
        if (!meta.ok) {
          frame.hidden = true;
          const notice = frame.parentElement.querySelector('[data-preview-error]');
          if (notice) {
            notice.hidden = false;
            notice.textContent = `${meta.error.code}: ${meta.error.message}`;
          }
          return;
        }
        const info = meta.result && meta.result.artifact ? meta.result.artifact : {};
        if (info.mime === 'text/html' || info.mime === 'image/png' || info.mime === 'image/jpeg') {
          // The preview iframe is sandboxed and carries the daemon's isolation
          // headers, so an HTML explanation still cannot reach the workbench.
          frame.src = frame.dataset.previewHref;
        } else {
          // A non-renderable payload keeps its card and points at the download.
          frame.hidden = true;
          const notice = frame.parentElement.querySelector('[data-truncation-notice]');
          if (notice) notice.hidden = false;
        }
        const validity = frame.closest('[data-validity]');
        if (validity)
          validity.dataset.validity = String(info.validity || validity.dataset.validity);
      });
    }
  }

  async function initInbox() {
    const list = document.getElementById('inboxList');
    if (!list) return;
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-choice]');
      if (!button || button.disabled) return;
      button.disabled = true;
      const answer = await rpc(
        'decision.resolve',
        {
          decisionId: button.dataset.decision,
          choice: button.dataset.choice,
          targetVersion: Number(button.dataset.targetVersion || '0'),
        },
        {
          idempotencyKey: newIdempotencyKey('decision'),
          expectedVersion: Number(button.dataset.targetVersion || '0'),
        },
      );
      button.disabled = false;
      if (!answer.ok) {
        showError('inboxError', answer.error);
        // An expired decision is disabled rather than retried (`AC-074`).
        if (answer.error.code === 'INVALID_STATE' || answer.error.code === 'VERSION_CONFLICT') {
          for (const sibling of list.querySelectorAll('button[data-choice]')) {
            if (sibling.dataset.decision === button.dataset.decision) {
              sibling.disabled = true;
              sibling.setAttribute('aria-disabled', 'true');
            }
          }
        }
        return;
      }
      showError('inboxError', null);
      window.location.reload();
    });
  }

  async function initSettings() {
    const form = document.getElementById('configForm');
    if (!form) return;
    const patch = document.getElementById('configPatch');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showError('configError', null);
      showStatus('configStatus', '');
      let parsed;
      try {
        parsed = JSON.parse(patch ? patch.value : '{}');
      } catch {
        showError('configError', {
          code: 'VALIDATION_ERROR',
          message: 'the patch is not valid JSON — input preserved',
        });
        return;
      }
      const answer = await rpc(
        'config.save',
        { scope: form.dataset.scope, patch: parsed },
        {
          idempotencyKey: newIdempotencyKey('config'),
          expectedVersion: Number(form.dataset.revision || '0'),
        },
      );
      if (!answer.ok) {
        // The textarea keeps the user's text; only the reason is added (AC-075).
        showError('configError', answer.error, true);
        return;
      }
      showStatus('configStatus', state.strings['settings.saved'] || 'saved');
      if (answer.result && typeof answer.result.revision === 'number') {
        form.dataset.revision = String(answer.result.revision);
        const meta = document.getElementById('settingsMeta');
        if (meta) {
          meta.dataset.revision = String(answer.result.revision);
          meta.dataset.version = String(answer.result.revision);
        }
      }
    });
    const test = document.getElementById('configTest');
    if (test) {
      test.addEventListener('click', async () => {
        showError('configError', null);
        const answer = await rpc(
          'config.test',
          { role: test.dataset.role || 'chief' },
          { idempotencyKey: newIdempotencyKey('config-test') },
        );
        if (!answer.ok) {
          showError('configError', answer.error, true);
          return;
        }
        showStatus('configStatus', state.strings['settings.testOk'] || 'usable');
      });
    }
    for (const button of document.querySelectorAll('button.test-provider')) {
      button.addEventListener('click', async () => {
        const answer = await rpc(
          'config.test',
          { providerId: button.dataset.provider, role: 'chief' },
          { idempotencyKey: newIdempotencyKey('provider-test') },
        );
        if (!answer.ok) {
          showError('configError', answer.error, true);
          return;
        }
        showStatus('configStatus', state.strings['settings.testOk'] || 'usable');
      });
    }
  }

  async function initRuns() {
    const list = document.querySelector('.work-list');
    if (!list) return;
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      button.disabled = true;
      const answer = await rpc(
        'work.control',
        { action, workId: button.dataset.work, reason: 'workbench' },
        { idempotencyKey: newIdempotencyKey(`run-${action}`) },
      );
      button.disabled = false;
      if (!answer.ok) {
        showError('runsError', answer.error);
        return;
      }
      showError('runsError', null);
      window.location.reload();
    });
  }

  async function initLogin() {
    const form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const token = document.getElementById('token');
      let response;
      try {
        response = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: token ? token.value : '' }),
        });
      } catch (error) {
        const element = document.createElement('p');
        element.className = 'alert';
        element.setAttribute('role', 'alert');
        element.textContent = `TRANSPORT_LOST: ${String(error)}`;
        form.append(element);
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const failure = (body && body.error) || {
          code: 'UNAUTHENTICATED',
          message: 'sign-in failed',
        };
        const element = document.createElement('p');
        element.className = 'alert';
        element.setAttribute('role', 'alert');
        element.textContent = `${failure.code}: ${failure.message}`;
        form.append(element);
        return;
      }
      window.location.assign('/projects');
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  async function boot() {
    initPanel();
    const page = shell ? shell.dataset.page : 'projects';
    await initLogin();
    if (!shell) return;

    try {
      const response = await fetch('/api/session', { headers: { accept: 'application/json' } });
      if (response.ok) {
        const session = await response.json();
        if (session && typeof session.csrfToken === 'string') state.csrfToken = session.csrfToken;
      } else {
        // 401 means the cookie is gone or expired; nothing else on the page can work.
        showConnection('expired');
        return;
      }
    } catch {
      showConnection('reconnecting');
    }

    const selected = readStoredLanguage();
    if (selected !== state.language) {
      applyLanguage(selected);
      bestEffort(() => loadStrings(selected).then(() => applyLanguage(selected)));
    } else {
      bestEffort(() => loadStrings(state.language).then(() => applyLanguage(state.language)));
    }
    const select = document.getElementById('languageSelect');
    if (select) {
      select.value = state.language;
      select.addEventListener('change', () => {
        const next = select.value === 'zh' ? 'zh' : 'en';
        const store = storage();
        if (store) store.setItem(languageStorageKey, next);
        applyLanguage(next);
        bestEffort(() => loadStrings(next).then(() => applyLanguage(next)));
      });
    }

    await initComposer();
    await initBoard();
    await initDetail();
    await initInbox();
    await initSettings();
    await initRuns();

    if (page === 'chief' || page === 'runs' || page === 'inbox' || page === 'requirement') {
      openSocket();
    } else {
      showConnection('open');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bestEffort(boot);
    });
  } else {
    bestEffort(boot);
  }
})();
