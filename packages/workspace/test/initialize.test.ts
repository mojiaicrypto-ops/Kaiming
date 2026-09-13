/**
 * Initialization state-machine tests (`docs/product/knowledge.md` §4/§5,
 * `docs/architecture/context.md` §4, AC-025/027/028/029).
 *
 * The repository fixtures are real temporary Git repositories created with the
 * real `git` binary; state persistence and file writes run through their real
 * implementations (JSON-file state store, node file system) unless a test needs a
 * controlled fault, in which case a thin spy/failing port is injected.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderReadme, type FeatureSectionBody, type ParsedFeature } from '@agentdev/knowledge';
import {
  NodeGitPort,
  READY_ENTRY_DOCUMENTS,
  WorkspaceError,
  createInitializer,
  createJsonFileInitStateStore,
  createMemoryInitStateStore,
  createNodeFileSystemPort,
  sha256Hex,
  type FileSystemPort,
  type GitResult,
  type InitBlocked,
  type InitFailed,
  type InitOutcome,
  type InitRecord,
  type InitSuccess,
  type Initializer,
} from '@agentdev/workspace';

const created: string[] = [];

/**
 * Explicit timeout for the cases in this file.
 *
 * Every case here drives the real `git` binary (init/commit/status) and the real
 * filesystem. The default 5s unit timeout made `pnpm test:unit` nondeterministic
 * on a loaded host (W9R1-06); the bound stays well under the integration project's
 * 180s and each case still finishes in well under a second on its own.
 */
const REAL_GIT_TEST_TIMEOUT = 30_000;

function makeTempDir(prefix = 'agentdev-ws-init-'): string {
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
const clock = (): string => '2026-01-01T00:00:00.000Z';

function initRepository(dir: string, branch = 'main'): void {
  const result = git.initRepository(dir, { branch });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'git init failed');
}

function commitFiles(dir: string, message: string, paths: readonly string[]): string {
  const result = git.commit(dir, { message, paths });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'git commit failed');
  return result.value.revision;
}

const BASE_FILES: Readonly<Record<string, string>> = {
  'README.md': '# demo\n',
  'package.json': '{"name":"demo"}\n',
  'src/orders/routes.ts': 'export const routes = [];\n',
  'src/payments/model.ts': 'export const model = {};\n',
};

/** Creates and commits a clean temporary repository. */
function seedRepository(files: Readonly<Record<string, string>> = BASE_FILES): {
  readonly dir: string;
  readonly revision: string;
} {
  const dir = makeTempDir();
  for (const [relativePath, content] of Object.entries(files))
    writeFileAt(dir, relativePath, content);
  initRepository(dir, 'main');
  const revision = commitFiles(dir, 'feat: seed', Object.keys(files));
  return { dir, revision };
}

interface SpyFileSystem extends FileSystemPort {
  readonly written: string[];
  readonly read: string[];
}

function spyFileSystem(base: FileSystemPort): SpyFileSystem {
  const written: string[] = [];
  const read: string[] = [];
  return {
    readFile(path) {
      read.push(path);
      return base.readFile(path);
    },
    writeFile(path, content) {
      written.push(path);
      base.writeFile(path, content);
    },
    pathExists(path) {
      return base.pathExists(path);
    },
    written,
    read,
  };
}

function okOf(outcome: InitOutcome): InitSuccess {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.status}`);
  return outcome;
}

function blockedOf(outcome: InitOutcome): InitBlocked {
  if (outcome.ok || outcome.status !== 'blocked') {
    throw new Error(`expected blocked, got ${outcome.ok ? 'ok' : outcome.status}`);
  }
  return outcome;
}

function failedOf(outcome: InitOutcome): InitFailed {
  if (outcome.ok || outcome.status !== 'failed') {
    throw new Error(`expected failed, got ${outcome.ok ? 'ok' : outcome.status}`);
  }
  return outcome;
}

function refusalOf(outcome: InitOutcome): Extract<InitOutcome, { ok: false }> {
  if (outcome.ok) throw new Error('expected a rejection, got ok');
  return outcome;
}

/**
 * Drives start → Identifying → Mapping → Confirming → Writing, confirming the
 * product-intent inferences when Confirming asks for them.
 */
function driveToWriting(init: Initializer, id: string): InitRecord {
  okOf(init.step(id)); // identifying → mapping
  okOf(init.step(id)); // mapping → confirming
  const third = init.step(id);
  if (third.ok) return third.record; // observed-only / empty project
  blockedOf(third);
  return okOf(init.confirm(id, { authorizationRef: 'user-action:1', by: 'user' })).record;
}

function section(heading: string, text: string, items: readonly string[] = []): FeatureSectionBody {
  return { heading, text, items };
}

/** A confirmed formal Feature document that disagrees with the observed tree. */
function confirmedFeature(): ParsedFeature {
  const documentPath = 'features/F-aaaaaaaa/README.md';
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
  };
}

/** Unwraps a GitResult, failing the test on an explicit Git error. */
function gitValue<T>(result: GitResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.errors[0]?.message ?? 'git failed'}`);
  return result.value;
}

describe('initialization phase sequence', { timeout: REAL_GIT_TEST_TIMEOUT }, () => {
  it('advances Identifying → Mapping → Confirming → Writing → Ready with evidence and a clean gate', () => {
    const { dir, revision } = seedRepository();
    const store = createMemoryInitStateStore();
    const init = createInitializer({ store, git, now: clock });
    const sourcePath = join(dir, 'src', 'orders', 'routes.ts');
    const sourceContent = readFileSync(sourcePath, 'utf8');
    const root = realpathSync(dir);

    const started = okOf(init.start({ id: 'init-1', root: dir }));
    expect(started.phase).toBe('identifying');
    expect(started.record.deliveryRef).toBeNull();

    const identified = okOf(init.step('init-1'));
    expect(identified.phase).toBe('mapping');
    expect(identified.record.gitRoot).toBe(root);
    expect(identified.record.gitRevision).toBe(revision);
    expect(identified.record.needsGitInitialization).toBe(false);

    const mapped = okOf(init.step('init-1'));
    expect(mapped.phase).toBe('confirming');
    expect(mapped.record.featureCount).toBe(2);
    expect(mapped.record.reads.length).toBeGreaterThanOrEqual(4);
    expect(mapped.record.inferences.filter((i) => i.requiresConfirmation)).toHaveLength(2);

    const awaitingConfirmation = blockedOf(init.step('init-1'));
    expect(awaitingConfirmation.blocker.kind).toBe('confirmation-required');
    expect(awaitingConfirmation.errors[0]?.code).toBe('GATE_NOT_READY');

    const confirmed = okOf(
      init.confirm('init-1', { authorizationRef: 'user-action:1', by: 'user', note: '同意' }),
    );
    expect(confirmed.phase).toBe('writing');
    expect(confirmed.record.confirmation?.authorizationRef).toBe('user-action:1');

    const done = okOf(init.step('init-1'));
    expect(done.phase).toBe('ready');
    expect(done.done).toBe(true);
    const record = done.record;

    // Evidence trail covers every phase and the gate.
    const kinds = record.evidence.map((entry) => entry.kind);
    expect(kinds[0]).toBe('start');
    for (const kind of ['identify', 'scan', 'confirmation', 'write', 'gate']) {
      expect(kinds).toContain(kind);
    }
    expect(record.evidence.map((entry) => entry.phase)).toEqual(
      expect.arrayContaining(['identifying', 'mapping', 'confirming', 'writing']),
    );

    // Candidate documents are on disk exactly as generated and marked candidates.
    expect(record.documents).toHaveLength(6);
    for (const document of record.documents) {
      expect(document.candidate).toBe(true);
      expect(document.deliveryRef).toBeNull();
      expect(readFileSync(join(record.root, document.path), 'utf8')).toBe(document.markdown);
    }
    for (const entry of READY_ENTRY_DOCUMENTS) {
      expect(existsSync(join(record.root, record.documentRoot, entry))).toBe(true);
    }
    expect(record.writes.every((receipt) => receipt.state === 'written')).toBe(true);

    // No delivery ref, no commit, no source change.
    expect(record.deliveryRef).toBeNull();
    expect(gitValue(git.headRevision(record.root), 'headRevision')).toBe(revision);
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceContent);
    const status = git.statusPorcelain(record.root);
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('expected status');
    expect(status.value.some((line) => line.includes('PROJECT.md'))).toBe(true);

    const gate = init.verifyReady('init-1');
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('expected a gate result');
    expect(gate.missing).toEqual([]);
    expect(gate.checks.every((check) => check.passed)).toBe(true);
    expect(gate.checks.map((check) => check.id)).toEqual([
      'candidate-documents-written',
      'feature-or-empty-project',
      'sources-and-unknowns',
      'documents-parse',
      'no-unresolved-conflict',
      'candidate-only-no-delivery-ref',
    ]);
  });

  it('fails the Ready gate when a candidate document is tampered with after Ready', () => {
    const { dir } = seedRepository();
    const init = createInitializer({
      store: createMemoryInitStateStore(),
      git,
      now: clock,
    });
    okOf(init.start({ id: 'init-1', root: dir }));
    const record = driveToWriting(init, 'init-1');
    const done = okOf(init.step('init-1'));
    expect(done.done).toBe(true);

    const featureDocument = record.documents.find((document) => document.kind === 'feature');
    expect(featureDocument).toBeDefined();
    if (featureDocument === undefined) throw new Error('missing feature document');
    writeFileSync(join(record.root, featureDocument.path), '# broken\n', 'utf8');

    const gate = init.verifyReady('init-1');
    expect(gate.ok).toBe(false);
    if ('errors' in gate) throw new Error('expected a gate result');
    expect(gate.missing).toEqual(['candidate-documents-written']);
    // The generated candidate still parses; drifting disk content is reported by
    // the write/hash check above.
    expect(gate.checks.find((check) => check.id === 'documents-parse')?.passed).toBe(true);
  });

  it('is idempotent for the same id and refuses to rebind it to another root', () => {
    const { dir } = seedRepository();
    const init = createInitializer({ store: createMemoryInitStateStore(), git, now: clock });
    okOf(init.start({ id: 'init-1', root: dir }));
    const again = okOf(init.start({ id: 'init-1', root: dir }));
    expect(again.advanced).toBe(false);
    expect(again.phase).toBe('identifying');

    const other = makeTempDir();
    const rebound = failedOf(init.start({ id: 'init-1', root: other }));
    expect(rebound.errors[0]?.code).toBe('INVALID_STATE');

    const missing = init.step('missing-id');
    expect(missing.ok).toBe(false);
    expect(missing.status).toBe('not-found');
    if (missing.ok || missing.status !== 'not-found') throw new Error('expected not-found');
    expect(missing.errors[0]?.code).toBe('NOT_FOUND');
  });
});

describe('interruption recovery in Writing', { timeout: REAL_GIT_TEST_TIMEOUT }, () => {
  it('resumes from a JSON-file state store without rewriting already-written documents', () => {
    const { dir } = seedRepository();
    const stateFile = join(makeTempDir(), 'init-state.json');
    const firstFiles = spyFileSystem(createNodeFileSystemPort());
    const first = createInitializer({
      store: createJsonFileInitStateStore(stateFile),
      git,
      fileSystem: firstFiles,
      now: clock,
      writeBatchSize: 2,
    });

    okOf(first.start({ id: 'init-1', root: dir }));
    driveToWriting(first, 'init-1');
    const partial = okOf(first.step('init-1'));
    expect(partial.done).toBe(false);
    expect(partial.record.status).toBe('writing');
    expect(partial.record.writes.map((receipt) => receipt.state)).toEqual(['written', 'written']);
    const writtenFirst = partial.record.documents.slice(0, 2).map((document) => document.path);
    expect(firstFiles.written).toEqual(writtenFirst.map((path) => join(partial.record.root, path)));

    // A fresh store instance reads exactly what the interrupted run persisted.
    const reloaded = createJsonFileInitStateStore(stateFile).load('init-1');
    expect(reloaded?.writes).toHaveLength(2);
    expect(reloaded?.phase).toBe('writing');

    const secondFiles = spyFileSystem(createNodeFileSystemPort());
    const second = createInitializer({
      store: createJsonFileInitStateStore(stateFile),
      git,
      fileSystem: secondFiles,
      now: clock,
    });
    const resumed = okOf(second.step('init-1'));
    expect(resumed.done).toBe(true);

    const expectedRemaining = partial.record.documents
      .slice(2)
      .map((document) => join(partial.record.root, document.path));
    expect([...secondFiles.written].sort()).toEqual([...expectedRemaining].sort());
    for (const alreadyWritten of writtenFirst) {
      expect(secondFiles.written).not.toContain(join(partial.record.root, alreadyWritten));
      expect(readFileSync(join(partial.record.root, alreadyWritten), 'utf8')).toBe(
        partial.record.documents.find((document) => document.path === alreadyWritten)?.markdown,
      );
    }
    expect(
      resumed.record.writes.filter((receipt) => receipt.state === 'unchanged').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('records an interrupted write and resumes without duplicating writes', () => {
    const { dir } = seedRepository();
    const inner = createNodeFileSystemPort();
    let writeCalls = 0;
    const failing: FileSystemPort = {
      readFile: (path) => inner.readFile(path),
      writeFile: (path, content) => {
        writeCalls += 1;
        if (writeCalls === 3) throw new Error('模拟写入崩溃');
        inner.writeFile(path, content);
      },
      pathExists: (path) => inner.pathExists(path),
    };

    const store = createMemoryInitStateStore();
    const first = createInitializer({ store, git, fileSystem: failing, now: clock });
    okOf(first.start({ id: 'init-1', root: dir }));
    driveToWriting(first, 'init-1');
    const crashed = failedOf(first.step('init-1'));
    expect(crashed.failure.kind).toBe('interrupted');
    expect(crashed.failure.recoverable).toBe(true);
    expect(crashed.record.writes.filter((receipt) => receipt.state === 'written')).toHaveLength(2);
    expect(crashed.phase).toBe('writing');

    const healthy = spyFileSystem(createNodeFileSystemPort());
    const second = createInitializer({ store, git, fileSystem: healthy, now: clock });
    const resumed = okOf(second.resume('init-1'));
    expect(resumed.done).toBe(true);
    expect(healthy.written).toHaveLength(4);
    for (const document of crashed.record.documents.slice(0, 2)) {
      expect(healthy.written).not.toContain(join(crashed.record.root, document.path));
      expect(readFileSync(join(crashed.record.root, document.path), 'utf8')).toBe(
        document.markdown,
      );
    }
  });
});

describe('write conflicts', { timeout: REAL_GIT_TEST_TIMEOUT }, () => {
  it('never overwrites an existing file with different content and requires explicit recovery', () => {
    const userContent = '# 用户自己的导航\n\n用户手工维护内容。\n';
    const { dir } = seedRepository({
      ...BASE_FILES,
      'docs/agentdev/PROJECT.md': userContent,
    });
    const init = createInitializer({ store: createMemoryInitStateStore(), git, now: clock });
    okOf(init.start({ id: 'init-1', root: dir }));
    driveToWriting(init, 'init-1');

    const conflicted = failedOf(init.step('init-1'));
    expect(conflicted.phase).toBe('writing');
    expect(conflicted.failure.kind).toBe('content-conflict');
    expect(conflicted.failure.details?.path).toBe('docs/agentdev/PROJECT.md');
    expect(conflicted.failure.details?.diskHash).toBe(sha256Hex(userContent));
    expect(conflicted.failure.details?.candidateHash).not.toBe(
      conflicted.failure.details?.diskHash,
    );
    expect(conflicted.errors[0]?.code).toBe('KNOWLEDGE_INVALID');
    expect(conflicted.record.fileConflicts).toHaveLength(1);

    // The user file is untouched and resume refuses while it is still there.
    const target = join(dir, 'docs/agentdev/PROJECT.md');
    expect(readFileSync(target, 'utf8')).toBe(userContent);
    const refused = failedOf(init.resume('init-1'));
    expect(refused.errors[0]?.code).toBe('INVALID_STATE');
    expect(readFileSync(target, 'utf8')).toBe(userContent);
    expect(existsSync(join(dir, 'docs/agentdev/INDEX.md'))).toBe(false);

    // After the user removes the conflicting file, resume completes the phase.
    rmSync(target);
    commitFiles(dir, 'chore: 移除冲突文档', ['docs/agentdev/PROJECT.md']);
    const resumed = okOf(init.resume('init-1'));
    expect(resumed.done).toBe(true);
    expect(existsSync(join(dir, 'docs/agentdev/INDEX.md'))).toBe(true);
  });

  it('reports a corrupt state file instead of treating it as empty', () => {
    const stateFile = join(makeTempDir(), 'init-state.json');
    writeFileSync(stateFile, '{ not json', 'utf8');
    const store = createJsonFileInitStateStore(stateFile);
    let caught: unknown;
    try {
      store.list();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkspaceError);
    if (!(caught instanceof WorkspaceError)) throw new Error('expected WorkspaceError');
    expect(caught.code).toBe('INVALID_STATE');
  });
});

describe('dirty workspace', { timeout: REAL_GIT_TEST_TIMEOUT }, () => {
  it('blocks delivery start with a hash report while read-only investigation still works', () => {
    const { dir, revision } = seedRepository();
    writeFileAt(dir, 'notes.txt', 'user data\n');

    const init = createInitializer({ store: createMemoryInitStateStore(), git, now: clock });
    okOf(init.start({ id: 'init-1', root: dir }));
    driveToWriting(init, 'init-1');

    const dirty = blockedOf(init.step('init-1'));
    expect(dirty.blocker.kind).toBe('dirty-workspace');
    expect(dirty.errors[0]?.code).toBe('INVALID_STATE');
    if (dirty.blocker.kind !== 'dirty-workspace') throw new Error('expected dirty blocker');
    const report = dirty.blocker.hashReport;
    const notes = report.find((entry) => entry.path === 'notes.txt');
    expect(notes?.sha256).toBe(sha256Hex('user data\n'));
    expect(notes?.state).toBe('??');

    // Read-only investigation is allowed in every state and writes nothing.
    const investigation = init.investigate('init-1');
    expect(investigation.ok).toBe(true);
    if (!investigation.ok) throw new Error('expected investigation');
    expect(investigation.wroteFiles).toBe(false);
    expect(investigation.reads.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'docs/agentdev'))).toBe(false);

    const noChoice = failedOf(init.resolveBlocker('init-1', { authorizationRef: 'user-action:2' }));
    expect(noChoice.errors[0]?.code).toBe('VALIDATION_ERROR');

    // Claiming "committed" without committing does not pass the gate.
    const stillDirty = blockedOf(
      init.resolveBlocker('init-1', {
        authorizationRef: 'user-action:2',
        dirtyChoice: 'committed',
      }),
    );
    expect(stillDirty.blocker.kind).toBe('dirty-workspace');
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('user data\n');

    // Saving a patch is an explicit handling: the phase proceeds and nothing is cleaned.
    const handled = okOf(
      init.resolveBlocker('init-1', { authorizationRef: 'user-action:3', dirtyChoice: 'patch' }),
    );
    expect(handled.done).toBe(true);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('user data\n');
    expect(init.get('init-1')?.dirtyHandling?.choice).toBe('patch');
    expect(init.get('init-1')?.deliveryRef).toBeNull();
    expect(gitValue(git.headRevision(dir), 'headRevision')).toBe(revision);
  });
});

describe('no-Git directory', { timeout: REAL_GIT_TEST_TIMEOUT }, () => {
  it('returns Blocked with the Git-initialization authorization request', () => {
    const dir = makeTempDir();
    writeFileAt(dir, 'README.md', '# app\n');
    writeFileAt(dir, 'src/app/main.ts', 'export const main = 1;\n');
    const root = realpathSync(dir);

    const init = createInitializer({ store: createMemoryInitStateStore(), git, now: clock });
    okOf(init.start({ id: 'init-1', root: dir }));
    const identified = okOf(init.step('init-1'));
    expect(identified.phase).toBe('mapping');
    expect(identified.record.gitRoot).toBeNull();
    expect(identified.record.needsGitInitialization).toBe(true);
    const mapped = okOf(init.step('init-1'));
    expect(mapped.phase).toBe('confirming');
    expect(mapped.record.featureCount).toBeGreaterThan(0);
    expect(blockedOf(init.step('init-1')).blocker.kind).toBe('confirmation-required');
    const confirmed = okOf(
      init.confirm('init-1', { authorizationRef: 'user-action:1', by: 'user' }),
    );
    expect(confirmed.phase).toBe('writing');

    const blocked = blockedOf(init.step('init-1'));
    expect(blocked.blocker.kind).toBe('git-initialization');
    expect(blocked.errors[0]?.code).toBe('NOT_AUTHORIZED');
    if (blocked.blocker.kind !== 'git-initialization') throw new Error('expected git blocker');
    expect(blocked.blocker.request.branch).toBe('agentdev/main');
    expect(blocked.blocker.request.root).toBe(root);
    expect(blocked.blocker.request.initialCommit).toBe(false);

    // Investigation and candidate artifacts are allowed before any authorization.
    const investigation = init.investigate('init-1');
    expect(investigation.ok).toBe(true);
    if (!investigation.ok) throw new Error('expected investigation');
    expect(investigation.featureCount).toBeGreaterThan(0);
    expect(investigation.candidateDocumentPaths.length).toBeGreaterThan(4);
    expect(existsSync(join(dir, 'docs'))).toBe(false);
    expect(git.isRepository(dir)).toBe(false);

    const afterAuthorization = blockedOf(
      init.authorizeGitInitialization('init-1', {
        authorizationRef: 'user-action:7',
        request: blocked.blocker.request,
      }),
    );
    expect(git.isRepository(dir)).toBe(true);
    expect(gitValue(git.branchName(dir), 'branchName')).toBe('agentdev/main');
    // The pre-existing files are now untracked dirt and block delivery start.
    expect(afterAuthorization.blocker.kind).toBe('dirty-workspace');
    if (afterAuthorization.blocker.kind !== 'dirty-workspace') {
      throw new Error('expected dirty blocker');
    }
    expect(afterAuthorization.blocker.hashReport.map((entry) => entry.path).sort()).toEqual([
      'README.md',
      'src/app/main.ts',
    ]);

    const stillDirty = blockedOf(
      init.resolveBlocker('init-1', {
        authorizationRef: 'user-action:8',
        dirtyChoice: 'committed',
      }),
    );
    expect(stillDirty.blocker.kind).toBe('dirty-workspace');

    // The user commits the existing files, then the explicit handling passes.
    commitFiles(dir, 'chore: 导入既有文件', ['README.md', 'src/app/main.ts']);
    const done = okOf(
      init.resolveBlocker('init-1', {
        authorizationRef: 'user-action:8',
        dirtyChoice: 'committed',
      }),
    );
    expect(done.done).toBe(true);
    expect(done.record.gitRoot).toBe(root);
    expect(gitValue(git.branchName(dir), 'branchName')).toBe('agentdev/main');
  });
});

describe('empty project (AC-025)', { timeout: REAL_GIT_TEST_TIMEOUT }, () => {
  it('creates the initial Git and delivery branch, then confirms an unimplemented project', () => {
    const dir = makeTempDir();
    const root = realpathSync(dir);
    const init = createInitializer({ store: createMemoryInitStateStore(), git, now: clock });
    okOf(init.start({ id: 'init-1', root: dir }));
    okOf(init.step('init-1'));
    const mapped = okOf(init.step('init-1'));
    expect(mapped.record.emptyProject).toBe(true);
    expect(mapped.record.featureCount).toBe(0);
    // Observed-only facts need no product-intent confirmation.
    const confirming = okOf(init.step('init-1'));
    expect(confirming.phase).toBe('writing');

    const blocked = blockedOf(init.step('init-1'));
    expect(blocked.blocker.kind).toBe('git-initialization');
    if (blocked.blocker.kind !== 'git-initialization') throw new Error('expected git blocker');
    expect(blocked.blocker.request.initialCommit).toBe(true);

    const done = okOf(
      init.authorizeGitInitialization('init-1', {
        authorizationRef: 'user-action:5',
        request: blocked.blocker.request,
      }),
    );
    expect(done.done).toBe(true);
    const record = done.record;
    expect(record.emptyProject).toBe(true);
    expect(record.featureCount).toBe(0);
    expect(record.deliveryRef).toBeNull();

    expect(git.isRepository(dir)).toBe(true);
    expect(gitValue(git.resolveRoot(dir), 'resolveRoot')).toBe(root);
    expect(gitValue(git.branchName(dir), 'branchName')).toBe('agentdev/main');
    const head = git.headRevision(dir);
    expect(head.ok).toBe(true);
    if (!head.ok) throw new Error('expected head');
    expect(head.value).not.toBeNull();
    expect(gitValue(git.trackedFiles(dir), 'trackedFiles')).toEqual([]);

    const project = record.documents.find((document) => document.documentPath === 'PROJECT.md');
    expect(project?.markdown).toContain('absent');
    expect(project?.candidate).toBe(true);
    const gate = init.verifyReady('init-1');
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('expected gate');
    expect(gate.missing).toEqual([]);
  });
});

describe('design/code conflict (AC-042)', { timeout: REAL_GIT_TEST_TIMEOUT }, () => {
  it('blocks Confirming, never confirms the existing document and keeps candidates observed', () => {
    const decisionId = '018f0a00-0000-7000-8000-000000000001';
    const existingMarkdown = renderReadme(confirmedFeature());
    const { dir } = seedRepository({
      'src/orders/routes.ts': 'export const routes = [];\n',
      'docs/agentdev/features/F-aaaaaaaa/README.md': existingMarkdown,
    });
    const existingPath = join(dir, 'docs/agentdev/features/F-aaaaaaaa/README.md');

    const init = createInitializer({
      store: createMemoryInitStateStore(),
      git,
      now: clock,
      knownIds: [decisionId],
    });
    okOf(init.start({ id: 'init-1', root: dir }));
    okOf(init.step('init-1'));
    const mapped = okOf(init.step('init-1'));
    expect(mapped.phase).toBe('confirming');
    expect(mapped.record.conflicts.map((conflict) => conflict.kind)).toEqual([
      'design-code-conflict',
    ]);
    expect(
      mapped.record.documents
        .filter((document) => document.kind === 'feature')
        .every((document) => document.markdown.includes('| design | unconfirmed |')),
    ).toBe(true);

    const blocked = blockedOf(init.step('init-1'));
    expect(blocked.blocker.kind).toBe('design-conflict');
    expect(blocked.errors[0]?.code).toBe('KNOWLEDGE_INVALID');
    expect(readFileSync(existingPath, 'utf8')).toBe(existingMarkdown);

    const afterResolution = blockedOf(
      init.resolveConflict('init-1', {
        documentPath: 'features/F-aaaaaaaa/README.md',
        kind: 'design-code-conflict',
        decisionRef: `decision:${decisionId}`,
      }),
    );
    expect(afterResolution.blocker.kind).toBe('confirmation-required');
    expect(readFileSync(existingPath, 'utf8')).toBe(existingMarkdown);

    const writing = okOf(init.confirm('init-1', { authorizationRef: 'user-action:9', by: 'user' }));
    expect(writing.phase).toBe('writing');
    const ready = okOf(init.step('init-1'));
    expect(ready.done).toBe(true);
    // The existing confirmed document is still exactly as it was.
    expect(readFileSync(existingPath, 'utf8')).toBe(existingMarkdown);
    expect(ready.record.conflictResolutions).toHaveLength(1);
  });
});

describe(
  'root-only projects reach Ready (W4R1-01 regression)',
  { timeout: REAL_GIT_TEST_TIMEOUT },
  () => {
    const shapes: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
      [
        'a root README and one root source file',
        { 'README.md': '# demo\n', 'main.ts': 'export const main = 1;\n' },
      ],
      [
        'a root README plus a root python module and test',
        {
          'README.md': '# demo\n',
          'main.py': 'print(1)\n',
          'test_main.py': 'def test_ok():\n    pass\n',
        },
      ],
    ];

    for (const [name, files] of shapes) {
      it(`reaches Ready for ${name}`, () => {
        const { dir } = seedRepository(files);
        const store = createMemoryInitStateStore();
        const init = createInitializer({ store, git, now: clock });
        okOf(init.start({ id: 'init-root', root: dir }));
        driveToWriting(init, 'init-root');
        const done = okOf(init.step('init-root'));
        expect(done.phase).toBe('ready');
        expect(done.done).toBe(true);
        // A root-level file is an observed capability, not an unsatisfiable gate.
        expect(done.record.emptyProject).toBe(false);
        expect(done.record.featureCount).toBeGreaterThan(0);
        expect(init.verifyReady('init-root').ok).toBe(true);
      });
    }

    it('treats a README-only project as an explicit no-capability project', () => {
      const { dir } = seedRepository({ 'README.md': '# docs only\n' });
      const store = createMemoryInitStateStore();
      const init = createInitializer({ store, git, now: clock });
      okOf(init.start({ id: 'init-docs', root: dir }));
      driveToWriting(init, 'init-docs');
      const done = okOf(init.step('init-docs'));
      expect(done.phase).toBe('ready');
      expect(done.record.featureCount).toBe(0);
      expect(done.record.emptyProject).toBe(true);
      expect(init.verifyReady('init-docs').ok).toBe(true);
    });
  },
);

describe(
  'budget exhaustion without capability (W4R2-01 regression)',
  { timeout: REAL_GIT_TEST_TIMEOUT },
  () => {
    /** 41 README files fill the default 40-file body budget; the source file is never read. */
    function readmeHeavyRepository(extra: Readonly<Record<string, string>> = {}): string {
      const files: Record<string, string> = {};
      for (let index = 0; index < 41; index += 1) {
        files[`pkg${index}/README.md`] = `# package ${index}\n`;
      }
      return seedRepository({ ...files, ...extra }).dir;
    }

    it('never reaches Ready by claiming an unconfirmed empty project', () => {
      const dir = readmeHeavyRepository();
      const store = createMemoryInitStateStore();
      const init = createInitializer({ store, git, now: clock });
      okOf(init.start({ id: 'init-budget', root: dir }));
      okOf(init.step('init-budget')); // identifying -> mapping
      const mapped = okOf(init.step('init-budget')); // mapping -> confirming
      expect(mapped.record.scanPartial).toBe(true);
      expect(mapped.record.featureCount).toBe(0);
      expect(mapped.record.emptyProject).toBe(false);

      const blocked = blockedOf(init.step('init-budget'));
      expect(blocked.blocker.kind).toBe('investigation-budget');
      expect(blocked.errors[0]?.code).toBe('MISSING_CONTEXT');
      // Retrying the same phase can never succeed on its own.
      const again = blockedOf(init.step('init-budget'));
      expect(again.blocker.kind).toBe('investigation-budget');
      expect(existsSync(join(dir, 'docs', 'agentdev', 'PROJECT.md'))).toBe(false);

      // The explicit no-capability decision is the resoluble path.
      const decided = okOf(
        init.confirmNoCapability('init-budget', {
          authorizationRef: 'user-action:no-capability',
          by: 'user',
        }),
      );
      expect(decided.phase).toBe('writing');
      expect(decided.record.emptyProjectConfirmed).toBe(true);
      const done = okOf(init.step('init-budget'));
      expect(done.phase).toBe('ready');
      expect(init.verifyReady('init-budget').ok).toBe(true);
      const project = readFileSync(join(dir, 'docs', 'agentdev', 'PROJECT.md'), 'utf8');
      // The published document reflects the explicit decision, not the earlier unknown state.
      expect(project).toContain('absent（未实现，明确空项目，用户已确认）');
      expect(project).not.toContain('未调查（预算耗尽');
    });

    it('finds the capability once the investigation batch is enlarged', () => {
      const dir = readmeHeavyRepository({ 'src/mod.ts': 'export const mod = 1;\n' });
      const store = createMemoryInitStateStore();
      const init = createInitializer({ store, git, now: clock });
      okOf(init.start({ id: 'init-more', root: dir }));
      okOf(init.step('init-more')); // identifying -> mapping
      okOf(init.step('init-more')); // mapping -> confirming
      const blocked = blockedOf(init.step('init-more'));
      expect(blocked.blocker.kind).toBe('investigation-budget');

      const reMapped = okOf(init.investigateMore('init-more', { maxBodyFiles: 200 }));
      expect(reMapped.phase).toBe('confirming');
      expect(reMapped.record.featureCount).toBeGreaterThan(0);
      expect(reMapped.record.emptyProject).toBe(false);

      const needsConfirmation = blockedOf(init.step('init-more'));
      expect(needsConfirmation.blocker.kind).toBe('confirmation-required');
      okOf(init.confirm('init-more', { authorizationRef: 'user-action:1', by: 'user' }));
      const done = okOf(init.step('init-more'));
      expect(done.phase).toBe('ready');
      expect(done.record.emptyProjectConfirmed).toBe(false);
    });
  },
);

describe(
  'budget-grant APIs reject bad input without bricking the record (W4R3-01..04)',
  { timeout: REAL_GIT_TEST_TIMEOUT },
  () => {
    function budgetedRepository(): string {
      const files: Record<string, string> = {};
      for (let index = 0; index < 41; index += 1)
        files[`pkg${index}/README.md`] = `# package ${index}\n`;
      files['src/mod.ts'] = 'export const mod = 1;\n';
      return seedRepository(files).dir;
    }

    it('rejects a smaller batch, a wrong phase and a missing id without persisting failure', () => {
      const dir = budgetedRepository();
      const store = createMemoryInitStateStore();
      const init = createInitializer({ store, git, now: clock });
      okOf(init.start({ id: 'init-guard', root: dir }));
      okOf(init.step('init-guard')); // identifying -> mapping
      okOf(init.step('init-guard')); // mapping -> confirming
      blockedOf(init.step('init-guard'));

      // A batch that does not actually grow the budget is refused ...
      const smaller = refusalOf(init.investigateMore('init-guard', { maxBodyFiles: 5 }));
      expect(smaller.errors[0]?.code).toBe('VALIDATION_ERROR');
      // ... and the record is still a healthy blocked record that a real batch can advance.
      expect(init.get('init-guard')?.status).toBe('blocked');
      expect(init.get('init-guard')?.failure).toBeNull();
      expect(blockedOf(init.step('init-guard')).blocker.kind).toBe('investigation-budget');

      // confirmNoCapability in the wrong phase is refused the same way.
      const wrongPhase = init.confirmNoCapability('missing-id', { authorizationRef: 'a', by: 'b' });
      expect(wrongPhase.status).toBe('not-found');

      // A batch that cannot help is refused while capabilities are already observed.
      const grown = okOf(init.investigateMore('init-guard', { maxBodyFiles: 200 }));
      expect(grown.record.featureCount).toBeGreaterThan(0);
      const tooLate = refusalOf(init.investigateMore('init-guard', { maxBodyFiles: 400 }));
      expect(tooLate.errors[0]?.code).toBe('VALIDATION_ERROR');
      expect(init.get('init-guard')?.failure).toBeNull();
    });

    it('refuses to degrade a Ready record through investigateMore', () => {
      const dir = seedRepository().dir;
      const store = createMemoryInitStateStore();
      const init = createInitializer({ store, git, now: clock });
      okOf(init.start({ id: 'init-ready', root: dir }));
      driveToWriting(init, 'init-ready');
      const done = okOf(init.step('init-ready'));
      expect(done.phase).toBe('ready');

      const degraded = refusalOf(init.investigateMore('init-ready', { maxBodyFiles: 1_000 }));
      expect(degraded.errors[0]?.code).toBe('INVALID_STATE');
      expect(init.get('init-ready')?.phase).toBe('ready');
      const noCapability = init.confirmNoCapability('init-ready', {
        authorizationRef: 'user-action:2',
        by: 'user',
      });
      expect(refusalOf(noCapability).errors[0]?.code).toBe('INVALID_STATE');
      expect(init.get('init-ready')?.phase).toBe('ready');
    });

    it('refuses a document-root that escapes the project (W4R3-03)', () => {
      expect(() =>
        createInitializer({ store: createMemoryInitStateStore(), git, documentRoot: '../escape' }),
      ).toThrowError(/document-root/u);
    });
  },
);

describe(
  'rejections never brick a record (T-01 regression)',
  { timeout: REAL_GIT_TEST_TIMEOUT },
  () => {
    it('keeps a Ready record Ready after a repeated confirm', () => {
      const { dir } = seedRepository();
      const store = createMemoryInitStateStore();
      const init = createInitializer({ store, git, now: clock });
      okOf(init.start({ id: 'init-t01', root: dir }));
      driveToWriting(init, 'init-t01');
      const done = okOf(init.step('init-t01'));
      expect(done.phase).toBe('ready');

      // A repeated confirmation is a harmless no-op: it neither advances nor breaks the record.
      const repeated = okOf(init.confirm('init-t01', { authorizationRef: 'user-action:2' }));
      expect(repeated.done).toBe(true);
      const record = init.get('init-t01');
      expect(record?.phase).toBe('ready');
      expect(record?.failure).toBeNull();
      expect(init.verifyReady('init-t01').ok).toBe(true);

      const lateGit = refusalOf(
        init.authorizeGitInitialization('init-t01', {
          authorizationRef: 'user-action:3',
          request: {
            kind: 'git-initialization',
            root: dir,
            branch: 'agentdev/main',
            initialCommit: false,
            reason: 'x',
          },
        }),
      );
      expect(lateGit.errors[0]?.code).toBe('INVALID_STATE');
      expect(init.get('init-t01')?.phase).toBe('ready');
    });
  },
);

describe(
  'input errors never downgrade a Ready record (W4R4-01 regression)',
  { timeout: REAL_GIT_TEST_TIMEOUT },
  () => {
    it('keeps done and Ready after resolveBlocker/resolveConflict misuse', () => {
      const { dir } = seedRepository();
      const store = createMemoryInitStateStore();
      const init = createInitializer({ store, git, now: clock });
      okOf(init.start({ id: 'init-w4r4', root: dir }));
      driveToWriting(init, 'init-w4r4');
      expect(okOf(init.step('init-w4r4')).done).toBe(true);

      for (const outcome of [
        init.resolveBlocker('init-w4r4', { authorizationRef: 'user-action:x' }),
        init.resolveConflict('init-w4r4', {
          documentPath: 'features/F-00000000/README.md',
          kind: 'design-code-conflict',
          decisionRef: 'decision:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
        }),
      ]) {
        refusalOf(outcome);
        const record = init.get('init-w4r4');
        expect(record?.status).toBe('ready');
        expect(record?.failure).toBeNull();
        expect(okOf(init.step('init-w4r4')).done).toBe(true);
        expect(init.verifyReady('init-w4r4').ok).toBe(true);
      }
    });
  },
);
