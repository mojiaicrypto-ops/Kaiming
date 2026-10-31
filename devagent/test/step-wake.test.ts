import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { wakeForSettledStep } from '../src/server/step-wake.ts';

const dirs: string[] = [];
const stores: Store[] = [];

function openStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-step-wake-'));
  dirs.push(dir);
  const store = new Store({ path: join(dir, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A chief with an active write Task whose current step is one dispatched developer. */
function seedStep(store: Store): void {
  store.createProject({ id: 'p-1', realPath: '/projects/alpha' });
  store.createSession({ id: 's-chief', projectId: 'p-1', roleId: 'chief', cwd: '/projects/alpha' });
  store.createTask({
    id: 't-1',
    projectId: 'p-1',
    chiefSessionId: 's-chief',
    ownerEpoch: 1,
    type: 'write',
    requiresTest: true,
    goal: 'ship it',
    scope: 'x',
    acceptanceRefs: [],
    basisRefs: [],
    planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'p' },
    authorizationRefs: [],
    sourceInputId: 'seed',
  });
  store.createTaskSessions({
    taskId: 't-1',
    members: [
      {
        sessionId: 's-dev',
        taskId: 't-1',
        roleId: 'developer',
        phase: 'plan',
        label: 'dev',
        instructions: 'implement it',
        refs: [],
        dependencies: [],
        expectedKind: 'implementation',
        writeScope: ['src/**'],
        inputId: 'i-dev',
        inputPayload: { content: [{ type: 'text', text: 'implement it' }] },

      },
    ],
  });
}

/** Run the member's input to a terminal state, the way the worker would. */
function settleMember(store: Store, status: 'completed' | 'failed' | 'interrupted' = 'completed'): void {
  const claimed = store.claimNextInput('s-dev');
  if (claimed.kind !== 'claimed') throw new Error(`member input was not claimable: ${claimed.kind}`);
  store.finishInput({
    inputId: claimed.input.inputId,
    expectedRevision: claimed.input.revision,
    status,
    ...(status === 'interrupted'
      ? { errorCode: 'RUN_TIMEOUT', errorMessage: 'run exceeded 5400s; the run was aborted' }
      : {}),
  });
}

function queueChiefInput(store: Store, inputId: string): void {
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId: 's-chief',
    sourceKey: `s-chief:${inputId}`,
    requestKey: inputId,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'meanwhile' }] },
  });
}

describe('settled-step wake', () => {
  it('wakes the idle chief once per settled step, and the notice is claimable while the Task runs', () => {
    const store = openStore();
    seedStep(store);
    settleMember(store);

    const woke = wakeForSettledStep(store, 't-1');
    expect(woke).toMatchObject({ woken: true, reason: 'woken' });
    const notice = store.getInput(woke.noticeId ?? '');
    expect(notice).toMatchObject({ kind: 'system_notice', status: 'queued', taskId: 't-1', sessionId: 's-chief' });
    const text = JSON.stringify(notice?.payload);
    expect(text).toContain('t-1');
    expect(text).toContain('phase plan');
    expect(text).toContain('advanced nothing');

    // The same step never produces a second notice (keyed by its member inputs).
    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: false, reason: 'already-notified' });

    // The claim gate really hands it to the chief: this is the turn that would have been lost.
    const claim = store.claimNextInput('s-chief');
    expect(claim.kind).toBe('claimed');
    if (claim.kind === 'claimed') expect(claim.input.inputId).toBe(woke.noticeId);
  });

  it('stays out of the way while a member of the step is still running', () => {
    const store = openStore();
    seedStep(store);
    const claimed = store.claimNextInput('s-dev');
    expect(claimed.kind).toBe('claimed');

    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: false, reason: 'step-busy' });
    expect(store.listInputs('s-chief')).toHaveLength(0);
  });

  it('stays out of the way while the chief itself still has work', () => {
    const store = openStore();
    seedStep(store);
    settleMember(store);
    queueChiefInput(store, 'i-chief');

    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: false, reason: 'chief-busy' });
    expect(store.listInputs('s-chief').map((input) => input.inputId)).toEqual(['i-chief']);
  });

  it('wakes for a failed member too, since the chief must see the block', () => {
    const store = openStore();
    seedStep(store);
    settleMember(store, 'failed');

    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: true, reason: 'woken' });
  });

  it('sends an interrupted member to the recovery notice, once, with the recover instruction', () => {
    const store = openStore();
    seedStep(store);
    settleMember(store, 'interrupted');

    const woke = wakeForSettledStep(store, 't-1');
    expect(woke).toMatchObject({ woken: true, noticeId: 'notice-i-dev' });
    const notice = store.getInput('notice-i-dev');
    expect(notice).toMatchObject({ kind: 'system_notice', status: 'queued', taskId: 't-1', sessionId: 's-chief' });
    const text = JSON.stringify(notice?.payload);
    expect(text).toContain('RUN_TIMEOUT');
    expect(text).toContain('outcome is unknown');
    expect(text).toContain('task(op=recover');
    expect(text).toContain('Do not assume it finished');
    // Only the recovery notice: the generic "continue" notice would hide the unknown outcome.
    expect(store.listInputs('s-chief').map((input) => input.inputId)).toEqual(['notice-i-dev']);
    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: false, reason: 'already-notified' });
    expect(store.claimNextInput('s-chief').kind).toBe('claimed');
  });

  it('defers the interrupted-member recovery notice while the chief is busy', () => {
    const store = openStore();
    seedStep(store);
    settleMember(store, 'interrupted');
    queueChiefInput(store, 'i-chief');

    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: false, reason: 'chief-busy' });
    expect(store.getInput('notice-i-dev')).toBeUndefined();
  });

  it('does not wake a Task that is no longer running', () => {
    const store = openStore();
    seedStep(store);
    settleMember(store);
    store.controlTask({ taskId: 't-1', expectedRevision: store.getTask('t-1')?.revision ?? 1, command: 'pause' });

    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: false, reason: 'not-running' });
  });

  it('does not wake for a step with no dispatched members', () => {
    const store = openStore();
    seedStep(store);
    settleMember(store);
    // A phase change clears the step; there is no report to recover at that point.
    store.updateTask({ taskId: 't-1', phase: 'develop' });

    expect(wakeForSettledStep(store, 't-1')).toMatchObject({ woken: false, reason: 'no-step' });
  });
});
