/**
 * Shared scaffolding for the host-owned domain tools: the small outcome envelope, parameter readers
 * and the error message helper. Keeping one copy here means every tool module answers the same way.
 */

export interface ToolOutcome {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  /**
   * Images the model should look at (a screenshot). Kept beside the text instead of inside
   * `content`, so every existing tool and test still sees a text-only array; the adapter that
   * reaches Pi merges both.
   */
  readonly images?: readonly { readonly data: string; readonly mimeType: string }[];
  readonly details: Record<string, unknown>;
  readonly isError: boolean;
}

/**
 * Pi shows a tool's `content` to the model and keeps `details` for the UI. Facts the model must act
 * on (version, issues, sections, ids) therefore travel in the text as well: a model that cannot see
 * *why* a save was refused can only guess, which is exactly what it did before.
 */
function withPayload(text: string, payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? text : `${text}\n${JSON.stringify(Object.fromEntries(entries))}`;
}

export function ok(
  text: string,
  details: Record<string, unknown>,
  images: readonly { readonly data: string; readonly mimeType: string }[] = [],
): ToolOutcome {
  return {
    content: [{ type: 'text', text: withPayload(text, details) }],
    ...(images.length > 0 ? { images } : {}),
    details,
    isError: false,
  };
}

export function fail(code: string, text: string, details: Record<string, unknown> = {}): ToolOutcome {
  const payload = { code, ...details };
  return {
    content: [{ type: 'text', text: withPayload(`Error: ${text}`, payload) }],
    details: payload,
    isError: true,
  };
}

/**
 * Add facts to a refusal the model has already received: the same structured fields, and the same
 * disclosure in the text it reads. Never changes a success.
 */
export function enrich(outcome: ToolOutcome, extra: Record<string, unknown>): ToolOutcome {
  if (!outcome.isError) {
    return outcome;
  }
  return {
    ...outcome,
    content: [{ type: 'text', text: `${outcome.content[0]?.text ?? ''}\n${JSON.stringify(extra)}` }],
    details: { ...outcome.details, ...extra },
  };
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** A finite number, or undefined: a string "8" from a model is not silently coerced. */
export function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === 'string') ? (value as string[]) : undefined;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
