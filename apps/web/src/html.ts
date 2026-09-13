/**
 * The HTML a browser and a screen reader both read, and the value formatting the
 * workbench pages share.
 *
 * Everything the pages render goes through `escapeHtml`/`attr`: a Requirement title,
 * a file path or an Agent's output is data, and data is never allowed to become
 * markup. The helpers here are deliberately tiny — no templating dependency is added
 * for the workbench (`pnpm-workspace.yaml` supply-chain policy).
 */
import type { Translator } from './i18n.js';

/** Escapes text for an HTML text node or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

/** Renders `key="value"` for every defined, non-boolean attribute. */
export function attrs(
  values: Readonly<Record<string, string | number | boolean | undefined>>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === false) continue;
    if (value === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}="${escapeHtml(String(value))}"`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

/** A complete HTML document. */
export function renderDocument(input: {
  readonly lang: string;
  readonly title: string;
  readonly body: string;
  readonly statusText?: string;
}): string {
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(input.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    '<link rel="stylesheet" href="/assets/styles.css">',
    '</head>',
    `<body data-status="${escapeHtml(input.statusText ?? 'ready')}">`,
    input.body,
    '<script type="module" src="/assets/app.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** One JSON island: the server's real snapshot, consumed by the client script. */
export function jsonIsland(id: string, value: unknown): string {
  // `</script>` inside a JSON string would end the island early, so the two
  // characters are escaped as JSON `\u003c` — still valid JSON, no markup.
  const payload = JSON.stringify(value).replace(/</gu, '\\u003c');
  return `<script type="application/json" id="${escapeHtml(id)}">${payload}</script>`;
}

/** A field that is labelled for both a sighted user and a screen reader. */
export function field(input: {
  readonly id: string;
  readonly labelKey: string;
  readonly value: string;
  readonly t: Translator;
  readonly hint?: string;
  readonly control?: string;
}): string {
  const label = input.t(input.labelKey);
  const control =
    input.control === 'textarea'
      ? `<textarea${attrs({ id: input.id, 'aria-describedby': input.hint === undefined ? undefined : `${input.id}-hint` })}>${escapeHtml(input.value)}</textarea>`
      : `<input${attrs({ id: input.id, type: 'text', value: input.value, 'aria-describedby': input.hint === undefined ? undefined : `${input.id}-hint` })}>`;
  return [
    `<div class="field">`,
    `<label${attrs({ for: input.id })}>${escapeHtml(label)}</label>`,
    control,
    input.hint === undefined
      ? ''
      : `<p class="hint" id="${input.id}-hint">${escapeHtml(input.hint)}</p>`,
    `</div>`,
  ]
    .filter((line) => line !== '')
    .join('');
}

/** `<dd>`-style pair used across the detail, agents, settings and runs pages. */
export function pair(
  label: string,
  value: string,
  options: { readonly code?: boolean } = {},
): string {
  return (
    `<div class="pair"><dt>${escapeHtml(label)}</dt>` +
    `<dd${options.code === true ? ' class="mono"' : ''}>${escapeHtml(value)}</dd></div>`
  );
}

/** A short, stable identifier shown to a user (never the whole UUID). */
export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

/** ISO-8601 UTC rendering of a stored timestamp; the device time zone is the default view. */
export function isoUtc(value: string | number | undefined): string {
  if (value === undefined) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** `received` / `decision_required` … rendered with the dictionary, never guessed. */
export function stateLabel(t: Translator, state: string): string {
  const key = `state.${state}`;
  const label = t(key);
  return label === key ? state : label;
}

/** A count that is always visible, including on a collapsed panel. */
export function badge(count: number, options: { readonly attention?: boolean } = {}): string {
  if (count <= 0) return '';
  return `<span${attrs({ class: `badge${options.attention === true ? ' attention' : ''}` })}>${String(count)}</span>`;
}
