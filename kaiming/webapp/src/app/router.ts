import { useCallback, useEffect, useState } from 'react';

/**
 * Client routes. The server serves index.html for every unknown path, so a deep link and a
 * reload both land on the shell and the path decides the screen (no hash, no prefix).
 */
export type Route =
  | { readonly view: 'chat' }
  | { readonly view: 'project'; readonly selected: string | null }
  | { readonly view: 'settings'; readonly tab: SettingsTab };

export type SettingsTab = 'providers' | 'models' | 'usage' | 'appearance';

const SETTINGS_TABS: readonly SettingsTab[] = ['providers', 'models', 'usage', 'appearance'];
const SETTINGS_PATH = /^\/settings(?:\/([^/]+))?\/?$/;
const PROJECT_PATH = /^\/project\/?$/;
/** The old address still works: a bookmark or a typed URL lands on the project page. */
const LEGACY_REQUIREMENTS_PATH = /^\/requirements\/?$/;

export function parsePath(pathname: string, search = ''): Route {
  const settings = SETTINGS_PATH.exec(pathname);
  if (settings !== null) {
    const tab = settings[1] as SettingsTab | undefined;
    return { view: 'settings', tab: tab !== undefined && SETTINGS_TABS.includes(tab) ? tab : 'providers' };
  }
  if (PROJECT_PATH.test(pathname) || LEGACY_REQUIREMENTS_PATH.test(pathname)) {
    const selected = new URLSearchParams(search).get('selected');
    return { view: 'project', selected: selected === null || selected === '' ? null : selected };
  }
  return { view: 'chat' };
}

/** Route → address. The selected backlog item lives in the query string so a reload reopens it. */
export function hrefOf(route: Route): string {
  switch (route.view) {
    case 'chat':
      return '/';
    case 'project':
      return route.selected === null ? '/project' : `/project?selected=${encodeURIComponent(route.selected)}`;
    case 'settings':
      return `/settings/${route.tab}`;
  }
}

/** Navigate without a reload; `replace` is for normalising an unknown path on first paint. */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === path) return;
  window.history[options.replace === true ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * The shortcuts the status bar advertises: 1/2/3 switch screens, `i` focuses the composer.
 * Typing in a field never triggers them — the keys belong to the shell, not to the text.
 */
export function useShortcuts(onNavigate: (path: string) => void = navigate): void {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true) return;
      // Digits also pick an option in the question panel; while a question is open they belong to
      // it, never to navigation (the prototype guards the same way).
      const questionOpen = document.querySelector('[data-testid="question-panel"]') !== null;
      if (questionOpen) return;
      if (event.key === '1') onNavigate('/');
      else if (event.key === '2') onNavigate('/project');
      else if (event.key === '3') onNavigate('/settings/providers');
      else if (event.key === 'i') {
        const composer = document.querySelector<HTMLTextAreaElement>('[data-testid="composer"]');
        if (composer !== null) {
          event.preventDefault();
          composer.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNavigate]);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname, window.location.search));
  const onPop = useCallback(() => setRoute(parsePath(window.location.pathname, window.location.search)), []);
  useEffect(() => {
    window.addEventListener('popstate', onPop);
    // An unknown path renders the chat screen; make the address bar agree with what is shown.
    const parsed = parsePath(window.location.pathname, window.location.search);
    if (hrefOf(parsed) !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState({}, '', hrefOf(parsed));
    }
    setRoute(parsed);
    return () => window.removeEventListener('popstate', onPop);
  }, [onPop]);
  return route;
}
