/**
 * The Runner's read ledger seal (`AC-085`, WP-12 R3-2d).
 *
 * `protocol.md` §6 `stage.submit` carries `readLedgerSeq`/`readLedgerHash`: the number of
 * content reads this Attempt really performed and the cumulative hash over their records.
 * The Runner owns them because only the Runner knows what it read; a model must never
 * invent them, so the `stage_yield` tool writes the sealed values instead of the model's
 * arguments.
 *
 * The formula is the repository's existing one
 * (`packages/core/src/context/ledger.ts` §24-32 / `readLedgerSealHash`), so Core can
 * re-compute the same value:
 *
 * ```text
 * acc0 = sha256("agentdev.read-ledger.seal.v1")
 * accᵢ = sha256(canonicalJson({ prev: accᵢ₋₁, seq, path, revision, hash, reason, bytes }))
 * seal = { seq: last entry's seq (0 when empty), hash: accₙ }
 * ```
 *
 * T2 runs no file tools, so an Attempt's ledger is truthfully empty and seals to
 * `sha256("agentdev.read-ledger.seal.v1")` — a computed value, not a placeholder.
 */
import { READ_LEDGER_SEAL_GENESIS, canonicalJson } from '@agentdev/contracts';
import { createHash } from 'node:crypto';

export { READ_LEDGER_SEAL_GENESIS };

/** One read this Attempt performed. */
export interface ReadLedgerRecord {
  readonly seq: number;
  readonly path: string;
  readonly revision: string;
  /** SHA-256 of the content that was read. */
  readonly hash: string;
  readonly reason: string;
  readonly bytes: number;
}

export interface ReadLedgerSeal {
  readonly seq: number;
  readonly hash: string;
}

export interface ReadLedger {
  record(entry: Omit<ReadLedgerRecord, 'seq'>): void;
  /** The sealed `(seq, hash)`; idempotent and stable for the Attempt. */
  seal(): ReadLedgerSeal;
  /** How many reads really happened. */
  readonly size: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Seals an ordered list of reads exactly as Core does (empty list included). */
export function sealReadLedger(entries: readonly ReadLedgerRecord[]): ReadLedgerSeal {
  let accumulator = sha256(READ_LEDGER_SEAL_GENESIS);
  for (const entry of entries) {
    accumulator = sha256(
      canonicalJson({
        prev: accumulator,
        seq: entry.seq,
        path: entry.path,
        revision: entry.revision,
        hash: entry.hash,
        reason: entry.reason,
        bytes: entry.bytes,
      }),
    );
  }
  const last = entries[entries.length - 1];
  return { seq: last === undefined ? 0 : last.seq, hash: accumulator };
}

/** One Attempt's ledger; the seal is computed once and never changes afterwards. */
export function createReadLedger(): ReadLedger {
  const entries: ReadLedgerRecord[] = [];
  let sealed: ReadLedgerSeal | undefined;
  return {
    record: (entry) => {
      if (sealed !== undefined) return;
      entries.push({ ...entry, seq: entries.length + 1 });
    },
    seal: () => {
      sealed ??= sealReadLedger(entries);
      return sealed;
    },
    get size() {
      return entries.length;
    },
  };
}
