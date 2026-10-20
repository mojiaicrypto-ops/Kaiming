(() => {
  const root = document.documentElement;
  const KEY_THEME = 'agentdev.hifi.theme';

  const icons = {
    chat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
    board: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2.5" width="3.4" height="11" rx="0.8"/><rect x="6.3" y="2.5" width="3.4" height="7.5" rx="0.8"/><rect x="10.6" y="2.5" width="3.4" height="5" rx="0.8"/></svg>',
    cpu: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4.5" y="4.5" width="7" height="7" rx="1"/><path d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2"/></svg>',
    folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4.5h4l1.2 1.5H14v6.5H2z"/></svg>',
    sliders: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 5h7M12 5h2M2 11h2M7 11h7"/><circle cx="10.5" cy="5" r="1.5"/><circle cx="5.5" cy="11" r="1.5"/></svg>',
    sun: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"/></svg>',
    palette: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 2a6 6 0 1 0 0 12c.9 0 1.4-.6 1.4-1.3 0-.6-.4-1-.9-1.4-.4-.4-.6-.7-.6-1.1 0-.7.6-1.2 1.3-1.2H11A3 3 0 0 0 14 6.5C14 4 11.3 2 8 2z"/><circle cx="5.5" cy="6" r=".9" fill="currentColor"/><circle cx="8" cy="4.8" r=".9" fill="currentColor"/><circle cx="10.4" cy="6" r=".9" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 12.5V4M4 7.5L8 3.5l4 4"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  };

  const screens = [
    { id: 'index', file: 'index.html', label: '总览', icon: 'palette' },
    { id: 'conversation', file: 'conversation.html', label: '主管对话', icon: 'chat' },
    { id: 'requirements', file: 'requirements.html', label: '需求看板', icon: 'board' },
    { id: 'providers', file: 'providers.html', label: '模型服务', icon: 'cpu' },
    { id: 'models', file: 'models.html', label: '角色与模型', icon: 'sliders' },
    { id: 'project', file: 'project.html', label: '项目', icon: 'folder' },
    { id: 'gallery', file: 'gallery.html', label: '组件与令牌', icon: 'palette' },
  ];

  const state = new Map([
    ['theme', localStorage.getItem(KEY_THEME) ?? 'dark'],
    ['conv', 'discussing'],
    ['project', 'existing'],
  ]);

  function applyTheme(theme) {
    root.dataset.theme = theme;
    localStorage.setItem(KEY_THEME, theme);
    for (const button of document.querySelectorAll('[data-scenario="theme"]')) {
      button.setAttribute('aria-pressed', String(button.dataset.value === theme));
      button.classList.toggle('primary', button.dataset.value === theme);
    }
  }

  function applyScenario(group, value) {
    state.set(group, value);
    for (const button of document.querySelectorAll(`[data-scenario="${group}"]`)) {
      button.setAttribute('aria-pressed', String(button.dataset.value === value));
      button.classList.toggle('primary', button.dataset.value === value);
    }
    for (const panel of document.querySelectorAll(`[data-scenario-panel="${group}"]`)) {
      panel.hidden = panel.dataset.value !== value;
    }
  }

  function mount() {
    const screen = document.body.dataset.screen;
    for (const slot of document.querySelectorAll('[data-proto-nav]')) {
      slot.className = 'proto-nav';
      slot.innerHTML = screens
        .map(
          (entry) =>
            `<a href="${entry.file}"${entry.id === screen ? ' aria-current="page"' : ''}>${
              entry.id === 'index' ? '' : icons[entry.icon] ?? ''
            }<span>${entry.label}</span></a>`,
        )
        .join('');
    }
    for (const slot of document.querySelectorAll('[data-icon]')) {
      slot.innerHTML = icons[slot.dataset.icon] ?? '';
      if (!slot.classList.contains('btn')) {
        slot.style.display = 'inline-flex';
        slot.style.width = '16px';
        slot.style.height = '16px';
        slot.style.flex = 'none';
      }
    }

    applyTheme(state.get('theme'));

    // Screens may declare their own scenario switch; otherwise add the theme-only bar.
    const bar = document.querySelector('[data-proto-toolbar]') ?? document.createElement('div');
    bar.className = bar.classList.contains('proto-scenario-bar') ? 'proto-scenario-bar' : 'proto-toolbar';
    bar.dataset.protoToolbar = '';
    const themeButtons = `
      <button class="btn sm" type="button" data-scenario="theme" data-value="dark">深色</button>
      <button class="btn sm" type="button" data-scenario="theme" data-value="light">浅色</button>`;
    // Only add the theme switch when this screen has not provided its own scenario bar.
    const ownsScenarioButtons = bar.querySelector('[data-scenario]') !== null;
    if (!ownsScenarioButtons) bar.innerHTML = themeButtons;
    else bar.insertAdjacentHTML('beforeend', '<span class="sep"></span>' + themeButtons);
    if (!bar.isConnected) document.body.append(bar);
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-scenario="theme"]');
      if (button) applyTheme(button.dataset.value);
    });

    for (const group of new Set(
      [...document.querySelectorAll('[data-scenario]')]
        .map((node) => node.dataset.scenario)
        .filter((name) => name !== 'theme'),
    )) {
      applyScenario(group, state.get(group));
      document.addEventListener('click', (event) => {
        const button = event.target.closest(`[data-scenario="${group}"]`);
        if (button) applyScenario(group, button.dataset.value);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
