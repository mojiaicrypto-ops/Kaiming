/**
 * WP-12 T5.5 integration: one BFF, one origin, two real projects.
 *
 * The BFF is created once with the installation's project directory and routes every
 * request to the daemon that serves the `projectId` it names. These are the product
 * path assertions for AC-023 (several projects on one installation) and AC-034 (no
 * cross-project row, cursor, session or artifact token leaks): a request naming an
 * unserved project fails closed, and an artifact URL is only served through its own
 * project's route.
 *
 * The directory itself is a test double here — the real one is exercised against real
 * Git and SQLite in `apps/daemon/test/project-lifecycle.integration.test.ts`; what
 * this file proves is the BFF's routing and isolation on top of two *real* daemons.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService, userIdFromSubject } from '@agentdev/core';
import type { ProjectDirectoryPort, ProjectEntry, ProjectTarget } from '../src/projects.js';
import { createWebApp, splitArtifactPath } from '../src/app.js';
import { NodeFilePort } from '../src/files.js';
import { WebSessionStore, cookieValue } from '../src/sessions.js';
import { seedRequirement, seedWork, startTestDaemon, uuid, type TestDaemon } from './helpers.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';

function entryOf(daemon: TestDaemon, name: string): ProjectEntry {
  return {
    projectId: daemon.projectId,
    name,
    root: daemon.projectRoot,
    trust: 'trusted',
    state: 'open',
    updatedAt: '2026-09-14T00:00:00.000Z',
    runningRuns: 0,
    executionReady: true,
    gitRoot: daemon.projectRoot,
    head: null,
    problem: null,
    initialization: null,
    import: null,
  };
}

function targetOf(daemon: TestDaemon): ProjectTarget {
  return { baseUrl: daemon.baseUrl, origin: daemon.origin, bearer: daemon.installationToken };
}

describe('single-entry multi-project BFF (WP-12 T5.5)', () => {
  let alpha: TestDaemon;
  let beta: TestDaemon;
  let auth: AuthService;
  let token: string;
  let server: Server;
  let baseUrl: string;
  let cookie: string;
  const roots: string[] = [];

  beforeAll(async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'agentdev-multi-auth-'));
    roots.push(stateDir);
    auth = AuthService.loadOrCreate({
      stateDir,
      config: { deployment: 'loopback', allowedOrigins: [WEB_ORIGIN] },
    });
    token = auth.createdToken ?? '';
    const alphaRoot = mkdtempSync(join(tmpdir(), 'agentdev-multi-alpha-'));
    const betaRoot = mkdtempSync(join(tmpdir(), 'agentdev-multi-beta-'));
    roots.push(alphaRoot, betaRoot);
    mkdirSync(join(alphaRoot, 'docs'), { recursive: true });
    mkdirSync(join(betaRoot, 'docs'), { recursive: true });

    alpha = await startTestDaemon({ projectRoot: alphaRoot, auth, installationToken: token });
    beta = await startTestDaemon({ projectRoot: betaRoot, auth, installationToken: token });

    // Distinguishing rows, so "A's content is not on B's page" is a real observation.
    seedRequirement(alpha, 'queued', undefined, 'ALPHA-ONLY-REQUIREMENT');
    seedRequirement(beta, 'queued', undefined, 'BETA-ONLY-REQUIREMENT');

    const entries = [entryOf(alpha, 'Alpha'), entryOf(beta, 'Beta')];
    const directory: ProjectDirectoryPort = {
      list: () => entries,
      entryOf: (projectId) => entries.find((entry) => entry.projectId === projectId),
      findByRoot: () => undefined,
      targetOf: (projectId) =>
        projectId === alpha.projectId
          ? targetOf(alpha)
          : projectId === beta.projectId
            ? targetOf(beta)
            : undefined,
      defaultProjectId: () => alpha.projectId,
      projectIdFor: () => alpha.projectId,
      open: () => Promise.resolve(entries[0] as ProjectEntry),
      create: () => Promise.resolve(entries[0] as ProjectEntry),
      clone: () => Promise.resolve(entries[0] as ProjectEntry),
      trust: () => entries[0] as ProjectEntry,
      close: () => entries[0] as ProjectEntry,
      initialize: () => Promise.resolve(entries[0] as ProjectEntry),
      problems: [],
    };

    const app = createWebApp({
      daemon: targetOf(alpha),
      projects: directory,
      auth,
      allowedOrigins: [WEB_ORIGIN],
      sessions: new WebSessionStore(),
      files: new NodeFilePort(),
      version: '0.0.0-test',
    });
    server = app.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address !== 'object') throw new Error('no BFF address');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;

    // One login for the whole installation.
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token }),
    });
    expect(login.status).toBe(200);
    cookie = cookieValue(login.headers.get('set-cookie') ?? '', 'agentdev_web') ?? '';
    expect(cookie).not.toBe('');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await alpha.close();
    await beta.close();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  async function page(path: string): Promise<string> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { cookie: `agentdev_web=${cookie}` },
    });
    return response.text();
  }

  async function rpc(method: string, params: Record<string, unknown>, projectId?: string) {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: WEB_ORIGIN,
        cookie: `agentdev_web=${cookie}`,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: `multi-${method}`,
        method,
        ...(projectId === undefined ? {} : { projectId }),
        params,
      }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('renders each project page from its own daemon and never from the other (AC-023/AC-034)', async () => {
    const alphaPage = await page(`/projects/${alpha.projectId}/requirements`);
    expect(alphaPage).toContain('ALPHA-ONLY-REQUIREMENT');
    expect(alphaPage).not.toContain('BETA-ONLY-REQUIREMENT');

    const betaPage = await page(`/projects/${beta.projectId}/requirements`);
    expect(betaPage).toContain('BETA-ONLY-REQUIREMENT');
    expect(betaPage).not.toContain('ALPHA-ONLY-REQUIREMENT');

    // The switcher offers both projects on every page, with the current one marked.
    expect(alphaPage).toContain('id="projectSwitcher"');
    expect(alphaPage).toContain(`href="/projects/${beta.projectId}/chief"`);
    expect(alphaPage).toContain('aria-current="page"');
  });

  it('routes /rpc by envelope projectId and fails closed for an unserved project (AC-034)', async () => {
    const alphaAnswer = await rpc('requirement.list', {}, alpha.projectId);
    expect(alphaAnswer.status).toBe(200);
    expect(JSON.stringify(alphaAnswer.body)).toContain('ALPHA-ONLY-REQUIREMENT');
    expect(JSON.stringify(alphaAnswer.body)).not.toContain('BETA-ONLY-REQUIREMENT');

    const betaAnswer = await rpc('requirement.list', {}, beta.projectId);
    expect(JSON.stringify(betaAnswer.body)).toContain('BETA-ONLY-REQUIREMENT');

    // A project this installation does not serve is refused, never answered from
    // another project (the isolation wall the ruling demands).
    const unknown = await rpc('requirement.list', {}, 'f'.repeat(32));
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(unknown.body)).not.toContain('ALPHA-ONLY-REQUIREMENT');
    expect(JSON.stringify(unknown.body)).not.toContain('BETA-ONLY-REQUIREMENT');
  });

  it('injects the routed projectId when the browser named none (D-T5-6)', async () => {
    // The browser omitted `projectId`; the BFF completes it with the routed project, so
    // the daemon's own `projectId !== this.projectId` wall has something to check.
    const withoutId = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: WEB_ORIGIN,
        cookie: `agentdev_web=${cookie}`,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: 'multi-no-project',
        method: 'project.snapshot.get',
        params: { scope: { kind: 'summary' } },
      }),
    });
    expect(withoutId.status).toBe(200);
    const body = (await withoutId.json()) as Record<string, unknown>;
    const result = body['result'] as Record<string, unknown>;
    // Without the injection the daemon would refuse the unscoped Project method; with
    // it, the answer is the default project's snapshot.
    expect(result['projectId']).toBe(alpha.projectId);
  });

  it('serves an artifact only through its own project route and rejects the token elsewhere (AC-034)', async () => {
    // A real artifact with real bytes in Alpha, staged through the real Attachment
    // and Artifact services (a user artifact bound to a real Work).
    const work = seedWork(alpha, {});
    const attachment = alpha.attachments.stage({
      conversationId: uuid('1'),
      ownerUserId: userIdFromSubject('installation:local'),
      mime: 'text/markdown',
      bytes: Buffer.from('ALPHA-ONLY-ARTIFACT-BYTES\n', 'utf8'),
    });
    const artifact = alpha.artifacts.createUser({ workId: work.id, attachment });
    const prepared = await rpc('artifact.download.prepare', { artifactId: artifact.id });
    expect(prepared.status).toBe(200);
    const downloadToken = (prepared.body['result'] as Record<string, unknown>)['downloadToken'];
    expect(typeof downloadToken).toBe('string');

    // Through Alpha's own project route the one-time token really serves the bytes.
    const own = await fetch(
      `${baseUrl}/artifacts/${alpha.projectId}/download/${String(downloadToken)}`,
      {
        headers: { cookie: `agentdev_web=${cookie}` },
      },
    );
    expect(own.status).toBe(200);
    const ownBody = await own.text();
    expect(ownBody).toContain('ALPHA-ONLY-ARTIFACT-BYTES');
    // …exactly once.
    const replay = await fetch(
      `${baseUrl}/artifacts/${alpha.projectId}/download/${String(downloadToken)}`,
      { headers: { cookie: `agentdev_web=${cookie}` } },
    );
    expect(replay.status).toBe(403);

    // The same artifact id and a fresh token through Beta's route must both be refused,
    // and neither refusal may carry Alpha's content.
    const preview = await fetch(`${baseUrl}/artifacts/${beta.projectId}/${artifact.id}/preview`, {
      headers: { cookie: `agentdev_web=${cookie}` },
    });
    expect(preview.status).toBeGreaterThanOrEqual(400);
    expect(await preview.text()).not.toContain('ALPHA-ONLY-ARTIFACT-BYTES');

    const second = await rpc('artifact.download.prepare', { artifactId: artifact.id });
    const secondToken = (second.body['result'] as Record<string, unknown>)['downloadToken'];
    const crossed = await fetch(
      `${baseUrl}/artifacts/${beta.projectId}/download/${String(secondToken)}`,
      { headers: { cookie: `agentdev_web=${cookie}` } },
    );
    expect(crossed.status).toBeGreaterThanOrEqual(400);
    expect(await crossed.text()).not.toContain('ALPHA-ONLY-ARTIFACT-BYTES');
  });

  it('binds the event socket to one project and never replays another project cursor (AC-034/AC-060)', async () => {
    // A real event in Alpha, and one in Beta, each on its own daemon.
    const alphaConversation = await rpc(
      'conversation.create',
      { title: 'ALPHA-ONLY-THREAD' },
      alpha.projectId,
    );
    expect(alphaConversation.status).toBe(200);
    const alphaConversationId = (
      (alphaConversation.body['result'] as Record<string, unknown>)['conversation'] as Record<
        string,
        unknown
      >
    )['id'];
    const betaConversation = await rpc(
      'conversation.create',
      { title: 'BETA-ONLY-THREAD' },
      beta.projectId,
    );
    const betaConversationId = (
      (betaConversation.body['result'] as Record<string, unknown>)['conversation'] as Record<
        string,
        unknown
      >
    )['id'];

    const alphaFrames = await subscribeOverBff(`/ws?projectId=${alpha.projectId}`);
    const alphaCursor = alphaFrames.cursor;
    expect(alphaCursor).toBeGreaterThan(0);

    // Beta's own stream replayed from its own zero carries Beta's event…
    const betaFresh = await subscribeOverBff(`/ws?projectId=${beta.projectId}`, 0);
    expect(JSON.stringify(betaFresh.frames)).toContain(String(betaConversationId));
    expect(JSON.stringify(betaFresh.frames)).not.toContain(String(alphaConversationId));

    // …and Alpha's cursor submitted on Beta's socket replays Beta's log, never Alpha's
    // events: the connection was bound to Beta at handshake time (D-T5-5).
    const crossed = await subscribeOverBff(`/ws?projectId=${beta.projectId}`, alphaCursor);
    const seen = JSON.stringify(crossed.frames);
    expect(seen).not.toContain(String(alphaConversationId));
    expect(seen).not.toContain('ALPHA-ONLY-THREAD');
    expect(betaFresh.subscriptionId).not.toBe(alphaFrames.subscriptionId);

    // A socket naming an unserved project is refused before the upgrade completes.
    await expect(subscribeOverBff(`/ws?projectId=${'e'.repeat(32)}`)).rejects.toThrowError();

    /** Opens the BFF socket, hellos, subscribes to the summary scope and collects frames. */
    async function subscribeOverBff(
      path: string,
      afterCursor?: number,
    ): Promise<{
      readonly cursor: number;
      readonly subscriptionId: string;
      readonly frames: readonly string[];
    }> {
      const wsUrl = `${baseUrl.replace('http', 'ws')}${path}`;
      return await new Promise((resolve, reject) => {
        const frames: string[] = [];
        const socket = new WebSocket(wsUrl, {
          headers: { cookie: `agentdev_web=${cookie}`, origin: WEB_ORIGIN },
        });
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error(`timed out on ${path}`));
        }, 5_000);
        socket.addEventListener('open', () => {
          socket.send(
            JSON.stringify({
              v: 1,
              type: 'request',
              id: 'cursor-hello',
              method: 'connection.hello',
              params: { protocolVersion: 1, client: 'web' },
            }),
          );
          socket.send(
            JSON.stringify({
              v: 1,
              type: 'request',
              id: 'cursor-sub',
              method: 'project.subscribe',
              params: {
                scope: { kind: 'summary' },
                ...(afterCursor === undefined ? {} : { afterCursor }),
              },
            }),
          );
        });
        let expectedSubscription: string | undefined;
        let cursor = 0;
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.close();
          resolve({ cursor, subscriptionId: expectedSubscription ?? '', frames });
        };
        socket.addEventListener('message', (event: { data?: unknown }) => {
          if (typeof event.data !== 'string') return;
          frames.push(event.data);
          const parsed = JSON.parse(event.data) as {
            id?: string;
            ok?: boolean;
            type?: string;
            subscriptionId?: string;
            result?: { cursor?: number; subscriptionId?: string };
          };
          if (parsed.id === 'cursor-sub') {
            if (parsed.ok !== true) {
              clearTimeout(timer);
              socket.close();
              reject(new Error(event.data));
              return;
            }
            cursor = parsed.result?.cursor ?? 0;
            expectedSubscription = parsed.result?.subscriptionId;
          }
          // The replayed events are sent before the batch watermark; wait for it so the
          // collected frames are the whole answer, not just its envelope.
          if (
            expectedSubscription !== undefined &&
            parsed.type === 'batch_end' &&
            parsed.subscriptionId === expectedSubscription
          ) {
            finish();
          }
        });
        socket.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error(`socket error on ${path}`));
        });
      });
    }
  });

  it('refuses an artifact URL that names no project (Q6 fail-closed)', async () => {
    const legacy = await fetch(`${baseUrl}/artifacts/download/some-token`, {
      headers: { cookie: `agentdev_web=${cookie}` },
    });
    expect(legacy.status).toBe(404);
    const legacyPreview = await fetch(`${baseUrl}/artifacts/${uuid('9')}/preview`, {
      headers: { cookie: `agentdev_web=${cookie}` },
    });
    // `uuid('9')` is not a served project id, so this is either "unserved project"
    // (404) — never an implicit fallback to the default project.
    expect(legacyPreview.status).toBe(404);
    expect(splitArtifactPath('/artifacts/download/token')).toBeUndefined();
    expect(splitArtifactPath('/artifacts/upload')).toBeUndefined();
    expect(splitArtifactPath(`/artifacts/${alpha.projectId}/download/token`)).toEqual({
      projectId: alpha.projectId,
      upstreamPath: '/artifacts/download/token',
    });
  });
});
