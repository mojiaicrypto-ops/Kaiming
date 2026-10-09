/**
 * Console log lines (the mock's .log-line grid: time, tag, message) with ansi_up for real ANSI output
 * and a hard line window so a chatty run cannot grow the DOM without bound.
 */
import { el } from '../../core/dom.js';
import { AnsiUp } from 'ansi_up';

const MAX_LINES = 500;

export function createLog({ node, window = MAX_LINES }) {
  const ansi = new AnsiUp();
  ansi.use_classes = false;
  let dropped = 0;
  return {
    /** Append one line; `tag` colours the row like the mock's log tags. */
    line(tag, text, { time = new Date().toISOString().slice(11, 19), isError = false } = {}) {
      const row = el('div', { class: `log-line ${isError ? 'is-error' : ''}` }, [
        el('span', { class: 'log-time', text: time }),
        el('span', { class: `log-tag ${tag}`, text: tag }),
        el('span', { class: 'log-message', html: ansi.ansi_to_html(text) }),
      ]);
      node.append(row);
      while (node.childElementCount > window) {
        node.firstElementChild?.remove();
        dropped += 1;
      }
      node.scrollTop = node.scrollHeight;
    },
    clear() {
      node.replaceChildren();
      dropped = 0;
    },
    get dropped() {
      return dropped;
    },
  };
}
