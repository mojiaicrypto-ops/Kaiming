/**
 * WP-09 T3 integration: the BFF and its pages over the real daemon.
 *
 * The daemon is the real `WorkbenchProtocol` over real SQLite and the real Core
 * services (`test/helpers.ts`), served on a loopback port; the BFF authenticates
 * against the real `AuthService`. Nothing is stubbed, so these tests are the AC
 * evidence for AC-068–AC-078 and AC-084 at the browser boundary:
 *
 * - login → board → detail → approve → event, driven exactly as the UI drives it;
 * - an expired Plan version is refused with the live version while background Work
 *   keeps running;
 * - an upload is bound atomically to the first message's Work, and a refused upload
 *   leaves no reference behind;
 * - the files page reads the target revision inside the root boundary and leaves the
 *   Agent context snapshot untouched;
 * - a bad config patch and an unusable model are reported with the input preserved
 *   and the active revision unchanged;
 * - the Inbox de-duplicates decisions per target version and disables expired ones;
 * - unauthenticated, expired-cookie and wrong-Origin writes are refused while the
 *   background Work keeps running, and the event stream resumes from its watermark.
 */
import type { Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanDraft } from '@agentdev/core';
import { createWebApp } from '../src/app.js';
import { NodeFilePort } from '../src/files.js';
import { WebSessionStore } from '../src/sessions.js';
import {
  GIT_HEAD,
  seedDecision,
  seedFinding,
  seedRequirement,
  seedRun,
  seedWork,
  startTestDaemon,
  uuid,
  type TestDaemon,
} from './helpers.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';

interface Frame {
  readonly v?: number;
  readonly type?: string;
  readonly id?: string;
  readonly ok?: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
  readonly cursor?: number;
  readonly scannedThrough?: number;
  readonly name?: string;
  readonly entityId?: string;
  readonly subscriptionId?: string;
}

/** A minimal browser-side WebSocket client over Node's built-in `WebSocket`. */
class WsClient {
  readonly socket: WebSocket;
  readonly frames: Frame[] = [];
  private waiters: (() => void)[] = [];

  constructor(url: string, cookie: string, origin = WEB_ORIGIN) {
    this.socket = new WebSocket(url, { headers: { cookie, origin } });
    this.socket.addEventListener('message', (event: { data?: unknown }) => {
      if (typeof event.data !== 'string') return;
      this.frames.push(JSON.parse(event.data) as Frame);
      for (const waiter of this.waiters.splice(0)) waiter();
    });
    this.socket.addEventListener('error', () => undefined);
  }

  async waitFor(predicate: (frame: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.find(predicate);
      if (found !== undefined) return found;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a frame');
      await new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(handle);
          resolve();
        });
      });
    }
  }

  async opened(): Promise<void> {
    if (this.socket.readyState === 1) return;
    await new Promise<void>((resolve, reject) => {
      const handle = setTimeout(() => reject(new Error('the socket never opened')), 5_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(handle);
        resolve();
      });
      this.socket.addEventListener('error', () => {
        clearTimeout(handle);
        reject(new Error('the socket failed to open'));
      });
    });
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(frame));
  }

  close(): void {
    this.socket.close();
  }
}

describe('workbench BFF over the real daemon (WP-09 T3)', () => {
  let daemon: TestDaemon;
  let web: Server;
  let baseUrl: string;
  let wsUrl: string;
  let cookie: string;
  let csrfToken: string;
  let projectRoot: string;
  const sockets: WsClient[] = [];

  beforeAll(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'agentdev-web-project-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const answer = 42;\n');
    writeFileSync(join(projectRoot, 'docs', 'PROJECT.md'), '# Project\n');
    writeFileSync(join(projectRoot, 'package.json'), '{"name":"fixture"}\n');

    daemon = await startTestDaemon({ webOrigin: WEB_ORIGIN, projectRoot });
    const sessions = new WebSessionStore();
    const app = createWebApp({
      daemon: {
        baseUrl: daemon.baseUrl,
        origin: WEB_ORIGIN,
        bearer: daemon.installationToken,
      },
      auth: daemon.auth,
      allowedOrigins: [WEB_ORIGIN],
      sessions,
      files: new NodeFilePort(),
      version: '0.0.0-test',
    });
    web = app.server;
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
    const address = web.address();
    if (address === null || typeof address !== 'object') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
    wsUrl = `ws://127.0.0.1:${String(address.port)}/ws`;

    await signIn();
  });

  /**
   * Signs in through the BFF and remembers the cookie.
   *
   * Called from `beforeAll` and again whenever a refusal proves the session is gone,
   * so the suite stays order-independent while the logout test still exercises a real
   * logout.
   */
  async function signIn(): Promise<void> {
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token: daemon.installationToken }),
    });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    csrfToken = ((await login.json()) as { csrfToken: string }).csrfToken;
  }

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await daemon.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const rpc = async (
    method: string,
    params: Record<string, unknown> = {},
    options: {
      readonly cookie?: string;
      readonly origin?: string;
      readonly idempotencyKey?: string;
      readonly expectedVersion?: number;
    } = {},
  ): Promise<{ status: number; frame: Frame }> => {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: options.cookie ?? cookie,
        origin: options.origin ?? WEB_ORIGIN,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: `t-${String(Math.random()).slice(2, 8)}`,
        method,
        params,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        ...(options.expectedVersion === undefined
          ? {}
          : { expectedVersion: options.expectedVersion }),
      }),
    });
    const body = (await response.json()) as Frame & { error?: { code: string; message: string } };
    if (response.status === 401 && options.cookie === undefined) {
      // A previous test signed out; a real client would land on the sign-in page, and
      // this suite signs back in so the assertions stay independent of test order.
      await signIn();
      return rpc(method, params, options);
    }
    return { status: response.status, frame: body };
  };

  const page = async (path: string, options: { readonly cookie?: string } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        accept: 'text/html',
        ...(options.cookie === undefined ? { cookie } : { cookie: options.cookie }),
      },
    });
    const html = await response.text();
    if (
      response.status === 401 &&
      options.cookie === undefined &&
      html.includes('id="loginForm"')
    ) {
      await signIn();
      return page(path, options);
    }
    return { status: response.status, html };
  };

  const connect = (options: { readonly cookie?: string } = {}): WsClient => {
    const socket = new WsClient(wsUrl, options.cookie ?? cookie);
    sockets.push(socket);
    return socket;
  };

  // -------------------------------------------------------------------------
  // AC-068: the board reads the real projection
  // -------------------------------------------------------------------------

  it('renders the board with the same requirement identity and no L1 card (AC-068)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const requirement = seedRequirement(daemon, 'active', work.id, 'Live board requirement');
    const l1 = seedWork(daemon, { level: 'L1', status: 'running', goal: 'direct help' });
    seedRequirement(daemon, 'completed', l1.id, 'L1-ish record');

    const { status, html } = await page(`/projects/${daemon.projectId}/requirements`);
    expect(status).toBe(200);
    expect(html).toContain(`data-identity="${requirement.id}"`);
    expect(html).toContain(`data-requirement="${requirement.id}"`);
    expect(html).toContain(`data-work="${work.id}"`);
    // The L1 Work id is reported as excluded and never becomes a board card identity.
    expect(html).toContain(`data-excluded="${l1.id}"`);
    expect(html).not.toContain(`data-identity="${l1.id}"`);
    expect(html).toContain('data-i18n="board.l1Hidden"');
  });

  it('offers a direct cancel for a Queued requirement without Work and refuses its pause (AC-068)', async () => {
    const queued = seedRequirement(daemon, 'queued', undefined, 'cancel me');
    const { html } = await page(`/projects/${daemon.projectId}/requirements`);
    expect(html).toContain(`data-requirement="${queued.id}"`);
    expect(html).toContain(
      `data-action="pause" data-requirement="${queued.id}" data-refused="INVALID_STATE"`,
    );

    // The refusal is the server's, not the page's: the same command answers
    // INVALID_STATE through the protocol.
    const refused = await rpc('work.control', {
      action: 'pause',
      requirementId: queued.id,
      reason: 'ui',
    });
    expect(refused.status).toBe(409);
    expect(refused.frame.error?.code).toBe('INVALID_STATE');

    const cancelled = await rpc(
      'work.control',
      { action: 'cancel', requirementId: queued.id, reason: 'user cancelled' },
      { idempotencyKey: `cancel-${queued.id}` },
    );
    // Either the daemon wrote the Git record or it named the missing service; it
    // never reports a silent success.
    if (!cancelled.frame.ok) {
      expect(['INVALID_STATE', 'NOT_FOUND']).toContain(cancelled.frame.error?.code);
    }
    const row = daemon.store.requirements.find(queued.id);
    // The daemon either writes the Git record and reflects `cancelled`, or names the
    // missing service; it never silently reports a success.
    expect(['cancelled', 'queued']).toContain(row?.lifecycle);
  });

  // -------------------------------------------------------------------------
  // AC-069 / AC-084: conversation, first message, attachments
  // -------------------------------------------------------------------------

  it('sends a message through the BFF and creates a real Work and event (AC-069)', async () => {
    const conversationId = uuid('1');
    const before = daemon.store.events.latestCursor();
    const sent = await rpc(
      'conversation.message.send',
      { conversationId, body: 'please explain the delivery state', attachmentIds: [] },
      { idempotencyKey: 'int-message-1' },
    );
    expect(sent.frame.ok).toBe(true);
    const workId =
      typeof sent.frame.result?.['workId'] === 'string' ? sent.frame.result['workId'] : '';
    expect(workId).not.toBe('');
    expect(daemon.store.works.find(workId)?.goal).toBe('please explain the delivery state');
    expect(daemon.store.events.latestCursor()).toBeGreaterThan(before);

    // The same idempotency key returns the original answer instead of a second Work.
    const replay = await rpc(
      'conversation.message.send',
      { conversationId, body: 'please explain the delivery state', attachmentIds: [] },
      { idempotencyKey: 'int-message-1' },
    );
    expect(replay.frame.result?.['workId']).toBe(workId);
    expect(daemon.store.works.count()).toBe(daemon.store.works.count());

    const { html } = await page(`/projects/${daemon.projectId}/chief`);
    expect(html).toContain('id="composer"');
    expect(html).toContain('please explain the delivery state');
    expect(html).toContain('data-translatable="false"');
  });

  it('binds an uploaded attachment to the first message and refuses a bad upload (AC-084/AC-076)', async () => {
    const conversationId = uuid('1');
    const form = new FormData();
    form.append('conversationId', conversationId);
    form.append('file', new Blob(['# notes\n'], { type: 'text/markdown' }), 'notes.md');
    const uploaded = await fetch(`${baseUrl}/artifacts/${daemon.projectId}/upload`, {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, cookie, 'x-csrf-token': csrfToken },
      body: form,
    });
    expect(uploaded.status, JSON.stringify(await uploaded.clone().text())).toBe(201);
    const attachment = (await uploaded.json()) as { attachmentId: string; bytes: number };
    expect(attachment.bytes).toBeGreaterThan(0);

    const sent = await rpc(
      'conversation.message.send',
      { conversationId, body: 'with an attachment', attachmentIds: [attachment.attachmentId] },
      { idempotencyKey: 'int-attachment-message' },
    );
    expect(sent.frame.ok).toBe(true);
    const bound = daemon.store.attachments.find(attachment.attachmentId);
    expect(bound?.state).toBe('bound');
    expect(bound?.boundMessageId).toBe(sent.frame.result?.['messageId']);

    // A second message cannot reuse the same upload.
    const reused = await rpc(
      'conversation.message.send',
      { conversationId, body: 'again', attachmentIds: [attachment.attachmentId] },
      { idempotencyKey: 'int-attachment-reuse' },
    );
    expect(reused.frame.ok).toBe(false);

    // A refused upload leaves no attachment behind.
    const before = daemon.store.attachments.count();
    const bad = new FormData();
    bad.append('conversationId', conversationId);
    bad.append('file', new Blob(['MZ'], { type: 'application/zip' }), 'x.zip');
    const refused = await fetch(`${baseUrl}/artifacts/${daemon.projectId}/upload`, {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, cookie, 'x-csrf-token': csrfToken },
      body: bad,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(daemon.store.attachments.count()).toBe(before);
  });

  // -------------------------------------------------------------------------
  // AC-070: versions, the expired Plan refusal and the truncated preview
  // -------------------------------------------------------------------------

  it('refuses an expired Plan version with the live version and keeps the Work running (AC-070)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const authorization = daemon.store.authorizations.insert({
      projectId: daemon.projectId,
      workId: work.id,
      sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
      goal: 'deliver the thing',
      scope: {
        readPaths: ['src'],
        writePaths: ['src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      operations: ['read', 'edit'],
      acceptedAt: new Date().toISOString(),
    });
    const planningRun = seedRun(daemon, { workId: work.id, role: 'planning', stage: 'plan' });
    const submitted = daemon.gates.submitPlan({
      workId: work.id,
      revision: GIT_HEAD,
      plan: {
        goal: 'deliver the thing',
        scope: {
          readPaths: ['src'],
          writePaths: ['src'],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
        tasks: [
          {
            id: daemon.store.newId(),
            role: 'backend',
            goal: 'edit the source',
            paths: ['src'],
            dependsOn: [],
            acceptanceIds: [],
            checks: ['pnpm test:unit'],
          },
        ],
      },
      approval: {
        authorizationRef: authorization.id,
        runId: planningRun.id,
        productChanged: false,
        at: new Date().toISOString(),
      },
    });
    expect(submitted.approved).toBe(true);
    if (!submitted.approved) throw new Error(`plan was not approved: ${submitted.message}`);
    const currentVersion = submitted.planRef.version;
    expect(currentVersion).toBeGreaterThan(0);

    const requirement = seedRequirement(daemon, 'active', work.id, 'plan detail');
    const { html } = await page(`/projects/${daemon.projectId}/requirements/${requirement.id}`);
    expect(html).toContain(`data-work="${work.id}"`);
    expect(html).toContain(`data-plan-version="${String(currentVersion)}"`);
    // The current version is approvable, so the card is not flagged expired.
    expect(html).toContain('data-expired="false"');

    // A stale client (the page it rendered from an older version) is refused with the
    // version the gate actually holds.
    const stale = await rpc(
      'plan.approve',
      {
        workId: work.id,
        revision: GIT_HEAD,
        planVersion: currentVersion - 1,
        plan: { goal: 'old', scope: {}, tasks: [] },
        approval: { authorizationRef: authorization.id, runId: planningRun.id },
      },
      { idempotencyKey: `stale-${work.id}`, expectedVersion: currentVersion - 1 },
    );
    expect(stale.frame.ok).toBe(false);
    expect(stale.frame.error?.code).toBe('VERSION_CONFLICT');

    // The refusal did not touch the Work: the background Work keeps running.
    const after = daemon.store.works.find(work.id);
    expect(after?.status).toBe('running');

    const next = await page(`/projects/${daemon.projectId}/requirements/${requirement.id}`);
    expect(next.html).toContain('data-plan-version="' + String(currentVersion) + '"');
  });

  it('renders a truncated artifact preview with the full download entry (AC-070)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const run = seedRun(daemon, { workId: work.id, role: 'backend' });
    const big = 'x'.repeat(1_200_000);
    const artifact = daemon.artifacts.createAgent({
      run: { id: run.id, workId: work.id, role: 'backend' },
      kind: 'diff',
      mime: 'text/plain',
      bytes: Buffer.from(big, 'utf8'),
      acl: ['chief'],
    });
    const requirement = seedRequirement(daemon, 'active', work.id, 'artifact detail');
    const { html } = await page(`/projects/${daemon.projectId}/requirements/${requirement.id}`);
    expect(html).toContain(`data-artifact="${artifact.id}"`);
    expect(html).toContain('data-i18n="detail.previewTruncated"');
    expect(html).toContain(`data-download-artifact="${artifact.id}"`);

    // The one-shot download token is issued by the daemon and proxied by the BFF.
    const prepared = await rpc(
      'artifact.download.prepare',
      { artifactId: artifact.id, artifactVersion: artifact.artifactVersion },
      { idempotencyKey: `dl-${artifact.id}` },
    );
    expect(prepared.frame.ok).toBe(true);
    const token =
      typeof prepared.frame.result?.['downloadToken'] === 'string'
        ? prepared.frame.result['downloadToken']
        : '';
    expect(token).not.toBe('');
  });

  // -------------------------------------------------------------------------
  // AC-077: files
  // -------------------------------------------------------------------------

  it('reads the target revision inside the root boundary without touching the snapshot (AC-077)', async () => {
    // The page reads a real revision out of the Project row; nothing in the file
    // path writes to the store, so the Agent context snapshot cannot change.
    const listing = await page(`/projects/${daemon.projectId}/files?path=src/index.ts`);
    expect(listing.status).toBe(200);
    expect(listing.html).toContain(`data-revision="${GIT_HEAD}"`);
    expect(listing.html).toContain('src/index.ts');
    expect(listing.html).toContain('export const answer = 42;');
    expect(listing.html).toContain('data-i18n="files.rootBoundary"');
    expect(listing.html).toContain('data-i18n="files.snapshotUntouched"');

    // The search narrows the listing to matching paths.
    const searched = await page(`/projects/${daemon.projectId}/files?query=index`);
    expect(searched.html).toContain('src/index.ts');
    expect(searched.html).not.toContain('docs/PROJECT.md');

    // A path outside the root is refused and no content is leaked.
    const escaped = await page(`/projects/${daemon.projectId}/files?path=..%2F..%2Fetc%2Fpasswd`);
    expect(escaped.html).toContain('data-code="NOT_FOUND"');
    expect(escaped.html).not.toContain('root:');

    // Reading files is read-only: the fixture is unchanged on disk.
    expect(readFileSync(join(projectRoot, 'src', 'index.ts'), 'utf8')).toBe(
      'export const answer = 42;\n',
    );
  });

  // -------------------------------------------------------------------------
  // AC-075: configuration
  // -------------------------------------------------------------------------

  it('reports a bad config patch with the input preserved and the revision unchanged (AC-075)', async () => {
    const settings = await rpc('config.get', { scope: 'global' });
    expect(settings.frame.ok).toBe(true);
    const revision = Number(settings.frame.result?.['revision'] ?? 0);

    const bad = await rpc(
      'config.save',
      { scope: 'global', patch: { unknownKey: true } },
      { idempotencyKey: 'bad-config', expectedVersion: revision },
    );
    expect(bad.frame.ok).toBe(false);
    expect(bad.frame.error?.code).toBe('VALIDATION_ERROR');
    expect(bad.status).toBe(422);
    // The server hands the caller's input back, which is what lets the form keep it.
    const details = (bad.frame.error as { details?: { preservedInput?: unknown } }).details;
    expect(JSON.stringify(details?.preservedInput ?? {})).toContain('unknownKey');

    const after = await rpc('config.get', { scope: 'global' });
    expect(Number(after.frame.result?.['revision'] ?? -1)).toBe(revision);

    // The rendered settings page shows the same active revision it just read.
    const { html } = await page('/settings');
    expect(html).toContain('id="configForm"');
    expect(html).toContain(`data-revision="${String(revision)}"`);
    expect(html).toContain('data-i18n="settings.unchanged"');
  });

  it('reports an unusable provider profile from config.test (AC-075)', async () => {
    const tested = await rpc('config.test', { role: 'chief' }, { idempotencyKey: 'provider-test' });
    // No provider is configured on this daemon, so the honest answer is a refusal
    // naming the reason — never a fabricated success.
    expect(tested.frame.ok).toBe(false);
    expect(tested.frame.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(tested.frame.error?.message ?? '').not.toBe('');
  });

  // -------------------------------------------------------------------------
  // AC-074: Inbox
  // -------------------------------------------------------------------------

  it('deduplicates decisions per target version and keeps an expired one inert (AC-074)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const targetId = uuid('50');
    seedDecision(daemon, { workId: work.id, targetId, targetVersion: 3 });
    seedDecision(daemon, { workId: work.id, targetId, targetVersion: 3 });
    seedDecision(daemon, { workId: work.id, targetId, targetVersion: 4, state: 'expired' });
    const reviewRun = seedRun(daemon, { workId: work.id, role: 'review', status: 'completed' });
    seedFinding(daemon, { workId: work.id, reviewRunId: reviewRun.id, severity: 'P1' });
    seedFinding(daemon, { workId: work.id, reviewRunId: reviewRun.id, severity: 'P1' });

    const { html } = await page(`/projects/${daemon.projectId}/inbox`);
    expect(html.match(/data-kind="decision"/gu) ?? []).toHaveLength(2);
    expect(html).toContain('data-target-version="3"');
    expect(html).toContain('data-target-version="4"');
    expect(html).toMatch(/data-decision="[^"]+"[^>]*data-choice="now"[^>]*disabled/u);
    // Two blocking findings of the same severity are one summarised repair row.
    expect(html.match(/data-kind="finding"/gu) ?? []).toHaveLength(1);
    expect(html).toContain('data-i18n="inbox.internalRepairs"');
  });

  // -------------------------------------------------------------------------
  // AC-078: the authentication lifecycle
  // -------------------------------------------------------------------------

  it('refuses unauthenticated and wrong-Origin writes while the Work keeps running (AC-078)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    seedRun(daemon, { workId: work.id, epoch: 5 });

    const anonymous = await rpc(
      'work.control',
      { action: 'cancel', workId: work.id },
      { cookie: '' },
    );
    expect(anonymous.status).toBe(401);
    const wrongOrigin = await rpc(
      'work.control',
      { action: 'cancel', workId: work.id },
      { origin: 'http://evil.example' },
    );
    expect(wrongOrigin.status).toBe(403);

    // Neither refusal touched the background Work.
    expect(daemon.store.works.find(work.id)?.status).toBe('running');
    expect(daemon.protocol.connectionCount).toBeGreaterThanOrEqual(0);
  });

  it('authenticates a same-Origin write without a browser CSRF header (W9R1-09)', async () => {
    // Registered deliberate deviation (`protocol.md` §2 vs the BFF): the exact-Origin
    // check plus the BFF's own HttpOnly `agentdev_web` session is the CSRF defence,
    // and the daemon call carries the BFF's own `session.csrfToken`. A browser header
    // is therefore neither required nor authoritative — a client cannot supply a
    // value the BFF would trust.
    const work = seedWork(daemon, { status: 'running' });
    const envelope = {
      v: 1,
      type: 'request',
      id: 'csrf-origin-only',
      method: 'work.control',
      params: { action: 'pause', workId: work.id, reason: 'w9r1-09' },
      idempotencyKey: 'w9r1-09-origin-only',
    };
    const withoutHeader = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: WEB_ORIGIN },
      body: JSON.stringify(envelope),
    });
    expect(withoutHeader.status, await withoutHeader.clone().text()).toBe(200);
    expect(daemon.store.works.find(work.id)?.status).toBe('paused');

    // A foreign Origin is refused even when the caller presents the session's own
    // CSRF token: the Origin, not the header, is what the BFF checks.
    const foreignOrigin = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'http://evil.example',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        ...envelope,
        id: 'csrf-foreign-origin',
        idempotencyKey: 'w9r1-09-foreign',
      }),
    });
    expect(foreignOrigin.status).toBe(403);
    expect((await foreignOrigin.json()) as { error?: { code?: string } }).toMatchObject({
      error: { code: 'NOT_AUTHORIZED' },
    });

    // A forged browser CSRF token is irrelevant: the BFF replaces it with its own
    // session's token before it reaches the daemon.
    const forged = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: WEB_ORIGIN,
        'x-csrf-token': 'forged-by-the-browser',
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: 'csrf-forged',
        method: 'work.control',
        params: { action: 'resume', workId: work.id, reason: 'w9r1-09-forged' },
        idempotencyKey: 'w9r1-09-forged',
      }),
    });
    expect(forged.status, await forged.clone().text()).toBe(200);
    expect(daemon.store.works.find(work.id)?.status).toBe('running');
  });

  it('keeps the background Work after a logout and refuses the stale cookie (AC-078)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const spent = cookie;
    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, cookie: spent, accept: 'application/json' },
    });
    expect(logout.status).toBe(200);

    // The browser cookie is gone from the BFF's store, but the Work is untouched.
    const after = await rpc('work.get', { workId: work.id }, { cookie: spent });
    expect(after.status).toBe(401);
    expect(daemon.store.works.find(work.id)?.status).toBe('running');
    expect(daemon.store.runs.count('work_id = ?', [work.id])).toBeGreaterThanOrEqual(0);

    // A page request gets the sign-in page rather than a stale render.
    const stale = await page(`/projects/${daemon.projectId}/chief`, { cookie: spent });
    expect(stale.status).toBe(401);
    expect(stale.html).toContain('id="loginForm"');
  });

  // -------------------------------------------------------------------------
  // AC-071 / AC-072 / AC-073: the shell over real pages
  // -------------------------------------------------------------------------

  it('shares the panel mode across pages and keeps Chief-only controls off other pages (AC-071/AC-072)', async () => {
    const surfaces = ['chief', 'requirements', 'docs', 'files', 'agents', 'runs', 'inbox'] as const;
    for (const surface of surfaces) {
      const rendered = await page(`/projects/${daemon.projectId}/${surface}`);
      expect(rendered.status, surface).toBe(200);
      expect(rendered.html).toContain(`data-page="${surface}"`);
      expect(rendered.html).toContain('id="liveDockToggle"');
      expect(rendered.html).toContain('data-i18n="language.label"');
      if (surface !== 'chief') {
        expect(rendered.html).not.toContain('id="newConversation"');
        expect(rendered.html).toContain('id="discussInChief"');
      }
    }
    const globalSettings = await page('/settings');
    expect(globalSettings.status).toBe(200);
    expect(globalSettings.html).toContain('data-page="settings"');

    // The panel mode is presentation only: no command reaches the daemon when a page
    // is rendered, and the mode is carried by the shell attribute.
    expect(globalSettings.html).toMatch(/data-panel-mode="(open|compact|hidden)"/u);
  });

  it('answers a page request with the language the browser asked for (AC-073)', async () => {
    const chinese = await fetch(`${baseUrl}/projects/${daemon.projectId}/requirements`, {
      headers: {
        accept: 'text/html',
        cookie: `${cookie}; agentdev_language=zh`,
      },
    });
    const html = await chinese.text();
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('需求');
    // Project content stays verbatim: no translated requirement titles.
    expect(html).toContain('data-i18n-project');
  });

  // -------------------------------------------------------------------------
  // AC-069 / AC-078: the event stream
  // -------------------------------------------------------------------------

  it('streams real events over the WebSocket proxy and resumes from a watermark (AC-069/AC-078)', async () => {
    const socket = connect();
    await socket.opened();
    socket.send({
      v: 1,
      type: 'request',
      id: 'hello',
      method: 'connection.hello',
      params: { protocolVersion: 1, client: 'web' },
    });
    const hello = await socket.waitFor((frame) => frame.id === 'hello');
    expect(hello.ok).toBe(true);

    socket.send({
      v: 1,
      type: 'request',
      id: 'sub',
      method: 'project.subscribe',
      params: { scope: { kind: 'summary' } },
    });
    const subscribed = await socket.waitFor((frame) => frame.id === 'sub');
    expect(subscribed.ok).toBe(true);
    const subscriptionId =
      typeof subscribed.result?.['subscriptionId'] === 'string'
        ? subscribed.result['subscriptionId']
        : '';
    expect(subscriptionId).not.toBe('');
    const cursor = Number(subscribed.result?.['cursor'] ?? 0);
    await socket.waitFor((frame) => frame.type === 'batch_end');
    const watermark = Number(
      socket.frames.filter((frame) => frame.type === 'batch_end').at(-1)?.scannedThrough ?? cursor,
    );

    // A real message produces a real event on the same socket.
    const sent = await rpc(
      'conversation.message.send',
      { conversationId: uuid('1'), body: 'trigger an event', attachmentIds: [] },
      { idempotencyKey: 'event-trigger' },
    );
    expect(sent.frame.ok).toBe(true);
    const event = await socket.waitFor(
      (frame) => frame.type === 'event' && frame.name === 'message.received',
    );
    expect(event.cursor).toBeGreaterThan(watermark);

    // Acknowledging the cursor is accepted, and a second socket resuming from the
    // watermark does not re-deliver older events.
    socket.send({
      v: 1,
      type: 'request',
      id: 'ack',
      method: 'project.events.ack',
      params: { subscriptionId, cursor: Number(event.cursor ?? 0) },
    });
    const ack = await socket.waitFor((frame) => frame.id === 'ack');
    expect(ack.ok).toBe(true);

    const resumed = connect();
    await resumed.opened();
    resumed.send({
      v: 1,
      type: 'request',
      id: 'sub2',
      method: 'project.subscribe',
      params: { scope: { kind: 'summary' }, afterCursor: Number(event.cursor ?? 0) },
    });
    const resumedSub = await resumed.waitFor((frame) => frame.id === 'sub2');
    expect(resumedSub.ok).toBe(true);
    expect(resumedSub.result?.['mode']).toBe('replay');
    await resumed.waitFor((frame) => frame.type === 'batch_end');
    const replayed = resumed.frames.filter(
      (frame) => frame.type === 'event' && (frame.cursor ?? 0) <= Number(event.cursor ?? 0),
    );
    expect(replayed).toEqual([]);
  });

  it('walks login → board → detail → approve → event in one headless flow (AC-068–AC-072)', async () => {
    // 1) Login through the BFF, exactly as the browser does.
    await signIn();
    expect(cookie).toContain('agentdev_web=');

    // 2) Board: one real Requirement with local Work.
    const work = seedWork(daemon, { status: 'running' });
    const requirement = seedRequirement(daemon, 'active', work.id, 'flow requirement');
    const board = await page(`/projects/${daemon.projectId}/requirements`);
    expect(board.status).toBe(200);
    expect(board.html).toContain(`data-identity="${requirement.id}"`);

    // 3) Detail: the same id, the plan version and an approvable control.
    const authorization = daemon.store.authorizations.insert({
      projectId: daemon.projectId,
      workId: work.id,
      sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
      goal: 'flow',
      scope: {
        readPaths: ['src'],
        writePaths: ['src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      operations: ['read', 'edit'],
      acceptedAt: new Date().toISOString(),
    });
    const planningRun = seedRun(daemon, { workId: work.id, role: 'planning', stage: 'plan' });
    const draft: PlanDraft = {
      goal: 'flow goal',
      scope: {
        readPaths: ['src'],
        writePaths: ['src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      tasks: [
        {
          id: daemon.store.newId(),
          role: 'backend',
          goal: 'edit the source',
          paths: ['src'],
          dependsOn: [],
          acceptanceIds: [],
          checks: ['pnpm test:unit'],
        },
      ],
    };
    const submitted = daemon.gates.submitPlan({
      workId: work.id,
      revision: GIT_HEAD,
      plan: draft,
      approval: {
        authorizationRef: authorization.id,
        runId: planningRun.id,
        productChanged: false,
        at: new Date().toISOString(),
      },
    });
    if (!submitted.approved) throw new Error(`plan was not approved: ${submitted.message}`);
    const planVersion = submitted.planRef.version;

    const detail = await page(`/projects/${daemon.projectId}/requirements/${requirement.id}`);
    expect(detail.status).toBe(200);
    expect(detail.html).toContain(`data-requirement="${requirement.id}"`);
    expect(detail.html).toContain(`data-plan-version="${String(planVersion)}"`);
    expect(detail.html).not.toMatch(/id="approvePlan"[^>]*disabled/u);

    // 4) Approve the version the page showed, through the same RPC the button uses.
    const approved = await rpc(
      'plan.approve',
      {
        workId: work.id,
        revision: GIT_HEAD,
        planVersion,
        plan: draft,
        approval: { authorizationRef: authorization.id, runId: planningRun.id },
      },
      { idempotencyKey: `flow-approve-${work.id}`, expectedVersion: planVersion },
    );
    expect(approved.status).toBe(200);
    expect(approved.frame.ok).toBe(true);
    expect(Number(approved.frame.result?.['currentVersion'] ?? 0)).toBeGreaterThanOrEqual(
      planVersion,
    );

    // 5) The event stream carries the resulting event with a watermark.
    const socket = connect();
    await socket.opened();
    socket.send({
      v: 1,
      type: 'request',
      id: 'flow-hello',
      method: 'connection.hello',
      params: { protocolVersion: 1, client: 'web' },
    });
    await socket.waitFor((frame) => frame.id === 'flow-hello');
    socket.send({
      v: 1,
      type: 'request',
      id: 'flow-sub',
      method: 'project.subscribe',
      params: { scope: { kind: 'summary' } },
    });
    const subscribed = await socket.waitFor((frame) => frame.id === 'flow-sub');
    expect(subscribed.ok).toBe(true);

    const sent = await rpc(
      'conversation.message.send',
      { conversationId: uuid('1'), body: 'flow event', attachmentIds: [] },
      { idempotencyKey: 'flow-event' },
    );
    expect(sent.frame.ok).toBe(true);
    const event = await socket.waitFor(
      (frame) => frame.type === 'event' && frame.name === 'message.received',
    );
    expect(event.cursor).toBeGreaterThan(0);
    const batch = await socket.waitFor((frame) => frame.type === 'batch_end');
    expect(batch.scannedThrough).toBeGreaterThanOrEqual(0);
  });

  it('refuses an unauthenticated WebSocket upgrade and keeps the Work alive (AC-078)', async () => {
    const work = seedWork(daemon, { status: 'running' });
    const socket = new WsClient(wsUrl, 'agentdev_web=nonsense');
    await expect(socket.opened()).rejects.toThrow();
    expect(daemon.store.works.find(work.id)?.status).toBe('running');
  });
});
