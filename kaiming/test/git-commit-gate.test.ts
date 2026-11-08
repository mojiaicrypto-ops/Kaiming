import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitGaps, observeCommit } from '../src/runtime/git-delivery.ts';
import { deliveryCommitGaps } from '../src/tools/completion-git.ts';
import { Store } from '../src/store/store.ts';
import { createTaskTool, type DomainTool, type TaskToolContext } from '../src/tools/task-tools.ts';
import { digestOfPaths } from '../src/runtime/deliverable.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function initRepo(): string {
  const root = tempDir('kaiming-git-');
  const repo = join(root, 'project');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--quiet']);
  return repo;
}

function write(repo: string, path: string, text: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function commitAll(repo: string): void {
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--quiet', '-m', 'delivery']);
}

describe('git observation', () => {
  it('reports no repository as the no-git case, with nothing to fix', () => {
    const plain = tempDir('kaiming-plain-');
    mkdirSync(join(plain, 'project'), { recursive: true });
    write(plain, 'project/a.ts', 'export const a = 1;\n');
    const observation = observeCommit(join(plain, 'project'), ['a.ts']);
    expect(observation.mode).toBe('no-git');
    expect(commitGaps(observation)).toEqual([]);
  });

  it('accepts a delivery whose files are committed', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    const observation = observeCommit(repo, ['src/a.ts']);
    expect(observation.mode).toBe('git');
    expect(observation.head).toMatch(/^[0-9a-f]{40}$/);
    expect(observation.dirty).toEqual([]);
    expect(commitGaps(observation)).toEqual([]);
  });

  it('names the uncommitted files and the command once the delivery changes', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    write(repo, 'src/a.ts', 'export const a = 2;\n');
    write(repo, 'src/b.ts', 'export const b = 1;\n');

    const gaps = commitGaps(observeCommit(repo, ['src/a.ts', 'src/b.ts']));

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('not committed');
    expect(gaps[0]).toContain('src/a.ts');
    expect(gaps[0]).toContain('src/b.ts');
    expect(gaps[0]).toContain('git add -- <paths>');
  });

  it('leaves unrelated changes outside the reviewed paths alone', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    write(repo, 'notes/local.md', 'mine\n');
    commitAll(repo);
    write(repo, 'notes/local.md', 'my own edit\n');
    write(repo, 'src/a.ts', 'export const a = 2;\n');
    commitAll(repo);

    expect(observeCommit(repo, ['src/a.ts']).dirty).toEqual([]);
  });

  it('reports a repository without commits as everything untracked', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');

    const observation = observeCommit(repo, ['src/a.ts']);

    expect(observation.mode).toBe('git');
    expect(observation.head).toBeNull();
    expect(observation.dirty).toEqual(['src/a.ts']);
  });

  it('checks a project that sits inside a larger repository', () => {
    const root = tempDir('kaiming-nested-');
    const outer = join(root, 'mono');
    const project = join(outer, 'apps', 'web');
    mkdirSync(project, { recursive: true });
    git(outer, ['init', '--quiet']);
    write(outer, 'apps/web/src/a.ts', 'export const a = 1;\n');
    commitAll(outer);
    write(outer, 'apps/web/src/a.ts', 'export const a = 2;\n');

    const observation = observeCommit(project, ['src/a.ts']);

    expect(observation.mode).toBe('git');
    expect(observation.dirty).toEqual(['src/a.ts']);
  });

  it('checks a reviewed file inside a nested repository against that repository', () => {
    // git stops at a nested repository: the outer project can never commit what is inside it, so the
    // inner repository is asked instead of reporting a permanent, unactionable gap.
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    const vendor = join(repo, 'vendor', 'lib');
    mkdirSync(vendor, { recursive: true });
    git(vendor, ['init', '--quiet']);
    writeFileSync(join(vendor, 'a.txt'), 'vendored\n');

    const unrecorded = observeCommit(repo, ['src/a.ts', 'vendor/lib/a.txt']);
    expect(unrecorded.nested.map((entry) => entry.root)).toEqual(['vendor/lib']);
    // Two separate facts: the project does not record the repository, and the inner file is new.
    const gaps = commitGaps(unrecorded);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain('not recorded as committed in this project');
    expect(gaps[1]).toContain('inside nested repository vendor/lib');

    // git only records a repository that has commits, so the inner one goes first.
    commitAll(vendor);
    const innerCommitted = commitGaps(observeCommit(repo, ['src/a.ts', 'vendor/lib/a.txt']));
    expect(innerCommitted).toHaveLength(1);
    expect(innerCommitted[0]).toContain('not recorded as committed in this project');

    git(repo, ['add', 'vendor/lib']);
    git(repo, ['commit', '--quiet', '-m', 'record the nested repository']);
    expect(commitGaps(observeCommit(repo, ['src/a.ts', 'vendor/lib/a.txt']))).toEqual([]);
  });

  it('reports a nested repository that this project ignores', () => {
    // Nothing in this project's history can ever carry a delivery inside an ignored directory.
    const repo = initRepo();
    write(repo, '.gitignore', 'vendor/\n');
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    const vendor = join(repo, 'vendor', 'lib');
    mkdirSync(vendor, { recursive: true });
    git(vendor, ['init', '--quiet']);
    writeFileSync(join(vendor, 'a.txt'), 'vendored\n');
    commitAll(vendor);

    const observation = observeCommit(repo, ['src/a.ts', 'vendor/lib/a.txt']);

    expect(observation.nested.map((entry) => entry.state)).toEqual(['ignored']);
    expect(commitGaps(observation).join(' ')).toContain('.gitignore');
  });

  it('follows nesting down from the outermost boundary', () => {
    // Two levels: the outer project must record vendor/a, which must record vendor/b.
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    const middle = join(repo, 'vendor', 'a');
    const inner = join(middle, 'vendor', 'b');
    mkdirSync(inner, { recursive: true });
    git(middle, ['init', '--quiet']);
    git(inner, ['init', '--quiet']);
    writeFileSync(join(inner, 'x.txt'), 'deep\n');
    commitAll(inner);
    const paths = ['src/a.ts', 'vendor/a/vendor/b/x.txt'];

    // Nothing recorded anywhere: both boundaries are facts (the project's, and the middle's).
    const top = observeCommit(repo, paths);
    expect(top.nested.map((entry) => entry.root)).toEqual(['vendor/a']);
    expect(top.nested[0]?.state).toBe('unrecorded');
    const topGaps = commitGaps(top);
    expect(topGaps).toHaveLength(2);
    expect(topGaps[0]).toContain('the nested repository vendor/a is not recorded');
    expect(topGaps[1]).toContain('the nested repository vendor/a/vendor/b is not recorded');

    // The middle repository records the inner one; the project still records nothing.
    git(middle, ['add', 'vendor/b']);
    git(middle, ['commit', '--quiet', '-m', 'record b']);
    const middleRecorded = commitGaps(observeCommit(repo, paths));
    expect(middleRecorded).toHaveLength(1);
    expect(middleRecorded[0]).toContain('the nested repository vendor/a is not recorded');

    // Now the project records the middle repository: everything is committed.
    git(repo, ['add', 'vendor/a']);
    git(repo, ['commit', '--quiet', '-m', 'record a']);
    expect(commitGaps(observeCommit(repo, paths))).toEqual([]);
  });

  it('accepts a delivery that includes a real submodule, once the content and the pointer are committed', () => {
    // The legitimate nested form: the inner repository holds the content, the outer one records it.
    const root = tempDir('kaiming-submodule-');
    const inner = join(root, 'inner');
    const outer = join(root, 'outer');
    mkdirSync(inner, { recursive: true });
    mkdirSync(outer, { recursive: true });
    git(inner, ['init', '--quiet']);
    writeFileSync(join(inner, 'a.txt'), 'vendored\n');
    commitAll(inner);
    git(outer, ['init', '--quiet']);
    writeFileSync(join(outer, 't.ts'), 'export const t = 1;\n');
    commitAll(outer);
    git(outer, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '../inner', 'vendor/lib']);
    git(outer, ['commit', '--quiet', '-m', 'add the submodule']);
    const paths = ['t.ts', 'vendor/lib/a.txt'];
    expect(commitGaps(observeCommit(outer, paths))).toEqual([]);

    writeFileSync(join(outer, 'vendor/lib', 'a.txt'), 'changed\n');
    // Dirty content is the nested repository's own fact: the pointer still names the same commit,
    // so the project's side is not reported as unrecorded.
    const innerDirty = commitGaps(observeCommit(outer, paths));
    expect(innerDirty).toHaveLength(1);
    expect(innerDirty[0]).toContain('inside nested repository vendor/lib');

    commitAll(join(outer, 'vendor/lib'));
    // The content is committed; the outer repository still points at the old commit.
    const pointerDirty = commitGaps(observeCommit(outer, paths));
    expect(pointerDirty).toHaveLength(1);
    expect(pointerDirty[0]).toContain('not recorded as committed in this project');

    git(outer, ['add', 'vendor/lib']);
    git(outer, ['commit', '--quiet', '-m', 'bump the submodule']);
    expect(commitGaps(observeCommit(outer, paths))).toEqual([]);
  });

  it('does not treat a stray file named .git as a nested repository', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    write(repo, 'docs/.git', 'not a pointer\n');
    write(repo, 'docs/note.md', 'text\n');
    commitAll(repo);
    writeFileSync(join(repo, 'docs', 'note.md'), 'changed\n');

    const observation = observeCommit(repo, ['docs/note.md']);

    expect(observation.nested).toEqual([]);
    expect(observation.dirty).toEqual(['docs/note.md']);
  });

  it('blocks when the repository above the project is unreadable', () => {
    // The tester's I2: a project that sits inside a larger repository whose .git is broken.
    const root = tempDir('kaiming-broken-parent-');
    const outer = join(root, 'mono');
    const project = join(outer, 'apps', 'web');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(outer, '.git'), { recursive: true });
    writeFileSync(join(outer, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const observation = observeCommit(project, ['src/a.ts']);

    expect(observation.mode).toBe('unverifiable');
    expect(commitGaps(observation).join(' ')).toContain('could not be checked');
  });

  it('does not offer to force-add an ignored path that no longer exists', () => {
    const repo = initRepo();
    write(repo, '.gitignore', 'build/\n');
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);

    const observation = observeCommit(repo, ['build/gone.js']);

    expect(observation.ignored).toEqual([]);
    expect(commitGaps(observation)).toEqual([]);
  });

  it('reports ignored and uncommitted paths as separate facts', () => {
    const repo = initRepo();
    write(repo, '.gitignore', 'build/\n');
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    write(repo, 'build/out.js', 'generated\n');
    write(repo, 'src/a.ts', 'export const a = 2;\n');

    const gaps = commitGaps(observeCommit(repo, ['build/out.js', 'src/a.ts']));

    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain('ignored');
    expect(gaps[1]).toContain('not committed');
  });

  it('reports a delivery that .gitignore excludes, which status can never show', () => {
    const repo = initRepo();
    write(repo, '.gitignore', 'build/\n');
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    write(repo, 'build/out.js', 'generated\n');

    const observation = observeCommit(repo, ['build/out.js']);

    expect(observation.mode).toBe('git');
    expect(observation.dirty).toEqual([]);
    expect(observation.ignored).toEqual(['build/out.js']);
    expect(commitGaps(observation).join(' ')).toContain('ignored');
  });

  it('does not pass a .git that git cannot read as a no-git project', () => {
    const project = tempDir('kaiming-broken-');
    mkdirSync(join(project, '.git'), { recursive: true });
    writeFileSync(join(project, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const observation = observeCommit(project, ['a.ts']);

    expect(observation.mode).toBe('unverifiable');
    expect(commitGaps(observation).join(' ')).toContain('could not be checked');
  });

  it('checks a delivery larger than one git status batch', () => {
    const repo = initRepo();
    const paths = Array.from({ length: 205 }, (_, index) => `src/f${String(index).padStart(3, '0')}.ts`);
    for (const path of paths) write(repo, path, 'export const value = 1;\n');
    commitAll(repo);
    // One change in the first batch and one past its boundary: both must be found.
    write(repo, paths[1]!, 'export const value = 2;\n');
    write(repo, paths[204]!, 'export const value = 3;\n');

    const observation = observeCommit(repo, paths);

    expect(observation.dirty).toEqual([paths[1], paths[204]]);
  });

  it('reports a staged change as well as a working-tree one', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    write(repo, 'src/a.ts', 'export const a = 2;\n');
    git(repo, ['add', 'src/a.ts']);

    expect(observeCommit(repo, ['src/a.ts']).dirty).toEqual(['src/a.ts']);
  });
});

/** A reviewer member with a claimed input: a report may only be recorded by a Task member. */
function addReviewer(store: Store, taskId: string): { sessionId: string; inputId: string } {
  // A member may only join in the Task's current phase.
  store.updateTask({ taskId, phase: 'review' });
  store.createTaskSessions({
    taskId,
    members: [
      {
        sessionId: 'm-review',
        taskId,
        roleId: 'reviewer',
        phase: 'review',
        label: 'review',
        instructions: 'check the delivery',
        refs: [],
        dependencies: [],
        expectedKind: 'review',
        inputId: 'i-m-review',
        inputPayload: { content: [{ type: 'text', text: 'review it' }] },
      },
    ],
  });
  const claimed = store.claimNextInput('m-review');
  if (claimed.kind !== 'claimed') throw new Error('the reviewer input could not be claimed');
  return { sessionId: 'm-review', inputId: 'i-m-review' };
}

function passReview(
  store: Store,
  taskId: string,
  repo: string,
  paths: readonly string[],
  resultId: string,
): void {
  const member = addReviewer(store, taskId);
  store.recordResult({
    resultId,
    taskId,
    sessionId: member.sessionId,
    inputId: member.inputId,
    roleId: 'reviewer',
    kind: 'review',
    summary: 'looks right',
    verdict: 'passed',
    deliveryState: { paths, digest: digestOfPaths(repo, paths) },
    bodyRef: { storage: 'server', path: `/tmp/${resultId}.md`, sha256: 'x' },
    basisRefs: [],
    checks: [],
  });
}

/** A store with one write Task and a passed review over the given paths. */
function taskWithReview(paths: readonly string[], existingRepo?: string): { store: Store; taskId: string; repo: string } {
  const repo = existingRepo ?? initRepo();
  const store = new Store({ path: join(repo, '..', 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: repo });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd: repo });
  store.acceptInput({
    inputId: 'i-1',
    projectId: 'p-1',
    sessionId: 'c-1',
    sourceKey: 'c-1:i-1',
    requestKey: 'i-1',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'go' }] },
  });
  const task = store.createTask({
    id: 't-1',
    projectId: 'p-1',
    chiefSessionId: 'c-1',
    ownerEpoch: 1,
    type: 'write',
    requiresTest: false,
    goal: 'goal',
    scope: 'scope',
    acceptanceRefs: [],
    basisRefs: [],
    planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
    authorizationRefs: [],
    sourceInputId: 'i-1',
  });
  passReview(store, task.id, repo, paths, 'r-review');
  return { store, taskId: task.id, repo };
}

describe('the completion gate', () => {
  it('says nothing when the delivery is committed', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    const { store, taskId } = taskWithReview(['src/a.ts'], repo);
    expect(deliveryCommitGaps(store, store.getTask(taskId)!)).toEqual([]);
  });

  it('reports the uncommitted delivery of a passed review', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    const { store, taskId } = taskWithReview(['src/a.ts'], repo);
    write(repo, 'src/a.ts', 'export const a = 2;\n');
    const gaps = deliveryCommitGaps(store, store.getTask(taskId)!);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('src/a.ts');
  });

  it('does not count ignored files from an older review as delivery', () => {
    const repo = initRepo();
    write(repo, '.gitignore', 'dist/\n');
    write(repo, 'dist/out.js', 'built\n');
    write(repo, '.git/info/exclude', 'local.docx\n');
    write(repo, 'local.docx', 'mine\n');
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    const { store, taskId } = taskWithReview(['dist/out.js', 'local.docx', 'src/a.ts'], repo);

    const gaps = deliveryCommitGaps(store, store.getTask(taskId)!);
    const text = gaps.join(' ');
    expect(gaps).toHaveLength(1);
    expect(text).toContain('src/a.ts');
    expect(text).not.toContain('dist/out.js');
    expect(text).not.toContain('local.docx');
    expect(text).not.toContain('ignored');

    commitAll(repo);
    expect(deliveryCommitGaps(store, store.getTask(taskId)!)).toEqual([]);
  });

  it('says nothing for a read Task', () => {
    const repo = initRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    commitAll(repo);
    const { store, taskId } = taskWithReview(['src/a.ts'], repo);
    write(repo, 'src/a.ts', 'export const a = 2;\n');
    expect(deliveryCommitGaps(store, { ...store.getTask(taskId)!, type: 'read' })).toEqual([]);
  });

  it('says nothing when the review bound no delivery paths', () => {
    const repo = initRepo();
    const { store, taskId } = taskWithReview([], repo);
    expect(deliveryCommitGaps(store, store.getTask(taskId)!)).toEqual([]);
  });
});

describe('task end refuses an uncommitted delivery', () => {
  function world(): { store: Store; repo: string; tool: DomainTool; taskId: string } {
    const repo = initRepo();
    const store = new Store({ path: join(repo, '..', 'state.db'), serverEpoch: 1 });
    stores.push(store);
    store.createProject({ id: 'p-1', realPath: repo });
    store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd: repo });
    store.acceptInput({
      inputId: 'i-dec',
      projectId: 'p-1',
      sessionId: 'c-1',
      sourceKey: 'c-1:i-dec',
      requestKey: 'i-dec',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'go ahead' }] },
    });
    const tool = createTaskTool(
      (): TaskToolContext => ({
        store,
        sessionId: 'c-1',
        projectId: 'p-1',
        cwd: repo,
        roleId: 'chief',
        inputId: 'i-dec',
        serverWorkDir: join(repo, '..', 'work'),
      }),
      { chief: true },
    );
    return { store, repo, tool, taskId: '' };
  }

  it('lists the uncommitted files in the refusal and drops the gap once committed', async () => {
    const w = world();
    const created = await w.tool.execute('call-1', {
      op: 'create',
      type: 'write',
      goal: 'reset password',
      scope: 'account module',
      planMarkdown: '# plan\n\n## 验收\n- observable result\n',
      authorizationRef: { inputId: 'i-dec' },
      requiresTest: false,
    });
    const taskId = String(created.details['taskId']);
    expect(taskId).not.toBe('');
    write(w.repo, 'src/a.ts', 'export const a = 1;\n');
    passReview(w.store, taskId, w.repo, ['src/a.ts'], 'r-review');

    const refused = await w.tool.execute('call-2', { op: 'end', taskId, completionResultId: 'r-settle' });
    expect(refused.details['code']).toBe('COMPLETION_INCOMPLETE');
    const gaps = refused.details['gaps'] as string[];
    expect(gaps.join(' ')).toContain('not committed');
    expect(gaps.join(' ')).toContain('src/a.ts');
    expect(w.store.getTask(taskId)?.status).not.toBe('completed');

    // Guidance carries the same fact, so the chief sees it before trying to end.
    const got = await w.tool.execute('call-g', { op: 'get', taskId });
    expect((got.details['gaps'] as string[]).join(' ')).toContain('not committed');

    commitAll(w.repo);
    const after = await w.tool.execute('call-3', { op: 'end', taskId, completionResultId: 'r-settle' });
    const afterGaps = (after.details['gaps'] as string[]).join(' ');
    expect(afterGaps).not.toContain('not committed');
    expect(afterGaps).toContain('completion result');
  });
});
