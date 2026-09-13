/**
 * WP-09 T4 required failure tests: 持续对话 / 过期卡片 / 窄屏焦点 / 断连 / 配置失败 / 订阅扩大.
 *
 * The six scenarios `docs/delivery/implementation.md` WP-09 names as mandatory are
 * exercised here against the same real stack the drill uses: real Git, real SQLite,
 * the real `WorkbenchProtocol` on loopback port 0 and the real BFF over a real
 * browser session. Each test fails if the corresponding behaviour regresses.
 *
 * Browser-only concerns (narrow-screen focus order and the client's disconnect
 * handling) are checked at the boundary that actually owns them: the rendered shell
 * plus the shipped `public/app.js`, asserted as source facts rather than simulated in
 * a headless DOM the product does not use.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
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
import { BlobStore, ProjectStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import type { WorkStatus } from '@agentdev/contracts';
import {
  WorkbenchProtocol,
  parseEnvelope,
  statusForCode,
  type WorkbenchAuthPort,
} from '../../daemon/src/protocol.js';
import { ProtocolClient, WebSocketTransport } from '@agentdev/client';
import { createWebApp } from '../src/app.js';
import { WebSessionStore } from '../src/sessions.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';
const uuid = (suffix: string): string => `018f2c1e-9a4b-7c3d-8e5f-${suffix.padStart(12, '0')}`;

interface Frame {
  readonly type?: string;
  readonly id?: string;
  readonly ok?: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string; readonly details?: unknown };
  readonly cursor?: number;
  readonly scannedThrough?: number;
  readonly name?: string;
  readonly entityId?: string;
  readonly subscriptionId?: string;
  readonly reason?: string;
  /** `bridge.open` reports how many subscriptions the bridge resumed. */
  readonly resumed?: number;
  readonly attempt?: number;
}

interface Harness {
  readonly web: Server;
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly projectId: string;
  readonly store: ProjectStore;
  readonly protocol: WorkbenchProtocol;
  readonly artifacts: ArtifactService;
  readonly gates: PlanGateService;
  readonly projectRoot: string;
  readonly stateDir: string;
  readonly installationToken: string;
  /** The provider the daemon's own configuration holds. */
  readonly providerId: string;
  readonly daemonServer: Server;
  login(): Promise<{ cookie: string; csrfToken: string }>;
  close(): Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t4f-root-')));
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t4f-data-')));
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t4f-state-')));
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  mkdirSync(join(projectRoot, 'docs'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'orders.ts'), 'export const orders = [];\n');
  writeFileSync(join(projectRoot, 'README.md'), '# failure fixture\n');

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
  // The one `ConfigStore` the daemon uses, seeded with a real provider profile so
  // the workbench can resolve a role at all.
  const config = ConfigStore.open({ globalDir: stateDir, projectRoot });
  const provider = config.upsertProvider({
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9/v1',
    enabled: true,
    models: [
      {
        id: 'fixture-model',
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        reasoningLevels: ['off', 'low'],
        vision: false,
      },
    ],
  });
  config.update('global', {
    roleOverrides: {
      chief: {
        providerId: provider.providerId,
        modelId: 'fixture-model',
        reasoning: 'off',
        skills: [],
        toolSubset: [],
        contextLimit: 32_000,
      },
    },
  });
  const gates = new PlanGateService({ store, artifacts, blobs });
  const protocol = new WorkbenchProtocol({
    store,
    blobs,
    events: new EventHub({ store }),
    attachments,
    artifacts,
    tokens: new DownloadTokenStore(),
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
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: 'a'.repeat(40),
  });
  store.conversations.insert({
    id: uuid('1'),
    projectId,
    title: 'chief conversation',
    archived: false,
  });

  const authPort = (): WorkbenchAuthPort => ({
    authenticate: (input) => {
      const decision = auth.authenticate(input);
      return decision.ok
        ? {
            ok: true,
            // T-01: identity is always the installation user; the session id stays an
            // audit subject only, exactly as `createDaemon` resolves it.
            subject: `user:${decision.session.id}`,
            userId: userIdFromSubject('installation:local'),
          }
        : {
            ok: false,
            status: decision.status,
            code: decision.code,
            message: decision.message,
          };
    },
    cookieOf: (request) => {
      const header = request.headers.cookie;
      if (typeof header !== 'string') return undefined;
      const entry = header
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('agentdev_session='));
      return entry?.slice('agentdev_session='.length);
    },
    bearerOk: (header) => auth.authenticateBearer(header).ok,
  });

  const daemonServer = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/healthz') {
        jsonResponse(response, 200, { version: '0.0.0-test', ready: true });
        return;
      }
      if (url.pathname === '/auth/login' && request.method === 'POST') {
        const parsed = JSON.parse((await readBody(request)).toString('utf8')) as {
          token?: unknown;
        };
        const result = auth.login({
          token: typeof parsed.token === 'string' ? parsed.token : '',
          ip: '127.0.0.1',
          ...(typeof request.headers.origin === 'string' ? { origin: request.headers.origin } : {}),
        });
        if (!result.ok) {
          jsonResponse(response, result.status, {
            ok: false,
            error: {
              code: 'UNAUTHENTICATED',
              message: result.status === 429 ? 'too many login attempts' : result.message,
              retryable: false,
            },
          });
          return;
        }
        response.setHeader('set-cookie', result.cookie);
        jsonResponse(response, 200, {
          csrfToken: result.csrfToken,
          expiresAt: new Date(result.expiresAt).toISOString(),
        });
        return;
      }
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        jsonResponse(response, 200, { status: 'applied', loggedOut: true });
        return;
      }
      if (url.pathname === '/rpc' && request.method === 'POST') {
        const raw = (await readBody(request)).toString('utf8');
        try {
          const envelope = parseEnvelope(JSON.parse(raw));
          const caller = protocol.authenticateRequest(request, authPort(), true);
          jsonResponse(response, 200, {
            v: 1,
            type: 'response',
            id: envelope.id,
            ok: true,
            result: protocol.dispatchEnvelope(envelope, caller),
          });
        } catch (error) {
          const failure = error as {
            status?: number;
            code?: string;
            message?: string;
            details?: Record<string, unknown>;
          };
          jsonResponse(
            response,
            failure.status ?? statusForCode(failure.code ?? 'INTERNAL_ERROR'),
            {
              ok: false,
              error: {
                code: failure.code ?? 'INTERNAL_ERROR',
                message: failure.message ?? 'failed',
                retryable: false,
                ...(failure.details === undefined ? {} : { details: failure.details }),
              },
            },
          );
        }
        return;
      }
      jsonResponse(response, 404, { ok: false, error: { code: 'NOT_FOUND' } });
    })();
  });
  daemonServer.on('upgrade', (request, socket) => {
    protocol.handleUpgrade(request, socket, authPort());
  });
  await new Promise<void>((resolve) => daemonServer.listen(0, '127.0.0.1', resolve));
  const daemonAddress = daemonServer.address();
  if (daemonAddress === null || typeof daemonAddress !== 'object') {
    throw new Error('the daemon has no address');
  }

  const sessions = new WebSessionStore();
  const app = createWebApp({
    daemon: {
      baseUrl: `http://127.0.0.1:${String(daemonAddress.port)}`,
      origin: WEB_ORIGIN,
      bearer: installationToken,
    },
    auth,
    allowedOrigins: [WEB_ORIGIN],
    sessions,
    version: '0.0.0-test',
  });
  const web = app.server;
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
  const webAddress = web.address();
  if (webAddress === null || typeof webAddress !== 'object') {
    throw new Error('the BFF has no address');
  }
  const baseUrl = `http://127.0.0.1:${String(webAddress.port)}`;

  return {
    web,
    daemonServer,
    baseUrl,
    wsUrl: `ws://127.0.0.1:${String(webAddress.port)}/ws`,
    projectId,
    store,
    protocol,
    artifacts,
    gates,
    projectRoot,
    stateDir,
    installationToken,
    providerId: provider.providerId,
    login: async () => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
        body: JSON.stringify({ token: installationToken }),
      });
      if (response.status !== 200) throw new Error(`login failed with ${String(response.status)}`);
      const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const body = (await response.json()) as { csrfToken: string };
      return { cookie, csrfToken: body.csrfToken };
    },
    close: async () => {
      protocol.closeAll();
      await new Promise<void>((resolve) => daemonServer.close(() => resolve()));
      await new Promise<void>((resolve) => web.close(() => resolve()));
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

/** A browser-side protocol client over the BFF's real `/ws` bridge. */
class BrowserSocket {
  readonly frames: Frame[] = [];
  private waiters: (() => void)[] = [];
  private readonly socket: WebSocket;

  constructor(url: string, cookie: string) {
    this.socket = new WebSocket(url, { headers: { cookie, origin: WEB_ORIGIN } });
    this.socket.addEventListener('message', (event: { data?: unknown }) => {
      if (typeof event.data !== 'string') return;
      this.frames.push(JSON.parse(event.data) as Frame);
      for (const waiter of this.waiters.splice(0)) waiter();
    });
    this.socket.addEventListener('error', () => undefined);
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

  async waitFor(predicate: (frame: Frame) => boolean, timeoutMs = 8_000): Promise<Frame> {
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

  close(): void {
    this.socket.close();
  }
}

/** A protocol `result` field as a string; `''` for anything that is not one. */
function text(result: Record<string, unknown> | undefined, key: string): string {
  const found = result?.[key];
  return typeof found === 'string' ? found : '';
}

function seedWork(
  harness: Harness,
  options: { readonly status?: WorkStatus; readonly goal?: string } = {},
): { readonly id: string } {
  const store = harness.store;
  const id = store.newId();
  const budget = store.budgets.insert({
    projectId: harness.projectId,
    workId: id,
    tokenLimit: 500_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 7_200,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  return store.works.insert({
    id,
    projectId: harness.projectId,
    intent: 'delivery',
    purpose: 'seed',
    level: 'L2',
    goal: options.goal ?? 'seed a work item',
    scope: {
      readPaths: ['src'],
      writePaths: ['src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
    status: options.status ?? 'queued',
    blockerIds: [],
    baseRevision: 'a'.repeat(40),
    budgetId: budget.id,
    policyRevision: 1,
  });
}

function seedRun(
  harness: Harness,
  input: { readonly workId: string; readonly epoch?: number },
): { readonly id: string } {
  const store = harness.store;
  const id = store.newId();
  const run = store.runs.insert({
    id,
    projectId: harness.projectId,
    workId: input.workId,
    role: 'backend',
    purpose: 'implementation',
    stage: 'execute',
    status: 'running',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: sha256(`config:${id}`),
    contextSnapshotId: sha256(`context:${id}`),
    dispatchSnapshotId: sha256(`dispatch:${id}`),
    budgetAllocation: 10_000,
  });
  store.attempts.insert({
    id: store.newId(),
    projectId: harness.projectId,
    runId: id,
    number: 1,
    status: 'running',
    ownerEpoch: input.epoch ?? 3,
    runnerId: 'runner-1',
  });
  return run;
}

function seedRequirement(
  harness: Harness,
  lifecycle: 'queued' | 'active' | 'completed',
  workId: string | undefined,
  title: string,
): { readonly id: string } {
  const id = harness.store.newId();
  return harness.store.requirements.insert({
    id,
    projectId: harness.projectId,
    ...(workId === undefined ? {} : { workId }),
    title,
    goal: 'keep the delivered behaviour stable',
    lifecycle,
    sourceRef: { kind: 'git', id: uuid('42'), version: '1', path: '.agentdev/requirements' },
    recordVersion: 1,
    portableRef: {
      path: `.agentdev/requirements/${id}`,
      revision: 'a'.repeat(40),
      hash: sha256(`record:${id}`),
    },
    executionAvailability: workId === undefined ? 'needs_replan' : 'local',
    evidenceAvailability: 'summary_only',
  });
}

describe('WP-09 T4 required failure tests', () => {
  let harness: Harness;
  let cookie: string;
  let csrfToken: string;
  const sockets: BrowserSocket[] = [];

  beforeAll(async () => {
    harness = await startHarness();
    ({ cookie, csrfToken } = await harness.login());
  });

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await harness.close();
  });

  const rpc = async (
    method: string,
    params: Record<string, unknown> = {},
    options: {
      readonly projectId?: string;
      readonly idempotencyKey?: string;
      readonly expectedVersion?: number;
    } = {},
  ): Promise<{ status: number; frame: Frame }> => {
    const response = await fetch(`${harness.baseUrl}/rpc`, {
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
        id: `t4f-${String(Math.random()).slice(2, 10)}`,
        method,
        projectId: options.projectId ?? harness.projectId,
        params,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        ...(options.expectedVersion === undefined
          ? {}
          : { expectedVersion: options.expectedVersion }),
      }),
    });
    return { status: response.status, frame: (await response.json()) as Frame };
  };

  const page = async (path: string): Promise<{ status: number; html: string }> => {
    const response = await fetch(`${harness.baseUrl}${path}`, {
      headers: { accept: 'text/html', cookie },
    });
    return { status: response.status, html: await response.text() };
  };

  // -------------------------------------------------------------------------
  // 持续对话 — the conversation never blocks on a stage
  // -------------------------------------------------------------------------

  it('持续对话: keeps the conversation usable at every stage and routes the opinion (AC-069)', async () => {
    const work = seedWork(harness, { status: 'running', goal: 'keep working' });
    seedRun(harness, { workId: work.id });
    seedRequirement(harness, 'active', work.id, 'active requirement');
    seedRequirement(harness, 'completed', undefined, 'completed requirement');
    const stages = ['running', 'completed', 'queued'] as const;
    for (const stage of stages) {
      if (stage !== 'running') seedWork(harness, { status: stage });
    }

    // Sending a message while work is active returns a real Work and a real event.
    const before = harness.store.events.latestCursor();
    const sent = await rpc(
      'conversation.message.send',
      {
        conversationId: uuid('1'),
        body: '说明一下当前交付状态，然后修改 src/orders.ts',
        attachmentIds: [],
      },
      { idempotencyKey: 't4f-continuous-1' },
    );
    expect(sent.frame.ok).toBe(true);
    const workId = text(sent.frame.result, 'workId');
    expect(workId).not.toBe('');
    expect(harness.store.events.latestCursor()).toBeGreaterThan(before);
    // The Chief's router split the message into an explanation Work and a real
    // authorized modification Work, recorded on each Work's own assessment row.
    const workIds = (sent.frame.result?.['workIds'] as string[] | undefined) ?? [];
    expect(workIds.length).toBeGreaterThanOrEqual(2);
    const reasons = workIds
      .map(
        (id) =>
          harness.store.assessments
            .list({ where: 'work_id = ?', params: [id], orderBy: 'created_at ASC' })
            .at(-1)?.reason ?? '',
      )
      .filter((reason) => reason !== '');
    expect(reasons.join(' | ')).toContain('mixed message');
    const intents = workIds.map((id) => harness.store.works.find(id)?.intent);
    expect(intents).toContain('delivery');
    expect(intents).toContain('assist');

    // The message is persisted at `received`; the server decides every later state.
    const recorded = harness.store.messages.list({
      where: 'conversation_id = ?',
      params: [uuid('1')],
      orderBy: 'seq ASC',
    });
    expect(recorded.at(-1)?.state).toBe('received');

    // The Composer is still there with its send control enabled — no stage blocks it.
    const chief = await page(`/projects/${harness.projectId}/chief`);
    expect(chief.status).toBe(200);
    expect(chief.html).toContain('id="composer"');
    expect(chief.html).toContain('id="composerBody"');
    expect(chief.html).not.toMatch(/id="composerSend"[^>]*disabled/u);
    expect(chief.html).toContain(`data-state="received"`);
    expect(chief.html).toContain('data-translatable="false"');

    // A second message in the same conversation succeeds immediately and the
    // conversation sequence advances: the dialogue is continuous, not queued behind
    // the previous message's processing.
    const second = await rpc(
      'conversation.message.send',
      { conversationId: uuid('1'), body: '补充：请一并更新测试', attachmentIds: [] },
      { idempotencyKey: 't4f-continuous-2' },
    );
    expect(second.frame.ok).toBe(true);
    const rows = harness.store.messages.list({
      where: 'conversation_id = ?',
      params: [uuid('1')],
      orderBy: 'seq ASC',
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.seq).toBe(1);
    expect(rows[1]?.seq).toBe(2);
    expect(new Set(rows.map((row) => row.seq)).size).toBe(rows.length);
  });

  // -------------------------------------------------------------------------
  // 过期卡片 — expired Plan and Decision cards
  // -------------------------------------------------------------------------

  it('过期卡片: refuses an expired Plan card with the live version and disables it (AC-070/AC-074)', async () => {
    const store = harness.store;
    const work = seedWork(harness, { status: 'running' });
    const authorization = store.authorizations.insert({
      projectId: harness.projectId,
      workId: work.id,
      sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
      goal: 'expire the card',
      scope: {
        readPaths: ['src'],
        writePaths: ['src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      operations: ['read', 'edit'],
      acceptedAt: new Date().toISOString(),
    });
    const planningRun = seedRun(harness, { workId: work.id });
    const submitted = harness.gates.submitPlan({
      workId: work.id,
      revision: 'a'.repeat(40),
      plan: {
        goal: 'expire the card',
        scope: {
          readPaths: ['src'],
          writePaths: ['src'],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
        tasks: [
          {
            id: store.newId(),
            role: 'backend',
            goal: 'edit the orders module',
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
        at: '2026-09-11T00:00:00.000Z',
      },
    });
    if (!submitted.approved) throw new Error(`the plan was refused: ${submitted.message}`);
    const liveVersion = submitted.planRef.version;

    const requirement = seedRequirement(harness, 'active', work.id, 'card detail');
    const stale = await rpc(
      'plan.approve',
      {
        workId: work.id,
        revision: 'a'.repeat(40),
        planVersion: liveVersion - 1,
        plan: { goal: 'old', scope: {}, tasks: [] },
        approval: { authorizationRef: authorization.id, runId: planningRun.id },
      },
      { idempotencyKey: `t4f-expired-plan-${work.id}`, expectedVersion: liveVersion - 1 },
    );
    expect(stale.frame.ok).toBe(false);
    expect(stale.frame.error?.code).toBe('VERSION_CONFLICT');
    expect((stale.frame.error?.details as { currentVersion?: number })?.currentVersion).toBe(
      liveVersion,
    );

    // A card asked for an older version renders that version as expired — disabled
    // with a visible reason — so the conflict precedes the click (W9R1-02).
    const card = await page(
      `/projects/${harness.projectId}/requirements/${requirement.id}?planVersion=${String(liveVersion - 1)}`,
    );
    expect(card.html).toContain(`data-current-version="${String(liveVersion)}"`);
    expect(card.html).toContain(`data-requested-version="${String(liveVersion - 1)}"`);
    expect(card.html).toContain('data-expired="true"');
    expect(card.html).toContain('id="planExpired"');
    expect(card.html).toContain('data-approvable="false"');
    expect(card.html).toMatch(/id="approvePlan"[^>]*disabled/u);
    expect(card.html).toContain('data-i18n="detail.approve"');

    // The same page asked for the version the gate holds is approvable again.
    const current = await page(
      `/projects/${harness.projectId}/requirements/${requirement.id}?planVersion=${String(liveVersion)}`,
    );
    expect(current.html).toContain(`data-plan-version="${String(liveVersion)}"`);
    expect(current.html).toContain('data-expired="false"');
    expect(current.html).toContain(
      `id="approvePlan" data-work="${work.id}" data-plan-version="${String(liveVersion)}"`,
    );
    expect(current.html).not.toMatch(/id="approvePlan"[^>]*disabled/u);

    // An expired decision card is inert on the server as well.
    const expired = store.decisions.insert({
      id: store.newId(),
      projectId: harness.projectId,
      workId: work.id,
      kind: 'start',
      targetRef: { id: uuid('70'), version: 2, hash: sha256('expired') },
      choices: ['now', 'later', 'decline'],
      state: 'expired',
      actor: 'user',
      effectRefs: [],
    });
    const refused = await rpc(
      'decision.resolve',
      { decisionId: expired.id, targetVersion: 2, choice: 'now' },
      { idempotencyKey: `t4f-expired-decision-${expired.id}` },
    );
    expect(refused.frame.ok).toBe(false);
    expect(refused.frame.error?.code).toBe('INVALID_STATE');
    const inbox = await page(`/projects/${harness.projectId}/inbox`);
    expect(inbox.html).toMatch(
      new RegExp(`data-decision="${expired.id}"[^>]*aria-disabled="true"`, 'u'),
    );
    expect(harness.store.decisions.find(expired.id)?.state).toBe('expired');
  });

  // -------------------------------------------------------------------------
  // 窄屏焦点 — the three-state dock, narrow overlay and the top-bar restore
  // -------------------------------------------------------------------------

  it('窄屏焦点: keeps dock focus order, the overlay close and the top-bar restore (AC-071/AC-073)', async () => {
    const rendered = await page(`/projects/${harness.projectId}/requirements`);
    expect(rendered.status).toBe(200);

    // The mode lives on the shell, so the first paint never flashes the wrong layout.
    expect(rendered.html).toMatch(/id="shell"[^>]*data-panel-mode="(open|compact|hidden)"/u);
    // The top-bar control precedes the dock in DOM order and controls it.
    const toggleAt = rendered.html.indexOf('id="liveDockToggle"');
    const dockAt = rendered.html.indexOf('id="liveDock"');
    expect(toggleAt).toBeGreaterThan(-1);
    expect(dockAt).toBeGreaterThan(toggleAt);
    expect(rendered.html).toMatch(/id="liveDockToggle"[^>]*aria-controls="liveDock"/u);
    // The dock exposes a close control (the narrow-screen overlay's way out) and the
    // top-bar counter that restores it.
    expect(rendered.html).toContain('id="liveDockClose"');
    expect(rendered.html).toContain('id="liveCount"');
    expect(rendered.html).toContain('aria-live="polite"');

    // Focus and mode behaviour is a client fact: assert the shipped script really
    // implements restore-to-trigger, no request on a mode change, and the three modes.
    const script = readFileSync(
      fileURLToPath(new URL('../public/app.js', import.meta.url)),
      'utf8',
    );
    expect(script).toContain('toggle.focus()');
    expect(script).toContain('liveDockClose');
    expect(script).toMatch(/index \+ 1\) % panelModes\.length/u);
    expect(script).not.toMatch(/setPanelMode[\s\S]{0,400}?fetch\(/u);

    // The panel mode is presentation only: switching it changes no Work and sends no
    // command, and an in-flight Run keeps running.
    const work = seedWork(harness, { status: 'running' });
    seedRun(harness, { workId: work.id, epoch: 11 });
    const modes = ['open', 'compact', 'hidden'] as const;
    for (const mode of modes) {
      const response = await fetch(
        `${harness.baseUrl}/projects/${harness.projectId}/requirements`,
        {
          headers: { accept: 'text/html', cookie: `${cookie}; agentdev_panel=${mode}` },
        },
      );
      const html = await response.text();
      expect(html, mode).toMatch(new RegExp(`id="shell"[^>]*data-panel-mode="${mode}"`, 'u'));
      expect(html, mode).toContain('id="liveDockToggle"');
    }
    expect(harness.store.works.find(work.id)?.status).toBe('running');
    expect(harness.store.runs.count('work_id = ?', [work.id])).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 归属 — the Chief conversation controls are real, not dead (AC-072)
  // -------------------------------------------------------------------------

  it('Chief: renders only conversation controls that a real method backs (AC-072, W9R1-07)', async () => {
    const chief = await page(`/projects/${harness.projectId}/chief`);
    expect(chief.status).toBe(200);
    const script = readFileSync(
      fileURLToPath(new URL('../public/app.js', import.meta.url)),
      'utf8',
    );
    // Every conversation control the Chief page renders has a listener in the shipped
    // script and a daemon method behind it; a control that cannot act is a dead
    // control (`experience.md` §1).
    for (const id of [
      'newConversation',
      'newConversationInline',
      'switchConversation',
      'conversationSelect',
    ]) {
      expect(chief.html, id).toContain(`id="${id}"`);
      expect(script, id).toContain(`'${id}'`);
    }
    expect(script).toContain('initConversations');
    expect(script).toContain("rpc(\n      'conversation.create'");

    // The control performs a real, durable creation: a new conversation row plus a
    // `conversation.created` event, and the page can then open it.
    const before = harness.store.conversations.count();
    const created = await rpc(
      'conversation.create',
      { title: 'a real chief conversation' },
      { idempotencyKey: 'w9r1-07-create' },
    );
    expect(created.frame.ok, JSON.stringify(created.frame.error)).toBe(true);
    const conversationId = text(created.frame.result ?? {}, 'conversationId');
    expect(conversationId).not.toBe('');
    expect(harness.store.conversations.count()).toBe(before + 1);
    expect(harness.store.conversations.find(conversationId)?.title).toBe(
      'a real chief conversation',
    );
    const events = harness.store.events.readAfter(0, { limit: 200 });
    expect(events.some((event) => event.name === 'conversation.created')).toBe(true);

    // Switch: the Chief page really reads the requested conversation.
    const switched = await page(
      `/projects/${harness.projectId}/chief?conversationId=${encodeURIComponent(conversationId)}`,
    );
    expect(switched.html).toContain(`data-conversation="${conversationId}"`);
    expect(switched.html).toContain('a real chief conversation');

    // A creation against a Work that does not exist is refused, not fabricated.
    const refused = await rpc(
      'conversation.create',
      { title: 'ghost', focusWorkId: uuid('99') },
      { idempotencyKey: 'w9r1-07-ghost' },
    );
    expect(refused.frame.ok).toBe(false);
    expect(refused.frame.error?.code).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // 桥接 — the BFF `/ws` bridge is a transport, not a translation layer (W9R1-08)
  // -------------------------------------------------------------------------

  it('forwards idempotencyKey and expectedVersion over the /ws bridge (W9R1-08)', async () => {
    // A paused Work, so `work.control resume` is a real write that reaches the
    // version check instead of stopping at an `INVALID_STATE`.
    const work = seedWork(harness, { status: 'running' });
    const paused = await rpc(
      'work.control',
      { action: 'pause', workId: work.id, reason: 'w9r1-08' },
      { idempotencyKey: 'w9r1-08-pause' },
    );
    expect(paused.frame.ok, JSON.stringify(paused.frame.error)).toBe(true);
    expect(harness.store.works.find(work.id)?.status).toBe('paused');

    const socket = new BrowserSocket(harness.wsUrl, cookie);
    sockets.push(socket);
    await socket.opened();
    socket.send({
      v: 1,
      type: 'request',
      id: 'hello-write',
      method: 'connection.hello',
      params: { protocolVersion: 1, client: 'web' },
    });
    expect((await socket.waitFor((frame) => frame.id === 'hello-write')).ok).toBe(true);

    // The browser writes over `/ws` with its own envelope semantics; the bridge must
    // carry both fields through, or the daemon silently ignores them and this
    // expectedVersion never reaches the Work's version check.
    socket.send({
      v: 1,
      type: 'request',
      id: 'ws-write',
      method: 'work.control',
      params: { action: 'resume', workId: work.id },
      idempotencyKey: 'w9r1-08-resume',
      expectedVersion: 999,
    });
    const first = await socket.waitFor((frame) => frame.id === 'ws-write');
    expect(first.ok).toBe(false);
    expect(first.error?.code).toBe('VERSION_CONFLICT');
    expect(JSON.stringify(first.error?.details ?? {})).toContain('999');
    // The refused write changed nothing: the Work is still paused.
    expect(harness.store.works.find(work.id)?.status).toBe('paused');

    // The same key and payload travel as one command: the daemon replays the recorded
    // answer, which it can only do if the idempotency key arrived.
    socket.send({
      v: 1,
      type: 'request',
      id: 'ws-write-again',
      method: 'work.control',
      params: { action: 'resume', workId: work.id },
      idempotencyKey: 'w9r1-08-resume',
      expectedVersion: 999,
    });
    const replayed = await socket.waitFor((frame) => frame.id === 'ws-write-again');
    expect(replayed.ok).toBe(first.ok);
    expect(replayed.error?.code).toBe(first.error?.code);
    expect(replayed.error?.details).toEqual(first.error?.details);

    // A successful write over the bridge is recorded in the same ledger as an HTTP
    // write, under the bridge's own installation subject.
    socket.send({
      v: 1,
      type: 'request',
      id: 'ws-ok',
      method: 'work.control',
      params: { action: 'resume', workId: work.id },
      idempotencyKey: 'w9r1-08-resume-ok',
      expectedVersion: harness.store.works.find(work.id)?.version ?? 1,
    });
    const accepted = await socket.waitFor((frame) => frame.id === 'ws-ok');
    expect(accepted.ok, JSON.stringify(accepted.error)).toBe(true);
    expect(harness.store.works.find(work.id)?.status).toBe('running');
    const recorded = harness.store.commands.lookup(
      'installation:local',
      'work.control',
      'w9r1-08-resume-ok',
    );
    expect(recorded?.state).toBe('completed');
    expect(recorded?.response).toEqual(accepted.result);
  });

  // -------------------------------------------------------------------------
  // 断连 — disconnected, reconnected, nothing lost
  // -------------------------------------------------------------------------

  it('断连: reports the break, replays from the watermark and keeps the Work (AC-078/AC-069)', async () => {
    const work = seedWork(harness, { status: 'running' });
    seedRun(harness, { workId: work.id, epoch: 9 });

    const socket = new BrowserSocket(harness.wsUrl, cookie);
    sockets.push(socket);
    await socket.opened();
    socket.send({
      v: 1,
      type: 'request',
      id: 'hello',
      method: 'connection.hello',
      params: { protocolVersion: 1, client: 'web' },
    });
    expect((await socket.waitFor((frame) => frame.id === 'hello')).ok).toBe(true);

    socket.send({
      v: 1,
      type: 'request',
      id: 'sub',
      method: 'project.subscribe',
      projectId: harness.projectId,
      params: { scope: { kind: 'summary' } },
    });
    const subscribed = await socket.waitFor((frame) => frame.id === 'sub');
    expect(subscribed.ok).toBe(true);
    const subscriptionId = text(subscribed.result, 'subscriptionId');
    expect(subscriptionId).not.toBe('');
    await socket.waitFor((frame) => frame.type === 'batch_end');

    // A real event arrives while the connection is up.
    await rpc(
      'conversation.message.send',
      { conversationId: uuid('1'), body: 'before the break', attachmentIds: [] },
      { idempotencyKey: 't4f-before-break' },
    );
    const event = await socket.waitFor(
      (frame) => frame.type === 'event' && frame.name === 'message.received',
    );
    const watermark = Number(event.cursor ?? 0);
    expect(watermark).toBeGreaterThan(0);
    socket.send({
      v: 1,
      type: 'request',
      id: 'ack',
      method: 'project.events.ack',
      params: { subscriptionId, cursor: watermark },
    });
    expect((await socket.waitFor((frame) => frame.id === 'ack')).ok).toBe(true);

    // The daemon connection breaks: the bridge tells the browser and reconnects.
    harness.protocol.closeAll(1001, 'network dropped');
    const notice = await socket.waitFor((frame) => frame.type === 'bridge.reconnecting');
    // The notice carries the real reconnect attempt, not a vacuous `|| true` (W9R2-06).
    expect(Number.isInteger(notice.attempt) && (notice.attempt ?? 0) > 0).toBe(true);

    // The background Work is untouched by the disconnect.
    expect(harness.store.works.find(work.id)?.status).toBe('running');

    // Events committed while the bridge was down are not lost: the bridge itself
    // re-subscribes from the watermark it tracked and replays the newer ones on the
    // same browser socket (AC-054, W9R1-11). No second browser socket is opened.
    await rpc(
      'conversation.message.send',
      { conversationId: uuid('1'), body: 'during the break', attachmentIds: [] },
      { idempotencyKey: 't4f-during-break' },
    );
    const reopeningAt = socket.frames.length;
    expect(socket.frames.some((frame) => frame.type === 'bridge.open')).toBe(true);
    const reopened = await socket.waitFor(
      (frame) => frame.type === 'bridge.open' && socket.frames.indexOf(frame) >= reopeningAt,
      15_000,
    );
    // The bridge itself resumed the subscription it was tracking: the reconnect is
    // observed on the same browser socket, not inferred from a new one (W9R1-11).
    expect(reopened['resumed']).toBe(1);
    const replayedOnSameSocket = await socket.waitFor(
      (frame) =>
        frame.type === 'event' &&
        frame.name === 'message.received' &&
        (frame.cursor ?? 0) > watermark,
      15_000,
    );
    expect(replayedOnSameSocket.cursor).toBeGreaterThan(watermark);
    await socket.waitFor((frame) => frame.type === 'batch_end', 15_000);
    // Nothing at or below the watermark was delivered twice after the reconnect
    // (the pre-break delivery itself is above the split point, not a duplicate).
    const duplicated = socket.frames
      .slice(reopeningAt)
      .filter((frame) => frame.type === 'event' && (frame.cursor ?? 0) <= watermark);
    expect(duplicated).toEqual([]);
    // The bridge replayed through the browser socket: the resumed events and batch
    // delimiter arrived there, without a second browser subscription request.
    const batchEndsAfterBreak = socket.frames
      .slice(reopeningAt)
      .filter((frame) => frame.type === 'batch_end');
    expect(batchEndsAfterBreak.length).toBeGreaterThan(0);
    expect(
      socket.frames
        .slice(reopeningAt)
        .some((frame) => frame.type === 'event' && (frame.cursor ?? 0) > watermark),
    ).toBe(true);
    // A fresh socket resuming from the same watermark sees the same newer events and
    // no duplicates, so the bridge's replay is the same contract as a new reconnect.
    const resumed = new BrowserSocket(harness.wsUrl, cookie);
    sockets.push(resumed);
    await resumed.opened();
    resumed.send({
      v: 1,
      type: 'request',
      id: 'hello2',
      method: 'connection.hello',
      params: { protocolVersion: 1, client: 'web' },
    });
    await resumed.waitFor((frame) => frame.id === 'hello2');
    resumed.send({
      v: 1,
      type: 'request',
      id: 'sub2',
      method: 'project.subscribe',
      projectId: harness.projectId,
      params: { scope: { kind: 'summary' }, afterCursor: watermark },
    });
    const replay = await resumed.waitFor((frame) => frame.id === 'sub2');
    expect(replay.ok).toBe(true);
    expect(replay.result?.['mode']).toBe('replay');
    await resumed.waitFor((frame) => frame.type === 'batch_end');
    const replayed = resumed.frames.filter(
      (frame) => frame.type === 'event' && (frame.cursor ?? 0) <= watermark,
    );
    expect(replayed).toEqual([]);
    const newer = resumed.frames.filter(
      (frame) => frame.type === 'event' && (frame.cursor ?? 0) > watermark,
    );
    expect(newer.length).toBeGreaterThan(0);

    // The client script shows the honest disconnected state and schedules a bounded,
    // exponential retry with a finite attempt cap (W9R1-10): no fixed 2s loop.
    const script = readFileSync(
      fileURLToPath(new URL('../public/app.js', import.meta.url)),
      'utf8',
    );
    expect(script).toContain("showConnection('reconnecting')");
    expect(script).toContain('connection.reconnecting');
    expect(script).toContain('const reconnectPolicy');
    expect(script).toContain('maxAttempts');
    expect(script).toMatch(/baseDelayMs:\s*1000/u);
    expect(script).toMatch(/maxDelayMs:\s*30000/u);
    expect(script).toMatch(/window\.setTimeout\(openSocket, delay\)/u);
    expect(script).not.toMatch(/setTimeout\(openSocket, 2000\)/u);
    expect(script).toContain('reconnectDelay');
    expect(script).toContain('afterCursor');
    // The renderer offers the documented wording for a lost connection.
    const rendered = await page(`/projects/${harness.projectId}/chief`);
    expect(rendered.html).toContain('data-connection=');
    expect(rendered.html).toContain('id="connectionState"');
    expect(rendered.html).toContain('id="liveReconnect"');
  });

  // -------------------------------------------------------------------------
  // 配置失败 — a provider failure never loses the input or the active config
  // -------------------------------------------------------------------------

  it('配置失败: reports an unusable provider, preserves the input and the revision (AC-075)', async () => {
    const before = await rpc('config.get', { scope: 'global' });
    const revision = Number(before.frame.result?.['revision'] ?? -1);
    expect(revision).toBeGreaterThan(0);
    // The seeded profile resolves, so the installation is usable before the failure.
    const working = await rpc(
      'config.test',
      { role: 'chief' },
      { idempotencyKey: 't4f-config-ok' },
    );
    expect(working.frame.ok).toBe(true);
    expect(working.frame.result?.['reasoning']).toBe('off');

    // The model really cannot reason at the requested level. The structural Schema
    // accepts the patch, and the honest refusal comes from profile resolution: the
    // level is named and the caller's input is handed back.
    const saved = await rpc(
      'config.save',
      { scope: 'global', patch: { roleOverrides: { chief: { reasoning: 'high' } } } },
      { idempotencyKey: 't4f-config-save', expectedVersion: revision },
    );
    expect(saved.frame.ok).toBe(true);
    expect(saved.frame.result?.['revision']).toBe(revision + 1);

    const tested = await rpc(
      'config.test',
      { role: 'chief' },
      { idempotencyKey: 't4f-config-test' },
    );
    expect(tested.frame.ok).toBe(false);
    expect(tested.frame.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(tested.frame.error?.message ?? '').toContain('does not support reasoning high');
    expect(
      JSON.stringify(
        (tested.frame.error?.details as { preservedInput?: unknown } | undefined)?.preservedInput ??
          {},
      ),
    ).toContain('chief');

    // The user restores the working profile with the input preserved in the editor,
    // and the active configuration resolves again.
    const restored = await rpc(
      'config.save',
      { scope: 'global', patch: { roleOverrides: { chief: { reasoning: 'off' } } } },
      { idempotencyKey: 't4f-config-restore', expectedVersion: revision + 1 },
    );
    expect(restored.frame.ok).toBe(true);
    expect(restored.frame.result?.['revision']).toBe(revision + 2);
    const active = await rpc(
      'config.test',
      { role: 'chief' },
      { idempotencyKey: 't4f-config-ok2' },
    );
    expect(active.frame.ok).toBe(true);
    expect(active.frame.result?.['reasoning']).toBe('off');

    const settings = await page('/settings');
    expect(settings.html).toContain(`data-revision="${String(revision + 2)}"`);
    expect(settings.html).toContain(`data-provider="${harness.providerId}"`);
    expect(settings.html).toContain('id="configPatch"');

    // The rejected patch text is still the textarea's content, so an edit is never
    // discarded by a refusal.
    const script = readFileSync(
      fileURLToPath(new URL('../public/app.js', import.meta.url)),
      'utf8',
    );
    expect(script).toContain("getElementById('configPatch')");
    expect(script).toContain('input preserved');
  });

  // -------------------------------------------------------------------------
  // 订阅扩大 — widening a subscription is refused, never leaked
  // -------------------------------------------------------------------------

  it('订阅扩大: refuses a cross-Project widening and answers a fresh scoped snapshot (AC-054/AC-078)', async () => {
    const otherProjectId = 'f'.repeat(32);
    const work = seedWork(harness, { status: 'running' });
    const run = seedRun(harness, { workId: work.id, epoch: 4 });

    const socket = new BrowserSocket(harness.wsUrl, cookie);
    sockets.push(socket);
    await socket.opened();
    socket.send({
      v: 1,
      type: 'request',
      id: 'hello',
      method: 'connection.hello',
      params: { protocolVersion: 1, client: 'web' },
    });
    await socket.waitFor((frame) => frame.id === 'hello');

    // 1) A subscription for another Project is refused before any snapshot exists,
    //    and the refusal names no other Project's data.
    socket.send({
      v: 1,
      type: 'request',
      id: 'foreign',
      method: 'project.subscribe',
      projectId: otherProjectId,
      params: { scope: { kind: 'summary' } },
    });
    const foreign = await socket.waitFor((frame) => frame.id === 'foreign');
    expect(foreign.ok).toBe(false);
    expect(foreign.error?.code).toBe('NOT_FOUND');
    // The caller learns only that the subscription was refused: no snapshot, no
    // counts, no subscription id and no event crosses the boundary. (The daemon's
    // `details.openProjectId` echoes this installation's own id; reported as a T2
    // residual rather than relied on here.)
    expect(foreign.result).toBeUndefined();
    const refused = foreign.error as { details?: { snapshot?: unknown } } | undefined;
    expect(refused?.details?.snapshot).toBeUndefined();
    expect(foreign.subscriptionId).toBeUndefined();
    expect(socket.frames.some((frame) => frame.type === 'event')).toBe(false);
    expect(socket.frames.some((frame) => frame.type === 'batch_end')).toBe(false);
    expect((foreign.error?.message ?? '').includes(String(harness.projectId))).toBe(false);

    // 2) The same widening through `subscription.set` is refused too.
    socket.send({
      v: 1,
      type: 'request',
      id: 'sub',
      method: 'project.subscribe',
      projectId: harness.projectId,
      params: { scope: { kind: 'summary' } },
    });
    const subscribed = await socket.waitFor((frame) => frame.id === 'sub');
    expect(subscribed.ok).toBe(true);
    const subscriptionId = text(subscribed.result, 'subscriptionId');
    await socket.waitFor((frame) => frame.type === 'batch_end');

    socket.send({
      v: 1,
      type: 'request',
      id: 'unknown-sub',
      method: 'subscription.set',
      projectId: harness.projectId,
      params: { subscriptionId: 'sub-does-not-exist', scope: { kind: 'work', id: work.id } },
    });
    const unknown = await socket.waitFor((frame) => frame.id === 'unknown-sub');
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe('NOT_FOUND');

    socket.send({
      v: 1,
      type: 'request',
      id: 'bad-kind',
      method: 'subscription.set',
      projectId: harness.projectId,
      params: { subscriptionId, scope: { kind: 'everything' } },
    });
    const badKind = await socket.waitFor((frame) => frame.id === 'bad-kind');
    expect(badKind.ok).toBe(false);
    expect(badKind.error?.code).toBe('VALIDATION_ERROR');

    // 3) A legitimate widening inside the Project answers a fresh snapshot at a new
    //    watermark and only then streams events for the enlarged scope.
    socket.send({
      v: 1,
      type: 'request',
      id: 'widen',
      method: 'subscription.set',
      projectId: harness.projectId,
      params: { subscriptionId, scope: { kind: 'work', id: work.id } },
    });
    const widened = await socket.waitFor((frame) => frame.id === 'widen');
    expect(widened.ok).toBe(true);
    const snapshot = widened.result?.['snapshot'] as { kind?: string; work?: { id?: string } };
    expect(snapshot.kind).toBe('work');
    expect(snapshot.work?.id).toBe(work.id);
    const widenedCursor = Number(widened.result?.['cursor'] ?? 0);
    expect(widenedCursor).toBeGreaterThan(0);
    await socket.waitFor((frame) => frame.type === 'batch_end');
    expect(harness.protocol.connectionCount).toBeGreaterThanOrEqual(1);
    expect(harness.store.runs.find(run.id)?.workId).toBe(work.id);
  });

  it('订阅扩大: refuses an out-of-authorisation scope locally, with no request sent (AC-054)', async () => {
    const client = new ProtocolClient({
      transport: new WebSocketTransport({
        url: harness.wsUrl,
        headers: { cookie, origin: WEB_ORIGIN },
      }),
      // The session may only observe its own Project's summary and work scopes.
      isProjectAuthorized: (projectId) => projectId === harness.projectId,
      allowedKinds: ['summary', 'work'],
    });
    try {
      await client.connect();
      await client.waitUntilOpen();
      const foreign = await client
        .subscribe({ projectId: 'e'.repeat(32), scope: { kind: 'summary' } })
        .then(
          () => undefined,
          (error: unknown) => error as { code?: string },
        );
      expect(foreign?.code).toBe('NOT_AUTHORIZED');
      const kindRefusal = await client
        .subscribe({ projectId: harness.projectId, scope: { kind: 'run', id: harness.projectId } })
        .then(
          () => undefined,
          (error: unknown) => error as { code?: string },
        );
      expect(kindRefusal?.code).toBe('NOT_AUTHORIZED');
      // The manager refused before the wire: no subscription was ever opened.
      expect(client.subscriptions).toHaveLength(0);

      // A scope the session may observe is accepted, so the guard is not a blanket
      // refusal.
      const allowed = await client.subscribe({
        projectId: harness.projectId,
        scope: { kind: 'summary' },
      });
      expect(client.subscriptions).toHaveLength(1);
      await client.remove(allowed);
    } finally {
      client.end();
    }
  });
});

function jsonResponse(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload, 'utf8')),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}
