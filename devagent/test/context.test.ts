import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTurnContextText } from '../src/runtime/context.ts';
import { sliceInjectedBody } from '../src/runtime/prompt-assembly.ts';

const PROMPT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'technicalnew',
  'prompts',
);

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A throwaway path, used only so the slicing errors can name a plausible file. */
function scratchPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-slice-'));
  dirs.push(dir);
  return join(dir, 'prompt.md');
}

describe('prompt slicing', () => {
  it('slices from the start boundary to EOF when there is no end boundary', () => {
    const body = sliceInjectedBody(
      '# Title\n\n## Role and goal\nBody line.\n',
      'role',
      join(PROMPT_DIR, 'X.md'),
    );

    expect(body).toBe('## Role and goal\nBody line.\n');
  });

  it('stops before the end boundary for the specialists slice', () => {
    const body = sliceInjectedBody(
      '## Shared rules\nR1\n## Role file map\n| roleId |\n',
      'specialists',
      join(PROMPT_DIR, 'specialists.md'),
    );

    expect(body).toBe('## Shared rules\nR1\n');
  });

  it('refuses a missing start or end boundary', () => {
    expect(() => sliceInjectedBody('## Something\n', 'role', scratchPath())).toThrow(/is missing/);
    expect(() =>
      sliceInjectedBody('## Shared rules\nR1\n', 'specialists', scratchPath()),
    ).toThrow(/is missing/);
  });

  it('refuses a duplicated start or end boundary instead of injecting half a body', () => {
    expect(() =>
      sliceInjectedBody('## Role and goal\nA\n## Role and goal\nB\n', 'role', 'x.md'),
    ).toThrow(/appears more than once/);
    expect(() =>
      sliceInjectedBody(
        '## Shared rules\nR1\n## Role file map\nM1\n## Role file map\nM2\n',
        'specialists',
        'specialists.md',
      ),
    ).toThrow(/appears more than once/);
  });
});

describe('turn context text', () => {
  it('states the input, task, plan, authorization and the grounds to read', () => {
    const text = buildTurnContextText({
      inputId: 'i-1',
      taskSummary: 'implement password reset',
      phase: 'develop',
      planPath: '.dev/work/t-1/plan.md',
      authorizationRef: 'm-001',
      refs: ['docs/requirements/req-1.md', 'docs/product/account.md'],
      dependsOnResultIds: ['r-1'],
    });

    expect(text).toContain('Current input: i-1');
    expect(text).toContain('Task: implement password reset');
    expect(text).toContain('Phase: develop');
    expect(text).toContain('Overall Plan: .dev/work/t-1/plan.md');
    expect(text).toContain('Authorization: m-001');
    expect(text).toContain('- docs/requirements/req-1.md');
    expect(text).toContain('- docs/product/account.md');
    expect(text).toContain('Earlier results to rely on: r-1');
  });

  it('says "none" for everything a free discussion does not have', () => {
    const text = buildTurnContextText({ inputId: 'i-2' });

    expect(text).toBe(
      [
        'Current input: i-2',
        'Task: none',
        'Phase: none',
        'Overall Plan: none',
        'Authorization: none',
        'Formal grounds: none',
      ].join('\n'),
    );
  });
});