/**
 * View routing: a hash route per workspace view (deep-linkable), and nothing else in the URL. Local
 * UI state (open dialogs, collapsed blocks, scroll) deliberately stays out of the route (P4 plan §5).
 */

export const VIEWS = ['chief', 'requirements', 'tasks', 'inbox', 'files', 'docs', 'agents', 'settings', 'projects'];

export class Router {
  constructor(options = {}) {
    this.onChange = options.onChange ?? (() => undefined);
    this.current = null;
    this.handler = () => {
      const view = this.#parse();
      this.current = view;
      this.onChange(view);
      this.#highlight(view);
    };
  }

  start(fallback = 'chief') {
    window.addEventListener('hashchange', this.handler);
    if (window.location.hash === '') {
      window.location.hash = `#/${fallback}`;
      return;
    }
    this.handler();
  }

  stop() {
    window.removeEventListener('hashchange', this.handler);
  }

  navigate(view) {
    if (window.location.hash === `#/${view}`) {
      this.handler();
      return;
    }
    window.location.hash = `#/${view}`;
  }

  #parse() {
    const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0];
    return VIEWS.includes(raw) ? raw : 'chief';
  }

  #highlight(view) {
    for (const button of document.querySelectorAll('.nav-item[data-view]')) {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }
  }
}
