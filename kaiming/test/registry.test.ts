/**
 * A reusable Pi instance is keyed by everything that shapes the session. A cwd or sandbox policy
 * change must rebuild it; leaving either out silently reuses the old boundary.
 */
import { describe, expect, it } from 'vitest';
import type { CreateSessionOptions, PiRuntimeFactory, PiSessionHandle } from '../src/runtime/pi-runtime.ts';
import type { EffectiveConfig } from '../src/runtime/config.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';

const config: EffectiveConfig = {
  selection: { providerId: 'p', modelId: 'm' },
  thinkingLevel: 'off',
  source: 'server',
  agentDir: '/tmp/agent',
  promptDir: '/tmp/prompts',
  tools: [],
};

describe('sandbox-aware registry binding', () => {
  it('rebuilds when cwd or sandboxKey changes, and only then', async () => {
    const created: CreateSessionOptions[] = [];
    const factory = {
      create: async (_config: EffectiveConfig, options: CreateSessionOptions) => {
        created.push(options);
        return {
          piFile: () => options.piFile,
          dispose: () => undefined,
        } as unknown as PiSessionHandle;
      },
    } as unknown as PiRuntimeFactory;
    const registry = new SessionRegistry(factory);
    const base = { sessionId: 's-1', cwd: '/project' };
    await registry.acquire(base, config);
    await registry.acquire(base, config);
    expect(created).toHaveLength(1);
    await registry.acquire({ ...base, cwd: '/other' }, config);
    expect(created).toHaveLength(2);
    await registry.acquire({ ...base, sandboxKey: 'policy-a' }, config);
    expect(created).toHaveLength(3);
    await registry.acquire({ ...base, sandboxKey: 'policy-b' }, config);
    expect(created).toHaveLength(4);
  });
});
