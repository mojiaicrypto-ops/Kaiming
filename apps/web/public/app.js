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
  /**
   * The one bounded reconnect policy in this repository (`packages/client`
   * `connection.ts` uses the same 1s/2s/4s…30s ladder and a finite attempt count);
   * the browser script copies it so the UI cannot retry forever (W9R1-10).
   */
  const reconnectPolicy = {
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    maxAttempts: 6,
  };

  /**
   * The interface dictionary the server embedded in `#uiStrings`.
   *
   * The daemon's `ui.translate` catalogue is smaller than the workbench dictionary,
   * so the client keeps its own copy for both locales. A language switch inside the
   * page then translates every string the client owns — including the `aria.*` labels
   * and the dynamic Live-panel state text — instead of leaving the server-rendered
   * wording in place (WP-12 T4, T7a gap). It carries interface strings only.
   */
  function readClientDictionary() {
    const island = document.getElementById('uiStrings');
    if (!island) return { en: {}, zh: {} };
    try {
      const parsed = JSON.parse(island.textContent || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          en: parsed.en && typeof parsed.en === 'object' ? parsed.en : {},
          zh: parsed.zh && typeof parsed.zh === 'object' ? parsed.zh : {},
        };
      }
    } catch {
      // A malformed island falls back to the daemon catalogue and the server text.
    }
    return { en: {}, zh: {} };
  }

  const state = {
    language: shell ? shell.dataset.language || 'en' : 'en',
    csrfToken: null,
    connection: 'connecting',
    watermark: 0,
    subscription: null,
    socket: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    strings: {},
    dictionary: readClientDictionary(),
  };

  /**
   * One interface string from the client dictionary.
   *
   * The result is deterministic: the key itself is the last resort, never a stale
   * label that was read back from the DOM (the T7a AC-071 regression).
   */
  function translateClient(key) {
    const dictionary = state.dictionary[state.language] || state.dictionary.en || {};
    const value = dictionary[key];
    return typeof value === 'string' && value !== '' ? value : key;
  }

  /**
   * The cookie the server reads to render the first paint in the chosen language
   * (`experience.md` §6: the interface language is a device-local choice that must
   * survive a reload). `SameSite=Lax` matches the BFF's own browser session cookie.
   */
  function languageCookie(language) {
    return `agentdev_language=${language}; path=/; max-age=31536000; SameSite=Lax`;
  }

  /**
   * The `aria-label` for one Live-panel mode.
   *
   * It is computed from the dictionaries alone; reading the element's current label
   * back would keep the previous mode's name after a switch (`data-mode="compact"`
   * with `aria-label="Live panel, open"`), which is the accessible-name lie the real
   * browser suite caught.
   */
  function panelAriaLabel(key, language, strings, dictionary) {
    const fromDictionary = (dictionary[language] || {})[key];
    if (typeof fromDictionary === 'string' && fromDictionary !== '') return fromDictionary;
    const fromStrings = strings[key];
    if (typeof fromStrings === 'string' && fromStrings !== '') return fromStrings;
    return key;
  }

  /**
   * The request one requirement action issues (`protocol.md` §4/§5).
   *
   * `complete` and `archive` are lifecycle writes: `complete` goes through
   * `requirement.save` and `archive` through the documented `requirement.archive`
   * command, while `pause`/`resume`/`cancel` are `work.control` actions. Every
   * outcome is the server's: the caller only renames the command, never the state.
   */
  function boardActionRequest(action, data) {
    const requirementId = typeof data.requirement === 'string' ? data.requirement : '';
    const workId = typeof data.work === 'string' ? data.work : '';
    const reason =
      typeof data.reason === 'string' && data.reason !== '' ? data.reason : 'workbench';
    switch (action) {
      case 'continue':
        return { ok: true, method: 'requirement.continue', params: { requirementId } };
      case 'complete':
        return {
          ok: true,
          method: 'requirement.save',
          params: { requirementId, patch: { lifecycle: 'completed' } },
        };
      case 'archive':
        return { ok: true, method: 'requirement.archive', params: { requirementId } };
      case 'pause':
      case 'resume':
      case 'cancel':
        return {
          ok: true,
          method: 'work.control',
          params: {
            action,
            reason,
            // A Queued requirement with no local Work cancels by requirement id; a
            // Work-scoped action names the Work (`AC-068`).
            ...(workId === '' ? { requirementId } : { workId }),
          },
        };
      default:
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `unknown requirement action ${String(action)}`,
          },
        };
    }
  }

  /**
   * The command one Inbox action issues (`protocol.md` §4).
   *
   * A `product` decision's choice is `decision.resolve` with the saved option. A
   * `permission` row's approve/deny pair goes through `permission.respond`, which is
   * what mints the bound Grant; the daemon resolves the real binding from the
   * recorded tool operation, so the client never restates an operation it was not
   * shown. A denial must record a reason and is refused locally before any request
   * when the operator left it empty. A user todo closes through `chief.todo.resolve`,
   * which only acknowledges the item — it authorizes no tool call.
   */
  function inboxActionRequest(action, data) {
    const disposition = typeof data.disposition === 'string' ? data.disposition : '';
    if (disposition !== '') {
      const todoId = typeof data.todo === 'string' ? data.todo : '';
      const workId = typeof data.work === 'string' ? data.work : '';
      if (
        (disposition !== 'handled' && disposition !== 'dismissed') ||
        todoId === '' ||
        workId === ''
      ) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `unknown todo action ${String(action)}`,
          },
        };
      }
      const note = typeof data.reason === 'string' ? data.reason.trim() : '';
      return {
        ok: true,
        method: 'chief.todo.resolve',
        params: {
          workId,
          todoId,
          disposition,
          ...(note === '' ? {} : { reason: note }),
        },
      };
    }
    const decisionId = typeof data.decision === 'string' ? data.decision : '';
    const choice = typeof data.choice === 'string' ? data.choice : '';
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    if (decisionId === '') {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'the decision id is missing' },
      };
    }
    if (data.permission === true) {
      if (choice !== 'approve' && choice !== 'deny') {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `unknown permission action ${String(action)}`,
          },
        };
      }
      if (choice === 'deny' && reason === '') {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'a denial must record a reason',
            reasonRequired: true,
          },
        };
      }
      return {
        ok: true,
        method: 'permission.respond',
        params: { decisionId, choice, ...(reason === '' ? {} : { reason }) },
      };
    }
    if (choice === '') {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'the choice is missing' } };
    }
    // An L3 confirmation (AC-011) answers through the same `decision.resolve`, but
    // declining it is a real refusal of a high-risk delivery, so it carries the same
    // required-reason rule as a denial (`experience.md` §5).
    if (data.l3Confirmation === true && choice === 'decline' && reason === '') {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'declining an L3 confirmation must record a reason',
          reasonRequired: true,
          reasonKey: 'inbox.l3DeclineReasonRequired',
        },
      };
    }
    return {
      ok: true,
      method: 'decision.resolve',
      params: {
        decisionId,
        choice,
        ...(data.l3Confirmation === true && reason !== '' ? { reason } : {}),
      },
    };
  }

  /** Exponential backoff with the policy's ceiling; never below the base delay. */
  function reconnectDelay(attempt) {
    const exponent = Math.max(0, attempt - 1);
    return Math.min(reconnectPolicy.maxDelayMs, reconnectPolicy.baseDelayMs * 2 ** exponent);
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
    // The choice must survive a reload: the BFF renders the first paint from this
    // cookie, so the whole page — not only the strings the server catalogue knows —
    // comes back in the chosen language (`experience.md` §6).
    try {
      document.cookie = languageCookie(language);
    } catch {
      // A document with cookies blocked still switches in memory for this page.
    }
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
    // The Plan gate can refuse after the page was rendered (the gate moved between
    // render and click), and the refusal carries a reason code, not a sentence: the
    // code's interface strings are fetched unconditionally so the failure message is
    // localised too (W9R2-05).
    for (const key of [
      'detail.approveReason.no_plan',
      'detail.approveReason.stale_version',
      'detail.approveReason.gate_not_approved',
      'detail.approveReason.plan_unreadable',
      'detail.approveReason.no_authorization',
      'detail.approveReason.authorization_unreadable',
      'detail.approveReason.gate_unavailable',
      'detail.approveExpired',
      'detail.approveUnavailable',
    ]) {
      keys.add(key);
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
    // The daemon's catalogue is the remote contract, but the workbench dictionary is
    // the UI's own wording; where both know a key the dictionary wins, so a switch
    // cannot quietly replace the server-rendered word with a different one. The
    // daemon answer still fills any key the local dictionary does not carry.
    state.strings = { ...resolved, ...(state.dictionary[language] || {}) };
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
      open: state.strings['connection.open'] || translateClient('connection.open'),
      connecting:
        state.strings['connection.connecting'] || translateClient('connection.connecting'),
      reconnecting:
        state.strings['connection.reconnecting'] || translateClient('connection.reconnecting'),
      closed: state.strings['connection.closed'] || translateClient('connection.closed'),
      expired: state.strings['connection.expired'] || translateClient('connection.expired'),
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
        panelAriaLabel(key, state.language, state.strings, state.dictionary),
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
    if (close) {
      close.addEventListener('click', () => {
        setPanelMode('compact');
        // `experience.md` §6: closing the narrow-screen overlay returns focus to the
        // top-bar control that opened it; doing it on every viewport keeps the
        // keyboard path identical (AC-071).
        if (toggle) toggle.focus();
      });
    }
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
      // WP-12 T5 D-T5-5: the socket is bound to the page's project at handshake
      // time, so a cursor can never be replayed against another project's stream.
      const bound = shell.dataset.project
        ? `?projectId=${encodeURIComponent(shell.dataset.project)}`
        : '';
      socket = new WebSocket(`${scheme}//${window.location.host}/ws${bound}`);
    } catch {
      showConnection('reconnecting');
      return;
    }
    state.socket = socket;
    socket.addEventListener('open', () => {
      showConnection('open');
      // A successful open resets the ladder: the next break starts at 1s again.
      state.reconnectAttempt = 0;
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
        showProviderTestEvent(frame);
        appendLive({
          cursor: typeof frame.cursor === 'number' ? frame.cursor : 0,
          name: typeof frame.name === 'string' ? frame.name : 'event',
          entityId: typeof frame.entityId === 'string' ? frame.entityId : '',
        });
        handleInboxEvent(frame);
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
      // The same bounded backoff policy the `@agentdev/client` connection uses:
      // 1s, 2s, 4s … capped at 30s and at a finite number of attempts, so a browser
      // never spins forever on a fixed 2s timer (`AC-078`, W9R1-10).
      state.reconnectAttempt += 1;
      if (state.reconnectAttempt > reconnectPolicy.maxAttempts) {
        showConnection('closed');
        return;
      }
      const delay = reconnectDelay(state.reconnectAttempt);
      state.reconnectTimer = window.setTimeout(openSocket, delay);
    });
    socket.addEventListener('error', () => showConnection('reconnecting'));
  }

  function send(frame) {
    const socket = state.socket;
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(frame));
  }

  // ---------------------------------------------------------------------------
  // Provider editor (WP-12 T1.2b, `protocol.md` §5)
  // ---------------------------------------------------------------------------

  /** Provider ids with a connection test in flight, so its event finds the form. */
  const pendingProviderTests = new Map();

  /**
   * Builds the `provider.upsert` parameters from one editor's values.
   *
   * `protocol.md` §5: the command takes `provider: ProviderInput` plus the secret
   * value separately, and `secretRef` is server-created. A blank secret therefore
   * omits the key entirely — it means "keep the stored credential", never "write an
   * empty credential". The returned object is the only place the typed value goes;
   * it is never written back to the DOM, a `data-*` attribute or a status line.
   *
   * Pure on purpose: no DOM, no globals, so the shipped source can be executed by
   * the client-script test exactly as it runs in the browser.
   */
  function providerUpsertParams(input) {
    const providerId = typeof input.providerId === 'string' ? input.providerId.trim() : '';
    const type = typeof input.type === 'string' ? input.type : '';
    const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
    const modelsText = typeof input.models === 'string' ? input.models : '';
    if (['openai-compatible', 'anthropic', 'google'].indexOf(type) === -1) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'the provider type must be openai-compatible, anthropic or google',
        },
      };
    }
    if (baseUrl === '') {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'the provider needs a base URL' },
      };
    }
    let models;
    try {
      models = JSON.parse(modelsText === '' ? '[]' : modelsText);
    } catch {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'the models field is not valid JSON' },
      };
    }
    if (!Array.isArray(models)) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'the models field must be a JSON array of ModelDescriptor objects',
        },
      };
    }
    const provider = { type, baseUrl, enabled: input.enabled === true, models };
    // An absent `providerId` asks the server to create one (`ProviderInput`).
    if (providerId !== '') provider.providerId = providerId;
    const params = { provider };
    if (typeof input.secret === 'string' && input.secret.length > 0) params.secret = input.secret;
    return { ok: true, params };
  }

  /**
   * Reads a `provider.test_completed` event's summary (`protocol.md` §5/§7).
   *
   * The event shape is the daemon's; every field is read defensively and an
   * outcome the UI cannot classify stays `null` — it is never rendered as success.
   */
  function providerTestOutcome(data) {
    const accepted =
      typeof data.accepted === 'boolean'
        ? data.accepted
        : typeof data.ok === 'boolean'
          ? data.ok
          : null;
    const detail = [];
    if (typeof data.modelId === 'string' && data.modelId !== '')
      detail.push(`modelId: ${data.modelId}`);
    if (typeof data.latencyMs === 'number') detail.push(`latencyMs: ${String(data.latencyMs)}`);
    if (typeof data.error === 'string' && data.error !== '') detail.push(data.error);
    return { accepted, detail: detail.join(' · ') };
  }

  function showProviderError(editor, failure, preserve) {
    const element = editor.querySelector('[data-role="error"]');
    if (!element) return;
    if (!failure) {
      element.hidden = true;
      element.textContent = '';
      return;
    }
    const code = failure.code || 'INTERNAL_ERROR';
    element.hidden = false;
    element.dataset.code = code;
    // The refusal never quotes the typed value: only the code, the server's message
    // and the fact that the input was kept.
    element.textContent = `${code}: ${failure.message || ''}${preserve ? ' — input preserved' : ''}`;
  }

  /** Shows one of the editor's pre-rendered result lines in the active language. */
  function showProviderResult(editor, role) {
    const result = editor.querySelector('.provider-result');
    if (result) result.hidden = false;
    for (const name of ['saved', 'test-accepted', 'test-completed']) {
      const line = editor.querySelector(`[data-role="${name}"]`);
      if (line) line.hidden = name !== role;
    }
  }

  /** The editor for one provider id, or `null` when the page has no such row. */
  function providerEditorFor(providerId) {
    for (const editor of document.querySelectorAll('form.provider-form')) {
      if (editor.dataset.provider === providerId) return editor;
    }
    return null;
  }

  /** Renders a completed connection test into its editor. */
  function showProviderTestEvent(frame) {
    if (frame.name !== 'provider.test_completed') return;
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const providerId =
      typeof data.providerId === 'string'
        ? data.providerId
        : typeof frame.entityId === 'string'
          ? frame.entityId
          : '';
    if (providerId === '') return;
    const pending = pendingProviderTests.get(providerId);
    const editor = pending ? pending.form : providerEditorFor(providerId);
    if (!editor) return;
    pendingProviderTests.delete(providerId);
    const outcome = providerTestOutcome(data);
    showProviderResult(editor, 'test-completed');
    const ok = editor.querySelector('[data-role="test-ok"]');
    const failed = editor.querySelector('[data-role="test-failed"]');
    if (ok) ok.hidden = outcome.accepted !== true;
    if (failed) failed.hidden = outcome.accepted !== false;
    const detail = editor.querySelector('[data-role="test-detail"]');
    if (detail) detail.textContent = outcome.detail;
  }

  /** Re-points the model-to-test select at the models just saved. */
  function fillProviderTestModels(editor, models) {
    const select = editor.querySelector('.provider-test-model');
    if (!select) return;
    const ids = models
      .map((model) => (model && typeof model.id === 'string' ? model.id : ''))
      .filter((id) => id !== '');
    select.replaceChildren(
      ...ids.map((id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = id;
        return option;
      }),
    );
    const hasModel = ids.length > 0;
    select.disabled = !hasModel;
    select.setAttribute('aria-disabled', String(!hasModel));
    const button = editor.querySelector('button.provider-test');
    if (button) {
      button.disabled = !hasModel;
      button.setAttribute('aria-disabled', String(!hasModel));
    }
  }

  /**
   * Wires one provider editor to `provider.upsert` / `provider.test`.
   *
   * Hard rules (WP-12 T1.2b): no local success path, a rejection keeps every typed
   * input, and a successful save reports only `secretConfigured` and the new
   * version before clearing the password field.
   */
  function initProviderEditor(editor) {
    const field = (name) => {
      const element = editor.querySelector(`[data-field="${name}"]`);
      return element && typeof element.value === 'string' ? element.value : '';
    };
    const secretField = editor.querySelector('[data-field="secret"]');
    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      showProviderError(editor, null);
      const enabledField = editor.querySelector('[data-field="enabled"]');
      const built = providerUpsertParams({
        providerId: field('providerId'),
        type: field('type'),
        baseUrl: field('baseUrl'),
        enabled: enabledField ? enabledField.checked === true : false,
        models: field('models'),
        secret: secretField ? secretField.value : '',
      });
      if (!built.ok) {
        showProviderError(editor, built.error, true);
        return;
      }
      const answer = await rpc('provider.upsert', built.params, {
        idempotencyKey: newIdempotencyKey('provider-upsert'),
      });
      if (!answer.ok) {
        // Every field — the API key included — keeps exactly what the operator typed.
        showProviderError(editor, answer.error, true);
        return;
      }
      const result = answer.result && typeof answer.result === 'object' ? answer.result : {};
      const configured = result.secretConfigured === true;
      const version = typeof result.version === 'number' ? String(result.version) : '?';
      showProviderResult(editor, 'saved');
      const detail = editor.querySelector('[data-role="saved-detail"]');
      // Only the boolean and the version are shown; the value itself has no place
      // in a status line (`reliability.md` §6).
      if (detail)
        detail.textContent = `secretConfigured: ${String(configured)} · version ${version}`;
      // A successful write is the one moment the typed key is no longer needed, so
      // it is cleared rather than kept in the page.
      if (secretField) secretField.value = '';
      if (Array.isArray(built.params.provider.models)) {
        fillProviderTestModels(editor, built.params.provider.models);
      }
      if (typeof result.providerId === 'string' && result.providerId !== '') {
        editor.dataset.provider = result.providerId;
        const idField = editor.querySelector('[data-field="providerId"]');
        if (idField && idField.value === '') idField.value = result.providerId;
      }
    });

    const testButton = editor.querySelector('button.provider-test');
    if (testButton) {
      testButton.addEventListener('click', async () => {
        showProviderError(editor, null);
        const select = editor.querySelector('.provider-test-model');
        const modelId = select ? select.value : '';
        const providerId = editor.dataset.provider || '';
        if (providerId === '' || modelId === '') {
          showProviderError(
            editor,
            {
              code: 'VALIDATION_ERROR',
              message: 'a provider id and a model id are needed to test the connection',
            },
            true,
          );
          return;
        }
        testButton.disabled = true;
        const answer = await rpc(
          'provider.test',
          { providerId, modelId },
          { idempotencyKey: newIdempotencyKey('provider-test') },
        );
        testButton.disabled = false;
        if (!answer.ok) {
          showProviderError(editor, answer.error, true);
          return;
        }
        if (answer.result && answer.result.accepted === false) {
          // `provider.test` answers `accepted` (`protocol.md` §5): a refusal is a
          // result, never rendered as "the test is running".
          showProviderResult(editor, 'test-completed');
          const ok = editor.querySelector('[data-role="test-ok"]');
          const failed = editor.querySelector('[data-role="test-failed"]');
          if (ok) ok.hidden = true;
          if (failed) failed.hidden = false;
          return;
        }
        pendingProviderTests.set(providerId, { form: editor, modelId });
        // `accepted` is the command's whole answer; the outcome is a persistent
        // event, so the UI states both instead of pretending the result is in.
        showProviderResult(editor, 'test-accepted');
      });
    }
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
    // The client owns these limit messages (`chief.attachment*`), and the daemon's
    // `ui.translate` catalogue does not carry them, so the local dictionary is the
    // deterministic source — the T7a gap showed the raw key here.
    showError('composerError', {
      code: 'VALIDATION_ERROR',
      message: state.strings[reasonKey] || translateClient(reasonKey),
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
      // Q6: artifact URLs carry the project explicitly under the single BFF origin.
      // There is no fallback: without a project id the request is refused rather than
      // routed from implicit "current project" state.
      if (!shell || !shell.dataset.project) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'no project is bound to this page' },
        };
      }
      const prefix = `/artifacts/${encodeURIComponent(shell.dataset.project)}`;
      response = await fetch(`${prefix}/upload`, {
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
    item.textContent = `${name} · ${state.strings['chief.attachmentStaged'] || translateClient('chief.attachmentStaged')}`;
    list.append(item);
  }

  // ---------------------------------------------------------------------------
  // Chief conversations (AC-072)
  // ---------------------------------------------------------------------------

  /**
   * Creates a real conversation through `conversation.create` and opens it.
   *
   * `experience.md` §1 keeps creation and switching on the Chief page; the control
   * therefore drives the daemon method that exists instead of being a dead button.
   */
  async function createConversation(trigger) {
    const projectId = shell ? shell.dataset.project : '';
    if (!projectId) return;
    const titleElement = document.getElementById('composerBody');
    const title = titleElement && titleElement.value.trim() !== '' ? titleElement.value.trim() : '';
    if (trigger) trigger.disabled = true;
    const answer = await rpc(
      'conversation.create',
      { ...(title === '' ? {} : { title: title.slice(0, 120) }) },
      { idempotencyKey: newIdempotencyKey('conversation'), projectId },
    );
    if (trigger) trigger.disabled = false;
    if (!answer.ok) {
      showError('conversationError', answer.error);
      return;
    }
    const conversationId =
      answer.result && typeof answer.result.conversationId === 'string'
        ? answer.result.conversationId
        : '';
    if (conversationId === '') {
      showError('conversationError', {
        code: 'INTERNAL_ERROR',
        message: 'the daemon answered without a conversation id',
      });
      return;
    }
    showError('conversationError', null);
    window.location.assign(
      `/projects/${encodeURIComponent(projectId)}/chief?conversationId=${encodeURIComponent(conversationId)}`,
    );
  }

  async function initConversations() {
    const page = shell ? shell.dataset.page : '';
    // A conversation control exists only on the Chief page; every other page links
    // to Chief instead of offering a button that cannot act (`experience.md` §1).
    if (page !== 'chief') return;
    for (const id of ['newConversation', 'newConversationInline']) {
      const button = document.getElementById(id);
      if (button)
        button.addEventListener('click', () => bestEffort(() => createConversation(button)));
    }
    const select = document.getElementById('conversationSelect');
    if (select) {
      select.addEventListener('change', () => {
        const projectId = shell ? shell.dataset.project : '';
        if (!projectId || !select.value) return;
        window.location.assign(
          `/projects/${encodeURIComponent(projectId)}/chief?conversationId=${encodeURIComponent(select.value)}`,
        );
      });
    }
    const switchButton = document.getElementById('switchConversation');
    if (switchButton) {
      switchButton.addEventListener('click', () => {
        const expanded = switchButton.getAttribute('aria-expanded') === 'true';
        switchButton.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        const target = document.getElementById('conversationSelect');
        if (target) target.focus();
      });
    }
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
        stateLabel.textContent =
          state.strings['state.received'] || translateClient('state.received');
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

  /**
   * Runs one requirement action through its real command (`protocol.md` §4/§5).
   *
   * The handler never writes a state of its own: a refusal renders the protocol code
   * and message beside the card, the button returns to its rendered state, and the
   * card keeps the values it was rendered from. Only an accepted answer reloads, so
   * the new state is read back from the server rather than assumed.
   */
  async function runRequirementAction(button, errorId) {
    const action = button.dataset.action || '';
    if (button.dataset.refused) {
      // Pausing a Queued requirement with no local Work is the documented refusal;
      // it is shown from the server's own rule flag, without a request (AC-068).
      showError(errorId, {
        code: button.dataset.refused,
        message:
          state.strings['board.pauseQueuedRefused'] || translateClient('board.pauseQueuedRefused'),
      });
      return;
    }
    const built = boardActionRequest(action, {
      requirement: button.dataset.requirement,
      work: button.dataset.work,
      reason: 'workbench',
    });
    if (!built.ok) {
      showError(errorId, built.error);
      return;
    }
    const options = { idempotencyKey: newIdempotencyKey(`requirement-${action}`) };
    // `work.control` compares `expectedVersion` with the target Work (`protocol.md`
    // §1), so the version the card was rendered from travels with the request.
    if (built.method === 'work.control' && button.dataset.workVersion) {
      const version = Number(button.dataset.workVersion);
      if (Number.isInteger(version)) options.expectedVersion = version;
    }
    button.disabled = true;
    const answer = await rpc(built.method, built.params, options);
    button.disabled = false;
    if (!answer.ok) {
      showError(errorId, answer.error);
      return;
    }
    showError(errorId, null);
    window.location.reload();
  }

  async function initBoard() {
    const board = document.getElementById('board');
    if (!board) return;
    board.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      await runRequirementAction(button, 'boardError');
    });
  }

  async function initDetail() {
    const actions = document.getElementById('detailActions');
    if (actions) {
      actions.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        await runRequirementAction(button, 'detailError');
      });
    }
    const approve = document.getElementById('approvePlan');
    if (approve) {
      approve.addEventListener('click', async () => {
        if (approve.disabled) return;
        showError('approveError', null);
        approve.disabled = true;
        const planVersion = Number(approve.dataset.planVersion || '0');
        // The Plan body and the local authorization are read from the gate first:
        // the page cannot invent them, and sending an empty body or a made-up
        // authorizationRef is exactly what made every approval fail (W9R1-01).
        const current = await rpc('plan.current', {
          workId: approve.dataset.work,
          revision: approve.dataset.planRevision,
          planVersion,
        });
        if (!current.ok) {
          approve.disabled = false;
          showError('approveError', current.error);
          return;
        }
        const gate = current.result || {};
        const approval = gate.approval || {};
        if (gate.current !== true || approval.enabled !== true) {
          // The button is disabled before the click as well; this branch is the
          // race where the gate moved between render and click.
          approve.disabled = true;
          approve.setAttribute('aria-disabled', 'true');
          const reasonCode = typeof approval.reasonCode === 'string' ? approval.reasonCode : '';
          const reasonKey = reasonCode ? 'detail.approveReason.' + reasonCode : '';
          showError('approveError', {
            code: gate.current === true ? 'INVALID_STATE' : 'VERSION_CONFLICT',
            // The interface string wins over the daemon's English diagnostic, which
            // is only a fallback for a code the catalogue does not know (W9R2-05).
            message:
              (reasonKey && (state.strings[reasonKey] || translateClient(reasonKey))) ||
              state.strings['detail.approveExpired'] ||
              translateClient('detail.approveExpired') ||
              approval.reason ||
              'approval unavailable',
          });
          return;
        }
        const authorizationId =
          gate.authorizationId || (gate.plan && gate.plan.authorizationRef) || '';
        const runId = gate.runId || '';
        if (!gate.plan || authorizationId === '' || runId === '') {
          approve.disabled = true;
          approve.setAttribute('aria-disabled', 'true');
          showError('approveError', {
            code: 'INVALID_STATE',
            message:
              state.strings['detail.approveUnavailable'] ||
              translateClient('detail.approveUnavailable'),
          });
          return;
        }
        const answer = await rpc(
          'plan.approve',
          {
            workId: approve.dataset.work,
            revision: approve.dataset.planRevision,
            planVersion,
            plan: gate.plan,
            approval: {
              authorizationRef: authorizationId,
              runId,
              productChanged: false,
            },
          },
          { idempotencyKey: newIdempotencyKey('plan'), expectedVersion: planVersion },
        );
        if (!answer.ok) {
          approve.disabled = false;
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
                plan.dataset.approvable = 'false';
              }
            }
            return;
          }
          showError('approveError', answer.error);
          return;
        }
        // The approval created the next version, so the card the user was looking at
        // is superseded now: it stays disabled instead of pretending the same version
        // can be approved twice.
        approve.disabled = true;
        approve.setAttribute('aria-disabled', 'true');
        const plan = document.getElementById('plan');
        if (plan) {
          plan.dataset.approvable = 'false';
          plan.dataset.expired = 'true';
          if (typeof answer.result?.version === 'number') {
            plan.dataset.currentVersion = String(answer.result.version);
          }
        }
        showStatus(
          'approveStatus',
          state.strings['settings.saved'] || translateClient('settings.saved'),
        );
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
        if (!shell || !shell.dataset.project) {
          showError('approveError', {
            code: 'VALIDATION_ERROR',
            message: 'no project is bound to this page',
          });
          return;
        }
        const prefix = `/artifacts/${encodeURIComponent(shell.dataset.project)}`;
        window.location.assign(`${prefix}/download/${answer.result.downloadToken}`);
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

  // ---------------------------------------------------------------------------
  // Inbox: decisions, tool permissions and their live updates (AC-074)
  // ---------------------------------------------------------------------------

  /**
   * The permission bindings learned from the live event stream, keyed by tool
   * operation id.
   *
   * `protocol.md` §7: a refused call emits `tool.refused` whose `entityId` is the
   * `toolOperationId` and whose change summary carries the operation, targets, input
   * hash and Run; a `permission` decision's `targetRef.id` is that same operation id
   * (`protocol.md` §4). The map therefore lets a request that arrives while the page
   * is open say exactly what will be granted. A pending request the page never saw an
   * event for keeps its "binding not reported" notice instead of guessing.
   */
  const permissionBindings = new Map();

  /** The Inbox-relevant persistent events (`protocol.md` §7). */
  const inboxEvents = [
    'decision.created',
    'decision.resolved',
    'permission.resolved',
    'state.decision_required',
    // A refused sensitive file files a user todo; the row must appear without a
    // manual reload (`protocol.md` §7 `chief_action_required`). Its closing event is
    // mirrored too, so a second tab drops the row as well.
    'chief_action_required',
    'chief.todo_resolved',
  ];

  function rememberToolRefusal(frame) {
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    if (typeof frame.entityId !== 'string' || frame.entityId === '') return;
    permissionBindings.set(frame.entityId, {
      operation: typeof data.operation === 'string' ? data.operation : '',
      targets: Array.isArray(data.targets) ? data.targets.map(String) : [],
      inputHash: typeof data.inputHash === 'string' ? data.inputHash : '',
      runId: typeof data.runId === 'string' ? data.runId : '',
    });
    applyPermissionBindings();
  }

  function setBindingText(row, name, text) {
    for (const element of row.querySelectorAll(`[data-binding-${name}]`)) {
      element.textContent = text;
    }
  }

  /** Fills the reported binding into its row and enables the deliberate approval. */
  function applyPermissionBindings() {
    const list = document.getElementById('inboxList');
    if (!list) return;
    for (const row of list.querySelectorAll('[data-entry="permission"]')) {
      const binding = permissionBindings.get(row.dataset.toolOperation || '');
      if (!binding || binding.operation === '') continue;
      setBindingText(row, 'operation', binding.operation);
      setBindingText(
        row,
        'targets',
        binding.targets.length === 0
          ? translateClient('inbox.noTargets')
          : binding.targets.join(', '),
      );
      setBindingText(row, 'input-hash', binding.inputHash);
      setBindingText(row, 'run', binding.runId);
      row.dataset.bindingMissing = 'false';
      const notice = row.querySelector('[data-binding-notice]');
      if (notice) notice.hidden = true;
      // An expired decision stays disabled even with a known binding.
      if (row.getAttribute('aria-disabled') !== 'true') {
        for (const button of row.querySelectorAll('button[data-permission="approve"]')) {
          button.disabled = false;
          button.removeAttribute('aria-disabled');
        }
      }
    }
  }

  /**
   * Re-reads the Inbox list from the server and re-applies the live bindings.
   *
   * The server render stays the single source of truth (`experience.md` §7): the page
   * is fetched again — a GET, so a running Run is untouched — and only the list region
   * is replaced, which keeps the Live dock, the scroll position and the learned
   * bindings without a manual reload.
   */
  async function refreshInbox() {
    const list = document.getElementById('inboxList');
    if (!list) return false;
    let response;
    try {
      response = await fetch(window.location.pathname, { headers: { accept: 'text/html' } });
    } catch (error) {
      showError('inboxRefreshError', {
        code: 'TRANSPORT_LOST',
        message: `${translateClient('inbox.refreshFailed')} ${String(error)}`,
      });
      return false;
    }
    if (!response.ok) {
      showError('inboxRefreshError', {
        code: 'INTERNAL_ERROR',
        message: translateClient('inbox.refreshFailed'),
      });
      return false;
    }
    // The fetched document is parsed into a detached element: no script runs, and the
    // server's own markup is the only thing read back out of it.
    const parsed = document.createElement('div');
    parsed.innerHTML = await response.text();
    const fresh = parsed.querySelector('#inboxList');
    if (!fresh) return false;
    list.innerHTML = fresh.innerHTML;
    list.dataset.unread = fresh.dataset.unread || '0';
    const empty = document.getElementById('inboxEmpty');
    if (empty) empty.hidden = list.children.length > 0;
    const badge = document.getElementById('inboxBadge');
    if (badge) {
      const unread = Number(list.dataset.unread || '0');
      badge.textContent = String(unread);
      badge.hidden = unread <= 0;
    }
    showError('inboxRefreshError', null);
    applyPermissionBindings();
    return true;
  }

  /** Routes one live event to the Inbox's own state (`protocol.md` §7). */
  function handleInboxEvent(frame) {
    if (!document.getElementById('inboxList')) return;
    if (frame.name === 'tool.refused') {
      rememberToolRefusal(frame);
      return;
    }
    if (inboxEvents.indexOf(frame.name) < 0) return;
    bestEffort(refreshInbox);
  }

  function disableInboxRow(list, decisionId) {
    for (const sibling of list.querySelectorAll('button[data-choice], button[data-permission]')) {
      if (sibling.dataset.decision === decisionId) {
        sibling.disabled = true;
        sibling.setAttribute('aria-disabled', 'true');
      }
    }
  }

  /** Disables both closing actions of one todo row after a state refusal (AC-074). */
  function disableTodoRow(list, todoId) {
    for (const sibling of list.querySelectorAll('button[data-todo-disposition]')) {
      if (sibling.dataset.todo === todoId) {
        sibling.disabled = true;
        sibling.setAttribute('aria-disabled', 'true');
      }
    }
  }

  async function initInbox() {
    const inbox = document.getElementById('inbox');
    const list = document.getElementById('inboxList');
    if (!inbox || !list) return;
    applyPermissionBindings();
    inbox.addEventListener('click', async (event) => {
      const todoButton = event.target.closest('button[data-todo-disposition]');
      const button =
        todoButton ?? event.target.closest('button[data-choice], button[data-permission]');
      if (!button || button.disabled) return;
      const todoAction = todoButton ? todoButton.dataset.todoDisposition : undefined;
      const permission = typeof button.dataset.permission === 'string';
      const choice =
        todoAction !== undefined
          ? todoAction
          : permission
            ? button.dataset.permission
            : button.dataset.choice;
      const row = button.closest('.inbox-row');
      const reasonField = row
        ? row.querySelector(
            todoAction === undefined
              ? '[data-permission-reason], [data-l3-reason]'
              : '[data-todo-reason]',
          )
        : null;
      const built = inboxActionRequest(choice, {
        decision: button.dataset.decision,
        choice,
        permission,
        l3Confirmation: row !== null && row.dataset.l3Confirmation === 'true',
        disposition: todoAction,
        todo: button.dataset.todo,
        work: button.dataset.work,
        reason: reasonField ? reasonField.value : '',
      });
      if (!built.ok) {
        // A denial without a reason never reaches the server: the entry keeps its
        // text and the operator is told what the command needs.
        showError('inboxError', {
          code: built.error.code,
          message: built.error.reasonRequired
            ? translateClient(built.error.reasonKey || 'inbox.denyReasonRequired')
            : built.error.message,
        });
        return;
      }
      showError('inboxError', null);
      showStatus('inboxStatus', '');
      button.disabled = true;
      // A todo card carries no target version: `expectedVersion` is the Work's, which
      // the page does not hold, so the write is keyed by its idempotency key alone.
      const targetVersion =
        button.dataset.targetVersion === undefined
          ? undefined
          : Number(button.dataset.targetVersion);
      const answer = await rpc(
        built.method,
        { ...built.params, ...(targetVersion === undefined ? {} : { targetVersion }) },
        {
          idempotencyKey: newIdempotencyKey(
            built.method === 'permission.respond'
              ? `permission-${choice}`
              : built.method === 'chief.todo.resolve'
                ? `todo-${choice}`
                : 'decision',
          ),
          expectedVersion: targetVersion,
        },
      );
      button.disabled = false;
      if (!answer.ok) {
        // The refusal is the server's: its code and message are rendered and the
        // entry keeps exactly the state it was rendered from (`experience.md` §7).
        showError('inboxError', answer.error);
        if (answer.error.code === 'INVALID_STATE' || answer.error.code === 'VERSION_CONFLICT') {
          if (todoAction === undefined) disableInboxRow(list, button.dataset.decision);
          else disableTodoRow(list, button.dataset.todo);
        }
        return;
      }
      const denied = built.method === 'permission.respond' && choice === 'deny';
      const key =
        built.method === 'chief.todo.resolve'
          ? 'inbox.todoResolved'
          : built.method === 'decision.resolve' &&
              row !== null &&
              row.dataset.l3Confirmation === 'true'
            ? choice === 'decline'
              ? 'inbox.l3Declined'
              : 'inbox.l3Confirmed'
            : denied
              ? 'inbox.denied'
              : 'inbox.resolved';
      showStatus('inboxStatus', state.strings[key] || translateClient(key));
      // The entry leaves the Inbox because the server says so: the list is read
      // back, and a failed refresh falls back to an honest reload.
      if (!(await refreshInbox())) window.location.reload();
    });
  }

  async function initSettings() {
    const form = document.getElementById('configForm');
    if (form) {
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
        showStatus(
          'configStatus',
          state.strings['settings.saved'] || translateClient('settings.saved'),
        );
        if (answer.result && typeof answer.result.revision === 'number') {
          form.dataset.revision = String(answer.result.revision);
          const meta = document.getElementById('settingsMeta');
          if (meta) {
            meta.dataset.revision = String(answer.result.revision);
            meta.dataset.version = String(answer.result.revision);
          }
        }
      });
    }
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
        showStatus(
          'configStatus',
          state.strings['settings.testOk'] || translateClient('settings.testOk'),
        );
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
        showStatus(
          'configStatus',
          state.strings['settings.testOk'] || translateClient('settings.testOk'),
        );
      });
    }
    for (const editor of document.querySelectorAll('form.provider-form')) {
      initProviderEditor(editor);
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
    await initConversations();
    await initBoard();
    await initDetail();
    await initInbox();
    await initSettings();
    await initRuns();

    if (
      page === 'chief' ||
      page === 'runs' ||
      page === 'inbox' ||
      page === 'requirement' ||
      // The settings page needs the same summary subscription so the persistent
      // `provider.test_completed` event reaches the editor that started the test.
      page === 'settings'
    ) {
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
