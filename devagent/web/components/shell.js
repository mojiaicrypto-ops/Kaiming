/**
 * The workbench shell: the topbar (project switcher, language), the sidebar navigation, the runtime
 * console chrome and the status bar. It shows only values the server reported or an explicit empty/
 * unknown state - connection and session activity come from the live session view, the project from
 * `project.get`, and the task count from the store.
 */
import { el, qs, qsa, replace } from '../core/dom.js';

export function createShell(context) {
  const { store, sessionView, i18n, router, rpc, dialog, toast, openProject, openSession, newConversation } =
    context;

  const workspace = qs('#workspace');
  const runtime = qs('.runtime');
  const statusLed = qs('#statusLed');
  const statusRun = qs('#statusRun');
  const statusBranch = qs('#statusBranch');
  const statusTokens = qs('#statusTokens');
  const projectSwitcher = qs('#projectSwitcher');
  const languageSelect = qs('#languageSelect');
  const liveDockButton = qs('#liveDockButton');
  const liveDot = qs('#liveDot');
  const liveLabel = qs('#liveLabel');
  const sectionEyebrow = qs('#sectionEyebrow');
  const sectionTitle = qs('#sectionTitle');
  const sectionSubtitle = qs('#sectionSubtitle');
  const conversationSwitcher = qs('#conversationSwitcher');
  const conversationSelect = qs('#conversationSelect');
  const focusCard = qs('#focusCard');
  const focusTitle = qs('#focusTitle');
  const focusPercent = qs('#focusPercent');
  const focusPhase = qs('#focusPhase');
  const focusDecision = qs('#focusDecision');
  const consoleTabs = qsa('.console-tab');
  const errorFilter = qs('#errorFilter');
  const stopRun = qs('#stopRun');

  /** The phase order the server reports; used to show a real position, never a made-up ratio. */
  const PHASES = ['clarify', 'analyze', 'design', 'plan', 'develop', 'review', 'test', 'settle'];
  /** One header per view: the same eyebrow/title/subtitle the view's own heading carries. */
  const HEADERS = {
    chief: ['section.chiefEyebrow', 'nav.chief', 'section.chiefSubtitle'],
    requirements: ['view.requirements.eyebrow', 'view.requirements.title', 'view.requirements.subtitle'],
    runs: ['view.runs.eyebrow', 'view.runs.title', 'view.runs.subtitle'],
    files: ['section.filesEyebrow', 'nav.files', 'section.filesSubtitle'],
    docs: ['view.docs.eyebrow', 'view.docs.title', 'view.docs.subtitle'],
    agents: ['view.agents.eyebrow', 'view.agents.title', 'view.agents.subtitle'],
    inbox: ['view.inbox.eyebrow', 'view.inbox.title', 'view.inbox.subtitle'],
    settings: ['view.settings.eyebrow', 'view.settings.title', 'view.settings.subtitle'],
  };
  const regions = {
    live: qs('#terminalLog'),
    events: qs('#terminalEvents'),
    artifacts: qs('#terminalArtifacts'),
  };

  let connection = 'connecting';
  let project = null;
  let consoleMode = 'live';
  let mounted = false;
  /** The session ids the switcher was built from, so rebuilding does not reset the user's choice. */
  let conversationsSignature = '';
  const unsubscribes = [];

  const t = (key) => i18n.t(key);
  /** The dictionary has no formatter: substitute {name} tokens the shipped copy carries. */
  const tr = (key, params) =>
    Object.entries(params ?? {}).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), t(key));

  /** The connection state; once connected, the session's own activity is the honest value. */
  function displayState() {
    if (connection !== 'connected') {
      return connection;
    }
    return sessionView.activity === 'processing' || sessionView.activity === 'queued'
      ? sessionView.activity
      : 'idle';
  }

  function paintStatus() {
    const state = displayState();
    if (statusLed !== null) {
      statusLed.dataset.state = state;
    }
    if (statusRun !== null) {
      statusRun.textContent = t(`status.${state}`);
    }
    if (statusTokens !== null) {
      statusTokens.textContent = tr('status.tasks', { count: store.tasks.length });
    }
  }

  function paintProject() {
    const name = qs('#projectName');
    const branch = qs('#projectBranch');
    const chip = qs('#projectChip');
    if (project === null) {
      if (name !== null) name.textContent = '';
      if (branch !== null) branch.textContent = '';
      if (chip !== null) chip.textContent = '';
      if (statusBranch !== null) statusBranch.textContent = '';
      return;
    }
    const base = project.realPath.split('/').filter(Boolean).pop() ?? project.realPath;
    const path = project.directoryExists ? project.realPath : tr('status.missingPath', { path: project.realPath });
    if (name !== null) name.textContent = base;
    if (branch !== null) branch.textContent = path;
    if (chip !== null) chip.textContent = initialsOf(base);
    if (statusBranch !== null) statusBranch.textContent = path;
  }

  async function loadProject() {
    if (store.projectId === null) {
      project = null;
      paintProject();
      return;
    }
    try {
      const read = await rpc.call('project.get', { projectId: store.projectId });
      project = read.project;
    } catch {
      // A project that cannot be read is shown as unknown, not as a fabricated name.
      project = null;
    }
    paintProject();
  }

  /** The conversation header follows the visible view: what a reader sees must match where they are. */
  function paintHeader() {
    const [eyebrow, title, subtitle] = HEADERS[router.current] ?? HEADERS.chief;
    if (sectionEyebrow !== null) {
      sectionEyebrow.textContent = t(eyebrow);
    }
    if (sectionTitle !== null) {
      sectionTitle.textContent = t(title);
    }
    if (sectionSubtitle !== null) {
      sectionSubtitle.textContent = t(subtitle);
    }
  }

  /** The live pill states the connection and the session activity - never a fixed demo label. */
  function paintLive() {
    const state = displayState();
    if (liveLabel !== null) {
      liveLabel.textContent = connection === 'connected' ? t('header.live') : t(`status.${connection}`);
    }
    if (liveDot !== null) {
      liveDot.dataset.state = state;
    }
  }

  /**
   * The conversation switcher lists the project's real sessions; changing it follows that session.
   * With no project (or no session yet) it hides instead of showing an invented conversation.
   */
  function paintConversations() {
    if (conversationSwitcher === null || conversationSelect === null) {
      return;
    }
    if (store.projectId === null || store.sessions.length === 0) {
      conversationSwitcher.hidden = true;
      return;
    }
    conversationSwitcher.hidden = false;
    const signature = store.sessions.map((session) => session.sessionId).join(',');
    if (signature !== conversationsSignature) {
      conversationsSignature = signature;
      conversationSelect.textContent = '';
      for (const session of store.sessions) {
        conversationSelect.append(
          el('option', {
            value: session.sessionId,
            text: `${t(`agents.role.${session.roleId}`)} · ${session.sessionId.slice(-6)}`,
          }),
        );
      }
    }
    conversationSelect.value = store.sessionId ?? '';
  }

  /** The focus card shows the one Task that is still open, or an explicit empty state. */
  function paintFocus() {
    if (focusCard === null) {
      return;
    }
    const task =
      store.tasks.find((entry) => entry.status === 'active' || entry.status === 'waiting') ??
      store.tasks.find((entry) => entry.status === 'paused' || entry.status === 'pausing') ??
      null;
    if (task === null) {
      focusCard.hidden = true;
      return;
    }
    focusCard.hidden = false;
    const index = Math.max(0, PHASES.indexOf(task.phase));
    if (focusTitle !== null) {
      focusTitle.textContent = task.goal ?? task.taskId;
    }
    if (focusPhase !== null) {
      // The phase is the server's own word for where the Task stands, translated for display.
      focusPhase.textContent = t(`phase.${task.phase}`);
    }
    if (focusDecision !== null) {
      // Only the Task's own recorded reason or next step; without one the card shows a dash.
      focusDecision.textContent = task.blockReason ?? task.nextStep ?? t('focus.decision');
    }
    if (focusPercent !== null) {
      focusPercent.textContent = `${index + 1} / ${PHASES.length}`;
    }
    const bar = focusCard.querySelector('.progress > span');
    if (bar !== null) {
      bar.style.width = `${Math.round(((index + 1) / PHASES.length) * 100)}%`;
    }
  }

  function setRuntimeState(state, focusSelector) {
    if (workspace !== null) {
      workspace.dataset.runtime = state;
    }
    if (runtime !== null) {
      runtime.setAttribute('aria-label', t(state === 'collapsed' ? 'aria.runConsoleCollapsed' : 'aria.runConsole'));
    }
    const collapse = qs('#collapseRuntime');
    if (collapse !== null) {
      collapse.setAttribute('aria-expanded', String(state === 'open'));
    }
    if (liveDockButton !== null) {
      liveDockButton.dataset.state = state;
      liveDockButton.setAttribute('aria-expanded', String(state === 'open'));
    }
    if (focusSelector !== undefined) {
      requestAnimationFrame(() => qs(focusSelector)?.focus());
    }
  }

  function selectConsoleTab(tab) {
    if (tab === null) {
      return;
    }
    consoleMode = tab.dataset.console ?? 'live';
    for (const item of consoleTabs) {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    }
    for (const [mode, region] of Object.entries(regions)) {
      if (region !== null) {
        region.hidden = mode !== consoleMode;
      }
    }
  }

  /** Events and artifacts have no data source in this build: an explicit empty state, never invented rows. */
  function paintConsoleRegions() {
    for (const [region, key] of [
      [regions.events, 'console.eventsEmpty'],
      [regions.artifacts, 'console.artifactsEmpty'],
    ]) {
      if (region !== null) {
        replace(region, el('div', { class: 'log-line' }, [el('span', { class: 'log-message', text: t(key) })]));
      }
    }
  }

  /** The console shows only lines the run actually produced; ERRORS toggles a real filter. */
  function toggleErrorsOnly() {
    if (errorFilter === null || regions.live === null) {
      return;
    }
    const next = errorFilter.getAttribute('aria-pressed') !== 'true';
    errorFilter.setAttribute('aria-pressed', String(next));
    let errors = 0;
    for (const line of regions.live.querySelectorAll('.log-line')) {
      const isError = line.classList.contains('is-error');
      if (isError) {
        errors += 1;
      }
      line.hidden = next && !isError;
    }
    toast.show(next ? tr('toast.errorsFiltered', { count: errors }) : t('toast.errorsShown'));
  }

  /**
   * Stop the work this conversation is actually running: the server's own snapshot names the input,
   * and the stop is recorded by the server (the toast never claims the work already stopped).
   */
  async function stopCurrentInput() {
    if (store.projectId === null || store.sessionId === null) {
      toast.show(t('toast.nothingRunning'));
      return;
    }
    try {
      const prepared = await rpc.call('session.stream.prepare', {
        projectId: store.projectId,
        sessionId: store.sessionId,
      });
      const inputs = Array.isArray(prepared.snapshot?.inputs) ? prepared.snapshot.inputs : [];
      const running = [...inputs].reverse().find((entry) => entry.status === 'processing' || entry.status === 'queued');
      if (running === undefined) {
        toast.show(t('toast.nothingRunning'));
        return;
      }
      await rpc.call('session.input.stop', {
        projectId: store.projectId,
        sessionId: store.sessionId,
        inputId: running.inputId,
      });
      toast.show(t('toast.stopRequested'));
    } catch (error) {
      toast.error(error?.message ?? String(error));
    }
  }

  function openProjectDialog() {
    projectSwitcher?.setAttribute('aria-expanded', 'true');
    void dialog
      .open({
        title: t('projects.open'),
        body: el('input', { id: 'projectPathInput', type: 'text', placeholder: '/path/to/project' }),
        submitLabel: t('common.open'),
        onSubmit: () => (qs('#projectPathInput')?.value ?? '').trim(),
      })
      .then((path) => (typeof path === 'string' && path !== '' ? openProject(path) : undefined))
      .catch((error) => toast.error(error?.message ?? String(error)))
      .finally(() => projectSwitcher?.setAttribute('aria-expanded', 'false'));
  }

  function wire() {
    for (const button of qsa('.nav-item[data-view]')) {
      button.addEventListener('click', () => router.navigate(button.dataset.view));
    }
    if (languageSelect !== null) {
      languageSelect.value = i18n.language;
      languageSelect.addEventListener('change', (event) => i18n.setLanguage(event.currentTarget.value));
    }
    projectSwitcher?.addEventListener('click', openProjectDialog);
    conversationSelect?.addEventListener('change', (event) => {
      const sessionId = event.currentTarget.value;
      if (typeof sessionId === 'string' && sessionId !== '') {
        void openSession?.(sessionId);
      }
    });
    qs('#paletteButton')?.addEventListener('click', () => router.navigate('settings'));
    qs('#newConversationButton')?.addEventListener('click', () => {
      void newConversation?.();
    });

    qs('#collapseRuntime')?.addEventListener('click', () => {
      if (window.matchMedia?.('(max-width: 840px)').matches === true) {
        toast.show(t('toast.consoleMobileHidden'));
        return;
      }
      setRuntimeState('collapsed', '#expandRuntime');
      toast.show(t('toast.consoleCollapsed'));
    });
    qs('#expandRuntime')?.addEventListener('click', () => {
      setRuntimeState('open', '#collapseRuntime');
      toast.show(t('toast.consoleExpanded'));
    });
    qs('#closeRuntime')?.addEventListener('click', () => {
      setRuntimeState('closed', '#liveDockButton');
      toast.show(t('toast.consoleClosed'));
    });
    liveDockButton?.addEventListener('click', () => {
      const open = workspace?.dataset.runtime === 'open';
      setRuntimeState(open ? 'collapsed' : 'open', open ? '#liveDockButton' : '#collapseRuntime');
      toast.show(t(open ? 'toast.liveCompact' : 'toast.liveOpened'));
    });

    errorFilter?.addEventListener('click', toggleErrorsOnly);
    stopRun?.addEventListener('click', () => void stopCurrentInput());
    for (const tab of consoleTabs) {
      tab.addEventListener('click', () => selectConsoleTab(tab));
    }
    qs('.console-tabs')?.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const index = consoleTabs.indexOf(document.activeElement);
      const next =
        event.key === 'ArrowLeft'
          ? (index - 1 + consoleTabs.length) % consoleTabs.length
          : event.key === 'ArrowRight'
            ? (index + 1) % consoleTabs.length
            : event.key === 'Home'
              ? 0
              : consoleTabs.length - 1;
      selectConsoleTab(consoleTabs[next]);
      consoleTabs[next]?.focus();
    });
  }

  function setConnection(state) {
    connection = state;
    paintStatus();
  }

  function mount() {
    if (mounted) {
      return;
    }
    mounted = true;
    wire();
    unsubscribes.push(store.subscribe('project', () => void loadProject()));
    unsubscribes.push(
      store.subscribe('task', () => {
        paintStatus();
        paintFocus();
      }),
    );
    unsubscribes.push(
      store.subscribe('session', () => paintConversations()),
    );
    unsubscribes.push(sessionView.subscribe(() => {
      paintStatus();
      paintLive();
    }));
    unsubscribes.push(
      i18n.onLanguage(() => {
        paintStatus();
        paintProject();
        paintConsoleRegions();
        paintHeader();
        paintLive();
        conversationsSignature = '';
        paintConversations();
        paintFocus();
        setRuntimeState(workspace?.dataset.runtime ?? 'open');
      }),
    );
    paintConsoleRegions();
    selectConsoleTab(qs('#consoleTabLive') ?? consoleTabs[0]);
    paintStatus();
    paintProject();
    paintHeader();
    paintLive();
    paintConversations();
    paintFocus();
    void loadProject();
  }

  return {
    id: 'shell',
    mount,
    setConnection,
    update() {
      paintStatus();
      paintProject();
      paintHeader();
      paintLive();
      paintConversations();
      paintFocus();
    },
    destroy() {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      unsubscribes.length = 0;
      mounted = false;
    },
  };
}

function initialsOf(name) {
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  const initials = words.map((word) => word.slice(0, 1).toUpperCase()).join('');
  return initials.slice(0, 2) || 'AD';
}
