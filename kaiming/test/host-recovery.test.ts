import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { closeInterruptedChiefInput } from '../src/server/host-recovery.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), 'kaiming-host-recovery-'));
  dirs.push(dir);
  const store = new Store({ path: join(dir, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: '/projects/alpha' });
  store.createSession({ id: 's-chief', projectId: 'p-1', roleId: 'chief', cwd: '/projects/alpha' });
  store.createSession({ id: 's-dev', projectId: 'p-1', roleId: 'developer', cwd: '/projects/alpha' });
  return store;
}

/** Accept and claim one input, then leave it interrupted the way a crashed run does. */
function interrupt(store: Store, sessionId: string, inputId: string): void {
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId,
    sourceKey: `user:${inputId}`,
    requestKey: inputId,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'hello' }] },
  });
  const claim = store.claimNextInput(sessionId);
  expect(claim.kind).toBe('claimed');
  if (claim.kind !== 'claimed') return;
  expect(
    store.finishInput({
      inputId,
      expectedRevision: claim.input.revision,
      status: 'interrupted',
      errorCode: 'RUN_STALLED',
      errorMessage: 'run was aborted',
    }),
  ).toBe(true);
}

describe('host recovery of a chief input', () => {
  it('closes the interrupted input with its evidence and unblocks the session', () => {
    const store = openStore();
    interrupt(store, 's-chief', 'i-1');
    // The bug the user saw: the interrupted row freezes every later message of the session.
    store.acceptInput({
      inputId: 'i-2',
      projectId: 'p-1',
      sessionId: 's-chief',
      sourceKey: 'user:i-2',
      requestKey: 'i-2',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'why the error?' }] },
    });
    expect(store.claimNextInput('s-chief').kind).toBe('blocked');

    const closed = closeInterruptedChiefInput(store, 'i-1', { code: 'run-aborted', detail: 'run was aborted' });
    expect(closed.closed).toBe(true);
    const input = store.getInput('i-1');
    expect(input?.status).toBe('stopped');
    expect(JSON.parse(input?.recovery ?? '{}')).toMatchObject({
      resolution: 'stopped',
      evidenceRefs: ['host:run-aborted'],
      resolvedBy: 'host:run-aborted',
    });
    // The chief is told the outcome is unknown, and the user's queued message can run again.
    const notice = store.getInput(closed.noticeId ?? 'missing');
    expect(notice?.kind).toBe('system_notice');
    expect(JSON.stringify(notice?.payload)).toContain('outcome is unknown');
    expect(store.claimNextInput('s-chief').kind).toBe('claimed');

    // A second pass (startup after the same outage) does nothing: one closure, one notice.
    expect(closeInterruptedChiefInput(store, 'i-1', { code: 'process-restart', detail: 'gone' }).closed).toBe(false);
  });

  it('binds the notice to the current Task so the warning is not queued behind it', () => {
    const store = openStore();
    // The real shape: the turn started before the Task existed, and the Task was created mid-run.
    store.acceptInput({
      inputId: 'i-1',
      projectId: 'p-1',
      sessionId: 's-chief',
      sourceKey: 'user:i-1',
      requestKey: 'i-1',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'arrange the docs' }] },
    });
    const claim = store.claimNextInput('s-chief');
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') return;
    store.createTask({
      id: 't-1',
      projectId: 'p-1',
      chiefSessionId: 's-chief',
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'reset password',
      scope: 'account module',
      acceptanceRefs: ['AC-1'],
      basisRefs: ['req-1'],
      planRef: { storage: 'server', path: '/tmp/x/plan.md', sha256: 'sha' },
      authorizationRefs: ['m-001'],
      sourceInputId: 'i-1',
    });
    expect(
      store.finishInput({
        inputId: 'i-1',
        expectedRevision: claim.input.revision,
        status: 'interrupted',
        errorCode: 'RUN_STALLED',
        errorMessage: 'run was aborted',
      }),
    ).toBe(true);

    const closed = closeInterruptedChiefInput(store, 'i-1', { code: 'run-aborted', detail: 'aborted' });
    expect(closed.closed).toBe(true);
    expect(store.getInput(closed.noticeId ?? '')?.taskId).toBe('t-1');
    // The chief's session is still on the Task: the notice is consumable instead of stranded.
    expect(store.claimNextInput('s-chief')).toMatchObject({ kind: 'claimed' });
  });

  it('leaves a member input to the chief, and a finished input as it is', () => {
    const store = openStore();
    interrupt(store, 's-dev', 'i-dev');
    expect(closeInterruptedChiefInput(store, 'i-dev', { code: 'run-aborted', detail: 'x' }).closed).toBe(false);
    expect(store.getInput('i-dev')?.status).toBe('interrupted');
    expect(closeInterruptedChiefInput(store, 'nope', { code: 'run-aborted', detail: 'x' }).closed).toBe(false);
  });
});
