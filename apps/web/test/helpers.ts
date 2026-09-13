/**
 * A real daemon for the WP-09 T3 integration tests.
 *
 * Nothing here is a mock of the product: `ProjectStore` is real SQLite, every Core
 * service is the real implementation, `/rpc` runs the real `WorkbenchProtocol`, and
 * `/ws` performs a real WebSocket upgrade on a loopback port 0 socket. The BFF under
 * test therefore authenticates against the real `AuthService` and reads real rows,
 * which is what makes the acceptance evidence meaningful.
 *
 * This file is a shared test fixture (not a test), so vitest does not collect it.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactService,
  AttachmentService,
  AuthService,
  ConfigStore,
  DecisionService,
  DownloadTokenStore,
  userIdFromSubject,
  EventHub,
  FindingService,
  PlanGateService,
  RequirementContinuation,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot, sha256 } from '@agentdev/storage';
import type {
  FindingSeverity,
  Intent,
  JsonObject,
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

export const PROJECT_ROOT = '/tmp/agentdev-web-root';
export const GIT_HEAD = 'a'.repeat(40);

/** A deterministic uuid-shaped id; `suffix` fills the final 12 hex characters. */
export const uuid = (suffix: string): string =>
  `018f2c1e-9a4b-7c3d-8e5f-${suffix.padStart(12, '0')}`;

export interface TestDaemon {
  readonly store: ProjectStore;
  readonly blobs: BlobStore;
  readonly auth: AuthService;
  readonly protocol: WorkbenchProtocol;
  readonly artifacts: ArtifactService;
  readonly attachments: AttachmentService;
  readonly gates: PlanGateService;
  readonly findings: FindingService;
  /** The repository root the Project row names. */
  readonly projectRoot: string;
  readonly server: Server;
  readonly projectId: string;
  /** e.g. `http://127.0.0.1:53123`. */
  readonly baseUrl: string;
  readonly origin: string;
  /** The installation token; `AuthService.createdToken` is only set on creation. */
  readonly installationToken: string;
  readonly dataDir: string;
  readonly stateDir: string;
  /** The exact `Origin` the daemon allowlists (the BFF's public origin). */
  readonly webOrigin: string;
  close(): Promise<void>;
}

export interface TestDaemonOptions {
  /** Origin the BFF uses for its own public URL and for daemon calls. */
  readonly webOrigin?: string;
  /** Repository root the Project row names; a real directory for the files page. */
  readonly projectRoot?: string;
  /** Shortens the session TTL so an expired cookie is testable. */
  readonly sessionTtlMs?: number;
  readonly now?: () => number;
}

/**
 * Boots the daemon the BFF talks to.
 *
 * It serves exactly the routes the production daemon serves so a BFF test exercises
 * the real status mapping and the real session cookie.
 */
export async function startTestDaemon(options: TestDaemonOptions = {}): Promise<TestDaemon> {
  const webOrigin = options.webOrigin ?? 'http://127.0.0.1:4317';
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-web-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'agentdev-web-auth-'));
  const store = ProjectStore.open({
    dataDir,
    canonicalRoot: projectRoot,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  const projectId = projectIdFromRoot(projectRoot);
  const blobs = new BlobStore({ root: dataDir });
  const auth = AuthService.loadOrCreate({
    stateDir,
    config: {
      deployment: 'loopback',
      allowedOrigins: [webOrigin],
      ...(options.sessionTtlMs === undefined ? {} : { sessionTtlMs: options.sessionTtlMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  });
  const installationToken = auth.createdToken ?? '';
  if (installationToken === '')
    throw new Error('the test daemon did not create an installation token');

  const attachments = new AttachmentService({ store, blobs });
  const artifacts = new ArtifactService({ store, blobs });
  const config = ConfigStore.open({ globalDir: stateDir, projectRoot: dataDir });
  const gates = new PlanGateService({ store, artifacts, blobs });
  const findings = new FindingService({ store, artifacts });
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
    findings,
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
    head: GIT_HEAD,
  });
  store.conversations.insert({
    id: uuid('1'),
    projectId,
    title: 'chief conversation',
    archived: false,
  });

  // AgentDev is a single-user installation: every authenticated session is the
  // same installer user, exactly as the production daemon maps it.
  const installerUserId = userIdFromSubject('installation:local');
  const authPort = (): WorkbenchAuthPort => ({
    authenticate: (input) => {
      const decision = auth.authenticate(input);
      return decision.ok
        ? {
            ok: true,
            subject: `user:${decision.session.id}`,
            userId: installerUserId,
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

  // The exact routes the daemon serves, so the BFF's login/logout and `/rpc`
  // proxying are exercised against the real status mapping.
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';
      if (url.pathname === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ version: '0.0.0-test', ready: true }));
        return;
      }
      if (url.pathname === '/auth/login' && method === 'POST') {
        const body = await readBody(request);
        const parsed = JSON.parse(body.toString('utf8')) as { token?: unknown };
        const result = auth.login({
          token: typeof parsed.token === 'string' ? parsed.token : '',
          ip: '127.0.0.1',
          ...(typeof request.headers.origin === 'string' ? { origin: request.headers.origin } : {}),
        });
        if (!result.ok) {
          const status = result.status;
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              ok: false,
              error: {
                code: status === 429 ? 'BUSY' : 'UNAUTHENTICATED',
                message: 'login failed',
                retryable: false,
              },
            }),
          );
          return;
        }
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': result.cookie,
        });
        response.end(JSON.stringify({ csrfToken: result.csrfToken, expiresAt: result.expiresAt }));
        return;
      }
      if (url.pathname === '/auth/logout' && method === 'POST') {
        const cookie = request.headers.cookie;
        const value =
          typeof cookie === 'string'
            ? cookie
                .split(';')
                .map((part) => part.trim())
                .find((part) => part.startsWith('agentdev_session='))
                ?.slice('agentdev_session='.length)
            : undefined;
        if (value !== undefined) auth.logout(value);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'applied', loggedOut: true }));
        return;
      }
      if (url.pathname === '/rpc' && method === 'POST') {
        const raw = (await readBody(request)).toString('utf8');
        try {
          const envelope = parseEnvelope(JSON.parse(raw));
          const caller = protocol.authenticateRequest(request, authPort(), true);
          const result = protocol.dispatchEnvelope(envelope, caller);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ v: 1, type: 'response', id: envelope.id, ok: true, result }),
          );
        } catch (error) {
          const failure = error as {
            status?: number;
            code?: string;
            message?: string;
            retryable?: boolean;
            details?: JsonObject;
          };
          response.writeHead(failure.status ?? statusForCode(failure.code ?? 'INTERNAL_ERROR'), {
            'content-type': 'application/json',
          });
          response.end(
            JSON.stringify({
              ok: false,
              error: {
                code: failure.code ?? 'INTERNAL_ERROR',
                message: failure.message ?? 'failed',
                retryable: failure.retryable === true,
                ...(failure.details === undefined ? {} : { details: failure.details }),
              },
            }),
          );
        }
        return;
      }
      if (url.pathname.startsWith('/artifacts/') && url.pathname.endsWith('/preview')) {
        const artifactId = url.pathname.split('/')[2] ?? '';
        try {
          protocol.authenticateRequest(request, authPort(), false);
          const artifact = artifacts.get(decodeURIComponent(artifactId));
          const bytes = artifacts.read(artifact);
          response.writeHead(200, {
            'content-type': artifact.mime,
            'x-agentdev-artifact-validity': artifact.validity,
          });
          response.end(Buffer.from(bytes));
        } catch (error) {
          const failure = error as { status?: number; code?: string };
          response.writeHead(failure.status ?? 404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: { code: failure.code ?? 'NOT_FOUND' } }));
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
          response.writeHead(422, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: { code: 'VALIDATION_ERROR' } }));
          return;
        }
        const fields: Record<string, string> = {};
        let file: { mime: string; bytes: Buffer } | undefined;
        const parts = raw.toString('latin1').split(`--${marker}`);
        for (const part of parts) {
          const separator = part.indexOf('\r\n\r\n');
          if (separator < 0) continue;
          const headers = part.slice(0, separator);
          const name = /name="([^"]*)"/u.exec(headers)?.[1];
          if (name === undefined) continue;
          const contentEnd = part.lastIndexOf('\r\n');
          const content = Buffer.from(part.slice(separator + 4, contentEnd), 'latin1');
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
          protocol.authenticateRequest(request, authPort(), true);
          if (file === undefined || fields['conversationId'] === undefined) {
            response.writeHead(422, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ ok: false, error: { code: 'VALIDATION_ERROR' } }));
            return;
          }
          const attachment = attachments.stage({
            conversationId: fields['conversationId'],
            ownerUserId: installerUserId,
            mime: file.mime,
            bytes: file.bytes,
          });
          response.writeHead(201, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              attachmentId: attachment.id,
              hash: attachment.contentHash,
              mime: attachment.mime,
              bytes: attachment.bytes,
              expiresAt: attachment.expiresAt,
            }),
          );
        } catch (error) {
          const failure = error as { status?: number; code?: string };
          response.writeHead(failure.status ?? 401, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ ok: false, error: { code: failure.code ?? 'UNAUTHENTICATED' } }),
          );
        }
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND' } }));
    })();
  });
  server.on('upgrade', (request, socket) => {
    protocol.handleUpgrade(request, socket, authPort());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address !== 'object') throw new Error('no server address');
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  return {
    store,
    blobs,
    auth,
    protocol,
    artifacts,
    attachments,
    gates,
    findings,
    projectRoot,
    server,
    projectId,
    baseUrl,
    origin: webOrigin,
    installationToken,
    dataDir,
    stateDir,
    webOrigin,
    close: async () => {
      protocol.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

/** Seeds one Work with a real budget row, exactly as the routing path does. */
export function seedWork(
  daemon: TestDaemon,
  options: {
    readonly status?: WorkStatus;
    readonly level?: Level;
    readonly intent?: Intent;
    readonly goal?: string;
  } = {},
): { readonly id: string } {
  const store = daemon.store;
  const id = store.newId();
  const budget = store.budgets.insert({
    projectId: daemon.projectId,
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
    projectId: daemon.projectId,
    intent: options.intent ?? 'delivery',
    purpose: 'seed',
    level: options.level ?? 'L2',
    goal: options.goal ?? 'seed a work item',
    scope: {
      readPaths: ['packages/core/src'],
      writePaths: ['packages/core/src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'action', id: uuid('30'), version: '1' },
    status: options.status ?? 'queued',
    blockerIds: [],
    baseRevision: GIT_HEAD,
    budgetId: budget.id,
    policyRevision: 1,
  });
}

/** Seeds one Requirement projection row; `workId` links it to a local Work. */
export function seedRequirement(
  daemon: TestDaemon,
  lifecycle: 'queued' | 'active' | 'completed' | 'cancelled' | 'archived',
  workId?: string,
  title = `requirement ${lifecycle}`,
): { readonly id: string } {
  const id = daemon.store.newId();
  return daemon.store.requirements.insert({
    id,
    projectId: daemon.projectId,
    ...(workId === undefined ? {} : { workId }),
    title,
    goal: 'keep the delivered behaviour stable',
    lifecycle,
    phase: lifecycle === 'active' ? 'execute' : undefined,
    sourceRef: { kind: 'git', id: uuid('42'), version: '1', path: '.agentdev/requirements' },
    recordVersion: 1,
    portableRef: {
      path: `.agentdev/requirements/${id}`,
      revision: GIT_HEAD,
      hash: sha256(`record:${id}`),
    },
    executionAvailability: workId === undefined ? 'needs_replan' : 'local',
    evidenceAvailability: 'summary_only',
  });
}

/** Seeds one decision row against an explicit target version. */
export function seedDecision(
  daemon: TestDaemon,
  input: {
    readonly workId: string;
    readonly targetId: string;
    readonly targetVersion: number;
    readonly state?: 'pending' | 'accepted' | 'rejected' | 'expired';
    readonly choices?: readonly string[];
  },
): { readonly id: string } {
  return daemon.store.decisions.insert({
    id: daemon.store.newId(),
    projectId: daemon.projectId,
    workId: input.workId,
    kind: 'start',
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

/** Seeds one Run plus an Attempt so Run detail has real attempt/epoch rows. */
export function seedRun(
  daemon: TestDaemon,
  input: {
    readonly workId: string;
    readonly taskId?: string;
    readonly role?: Role;
    readonly status?: RunStatus;
    readonly stage?: string;
    readonly epoch?: number;
  },
): { readonly id: string } {
  const store = daemon.store;
  const id = store.newId();
  const run = store.runs.insert({
    id,
    projectId: daemon.projectId,
    workId: input.workId,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
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
    projectId: daemon.projectId,
    runId: id,
    number: 1,
    status: 'running',
    ownerEpoch: input.epoch ?? 3,
    runnerId: 'runner-1',
  });
  return run;
}

/** Seeds one blocking Finding so the Inbox grouping has real rows. */
export function seedFinding(
  daemon: TestDaemon,
  input: {
    readonly workId: string;
    readonly reviewRunId: string;
    readonly severity?: FindingSeverity;
  },
): { readonly id: string } {
  return daemon.store.findings.insert({
    id: daemon.store.newId(),
    projectId: daemon.projectId,
    workId: input.workId,
    reviewRunId: input.reviewRunId,
    manifestId: daemon.store.newId(),
    // An integration finding is bound by its target ref, so it needs no task row.
    targetKind: 'integration',
    targetRef: { id: daemon.store.newId(), version: 1, hash: sha256('target') },
    description: 'a blocking defect',
    severity: input.severity ?? 'P1',
    blocking: true,
    state: 'open',
    evidenceRefs: [],
  });
}

async function readBody(request: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}
