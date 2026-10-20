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
  const root = mkdtempSync(join(tmpdir(), 'devagent-tools-'));
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

function createArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: 'create',
    type: 'write',
    goal: 'reset password',
    scope: 'account module',
    planMarkdown: '# original plan\n',
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
    expect(readFileSync(task?.planRef?.path ?? '', 'utf8')).toBe('# original plan\n');
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
      changes: { planMarkdown: '# STALE WRITER\n' },
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
      changes: { planMarkdown: '# revised plan\n' },
    });

    expect(updated.isError).toBe(false);
    expect(updated.details['phase']).toBe('develop');
    expect(updated.details['planState']).toBe('saved');
    expect(readFileSync(task?.planRef?.path ?? '', 'utf8')).toBe('# revised plan\n');
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
    expect(read.details['planText']).toBe('# original plan\n');
    expect(read.details['planCurrent']).toBe(true);
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

  it('offers a specialist only the get operation', () => {
    const reader = createTaskGetTool(() => {
      throw new Error('the schema check does not execute the tool');
    });
    const op = reader.parameters['properties'] as Record<string, { enum?: string[] }>;
    expect(op['op']?.enum).toEqual(['get']);
  });
});
