/**
 * The shipped browser script's reconnect policy (W9R1-10).
 *
 * `public/app.js` is a build artefact the server serves verbatim: it has no bundler
 * and no test harness of its own, so the browser-side facts the acceptance criteria
 * name are asserted against the shipped source. The reconnect ladder is one of them:
 * the previous fixed 2s infinite loop is exactly what `AC-078` bounds.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');

/**
 * The required failure-test suite (`W9R2-06`).
 *
 * The disconnect case used to assert `typeof notice.id === 'string' || true`, which
 * is true under every outcome and therefore evidence of nothing. The assertion is
 * now a real field check; this guard keeps it that way, because the defect is the
 * test itself and a vacuous assertion cannot fail at runtime.
 */
const failures = readFileSync(
  fileURLToPath(new URL('./workbench-failures.integration.test.ts', import.meta.url)),
  'utf8',
);

describe('required failure-test hygiene (W9R2-06)', () => {
  it('contains no always-true assertion', () => {
    // `x || true`, `expect(true)`, `toBeTruthy()` on a literal — any of them would
    // pin the suite green regardless of the product.
    expect(failures).not.toMatch(/\|\|\s*true\s*\)/u);
    expect(failures).not.toMatch(/expect\(true\)/u);
  });

  it('asserts the real reconnect attempt of the disconnection notice', () => {
    expect(failures).toMatch(/notice\.attempt/u);
    expect(failures).toMatch(
      /expect\(Number\.isInteger\(notice\.attempt\) && \(notice\.attempt \?\? 0\) > 0\)\.toBe\(true\)/u,
    );
    expect(failures).not.toMatch(/notice\.id === 'string'/u);
  });
});

/** The shipped policy object, parsed out of the script source. */
function shippedPolicy(): {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
} {
  const block = /const reconnectPolicy = \{([\s\S]*?)\};/u.exec(script)?.[1] ?? '';
  const value = (key: string): number => {
    const match = new RegExp(`${key}:\\s*([0-9_]+)`, 'u').exec(block);
    if (match === null) throw new Error(`${key} is not in the shipped policy`);
    return Number((match[1] ?? '').replaceAll('_', ''));
  };
  return {
    baseDelayMs: value('baseDelayMs'),
    maxDelayMs: value('maxDelayMs'),
    maxAttempts: value('maxAttempts'),
  };
}

/**
 * The shipped delay function, evaluated from its own source.
 *
 * The body is extracted rather than re-implemented, so the test fails if the
 * script's arithmetic drifts away from the bounded policy.
 */
function shippedDelay(attempt: number): number {
  const body = /function reconnectDelay\(attempt\) \{([\s\S]*?)\n {2}\}/u.exec(script)?.[1];
  if (body === undefined) throw new Error('reconnectDelay is not in the shipped script');
  const policy = shippedPolicy();
  // The shipped function body is evaluated as source, so the test fails if its
  // arithmetic drifts; it is a fixed literal from this repository, not user input.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const evaluate = new Function('attempt', 'reconnectPolicy', body) as (
    attempt: number,
    shipped: { readonly baseDelayMs: number; readonly maxDelayMs: number },
  ) => number;
  return evaluate(attempt, policy);
}

describe('browser reconnect policy (W9R1-10)', () => {
  it('uses the same bounded exponential ladder as the client package', () => {
    const policy = shippedPolicy();
    expect(policy.baseDelayMs).toBe(1000);
    expect(policy.maxDelayMs).toBe(30000);
    expect(policy.maxAttempts).toBeGreaterThan(0);
    expect(policy.maxAttempts).toBeLessThanOrEqual(10);
    expect(shippedDelay(1)).toBe(1000);
    expect(shippedDelay(2)).toBe(2000);
    expect(shippedDelay(3)).toBe(4000);
    expect(shippedDelay(4)).toBe(8000);
    expect(shippedDelay(5)).toBe(16000);
    // The ladder is capped, never unbounded.
    expect(shippedDelay(6)).toBe(30000);
    expect(shippedDelay(50)).toBe(30000);
    expect(shippedDelay(0)).toBe(1000);
  });

  it('caps the attempts and reports the honest closed state instead of looping', () => {
    // The fixed 2s loop is gone, the attempt counter advances, and a socket that did
    // open resets the ladder so the next break starts at the base delay again.
    expect(script).not.toMatch(/setTimeout\(openSocket,\s*2000\)/u);
    expect(script).toMatch(/state\.reconnectAttempt \+= 1/u);
    expect(script).toMatch(/state\.reconnectAttempt > reconnectPolicy\.maxAttempts/u);
    expect(script).toMatch(/state\.reconnectAttempt = 0/u);
    expect(script).toMatch(/window\.setTimeout\(openSocket, delay\)/u);
    expect(script).toMatch(/showConnection\('closed'\)/u);
    expect(script).toMatch(/if \(state\.connection === 'expired'\) return/u);
  });
});
