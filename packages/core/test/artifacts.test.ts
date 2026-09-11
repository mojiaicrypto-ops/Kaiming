import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTIFACT_LIMITS, ATTACHMENT_LIMITS, type Run } from '@agentdev/contracts';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import {
  AttachmentService,
  ArtifactService,
  DownloadTokenStore,
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
  ProtocolError,
  renderPreview,
  previewHeaders,
  sendMessage,
  userIdFromSubject,
} from '../src/index.js';

const ROOT = '/tmp/agentdev-artifacts-root';
const CONVERSATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f01';
const OWNER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f02';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f03';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f04';
const MESSAGE_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f05';

let clock = 1_700_000_000_000;

describe('attachments, artifacts and previews (WP-03)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let blobs: BlobStore;
  let attachments: AttachmentService;
  let artifacts: ArtifactService;
  let projectId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-artifacts-'));
    clock = 1_700_000_000_000;
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    blobs = new BlobStore({ root: dataDir });
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
    store.conversations.insert({ id: CONVERSATION_ID, projectId, title: 'chief', archived: false });
    const budget = store.budgets.insert({
      projectId,
      workId: WORK_ID,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    store.works.insert({
      id: WORK_ID,
      projectId,
      intent: 'assist',
      purpose: 'answer the question',
      level: 'none',
      goal: 'explain the routing rules',
      scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
      sourceRef: { kind: 'message', id: MESSAGE_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      budgetId: budget.id,
      policyRevision: 1,
    });
    store.runs.insert({
      id: RUN_ID,
      projectId,
      workId: WORK_ID,
      role: 'backend',
      purpose: 'analysis',
      stage: 'assist',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'a'.repeat(64),
      contextSnapshotId: 'b'.repeat(64),
      dispatchSnapshotId: 'c'.repeat(64),
      budgetAllocation: 1_000,
    });
    attachments = new AttachmentService({ store, blobs, now: () => clock });
    artifacts = new ArtifactService({ store, blobs, now: () => clock });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const run = (): Pick<Run, 'id' | 'workId' | 'role'> => ({
    id: RUN_ID,
    workId: WORK_ID,
    role: 'backend',
  });

  function stage(text: string, mime = 'text/html') {
    return attachments.stage({
      conversationId: CONVERSATION_ID,
      ownerUserId: OWNER_ID,
      mime,
      bytes: Buffer.from(text, 'utf8'),
    });
  }

  it('stages an upload with a 24h TTL and binds it once (AC-084)', () => {
    const staged = stage('<p>hi</p>');
    expect(staged.state).toBe('staged');
    expect(staged.bytes).toBe(9);
    expect(Date.parse(staged.expiresAt)).toBe(
      clock + ATTACHMENT_LIMITS.stagedTtlHours * 60 * 60 * 1000,
    );
    expect(blobs.has(staged.relativeBlobPath)).toBe(true);

    const bound = attachments.bind({
      attachmentIds: [staged.id],
      messageId: MESSAGE_ID,
      workId: WORK_ID,
      conversationId: CONVERSATION_ID,
      ownerUserId: OWNER_ID,
    });
    expect(bound[0]).toMatchObject({ state: 'bound', boundMessageId: MESSAGE_ID, workId: WORK_ID });

    // The same upload cannot back a second message.
    expect(() =>
      attachments.bind({
        attachmentIds: [staged.id],
        messageId: MESSAGE_ID,
        workId: WORK_ID,
        conversationId: CONVERSATION_ID,
        ownerUserId: OWNER_ID,
      }),
    ).toThrowError(/already bound/);
  });

  it('enforces the upload limits before anything is stored (AC-076)', () => {
    expect(() => stage('x', 'application/zip')).toThrowError(/not supported/);
    expect(() => stage('')).toThrowError(/empty/);
    const huge = Buffer.alloc(ATTACHMENT_LIMITS.maxBytesEach + 1, 0x61);
    expect(() =>
      attachments.stage({
        conversationId: CONVERSATION_ID,
        ownerUserId: OWNER_ID,
        mime: 'text/plain',
        bytes: huge,
      }),
    ).toThrowError(/per-file size limit/);
    // Nothing was persisted for a refused upload.
    expect(store.attachments.list()).toHaveLength(0);
    expect(store.events.readAfter(0, { limit: 10 })).toHaveLength(0);

    const one = stage('a', 'text/plain');
    const two = stage('b', 'text/plain');
    expect(() =>
      attachments.bind({
        attachmentIds: [one.id, one.id],
        messageId: MESSAGE_ID,
        workId: WORK_ID,
        conversationId: CONVERSATION_ID,
        ownerUserId: OWNER_ID,
      }),
    ).toThrowError(/listed twice/);
    expect(() =>
      attachments.bind({
        attachmentIds: [one.id, two.id],
        messageId: MESSAGE_ID,
        workId: WORK_ID,
        conversationId: CONVERSATION_ID,
        ownerUserId: 'another-user',
      }),
    ).toThrowError(/another owner/);
    expect(store.attachments.find(one.id)?.state).toBe('staged');
  });

  it('refuses more attachments than one message may carry, and expired ones', () => {
    const staged = Array.from({ length: ATTACHMENT_LIMITS.maxPerMessage + 1 }, () =>
      stage('x', 'text/plain'),
    );
    expect(() =>
      attachments.bind({
        attachmentIds: staged.map((attachment) => attachment.id),
        messageId: MESSAGE_ID,
        workId: WORK_ID,
        conversationId: CONVERSATION_ID,
        ownerUserId: OWNER_ID,
      }),
    ).toThrowError(/too many attachments/);

    clock += ATTACHMENT_LIMITS.stagedTtlHours * 60 * 60 * 1000 + 1;
    expect(attachments.expireStale()).toHaveLength(staged.length);
    expect(() =>
      attachments.bind({
        attachmentIds: [staged[0]?.id ?? ''],
        messageId: MESSAGE_ID,
        workId: WORK_ID,
        conversationId: CONVERSATION_ID,
        ownerUserId: OWNER_ID,
      }),
    ).toThrowError(/expired/);
  });

  it('deletes only the caller\u2019s own staged upload', () => {
    const staged = stage('x', 'text/plain');
    expect(() => attachments.remove(staged.id, 'another-user')).toThrowError(/another user/);
    expect(attachments.remove(staged.id, OWNER_ID)).toMatchObject({ state: 'expired' });
    expect(() => attachments.remove(staged.id, OWNER_ID)).toThrowError(/cannot be deleted/);
  });

  it('versions agent artifacts and keeps the old bytes readable (AC-002)', () => {
    const first = artifacts.createAgent({
      run: run(),
      kind: 'explanation',
      mime: 'text/html',
      bytes: Buffer.from('<h1>v1</h1>', 'utf8'),
    });
    const second = artifacts.createAgent({
      run: run(),
      kind: 'explanation',
      mime: 'text/html',
      bytes: Buffer.from('<h1>v2</h1>', 'utf8'),
    });
    expect(first.artifactVersion).toBe(1);
    expect(second.artifactVersion).toBe(2);
    expect(artifacts.get(second.id, 1).id).toBe(first.id);
    expect(Buffer.from(artifacts.read(first)).toString('utf8')).toBe('<h1>v1</h1>');
    expect(artifacts.latestByKind(WORK_ID, 'explanation')?.id).toBe(second.id);

    const created = store.events
      .readAfter(0, { limit: 10 })
      .filter((event) => event.name === 'artifact.created');
    expect(created).toHaveLength(2);
    expect(created[0]?.data).toMatchObject({ artifactVersion: 1, kind: 'explanation' });
  });

  it('binds a user artifact to its attachment and stores no Run', () => {
    const staged = stage('<p>user</p>');
    const bound = attachments.bind({
      attachmentIds: [staged.id],
      messageId: MESSAGE_ID,
      workId: WORK_ID,
      conversationId: CONVERSATION_ID,
      ownerUserId: OWNER_ID,
    })[0];
    if (bound === undefined) throw new Error('attachment was not bound');
    const artifact = artifacts.createUser({ workId: WORK_ID, attachment: bound });
    expect(artifact).toMatchObject({ origin: 'user', attachmentId: staged.id, kind: 'attachment' });
    expect(artifact.runId).toBeUndefined();
    expect(artifacts.isReadable(artifact, 'chief')).toBe(true);
  });

  it('invalidates an artifact once and keeps the reason (AC-002)', () => {
    const artifact = artifacts.createAgent({
      run: run(),
      kind: 'explanation',
      mime: 'text/plain',
      bytes: Buffer.from('stale', 'utf8'),
    });
    const invalid = artifacts.invalidate(artifact.id, 'superseded by v2');
    expect(invalid).toMatchObject({ validity: 'invalid', invalidReason: 'superseded by v2' });
    expect(() => artifacts.invalidate(artifact.id, 'again')).toThrowError(/already invalid/);
    expect(
      store.events
        .readAfter(0, { limit: 10 })
        .filter((event) => event.name === 'artifact.invalidated'),
    ).toHaveLength(1);
  });

  it('reports a missing blob as ARTIFACT_MISSING instead of crashing', () => {
    const artifact = artifacts.createAgent({
      run: run(),
      kind: 'explanation',
      mime: 'text/plain',
      bytes: Buffer.from('gone', 'utf8'),
    });
    rmSync(join(dataDir, artifact.relativeBlobPath), { force: true });
    try {
      artifacts.read(artifact);
      throw new Error('expected ARTIFACT_MISSING');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect(error).toMatchObject({ code: 'ARTIFACT_MISSING' });
    }
  });

  it('sends a message, creates its assist Work and binds uploads atomically (AC-084)', () => {
    // The upload owner and the message author are the same derived subject, exactly
    // as the daemon binds them.
    const subject = 'installation:local';
    const owner = userIdFromSubject(subject);
    const staged = attachments.stage({
      conversationId: CONVERSATION_ID,
      ownerUserId: owner,
      mime: 'text/html',
      bytes: Buffer.from('<p>hi</p>', 'utf8'),
    });
    const sent = sendMessage(
      { projectId, store, attachments, artifacts, blobs, now: () => clock },
      {
        conversationId: CONVERSATION_ID,
        body: 'explain the routing rules',
        attachmentIds: [staged.id],
        ownerUserId: owner,
      },
    );
    const work = store.works.find(sent.workId);
    expect(work).toMatchObject({ intent: 'assist', level: 'none', status: 'queued' });
    // No Requirement is ever created on the direct-collaboration route.
    expect(store.requirements.list()).toHaveLength(0);
    expect(store.attachments.find(staged.id)).toMatchObject({
      state: 'bound',
      workId: sent.workId,
      boundMessageId: sent.messageId,
    });
    expect(store.artifacts.list({ where: 'origin = ?', params: ['user'] })).toHaveLength(1);
    expect(store.messages.find(sent.messageId)?.seq).toBe(1);

    // A second message reuses the conversation sequence and creates its own Work.
    const second = sendMessage(
      { projectId, store, attachments, artifacts, blobs, now: () => clock },
      { conversationId: CONVERSATION_ID, body: 'and now a follow-up', ownerUserId: owner },
    );
    expect(store.messages.find(second.messageId)?.seq).toBe(2);
    expect(second.workId).not.toBe(sent.workId);

    // An oversized body is refused before any row is written.
    expect(() =>
      sendMessage(
        { projectId, store, attachments, artifacts, blobs, now: () => clock },
        { conversationId: CONVERSATION_ID, body: 'x'.repeat(64_001), ownerUserId: owner },
      ),
    ).toThrowError(/too long/);
    expect(store.messages.list()).toHaveLength(2);
  });

  it('leaves no reference behind when artifact generation fails (required failure test)', () => {
    // A blob store whose root cannot be created: the write fails, so nothing may be
    // referenced by an Artifact row.
    const brokenRoot = join(dataDir, 'not-a-directory');
    writeFileSync(brokenRoot, 'file, not a directory');
    const broken = new ArtifactService({
      store,
      blobs: new BlobStore({ root: join(brokenRoot, 'nested') }),
      now: () => clock,
    });
    try {
      broken.createAgent({
        run: run(),
        kind: 'explanation',
        mime: 'text/html',
        bytes: Buffer.from('<p>boom</p>', 'utf8'),
      });
      throw new Error('expected a generation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect(error).toMatchObject({ code: 'INTERNAL_ERROR' });
    }
    expect(store.artifacts.list()).toHaveLength(0);
    expect(
      store.events.readAfter(0, { limit: 50 }).filter((event) => event.name === 'artifact.created'),
    ).toHaveLength(0);
  });

  it('produces an agent explanation artifact for a delegated analysis Run (AC-003)', () => {
    const artifact = artifacts.createAgent({
      run: { id: RUN_ID, workId: WORK_ID, role: 'backend' },
      kind: 'explanation',
      mime: 'text/html',
      bytes: Buffer.from('<h1>routing</h1>', 'utf8'),
      acl: ['chief'],
      sourceRevision: 'abc123',
    });
    expect(artifact).toMatchObject({
      origin: 'agent',
      runId: RUN_ID,
      kind: 'explanation',
      mime: 'text/html',
      validity: 'valid',
      sourceRevision: 'abc123',
    });
    // The producing Run stays on the assist route: no Requirement is created.
    expect(store.requirements.list()).toHaveLength(0);
    expect(artifacts.isReadable(artifact, 'chief')).toBe(true);
  });

  it('records the authority an explicit message grants (AC-005)', () => {
    const owner = userIdFromSubject('installation:local');
    // The message itself names the target, so the Chief routes it as delivery and the
    // message is its own scope authorization — no second confirmation (AC-005).
    const sent = sendMessage(
      { projectId, store, attachments, artifacts, blobs, now: () => clock },
      {
        conversationId: CONVERSATION_ID,
        body: '修改 docs/INDEX.md',
        ownerUserId: owner,
      },
    );
    expect(sent.authorizationId).not.toBeNull();
    const work = store.works.find(sent.workId);
    expect(work?.authorizationRef).toBe(sent.authorizationId);
    expect(store.authorizations.find(sent.authorizationId ?? '')).toMatchObject({
      workId: sent.workId,
      sourceRef: { kind: 'message', id: sent.messageId },
      scope: { writePaths: ['docs/INDEX.md'], readPaths: ['docs/INDEX.md'] },
      operations: ['read', 'edit'],
    });
    // The Assessment records the routing evidence for that authorization.
    const assessment = store.assessments.list({ where: 'work_id = ?', params: [sent.workId] })[0];
    // A scope that declares operations is L2 (`workflow.md` §2.4 keeps L1 for
    // presentation-only changes), which is also the Core's routing floor.
    expect(assessment).toMatchObject({
      intent: 'delivery',
      level: 'L2',
      authorizationRef: sent.authorizationId,
    });
    // The granted scope itself lives on the Authorization (DC-60 keeps the assessment
    // row to its documented columns).
    expect(store.works.find(sent.workId)?.scope).toMatchObject({
      writePaths: ['docs/INDEX.md'],
    });
    // The granted authorization is self-consistent: a Run that reads and edits the
    // named path satisfies the Core's capability check (W3R3-01).
    const granted = store.authorizations.find(sent.authorizationId ?? '');
    expect(granted?.operations).toContain('read');
    expect(granted?.scope.readPaths).toContain('docs/INDEX.md');
    // A question that names a target is still a question.
    const questionWithPath = sendMessage(
      { projectId, store, attachments, artifacts, blobs, now: () => clock },
      {
        conversationId: CONVERSATION_ID,
        body: 'how do I fix the typo in docs/INDEX.md?',
        ownerUserId: owner,
      },
    );
    expect(questionWithPath.authorizationId).toBeNull();
    expect(store.works.find(questionWithPath.workId)?.intent).toBe('assist');

    // A pure question grants nothing and stays read-only.
    const question = sendMessage(
      { projectId, store, attachments, artifacts, blobs, now: () => clock },
      {
        conversationId: CONVERSATION_ID,
        body: 'explain how the routing rules work',
        ownerUserId: owner,
      },
    );
    expect(question.authorizationId).toBeNull();
    expect(store.works.find(question.workId)).toMatchObject({ intent: 'assist', level: 'none' });
  });

  it('splits one mixed message into the work items it names (AC-006)', () => {
    const owner = userIdFromSubject('installation:local');
    // One message asking for both an explanation and a fix is split by the Chief
    // route itself: the explanation is read-only and can finish first.
    const sent = sendMessage(
      { projectId, store, attachments, artifacts, blobs, now: () => clock },
      {
        conversationId: CONVERSATION_ID,
        body: 'explain the routing rules and 修复 docs/INDEX.md',
        ownerUserId: owner,
      },
    );
    // One message, two independent Works, each with its own scope and budget.
    expect(sent.workIds).toHaveLength(2);
    expect(sent.workId).toBe(sent.workIds[0]);
    const works = sent.workIds.map((id) => store.works.find(id));
    expect(works.map((work) => work?.intent).sort()).toEqual(['assist', 'delivery']);
    // Independent scopes: only the delivery Work may write, and only the named path.
    const delivery = works.find((work) => work?.intent === 'delivery');
    const explanation = works.find((work) => work?.intent === 'assist');
    expect(delivery?.scope).toMatchObject({
      writePaths: ['docs/INDEX.md'],
      operations: ['read', 'edit'],
    });
    expect(explanation?.scope.writePaths).toEqual([]);
    for (const work of works) {
      expect(work?.sourceRef).toMatchObject({ kind: 'message', id: sent.messageId });
      expect(store.budgets.list({ where: 'work_id = ?', params: [work?.id ?? ''] })).toHaveLength(
        1,
      );
    }
    // Still no Requirement on either route.
    expect(store.requirements.list()).toHaveLength(0);
  });

  it('carries the isolation policy on every preview (AC-052)', () => {
    const headers = previewHeaders('text/html');
    expect(headers['content-security-policy']).toBe(PREVIEW_CSP);
    expect(headers['x-agentdev-preview-sandbox']).toBe(PREVIEW_SANDBOX);
    expect(headers['x-agentdev-preview-credentials']).toBe('omit');
    // The documented policy denies the classic attacks by construction.
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CSP).toContain("script-src 'unsafe-inline'");
    expect(PREVIEW_SANDBOX).toBe('allow-scripts');
    expect(PREVIEW_SANDBOX).not.toContain('allow-same-origin');
    expect(PREVIEW_SANDBOX).not.toContain('allow-forms');
    expect(PREVIEW_SANDBOX).not.toContain('allow-top-navigation');
    expect(PREVIEW_SANDBOX).not.toContain('allow-popups');
    expect(PREVIEW_SANDBOX).not.toContain('allow-downloads');
  });

  it('truncates oversized previews and keeps the download path (AC-002)', () => {
    const small = renderPreview(
      { kind: 'explanation', mime: 'text/html', bytes: 4 },
      Buffer.from('<!doctype html>', 'utf8'),
    );
    expect(small).toMatchObject({ mode: 'inline', downloadRequired: false });

    const manyLines = Array.from({ length: ARTIFACT_LIMITS.inlinePreviewMaxLines + 10 }, () => 'x');
    const long = Buffer.from(manyLines.join('\n'), 'utf8');
    const truncated = renderPreview(
      { kind: 'explanation', mime: 'text/plain', bytes: long.byteLength },
      long,
    );
    expect(truncated.mode).toBe('truncated');
    expect(truncated.downloadRequired).toBe(true);
    expect(truncated.lines).toBe(ARTIFACT_LIMITS.inlinePreviewMaxLines);
    expect(truncated.truncatedAtLine).toBe(ARTIFACT_LIMITS.inlinePreviewMaxLines);

    const big = Buffer.alloc(ARTIFACT_LIMITS.inlinePreviewMaxBytes + 1, 0x61);
    const byBytes = renderPreview(
      { kind: 'explanation', mime: 'text/plain', bytes: big.byteLength },
      big,
    );
    expect(byBytes.mode).toBe('truncated');
  });

  it('consumes a download token exactly once and expires it (AC-002)', () => {
    const tokens = new DownloadTokenStore({ now: () => clock });
    const grant = tokens.issue({ id: 'artifact-1', artifactVersion: 2 });
    expect(grant.expiresAt).toBe(
      new Date(clock + ARTIFACT_LIMITS.downloadTokenTtlSec * 1000).toISOString(),
    );
    expect(tokens.consume(grant.token)).toMatchObject({
      artifactId: 'artifact-1',
      artifactVersion: 2,
    });
    // Replay is refused.
    expect(tokens.consume(grant.token)).toBeUndefined();

    const expiring = tokens.issue({ id: 'artifact-2', artifactVersion: 1 });
    clock += ARTIFACT_LIMITS.downloadTokenTtlSec * 1000 + 1;
    expect(tokens.consume(expiring.token)).toBeUndefined();
    expect(tokens.prune()).toBe(0);
  });
});
