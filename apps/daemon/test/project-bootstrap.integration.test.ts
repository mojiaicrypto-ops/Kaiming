/**
 * WP-12 project UX: a zero-project `agentdev start` is a real, usable installation.
 *
 * The product owner's first requirement is that `agentdev start` with no project
 * brings the one UI up and guides the user to add their first project — from the
 * browser, with no CLI. This test drives the **real host** (`startRuntime`), the real
 * BFF and the real loopback listeners over an empty registry, and proves:
 *
 * - the BFF is up and serves the sign-in page with zero projects;
 * - a browser can sign in even though no project daemon is bound (the BFF reuses the
 *   installation `AuthService` with the identical credential/origin/rate rules);
 * - `/projects` renders the first-run guidance;
 * - `project.open` from the browser opens the first folder with the **read-only**
 *   default trust, `project.list` reports it `open`, and the explicit `project.trust`
 *   is what makes it trusted — re-opening never launders a revocation;
 * - the human-only folder picker is served by the host and its read is audited under
 *   the installation home.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readInstallationCredential } from '@agentdev/core';
import { DEFAULT_WEB_ORIGIN } from '../src/bootstrap.js';
import { startRuntime, type RunningRuntime } from '../src/main.js';

/** Creates a real Git repository with one commit. */
function makeRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(root, 'README.md'), '# project\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'initial');
  return root;
}

describe('a zero-project start is a usable installation (WP-12 project UX)', () => {
  let base: string;
  let home: string;
  let repo: string;
  let runtime: RunningRuntime;
  let webUrl: string;
  let installationToken: string;
  let cookie = '';
  let csrfToken = '';

  const rpc = async (
    method: string,
    params: Record<string, unknown> = {},
    projectId?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(`${webUrl}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: DEFAULT_WEB_ORIGIN,
        cookie,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: `t-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
        method,
        params,
        ...(projectId === undefined ? {} : { projectId }),
      }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  const page = async (path: string): Promise<{ status: number; html: string }> => {
    const response = await fetch(`${webUrl}${path}`, {
      headers: { accept: 'text/html', cookie },
    });
    return { status: response.status, html: await response.text() };
  };

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'agentdev-zero-project-'));
    home = join(base, 'home');
    repo = makeRepo('agentdev-zero-repo-');
    runtime = await startRuntime({
      home,
      roots: [],
      execute: false,
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      log: () => undefined,
    });
    installationToken = readInstallationCredential(home);
    webUrl = `http://${runtime.web?.host ?? '127.0.0.1'}:${String(runtime.web?.port ?? 0)}`;
    expect(runtime.instances).toHaveLength(0);
  }, 60_000);

  afterAll(async () => {
    await runtime.stop();
    rmSync(base, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('serves the sign-in page and signs the first browser in with zero projects', async () => {
    const root = await page('/');
    // The sign-in page is served with 401 and the form (`protocol.md` §2).
    expect(root.status).toBe(401);
    expect(root.html).toContain('id="loginForm"');

    // No daemon listener exists yet, which is exactly the fresh-install case: the BFF
    // answers the sign-in itself with the same credential check.
    const login = await fetch(`${webUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: installationToken }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { csrfToken: string };
    csrfToken = body.csrfToken;
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toContain('agentdev_web=');
  });

  it('guides the user to add the first project on /projects', async () => {
    const projects = await page('/projects');
    expect(projects.status).toBe(200);
    expect(projects.html).toContain('data-i18n="projects.firstRunTitle"');
    expect(projects.html).toContain('data-i18n="projects.firstRunHint"');
    expect(projects.html).toContain('id="openFolder"');
    expect(projects.html).toContain('id="folderPicker"');
    // The topbar must not offer a project that does not exist.
    expect(projects.html).not.toContain('href="/projects/project/chief"');
  });

  it('opens the first folder from the browser, read-only until it is trusted', async () => {
    const opened = await rpc('project.open', { root: repo });
    expect(opened.status).toBe(200);
    const result = opened.body['result'] as Record<string, unknown>;
    expect(result['status']).toBe('applied');
    expect(result['trust']).toBe('untrusted');
    const projectId = result['projectId'] as string;
    expect(typeof projectId).toBe('string');

    const listed = await rpc('project.list', {});
    const items = (listed.body['result'] as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.['projectId']).toBe(projectId);
    expect(items[0]?.['lifecycleState']).toBe('open');
    expect(items[0]?.['trust']).toBe('untrusted');

    // The explicit trust act, then a re-open that must keep it.
    const trusted = await rpc('project.trust', { trusted: true }, projectId);
    expect(trusted.status).toBe(200);
    expect((trusted.body['result'] as Record<string, unknown>)['trust']).toBe('trusted');
    const reopened = await rpc('project.open', { root: repo });
    expect((reopened.body['result'] as Record<string, unknown>)['trust']).toBe('trusted');

    // Revoking trust is not laundered by the next open either.
    await rpc('project.trust', { trusted: false }, projectId);
    const again = await rpc('project.open', { root: repo });
    expect((again.body['result'] as Record<string, unknown>)['trust']).toBe('untrusted');
  }, 30_000);

  it('serves the human-only picker and audits the read under the installation home', async () => {
    const listing = await fetch(`${webUrl}/picker/list?path=${encodeURIComponent(repo)}`, {
      headers: { accept: 'application/json', cookie },
    });
    expect(listing.status).toBe(200);
    const body = (await listing.json()) as {
      path: string;
      entries: { name: string; isDirectory: boolean; hidden: boolean }[];
    };
    expect(body.path).toBe(realpathSync(repo));
    expect(
      body.entries.some((entry) => entry.name === 'README.md' && entry.isDirectory === false),
    ).toBe(true);
    // Names only: the file body never appears.
    expect(JSON.stringify(body)).not.toContain('# project');

    const refused = await fetch(
      `${webUrl}/picker/list?path=${encodeURIComponent(join(repo, 'README.md'))}`,
      {
        headers: { accept: 'application/json', cookie },
      },
    );
    expect(refused.status).toBe(422);

    const auditPath = join(home, 'logs', 'picker-audit.jsonl');
    expect(existsSync(auditPath)).toBe(true);
    const records = readFileSync(auditPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(
      records.some(
        (record) => record['outcome'] === 'listed' && record['path'] === realpathSync(repo),
      ),
    ).toBe(true);
    expect(records.some((record) => record['outcome'] === 'refused')).toBe(true);
    for (const record of records) {
      expect(typeof record['sessionId']).toBe('string');
      expect(typeof record['at']).toBe('string');
    }
  });

  it('refuses an unauthenticated picker read', async () => {
    const response = await fetch(`${webUrl}/picker/list`, {
      headers: { accept: 'application/json' },
    });
    expect(response.status).toBe(401);
  });
});
