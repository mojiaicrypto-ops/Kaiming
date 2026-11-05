import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('PiRuntimeFactory', () => {
  it('shares one ModelRuntime when two sessions start together', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'kaiming-runtime-'));
    dirs.push(agentDir);
    const factory = new PiRuntimeFactory({
      model: { providerId: 'unset', modelId: 'unset' },
      agentDir,
      promptDir: '/prompts',
      tools: [],
    });

    const [first, second] = await Promise.all([factory.runtime(), factory.runtime()]);

    expect(first).toBe(second);
  });
});
