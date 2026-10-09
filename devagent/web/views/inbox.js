/**
 * The Inbox view: everything that needs a human. Three real sources only - open questions of the
 * current session (answered through the shared interaction card), recovery findings from
 * `session.recovery.inspect` (with a real evidence-carrying resolve action), and Task rows whose
 * `blockReason` or `nextStep` is set. When none of them exists the view says so.
 *
 * Re-render discipline: a stream frame can call `update()` several times a second, so the view
 * rebuilds only when a signature of the underlying facts changes - a re-render while the user types
 * an evidence reference would throw the field away.
 */
import { el, qs, replace } from '../core/dom.js';
import { createInteractionCard } from '../components/interaction-card.js';

export function createInboxView(context) {
  const { rpc, store, i18n, toast } = context;
  const container = qs('#inboxContent');
  let recovery = null;
  let recoveryFor = null;
  let loadingRecovery = false;
  let signature = null;

  const t = (key) => i18n.t(key);

  function blockedTasks() {
    return (store.tasks ?? []).filter(
      (task) => isSet(task.blockReason) || isSet(task.nextStep),
    );
  }

  function currentSignature() {
    const questions = (store.pendingInteractions ?? [])
      .map((entry) => `${entry.interactionId}:${entry.revision}`)
      .join(',');
    const findings = (recovery?.interruptedInputs ?? [])
      .map((entry) => `${entry.inputId}:${entry.revision}`)
      .join(',');
    const blocked = blockedTasks().map((task) => `${task.taskId}:${task.status}:${task.revision}`).join(',');
    return [i18n.language, store.sessionId, recovery?.error ?? '', questions, findings, blocked].join('|');
  }

  async function refreshRecovery() {
    if (store.projectId === null || store.sessionId === null) {
      recovery = null;
      recoveryFor = null;
      return;
    }
    loadingRecovery = true;
    try {
      const read = await rpc.call('session.recovery.inspect', {
        projectId: store.projectId,
        sessionId: store.sessionId,
      });
      const interruptedInputs = [];
      for (const input of read.interruptedInputs ?? []) {
        // The resolve CAS needs the revision the user actually saw; ask the input directly.
        let revision;
        try {
          const got = await rpc.call('session.input.get', {
            projectId: store.projectId,
            sessionId: store.sessionId,
            inputId: input.inputId,
          });
          revision = got.input?.revision;
        } catch {
          revision = undefined;
        }
        interruptedInputs.push({ ...input, revision });
      }
      recovery = { ...read, interruptedInputs };
      recoveryFor = store.sessionId;
    } catch (error) {
      recovery = { error: error?.message ?? String(error), interruptedInputs: [] };
      recoveryFor = store.sessionId;
    } finally {
      loadingRecovery = false;
    }
  }

  async function sync() {
    if (store.sessionId !== recoveryFor && !loadingRecovery) {
      await refreshRecovery();
    }
    paint();
  }

  function paint() {
    if (container === null) {
      return;
    }
    const next = currentSignature();
    if (next === signature) {
      return;
    }
    signature = next;
    const parts = [questionsSection(), recoverySection(), blockedSection(blockedTasks())].filter(Boolean);
    if (parts.length === 0) {
      replace(container, el('p', { class: 'muted', text: t('inbox.empty') }));
      return;
    }
    replace(container, ...parts);
  }

  function section(titleKey, count, rows) {
    if (rows.length === 0) {
      return null;
    }
    return el('section', { class: 'config-section' }, [
      el('div', { class: 'config-section-title' }, [
        el('strong', { text: t(titleKey) }),
        el('span', { text: String(count) }),
      ]),
      el('div', { class: 'data-list', role: 'list' }, rows),
    ]);
  }

  function questionsSection() {
    const pending = store.pendingInteractions ?? [];
    const rows = pending.map((interaction) => {
      const card = createInteractionCard(interaction, {
        t,
        onAnswer: async (interactionId, revision, response) => {
          await store.answerInteraction(interactionId, revision, response);
          toast.success(t('inbox.answered'));
        },
      });
      return el('div', { class: 'data-row' }, [
        el('span', { class: 'data-id', text: interaction.method ?? 'question' }),
        el('span', { class: 'data-main' }, [
          el('strong', { text: interaction.title ?? interaction.interactionId }),
          isSet(interaction.message) ? el('small', { text: interaction.message }) : null,
          card.node,
        ]),
        el('span', { class: 'data-status', text: t('inbox.statusQuestion') }),
      ]);
    });
    return section('inbox.questions', pending.length, rows);
  }

  function recoverySection() {
    if (recovery === null) {
      return null;
    }
    if (recovery.error !== undefined) {
      return section('inbox.recovery', 1, [
        el('div', { class: 'data-row' }, [
          el('span', { class: 'data-id', text: 'ERR' }),
          el('span', { class: 'data-main' }, [
            el('strong', { text: t('inbox.recoveryErrorTitle') }),
            el('small', { text: recovery.error }),
          ]),
          el('span', { class: 'data-status', text: 'error' }),
        ]),
      ]);
    }
    const findings = recovery.interruptedInputs ?? [];
    return section('inbox.recovery', findings.length, findings.map((input) => recoveryRow(input)));
  }

  function recoveryRow(input) {
    const resolution = el(
      'select',
      { class: 'config-select' },
      ['completed', 'failed', 'stopped'].map((value) =>
        el('option', { value, text: t(`inbox.resolution.${value}`) }),
      ),
    );
    const evidence = el('input', {
      class: 'config-input',
      type: 'text',
      placeholder: t('inbox.evidencePlaceholder'),
      autocomplete: 'off',
    });
    const resolveButton = el('button', {
      class: 'config-button primary',
      type: 'button',
      text: t('inbox.resolve'),
      disabled: true,
      onclick: () => void resolve(input, resolution.value, evidence.value, resolveButton),
    });
    evidence.addEventListener('input', () => {
      resolveButton.disabled = evidence.value.trim() === '' || input.revision === undefined;
    });
    return el('div', { class: 'data-row' }, [
      el('span', { class: 'data-id', text: input.inputId }),
      el('span', { class: 'data-main' }, [
        el('strong', { text: `${input.kind ?? 'input'} · ${input.errorCode ?? 'error'}` }),
        isSet(input.errorMessage) ? el('small', { text: input.errorMessage }) : null,
        el('div', { class: 'recovery-resolve' }, [resolution, evidence, resolveButton]),
      ]),
      el('span', { class: 'data-status', text: t('inbox.statusInterrupted') }),
    ]);
  }

  async function resolve(input, resolution, evidenceText, button) {
    if (input.revision === undefined) {
      toast.error(t('inbox.revisionUnknown'));
      return;
    }
    const evidenceRefs = evidenceText
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (evidenceRefs.length === 0) {
      toast.error(t('inbox.evidenceRequired'));
      return;
    }
    button.disabled = true;
    try {
      await rpc.call('session.recovery.resolve', {
        projectId: store.projectId,
        sessionId: store.sessionId,
        inputId: input.inputId,
        expectedRevision: input.revision,
        resolution,
        evidenceRefs,
      });
      toast.success(t('inbox.resolved'));
      signature = null;
      await refreshRecovery();
      paint();
    } catch (error) {
      toast.error(error?.message ?? String(error));
    } finally {
      button.disabled = false;
    }
  }

  function blockedSection(tasks) {
    const rows = tasks.map((task) =>
      el('div', { class: 'data-row' }, [
        el('span', { class: 'data-id', text: task.taskId }),
        el('span', { class: 'data-main' }, [
          el('strong', { text: task.goal ?? task.summary ?? task.type ?? task.taskId }),
          el('small', { text: task.blockReason ?? task.nextStep ?? '' }),
        ]),
        el('span', { class: 'data-status', text: task.status ?? '' }),
      ]),
    );
    return section('inbox.blocked', tasks.length, rows);
  }

  return {
    id: 'inbox',
    mount() {
      signature = null;
      recoveryFor = null;
      void sync();
    },
    update() {
      void sync();
    },
  };
}

function isSet(value) {
  return value !== undefined && value !== null && value !== '';
}
