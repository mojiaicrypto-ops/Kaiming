/**
 * The chief shell audit (A): the fingerprint must see a tracked edit, a second edit to an
 * already-dirty file, an untracked add/change and a commit; it must stay quiet for a clean tree,
 * an ignored file and a project without git. The extension half proves the warning travels with
 * the tool result and marks it as an error without blocking anything.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  compareWorktreeFingerprints,
  createShellAudit,
  readWorktreeFingerprint,
  type WorktreeFingerprint,
} from '../src/runtime/shell-audit.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-C', cwd, '-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], {
    stdio: 'ignore',
  });
}

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'kaiming-shell-audit-'));
  dirs.push(cwd);
  git(cwd, 'init', '-q');
  writeFileSync(join(cwd, 'app.ts'), 'export const value = 1;\n');
  git(cwd, 'add', 'app.ts');
  git(cwd, 'commit', '-qm', 'init');
  return cwd;
}

async function snapshot(cwd: string) {
  const found = await readWorktreeFingerprint(cwd);
  if (found === null) throw new Error('the test repository has no fingerprint');
  return found;
}

describe('worktree fingerprint', () => {
  it('reports a tracked edit and the path it touched', async () => {
    const cwd = repo();
    const before = await snapshot(cwd);
    writeFileSync(join(cwd, 'app.ts'), 'export const value = 2;\n');
    const after = await snapshot(cwd);
    const finding = compareWorktreeFingerprints(before, after);
    expect(finding.changed).toBe(true);
    expect(finding.statusChanged).toBe(true);
    expect(finding.diffChanged).toBe(true);
    expect(finding.paths).toContain('app.ts');
  });

  it('reports a second edit to a file that was already dirty', async () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'app.ts'), 'export const value = 2;\n');
    const before = await snapshot(cwd);
    writeFileSync(join(cwd, 'app.ts'), 'export const value = 3;\n');
    const after = await snapshot(cwd);
    const finding = compareWorktreeFingerprints(before, after);
    // The porcelain code stays ` M`; only the dirty-content digest can see this edit.
    expect(finding.statusChanged).toBe(false);
    expect(finding.diffChanged).toBe(true);
    expect(finding.changed).toBe(true);
  });

  it('reports a new untracked file and a later change to it', async () => {
    const cwd = repo();
    const before = await snapshot(cwd);
    writeFileSync(join(cwd, 'notes.txt'), 'one\n');
    const afterAdd = await snapshot(cwd);
    const add = compareWorktreeFingerprints(before, afterAdd);
    expect(add.untrackedChanged).toBe(true);
    expect(add.paths).toContain('notes.txt');

    writeFileSync(join(cwd, 'notes.txt'), 'two\n');
    const afterEdit = await snapshot(cwd);
    const edit = compareWorktreeFingerprints(afterAdd, afterEdit);
    expect(edit.statusChanged).toBe(false);
    expect(edit.untrackedChanged).toBe(true);
    expect(edit.changed).toBe(true);
  });

  it('reports a commit as a HEAD change', async () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'app.ts'), 'export const value = 2;\n');
    const before = await snapshot(cwd);
    git(cwd, 'commit', '-qam', 'change');
    const after = await snapshot(cwd);
    const finding = compareWorktreeFingerprints(before, after);
    expect(finding.headChanged).toBe(true);
    expect(finding.headBefore).not.toBe(finding.headAfter);
    expect(finding.changed).toBe(true);
  });

  it('stays quiet for a clean tree and an ignored file', async () => {
    const cwd = repo();
    writeFileSync(join(cwd, '.gitignore'), 'ignored.txt\n');
    git(cwd, 'add', '.gitignore');
    git(cwd, 'commit', '-qm', 'ignore');
    const before = await snapshot(cwd);
    writeFileSync(join(cwd, 'ignored.txt'), 'local only\n');
    const after = await snapshot(cwd);
    expect(compareWorktreeFingerprints(before, after).changed).toBe(false);
  });

  it('observes a project that is a subdirectory of its repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaiming-shell-audit-sub-'));
    dirs.push(root);
    git(root, 'init', '-q');
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'app.ts'), 'export const value = 1;\n');
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'init');
    const cwd = join(root, 'sub');
    const before = await snapshot(cwd);
    writeFileSync(join(cwd, 'app.ts'), 'export const value = 2;\n');
    const after = await snapshot(cwd);
    const finding = compareWorktreeFingerprints(before, after);
    expect(finding.changed).toBe(true);
    expect(finding.paths).toContain('app.ts');
  });

  it('skips a directory that git cannot describe', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kaiming-shell-audit-nogit-'));
    dirs.push(cwd);
    expect(await readWorktreeFingerprint(cwd)).toBeNull();
  });

  // Root bypasses file permissions, so the chmod cannot make the index unreadable there.
  it.skipIf(process.getuid?.() === 0)(
    'reports an unreadable status instead of silently skipping the audit',
    async () => {
      const cwd = repo();
      const index = join(cwd, '.git', 'index');
      chmodSync(index, 0o000);
      try {
        const before = await readWorktreeFingerprint(cwd);
        const after = await readWorktreeFingerprint(cwd);
        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        expect(before?.statusAvailable).toBe(false);
        expect(before?.limited).toBe(true);
        const finding = compareWorktreeFingerprints(before!, after!);
        expect(finding.changed).toBe(false);
        expect(finding.statusUnavailable).toBe(true);

        const handlers = install(cwd);
        await handlers.tool_call?.(bashCall('blind'));
        const result = (await handlers.tool_result?.(bashResult('blind'))) as {
          content: Array<{ type: string; text: string }>;
          isError?: boolean;
        };
        expect(result.isError).not.toBe(true);
        expect(result.content[1]?.text).toContain('status could not be read');
      } finally {
        chmodSync(index, 0o644);
      }
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    'does not fabricate a change when status fails on one side',
    async () => {
      for (const dirtyTracked of [false, true]) {
        const cwd = repo();
        writeFileSync(join(cwd, 'untracked.txt'), 'new\n');
        if (dirtyTracked) writeFileSync(join(cwd, 'app.ts'), 'export const value = 2;\n');
        const before = await readWorktreeFingerprint(cwd);
        const index = join(cwd, '.git', 'index');
        chmodSync(index, 0o000);
        try {
          const after = await readWorktreeFingerprint(cwd);
          expect(before).not.toBeNull();
          expect(after).not.toBeNull();
          const finding = compareWorktreeFingerprints(before!, after!);
          expect(finding.statusUnavailable).toBe(true);
          expect(finding.changed).toBe(false);
          expect(finding.diffChanged).toBe(false);
          expect(finding.untrackedChanged).toBe(false);
        } finally {
          chmodSync(index, 0o644);
        }
      }
    },
  );

  it('does not compare HEAD when one side could not read it', () => {
    const base: WorktreeFingerprint = {
      head: null,
      headAvailable: true,
      statusAvailable: true,
      statusHash: 'status',
      statusPaths: [],
      diffHash: null,
      untrackedHash: 'untracked',
      limited: false,
    };
    const finding = compareWorktreeFingerprints(
      { ...base, head: 'abc', headAvailable: false },
      base,
    );
    expect(finding.headChanged).toBe(false);
    expect(finding.changed).toBe(false);
  });
});

type Handler = (event: unknown, ctx?: unknown) => unknown;

function install(cwd: string): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  const api = {
    on(event: string, handler: Handler) {
      handlers[event] = handler;
      return () => undefined;
    },
  } as unknown as ExtensionAPI;
  createShellAudit({ cwd })(api);
  return handlers;
}

function bashCall(toolCallId: string): unknown {
  return { type: 'tool_call', toolCallId, toolName: 'bash', input: { command: 'echo hi' } };
}

function bashResult(toolCallId: string): unknown {
  return {
    type: 'tool_result',
    toolCallId,
    toolName: 'bash',
    input: {},
    content: [{ type: 'text', text: 'hi' }],
    isError: false,
  };
}

describe('shell audit extension', () => {
  it('appends the finding to the result and marks it as an error', async () => {
    const cwd = repo();
    const handlers = install(cwd);
    await handlers.tool_call?.(bashCall('c1'));
    writeFileSync(join(cwd, 'app.ts'), 'export const value = 2;\n');
    const result = (await handlers.tool_result?.(bashResult('c1'))) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(result.content[1]?.text).toContain('app.ts');
    expect(result.content[1]?.text).toContain('audit, not a rollback');
  });

  it('leaves a clean call untouched and skips a non-git directory', async () => {
    const cwd = repo();
    const handlers = install(cwd);
    await handlers.tool_call?.(bashCall('clean'));
    expect(await handlers.tool_result?.(bashResult('clean'))).toBeUndefined();

    const noGit = mkdtempSync(join(tmpdir(), 'kaiming-shell-audit-nogit-'));
    dirs.push(noGit);
    const noGitHandlers = install(noGit);
    await noGitHandlers.tool_call?.(bashCall('nogit'));
    expect(await noGitHandlers.tool_result?.(bashResult('nogit'))).toBeUndefined();
  });
});
