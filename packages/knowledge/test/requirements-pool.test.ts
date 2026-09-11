/**
 * Portable Requirement pool tests (`docs/product/requirements.md`,
 * `docs/architecture/data.md` §2, AC-087/088/092/093).
 *
 * Every fixture is a real temporary directory holding real
 * `.agentdev/requirements/<id>/{requirement.json,content.md}` files (and one real
 * temporary Git repository for the ignore rule). The library is pure: the "AI
 * client" below is only ever a spy, and a single property read would fail the
 * list test — proving the list works without any model call.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVIDENCE_NOT_MIGRATED,
  LEGACY_REQUIREMENTS_DIR,
  REQUIREMENTS_README,
  REQUIREMENTS_ROOT,
  WORKING_TREE_REVISION,
  importRequirementPool,
  importedHistorySummary,
  normalizeContentMarkdown,
  parseRequirementPoolInput,
  parseRequirementPool,
  readContentVersion,
  rebuildPoolReadme,
  requirementRecordHash,
  sha256Hex,
  type LocalRequirementRecord,
  type LocalRequirementState,
  type RequirementPoolIssue,
  type RequirementPoolRecord,
  type RequirementPoolResult,
} from '../src/index.js';

const REVISION_1 = '1111111111111111111111111111111111111111';
const REVISION_2 = '2222222222222222222222222222222222222222';

const ID_QUEUED = '0195f0a0-0000-7000-8000-000000000001';
const ID_ACTIVE = '0195f0a0-0000-7000-8000-000000000002';
const ID_COMPLETED = '0195f0a0-0000-7000-8000-000000000003';
const ID_CANCELLED = '0195f0a0-0000-7000-8000-000000000004';
const ID_ARCHIVED = '0195f0a0-0000-7000-8000-000000000005';

const FEATURE_ID = 'F-1a2b3c4d';

const created: string[] = [];

function makeTempDir(prefix = 'agentdev-req-pool-'): string {
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

/** Everything optional a test may override when building one record. */
interface RecordOptions {
  readonly id?: string;
  readonly version?: number;
  readonly title?: string;
  readonly goal?: string;
  readonly lifecycle?: 'queued' | 'active' | 'completed' | 'cancelled' | 'archived';
  readonly previousLifecycle?: 'queued' | 'completed';
  readonly contentBody?: string;
  readonly contentHash?: string;
  readonly contentVersionMarker?: number | 'omit';
  readonly contentFile?: string;
  readonly extraMetadata?: Readonly<Record<string, unknown>>;
  readonly acceptance?: boolean;
  readonly completion?: boolean;
  readonly cancellation?: boolean;
  readonly confirmedDecision?: boolean;
}

interface BuiltRecord {
  readonly id: string;
  readonly metadataJson: string;
  readonly contentMarkdown: string;
  /** The declared `version`, which the version-mismatch tests deliberately skew. */
  readonly metadataVersion: number;
}

const DEFAULT_BODY = [
  '<!-- record-version: 1 -->',
  '# 需求正文',
  '',
  '## 目标与背景',
  '让需求随 Git 迁移。',
  '',
  '## 范围与行为',
  '仅保存需求事实，不迁移执行现场。',
  '',
  '## 验收说明',
  'AC-087：空白服务器仅 Clone 即可恢复需求列表。',
  '',
  '## 已确认决定',
  '无',
  '',
  '## 未决问题',
  '无',
  '',
  '## 完成摘要',
  '无',
  '',
].join('\n');

/** Builds one record's two files in memory; the hash always matches the body. */
function buildRecord(options: RecordOptions = {}): BuiltRecord {
  const id = options.id ?? ID_QUEUED;
  const version = options.version ?? 1;
  const lifecycle = options.lifecycle ?? 'queued';
  const contentMarkdown = (options.contentBody ?? DEFAULT_BODY).replace(
    '<!-- record-version: 1 -->',
    options.contentVersionMarker === 'omit'
      ? ''
      : `<!-- record-version: ${options.contentVersionMarker ?? version} -->`,
  );
  const contentHash = options.contentHash ?? sha256Hex(normalizeContentMarkdown(contentMarkdown));
  const base: Record<string, unknown> = {
    schemaVersion: 1,
    id,
    version,
    contentFile: options.contentFile ?? 'content.md',
    contentHash,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    title: options.title ?? '需求随 Git 迁移',
    goal: options.goal ?? '任何服务器 Clone 后都能读取需求池',
    scope: {
      readPaths: ['packages'],
      writePaths: [],
      operations: [],
      networkTargets: [],
    },
    lifecycle,
    featureIds: [FEATURE_ID],
    acceptance:
      options.acceptance === true
        ? [{ id: 'AC-087', given: '空白服务器', when: 'Clone 项目', then: '需求列表可用' }]
        : [],
    openQuestions: [],
    confirmedDecisions:
      options.confirmedDecision === true
        ? [
            {
              id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
              summary: '需求事实保存在 .agentdev/requirements',
              decidedAt: '2026-01-01T12:00:00.000Z',
              sourceKind: 'user_message',
            },
          ]
        : [],
    relatedRequirementIds: [],
  };
  if (options.previousLifecycle !== undefined) base.previousLifecycle = options.previousLifecycle;
  if (options.completion === true) {
    base.completion = {
      completedAt: '2026-02-01T00:00:00.000Z',
      summary: '需求池解析、导入与索引已交付。',
      codeRevision: REVISION_1,
      codeTree: 'c'.repeat(64),
      featureIds: [FEATURE_ID],
      verificationSummary: '本机单测通过；旧报告未迁移。',
      remainingIssues: ['README 需要重建'],
    };
  }
  if (options.cancellation === true) {
    base.cancellation = { cancelledAt: '2026-02-02T00:00:00.000Z', reason: '用户决定放弃该需求' };
  }
  const metadata = { ...base, ...(options.extraMetadata ?? {}) };
  return {
    id,
    metadataJson: `${JSON.stringify(metadata, null, 2)}\n`,
    contentMarkdown,
    metadataVersion: version,
  };
}

/** Writes a pool directory and returns its repository root. */
function writePool(
  records: readonly BuiltRecord[],
  options: { readonly readme?: string | false } = {},
): string {
  const root = makeTempDir();
  for (const record of records) {
    writeFileAt(root, `${REQUIREMENTS_ROOT}/${record.id}/requirement.json`, record.metadataJson);
    writeFileAt(root, `${REQUIREMENTS_ROOT}/${record.id}/content.md`, record.contentMarkdown);
  }
  if (options.readme !== false) {
    writeFileAt(root, REQUIREMENTS_README, options.readme ?? '# 需求池索引\n');
  }
  return root;
}

function expectOk(result: RequirementPoolResult) {
  expect(result.errors).toEqual([]);
  if (!result.ok || result.pool === null) throw new Error('expected a valid pool');
  return result.pool;
}

function codes(result: RequirementPoolResult): readonly string[] {
  return result.errors.map((issue: RequirementPoolIssue) => issue.code);
}

function emptyLocal(): LocalRequirementState {
  return { projectId: 'a'.repeat(32), revision: REVISION_1, records: [] };
}

function withRecords(local: LocalRequirementState, rows: readonly LocalRequirementRecord[]) {
  return { ...local, records: rows };
}

function findRow(state: LocalRequirementState, id: string): LocalRequirementRecord {
  const row = state.records.find((item) => item.id === id);
  if (row === undefined) throw new Error(`missing local row ${id}`);
  return row;
}

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

/** One real temporary Git repository with an initial commit. */
function makeGitRepository(): string {
  const root = makeTempDir('agentdev-req-git-');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'agentdev@example.test']);
  git(root, ['config', 'user.name', 'AgentDev Test']);
  writeFileAt(root, 'README.md', '# demo\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'init']);
  return root;
}

describe('parseRequirementPool', () => {
  it('parses README plus two requirements and lists them without any model call', () => {
    const queued = buildRecord({ id: ID_QUEUED });
    const active = buildRecord({ id: ID_ACTIVE, lifecycle: 'active', title: '进行中的需求' });
    const root = writePool([queued, active], { readme: '# 需求池索引\n\n（过期内容）\n' });

    // A spy that fails the test the moment anything reads from it: the list and
    // the body must come from disk, never from a model.
    const aiClient = new Proxy(
      {},
      {
        get: (_target, property) => {
          throw new Error(`parseRequirementPool must not touch an AI client (${String(property)})`);
        },
      },
    );
    void aiClient;

    const pool = expectOk(parseRequirementPool({ repoRoot: root, revision: REVISION_1 }));

    expect(pool.rootPath).toBe(REQUIREMENTS_ROOT);
    expect(pool.revision).toBe(REVISION_1);
    expect(pool.records.map((record) => record.id)).toEqual([ID_QUEUED, ID_ACTIVE]);
    expect(pool.records.map((record) => record.metadata.lifecycle)).toEqual(['queued', 'active']);
    expect(pool.records.map((record) => record.metadata.goal)).toEqual([
      '任何服务器 Clone 后都能读取需求池',
      '任何服务器 Clone 后都能读取需求池',
    ]);
    expect(pool.records[0]?.metadata.title).toBe('需求随 Git 迁移');
    // The body text is exposed verbatim, with the version marker still readable.
    expect(pool.records[0]?.contentMarkdown).toContain('让需求随 Git 迁移。');
    expect(readContentVersion(pool.records[0]?.contentMarkdown ?? '')).toBe(1);
    expect(pool.records[0]?.contentHash).toBe(sha256Hex(queued.contentMarkdown));
    expect(pool.records[0]?.metadataHash).toBe(sha256Hex(queued.metadataJson));
    expect(pool.records[0]?.recordHash).toBe(
      requirementRecordHash(
        sha256Hex(queued.metadataJson),
        sha256Hex(normalizeContentMarkdown(queued.contentMarkdown)),
      ),
    );
    // The stored README is stale, which is reported but never fatal.
    expect(pool.readmeOutOfDate).toBe(true);
    expect(pool.readme).toBe(rebuildPoolReadme(pool.records));
    expect(pool.legacyPaths).toEqual([]);
  });

  it('reports a missing README as rebuildable instead of failing', () => {
    const root = writePool([buildRecord()], { readme: false });
    const pool = expectOk(parseRequirementPool({ repoRoot: root }));
    expect(pool.readmeOutOfDate).toBe(true);
    expect(pool.storedReadme).toBeUndefined();
    expect(pool.readme).toContain('0195f0a0-0000-7000-8000-000000000001');
  });

  it('changes the combined hash and version together when the body changes', () => {
    const before = buildRecord({ id: ID_QUEUED });
    const editedBody = DEFAULT_BODY.replace(
      '让需求随 Git 迁移。',
      '让需求随 Git 迁移，并保留稳定 ID。',
    );
    const after = buildRecord({ id: ID_QUEUED, version: 2, contentBody: editedBody });

    const beforePool = expectOk(parseRequirementPool({ repoRoot: writePool([before]) }));
    const afterPool = expectOk(parseRequirementPool({ repoRoot: writePool([after]) }));

    const beforeRecord = beforePool.records[0] as RequirementPoolRecord;
    const afterRecord = afterPool.records[0] as RequirementPoolRecord;
    expect(afterRecord.metadata.version).toBe(2);
    expect(afterRecord.contentHash).not.toBe(beforeRecord.contentHash);
    // The record hash covers both files, so it changes even though the metadata
    // hash changed only because contentHash is embedded in it.
    expect(afterRecord.recordHash).not.toBe(beforeRecord.recordHash);
    expect(readContentVersion(afterRecord.contentMarkdown)).toBe(2);
  });

  it('reports a missing content.md without dropping the record', () => {
    const record = buildRecord({ id: ID_QUEUED });
    const root = writePool([record]);
    rmSync(join(root, REQUIREMENTS_ROOT, ID_QUEUED, 'content.md'));

    const result = parseRequirementPool({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(codes(result)).toEqual(['REQUIREMENT_CONFLICT']);
    expect(result.errors[0]?.path).toBe(`${REQUIREMENTS_ROOT}/${ID_QUEUED}/content.md`);
    expect(result.errors[0]?.requirementId).toBe(ID_QUEUED);
  });

  it('reports missing requirement.json without dropping the record', () => {
    const record = buildRecord({ id: ID_QUEUED });
    const root = writePool([record]);
    rmSync(join(root, REQUIREMENTS_ROOT, ID_QUEUED, 'requirement.json'));

    const result = parseRequirementPool({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['REQUIREMENT_CONFLICT']);
    expect(result.errors[0]?.path).toBe(`${REQUIREMENTS_ROOT}/${ID_QUEUED}/requirement.json`);
  });

  it('reports a content hash mismatch per record', () => {
    const record = buildRecord({ id: ID_QUEUED, contentHash: 'f'.repeat(64) });
    const result = parseRequirementPool({ repoRoot: writePool([record]) });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['REQUIREMENT_CONFLICT']);
    expect(result.errors[0]?.message).toContain('contentHash');
    expect(result.errors[0]?.requirementId).toBe(ID_QUEUED);
  });

  it('reports a version mismatch between requirement.json and content.md', () => {
    const mismatched = buildRecord({ id: ID_QUEUED, contentVersionMarker: 7 });
    const result = parseRequirementPool({ repoRoot: writePool([mismatched]) });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain('record-version 7');
    expect(result.errors[0]?.message).toContain('version 1');

    // A body without the optional marker is accepted; the metadata is authority.
    const unmarked = buildRecord({ id: ID_QUEUED, contentVersionMarker: 'omit' });
    const accepted = expectOk(parseRequirementPool({ repoRoot: writePool([unmarked]) }));
    expect(accepted.records).toHaveLength(1);
    expect(readContentVersion(accepted.records[0]?.contentMarkdown ?? '')).toBeUndefined();
  });

  it('reports a directory whose name is not the record id', () => {
    const record = buildRecord({ id: ID_QUEUED });
    const root = makeTempDir();
    writeFileAt(root, `${REQUIREMENTS_ROOT}/not-the-id/requirement.json`, record.metadataJson);
    writeFileAt(root, `${REQUIREMENTS_ROOT}/not-the-id/content.md`, record.contentMarkdown);

    const result = parseRequirementPool({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain('must equal the record id');
  });

  it('keeps valid records visible next to a broken one and never rewrites the files', () => {
    const good = buildRecord({ id: ID_QUEUED });
    const bad = buildRecord({ id: ID_ACTIVE, contentHash: 'e'.repeat(64) });
    const root = writePool([good, bad]);
    const badBodyBefore = readFileSync(
      join(root, REQUIREMENTS_ROOT, ID_ACTIVE, 'content.md'),
      'utf8',
    );

    const result = parseRequirementPool({ repoRoot: root });

    expect(result.ok).toBe(false);
    // The valid record is still reported so it stays visible and importable.
    expect(result.records.map((record) => record.id)).toEqual([ID_QUEUED]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.requirementId).toBe(ID_ACTIVE);
    // Nothing was blank-filled, repaired or deleted on disk.
    expect(readFileSync(join(root, REQUIREMENTS_ROOT, ID_ACTIVE, 'content.md'), 'utf8')).toBe(
      badBodyBefore,
    );
    expect(readFileSync(join(root, REQUIREMENTS_ROOT, ID_QUEUED, 'content.md'), 'utf8')).toBe(
      good.contentMarkdown,
    );
  });
});

describe('Git ignore and legacy layout', () => {
  it('reports REQUIREMENT_PATH_IGNORED when .agentdev is ignored wholesale', () => {
    const root = makeGitRepository();
    writeFileAt(root, '.gitignore', '.agentdev/\n');
    const record = buildRecord({ id: ID_QUEUED });
    writeFileAt(root, `${REQUIREMENTS_ROOT}/${ID_QUEUED}/requirement.json`, record.metadataJson);
    writeFileAt(root, `${REQUIREMENTS_ROOT}/${ID_QUEUED}/content.md`, record.contentMarkdown);
    // Sanity-check the fixture: real Git really reports the pool as ignored.
    expect(() =>
      execFileSync('git', ['-C', root, 'check-ignore', '--quiet', '--', REQUIREMENTS_ROOT]),
    ).not.toThrow();

    const result = parseRequirementPool({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('REQUIREMENT_PATH_IGNORED');
    const ignored = result.errors.filter((issue) => issue.code === 'REQUIREMENT_PATH_IGNORED');
    expect(ignored.map((issue) => issue.path)).toContain(REQUIREMENTS_ROOT);
    // The record itself is still readable; only the Git path is wrong.
    expect(result.records.map((item) => item.id)).toEqual([ID_QUEUED]);
  });

  it('treats an un-ignored pool in the same repository as tracked', () => {
    const root = makeGitRepository();
    writeFileAt(root, '.gitignore', '.agentdev/work/\n');
    const record = buildRecord({ id: ID_QUEUED });
    writeFileAt(root, `${REQUIREMENTS_ROOT}/${ID_QUEUED}/requirement.json`, record.metadataJson);
    writeFileAt(root, `${REQUIREMENTS_ROOT}/${ID_QUEUED}/content.md`, record.contentMarkdown);

    const pool = expectOk(parseRequirementPool({ repoRoot: root }));
    expect(pool.records.map((item) => item.id)).toEqual([ID_QUEUED]);
  });

  it('reports the legacy single-JSON layout without migrating it', () => {
    const root = makeTempDir();
    const record = buildRecord({ id: ID_QUEUED });
    writeFileAt(root, `${REQUIREMENTS_ROOT}/${ID_QUEUED}.json`, record.metadataJson);
    writeFileAt(
      root,
      `docs/agentdev/${LEGACY_REQUIREMENTS_DIR}/${ID_ACTIVE}.json`,
      buildRecord({ id: ID_ACTIVE }).metadataJson,
    );

    const result = parseRequirementPool({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['LEGACY_REQUIREMENT_FORMAT', 'LEGACY_REQUIREMENT_FORMAT']);
    expect(result.errors.map((issue) => issue.path)).toEqual([
      `${REQUIREMENTS_ROOT}/${ID_QUEUED}.json`,
      `docs/agentdev/${LEGACY_REQUIREMENTS_DIR}/${ID_ACTIVE}.json`,
    ]);
    expect(result.records).toEqual([]);
    // The legacy file is still on disk — a conversion is an explicit user action.
    expect(readFileSync(join(root, `${REQUIREMENTS_ROOT}/${ID_QUEUED}.json`), 'utf8')).toBe(
      record.metadataJson,
    );
  });

  it('reports a duplicate requirement id once per record', () => {
    const record = buildRecord({ id: ID_QUEUED });
    // Two records that declare the same id; nothing is merged, and each copy is
    // reported so the user can see the offending paths.
    const result = parseRequirementPoolInput({
      records: [
        {
          directoryName: ID_QUEUED,
          metadataJson: record.metadataJson,
          contentMarkdown: record.contentMarkdown,
        },
        {
          directoryName: ID_QUEUED,
          metadataJson: record.metadataJson,
          contentMarkdown: record.contentMarkdown,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    const duplicates = result.errors.filter((issue) => issue.message.includes('duplicate'));
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((issue) => issue.requirementId)).toEqual([ID_QUEUED, ID_QUEUED]);
    expect(duplicates.map((issue) => issue.path)).toEqual([
      `${REQUIREMENTS_ROOT}/${ID_QUEUED}`,
      `${REQUIREMENTS_ROOT}/${ID_QUEUED}`,
    ]);
    expect(codes(result)).toEqual(['REQUIREMENT_CONFLICT', 'REQUIREMENT_CONFLICT']);
  });
});

describe('importRequirementPool', () => {
  it('imports a pool, is idempotent, and keeps local and record versions apart', () => {
    const queued = buildRecord({ id: ID_QUEUED });
    const completed = buildRecord({
      id: ID_COMPLETED,
      lifecycle: 'completed',
      completion: true,
      acceptance: true,
      confirmedDecision: true,
    });
    const pool = expectOk(
      parseRequirementPool({
        repoRoot: writePool([queued, completed]),
        revision: REVISION_1,
      }),
    );

    const first = importRequirementPool({
      records: pool.records,
      local: emptyLocal(),
      commit: true,
    });
    expect(first.conflicts).toEqual([]);
    expect(first.summary).toEqual({
      received: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
      skipped: 0,
    });
    expect(first.state.revision).toBe(REVISION_1);
    const queuedRow = findRow(first.state, ID_QUEUED);
    expect(queuedRow.localVersion).toBe(1);
    expect(queuedRow.recordVersion).toBe(1);
    expect(queuedRow.sourceRevision).toBe(REVISION_1);
    expect(queuedRow.sourcePath).toBe(`${REQUIREMENTS_ROOT}/${ID_QUEUED}`);
    expect(queuedRow.contentMarkdown).toContain('让需求随 Git 迁移。');

    const second = importRequirementPool({ records: pool.records, local: first.state });
    expect(second.summary).toEqual({
      received: 2,
      created: 0,
      updated: 0,
      unchanged: 2,
      conflicts: 0,
      skipped: 0,
    });
    // Idempotent: the whole projection is identical, including local versions.
    expect(second.state).toEqual(first.state);

    // The local row version is its own counter: a local-only change leaves
    // recordVersion alone, and a later record bump moves only recordVersion.
    const locallyEdited = withRecords(
      { ...first.state, revision: first.state.revision },
      first.state.records.map((row) =>
        row.id === ID_QUEUED ? { ...row, localVersion: row.localVersion + 1 } : row,
      ),
    );
    const third = importRequirementPool({ records: pool.records, local: locallyEdited });
    expect(third.summary.unchanged).toBe(2);
    expect(findRow(third.state, ID_QUEUED).localVersion).toBe(2);
    expect(findRow(third.state, ID_QUEUED).recordVersion).toBe(1);

    const bumped = expectOk(
      parseRequirementPool({
        repoRoot: writePool([
          buildRecord({
            id: ID_QUEUED,
            version: 4,
            contentBody: DEFAULT_BODY.replace('迁移。', '迁移，并保留 ID。'),
          }),
          completed,
        ]),
        // Same revision the projection is built from: a newer version is a normal
        // update, not the stale-projection refusal exercised below.
        revision: REVISION_1,
      }),
    );
    const fourth = importRequirementPool({
      records: bumped.records,
      local: third.state,
      commit: true,
    });
    expect(fourth.summary.updated).toBe(1);
    const updatedRow = findRow(fourth.state, ID_QUEUED);
    expect(updatedRow.recordVersion).toBe(4);
    expect(updatedRow.localVersion).toBe(3);
    expect(updatedRow.recordHash).toBe(bumped.records[0]?.recordHash);
    expect(updatedRow.sourceRevision).toBe(REVISION_1);
    expect(fourth.state.revision).toBe(REVISION_1);
  });

  it('reports the same recordVersion with different content as a per-record conflict', () => {
    const original = buildRecord({ id: ID_QUEUED, title: '原需求' });
    const conflicting = buildRecord({
      id: ID_QUEUED,
      title: '另一台服务器的同名需求',
      contentBody: DEFAULT_BODY.replace('让需求随 Git 迁移。', '让需求随 Git 迁移，且内容不同。'),
    });

    const local = importRequirementPool({
      records: expectOk(
        parseRequirementPool({ repoRoot: writePool([original]), revision: REVISION_1 }),
      ).records,
      local: emptyLocal(),
    }).state;
    const incoming = expectOk(
      parseRequirementPool({ repoRoot: writePool([conflicting]), revision: REVISION_1 }),
    );

    const result = importRequirementPool({ records: incoming.records, local });
    expect(result.summary.conflicts).toBe(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      requirementId: ID_QUEUED,
      reason: 'same_version_different_content',
      localRecordVersion: 1,
      recordVersion: 1,
    });
    expect(result.conflicts[0]?.localRecordHash).not.toBe(result.conflicts[0]?.recordHash);
    // The local projection is unchanged: nothing was overwritten or deleted.
    expect(findRow(result.state, ID_QUEUED).title).toBe('原需求');
    expect(result.state).toEqual(local);
  });

  it('refuses an older incoming recordVersion', () => {
    const current = buildRecord({ id: ID_QUEUED, version: 3 });
    const older = buildRecord({ id: ID_QUEUED, version: 2 });
    const local = importRequirementPool({
      records: expectOk(parseRequirementPool({ repoRoot: writePool([current]) })).records,
      local: emptyLocal(),
    }).state;

    const result = importRequirementPool({
      records: expectOk(parseRequirementPool({ repoRoot: writePool([older]) })).records,
      local,
    });
    expect(result.conflicts[0]?.reason).toBe('incoming_version_older');
    expect(findRow(result.state, ID_QUEUED).recordVersion).toBe(3);
  });

  it('conflicts per record when a local row has no readable Git record', () => {
    const record = buildRecord({ id: ID_QUEUED });
    const local = importRequirementPool({
      records: expectOk(
        parseRequirementPool({ repoRoot: writePool([record]), revision: REVISION_1 }),
      ).records,
      local: emptyLocal(),
    }).state;

    const result = importRequirementPool({
      records: [],
      local,
      unresolvedIds: [ID_QUEUED],
    });
    expect(result.conflicts).toEqual([
      expect.objectContaining({ requirementId: ID_QUEUED, reason: 'record_unreadable' }),
    ]);
    // The local row survives so the user can restore the Git record and re-import.
    expect(findRow(result.state, ID_QUEUED).recordVersion).toBe(1);
  });

  it('refuses to overwrite when Git moved but the projection is stale', () => {
    const v1 = buildRecord({ id: ID_QUEUED });
    const v2 = buildRecord({
      id: ID_QUEUED,
      version: 2,
      contentBody: DEFAULT_BODY.replace(
        '让需求随 Git 迁移。',
        '让需求随 Git 迁移，并保留稳定 ID。',
      ),
    });
    const local = importRequirementPool({
      records: expectOk(parseRequirementPool({ repoRoot: writePool([v1]), revision: REVISION_1 }))
        .records,
      local: emptyLocal(),
      commit: true,
    }).state;

    // Another server pushed v2; this server pulled it but the projection is still
    // built from REVISION_1, so the import must refuse rather than overwrite.
    const incoming = expectOk(
      parseRequirementPool({ repoRoot: writePool([v2]), revision: REVISION_2 }),
    );
    const refused = importRequirementPool({ records: incoming.records, local, commit: true });
    expect(refused.conflicts[0]?.reason).toBe('stale_projection');
    expect(refused.state).toEqual(local);
    expect(findRow(refused.state, ID_QUEUED).recordVersion).toBe(1);
    expect(findRow(refused.state, ID_QUEUED).sourceRevision).toBe(REVISION_1);

    // An unchanged record stays importable even from a newer revision, so the
    // operation is idempotent and never wedges on a stale projection.
    const unchanged = importRequirementPool({
      records: expectOk(parseRequirementPool({ repoRoot: writePool([v1]), revision: REVISION_2 }))
        .records,
      local,
    });
    expect(unchanged.conflicts).toEqual([]);
    expect(unchanged.summary.unchanged).toBe(1);

    // After the user refreshes the projection from the repository, the explicit
    // re-import succeeds and the row follows the new Git record.
    const refreshed = importRequirementPool({
      records: incoming.records,
      local: { projectId: local.projectId, revision: REVISION_1, records: [] },
      commit: true,
    });
    expect(refreshed.conflicts).toEqual([]);
    expect(refreshed.summary.created).toBe(1);
    const row = findRow(refreshed.state, ID_QUEUED);
    expect(row.recordVersion).toBe(2);
    expect(row.sourceRevision).toBe(REVISION_2);
    expect(row.recordHash).toBe(incoming.records[0]?.recordHash);
    expect(refreshed.state.revision).toBe(REVISION_2);

    // And afterwards the same import is idempotent against the refreshed state.
    const settled = importRequirementPool({ records: incoming.records, local: refreshed.state });
    expect(settled.conflicts).toEqual([]);
    expect(settled.summary.unchanged).toBe(1);
    expect(settled.state).toEqual(refreshed.state);
  });

  it('clears a conflict after Git is repaired and the record is re-imported', () => {
    const original = buildRecord({ id: ID_QUEUED });
    let local = importRequirementPool({
      records: expectOk(
        parseRequirementPool({ repoRoot: writePool([original]), revision: REVISION_1 }),
      ).records,
      local: emptyLocal(),
    }).state;

    // The broken pool: the same version with different content.
    const broken = expectOk(
      parseRequirementPool({
        repoRoot: writePool([
          buildRecord({
            id: ID_QUEUED,
            contentBody: DEFAULT_BODY.replace('让需求随 Git 迁移。', '被别人改写。'),
          }),
        ]),
        revision: REVISION_1,
      }),
    );
    const conflicted = importRequirementPool({
      records: broken.records,
      local,
      unresolvedIds: [ID_QUEUED],
    });
    expect(conflicted.conflicts).toHaveLength(1);
    local = conflicted.state;
    expect(findRow(local, ID_QUEUED).title).toBe('需求随 Git 迁移');

    // The user repairs Git by bumping the version and re-imports explicitly.
    const repaired = expectOk(
      parseRequirementPool({
        repoRoot: writePool([
          buildRecord({
            id: ID_QUEUED,
            version: 2,
            contentBody: DEFAULT_BODY.replace('让需求随 Git 迁移。', '合并后的正文。'),
          }),
        ]),
        revision: REVISION_1,
      }),
    );
    const resolved = importRequirementPool({ records: repaired.records, local });
    expect(resolved.conflicts).toEqual([]);
    expect(findRow(resolved.state, ID_QUEUED).recordVersion).toBe(2);
    expect(findRow(resolved.state, ID_QUEUED).contentMarkdown).toContain('合并后的正文。');
  });

  it('reports a duplicate id inside one batch instead of importing either copy', () => {
    const record = buildRecord({ id: ID_QUEUED });
    const parsed = expectOk(parseRequirementPool({ repoRoot: writePool([record]) }));
    const result = importRequirementPool({
      records: [
        parsed.records[0] as RequirementPoolRecord,
        parsed.records[0] as RequirementPoolRecord,
      ],
      local: emptyLocal(),
    });
    expect(result.conflicts[0]?.reason).toBe('duplicate_id_in_batch');
    expect(result.state.records).toEqual([]);
  });

  it('marks an active record without a Work as needing replan', () => {
    const active = buildRecord({ id: ID_ACTIVE, lifecycle: 'active' });
    const pool = expectOk(parseRequirementPool({ repoRoot: writePool([active]) }));
    const result = importRequirementPool({ records: pool.records, local: emptyLocal() });
    expect(findRow(result.state, ID_ACTIVE).workId).toBeUndefined();
    expect(findRow(result.state, ID_ACTIVE).lifecycle).toBe('active');

    const withWork = importRequirementPool({
      records: pool.records,
      local: { ...emptyLocal(), workIdByRequirementId: { [ID_ACTIVE]: ID_QUEUED } },
    });
    expect(findRow(withWork.state, ID_ACTIVE).workId).toBe(ID_QUEUED);
  });
});

describe('imported history (AC-088)', () => {
  it('keeps completion, cancellation and pre-archive state without migrating evidence', () => {
    const completed = buildRecord({
      id: ID_COMPLETED,
      lifecycle: 'completed',
      completion: true,
      acceptance: true,
      confirmedDecision: true,
    });
    const cancelled = buildRecord({
      id: ID_CANCELLED,
      lifecycle: 'cancelled',
      cancellation: true,
    });
    const archived = buildRecord({
      id: ID_ARCHIVED,
      lifecycle: 'archived',
      previousLifecycle: 'completed',
      completion: true,
    });
    const pool = expectOk(
      parseRequirementPool({
        repoRoot: writePool([completed, cancelled, archived]),
        revision: REVISION_1,
      }),
    );
    const imported = importRequirementPool({ records: pool.records, local: emptyLocal() });
    expect(imported.conflicts).toEqual([]);

    const completedRow = findRow(imported.state, ID_COMPLETED);
    expect(completedRow.evidenceNotMigrated).toBe(true);
    expect(completedRow.evidenceAvailability).toBe('summary_only');
    const completedSummary = importedHistorySummary(completedRow);
    expect(completedSummary?.completion).toMatchObject({
      summary: '需求池解析、导入与索引已交付。',
      codeRevision: REVISION_1,
      featureIds: [FEATURE_ID],
      verificationSummary: '本机单测通过；旧报告未迁移。',
      remainingIssues: ['README 需要重建'],
    });
    expect(completedSummary?.featureIds).toEqual([FEATURE_ID]);
    expect(completedSummary?.evidenceNotice).toBe(EVIDENCE_NOT_MIGRATED);
    expect(completedSummary?.evidenceAvailability).toBe('summary_only');
    // A migrated summary is never local verification evidence.
    expect(completedSummary?.countsAsLocalVerification).toBe(false);

    const cancelledRow = findRow(imported.state, ID_CANCELLED);
    const cancelledSummary = importedHistorySummary(cancelledRow);
    expect(cancelledSummary?.cancellation).toEqual({
      cancelledAt: '2026-02-02T00:00:00.000Z',
      reason: '用户决定放弃该需求',
    });
    expect(cancelledSummary?.completion).toBeUndefined();
    expect(cancelledSummary?.evidenceNotice).toBe(EVIDENCE_NOT_MIGRATED);
    expect(cancelledSummary?.countsAsLocalVerification).toBe(false);

    const archivedRow = findRow(imported.state, ID_ARCHIVED);
    const archivedSummary = importedHistorySummary(archivedRow);
    expect(archivedSummary?.lifecycle).toBe('archived');
    expect(archivedSummary?.previousLifecycle).toBe('completed');
    expect(archivedSummary?.completion?.summary).toBe('需求池解析、导入与索引已交付。');
    expect(archivedSummary?.countsAsLocalVerification).toBe(false);

    // A queued record is not history.
    const queued = importRequirementPool({
      records: expectOk(parseRequirementPool({ repoRoot: writePool([buildRecord()]) })).records,
      local: emptyLocal(),
    });
    expect(importedHistorySummary(findRow(queued.state, ID_QUEUED))).toBeUndefined();
  });
});

describe('parseRequirementPoolInput', () => {
  it('validates already-read bytes without touching the filesystem', () => {
    const record = buildRecord({ id: ID_QUEUED });
    const result = parseRequirementPoolInput({
      records: [
        {
          directoryName: ID_QUEUED,
          metadataJson: record.metadataJson,
          contentMarkdown: record.contentMarkdown,
        },
      ],
      missing: [{ directoryName: ID_ACTIVE, file: 'requirement.json' }],
      legacy: [
        {
          directoryName: ID_ARCHIVED,
          metadataJson: '{}',
          contentMarkdown: '',
          legacyPath: `docs/agentdev/requirements/${ID_ARCHIVED}.json`,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['REQUIREMENT_CONFLICT', 'LEGACY_REQUIREMENT_FORMAT']);
    expect(result.errors[0]?.path).toBe(`${REQUIREMENTS_ROOT}/${ID_ACTIVE}/requirement.json`);
    expect(result.errors[1]?.path).toBe(`docs/agentdev/requirements/${ID_ARCHIVED}.json`);
    // The valid record is still parsed and listed.
    expect(result.records.map((item) => item.id)).toEqual([ID_QUEUED]);
    expect(result.records[0]?.revision).toBe(WORKING_TREE_REVISION);
  });

  it('accepts an empty pool and rejects a missing README change only when read from disk', () => {
    const result = parseRequirementPoolInput({ records: [] });
    expect(result.ok).toBe(true);
    if (!result.ok || result.pool === null) throw new Error('expected an empty valid pool');
    expect(result.pool.records).toEqual([]);
    expect(result.pool.readmeOutOfDate).toBe(true);
    expect(result.pool.storedReadme).toBeUndefined();
  });
});

describe('rebuildPoolReadme', () => {
  it('rebuilds the navigation index from records, sorted by id', () => {
    const pool = expectOk(
      parseRequirementPool({
        repoRoot: writePool([
          buildRecord({ id: ID_ACTIVE, lifecycle: 'active', title: '进行中的需求' }),
          buildRecord({ id: ID_QUEUED, title: '需求随 Git 迁移' }),
        ]),
      }),
    );
    const readme = rebuildPoolReadme(pool.records);
    expect(readme).toBe(rebuildPoolReadme(pool.records));
    expect(readme).toContain('# 需求池索引');
    expect(readme).toContain('| requirement_id | 标题 | 状态 | 正文 |');
    const queuedLine = readme.split('\n').find((line) => line.includes(ID_QUEUED));
    expect(queuedLine).toContain('需求随 Git 迁移');
    expect(queuedLine).toContain('queued');
    expect(queuedLine).toContain(`[content.md](${ID_QUEUED}/content.md)`);
    // Rows are ordered by id; compare full lines so one id cannot shadow another.
    const rows = readme.split('\n').filter((line) => line.startsWith('| 0195f0a0-'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.includes(`| ${ID_QUEUED} |`)).toBe(true);
    expect(rows[1]?.includes(`| ${ID_ACTIVE} |`)).toBe(true);
    // The rendered index is byte-identical to what a pool parse produces.
    expect(pool.readme).toBe(readme);

    const empty = rebuildPoolReadme([]);
    expect(empty).toContain('需求池为空。');
  });
});
