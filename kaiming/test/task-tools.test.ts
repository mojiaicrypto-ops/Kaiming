import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createTaskGetTool, createTaskTool, type DomainTool, type TaskToolContext } from '../src/tools/task-tools.ts';
import { digestOfText } from '../src/runtime/plan-store.ts';

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

interface World {
  readonly store: Store;
  readonly root: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly serverWorkDir: string;
  readonly tools: readonly DomainTool[];
  setInput(inputId: string): void;
}

function world(options: { projectId?: string; sessionId?: string } = {}): World {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-tools-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  const projectId = options.projectId ?? 'p-1';
  const sessionId = options.sessionId ?? 'c-1';
  const store = new Store({ path: join(root, `${sessionId}.db`), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: projectId, realPath: cwd });
  store.createSession({ id: sessionId, projectId, roleId: 'chief', cwd });
  const state = { inputId: 'i-1' };
  // A real decision input in this project: the tool verifies the cited decision, not its wording.
  store.acceptInput({
    inputId: 'i-dec',
    projectId,
    sessionId,
    sourceKey: `${sessionId}:i-dec`,
    requestKey: 'i-dec',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'go ahead' }] },
  });
  const serverWorkDir = join(root, 'work');
  const tool = createTaskTool(
    (): TaskToolContext => {
      const currentTaskId = store.getSession(sessionId)?.currentTaskId;
      return {
        store,
        sessionId,
        projectId,
        cwd,
        roleId: 'chief',
        inputId: state.inputId,
        serverWorkDir,
        ...(currentTaskId != null ? { currentTaskId } : {}),
      };
    },
    { chief: true },
  );
  return {
    store,
    root,
    cwd,
    sessionId,
    projectId,
    serverWorkDir,
    tools: [tool],
    setInput: (inputId) => {
      state.inputId = inputId;
    },
  };
}

function tool(tools: readonly DomainTool[]): DomainTool {
  const found = tools[0];
  if (found === undefined) {
    throw new Error('the tool is not registered');
  }
  return found;
}

/** A write Plan must state acceptance (G2), so every fixture carries one. */
const PLAN = '# original plan\n\n## 验收\n- observable result\n';

function createArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: 'create',
    type: 'write',
    goal: 'reset password',
    scope: 'account module',
    planMarkdown: PLAN,
    authorizationRef: { inputId: 'i-dec' },
    requiresTest: true,
    ...overrides,
  };
}

describe('task create', () => {
  it('creates the Task, writes the plan and records the calling input', async () => {
    const w = world();
    w.setInput('i-7');

    const result = await tool(w.tools).execute('call-1', createArgs());

    expect(result.isError).toBe(false);
    expect(result.details['planState']).toBe('saved');
    const task = w.store.listTasks(w.projectId)[0];
    expect(task?.sourceInputId).toBe('i-7');
    expect(readFileSync(task?.planRef?.path ?? '', 'utf8')).toBe(PLAN);
    // The model-facing result carries no revision: the host owns that bookkeeping.
    expect(result.details['revision']).toBeUndefined();
  });

  it('leaves no plan file or receipt behind when the Task cannot be created', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());

    const refused = await tool(w.tools).execute('call-2', createArgs({ goal: 'second' }));

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('WORKSPACE_BUSY');
    expect(w.store.listTasks(w.projectId)).toHaveLength(1);
    // Nothing was recorded for the refused call: no receipt, and no extra plan directory.
    const refusedTaskId = String(refused.details['taskId'] ?? '');
    expect(refusedTaskId).not.toBe('');
    expect(w.store.getFileSave(`i-1:plan:${refusedTaskId}`)).toBeUndefined();
    const acceptedTaskId = String(w.store.listTasks(w.projectId)[0]?.id ?? '');
    expect(readdirSync(join(w.cwd, '.dev', 'work'))).toEqual([acceptedTaskId]);
  });
});

describe('task guidance', () => {
  it('reports the actions allowed right now and what still blocks completion', async () => {
    const w = world();
    const created = await tool(w.tools).execute('call-1', createArgs());

    const actions = created.details['nextActions'] as Array<{ op: string; action: string; reason: string }>;
    expect(actions.map((entry) => entry.op)).toEqual(expect.arrayContaining(['update', 'dispatch']));
    // End is not offered while reports are missing; the gaps say what is.
    expect(actions.map((entry) => entry.op)).not.toContain('end');
    // The phase is plan: designer/investigator may be dispatched, developer may not.
    expect(actions.some((entry) => entry.action.includes('designer'))).toBe(true);
    const gaps = created.details['gaps'] as string[];
    expect(gaps.join(' ')).toContain('settlement');
    expect(gaps.join(' ')).toContain('review');
  });

  it('attaches the same guidance to a refused completion', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];

    const refused = await tool(w.tools).execute('call-2', {
      op: 'end',
      taskId: task?.id,
      completionResultId: 'r-1',
    });

    expect(refused.details['code']).toBe('COMPLETION_INCOMPLETE');
    expect((refused.details['nextActions'] as Array<{ op: string }>).length).toBeGreaterThan(0);
    // The model reads the content, so the guidance has to be in the text too.
    const text = refused.content.map((part) => part.text).join('\n');
    expect(text).toContain('nextActions');
  });
  it('points missing reports at the same Session instead of a replacement review', async () => {
    const w = world();
    const task = w.store.createTask({
      id: 't-missing-report',
      projectId: w.projectId,
      chiefSessionId: w.sessionId,
      ownerEpoch: 1,
      type: 'write',
      requiresTest: true,
      goal: 'deliver it',
      scope: 'deploy',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: join(w.serverWorkDir, 'plan.md'), sha256: 'x' },
      authorizationRefs: ['i-dec'],
      sourceInputId: 'i-1',
    });
    w.store.updateTask({ taskId: task.id, phase: 'review' });
    w.store.createTaskSessions({
      taskId: task.id,
      members: [
        {
          sessionId: 's-review',
          taskId: task.id,
          roleId: 'reviewer',
          phase: 'review',
          label: 'review',
          instructions: 'review it',
          refs: [],
          dependencies: [],
          expectedKind: 'review',
          inputId: 'i-review',
          inputPayload: { content: [{ type: 'text', text: 'review it' }] },
        },
      ],
    });
    expect(w.store.claimNextInput('s-review').kind).toBe('claimed');
    const input = w.store.getInput('i-review');
    expect(input).toBeDefined();
    expect(
      w.store.finishInput({
        inputId: 'i-review',
        expectedRevision: input?.revision ?? 0,
        status: 'completed',
      }),
    ).toBe(true);

    const read = await tool(w.tools).execute('call-1', { op: 'get', taskId: task.id });
    const members = read.details['members'] as Array<{ sessionId: string; reportMissing: boolean }>;
    expect(members).toContainEqual(expect.objectContaining({ sessionId: 's-review', reportMissing: true }));
    const actions = read.details['nextActions'] as Array<{ action: string; op: string; reason: string }>;
    expect(actions.some((entry) => entry.action.includes('s-review') && entry.reason.includes('without its formal'))).toBe(true);
    expect(actions.map((entry) => entry.op)).not.toContain('update');
    expect((read.details['gaps'] as string[]).join(' ')).toContain('no formal review report');
  });
});

describe('task guidance · honest advice', () => {
  it('advises the investigator for a read Task, never the designer', async () => {
    const w = world();
    const created = await tool(w.tools).execute('call-1', createArgs({ type: 'read', requiresTest: false }));

    const actions = created.details['nextActions'] as Array<{ op: string; action: string }>;
    const dispatch = actions.find((entry) => entry.op === 'dispatch');
    expect(dispatch?.action).toContain('investigator');
    expect(dispatch?.action).not.toContain('designer');
  });

  it('does not offer end when the recorded review failed', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    w.store.createTaskSessions({
      taskId: task?.id ?? '',
      members: [
        {
          sessionId: 'm-1',
          taskId: task?.id ?? '',
          roleId: 'reviewer',
          phase: 'plan',
          label: 'review',
          instructions: 'check it',
          refs: [],
          dependencies: [],
          expectedKind: 'review',
          inputId: 'i-m1',
          inputPayload: { content: [{ type: 'text', text: 'check it' }] },
        },
      ],
    });
    const claimed = w.store.claimNextInput('m-1');
    if (claimed.kind !== 'claimed') throw new Error('the member input could not be claimed');
    w.store.recordResult({
      resultId: 'r-failed',
      taskId: task?.id ?? '',
      sessionId: 'm-1',
      inputId: claimed.input.inputId,
      roleId: 'reviewer',
      kind: 'review',
      summary: 'blocking finding',
      verdict: 'failed',
      deliveryState: { digest: 'x', paths: [] },
      bodyRef: { storage: 'server', path: '/tmp/r-failed.md', sha256: 'x' },
      basisRefs: [],
      checks: [],
    });

    const read = await tool(w.tools).execute('call-2', { op: 'get' });

    const actions = read.details['nextActions'] as Array<{ op: string }>;
    expect(actions.map((entry) => entry.op)).not.toContain('end');
    expect((read.details['gaps'] as string[]).join(' ')).toContain('no passed independent review');
  });

  it('sends a test phase without a passed review back to the review', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    await tool(w.tools).execute('call-2', { op: 'update', taskId: task?.id, phase: 'test' });

    const read = await tool(w.tools).execute('call-3', { op: 'get' });

    const actions = read.details['nextActions'] as Array<{ op: string; action: string }>;
    expect(actions.some((entry) => entry.action.includes('phase=review'))).toBe(true);
    expect(actions.some((entry) => entry.action.includes('roleId: tester'))).toBe(false);
  });
});

describe('task update', () => {
  it('refuses to overwrite a Plan edited outside the tool and returns the current text', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    const planPath = task?.planRef?.path ?? '';
    // A person edits the Plan file: the recorded digest no longer matches what is on disk.
    writeFileSync(planPath, '# hand edit\n', 'utf8');

    const stale = await tool(w.tools).execute('call-2', {
      op: 'update',
      taskId: task?.id,
      changes: { planMarkdown: '# STALE WRITER\n\n## 验收\n- other\n' },
    });

    expect(stale.isError).toBe(true);
    expect(stale.details['code']).toBe('VERSION_CONFLICT');
    expect(stale.details['currentText']).toBe('# hand edit\n');
    expect(readFileSync(planPath, 'utf8')).toBe('# hand edit\n');
  });

  it('starts the next step and rewrites the plan from the recorded version', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];

    const updated = await tool(w.tools).execute('call-2', {
      op: 'update',
      taskId: task?.id,
      phase: 'develop',
      summary: 'plan fixed',
      changes: { planMarkdown: '# revised plan\n\n## 验收\n- observable result\n' },
    });

    expect(updated.isError).toBe(false);
    expect(updated.details['phase']).toBe('develop');
    expect(updated.details['planState']).toBe('saved');
    expect(readFileSync(task?.planRef?.path ?? '', 'utf8')).toBe('# revised plan\n\n## 验收\n- observable result\n');
  });

  it('refuses a Task coordinated by another session', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    w.store.createSession({ id: 'c-2', projectId: w.projectId, roleId: 'chief', cwd: w.cwd });
    const secondChief = createTaskTool(
      () => ({
        store: w.store,
        sessionId: 'c-2',
        projectId: w.projectId,
        cwd: w.cwd,
        roleId: 'chief',
        inputId: 'i-9',
        serverWorkDir: w.serverWorkDir,
      }),
      { chief: true },
    );

    const result = await secondChief.execute('call-2', { op: 'update', taskId: task?.id, phase: 'develop' });

    expect(result.isError).toBe(true);
    expect(result.details['code']).toBe('FORBIDDEN');
    expect(w.store.getTask(task?.id ?? '')?.phase).toBe('plan');
  });
});

describe('task get', () => {
  it('resolves the current Task without an id and reports the plan text', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());

    const read = await tool(w.tools).execute('call-2', { op: 'get' });

    expect(read.isError).toBe(false);
    const task = read.details['task'] as { taskId?: string };
    expect(task.taskId).toBe(w.store.listTasks(w.projectId)[0]?.id);
    expect(read.details['planText']).toBe(PLAN);
    expect(read.details['planCurrent']).toBe(true);
  });

  it('says project writes are held while the Task is not running, and drops the note once it resumes', async () => {
    const w = world();
    const created = await tool(w.tools).execute('call-1', createArgs());
    expect(created.isError).toBe(false);
    const taskId = w.store.listTasks(w.projectId)[0]?.id ?? '';
    const paused = await tool(w.tools).execute('call-2', { op: 'control', taskId, command: 'pause' });
    expect(paused.isError).toBe(false);

    const held = await tool(w.tools).execute('call-3', { op: 'get', taskId });

    expect(held.isError).toBe(false);
    expect(held.details['context']).toEqual({
      writeHold: 'paused',
      note: expect.stringContaining('withheld here'),
    });
    // The Task can still be resumed from here: the note is not a dead end.
    const actions = held.details['nextActions'];
    expect(Array.isArray(actions)).toBe(true);
    if (Array.isArray(actions)) {
      const first = actions[0];
      expect(String((first as { action?: string } | undefined)?.action)).toContain('command=resume');
    }

    await tool(w.tools).execute('call-4', { op: 'control', taskId, command: 'resume' });
    const open = await tool(w.tools).execute('call-5', { op: 'get', taskId });
    expect(open.details['context']).toBeUndefined();
  });

  it('says so when the session has no Task yet', async () => {
    const w = world();

    const read = await tool(w.tools).execute('call-1', { op: 'get' });

    expect(read.isError).toBe(true);
    expect(read.details['code']).toBe('NOT_FOUND');
  });

  it('does not expose another project through a specialist reader', async () => {
    const owner = world();
    await tool(owner.tools).execute('call-1', createArgs());
    const task = owner.store.listTasks(owner.projectId)[0];

    const stranger = world({ projectId: 'p-2', sessionId: 'c-9' });
    // Build a specialist reader pointed at the stranger's project but asking for the foreign Task.
    const reader = createTaskGetTool(() => ({
      store: stranger.store,
      sessionId: 'c-9',
      projectId: 'p-2',
      cwd: stranger.cwd,
      roleId: 'reviewer',
      inputId: 'i-1',
      serverWorkDir: stranger.serverWorkDir,
    }));

    const read = await reader.execute('call-2', { op: 'get', taskId: task?.id });

    expect(read.isError).toBe(true);
    expect(read.details['code']).toBe('NOT_FOUND');
  });

  it('returns the current members and, on request, the report bodies', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    w.store.createTaskSessions({
      taskId: task?.id ?? '',
      members: [
        {
          sessionId: 'm-1',
          taskId: task?.id ?? '',
          roleId: 'developer',
          phase: 'plan',
          label: 'work',
          instructions: 'do it',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          writeScope: ['src/'],
          inputId: 'i-m1',
          inputPayload: { content: [{ type: 'text', text: 'do it' }] },
        },
      ],
    });
    const bodyPath = join(w.root, 'report.md');
    writeFileSync(bodyPath, '# report\n', 'utf8');
    w.store.recordResult({
      resultId: 'r-1',
      taskId: task?.id ?? '',
      sessionId: 'm-1',
      inputId: 'i-m1',
      roleId: 'developer',
      kind: 'implementation',
      summary: 'done',
      bodyRef: { storage: 'server', path: bodyPath, sha256: digestOfText('# report\n') },
      basisRefs: [],
      checks: [],
    });

    const read = await tool(w.tools).execute('call-2', { op: 'get', includeResultBodies: true });

    expect(read.isError).toBe(false);
    const members = read.details['members'] as Array<Record<string, unknown>>;
    expect(members[0]).toMatchObject({ sessionId: 'm-1', expectedKind: 'implementation', writeScope: ['src/'] });
    const results = read.details['results'] as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ resultId: 'r-1', body: '# report\n' });
  });

  it('does not advertise chief-only calls to a specialist reader', async () => {
    const w = world();
    await tool(w.tools).execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    w.store.createTaskSessions({
      taskId: task?.id ?? '',
      members: [
        {
          sessionId: 'm-1',
          taskId: task?.id ?? '',
          roleId: 'developer',
          phase: 'plan',
          label: 'work',
          instructions: 'do it',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          writeScope: ['src/'],
          inputId: 'i-m1',
          inputPayload: { content: [{ type: 'text', text: 'do it' }] },
        },
      ],
    });
    const reader = createTaskGetTool(() => ({
      store: w.store,
      sessionId: 'm-1',
      projectId: w.projectId,
      cwd: w.cwd,
      roleId: 'developer',
      inputId: 'i-1',
      serverWorkDir: w.serverWorkDir,
    }));

    const read = await reader.execute('call-2', { op: 'get' });

    expect(read.isError).toBe(false);
    expect(read.details['nextActions']).toEqual([]);
    // The observable gaps stay: a member still learns what the Task is waiting for.
    expect((read.details['gaps'] as string[]).length).toBeGreaterThan(0);
  });

  it('offers a specialist only the get operation', () => {
    const reader = createTaskGetTool(() => {
      throw new Error('the schema check does not execute the tool');
    });
    const op = reader.parameters['properties'] as Record<string, { enum?: string[] }>;
    expect(op['op']?.enum).toEqual(['get']);
  });
});

describe('task change announcements', () => {
  it('announces create, update and a refused op is silent', async () => {
    const w = world();
    const announced: string[] = [];
    const tool = createTaskTool((): TaskToolContext => {
      const currentTaskId = w.store.getSession(w.sessionId)?.currentTaskId;
      return {
        store: w.store,
        sessionId: w.sessionId,
        projectId: w.projectId,
        cwd: w.cwd,
        roleId: 'chief',
        inputId: 'i-dec',
        serverWorkDir: w.serverWorkDir,
        onTaskChange: (taskId) => announced.push(taskId),
        ...(currentTaskId != null ? { currentTaskId } : {}),
      };
    }, { chief: true });

    const created = await tool.execute('call-1', createArgs());
    const taskId = String(created.details['taskId']);
    expect(announced).toEqual([taskId]);

    await tool.execute('call-2', { op: 'update', phase: 'design' });
    expect(announced).toEqual([taskId, taskId]);

    // A read is not a change, and a refusal is not a change: neither may wake a browser up.
    await tool.execute('call-3', { op: 'get' });
    const refused = await tool.execute('call-4', { op: 'dispatch', sessions: [] });
    expect(refused.isError).toBe(true);
    expect(announced).toEqual([taskId, taskId]);
  });

  it('cites the running user input when the model does not pass a decision', async () => {
    const w = world();
    // The chief's own run is a user input in this project; a Task created inside it cites that
    // input, so the model does not have to echo an id it was never given.
    w.store.acceptInput({
      inputId: 'i-run',
      projectId: w.projectId,
      sessionId: w.sessionId,
      sourceKey: `${w.sessionId}:i-run`,
      requestKey: 'i-run',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: '开工' }] },
    });
    w.setInput('i-run');

    const created = await tool(w.tools).execute('call-1', createArgs({ authorizationRef: undefined }));

    expect(created.isError).toBe(false);
    const task = w.store.listTasks(w.projectId)[0];
    expect(task?.authorizationRefs).toContain('input:i-run');
  });
});
