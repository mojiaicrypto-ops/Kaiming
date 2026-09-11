/**
 * Workspace scanning tests (`docs/product/knowledge.md` §5, AC-026/027/042).
 *
 * Everything runs on real temporary directories; the repository tests use the real
 * `git` binary through `NodeGitPort`, the rest use `MemoryGitPort` so a scan rule
 * can be asserted without repository setup.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseFeatureDocument,
  renderReadme,
  type FeatureSectionBody,
  type ParsedFeature,
} from '@agentdev/knowledge';
import {
  CANDIDATE_BANNER,
  DEFAULT_SCAN_BUDGET,
  NodeGitPort,
  SCAN_INDEX_LIMIT,
  createMemoryGitPort,
  generateCandidateKnowledge,
  indexPage,
  readKnowledgeDocuments,
  resolveProject,
  scanProject,
  sha256Hex,
  type GitPort,
  type GitResult,
  type MemoryGitPort,
  type ProjectIdentity,
  type ScanBudget,
  type ScanResult,
} from '@agentdev/workspace';

const created: string[] = [];

function makeTempDir(prefix = 'agentdev-ws-scan-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function writeFileAt(root: string, relativePath: string, content: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const git = new NodeGitPort();

function initRepository(dir: string, branch = 'main'): void {
  const result = git.initRepository(dir, { branch });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'git init failed');
}

function commitFiles(dir: string, message: string, paths: readonly string[]): string {
  const result = git.commit(dir, { message, paths });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'git commit failed');
  return result.value.revision;
}

function memoryRepoFor(dir: string): MemoryGitPort {
  return createMemoryGitPort({
    repositories: [{ root: realpathSync(dir), branch: 'main', head: null }],
  });
}

function scanDir(
  dir: string,
  options: { git?: GitPort; budget?: Partial<ScanBudget>; documentRoot?: string } = {},
): ScanResult {
  const outcome = scanProject({
    root: dir,
    git: options.git ?? memoryRepoFor(dir),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.documentRoot === undefined ? {} : { documentRoot: options.documentRoot }),
  });
  if (!outcome.ok) throw new Error(outcome.errors.map((error) => error.message).join('; '));
  return outcome;
}

function identityOf(dir: string): ProjectIdentity {
  const outcome = resolveProject(dir, { git });
  if (!outcome.ok) throw new Error(outcome.errors.map((error) => error.message).join('; '));
  return outcome;
}

function section(heading: string, text: string, items: readonly string[] = []): FeatureSectionBody {
  return { heading, text, items };
}

/** A formal Feature document used to exercise observed-vs-document conflicts. */
function existingFeature(overrides: Partial<ParsedFeature> = {}): ParsedFeature {
  const documentPath = overrides.documentPath ?? 'features/F-aaaaaaaa/README.md';
  return {
    title: '订单',
    documentPath,
    documentRevision: 'unknown',
    featureId: 'F-aaaaaaaa',
    name: '订单',
    module: 'orders',
    ownerDocument: documentPath,
    design: 'confirmed',
    designDecisionRefs: ['decision:018f0a00-0000-7000-8000-000000000001'],
    implementation: 'implemented',
    verification: 'unverified',
    verificationEvidenceRefs: [],
    verificationCoverage: [],
    investigation: 'partial',
    investigationScope: ['订单路由'],
    sourceRefs: ['git:0123456789012345678901234567890123456789:src/orders/routes.ts'],
    revision: '0123456789012345678901234567890123456789',
    relations: [],
    sections: {
      purpose: section('用途', '允许用户取消未付款订单。'),
      currentBehaviour: section('当前行为', '已付款订单返回拒绝。'),
      entries: section('实现入口', '', ['src/orders/handler.ts']),
      gaps: section('已知差距', '无已登记差距。'),
      decisions: section('关键决定', '无。'),
    },
    ...overrides,
  };
}

/** Unwraps a GitResult, failing the test on an explicit Git error. */
function gitValue<T>(result: GitResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.errors[0]?.message ?? 'git failed'}`);
  return result.value;
}

describe('resolveProject', () => {
  it('reduces subdirectories and symlinked paths of one repository to one Project', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'src/orders/routes.ts', 'export const routes = [];\n');
    initRepository(dir);
    commitFiles(dir, 'feat: orders', ['src/orders/routes.ts']);

    const root = realpathSync(dir);
    const fromRoot = identityOf(root);
    const fromSubdirectory = identityOf(join(root, 'src', 'orders'));

    const holder = makeTempDir();
    const link = join(holder, 'repo-link');
    symlinkSync(root, link, 'dir');
    const fromSymlink = identityOf(link);

    expect(fromRoot.gitRoot).toBe(root);
    expect(fromRoot.projectId).toBe(sha256Hex(root).slice(0, 32));
    expect(fromSubdirectory.root).toBe(root);
    expect(fromSubdirectory.projectId).toBe(fromRoot.projectId);
    expect(fromSymlink.root).toBe(root);
    expect(fromSymlink.projectId).toBe(fromRoot.projectId);
  });

  it('resolves a nested repository to itself, not to its parent', () => {
    const parent = makeTempDir();
    writeFileAt(parent, 'src/app/main.ts', 'export const main = 1;\n');
    initRepository(parent);
    commitFiles(parent, 'feat: app', ['src/app/main.ts']);

    const nested = join(parent, 'nested');
    writeFileAt(nested, 'lib/tool.ts', 'export const tool = 1;\n');
    initRepository(nested);
    commitFiles(nested, 'feat: tool', ['lib/tool.ts']);

    const parentIdentity = identityOf(parent);
    const nestedIdentity = identityOf(nested);
    expect(nestedIdentity.root).toBe(realpathSync(nested));
    expect(nestedIdentity.projectId).not.toBe(parentIdentity.projectId);
  });

  it('reports a missing path as NOT_FOUND instead of scanning nothing', () => {
    const dir = makeTempDir();
    const outcome = resolveProject(join(dir, 'missing'), { git });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.errors[0]?.code).toBe('NOT_FOUND');
  });
});

describe('scanProject exclusions', () => {
  it('excludes dependency directories, generated output, binaries and generated files', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'README.md', '# demo\n');
    writeFileAt(dir, 'package.json', '{"name":"demo"}\n');
    writeFileAt(dir, 'src/orders/routes.ts', 'export const routes = [];\n');
    writeFileAt(dir, 'node_modules/pkg/index.js', 'module.exports = {};\n');
    writeFileAt(dir, 'vendor/lib.js', 'module.exports = {};\n');
    writeFileAt(dir, 'dist/bundle.js', 'console.log(1);\n');
    writeFileAt(dir, 'coverage/lcov.info', 'TN:\n');
    writeFileAt(dir, 'target/debug/app.rs', 'fn main() {}\n');
    writeFileAt(dir, 'logo.png', 'PNG\u0000\u0000binary');
    writeFileAt(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
    writeFileAt(dir, 'src/orders/schema.ts.map', '{"version":3}\n');

    const result = scanDir(dir);
    const indexed = result.index.map((entry) => entry.path);

    for (const excluded of ['node_modules', 'vendor', 'dist', 'coverage', 'target']) {
      expect(result.excludedDirectories).toContain(excluded);
      expect(indexed.some((path) => path === excluded || path.startsWith(`${excluded}/`))).toBe(
        false,
      );
    }
    expect(result.binaryFiles).toContain('logo.png');
    expect(result.generatedFiles).toContain('pnpm-lock.yaml');
    expect(result.generatedFiles).toContain('src/orders/schema.ts.map');

    const bodyPaths = result.bodyFiles.map((file) => file.path);
    expect(bodyPaths).toEqual(['README.md', 'package.json', 'src/orders/routes.ts']);
    expect(result.partial).toBe(false);
    expect(result.claimsFullUnderstanding).toBe(false);
  });

  it('does not follow symlinks and reports escapes and broken links as unknowns', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'src/orders/routes.ts', 'export const routes = [];\n');
    writeFileAt(dir, 'src/orders/README.md', '# orders\n');

    const outside = makeTempDir();
    writeFileAt(outside, 'secret.txt', 'secret\n');
    symlinkSync(outside, join(dir, 'link-out'), 'dir');
    symlinkSync(join(dir, 'src', 'orders'), join(dir, 'link-in'), 'dir');
    symlinkSync(join(dir, 'missing-target'), join(dir, 'link-broken'), 'file');

    const result = scanDir(dir);
    const bodyPaths = result.bodyFiles.map((file) => file.path);

    expect(result.unknowns.some((u) => u.kind === 'symlink-escape' && u.path === 'link-out')).toBe(
      true,
    );
    expect(
      result.unknowns.some((u) => u.kind === 'broken-symlink' && u.path === 'link-broken'),
    ).toBe(true);
    const linkIn = result.index.find((entry) => entry.path === 'link-in');
    expect(linkIn?.symlink).toBe(true);
    // Not traversed, so the inner files appear exactly once (through their real path).
    expect(bodyPaths.filter((path) => path.endsWith('routes.ts'))).toEqual([
      'src/orders/routes.ts',
    ]);
    expect(bodyPaths.some((path) => path.startsWith('link-'))).toBe(false);
    expect(bodyPaths).not.toContain('secret.txt');
  });
});

describe('scanProject budgets', () => {
  it('stops at 40 body files and reports a partial map with explicit unknowns', () => {
    const dir = makeTempDir();
    for (let index = 0; index < 50; index += 1) {
      const name = `mod${String(index).padStart(2, '0')}`;
      writeFileAt(dir, `${name}/README.md`, `# module ${index}\n`);
    }

    const result = scanDir(dir);
    expect(DEFAULT_SCAN_BUDGET.maxBodyFiles).toBe(40);
    expect(result.bodyFiles).toHaveLength(40);
    expect(result.bodyFiles[0]?.path).toBe('mod00/README.md');
    expect(result.bodyFiles[39]?.path).toBe('mod39/README.md');
    expect(result.skippedFiles).toHaveLength(10);
    expect(result.skippedFiles.every((file) => file.reason === 'body-files')).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.completeness).toBe('partial');
    expect(result.claimsFullUnderstanding).toBe(false);
    expect(result.unknowns.some((unknown) => unknown.kind === 'budget-body-files')).toBe(true);
  });

  it('stops before exceeding 512 KiB of body content', () => {
    const dir = makeTempDir();
    const chunk = 'a'.repeat(40 * 1024);
    for (let index = 0; index < 30; index += 1) {
      writeFileAt(dir, `doc${String(index).padStart(2, '0')}/README.md`, chunk);
    }

    const result = scanDir(dir);
    expect(result.bodyFiles).toHaveLength(12);
    expect(result.bodyBytesRead).toBe(12 * 40 * 1024);
    expect(result.bodyBytesRead).toBeLessThanOrEqual(DEFAULT_SCAN_BUDGET.maxBodyBytes);
    expect(result.skippedFiles).toHaveLength(18);
    expect(result.skippedFiles.every((file) => file.reason === 'body-bytes')).toBe(true);
    expect(result.unknowns.some((unknown) => unknown.kind === 'budget-body-bytes')).toBe(true);
    expect(result.partial).toBe(true);
  });

  it('keeps the index out of the body budget and caps it with paging', () => {
    const dir = makeTempDir();
    for (let index = 0; index < 8; index += 1) {
      writeFileAt(dir, `src/f${index}.ts`, 'export const value = 1;\n');
    }

    const result = scanDir(dir, { budget: { maxIndexEntries: 5 } });
    expect(SCAN_INDEX_LIMIT).toBe(10_000);
    expect(result.indexTotal).toBe(9);
    expect(result.index).toHaveLength(5);
    expect(result.indexTruncated).toBe(true);
    expect(result.unknowns.some((unknown) => unknown.kind === 'index-truncated')).toBe(true);

    const collected: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = indexPage(result, { offset, limit: 2 });
      expect(page.ok).toBe(true);
      if (!page.ok) throw new Error('expected a page');
      expect(page.page.total).toBe(5);
      expect(page.page.discoverable).toBe(9);
      expect(page.page.truncated).toBe(true);
      collected.push(...page.page.entries.map((entry) => entry.path));
      offset = page.page.nextOffset;
    }
    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);

    for (const invalid of [
      { offset: 0, limit: 0 },
      { offset: 0, limit: 201 },
      { offset: -1, limit: 10 },
    ]) {
      const failure = indexPage(result, invalid);
      expect(failure.ok).toBe(false);
      if (failure.ok) throw new Error('expected validation failure');
      expect(failure.errors[0]?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('reports an empty directory as an explicit empty project', () => {
    const dir = makeTempDir();
    const result = scanDir(dir);
    expect(result.indexTotal).toBe(0);
    expect(result.bodyFiles).toHaveLength(0);
    expect(result.unknowns.some((unknown) => unknown.kind === 'empty-project')).toBe(true);
  });
});

describe('nested repositories', () => {
  it('excludes nested repository files from the parent and scans them independently', () => {
    const parent = makeTempDir();
    writeFileAt(parent, 'src/app/main.ts', 'export const main = 1;\n');
    initRepository(parent);
    commitFiles(parent, 'feat: app', ['src/app/main.ts']);

    const nested = join(parent, 'nested');
    writeFileAt(nested, 'lib/tool.ts', 'export const tool = 1;\n');
    initRepository(nested);
    commitFiles(nested, 'feat: tool', ['lib/tool.ts']);

    const parentScan = scanDir(parent);
    expect(parentScan.nestedRepositories).toHaveLength(1);
    expect(parentScan.nestedRepositories[0]?.relativePath).toBe('nested');
    expect(parentScan.nestedRepositories[0]?.projectId).toBe(
      sha256Hex(realpathSync(nested)).slice(0, 32),
    );
    expect(parentScan.unknowns.some((unknown) => unknown.kind === 'nested-repository')).toBe(true);
    expect(parentScan.index.some((entry) => entry.path.startsWith('nested/'))).toBe(false);
    expect(parentScan.bodyFiles.some((file) => file.path.startsWith('nested/'))).toBe(false);

    const nestedScan = scanDir(nested);
    expect(nestedScan.projectId).not.toBe(parentScan.projectId);
    expect(nestedScan.bodyFiles.map((file) => file.path)).toContain('lib/tool.ts');
    expect(nestedScan.nestedRepositories).toHaveLength(0);
  });
});

describe('candidate knowledge', () => {
  it('generates observed candidate features and documents without touching a delivery ref', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'README.md', '# demo project\n');
    writeFileAt(
      dir,
      'package.json',
      `${JSON.stringify({ name: 'demo', scripts: { build: 'tsc', test: 'vitest' } }, null, 2)}\n`,
    );
    writeFileAt(dir, 'src/orders/routes.ts', 'export const routes = [];\n');
    writeFileAt(dir, 'src/orders/routes.test.ts', 'test("routes", () => {});\n');
    writeFileAt(dir, 'src/payments/model.ts', 'export const model = {};\n');
    initRepository(dir);
    const revision = commitFiles(dir, 'feat: modules', [
      'README.md',
      'package.json',
      'src/orders/routes.ts',
      'src/orders/routes.test.ts',
      'src/payments/model.ts',
    ]);

    const scan = scanDir(dir, { git });
    expect(scan.gitRevision).toBe(revision);
    const knowledge = generateCandidateKnowledge({ scan });

    expect(knowledge.candidate).toBe(true);
    expect(knowledge.updatesDeliveryRef).toBe(false);
    expect(knowledge.deliveryRef).toBeNull();
    expect(knowledge.emptyProject).toBe(false);
    expect(knowledge.documents.map((document) => document.documentPath)).toEqual([
      'PROJECT.md',
      'INDEX.md',
      'CODE_MAP.md',
      'features/README.md',
      ...knowledge.features.map((candidate) => candidate.document.documentPath),
    ]);
    expect(
      knowledge.documents.every(
        (document) => document.candidate === true && document.deliveryRef === null,
      ),
    ).toBe(true);
    expect(
      knowledge.documents.every((document) => document.markdown.startsWith(CANDIDATE_BANNER)),
    ).toBe(true);
    expect(knowledge.features.map((candidate) => candidate.moduleKey)).toEqual([
      'src/orders',
      'src/payments',
    ]);

    const observedPaths = new Set(scan.bodyFiles.map((file) => file.path));
    for (const candidate of knowledge.features) {
      expect(candidate.observed).toBe(true);
      expect(candidate.candidate).toBe(true);
      expect(candidate.design).toBe('unconfirmed');
      expect(candidate.feature.design).toBe('unconfirmed');
      expect(candidate.feature.implementation).toBe('partial');
      expect(candidate.feature.verification).toBe('unverified');
      expect(candidate.feature.revision).toBe(revision);
      expect(candidate.feature.sections.purpose.text).toContain('未调查');
      // Every source ref points at a real, read path at the real revision.
      expect(candidate.sourceRefs.length).toBeGreaterThan(0);
      for (const ref of candidate.sourceRefs) {
        expect(ref.startsWith(`git:${revision}:`)).toBe(true);
        const path = ref.slice(`git:${revision}:`.length);
        expect(observedPaths.has(path)).toBe(true);
      }
      for (const item of candidate.feature.sections.entries.items) {
        expect(observedPaths.has(item)).toBe(true);
      }
      // The rendered candidate parses back to the same Feature facts.
      const parsed = parseFeatureDocument(candidate.document.markdown, {
        relativePath: candidate.document.documentPath,
        revision,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.errors.map((error) => error.message).join('; '));
      expect(parsed.feature.design).toBe('unconfirmed');
      expect(parsed.feature.featureId).toBe(candidate.feature.featureId);
      expect(parsed.feature.ownerDocument).toBe(candidate.document.documentPath);
    }

    const manifest = knowledge.observations.find((observation) => observation.kind === 'manifest');
    expect(manifest?.detail).toContain('name=demo');
    expect(manifest?.detail).toContain('build');
  });

  it('reports an existing document that disagrees with the observed tree (AC-042)', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'src/orders/routes.ts', 'export const routes = [];\n');
    const existingMarkdown = renderReadme(existingFeature());
    writeFileAt(dir, 'docs/agentdev/features/F-aaaaaaaa/README.md', existingMarkdown);
    initRepository(dir);
    commitFiles(dir, 'feat: orders', [
      'src/orders/routes.ts',
      'docs/agentdev/features/F-aaaaaaaa/README.md',
    ]);

    const scan = scanDir(dir);
    const read = readKnowledgeDocuments({ root: scan.root });
    expect(read.documents.map((document) => document.relativePath)).toEqual([
      'features/F-aaaaaaaa/README.md',
    ]);

    const knownIds = ['018f0a00-0000-7000-8000-000000000001'];
    const knowledge = generateCandidateKnowledge({
      scan,
      existingDocuments: read.documents,
      knownIds,
    });

    expect(knowledge.conflicts).toHaveLength(1);
    const conflict = knowledge.conflicts[0];
    expect(conflict?.kind).toBe('design-code-conflict');
    expect(conflict?.documentPath).toBe('features/F-aaaaaaaa/README.md');
    expect(conflict?.featureId).toBe('F-aaaaaaaa');
    expect(conflict?.moduleKey).toBe('src/orders');
    expect(conflict?.paths).toEqual(['src/orders/handler.ts']);
    expect(conflict?.detail).toContain('冲突');

    // Observed candidate stays unconfirmed and lists the conflict as a gap.
    const orders = knowledge.features.find((candidate) => candidate.moduleKey === 'src/orders');
    expect(orders?.feature.design).toBe('unconfirmed');
    expect(orders?.feature.sections.gaps.items.some((item) => item.includes('设计/实现冲突'))).toBe(
      true,
    );
    expect(orders?.document.markdown).toContain('| design | unconfirmed |');

    // Without a resolvable decision the document is still reported, never trusted.
    const withoutIds = generateCandidateKnowledge({ scan, existingDocuments: read.documents });
    expect(withoutIds.conflicts[0]?.kind).toBe('invalid-document');

    // The existing formal document is never rewritten by candidate generation.
    expect(readFileSync(join(dir, 'docs/agentdev/features/F-aaaaaaaa/README.md'), 'utf8')).toBe(
      existingMarkdown,
    );
  });

  it('records git-unavailable as an unknown instead of claiming a revision', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'src/app/main.ts', 'export const main = 1;\n');
    const brokenGit: GitPort = {
      isRepository: () => false,
      resolveRoot: () => ({
        ok: false,
        errors: [{ code: 'INTERNAL_ERROR', message: 'git 不可用（测试桩）', path: dir }],
      }),
      headRevision: () => ({ ok: true, value: null }),
      statusPorcelain: () => ({ ok: true, value: [] }),
      initRepository: () => ({
        ok: false,
        errors: [{ code: 'INTERNAL_ERROR', message: 'unused' }],
      }),
      branchName: () => ({ ok: true, value: null }),
      commit: () => ({ ok: false, errors: [{ code: 'INTERNAL_ERROR', message: 'unused' }] }),
      trackedFiles: () => ({ ok: true, value: [] }),
    };

    const result = scanDir(dir, { git: brokenGit });
    expect(result.gitRoot).toBeNull();
    expect(result.gitRevision).toBeNull();
    expect(result.unknowns.some((unknown) => unknown.kind === 'git-unavailable')).toBe(true);

    const knowledge = generateCandidateKnowledge({ scan: result });
    // No revision known: source refs fall back to real paths, not invented SHAs.
    for (const candidate of knowledge.features) {
      expect(candidate.sourceRefs.every((ref) => ref.startsWith('file:'))).toBe(true);
      expect(candidate.feature.revision).toBe('未调查');
    }
  });
});

describe('Git ports', () => {
  it('NodeGitPort runs real git with explicit arguments', () => {
    const dir = makeTempDir();
    expect(git.isRepository(dir)).toBe(false);
    expect(git.resolveRoot(dir)).toEqual({ ok: true, value: null });

    const initialized = git.initRepository(dir, { branch: 'agentdev/main' });
    expect(initialized.ok).toBe(true);
    const again = git.initRepository(dir, { branch: 'agentdev/main' });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('expected failure');
    expect(again.errors[0]?.code).toBe('INVALID_STATE');

    expect(gitValue(git.branchName(dir), 'branchName')).toBe('agentdev/main');
    expect(gitValue(git.headRevision(dir), 'headRevision')).toBeNull();

    writeFileAt(dir, 'a.txt', 'hello\n');
    const dirty = git.statusPorcelain(dir);
    expect(dirty.ok).toBe(true);
    if (!dirty.ok) throw new Error('expected status');
    expect(dirty.value.some((line) => line.includes('a.txt'))).toBe(true);

    const committed = git.commit(dir, { message: 'chore: init', paths: ['a.txt'] });
    expect(committed.ok).toBe(true);
    if (!committed.ok) throw new Error('expected commit');
    expect(gitValue(git.statusPorcelain(dir), 'statusPorcelain')).toEqual([]);
    expect(gitValue(git.headRevision(dir), 'headRevision')).toBe(committed.value.revision);
    expect(gitValue(git.trackedFiles(dir), 'trackedFiles')).toContain('a.txt');
    writeFileAt(dir, 'src/nested/file.ts', 'export const value = 1;\n');
    expect(git.resolveRoot(join(dir, 'src', 'nested'))).toEqual({
      ok: true,
      value: realpathSync(dir),
    });

    const invalid = git.commit(dir, { message: '   ', paths: [] });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('expected failure');
    expect(invalid.errors[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('MemoryGitPort answers the same contract without a repository', () => {
    const dir = makeTempDir();
    const root = realpathSync(dir);
    const memory = createMemoryGitPort({ repositories: [{ root, branch: 'main', head: null }] });

    expect(memory.isRepository(dir)).toBe(true);
    expect(memory.resolveRoot(join(dir, 'src'))).toEqual({ ok: true, value: root });
    expect(gitValue(memory.headRevision(dir), 'headRevision')).toBeNull();
    memory.setStatus(dir, ['?? notes.txt']);
    expect(gitValue(memory.statusPorcelain(dir), 'statusPorcelain')).toEqual(['?? notes.txt']);

    const committed = memory.commit(dir, { message: 'init', paths: ['notes.txt'] });
    expect(committed.ok).toBe(true);
    if (!committed.ok) throw new Error('expected commit');
    expect(gitValue(memory.statusPorcelain(dir), 'statusPorcelain')).toEqual([]);
    expect(gitValue(memory.trackedFiles(dir), 'trackedFiles')).toContain('notes.txt');
    expect(gitValue(memory.branchName(dir), 'branchName')).toBe('main');

    const other = makeTempDir();
    expect(memory.isRepository(other)).toBe(false);
    expect(memory.initRepository(other, { branch: 'agentdev/main' }).ok).toBe(true);
    expect(memory.repositories()).toHaveLength(2);
  });
});

describe('file fixtures stay untouched by scanning', () => {
  it('does not create files while scanning', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'src/app/main.ts', 'export const main = 1;\n');
    const before = scanDir(dir);
    expect(existsSync(join(dir, '.agentdev'))).toBe(false);
    const knowledge = generateCandidateKnowledge({ scan: before });
    // Candidate documents are returned, not written.
    expect(knowledge.documents.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'docs'))).toBe(false);
  });
});
