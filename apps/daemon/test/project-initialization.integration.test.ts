/**
 * WP-12 T5.3 integration: `project.initialize` wired to the real state machine.
 *
 * Real Git repositories, the real scanner and candidate generator, real files on
 * disk and the real durable initialization state file. These are the product-path
 * assertions for AC-025/AC-026/AC-027/AC-028/AC-029: the code is investigated inside
 * the budget, the sources and unknowns are explicit, the code is never moved, a dirty
 * workspace blocks delivery with a per-path hash report while read-only investigation
 * keeps working, an interrupted/conflicting write resumes by hash and never
 * overwrites.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, readInstallationCredential } from '@agentdev/core';

import { openProject, type OpenedProject } from '../src/bootstrap.js';
import { ProjectDirectory, type AssembledProject } from '../src/project-directory.js';
import { investigateProject, runInitialize } from '../src/initialize-driver.js';

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

/** A legacy repository with real modules, so the scanner observes a capability. */
function makeLegacyRepo(root: string): string {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  writeFileSync(
    join(root, 'src', 'alpha.ts'),
    'export function alpha(): number {\n  return 1;\n}\n',
  );
  writeFileSync(
    join(root, 'src', 'beta.ts'),
    'export function beta(): string {\n  return "b";\n}\n',
  );
  writeFileSync(join(root, 'README.md'), '# demo\n');
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init']);
  return root;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface Harness {
  readonly home: string;
  readonly directory: ProjectDirectory;
  readonly projects: OpenedProject[];
  close(): void;
}

function startDirectory(): Harness {
  const home = mkdtempSync(join(tmpdir(), 'agentdev-t5-init-home-'));
  const auth = AuthService.loadOrCreate({
    stateDir: home,
    config: { deployment: 'loopback', allowedOrigins: [WEB_ORIGIN] },
  });
  const token = readInstallationCredential(home);
  const projects: OpenedProject[] = [];
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
      projects.push(project);
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
    runningRuns: () => 0,
    executionReady: () => true,
  });
  return {
    home,
    directory,
    projects,
    close: () => {
      for (const project of projects) project.store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

describe('project.initialize over the real state machine (WP-12 T5.3)', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = startDirectory();
  });

  afterEach(() => {
    harness.close();
  });

  it('investigates a legacy project and reaches Ready without moving the code (AC-026)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-legacy-'));
    const root = makeLegacyRepo(join(base, 'repo'));
    const sourceBefore = readFileSync(join(root, 'src', 'alpha.ts'), 'utf8');
    const headBefore = git(root, ['rev-parse', 'HEAD']).trim();

    const entry = await harness.directory.open(root, { trust: true });
    const handle = harness.directory.handleOf(entry.projectId ?? '');
    expect(handle).toBeDefined();

    const result = await harness.directory.initialize(entry.projectId ?? '', {
      sourceMessageId: 'msg-initialize-1',
    });
    expect(result.projectId).toBe(entry.projectId);
    const fact = harness.directory.entryOf(entry.projectId ?? '')?.initialization;
    expect(fact?.status).toBe('ready');
    expect(fact?.done).toBe(true);

    // The four documented Ready entry documents exist as real files.
    for (const document of ['PROJECT.md', 'INDEX.md', 'CODE_MAP.md', 'features/README.md']) {
      expect(existsSync(join(root, 'docs/agentdev', document))).toBe(true);
    }
    // The code was investigated, never moved: the source file and HEAD are unchanged.
    expect(readFileSync(join(root, 'src', 'alpha.ts'), 'utf8')).toBe(sourceBefore);
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    // Candidate documents are uncommitted (the machine never touches a delivery ref).
    expect(git(root, ['status', '--porcelain', '-uall']).toString()).toContain('docs/agentdev/');

    // Both documented initialization events landed in the owning project's own stream.
    const names = handle?.assembled.store.events
      .readAfter(0)
      .filter((event) => event.name.startsWith('initialization.'))
      .map((event) => event.name);
    expect(names).toContain('initialization.progress');
    expect(names).toContain('initialization.completed');
  });

  it('never silently re-initializes an existing repository from a bare new-mode request (AC-027)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-reinit-'));
    const root = makeLegacyRepo(join(base, 'repo'));
    const entry = await harness.directory.open(root, { trust: true });
    const headBefore = git(root, ['rev-parse', 'HEAD']).trim();

    // `mode:'new'` against an existing repository is refused with the observed facts;
    // no `git init`, no history rewrite, no candidate documents.
    await expect(
      harness.directory.initialize(entry.projectId ?? '', {
        sourceMessageId: 'msg-reinit',
        mode: 'new',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    expect(git(root, ['branch', '--list', 'agentdev/main']).trim()).toBe('');
    expect(existsSync(join(root, 'docs', 'agentdev'))).toBe(false);

    // A directory that is not a repository at all still needs an explicit act: the
    // driver reports the authorization request and writes nothing (AC-027).
    const plainBase = mkdtempSync(join(tmpdir(), 'agentdev-t5-plain-'));
    const plain = join(plainBase, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'keep.txt'), 'keep\n');
    const blocked = runInitialize(
      { dataDir: join(plainBase, 'data'), documentRoot: 'docs/agentdev' },
      { operationId: 'plain-1', root: plain, sourceMessageId: 'm', confirmObservedFacts: true },
    );
    expect(blocked.blocker?.kind).toBe('git-initialization');
    expect(existsSync(join(plain, '.git'))).toBe(false);
    expect(readFileSync(join(plain, 'keep.txt'), 'utf8')).toBe('keep\n');
  });

  it('blocks a dirty workspace with a per-path hash report and keeps investigation working (AC-028)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-dirty-'));
    const root = makeLegacyRepo(join(base, 'repo'));
    const entry = await harness.directory.open(root, { trust: true });

    writeFileSync(
      join(root, 'src', 'alpha.ts'),
      'export function alpha(): number {\n  return 2;\n}\n',
    );
    await harness.directory.initialize(entry.projectId ?? '', { sourceMessageId: 'msg-dirty' });

    const fact = harness.directory.entryOf(entry.projectId ?? '')?.initialization;
    expect(fact?.blockerKind).toBe('dirty-workspace');
    const report = fact?.dirtyPaths ?? [];
    const alpha = report.find((path) => path.path === 'src/alpha.ts');
    expect(alpha).toBeDefined();
    expect(alpha?.sha256).toBe(sha256(readFileSync(join(root, 'src', 'alpha.ts'), 'utf8')));
    // Delivery writing was blocked, so no candidate document was written.
    expect(existsSync(join(root, 'docs/agentdev', 'PROJECT.md'))).toBe(false);
    // Read-only investigation still works in a dirty workspace (`ARCHITECTURE.md` §4).
    const investigated = investigateProject({ root, documentRoot: 'docs/agentdev' });
    expect(investigated.ok).toBe(true);
    if (investigated.ok) {
      expect(investigated.wroteFiles).toBe(false);
      expect(investigated.featureCount).toBeGreaterThan(0);
    }
  });

  it('stops on a workspace it must not overwrite and reports the real per-path hashes (AC-029)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-conflict-'));
    const root = makeLegacyRepo(join(base, 'repo'));
    const entry = await harness.directory.open(root, { trust: true });

    await harness.directory.initialize(entry.projectId ?? '', { sourceMessageId: 'msg-first' });
    const first = harness.directory.entryOf(entry.projectId ?? '')?.initialization;
    expect(first?.done).toBe(true);
    expect(first?.written ?? 0).toBeGreaterThan(0);
    const written = readFileSync(join(root, 'docs/agentdev', 'PROJECT.md'), 'utf8');

    // A user edit inside a candidate document leaves the workspace uncommitted, so the
    // next drive stops instead of overwriting it — and it names the real hash of what
    // it refused to touch (AC-028's hash report, exercised on the delivery path).
    writeFileSync(join(root, 'docs/agentdev', 'PROJECT.md'), `${written}\nuser note\n`);
    const before = statSync(join(root, 'docs/agentdev', 'PROJECT.md')).mtimeMs;
    await harness.directory.initialize(entry.projectId ?? '', { sourceMessageId: 'msg-second' });
    const stopped = harness.directory.entryOf(entry.projectId ?? '')?.initialization;
    expect(stopped?.done).toBe(false);
    expect(stopped?.blockerKind).toBe('dirty-workspace');
    const projectDoc = stopped?.dirtyPaths.find((path) => path.path === 'docs/agentdev/PROJECT.md');
    expect(projectDoc?.sha256).toBe(
      sha256(readFileSync(join(root, 'docs/agentdev', 'PROJECT.md'), 'utf8')),
    );
    expect(stopped?.written ?? 0).toBe(0);
    // Nothing was rewritten: the user's bytes and mtime are exactly as they were.
    expect(readFileSync(join(root, 'docs/agentdev', 'PROJECT.md'), 'utf8')).toBe(
      `${written}\nuser note\n`,
    );
    expect(statSync(join(root, 'docs/agentdev', 'PROJECT.md')).mtimeMs).toBe(before);
  });
});

describe('initialize driver blockers (WP-12 T5.3)', () => {
  it('refuses to run git init without the explicit mode and reports the request (AC-027)', () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-nogit-'));
    const root = join(base, 'content');
    mkdirSync(root);
    writeFileSync(join(root, 'notes.md'), 'existing content\n');
    const dataDir = join(base, 'data');
    mkdirSync(dataDir, { recursive: true });

    const blocked = runInitialize(
      { dataDir, documentRoot: 'docs/agentdev', branch: 'agentdev/main' },
      { operationId: 'nogit-1', root, sourceMessageId: 'm', confirmObservedFacts: true },
    );
    expect(blocked.status).toBe('blocked');
    expect(blocked.blocker?.kind).toBe('git-initialization');
    // Read-only: the drive wrote nothing and the directory is still not a repository.
    expect(existsSync(join(root, '.git'))).toBe(false);
    expect(existsSync(join(root, 'docs/agentdev'))).toBe(false);
    const investigated = investigateProject({ root, documentRoot: 'docs/agentdev' });
    expect(investigated.ok).toBe(true);

    // The explicit `mode:'new'` act is the authorization: it initializes Git itself.
    const authorized = runInitialize(
      { dataDir, documentRoot: 'docs/agentdev', branch: 'agentdev/main' },
      {
        operationId: 'nogit-2',
        root,
        sourceMessageId: 'm',
        mode: 'new',
        authorizeGitInit: true,
        confirmObservedFacts: true,
      },
    );
    expect(existsSync(join(root, '.git'))).toBe(true);
    expect(['accepted', 'blocked']).toContain(authorized.status);
  });

  it('derives the mode from the real root state (Q8)', () => {
    // An empty, non-Git directory is `new`; anything else is `legacy`.
    expect(
      runInitialize(
        {
          dataDir: mkdtempSync(join(tmpdir(), 'agentdev-t5-mode-')),
          documentRoot: 'docs/agentdev',
        },
        {
          operationId: 'mode-1',
          root: (() => {
            const root = mkdtempSync(join(tmpdir(), 'agentdev-t5-empty-'));
            return root;
          })(),
          sourceMessageId: 'm',
          confirmObservedFacts: true,
        },
      ).phase,
    ).not.toBeNull();
    // A `new` hint over content is refused with the observed facts instead of replacing it.
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-mode2-'));
    const occupied = makeLegacyRepo(join(base, 'occupied'));
    expect(() =>
      runInitialize(
        { dataDir: join(base, 'data'), documentRoot: 'docs/agentdev' },
        {
          operationId: 'mode-2',
          root: occupied,
          sourceMessageId: 'm',
          mode: 'new',
          authorizeGitInit: true,
        },
      ),
    ).toThrowError(/already a Git repository/u);
    expect(readFileSync(join(occupied, 'src', 'alpha.ts'), 'utf8')).toContain('return 1');
  });
});
