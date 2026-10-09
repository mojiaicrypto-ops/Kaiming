/**
 * Tool cards: a card appears as soon as a tool starts (name + a streaming argument summary), flips to
 * its result when the tool ends, and shows the error state in red. Arguments stream, so the summary is
 * deliberately a truncated one-liner.
 */
import { el, replace } from '../../core/dom.js';

export function createToolCard({ name, callId }) {
  let argumentsText = '';
  let status = 'running';
  let result = '';
  const summary = el('code', { class: 'tool-args' });
  const state = el('span', { class: 'tool-state', text: 'running' });
  const resultBody = el('pre', { class: 'tool-result', hidden: true });
  const head = el('div', { class: 'tool-head' }, [
    el('span', { class: 'tool-name', text: name ?? 'tool' }),
    summary,
    state,
  ]);
  const node = el('div', { class: 'tool-card', dataset: { callId: callId ?? '' } }, [head, resultBody]);

  const paint = () => {
    state.textContent = status;
    node.classList.toggle('is-error', status === 'failed');
    node.classList.toggle('is-done', status !== 'running');
    summary.textContent = argumentsText.replace(/\s+/g, ' ').slice(0, 160);
  };
  paint();

  return {
    node,
    appendArguments(delta) {
      argumentsText += delta;
      paint();
    },
    finish({ ok, text }) {
      status = ok ? 'done' : 'failed';
      result = text ?? '';
      if (result !== '') {
        resultBody.textContent = result;
        resultBody.hidden = false;
      }
      paint();
    },
    fail(message) {
      status = 'failed';
      resultBody.textContent = message;
      resultBody.hidden = false;
      paint();
    },
    get status() {
      return status;
    },
  };
}
