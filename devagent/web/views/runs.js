/**
 * Runs view: the Task board. Cards come straight from `store.tasks` (the server's `task.list` rows)
 * through the shared `boardCard`, grouped into the mock's four columns by real status.
 *
 * A card opens a detail dialog backed by `task.get` (phase/status/revision/goal/scope/members/results);
 * pause/resume/cancel call the real `task.control` with the card's `expectedRevision` and a fresh
 * requestId per user action; a selected result loads its body through `task.report.get`.
 */
import { el, qs, relativeTime, replace } from '../core/dom.js';
import { boardCard } from '../components/board-card.js';
import { dataRow } from '../components/data-list.js';

const COLUMNS = [
  { label: 'runs.column.active', statuses: ['active', 'pausing'] },
  { label: 'runs.column.waiting', statuses: ['waiting'] },
  { label: 'runs.column.paused', statuses: ['paused', 'cancelling'] },
  { label: 'runs.column.done', statuses: ['completed', 'cancelled'] },
];

export function createRunsView(context) {
  const { store, i18n, dialog, toast, newRequestId } = context;
  const region = qs('#runsContent');
  const t = (key) => i18n.t(key);

  function paint() {
    if (region === null) {
      return;
    }
    const tasks = Array.isArray(store.tasks) ? store.tasks : [];
    if (tasks.length === 0) {
      replace(region, el('p', { class: 'board-help', text: t('runs.empty') }));
      return;
    }
    const board = el('div', {
      class: 'requirement-board',
      role: 'list',
      'aria-label': t('aria.requirementBoard'),
    });
    for (const column of COLUMNS) {
      const cards = tasks.filter((task) => column.statuses.includes(task.status));
      board.append(
        el('section', { class: 'board-column', role: 'listitem' }, [
          el('div', { class: 'board-title' }, [
            el('span', { text: t(column.label) }),
            el('span', { text: String(cards.length) }),
          ]),
          ...cards.map((task) => boardCard(task, { onOpen: (picked) => void openTask(picked) })),
        ]),
      );
    }
    replace(region, board);
  }

  function controlButton(task, command, labelKey, disabled) {
    return el('button', {
      class: 'decision-button',
      type: 'button',
      text: t(labelKey),
      disabled: disabled ? true : undefined,
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          // One id for this user action; a retry of the same click reuses it (R1).
          await store.rpc.call(
            'task.control',
            {
              projectId: store.projectId,
              taskId: task.taskId,
              command,
              expectedRevision: task.revision,
            },
            { requestId: newRequestId() },
          );
          toast.success(t('runs.commandSent'));
          await store.refreshTasks();
          dialog.close();
        } catch (failure) {
          toast.error(failure?.message ?? String(failure));
          button.disabled = false;
        }
      },
    });
  }

  async function openTask(card) {
    let read;
    try {
      read = await store.rpc.call('task.get', { projectId: store.projectId, taskId: card.taskId });
    } catch (failure) {
      toast.error(failure?.message ?? String(failure));
      return;
    }
    const task = read.task;
    const reportRegion = el('div', { class: 'code-scroll', style: 'max-height:220px' });

    const loadReport = async (result) => {
      try {
        const report = await store.rpc.call('task.report.get', {
          projectId: store.projectId,
          taskId: task.taskId,
          resultId: result.resultId,
        });
        replace(reportRegion, el('pre', { class: 'code-pre' }, [el('code', { text: report.text ?? '' })]));
      } catch (failure) {
        toast.error(failure?.message ?? String(failure));
      }
    };

    const results = Array.isArray(read.results) ? read.results : [];
    const resultsList =
      results.length === 0
        ? el('p', { class: 'board-help', text: t('runs.noResults') })
        : el(
            'div',
            { class: 'data-list', role: 'list' },
            results.map((result) =>
              dataRow({
                id: result.resultId,
                main: result.kind,
                meta: [result.verdict, result.summary, result.createdAt].filter(Boolean).join(' · '),
                status: String(result.version ?? '').slice(0, 10),
                onClick: () => void loadReport(result),
              }),
            ),
          );

    const members = Array.isArray(read.members) ? read.members : [];
    const membersList =
      members.length === 0
        ? el('p', { class: 'board-help', text: t('runs.noMembers') })
        : el(
            'div',
            { class: 'data-list', role: 'list' },
            members.map((member) =>
              dataRow({
                id: member.roleId,
                main: member.label,
                meta: [member.phase, member.expectedKind, member.sessionId]
                  .concat(Array.isArray(member.writeScope) && member.writeScope.length > 0 ? [`write: ${member.writeScope.join(', ')}`] : [])
                  .filter(Boolean)
                  .join(' · '),
                status: member.currentInputId === null || member.currentInputId === undefined ? '' : 'active',
              }),
            ),
          );

    const body = [
      el('dl', { class: 'card-facts' }, [
        fact(t('card.phase'), task.phase),
        fact(t('runs.status'), task.status),
        fact(t('runs.revision'), String(task.revision)),
        fact(t('runs.goal'), task.goal),
        fact(t('runs.scope'), task.scope),
        fact(t('card.updated'), relativeTime(task.updatedAt) || String(task.updatedAt ?? '')),
      ]),
      el('div', { class: 'config-section-title' }, [el('strong', { text: t('runs.members') })]),
      membersList,
      el('div', { class: 'config-section-title' }, [el('strong', { text: t('runs.results') })]),
      resultsList,
      el('div', { class: 'config-section-title' }, [el('strong', { text: t('runs.report') })]),
      reportRegion,
      el('div', { class: 'config-section-title' }, [el('strong', { text: t('runs.control') })]),
      el('div', { class: 'decision-actions' }, [
        controlButton(task, 'pause', 'run.pause', !['active', 'waiting'].includes(task.status)),
        controlButton(task, 'resume', 'run.resume', task.status !== 'paused'),
        controlButton(
          task,
          'cancel',
          'run.stop',
          ['completed', 'cancelled', 'cancelling'].includes(task.status),
        ),
      ]),
    ];

    await dialog.open({
      title: `${task.taskId} · ${task.goal}`,
      body,
      submitLabel: t('common.close'),
    });
  }

  return {
    id: 'runs',
    mount() {
      paint();
    },
    update() {
      paint();
    },
  };
}

function fact(label, value) {
  return el('div', {}, [el('dt', { text: label }), el('dd', { text: String(value ?? '') })]);
}
