/**
 * WP-12 T4c integration: the Inbox over the real daemon.
 *
 * The daemon is the real `WorkbenchProtocol` over real SQLite and the real Core
 * services (`test/helpers.ts`), so both Inbox entry kinds are exercised at the point
 * where the browser reads them:
 *
 * - a `product` decision's question is the markdown body of the `kind=decision`
 *   Artifact its `targetRef` names, resolved through the documented preview endpoint
 *   (`protocol.md` §6);
 * - a `permission` decision parks a Run, and the page names that Run while stating
 *   the operation and targets the daemon did not report (`protocol.md` §4);
 * - `permission.respond` is forwarded as a write (Origin gate) and its protocol error
 *   code reaches the browser unchanged (`protocol.md` §1/§7).
 */
import type { Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Broker, GrantStore, ToolGrantService } from '@agentdev/core';
import type { JsonObject } from '@agentdev/contracts';
import { sha256 } from '@agentdev/storage';
import { createToolHandler } from '../../daemon/src/tool-handler.js';
import { createWebApp } from '../src/app.js';
import { WebSessionStore } from '../src/sessions.js';
import { seedRun, seedWork, startTestDaemon, uuid, type TestDaemon } from './helpers.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';

describe('Inbox requests over the real daemon (WP-12 T4c, AC-074)', () => {
  let daemon: TestDaemon;
  let web: Server;
  let baseUrl: string;
  let cookie: string;
  let csrfToken: string;
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'agentdev-web-inbox-'));
    daemon = await startTestDaemon({ webOrigin: WEB_ORIGIN, projectRoot });
    const app = createWebApp({
      daemon: {
        baseUrl: daemon.baseUrl,
        origin: WEB_ORIGIN,
        bearer: daemon.installationToken,
      },
      auth: daemon.auth,
      allowedOrigins: [WEB_ORIGIN],
      sessions: new WebSessionStore(),
      version: '0.0.0-test',
    });
    web = app.server;
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
    const address = web.address();
    if (address === null || typeof address !== 'object') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token: daemon.installationToken }),
    });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    csrfToken = ((await login.json()) as { csrfToken: string }).csrfToken;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await daemon.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const inboxPage = async (): Promise<string> => {
    const response = await fetch(`${baseUrl}/projects/${daemon.projectId}/inbox`, {
      headers: { accept: 'text/html', cookie },
    });
    expect(response.status).toBe(200);
    return response.text();
  };

  interface RpcFrame {
    readonly ok?: boolean;
    readonly result?: Record<string, unknown>;
    readonly error?: { readonly code?: string; readonly message?: string };
  }

  /** One `/rpc` write as the browser sends it (same-origin cookie + CSRF header). */
  const rpc = async (
    method: string,
    params: JsonObject,
    idempotencyKey: string,
  ): Promise<{ readonly status: number; readonly frame: RpcFrame }> => {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: WEB_ORIGIN,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: `w2-${method}-${idempotencyKey}`,
        method,
        params,
        idempotencyKey,
      }),
    });
    return { status: response.status, frame: (await response.json()) as RpcFrame };
  };

  it('renders a product question from its real targetRef Artifact body', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const run = seedRun(daemon, { workId: work.id, role: 'chief' });
    const artifact = daemon.artifacts.createAgent({
      run: { id: run.id, workId: work.id, role: 'chief' },
      kind: 'decision',
      mime: 'text/markdown',
      bytes: Buffer.from('# Product question\n\nShip the smaller change?'),
    });
    const decision = daemon.store.decisions.insert({
      projectId: daemon.projectId,
      workId: work.id,
      kind: 'product',
      targetRef: {
        id: artifact.id,
        version: artifact.artifactVersion,
        hash: artifact.contentHash,
      },
      choices: ['accept', 'decline'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });

    const html = await inboxPage();
    expect(html).toContain(`data-decision="${decision.id}"`);
    expect(html).toContain('data-question-body');
    expect(html).toContain('Ship the smaller change?');
    expect(html).toContain(`data-artifact-ref="${artifact.id}"`);
    expect(html).toContain('data-choice="accept"');
    expect(html).toContain('data-choice="decline"');
  });

  it('names the parked Run and states the binding the daemon did not report', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const run = seedRun(daemon, {
      workId: work.id,
      role: 'backend',
      status: 'waiting_permission',
      stage: 'execute',
    });
    const decision = daemon.store.decisions.insert({
      projectId: daemon.projectId,
      workId: work.id,
      kind: 'permission',
      targetRef: { id: uuid('70'), version: 1, hash: sha256('binding-1') },
      choices: ['approve', 'deny'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });

    const html = await inboxPage();
    expect(html).toContain(`data-decision="${decision.id}"`);
    expect(html).toContain('data-entry="permission"');
    expect(html).toContain(`data-binding-run>${run.id}<`);
    expect(html).toContain('data-binding-raised-by>backend · execute · Waiting for permission<');
    // The daemon's `inbox` result does not carry the bound operation and targets yet,
    // so the page states that instead of offering a blind approval.
    expect(html).toContain('data-binding-missing="true"');
    expect(html).toMatch(/data-permission="approve"[^>]*disabled/u);
  });

  it('forwards permission.respond as a write and keeps the protocol error code', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const decision = daemon.store.decisions.insert({
      projectId: daemon.projectId,
      workId: work.id,
      kind: 'permission',
      targetRef: { id: uuid('71'), version: 1, hash: sha256('binding-2') },
      choices: ['approve', 'deny'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const body = {
      v: 1,
      type: 'request',
      id: 't4c-permission',
      method: 'permission.respond',
      params: { decisionId: decision.id, choice: 'deny' },
      idempotencyKey: `t4c-permission-${decision.id}`,
    };
    const send = (origin: string): Promise<Response> =>
      fetch(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(body),
      });

    // The Origin gate applies before the daemon is reached: it is a write.
    const crossOrigin = await send('http://evil.example');
    expect(crossOrigin.status).toBe(403);
    // The daemon refuses because this test daemon has no tool bridge attached; the
    // real code reaches the browser unchanged instead of an invented success.
    const refused = await send(WEB_ORIGIN);
    const frame = (await refused.json()) as { ok?: boolean; error?: { code?: string } };
    expect(refused.status).toBe(422);
    expect(frame.ok).toBe(false);
    expect(frame.error?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('shows a real sensitive-file refusal as a user todo and keeps it across a retry (W2)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const run = seedRun(daemon, { workId: work.id, role: 'backend' });
    const attempt = daemon.store.attempts.list({ where: 'run_id = ?', params: [run.id] })[0];
    if (attempt === undefined) throw new Error('the seeded Run has no Attempt');
    // The file the agent is refused. Its content must never reach the page: the real
    // handler refuses before the Broker, so no read happens at all.
    writeFileSync(join(projectRoot, '.env'), 'AGENTDEV_TEST_SECRET_MARKER=hunter2\n', 'utf8');

    // The real handler `apps/daemon/src/tool-handler.ts` the tool endpoint calls, over
    // the same real SQLite store the daemon serves. A `read` of `.env` hits the frozen
    // sensitive-file table (附录 A.2), so it is refused and files the todo itself —
    // nothing in this test writes the `chief_action_required` payload by hand.
    const grants = new GrantStore({ store: daemon.store });
    const handler = createToolHandler({
      store: daemon.store,
      broker: new Broker({
        store: daemon.store,
        grants,
        docker: () => ({ available: false, reason: 'no docker in this test' }),
        resolver: { resolve: () => Promise.resolve({ ok: false, reason: 'offline test' }) },
      }),
      artifacts: daemon.artifacts,
      grantService: new ToolGrantService({ store: daemon.store, grants }),
    });
    const readDotEnv = async (): Promise<unknown> =>
      handler
        .execute({
          caller: {
            runId: run.id,
            attemptId: attempt.id,
            epoch: attempt.ownerEpoch,
            role: 'backend',
          },
          request: {
            toolName: 'read',
            args: { path: '.env' },
            toolOperationId: daemon.store.newId(),
            timeoutMs: 120_000,
          },
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

    const refusal = await readDotEnv();
    expect(refusal).toMatchObject({ code: 'CONTEXT_FORBIDDEN' });

    const first = await inboxPage();
    expect(first.match(/data-entry="todo"/gu) ?? []).toHaveLength(1);
    expect(first).toContain('data-todo-kind="sensitive_file"');
    expect(first).toContain('data-todo-action>read<');
    expect(first).toContain('data-todo-path>.env<');
    expect(first).toContain('data-todo-pattern>.env*<');
    expect(first).toContain('data-todo-config-policy>strict<');
    expect(first).toContain(`data-work="${work.id}"`);
    expect(first).toContain(`data-run="${run.id}"`);
    expect(first).toContain('data-todo-raised-by>backend<');
    expect(first).toContain('data-i18n="inbox.todoHandling"');
    // The refused file's content is not on the page (the daemon never read it).
    expect(first).not.toContain('AGENTDEV_TEST_SECRET_MARKER');
    expect(first).not.toContain('hunter2');

    // The model retries the same file: the refusal keeps exactly one todo, and the
    // item is still there rather than being cleared by the retry.
    expect(await readDotEnv()).toMatchObject({ code: 'CONTEXT_FORBIDDEN' });
    const second = await inboxPage();
    expect(second.match(/data-entry="todo"/gu) ?? []).toHaveLength(1);
    expect(second).toContain('data-todo-path>.env<');
    // The card carries both closing actions, keyed by the todo id (`protocol.md` §4).
    const todoId = `${work.id}:.env:.env*`;
    expect(second).toContain(`data-todo="${todoId}"`);
    expect(second).toContain('data-todo-disposition="handled"');
    expect(second).toContain('data-todo-disposition="dismissed"');

    // Closing the todo is a user acknowledgement, not an authorization: it records the
    // closing, mints no Grant, and the Inbox stops listing the row.
    const grantsBefore = daemon.store.grants.list({
      where: 'work_id = ?',
      params: [work.id],
    }).length;
    const closed = await rpc(
      'chief.todo.resolve',
      { workId: work.id, todoId, disposition: 'handled', reason: '已在产品外处理' },
      'w2-todo-close',
    );
    expect(closed.status).toBe(200);
    expect(closed.frame).toMatchObject({
      ok: true,
      result: { status: 'applied', todoId, disposition: 'handled', state: 'resolved' },
    });
    const third = await inboxPage();
    expect(third.match(/data-entry="todo"/gu) ?? []).toHaveLength(0);
    // The closing authorizes nothing: the same call is still refused and no Grant
    // appeared, and the record survives a fresh server read (not a local deletion).
    expect(await readDotEnv()).toMatchObject({ code: 'CONTEXT_FORBIDDEN' });
    expect(daemon.store.grants.list({ where: 'work_id = ?', params: [work.id] }).length).toBe(
      grantsBefore,
    );
    const fourth = await inboxPage();
    expect(fourth.match(/data-entry="todo"/gu) ?? []).toHaveLength(0);

    // A second closing is idempotent and reports the disposition already recorded.
    const replay = await rpc(
      'chief.todo.resolve',
      { workId: work.id, todoId, disposition: 'dismissed' },
      'w2-todo-close-again',
    );
    expect(replay.frame).toMatchObject({
      ok: true,
      result: { disposition: 'handled', idempotent: true },
    });

    // Unknown ids and a todo that belongs to another Work are typed refusals.
    const unknown = await rpc(
      'chief.todo.resolve',
      { workId: work.id, todoId: `${work.id}:.env:nope`, disposition: 'handled' },
      'w2-todo-unknown',
    );
    expect(unknown.status).toBe(404);
    expect(unknown.frame.error?.code).toBe('NOT_FOUND');
    const otherWork = seedWork(daemon, { status: 'running' });
    const foreign = await rpc(
      'chief.todo.resolve',
      { workId: otherWork.id, todoId, disposition: 'handled' },
      'w2-todo-foreign',
    );
    expect(foreign.status).toBe(404);
    expect(foreign.frame.error?.code).toBe('NOT_FOUND');

    // It is a write: the Origin gate applies before the daemon is reached.
    const crossOrigin = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'http://evil.example',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: 'w2-todo-cross',
        method: 'chief.todo.resolve',
        params: { workId: work.id, todoId, disposition: 'handled' },
        idempotencyKey: 'w2-todo-cross',
      }),
    });
    expect(crossOrigin.status).toBe(403);
  });
});
