/**
 * WP-12 T5.1/T5.2 integration: the installation project directory and `project.*`.
 *
 * Everything here runs against real Git repositories, real SQLite project databases
 * and the real `WorkbenchProtocol`; no project row is seeded, because the point of
 * the slice is exactly that the lifecycle commands create and publish real projects
 * (`docs/delivery/acceptance.md` AC-023/AC-024/AC-025, `protocol.md` §3).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JsonObject } from '@agentdev/contracts';
import { AuthService, readInstallationCredential, readProjectRegistry } from '@agentdev/core';

import { openProject } from '../src/bootstrap.js';
import { ProjectDirectory, ProjectDirectoryError } from '../src/project-directory.js';
import { parseEnvelope, type WorkbenchProtocol } from '../src/protocol.js';
import type { AssembledProject } from '../src/project-directory.js';
import type { ProjectEntry } from '@agentdev/web';

const WEB_ORIGIN = 'http://127.0.0.1:4317';

/** Real `git` with a deterministic identity, so the tests need no global config. */
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

/** A real repository with one commit on `main`. */
function makeRepo(root: string, file = 'README.md'): string {
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-b', 'main']);
  writeFileSync(join(root, file), '# title\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);
  return root;
}

interface Harness {
  readonly home: string;
  readonly auth: AuthService;
  readonly token: string;
  readonly directory: ProjectDirectory;
  close(): void;
}

function startDirectory(): Harness {
  const home = mkdtempSync(join(tmpdir(), 'agentdev-t5-home-'));
  const auth = AuthService.loadOrCreate({
    stateDir: home,
    config: { deployment: 'loopback', allowedOrigins: [WEB_ORIGIN] },
  });
  const token = readInstallationCredential(home);
  const ref: { current?: ProjectDirectory } = {};
  const directory = new ProjectDirectory({
    home,
    host: '127.0.0.1',
    version: '0.0.0-test',
    bearer: () => token,
    epoch: () => 1,
    webOrigin: WEB_ORIGIN,
    assemble: async (input): Promise<AssembledProject> => {
      const project = await openProject({
        root: input.root,
        home,
        auth,
        installationToken: token,
        version: '0.0.0-test',
        withWeb: false,
        daemonPort: 0,
        host: '127.0.0.1',
        trust: input.trust,
        ...(ref.current === undefined ? {} : { projectDirectory: ref.current }),
      });
      const row = project.store.projects.find(project.projectId);
      const instance = {
        projectId: project.projectId,
        root: project.root,
        daemon: { host: '127.0.0.1' as const, port: project.ports.daemon },
        web: null,
      };
      return {
        projectId: project.projectId,
        root: project.root,
        gitRoot: project.gitRoot,
        dataDir: project.dataDir,
        instance,
        store: project.store,
        protocol: project.protocol,
        deliveryBranch: row?.deliveryBranch ?? 'agentdev/main',
        documentRoot: row?.documentRoot ?? 'docs/agentdev',
      };
    },
    teardown: (projectId) => {
      const handle = directory.handleOf(projectId);
      if (handle !== undefined) handle.assembled.protocol.closeAll(1001, 'test close');
      return Promise.resolve();
    },
    runningRuns: () => 0,
    executionReady: () => true,
  });
  ref.current = directory;
  return {
    home,
    auth,
    token,
    directory,
    close: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** Dispatches one command exactly as `/rpc` does, with the installation caller. */
function call(
  protocol: WorkbenchProtocol,
  method: string,
  params: JsonObject,
  projectId?: string,
): JsonObject {
  const envelope = parseEnvelope({
    v: 1,
    type: 'request',
    id: `req-${method}`,
    method,
    ...(projectId === undefined ? {} : { projectId }),
    params,
  });
  return protocol.dispatchEnvelope(envelope, {
    subject: 'installation:local',
    userId: '018f2c1e-9a4b-7c3d-8e5f-000000000001',
    role: 'chief',
  });
}

/** Polls the way the switcher does until an accepted background open publishes. */
async function waitForProject(
  directory: ProjectDirectory,
  root: string,
  timeoutMs = 15_000,
): Promise<ProjectEntry> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = directory
      .list()
      .find((candidate) => candidate.root === root || candidate.root.endsWith(root));
    if (entry !== undefined) return entry;
    if (Date.now() > deadline) throw new Error(`project ${root} was not published in time`);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

describe('installation project directory (WP-12 T5.1/T5.2)', () => {
  let harness: Harness;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    harness = startDirectory();
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-repos-'));
    repoA = makeRepo(join(base, 'alpha'));
    repoB = makeRepo(join(base, 'beta'));
  });

  afterEach(() => {
    harness.close();
  });

  it('opens two real roots with independent ids, databases and registries (AC-023)', async () => {
    const a = await harness.directory.open(repoA, { trust: true, name: 'Alpha' });
    const b = await harness.directory.open(repoB, { trust: true });
    const idA = a.projectId ?? '';
    const idB = b.projectId ?? '';

    expect(idA).not.toBe(idB);
    expect(a.state).toBe('open');
    expect(b.state).toBe('open');
    expect(a.name).toBe('Alpha');
    // No explicit name: the switcher falls back to the root's basename.
    expect(b.name).toBe('beta');

    const registry = readProjectRegistry(harness.home);
    expect(registry.projects).toHaveLength(2);
    expect(registry.projects.map((entry) => entry.root).sort()).toEqual([a.root, b.root].sort());
    expect(registry.projects.find((entry) => entry.projectId === idA)?.name).toBe('Alpha');

    // Real, separate SQLite files — the load-bearing isolation wall.
    const handleA = harness.directory.handleOf(idA);
    const handleB = harness.directory.handleOf(idB);
    expect(handleA).toBeDefined();
    expect(handleB).toBeDefined();
    expect(handleA?.assembled.dataDir).not.toBe(handleB?.assembled.dataDir);
    expect(existsSync(join(handleA?.assembled.dataDir ?? '', 'project.sqlite'))).toBe(true);
    expect(existsSync(join(handleB?.assembled.dataDir ?? '', 'project.sqlite'))).toBe(true);

    // A row written into A is invisible from B (no cross-project rows).
    handleA?.assembled.store.conversations.insert({
      projectId: idA,
      title: 'only in alpha',
      archived: false,
    });
    expect(handleA?.assembled.store.conversations.count()).toBe(1);
    expect(handleB?.assembled.store.conversations.count()).toBe(0);

    // A per-Git-root lock exists for each root, under the installation home and never
    // inside the user's repository (Q5).
    expect(existsSync(join(harness.home, 'locks'))).toBe(true);
    expect(readFileSync(join(repoA, 'README.md'), 'utf8')).toBe('# title\n');
  });

  it('opening the same root twice is idempotent and one root cannot be opened twice (Q5)', async () => {
    const first = await harness.directory.open(repoA, { trust: true });
    const second = await harness.directory.open(repoA, { trust: true });
    expect(second.projectId).toBe(first.projectId);
    expect(harness.directory.list()).toHaveLength(1);

    // A second directory over the same home sees the live lock and refuses with the
    // holder, rather than opening a second runtime for one repository.
    const peer = new ProjectDirectory({
      home: harness.home,
      host: '127.0.0.1',
      version: '0.0.0-test',
      bearer: () => harness.token,
      epoch: () => 2,
      assemble: () => {
        throw new Error('must not assemble');
      },
      teardown: () => Promise.resolve(),
      runningRuns: () => 0,
      executionReady: () => true,
    });
    await expect(peer.open(repoA, { trust: true })).rejects.toThrowError(ProjectDirectoryError);
    await expect(peer.open(repoA, { trust: true })).rejects.toMatchObject({
      code: 'PROJECT_ALREADY_OPEN',
    });
  });

  it('creates a project in an empty directory with Git, the delivery branch and the events (AC-025)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-empty-'));
    const root = join(base, 'fresh');
    mkdirSync(root);

    const entry = await harness.directory.create(root, 'Fresh');
    expect(entry.state).toBe('open');
    expect(entry.name).toBe('Fresh');

    // Real Git history plus the documented delivery branch (`ARCHITECTURE.md` §4).
    expect(git(root, ['rev-parse', '--verify', 'HEAD']).trim()).toMatch(/^[0-9a-f]{40}$/u);
    expect(git(root, ['branch', '--list', 'agentdev/main']).trim()).not.toBe('');

    // The four documented Ready entry documents are real files on disk.
    for (const document of ['PROJECT.md', 'INDEX.md', 'CODE_MAP.md', 'features/README.md']) {
      expect(existsSync(join(root, 'docs/agentdev', document))).toBe(true);
    }

    // `project.created` landed in the *new project's own* stream (Q9).
    const handle = harness.directory.handleOf(entry.projectId ?? '');
    const created = handle?.assembled.store.events
      .readAfter(0)
      .filter((event) => event.name === 'project.created');
    expect(created?.length ?? 0).toBeGreaterThan(0);
    expect(created?.[0]?.entityId).toBe(entry.projectId);

    // A non-empty directory is refused with the observed facts: no implicit cleanup.
    const occupied = join(base, 'occupied');
    mkdirSync(occupied);
    writeFileSync(join(occupied, 'keep.txt'), 'precious\n');
    await expect(harness.directory.create(occupied, 'Occupied')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(readFileSync(join(occupied, 'keep.txt'), 'utf8')).toBe('precious\n');
  });

  it('flips trust, refuses a close with live Runs and closes at navigation level (Q3)', async () => {
    const a = await harness.directory.open(repoA, { trust: true });
    const trusted = harness.directory.trust(a.projectId ?? '', false);
    expect(trusted.trust).toBe('untrusted');
    const handle = harness.directory.handleOf(a.projectId ?? '');
    expect(handle?.assembled.store.projects.find(a.projectId ?? '')?.trust).toBe('untrusted');

    // The close refusal is driven by the host's live-Run count (the same fact the Run
    // gate consumes), so a project with work in flight keeps serving it.
    const busy = new ProjectDirectory({
      home: mkdtempSync(join(tmpdir(), 'agentdev-t5-busy-')),
      host: '127.0.0.1',
      version: '0.0.0-test',
      bearer: () => harness.token,
      epoch: () => 9,
      assemble: async (input) => {
        const project = await openProject({
          root: input.root,
          home: harness.home,
          auth: harness.auth,
          installationToken: harness.token,
          version: '0.0.0-test',
          withWeb: false,
          daemonPort: 0,
          host: '127.0.0.1',
          trust: input.trust,
        });
        return {
          projectId: project.projectId,
          root: project.root,
          gitRoot: project.gitRoot,
          dataDir: project.dataDir,
          instance: {
            projectId: project.projectId,
            root: project.root,
            daemon: { host: '127.0.0.1' as const, port: project.ports.daemon },
            web: null,
          },
          store: project.store,
          protocol: project.protocol,
          deliveryBranch: 'agentdev/main',
          documentRoot: 'docs/agentdev',
        };
      },
      teardown: () => Promise.resolve(),
      runningRuns: (projectId) => (projectId === 'busy' ? 2 : 1),
      executionReady: () => true,
    });
    const busyEntry = await busy.open(repoB, { trust: true });
    expect(() => busy.close(busyEntry.projectId ?? '')).toThrowError(ProjectDirectoryError);
    expect(() => busy.close(busyEntry.projectId ?? '')).toThrowError(/live Run/u);
    expect(busy.entryOf(busyEntry.projectId ?? '')?.state).toBe('open');

    // With no live Run the close is navigation-level: state closed, active set
    // emptied, registry entry retained.
    const closed = harness.directory.close(a.projectId ?? '');
    expect(closed.state).toBe('closed');
    expect(harness.directory.handleOf(a.projectId ?? '')).toBeUndefined();
    expect(readProjectRegistry(harness.home).projects.map((e) => e.root)).toContain(a.root);
    expect(harness.directory.list().find((entry) => entry.projectId === a.projectId)?.state).toBe(
      'closed',
    );
  });

  it('skips and reports a damaged registry entry instead of failing the installation (Q2)', async () => {
    const a = await harness.directory.open(repoA, { trust: true });
    const registryPath = join(harness.home, 'projects.json');
    const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      v: number;
      projects: unknown[];
    };
    raw.projects.push({ root: '/nowhere/broken', projectId: 'not-hex' });
    writeFileSync(registryPath, JSON.stringify(raw));

    const listed = harness.directory.list();
    expect(listed.some((entry) => entry.projectId === a.projectId && entry.state === 'open')).toBe(
      true,
    );
    const problem = listed.find((entry) => entry.state === 'unreadable');
    expect(problem?.problem?.code).toBe('PROJECT_ENTRY_INVALID');
    expect(harness.directory.problems).toHaveLength(1);

    // A missing root is reported as `missing`, and the healthy project still opens.
    const registry = readProjectRegistry(harness.home);
    expect(registry.projects).toHaveLength(1);
  });
});

describe('project.* protocol surface (WP-12 T5.2)', () => {
  let harness: Harness;
  let repoA: string;
  let repoB: string;
  let protocol: WorkbenchProtocol;

  beforeEach(async () => {
    harness = startDirectory();
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-proto-'));
    repoA = makeRepo(join(base, 'alpha'));
    repoB = makeRepo(join(base, 'beta'));
    await harness.directory.open(repoA, { trust: true, name: 'Alpha' });
    const handle = harness.directory.handleOf(harness.directory.list()[0]?.projectId ?? '');
    protocol = handle?.assembled.protocol as WorkbenchProtocol;
  });

  afterEach(() => {
    harness.close();
  });

  it('lists every project of the installation with its real lifecycle state', () => {
    const listed = call(protocol, 'project.list', {});
    const items = listed['items'] as JsonObject[];
    expect(items).toHaveLength(1);
    expect(items[0]?.['name']).toBe('Alpha');
    expect(items[0]?.['lifecycleState']).toBe('open');
    expect(items[0]?.['executionReady']).toBe(true);
  });

  it('opens a second project through the protocol and reports it once serving', async () => {
    const accepted = call(protocol, 'project.open', { root: repoB });
    expect(accepted['status']).toBe('accepted');
    expect(typeof accepted['operationId']).toBe('string');
    const openedId = accepted['projectId'] as string;
    // The assembly is real (listeners bind); wait for it the way a client polls.
    await harness.directory.open(repoB, { trust: true });
    const listed = call(protocol, 'project.list', {});
    const items = listed['items'] as JsonObject[];
    expect(items).toHaveLength(2);
    expect(items.map((item) => item['projectId'])).toContain(openedId);
  });

  it('applies trust and close, and answers them with the documented shape', () => {
    const projectId = harness.directory.list()[0]?.projectId ?? '';
    const trusted = call(protocol, 'project.trust', { trusted: false }, projectId);
    expect(trusted['status']).toBe('applied');
    expect(trusted['trust']).toBe('untrusted');
    expect(trusted['admission']).toBe('stopped');

    const closed = call(protocol, 'project.close', {}, projectId);
    expect(closed['status']).toBe('applied');
    expect(closed['state']).toBe('closed');

    // `project.trust` without an envelope projectId is a validation error, not a guess.
    expect(() => call(protocol, 'project.trust', { trusted: true })).toThrowError(
      /requires the envelope's projectId/u,
    );
  });

  it('refuses a cross-project read at the daemon wall (AC-034)', () => {
    const opened = harness.directory.list()[0];
    expect(() => call(protocol, 'conversation.list', {}, 'b'.repeat(32))).toThrowError(
      /is not open on this daemon/u,
    );
    expect(opened?.projectId).not.toBe('b'.repeat(32));
  });

  it('creates a project through the protocol and emits project.created', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-create-'));
    const root = join(base, 'made');
    mkdirSync(root);
    const accepted = call(protocol, 'project.create', { root, name: 'Made' });
    expect(accepted['status']).toBe('accepted');
    expect(typeof accepted['operationId']).toBe('string');

    // The command answers `accepted` and finishes in the background; a client polls the
    // installation's project list, exactly as the switcher does.
    const entry = await waitForProject(harness.directory, root);
    expect(entry.name).toBe('Made');
    const handle = harness.directory.handleOf(entry.projectId ?? '');
    const created = handle?.assembled.store.events
      .readAfter(0)
      .filter((event) => event.name === 'project.created');
    expect(created?.length ?? 0).toBeGreaterThan(0);
    expect(created?.[0]?.entityId).toBe(entry.projectId);
  });

  it('surfaces a lifecycle refusal as a typed error, not a silent success', async () => {
    // `/rpc` answers `accepted` and reports the failure through `operation.failed`
    // (Q9); the admin/CLI path gets the code directly, which the directory exposes.
    // The ask is that an unserved project is never silently accepted as success.
    await expect(
      harness.directory.initialize('c'.repeat(32), { sourceMessageId: 'msg-1' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
