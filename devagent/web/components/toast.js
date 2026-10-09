/**
 * Toasts: the mock's .toast behaviour (bottom right, 3.2s, success/error/neutral). A toast reports a
 * fact; it is never the only record of an outcome.
 */
import { qs } from '../core/dom.js';

export function createToast() {
  const host = qs('#toast') ?? document.body;
  let timer;
  return {
    show(message, kind = 'neutral') {
      host.className = `toast ${kind}`;
      host.textContent = message;
      host.hidden = false;
      host.classList.add('is-visible');
      clearTimeout(timer);
      timer = setTimeout(() => {
        host.classList.remove('is-visible');
        host.hidden = true;
      }, 3200);
    },
    success(message) {
      this.show(message, 'success');
    },
    error(message) {
      this.show(message, 'error');
    },
  };
}
