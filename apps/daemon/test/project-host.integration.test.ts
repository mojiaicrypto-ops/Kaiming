/**
 * WP-12 T5 host integration: one installation, one BFF, two real projects.
 *
 * `startRuntime` opens every configured root with the real assembly (SQLite, services,
 * listeners) and serves **one** BFF for the whole installation (D-T5-3). These
 * assertions cover the two things the slice must not break: a single-project
 * installation still reports a usable web address through `GET /projects`, and a
 * browser logged in once can read each project's page without any cross-project leak.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readInstallationCredential } from '@agentdev/core';

import { startRuntime, type RunningRuntime } from '../src/main.js';

const WEB_ORIGIN = 'http://127.0.0.1:4317';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'AgentDev Test',
      GIT_AUTHOR_EMAIL: 'test@localhost',
      GIT_COMMITTER_NAME: 'AgentDev Test',
      GIT_COMMITTER_EMAIL: 'test@localhost',
    },
  }).toString();
}

function makeRepo(base: string, name: string): string {
  const root = join(base, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'README.md'), `# ${name}\n`);
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init']);
  return root;
}

describe('single-entry host over two real projects (WP-12 T5)', () => {
  const homes: string[] = [];
  let runtime: RunningRuntime | null = null;

  afterEach(async () => {
    if (runtime !== null) {
      await runtime.stop();
      runtime = null;
    }
    while (homes.length > 0) {
      const home = homes.pop();
      if (home !== undefined) rmSync(home, { recursive: true, force: true });
    }
  });

  it('publishes a cold-opened project from accepted to servable through the real BFF (T5.1/T5.2)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-cold-'));
    homes.push(base);
    const home = join(base, 'home');
    const alpha = makeRepo(base, 'alpha');
    const gamma = makeRepo(base, 'gamma');

    runtime = await startRuntime({
      home,
      roots: [alpha],
      execute: false,
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      secretBackend: 'file',
      trust: true,
      log: () => undefined,
    });
    const bff = runtime.web;
    if (bff === null) throw new Error('the BFF did not bind');
    const webBase = `http://${bff.host}:${String(bff.port)}`;
    const token = readInstallationCredential(home);
    const login = await fetch(`${webBase}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    /** One `/rpc` call through the BFF, exactly as the browser makes it. */
    const rpc = async (method: string, params: Record<string, unknown>, projectId?: string) => {
      const response = await fetch(`${webBase}/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: WEB_ORIGIN,
          cookie,
        },
        body: JSON.stringify({
          v: 1,
          type: 'request',
          id: `cold-${method}`,
          method,
          ...(projectId === undefined ? {} : { projectId }),
          params,
        }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };

    // A root this installation has never opened: only `accepted` is possible, because
    // binding the project's listener is asynchronous (protocol.md §3).
    const opened = await rpc('project.open', { root: gamma });
    expect(opened.status).toBe(200);
    const result = opened.body['result'] as Record<string, unknown>;
    expect(result['status']).toBe('accepted');
    expect(typeof result['operationId']).toBe('string');
    const gammaId = result['projectId'] as string;
    expect(typeof gammaId).toBe('string');

    // The documented readiness source: `project.list`. A client polls it; nothing else
    // (no timer guess, no `project.snapshot.get` before the entry is open) is allowed.
    const deadline = Date.now() + 20_000;
    const lifecycleOf = async (): Promise<string> => {
      const listed = await rpc('project.list', {});
      const items = (listed.body['result'] as Record<string, unknown>)['items'] as Record<
        string,
        unknown
      >[];
      const entry = items.find((item) => item['projectId'] === gammaId);
      const value = entry?.['lifecycleState'];
      return typeof value === 'string' ? value : '';
    };
    let lifecycle = await lifecycleOf();
    while (lifecycle !== 'open') {
      if (Date.now() > deadline) throw new Error(`project ${gammaId} never became open`);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      lifecycle = await lifecycleOf();
    }
    expect(lifecycle).toBe('open');

    // Once open, the project is servable through the same single BFF and appears in the
    // switcher of every page.
    const page = await fetch(`${webBase}/projects/${gammaId}/requirements`, {
      headers: { cookie },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`data-project="${gammaId}"`);
    expect(html).toContain('id="projectSwitcher"');
    expect(html).toContain(`href="/projects/${runtime.instances[0]?.projectId ?? ''}/chief"`);
    expect(runtime.instances.map((instance) => instance.projectId)).toContain(gammaId);
  });

  it('serves every project through one BFF and keeps the pages isolated', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-host-'));
    homes.push(base);
    const home = join(base, 'home');
    const alpha = makeRepo(base, 'alpha');
    const beta = makeRepo(base, 'beta');

    runtime = await startRuntime({
      home,
      roots: [alpha, beta],
      execute: false,
      daemonPort: 0,
      webPort: 0,
      adminPort: 0,
      secretBackend: 'file',
      trust: true,
      log: () => undefined,
    });

    // One BFF for the installation, and every instance reports it as its web address.
    expect(runtime.web).not.toBeNull();
    expect(runtime.instances).toHaveLength(2);
    const bff = runtime.web;
    if (bff === null) throw new Error('the BFF did not bind');

    const token = readInstallationCredential(home);
    const projects = await fetch(`http://${bff.host}:${String(bff.port)}/healthz`);
    expect(projects.status).toBe(200);

    const admin = await fetch(
      `http://${runtime.admin.host}:${String(runtime.admin.port)}/projects`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(admin.status).toBe(200);
    const listing = (await admin.json()) as {
      instances: { projectId: string; root: string; web: { port: number } | null }[];
      bff: { port: number } | null;
    };
    expect(listing.instances).toHaveLength(2);
    for (const instance of listing.instances) {
      // `agentdev open`/`status` print this: the address that actually serves the
      // project, which is the single BFF under the new model.
      expect(instance.web?.port).toBe(bff.port);
    }
    expect(listing.bff?.port).toBe(bff.port);

    // One login, then each project's own page.
    const webBase = `http://${bff.host}:${String(bff.port)}`;
    const login = await fetch(`${webBase}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ token }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    for (const instance of listing.instances) {
      const page = await fetch(`${webBase}/projects/${instance.projectId}/requirements`, {
        headers: { cookie },
      });
      expect(page.status).toBe(200);
      const html = await page.text();
      // The switcher names both projects; the page is that project's own.
      expect(html).toContain('id="projectSwitcher"');
      expect(html).toContain(`data-project="${instance.projectId}"`);
      const other = listing.instances.find((entry) => entry.projectId !== instance.projectId);
      expect(html).toContain(`href="/projects/${String(other?.projectId)}/chief"`);
    }

    // An unserved project fails closed instead of rendering the default project.
    const unknown = await fetch(`${webBase}/projects/${'f'.repeat(32)}/requirements`, {
      headers: { cookie },
    });
    expect(unknown.status).toBe(404);

    // An artifact URL without a project is refused (Q6 fail-closed).
    const legacyArtifact = await fetch(`${webBase}/artifacts/download/token`, {
      headers: { cookie },
    });
    expect(legacyArtifact.status).toBe(404);
  });
});
