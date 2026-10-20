import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import type { DelegationReturn } from '../src/tools/delegation-tools.ts';
import { createTaskTool, type DomainTool, type TaskToolContext } from '../src/tools/task-tools.ts';

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

interface Fixture {
  readonly store: Store;
  readonly cwd: string;
  readonly serverWorkDir: string;
  readonly chiefTools: readonly DomainTool[];
  readonly taskTool: DomainTool;
  readonly dispatchCalls: string[];
  readonly settleCalls: Array<{ taskId: string; timeoutMs: number }>;
  setSettleReturn(value: DelegationReturn): void;
  setInput(inputId: string): void;
}

function chiefTool(store: Store, cwd: string, serverWorkDir: string, sessionId: string): DomainTool {
  const contextOf = (): TaskToolContext => {
    const currentTaskId = store.getSession(sessionId)?.currentTaskId;
    return {
      store,
      sessionId,
      projectId: 'p-1',
      cwd,
      roleId: 'chief',
      inputId: 'i-1',
      serverWorkDir,
      ...(currentTaskId != null ? { currentTaskId } : {}),
      host: {
        dispatch: async () => undefined,
        settleStep: async (taskId: string) => ({ taskId, outcome: 'completed' as const, sessions: [] }),
      },
    };
  };
  return createTaskTool(contextOf, { chief: true });
}

async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-delegation-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
  // A real decision input: createTask verifies the decision reference it is given.
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
  const state = { inputId: 'i-1', settle: undefined as DelegationReturn | undefined };
  const serverWorkDir = join(root, 'work');
  const dispatchCalls: string[] = [];
  const settleCalls: Array<{ taskId: string; timeoutMs: number }> = [];
  const taskTool = createTaskTool(
    (): TaskToolContext => {
      const currentTaskId = store.getSession('c-1')?.currentTaskId;
      return {
        store,
        sessionId: 'c-1',
        projectId: 'p-1',
        cwd,
        roleId: 'chief',
        inputId: state.inputId,
        serverWorkDir,
        ...(currentTaskId != null ? { currentTaskId } : {}),
        host: {
          async dispatch(sessionId: string) {
            dispatchCalls.push(sessionId);
          },
          async settleStep(taskId: string, timeoutMs: number) {
            settleCalls.push({ taskId, timeoutMs });
            return state.settle ?? { taskId, outcome: 'completed' as const, sessions: [] };
          },
        },
      };
    },
    { chief: true },
  );
  await taskTool.execute('c1', {
    op: 'create',
    type: 'write',
    goal: 'reset password',
    scope: 'account',
    planMarkdown: '# plan\n',
    authorizationRef: { inputId: 'i-dec' },
    requiresTest: true,
  });
  // The stub returns a settled snapshot by default so tests can assert what the tool forwards.
  state.settle = {
    taskId: store.listTasks('p-1')[0]?.id ?? '',
    outcome: 'completed',
    sessions: [{ sessionId: 'member-1', inputId: 'mi-1', state: 'completed', resultIds: [], interactionIds: [] }],
  };
  return {
    store,
    cwd,
    serverWorkDir,
    chiefTools: [taskTool],
    taskTool,
    dispatchCalls,
    settleCalls,
    setSettleReturn: (value) => {
      state.settle = value;
    },
    setInput: (inputId) => {
      state.inputId = inputId;
    },
  };
}

const member = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  roleId: 'developer',
  label: 'implement',
  instructions: 'implement the reset flow',
  expectedKind: 'implementation',
  writeScope: ['src/'],
  ...overrides,
});

async function moveToPhase(f: Fixture, phase: string): Promise<void> {
  const task = f.store.listTasks('p-1')[0];
  const update = f.taskTool;
  await update.execute('u1', { op: 'update', taskId: task?.id, phase });
}

describe('task dispatch', () => {
  it('creates the current step members, dispatches them and reports the aggregate', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];

    const result = await f.taskTool.execute('call-1', { op: 'dispatch', sessions: [member({ writeScope: ['src/'] })] });

    expect(result.isError).toBe(false);
    const members = f.store.listTaskSessions(task?.id ?? '');
    expect(members).toHaveLength(1);
    expect(members[0]?.roleId).toBe('developer');
    expect(members[0]?.phase).toBe('develop');
    expect(members[0]?.writeScope).toEqual(['src/']);
    expect(f.store.getTask(task?.id ?? '')?.currentSessionIds).toEqual([members[0]?.sessionId]);
    // The member's first input really exists and is queued, and it was dispatched once.
    expect(f.store.getInput(members[0]?.currentInputId ?? '')?.status).toBe('queued');
    expect(f.dispatchCalls).toEqual([members[0]?.sessionId]);
    expect(f.settleCalls).toEqual([{ taskId: task?.id, timeoutMs: 120_000 }]);
    expect(result.details['outcome']).toBe('completed');
  });

  it('refuses a role outside the current phase and a report kind a read Task cannot ask for', async () => {
    const f = await fixture();

    const wrongPhase = await f.taskTool.execute('call-1', {
      op: 'dispatch',
      sessions: [member({ roleId: 'reviewer', expectedKind: 'review' })],
    });

    expect(wrongPhase.isError).toBe(true);
    expect(wrongPhase.details['code']).toBe('STAGE_NOT_READY');
    expect(f.store.listTaskSessions(f.store.listTasks('p-1')[0]?.id ?? '')).toHaveLength(0);
    expect(f.dispatchCalls).toEqual([]);

    // A read Task only accepts read-only report kinds.
    f.store.createSession({ id: 'c-2', projectId: 'p-1', roleId: 'chief', cwd: f.cwd });
    const readTool = chiefTool(f.store, f.cwd, f.serverWorkDir, 'c-2');
    const created = await readTool.execute('c2', {
      op: 'create',
      type: 'read',
      goal: 'investigate',
      scope: 'x',
      planMarkdown: '# read plan\n',
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(created.isError).toBe(false);
    const readTaskId = String(created.details['taskId'] ?? '');
    await readTool.execute('u2', { op: 'update', taskId: readTaskId, phase: 'analyze' });

    const badKind = await readTool.execute('call-2', {
      op: 'dispatch',
      sessions: [member({ roleId: 'investigator', expectedKind: 'implementation' })],
    });

    expect(badKind.isError).toBe(true);
    expect(badKind.details['code']).toBe('INVALID_ARGUMENT');
  });

  it('only allows a read-only recovery check while the Task is paused', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    const paused = await f.taskTool.execute('p1', { op: 'control', taskId: task?.id, command: 'pause' });
    expect(paused.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('paused');

    const refused = await f.taskTool.execute('call-1', { op: 'dispatch', taskId: task?.id, sessions: [member()] });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('TASK_CONTROLLED');
    expect(f.store.listTaskSessions(task?.id ?? '')).toHaveLength(0);
  });

  it('continues a settled member and refuses one that is still running', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    await f.taskTool.execute('call-1', { op: 'dispatch', sessions: [member()] });
    const task = f.store.listTasks('p-1')[0];
    const settled = f.store.listTaskSessions(task?.id ?? '')[0];
    // Simulate the member having finished its work.
    const claimed = f.store.claimNextInput(settled?.sessionId ?? '');
    if (claimed.kind !== 'claimed') {
      throw new Error('the member input could not be claimed');
    }
    f.store.finishInput({
      inputId: claimed.input.inputId,
      expectedRevision: claimed.input.revision,
      status: 'completed',
    });
    f.dispatchCalls.length = 0;

    const continued = await f.taskTool.execute('call-2', {
      op: 'dispatch',
      sessions: [{ sessionId: settled?.sessionId, instructions: 'fix the finding' }],
    });

    expect(continued.isError).toBe(false);
    const after = f.store.getTaskSession(settled?.sessionId ?? '');
    expect(after?.currentInputId).not.toBe(settled?.currentInputId);
    expect(f.store.getInput(after?.currentInputId ?? '')?.kind).toBe('continuation');
    expect(f.dispatchCalls).toEqual([settled?.sessionId]);

    // A member that is still queued must not be continued.
    const running = f.store.listTaskSessions(task?.id ?? '')[0];
    const refused = await f.taskTool.execute('call-3', {
      op: 'dispatch',
      sessions: [{ sessionId: running?.sessionId, instructions: 'again' }],
    });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('STAGE_NOT_READY');
  });

  it('waits without adding work and forwards the timeout snapshot unchanged', async () => {
    const f = await fixture();
    const snapshot: DelegationReturn = {
      taskId: f.store.listTasks('p-1')[0]?.id ?? '',
      outcome: 'timeout',
      sessions: [{ sessionId: 'member-9', inputId: 'mi-9', state: 'working', resultIds: [], interactionIds: [] }],
    };
    f.setSettleReturn(snapshot);

    const waited = await f.taskTool.execute('call-1', { op: 'dispatch', waitTimeoutMs: 500 });

    expect(waited.isError).toBe(false);
    expect(waited.details['outcome']).toBe('timeout');
    expect(f.store.listTaskSessions(snapshot.taskId)).toHaveLength(0);
    expect(f.dispatchCalls).toEqual([]);
    expect(f.settleCalls).toEqual([{ taskId: snapshot.taskId, timeoutMs: 1_000 }]);
  });

  it('derives the label and the report kind from the role when they are omitted', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');

    const result = await f.taskTool.execute('c1', {
      op: 'dispatch',
      sessions: [{ roleId: 'developer', instructions: 'implement it', writeScope: ['src/'] }],
    });

    expect(result.isError).toBe(false);
    const member = f.store.listTaskSessions(f.store.listTasks('p-1')[0]?.id ?? '')[0];
    expect(member).toMatchObject({ roleId: 'developer', label: 'developer', expectedKind: 'implementation' });
  });

  it('names the current members and allowed roles when a dispatch is refused', async () => {
    const f = await fixture();

    const wrongPhase = await f.taskTool.execute('call-1', {
      op: 'dispatch',
      sessions: [member({ roleId: 'reviewer', expectedKind: 'review' })],
    });

    expect(wrongPhase.isError).toBe(true);
    expect(wrongPhase.details['phase']).toBe('plan');
    expect(wrongPhase.details['allowedRoles']).toEqual(expect.arrayContaining(['designer', 'investigator']));
    expect(wrongPhase.details['members']).toEqual([]);
  });

  it('lists a wait action while the current step has unsettled work', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    await f.taskTool.execute('call-1', { op: 'dispatch', sessions: [member()] });

    const read = await f.taskTool.execute('call-2', { op: 'get' });

    const actions = read.details['nextActions'] as Array<{ op: string; action: string }>;
    expect(actions[0]?.action).toContain('wait for the step');
    expect((read.details['gaps'] as string[]).join(' ')).toContain('not settled');
  });

  it('requires a write scope from writing members and reports overlaps without blocking', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');

    const missing = await f.taskTool.execute('c1', {
      op: 'dispatch',
      sessions: [{ roleId: 'developer', label: 'a', instructions: 'x', expectedKind: 'implementation' }],
    });
    expect(missing.isError).toBe(true);
    expect(missing.details['code']).toBe('INVALID_ARGUMENT');
    expect(f.store.listTaskSessions(f.store.listTasks('p-1')[0]?.id ?? '')).toHaveLength(0);

    const overlap = await f.taskTool.execute('c2', {
      op: 'dispatch',
      sessions: [
        member({ roleId: 'developer', label: 'one', writeScope: ['src/'] }),
        member({ roleId: 'developer', label: 'two', writeScope: ['src/account'] }),
      ],
    });
    expect(overlap.isError).toBe(false);
    expect(overlap.details['warnings']).toEqual([expect.stringContaining('overlapping writeScope')]);
    expect(f.store.listTaskSessions(f.store.listTasks('p-1')[0]?.id ?? '')).toHaveLength(2);
  });

  it('refuses a tester before an independent review has passed', async () => {
    const f = await fixture();
    await moveToPhase(f, 'test');

    const refused = await f.taskTool.execute('c1', {
      op: 'dispatch',
      sessions: [{ roleId: 'tester', label: 'verify', instructions: 'run it', expectedKind: 'test' }],
    });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('STAGE_NOT_READY');
    expect(f.dispatchCalls).toEqual([]);
  });

  it('applies the review pre-gate to a tester continuation too', async () => {
    const f = await fixture();
    await moveToPhase(f, 'test');
    // A tester member that settled earlier in this step.
    f.store.createTaskSessions({
      taskId: f.store.listTasks('p-1')[0]?.id ?? '',
      members: [
        {
          sessionId: 'm-test',
          taskId: f.store.listTasks('p-1')[0]?.id ?? '',
          roleId: 'tester',
          phase: 'test',
          label: 'verify',
          instructions: 'run it',
          refs: [],
          dependencies: [],
          expectedKind: 'test',
          inputId: 'i-test',
          inputPayload: { content: [{ type: 'text', text: 'run it' }] },
        },
      ],
    });
    const claimed = f.store.claimNextInput('m-test');
    if (claimed.kind !== 'claimed') throw new Error('the tester input could not be claimed');
    f.store.finishInput({ inputId: 'i-test', expectedRevision: claimed.input.revision, status: 'completed' });

    const refused = await f.taskTool.execute('c1', {
      op: 'dispatch',
      sessions: [{ sessionId: 'm-test', instructions: 'run it again' }],
    });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('STAGE_NOT_READY');
  });

  it('treats a root-level glob as overlapping every scope', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');

    const result = await f.taskTool.execute('c1', {
      op: 'dispatch',
      sessions: [
        member({ roleId: 'developer', label: 'one', writeScope: ['*.ts'] }),
        member({ roleId: 'developer', label: 'two', writeScope: ['src/'] }),
      ],
    });

    expect(result.details['warnings']).toEqual([expect.stringContaining('overlapping writeScope')]);
  });

  it('refuses a malformed sessions value instead of silently waiting', async () => {
    const f = await fixture();

    const refused = await f.taskTool.execute('c1', { op: 'dispatch', sessions: { roleId: 'developer' } });

    expect(refused.details['code']).toBe('INVALID_ARGUMENT');
    expect(f.settleCalls).toEqual([]);
  });

  it('refuses delegation from a session that does not coordinate the Task', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    const stranger = chiefTool(f.store, f.cwd, f.serverWorkDir, 'c-other');

    const refused = await stranger.execute('call-1', { op: 'dispatch', taskId: task?.id, sessions: [member()] });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('FORBIDDEN');
  });
});

describe('task control', () => {
  it('pauses, resumes and cancels without a version from the model', async () => {
    const f = await fixture();
    const task = f.store.listTasks('p-1')[0];

    const paused = await f.taskTool.execute('c1', { op: 'control', taskId: task?.id, command: 'pause' });
    expect(paused?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('paused');
    // A paused Task still occupies the chief's only open-Task slot (G2: "含暂停").
    expect(f.store.getSession('c-1')?.currentTaskId).toBe(task?.id);

    const resumed = await f.taskTool.execute('c3', { op: 'control', taskId: task?.id, command: 'resume' });
    expect(resumed?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('active');
    expect(f.store.getSession('c-1')?.currentTaskId).toBe(task?.id);

    // Cancellation ends the Task and frees the slot.
    const cancelled = await f.taskTool.execute('c4', { op: 'control', taskId: task?.id, command: 'cancel' });
    expect(cancelled?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('cancelled');
    expect(f.store.getSession('c-1')?.currentTaskId).toBeNull();
  });
});

describe('dispatch against the control rules', () => {
  it('binds every member to the Task and lets the wait own the deadline', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    const deferred = Promise.withResolvers<void>();
    let waitedMs = 0;
    const tool = createTaskTool(
      () => ({
        store: f.store,
        sessionId: 'c-1',
        projectId: 'p-1',
        cwd: f.cwd,
        roleId: 'chief',
        inputId: 'i-1',
        serverWorkDir: f.serverWorkDir,
        ...(task?.id !== undefined ? { currentTaskId: task.id } : {}),
        host: {
          dispatch: () => deferred.promise,
          settleStep: async (id: string, timeoutMs: number) => {
            waitedMs = timeoutMs;
            return { taskId: id, outcome: 'timeout', sessions: [] };
          },
        },
      }),
      { chief: true },
    );

    const result = await tool.execute('call-1', { op: 'dispatch', waitTimeoutMs: 1_500, sessions: [member()] });

    // A member that keeps running must not hold the tool past the deadline.
    expect(result.isError).toBe(false);
    expect(result.details['outcome']).toBe('timeout');
    expect(waitedMs).toBe(1_500);
    const created = f.store.listTaskSessions(task?.id ?? '')[0];
    // The member's identity is bound to the Task it works on.
    expect(f.store.getSession(created?.sessionId ?? '')?.currentTaskId).toBe(task?.id);
    deferred.resolve();
  });

  it('allows the read-only recovery check while the Task is paused, in the paused phase', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    await f.taskTool.execute('p1', { op: 'control', taskId: task?.id, command: 'pause' });
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('paused');

    // Ordinary work stays refused.
    const refused = await f.taskTool.execute('call-1', { op: 'dispatch', sessions: [member()] });
    expect(refused.details['code']).toBe('TASK_CONTROLLED');

    // The one allowed kind of work is the read-only recovery check, whatever the phase is.
    const recovery = await f.taskTool.execute('call-2', {
      op: 'dispatch',
      sessions: [member({ roleId: 'investigator', expectedKind: 'recovery', label: 'recover' })],
    });

    expect(recovery.isError).toBe(false);
    const members = f.store.listTaskSessions(task?.id ?? '');
    expect(members).toHaveLength(1);
    expect(members[0]?.roleId).toBe('investigator');
    expect(members[0]?.phase).toBe('develop');
  });

  it('accepts no new work at all once a Task is cancelled', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    await f.taskTool.execute('p1', { op: 'control', taskId: task?.id, command: 'cancel' });

    // Even the read-only recovery check is refused, and nothing is written.
    const recovery = await f.taskTool.execute('call-1', {
      op: 'dispatch',
      taskId: task?.id,
      sessions: [member({ roleId: 'investigator', expectedKind: 'recovery', label: 'recover' })],
    });

    expect(recovery.isError).toBe(true);
    expect(recovery.details['code']).toBe('TASK_CONTROLLED');
    expect(f.store.listTaskSessions(task?.id ?? '')).toHaveLength(0);
  });

  it('refuses to continue work of a paused Task and of an interrupted member', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    await f.taskTool.execute('call-1', { op: 'dispatch', sessions: [member()] });
    const task = f.store.listTasks('p-1')[0];
    const memberRow = f.store.listTaskSessions(task?.id ?? '')[0];
    const claimed = f.store.claimNextInput(memberRow?.sessionId ?? '');
    if (claimed.kind !== 'claimed') {
      throw new Error('the member input could not be claimed');
    }
    f.store.finishInput({
      inputId: claimed.input.inputId,
      expectedRevision: claimed.input.revision,
      status: 'interrupted',
    });

    const needsRecovery = await f.taskTool.execute('call-2', {
      op: 'dispatch',
      sessions: [{ sessionId: memberRow?.sessionId, instructions: 'carry on' }],
    });

    expect(needsRecovery.isError).toBe(true);
    expect(needsRecovery.details['code']).toBe('RECOVERY_REQUIRED');

    await f.taskTool.execute('p1', { op: 'control', taskId: task?.id, command: 'pause' });
    const continuedWhilePaused = await f.taskTool.execute('call-3', {
      op: 'dispatch',
      taskId: task?.id,
      sessions: [{ sessionId: memberRow?.sessionId, instructions: 'carry on' }],
    });

    expect(continuedWhilePaused.isError).toBe(true);
    expect(continuedWhilePaused.details['code']).toBe('TASK_CONTROLLED');
    // Nothing was written for either refusal.
    expect(f.store.getTaskSession(memberRow?.sessionId ?? '')?.currentInputId).toBe(memberRow?.currentInputId);
  });
});
