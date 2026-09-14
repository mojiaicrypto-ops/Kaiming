import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { READ_LEDGER_SEAL_GENESIS, createReadLedger, sealReadLedger } from '../src/read-ledger.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('Runner read ledger seal (AC-085, WP-12 R3-2d)', () => {
  it('seals an empty ledger to the genesis value, not a placeholder', () => {
    // The same formula Core uses (`packages/core/src/context/ledger.ts`): the empty seal is
    // sha256(GENESIS) — a computed value, so no constant or all-zero hash can stand in.
    expect(sealReadLedger([])).toEqual({ seq: 0, hash: sha256(READ_LEDGER_SEAL_GENESIS) });
    expect(sealReadLedger([]).hash).not.toBe('0'.repeat(64));
  });

  it('chains each read into the accumulator and reports the last seq', () => {
    const ledger = createReadLedger();
    ledger.record({
      path: 'src/a.ts',
      revision: 'a'.repeat(40),
      hash: 'b'.repeat(64),
      reason: 'the task named it',
      bytes: 12,
    });
    ledger.record({
      path: 'src/b.ts',
      revision: 'a'.repeat(40),
      hash: 'c'.repeat(64),
      reason: 'followed the import',
      bytes: 34,
    });
    const seal = ledger.seal();
    expect(seal.seq).toBe(2);
    expect(seal.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(seal.hash).toBe(
      sealReadLedger([
        {
          seq: 1,
          path: 'src/a.ts',
          revision: 'a'.repeat(40),
          hash: 'b'.repeat(64),
          reason: 'the task named it',
          bytes: 12,
        },
        {
          seq: 2,
          path: 'src/b.ts',
          revision: 'a'.repeat(40),
          hash: 'c'.repeat(64),
          reason: 'followed the import',
          bytes: 34,
        },
      ]).hash,
    );
    // Idempotent, and a later read cannot rewrite a sealed Attempt.
    expect(ledger.seal()).toEqual(seal);
    ledger.record({
      path: 'src/c.ts',
      revision: 'a'.repeat(40),
      hash: 'd'.repeat(64),
      reason: 'too late',
      bytes: 1,
    });
    expect(ledger.seal()).toEqual(seal);
  });
});
