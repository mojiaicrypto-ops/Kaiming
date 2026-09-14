/**
 * Deterministic JSON serialisation, shared by every surface that hashes a payload.
 *
 * The Runner computes a tool call's `expectedInputHash` and Core recomputes the same
 * digest to decide whether a retried `tool.execute` is a replay of the same call or an
 * `IDEMPOTENCY_CONFLICT` (`docs/architecture/protocol.md` §6, `reliability.md` §2:
 * "同操作同Hash重取原结果，不重复消费，同操作不同Hash拒绝"). Two independent
 * implementations of "canonical JSON" would break that equality the moment either side
 * changed key ordering, so the rule lives here once and both sides import it.
 *
 * The rule is the one the repository has always used for ledger and snapshot hashes
 * (`core/dispatcher.ts` re-exports this function for compatibility):
 *
 * - object keys sorted by code unit, so insertion order cannot change the digest;
 * - `undefined` members dropped, so an omitted optional field and an explicit
 *   `undefined` hash identically;
 * - arrays keep their order, because a tool argument list is ordered;
 * - anything else falls back to `JSON.stringify` (`null` for `undefined`).
 *
 * This module is browser-safe: it depends on nothing but the language.
 */

/** Canonical JSON for one value; see the module note for the exact normalisation. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}
