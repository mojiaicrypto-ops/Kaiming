/**
 * The deletion gate's rule table: what asks, what stays quiet, and what never slips through a
 * compound command. Pure text rules, so every case here is a direct call of `deletionCommandReason`.
 */
import { describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createDeletionGate, deletionCommandFinding, deletionCommandReason, historyCommandReason } from '../src/runtime/deletion-gate.ts';

describe('deletion command detection', () => {
  it('asks before the direct deletion commands, in every common shape', () => {
    const commands = [
      'rm notes.md',
      'rm -rf build',
      'rm -r --recursive dist',
      'rmdir empty-dir',
      'shred secret.key',
      'unlink broken-link',
    ];
    for (const command of commands) {
      expect(deletionCommandReason(command), command).toBeDefined();
    }
  });

  it('asks before git commands that really delete, and leaves the rest alone', () => {
    const destructive = [
      'git clean -f',
      'git clean -fdx',
      'git clean --force',
      'git -C repo clean -f',
      'git stash drop stash@{0}',
      'git stash clear',
      'git branch -D experiment',
    ];
    for (const command of destructive) {
      expect(deletionCommandReason(command), command).toBeDefined();
    }
    const safe = [
      'git clean -n',
      'git reset --soft HEAD~1',
      'git reset --hard HEAD~1',
      'git restore src/app.ts',
      'git checkout -- .',
      'git checkout -- src/app.ts',
      'git push --force origin main',
      'git push -f origin main',
      'git push --force-with-lease origin main',
      'git status',
      'git checkout main',
      'git checkout -b feature',
      'git stash',
      'git stash pop',
      'git branch -d merged',
      'git push origin main',
      'git diff --cached',
    ];
    for (const command of safe) {
      expect(deletionCommandReason(command), command).toBeUndefined();
    }
  });

  it('ignores deletion words inside quoted arguments and sed/grep patterns', () => {
    const ordinary = [
      `grep -n 'kept\\|rm -rf' notes.txt`,
      `sed -i.bak 's#^rm -rf "$TMP"$#echo kept#' script.sh`,
      `echo 'unlink'`,
      `echo '$(rm -rf build)'`,
      `grep 'find . -delete' notes.txt`,
      `grep 'git clean -f' notes.txt`,
    ];
    for (const command of ordinary) {
      expect(deletionCommandReason(command), command).toBeUndefined();
    }
  });

  it('catches deletion hidden after a separator, in every segment shape', () => {
    const hidden = [
      'echo hi && rm -rf build',
      'echo hi; rm notes.md',
      'git status || rm -rf .',
      'ls | xargs rm',
      'echo start\ngit clean -f',
    ];
    for (const command of hidden) {
      expect(deletionCommandReason(command), command).toBeDefined();
    }
  });

  it('catches scripted deletion through an interpreter', () => {
    const scripted = [
      'python -c "import os; os.remove(\'a.txt\')"',
      'python3 -c "import shutil; shutil.rmtree(\'build\')"',
      'node -e "fs.rmSync(\'dist\', {recursive: true})"',
      'node -e "require(\'fs\').unlinkSync(\'a.txt\')"',
    ];
    for (const command of scripted) {
      expect(deletionCommandReason(command), command).toBeDefined();
    }
  });

  it('leaves ordinary commands alone, including quoted deletion words', () => {
    const ordinary = [
      'ls -la',
      'npm test',
      'git add -A && git commit -m "rm unused import"',
      'grep -rn "remove" src',
      'mkdir -p build',
      'mv draft.md final.md',
      'cp a.txt b.txt',
      'cat notes.md',
      'echo "rm -rf build"',
      'git checkout -- apps/web/next-env.d.ts',
    ];
    for (const command of ordinary) {
      expect(deletionCommandReason(command), command).toBeUndefined();
    }
  });

  it('still asks when the deletion word is a command substitution that really runs', () => {
    // Text detection is not a parser, but command substitutions do execute: `$(rm …)` must ask.
    expect(deletionCommandReason('echo "$(rm -rf build)"')).toBeDefined();
    expect(deletionCommandReason('echo `rm notes.md`')).toBeDefined();
  });

  it('treats only writer heredoc bodies as data', () => {
    // Writing a test script is not running it; the body is data for cat/tee/commit.
    const cases = [
      `cat > tests/probe.mjs <<'EOF'\nimport { rmSync } from 'node:fs'\nrmSync('/tmp/not-run', { recursive: true })\nEOF`,
      `cat <<'EOF' > /tmp/probe.mjs\nrm -rf /tmp/not-run\nEOF`,
      `tee /tmp/probe.mjs <<'EOF'\nrm -rf /tmp/not-run\nEOF`,
      `git commit -F - <<'EOF'\nrm -rf /tmp/not-run\nEOF`,
      `cat > /tmp/probe.mjs <<-EOF\n\trm -rf /tmp/not-run\n\tEOF`,
    ];
    for (const command of cases) {
      expect(deletionCommandReason(command), command).toBeUndefined();
    }
  });

  it('keeps heredoc bodies that an interpreter executes visible to the rules', () => {
    for (const command of [
      `python3 - <<'PY'\nimport os\nos.remove('/tmp/really-delete')\nPY`,
      `node - <<'JS'\nrequire('node:fs').rmSync('/tmp/really-delete')\nJS`,
      `tee /tmp/probe.mjs <<'EOF' | bash\nrm -rf /tmp/really-delete\nEOF`,
      `cat <<'EOF' > /tmp/probe.mjs | bash\nrm -rf /tmp/really-delete\nEOF`,
    ]) {
      expect(deletionCommandReason(command), command).toBeDefined();
    }
    expect(deletionCommandFinding(`bash <<'EOF'\ngit clean -f\nEOF`)?.highRisk).toBe(true);
  });

  it('still detects a real deletion after the heredoc closes', () => {
    const command = `cat > /tmp/probe.mjs <<'EOF'\nconst x = 1\nEOF\nrm -rf /tmp/really-delete`;
    expect(deletionCommandReason(command)).toBeDefined();
  });
});

describe('chief history/worktree gate', () => {
  it('leaves the default table unchanged for commit, history and worktree-discard commands', () => {
    for (const command of [
      'git commit -m done',
      'git -C repo commit --amend',
      'git merge feature',
      'git rebase main',
      'git cherry-pick abc123',
      'git push --force origin main',
      'git reset --hard HEAD~1',
      'git checkout -- src/app.ts',
      'git restore src/app.ts',
    ]) {
      expect(deletionCommandReason(command), command).toBeUndefined();
    }
  });

  it('asks before the chief would commit, rewrite or discard the project', () => {
    for (const command of [
      'git commit -m done',
      'sudo git commit --amend',
      'git -C repo commit',
      'git -c user.name=Test commit -m done',
      'git merge feature',
      'git rebase main',
      'git cherry-pick abc123',
      'git push --force origin main',
      'git -c core.pager=cat push --force origin main',
      'git push -f origin main',
      'git push --force-with-lease origin main',
      'git reset --hard HEAD~1',
      'git checkout -- .',
      'git checkout -- src/app.ts',
      'git checkout .',
      'sudo git checkout .',
      'git restore src/app.ts',
      'echo $(git reset --hard)',
      'echo `git reset --hard`',
      'echo $(git push -f)',
      'echo $(git checkout .)',
      'echo `git checkout .`',
    ]) {
      expect(deletionCommandReason(command, { guardHistory: true }), command).toBeDefined();
    }
  });

  it('keeps read-only and normal git commands quiet under the chief gate', () => {
    for (const command of [
      'git status',
      'git log --oneline -5',
      'git diff --stat',
      'git show HEAD',
      'git fetch origin',
      'git push origin main',
      'git reset --soft HEAD~1',
      'git checkout main',
      'git checkout -b feature',
      'git merge-base HEAD main',
      'git commit-tree abc123',
    ]) {
      expect(deletionCommandReason(command, { guardHistory: true }), command).toBeUndefined();
    }
  });

  it('does not treat a quoted or remote git word as a local command', () => {
    // This is a text gate, not a shell parser: the audit covers a local HEAD/status change; an ssh
    // command is remote work and deliberately outside the local project fingerprint.
    expect(deletionCommandReason(`echo 'git commit -m done'`, { guardHistory: true })).toBeUndefined();
    expect(deletionCommandReason(`ssh host 'git commit -m done'`, { guardHistory: true })).toBeUndefined();
  });
});

describe('read-only chief history refusal', () => {
  it('identifies the commands the read-only sandbox refuses without a prompt', () => {
    for (const command of [
      'git commit -m done',
      'git merge feature',
      'git reset --hard HEAD~1',
      'git checkout .',
      'echo $(git push -f)',
    ]) {
      expect(historyCommandReason(command), command).toBeDefined();
    }
    for (const command of ['git status', 'git diff --stat', 'ls -la']) {
      expect(historyCommandReason(command), command).toBeUndefined();
    }
  });
});

describe('read-only gate preference', () => {
  it('refuses history commands without asking when the sandbox is active', async () => {
    let handler:
      | ((event: { toolName: string; input: unknown }, ctx: { hasUI: boolean }) => Promise<unknown>)
      | undefined;
    const pi = {
      on: (name: string, callback: typeof handler) => {
        if (name === 'tool_call') handler = callback;
      },
    } as unknown as ExtensionAPI;
    createDeletionGate({ guardHistory: true, readOnlySandbox: true })(pi);
    expect(handler).toBeDefined();
    const refusal = await handler!(
      { toolName: 'bash', input: { command: 'git commit -m done' } },
      { hasUI: false },
    );
    expect(refusal).toMatchObject({ block: true });
    expect(JSON.stringify(refusal)).toContain('settler');
    expect(
      await handler!({ toolName: 'bash', input: { command: 'git status' } }, { hasUI: false }),
    ).toBeUndefined();
  });
});

describe('workspace sandbox deletion gate', () => {
  function gateHandler(options: Parameters<typeof createDeletionGate>[0]) {
    let handler:
      | ((event: { toolName: string; input: unknown }, ctx: { hasUI: boolean }) => Promise<unknown>)
      | undefined;
    const pi = {
      on: (name: string, callback: typeof handler) => {
        if (name === 'tool_call') handler = callback;
      },
    } as unknown as ExtensionAPI;
    createDeletionGate(options)(pi);
    expect(handler).toBeDefined();
    return (command: string) =>
      handler!({ toolName: 'bash', input: { command } }, { hasUI: false });
  }

  it('skips an ordinary file deletion only when the workspace sandbox is active', async () => {
    const active = gateHandler({ sandboxActive: true });
    await expect(active('rm -rf /tmp/workspace-file')).resolves.toBeUndefined();
    await expect(active('find build -delete')).resolves.toBeUndefined();

    const inactive = gateHandler({ sandboxActive: false });
    const refusal = await inactive('rm -rf /tmp/workspace-file');
    expect(refusal).toMatchObject({ block: true });
    expect(JSON.stringify(refusal)).toContain('deletes files or directories');
  });

  it('keeps high-risk Git cleanup behind the gate even when the workspace sandbox is active', async () => {
    const active = gateHandler({ sandboxActive: true });
    for (const command of ['git clean -f', 'git stash clear', 'git branch -D old']) {
      const refusal = await active(command);
      expect(refusal, command).toMatchObject({ block: true });
    }
    expect(deletionCommandFinding('git clean -f')?.highRisk).toBe(true);
    expect(deletionCommandFinding('rm -rf build')?.highRisk).toBe(false);
  });

  it('keeps high-risk Git cleanup behind the gate inside an executed heredoc', async () => {
    const active = gateHandler({ sandboxActive: true });
    const command = `bash <<'EOF'\ngit clean -f\nEOF`;
    const refusal = await active(command);
    expect(refusal).toMatchObject({ block: true });
    expect(JSON.stringify(refusal)).toContain('git clean -f deletes untracked files');
  });
});
