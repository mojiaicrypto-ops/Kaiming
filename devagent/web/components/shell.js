/**
 * The workbench shell: the topbar (project switcher, language), the sidebar navigation, the runtime
 * console chrome and the status bar. It shows only values the server reported or an explicit empty/
 * unknown state - connection and session activity come from the live session view, the project from
 * `project.get`, and the task count from the store.
 */
import { el, qs, qsa, replace } from '../core/dom.js';

export function createShell(context) {
  const { store, sessionView, i18n, router, rpc, dialog, toast, openProject, newConversation } = context;

  const workspace = qs('#workspace');
  const runtime = qs('.runtime');
  const statusLed = qs('#statusLed');
  const statusRun = qs('#statusRun');
  const statusBranch = qs('#statusBranch');
  const statusTokens = qs('#statusTokens');
  const projectSwitcher = qs('#projectSwitcher');
  const languageSelect = qs('#languageSelect');
  const liveDockButton = qs('#liveDockButton');
  const consoleTabs = qsa('.console-tab');
  const regions = {
    live: qs('#terminalLog'),
    events: qs('#terminalEvents'),
    artifacts: qs('#terminalArtifacts'),
  };

  let connection = 'connecting';
  let project = null;
  let consoleMode = 'live';
  let mounted = false;
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
    unsubscribes.push(store.subscribe('task', () => paintStatus()));
    unsubscribes.push(sessionView.subscribe(() => paintStatus()));
    unsubscribes.push(
      i18n.onLanguage(() => {
        paintStatus();
        paintProject();
        paintConsoleRegions();
        setRuntimeState(workspace?.dataset.runtime ?? 'open');
      }),
    );
    paintConsoleRegions();
    selectConsoleTab(qs('#consoleTabLive') ?? consoleTabs[0]);
    paintStatus();
    paintProject();
    void loadProject();
  }

  return {
    id: 'shell',
    mount,
    setConnection,
    update() {
      paintStatus();
      paintProject();
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
