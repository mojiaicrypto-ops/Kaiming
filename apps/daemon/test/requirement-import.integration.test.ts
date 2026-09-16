/**
 * WP-12 T5.4 integration: the first-open requirement-pool import.
 *
 * A repository is committed on the `agentdev/main` delivery branch, then **really
 * cloned** with `git` into a second installation whose SQLite is empty; the project is
 * opened and the committed pool appears. Every requirement row in these assertions comes
 * from `RequirementProjection.import` reading a record out of Git, and no Run starts.
 * `store.requirements.insert` must not appear in this file.
 *
 * **What this test does not prove** (WP-12 clone-portability round): the pool records
 * are written here with `node:fs` (`writeRecord`/`makeSourceRepository`), so the
 * *producer* side — the documented save path that commits a record to the delivery
 * branch — is not exercised. It proves the clone → open → per-record import half
 * (all five lifecycles, a broken record, an absent pool). The no-seed drill that
 * produces the pool through the real protocol commands and then clones it is
 * `requirement-portability-drill.integration.test.ts`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DELIVERY_BRANCH,
  git,
  startInstallation,
  type Installation,
} from './requirement-clone-helpers.js';

const FEATURE_ID = 'F-1a2b3c4d';

const IDS = {
  queued: '0195f0a0-0000-7000-8000-000000000001',
  active: '0195f0a0-0000-7000-8000-000000000002',
  completed: '0195f0a0-0000-7000-8000-000000000003',
  cancelled: '0195f0a0-0000-7000-8000-000000000004',
  archived: '0195f0a0-0000-7000-8000-000000000005',
} as const;

type Lifecycle = 'queued' | 'active' | 'completed' | 'cancelled' | 'archived';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The documented six level-2 headings (`requirements.md` §6). */
function contentOf(title: string, version: number): string {
  return [
    `<!-- record-version: ${String(version)} -->`,
    `# ${title}`,
    '',
    '## 目标与背景',
    '需求随 Git 迁移。',
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
}

/** Writes one portable record the way the real save path commits it. */
function writeRecord(root: string, id: string, lifecycle: Lifecycle, title: string): string {
  const contentMarkdown = contentOf(title, 1);
  const contentHash = sha256Hex(contentMarkdown);
  const metadata: Record<string, unknown> = {
    schemaVersion: 1,
    id,
    version: 1,
    contentFile: 'content.md',
    contentHash,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    title,
    goal: '任何服务器 Clone 后都能读取需求池',
    scope: { readPaths: ['packages'], writePaths: [], operations: [], networkTargets: [] },
    lifecycle,
    featureIds: [FEATURE_ID],
    acceptance: [],
    openQuestions: [],
    confirmedDecisions: [],
    relatedRequirementIds: [],
  };
  // An archived record carries its pre-archive state (`requirements.md` §6), so the
  // completion facts travel with it.
  if (lifecycle === 'completed' || lifecycle === 'archived') {
    metadata['completion'] = {
      completedAt: '2026-02-01T00:00:00.000Z',
      summary: '需求池解析、导入与索引已交付。',
      codeRevision: '1'.repeat(40),
      codeTree: 'c'.repeat(64),
      featureIds: [FEATURE_ID],
      verificationSummary: '本机单测通过；旧报告未迁移。',
      remainingIssues: ['README 需要重建'],
    };
  }
  if (lifecycle === 'cancelled') {
    metadata['cancellation'] = {
      cancelledAt: '2026-02-02T00:00:00.000Z',
      reason: '用户决定放弃该需求',
    };
  }
  if (lifecycle === 'archived') metadata['previousLifecycle'] = 'completed';
  const directory = join(root, '.agentdev', 'requirements', id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'requirement.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(directory, 'content.md'), contentMarkdown);
  return contentMarkdown;
}

/** A real repository whose delivery branch carries five records. */
function makeSourceRepository(root: string, options: { omitContentFor?: string } = {}): string {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const one = 1;\n');
  writeFileSync(join(root, 'README.md'), '# pool source\n');
  for (const [lifecycle, id] of Object.entries(IDS) as [Lifecycle, string][]) {
    writeRecord(root, id, lifecycle, `${lifecycle} requirement`);
  }
  writeFileSync(join(root, '.agentdev', 'requirements', 'README.md'), '# 需求池索引\n');
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'pool']);
  // The delivery branch is where the pool lives for an imported project.
  git(root, ['branch', DELIVERY_BRANCH]);
  if (options.omitContentFor !== undefined) {
    // The break has to be on the *delivery* branch: that is the revision the import
    // reads, so a break on `main` would be invisible to it.
    git(root, ['checkout', DELIVERY_BRANCH]);
    rmSync(join(root, '.agentdev', 'requirements', options.omitContentFor, 'content.md'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'break one record']);
    git(root, ['checkout', 'main']);
  }
  return root;
}

describe('first-open requirement import from the delivery revision (WP-12 T5.4)', () => {
  let harness: Installation;
  let source: string;
  const temporaries: string[] = [];

  beforeEach(() => {
    harness = startInstallation();
    const base = mkdtempSync(join(tmpdir(), 'agentdev-t5-pool-'));
    temporaries.push(base);
    source = makeSourceRepository(join(base, 'source'));
  });

  afterEach(() => {
    harness.close();
    while (temporaries.length > 0) {
      const dir = temporaries.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores every lifecycle from a real clone with an empty database (AC-087/AC-088/AC-089)', async () => {
    // A second installation clones the repository with real `git`.
    const cloneBase = mkdtempSync(join(tmpdir(), 'agentdev-t5-clone-'));
    temporaries.push(cloneBase);
    const cloneRoot = join(cloneBase, 'clone');
    git(cloneBase, ['clone', '--no-tags', '--', source, cloneRoot]);
    // The pool lives on the delivery branch; a bare clone only has the remote ref, so
    // the import's `origin/agentdev/main` rule is what must find it.
    expect(git(cloneRoot, ['branch', '--list', DELIVERY_BRANCH]).trim()).toBe('');
    expect(git(cloneRoot, ['branch', '-r', '--list', `origin/${DELIVERY_BRANCH}`]).trim()).not.toBe(
      '',
    );

    const entry = await harness.directory.open(cloneRoot, { trust: true });
    const handle = harness.directory.handleOf(entry.projectId ?? '');
    expect(handle).toBeDefined();
    const store = handle?.assembled.store;
    expect(store?.requirements.count()).toBe(5);

    // No Run was started and no Work was created: imported history is not new work.
    expect(store?.runs.count()).toBe(0);

    const rows = store?.requirements.list() ?? [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const lifecycle of Object.keys(IDS) as Lifecycle[]) {
      expect(byId.get(IDS[lifecycle])?.lifecycle).toBe(lifecycle);
    }
    // An imported `active` record waits to continue instead of executing (`AC-089`).
    const active = byId.get(IDS.active);
    expect(active?.executionAvailability).toBe('needs_replan');
    expect(active?.workId).toBeUndefined();
    // Evidence that was not migrated is reported honestly (`AC-088`).
    expect(active?.evidenceAvailability).toBe('summary_only');

    // The import summary is visible on the project, exactly as the snapshot reports it.
    const fact = harness.directory.entryOf(entry.projectId ?? '')?.import;
    expect(fact?.source).toBe('origin-branch');
    expect(fact?.imported).toBe(5);
    expect(fact?.conflicts).toBe(0);
    expect(fact?.revision).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('keeps valid records visible next to a broken one and reports the conflict (AC-092 surface)', async () => {
    const brokenBase = mkdtempSync(join(tmpdir(), 'agentdev-t5-broken-'));
    temporaries.push(brokenBase);
    const brokenSource = makeSourceRepository(join(brokenBase, 'source'), {
      omitContentFor: IDS.completed,
    });
    const cloneRoot = join(brokenBase, 'clone');
    git(brokenBase, ['clone', '--no-tags', '--', brokenSource, cloneRoot]);

    const entry = await harness.directory.open(cloneRoot, { trust: true });
    const handle = harness.directory.handleOf(entry.projectId ?? '');
    const store = handle?.assembled.store;
    // Four good records are imported; the fifth is reported, never fabricated.
    expect(store?.requirements.count()).toBe(4);
    expect(store?.requirements.find(IDS.completed)).toBeUndefined();
    const fact = harness.directory.entryOf(entry.projectId ?? '')?.import;
    expect(fact?.imported).toBe(4);
    expect(fact?.conflicts).toBeGreaterThan(0);
    expect(fact?.writeBlocked).toBe(true);
  });

  it('does not invent a requirement when the delivery branch has no pool', async () => {
    const bareBase = mkdtempSync(join(tmpdir(), 'agentdev-t5-nopool-'));
    temporaries.push(bareBase);
    const bare = join(bareBase, 'bare');
    mkdirSync(join(bare, 'src'), { recursive: true });
    writeFileSync(join(bare, 'src', 'index.ts'), 'export const one = 1;\n');
    git(bare, ['init', '-b', 'main']);
    git(bare, ['add', '.']);
    git(bare, ['commit', '-m', 'no pool']);
    const cloneRoot = join(bareBase, 'clone');
    git(bareBase, ['clone', '--no-tags', '--', bare, cloneRoot]);

    const entry = await harness.directory.open(cloneRoot, { trust: true });
    const handle = harness.directory.handleOf(entry.projectId ?? '');
    expect(handle?.assembled.store.requirements.count()).toBe(0);
    expect(harness.directory.entryOf(entry.projectId ?? '')?.import?.imported).toBe(0);
    expect(existsSync(join(cloneRoot, '.agentdev'))).toBe(false);
  });
});
