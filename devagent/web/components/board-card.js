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
      el('div', { class: 'card-top' }, [
        el('code', { text: task.taskId }),
        el('span', { class: `card-kind ${task.type}`, text: task.type }),
      ]),
      el('strong', { text: task.goal }),
      el('p', { text: task.scope }),
      el('div', { class: 'card-facts' }, [
        el('span', {}, [el('small', { text: 'phase' }), el('b', { text: task.phase })]),
        el('span', {}, [el('small', { text: 'status' }), el('b', { text: task.status })]),
        el('span', {}, [el('small', { text: 'members' }), el('b', { text: String(members) })]),
        el('span', {}, [el('small', { text: 'tests' }), el('b', { text: task.requiresTest ? 'required' : 'none' })]),
      ]),
      el('div', { class: 'card-progress' }, [
        el('span', { style: `width:${done ? 100 : (PHASE_PROGRESS[task.phase] ?? 5)}%` }),
      ]),
      el('div', { class: 'card-footer' }, [
        el('small', { text: `rev ${task.revision}` }),
        el('small', { text: task.nextStep ?? task.blockReason ?? '' }),
      ]),
    ],
  );
}
