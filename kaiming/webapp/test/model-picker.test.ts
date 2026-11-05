import { describe, expect, it } from 'vitest';
import { rank, keyOf } from '../src/settings/ModelPicker';
import type { CatalogModel } from '../src/settings/config-model';

const model = (
  providerId: string,
  id: string,
  extra: Partial<CatalogModel> = {},
): CatalogModel => ({
  providerId,
  id,
  name: id,
  api: 'openai-completions',
  reasoning: true,
  thinkingLevels: ['off', 'low', 'high'],
  contextWindow: 200_000,
  maxTokens: 128_000,
  ...extra,
});

const CATALOG: readonly CatalogModel[] = [
  model('zai', 'glm-5-3'),
  model('openrouter', 'zai-org/glm-4-6-air'),
  model('baseten', 'deepseek-ai/DeepSeek-V4.1-Flash'),
  model('deepseek', 'deepseek-flash'),
  model('anthropic', 'claude-opus-4-6'),
];

describe('choosing a model by typing part of its name', () => {
  it('keeps the catalogue order until something is typed', () => {
    expect(rank(CATALOG, '', '').map(keyOf)).toEqual(CATALOG.map(keyOf));
  });

  it('finds a model from a contiguous piece of its name', () => {
    expect(rank(CATALOG, 'glm', '').map((entry) => entry.id)).toEqual(['glm-5-3', 'zai-org/glm-4-6-air']);
  });

  it('finds a model from scattered characters, which is what people actually type', () => {
    // "d4f" is how someone abbreviates DeepSeek-V4.1-Flash while typing fast.
    const found = rank(CATALOG, 'd4f', '').map((entry) => entry.id);
    expect(found[0]).toBe('deepseek-ai/DeepSeek-V4.1-Flash');
  });

  it('narrows to one provider when its name is typed', () => {
    const found = rank(CATALOG, 'baseten', '').map(keyOf);
    expect(found).toEqual(['baseten/deepseek-ai/DeepSeek-V4.1-Flash']);
  });

  it('never offers the provider being edited: a model cannot point at itself', () => {
    const found = rank(CATALOG, 'deepseek', 'deepseek').map(keyOf);
    expect(found).not.toContain('deepseek/deepseek-flash');
    expect(found).toContain('baseten/deepseek-ai/DeepSeek-V4.1-Flash');
  });

  it('returns nothing when the characters are not there in order', () => {
    expect(rank(CATALOG, 'zzz', '')).toEqual([]);
    expect(rank(CATALOG, 'flash opus', '')).toEqual([]);
  });

  it('prefers the tighter match when several contain the query', () => {
    // Both match "opus"; the shorter id must not be pushed below the longer one by name length.
    const catalog = [model('a', 'opus-but-a-much-longer-name'), model('b', 'opus')];
    expect(rank(catalog, 'opus', '')[0]?.id).toBe('opus');
  });
});
