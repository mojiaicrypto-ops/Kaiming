/**
 * The thinking block: accumulated reasoning, collapsed by default, expandable while it streams. Its
 * state is local to the block (never routed, never stored).
 */
import { el, replace } from '../../core/dom.js';

export function createThinkingBlock() {
  let text = '';
  let open = false;
  let node = el('details', { class: 'thinking-block' });
  const body = el('pre', { class: 'thinking-body' });
  const summary = el('summary');
  replace(node, summary, body);

  const update = () => {
    summary.textContent = `${open ? '▾' : '▸'} thinking · ${text.length} chars`;
    body.textContent = text;
    node.open = open;
  };
  node.addEventListener('toggle', () => {
    open = node.open;
    update();
  });
  update();

  return {
    node,
    append(delta) {
      text += delta;
      update();
    },
    finish(full) {
      text = typeof full === 'string' && full !== '' ? full : text;
      update();
    },
    get text() {
      return text;
    },
  };
}
