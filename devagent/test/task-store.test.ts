import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, StoreError, type ArtifactRef } from '../src/store/store.ts';
import { commitPlan, digestOfText, planRefFor, planTarget, readPlan } from '../src/runtime/plan-store.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setup(): { store: Store; root: string; cwd: string; serverWorkDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'devagent-task-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
  return { store, root, cwd, serverWorkDir: join(root, 'work') };
}

const plan: ArtifactRef = { storage: 'server', path: '/tmp/x/plan.md', sha256: 'sha' };

function create(store: Store, overrides: Record<string, unknown> = {}): void {
  store.createTask({
    id: 't-1',
    projectId: 'p-1',
    chiefSessionId: 'c-1',
    ownerEpoch: 1,
    type: 'write',
    requiresTest: true,
    goal: 'reset password',
    scope: 'account module',
    acceptanceRefs: ['AC-1'],
    basisRefs: ['req-1'],
    planRef: plan,
    authorizationRefs: ['m-001'],
    sourceInputId: 'i-1',
    ...overrides,
  });
}

describe('task store', () => {
  it('creates a Task, takes the chief slot and keeps the plan reference', () => {
    const { store } = setup();

    create(store);

    const task = store.getTask('t-1');
    expect(task).toMatchObject({
      type: 'write',
      requiresTest: true,
      phase: 'plan',
      status: 'active',
      revision: 1,
      currentSessionIds: [],
      planRef: plan,
      acceptanceRefs: ['AC-1'],
      sourceInputId: 'i-1',
    });
    expect(store.getSession('c-1')?.currentTaskId).toBe('t-1');
  });

  it('refuses a second open Task for the same chief and a read Task that wants tests', () => {
    const { store } = setup();
    create(store);

    expect(() => create(store, { id: 't-2', requirementId: undefined })).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_BUSY' }),
    );
    expect(() => create(store, { id: 't-3', type: 'read', requiresTest: true, requirementId: undefined })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() =>
      create(store, { id: 't-4', chiefSessionId: 'missing', requirementId: undefined }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('refuses a second open implementation Task for the same requirement', () => {
    const { store } = setup();
    store.createSession({ id: 'c-2', projectId: 'p-1', roleId: 'chief', cwd: '/tmp' });
    create(store, { requirementId: 'req-1' });

    expect(() => create(store, { id: 't-2', chiefSessionId: 'c-2', requirementId: 'req-1' })).toThrowError(
      expect.objectContaining({ code: 'TASK_BUSY' }),
    );
  });

  it('applies version-checked updates and clears the current step when a phase starts', () => {
    const { store } = setup();
    create(store);

    expect(() => store.updateTask({ taskId: 't-1', expectedRevision: 2, summary: 'stale' })).toThrowError(
      expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    );
    const updated = store.updateTask({
      taskId: 't-1',
      expectedRevision: 1,
      phase: 'develop',
      summary: 'plan fixed',
      goal: 'reset password (revised)',
    });

    expect(updated).toMatchObject({ phase: 'develop', revision: 2, goal: 'reset password (revised)' });
    expect(updated.currentSessionIds).toEqual([]);
  });

  it('never lets a read Task declare requiresTest, even through an update', () => {
    const { store } = setup();
    create(store, { type: 'read', requiresTest: false });

    expect(() =>
      store.updateTask({ taskId: 't-1', expectedRevision: 1, requiresTest: true }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(store.getTask('t-1')?.requiresTest).toBe(false);
  });

  it('reports exactly what still blocks completion instead of finishing', () => {
    const { store } = setup();
    create(store);

    const result = store.endTask({ taskId: 't-1', expectedRevision: 1, completionResultId: 'r-1' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('unreachable');
    }
    expect(result.gaps.join(' ')).toContain('not recorded');
    // A Test requirement is checked against a really frozen candidate version.
    expect(result.gaps.join(' ')).toContain('no candidate version was frozen');

    // With a frozen candidate the gap names the version the Test must have covered.
    store.setCandidate({
      taskId: 't-1',
      expectedRevision: store.getTask('t-1')?.revision ?? 1,
      candidate: { candidateId: 'k-1', files: [] },
    });
    const second = store.endTask({
      taskId: 't-1',
      expectedRevision: store.getTask('t-1')?.revision ?? 1,
      completionResultId: 'r-1',
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error('unreachable');
    }
    // The implementation flow needs an independent Review first, then the same-candidate Test.
    expect(second.gaps.join(' ')).toContain('no passed independent review is recorded for candidate k-1');
    expect(store.getTask('t-1')?.status).toBe('active');
    expect(store.getSession('c-1')?.currentTaskId).toBe('t-1');
  });

  it('refuses an unknown Task and a non-chief owner', () => {
    const { store } = setup();
    store.createSession({ id: 's-dev', projectId: 'p-1', roleId: 'developer', cwd: '/tmp' });

    expect(() =>
      create(store, { id: 't-9', chiefSessionId: 's-dev', requirementId: undefined }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => store.updateTask({ taskId: 'nope', expectedRevision: 1 })).toThrowError(StoreError);
  });
});

describe('plan persistence', () => {
  it('writes the plan atomically, verifies it on disk and reuses an identical version', () => {
    const { store, cwd, serverWorkDir } = setup();
    const target = planTarget({ taskId: 't-1', type: 'write', projectCwd: cwd, serverWorkDir });

    const first = commitPlan({ store, requestKey: 'k-1', target, markdown: '# Plan v1\n' });
    const second = commitPlan({ store, requestKey: 'k-1', target, markdown: '# Plan v1\n' });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.ref.sha256).toBe(first.ref.sha256);
    expect(target.path).toBe(join(cwd, '.dev', 'work', 't-1', 'plan.md'));
    expect(readFileSync(target.path, 'utf8')).toBe('# Plan v1\n');
    expect(readPlan(first.ref)).toEqual({ text: '# Plan v1\n', current: true });
    expect(store.getFileSave('k-1')).toMatchObject({
      state: 'saved',
      contentHash: digestOfText('# Plan v1\n'),
      content: '# Plan v1\n',
    });
  });

  it('refuses to certify a version that is not the one on disk', () => {
    const { store, cwd, serverWorkDir } = setup();
    const target = planTarget({ taskId: 't-1', type: 'write', projectCwd: cwd, serverWorkDir });
    commitPlan({ store, requestKey: 'k-1', target, markdown: '# Plan v1\n' });

    // Someone edited the file by hand: a retry must not silently claim the recorded version is there.
    writeFileSync(target.path, '# hand edited\n');

    expect(() => commitPlan({ store, requestKey: 'k-1', target, markdown: '# Plan v1\n' })).toThrowError(
      expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    );
    // Nor may a different body silently overwrite the foreign edit.
    expect(() => commitPlan({ store, requestKey: 'k-1', target, markdown: '# Plan v2\n' })).toThrowError(
      expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    );
    expect(readFileSync(target.path, 'utf8')).toBe('# hand edited\n');

    // Once the recorded version is back on disk, a new body is an ordinary revision and the receipt
    // follows the bytes that are really there.
    writeFileSync(target.path, '# Plan v1\n');
    const rewritten = commitPlan({ store, requestKey: 'k-1', target, markdown: '# Plan v2\n' });
    expect(rewritten.reused).toBe(false);
    expect(readFileSync(target.path, 'utf8')).toBe('# Plan v2\n');
    expect(store.getFileSave('k-1')?.contentHash).toBe(digestOfText('# Plan v2\n'));
  });

  it('keeps a read Task plan in the host work area and reports a changed file', () => {
    const { store, cwd, serverWorkDir } = setup();
    const target = planTarget({ taskId: 't-2', type: 'read', projectCwd: cwd, serverWorkDir });

    const { ref } = commitPlan({ store, requestKey: 'k-2', target, markdown: 'short plan\n' });

    expect(target.path).toBe(join(serverWorkDir, 't-2', 'plan.md'));
    expect(planRefFor(target, 'short plan\n')).toEqual(ref);
    rmSync(target.path);
    expect(readPlan(ref)).toEqual({ text: '', current: false });
  });
});
describe('task store · stage readiness follows member input state', () => {
  function addMember(store: Store, inputId: string): void {
    store.updateTask({ taskId: 't-1', expectedRevision: store.getTask('t-1')!.revision, phase: 'develop' });
    store.createTaskSessions({
      taskId: 't-1',
      members: [
        {
          sessionId: 'm-1',
          taskId: 't-1',
          roleId: 'developer',
          phase: 'develop',
          label: 'work',
          instructions: 'do the work',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          inputId,
          inputPayload: { content: [{ type: 'text', text: 'work' }] },
        },
      ],
    });
  }

  it('a member whose input is still processing blocks the phase change (STAGE_NOT_READY)', () => {
    const { store } = setup();
    create(store);
    addMember(store, 'i-m1');
    store.claimNextInput('m-1'); // → processing
    expect(() =>
      store.updateTask({ taskId: 't-1', expectedRevision: store.getTask('t-1')!.revision, phase: 'review' }),
    ).toThrowError(expect.objectContaining({ code: 'STAGE_NOT_READY' }));
  });

  it('a member whose input has completed no longer blocks the phase change (the settle gate)', () => {
    const { store } = setup();
    create(store);
    addMember(store, 'i-m1');
    const claimed = store.claimNextInput('m-1');
    if (claimed.kind !== 'claimed') throw new Error('the member input could not be claimed');
    store.finishInput({
      inputId: 'i-m1',
      expectedRevision: claimed.input.revision,
      status: 'completed',
    });
    const updated = store.updateTask({
      taskId: 't-1',
      expectedRevision: store.getTask('t-1')!.revision,
      phase: 'review',
      summary: 'develop step settled',
    });
    expect(updated.phase).toBe('review');
    expect(updated.currentSessionIds).toEqual([]);
  });
});
