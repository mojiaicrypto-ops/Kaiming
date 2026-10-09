/**
 * The mock's .board-card: id + type, the goal, the facts grid and a progress bar. Facts come from the
 * Task row; what the mock showed without data (a priority field) is deliberately absent.
 */
import { el } from '../core/dom.js';

const PHASE_PROGRESS = {
  clarify: 10,
  analyze: 25,
  design: 40,
  plan: 55,
  develop: 70,
  review: 80,
  test: 90,
  settle: 95,
};

export function boardCard(task, { onOpen } = {}) {
  const members = Array.isArray(task.phaseMembers) ? task.phaseMembers.length : 0;
  const done = task.status === 'completed' || task.status === 'cancelled';
  return el(
    'button',
    {
      class: `board-card ${task.status}`,
      type: 'button',
      ...(onOpen === undefined ? {} : { onclick: () => onOpen(task) }),
    },
    [
      // The mock's own header row: .board-card-top with the id and a .priority slot.
      el('div', { class: 'board-card-top' }, [
        el('code', { text: task.taskId }),
        el('span', { class: 'priority', text: task.type }),
      ]),
      el('strong', { text: task.goal }),
      el('p', { text: task.scope }),
      // The mock's <dl class="card-facts"> with dt/dd pairs (its CSS styles exactly that).
      el('dl', { class: 'card-facts' }, [
        ...[
          ['phase', task.phase],
          ['status', task.status],
          ['members', String(members)],
          ['tests', task.requiresTest ? 'required' : 'none'],
        ].map(([term, value]) => el('div', {}, [el('dt', { text: term }), el('dd', { text: value })])),
      ]),
      el('div', { class: 'card-progress' }, [
        el('i', { style: `width:${done ? 100 : (PHASE_PROGRESS[task.phase] ?? 5)}%` }),
      ]),
      el('div', { class: 'card-footer' }, [
        el('small', { text: `rev ${task.revision}` }),
        el('small', { text: task.nextStep ?? task.blockReason ?? '' }),
      ]),
    ],
  );
}
