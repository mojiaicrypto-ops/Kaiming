import { describe, expect, it } from 'vitest';
import { rollupUsage } from '../src/runtime/usage-rollup.ts';

const message = (overrides: Record<string, unknown> = {}) => ({
  role: 'assistant',
  provider: 'zai',
  model: 'glm-5-3',
  usage: {
    input: 100,
    output: 20,
    cacheRead: 30,
    cacheWrite: 10,
    reasoning: 5,
    cost: { total: 0.5 },
  },
  ...overrides,
});

describe('folding one input\'s responses into per-model totals', () => {
  it('sums every response of the same model, including tool rounds', () => {
    const entries = rollupUsage([message(), message(), message()]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      providerId: 'zai',
      modelId: 'glm-5-3',
      responses: 3,
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 90,
      cacheWriteTokens: 30,
      reasoningTokens: 15,
    });
    expect(entries[0]?.costTotal).toBeCloseTo(1.5);
  });

  it('keeps models apart, so a compaction or fallback is counted where it was spent', () => {
    // A session can use a second model mid-input (compaction, fallback). The response says which,
    // and the configuration's intent must not overwrite that fact.
    const entries = rollupUsage([
      message(),
      message({ provider: 'deepseek', model: 'deepseek-flash', usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 } }),
    ]);
    expect(entries.map((entry) => entry.modelId).sort()).toEqual(['deepseek-flash', 'glm-5-3']);
    expect(entries.find((entry) => entry.modelId === 'deepseek-flash')?.inputTokens).toBe(7);
  });

  it('treats an all-zero usage as "not reported", not as a free request', () => {
    // Pi initializes usage to zeros and only fills it when the provider sends one. A request whose
    // price is unknown is still a request; showing 0 tokens would claim it cost nothing.
    const entries = rollupUsage([
      message({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } }),
    ]);
    expect(entries[0]).toMatchObject({
      responses: 1,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      costTotal: null,
    });
  });

  it('treats a missing usage object the same way', () => {
    const entries = rollupUsage([message({ usage: undefined })]);
    expect(entries[0]).toMatchObject({ responses: 1, inputTokens: null });
  });

  it('keeps a reported zero reasoning count, and leaves an unknown price out of the total', () => {
    // Pi cannot tell "the provider sent reasoning: 0" from "the provider sent nothing", so a 0 is
    // kept: a response that used no reasoning is the ordinary case. A zero *cost* is different —
    // Pi prices from the catalogue, so no price means unknown, not free.
    const entries = rollupUsage([message({ usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 } })]);
    expect(entries[0]?.reasoningTokens).toBe(0);
    expect(entries[0]?.costTotal).toBeNull();
  });

  it('counts only the messages after the boundary, so an earlier input is not counted twice', () => {
    const entries = rollupUsage([message(), message()], 1);
    expect(entries[0]?.responses).toBe(1);
    expect(entries[0]?.inputTokens).toBe(100);
  });

  it('ignores non-assistant messages and returns nothing for a turn without responses', () => {
    expect(rollupUsage([{ role: 'user' }, { role: 'toolResult' }])).toEqual([]);
  });
});
