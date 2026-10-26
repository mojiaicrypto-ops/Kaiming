/**
 * The project-file byte route (U11): the viewer's only way to show an image or hand a file to the
 * browser's download. It is a read-only surface on the user's own project, so the tests are about
 * everything it must refuse: no cookie, no project, a path that leaves the project, a symlink that
 * points out of it, a directory, and a request for a project that is not open.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { AuthService, SESSION_COOKIE } from '../src/server/auth.ts';
import { RpcRouter } from '../src/server/rpc.ts';
import { PROJECT_FILE_PATH_PREFIX, createWorkbenchServer, type WorkbenchServer } from '../src/server/http.ts';

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
  readonly projectDir: string;
  readonly get: (path: string, cookie?: string) => Promise<Response>;
  readonly login: () => Promise<string>;
}> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-project-files-'));
  const projectDir = join(root, 'project');
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  writeFileSync(join(projectDir, 'assets', 'dot.png'), PNG);
  writeFileSync(join(projectDir, 'app.ts'), 'const answer = 42;\n');
  // Written outside the project: a link to it must never be served.
  writeFileSync(join(root, 'secret.txt'), 'do not serve me\n');
  symlinkSync(join(root, 'secret.txt'), join(projectDir, 'escape.txt'));
  mkdirSync(join(projectDir, 'nested'), { recursive: true });

  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  const auth = new AuthService({ accessPassword: PASSWORD });
  const router = new RpcRouter();
  store.createProject({ id: 'p-1', realPath: projectDir });
  const workbench: WorkbenchServer = createWorkbenchServer({ store, auth, router });
  const { origin } = await workbench.listen(0);
  cleanups.push(async () => {
    await workbench.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    projectDir,
    async login() {
      const response = await fetch(`${origin}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'r1', method: 'auth.login', params: { password: PASSWORD } }),
      });
      return /agentdev_session=([0-9a-f]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
    },
    get: (path, cookie) =>
      fetch(`${origin}${PROJECT_FILE_PATH_PREFIX}${path}`, {
        headers: cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` },
      }),
  };
}

describe('the project file byte route', () => {
  it('serves an image with its own type and refuses to let a browser sniff it', async () => {
    const h = await harness();
    const cookie = await h.login();
    const response = await h.get('p-1/assets/dot.png', cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('marks the download response as an attachment and names the file', async () => {
    const h = await harness();
    const cookie = await h.login();
    const response = await h.get('p-1/assets/dot.png?download=1', cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain('dot.png');
  });

  it('serves text bytes for a text file (the viewer reads text over RPC, but the route is honest)', async () => {
    const h = await harness();
    const cookie = await h.login();
    const response = await h.get('p-1/app.ts', cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('const answer = 42;\n');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 401 without a cookie: bytes are not public', async () => {
    const h = await harness();
    expect((await h.get('p-1/assets/dot.png')).status).toBe(401);
  });

  it('refuses a path that climbs out of the project', async () => {
    const h = await harness();
    const cookie = await h.login();
    for (const path of ['p-1/../../secret.txt', 'p-1/%2e%2e/%2e%2e/secret.txt', 'p-1//etc/passwd']) {
      const response = await h.get(path, cookie);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain('do not serve me');
    }
  });

  it('never follows a symlink out of the project', async () => {
    const h = await harness();
    const cookie = await h.login();
    const response = await h.get('p-1/escape.txt', cookie);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('do not serve me');
  });

  it('answers 404 for a directory, an unknown project and a missing file', async () => {
    const h = await harness();
    const cookie = await h.login();
    const directory = await h.get('p-1/nested', cookie);
    expect(directory.status).toBe(404);
    expect((await h.get('p-2/app.ts', cookie)).status).toBe(404);
    expect((await h.get('p-1/missing.png', cookie)).status).toBe(404);
  });
});
