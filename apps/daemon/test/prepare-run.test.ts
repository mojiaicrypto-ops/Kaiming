import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectCatalog } from '../src/prepare-run.js';

const dir = mkdtempSync(join(tmpdir(), 'agentdev-prepare-run-'));

function write(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('per-Attempt catalog inspection (WP-12 R4)', () => {
  it('accepts the catalog the daemon writes', () => {
    const path = write(
      'good.json',
      JSON.stringify({
        providers: {
          'agentdev-gateway': {
            baseUrl: 'http://127.0.0.1:1',
            api: 'openai-completions',
            apiKey: 'cap',
            models: [{ id: 'm', api: 'openai-completions' }],
          },
        },
      }),
    );
    expect(inspectCatalog(path)).toBeNull();
  });

  it('names the concrete reason a Runner would otherwise only report as MODEL_UNAVAILABLE', () => {
    expect(inspectCatalog(join(dir, 'missing.json'))).toBe('the file does not exist');
    expect(inspectCatalog(write('empty.json', ''))).toBe('the file is empty');
    expect(inspectCatalog(write('bad.json', '{oops'))).toBe('the file is not valid JSON');
    expect(inspectCatalog(write('none.json', '{}'))).toBe('it declares no providers');
    expect(inspectCatalog(write('other.json', '{"providers":{"other":{}}}'))).toBe(
      'it declares no agentdev-gateway provider',
    );
    expect(
      inspectCatalog(write('nomodels.json', '{"providers":{"agentdev-gateway":{"models":[]}}}')),
    ).toBe('its gateway provider lists no models');
  });
});
