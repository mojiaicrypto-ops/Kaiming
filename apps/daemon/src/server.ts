/**
 * The WP-03 HTTP surface: upload, bind, preview, download and health.
 *
 * `protocol.md` §5 fixes the shapes; this module is the only place that turns them
 * into responses, so an endpoint cannot quietly serve a preview without the isolation
 * headers or leak a path in `/healthz`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { JsonObject, Role } from '@agentdev/contracts';
import { StorageError, withTransaction } from '@agentdev/storage';
import type { BlobStore, ProjectStore } from '@agentdev/storage';
import {
  ProtocolError,
  assertPreviewable,
  payloadHashOf,
  previewHeaders,
  userIdFromSubject,
  renderPreview,
  sendMessage,
  type ArtifactService,
  type AttachmentService,
  type AuthService,
  type DownloadTokenStore,
  type MessageSendParams,
} from '@agentdev/core';

export interface DaemonOptions {
  readonly projectId: string;
  readonly store: ProjectStore;
  readonly blobs: BlobStore;
  readonly auth: AuthService;
  readonly attachments: AttachmentService;
  readonly artifacts: ArtifactService;
  readonly tokens: DownloadTokenStore;
  /** Reported by `/healthz`; never a path or a secret. */
  readonly version: string;
  /** Role whose artifacts the daemon serves; ACL checks use it. */
  readonly role?: Role;
  readonly now?: () => number;
}

interface Authed {
  /** Audit subject: the session or the installation credential. */
  readonly subject: string;
  /**
   * Ownership identity for uploads and messages.
   *
   * AgentDev is a single-user, self-hosted installation, so every authenticated
   * session is the same user: an upload made in one browser session is bindable from
   * another, and the value stays stable across restarts (W3-03).
   */
  readonly userId: string;
}

/** A request-level failure that already maps onto the protocol error table. */
class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createDaemon(options: DaemonOptions): Server {
  const role = options.role ?? 'chief';
  const now = options.now ?? (() => Date.now());

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      fail(response, error);
    });
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    if (path === '/healthz' && method === 'GET') {
      json(response, 200, { version: options.version, ready: true });
      return;
    }

    if (path.startsWith('/artifacts/download/') && method === 'GET') {
      // The one-shot token is the credential for a download (`protocol.md` §5), so
      // this route is served before session authentication.
      serveDownload(response, segment(path, 3));
      return;
    }

    const authed = authenticate(request, method !== 'GET' && method !== 'HEAD');

    if (path === '/artifacts/upload' && method === 'POST') {
      await upload(request, response, authed);
      return;
    }
    if (path.startsWith('/artifacts/uploads/') && method === 'DELETE') {
      const attachmentId = segment(path, 3);
      const removed = options.attachments.remove(attachmentId, authed.userId);
      json(response, 200, { attachmentId: removed.id, state: removed.state });
      return;
    }
    if (path.startsWith('/artifacts/') && path.endsWith('/preview') && method === 'GET') {
      const artifactId = segment(path, 2);
      const artifact = options.artifacts.get(artifactId);
      assertReadable(artifact, authed.userId);
      assertPreviewable(artifact.kind, artifact.mime);
      const bytes = options.artifacts.read(artifact);
      const body = renderPreview(artifact, bytes);
      response.writeHead(200, {
        ...previewHeaders(artifact.mime),
        // The client renders the validity badge from the response, so an invalidated
        // artifact is not silently presented as current (W3-06).
        'x-agentdev-artifact-validity': artifact.validity,
        'x-agentdev-preview-mode': body.mode,
        'x-agentdev-preview-download-required': body.downloadRequired ? 'true' : 'false',
        ...(body.truncatedAtLine === null
          ? {}
          : { 'x-agentdev-preview-truncated-at-line': String(body.truncatedAtLine) }),
        'content-length': String(Buffer.byteLength(body.text, 'utf8')),
      });
      response.end(body.text);
      return;
    }
    if (path === '/artifacts/download.prepare' && method === 'POST') {
      const payload = await readJson(request);
      const artifactId = stringField(payload, 'artifactId');
      const version = payload['artifactVersion'];
      if (version !== undefined && (typeof version !== 'number' || !Number.isInteger(version))) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'artifactVersion must be an integer');
      }
      const artifact = options.artifacts.get(artifactId, version);
      assertReadable(artifact, authed.userId);
      options.tokens.prune();
      const grant = options.tokens.issue(artifact);
      json(response, 200, {
        downloadToken: grant.token,
        expiresAt: grant.expiresAt,
        artifactId: grant.artifactId,
        artifactVersion: grant.artifactVersion,
        validity: artifact.validity,
      });
      return;
    }
    if (path === '/conversation.message.send' && method === 'POST') {
      const payload = await readJson(request);
      const idempotencyKey =
        typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined;
      if (
        idempotencyKey !== undefined &&
        (idempotencyKey.length === 0 || idempotencyKey.length > 128)
      ) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'the idempotency key must be 1–128 characters',
        );
      }
      const params = {
        conversationId: stringField(payload, 'conversationId'),
        body: stringField(payload, 'body'),
        attachmentIds: Array.isArray(payload['attachmentIds'])
          ? (payload['attachmentIds'] as unknown[]).map(String)
          : [],
        ...(typeof payload['targetWorkId'] === 'string'
          ? { targetWorkId: payload['targetWorkId'] }
          : {}),
        ...(Array.isArray(payload['workItems'])
          ? { workItems: payload['workItems'] as NonNullable<MessageSendParams['workItems']> }
          : {}),
      };
      // The message, its Work, the attachment bindings, the user artifacts, the
      // command-ledger entry and the `message.received` event commit together; a
      // failure leaves every upload staged so the client can retry with the same ids.
      // A client cannot hand itself authority: the only authorization a message
      // creates is the one the Core derives from the message's own named target
      // (AC-005); the wire format has no `authorization` field (W3R3 review).
      const outcome = withTransaction(options.store.db, () => {
        let commandId: string | undefined;
        if (idempotencyKey !== undefined) {
          const begun = options.store.commands.begin({
            subject: authed.subject,
            operation: 'conversation.message.send',
            key: idempotencyKey,
            payloadHash: payloadHashOf('conversation.message.send', params),
          });
          if (begun.kind === 'conflict') {
            throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', begun.reason);
          }
          if (begun.kind === 'replay') {
            return begun.response as JsonObject;
          }
          commandId = begun.commandId;
        }
        const sent = sendMessage(
          {
            projectId: options.projectId,
            store: options.store,
            attachments: options.attachments,
            artifacts: options.artifacts,
            blobs: options.blobs,
            now,
          },
          { ...params, ownerUserId: authed.userId, acl: [role] },
        );
        const reply: JsonObject = {
          messageId: sent.messageId,
          workId: sent.workId,
          // A split message needs every Work id and the authorization it created.
          workIds: [...sent.workIds],
          authorizationId: sent.authorizationId,
          state: sent.state,
          version: sent.version,
        };
        options.store.events.append({
          name: 'message.received',
          entityId: sent.messageId,
          entityVersion: sent.version,
          data: {
            messageId: sent.messageId,
            workId: sent.workId,
            workIds: [...sent.workIds],
            authorizationId: sent.authorizationId,
            attachmentIds: [...sent.attachmentIds],
            artifactIds: [...sent.artifactIds],
          },
        });
        if (commandId !== undefined) options.store.commands.complete(commandId, reply);
        return reply;
      });
      json(response, 202, outcome);
      return;
    }

    throw new HttpError(404, 'NOT_FOUND', `no route for ${method} ${path}`);
  }

  /**
   * Enforces artifact readability for one authenticated user.
   *
   * The role ACL decides which roles may see an artifact, and a user upload is
   * additionally tied to the user that supplied it. Under the single-user product
   * model every authenticated session maps to the same installation user, so this is
   * a second deployment's data that stays out of reach, not one browser from another
   * (the session id stays an audit subject only).
   */
  function assertReadable(artifact: ReturnType<ArtifactService['get']>, userId: string): void {
    if (!options.artifacts.isReadable(artifact, role)) {
      throw new HttpError(403, 'NOT_AUTHORIZED', 'the artifact is not readable by this role');
    }
    if (artifact.origin === 'user' && artifact.attachmentId !== undefined) {
      const attachment = options.store.attachments.find(artifact.attachmentId);
      if (attachment !== undefined && attachment.ownerUserId !== userId) {
        throw new HttpError(403, 'NOT_AUTHORIZED', 'the artifact belongs to another user');
      }
    }
  }

  /** Serves one artifact body for a consumed download token. */
  function serveDownload(response: ServerResponse, token: string): void {
    const grant = options.tokens.consume(token);
    if (grant === undefined) {
      throw new HttpError(403, 'NOT_AUTHORIZED', 'the download token is unknown, used or expired');
    }
    const artifact = options.artifacts.get(grant.artifactId, grant.artifactVersion);
    if (!options.artifacts.isReadable(artifact, role)) {
      throw new HttpError(403, 'NOT_AUTHORIZED', 'the artifact is not readable by this role');
    }
    const bytes = options.artifacts.read(artifact);
    response.writeHead(200, {
      'content-type': artifact.mime,
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${artifact.id}.${artifact.artifactVersion}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-agentdev-artifact-validity': artifact.validity,
    });
    response.end(Buffer.from(bytes));
  }

  function authenticate(request: IncomingMessage, isWrite: boolean): Authed {
    const userId = userIdFromSubject('installation:local');
    const bearer = options.auth.authenticateBearer(request.headers.authorization);
    if (bearer.ok) {
      // The daemon/CLI credential is a full-project subject.
      return { subject: 'installation:local', userId };
    }
    const decision = options.auth.authenticate({
      ...(cookieOf(request) === undefined ? {} : { cookie: cookieOf(request) as string }),
      ...(typeof request.headers['x-csrf-token'] === 'string'
        ? { csrfToken: request.headers['x-csrf-token'] }
        : {}),
      ...(typeof request.headers.origin === 'string' ? { origin: request.headers.origin } : {}),
      isWrite,
    });
    if (!decision.ok) {
      throw new HttpError(decision.status, decision.code, decision.message);
    }
    return { subject: `user:${decision.session.id}`, userId };
  }

  async function upload(
    request: IncomingMessage,
    response: ServerResponse,
    authed: Authed,
  ): Promise<void> {
    const contentType = String(request.headers['content-type'] ?? '');
    if (!contentType.includes('multipart/form-data')) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'expected multipart/form-data');
    }
    const body = await readBody(request);
    const parsed = parseMultipart(body, contentType);
    const conversationId = parsed.fields['conversationId'];
    if (conversationId === undefined) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'conversationId is required');
    }
    const file = parsed.file;
    if (file === undefined) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'a file part is required');
    }
    // Opportunistic sweep: staged uploads that outlived their TTL are released
    // whenever a client uploads again (no scheduler exists yet).
    options.attachments.expireStale();
    const attachment = options.attachments.stage({
      conversationId,
      ownerUserId: authed.userId,
      mime: file.mime || 'application/octet-stream',
      bytes: file.bytes,
    });
    json(response, 201, {
      attachmentId: attachment.id,
      hash: attachment.contentHash,
      mime: attachment.mime,
      bytes: attachment.bytes,
      expiresAt: attachment.expiresAt,
    });
  }

  function fail(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof ProtocolError) {
      const status =
        error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'NOT_AUTHORIZED' || error.code === 'ATTACHMENT_ALREADY_BOUND'
            ? 403
            : error.code === 'INTERNAL_ERROR'
              ? 500
              : 400;
      json(response, status, {
        ok: false,
        error: { code: error.code, message: error.message, retryable: error.retryable },
      });
      return;
    }
    if (error instanceof StorageError) {
      // Only a reference to a missing record is the caller's fault; anything else
      // (busy, conflict, blob mismatch) stays a server-side failure.
      const missing = error.code === 'NOT_FOUND' || /FOREIGN KEY/u.test(error.message);
      if (!missing) {
        json(response, 500, {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'the change could not be stored',
            retryable: false,
          },
        });
        return;
      }
      json(response, 404, {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'the request references a record that does not exist',
          retryable: false,
        },
      });
      return;
    }
    if (error instanceof HttpError) {
      json(response, error.status, {
        ok: false,
        error: { code: error.code, message: error.message, retryable: false, ...error.details },
      });
      return;
    }
    // Never echo an internal message or a path to the client.
    json(response, 500, {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'the request could not be completed',
        retryable: false,
      },
    });
  }

  return server;
}

/** Starts a daemon on loopback and resolves once it is listening. */
export async function listen(
  server: Server,
  options: { readonly port: number; readonly host?: string },
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

/** Reads a required string field without ever stringifying a non-string. */
function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${key} must be a string`);
  }
  return value;
}

function cookieOf(request: IncomingMessage): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return undefined;
  const entry = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('agentdev_session='));
  return entry?.slice('agentdev_session='.length);
}

function segment(path: string, index: number): string {
  const value = path.split('/')[index];
  if (value === undefined || value.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', `missing path segment ${index}`);
  }
  return decodeURIComponent(value);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload, 'utf8')),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.byteLength;
    if (total > limit) {
      throw new HttpError(413, 'VALIDATION_ERROR', 'the request body is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request);
  if (body.byteLength === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'the request body is not a JSON object');
  }
}

interface MultipartPart {
  readonly mime: string;
  readonly bytes: Buffer;
}

/**
 * Minimal `multipart/form-data` parser: text fields and one or more file parts.
 *
 * The daemon avoids a new dependency for one documented endpoint; the parser only
 * splits on the declared boundary and never trusts a part header beyond its name and
 * content type.
 */
export function parseMultipart(
  body: Buffer,
  contentType: string,
): { readonly fields: Record<string, string>; readonly file?: MultipartPart } {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/u.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined || boundary.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'multipart boundary is missing');
  }
  const marker = Buffer.from(`--${boundary}`, 'utf8');
  const fields: Record<string, string> = {};
  let file: MultipartPart | undefined;
  let cursor = 0;
  while (true) {
    const start = body.indexOf(marker, cursor);
    if (start === -1) break;
    const next = body.indexOf(marker, start + marker.byteLength);
    if (next === -1) break;
    const part = body.subarray(start + marker.byteLength, next);
    cursor = next;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    // The trailing CRLF before the next boundary belongs to the framing, not the data.
    const content = part.subarray(headerEnd + 4, Math.max(headerEnd + 4, part.byteLength - 2));
    const name = /name="([^"]*)"/u.exec(headers)?.[1];
    if (name === undefined) continue;
    const mime = /content-type:\s*([^\r\n;]+)/iu.exec(headers)?.[1]?.trim();
    if (name === 'file') {
      file = { mime: mime ?? 'application/octet-stream', bytes: content };
    } else {
      fields[name] = content.toString('utf8');
    }
  }
  return { fields, ...(file === undefined ? {} : { file }) };
}
