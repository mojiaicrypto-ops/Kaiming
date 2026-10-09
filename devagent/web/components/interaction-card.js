/**
 * Open questions (M5): a pending interaction is rendered by its type (confirm / select / input), the
 * answer is sent with the revision the snapshot carried, and a stale request reports itself instead of
 * pretending it was answered.
 */
import { el, replace } from '../core/dom.js';

export function createInteractionCard(interaction, { onAnswer, t = (key) => key }) {
  const message = interaction.message === null || interaction.message === undefined ? null : el('p', { text: interaction.message });
  const controls = el('div', { class: 'interaction-controls' });
  const status = el('span', { class: 'interaction-state', text: 'pending' });
  const fail = (error) => {
    status.textContent = error?.code ?? 'error';
    status.classList.add('is-error');
  };
  const answer = async (response) => {
    status.textContent = 'sending';
    try {
      await onAnswer(interaction.interactionId, interaction.revision, response);
      status.textContent = 'answered';
    } catch (error) {
      // INTERACTION_STALE means the question can never be resumed; anything else is a real failure.
      fail(error);
    }
  };

  if (interaction.method === 'confirm') {
    controls.append(
      el('button', { class: 'primary', type: 'button', text: t('common.confirm') ?? 'Yes', onclick: () => answer({ confirmed: true }) }),
      el('button', { type: 'button', text: t('common.cancel') ?? 'No', onclick: () => answer({ confirmed: false }) }),
    );
  } else if (interaction.method === 'select') {
    for (const option of interaction.options ?? []) {
      controls.append(
        el('button', { type: 'button', text: option, onclick: () => answer({ value: option }) }),
      );
    }
  } else {
    const field = el('input', { type: 'text', placeholder: interaction.placeholder ?? '', class: 'interaction-input' });
    controls.append(
      field,
      el('button', {
        class: 'primary',
        type: 'button',
        text: t('common.save') ?? 'Send',
        onclick: () => answer({ value: field.value }),
      }),
    );
  }

  const node = el('div', { class: 'interaction-card', dataset: { interactionId: interaction.interactionId } }, [
    el('div', { class: 'interaction-head' }, [
      el('span', { class: 'interaction-kind', text: interaction.method }),
      el('strong', { text: interaction.title }),
      status,
    ]),
    message,
    controls,
  ]);
  return { node, interactionId: interaction.interactionId };
}

/** Render every pending question of a session into `region` (replace-on-invalidate). */
export function renderInteractions(region, interactions, options) {
  replace(region, ...interactions.map((interaction) => createInteractionCard(interaction, options).node));
}
