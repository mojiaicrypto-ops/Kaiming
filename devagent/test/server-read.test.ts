import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { AuthService, CSRF_HEADER, SESSION_COOKIE } from '../src/server/auth.ts';
import { RpcRouter } from '../src/server/rpc.ts';
import { createWorkbenchServer } from '../src/server/http.ts';
import { registerCoreMethods } from '../src/server/methods.ts';
import { registerReadMethods } from '../src/server/read-methods.ts';
import { digestOfText } from '../src/runtime/plan-store.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'read-surface-secret';
const PROPOSAL = `---
schemaVersion: 2
id: req-reset
kind: proposal
title: 密码重置
status: pending
createdAt: "2026-10-04T00:00:00Z"
updatedAt: "2026-10-04T00:00:00Z"
---

## 目标
允许用户重置密码。
`;

interface Harness {
  readonly origin: string;
  readonly store: Store;
  readonly projectRoot: string;
  readonly projectId: string;
  readonly cookie: string;
  readonly csrf: string;
  call(method: string, params?: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
}

async function harness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-read-'));
  const projectRoot = join(root, 'project');
  mkdirSync(join(projectRoot, '.dev', 'requirements'), { recursive: true });
  writeFileSync(join(projectRoot, 'AGENTS.md'), '# project rules\n');
  writeFileSync(join(projectRoot, '.dev', 'INDEX.md'), '# index\n');
  writeFileSync(join(projectRoot, '.dev', 'PROJECT.md'), '# project\n');
  writeFileSync(join(projectRoot, '.dev', 'requirements', 'req-reset.md'), PROPOSAL);
  writeFileSync(join(projectRoot, '.dev', 'requirements', 'req-broken.md'), '# not a record\n');
  writeFileSync(join(projectRoot, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(root, 'outside.txt'), 'TOP_SECRET');
  symlinkSync(join(root, 'outside.txt'), join(projectRoot, 'escape.txt'));

  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  const projectId = 'p-1';
  // realpath is the identity: the fixture registers the canonical path, exactly like project.open does.
  const canonicalRoot = realpathSync(projectRoot);
  store.createProject({ id: projectId, realPath: canonicalRoot });
  store.createSession({ id: 's-chief', projectId, roleId: 'chief', cwd: canonicalRoot });
  store.acceptInput({
    inputId: 'i-user',
    projectId,
    sessionId: 's-chief',
    sourceKey: 's-chief:i-user',
    requestKey: 'i-user',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: '先讨论，不开始开发' }] },
  });
  // A write Task with one member, one recorded report and one interrupted input.
  const task = store.createTask({
    id: 't-1',
    projectId,
    chiefSessionId: 's-chief',
    ownerEpoch: 1,
    type: 'write',
    requiresTest: false,
    goal: 'reset password',
    scope: 'account',
    acceptanceRefs: [],
    basisRefs: [],
    planRef: { storage: 'project', path: join(projectRoot, '.dev', 'work', 't-1', 'plan.md'), sha256: 'plan' },
    authorizationRefs: ['input:i-user'],
    sourceInputId: 'i-user',
  });
  store.updateTask({ taskId: task.id, expectedRevision: task.revision, phase: 'develop' });
  store.createTaskSessions({
    taskId: task.id,
    members: [
      {
        sessionId: 's-dev',
        taskId: task.id,
        roleId: 'developer',
        phase: 'develop',
        label: 'implement',
        instructions: 'implement it',
        refs: [],
        dependencies: [],
        expectedKind: 'implementation',
        inputId: 'i-dev',
        inputPayload: { content: [{ type: 'text', text: 'implement it' }] },
      },
    ],
  });
  const reportPath = join(projectRoot, '.dev', 'work', 't-1', 's-dev', 'r-1.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, '# implementation\n\nreset flow done\n');
  store.recordResult({
    resultId: 'r-1',
    taskId: task.id,
    sessionId: 's-dev',
    inputId: 'i-dev',
    roleId: 'developer',
    kind: 'implementation',
    summary: 'implemented',
    bodyRef: { storage: 'project', path: reportPath, sha256: digestOfText('# implementation\n\nreset flow done\n') },
    basisRefs: [],
    checks: [],
  });
  // An interrupted input blocks the session until it is verified.
  store.acceptInput({
    inputId: 'i-broken',
    projectId,
    sessionId: 's-dev',
    // It belongs to the running Task: work outside the current Task waits (R3).
    taskId: task.id,
    sourceKey: 's-dev:i-broken',
    requestKey: 'i-broken',
    method: 'task.session',
    kind: 'continuation',
    payload: { content: [{ type: 'text', text: 'again' }] },
  });
  const first = store.claimNextInput('s-dev');
  if (first.kind !== 'claimed') {
    throw new Error('the member input could not be claimed');
  }
  store.finishInput({ inputId: first.input.inputId, expectedRevision: first.input.revision, status: 'completed' });
  const claimed = store.claimNextInput('s-dev');
  if (claimed.kind !== 'claimed') {
    throw new Error('the second member input could not be claimed');
  }
  store.finishInput({
    inputId: claimed.input.inputId,
    expectedRevision: claimed.input.revision,
    status: 'interrupted',
    errorCode: 'HOST_SAVE_FAILED',
    errorMessage: 'the boundary could not be confirmed',
  });
  // A Pi history file with a marker, two messages, and a broken line.
  const piFile = join(root, 'sessions', 's-chief.jsonl');
  mkdirSync(dirname(piFile), { recursive: true });
  writeFileSync(
    piFile,
    [
      JSON.stringify({ type: 'session', id: 'h-1', version: 3, timestamp: 't', cwd: projectRoot }),
      JSON.stringify({
        type: 'custom',
        id: 'm-1',
        customType: 'agentdev.input-marker',
        data: { inputId: 'i-user', requestDigest: 'digest-1' },
      }),
      JSON.stringify({ type: 'message', id: 'u-1', message: { role: 'user', content: '先讨论' }, timestamp: 't1' }),
      JSON.stringify({ type: 'message', id: 'a-1', message: { role: 'assistant', content: '好的' }, timestamp: 't2' }),
      '{broken',
    ].join('\n') + '\n',
  );
  store.recordSessionBinding({ sessionId: 's-chief', piFile, hasHistory: true, configHash: 'cfg' });

  const auth = new AuthService({ accessPassword: PASSWORD });
  const router = new RpcRouter();
  registerCoreMethods(router, {
    store,
    server: { model: { providerId: 'stub', modelId: 'stub-1' }, agentDir: root, promptDir: root, tools: [] },
  });
  registerReadMethods(router, { store });
  const workbench = createWorkbenchServer({ store, auth, router });
  const { origin } = await workbench.listen(0);
  cleanups.push(async () => {
    await workbench.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const login = await fetch(`${origin}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'auth.login', params: { password: PASSWORD } }),
  });
  const setCookie = login.headers.get('set-cookie') ?? '';
  const cookie = /agentdev_session=([0-9a-f]+)/.exec(setCookie)?.[1] ?? '';
  const csrf = String(((await login.json()) as { result: { csrfToken: string } }).result.csrfToken);
  return {
    origin,
    store,
    projectRoot,
    projectId,
    cookie,
    csrf,
    async call(method, params = {}) {
      const response = await fetch(`${origin}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${cookie}`, [CSRF_HEADER]: csrf },
        body: JSON.stringify({ requestId: `req-${method}-${Math.random().toString(16).slice(2)}`, method, params }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

const errorCode = (body: Record<string, unknown>): string => (body['error'] as { code: string }).code;
const resultOf = <T>(body: Record<string, unknown>): T => body['result'] as T;

describe('read-only query surface', () => {
  it('requires a session for every read method', async () => {
    const h = await harness();
    const response = await fetch(`${h.origin}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'task.list', params: { projectId: h.projectId } }),
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('opens the same directory as one project, reports entry gaps, and refuses a missing directory', async () => {
    const h = await harness();

    const existing = await h.call('project.open', { path: h.projectRoot });
    expect(resultOf<{ opened: string; project: { projectId: string; entries: Array<{ path: string; present: boolean }> } }>(existing.body).opened).toBe('existing');
    const entries = resultOf<{ project: { entries: Array<{ path: string; present: boolean }> } }>(existing.body).project.entries;
    expect(entries.map((entry) => `${entry.path}:${entry.present}`)).toEqual([
      'AGENTS.md:true',
      '.dev/INDEX.md:true',
      '.dev/PROJECT.md:true',
    ]);

    const fresh = join(h.projectRoot, '..', 'fresh-project');
    mkdirSync(fresh, { recursive: true });
    const registered = await h.call('project.open', { path: fresh });
    expect(resultOf<{ opened: string }>(registered.body).opened).toBe('registered');
    expect(existsSync(join(fresh, '.dev'))).toBe(false);

    const missing = await h.call('project.open', { path: join(h.projectRoot, 'nope') });
    expect(missing.status).toBe(503);
    expect(errorCode(missing.body)).toBe('PROJECT_UNAVAILABLE');
  });

  it('reports a project whose directory disappeared instead of pretending it is fine', async () => {
    const h = await harness();
    h.store.createProject({ id: 'p-gone', realPath: join(h.projectRoot, '..', 'gone') });

    const response = await h.call('project.get', { projectId: 'p-gone' });

    expect(response.status).toBe(200);
    const project = resultOf<{ project: { directoryExists: boolean; problem?: string } }>(response.body).project;
    expect(project.directoryExists).toBe(false);
    expect(project.problem).toContain('rebind');
  });

  it('creates and reads a chief session without a model', async () => {
    const h = await harness();

    const created = await h.call('session.create', { projectId: h.projectId });

    expect(created.status).toBe(200);
    const session = resultOf<{ session: { sessionId: string; roleId: string; activity: string } }>(created.body).session;
    expect(session.roleId).toBe('chief');
    const read = await h.call('session.get', { projectId: h.projectId, sessionId: session.sessionId });
    expect(resultOf<{ session: { sessionId: string } }>(read.body).session.sessionId).toBe(session.sessionId);

    // The seeded chief session holds a queued input and a Task.
    const chief = await h.call('session.get', { projectId: h.projectId, sessionId: 's-chief' });
    const chiefResult = resultOf<{ session: { activity: string; queuedInputs: number; task: { taskId: string } | null } }>(chief.body).session;
    expect(chiefResult.queuedInputs).toBe(1);
    expect(chiefResult.task?.taskId).toBe('t-1');

    const unknown = await h.call('session.get', { projectId: h.projectId, sessionId: 's-nope' });
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown.body)).toBe('NOT_FOUND');
  });

  it('lists history with input correlation and pages it by entry id', async () => {
    const h = await harness();

    const first = await h.call('session.messages.list', { projectId: h.projectId, sessionId: 's-chief', limit: 1 });

    expect(first.status).toBe(200);
    const page = resultOf<{
      messages: Array<{ entryId: string; role: string; inputId: string | null; inputStatus: string | null }>;
      nextCursor: string | null;
      correlation: { markers: number; uncorrelated: number };
      problems: string[];
    }>(first.body);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ entryId: 'u-1', role: 'user', inputId: 'i-user', inputStatus: 'queued' });
    expect(page.nextCursor).toBe('u-1');
    // The broken line is reported, not hidden, and the marker correlates the messages.
    expect(page.problems.join(' ')).toContain('line 5');
    expect(page.correlation).toEqual({ markers: 1, uncorrelated: 0 });

    const second = await h.call('session.messages.list', {
      projectId: h.projectId,
      sessionId: 's-chief',
      limit: 1,
      cursor: page.nextCursor,
    });
    expect(resultOf<{ messages: Array<{ entryId: string }> }>(second.body).messages.map((entry) => entry.entryId)).toEqual(['a-1']);

    const badCursor = await h.call('session.messages.list', {
      projectId: h.projectId,
      sessionId: 's-chief',
      cursor: 'not-an-entry',
    });
    expect(badCursor.status).toBe(400);
    expect(errorCode(badCursor.body)).toBe('INVALID_ARGUMENT');
  });

  it('tells a session with no history apart from one whose history file is missing', async () => {
    const h = await harness();
    const created = await h.call('session.create', { projectId: h.projectId });
    const fresh = resultOf<{ session: { sessionId: string } }>(created.body).session.sessionId;

    const empty = await h.call('session.messages.list', { projectId: h.projectId, sessionId: fresh });

    expect(empty.status).toBe(200);
    expect(resultOf<{ messages: unknown[] }>(empty.body).messages).toEqual([]);

    rmSync(join(h.projectRoot, '..', 'sessions', 's-chief.jsonl'));
    const missing = await h.call('session.messages.list', { projectId: h.projectId, sessionId: 's-chief' });
    // A bound-but-missing history is a record conflict (R6: keep the record, inspect), not an outage.
    expect(missing.status).toBe(409);
    expect(errorCode(missing.body)).toBe('HISTORY_UNAVAILABLE');
  });

  it('reads one input with its original content, boundary and stop facts', async () => {
    const h = await harness();

    const response = await h.call('session.input.get', { projectId: h.projectId, sessionId: 's-chief', inputId: 'i-user' });

    expect(response.status).toBe(200);
    const input = resultOf<{ input: { status: string; payload: unknown; boundary: unknown } }>(response.body).input;
    expect(input.status).toBe('queued');
    expect(JSON.stringify(input.payload)).toContain('先讨论');
    expect(input.boundary).toBeNull();

    const wrongSession = await h.call('session.input.get', { projectId: h.projectId, sessionId: 's-dev', inputId: 'i-user' });
    expect(wrongSession.status).toBe(404);
  });

  it('lists Tasks, reads one with its members and results, and refuses a foreign Task', async () => {
    const h = await harness();

    const list = await h.call('task.list', { projectId: h.projectId });
    expect(resultOf<{ tasks: Array<{ taskId: string }> }>(list.body).tasks.map((task) => task.taskId)).toEqual(['t-1']);

    const detail = await h.call('task.get', { projectId: h.projectId, taskId: 't-1' });
    const task = resultOf<{
      task: { phase: string; status: string };
      members: Array<{ sessionId: string; expectedKind: string }>;
      results: Array<{ resultId: string; kind: string; version: string }>;
    }>(detail.body);
    expect(task.task).toMatchObject({ phase: 'develop', status: 'active' });
    expect(task.members).toHaveLength(1);
    expect(task.members[0]).toMatchObject({ sessionId: 's-dev', expectedKind: 'implementation' });
    expect(task.results.map((entry) => entry.resultId)).toEqual(['r-1']);

    h.store.createProject({ id: 'p-other', realPath: join(h.projectRoot, '..', 'other') });
    const foreign = await h.call('task.get', { projectId: 'p-other', taskId: 't-1' });
    expect(foreign.status).toBe(404);
  });

  it('returns a report body with its version and reports a changed body as stale', async () => {
    const h = await harness();

    const response = await h.call('task.report.get', { projectId: h.projectId, taskId: 't-1', resultId: 'r-1' });
    expect(response.status).toBe(200);
    const report = resultOf<{ text: string; version: string; result: { kind: string } }>(response.body);
    expect(report.text).toContain('reset flow done');
    expect(report.result.kind).toBe('implementation');

    writeFileSync(join(h.projectRoot, '.dev', 'work', 't-1', 's-dev', 'r-1.md'), '# edited by hand\n');
    const stale = await h.call('task.report.get', { projectId: h.projectId, taskId: 't-1', resultId: 'r-1' });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('REPORT_STALE');
  });

  it('lists requirements with invalid files reported and reads one record by id', async () => {
    const h = await harness();

    const list = await h.call('requirement.list', { projectId: h.projectId });
    expect(resultOf<{ items: Array<{ id: string }> }>(list.body).items.map((item) => item.id)).toEqual(['req-reset']);
    expect(resultOf<{ invalidFiles: Array<{ file: string }> }>(list.body).invalidFiles.map((entry) => entry.file)).toEqual([
      'req-broken.md',
    ]);

    const one = await h.call('requirement.get', { projectId: h.projectId, requirementId: 'req-reset' });
    expect(resultOf<{ metadata: { kind: string } }>(one.body).metadata.kind).toBe('proposal');

    const broken = await h.call('requirement.get', { projectId: h.projectId, requirementId: 'req-broken' });
    expect(broken.status).toBe(200);
    expect(resultOf<{ issues: string[] }>(broken.body).issues.length).toBeGreaterThan(0);
  });

  it('lists and reads project files without escaping the project', async () => {
    const h = await harness();

    const list = await h.call('project.files.list', { projectId: h.projectId });
    const names = resultOf<{ entries: Array<{ name: string; type: string }> }>(list.body).entries.map((entry) => entry.name);
    expect(names).toContain('AGENTS.md');
    expect(names).toContain('.dev');

    const read = await h.call('project.files.read', { projectId: h.projectId, path: 'AGENTS.md' });
    expect(read.status).toBe(200);
    expect(resultOf<{ text: string; version: string }>(read.body).text).toBe('# project rules\n');

    const stale = await h.call('project.files.read', {
      projectId: h.projectId,
      path: 'AGENTS.md',
      expectedVersion: 'deadbeef',
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('VERSION_CONFLICT');

    const binary = await h.call('project.files.read', { projectId: h.projectId, path: 'binary.dat' });
    expect(resultOf<{ binary: boolean; text: string | null }>(binary.body)).toMatchObject({ binary: true, text: null });

    const escape = await h.call('project.files.read', { projectId: h.projectId, path: '../outside.txt' });
    expect(escape.status).toBe(403);
    const symlink = await h.call('project.files.read', { projectId: h.projectId, path: 'escape.txt' });
    expect(symlink.status).toBe(403);
    expect(errorCode(symlink.body)).toBe('FORBIDDEN');
  });

  it('refuses a requirement id that is not a record name', async () => {
    const h = await harness();
    // A traversal id must never become a path: it is refused before any lookup.
    const escape = await h.call('requirement.get', {
      projectId: h.projectId,
      requirementId: '../../../outside-secret',
    });

    expect(escape.status).toBe(400);
    expect(errorCode(escape.body)).toBe('INVALID_ARGUMENT');
    expect(JSON.stringify(escape.body)).not.toContain('TOP_SECRET');
  });

  it('advances task.list paging with the cursor it returns', async () => {
    const h = await harness();
    // A second Task in the same project (cancelled, so the chief's one-open-Task rule holds).
    h.store.createSession({ id: 's-chief2', projectId: h.projectId, roleId: 'chief', cwd: realpathSync(h.projectRoot) });
    const second = h.store.createTask({
      id: 't-2',
      projectId: h.projectId,
      chiefSessionId: 's-chief2',
      ownerEpoch: 1,
      type: 'read',
      requiresTest: false,
      goal: 'investigate',
      scope: 'account',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'p' },
      authorizationRefs: ['input:i-user'],
      sourceInputId: 'i-user',
    });
    expect(second.id).toBe('t-2');

    const first = await h.call('task.list', { projectId: h.projectId, limit: 1 });
    const page = resultOf<{ tasks: Array<{ taskId: string }>; nextCursor: string | null }>(first.body);
    expect(page.tasks).toHaveLength(1);
    expect(page.nextCursor).toBe(page.tasks[0]?.taskId);

    const next = await h.call('task.list', { projectId: h.projectId, limit: 1, cursor: page.nextCursor ?? undefined });
    expect(resultOf<{ tasks: Array<{ taskId: string }> }>(next.body).tasks.map((task) => task.taskId)).not.toEqual(
      page.tasks.map((task) => task.taskId),
    );

    const bad = await h.call('task.list', { projectId: h.projectId, cursor: 't-nope' });
    expect(bad.status).toBe(400);
  });

  it('treats a bound history that was emptied as unavailable rather than as an empty chat', async () => {
    const h = await harness();
    writeFileSync(join(h.projectRoot, '..', 'sessions', 's-chief.jsonl'), '');

    const response = await h.call('session.messages.list', { projectId: h.projectId, sessionId: 's-chief' });

    expect(response.status).toBe(409);
    expect(errorCode(response.body)).toBe('HISTORY_UNAVAILABLE');
  });

  it('lists symlinks without following them and refuses unknown cursors', async () => {
    const h = await harness();
    writeFileSync(join(h.projectRoot, 'dangling-link'), '');
    rmSync(join(h.projectRoot, 'dangling-link'));
    symlinkSync(join(h.projectRoot, '..', 'missing-target'), join(h.projectRoot, 'dangling-link'));

    const list = await h.call('project.files.list', { projectId: h.projectId, limit: 50 });

    expect(list.status).toBe(200);
    const entries = resultOf<{ entries: Array<{ name: string; type: string; size: number | null }> }>(list.body).entries;
    // A dangling symlink does not break the listing, and an escaping one is not followed.
    expect(entries.find((entry) => entry.name === 'dangling-link')?.type).toBe('symlink');
    expect(entries.find((entry) => entry.name === 'escape.txt')).toMatchObject({ type: 'symlink', size: null });

    const badCursor = await h.call('project.files.list', { projectId: h.projectId, cursor: 'nope' });
    expect(badCursor.status).toBe(400);
  });

  it('inspects recovery facts for a session that has an interrupted input', async () => {
    const h = await harness();

    const response = await h.call('session.recovery.inspect', { projectId: h.projectId, sessionId: 's-dev' });

    expect(response.status).toBe(200);
    const inspected = resultOf<{
      interruptedInputs: Array<{ inputId: string; errorCode: string | null }>;
      binding: { hasHistory: boolean; fileExists: boolean } | null;
      taskId: string | null;
    }>(response.body);
    expect(inspected.interruptedInputs.map((entry) => entry.inputId)).toEqual(['i-broken']);
    expect(inspected.interruptedInputs[0]?.errorCode).toBe('HOST_SAVE_FAILED');
    expect(inspected.taskId).toBe('t-1');
  });

  it('rebinds a project only with a user decision and no work in flight', async () => {
    const h = await harness();
    const moved = join(h.projectRoot, '..', 'moved-project');
    mkdirSync(join(moved, '.dev'), { recursive: true });
    const project = h.store.getProject(h.projectId);

    const noDecision = await h.call('project.rebind', {
      projectId: h.projectId,
      expectedRevision: project?.revision ?? 1,
      path: moved,
    });
    expect(noDecision.status).toBe(403);
    expect(errorCode(noDecision.body)).toBe('FORBIDDEN');

    const busy = await h.call('project.rebind', {
      projectId: h.projectId,
      expectedRevision: project?.revision ?? 1,
      path: moved,
      authorizationRef: { inputId: 'i-user' },
    });
    expect(busy.status).toBe(409);
    expect(errorCode(busy.body)).toBe('WORKSPACE_BUSY');

    // The gaps name the real blockers (the open Task and the unverified member input).
    const gaps = (busy.body['error'] as { details: { gaps: string[] } }).details.gaps.join(' ');
    expect(gaps).toContain('t-1');
    expect(gaps).toContain('i-broken');

    // A project with nothing in flight rebinds, and its sessions follow the new directory.
    const settledRoot = join(h.projectRoot, '..', 'settled');
    mkdirSync(settledRoot, { recursive: true });
    const canonicalSettled = realpathSync(settledRoot);
    h.store.createProject({ id: 'p-settled', realPath: canonicalSettled });
    h.store.createSession({ id: 's-settled', projectId: 'p-settled', roleId: 'chief', cwd: canonicalSettled });
    // The decision must be a real user input of *this* project.
    h.store.acceptInput({
      inputId: 'i-settled',
      projectId: 'p-settled',
      sessionId: 's-settled',
      sourceKey: 's-settled:i-settled',
      requestKey: 'i-settled',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: 'move it' }] },
    });
    const move = h.store.claimNextInput('s-settled');
    if (move.kind === 'claimed') {
      h.store.finishInput({ inputId: move.input.inputId, expectedRevision: move.input.revision, status: 'completed' });
    }
    const target = join(h.projectRoot, '..', 'settled-moved');
    mkdirSync(target, { recursive: true });
    const rebound = await h.call('project.rebind', {
      projectId: 'p-settled',
      expectedRevision: h.store.getProject('p-settled')?.revision ?? 1,
      path: target,
      authorizationRef: { inputId: 'i-settled' },
    });

    expect(rebound.status).toBe(200);
    expect(h.store.getProject('p-settled')?.realPath).toBe(realpathSync(target));
    expect(h.store.getSession('s-settled')?.cwd).toBe(realpathSync(target));
  });
});
