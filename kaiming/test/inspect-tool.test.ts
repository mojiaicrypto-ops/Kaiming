/**
 * The chief's inspector is the replacement for `bash` (P0-4). These tests assert the property that
 * makes the replacement meaningful: the argument table is fixed, model input cannot become a flag
 * or an escaping path, and a real git repository answers without being modified.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInspectTool, gitInspectArgs } from '../src/tools/inspect-tool.ts';
import type { ToolOutcome } from '../src/tools/tool-kit.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kaiming-inspect-'));
  dirs.push(dir);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('init', '--quiet');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'base');
  return dir;
}

function invoke(cwd: string, params: unknown): Promise<ToolOutcome> {
  return createInspectTool(() => ({ cwd })).execute('call-1', params);
}

describe('inspect argument table', () => {
  it('builds fixed read-only argv for every op', () => {
    const status = gitInspectArgs({ op: 'status' });
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error(status.message);
    expect(status.args).toEqual(
      expect.arrayContaining(['status', '--porcelain=v1', '-b']),
    );
    // The only -c is the host's fsmonitor suppression; no model value can add one.
    expect(status.args.filter((arg) => arg === '-c')).toHaveLength(1);

    for (const op of ['status', 'log', 'diff', 'show', 'rev-parse']) {
      const built = gitInspectArgs({ op });
      expect(built.ok, op).toBe(true);
      if (!built.ok) continue;
      expect(built.args, op).not.toContain('--output');
      expect(built.args, op).not.toContain('--ext-diff');
      expect(built.args, op).not.toContain('--exec');
      expect(built.args, op).not.toContain('--edit');
    }
    const diff = gitInspectArgs({ op: 'diff' });
    if (diff.ok) expect(diff.args).toEqual(expect.arrayContaining(['--no-ext-diff', '--no-textconv']));
  });

  it('rejects a revision that could be a flag, a path traversal, an unknown key or a bad limit', () => {
    for (const params of [
      { op: 'show', rev: '--output=/tmp/evil' },
      { op: 'show', rev: '-c' },
      { op: 'status', path: '../secret' },
      { op: 'status', path: '/etc/passwd' },
      { op: 'status', path: '-rf' },
      { op: 'log', limit: 0 },
      { op: 'log', limit: 51 },
      { op: 'log', limit: 1.5 },
      { op: 'status', limit: 5 },
      { op: 'show', rev: 'HEAD', path: '--output=x' },
      { op: 'status', extra: true },
      { op: 'rm' },
    ]) {
      const built = gitInspectArgs(params);
      expect(built.ok, JSON.stringify(params)).toBe(false);
    }
    expect(gitInspectArgs({ op: 'show', rev: 'HEAD~1' }).ok).toBe(true);
    expect(gitInspectArgs({ op: 'log', limit: 5, path: 'src/a.ts' }).ok).toBe(true);
  });
});

describe('inspect tool', () => {
  it('reads status, log, diff, show and the repository root without changing the repository', async () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(cwd, 'new.ts'), 'export const n = 1;\n');
    const statusBefore = execFileSync('git', ['status', '--porcelain=v1'], { cwd, encoding: 'utf8' });
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });

    const status = await invoke(cwd, { op: 'status' });
    expect(status.isError).toBe(false);
    const statusText = status.content.map((part) => part.text).join('\n');
    expect(statusText).toContain('a.ts');
    expect(statusText).toContain('new.ts');

    const log = await invoke(cwd, { op: 'log', limit: 5 });
    expect(log.content.map((part) => part.text).join('\n')).toContain('base');

    const diff = await invoke(cwd, { op: 'diff' });
    expect(diff.content.map((part) => part.text).join('\n')).toContain('a.ts');

    const show = await invoke(cwd, { op: 'show' });
    expect(show.content.map((part) => part.text).join('\n')).toContain('base');

    const root = await invoke(cwd, { op: 'rev-parse' });
    expect(root.content.map((part) => part.text).join('\n').split('\n')[0]).toBe(realpathSync(cwd));

    expect(execFileSync('git', ['status', '--porcelain=v1'], { cwd, encoding: 'utf8' })).toBe(statusBefore);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })).toBe(headBefore);
  });

  it('fails a write-flag attempt as an argument error, before git runs', async () => {
    const cwd = repo();
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });

    const result = await invoke(cwd, { op: 'show', rev: '--output=/tmp/evil' });

    expect(result.isError).toBe(true);
    expect(result.content.map((part) => part.text).join('\n')).toContain('rev must be a revision name');
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })).toBe(headBefore);
  });

  it('reports a non-repository as an error instead of pretending nothing changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kaiming-inspect-nogit-'));
    dirs.push(dir);
    const result = await invoke(dir, { op: 'status' });
    expect(result.isError).toBe(true);
    expect(result.content.map((part) => part.text).join('\n').toLowerCase()).toContain('not a git repository');
  });

  it.skipIf(process.platform === 'win32')(
    'does not execute repository-configured diff, textconv or fsmonitor helpers',
    async () => {
      const cwd = repo();
      const marker = join(cwd, 'helper-ran');
      const helper = join(cwd, 'helper.sh');
      writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\nexit 0\n`, 'utf8');
      chmodSync(helper, 0o755);
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd, stdio: 'ignore' });
      };
      // All three are ways a repository could run code during an "inspection": an external diff, a
      // textconv driver, and the fsmonitor hook. The tool disables each at the argv/config level.
      git('config', 'diff.external', helper);
      git('config', 'diff.evil.textconv', helper);
      git('config', 'core.fsmonitor', helper);
      writeFileSync(join(cwd, '.gitattributes'), '* diff=evil\n', 'utf8');
      writeFileSync(join(cwd, 'a.ts'), 'export const a = 4;\n', 'utf8');

      await invoke(cwd, { op: 'status' });
      await invoke(cwd, { op: 'diff' });
      await invoke(cwd, { op: 'show' });
      await invoke(cwd, { op: 'log' });

      expect(existsSync(marker)).toBe(false);
    },
  );
});
