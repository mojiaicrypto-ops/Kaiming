/**
 * The browser workbench's attachment identity (T-01).
 *
 * This suite boots the **production** `createDaemon` (the real HTTP surface and the
 * real `WorkbenchProtocol`) plus the real BFF, then drives the exact two requests the
 * shipped `app.js` makes: upload through the BFF, then send the first message through
 * the BFF. Nothing here re-implements a daemon route, which is what let T-01 hide:
 * the older fixture owned its own `/rpc` and `/artifacts/upload`, so it could agree
 * with itself while the product derived a per-session owner for the message and the
 * installation owner for the upload.
 *
 * AgentDev is single-user, so every session must resolve to the same installer user.
 * If `createDaemon` derives the message owner from the session id again, the
 * attachment binding fails with `NOT_AUTHORIZED` and the first test below fails.
 */
import type { Server } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ArtifactService,
  AttachmentService,
  AuthService,
  ConfigStore,
  DecisionService,
  DownloadTokenStore,
  EventHub,
  FindingService,
  PlanGateService,
  RequirementContinuation,
  userIdFromSubject,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot } from '@agentdev/storage';
import { createDaemon } from '../../daemon/src/server.js';
import { WorkbenchProtocol } from '../../daemon/src/protocol.js';
import { createWebApp } from '../src/app.js';
import { WebSessionStore } from '../src/sessions.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';
const CONVERSATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5f01';

interface IdentityHarness {
  readonly baseUrl: string;
  readonly daemonUrl: string;
  readonly store: ProjectStore;
  readonly installationToken: string;
  readonly projectRoot: string;
  login(): Promise<{ cookie: string; csrfToken: string }>;
  rpc(
    method: string,
    params: Record<string, unknown>,
    options?: { readonly cookie?: string; readonly idempotencyKey?: string },
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  upload(cookie: string, body: string): Promise<Response>;
  close(): Promise<void>;
}

async function startIdentityHarness(): Promise<IdentityHarness> {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t01-root-')));
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t01-data-')));
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t01-state-')));

  const store = ProjectStore.open({
    dataDir,
    canonicalRoot: projectRoot,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  const projectId = projectIdFromRoot(projectRoot);
  const blobs = new BlobStore({ root: dataDir });
  const auth = AuthService.loadOrCreate({
    stateDir,
    config: { deployment: 'loopback', allowedOrigins: [WEB_ORIGIN] },
  });
  const installationToken = auth.createdToken ?? '';
  if (installationToken === '') throw new Error('no installation token was created');

  const attachments = new AttachmentService({ store, blobs });
  const artifacts = new ArtifactService({ store, blobs });
  const config = ConfigStore.open({ globalDir: stateDir, projectRoot });
  const gates = new PlanGateService({ store, artifacts, blobs });
  const tokens = new DownloadTokenStore();
  const protocol = new WorkbenchProtocol({
    store,
    blobs,
    events: new EventHub({ store }),
    attachments,
    artifacts,
    tokens,
    version: '0.0.0-test',
    config,
    gates,
    decisions: new DecisionService({ store, artifacts }),
    findings: new FindingService({ store, artifacts }),
    requirements: new RequirementContinuation({ store }),
  });

  store.projects.insert({
    id: projectId,
    root: projectRoot,
    gitRoot: projectRoot,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: 'a'.repeat(40),
  });
  store.conversations.insert({
    id: CONVERSATION_ID,
    projectId,
    title: 'chief conversation',
    archived: false,
  });

  // The production daemon: the same `createDaemon` a deployment runs, with the real
  // protocol wired in.
  const daemon = createDaemon({
    projectId,
    store,
    blobs,
    auth,
    attachments,
    artifacts,
    tokens,
    version: '0.0.0-test',
    workbench: protocol,
  });
  await new Promise<void>((resolve) => daemon.listen(0, '127.0.0.1', resolve));
  const daemonAddress = daemon.address();
  if (daemonAddress === null || typeof daemonAddress !== 'object') {
    throw new Error('the daemon has no address');
  }
  const daemonUrl = `http://127.0.0.1:${String(daemonAddress.port)}`;

  const app = createWebApp({
    daemon: { baseUrl: daemonUrl, origin: WEB_ORIGIN, bearer: installationToken },
    auth,
    allowedOrigins: [WEB_ORIGIN],
    sessions: new WebSessionStore(),
    version: '0.0.0-test',
  });
  const web: Server = app.server;
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
  const webAddress = web.address();
  if (webAddress === null || typeof webAddress !== 'object') {
    throw new Error('the BFF has no address');
  }
  const baseUrl = `http://127.0.0.1:${String(webAddress.port)}`;

  return {
    baseUrl,
    daemonUrl,
    store,
    installationToken,
    projectRoot,
    async login() {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
        body: JSON.stringify({ token: installationToken }),
      });
      if (!response.ok) throw new Error(`login failed with ${String(response.status)}`);
      const setCookie = response.headers.get('set-cookie') ?? '';
      const cookie = setCookie.split(';')[0] ?? '';
      const body = (await response.json()) as { csrfToken?: string };
      return { cookie, csrfToken: body.csrfToken ?? '' };
    },
    async rpc(method, params, options = {}) {
      const response = await fetch(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: options.cookie ?? '',
          origin: WEB_ORIGIN,
        },
        body: JSON.stringify({
          v: 1,
          type: 'request',
          id: `t01-${method}-${String(Math.random()).slice(2, 10)}`,
          method,
          projectId,
          params,
          ...(options.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: options.idempotencyKey }),
        }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
    async upload(cookie, body) {
      const form = new FormData();
      form.append('conversationId', CONVERSATION_ID);
      form.append('file', new Blob([body], { type: 'text/markdown' }), 'notes.md');
      return fetch(`${baseUrl}/artifacts/${projectId}/upload`, {
        method: 'POST',
        headers: { origin: WEB_ORIGIN, cookie },
        body: form,
      });
    },
    async close() {
      protocol.closeAll();
      await new Promise<void>((resolve) => web.close(() => resolve()));
      await new Promise<void>((resolve) => daemon.close(() => resolve()));
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

interface FrameError {
  readonly ok?: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: string; readonly message?: string };
}

/** One protocol `result` field as text; `''` for anything that is not a string. */
function text(result: Record<string, unknown> | undefined, key: string): string {
  const found = result?.[key];
  return typeof found === 'string' ? found : '';
}

describe('browser attachment identity (T-01)', () => {
  let harness: IdentityHarness;
  let cookie: string;

  beforeAll(async () => {
    harness = await startIdentityHarness();
    ({ cookie } = await harness.login());
  });

  afterAll(async () => {
    await harness.close();
  });

  it('binds an attachment uploaded through the BFF to a message sent through the BFF (T-01)', async () => {
    // 1. The browser uploads through the BFF, exactly as `app.js` does.
    const uploaded = await harness.upload(cookie, '# notes\n');
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const attachment = (await uploaded.json()) as { attachmentId: string };
    expect(attachment.attachmentId).not.toBe('');
    // The upload is recorded under the installation user, not a per-session one.
    const staged = harness.store.attachments.find(attachment.attachmentId);
    expect(staged?.ownerUserId).toBe(userIdFromSubject('installation:local'));

    // 2. The same browser sends the first message with that attachment, through the
    //    BFF. The owners must agree or this is a 403 `NOT_AUTHORIZED` (T-01).
    const sent = await harness.rpc(
      'conversation.message.send',
      {
        conversationId: CONVERSATION_ID,
        body: '请阅读附件',
        attachmentIds: [attachment.attachmentId],
      },
      { cookie, idempotencyKey: 't01-first-message' },
    );
    const frame = sent.body as FrameError;
    expect(sent.status, JSON.stringify(frame)).toBe(200);
    expect(frame.ok, JSON.stringify(frame.error)).toBe(true);
    const workId = text(frame.result, 'workId');
    expect(workId).not.toBe('');

    // The binding is atomic: the attachment is bound to the message's Work and the
    // user artifact the message created points back at the upload.
    const bound = harness.store.attachments.find(attachment.attachmentId);
    expect(bound?.state).toBe('bound');
    expect(bound?.workId).toBe(workId);
    expect(bound?.boundMessageId).toBe(text(frame.result, 'messageId'));
    const artifacts = harness.store.artifacts.list({
      where: 'work_id = ?',
      params: [workId],
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.origin).toBe('user');
    expect(artifacts[0]?.attachmentId).toBe(attachment.attachmentId);

    // 3. A second conversation without an attachment still works: the identity fix
    //    does not make the attachment path mandatory.
    const plain = await harness.rpc(
      'conversation.message.send',
      { conversationId: CONVERSATION_ID, body: '无需附件', attachmentIds: [] },
      { cookie, idempotencyKey: 't01-plain-message' },
    );
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    expect((plain.body as FrameError).ok).toBe(true);
  });

  it('keeps the daemon installation-Bearer path working for the same attachment flow (T-01)', async () => {
    const form = new FormData();
    form.append('conversationId', CONVERSATION_ID);
    form.append('file', new Blob(['# bearer notes\n'], { type: 'text/markdown' }), 'notes.md');
    const uploaded = await fetch(`${harness.daemonUrl}/artifacts/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${harness.installationToken}` },
      body: form,
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const attachment = (await uploaded.json()) as { attachmentId: string };

    const sent = await fetch(`${harness.daemonUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${harness.installationToken}`,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: 't01-bearer-send',
        method: 'conversation.message.send',
        projectId: harness.store.projectId,
        params: {
          conversationId: CONVERSATION_ID,
          body: '通过安装凭据发送',
          attachmentIds: [attachment.attachmentId],
        },
        idempotencyKey: 't01-bearer-message',
      }),
    });
    expect(sent.status, await sent.clone().text()).toBe(200);
    const frame = (await sent.json()) as FrameError;
    expect(frame.ok, JSON.stringify(frame.error)).toBe(true);
    expect(harness.store.attachments.find(attachment.attachmentId)?.state).toBe('bound');
  });

  it('derives the same owner from two different browser sessions (T-01/T-03)', async () => {
    const first = await harness.login();
    const second = await harness.login();
    expect(first.cookie).not.toBe(second.cookie);
    // An upload made by one session is bindable from the other: the owner identity is
    // the installation's, so a second browser (or a re-login) never loses it.
    const uploaded = await harness.upload(first.cookie, '# cross-session\n');
    expect(uploaded.status).toBe(201);
    const attachment = (await uploaded.json()) as { attachmentId: string };
    const sent = await harness.rpc(
      'conversation.message.send',
      {
        conversationId: CONVERSATION_ID,
        body: '另一个会话发送',
        attachmentIds: [attachment.attachmentId],
      },
      { cookie: second.cookie, idempotencyKey: 't01-cross-session' },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect((sent.body as FrameError).ok).toBe(true);
    expect(harness.store.attachments.find(attachment.attachmentId)?.state).toBe('bound');
  });
});
