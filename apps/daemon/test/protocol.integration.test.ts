/**
 * WP-09 T2 integration: the workbench protocol surface over the real Core.
 *
 * Every test here runs against real SQLite (`ProjectStore`), the real `EventHub`,
 * the real Core services and a real WebSocket upgrade on loopback port 0. The
 * assertions cover `docs/delivery/acceptance.md` AC-068–078, AC-084, AC-087–090 and
 * AC-093 at the protocol boundary: each query answers real state, each command
 * mutates the real store and emits the documented event, an expired plan approval
 * is refused, a refused config save preserves the input and the active revision, a
 * watermark replay has no duplicates or gaps, a disconnect leaves background Work
 * untouched, and a cross-project subscription is refused.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  type PlanDraft,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import type { JsonObject, WorkStatus } from '@agentdev/contracts';
import {
  WorkbenchProtocol,
  parseEnvelope,
  statusForCode,
  type WorkbenchAuthPort,
} from '../src/protocol.js';

const ROOT = '/tmp/agentdev-workbench-root';
const GIT_HEAD = 'a'.repeat(40);
const OTHER_PROJECT = 'b'.repeat(32);

const uuid = (suffix: string): string => `018f2c1e-9a4b-7c3d-8e5f-${suffix.padStart(12, '0')}`;

interface Envelope {
  readonly v?: number;
  readonly type?: string;
  readonly id?: string;
  readonly ok?: boolean;
  readonly result?: JsonObject;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: JsonObject;
  };
  readonly name?: string;
  readonly cursor?: number;
  readonly subscriptionId?: string;
  readonly scannedThrough?: number;
  readonly reason?: string;
}

/** A minimal WebSocket client over Node's built-in `WebSocket`. */
class WsClient {
  readonly socket: WebSocket;
  readonly frames: Envelope[] = [];
  private waiters: (() => void)[] = [];
  private closedInfo: { code: number; reason: string } | undefined;
  private closeWaiters: (() => void)[] = [];
  private counter = 0;

  constructor(url: string, headers: Record<string, string>) {
    this.socket = new WebSocket(url, { headers });
    this.socket.addEventListener('message', (event: { data?: unknown }) => {
      if (typeof event.data !== 'string') return;
      this.frames.push(JSON.parse(event.data) as Envelope);
      this.wake();
    });
    this.socket.addEventListener('close', (event: { code?: number; reason?: string }) => {
      this.closedInfo = { code: event.code ?? 0, reason: event.reason ?? '' };
      for (const waiter of this.closeWaiters.splice(0)) waiter();
    });
    // Node's client reports a refused handshake through `error` before `close`;
    // the test needs the close, and an unhandled error event would fail the run.
    this.socket.addEventListener('error', () => undefined);
  }

  async waitFor(predicate: (frame: Envelope) => boolean, timeoutMs = 5_000): Promise<Envelope> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.find(predicate);
      if (found !== undefined) return found;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a WebSocket frame');
      await new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(handle);
          resolve();
        });
      });
    }
  }

  async waitForClose(timeoutMs = 5_000): Promise<{ code: number; reason: string }> {
    if (this.closedInfo !== undefined) return this.closedInfo;
    const deadline = Date.now() + timeoutMs;
    while (this.closedInfo === undefined) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for the socket to close');
      await new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, remaining);
        this.closeWaiters.push(() => {
          clearTimeout(handle);
          resolve();
        });
      });
    }
    return this.closedInfo;
  }

  async request(method: string, params: JsonObject = {}, extra: JsonObject = {}): Promise<string> {
    this.counter += 1;
    const id = `t-${this.counter}`;
    await this.opened();
    this.socket.send(JSON.stringify({ v: 1, type: 'request', id, method, params, ...extra }));
    return id;
  }

  /** Resolves once the handshake finished; `WebSocket.send` before that throws. */
  private async opened(): Promise<void> {
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

  /** Sends one request and resolves with its terminal response. */
  async call(
    method: string,
    params: JsonObject = {},
    extra: JsonObject = {},
  ): Promise<{ ok: boolean; result?: JsonObject; error?: Envelope['error'] }> {
    const id = await this.request(method, params, extra);
    const frame = await this.waitFor((entry) => entry.id === id && entry.type === 'response');
    return frame.ok === true
      ? { ok: true, result: frame.result ?? {} }
      : { ok: false, error: frame.error };
  }

  close(): void {
    this.socket.close();
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}

describe('workbench protocol over the real Core (WP-09 T2)', () => {
  let dataDir: string;
  let stateDir: string;
  let store: ProjectStore;
  let blobs: BlobStore;
  let protocol: WorkbenchProtocol;
  let auth: AuthService;
  let server: Server;
  let wsUrl: string;
  let baseUrl: string;
  let cookie: string;
  let csrfToken: string;
  let projectId: string;
  let conversationId: string;
  const clients: WsClient[] = [];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-workbench-'));
    stateDir = mkdtempSync(join(tmpdir(), 'agentdev-workbench-auth-'));
    store = ProjectStore.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(ROOT);
    blobs = new BlobStore({ root: dataDir });
    auth = AuthService.loadOrCreate({
      stateDir,
      config: { deployment: 'loopback', allowedOrigins: ['http://127.0.0.1:4317'] },
    });
    const login = auth.login({ token: auth.createdToken as string, ip: '127.0.0.1' });
    if (!login.ok) throw new Error('login failed');
    cookie = login.cookie;
    csrfToken = login.csrfToken;

    const attachments = new AttachmentService({ store, blobs });
    const artifacts = new ArtifactService({ store, blobs });
    const config = ConfigStore.open({ globalDir: stateDir, projectRoot: dataDir });
    protocol = new WorkbenchProtocol({
      store,
      blobs,
      events: new EventHub({ store }),
      attachments,
      artifacts,
      tokens: new DownloadTokenStore(),
      version: '0.0.0-test',
      config,
      gates: new PlanGateService({ store, artifacts, blobs }),
      decisions: new DecisionService({ store, artifacts }),
      findings: new FindingService({ store, artifacts }),
      requirements: new RequirementContinuation({ store }),
    });

    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
      head: GIT_HEAD,
    });
    conversationId = uuid('1');
    store.conversations.insert({
      id: conversationId,
      projectId,
      title: 'chief',
      archived: false,
    });

    // The test serves the same `/rpc` route `createDaemon` serves, so the HTTP
    // status mapping is exercised over a real socket.
    server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/rpc' || request.method !== 'POST') {
          response.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const envelope = parseEnvelope(JSON.parse(raw));
          const caller = protocol.authenticateRequest(request, authPort(), true);
          const result = protocol.dispatchEnvelope(envelope, caller);
          const body = JSON.stringify({
            v: 1,
            type: 'response',
            id: envelope.id,
            ok: true,
            result,
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(body);
        } catch (error) {
          // The production `/rpc` route maps a protocol code through
          // `statusForCode`; this test server does the same so the wire status is
          // the one the error table promises.
          const failure = error as { status?: number; code?: string; message?: string };
          response.writeHead(failure.status ?? statusForCode(failure.code ?? 'INTERNAL_ERROR'), {
            'content-type': 'application/json',
          });
          response.end(
            JSON.stringify({
              ok: false,
              error: {
                code: failure.code ?? 'INTERNAL_ERROR',
                message: failure.message ?? 'failed',
                retryable: false,
              },
            }),
          );
        }
      })();
    });
    server.on('upgrade', (request, socket) => {
      protocol.handleUpgrade(request, socket, authPort());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address !== 'object') throw new Error('no server address');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
    wsUrl = `ws://127.0.0.1:${String(address.port)}/ws`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    protocol.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  function authPort(): WorkbenchAuthPort {
    return {
      authenticate: (input) => {
        const decision = auth.authenticate(input);
        return decision.ok
          ? { ok: true, subject: `user:${decision.session.id}` }
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
    };
  }

  function caller() {
    return { subject: 'user:test', userId: uuid('99'), role: 'chief' as const };
  }

  /** Re-serialises a value into the contract JSON shape the wire carries. */
  function json(value: unknown): JsonObject {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  }

  function call(method: string, params: JsonObject = {}, extra: JsonObject = {}): JsonObject {
    return json(protocol.dispatch(method, params, { caller: caller(), ...extra }));
  }

  function expectRefusal(
    run: () => unknown,
    code: string,
  ): { code: string; message: string; details?: JsonObject } {
    try {
      run();
    } catch (error) {
      const failure = error as { code?: string; message?: string; details?: JsonObject };
      expect(failure.code).toBe(code);
      return {
        code: failure.code ?? '',
        message: failure.message ?? '',
        ...(failure.details === undefined ? {} : { details: failure.details }),
      };
    }
    throw new Error(`expected ${code} but the call succeeded`);
  }

  interface SeedOptions {
    readonly status?: WorkStatus;
    readonly name?: string;
  }

  function seedWork({ status = 'queued', name = 'w1' }: SeedOptions = {}) {
    const workId = uuid(name === 'w1' ? '10' : '20');
    const budget = store.budgets.insert({
      projectId,
      workId,
      tokenLimit: 500_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 7_200,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    const work = store.works.insert({
      id: workId,
      projectId,
      intent: 'delivery',
      purpose: 'seed',
      level: 'L2',
      goal: 'seed a work item',
      scope: {
        readPaths: ['packages/core/src'],
        writePaths: ['packages/core/src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
      status,
      blockerIds: [],
      baseRevision: GIT_HEAD,
      budgetId: budget.id,
      policyRevision: 1,
    });
    return work;
  }

  function seedRequirement(lifecycle: string, workId?: string) {
    const requirementId = uuid(lifecycle === 'queued' ? '40' : '41');
    const row = store.requirements.insert({
      id: requirementId,
      projectId,
      ...(workId === undefined ? {} : { workId }),
      title: `requirement ${lifecycle}`,
      goal: 'keep the delivered behaviour stable',
      lifecycle: lifecycle as 'queued' | 'active' | 'completed' | 'archived',
      sourceRef: { kind: 'git', id: uuid('42'), version: '1', path: '.agentdev/requirements' },
      recordVersion: 1,
      portableRef: {
        path: `.agentdev/requirements/${requirementId}`,
        revision: GIT_HEAD,
        hash: sha256(`record:${requirementId}`),
      },
      executionAvailability: workId === undefined ? 'needs_replan' : 'local',
      evidenceAvailability: 'summary_only',
    });
    return row;
  }

  function connect(overrides: { origin?: string; cookie?: string } = {}): WsClient {
    const client = new WsClient(wsUrl, {
      Origin: overrides.origin ?? 'http://127.0.0.1:4317',
      ...(overrides.cookie === undefined ? { Cookie: cookie } : { Cookie: overrides.cookie }),
    });
    clients.push(client);
    return client;
  }

  /**
   * Attributes event cursors to the subscription whose `batch_end` closes them.
   *
   * The `Event` frame (`protocol.md` §7) carries no subscriptionId, and §2 makes the batch
   * the unit a client applies before ACK, so the trailing `batch_end {subscriptionId}` is
   * the only attribution the wire offers. A stream replaced mid-flight by a same-scope
   * `project.subscribe` keeps the cursors it already delivered, so "no duplicate, no gap"
   * is a per-stream property; summing cursors across a connection conflated two streams.
   */
  function cursorsByBatch(frames: readonly Envelope[]): Map<string, number[]> {
    const batches = new Map<string, number[]>();
    let pending: number[] = [];
    for (const frame of frames) {
      if (frame.type === 'event' && frame.cursor !== undefined) {
        pending.push(frame.cursor);
        continue;
      }
      if (frame.type === 'batch_end' && frame.subscriptionId !== undefined) {
        batches.set(frame.subscriptionId, [
          ...(batches.get(frame.subscriptionId) ?? []),
          ...pending,
        ]);
        pending = [];
      }
    }
    return batches;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('answers every workbench query from real state (AC-068/AC-070/AC-074)', () => {
    const work = seedWork();
    const requirement = seedRequirement('active', work.id);
    const projects = call('projects') as { items: { projectId: string; root: string }[] };
    expect(projects.items.map((item) => item.projectId)).toContain(projectId);

    const opened = call('project.open', { root: ROOT });
    expect(opened['projectId']).toBe(projectId);

    const board = call('board') as {
      columns: Record<string, { requirementId: string; identity: string }[]>;
      excludedWorkIds: string[];
    };
    expect(board.columns['active']?.map((card) => card.requirementId)).toEqual([requirement.id]);
    // The board identity is the Requirement id itself — no copied object.
    expect(board.columns['active']?.[0]?.identity).toBe(requirement.id);
    // An L1 Work never enters the board.
    const l1 = seedWork({ name: 'w2' });
    store.works.update(l1.id, { level: 'L1' }, l1.version);
    const after = call('board') as { excludedWorkIds: string[] };
    expect(after.excludedWorkIds).toContain(l1.id);

    const works = call('work.list') as { items: { id: string }[] };
    expect(works.items.map((item) => item.id)).toContain(work.id);
    expect(call('work.get', { workId: work.id })['work']).toMatchObject({ id: work.id });

    const requirements = call('requirement.list') as {
      items: { id: string; executionAvailability: string; evidenceAvailability: string }[];
    };
    expect(requirements.items[0]).toMatchObject({
      id: requirement.id,
      executionAvailability: 'local',
      evidenceAvailability: 'summary_only',
    });
    expect(call('requirement.get', { requirementId: requirement.id })).toMatchObject({
      id: requirement.id,
    });

    expect((call('run.list', { workId: work.id }) as { items: unknown[] }).items).toEqual([]);
    expect((call('artifact.list', { workId: work.id }) as { items: unknown[] }).items).toEqual([]);

    const inbox = call('inbox') as { items: unknown[]; unread: number };
    expect(inbox.items).toEqual([]);
    expect(inbox.unread).toBe(0);

    const agents = call('agents') as { roles: { role: string }[]; limits: JsonObject };
    expect(agents.roles).toHaveLength(8);
    expect(agents.roles.map((role) => role.role)).toContain('chief');
    expect(agents.limits['taskWriterCount']).toBe(1);

    const settings = call('settings') as { configRevision: number; projectId: string };
    expect(settings.projectId).toBe(projectId);
    expect(settings.configRevision).toBe(0);

    const snapshot = call('project.snapshot.get') as { projectId: string; counts: JsonObject };
    expect(snapshot.projectId).toBe(projectId);
    expect(snapshot.counts['requirements']).toBe(1);
  });

  it('answers a cross-project id with NOT_FOUND and never another project data (AC-078)', () => {
    const refused = expectRefusal(
      () => call('work.list', {}, { projectId: OTHER_PROJECT }),
      'NOT_FOUND',
    );
    expect(refused.message).toContain(OTHER_PROJECT);
  });

  it('deduplicates the Inbox by target version and keeps an expired decision inert (AC-074)', () => {
    const work = seedWork();
    const targetRef = { id: uuid('50'), version: 3, hash: sha256('target') };
    store.decisions.insert({
      id: uuid('51'),
      projectId,
      workId: work.id,
      kind: 'start',
      targetRef,
      choices: ['now', 'later', 'decline'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    // A second row for the same target+version must collapse into one Inbox entry.
    store.decisions.insert({
      id: uuid('52'),
      projectId,
      workId: work.id,
      kind: 'start',
      targetRef,
      choices: ['now', 'later', 'decline'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    store.decisions.insert({
      id: uuid('53'),
      projectId,
      workId: work.id,
      kind: 'start',
      targetRef: { ...targetRef, version: 4 },
      choices: ['now', 'later', 'decline'],
      state: 'expired',
      actor: 'user',
      effectRefs: [],
    });
    const inbox = call('inbox') as {
      items: { kind: string; targetVersion: number; actionable: boolean }[];
    };
    const decisions = inbox.items.filter((item) => item.kind === 'decision');
    expect(decisions).toHaveLength(2);
    expect(decisions.find((item) => item.targetVersion === 3)?.actionable).toBe(true);
    // An expired target is visible but can never be applied again.
    expect(decisions.find((item) => item.targetVersion === 4)?.actionable).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  it('sends a message that creates real Work and a real event (AC-069/AC-084)', () => {
    const before = store.events.latestCursor();
    const sent = call(
      'conversation.message.send',
      { conversationId, body: 'explain the routing rules', attachmentIds: [] },
      { idempotencyKey: 'msg-1' },
    );
    expect(sent['workId']).toMatch(/^[0-9a-f-]{36}$/u);
    const work = store.works.find(typeof sent['workId'] === 'string' ? sent['workId'] : '');
    expect(work).toMatchObject({ intent: 'assist', level: 'none' });
    const events = store.events.readAfter(before, { limit: 10 });
    expect(events.some((event) => event.name === 'message.received')).toBe(true);

    // The replayed command returns the original result and creates nothing new.
    const replay = call(
      'conversation.message.send',
      { conversationId, body: 'explain the routing rules', attachmentIds: [] },
      { idempotencyKey: 'msg-1' },
    );
    expect(replay).toEqual(sent);
    expect(store.messages.count()).toBe(1);

    // A different payload under a used key is a conflict, never a silent no-op.
    expectRefusal(
      () =>
        call(
          'conversation.message.send',
          { conversationId, body: 'a different request', attachmentIds: [] },
          { idempotencyKey: 'msg-1' },
        ),
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('refuses to cancel a Queued requirement it cannot record and refuses to pause it (AC-068)', () => {
    const requirement = seedRequirement('queued');
    // No record service is wired here, so the honest answer is that the Git record
    // could not be cancelled — never a fabricated success.
    expectRefusal(
      () =>
        call('work.control', {
          action: 'cancel',
          requirementId: requirement.id,
          reason: 'no longer needed',
        }),
      'INVALID_STATE',
    );
    // A pause has nothing to pause; the board rule says exactly that.
    expectRefusal(
      () => call('work.control', { action: 'pause', requirementId: requirement.id }),
      'INVALID_STATE',
    );
    // The Requirement row is untouched: no command applied a partial change.
    expect(store.requirements.find(requirement.id)?.lifecycle).toBe('queued');
  });

  it('pauses and resumes a real Work through the finding service (AC-020 surface)', () => {
    const work = seedWork({ status: 'running' });
    const paused = call('work.control', { action: 'pause', workId: work.id, reason: 'user asked' });
    expect(paused['status']).toBe('accepted');
    expect(paused['previousStatus']).toBe('running');
    expect(store.works.find(work.id)?.status).toBe('paused');

    const resumed = call(
      'work.control',
      { action: 'resume', workId: work.id },
      { expectedVersion: store.works.find(work.id)?.version ?? 1 },
    );
    expect(resumed['status']).toBe('accepted');

    // A resume with a stale Work version is a conflict carrying the live version.
    const stale = expectRefusal(
      () => call('work.control', { action: 'resume', workId: work.id }, { expectedVersion: 1 }),
      'VERSION_CONFLICT',
    );
    expect(stale.details?.['currentVersion']).toBeGreaterThan(1);
  });

  it('refuses requirement.save without the Git record service instead of faking a save (AC-090/AC-093)', () => {
    // The record service owns the Git commit; without it the daemon must refuse the
    // write rather than report a save the repository never saw.
    const refused = expectRefusal(
      () =>
        call('requirement.save', {
          requirementId: uuid('40'),
          patch: { title: 'renamed', contentMarkdown: '# renamed\n\nbody\n' },
        }),
      'INVALID_STATE',
    );
    expect(refused.message).toContain('Git record service');
    // The retry path needs a real original operation, so an unknown one is NOT_FOUND.
    expectRefusal(
      () => call('requirement.save.retry', { operationId: uuid('ab') }),
      'INVALID_STATE',
    );
    expect(store.requirements.list()).toHaveLength(0);
  });

  // A projection read-model check over a **seeded** row (`seedRequirement` inserts
  // straight into SQLite). It proves the protocol read shape for an imported active
  // record, but it is not the portability evidence for AC-087/AC-088/AC-089: the
  // no-seed path is `requirement-portability-drill.integration.test.ts`, which produces
  // the pool through the documented commands, commits it to the delivery branch and
  // really clones it.
  it('keeps an imported requirement identity and its evidence availability honest', () => {
    const requirement = seedRequirement('active');
    const listed = call('requirement.list') as {
      items: {
        id: string;
        portableRef: { path: string; revision: string; hash: string };
        waitingToContinue: boolean;
        evidenceAvailability: string;
      }[];
    };
    expect(listed.items[0]).toMatchObject({
      id: requirement.id,
      // The stable id and portable ref survive the import unchanged.
      portableRef: requirement.portableRef,
      // An active record with no local Work is honestly waiting to continue.
      waitingToContinue: true,
      evidenceAvailability: 'summary_only',
    });
    const detail = call('requirement.get', { requirementId: requirement.id }) as {
      waitingToContinue: boolean;
      work: unknown;
    };
    expect(detail.work).toBeNull();
    expect(detail.waitingToContinue).toBe(true);

    // Continuing needs a real local authorization source; an unknown id is refused
    // rather than silently forging one.
    const refused = expectRefusal(
      () =>
        call('requirement.continue', {
          requirementId: requirement.id,
          authorizationRef: uuid('cd'),
        }),
      'NOT_AUTHORIZED',
    );
    expect(refused.message).toContain('authorization');
    expect(store.works.list()).toHaveLength(0);
  });

  it('refuses a plan approval for an expired version with the version in view (AC-070)', () => {
    const work = seedWork();
    store.runs.insert({
      id: uuid('60'),
      projectId,
      workId: work.id,
      role: 'planning',
      purpose: 'artifact',
      stage: 'plan',
      status: 'completed',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: sha256('config'),
      contextSnapshotId: sha256('context'),
      dispatchSnapshotId: sha256('dispatch'),
      budgetAllocation: 0,
    });
    const authorization = store.authorizations.insert({
      projectId,
      sourceRef: { kind: 'action', id: uuid('61'), version: '1' },
      workId: work.id,
      goal: 'seed authority',
      scope: {
        readPaths: ['packages/core/src'],
        writePaths: ['packages/core/src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      operations: ['read', 'edit'],
      acceptedAt: store.now(),
    });
    const plan: PlanDraft = {
      goal: 'seed the plan',
      scope: {
        readPaths: ['packages/core/src'],
        writePaths: ['packages/core/src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      tasks: [
        {
          id: 'T1',
          role: 'backend',
          goal: 'seed a task',
          paths: ['packages/core/src'],
          dependsOn: [],
          acceptanceIds: ['AC-070'],
          checks: ['pnpm test:unit'],
        },
      ],
    };
    const approval = {
      authorizationRef: authorization.id,
      runId: uuid('60'),
      productChanged: false,
    };
    // The client holds no approved Plan yet, so approving version 1 is a conflict
    // that names the live version instead of approving something else.
    const expired = expectRefusal(
      () =>
        call('plan.approve', {
          workId: work.id,
          planVersion: 1,
          plan: json(plan),
          approval,
          revision: GIT_HEAD,
        }),
      'VERSION_CONFLICT',
    );
    expect(expired.details?.['currentVersion']).toBe(0);
    expect(store.artifacts.list({ where: 'work_id = ?', params: [work.id] })).toHaveLength(0);

    // A first real approval (version 0 ⇒ absent) passes the gate and emits the
    // documented `decision.created` event.
    const before = store.events.latestCursor();
    const approved = call('plan.approve', {
      workId: work.id,
      planVersion: 0,
      plan: json(plan),
      approval,
      revision: GIT_HEAD,
    });
    expect(approved['version']).toBe(1);
    expect(approved['planRef']).toMatchObject({ version: 1 });
    const events = store.events.readAfter(before, { limit: 20 });
    expect(events.some((event) => event.name === 'decision.created')).toBe(true);

    // Now version 1 is the current Plan; re-approving the old version 0 is refused
    // and tells the user which version they are actually looking at.
    const stale = expectRefusal(
      () =>
        call('plan.approve', {
          workId: work.id,
          planVersion: 0,
          plan: json(plan),
          approval,
          revision: GIT_HEAD,
        }),
      'VERSION_CONFLICT',
    );
    expect(stale.details?.['currentVersion']).toBe(1);
  });

  it('submits a real finding and resolves a decision through the real rows (AC-074)', () => {
    const work = seedWork({ status: 'running' });
    store.runs.insert({
      id: uuid('70'),
      projectId,
      workId: work.id,
      role: 'review',
      purpose: 'review',
      stage: 'review',
      status: 'completed',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: sha256('config'),
      contextSnapshotId: sha256('context'),
      dispatchSnapshotId: sha256('dispatch'),
      budgetAllocation: 0,
    });
    const submitted = call('finding.submit', {
      reviewRunId: uuid('70'),
      target: {
        targetKind: 'integration',
        targetRef: { id: uuid('71'), version: 1, hash: sha256('review-artifact') },
      },
      manifestRef: { id: uuid('72'), version: 1, hash: sha256('manifest') },
      severity: 'P1',
      description: 'the documented cancellation path lost the reason field',
    });
    expect(submitted['finding']).toMatchObject({ severity: 'P1', blocking: true, state: 'open' });
    expect(store.findings.list()).toHaveLength(1);

    const decision = store.decisions.insert({
      id: uuid('73'),
      projectId,
      workId: work.id,
      kind: 'risk',
      targetRef: { id: uuid('74'), version: 2, hash: sha256('risk-target') },
      choices: ['accept', 'decline'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const resolved = call('decision.resolve', {
      decisionId: decision.id,
      targetVersion: 2,
      choice: 'accept',
    });
    expect(resolved).toMatchObject({ state: 'accepted', choice: 'accept' });
    expect(store.decisions.find(decision.id)?.state).toBe('accepted');
    const events = store.events.readAfter(0, { limit: 100 });
    expect(events.some((event) => event.name === 'decision.resolved')).toBe(true);

    // Resolving twice with the same choice is idempotent; a different choice is not.
    expect(
      call('decision.resolve', { decisionId: decision.id, targetVersion: 2, choice: 'accept' }),
    ).toMatchObject({ idempotent: true });
    expectRefusal(
      () =>
        call('decision.resolve', { decisionId: decision.id, targetVersion: 2, choice: 'decline' }),
      'INVALID_STATE',
    );
    // A stale target version is a conflict with the live version.
    expectRefusal(
      () =>
        call('decision.resolve', { decisionId: decision.id, targetVersion: 1, choice: 'accept' }),
      'VERSION_CONFLICT',
    );
  });

  it('preserves the input and the active revision when config.save is refused (AC-075)', () => {
    const patch = { limits: { shellTimeoutSec: 99_999 } };
    const refused = expectRefusal(
      () => call('config.save', { scope: 'global', patch }),
      'VALIDATION_ERROR',
    );
    expect(refused.details?.['preservedInput']).toEqual({ scope: 'global', patch });
    expect(refused.details?.['currentVersion']).toBe(0);
    // The active revision never moved and nothing was written.
    const settings = call('settings') as { configRevision: number };
    expect(settings.configRevision).toBe(0);
    expect((call('config.get', { scope: 'global' }) as { version: number }).version).toBe(0);

    // A valid patch applies and bumps the revision, so the failure above was real.
    const applied = call('config.save', {
      scope: 'global',
      patch: { limits: { shellTimeoutSec: 300 } },
    });
    expect(applied['version']).toBe(1);
    expect((call('config.get', { scope: 'global' }) as { version: number }).version).toBe(1);
  });

  it('reports an unusable provider profile without changing the configuration (AC-075)', () => {
    const refused = expectRefusal(
      () => call('config.test', { role: 'chief' }),
      'PROVIDER_UNAVAILABLE',
    );
    expect(refused.details?.['preservedInput']).toEqual({ role: 'chief' });
    expect((call('config.get', { scope: 'global' }) as { version: number }).version).toBe(0);
    expect(store.events.latestCursor()).toBe(0);
  });

  it('backs up and restores the real database through the protocol (AC-064 surface)', () => {
    seedWork();
    const backupDir = join(dataDir, 'backup');
    const backup = call('backup.run', { outputDir: backupDir });
    const manifest = backup['manifest'] as { complete: boolean; database: { path: string } };
    expect(manifest.complete).toBe(true);
    expect(manifest.database.path).toBe('project.sqlite');

    const target = join(dataDir, 'restore');
    const restored = call('restore.run', { backupDir, targetDir: target });
    expect(restored['restoredStatus']).toBe('ready');
    expect((restored['consistency'] as { filesVerified: number }).filesVerified).toBeGreaterThan(0);

    // A second backup into the same non-empty directory is refused, not merged.
    expectRefusal(() => call('backup.run', { outputDir: backupDir }), 'INVALID_STATE');
  });

  it('translates only the interface strings and leaves project content untouched (AC-073)', () => {
    const translated = call('ui.translate', { resourceId: 'nav.chief', locale: 'zh' });
    expect(translated).toMatchObject({ translatable: true, content: '主管' });
    const projectContent = call('ui.translate', {
      resourceId: 'message.body',
      locale: 'zh',
      content: '用户自己的原文',
    });
    expect(projectContent).toMatchObject({ translatable: false, content: '用户自己的原文' });
    expectRefusal(() => call('ui.translate', { resourceId: 'nope.missing' }), 'NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // WebSocket: authentication, subscription and watermark
  // -------------------------------------------------------------------------

  it('refuses an unauthenticated or foreign-origin upgrade (AC-078)', async () => {
    const unauthenticated = new WsClient(wsUrl, { Origin: 'http://127.0.0.1:4317' });
    await unauthenticated.waitForClose();
    // A refused handshake never reaches a `101`, so the client sees no socket and
    // no event frame at all.
    expect(protocol.connectionCount).toBe(0);

    const foreignOrigin = connect({
      origin: 'https://evil.test',
      cookie: 'agentdev_session=not-a-session',
    });
    await foreignOrigin.waitForClose();
    expect(foreignOrigin.frames.filter((frame) => frame.type === 'event')).toHaveLength(0);
  });

  it('replays events after a watermark with no duplicates and no gaps (AC-054)', async () => {
    const client = connect();
    const hello = await client.call('connection.hello', { protocolVersion: 1, client: 'web' });
    expect(hello.ok).toBe(true);
    // A snapshot subscribe pins the empty log at cursor 0.
    const subscribed = await client.call('project.subscribe', { scope: { kind: 'summary' } });
    expect(subscribed.ok).toBe(true);
    const cursor = subscribed.result?.['cursor'] as number;
    const subscriptionId = subscribed.result?.['subscriptionId'] as string;
    expect(typeof subscriptionId).toBe('string');
    // The first scan reported its watermark even though the batch was empty.
    await client.waitFor(
      (frame) => frame.type === 'batch_end' && frame.subscriptionId === subscriptionId,
    );
    expect(cursor).toBe(0);

    // Three events land; the live scan delivers them once, in order.
    store.events.append({
      name: 'work.control_changed',
      entityId: uuid('80'),
      entityVersion: 1,
      data: { workId: uuid('80') },
    });
    store.events.append({
      name: 'work.control_changed',
      entityId: uuid('81'),
      entityVersion: 1,
      data: { workId: uuid('81') },
    });
    store.events.append({
      name: 'work.control_changed',
      entityId: uuid('82'),
      entityVersion: 1,
      data: { workId: uuid('82') },
    });
    const latest = store.events.latestCursor();
    await client.waitFor((frame) => frame.type === 'event' && frame.cursor === latest);
    const delivered = client.frames
      .filter((frame) => frame.type === 'event' && frame.cursor !== undefined)
      .map((frame) => frame.cursor as number);
    expect(delivered).toEqual([1, 2, 3]);
    expect(new Set(delivered).size).toBe(delivered.length);

    // A resume from the watermark replays exactly what was missed and nothing else.
    store.events.append({
      name: 'work.control_changed',
      entityId: uuid('83'),
      entityVersion: 1,
      data: { workId: uuid('83') },
    });
    const missed = store.events.latestCursor();
    const resumed = await client.call('project.subscribe', {
      scope: { kind: 'summary' },
      afterCursor: latest,
    });
    expect(resumed.ok).toBe(true);
    expect(resumed.result?.['mode']).toBe('replay');
    const resumedId = resumed.result?.['subscriptionId'] as string;
    // `protocol.md` §2 keeps **one live subscription per (kind, id)**: the resume replaces
    // the previous stream rather than adding a second reader, so it gets a new id and the
    // old one stops receiving batches. The replaced stream may still have delivered the new
    // event on its 50 ms poll before the resume handler ran — that is its own cursor
    // advancing, not a replay. Event frames carry no subscriptionId, so uniqueness must be
    // read the way a client reads it (`protocol.md` §2, "客户端应用整个批次后ACK"): a batch
    // is closed by `batch_end {subscriptionId}`, and the cursor guarantee is **per stream**
    // (`packages/client/src/subscriptions.ts` drops `cursor <= watermark` and counts it as a
    // duplicate). Reading the whole connection as one stream is what made this case flip.
    expect(resumedId).not.toBe(subscriptionId);
    await client.waitFor(
      (frame) =>
        frame.type === 'batch_end' &&
        frame.subscriptionId === resumedId &&
        (frame.scannedThrough ?? 0) >= missed,
    );
    const batches = cursorsByBatch(client.frames);
    // The resumed stream replays exactly what was missed and nothing else.
    expect(batches.get(resumedId)).toEqual([missed]);
    for (const [id, cursors] of batches) {
      expect(cursors, `subscription ${id} delivered a cursor twice`).toEqual([...new Set(cursors)]);
    }
    const afterResume = client.frames
      .filter((frame) => frame.type === 'event' && frame.cursor !== undefined)
      .map((frame) => frame.cursor as number);
    // The connection saw every cursor once in order, and the replay closed the gap.
    expect(afterResume.slice(0, 3)).toEqual([1, 2, 3]);
    expect(afterResume.at(-1)).toBe(missed);
    expect([...new Set(afterResume)]).toEqual([1, 2, 3, missed]);

    const acked = await client.call('project.events.ack', {
      subscriptionId: resumed.result?.['subscriptionId'] ?? subscriptionId,
      cursor: missed,
    });
    expect(acked.result?.['acknowledged']).toBe(missed);
    // A cursor that moves backwards is refused.
    const backwards = await client.call('project.events.ack', {
      subscriptionId: (resumed.result?.['subscriptionId'] as string | undefined) ?? subscriptionId,
      cursor: 0,
    });
    expect(backwards.ok).toBe(false);
    expect(backwards.error?.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a cross-project subscription and closes on an expired session (AC-078)', async () => {
    const client = connect();
    await client.call('connection.hello', { protocolVersion: 1, client: 'web' });
    const crossProject = await client.call(
      'project.subscribe',
      { scope: { kind: 'summary' } },
      { projectId: OTHER_PROJECT },
    );
    expect(crossProject.ok).toBe(false);
    expect(crossProject.error?.code).toBe('NOT_FOUND');
    expect(client.frames.filter((frame) => frame.type === 'event')).toHaveLength(0);

    // An expired session cannot open a socket at all: the handshake is refused
    // before `101`, so the client never receives a single protocol frame.
    const sessionId = /agentdev_session=([^;]+)/u.exec(cookie)?.[1] ?? '';
    auth.logout(sessionId);
    const expired = new WsClient(wsUrl, { Origin: 'http://127.0.0.1:4317', Cookie: cookie });
    const closed = await expired.waitForClose();
    expect(closed.code).toBeGreaterThan(0);
    expect(expired.frames).toHaveLength(0);
  });

  it('keeps background Work running when the WebSocket disconnects (AC-054/AC-078)', async () => {
    const work = seedWork({ status: 'running' });
    const client = connect();
    await client.call('connection.hello', { protocolVersion: 1, client: 'web' });
    await client.call('project.subscribe', { scope: { kind: 'work', id: work.id } });
    client.close();
    await client.waitForClose();

    // The disconnection is not a Work state change: the run keeps its status and
    // new events still persist while nobody is subscribed.
    expect(store.works.find(work.id)?.status).toBe('running');
    const before = store.events.latestCursor();
    store.events.append({
      name: 'run.queued',
      entityId: uuid('90'),
      entityVersion: 1,
      data: { workId: work.id },
    });
    expect(store.events.latestCursor()).toBeGreaterThan(before);
    expect(store.works.find(work.id)?.status).toBe('running');
  });

  // -------------------------------------------------------------------------
  // Error table
  // -------------------------------------------------------------------------

  it('answers protocol-shaped errors for 401/403/404/409/422 paths', () => {
    // 404 unknown method and unknown record.
    expect(expectRefusal(() => call('does.not.exist', {}), 'NOT_FOUND').code).toBe('NOT_FOUND');
    expect(expectRefusal(() => call('work.get', { workId: uuid('aa') }), 'NOT_FOUND').code).toBe(
      'NOT_FOUND',
    );
    // 422 shape errors.
    expect(expectRefusal(() => call('work.get', {}), 'VALIDATION_ERROR').code).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      expectRefusal(
        () => call('knowledge.get', { featureId: 'F-00000000', view: 'nope' }),
        'VALIDATION_ERROR',
      ).code,
    ).toBe('VALIDATION_ERROR');
    // 403/401 through the HTTP authentication seam: no session cookie at all.
    const noSession = authPort();
    const decision = noSession.authenticate({ isWrite: true });
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
    expect(decision.code).toBe('UNAUTHENTICATED');
    // 403 wrong Origin (with a *valid* session, so the origin is what is refused).
    const sessionId = /agentdev_session=([^;]+)/u.exec(cookie)?.[1] ?? '';
    const wrongOrigin = noSession.authenticate({
      cookie: sessionId,
      origin: 'https://evil.test',
      isWrite: false,
    });
    expect(wrongOrigin.ok).toBe(false);
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.code).toBe('NOT_AUTHORIZED');
    // 409 version conflict and invalid state on a real command.
    const work = seedWork({ status: 'completed' });
    expectRefusal(
      () => call('work.control', { action: 'pause', workId: work.id }, { expectedVersion: 99 }),
      'INVALID_STATE',
    );
  });

  it('keeps the JSON-RPC surface over real HTTP with session authentication', async () => {
    seedWork();
    const envelope = {
      v: 1,
      type: 'request',
      id: 'http-1',
      method: 'board',
      projectId,
      params: {},
    };
    const unauthenticated = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4317' },
      body: JSON.stringify(envelope),
    });
    expect(unauthenticated.status).toBe(401);
    const unauthBody = (await unauthenticated.json()) as { error: { code: string } };
    expect(unauthBody.error.code).toBe('UNAUTHENTICATED');

    const authenticated = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:4317',
        cookie,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(envelope),
    });
    expect(authenticated.status).toBe(200);
    const body = (await authenticated.json()) as {
      ok: boolean;
      result: { columns: JsonObject };
    };
    expect(body.ok).toBe(true);
    expect(body.result.columns).toBeDefined();

    // A validation failure answers the documented 422 for the same route.
    const invalid = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:4317',
        cookie,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        ...envelope,
        id: 'http-3',
        method: 'work.get',
        params: {},
      }),
    });
    expect(invalid.status).toBe(422);
  });

  it('reports the 422 status the error table implies for a validation failure', () => {
    expect(protocol.statusOf('VALIDATION_ERROR')).toBe(422);
    expect(protocol.statusOf('NOT_FOUND')).toBe(404);
    expect(protocol.statusOf('VERSION_CONFLICT')).toBe(409);
    expect(protocol.statusOf('NOT_AUTHORIZED')).toBe(403);
    expect(protocol.statusOf('UNAUTHENTICATED')).toBe(401);
    expect(protocol.statusOf('INTERNAL_ERROR')).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Round-1 fixes: cross-Project refusal details and the shared command ledger
  // -------------------------------------------------------------------------

  it('does not echo the local Project id in a cross-Project refusal (W9R1-03)', async () => {
    const refusal = expectRefusal(
      () => call('board', {}, { projectId: OTHER_PROJECT }),
      'NOT_FOUND',
    );
    expect(refusal.details?.['projectId']).toBe(OTHER_PROJECT);
    // The refusal names only the id the caller sent; this installation's own id
    // would leak which Project the daemon actually serves (W9R1-03).
    expect(JSON.stringify(refusal.details ?? {})).not.toContain(projectId);
    expect(Object.keys(refusal.details ?? {}).sort()).toEqual(['projectId']);
    expect(refusal.message).not.toContain(projectId);

    const client = connect();
    await client.call('connection.hello', { protocolVersion: 1, client: 'web' });
    const frame = await client.call(
      'project.subscribe',
      { scope: { kind: 'summary' } },
      { projectId: OTHER_PROJECT },
    );
    expect(frame.ok).toBe(false);
    expect(frame.error?.code).toBe('NOT_FOUND');
    expect(JSON.stringify(frame.error?.details ?? {})).not.toContain(projectId);
  });

  it('replays a recorded write and refuses the same key with a different payload (W9R1-04)', () => {
    const work = seedWork({ status: 'running' });
    const pause = json({ action: 'pause', workId: work.id });
    const first = call('work.control', pause, { idempotencyKey: 'w9r1-04-pause' });
    expect(first['status']).toBe('accepted');
    expect(typeof first['version']).toBe('number');
    const replayedPause = call('work.control', pause, { idempotencyKey: 'w9r1-04-pause' });
    expect(replayedPause).toEqual(first);
    // A replay never advances the Work: the recorded result carries the first version.
    expect(store.works.find(work.id)?.version).toBe(first['version']);
    expectRefusal(
      () =>
        call(
          'work.control',
          { action: 'resume', workId: work.id },
          { idempotencyKey: 'w9r1-04-pause' },
        ),
      'IDEMPOTENCY_CONFLICT',
    );

    // `defaultRole` is not part of `ConfigPatch`; `limits.shellTimeoutSec` is the
    // overridable surface the contract actually exposes.
    const configPatch = json({ scope: 'global', patch: { limits: { shellTimeoutSec: 300 } } });
    const applied = call('config.save', configPatch, { idempotencyKey: 'w9r1-04-config' });
    expect(applied['status']).toBe('applied');
    const replayedConfig = call('config.save', configPatch, { idempotencyKey: 'w9r1-04-config' });
    expect(replayedConfig['revision']).toBe(applied['revision']);
    expectRefusal(
      () =>
        call(
          'config.save',
          { scope: 'global', patch: { limits: { shellTimeoutSec: 301 } } },
          { idempotencyKey: 'w9r1-04-config' },
        ),
      'IDEMPOTENCY_CONFLICT',
    );

    const decisionWork = seedWork({ status: 'running', name: 'w2' });
    const decision = store.decisions.insert({
      id: uuid('a0'),
      projectId,
      workId: decisionWork.id,
      kind: 'start',
      targetRef: { id: uuid('a1'), version: 3, hash: sha256('w9r1-target') },
      choices: ['now', 'later', 'decline'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const resolve = json({ decisionId: decision.id, choice: 'later', targetVersion: 3 });
    const resolved = call('decision.resolve', resolve, { idempotencyKey: 'w9r1-04-decision' });
    expect(resolved['status']).toBe('applied');
    expect(call('decision.resolve', resolve, { idempotencyKey: 'w9r1-04-decision' })).toEqual(
      resolved,
    );
    expectRefusal(
      () =>
        call(
          'decision.resolve',
          { decisionId: decision.id, choice: 'now', targetVersion: 3 },
          { idempotencyKey: 'w9r1-04-decision' },
        ),
      'IDEMPOTENCY_CONFLICT',
    );

    // `backup.run`/`restore.run` cannot share the ledger's transaction: SQLite
    // refuses `VACUUM INTO` inside one, so they record their ledger row around the
    // operation instead and keep the full replay/conflict contract.
    const temp = mkdtempSync(join(tmpdir(), 'agentdev-w9r1-'));
    const backupDir = join(temp, 'backup');
    const backup = call(
      'backup.run',
      { outputDir: backupDir },
      { idempotencyKey: 'w9r1-04-backup' },
    );
    expect(backup['status']).toBe('applied');
    expect(typeof backup['backupId']).toBe('string');
    // The same key and payload replay the recorded backup instead of taking a second
    // snapshot, and the same key with another directory is the documented conflict.
    expect(
      call('backup.run', { outputDir: backupDir }, { idempotencyKey: 'w9r1-04-backup' }),
    ).toEqual(backup);
    expect(store.commands.lookup(caller().subject, 'backup.run', 'w9r1-04-backup')?.state).toBe(
      'completed',
    );
    expectRefusal(
      () =>
        call(
          'backup.run',
          { outputDir: join(temp, 'keyed-backup') },
          { idempotencyKey: 'w9r1-04-backup' },
        ),
      'IDEMPOTENCY_CONFLICT',
    );

    const targetDir = join(temp, 'restore');
    const restoreParams = json({ backupDir, targetDir });
    const restored = call('restore.run', restoreParams, { idempotencyKey: 'w9r1-04-restore' });
    expect(restored['status']).toBe('applied');
    expect(restored['restoredStatus']).toBe('ready');
    expect(call('restore.run', restoreParams, { idempotencyKey: 'w9r1-04-restore' })).toEqual(
      restored,
    );
    expectRefusal(
      () =>
        call(
          'restore.run',
          { backupDir, targetDir: join(temp, 'restore-2') },
          { idempotencyKey: 'w9r1-04-restore' },
        ),
      'IDEMPOTENCY_CONFLICT',
    );
    rmSync(temp, { recursive: true, force: true });
  });

  it('records a command only once for a replayed write and never on a failure (W9R1-04)', () => {
    // A failed command leaves no ledger row, so its key stays free.
    const requirement = seedRequirement('queued');
    expectRefusal(
      () =>
        call(
          'work.control',
          { action: 'pause', requirementId: requirement.id },
          { idempotencyKey: 'w9r1-04-failed' },
        ),
      'INVALID_STATE',
    );
    expect(
      store.commands.lookup(caller().subject, 'work.control', 'w9r1-04-failed'),
    ).toBeUndefined();

    // A successful command is queryable and the recorded response is the replay.
    const work = seedWork({ status: 'running' });
    const pause = json({ action: 'pause', workId: work.id });
    const paused = call('work.control', pause, { idempotencyKey: 'w9r1-04-recorded' });
    const recorded = store.commands.lookup(caller().subject, 'work.control', 'w9r1-04-recorded');
    expect(recorded?.state).toBe('completed');
    expect(recorded?.response).toEqual(paused);
    expect(call('work.control', pause, { idempotencyKey: 'w9r1-04-recorded' })).toEqual(paused);

    // Without a key the ledger is never consulted, so the write still works.
    const other = seedWork({ status: 'running', name: 'w2' });
    expect(call('work.control', { action: 'pause', workId: other.id })['status']).toBe('accepted');
  });
});
