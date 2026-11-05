/**
 * Image upload and read routes (U6): the cookie authenticates, the CSRF header proves the page, and
 * the bytes decide the format. The browser then reads the image from an immutable address.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { AuthService, CSRF_HEADER, SESSION_COOKIE } from '../src/server/auth.ts';
import { RpcRouter } from '../src/server/rpc.ts';
import { ATTACHMENT_PATH_PREFIX, UPLOAD_PATH, createWorkbenchServer, type WorkbenchServer } from '../src/server/http.ts';
import { MAX_IMAGE_BYTES, imageIdOf, readAttachmentBytes, readDocument, readImage } from '../src/server/attachments.ts';
import { pdfBytes } from './document-fixtures.ts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'correct horse battery staple';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function harness(): Promise<{
  readonly origin: string;
  readonly agentDir: string;
  login(): Promise<{ cookie: string; csrf: string }>;
  upload(body: Buffer, auth?: { cookie: string; csrf: string }, contentType?: string, name?: string): Promise<Response>;
  get(path: string, cookie?: string): Promise<Response>;
}> {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-uploads-'));
  const agentDir = join(root, 'agent');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  const auth = new AuthService({ accessPassword: PASSWORD });
  const router = new RpcRouter();
  router.register('auth.login', {
    write: false,
    run: (params, context) => {
      const outcome = auth.login(String(params['password'] ?? ''));
      if (outcome === undefined) throw new Error('bad password');
      context.setCookie?.(outcome.cookie);
      return { csrfToken: outcome.csrfToken };
    },
  });
  const workbench: WorkbenchServer = createWorkbenchServer({ store, auth, router, attachmentDir: agentDir });
  const { origin } = await workbench.listen(0);
  cleanups.push(async () => {
    await workbench.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    origin,
    agentDir,
    async login() {
      const response = await fetch(`${origin}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'r1', method: 'auth.login', params: { password: PASSWORD } }),
      });
      const cookie = /kaiming_session=([0-9a-f]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
      const body = (await response.json()) as { result: { csrfToken: string } };
      return { cookie, csrf: body.result.csrfToken };
    },
    async upload(body, session, contentType = 'image/png', name) {
      const headers: Record<string, string> = { 'content-type': contentType };
      if (name !== undefined) headers['x-kaiming-filename'] = encodeURIComponent(name);
      if (session !== undefined) {
        headers['cookie'] = `${SESSION_COOKIE}=${session.cookie}`;
        headers[CSRF_HEADER] = session.csrf;
      }
      return fetch(`${origin}${UPLOAD_PATH}`, { method: 'POST', headers, body });
    },
    async get(path, cookie) {
      return fetch(`${origin}${path}`, {
        headers: cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` },
      });
    },
  };
}

describe('image upload route', () => {
  it('requires a session and the CSRF token before accepting bytes', async () => {
    const h = await harness();
    expect((await h.upload(PNG)).status).toBe(401);

    const session = await h.login();
    const bare = await fetch(`${h.origin}${UPLOAD_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', cookie: `${SESSION_COOKIE}=${session.cookie}` },
      body: PNG,
    });
    expect(bare.status).toBe(403);
    expect((await bare.json()) as { error: { details?: { csrf?: boolean } } }).toMatchObject({
      error: { details: { csrf: true } },
    });
  });

  it('stores the bytes under their digest and serves them back immutably', async () => {
    const h = await harness();
    const session = await h.login();
    const response = await h.upload(PNG, session);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { id: string; mimeType: string; url: string; bytes: number } };
    expect(body.result.id).toBe(imageIdOf(PNG));
    expect(body.result.mimeType).toBe('image/png');
    expect(body.result.bytes).toBe(PNG.byteLength);
    expect(body.result.url).toBe(`${ATTACHMENT_PATH_PREFIX}${imageIdOf(PNG)}`);
    expect(readImage(h.agentDir, body.result.id)?.bytes.equals(PNG)).toBe(true);

    const image = await h.get(body.result.url, session.cookie);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);

    // The address is private: without the cookie it is not readable.
    expect((await h.get(body.result.url)).status).toBe(401);
  });

  it('refuses content that is not an image and bodies past the limit', async () => {
    const h = await harness();
    const session = await h.login();
    const binary = await h.upload(Buffer.from([0, 1, 2, 3, 4]), session, 'image/png', 'scan.bin');
    expect(binary.status).toBe(400);
    expect(((await binary.json()) as { error: { code: string } }).error.code).toBe('INVALID_ARGUMENT');

    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
    const oversized = await h.upload(huge, session);
    expect(oversized.status).toBe(400);
    const body = (await oversized.json()) as { error: { message: string; details: { limit: number } } };
    expect(body.error.details.limit).toBe(MAX_IMAGE_BYTES);
  });

  it('answers 404 for an unknown id and for a path that is not an id', async () => {
    const h = await harness();
    const session = await h.login();
    expect((await h.get(`${ATTACHMENT_PATH_PREFIX}${'0'.repeat(32)}`, session.cookie)).status).toBe(404);
    expect((await h.get(`${ATTACHMENT_PATH_PREFIX}..%2F..%2Fetc%2Fpasswd`, session.cookie)).status).toBe(404);
  });

  it('accepts a PDF document, extracts its text and serves the original bytes', async () => {
    const h = await harness();
    const session = await h.login();
    const pdf = pdfBytes('Uploaded PDF');
    const response = await h.upload(pdf, session, 'application/pdf', 'research.pdf');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { id: string; kind: string; name: string; mimeType: string; url: string; extractedChars: number };
    };
    expect(body.result.kind).toBe('document');
    expect(body.result.name).toBe('research.pdf');
    expect(body.result.mimeType).toBe('application/pdf');
    expect(readDocument(h.agentDir, body.result.id)?.text).toContain('Uploaded PDF');
    expect(readAttachmentBytes(h.agentDir, body.result.id)?.equals(pdf)).toBe(true);

    const served = await h.get(body.result.url, session.cookie);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await served.arrayBuffer()).equals(pdf)).toBe(true);
  });
});
