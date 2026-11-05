import type { UsageFigures } from '../store/store.ts';

/** One model's share of one input, as the ledger stores it. */
export interface UsageEntry extends UsageFigures {
  readonly providerId: string;
  readonly modelId: string;
}

/** The minimum a message must expose for its usage to be counted; non-assistant messages are skipped. */
export interface UsageBearingMessage {
  readonly role: string;
  readonly provider?: string;
  readonly model?: string;
  readonly usage?:
    | {
        readonly input: number;
        readonly output: number;
        readonly cacheRead: number;
        readonly cacheWrite: number;
        readonly reasoning?: number | undefined;
        readonly cost?: { readonly total: number } | undefined;
      }
    | undefined;
}

/**
 * Fold the responses of one input into per-(provider, model) totals.
 *
 * Two rules make the resulting numbers honest:
 *
 * - Attribution comes from the response, not from the configuration. A compaction or a fallback
 *   model is counted where the tokens were really spent.
 * - Pi initializes `usage` to zeros and fills it only when the provider sends one, so an all-zero
 *   usage means "not reported". Any real response consumes prompt tokens, so that usage becomes
 *   `null` figures rather than a free request; the response itself still counts.
 * - A zero cost is the same kind of absence: Pi prices a response from the catalogue, so a model
 *   with no catalogue cost yields 0. Recording that as "$0.00" would claim the request was free.
 */
export function rollupUsage(
  messages: readonly UsageBearingMessage[],
  from = 0,
): readonly UsageEntry[] {
  const totals = new Map<string, MutableEntry>();
  for (const message of messages.slice(from)) {
    if (message.role !== 'assistant') continue;
    if (message.provider === undefined || message.model === undefined) continue;
    const reported = message.usage !== undefined && isReported(message.usage);
    const reportedUsage = reported ? message.usage : undefined;
    const key = `${message.provider}\u0000${message.model}`;
    const entry = totals.get(key) ?? {
      providerId: message.provider,
      modelId: message.model,
      responses: 0,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      costTotal: null,
    };
    entry.responses += 1;
    entry.inputTokens = add(entry.inputTokens, reportedUsage?.input);
    entry.outputTokens = add(entry.outputTokens, reportedUsage?.output);
    entry.cacheReadTokens = add(entry.cacheReadTokens, reportedUsage?.cacheRead);
    entry.cacheWriteTokens = add(entry.cacheWriteTokens, reportedUsage?.cacheWrite);
    entry.reasoningTokens = add(entry.reasoningTokens, reportedUsage?.reasoning);
    // A zero total means Pi computed no price (the model has no catalogue cost), which is "unknown",
    // not "free". Sixtieth-of-a-cent totals are real; exactly zero never is.
    const cost = reportedUsage?.cost?.total;
    entry.costTotal = cost !== undefined && cost > 0 ? add(entry.costTotal, cost) : entry.costTotal;
    totals.set(key, entry);
  }
  return [...totals.values()];
}

type MutableEntry = { -readonly [K in keyof UsageEntry]: UsageEntry[K] };

function add(current: number | null, next: number | undefined): number | null {
  if (next === undefined || Number.isNaN(next)) return current;
  return (current ?? 0) + next;
}

/** Whether the provider actually filled the usage in, or Pi's zero initializer is still there. */
function isReported(usage: NonNullable<UsageBearingMessage['usage']>): boolean {
  return usage.input > 0 || usage.output > 0 || usage.cacheRead > 0 || usage.cacheWrite > 0;
}
