import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadModelConfig, parseModelConfig } from '../spikes/harness/model-config.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeConfig(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-model-config-'));
  dirs.push(dir);
  const path = join(dir, 'model.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('model config', () => {
  it('accepts an official provider key supplied through the environment', () => {
    const result = parseModelConfig({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    });

    expect(result).toEqual({
      ok: true,
      config: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        providers: {},
      },
    });
  });

  it('registers a custom OpenAI-compatible endpoint under the given provider id', () => {
    const result = parseModelConfig({
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      endpoint: { baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-completions', apiKey: 'ollama' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('unreachable');
    }
    expect(result.config.providers).toEqual({
      local: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        api: 'openai-completions',
        apiKey: 'ollama',
        models: [{ id: 'qwen2.5-coder:7b', name: 'qwen2.5-coder:7b' }],
      },
    });
  });

  it('rejects unfilled placeholders instead of starting a doomed run', () => {
    expect(parseModelConfig({ provider: 'REPLACE_ME', model: 'x' })).toEqual({
      ok: false,
      error: 'provider must be set to a real provider id',
    });
    expect(parseModelConfig({ provider: 'openai', model: 'REPLACE_ME' })).toEqual({
      ok: false,
      error: 'model must be set to a real model id',
    });
  });

  it('rejects malformed shapes', () => {
    expect(parseModelConfig('nope').ok).toBe(false);
    expect(parseModelConfig({ provider: 'openai', model: 'gpt-5', env: [] })).toEqual({
      ok: false,
      error: 'env must be an object',
    });
    expect(parseModelConfig({ provider: 'openai', model: 'gpt-5', env: { KEY: 1 } })).toEqual({
      ok: false,
      error: 'env.KEY must be a string',
    });
    expect(parseModelConfig({ provider: 'local', model: 'm', endpoint: { api: 'openai-completions' } })).toEqual({
      ok: false,
      error: 'endpoint.baseUrl must be a non-empty string',
    });
  });

  it('reports a missing or unparsable file with the path', () => {
    const missing = loadModelConfig('/nonexistent/model.json');
    expect(missing.ok).toBe(false);
    if (missing.ok) {
      throw new Error('unreachable');
    }
    expect(missing.error).toContain('/nonexistent/model.json');

    const dir = mkdtempSync(join(tmpdir(), 'devagent-model-config-'));
    dirs.push(dir);
    const broken = join(dir, 'model.json');
    writeFileSync(broken, '{ not json');
    const parsedBroken = loadModelConfig(broken);
    expect(parsedBroken.ok).toBe(false);

    const good = writeConfig({ provider: 'openai', model: 'gpt-5' });
    const loaded = loadModelConfig(good);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error('unreachable');
    }
    expect(loaded.config).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      env: {},
      providers: {},
    });
  });
});