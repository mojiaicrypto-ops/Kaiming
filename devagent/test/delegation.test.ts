import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createTaskSessionsTool, type DelegationReturn } from '../src/tools/delegation-tools.ts';
import { createChiefTaskTools, type DomainTool, type TaskToolContext } from '../src/tools/task-tools.ts';

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
  readonly delegation: DomainTool;
  readonly dispatchCalls: string[];
  readonly settleCalls: Array<{ taskId: string; timeoutMs: number }>;
  setSettleReturn(value: DelegationReturn): void;
  setInput(inputId: string): void;
}

async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-delegation-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
  const state = { inputId: 'i-1', settle: undefined as DelegationReturn | undefined };
  const serverWorkDir = join(root, 'work');
  const contextOf = (): TaskToolContext => {
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
    };
  };
  const chiefTools = createChiefTaskTools(contextOf);
  const dispatchCalls: string[] = [];
  const settleCalls: Array<{ taskId: string; timeoutMs: number }> = [];
  const delegation = createTaskSessionsTool(() => ({
    ...contextOf(),
    host: {
      async dispatch(sessionId: string) {
        dispatchCalls.push(sessionId);
      },
      async settleStep(taskId: string, timeoutMs: number) {
        settleCalls.push({ taskId, timeoutMs });
        return (
          state.settle ?? {
            taskId,
            outcome: 'completed' as const,
            sessions: [],
          }
        );
      },
    },
  }));
  const create = chiefTools.find((entry) => entry.name === 'createTask');
  if (create === undefined) {
    throw new Error('createTask tool missing');
  }
  await create.execute('c1', {
    type: 'write',
    goal: 'reset password',
    scope: 'account',
    planMarkdown: '# plan\n',
    authorizationRef: 'm-001',
    requiresTest: true,
  });
  // The stub returns a settled snapshot by default so tests can assert what the tool forwards.
  state.settle = {
    taskId: store.listTasks('p-1')[0]?.id ?? '',
    outcome: 'completed',
    sessions: [
      {
        sessionId: 'member-1',
        inputId: 'mi-1',
        state: 'completed',
        resultIds: [],
        interactionIds: [],
      },
    ],
  };
  return {
    store,
    cwd,
    serverWorkDir,
    chiefTools,
    delegation,
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
  ...overrides,
});

async function moveToPhase(f: Fixture, phase: string): Promise<void> {
  const task = f.store.listTasks('p-1')[0];
  const update = f.chiefTools.find((entry) => entry.name === 'updateTask');
  await update?.execute('u1', { taskId: task?.id, expectedRevision: task?.revision, phase });
}

describe('createTaskSessions', () => {
  it('creates the current step members, dispatches them and reports the aggregate', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];

    const result = await f.delegation.execute('call-1', {
      mode: 'create',
      sessions: [member()],
    });

    expect(result.isError).toBe(false);
    const members = f.store.listTaskSessions(task?.id ?? '');
    expect(members).toHaveLength(1);
    expect(members[0]?.roleId).toBe('developer');
    expect(members[0]?.phase).toBe('develop');
    expect(f.store.getTask(task?.id ?? '')?.currentSessionIds).toEqual([members[0]?.sessionId]);
    // The member's first input really exists and is queued, and it was dispatched once.
    expect(f.store.getInput(members[0]?.currentInputId ?? '')?.status).toBe('queued');
    expect(f.dispatchCalls).toEqual([members[0]?.sessionId]);
    expect(f.settleCalls).toEqual([{ taskId: task?.id, timeoutMs: 120_000 }]);
    expect(result.details['outcome']).toBe('completed');
  });

  it('refuses a role outside the current phase and a report kind a read Task cannot ask for', async () => {
    const f = await fixture();

    const wrongPhase = await f.delegation.execute('call-1', {
      mode: 'create',
      sessions: [member({ roleId: 'reviewer', expectedKind: 'review' })],
    });

    expect(wrongPhase.isError).toBe(true);
    expect(wrongPhase.details['code']).toBe('STAGE_NOT_READY');
    expect(f.store.listTaskSessions(f.store.listTasks('p-1')[0]?.id ?? '')).toHaveLength(0);
    expect(f.dispatchCalls).toEqual([]);

    // A read Task only accepts read-only report kinds.
    const readTask = f.store.listTasks('p-1')[0];
    f.store.createSession({ id: 'c-2', projectId: 'p-1', roleId: 'chief', cwd: f.cwd });
    const readTools = createChiefTaskTools(() => ({
      store: f.store,
      sessionId: 'c-2',
      projectId: 'p-1',
      cwd: f.cwd,
      roleId: 'chief',
      inputId: 'i-9',
      serverWorkDir: f.serverWorkDir,
      ...(f.store.getSession('c-2')?.currentTaskId != null
        ? { currentTaskId: f.store.getSession('c-2')?.currentTaskId as string }
        : {}),
    }));
    const create = readTools.find((entry) => entry.name === 'createTask');
    const created = await create?.execute('c2', {
      type: 'read',
      goal: 'investigate',
      scope: 'x',
      planMarkdown: '# read plan\n',
      authorizationRef: 'm-001',
    });
    expect(created?.isError).toBe(false);
    const readTaskId = String(created?.details['taskId'] ?? '');
    await readTools.find((entry) => entry.name === 'updateTask')?.execute('u2', {
      taskId: readTaskId,
      expectedRevision: f.store.getTask(readTaskId)?.revision,
      phase: 'analyze',
    });
    const readTool = createTaskSessionsTool(() => ({
      store: f.store,
      sessionId: 'c-2',
      projectId: 'p-1',
      cwd: f.cwd,
      roleId: 'chief',
      inputId: 'i-9',
      serverWorkDir: f.serverWorkDir,
      currentTaskId: readTaskId,
      host: {
        async dispatch() {},
        async settleStep(taskId: string) {
          return { taskId, outcome: 'completed' as const, sessions: [] };
        },
      },
    }));

    const badKind = await readTool.execute('call-2', {
      mode: 'create',
      sessions: [member({ roleId: 'investigator', expectedKind: 'implementation' })],
    });

    expect(badKind.isError).toBe(true);
    expect(badKind.details['code']).toBe('INVALID_ARGUMENT');
    expect(readTask).toBeDefined();
  });

  it('only allows a read-only recovery check while the Task is paused', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    const control = f.chiefTools.find((entry) => entry.name === 'task');
    const paused = await control?.execute('p1', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: task?.revision,
      command: 'pause',
    });
    expect(paused?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('paused');

    const refused = await f.delegation.execute('call-1', {
      taskId: task?.id,
      mode: 'create',
      sessions: [member()],
    });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('TASK_CONTROLLED');
    expect(f.store.listTaskSessions(task?.id ?? '')).toHaveLength(0);
  });

  it('continues a settled member and refuses one that is still running', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    await f.delegation.execute('call-1', { mode: 'create', sessions: [member()] });
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

    const continued = await f.delegation.execute('call-2', {
      mode: 'continue',
      sessionId: settled?.sessionId,
      instructions: 'fix the finding',
    });

    expect(continued.isError).toBe(false);
    const after = f.store.getTaskSession(settled?.sessionId ?? '');
    expect(after?.currentInputId).not.toBe(settled?.currentInputId);
    expect(f.store.getInput(after?.currentInputId ?? '')?.kind).toBe('continuation');
    expect(f.dispatchCalls).toEqual([settled?.sessionId]);

    // A member that is still queued must not be continued.
    const running = f.store.listTaskSessions(task?.id ?? '')[0];
    const refused = await f.delegation.execute('call-3', {
      mode: 'continue',
      sessionId: running?.sessionId,
      instructions: 'again',
    });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('STAGE_NOT_READY');
  });

  it('waits without adding work and forwards the timeout snapshot unchanged', async () => {
    const f = await fixture();
    const snapshot: DelegationReturn = {
      taskId: f.store.listTasks('p-1')[0]?.id ?? '',
      outcome: 'timeout',
      sessions: [
        {
          sessionId: 'member-9',
          inputId: 'mi-9',
          state: 'working',
          resultIds: [],
          interactionIds: [],
        },
      ],
    };
    f.setSettleReturn(snapshot);

    const waited = await f.delegation.execute('call-1', { mode: 'wait', waitTimeoutMs: 500 });

    expect(waited.isError).toBe(false);
    expect(waited.details['outcome']).toBe('timeout');
    expect(f.store.listTaskSessions(snapshot.taskId)).toHaveLength(0);
    expect(f.dispatchCalls).toEqual([]);
    expect(f.settleCalls).toEqual([{ taskId: snapshot.taskId, timeoutMs: 1_000 }]);
  });

  it('refuses delegation from a session that does not coordinate the Task', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    const stranger = createTaskSessionsTool(() => ({
      store: f.store,
      sessionId: 'c-other',
      projectId: 'p-1',
      cwd: f.cwd,
      roleId: 'chief',
      inputId: 'i-1',
      serverWorkDir: f.serverWorkDir,
      host: {
        async dispatch() {},
        async settleStep(taskId: string) {
          return { taskId, outcome: 'completed' as const, sessions: [] };
        },
      },
    }));

    const refused = await stranger.execute('call-1', {
      taskId: task?.id,
      mode: 'create',
      sessions: [member()],
    });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('FORBIDDEN');
  });
});

describe('task control', () => {
  it('pauses, resumes and cancels with version checks', async () => {
    const f = await fixture();
    const task = f.store.listTasks('p-1')[0];
    const control = f.chiefTools.find((entry) => entry.name === 'task');

    const paused = await control?.execute('c1', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: task?.revision,
      command: 'pause',
    });
    expect(paused?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('paused');
    // A paused Task still occupies the chief's only open-Task slot (G2: "含暂停").
    expect(f.store.getSession('c-1')?.currentTaskId).toBe(task?.id);

    const stale = await control?.execute('c2', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: task?.revision,
      command: 'resume',
    });
    expect(stale?.isError).toBe(true);
    expect(stale?.details['code']).toBe('VERSION_CONFLICT');

    const resumed = await control?.execute('c3', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: f.store.getTask(task?.id ?? '')?.revision,
      command: 'resume',
    });
    expect(resumed?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('active');
    expect(f.store.getSession('c-1')?.currentTaskId).toBe(task?.id);

    // Cancellation ends the Task and frees the slot.
    const cancelled = await control?.execute('c4', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: f.store.getTask(task?.id ?? '')?.revision,
      command: 'cancel',
    });
    expect(cancelled?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.status).toBe('cancelled');
    expect(f.store.getSession('c-1')?.currentTaskId).toBeNull();
  });

  it('freezes a candidate version with a version check', async () => {
    const f = await fixture();
    const task = f.store.listTasks('p-1')[0];
    const control = f.chiefTools.find((entry) => entry.name === 'task');

    const prepared = await control?.execute('c1', {
      op: 'prepare_candidate',
      taskId: task?.id,
      expectedRevision: task?.revision,
      candidate: { candidateId: 'k-1', files: [{ path: 'src/a.ts', sha256: 'abc' }] },
    });

    expect(prepared?.isError).toBe(false);
    expect(f.store.getTask(task?.id ?? '')?.candidate).toEqual({
      candidateId: 'k-1',
      files: [{ path: 'src/a.ts', sha256: 'abc' }],
    });
  });
});
describe('delegation against the control rules', () => {
  const contextFor = (
    f: Fixture,
    taskId: string,
    host: Partial<{ dispatch: (sessionId: string) => Promise<void>; settleStep: (taskId: string, timeoutMs: number) => Promise<DelegationReturn> }> = {},
  ) =>
    ({
      store: f.store,
      sessionId: 'c-1',
      projectId: 'p-1',
      cwd: f.cwd,
      roleId: 'chief',
      inputId: 'i-1',
      serverWorkDir: f.serverWorkDir,
      currentTaskId: taskId,
      host: {
        dispatch: host.dispatch ?? (async () => undefined),
        settleStep:
          host.settleStep ?? (async (id: string) => ({ taskId: id, outcome: 'completed' as const, sessions: [] })),
      },
    }) as never;

  it('binds every member to the Task and lets the wait own the deadline', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    const task = f.store.listTasks('p-1')[0];
    const deferred = Promise.withResolvers<void>();
    let waitedMs = 0;
    const tool = createTaskSessionsTool(() =>
      contextFor(f, task?.id ?? '', {
        dispatch: () => deferred.promise,
        settleStep: async (id: string, timeoutMs: number) => {
          waitedMs = timeoutMs;
          return { taskId: id, outcome: 'timeout', sessions: [] };
        },
      }),
    );

    const result = await tool.execute('call-1', { mode: 'create', waitTimeoutMs: 1_500, sessions: [member()] });

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
    const control = f.chiefTools.find((entry) => entry.name === 'task');
    await control?.execute('p1', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: task?.revision,
      command: 'pause',
    });
    const paused = f.store.getTask(task?.id ?? '');
    expect(paused?.status).toBe('paused');
    const tool = createTaskSessionsTool(() => contextFor(f, task?.id ?? ''));

    // Ordinary work stays refused.
    const refused = await tool.execute('call-1', { mode: 'create', sessions: [member()] });
    expect(refused.details['code']).toBe('TASK_CONTROLLED');

    // The one allowed kind of work is the read-only recovery check, whatever the phase is.
    const recovery = await tool.execute('call-2', {
      mode: 'create',
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
    const control = f.chiefTools.find((entry) => entry.name === 'task');
    await control?.execute('p1', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: task?.revision,
      command: 'cancel',
    });
    const tool = createTaskSessionsTool(() => contextFor(f, task?.id ?? ''));

    // Even the read-only recovery check is refused, and nothing is written.
    const recovery = await tool.execute('call-1', {
      mode: 'create',
      sessions: [member({ roleId: 'investigator', expectedKind: 'recovery', label: 'recover' })],
    });

    expect(recovery.isError).toBe(true);
    expect(recovery.details['code']).toBe('TASK_CONTROLLED');
    expect(f.store.listTaskSessions(task?.id ?? '')).toHaveLength(0);
  });

  it('refuses to continue work of a paused Task and of an interrupted member', async () => {
    const f = await fixture();
    await moveToPhase(f, 'develop');
    await f.delegation.execute('call-1', { mode: 'create', sessions: [member()] });
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

    const needsRecovery = await f.delegation.execute('call-2', {
      mode: 'continue',
      sessionId: memberRow?.sessionId,
      instructions: 'carry on',
    });

    expect(needsRecovery.isError).toBe(true);
    expect(needsRecovery.details['code']).toBe('RECOVERY_REQUIRED');

    const control = f.chiefTools.find((entry) => entry.name === 'task');
    await control?.execute('p1', {
      op: 'control',
      taskId: task?.id,
      expectedRevision: f.store.getTask(task?.id ?? '')?.revision,
      command: 'pause',
    });
    const continuedWhilePaused = await f.delegation.execute('call-3', {
      taskId: task?.id,
      mode: 'continue',
      sessionId: memberRow?.sessionId,
      instructions: 'carry on',
    });

    expect(continuedWhilePaused.isError).toBe(true);
    expect(continuedWhilePaused.details['code']).toBe('TASK_CONTROLLED');
    // Nothing was written for either refusal.
    expect(f.store.getTaskSession(memberRow?.sessionId ?? '')?.currentInputId).toBe(
      memberRow?.currentInputId,
    );
  });
});
