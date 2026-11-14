/**
 * `PiRuntimeFactory.isAvailable` must answer from the runtime's in-memory availability snapshot
 * and re-read the credential/catalog files only when they change on disk (plan
 * worker-idle-scan-20261114): the SDK's full pass resolves credentials for every provider and
 * used to run once per claim probe. Both properties are falsifiable: a monkey-patched full path
 * must never be hit while files are quiet, and a hand edit must reach the next call (R5).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const provider = (apiKey: string): Record<string, unknown> => ({
  baseUrl: 'http://127.0.0.1:9999/v1',
  api: 'openai-completions',
  name: 'Bench',
  apiKey,
  models: [
    { id: 'm-1', name: 'M1', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 },
  ],
});

function factory(): PiRuntimeFactory {
  const agentDir = mkdtempSync(join(tmpdir(), 'kaiming-availability-'));
  dirs.push(agentDir);
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'p-bench': provider('sk-one') } }));
  return new PiRuntimeFactory({
    model: { providerId: 'unset', modelId: 'unset' },
    agentDir,
    promptDir: '/prompts',
    tools: [],
  });
}

describe('availability snapshot', () => {
  it('answers from the snapshot without running the full availability pass', async () => {
    const bench = factory();
    const selection = { providerId: 'p-bench', modelId: 'm-1' };
    expect(await bench.isAvailable(selection)).toBe(true);
    type Patchable = { getAvailable(...args: unknown[]): Promise<unknown> };
    const proto = ModelRuntime.prototype as unknown as Patchable;
    const original = proto.getAvailable;
    try {
      proto.getAvailable = (): never => {
        throw new Error('the full availability pass must not run while the config files are quiet');
      };
      expect(await bench.isAvailable(selection)).toBe(true);
    } finally {
      proto.getAvailable = original;
    }
  });

  it('re-reads the configuration after a hand edit (R5: next call sees new files)', async () => {
    const bench = factory();
    const agentDir = dirs[dirs.length - 1] as string;
    const selection = { providerId: 'p-bench', modelId: 'm-1' };
    expect(await bench.isAvailable(selection)).toBe(true);
    // Provider removed by a hand edit: the stamp changes, the next call must not serve the stale
    // snapshot. (Empty content keeps this a size-changing rewrite.)
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: {} }));
    expect(await bench.isAvailable(selection)).toBe(false);
    // Restored with a different key: a stale-but-refreshing implementation would still answer
    // false here; the snapshot must come from the re-read files.
    writeFileSync(
      join(agentDir, 'models.json'),
      JSON.stringify({ providers: { 'p-bench': provider('sk-two') } }),
    );
    expect(await bench.isAvailable(selection)).toBe(true);
  });
});
