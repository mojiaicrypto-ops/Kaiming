import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createChiefTaskTools, createTaskGetTool, type DomainTool, type TaskToolContext } from '../src/tools/task-tools.ts';

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
  const serverWorkDir = join(root, 'work');
  const tools = createChiefTaskTools((): TaskToolContext => {
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
  });
  return {
    store,
    root,
    cwd,
    sessionId,
    projectId,
    serverWorkDir,
    tools,
    setInput: (inputId) => {
      state.inputId = inputId;
    },
  };
}

function tool(tools: readonly DomainTool[], name: string): DomainTool {
  const found = tools.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`tool ${name} is not registered`);
  }
  return found;
}

function chiefTool(w: World, name: string): DomainTool {
  return tool(w.tools, name);
}

function createArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'write',
    goal: 'reset password',
    scope: 'account module',
    planMarkdown: '# original plan\n',
    authorizationRef: 'm-001',
    requiresTest: true,
    ...overrides,
  };
}

describe('createTask tool', () => {
  it('creates the Task, writes the plan and records the calling input', async () => {
    const w = world();
    w.setInput('i-7');

    const result = await chiefTool(w, 'createTask').execute('call-1', createArgs());

    expect(result.isError).toBe(false);
    expect(result.details['planState']).toBe('saved');
    const task = w.store.listTasks(w.projectId)[0];
    expect(task?.sourceInputId).toBe('i-7');
    expect(readFileSync(task?.planRef?.path ?? '', 'utf8')).toBe('# original plan\n');
  });

  it('leaves no plan file or receipt behind when the Task cannot be created', async () => {
    const w = world();
    await chiefTool(w, 'createTask').execute('call-1', createArgs());

    const refused = await chiefTool(w, 'createTask').execute('call-2', createArgs({ goal: 'second' }));

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

describe('updateTask tool', () => {
  it('does not touch the plan when the revision is stale', async () => {
    const w = world();
    await chiefTool(w, 'createTask').execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    const planPath = task?.planRef?.path ?? '';

    const stale = await chiefTool(w, 'updateTask').execute('call-2', {
      taskId: task?.id,
      expectedRevision: 99,
      changes: { planMarkdown: '# STALE WRITER\n' },
    });

    expect(stale.isError).toBe(true);
    expect(stale.details['code']).toBe('VERSION_CONFLICT');
    expect(readFileSync(planPath, 'utf8')).toBe('# original plan\n');
    expect(w.store.getTask(task?.id ?? '')?.revision).toBe(1);
  });

  it('starts the next step and rewrites the plan at the current revision', async () => {
    const w = world();
    await chiefTool(w, 'createTask').execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];

    const updated = await chiefTool(w, 'updateTask').execute('call-2', {
      taskId: task?.id,
      expectedRevision: 1,
      phase: 'develop',
      summary: 'plan fixed',
      changes: { planMarkdown: '# revised plan\n', expectedPlanVersion: task?.planRef?.sha256 },
    });

    expect(updated.isError).toBe(false);
    expect(updated.details['phase']).toBe('develop');
    expect(updated.details['planState']).toBe('saved');
    expect(readFileSync(task?.planRef?.path ?? '', 'utf8')).toBe('# revised plan\n');
  });

  it('refuses a revision that no longer matches the file on disk', async () => {
    const w = world();
    await chiefTool(w, 'createTask').execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];

    const mismatch = await chiefTool(w, 'updateTask').execute('call-2', {
      taskId: task?.id,
      expectedRevision: 1,
      changes: { planMarkdown: '# revised\n', expectedPlanVersion: 'not-the-current-version' },
    });

    expect(mismatch.isError).toBe(true);
    expect(mismatch.details['code']).toBe('VERSION_CONFLICT');
  });

  it('refuses a Task coordinated by another session', async () => {
    const w = world();
    await chiefTool(w, 'createTask').execute('call-1', createArgs());
    const task = w.store.listTasks(w.projectId)[0];
    w.store.createSession({ id: 'c-2', projectId: w.projectId, roleId: 'chief', cwd: w.cwd });
    const secondChief = createChiefTaskTools(() => ({
      store: w.store,
      sessionId: 'c-2',
      projectId: w.projectId,
      cwd: w.cwd,
      roleId: 'chief',
      inputId: 'i-9',
      serverWorkDir: w.serverWorkDir,
    }));

    const result = await tool(secondChief, 'updateTask').execute('call-2', {
      taskId: task?.id,
      expectedRevision: 1,
      phase: 'develop',
    });

    expect(result.isError).toBe(true);
    expect(result.details['code']).toBe('FORBIDDEN');
    expect(w.store.getTask(task?.id ?? '')?.phase).toBe('plan');
  });
});

describe('task.get tool', () => {
  it('resolves the current Task without an id and reports the plan text', async () => {
    const w = world();
    await chiefTool(w, 'createTask').execute('call-1', createArgs());

    const read = await chiefTool(w, 'task').execute('call-2', {});

    expect(read.isError).toBe(false);
    const task = read.details['task'] as { taskId?: string };
    expect(task.taskId).toBe(w.store.listTasks(w.projectId)[0]?.id);
    expect(read.details['planText']).toBe('# original plan\n');
    expect(read.details['planCurrent']).toBe(true);
  });

  it('says so when the session has no Task yet', async () => {
    const w = world();

    const read = await chiefTool(w, 'task').execute('call-1', {});

    expect(read.isError).toBe(true);
    expect(read.details['code']).toBe('NOT_FOUND');
  });

  it('does not expose another project through a specialist reader', async () => {
    const owner = world();
    await tool(owner.tools, 'createTask').execute('call-1', createArgs());
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

    const read = await reader.execute('call-2', { taskId: task?.id });

    expect(read.isError).toBe(true);
    expect(read.details['code']).toBe('NOT_FOUND');
  });
});