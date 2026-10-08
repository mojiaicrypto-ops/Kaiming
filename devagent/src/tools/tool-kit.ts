/**
 * Shared scaffolding for the host-owned domain tools: the small outcome envelope, parameter readers
 * and the error message helper. Keeping one copy here means every tool module answers the same way.
 */

export interface ToolOutcome {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly details: Record<string, unknown>;
  readonly isError: boolean;
}

export function ok(text: string, details: Record<string, unknown>): ToolOutcome {
  return { content: [{ type: 'text', text }], details, isError: false };
}

export function fail(code: string, text: string, details: Record<string, unknown> = {}): ToolOutcome {
  return { content: [{ type: 'text', text: `Error: ${text}` }], details: { code, ...details }, isError: true };
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
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
