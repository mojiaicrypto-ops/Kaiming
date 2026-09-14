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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '@agentdev/storage';
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
});
