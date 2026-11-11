/**
 * The deletion gate's rule table: what asks, what stays quiet, and what never slips through a
 * compound command. Pure text rules, so every case here is a direct call of `deletionCommandReason`.
 */
import { describe, expect, it } from 'vitest';
import { deletionCommandReason } from '../src/runtime/deletion-gate.ts';

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
});
