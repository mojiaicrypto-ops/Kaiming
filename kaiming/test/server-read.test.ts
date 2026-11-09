import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
  const root = mkdtempSync(join(tmpdir(), 'kaiming-read-'));
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
  store.updateTask({ taskId: task.id, phase: 'develop' });
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
        customType: 'kaiming.input-marker',
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
  const cookie = /kaiming_session=([0-9a-f]+)/.exec(setCookie)?.[1] ?? '';
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

  it('lists host directories for the picker: names only, real paths, parents, and refusals', async () => {
    const h = await harness();

    // Without a path the listing starts at the process user's home: the natural place to look.
    const home = await h.call('fs.browse', {});
    const homeListing = resultOf<{ path: string; parent: string | null; directories: readonly string[] }>(home.body);
    expect(homeListing.path).toBe(realpathSync(homedir()));
    expect(Array.isArray(homeListing.directories)).toBe(true);

    // A given directory: canonical path, its parent, and directory names only — files never appear.
    const root = realpathSync(join(h.projectRoot, '..'));
    const listed = await h.call('fs.browse', { path: join(h.projectRoot, '..') });
    const listing = resultOf<{ path: string; parent: string | null; directories: readonly string[] }>(listed.body);
    expect(listing.path).toBe(root);
    expect(listing.parent).toBe(dirname(root));
    expect(listing.directories).toContain('project');
    expect(listing.directories).toContain('sessions');
    expect(listing.directories).not.toContain('outside.txt');
    expect(listing.directories).not.toContain('state.db');

    // A symlink to a directory stays navigable: project.open realpaths whatever it is given.
    symlinkSync(h.projectRoot, join(root, 'linked'));
    const withLink = await h.call('fs.browse', { path: root });
    expect(resultOf<{ directories: readonly string[] }>(withLink.body).directories).toContain('linked');

    // Refusals: a path that does not exist, and a path that is a file.
    const missing = await h.call('fs.browse', { path: join(root, 'not-here') });
    expect(missing.status).toBe(404);
    expect(errorCode(missing.body)).toBe('NOT_FOUND');
    const file = await h.call('fs.browse', { path: join(root, 'outside.txt') });
    expect(file.status).toBe(400);
    expect(errorCode(file.body)).toBe('INVALID_ARGUMENT');
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

  it('carries a tool result identity through the paged history', async () => {
    const h = await harness();
    const piFile = join(h.projectRoot, '..', 'sessions', 's-chief.jsonl');
    mkdirSync(dirname(piFile), { recursive: true });
    writeFileSync(
      piFile,
      [
        JSON.stringify({ type: 'session', id: 'h-1', version: 3, timestamp: 't', cwd: h.projectRoot }),
        JSON.stringify({
          type: 'message',
          id: 'r-1',
          message: {
            role: 'toolResult',
            toolCallId: 'call_3',
            toolName: 'question',
            isError: true,
            content: [{ type: 'text', text: 'Error: refused' }],
          },
          timestamp: 't1',
        }),
      ].join('\n') + '\n',
    );
    h.store.recordSessionBinding({ sessionId: 's-chief', piFile, hasHistory: true, configHash: 'cfg' });

    const listed = await h.call('session.messages.list', { projectId: h.projectId, sessionId: 's-chief' });
    const messages = resultOf<{ messages: Array<Record<string, unknown>> }>(listed.body).messages;
    // The same identity the snapshot sends: a consumer can match the result to its call.
    expect(messages[0]).toMatchObject({ role: 'toolResult', toolCallId: 'call_3', toolName: 'question', isError: true });
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
    const tasks = resultOf<{
      tasks: Array<{ taskId: string; createdAt: string; updatedAt: string }>;
    }>(list.body).tasks;
    expect(tasks.map((task) => task.taskId)).toEqual(['t-1']);
    expect(tasks[0]).toMatchObject({
      taskId: 't-1',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const detail = await h.call('task.get', { projectId: h.projectId, taskId: 't-1' });
    const task = resultOf<{
      task: { phase: string; status: string; createdAt: string; updatedAt: string };
      members: Array<{
        sessionId: string;
        expectedKind: string;
        executionStartedAt: string | null;
        executionEndedAt: string | null;
      }>;
      results: Array<{ resultId: string; kind: string; version: string }>;
    }>(detail.body);
    expect(task.task).toMatchObject({
      phase: 'develop',
      status: 'active',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(task.members).toHaveLength(1);
    expect(task.members[0]).toMatchObject({
      sessionId: 's-dev',
      expectedKind: 'implementation',
      executionStartedAt: expect.any(String),
      executionEndedAt: expect.any(String),
    });
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

  it('rebinds a project only when no work is in flight, and only with a verifiable reference', async () => {
    const h = await harness();
    const moved = join(h.projectRoot, '..', 'moved-project');
    mkdirSync(join(moved, '.dev'), { recursive: true });
    const project = h.store.getProject(h.projectId);

    // A browser-initiated rebind needs no cited decision: no model tool exposes this method, so the
    // authenticated request is the decision. A reference that is supplied is still checked.
    const bogus = await h.call('project.rebind', {
      projectId: h.projectId,
      expectedRevision: project?.revision ?? 1,
      path: moved,
      authorizationRef: { inputId: 'i-nope' },
    });
    expect(bogus.status).toBe(403);
    expect(errorCode(bogus.body)).toBe('FORBIDDEN');

    const busy = await h.call('project.rebind', {
      projectId: h.projectId,
      expectedRevision: project?.revision ?? 1,
      path: moved,
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
  it('lists the chief conversations of a project with derived titles, live activity and one request', async () => {
    const h = await harness();
    // A session with no message yet, and one whose first message is too long for a title.
    h.store.createSession({ id: 's-empty', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });
    h.store.createSession({ id: 's-long', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });
    const long = '长'.repeat(80);
    h.store.acceptInput({
      inputId: 'i-long',
      projectId: h.projectId,
      sessionId: 's-long',
      sourceKey: 's-long:i-long',
      requestKey: 'i-long',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: `\n  ${long}  ` }] },
    });

    const listed = await h.call('session.list', { projectId: h.projectId });

    expect(listed.status).toBe(200);
    const body = resultOf<{
      sessions: Array<{
        sessionId: string;
        revision: number;
        title: string | null;
        activity: string;
        lastActivityAt: string | null;
        currentTaskId: string | null;
      }>;
      nextCursor: string | null;
    }>(listed.body);
    const byId = new Map(body.sessions.map((entry) => [entry.sessionId, entry]));
    // The title is the first user message's first non-empty line, cut to 60 code points.
    expect(byId.get('s-chief')?.title).toBe('先讨论，不开始开发');
    // The rail can act on its own rows: cleanup is a compare-and-set on this revision, which the
    // fixture bumped while seeding the Task.
    expect(typeof byId.get('s-chief')?.revision).toBe('number');
    expect(byId.get('s-chief')?.revision).toBeGreaterThanOrEqual(1);
    expect([...(byId.get('s-long')?.title ?? '')]).toHaveLength(61);
    expect(byId.get('s-long')?.title?.endsWith('…')).toBe(true);
    // A session with no input has no title and no activity, and still appears (it is a session).
    expect(byId.get('s-empty')?.title).toBeNull();
    expect(byId.get('s-empty')?.activity).toBe('idle');
    expect(byId.get('s-chief')?.activity).toBe('queued');
    // A Task member works inside its Task: the rail lists the user's conversations, and the member
    // appears under the Task it serves instead of as another chat nobody started.
    expect(body.sessions.map((entry) => entry.sessionId).sort()).toEqual(['s-chief', 's-empty', 's-long']);
    expect(byId.has('s-dev')).toBe(false);
    // Nothing is left out and nothing is opened: the list must not need a model or a stream.
    expect(body.nextCursor).toBeNull();
  });

  it('pages the session list by its own cursor and rejects a foreign one', async () => {
    const h = await harness();
    h.store.createSession({ id: 's-empty', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });
    // The fixture also holds a Task member; it is not a conversation, so the listing has three
    // chief sessions and needs two pages at limit 2.
    h.store.createSession({ id: 's-second', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });

    const first = await h.call('session.list', { projectId: h.projectId, limit: 2 });
    const page = resultOf<{ sessions: Array<{ sessionId: string }>; nextCursor: string | null }>(first.body);
    expect(page.sessions).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const next = await h.call('session.list', { projectId: h.projectId, limit: 2, cursor: page.nextCursor });
    const second = resultOf<{ sessions: Array<{ sessionId: string }>; nextCursor: string | null }>(next.body);
    // Three chief sessions in this fixture (the Task member is not a conversation): the second page
    // holds the last one and ends the listing.
    expect(second.sessions).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.sessions.some((entry) => page.sessions.some((first) => first.sessionId === entry.sessionId))).toBe(false);

    const bad = await h.call('session.list', { projectId: h.projectId, cursor: 'nope|s-1' });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.body)).toBe('INVALID_ARGUMENT');
  });

  it('reports a session that is stopping, with the configuration it is running', async () => {
    const h = await harness();
    h.store.createSession({ id: 's-busy', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });
    h.store.acceptInput({
      inputId: 'i-busy',
      projectId: h.projectId,
      sessionId: 's-busy',
      sourceKey: 's-busy:i-busy',
      requestKey: 'i-busy',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: '开始' }] },
    });
    const claimed = h.store.claimNextInput('s-busy');
    if (claimed.kind !== 'claimed') throw new Error('the input could not be claimed');
    h.store.recordEffectiveConfig({
      inputId: 'i-busy',
      // The recorded shape carries server directories too; the read surface must not show them.
      effectiveConfig: {
        providerId: 'p-a',
        modelId: 'm-1',
        source: 'role',
        agentDir: '/private/server',
        promptDir: '/private/prompts',
      },
    });

    const running = await h.call('session.get', { projectId: h.projectId, sessionId: 's-busy' });
    const runningSession = resultOf<{
      session: { activity: string; stopping: boolean; config: Record<string, unknown> | null };
    }>(running.body).session;
    expect(runningSession.activity).toBe('processing');
    expect(runningSession.stopping).toBe(false);
    expect(runningSession.config).toEqual({ providerId: 'p-a', modelId: 'm-1', source: 'role' });

    h.store.requestStop({ inputId: 'i-busy', requestKey: 'stop-1', reason: 'user asked' });
    const stopping = await h.call('session.get', { projectId: h.projectId, sessionId: 's-busy' });
    const stoppingSession = resultOf<{ session: { activity: string; stopping: boolean } }>(stopping.body).session;
    expect(stoppingSession.activity).toBe('stopping');
    expect(stoppingSession.stopping).toBe(true);

    // The same session seen as a Task member must not have to interpret a different vocabulary.
    const listed = await h.call('session.list', { projectId: h.projectId });
    const row = resultOf<{ sessions: Array<{ sessionId: string; activity: string }> }>(listed.body).sessions.find(
      (entry) => entry.sessionId === 's-busy',
    );
    expect(row?.activity).toBe('stopping');
  });

  it('keeps a project summary bounded and cuts the recorded configuration to its public fields', async () => {
    const h = await harness();
    const project = await h.call('project.get', { projectId: h.projectId });
    expect(Object.keys(resultOf<{ project: Record<string, unknown> }>(project.body).project)).not.toContain('tasks');

    h.store.createSession({ id: 's-cfg', projectId: h.projectId, roleId: 'chief', cwd: h.projectRoot });
    h.store.acceptInput({
      inputId: 'i-cfg',
      projectId: h.projectId,
      sessionId: 's-cfg',
      sourceKey: 's-cfg:i-cfg',
      requestKey: 'i-cfg',
      method: 'session.input.submit',
      kind: 'user',
      payload: { content: [{ type: 'text', text: '跑一下' }] },
    });
    const claimed = h.store.claimNextInput('s-cfg');
    if (claimed.kind !== 'claimed') throw new Error('the input could not be claimed');
    h.store.recordEffectiveConfig({
      inputId: 'i-cfg',
      effectiveConfig: { providerId: 'p-a', modelId: 'm-2', source: 'project', agentDir: '/private/server' },
    });

    const read = await h.call('session.input.get', { projectId: h.projectId, sessionId: 's-cfg', inputId: 'i-cfg' });
    expect(resultOf<{ input: { effectiveConfig: unknown } }>(read.body).input.effectiveConfig).toEqual({
      providerId: 'p-a',
      modelId: 'm-2',
      source: 'project',
    });
  });

  it('lists registered projects with counts, a missing directory and a working cursor', async () => {
    const h = await harness();
    h.store.createProject({ id: 'p-gone', realPath: join(h.projectRoot, '..', 'gone') });

    const listed = await h.call('project.list', {});
    expect(listed.status).toBe(200);
    const projects = resultOf<{
      projects: Array<{
        projectId: string;
        realPath: string;
        directoryExists: boolean;
        sessionCount: number;
        taskCount: number;
        lastActivityAt: string | null;
        problem?: string;
      }>;
      nextCursor: string | null;
    }>(listed.body).projects;
    const mine = projects.find((entry) => entry.projectId === h.projectId);
    expect(mine).toMatchObject({ directoryExists: true, sessionCount: 2, taskCount: 1 });
    expect(mine?.lastActivityAt).not.toBeNull();
    const gone = projects.find((entry) => entry.projectId === 'p-gone');
    expect(gone?.directoryExists).toBe(false);
    expect(gone?.problem).toContain('rebind');
    // Listing is a read: it must not register anything, and it must not need a project id.
    expect(h.store.listProjectSummaries()).toHaveLength(2);

    const first = await h.call('project.list', { limit: 1 });
    const page = resultOf<{ projects: Array<{ projectId: string }>; nextCursor: string | null }>(first.body);
    expect(page.projects).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const second = await h.call('project.list', { limit: 1, cursor: page.nextCursor });
    const next = resultOf<{ projects: Array<{ projectId: string }> }>(second.body);
    expect(next.projects[0]?.projectId).not.toBe(page.projects[0]?.projectId);

    const bad = await h.call('project.list', { cursor: '2020-01-01T00:00:00Z|p-none' });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.body)).toBe('INVALID_ARGUMENT');
  });

  it('walks the history backwards from the oldest message a reader already has', async () => {
    const h = await harness();
    // Four messages on disk: a tail of two can be extended back one page at a time.
    const piFile = join(h.projectRoot, '..', 'sessions', 's-chief.jsonl');
    mkdirSync(dirname(piFile), { recursive: true });
    writeFileSync(
      piFile,
      [
        JSON.stringify({ type: 'session', id: 'h-1', version: 3, timestamp: 't', cwd: h.projectRoot }),
        JSON.stringify({ type: 'message', id: 'u-1', message: { role: 'user', content: 'one' }, timestamp: 't1' }),
        JSON.stringify({ type: 'message', id: 'a-1', message: { role: 'assistant', content: 'two' }, timestamp: 't2' }),
        JSON.stringify({ type: 'message', id: 'u-2', message: { role: 'user', content: 'three' }, timestamp: 't3' }),
        JSON.stringify({ type: 'message', id: 'a-2', message: { role: 'assistant', content: 'four' }, timestamp: 't4' }),
      ].join('\n') + '\n',
    );

    const page = await h.call('session.messages.list', {
      projectId: h.projectId,
      sessionId: 's-chief',
      before: 'u-2',
      limit: 1,
    });
    const read = resultOf<{
      messages: Array<{ entryId: string }>;
      previousCursor: string | null;
      nextCursor: string | null;
    }>(page.body);
    // The page ends *before* the anchor, and the cursor is its own first entry.
    expect(read.messages.map((entry) => entry.entryId)).toEqual(['a-1']);
    expect(read.previousCursor).toBe('a-1');
    expect(read.nextCursor).toBeNull();

    const start = await h.call('session.messages.list', {
      projectId: h.projectId,
      sessionId: 's-chief',
      before: 'a-1',
      limit: 5,
    });
    const first = resultOf<{ messages: Array<{ entryId: string }>; previousCursor: string | null }>(start.body);
    expect(first.messages.map((entry) => entry.entryId)).toEqual(['u-1']);
    // At the beginning of the history there is nothing older to ask for.
    expect(first.previousCursor).toBeNull();

    const both = await h.call('session.messages.list', {
      projectId: h.projectId,
      sessionId: 's-chief',
      cursor: 'u-1',
      before: 'a-1',
    });
    expect(both.status).toBe(400);
    expect(errorCode(both.body)).toBe('INVALID_ARGUMENT');

    const unknown = await h.call('session.messages.list', {
      projectId: h.projectId,
      sessionId: 's-chief',
      before: 'nope',
    });
    expect(unknown.status).toBe(400);
    expect(errorCode(unknown.body)).toBe('INVALID_ARGUMENT');
  });


  it('opens one fixed session per external channel, and says which channel a session belongs to', async () => {
    const h = await harness();
    const first = await h.call('session.open', { projectId: h.projectId, channel: 'mcp' });
    expect(first.status).toBe(200);
    const opened = first.body['result'] as { session: { sessionId: string }; created: boolean };
    expect(opened.created).toBe(true);

    // Two callers asking at the same time still get one session: the unique index decides.
    const raced = await Promise.all([
      h.call('session.open', { projectId: h.projectId, channel: 'race' }),
      h.call('session.open', { projectId: h.projectId, channel: 'race' }),
    ]);
    const racedIds = raced.map((entry) => (entry.body['result'] as { session: { sessionId: string } }).session.sessionId);
    expect(raced.every((entry) => entry.status === 200)).toBe(true);
    expect(new Set(racedIds).size).toBe(1);

    const again = await h.call('session.open', { projectId: h.projectId, channel: 'mcp' });
    const reopened = again.body['result'] as { session: { sessionId: string }; created: boolean };
    expect(reopened.created).toBe(false);
    expect(reopened.session.sessionId).toBe(opened.session.sessionId);

    // A second channel is a second session; the same channel is never a third one.
    const other = await h.call('session.open', { projectId: h.projectId, channel: 'other' });
    expect((other.body['result'] as { session: { sessionId: string } }).session.sessionId).not.toBe(
      opened.session.sessionId,
    );

    // A channel name is a program identity, not free text.
    const refused = await h.call('session.open', { projectId: h.projectId, channel: 'MCP Channel' });
    expect(refused.status).toBe(400);
    expect(errorCode(refused.body)).toBe('INVALID_ARGUMENT');

    // The rail can label the fixed session instead of presenting it as an ordinary chat.
    const list = await h.call('session.list', { projectId: h.projectId });
    const rows = (list.body['result'] as { sessions: Array<{ sessionId: string; channel: string | null }> }).sessions;
    expect(rows.find((row) => row.sessionId === opened.session.sessionId)?.channel).toBe('mcp');
    expect(rows.find((row) => row.sessionId === 's-chief')?.channel).toBeNull();
  });

  it('lists the questions a session is waiting on, without a live subscription', async () => {
    const h = await harness();
    h.store.createInteraction({
      interactionId: 'q-read',
      projectId: h.projectId,
      sessionId: 's-chief',
      inputId: 'i-user',
      method: 'select',
      title: '是否继续？',
      message: '需要你决定',
      options: ['继续', '暂停'],
      requestKey: 'q-read',
    });
    const listed = await h.call('interaction.list', { projectId: h.projectId, sessionId: 's-chief' });
    expect(listed.status).toBe(200);
    const interactions = (listed.body['result'] as { interactions: Array<Record<string, unknown>> }).interactions;
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ interactionId: 'q-read', method: 'select', options: ['继续', '暂停'] });
  });

});
