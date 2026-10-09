/**
 * Workbench bootstrap: access, project, session, then the shell around the eight views.
 *
 * Order matters: the language and the access check come first (nothing else can be trusted before a
 * session exists), then the project (realpath identity), then a chief session, then the live stream.
 */
import { RpcClient, RpcError, newRequestId } from './core/rpc.js';
import { SessionStream } from './core/stream.js';
import { WorkbenchStore } from './core/store.js';
import { SessionView } from './core/session-view.js';
import { I18n } from './core/i18n.js';
import { Router } from './core/router.js';
import { el, qs } from './core/dom.js';
import { createToast } from './components/toast.js';
import { createDialog } from './components/dialog.js';
import { createLog } from './components/stream/log-line.js';
import { createShell } from './components/shell.js';
import { createChiefView } from './views/chief.js';
import { createInboxView } from './views/inbox.js';
import { createAgentsView } from './views/agents.js';
import { createSettingsView } from './views/settings.js';
import { createRequirementsView } from './views/requirements.js';
import { createRunsView } from './views/runs.js';
import { createFilesView } from './views/files.js';
import { createDocsView } from './views/docs.js';

const PROJECT_KEY = 'agentdev.projectPath';
const SESSION_KEY = 'agentdev.sessionId';
const markdownItModule = await import('markdown-it');
const hljs = await import('highlight.js/core');

async function main() {
  const i18n = await I18n.load('/i18n.json');
  const toast = createToast();
  const dialog = createDialog();
  // One login dialog at a time: several 401s (a boot check plus a stream resync) must not race to
  // open, replace and close each other's dialog.
  let loginInFlight = null;
  const ensureLoginOnce = () => {
    loginInFlight ??= ensureLogin(rpc, i18n, dialog).finally(() => {
      loginInFlight = null;
    });
    return loginInFlight;
  };
  const rpc = new RpcClient({ onUnauthorized: () => void ensureLoginOnce() });
  const sessionView = new SessionView();
  let markdownIt;
  try {
    markdownIt = await makeMarkdownIt(markdownItModule.default ?? markdownItModule);
  } catch (error) {
    // A renderer that cannot load is a real failure: report it instead of silently dropping markdown.
    toast.error(`markdown renderer unavailable: ${error.message}`);
    markdownIt = { render: (text) => `<pre>${text}</pre>` };
  }

  const store = new WorkbenchStore({
    rpc,
    streamFactory: (options) => new SessionStream({ rpc, ...options }),
  });
  const views = new Map();
  const router = new Router({
    onChange: (view) => {
      showView(view);
    },
  });

  const context = {
    rpc,
    store,
    sessionView,
    i18n,
    router,
    toast,
    dialog,
    newRequestId,
    markdownIt,
    highlight: hljs.default ?? hljs,
    openProject: (path) => openProject(path),
    newConversation: () => startNewConversation(),
  };

  sessionView.subscribe(() => {
    // Every view that shows session state re-reads it on the next frame it is visible.
    for (const view of views.values()) {
      view.update?.();
    }
  });
  store.subscribeSession((frame) => {
    if (frame.type === 'snapshot') {
      sessionView.applySnapshot(frame.snapshot);
      setStatus('connected');
      return;
    }
    if (frame.type === 'resync') {
      sessionView.applySnapshot(frame.snapshot);
      console.log('stream resynced');
      return;
    }
    if (frame.type === 'stream-error') {
      setStatus('reconnecting');
      return;
    }
    sessionView.applyFrame(frame);
    if (frame.type === 'pi') {
      logFrame(frame);
    }
  });
  store.subscribe('task', () => {
    for (const view of views.values()) {
      view.update?.();
    }
  });
  store.subscribe('interaction', () => sessionView.setPending(store.pendingInteractions));
  i18n.onLanguage(() => {
    // Rebuild the visible view so views that render through i18n.t pick up the new language.
    views.get(router.current)?.update?.();
  });

  const shell = createShell(context);
  shell.mount();
  currentContext = context;
  await boot();

  async function boot() {
    // The cookie decides whether we are still logged in: a cheap read tells us, and a fresh reload
    // keeps the CSRF token it stored, so a write after a reload is not refused for no reason.
    try {
      await rpc.call('config.get', {});
    } catch (error) {
      if (error instanceof RpcError && error.code === 'UNAUTHORIZED') {
        await ensureLoginOnce();
      } else {
        throw error;
      }
    }
    setStatus('connecting');
    const path = localStorage.getItem(PROJECT_KEY);
    if (path !== null) {
      try {
        await openProject(path);
      } catch (error) {
        toast.error(`project unavailable: ${error.message}`);
      }
    }
    router.start();
  }

  async function openProject(path) {
    const project = await store.openProject(path);
    localStorage.setItem(PROJECT_KEY, project.realPath);
    await store.refreshSessions();
    const known = localStorage.getItem(SESSION_KEY);
    const session =
      store.sessions.find((entry) => entry.sessionId === known) ?? store.sessions[0] ?? undefined;
    const sessionId = session?.sessionId ?? (await createSession());
    await store.refreshTasks();
    await store.refreshRequirements();
    await store.startSession(sessionId);
    localStorage.setItem(SESSION_KEY, sessionId);
    return project;
  }

  async function createSession() {
    const created = await rpc.call('session.create', { projectId: store.projectId });
    return created.session.sessionId;
  }

  /** Start a fresh chief session and follow it; the shell's new-conversation button calls this. */
  async function startNewConversation() {
    const sessionId = await createSession();
    await store.startSession(sessionId);
    localStorage.setItem(SESSION_KEY, sessionId);
    return sessionId;
  }

  /** The connection state is the shell's; it merges it with the session activity. */
  function setStatus(state) {
    shell.setConnection(state);
  }

  function logFrame(frame) {
    const node = qs('#terminalLog');
    if (node === null) {
      return;
    }
    const log = consoleLog ?? createLog({ node });
    consoleLog = log;
    const event = frame.event ?? {};
    const tag = event.type?.startsWith('tool') === true ? 'tool' : event.type === 'message_end' ? 'pass' : 'agent';
    log.line(tag, `${event.type ?? 'event'}${frame.inputId === undefined ? '' : ` · ${frame.inputId}`}`);
  }

  function showView(id) {
    for (const section of document.querySelectorAll('.view')) {
      section.hidden = section.id !== `${id}View`;
    }
    if (!views.has(id)) {
      views.set(id, createView(id));
    }
    views.get(id)?.mount?.();
    views.get(id)?.update?.();
  }

  function createView(id) {
    switch (id) {
      case 'chief':
        return createChiefView(context);
      case 'requirements':
        return createRequirementsView(context);
      case 'runs':
        return createRunsView(context);
      case 'files':
        return createFilesView(context);
      case 'docs':
        return createDocsView(context);
      case 'inbox':
        return createInboxView(context);
      case 'agents':
        return createAgentsView(context);
      case 'settings':
        return createSettingsView(context);
    }
  }
}

/** Ask for the access password until a call succeeds; a wrong password is its own message. */
async function ensureLogin(rpc, i18n, dialog) {
  for (;;) {
    const password = await dialog.open({
      title: i18n.t('auth.title') ?? 'Access password',
      body: el('input', { id: 'accessPassword', type: 'password', autocomplete: 'current-password' }),
      submitLabel: i18n.t('auth.login') ?? 'Log in',
      onSubmit: () => qs('#accessPassword')?.value ?? '',
    });
    if (typeof password !== 'string' || password === '') {
      continue;
    }
    try {
      await rpc.login(password);
      return;
    } catch (error) {
      if (error instanceof RpcError && error.code === 'UNAUTHORIZED') {
        await dialog.open({
          title: i18n.t('auth.wrong') ?? 'Wrong password',
          body: el('p', { text: error.message }),
          submitLabel: i18n.t('common.close') ?? 'Close',
          onSubmit: () => true,
        });
        continue;
      }
      throw error;
    }
  }
}

/** markdown-it with the vendored highlighter: unknown languages fall back to plain escaped code. */
function makeMarkdownIt(MarkdownIt) {
  return new MarkdownIt({
    breaks: true,
    linkify: true,
    highlight(code, language) {
      if (typeof language === 'string' && language !== '' && hljs.getLanguage?.(language) !== undefined) {
        return hljs.highlight(code, { language }).value;
      }
      return '';
    },
  });
}

/** The live console (the mock's .terminalLog): appended to, windowed, never re-rendered. */
let consoleLog = null;
/** The boot context, kept for the shell/views that read it after `main()` resolves. */
let currentContext = null;
void main();
