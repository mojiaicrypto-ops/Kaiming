/**
 * The mock's .data-list rows: 76px id, a flexible main column and an 86px status column, so Runs /
 * Inbox / Docs keep the same information density.
 */
import { el, replace } from '../core/dom.js';

export function dataRow({ id, main, meta, status, statusKind = '', onClick }) {
  return el(
    onClick === undefined ? 'div' : 'button',
    {
      class: 'data-row',
      ...(onClick === undefined ? {} : { type: 'button', onclick: onClick }),
    },
    [
      el('span', { class: 'data-id', text: id }),
      el('span', { class: 'data-main' }, [
        el('strong', { text: main }),
        meta === undefined ? null : el('small', { text: meta }),
      ]),
      el('span', { class: `data-status ${statusKind}`, text: status }),
    ],
  );
}

export function dataList(rows) {
  return el('div', { class: 'data-list', role: 'list' }, rows);
}

export function renderDataList(region, rows) {
  replace(region, dataList(rows));
}
