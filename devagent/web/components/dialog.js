/**
 * One dialog surface for every question the workbench asks (the mock's dialog-head/body/actions).
 * A dialog is local UI state: it is never part of the route nor of a server record.
 */
import { el, qs, replace } from '../core/dom.js';

export function createDialog() {
  let node = qs('#appDialog');
  if (node === null) {
    node = el('dialog', { id: 'appDialog', class: 'dialog' });
    document.body.append(node);
  }
  let current = null;
  const close = (value) => {
    const resolve = current?.resolve;
    current = null;
    node.close();
    resolve?.(value);
  };
  node.addEventListener('cancel', (event) => {
    event.preventDefault();
    close(undefined);
  });
  return {
    /** Open a dialog; resolves with the value `onSubmit` produced, or undefined when dismissed. */
    open({ title, body, submitLabel = 'OK', cancelLabel = 'Cancel', onSubmit }) {
      current?.resolve?.(undefined);
      const bodyNode = el('div', { class: 'dialog-body' }, Array.isArray(body) ? body : [body]);
      const error = el('p', { class: 'dialog-error', hidden: true });
      const submit = el('button', {
        class: 'primary',
        type: 'button',
        text: submitLabel,
        onclick: async () => {
          try {
            const value = await onSubmit?.();
            if (value !== false) {
              close(value);
            }
          } catch (failure) {
            error.textContent = failure?.message ?? String(failure);
            error.hidden = false;
          }
        },
      });
      replace(
        node,
        el('div', { class: 'dialog-form' }, [
          el('div', { class: 'dialog-head' }, [el('strong', { text: title })]),
          bodyNode,
          error,
          el('div', { class: 'dialog-actions' }, [
            el('button', { type: 'button', text: cancelLabel, onclick: () => close(undefined) }),
            submit,
          ]),
        ]),
      );
      const promise = new Promise((resolve) => {
        current = { resolve };
      });
      node.showModal?.();
      return promise;
    },
    close() {
      close(undefined);
    },
  };
}
