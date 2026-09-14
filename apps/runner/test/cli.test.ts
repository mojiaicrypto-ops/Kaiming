/**
 * Runner CLI argument tests (WP-12 T2.3).
 *
 * `protocol.md` §6 needs the Runner to know which Work it is assessing and where Core's
 * control endpoint lives; `execution.md` §2 keeps its capability out of the process
 * arguments. These tests pin both halves of that handoff.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { capabilityFromCatalog, parseCliArgs, UsageError } from '../src/cli.js';

const root = mkdtempSync(join(tmpdir(), 'agentdev-runner-cli-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const base = [
  '--attempt-id',
  'attempt-1',
  '--epoch',
  '2',
  '--provider',
  'agentdev-gateway',
  '--model',
  'stub-model',
  '--cwd',
  root,
  '--agent-dir',
  join(root, 'agent'),
];

describe('runner CLI (protocol.md §6)', () => {
  it('parses the role and Work the control tools need', () => {
    const options = parseCliArgs([
      ...base,
      '--role',
      'chief',
      '--work-id',
      'work-1',
      '--control-url',
      'http://127.0.0.1:50123',
    ]);
    expect(options).toMatchObject({
      role: 'chief',
      workId: 'work-1',
      controlUrl: 'http://127.0.0.1:50123',
      attemptId: 'attempt-1',
      epoch: 2,
    });
  });

  it('rejects an unknown role and a non-positive epoch', () => {
    expect(() => parseCliArgs([...base, '--role', 'nobody'])).toThrowError(UsageError);
    const zeroEpoch = base.map((value) => (value === '2' ? '0' : value));
    expect(() => parseCliArgs(zeroEpoch)).toThrowError(UsageError);
  });

  it('reads the capability from the per-Attempt catalog, never from argv', () => {
    const catalog = join(root, 'models.json');
    writeFileSync(
      catalog,
      JSON.stringify({
        providers: { 'agentdev-gateway': { baseUrl: 'http://127.0.0.1:1', apiKey: 'cap-token' } },
      }),
    );
    expect(capabilityFromCatalog(catalog)).toBe('cap-token');
    expect(capabilityFromCatalog(join(root, 'missing.json'))).toBe('');
    expect(capabilityFromCatalog(null)).toBe('');
    // The flag is not part of the interface at all: a capability on argv would be visible
    // to every local process through `ps`.
    expect(() => parseCliArgs([...base, '--capability', 'leaked'])).toThrow();
  });
});
