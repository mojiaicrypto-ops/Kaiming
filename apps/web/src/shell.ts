/**
 * The shared Project Shell: navigation, the top bar, the Live Dock and the panel
 * modes every page shares.
 *
 * `docs/product/experience.md` §1/§6 is the contract:
 *
 * - Conversation create/switch controls exist **only** on Chief; every other page
 *   links into Chief with its object reference (AC-072);
 * - the Live Dock is shared across pages with Open / Compact / Hidden states, the
 *   top bar always restores the last one, and on a narrow viewport Open is a
 *   closable overlay whose close control returns focus to the same top-bar button
 *   (AC-071);
 * - the panel mode is presentation only: switching it issues no command and cannot
 *   change a Run (AC-071);
 * - buttons are keyboard reachable in DOM order and every state carries text as
 *   well as colour (AC-073).
 */
import { escapeHtml, jsonIsland } from './html.js';
import { DEFAULT_LANGUAGE, type Language, type Translator } from './i18n.js';

export type PageKey =
  | 'projects'
  | 'chief'
  | 'requirements'
  | 'requirement'
  | 'docs'
  | 'files'
  | 'agents'
  | 'runs'
  | 'inbox'
  | 'settings';

export const PANEL_MODES = ['open', 'compact', 'hidden'] as const;
export type PanelMode = (typeof PANEL_MODES)[number];

/** The mode a fresh browser starts in; the remembered mode wins once stored. */
export const DEFAULT_PANEL_MODE: PanelMode = 'open';

export function isPanelMode(value: unknown): value is PanelMode {
  return value === 'open' || value === 'compact' || value === 'hidden';
}

/** Cycles Open → Compact → Hidden → Open, as the top-bar control does. */
export function nextPanelMode(mode: PanelMode): PanelMode {
  const index = PANEL_MODES.indexOf(mode);
  return PANEL_MODES[(index + 1) % PANEL_MODES.length] ?? 'open';
}

/** The ARIA label key for one mode, so the button never leaves its label implied. */
export function panelModeAriaKey(mode: PanelMode): string {
  return mode === 'open'
    ? 'aria.liveDockOpen'
    : mode === 'compact'
      ? 'aria.liveDockCompact'
      : 'aria.liveDockHidden';
}

export function panelModeLabelKey(mode: PanelMode): string {
  return `shell.panelMode.${mode}`;
}

interface NavEntry {
  readonly page: PageKey;
  readonly href: (projectId: string) => string;
  readonly labelKey: string;
  readonly ariaKey: string;
  readonly icon: string;
}

const NAV_ENTRIES: readonly NavEntry[] = [
  {
    page: 'chief',
    href: (id) => `/projects/${id}/chief`,
    labelKey: 'nav.chief',
    ariaKey: 'aria.chiefConversation',
    icon: 'CH',
  },
  {
    page: 'requirements',
    href: (id) => `/projects/${id}/requirements`,
    labelKey: 'nav.requirements',
    ariaKey: 'aria.board',
    icon: 'RQ',
  },
  {
    page: 'docs',
    href: (id) => `/projects/${id}/docs`,
    labelKey: 'nav.docs',
    ariaKey: 'aria.docs',
    icon: 'DC',
  },
  {
    page: 'files',
    href: (id) => `/projects/${id}/files`,
    labelKey: 'nav.files',
    ariaKey: 'aria.projectFiles',
    icon: 'FL',
  },
  {
    page: 'agents',
    href: (id) => `/projects/${id}/agents`,
    labelKey: 'nav.agents',
    ariaKey: 'aria.agents',
    icon: 'AG',
  },
  {
    page: 'runs',
    href: (id) => `/projects/${id}/runs`,
    labelKey: 'nav.runs',
    ariaKey: 'aria.runs',
    icon: 'RN',
  },
  {
    page: 'inbox',
    href: (id) => `/projects/${id}/inbox`,
    labelKey: 'nav.inbox',
    ariaKey: 'aria.inbox',
    icon: 'IN',
  },
  {
    page: 'settings',
    href: () => '/settings',
    labelKey: 'nav.settings',
    ariaKey: 'aria.settings',
    icon: 'ST',
  },
];

export interface ShellState {
  readonly projectId: string;
  readonly projectName: string;
  readonly page: PageKey;
  readonly language: Language;
  /** Interface locales this shell offers; the switch never touches project content. */
  readonly languages?: readonly Language[];
  readonly panelMode?: PanelMode;
  readonly inboxCount?: number;
  readonly liveCount?: number;
  readonly connectionState?: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'expired';
  readonly statusText?: string;
  readonly title?: string;
}

/**
 * The page's own title, prefixed by the project name for a browser tab.
 *
 * A Requirement or Feature title is project content and appears verbatim; only the
 * separator and the product name come from the dictionary.
 */
export function documentTitle(state: ShellState, pageTitle: string, t: Translator): string {
  const product = t('app.title');
  return pageTitle === '' ? product : `${pageTitle} · ${product}`;
}

function navItem(state: ShellState, entry: NavEntry, t: Translator): string {
  const active = state.page === entry.page;
  const href = entry.href(state.projectId);
  const count = entry.page === 'inbox' ? (state.inboxCount ?? 0) : 0;
  return [
    `<a class="nav-item${active ? ' active' : ''}"`,
    ` href="${escapeHtml(href)}"`,
    ` data-page="${entry.page}"`,
    ` data-i18n-aria="${entry.ariaKey}"`,
    ` aria-label="${escapeHtml(t(entry.ariaKey))}"`,
    active ? ' aria-current="page"' : '',
    '>',
    `<span class="nav-icon" aria-hidden="true">${escapeHtml(entry.icon)}</span>`,
    `<span class="nav-text" data-i18n="${escapeHtml(entry.labelKey)}">${escapeHtml(t(entry.labelKey))}</span>`,
    count > 0 ? `<span class="nav-badge attention">${String(count)}</span>` : '',
    '</a>',
  ].join('');
}

function languageOption(value: Language, current: Language, t: Translator): string {
  const label = t(`language.${value}`);
  return `<option value="${value}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

/**
 * Renders the whole shell around one page body.
 *
 * The body is inserted unchanged: a page module is responsible for escaping its own
 * data, and the shell never re-parses HTML.
 */
export function renderShell(state: ShellState, body: string, t: Translator): string {
  const language = state.language;
  const panelMode = state.panelMode ?? DEFAULT_PANEL_MODE;
  const connection = state.connectionState ?? 'connecting';
  const languages = state.languages ?? [DEFAULT_LANGUAGE, 'zh'];
  const body_ = [
    `<a class="skip-link" href="#main" data-i18n="shell.skipToMain">${escapeHtml(t('shell.skipToMain'))}</a>`,
    `<div class="app shell" id="shell" data-panel-mode="${panelMode}" data-page="${state.page}" data-project="${escapeHtml(state.projectId)}" data-connection="${connection}" data-language="${language}">`,
    renderTopbar(state, t, panelMode, connection, languages),
    renderSidebar(state, t),
    renderMain(state, body, t),
    renderLiveDock(state, t, panelMode),
    '</div>',
  ].join('\n');
  return body_;
}

function renderTopbar(
  state: ShellState,
  t: Translator,
  panelMode: PanelMode,
  connection: string,
  languages: readonly Language[],
): string {
  const chief = state.page === 'chief';
  const connectionLabel = t('connection.state');
  const connectionText = t(
    connection === 'open'
      ? 'connection.open'
      : connection === 'reconnecting'
        ? 'connection.reconnecting'
        : connection === 'closed'
          ? 'connection.closed'
          : connection === 'expired'
            ? 'connection.expired'
            : 'connection.connecting',
  );
  return [
    '<header class="topbar">',
    `<div class="brand" data-i18n-aria="app.title" aria-label="${escapeHtml(t('app.title'))}">`,
    `<span class="brand-mark" aria-hidden="true"></span>`,
    `<span class="brand-name" data-i18n="app.title">${escapeHtml(t('app.title'))}</span>`,
    '</div>',
    '<div class="project-area">',
    `<a class="project-name" href="/projects/${escapeHtml(state.projectId)}/chief" data-i18n-project="${escapeHtml(state.projectId)}">${escapeHtml(state.projectName)}</a>`,
    chief
      ? `<button class="conversation-control" id="newConversation" type="button" data-i18n="chief.newConversation">${escapeHtml(t('chief.newConversation'))}</button>` +
        `<button class="conversation-control" id="switchConversation" type="button" data-i18n="chief.switchConversation" aria-expanded="false">${escapeHtml(t('chief.switchConversation'))}</button>`
      : // AC-072: no create/switch control outside Chief — only a deep link into it.
        `<a class="discuss-link" id="discussInChief" href="/projects/${escapeHtml(state.projectId)}/chief" data-i18n="shell.discussInChief">${escapeHtml(t('shell.discussInChief'))}</a>`,
    '</div>',
    '<div class="topbar-tools">',
    `<span class="connection-state" id="connectionState" role="status" aria-live="polite" data-connection="${connection}" data-i18n-aria="connection.state" aria-label="${escapeHtml(connectionLabel)}">${escapeHtml(connectionText)}</span>`,
    `<button class="top-live-button" id="liveDockToggle" type="button" data-mode="${panelMode}" data-i18n-aria="${panelModeAriaKey(panelMode)}" aria-label="${escapeHtml(t(panelModeAriaKey(panelMode)))}" aria-controls="liveDock" aria-expanded="${panelMode === 'open' ? 'true' : 'false'}">`,
    `<span class="status-led" aria-hidden="true"></span>`,
    `<span data-i18n="run.topLive">${escapeHtml(t('run.topLive'))}</span>`,
    `<span class="badge" id="liveCount">${String(state.liveCount ?? 0)}</span>`,
    '</button>',
    `<label class="language-label" for="languageSelect" data-i18n="language.label">${escapeHtml(t('language.label'))}</label>`,
    `<select class="language-select" id="languageSelect" data-i18n-aria="language.label" aria-label="${escapeHtml(t('language.label'))}" data-storage-key="agentdev.language">`,
    languages.map((value) => languageOption(value, state.language, t)).join(''),
    '</select>',
    `<form class="logout" method="post" action="/api/auth/logout">`,
    `<button type="submit" data-i18n="auth.logout">${escapeHtml(t('auth.logout'))}</button>`,
    '</form>',
    '</div>',
    '</header>',
  ].join('');
}

function renderSidebar(state: ShellState, t: Translator): string {
  return [
    `<nav class="sidebar" data-i18n-aria="nav.primary" aria-label="${escapeHtml(t('nav.primary'))}">`,
    '<div class="nav-section">',
    `<div class="nav-label" data-i18n="nav.workspace">${escapeHtml(t('nav.workspace'))}</div>`,
    `<a class="nav-item${state.page === 'projects' ? ' active' : ''}" href="/projects" data-page="projects"${state.page === 'projects' ? ' aria-current="page"' : ''}>` +
      `<span class="nav-icon" aria-hidden="true">PR</span>` +
      `<span class="nav-text" data-i18n="nav.projects">${escapeHtml(t('nav.projects'))}</span></a>`,
    NAV_ENTRIES.filter((entry) => entry.page === 'chief' || entry.page === 'requirements')
      .map((entry) => navItem(state, entry, t))
      .join(''),
    '</div>',
    '<div class="nav-section">',
    `<div class="nav-label" data-i18n="nav.project">${escapeHtml(t('nav.project'))}</div>`,
    NAV_ENTRIES.filter(
      (entry) =>
        entry.page === 'docs' ||
        entry.page === 'files' ||
        entry.page === 'agents' ||
        entry.page === 'runs',
    )
      .map((entry) => navItem(state, entry, t))
      .join(''),
    '</div>',
    '<div class="nav-section">',
    `<div class="nav-label" data-i18n="nav.system">${escapeHtml(t('nav.system'))}</div>`,
    NAV_ENTRIES.filter((entry) => entry.page === 'inbox' || entry.page === 'settings')
      .map((entry) => navItem(state, entry, t))
      .join(''),
    '</div>',
    '</nav>',
  ].join('');
}

function renderMain(state: ShellState, body: string, t: Translator): string {
  return [
    `<main class="main" id="main" tabindex="-1" data-i18n-aria="app.projectWorkspace" aria-label="${escapeHtml(t('app.projectWorkspace'))}">`,
    body,
    '</main>',
  ].join('');
}

/**
 * The Live Dock.
 *
 * `data-count` carries the live event count so the top-bar badge stays visible in
 * Compact and Hidden, and the mode is already on `#shell` when the document is
 * parsed — no flash of the wrong layout and no JavaScript needed to restore it.
 */
function renderLiveDock(state: ShellState, t: Translator, panelMode: PanelMode): string {
  return [
    `<aside class="live-dock" id="liveDock" data-mode="${panelMode}"`,
    ` data-i18n-aria="aria.liveDock" aria-label="${escapeHtml(t('aria.liveDock'))}"`,
    ` aria-expanded="${panelMode === 'open' ? 'true' : 'false'}">`,
    '<div class="live-head">',
    `<h2 data-i18n="live.title">${escapeHtml(t('live.title'))}</h2>`,
    `<span class="watermark" id="liveWatermark" data-i18n-aria="live.watermark" aria-label="${escapeHtml(t('live.watermark'))}">0</span>`,
    `<button class="live-close" id="liveDockClose" type="button" data-i18n-aria="shell.panelClose" aria-label="${escapeHtml(t('shell.panelClose'))}">×</button>`,
    '</div>',
    `<p class="live-reconnect" id="liveReconnect" role="status" aria-live="polite" hidden data-i18n="live.reconnect">${escapeHtml(t('live.reconnect'))}</p>`,
    `<ol class="live-events" id="liveEvents" data-i18n-aria="aria.liveStream" aria-label="${escapeHtml(t('aria.liveStream'))}" aria-live="polite"></ol>`,
    `<p class="hint" data-i18n="aria.focusOrderNote">${escapeHtml(t('aria.focusOrderNote'))}</p>`,
    '</aside>',
  ].join('');
}

/**
 * The `view` payload the client script hydrates from.
 *
 * It is the server's real protocol answer, not a fixture: the island exists so the
 * first paint already shows the true state and a later fetch only refreshes it.
 */
export function renderViewIsland(id: string, value: unknown): string {
  return jsonIsland(id, value);
}

/** Renders a project-scoped page shell; `body` is the page's own markup. */
export function renderProjectPage(
  state: ShellState,
  body: string,
  t: Translator,
  view?: unknown,
): string {
  const withIsland = view === undefined ? body : `${body}\n${renderViewIsland('viewData', view)}`;
  return renderShell(state, withIsland, t);
}
