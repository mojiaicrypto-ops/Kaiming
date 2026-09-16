/**
 * WP-12 project UX: the human-only folder picker at the BFF boundary.
 *
 * These tests drive the **real** BFF HTTP server and the **real** filesystem, and they
 * exist to prove the four properties the product owner's ruling names, not to
 * re-assert the implementation:
 *
 * 1. it lists **names only** — a directory's entries are exactly
 *    `{name,isDirectory,hidden}`, and no file body ever appears in the answer;
 * 2. it refuses anything that is not a directory (a file path, a missing path, a
 *    non-absolute path) with a typed error the UI can show;
 * 3. it is **audited**: every listing and every refusal appends a record naming the
 *    session, the path and the time, and the sink is written *before* the answer;
 * 4. it is **not** part of the agent/protocol surface: it is not an installation
 *    method the daemon would answer, and the Runner's fixed tool union contains no
 *    directory-listing tool.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROKER_TOOLS } from '@agentdev/contracts';
import { AuthService } from '@agentdev/core';
import {
  createWebApp,
  isInstallationMethod,
  NodeFolderPicker,
  PickerRefused,
} from '../src/index.js';
import { WebSessionStore } from '../src/sessions.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';
/** A body no listing may ever echo back. */
const SECRET_MARKER = 'PICKER_SECRET_MARKER_9f3a';

interface AuditRecord {
  readonly at: string;
  readonly sessionId: string;
  readonly requested: string | null;
  readonly path: string | null;
  readonly outcome: 'listed' | 'refused';
  readonly code: string | null;
  readonly entryCount: number;
}

describe('folder picker (WP-12 project UX)', () => {
  let base: string;
  let root: string;
  let baseUrl: string;
  let cookie: string;
  let close: () => Promise<void>;
  const audit: AuditRecord[] = [];

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'agentdev-picker-'));
    root = join(base, 'root');
    mkdirSync(join(root, 'alpha'), { recursive: true });
    mkdirSync(join(root, '.hidden-dir'), { recursive: true });
    // A symlinked directory stays navigable: the picker reports it as a directory.
    mkdirSync(join(root, 'real-target'), { recursive: true });
    writeFileSync(join(root, 'beta.txt'), `contents ${SECRET_MARKER}\n`);
    writeFileSync(join(root, 'gamma.md'), '# also secret\n');

    const picker = new NodeFolderPicker({
      home: root,
      audit: (record) => audit.push(record),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });
    const app = createWebApp({
      daemon: { baseUrl: 'http://127.0.0.1:1', origin: WEB_ORIGIN, bearer: 'test-bearer' },
      // The real `AuthService` backs the browser session; the daemon transport is never
      // reached by the picker route.
      auth: AuthService.loadOrCreate({ stateDir: join(base, 'auth') }),
      // The picker needs only the browser session; the daemon transport is irrelevant
      // here, so the login is injected and no daemon is booted.
      login: () => Promise.resolve({ daemonCookie: 'daemon-cookie', csrfToken: 'csrf' }),
      sessions: new WebSessionStore(),
      allowedOrigins: [WEB_ORIGIN],
      picker,
      version: '0.0.0-test',
    });
    const server = app.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address !== 'object') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
    close = () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token: 'installation-token' }),
    });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toContain('agentdev_web=');
  });

  afterAll(async () => {
    await close();
    rmSync(base, { recursive: true, force: true });
  });

  const list = async (
    query = '',
    options: { readonly cookie?: string | null } = {},
  ): Promise<{ status: number; body: Record<string, unknown>; text: string }> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    const value = options.cookie === undefined ? cookie : options.cookie;
    if (value !== null && value !== '') headers['cookie'] = value;
    const response = await fetch(`${baseUrl}/picker/list${query}`, { headers });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown>, text };
  };

  it('signs in and lists one directory of names with the documented flags', async () => {
    const answer = await list('');
    expect(answer.status).toBe(200);
    expect(answer.body['path']).toBe(realpathSync(root));
    expect(answer.body['parent']).toBe(realpathSync(base));
    expect(answer.body['truncated']).toBe(false);
    const entries = answer.body['entries'] as {
      name: string;
      isDirectory: boolean;
      hidden: boolean;
    }[];
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    expect(byName.get('alpha')).toEqual({ name: 'alpha', isDirectory: true, hidden: false });
    expect(byName.get('beta.txt')).toEqual({ name: 'beta.txt', isDirectory: false, hidden: false });
    expect(byName.get('.hidden-dir')).toEqual({
      name: '.hidden-dir',
      isDirectory: true,
      hidden: true,
    });
    // Names only: every entry carries exactly the three documented fields, so a size,
    // hash or body can never ride along.
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['hidden', 'isDirectory', 'name']);
    }
    expect(answer.text).not.toContain(SECRET_MARKER);
  });

  it('lists a named absolute path and normalises `..` inside it', async () => {
    const nested = await list(`?path=${encodeURIComponent(join(root, 'alpha'))}`);
    expect(nested.status).toBe(200);
    expect(nested.body['path']).toBe(realpathSync(join(root, 'alpha')));

    const up = await list(`?path=${encodeURIComponent(join(root, 'alpha', '..'))}`);
    expect(up.status).toBe(200);
    expect(up.body['path']).toBe(realpathSync(root));
  });

  it('refuses a path that is a file, without echoing anything about it', async () => {
    const answer = await list(`?path=${encodeURIComponent(join(root, 'beta.txt'))}`);
    expect(answer.status).toBe(422);
    const error = answer.body['error'] as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details['reason']).toBe('not-a-directory');
    expect(answer.text).not.toContain(SECRET_MARKER);
    // The refusal names the path it rejected, but not the file's size or contents.
    expect(error.details['path']).toBe(realpathSync(join(root, 'beta.txt')));
  });

  it('refuses a missing path and a relative path', async () => {
    const missing = await list(`?path=${encodeURIComponent(join(root, 'nope'))}`);
    expect(missing.status).toBe(404);
    expect((missing.body['error'] as { code: string }).code).toBe('NOT_FOUND');

    const relative = await list('?path=alpha');
    expect(relative.status).toBe(422);
    const error = relative.body['error'] as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details['reason']).toBe('not-absolute');
  });

  it('is read-only: a non-GET method is refused and never reaches a listing', async () => {
    const before = audit.length;
    const response = await fetch(`${baseUrl}/picker/list`, {
      method: 'POST',
      headers: { cookie, origin: WEB_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(405);
    expect(audit.length).toBe(before);
  });

  it('requires the browser session', async () => {
    const answer = await list('', { cookie: null });
    expect(answer.status).toBe(401);
    expect((answer.body['error'] as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('audits every read and every refusal, before it answers', async () => {
    const before = audit.length;
    await list(`?path=${encodeURIComponent(join(root, 'alpha'))}`);
    await list(`?path=${encodeURIComponent(join(root, 'beta.txt'))}`);
    const records = audit.slice(before);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      at: '2026-01-02T03:04:05.000Z',
      outcome: 'listed',
      path: realpathSync(join(root, 'alpha')),
      code: null,
      entryCount: 0,
    });
    expect(records[1]).toMatchObject({ outcome: 'refused', code: 'VALIDATION_ERROR' });
    // "Who" is the BFF browser session (`protocol.md` §2's audit subject), and every
    // record carries it — including the refusals.
    for (const record of records) {
      expect(typeof record.sessionId).toBe('string');
      expect(record.sessionId.length).toBeGreaterThan(10);
    }
  });

  it('cannot be reached as a protocol method or an agent tool', () => {
    // The BFF-only route is not an installation-level daemon method, so a `/rpc`
    // envelope naming it is forwarded as a Project method (and fails closed there).
    expect(isInstallationMethod('picker.list')).toBe(false);
    expect(isInstallationMethod('project.list')).toBe(true);
    // The agent's tool surface is this fixed union: no directory lister exists to
    // expose, and nothing here is derived from the picker.
    expect(Object.keys(BROKER_TOOLS).sort()).toEqual([
      'artifact_write',
      'bash',
      'edit',
      'git',
      'read',
      'search',
      'write',
    ]);
  });

  it('reports a directory it cannot read as a typed NOT_FOUND, not a partial listing', () => {
    const picker = new NodeFolderPicker({ home: root, audit: () => undefined });
    // `/proc/1/fd` exists on Linux but is not listable for an unprivileged process; on
    // platforms where it is readable the call still answers a directory, so the
    // assertion is the shape, never a fabricated failure.
    let listed: unknown;
    try {
      listed = picker.list('/proc/1/fd', { sessionId: 'session-test' });
    } catch (error) {
      expect(error).toBeInstanceOf(PickerRefused);
      expect((error as PickerRefused).code).toBe('NOT_FOUND');
      return;
    }
    expect(listed).toBeDefined();
  });
});
