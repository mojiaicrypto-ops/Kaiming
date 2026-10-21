import type { PendingInteraction } from '../api/stream';

/**
 * The response shape each question method expects. `confirm` sends a boolean, `select` sends the
 * chosen option as `value`, `input` sends the typed text — the same envelope the server has always
 * accepted (R7); the panel only changes how the user gets there.
 */
export type AnswerDraft =
  | { readonly method: 'confirm'; readonly value: boolean }
  | { readonly method: 'select'; readonly value: string }
  | { readonly method: 'input'; readonly value: string };

export interface AnswerRow {
  readonly label: string;
  readonly value: unknown;
  /** The row that opens a text field instead of answering immediately. */
  readonly input?: boolean;
}

export function responseFor(method: string, value: unknown): unknown {
  if (method === 'confirm') return { confirmed: value === true };
  if (method === 'select') return { value };
  if (method === 'input') return { value };
  return { value };
}

/** Rows for the panel: one per option, plus the always-available escape hatch for a selection. */
export function rowsFor(interaction: PendingInteraction): AnswerRow[] {
  if (interaction.method === 'confirm') {
    return [
      { label: 'confirm', value: true },
      { label: 'reject', value: false },
    ];
  }
  if (interaction.method === 'select') {
    return [
      ...(interaction.options ?? []).map((option) => ({ label: option, value: option })),
      { label: 'other', value: null, input: true },
    ];
  }
  return [];
}

/** The echo shown on an answered card; a stable summary the server can also produce. */
export function echoOf(response: unknown): string {
  if (typeof response === 'object' && response !== null) {
    const record = response as Record<string, unknown>;
    if (typeof record['value'] === 'string') return record['value'];
    if (typeof record['confirmed'] === 'boolean') return record['confirmed'] ? 'yes' : 'no';
    if (record['cancelled'] === true) return 'cancelled';
  }
  return '—';
}
