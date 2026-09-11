import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore as Store, projectIdFromRoot } from '@agentdev/storage';
import {
  canonicalPath,
  findGitRoot,
  findNestedRepos,
  isInsideNestedRepo,
  isSameProject,
  nestedRepoExclusions,
  requireOwnIdentity,
  resolveProjectIdentity,
} from '../src/index.js';

/**
 * AC-023 (two real git roots stay independent) and AC-024 (subdirectories and
 * symlinks normalize to one Project, nested repositories stay separate and are
 * excluded from the parent's paths). Real `git init` repositories, real symlinks.
 */
let root: string;
let firstRepo: string;
let secondRepo: string;

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentdev-identity-'));
  firstRepo = join(root, 'alpha');
  secondRepo = join(root, 'beta');
  for (const repo of [firstRepo, secondRepo]) {
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    writeFileSync(join(repo, 'src', 'deep', 'file.ts'), 'export const x = 1;\n');
    git(repo, 'init', '--quiet', '--initial-branch=main');
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('canonical roots (AC-024)', () => {
  it('normalizes a subdirectory to the repository root', () => {
    const nested = resolveProjectIdentity(join(firstRepo, 'src', 'deep'));
    const top = resolveProjectIdentity(firstRepo);
    expect(nested.canonicalRoot).toBe(top.canonicalRoot);
    expect(nested.projectId).toBe(top.projectId);
    expect(nested.normalizedFromSubdirectory).toBe(true);
    expect(top.normalizedFromSubdirectory).toBe(false);
    expect(isSameProject(nested, top)).toBe(true);
  });

  it('normalizes a trailing separator and a symlinked path', () => {
    const link = join(root, 'alpha-link');
    symlinkSync(firstRepo, link);
    const viaLink = resolveProjectIdentity(link);
    const direct = resolveProjectIdentity(firstRepo);
    expect(viaLink.canonicalRoot).toBe(direct.canonicalRoot);
    expect(viaLink.projectId).toBe(direct.projectId);
    expect(resolveProjectIdentity(`${firstRepo}/`).projectId).toBe(direct.projectId);
    expect(canonicalPath(link)).toBe(realpathSync.native(firstRepo));
  });

  it('finds the git root from a deep directory and reports no git root outside one', () => {
    expect(findGitRoot(join(firstRepo, 'src', 'deep'))).toBe(realpathSync.native(firstRepo));
    const bare = join(root, 'plain');
    mkdirSync(bare);
    expect(findGitRoot(bare)).toBeUndefined();
    const identity = resolveProjectIdentity(bare);
    expect(identity.gitRoot).toBeUndefined();
    expect(identity.canonicalRoot).toBe(realpathSync.native(bare));
    expect(identity.projectId).toBe(projectIdFromRoot(realpathSync.native(bare)));
  });

  it('derives the project id from the canonical root hash', () => {
    const identity = resolveProjectIdentity(firstRepo);
    expect(identity.projectId).toHaveLength(32);
    expect(identity.projectId).toMatch(/^[0-9a-f]{32}$/);
    expect(identity.projectId).toBe(projectIdFromRoot(identity.canonicalRoot));
  });
});

describe('independent projects (AC-023)', () => {
  it('gives two real roots distinct ids and independent databases', () => {
    const alpha = resolveProjectIdentity(firstRepo);
    const beta = resolveProjectIdentity(secondRepo);
    expect(alpha.projectId).not.toBe(beta.projectId);
    expect(isSameProject(alpha, beta)).toBe(false);

    const alphaDir = join(root, 'state', 'alpha');
    const betaDir = join(root, 'state', 'beta');
    const alphaStore = Store.open({
      dataDir: alphaDir,
      projectId: alpha.projectId,
      migrations: { backup: () => undefined, backupPath: join(alphaDir, 'pre.sqlite') },
    });
    const betaStore = Store.open({
      dataDir: betaDir,
      projectId: beta.projectId,
      migrations: { backup: () => undefined, backupPath: join(betaDir, 'pre.sqlite') },
    });
    try {
      alphaStore.projects.insert({
        id: alpha.projectId,
        root: alpha.canonicalRoot,
        codeRoot: 'src',
        documentRoot: 'docs',
        deliveryBranch: 'agentdev/main',
        trust: 'trusted',
        state: 'open',
      });
      betaStore.projects.insert({
        id: beta.projectId,
        root: beta.canonicalRoot,
        codeRoot: 'src',
        documentRoot: 'docs',
        deliveryBranch: 'agentdev/main',
        trust: 'untrusted',
        state: 'open',
      });

      // Each database holds only its own project, so ids cannot cross.
      expect(alphaStore.projects.list().map((row) => row.id)).toEqual([alpha.projectId]);
      expect(betaStore.projects.list().map((row) => row.id)).toEqual([beta.projectId]);
      expect(betaStore.projects.find(alpha.projectId)).toBeUndefined();
      expect(alphaStore.projectId).not.toBe(betaStore.projectId);
      expect(alphaStore.projects.get(alpha.projectId).trust).toBe('trusted');
      expect(betaStore.projects.get(beta.projectId).trust).toBe('untrusted');
    } finally {
      alphaStore.close();
      betaStore.close();
    }
  });
});

describe('nested repositories (AC-024)', () => {
  it('finds nested repositories and excludes their paths from the parent', () => {
    const nested = join(firstRepo, 'vendor', 'lib');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'index.ts'), 'export {};\n');
    git(nested, 'init', '--quiet', '--initial-branch=main');

    const identity = resolveProjectIdentity(firstRepo);
    expect(identity.nestedRepos).toEqual([realpathSync.native(nested)]);
    expect(nestedRepoExclusions(identity)).toEqual(['vendor/lib']);

    expect(isInsideNestedRepo(identity, 'vendor/lib/index.ts')).toBe(true);
    expect(isInsideNestedRepo(identity, 'vendor/lib')).toBe(true);
    expect(isInsideNestedRepo(identity, 'vendor/other/index.ts')).toBe(false);
    expect(isInsideNestedRepo(identity, 'src/deep/file.ts')).toBe(false);

    // A nested repository must be opened on its own, and its id differs.
    const decision = requireOwnIdentity(identity, 'vendor/lib/index.ts');
    expect(decision).toMatchObject({ ok: false, code: 'NESTED_REPO' });
    expect(requireOwnIdentity(identity, 'src/deep/file.ts')).toEqual({ ok: true });
    const nestedIdentity = resolveProjectIdentity(nested);
    expect(nestedIdentity.projectId).not.toBe(identity.projectId);
    expect(isSameProject(nestedIdentity, identity)).toBe(false);
  });

  it('does not treat an unrelated directory as nested', () => {
    mkdirSync(join(firstRepo, 'docs'), { recursive: true });
    const identity = resolveProjectIdentity(firstRepo);
    expect(identity.nestedRepos).toEqual([]);
    expect(nestedRepoExclusions(identity)).toEqual([]);
    expect(requireOwnIdentity(identity, 'docs/readme.md')).toEqual({ ok: true });
  });

  it('bounds the nested scan by depth', () => {
    const shallow = join(firstRepo, 'a', 'b', 'c', 'd', 'repo');
    mkdirSync(shallow, { recursive: true });
    git(shallow, 'init', '--quiet', '--initial-branch=main');
    const deepScan = resolveProjectIdentity(firstRepo, { maxScanDepth: 10 });
    expect(deepScan.nestedRepos).toHaveLength(1);
    const shallowScan = resolveProjectIdentity(firstRepo, { maxScanDepth: 2 });
    expect(shallowScan.nestedRepos).toEqual([]);
    expect(findNestedRepos(firstRepo, { maxDepth: 2 })).toEqual([]);
  });

  it('can skip the nested scan entirely', () => {
    const nested = join(firstRepo, 'inner');
    mkdirSync(nested, { recursive: true });
    git(nested, 'init', '--quiet', '--initial-branch=main');
    const identity = resolveProjectIdentity(firstRepo, { scanNestedRepos: false });
    expect(identity.nestedRepos).toEqual([]);
  });
});
