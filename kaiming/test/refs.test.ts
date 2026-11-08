import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRef, resolveRef } from '../src/runtime/refs.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-refs-'));
  dirs.push(root);
  return root;
}

describe('parseRef', () => {
  it('treats a bare location as a project-relative path', () => {
    expect(parseRef('.dev/product/account.md#密码重置')).toEqual({
      scheme: 'repo',
      path: '.dev/product/account.md',
      heading: '密码重置',
    });
  });

  it('accepts an explicit repo scheme', () => {
    expect(parseRef('repo:docs/x.md')).toEqual({ scheme: 'repo', path: 'docs/x.md' });
  });

  it('refuses another scheme instead of treating it as a path', () => {
    expect(() => parseRef('jira:PROJ-12')).toThrow(/不支持的引用类型/);
  });

  it('refuses absolute paths and paths that leave the project', () => {
    expect(() => parseRef('/etc/passwd')).toThrow(/项目相对路径/);
    expect(() => parseRef('../outside.md')).toThrow(/越出项目目录/);
  });

  it('refuses an empty reference', () => {
    expect(() => parseRef('   ')).toThrow(/不能为空/);
  });
});

describe('resolveRef', () => {
  it('resolves an existing file, reports the heading and hashes the content outside Git', () => {
    const cwd = project();
    mkdirSync(join(cwd, '.dev', 'product'), { recursive: true });
    writeFileSync(join(cwd, '.dev', 'product', 'account.md'), '# 账号\n\n## 密码重置\n', 'utf8');
    const resolved = resolveRef(cwd, '.dev/product/account.md#密码重置');
    expect(resolved.exists).toBe(true);
    expect(resolved.headingFound).toBe(true);
    expect(resolved.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a missing heading while still resolving the file', () => {
    const cwd = project();
    writeFileSync(join(cwd, 'spec.md'), '# 只有这一节\n', 'utf8');
    const resolved = resolveRef(cwd, 'spec.md#不存在的标题');
    expect(resolved.exists).toBe(true);
    expect(resolved.headingFound).toBe(false);
  });

  it('reports a missing file without throwing', () => {
    const cwd = project();
    expect(resolveRef(cwd, '.dev/product/none.md')).toMatchObject({ exists: false });
  });

  it('returns the Git blob hash for a tracked, clean file', () => {
    const cwd = project();
    writeFileSync(join(cwd, 'spec.md'), '# 规格\n', 'utf8');
    execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['add', 'spec.md'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'spec'], { cwd, stdio: 'ignore' });
    const blob = execFileSync('git', ['hash-object', '--', 'spec.md'], { cwd, encoding: 'utf8' }).trim();
    expect(resolveRef(cwd, 'spec.md').version).toBe(blob);
  });

  it('falls back to the content hash once the tracked file is modified', () => {
    const cwd = project();
    const path = join(cwd, 'spec.md');
    writeFileSync(path, '# 规格\n', 'utf8');
    execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['add', 'spec.md'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'spec'], { cwd, stdio: 'ignore' });
    writeFileSync(path, '# 规格（改过）\n', 'utf8');
    expect(resolveRef(cwd, 'spec.md').version).toMatch(/^[0-9a-f]{64}$/);
  });
});
