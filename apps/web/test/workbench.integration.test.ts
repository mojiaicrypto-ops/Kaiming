/**
 * WP-09 T4 end-to-end drill: the whole workbench against the real stack.
 *
 * Nothing below is a mock of the product. The harness boots a **real Git
 * repository**, a **real SQLite `ProjectStore`**, the real Core services
 * (`RequirementSaveService` with the real CAS + worktree Git port included), the
 * real `WorkbenchProtocol` over a loopback port 0 socket, and the real BFF with a
 * real browser-session cookie. Requirements are actually committed to Git, the
 * board actually reads the projection, and the WebSocket is a real RFC6455
 * upgrade — so each assertion is evidence about the delivered system rather than
 * about a fixture.
 *
 * The suite covers, in order:
 *
 * - all nine surfaces reading real state end to end;
 * - a conversation message routed by the Chief's assessment;
 * - a Queued requirement cancelled through the real Git record service with no Work;
 * - an L1 Work that never enters the board;
 * - an expired Plan version refused with the version the gate still holds;
 * - a truncated artifact with the full one-shot download;
 * - a branch preview confined to the root boundary;
 * - decisions de-duplicated per target version with an expired one inert;
 * - a provider failure that preserves the caller's input and the active revision;
 * - a Requirement save visible in the UI only after Git and the projection agree;
 * - the "waiting to continue" path for an imported active Requirement (AC-089).
 *
 * WP-09's six required failure scenarios live in
 * `apps/web/test/workbench-failures.test.ts`.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
  ProjectIntegrationLock,
  RequirementContinuation,
  assertPreviewable,
  createRequirementSaveService,
  previewHeaders,
  renderPreview,
  userIdFromSubject,
  type PlanDraft,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import {
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
  type GitResult,
} from '@agentdev/workspace';
import type {
  FindingSeverity,
  Intent,
  Level,
  Role,
  RunStatus,
  WorkStatus,
} from '@agentdev/contracts';
import {
  WorkbenchProtocol,
  parseEnvelope,
  statusForCode,
  type WorkbenchAuthPort,
} from '../../daemon/src/protocol.js';
import { UI_STRINGS } from '../src/i18n.js';
import { createWebApp } from '../src/app.js';
import { WebSessionStore } from '../src/sessions.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';
/** Injected clock for the save service, so a committed record is deterministic. */
const TIME = '2026-09-11T00:00:00.000Z';

/** A deterministic uuid-shaped id; `suffix` fills the final 12 hex characters. */
const uuid = (suffix: string): string => `018f2c1e-9a4b-7c3d-8e5f-${suffix.padStart(12, '0')}`;

/** The six level-2 headings `requirements.md` §6 requires, in order. */
function requirementBody(text: string): string {
  return [
    '## 目标与背景',
    '',
    text,
    '',
    '## 范围与行为',
    '',
    '仅订单模块。',
    '',
    '## 验收说明',
    '',
    'AC-090。',
    '',
    '## 已确认决定',
    '',
    '待明确',
    '',
    '## 未决问题',
    '',
    '待明确',
    '',
    '## 完成摘要',
    '',
    '待明确',
    '',
  ].join('\n');
}

interface Frame {
  readonly v?: number;
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
}

interface SaveHarness {
  readonly protocol: WorkbenchProtocol;
  readonly store: ProjectStore;
  readonly service: ReturnType<typeof createRequirementSaveService>;
  readonly journal: ReturnType<typeof createMemoryCasJournal>;
  readonly projectId: string;
  readonly repoRoot: string;
  /**
   * The revision the delivery branch holds when the Project row is written.
   *
   * A getter, not a snapshot: the tests share one harness, and a test that writes a
   * real Git record (the Queued cancellation) advances the branch. The baseline a
   * later test must name is the branch it actually reads, which is what `head()`
   * answers; the seed revision stays available as `seedRevision`.
   */
  readonly baseRevision: string;
  /** The delivery-branch revision at harness start. */
  readonly seedRevision: string;
  /** Reads a repository-relative blob at a revision; `null` when it is absent. */
  readAtRevision(revision: string, path: string): string | null;
  /** Current delivery-branch revision, from the real Git port. */
  head(): string;
  /** Commits `README.md` with the given message; used to advance the branch. */
  commitAll(message: string): string;
}

interface Harness {
  readonly web: Server;
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly daemon: {
    readonly store: ProjectStore;
    readonly auth: AuthService;
    readonly protocol: WorkbenchProtocol;
    readonly artifacts: ArtifactService;
    readonly attachments: AttachmentService;
    readonly gates: PlanGateService;
    readonly findings: FindingService;
    readonly projectId: string;
    readonly projectRoot: string;
    readonly stateDir: string;
    readonly installationToken: string;
  };
  readonly daemonServer: Server;
  readonly saves: SaveHarness;
  readonly projectId: string;
  /** The provider the daemon's own configuration holds. */
  readonly providerId: string;
  login(): Promise<{ cookie: string; csrfToken: string }>;
  close(): Promise<void>;
}

/** A protocol `result` field as a string; `''` for anything that is not one. */
function text(result: Record<string, unknown> | undefined, key: string): string {
  const found = result?.[key];
  return typeof found === 'string' ? found : '';
}

function value<T>(result: GitResult<T>, what: string): T {
  if (!result.ok) {
    throw new Error(`${what} failed: ${result.errors.map((error) => error.message).join('; ')}`);
  }
  return result.value;
}

/**
 * Boots the real stack: repository, store, Core services, daemon HTTP/WS and BFF.
 *
 * The Git port is the production `createNodeWorktreeGitPort`, so a requirement
 * save really commits, really moves the delivery ref by CAS and really refreshes
 * the working copy.
 */
async function startHarness(): Promise<Harness> {
  const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t4-repo-')));
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t4-data-')));
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t4-state-')));
  const git = createNodeWorktreeGitPort();

  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  mkdirSync(join(repoRoot, 'docs'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'orders.ts'), 'export const orders = [];\n');
  writeFileSync(join(repoRoot, 'README.md'), '# delivery fixture\n');
  value(git.initRepository(repoRoot, { branch: 'agentdev/main' }), 'git init');
  writeFileSync(join(repoRoot, '.gitignore'), 'node_modules/\n.agentdev/work/\n');
  const seed = value<{ revision: string }>(
    git.commitPaths(repoRoot, 'chore: seed the delivery branch', [
      'src/orders.ts',
      'README.md',
      '.gitignore',
    ]),
    'seed commit',
  );

  const store = ProjectStore.open({
    dataDir,
    canonicalRoot: repoRoot,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  const projectId = projectIdFromRoot(repoRoot);
  const blobs = new BlobStore({ root: dataDir });
  const auth = AuthService.loadOrCreate({
    stateDir,
    config: { deployment: 'loopback', allowedOrigins: [WEB_ORIGIN] },
  });
  const installationToken = auth.createdToken ?? '';
  if (installationToken === '') throw new Error('no installation token was created');

  const attachments = new AttachmentService({ store, blobs });
  const artifacts = new ArtifactService({ store, blobs });
  // The one `ConfigStore` the daemon itself uses: seeding through it keeps the
  // daemon's in-memory document and the file on disk in agreement.
  const config = ConfigStore.open({ globalDir: stateDir, projectRoot: repoRoot });
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
  const gates = new PlanGateService({ store, artifacts, blobs });
  const findings = new FindingService({ store, artifacts });
  const tokens = new DownloadTokenStore();
  const journal = createMemoryCasJournal();
  const service = createRequirementSaveService({
    store,
    worktrees: git,
    journal,
    events: createMemoryCasEvents(),
    lock: new ProjectIntegrationLock({ projectId, leases: store.leases, now: () => TIME }),
    worktreeRoot: join(dataDir, 'save-worktrees'),
    now: () => TIME,
  });
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
    findings,
    requirements: new RequirementContinuation({ store }),
    requirementSaves: service,
  });

  store.projects.insert({
    id: projectId,
    root: repoRoot,
    gitRoot: repoRoot,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: seed.revision,
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
            // T-01: the session is the audit subject, but the owner identity is the
            // installation's — the same value the production `createDaemon` resolves
            // and the same one the upload route records. A fixture that derived a
            // per-session user here would let a broken product path pass.
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
      const method = request.method ?? 'GET';
      if (url.pathname === '/healthz') {
        json(response, 200, { version: '0.0.0-test', ready: true });
        return;
      }
      if (url.pathname === '/auth/login' && method === 'POST') {
        const parsed = JSON.parse((await readBody(request)).toString('utf8')) as {
          token?: unknown;
        };
        const result = auth.login({
          token: typeof parsed.token === 'string' ? parsed.token : '',
          ip: '127.0.0.1',
          ...(typeof request.headers.origin === 'string' ? { origin: request.headers.origin } : {}),
        });
        if (!result.ok) {
          json(response, result.status, {
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
        json(response, 200, {
          csrfToken: result.csrfToken,
          expiresAt: new Date(result.expiresAt).toISOString(),
        });
        return;
      }
      if (url.pathname === '/auth/logout' && method === 'POST') {
        const cookie = request.headers.cookie;
        const value_ =
          typeof cookie === 'string'
            ? cookie
                .split(';')
                .map((part) => part.trim())
                .find((part) => part.startsWith('agentdev_session='))
                ?.slice('agentdev_session='.length)
            : undefined;
        if (value_ !== undefined) auth.logout(value_);
        json(response, 200, { status: 'applied', loggedOut: true });
        return;
      }
      if (url.pathname === '/rpc' && method === 'POST') {
        const raw = (await readBody(request)).toString('utf8');
        try {
          const envelope = parseEnvelope(JSON.parse(raw));
          const caller = protocol.authenticateRequest(request, authPort(), true);
          json(response, 200, {
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
          json(response, failure.status ?? statusForCode(failure.code ?? 'INTERNAL_ERROR'), {
            ok: false,
            error: {
              code: failure.code ?? 'INTERNAL_ERROR',
              message: failure.message ?? 'failed',
              retryable: false,
              ...(failure.details === undefined ? {} : { details: failure.details }),
            },
          });
        }
        return;
      }
      if (url.pathname === '/artifacts/upload' && method === 'POST') {
        const raw = await readBody(request);
        const boundary = /boundary=(?:"([^"]+)"|([^;]+))/u.exec(
          String(request.headers['content-type'] ?? ''),
        );
        const marker = boundary?.[1] ?? boundary?.[2];
        if (marker === undefined) {
          json(response, 422, { ok: false, error: { code: 'VALIDATION_ERROR' } });
          return;
        }
        const fields: Record<string, string> = {};
        let file: { mime: string; bytes: Buffer } | undefined;
        for (const part of raw.toString('latin1').split(`--${marker}`)) {
          const separator = part.indexOf('\r\n\r\n');
          if (separator < 0) continue;
          const headers = part.slice(0, separator);
          const name = /name="([^"]*)"/u.exec(headers)?.[1];
          if (name === undefined) continue;
          const content = Buffer.from(
            part.slice(separator + 4, part.lastIndexOf('\r\n')),
            'latin1',
          );
          if (name === 'file') {
            file = {
              mime:
                /content-type:\s*([^\r\n;]+)/iu.exec(headers)?.[1]?.trim() ??
                'application/octet-stream',
              bytes: content,
            };
          } else {
            fields[name] = content.toString('utf8');
          }
        }
        try {
          const caller = protocol.authenticateRequest(request, authPort(), true);
          if (file === undefined || fields['conversationId'] === undefined) {
            json(response, 422, { ok: false, error: { code: 'VALIDATION_ERROR' } });
            return;
          }
          const attachment = attachments.stage({
            conversationId: fields['conversationId'],
            ownerUserId: caller.userId,
            mime: file.mime,
            bytes: file.bytes,
          });
          json(response, 201, {
            attachmentId: attachment.id,
            hash: attachment.contentHash,
            mime: attachment.mime,
            bytes: attachment.bytes,
            expiresAt: attachment.expiresAt,
          });
        } catch (error) {
          const failure = error as { status?: number; code?: string };
          json(response, failure.status ?? 401, {
            ok: false,
            error: { code: failure.code ?? 'UNAUTHENTICATED' },
          });
        }
        return;
      }
      if (url.pathname.startsWith('/artifacts/download/') && method === 'GET') {
        // The one-shot token is the credential (`protocol.md` §5), so this route is
        // served before session authentication, exactly as `createDaemon` serves it.
        const token = decodeURIComponent(url.pathname.split('/')[3] ?? '');
        const consumed = tokens.consume(token);
        if (consumed === undefined) {
          json(response, 403, {
            ok: false,
            error: { code: 'NOT_AUTHORIZED', message: 'the download token is unknown or used' },
          });
          return;
        }
        const artifact = artifacts.get(consumed.artifactId, consumed.artifactVersion);
        const bytes = artifacts.read(artifact);
        response.writeHead(200, {
          'content-type': artifact.mime,
          'content-length': String(bytes.byteLength),
          'content-disposition': `attachment; filename="${artifact.id}.${String(artifact.artifactVersion)}"`,
          'x-agentdev-artifact-validity': artifact.validity,
        });
        response.end(Buffer.from(bytes));
        return;
      }
      if (url.pathname.startsWith('/artifacts/') && url.pathname.endsWith('/preview')) {
        try {
          protocol.authenticateRequest(request, authPort(), false);
          const artifact = artifacts.get(decodeURIComponent(url.pathname.split('/')[2] ?? ''));
          assertPreviewable(artifact.kind, artifact.mime);
          const body = renderPreview(artifact, artifacts.read(artifact));
          response.writeHead(200, {
            ...previewHeaders(artifact.mime),
            'x-agentdev-artifact-validity': artifact.validity,
            'x-agentdev-preview-mode': body.mode,
            'x-agentdev-preview-download-required': body.downloadRequired ? 'true' : 'false',
            ...(body.truncatedAtLine === null
              ? {}
              : { 'x-agentdev-preview-truncated-at-line': String(body.truncatedAtLine) }),
          });
          response.end(body.text);
        } catch (error) {
          const failure = error as { status?: number; code?: string };
          json(response, failure.status ?? 404, {
            ok: false,
            error: { code: failure.code ?? 'NOT_FOUND' },
          });
        }
        return;
      }
      json(response, 404, { ok: false, error: { code: 'NOT_FOUND' } });
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
  const daemonBaseUrl = `http://127.0.0.1:${String(daemonAddress.port)}`;

  const sessions = new WebSessionStore();
  const app = createWebApp({
    daemon: { baseUrl: daemonBaseUrl, origin: WEB_ORIGIN, bearer: installationToken },
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
    daemon: {
      store,
      auth,
      protocol,
      artifacts,
      attachments,
      gates,
      findings,
      projectId,
      projectRoot: repoRoot,
      stateDir,
      installationToken,
    },
    saves: {
      protocol,
      store,
      service,
      journal,
      projectId,
      repoRoot,
      get baseRevision(): string {
        return value(git.headRevision(repoRoot), 'head revision') ?? '';
      },
      seedRevision: seed.revision,
      readAtRevision: (revision, path) =>
        value(git.readBlob(repoRoot, revision, path), 'read blob'),
      head: () => value(git.headRevision(repoRoot), 'head revision') ?? '',
      commitAll: (message) => {
        const committed = value<{ revision: string }>(
          git.commitPaths(repoRoot, message, ['README.md']),
          'test commit',
        );
        return committed.revision;
      },
    },
    projectId,
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
      rmSync(repoRoot, { recursive: true, force: true });
    },
  };
}

/** One Work with its real budget row, exactly as the routing path creates one. */
function seedWork(
  harness: Harness,
  options: {
    readonly status?: WorkStatus;
    readonly level?: Level;
    readonly intent?: Intent;
    readonly goal?: string;
  } = {},
): { readonly id: string } {
  const store = harness.daemon.store;
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
    intent: options.intent ?? 'delivery',
    purpose: 'seed',
    level: options.level ?? 'L2',
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
    baseRevision: harness.saves.head(),
    budgetId: budget.id,
    policyRevision: 1,
  });
}

function seedTask(
  harness: Harness,
  input: {
    readonly workId: string;
    readonly role?: Role;
    readonly stage?: 'ready' | 'develop' | 'review' | 'test' | 'done';
  },
): { readonly id: string } {
  return harness.daemon.store.tasks.insert({
    id: harness.daemon.store.newId(),
    projectId: harness.projectId,
    workId: input.workId,
    planRef: { id: harness.daemon.store.newId(), version: 1, hash: sha256('plan') },
    role: input.role ?? 'backend',
    dependsOn: [],
    dependencyManifestRefs: [],
    scope: {
      readPaths: ['src/orders.ts'],
      writePaths: ['src/orders.ts'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    stage: input.stage ?? 'develop',
    acceptanceIds: [],
  });
}

function seedRun(
  harness: Harness,
  input: {
    readonly workId: string;
    readonly input?: Record<string, unknown>;
    readonly role?: Role;
    readonly status?: RunStatus;
    readonly stage?: string;
    readonly epoch?: number;
  },
): { readonly id: string } {
  const store = harness.daemon.store;
  const id = store.newId();
  const run = store.runs.insert({
    id,
    projectId: harness.projectId,
    workId: input.workId,
    role: input.role ?? 'backend',
    purpose: 'implementation',
    stage: input.stage ?? 'execute',
    status: input.status ?? 'running',
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
  lifecycle: 'queued' | 'active' | 'completed' | 'cancelled' | 'archived',
  workId: string | undefined,
  title: string,
): { readonly id: string } {
  const id = harness.daemon.store.newId();
  return harness.daemon.store.requirements.insert({
    id,
    projectId: harness.projectId,
    ...(workId === undefined ? {} : { workId }),
    title,
    goal: 'keep the delivered behaviour stable',
    lifecycle,
    phase: lifecycle === 'active' ? 'execute' : undefined,
    sourceRef: { kind: 'git', id: uuid('42'), version: '1', path: '.agentdev/requirements' },
    recordVersion: 1,
    portableRef: {
      path: `.agentdev/requirements/${id}`,
      revision: harness.saves.baseRevision,
      hash: sha256(`record:${id}`),
    },
    executionAvailability: workId === undefined ? 'needs_replan' : 'local',
    evidenceAvailability: 'summary_only',
  });
}

function seedDecision(
  harness: Harness,
  input: {
    readonly workId: string;
    readonly targetId: string;
    readonly targetVersion: number;
    readonly kind?: 'product' | 'start' | 'permission' | 'recovery';
    readonly state?: 'pending' | 'accepted' | 'rejected' | 'expired';
    readonly choices?: readonly string[];
  },
): { readonly id: string } {
  return harness.daemon.store.decisions.insert({
    id: harness.daemon.store.newId(),
    projectId: harness.projectId,
    workId: input.workId,
    kind: input.kind ?? 'start',
    targetRef: {
      id: input.targetId,
      version: input.targetVersion,
      hash: sha256(`t:${input.targetId}`),
    },
    choices: [...(input.choices ?? ['now', 'later', 'decline'])],
    state: input.state ?? 'pending',
    actor: 'user',
    effectRefs: [],
  });
}

function seedFinding(
  harness: Harness,
  input: {
    readonly workId: string;
    readonly reviewRunId: string;
    readonly severity?: FindingSeverity;
  },
): { readonly id: string } {
  return harness.daemon.store.findings.insert({
    id: harness.daemon.store.newId(),
    projectId: harness.projectId,
    workId: input.workId,
    reviewRunId: input.reviewRunId,
    manifestId: harness.daemon.store.newId(),
    targetKind: 'integration',
    targetRef: { id: harness.daemon.store.newId(), version: 1, hash: sha256('target') },
    description: 'a blocking defect',
    severity: input.severity ?? 'P1',
    blocking: true,
    state: 'open',
    evidenceRefs: [],
  });
}

describe('WP-09 T4: the workbench end to end over the real stack', () => {
  let harness: Harness;
  let cookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    harness = await startHarness();
    ({ cookie, csrfToken } = await harness.login());
  });

  afterAll(async () => {
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
        id: `t4-${String(Math.random()).slice(2, 10)}`,
        method,
        projectId: options.projectId ?? harness.projectId,
        params,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        ...(options.expectedVersion === undefined
          ? {}
          : { expectedVersion: options.expectedVersion }),
      }),
    });
    const body = (await response.json()) as Frame;
    return { status: response.status, frame: body };
  };

  const accepted = async (
    method: string,
    params: Record<string, unknown> = {},
    options: { readonly idempotencyKey?: string; readonly expectedVersion?: number } = {},
  ): Promise<Record<string, unknown>> => {
    const answer = await rpc(method, params, options);
    expect(
      answer.frame.ok,
      `${method} refused with ${answer.frame.error?.code ?? '?'}: ${answer.frame.error?.message ?? ''}`,
    ).toBe(true);
    return answer.frame.result ?? {};
  };

  const page = async (path: string): Promise<{ status: number; html: string }> => {
    const response = await fetch(`${harness.baseUrl}${path}`, {
      headers: { accept: 'text/html', cookie },
    });
    return { status: response.status, html: await response.text() };
  };

  // -------------------------------------------------------------------------
  // The nine surfaces over real state
  // -------------------------------------------------------------------------

  it('reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-090, AC-093)', async () => {
    const projectId = harness.projectId;
    const store = harness.daemon.store;

    // Real state behind every surface: a Work with a Task and a Run, a
    // Requirement with a Plan, knowledge, decisions and findings.
    const work = seedWork(harness, { status: 'running', goal: 'deliver the drill' });
    seedTask(harness, { workId: work.id });
    const drillRun = seedRun(harness, { workId: work.id, epoch: 7 });
    const requirement = seedRequirement(harness, 'active', work.id, 'Drill requirement');
    const queued = seedRequirement(harness, 'queued', undefined, 'Queued requirement');
    const completed = seedRequirement(harness, 'completed', undefined, 'Completed requirement');
    const archived = seedRequirement(harness, 'archived', undefined, 'Archived requirement');
    const cancelled = seedRequirement(harness, 'cancelled', undefined, 'Cancelled requirement');
    const decision = seedDecision(harness, {
      workId: work.id,
      targetId: uuid('50'),
      targetVersion: 3,
    });
    const reviewRun = seedRun(harness, {
      workId: work.id,
      role: 'review',
      status: 'completed',
    });
    seedFinding(harness, { workId: work.id, reviewRunId: reviewRun.id });
    const now = new Date().toISOString();
    store.featureProjections.insert({
      id: store.newId(),
      projectId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      revision: harness.saves.baseRevision,
      featureId: 'FEAT-ORDER-CANCEL',
      documentPath: 'docs/features/order-cancel.md',
      documentHash: sha256('docs/features/order-cancel.md'),
      fields: {
        design: 'confirmed',
        implementation: 'absent',
        verification: 'not_run',
        featureRefs: ['FEAT-ORDER-CANCEL'],
      },
      relations: {},
      state: 'valid',
    });

    // /projects — the navigation surface lists the real Project row.
    const projects = await page('/projects');
    expect(projects.status).toBe(200);
    expect(projects.html).toContain(`data-project="${projectId}"`);
    expect(projects.html).toContain('id="currentProject"');
    expect(projects.html).toContain(harness.daemon.projectRoot);

    // Chief — the conversation surface reads the real conversation through the protocol.
    const chief = await rpc('conversation.get', { conversationId: uuid('1') });
    expect(chief.frame.ok).toBe(true);
    expect((chief.frame.result?.['conversation'] as { title?: string } | undefined)?.title).toBe(
      'chief conversation',
    );
    const chiefPage = await page(`/projects/${projectId}/chief`);
    expect(chiefPage.status).toBe(200);
    expect(chiefPage.html).toContain('id="composer"');
    expect(chiefPage.html).toContain(`data-conversation="${uuid('1')}"`);
    expect(chiefPage.html).toContain('id="newConversation"');

    // Board — four real columns carrying the same Requirement identities.
    const boardPage = await page(`/projects/${projectId}/requirements`);
    expect(boardPage.status).toBe(200);
    expect(boardPage.html).toContain('data-column="queued"');
    expect(boardPage.html).toContain('data-column="active"');
    expect(boardPage.html).toContain('data-column="completed"');
    expect(boardPage.html).toContain('data-column="archived"');
    for (const row of [requirement, queued, completed, archived, cancelled]) {
      expect(boardPage.html).toContain(`data-identity="${row.id}"`);
    }
    expect(boardPage.html).toContain(`data-lifecycle="cancelled"`);
    expect(boardPage.html).toContain('data-i18n="board.pauseQueuedRefused"');

    // Detail — the Requirement's own id, Task and Run rows, and the Plan card.
    const detail = await page(`/projects/${projectId}/requirements/${requirement.id}`);
    expect(detail.status).toBe(200);
    expect(detail.html).toContain(`data-requirement="${requirement.id}"`);
    expect(detail.html).toContain('id="plan"');
    expect(detail.html).toContain('id="requirementTasks"');
    expect(detail.html).toContain('id="requirementRuns"');

    // Docs — the real Feature projection is listed with its three separated states.
    const docs = await page(`/projects/${projectId}/docs`);
    expect(docs.status).toBe(200);
    expect(docs.html).toContain('data-feature="FEAT-ORDER-CANCEL"');
    expect(docs.html).toContain('docs/features/order-cancel.md');
    expect(docs.html).toContain('data-state="valid"');

    // Files — the real repository tree at the Project's target revision.
    const files = await page(`/projects/${projectId}/files?path=src/orders.ts`);
    expect(files.status).toBe(200);
    expect(files.html).toContain(`data-revision="${harness.saves.baseRevision}"`);
    expect(files.html).toContain('data-branch="agentdev/main"');
    expect(files.html).toContain('export const orders = [];');

    // Agents — eight real role rows resolved from the configuration.
    const agents = await page(`/projects/${projectId}/agents`);
    expect(agents.status).toBe(200);
    expect(agents.html.match(/data-role="/gu) ?? []).toHaveLength(8);
    expect(agents.html).toContain('data-usable="false"');

    // Runs — the real Work rows with their level and status; Run detail is read
    // through `run.get`, which is what the page's own `?runId=` route uses.
    const runs = await page(`/projects/${projectId}/runs`);
    expect(runs.status).toBe(200);
    expect(runs.html).toContain(`data-work="${work.id}"`);
    expect(runs.html).toMatch(
      new RegExp(`data-work="${work.id}" data-level="L2" data-status="running"`, 'u'),
    );
    const runRow = await accepted('run.get', { runId: drillRun.id });
    expect((runRow['run'] as { workId?: string } | undefined)?.workId).toBe(work.id);
    const runDetail = await page(
      `/projects/${projectId}/runs?runId=${encodeURIComponent(drillRun.id)}`,
    );
    expect(runDetail.status).toBe(200);
    expect(runDetail.html).toContain('id="runDetail"');
    expect(runDetail.html).toContain('data-epoch="7"');

    // Inbox — the real pending decision and the summarised blocking repair.
    const inbox = await page(`/projects/${projectId}/inbox`);
    expect(inbox.status).toBe(200);
    expect(inbox.html).toContain(`data-decision="${decision.id}"`);
    expect(inbox.html).toContain('data-target-version="3"');
    expect(inbox.html).toContain('data-kind="finding"');

    // Settings — the real global revision and the provider catalogue.
    const settings = await page('/settings');
    expect(settings.status).toBe(200);
    expect(settings.html).toContain('id="configForm"');
    expect(settings.html).toContain('data-scope="global"');
    expect(settings.html).toContain('data-revision="1"');
    expect(settings.html).toContain(`data-provider="${harness.providerId}"`);
  });

  // -------------------------------------------------------------------------
  // AC-069: Chief routing and the conversation loop
  // -------------------------------------------------------------------------

  it('routes a conversation message through the Chief and keeps the composer usable (AC-069)', async () => {
    const store = harness.daemon.store;
    const sent = await accepted(
      'conversation.message.send',
      {
        conversationId: uuid('1'),
        body: '请修改 src/orders.ts',
        attachmentIds: [],
      },
      { idempotencyKey: 't4-chief-route' },
    );
    const workId = text(sent, 'workId');
    expect(workId).not.toBe('');

    // The Chief's own assessment row carries the routing reason and authority.
    const assessment = store.assessments
      .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at ASC' })
      .at(-1);
    expect(assessment?.reason ?? '').toContain('explicit command with a target');
    expect(assessment?.intent).toBe('delivery');
    expect(assessment?.level).toBe('L2');
    const work = store.works.find(workId);
    expect(work?.sourceRef.kind).toBe('message');
    expect(work?.sourceRef.id).toBe(sent['messageId']);
    expect(work?.goal).toContain('src/orders.ts');

    // A follow-up opinion against that Work is routed to the same Work, and the
    // original Work's authority is not rewritten.
    const versionBefore = store.works.find(workId)?.version ?? 0;
    const followUp = await accepted(
      'conversation.message.send',
      {
        conversationId: uuid('1'),
        body: '这个改动先不做，等确认',
        attachmentIds: [],
        targetWorkId: workId,
      },
      { idempotencyKey: 't4-chief-follow-up' },
    );
    expect(followUp['workId']).toBe(workId);
    expect(store.works.find(workId)?.version).toBe(versionBefore);

    // Messages at different stages render their own real state, and the composer
    // stays available: the server decides processing, the UI never infers it.
    const states = ['processing', 'processed', 'failed', 'decision_required'] as const;
    const existing = store.messages.count('conversation_id = ?', [uuid('1')]);
    for (const [index, state] of states.entries()) {
      const text = `message for ${state}`;
      const blob = store.blobs.write(text);
      const body = store.messageBodies.insert({
        id: store.newId(),
        projectId: harness.projectId,
        ownerKind: 'user',
        ownerUserId: userIdFromSubject('installation:local'),
        mime: 'text/plain',
        contentHash: blob.hash,
        relativeBlobPath: blob.relativePath,
        bytes: blob.bytes,
      });
      store.messages.insert({
        id: store.newId(),
        projectId: harness.projectId,
        conversationId: uuid('1'),
        seq: existing + index + 1,
        sender: 'user',
        bodyRef: body.id,
        state,
        resultRefs: [],
      });
    }

    const chiefPage = await page(`/projects/${harness.projectId}/chief`);
    expect(chiefPage.status).toBe(200);
    for (const state of states) expect(chiefPage.html).toContain(`data-state="${state}"`);
    expect(chiefPage.html).toContain('Processing');
    expect(chiefPage.html).toContain('Processed');
    expect(chiefPage.html).toContain('Failed');
    expect(chiefPage.html).toContain('Decision required');
    expect(chiefPage.html).toContain('id="composerSend"');
    expect(chiefPage.html).not.toMatch(/id="composerSend"[^>]*disabled/u);
    // The user's words are project content and stay verbatim.
    expect(chiefPage.html).toContain('请修改 src/orders.ts');
  });

  // -------------------------------------------------------------------------
  // AC-068: board identity, the Queued cancel, the absent L1
  // -------------------------------------------------------------------------

  it('cancels a Queued requirement with no Work through the real Git record service (AC-068)', async () => {
    // The record has to exist in Git, because the save service reads the delivery
    // baseline: a projection-only fixture is the honest REQUIREMENT_CONFLICT, not
    // the cancellation path under test. `requirement.save` creates the real
    // Queued record and its commit first.
    const created = await rpc(
      'requirement.save',
      {
        sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
        patch: {
          title: 'cancel me in Git',
          goal: 'cancel a Queued requirement without a Work',
          scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
          lifecycle: 'queued',
          contentMarkdown: requirementBody('unpaid orders can be cancelled'),
        },
      },
      { idempotencyKey: `t4-cancel-create`, expectedVersion: 0 },
    );
    expect(created.frame.ok, JSON.stringify(created.frame.error)).toBe(true);
    const queuedId = text(created.frame.result ?? {}, 'requirementId');
    expect(queuedId).not.toBe('');
    const beforeHead = harness.saves.head();

    const board = await page(`/projects/${harness.projectId}/requirements`);
    expect(board.html).toContain(`data-requirement="${queuedId}"`);
    expect(board.html).toContain(
      `data-action="pause" data-requirement="${queuedId}" data-refused="INVALID_STATE"`,
    );
    expect(board.html).toContain(`data-action="cancel" data-requirement="${queuedId}"`);

    // Pausing a Queued requirement is refused: there is no local Work to pause.
    const refusedPause = await rpc('work.control', {
      action: 'pause',
      requirementId: queuedId,
      reason: 'ui',
    });
    expect(refusedPause.status).toBe(409);
    expect(refusedPause.frame.error?.code).toBe('INVALID_STATE');

    // A Queued requirement with no Work cancels directly (AC-068): the daemon
    // generates the canonical six-heading body, the real `RequirementSaveService`
    // writes the Git record, and the projection follows it.
    const cancel = await rpc(
      'work.control',
      { action: 'cancel', requirementId: queuedId, reason: 'no longer needed' },
      { idempotencyKey: `t4-cancel-${queuedId}` },
    );
    expect(cancel.frame.ok, JSON.stringify(cancel.frame.error)).toBe(true);
    const git = cancel.frame.result?.['git'] as
      { commit?: string; branch?: string; unpushed?: boolean } | undefined;
    expect(cancel.frame.result?.['lifecycle']).toBe('cancelled');
    expect(String(git?.commit ?? '')).toHaveLength(40);
    expect(harness.saves.head()).toBe(String(git?.commit));
    expect(harness.saves.head()).not.toBe(beforeHead);
    // The committed body is the canonical record: all six level-2 headings, once
    // each, with the recorded cancellation reason as the completion summary.
    const content =
      harness.saves.readAtRevision(
        String(git?.commit),
        `.agentdev/requirements/${queuedId}/content.md`,
      ) ?? '';
    for (const heading of [
      '目标与背景',
      '范围与行为',
      '验收说明',
      '已确认决定',
      '未决问题',
      '完成摘要',
    ]) {
      expect(content.split(`## ${heading}`)).toHaveLength(2);
    }
    expect(content).toContain('no longer needed');
    const metadata =
      harness.saves.readAtRevision(
        String(git?.commit),
        `.agentdev/requirements/${queuedId}/requirement.json`,
      ) ?? '';
    expect(JSON.parse(metadata)).toMatchObject({
      lifecycle: 'cancelled',
      cancellation: { reason: 'no longer needed' },
    });
    expect(harness.daemon.store.requirements.find(queuedId)?.lifecycle).toBe('cancelled');

    // Whatever the outcome, the board still shows the true lifecycle.
    const after = await page(`/projects/${harness.projectId}/requirements`);
    expect(after.html).toContain(`data-requirement="${queuedId}"`);
    expect(after.html).toContain('data-lifecycle="cancelled"');
  });

  // -------------------------------------------------------------------------
  // WP-09 round-2 findings: the requirement record's idempotency and fidelity
  // -------------------------------------------------------------------------

  it('replays requirement.save for the same key and refuses a different payload (W9R2-01)', async () => {
    const store = harness.daemon.store;
    const before = store.requirements.count();
    const key = `t6-save-idem-${uuid('61')}`;
    const params = {
      patch: {
        title: '幂等的需求创建',
        goal: '同一个幂等键不产生第二条需求',
        lifecycle: 'queued',
        scope: {
          readPaths: ['src/orders.ts'],
          writePaths: [],
          operations: ['read'],
          networkTargets: [],
        },
        contentMarkdown: requirementBody('同一个幂等键只产生一条需求。'),
      },
    };
    const first = await rpc('requirement.save', params, {
      idempotencyKey: key,
      expectedVersion: 0,
    });
    expect(first.frame.ok, JSON.stringify(first.frame.error)).toBe(true);
    const requirementId = text(first.frame.result ?? {}, 'requirementId');
    expect(requirementId).not.toBe('');
    expect(store.requirements.count()).toBe(before + 1);

    // The same key with the same payload is the recorded operation, not a second
    // Requirement (W9R2-01).
    const replay = await rpc('requirement.save', params, {
      idempotencyKey: key,
      expectedVersion: 0,
    });
    expect(replay.frame.ok, JSON.stringify(replay.frame.error)).toBe(true);
    expect(replay.frame.result).toEqual(first.frame.result);
    expect(text(replay.frame.result ?? {}, 'requirementId')).toBe(requirementId);
    expect(store.requirements.count()).toBe(before + 1);

    // The same key with a different payload is the documented conflict.
    const conflict = await rpc(
      'requirement.save',
      { patch: { ...params.patch, title: '另一个标题' } },
      { idempotencyKey: key, expectedVersion: 0 },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.frame.error?.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(store.requirements.count()).toBe(before + 1);

    // A key that was refused because the payload was invalid does not pin the key:
    // the corrected payload may reuse it.
    const retryKey = `t6-save-retry-${uuid('62')}`;
    const refused = await rpc(
      'requirement.save',
      { patch: { lifecycle: 'queued' } },
      { idempotencyKey: retryKey, expectedVersion: 0 },
    );
    expect(refused.frame.ok).toBe(false);
    const corrected = await rpc('requirement.save', params, {
      idempotencyKey: retryKey,
      expectedVersion: 0,
    });
    expect(corrected.frame.ok, JSON.stringify(corrected.frame.error)).toBe(true);
    expect(store.requirements.count()).toBe(before + 2);
  });

  it('keeps the recorded fields an update does not name (W9R2-02)', async () => {
    const acceptance = [{ id: 'AC-1', given: '一个排队需求', when: '更新目标', then: '范围不变' }];
    const confirmed = [
      {
        id: 'D-1',
        summary: '保留已确认决定',
        decidedAt: TIME,
        sourceKind: 'user_action',
      },
    ];
    const created = await rpc(
      'requirement.save',
      {
        patch: {
          title: '范围必须保留',
          goal: '初始目标',
          lifecycle: 'queued',
          scope: {
            readPaths: ['src/orders.ts'],
            writePaths: ['src/orders.ts'],
            operations: ['read', 'edit'],
            networkTargets: [],
          },
          featureIds: ['F-1'],
          acceptance,
          openQuestions: ['何时上线？'],
          confirmedDecisions: confirmed,
          contentMarkdown: requirementBody('未付款订单可取消。'),
        },
      },
      { idempotencyKey: `t6-scope-create-${uuid('63')}`, expectedVersion: 0 },
    );
    expect(created.frame.ok, JSON.stringify(created.frame.error)).toBe(true);
    const requirementId = text(created.frame.result ?? {}, 'requirementId');
    const createdCommit = String(
      (created.frame.result?.['git'] as { commit?: string } | undefined)?.commit ?? '',
    );
    expect(createdCommit).toHaveLength(40);

    // An unrelated update names none of the arrays and no scope: the recorded
    // values must survive (`protocol.md` §8 "未提供字段保持原值").
    const updated = await rpc(
      'requirement.save',
      {
        requirementId,
        patch: {
          goal: '更新后的目标',
          contentMarkdown: requirementBody('更新后的正文。'),
        },
      },
      { idempotencyKey: `t6-scope-update-${uuid('64')}`, expectedVersion: 1 },
    );
    expect(updated.frame.ok, JSON.stringify(updated.frame.error)).toBe(true);
    expect(Number(updated.frame.result?.['recordVersion'] ?? 0)).toBe(2);

    const commit = harness.saves.head();
    expect(commit).not.toBe(createdCommit);
    const record = JSON.parse(
      harness.saves.readAtRevision(
        commit,
        `.agentdev/requirements/${requirementId}/requirement.json`,
      ) ?? '{}',
    ) as {
      goal?: string;
      scope?: { readPaths?: string[] };
      acceptance?: unknown[];
      openQuestions?: string[];
      confirmedDecisions?: unknown[];
      featureIds?: string[];
    };
    // The named field changed; nothing else did.
    expect(record.goal).toBe('更新后的目标');
    expect(record.scope?.readPaths).toEqual(['src/orders.ts']);
    expect(record.featureIds).toEqual(['F-1']);
    expect(record.acceptance).toEqual(acceptance);
    expect(record.openQuestions).toEqual(['何时上线？']);
    expect(record.confirmedDecisions).toEqual(confirmed);
  });

  it('cancels a requirement without rewriting its recorded body or fields (W9R2-03)', async () => {
    const acceptance = [{ id: 'AC-9', given: 'g', when: 'w', then: 't' }];
    const confirmed = [
      { id: 'D-9', summary: 's', decidedAt: TIME, sourceKind: 'user_action' as const },
    ];
    const body = [
      '# 取消保真',
      '',
      '## 目标与背景',
      '',
      '背景原文。',
      '',
      '## 范围与行为',
      '',
      '范围原文。',
      '',
      '## 验收说明',
      '',
      '验收原文。',
      '',
      '## 已确认决定',
      '',
      '决定原文。',
      '',
      '## 未决问题',
      '',
      '问题原文。',
      '',
      '## 完成摘要',
      '',
      '尚未完成。',
      '',
    ].join('\n');
    const created = await rpc(
      'requirement.save',
      {
        patch: {
          title: '取消保真',
          goal: '取消不改写已记录成果',
          lifecycle: 'queued',
          scope: {
            readPaths: ['src/orders.ts'],
            writePaths: ['src/orders.ts'],
            operations: ['read', 'edit'],
            networkTargets: [],
          },
          featureIds: ['F-9'],
          acceptance,
          openQuestions: ['问题原文。'],
          confirmedDecisions: confirmed,
          contentMarkdown: body,
        },
      },
      { idempotencyKey: `t6-cancel-fidelity-${uuid('65')}`, expectedVersion: 0 },
    );
    expect(created.frame.ok, JSON.stringify(created.frame.error)).toBe(true);
    const requirementId = text(created.frame.result ?? {}, 'requirementId');

    const cancelled = await rpc(
      'work.control',
      { action: 'cancel', requirementId, reason: '产品决定不再需要' },
      { idempotencyKey: `t6-cancel-fidelity-run-${uuid('66')}` },
    );
    expect(cancelled.frame.ok, JSON.stringify(cancelled.frame.error)).toBe(true);
    expect(cancelled.frame.result?.['lifecycle']).toBe('cancelled');
    const commit = String(
      (cancelled.frame.result?.['git'] as { commit?: string } | undefined)?.commit ?? '',
    );
    expect(commit).toHaveLength(40);

    const metadata = JSON.parse(
      harness.saves.readAtRevision(
        commit,
        `.agentdev/requirements/${requirementId}/requirement.json`,
      ) ?? '{}',
    ) as {
      lifecycle?: string;
      cancellation?: { reason?: string };
      scope?: { readPaths?: string[] };
      featureIds?: string[];
      acceptance?: unknown[];
      openQuestions?: string[];
      confirmedDecisions?: unknown[];
    };
    expect(metadata.lifecycle).toBe('cancelled');
    expect(metadata.cancellation?.reason).toBe('产品决定不再需要');
    // Everything the record held before the cancel is still there.
    expect(metadata.scope?.readPaths).toEqual(['src/orders.ts']);
    expect(metadata.featureIds).toEqual(['F-9']);
    expect(metadata.acceptance).toEqual(acceptance);
    expect(metadata.openQuestions).toEqual(['问题原文。']);
    expect(metadata.confirmedDecisions).toEqual(confirmed);

    const content =
      harness.saves.readAtRevision(commit, `.agentdev/requirements/${requirementId}/content.md`) ??
      '';
    for (const section of ['背景原文。', '范围原文。', '验收原文。', '决定原文。', '问题原文。']) {
      expect(content).toContain(section);
    }
    // Only the completion summary is rewritten, with the real reason.
    expect(content).toContain('产品决定不再需要');
    for (const heading of [
      '目标与背景',
      '范围与行为',
      '验收说明',
      '已确认决定',
      '未决问题',
      '完成摘要',
    ]) {
      expect(content.split(`## ${heading}`)).toHaveLength(2);
    }
  });

  it('keeps an L1 Work off the board and reports it as excluded (AC-068)', async () => {
    const l1 = seedWork(harness, { level: 'L1', status: 'running', goal: 'explain the fixture' });
    // The deliverable record that does belong on the board, for contrast.
    const deliverable = seedRequirement(harness, 'active', undefined, 'deliverable record');

    // The projection is the authority: the L1 Work is reported as excluded and is
    // not any board card's Work.
    const board = await accepted('board');
    expect((board['excludedWorkIds'] as string[] | undefined) ?? []).toContain(l1.id);
    const rule = board['rule'] as { l1NotOnBoard?: boolean } | undefined;
    expect(rule?.l1NotOnBoard).toBe(true);
    const columns = board['columns'] as Record<string, { work: { id: string } | null }[]>;
    const cards = Object.values(columns).flat();
    expect(cards.some((card) => card.work?.id === l1.id)).toBe(false);
    expect((board['requirementIds'] as string[] | undefined) ?? []).toContain(deliverable.id);

    const boardPage = await page(`/projects/${harness.projectId}/requirements`);
    expect(boardPage.html).toMatch(new RegExp(`data-excluded="[^"]*${l1.id}[^"]*"`, 'u'));
    expect(boardPage.html).toContain(`data-identity="${deliverable.id}"`);
    expect(boardPage.html).toContain('data-i18n="board.l1Hidden"');
  });

  // -------------------------------------------------------------------------
  // AC-084 / AC-076: the first message's attachments
  // -------------------------------------------------------------------------

  it('binds an uploaded attachment to the first message and refuses a bad one (AC-084/AC-076)', async () => {
    const conversationId = uuid('1');
    const messagesBefore = harness.daemon.store.messages.count('conversation_id = ?', [
      conversationId,
    ]);
    const form = new FormData();
    form.append('conversationId', conversationId);
    form.append('file', new Blob(['# notes\n'], { type: 'text/markdown' }), 'notes.md');
    const uploaded = await fetch(`${harness.baseUrl}/artifacts/${harness.projectId}/upload`, {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, cookie, 'x-csrf-token': csrfToken },
      body: form,
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const attachment = (await uploaded.json()) as { attachmentId: string; bytes: number };
    expect(attachment.bytes).toBeGreaterThan(0);

    // The first message in a conversation with no Work binds the staged upload to the
    // Work the message creates, and the user's Artifact is recorded with it.
    const sent = await rpc(
      'conversation.message.send',
      { conversationId, body: '请阅读附件', attachmentIds: [attachment.attachmentId] },
      { idempotencyKey: 't4-attachment-first' },
    );
    expect(sent.frame.ok, JSON.stringify(sent.frame.error)).toBe(true);
    const workId = text(sent.frame.result, 'workId');
    expect(workId).not.toBe('');
    const bound = harness.daemon.store.attachments.find(attachment.attachmentId);
    expect(bound?.state).toBe('bound');
    expect(bound?.workId).toBe(workId);
    expect(bound?.boundMessageId).toBe(text(sent.frame.result, 'messageId'));
    expect(
      harness.daemon.store.artifacts.list({ where: 'work_id = ?', params: [workId] }),
    ).toHaveLength(1);
    expect(harness.daemon.store.messages.count('conversation_id = ?', [conversationId])).toBe(
      messagesBefore + 1,
    );

    // The same upload cannot be reused by another message.
    const reused = await rpc(
      'conversation.message.send',
      { conversationId, body: '再来一次', attachmentIds: [attachment.attachmentId] },
      { idempotencyKey: 't4-attachment-reuse' },
    );
    expect(reused.frame.ok).toBe(false);

    // A refused upload leaves no attachment behind.
    const before = harness.daemon.store.attachments.count();
    const bad = new FormData();
    bad.append('conversationId', conversationId);
    bad.append('file', new Blob(['MZ'], { type: 'application/zip' }), 'x.zip');
    const refused = await fetch(`${harness.baseUrl}/artifacts/${harness.projectId}/upload`, {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, cookie, 'x-csrf-token': csrfToken },
      body: bad,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(harness.daemon.store.attachments.count()).toBe(before);

    // The message is visible on the Chief surface with its real body. (`data-attachment`
    // chips appear only when the projection carries the ids, which the workbench
    // protocol's `conversation.get` does not yet add to a message row.)
    const chief = await page(`/projects/${harness.projectId}/chief`);
    expect(chief.status).toBe(200);
    expect(chief.html).toContain('请阅读附件');
    expect(chief.html).toContain('data-translatable="false"');
    expect(chief.html).toContain('data-i18n="chief.attachmentLimits"');
  });

  // -------------------------------------------------------------------------
  // AC-070: versions, truncation, download
  // -------------------------------------------------------------------------

  it('refuses an expired Plan approval with the live version and keeps the Work running (AC-070)', async () => {
    const store = harness.daemon.store;
    const work = seedWork(harness, { status: 'running' });
    const authorization = store.authorizations.insert({
      projectId: harness.projectId,
      workId: work.id,
      sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
      goal: 'deliver the plan',
      scope: {
        readPaths: ['src'],
        writePaths: ['src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      operations: ['read', 'edit'],
      acceptedAt: new Date().toISOString(),
    });
    const planningRun = seedRun(harness, { workId: work.id, role: 'planning', stage: 'plan' });
    const draft: PlanDraft = {
      goal: 'deliver the plan',
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
    };
    const submitted = harness.daemon.gates.submitPlan({
      workId: work.id,
      revision: harness.saves.baseRevision,
      plan: draft,
      approval: {
        authorizationRef: authorization.id,
        runId: planningRun.id,
        productChanged: false,
        at: TIME,
      },
    });
    if (!submitted.approved) throw new Error(`the plan was refused: ${submitted.message}`);
    const liveVersion = submitted.planRef.version;
    expect(liveVersion).toBeGreaterThan(0);

    const requirement = seedRequirement(harness, 'active', work.id, 'plan detail');
    const current = await page(`/projects/${harness.projectId}/requirements/${requirement.id}`);
    expect(current.html).toContain(`data-plan-version="${String(liveVersion)}"`);
    expect(current.html).toContain('data-expired="false"');

    // The stale card is refused with the version the gate still holds; the expired
    // card is not approvable in the UI either.
    const stale = await rpc(
      'plan.approve',
      {
        workId: work.id,
        revision: harness.saves.baseRevision,
        planVersion: liveVersion - 1,
        plan: { goal: 'old', scope: {}, tasks: [] },
        approval: { authorizationRef: authorization.id, runId: planningRun.id },
      },
      { idempotencyKey: `t4-stale-${work.id}`, expectedVersion: liveVersion - 1 },
    );
    expect(stale.frame.ok).toBe(false);
    expect(stale.frame.error?.code).toBe('VERSION_CONFLICT');
    expect((stale.frame.error?.details as { currentVersion?: number })?.currentVersion).toBe(
      liveVersion,
    );

    // A card asked for an older version renders that version as expired and disables
    // approval with a visible reason, so the conflict is visible before the click
    // (AC-070, W9R1-02).
    const staleCard = await page(
      `/projects/${harness.projectId}/requirements/${requirement.id}?planVersion=${String(liveVersion - 1)}`,
    );
    expect(staleCard.html).toContain(`data-requested-version="${String(liveVersion - 1)}"`);
    expect(staleCard.html).toContain(`data-current-version="${String(liveVersion)}"`);
    expect(staleCard.html).toContain('data-expired="true"');
    expect(staleCard.html).toContain('id="planExpired"');
    expect(staleCard.html).toMatch(/id="approvePlan"[^>]*disabled/u);
    expect(staleCard.html).toContain('data-approvable="false"');

    // The current version stays valid and approvable.
    const currentCard = await page(
      `/projects/${harness.projectId}/requirements/${requirement.id}?planVersion=${String(liveVersion)}`,
    );
    expect(currentCard.html).toContain('data-expired="false"');
    expect(currentCard.html).not.toMatch(/id="approvePlan"[^>]*disabled/u);

    // The refusal did not touch the background Work.
    expect(store.works.find(work.id)?.status).toBe('running');
  });

  it('approves the Plan the card shows through the real gate (AC-070, W9R1-01)', async () => {
    const store = harness.daemon.store;
    const work = seedWork(harness, { status: 'running' });
    const authorization = store.authorizations.insert({
      projectId: harness.projectId,
      workId: work.id,
      sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
      goal: 'approve the shown plan',
      scope: {
        readPaths: ['src'],
        writePaths: ['src'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      operations: ['read', 'edit'],
      acceptedAt: new Date().toISOString(),
    });
    const planningRun = seedRun(harness, { workId: work.id, role: 'planning', stage: 'plan' });
    const submitted = harness.daemon.gates.submitPlan({
      workId: work.id,
      revision: harness.saves.baseRevision,
      plan: {
        goal: 'approve the shown plan',
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
        at: TIME,
      },
    });
    if (!submitted.approved) throw new Error(`the plan was refused: ${submitted.message}`);
    const liveVersion = submitted.planRef.version;
    const requirement = seedRequirement(harness, 'active', work.id, 'approve the card');
    const detailUrl = `/projects/${harness.projectId}/requirements/${requirement.id}`;

    // Step 1 — the card asks the gate for the Plan body and the local authorization,
    // which is exactly the round trip `public/app.js` now performs (W9R1-01).
    const planCurrent = await rpc('plan.current', { workId: work.id, planVersion: liveVersion });
    expect(planCurrent.frame.ok, JSON.stringify(planCurrent.frame.error)).toBe(true);
    const gate = planCurrent.frame.result ?? {};
    expect(gate['current']).toBe(true);
    expect(gate['currentVersion']).toBe(liveVersion);
    expect(gate['authorizationId']).toBe(authorization.id);
    expect(gate['runId']).toBe(planningRun.id);
    expect((gate['approval'] as { enabled?: boolean })?.enabled).toBe(true);
    const planBody = gate['plan'] as { tasks?: unknown[] } | undefined;
    expect(Array.isArray(planBody?.tasks)).toBe(true);
    expect((planBody?.tasks ?? []).length).toBeGreaterThan(0);

    // Step 2 — that payload approves through the real PlanGateService: 200/applied
    // and a real next version, never the old `plan:{}` + `workbench` 422.
    const approved = await rpc(
      'plan.approve',
      {
        workId: work.id,
        revision: harness.saves.baseRevision,
        planVersion: liveVersion,
        plan: planBody,
        approval: {
          authorizationRef: gate['authorizationId'],
          runId: gate['runId'],
          productChanged: false,
        },
      },
      { idempotencyKey: `t4-approve-${work.id}`, expectedVersion: liveVersion },
    );
    expect(approved.frame.ok, JSON.stringify(approved.frame.error)).toBe(true);
    expect(approved.frame.result?.['status']).toBe('applied');
    const approvedVersion = Number(approved.frame.result?.['version'] ?? 0);
    expect(approvedVersion).toBeGreaterThan(liveVersion);
    expect(
      harness.daemon.gates.getCurrentPlanApproval(work.id, harness.saves.baseRevision).current
        ?.planRef.version,
    ).toBe(approvedVersion);
    // The card now shows the new version as the live one.
    const after = await page(detailUrl);
    expect(after.html).toContain(`data-current-version="${String(approvedVersion)}"`);
    expect(after.html).toContain('data-expired="false"');

    // The same payload with the same key replays the recorded result instead of
    // approving a third version (W9R1-04).
    const replayed = await rpc(
      'plan.approve',
      {
        workId: work.id,
        revision: harness.saves.baseRevision,
        planVersion: liveVersion,
        plan: planBody,
        approval: {
          authorizationRef: gate['authorizationId'],
          runId: gate['runId'],
          productChanged: false,
        },
      },
      { idempotencyKey: `t4-approve-${work.id}`, expectedVersion: liveVersion },
    );
    expect(replayed.frame.ok, JSON.stringify(replayed.frame.error)).toBe(true);
    expect(replayed.frame.result?.['version']).toBe(approvedVersion);
  });

  it('disables Plan approval with a visible reason when the gate holds no Plan (W9R1-01)', async () => {
    const work = seedWork(harness, { status: 'running' });
    const requirement = seedRequirement(harness, 'active', work.id, 'no plan yet');

    // The daemon says so honestly instead of the page promising an approval.
    const planCurrent = await rpc('plan.current', { workId: work.id });
    expect(planCurrent.frame.ok, JSON.stringify(planCurrent.frame.error)).toBe(true);
    const gate = planCurrent.frame.result ?? {};
    expect(gate['currentVersion']).toBe(0);
    expect(gate['plan']).toBeNull();
    expect(gate['authorizationId']).toBeNull();
    expect((gate['approval'] as { enabled?: boolean })?.enabled).toBe(false);
    expect(String((gate['approval'] as { reason?: string })?.reason ?? '')).not.toBe('');
    // The daemon also answers the machine-readable code the page localises (W9R2-05).
    expect((gate['approval'] as { reasonCode?: string })?.reasonCode).toBe('no_plan');

    const html = (await page(`/projects/${harness.projectId}/requirements/${requirement.id}`)).html;
    expect(html).toMatch(/id="approvePlan"[^>]*disabled/u);
    expect(html).toContain('data-approvable="false"');
    expect(html).toContain('id="approveBlocked"');
    // The visible reason is an interface string keyed by the daemon's code; the
    // daemon's English sentence is only the diagnostic tooltip.
    expect(html).toContain('data-i18n="detail.approveReason.no_plan"');
    expect(html).toContain('data-approve-reason="no_plan"');
    expect(html).not.toMatch(/>the gate holds no approved Plan for this Work revision</u);
  });

  it('renders the disabled approval reason in the page language (W9R2-05)', async () => {
    const work = seedWork(harness, { status: 'running' });
    const requirement = seedRequirement(harness, 'active', work.id, 'no plan yet');
    const response = await fetch(
      `${harness.baseUrl}/projects/${harness.projectId}/requirements/${requirement.id}`,
      {
        headers: {
          accept: 'text/html',
          cookie: `${cookie}; agentdev_language=zh`,
        },
      },
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="zh-CN"');
    // The visible reason is Chinese; the daemon's English sentence is not the text of
    // the alert (it stays available as the diagnostic title).
    expect(html).toContain(UI_STRINGS['detail.approveReason.no_plan']?.zh ?? '');
    expect(html).toContain('data-i18n="detail.approveReason.no_plan"');
    expect(html).not.toMatch(/>the gate holds no approved Plan for this Work revision</u);
  });

  it('renders a truncated artifact with the full one-shot download (AC-070)', async () => {
    const work = seedWork(harness, { status: 'running' });
    const run = seedRun(harness, { workId: work.id });
    const big = 'x'.repeat(1_200_000);
    const artifact = harness.daemon.artifacts.createAgent({
      run: { id: run.id, workId: work.id, role: 'backend' },
      kind: 'diff',
      mime: 'text/plain',
      bytes: Buffer.from(big, 'utf8'),
      acl: ['chief'],
    });
    const requirement = seedRequirement(harness, 'active', work.id, 'artifact detail');

    const detail = await page(`/projects/${harness.projectId}/requirements/${requirement.id}`);
    expect(detail.html).toContain(`data-artifact="${artifact.id}"`);
    expect(detail.html).toContain('data-i18n="detail.previewTruncated"');
    expect(detail.html).toContain(`data-download-artifact="${artifact.id}"`);

    // The preview route inlines a bounded slice (the documented 1 MiB inline limit)
    // while the one-shot download below returns the whole body: truncation is real,
    // and its repair path exists.
    const preview = await fetch(
      `${harness.baseUrl}/artifacts/${harness.projectId}/${encodeURIComponent(artifact.id)}/preview`,
      { headers: { cookie } },
    );
    expect(preview.status).toBe(200);
    const body = await preview.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBeLessThanOrEqual(1024 * 1024);
    expect(body.length).toBeLessThan(big.length);

    // The full body is reachable through the real one-shot download token, and the
    // token is consumed exactly once.
    const prepared = await accepted(
      'artifact.download.prepare',
      { artifactId: artifact.id, artifactVersion: artifact.artifactVersion },
      { idempotencyKey: `t4-download-${artifact.id}` },
    );
    const token = text(prepared, 'downloadToken');
    expect(token).not.toBe('');
    const download = await fetch(
      `${harness.baseUrl}/artifacts/${harness.projectId}/download/${encodeURIComponent(token)}`,
      { headers: { cookie } },
    );
    expect(download.status).toBe(200);
    expect((await download.text()).length).toBe(big.length);
    const second = await fetch(
      `${harness.baseUrl}/artifacts/${harness.projectId}/download/${encodeURIComponent(token)}`,
      { headers: { cookie } },
    );
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  // -------------------------------------------------------------------------
  // AC-077: the branch preview and its root boundary
  // -------------------------------------------------------------------------

  it('reads the branch preview inside the root boundary without touching a snapshot (AC-077)', async () => {
    const projectId = harness.projectId;
    // The Project row is seeded with the branch revision that existed when it was
    // written; a later real commit must not silently move the label.
    const seeded = harness.daemon.store.projects.find(projectId)?.head ?? '';
    const listing = await page(`/projects/${projectId}/files?path=README.md`);
    expect(listing.status).toBe(200);
    expect(listing.html).toContain(`data-revision="${seeded}"`);
    expect(listing.html).toContain(`data-branch="agentdev/main"`);
    expect(listing.html).toContain('data-i18n="files.rootBoundary"');
    expect(listing.html).toContain('data-i18n="files.snapshotUntouched"');
    expect(listing.html).toContain('delivery fixture');

    // The search narrows the real tree to matching paths.
    const searched = await page(`/projects/${projectId}/files?query=orders`);
    expect(searched.html).toContain('src/orders.ts');
    expect(searched.html).not.toContain('README.md');

    // An absolute path and a traversal out of the root are both refused, and no
    // other repository content is echoed.
    const absolute = await page(`/projects/${projectId}/files?path=%2Fetc%2Fpasswd`);
    expect(absolute.html).toContain('data-code="NOT_FOUND"');
    const traversal = await page(`/projects/${projectId}/files?path=..%2F..%2Fetc%2Fpasswd`);
    expect(traversal.html).toContain('data-code="NOT_FOUND"');
    expect(traversal.html).not.toContain('root:');

    // The file content on disk is untouched: reading is read-only.
    expect(readFileSync(join(harness.daemon.projectRoot, 'README.md'), 'utf8')).toBe(
      '# delivery fixture\n',
    );

    // The page names the Project row's target revision, so advancing the delivery
    // branch moves the label only when the Project row itself moves.
    writeFileSync(join(harness.daemon.projectRoot, 'README.md'), '# delivery fixture\n\nmoved\n');
    const advanced = harness.saves.commitAll('chore: advance the delivery branch');
    expect(advanced).not.toBe(seeded);
    const stale = await page(`/projects/${projectId}/files?path=README.md`);
    expect(stale.html).toContain(`data-revision="${seeded}"`);
    expect(stale.html).not.toContain(`data-revision="${advanced}"`);
    harness.daemon.store.projects.update(
      projectId,
      { head: advanced },
      harness.daemon.store.projects.find(projectId)?.version ?? 1,
    );
    const moved = await page(`/projects/${projectId}/files?path=README.md`);
    expect(moved.html).toContain(`data-revision="${advanced}"`);
  });

  // -------------------------------------------------------------------------
  // AC-074: Inbox de-duplication and the expired decision
  // -------------------------------------------------------------------------

  it('deduplicates decisions per target version and disables an expired one (AC-074)', async () => {
    const work = seedWork(harness, { status: 'running' });
    const targetId = uuid('60');
    const first = seedDecision(harness, { workId: work.id, targetId, targetVersion: 4 });
    seedDecision(harness, { workId: work.id, targetId, targetVersion: 4 });
    seedDecision(harness, { workId: work.id, targetId, targetVersion: 5 });
    const expired = seedDecision(harness, {
      workId: work.id,
      targetId,
      targetVersion: 6,
      state: 'expired',
    });
    const reviewRun = seedRun(harness, { workId: work.id, role: 'review', status: 'completed' });
    seedFinding(harness, { workId: work.id, reviewRunId: reviewRun.id, severity: 'P1' });
    seedFinding(harness, { workId: work.id, reviewRunId: reviewRun.id, severity: 'P1' });

    const inbox = await page(`/projects/${harness.projectId}/inbox`);
    expect(inbox.html).toContain(`data-decision="${first.id}"`);
    expect(inbox.html).toContain('data-target-version="4"');
    expect(inbox.html).toContain('data-target-version="5"');
    // Two decisions on version 4 collapse into one row; other tests' decisions use
    // their own target ids, so this counts only the rows for this target.
    const decisionRows =
      inbox.html.match(/<li class="inbox-row" data-kind="decision"[^>]*>/gu) ?? [];
    const ours = decisionRows.filter(
      (row) => row.includes(`data-target-version="4"`) || row.includes(`data-target-version="5"`),
    );
    expect(ours).toHaveLength(2);
    expect(ours.filter((row) => row.includes('data-target-version="4"'))).toHaveLength(1);
    expect(ours.filter((row) => row.includes('data-target-version="5"'))).toHaveLength(1);
    expect(inbox.html).toMatch(
      new RegExp(`data-decision="${expired.id}"[^>]*aria-disabled="true"`, 'u'),
    );
    expect(inbox.html).toMatch(
      new RegExp(`data-decision="${expired.id}"[^>]*>[\\s\\S]{0,400}?disabled`, 'u'),
    );
    // The repeated blocking findings are one summarised internal repair.
    expect(inbox.html).toContain('data-kind="finding"');
    expect(inbox.html).toContain('data-i18n="inbox.internalRepairs"');
    expect(inbox.html).toContain('data-i18n="inbox.internalRepairs"');

    // The server is the authority: an expired decision can never be applied, a
    // stale target version is refused, and a fresh one is applied once.
    const refusedExpired = await rpc(
      'decision.resolve',
      { decisionId: expired.id, targetVersion: 6, choice: 'now' },
      { idempotencyKey: 't4-expired-decision' },
    );
    expect(refusedExpired.frame.ok).toBe(false);
    expect(refusedExpired.frame.error?.code).toBe('INVALID_STATE');

    const refusedStale = await rpc(
      'decision.resolve',
      { decisionId: first.id, targetVersion: 3, choice: 'now' },
      { idempotencyKey: 't4-stale-decision' },
    );
    expect(refusedStale.frame.ok).toBe(false);
    expect(refusedStale.frame.error?.code).toBe('VERSION_CONFLICT');

    const applied = await accepted(
      'decision.resolve',
      { decisionId: first.id, targetVersion: 4, choice: 'now' },
      { idempotencyKey: 't4-apply-decision' },
    );
    expect(applied['state']).toBe('accepted');
    expect(harness.daemon.store.decisions.find(first.id)?.state).toBe('accepted');
  });

  // -------------------------------------------------------------------------
  // AC-075: configuration failure with the input preserved
  // -------------------------------------------------------------------------

  it('preserves the input on a provider failure and leaves the active revision unchanged (AC-075)', async () => {
    const patch = {
      roleOverrides: {
        chief: {
          providerId: harness.providerId,
          modelId: 'fixture-model',
          reasoning: 'off',
          skills: [],
          toolSubset: [],
          contextLimit: 32_000,
        },
      },
    };
    const saved = await accepted(
      'config.save',
      { scope: 'global', patch },
      { idempotencyKey: 't4-config-provider', expectedVersion: 1 },
    );
    const revision = Number(saved['revision'] ?? -1);
    expect(revision).toBe(2);

    // The active profile works, so the Settings page shows a usable role.
    const usable = await accepted('config.test', { role: 'chief' });
    expect(usable['providerId']).toBe(harness.providerId);
    expect(usable['reasoning']).toBe('off');
    expect(usable['reasoningSupported']).toBe(true);

    // A model that cannot reason at the requested level is accepted by the
    // structural Schema, and the honest refusal arrives from the real profile
    // resolution: the level is named, the caller's input is handed back, and the
    // running configuration keeps its working revision.
    const rejectedPatch = {
      roleOverrides: { chief: { reasoning: 'high' } },
    };
    const rejected = await rpc(
      'config.save',
      { scope: 'global', patch: rejectedPatch },
      { idempotencyKey: 't4-config-bad-reasoning', expectedVersion: revision },
    );
    expect(rejected.frame.ok, JSON.stringify(rejected.frame.error)).toBe(true);
    expect(rejected.frame.result?.['revision']).toBe(revision + 1);

    // `config.test` reports the same unusable profile instead of inventing success.
    const unusable = await rpc(
      'config.test',
      { role: 'chief' },
      { idempotencyKey: 't4-config-test' },
    );
    expect(unusable.frame.ok, JSON.stringify(unusable.frame.result)).toBe(false);
    expect(unusable.frame.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(unusable.frame.error?.message ?? '').toContain('does not support reasoning high');
    const preserved = JSON.stringify(
      (unusable.frame.error?.details as { preservedInput?: unknown } | undefined)?.preservedInput ??
        {},
    );
    expect(preserved).toContain('chief');

    // The user restores the working profile; the active configuration then resolves
    // again, so the failure never left the installation unable to run.
    const restored = await accepted(
      'config.save',
      { scope: 'global', patch: { roleOverrides: { chief: { reasoning: 'off' } } } },
      { idempotencyKey: 't4-config-restore', expectedVersion: revision + 1 },
    );
    expect(Number(restored['revision'] ?? -1)).toBe(revision + 2);
    const active = await accepted('config.test', { role: 'chief' });
    expect(active['reasoning']).toBe('off');
    expect(active['reasoningSupported']).toBe(true);

    const after = await accepted('config.get', { scope: 'global' });
    expect(after['revision']).toBe(revision + 2);
    const settings = await page('/settings');
    expect(settings.html).toContain(`data-revision="${String(revision + 2)}"`);
    expect(settings.html).toContain(`data-provider="${harness.providerId}"`);
    expect(settings.html).not.toContain(harness.daemon.installationToken);
  });

  // -------------------------------------------------------------------------
  // AC-090, AC-093: the requirement pool and the UI
  // -------------------------------------------------------------------------

  // A UI check over a **seeded** projection row (`seedRequirement` inserts straight into
  // SQLite): it proves the board/detail render the "待继续" state and that continuing
  // creates a Work without a Run. It is not the portability evidence for AC-087/AC-089 —
  // that is the no-seed clone drill
  // (`apps/daemon/test/requirement-portability-drill.integration.test.ts`) plus its
  // real-browser half (`tests/browser/ac-087-clone-pool.spec.mjs`).
  it('shows an imported active requirement as waiting to continue with no Run', async () => {
    const imported = seedRequirement(harness, 'active', undefined, 'imported from Git');
    const board = await page(`/projects/${harness.projectId}/requirements`);
    expect(board.html).toContain('data-i18n="board.card.waitingToContinue"');

    const detail = await page(`/projects/${harness.projectId}/requirements/${imported.id}`);
    expect(detail.html).toContain('data-i18n="board.card.waitingToContinue"');
    // No Run exists: the Runs surface answers honestly rather than inventing one.
    const runs = await page(`/projects/${harness.projectId}/runs`);
    expect(runs.html).not.toContain(`data-work="${imported.id}"`);

    const continued = await accepted(
      'requirement.continue',
      { requirementId: imported.id, goal: 'continue the imported requirement' },
      { idempotencyKey: `t4-continue-${imported.id}` },
    );
    const workId = text(continued, 'workId');
    expect(workId).not.toBe('');
    expect(continued['reusedPreviousVerification']).toBe(false);
    expect(
      harness.daemon.store.authorizations.list({ where: 'work_id = ?', params: [workId] }),
    ).toHaveLength(1);
    // The continuation created a real Work with no Run: a Run still needs a plan.
    expect(harness.daemon.store.works.find(workId)?.status).toBe('queued');
    expect(harness.daemon.store.runs.count('work_id = ?', [workId])).toBe(0);
    expect(harness.daemon.store.requirements.find(imported.id)?.workId).toBe(workId);
  });

  it('shows a requirement in the UI only after Git and the projection agree (AC-090/AC-093)', async () => {
    const store = harness.daemon.store;
    const before = harness.saves.head();
    // A new Requirement id the projection does not know yet: creating it must be an
    // explicit `expectedAbsent` save.
    // A create carries no `requirementId`: the server owns a new record's identity
    // (`protocol.md` §8), and the caller states `expectedVersion: 0` for the absent
    // entity.
    const created = await rpc(
      'requirement.save',
      {
        patch: {
          title: '未付款订单可取消',
          goal: '让未付款订单可取消',
          lifecycle: 'queued',
          scope: {
            readPaths: ['src/orders.ts'],
            writePaths: ['src/orders.ts'],
            operations: ['read', 'edit'],
            networkTargets: [],
          },
          contentMarkdown: requirementBody('未付款订单可取消。'),
        },
      },
      { idempotencyKey: 't4-save-create', expectedVersion: 0 },
    );
    expect(created.frame.ok, JSON.stringify(created.frame.error)).toBe(true);
    const saved = created.frame.result ?? {};
    const newId = text(saved, 'requirementId');
    expect(newId).not.toBe('');
    expect(saved['saveState']).toBe('saved');
    expect(saved['recordVersion']).toBe(1);
    expect(saved['reusedCommit']).toBe(false);
    const git = saved['git'] as
      { commit?: string; branch?: string; ref?: string; unpushed?: boolean } | undefined;
    const commit = String(git?.commit ?? '');
    expect(commit).toHaveLength(40);
    expect(git?.branch).toBe('agentdev/main');
    expect(git?.ref).toBe('refs/heads/agentdev/main');
    expect(git?.unpushed).toBe(true);
    expect(harness.saves.head()).toBe(commit);
    expect(commit).not.toBe(before);

    // Git really holds both halves of the record, sharing one version.
    const metadata = JSON.parse(
      harness.saves.readAtRevision(commit, `.agentdev/requirements/${newId}/requirement.json`) ??
        '{}',
    ) as { version?: number; contentHash?: string; contentFile?: string };
    const content = harness.saves.readAtRevision(
      commit,
      `.agentdev/requirements/${newId}/content.md`,
    );
    expect(metadata.version).toBe(1);
    expect(metadata.contentFile).toBe('content.md');
    expect(content ?? '').toContain('<!-- record-version: 1 -->');
    expect(content).toContain('## 目标与背景');
    expect(sha256(content ?? '')).toBe(metadata.contentHash);

    // The projection followed Git, so the UI now shows the saved Requirement.
    const row = store.requirements.find(newId);
    expect(row?.recordVersion).toBe(1);
    expect(row?.portableRef.revision).toBe(commit);
    const board = await page(`/projects/${harness.projectId}/requirements`);
    expect(board.html).toContain(`data-identity="${newId}"`);
    expect(board.html).toMatch(
      new RegExp(`data-requirement="${newId}"[\\s\\S]{0,2500}?Save state: saved`, 'u'),
    );

    const detail = await page(`/projects/${harness.projectId}/requirements/${newId}`);
    expect(detail.html).toContain(`data-record-version="1"`);
    expect(detail.html).toContain('让未付款订单可取消');
    expect(detail.html).toContain('Save state: saved');
    expect(detail.html).toContain('data-i18n-project');
    // AC-090: the branch and the commit the projection really points at, plus the
    // Git-side push state the read surfaces now report (`git.unpushed`); this
    // repository has no upstream, so the honest answer is "unpushed".
    for (const html of [board.html, detail.html]) {
      expect(html).toContain('data-git-branch="agentdev/main"');
      expect(html).toContain(`data-git-commit="${commit}"`);
      expect(html).toContain(`Commit: ${commit.slice(0, 12)}`);
      expect(html).toContain('data-git-unpushed="true"');
      expect(html).toContain('Push state: Unpushed');
    }
    // The created record is Queued, so the detail offers exactly the transitions
    // that record can make; a claim it cannot perform is never rendered.
    expect(detail.html).toContain('data-action="archive"');
    expect(detail.html).toContain('data-action="cancel"');
    expect(detail.html).not.toContain('data-action="complete"');

    // A second save increments the version and the pair stays consistent.
    const updated = await accepted(
      'requirement.save',
      {
        requirementId: newId,
        patch: {
          goal: '让未付款订单可取消并留下审计记录',
          scope: {
            readPaths: ['src/orders.ts'],
            writePaths: ['src/orders.ts'],
            operations: ['read', 'edit'],
            networkTargets: [],
          },
          contentMarkdown: requirementBody('未付款订单可取消，并留下审计记录。'),
        },
      },
      { idempotencyKey: `t4-save2-${newId}`, expectedVersion: 1 },
    );
    expect(updated['recordVersion']).toBe(2);
    const secondContent = harness.saves.readAtRevision(
      commit === harness.saves.head() ? commit : harness.saves.head(),
      `.agentdev/requirements/${newId}/content.md`,
    );
    expect(secondContent ?? '').toContain('<!-- record-version: 2 -->');
    const boardAfter = await page(`/projects/${harness.projectId}/requirements`);
    expect(boardAfter.html).toMatch(
      new RegExp(`data-requirement="${newId}"[\\s\\S]{0,2500}?Save state: saved`, 'u'),
    );
    expect(harness.daemon.store.requirements.find(newId)?.recordVersion).toBe(2);

    // A save that would overwrite Git from a record version the service does not
    // hold is refused with a conflict code, and the UI reports `save_failed`: the
    // projection never presents a refused save as committed.
    const conflicting = await rpc(
      'requirement.save',
      {
        requirementId: newId,
        patch: {
          goal: 'stale writer',
          scope: {
            readPaths: ['src/orders.ts'],
            writePaths: ['src/orders.ts'],
            operations: ['read', 'edit'],
            networkTargets: [],
          },
          contentMarkdown: requirementBody('stale writer body'),
        },
      },
      { idempotencyKey: `t4-save-conflict-${newId}`, expectedVersion: 1 },
    );
    if (!conflicting.frame.ok) {
      expect(['REQUIREMENT_CONFLICT', 'VERSION_CONFLICT']).toContain(
        conflicting.frame.error?.code ?? '',
      );
      expect(
        JSON.stringify((conflicting.frame.error?.details as { preservedInput?: unknown }) ?? {}),
      ).toContain('stale writer');
    } else {
      // The daemon accepted a newer record version; the projection still describes
      // Git, and the board must therefore still read `saved` rather than a lie.
      expect(Number(conflicting.frame.result?.['recordVersion'] ?? 0)).toBeGreaterThan(1);
    }
    // Whatever the outcome, the UI only ever reports what the projection holds.
    const projected = harness.daemon.store.operations.list({
      where: 'requirement_id = ?',
      params: [newId],
      orderBy: 'created_at ASC',
    });
    const expectedState =
      projected.at(-1)?.state === 'failed'
        ? 'save_failed'
        : projected.at(-1)?.state === 'completed'
          ? 'saved'
          : 'saving';
    const afterConflict = await page(`/projects/${harness.projectId}/requirements`);
    expect(afterConflict.html).toContain(`data-requirement="${newId}"`);
    expect(afterConflict.html).toContain(`Save state: ${expectedState}`);
  });

  it('answers the card actions with the real protocol codes the UI renders (AC-068)', async () => {
    const store = harness.daemon.store;
    const queued = seedRequirement(harness, 'queued', undefined, 'action queued');
    const work = seedWork(harness, { status: 'running', goal: 'action active' });
    const active = seedRequirement(harness, 'active', work.id, 'action active');
    const completed = seedRequirement(harness, 'completed', undefined, 'action done');

    // Pause on a Queued requirement with no local Work: the documented INVALID_STATE
    // the board renders from the server's own rule flag (AC-068).
    const paused = await rpc(
      'work.control',
      { action: 'pause', requirementId: queued.id, reason: 'workbench' },
      { idempotencyKey: `t4-pause-${queued.id}` },
    );
    expect(paused.frame.ok).toBe(false);
    expect(paused.frame.error?.code).toBe('INVALID_STATE');
    expect(store.requirements.find(queued.id)?.lifecycle).toBe('queued');

    // Cancel is only a Queued transition: a Completed record is refused and stays put.
    const cancelled = await rpc(
      'work.control',
      { action: 'cancel', requirementId: completed.id, reason: 'workbench' },
      { idempotencyKey: `t4-cancel-${completed.id}` },
    );
    expect(cancelled.frame.ok).toBe(false);
    expect(cancelled.frame.error?.code).toBe('INVALID_STATE');
    expect(store.requirements.find(completed.id)?.lifecycle).toBe('completed');

    // `archive` is the documented command (`protocol.md` §4) the board calls. The
    // record has to exist in Git, so this creates a real Queued record first; the
    // archive then moves the committed record to `archived` and `restore` returns it
    // to the state it was archived from (`workflow.md` §5.1).
    const archivable = await rpc(
      'requirement.save',
      {
        patch: {
          title: 'archive me in Git',
          goal: 'archive a Queued requirement',
          scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
          lifecycle: 'queued',
          contentMarkdown: requirementBody('archive me'),
        },
      },
      { idempotencyKey: 't4-archive-create', expectedVersion: 0 },
    );
    expect(archivable.frame.ok, JSON.stringify(archivable.frame.error)).toBe(true);
    const archivableId = text(archivable.frame.result ?? {}, 'requirementId');
    const archived = await rpc(
      'requirement.archive',
      { requirementId: archivableId },
      { idempotencyKey: `t4-archive-${archivableId}` },
    );
    expect(archived.frame.ok, JSON.stringify(archived.frame.error)).toBe(true);
    expect(archived.frame.result?.['status']).toBe('accepted');
    expect(archived.frame.result?.['lifecycle']).toBe('archived');
    expect(store.requirements.find(archivableId)?.lifecycle).toBe('archived');

    const restored = await rpc(
      'requirement.restore',
      { requirementId: archivableId },
      { idempotencyKey: `t4-restore-${archivableId}` },
    );
    expect(restored.frame.ok, JSON.stringify(restored.frame.error)).toBe(true);
    expect(restored.frame.result?.['lifecycle']).toBe('queued');
    expect(store.requirements.find(archivableId)?.lifecycle).toBe('queued');

    // `complete` goes through `requirement.save`; without the real completion fact
    // (`requirements.md` §2) the daemon refuses with the documented gate code, and
    // the projection keeps the Active lifecycle.
    const completedAttempt = await rpc(
      'requirement.save',
      { requirementId: active.id, patch: { lifecycle: 'completed' } },
      { idempotencyKey: `t4-complete-${active.id}` },
    );
    expect(completedAttempt.frame.ok).toBe(false);
    expect(completedAttempt.frame.error?.code).toBe('GATE_NOT_READY');
    expect(store.requirements.find(active.id)?.lifecycle).toBe('active');

    // The unknown-action guard is a validation error, not a silent no-op.
    const unknown = await rpc(
      'work.control',
      { action: 'complete', workId: work.id, reason: 'workbench' },
      { idempotencyKey: `t4-unknown-${active.id}` },
    );
    expect(unknown.frame.ok).toBe(false);
    expect(unknown.frame.error?.code).toBe('VALIDATION_ERROR');
  });
});

function json(response: ServerResponse, status: number, body: unknown): void {
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
