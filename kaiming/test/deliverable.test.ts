import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestOfPaths, snapshotDelivery } from '../src/runtime/deliverable.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-delivery-'));
  dirs.push(root);
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');
  return root;
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('delivery observation', () => {
  it('covers project files and leaves host bookkeeping and knowledge entries out', () => {
    const cwd = project();
    mkdirSync(join(cwd, '.dev', 'work'), { recursive: true });
    writeFileSync(join(cwd, '.dev', 'work', 'plan.md'), '# plan\n', 'utf8');
    mkdirSync(join(cwd, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules', 'pkg', 'index.js'), 'x\n', 'utf8');
    writeFileSync(join(cwd, 'AGENTS.md'), '# rules\n', 'utf8');

    const snapshot = snapshotDelivery(cwd, [join(cwd, 'AGENTS.md')]);

    expect([...snapshot.paths].sort()).toEqual(['a.ts', 'src/b.ts']);
    expect(snapshot.digest).toBe(digestOfPaths(cwd, snapshot.paths));
  });

  it('leaves git-ignored untracked files out and keeps tracked files that match a pattern', () => {
    const cwd = project();
    git(cwd, ['init', '--quiet']);
    writeFileSync(join(cwd, '.gitignore'), 'dist/\n*.tsbuildinfo\nprivate.docx\n', 'utf8');
    mkdirSync(join(cwd, 'dist'));
    writeFileSync(join(cwd, 'dist', 'out.js'), 'built\n', 'utf8');
    writeFileSync(join(cwd, 'cache.tsbuildinfo'), 'cache\n', 'utf8');
    writeFileSync(join(cwd, 'private.docx'), 'mine\n', 'utf8');
    writeFileSync(join(cwd, '.git/info/exclude'), 'local.docx\n', 'utf8');
    writeFileSync(join(cwd, 'local.docx'), 'excluded by info/exclude\n', 'utf8');
    writeFileSync(join(cwd, 'dist', 'tracked.js'), 'tracked despite the rule\n', 'utf8');
    git(cwd, ['add', '-f', 'dist/tracked.js']);

    const snapshot = snapshotDelivery(cwd);

    expect(snapshot.paths).toContain('dist/tracked.js');
    expect(snapshot.paths).not.toContain('dist/out.js');
    expect(snapshot.paths).not.toContain('cache.tsbuildinfo');
    expect(snapshot.paths).not.toContain('private.docx');
    expect(snapshot.paths).not.toContain('local.docx');
    expect(snapshot.paths).toContain('a.ts');
    expect(snapshot.paths).toContain('src/b.ts');
    expect(snapshot.digest).toBe(digestOfPaths(cwd, snapshot.paths));
  });

  it('does not change the reviewed digest when an ignored artifact is removed', () => {
    const cwd = project();
    git(cwd, ['init', '--quiet']);
    writeFileSync(join(cwd, '.gitignore'), 'dist/\n', 'utf8');
    mkdirSync(join(cwd, 'dist'));
    writeFileSync(join(cwd, 'dist', 'out.js'), 'built\n', 'utf8');

    const snapshot = snapshotDelivery(cwd);
    expect(snapshot.paths).not.toContain('dist/out.js');
    rmSync(join(cwd, 'dist', 'out.js'));

    // The artifact was never delivery, so its later removal cannot invalidate the review.
    expect(digestOfPaths(cwd, snapshot.paths)).toBe(snapshot.digest);
  });

  it('excludes ignored paths beyond one check-ignore batch', () => {
    const cwd = project();
    git(cwd, ['init', '--quiet']);
    writeFileSync(join(cwd, '.gitignore'), 'dist/\n', 'utf8');
    mkdirSync(join(cwd, 'dist'));
    for (let index = 0; index < 205; index += 1) {
      writeFileSync(join(cwd, 'dist', `out-${String(index)}.js`), 'built\n', 'utf8');
    }

    const snapshot = snapshotDelivery(cwd);

    expect(snapshot.paths.some((path) => path.startsWith('dist/'))).toBe(false);
    expect(snapshot.digest).toBe(digestOfPaths(cwd, snapshot.paths));
  });

  it('fails closed when git cannot report ignored paths', () => {
    const cwd = project();
    // A marker makes this "a repository git cannot read", not the no-git case.
    mkdirSync(join(cwd, '.git'));

    expect(() => snapshotDelivery(cwd)).toThrow('ignored paths could not be determined');
  });

  it('applies ignore rules from a repository above the project', () => {
    const outer = mkdtempSync(join(tmpdir(), 'kaiming-monorepo-'));
    dirs.push(outer);
    const cwd = join(outer, 'apps', 'web');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    git(outer, ['init', '--quiet']);
    writeFileSync(join(outer, '.gitignore'), 'dist/\n', 'utf8');
    mkdirSync(join(cwd, 'dist'));
    writeFileSync(join(cwd, 'dist', 'out.js'), 'built\n', 'utf8');

    const snapshot = snapshotDelivery(cwd);

    expect(snapshot.paths).toContain('src/a.ts');
    expect(snapshot.paths).not.toContain('dist/out.js');
  });

  it('detects a changed or deleted reviewed file and ignores a new one', () => {
    const cwd = project();
    const snapshot = snapshotDelivery(cwd);

    writeFileSync(join(cwd, 'new.ts'), 'export const n = 1;\n', 'utf8');
    // A file added after the review is not part of what was reviewed.
    expect(digestOfPaths(cwd, snapshot.paths)).toBe(snapshot.digest);

    writeFileSync(join(cwd, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
    expect(digestOfPaths(cwd, snapshot.paths)).not.toBe(snapshot.digest);

    writeFileSync(join(cwd, 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');
    expect(digestOfPaths(cwd, snapshot.paths)).toBe(snapshot.digest);

    rmSync(join(cwd, 'a.ts'));
    // A reviewed file that is gone is a change, never "unchanged".
    expect(digestOfPaths(cwd, snapshot.paths)).not.toBe(snapshot.digest);
  });

  it('distinguishes a file that became unreadable from one that was deleted', () => {
    const cwd = project();
    const reviewed = ['a.ts', 'src/b.ts'];
    chmodSync(join(cwd, 'a.ts'), 0o000);
    const unreadable = digestOfPaths(cwd, reviewed);
    chmodSync(join(cwd, 'a.ts'), 0o644);
    rmSync(join(cwd, 'a.ts'));
    const missing = digestOfPaths(cwd, reviewed);

    // Both states differ from the original and from each other: "unreadable" is not "gone".
    expect(unreadable).not.toBe(digestOfPaths(cwd, reviewed));
    expect(unreadable).not.toBe(missing);
  });
});
