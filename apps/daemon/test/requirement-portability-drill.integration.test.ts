/**
 * WP-12 clone-portability drill: the requirement pool produced by the **real save
 * path**, committed to the delivery branch, cloned into a second installation with an
 * empty database, and continued (AC-087/AC-088/AC-089).
 *
 * ## Why this file exists
 *
 * The previous application-level evidence for AC-087/088/089 read either a
 * `seedRequirement(...)` row inserted straight into SQLite or a pool whose
 * `requirement.json`/`content.md` files the test wrote with `node:fs`. Both prove the
 * *reader*; neither proves that the documented product path can produce the artifact
 * that travels. This drill closes that gap end to end:
 *
 * 1. **Installation A** opens a real Git repository whose delivery branch has no pool.
 *    Every record is then produced through the real daemon protocol over real Git: the
 *    documented `requirement.create` / `requirement.save` / `requirement.update` /
 *    `requirement.start` / `requirement.archive` commands and the documented queued
 *    cancel (`work.control`). `RequirementSaveService` writes each record in a throw-away
 *    worktree and moves `refs/heads/agentdev/main` by CAS, so this file never writes a
 *    pool file and never inserts a requirement row.
 * 2. One record reaches the terminal `completed` lifecycle through the documented
 *    completion write entrance (`requirement.save` with `lifecycle:'completed'` plus the
 *    `completion` fact — the same entrance the Settlement path uses, `protocol.md` §8).
 *    It is produced at the **Core `RequirementSaveService` layer**; the fact that a real
 *    model-driven delivery would normally supply the completion fact is stated in the
 *    record (`clone-portability.md`), not hidden.
 * 3. The records are cloned with real `git` into **installation B**, whose project
 *    database starts empty.
 * 4. B opens the clone: `ProjectDirectory` runs the first-open import from
 *    `origin/agentdev/main`, the projection is rebuilt per record, and the drill asserts
 *    the imported states, the preserved portable fields, the honest
 *    `evidenceAvailability='summary_only'` and the `needs_replan` continuation state.
 * 5. The imported `active` record is continued through `requirement.continue`: a new
 *    local Work and user authorization appear, every Gate is unmet, and **no Run was
 *    started** by importing or by continuing.
 *
 * `store.requirements.insert` and `seedRequirement` must not appear in this file.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRequirementPoolAtRevision, userIdFromSubject } from '@agentdev/core';
import type { JsonObject } from '@agentdev/contracts';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';

import type { WorkbenchProtocol } from '../src/protocol.js';
import {
  DELIVERY_BRANCH,
  git,
  startInstallation,
  type Installation,
} from './requirement-clone-helpers.js';

const NOW = '2026-09-20T12:00:00.000Z';
const FEATURE_ID = 'F-1a2b3c4d';
const OTHER_FEATURE_ID = 'F-5e6f7a8b';

/** The one caller a single-user installation resolves every session to. */
const CALLER = {
  subject: 'user:drill',
  userId: userIdFromSubject('installation:local'),
  role: 'chief' as const,
};

type Json = JsonObject;

/** Dispatches one real protocol method and returns its JSON-safe answer. */
function call(
  protocol: WorkbenchProtocol,
  method: string,
  params: Json = {},
  options: { readonly idempotencyKey?: string } = {},
): Json {
  return JSON.parse(
    JSON.stringify(
      protocol.dispatch(method, params, {
        caller: CALLER,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      }),
    ),
  ) as Json;
}

/** The six documented level-2 headings (`requirements.md` §6). */
function body(title: string, completion = '无'): string {
  return [
    `# ${title}`,
    '',
    '## 目标与背景',
    `${title}：需求事实随 Git 迁移，不随数据库或运行环境迁移。`,
    '',
    '## 范围与行为',
    '只保存需求事实；不迁移执行现场、授权与模型配置。',
    '',
    '## 验收说明',
    'Clone 后列表、状态与历史可读；导入不启动 Run。',
    '',
    '## 已确认决定',
    '无',
    '',
    '## 未决问题',
    '无',
    '',
    '## 完成摘要',
    completion,
    '',
  ].join('\n');
}

/** A real repository whose checked-out `main` is not the delivery branch. */
function makeRepository(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const one = 1;\n');
  writeFileSync(join(root, 'README.md'), '# clone portability source\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.agentdev/work/\n');
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'seed']);
  // The durable pool lives on the delivery branch; the developer's checkout stays on
  // `main`, exactly as a real project does.
  git(root, ['branch', DELIVERY_BRANCH]);
}

describe('requirement-pool portability drill — real save path to a real clone (AC-087/AC-088/AC-089)', () => {
  let installationA: Installation;
  let installationB: Installation;
  const temporaries: string[] = [];

  beforeEach(() => {
    installationA = startInstallation();
    installationB = startInstallation();
  });

  afterEach(() => {
    installationA.close();
    installationB.close();
    while (temporaries.length > 0) {
      const dir = temporaries.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('produces every lifecycle through the protocol, clones the delivery branch, and continues the active record', async () => {
    const base = mkdtempSync(join(tmpdir(), 'agentdev-clone-portability-'));
    temporaries.push(base);
    const source = join(base, 'source');
    makeRepository(source);
    const seedRevision = git(source, ['rev-parse', 'main']).trim();

    // ---- Installation A: the pool is produced by the documented commands ---------
    const entryA = await installationA.directory.open(source, { trust: true });
    const handleA = installationA.directory.handleOf(entryA.projectId ?? '');
    expect(handleA).toBeDefined();
    if (handleA === undefined) throw new Error('installation A did not assemble');
    const protocolA = handleA.assembled.protocol;
    const storeA = handleA.assembled.store;
    // A's first open finds an empty pool: nothing was seeded for it either.
    expect(installationA.directory.entryOf(entryA.projectId ?? '')?.import?.imported).toBe(0);

    let sequence = 0;
    const create = (title: string, goal = `${title} 的目标`, content = body(title)): string => {
      sequence += 1;
      const created = call(
        protocolA,
        'requirement.create',
        {
          title,
          goal,
          scope: { readPaths: ['src'], writePaths: [], operations: ['read'], networkTargets: [] },
          contentMarkdown: content,
        },
        { idempotencyKey: `drill-create-${String(sequence)}` },
      );
      expect(typeof created['requirementId'], JSON.stringify(created)).toBe('string');
      return created['requirementId'] as string;
    };

    // (1) A queued requirement carrying the full portable metadata surface.
    const queuedId = create(
      '队列需求：需求池索引重建',
      '任何服务器 Clone 后都能读取需求池',
      body('队列需求：需求池索引重建'),
    );
    const updated = call(
      protocolA,
      'requirement.update',
      {
        requirementId: queuedId,
        patch: {
          acceptance: [
            {
              id: 'ACC-POOL-1',
              given: '空白服务器只 Clone 了项目',
              when: '可信打开项目',
              then: '需求列表、目标、范围与未决项可读',
            },
          ],
          openQuestions: ['README 索引是否需要随每次保存重建？'],
          confirmedDecisions: [
            {
              id: 'DEC-POOL-1',
              summary: '需求事实只写 .agentdev/requirements/<id>/',
              decidedAt: NOW,
              sourceKind: 'user_message',
            },
          ],
          featureIds: [FEATURE_ID],
        },
      },
      { idempotencyKey: 'drill-update-queued' },
    );
    expect(updated['status']).toBe('accepted');

    // (2) A completed requirement through the documented completion write entrance.
    //     The completion fact is supplied at the Core save layer, where a real
    //     Settlement would supply it after the acceptance Gates passed. `codeRevision`
    //     is the real seeded commit; `codeTree` is its SHA-256 (the documented
    //     `codeTree` field is a 64-hex tree hash, not Git's 40-hex tree OID).
    const completedId = create('已完成需求：需求池解析与导入', '交付可移植需求池');
    call(
      protocolA,
      'requirement.save',
      { requirementId: completedId, patch: { lifecycle: 'active' } },
      { idempotencyKey: 'drill-activate-completed' },
    );
    const codeRevision = git(source, ['rev-parse', 'HEAD']).trim();
    const codeTree = createHash('sha256').update(codeRevision).digest('hex');
    const completionSummary = '需求池解析、导入、投影与索引已交付。';
    const completedContent = body('已完成需求：需求池解析与导入', completionSummary);
    const completed = call(
      protocolA,
      'requirement.save',
      {
        requirementId: completedId,
        patch: {
          contentMarkdown: completedContent,
          lifecycle: 'completed',
          completion: {
            completedAt: NOW,
            summary: completionSummary,
            codeRevision,
            codeTree,
            featureIds: [OTHER_FEATURE_ID],
            verificationSummary: '本机单测与集成演练通过；旧报告未迁移。',
            remainingIssues: ['README 需要重建'],
          },
        },
      },
      { idempotencyKey: 'drill-complete' },
    );
    expect(completed['status']).toBe('applied');

    // (3) A cancelled requirement keeps its file as history (queued → cancelled).
    const cancelledId = create('已取消需求：不再需要');
    const cancelled = call(
      protocolA,
      'work.control',
      { action: 'cancel', requirementId: cancelledId, reason: '用户决定放弃该需求' },
      { idempotencyKey: 'drill-cancel' },
    );
    expect(cancelled['status']).toBe('accepted');

    // (4) An archived requirement preserves its pre-archive state.
    const archivedId = create('已归档需求：保留历史');
    const archived = call(
      protocolA,
      'requirement.archive',
      { requirementId: archivedId },
      { idempotencyKey: 'drill-archive' },
    );
    expect(archived['lifecycle']).toBe('archived');

    // (5) A genuinely in-progress requirement: `requirement.start` commits `active` to
    //     Git and creates the local Work, but starts no Run.
    const activeId = create('进行中需求：继续复核');
    const started = call(
      protocolA,
      'requirement.start',
      {
        requirementId: activeId,
        budget: { tokenLimit: 20_000, timeLimit: 600, repairLimit: 1 },
      },
      { idempotencyKey: 'drill-start' },
    );
    expect(started['status']).toBe('accepted');
    expect(storeA.requirements.find(activeId)?.lifecycle).toBe('active');

    // The producer side is the documented protocol, not a filesystem seed: the
    // checkout is still `main` at its seed commit, while the pool is a fact of the
    // delivery branch's commit. (`RequirementSaveService` also refreshes the working
    // copy so the on-disk directory does not lag the branch; a clone takes only the
    // commit, which is why B must resolve `origin/agentdev/main`.)
    expect(git(source, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
    expect(git(source, ['rev-parse', 'main']).trim()).toBe(seedRevision);

    const deliveryRevision = git(source, ['rev-parse', `refs/heads/${DELIVERY_BRANCH}`]).trim();
    expect(deliveryRevision).toMatch(/^[0-9a-f]{40}$/u);
    // The committed metadata really carries the portable fields, read with real Git.
    expect(
      git(source, [
        'cat-file',
        '-p',
        `${deliveryRevision}:.agentdev/requirements/${queuedId}/requirement.json`,
      ]),
    ).toContain('ACC-POOL-1');
    // A has five records in its projection and no Run (start plans; it does not execute).
    expect(storeA.requirements.count()).toBe(5);
    expect(storeA.runs.count()).toBe(0);

    // The delivery branch really carries the pool the save committed.
    const gitPort = createNodeWorktreeGitPort();
    const atDelivery = readRequirementPoolAtRevision({
      git: gitPort,
      repoRoot: source,
      revision: deliveryRevision,
    });
    expect(atDelivery.conflicts).toEqual([]);
    expect(atDelivery.records.map((record) => record.id).sort()).toEqual(
      [queuedId, completedId, cancelledId, archivedId, activeId].sort(),
    );

    // ---- Installation B: a real clone into an empty database ---------------------
    const cloneBase = mkdtempSync(join(tmpdir(), 'agentdev-clone-'));
    temporaries.push(cloneBase);
    const cloneRoot = join(cloneBase, 'clone');
    git(cloneBase, ['clone', '--no-tags', '--', source, cloneRoot]);
    // A fresh clone has only the remote-tracking delivery ref: the import's
    // `origin/agentdev/main` rule is what must find the pool.
    expect(git(cloneRoot, ['branch', '--list', DELIVERY_BRANCH]).trim()).toBe('');
    expect(git(cloneRoot, ['branch', '-r', '--list', `origin/${DELIVERY_BRANCH}`]).trim()).not.toBe(
      '',
    );

    const entryB = await installationB.directory.open(cloneRoot, { trust: true });
    const handleB = installationB.directory.handleOf(entryB.projectId ?? '');
    expect(handleB).toBeDefined();
    if (handleB === undefined) throw new Error('installation B did not assemble');
    const protocolB = handleB.assembled.protocol;
    const storeB = handleB.assembled.store;

    const fact = installationB.directory.entryOf(entryB.projectId ?? '')?.import;
    expect(fact?.source).toBe('origin-branch');
    expect(fact?.revision).toBe(deliveryRevision);
    expect(fact?.imported).toBe(5);
    expect(fact?.conflicts).toBe(0);
    expect(fact?.writeBlocked).toBe(false);

    // The projection is rebuilt from Git: no seeded row, no imported Work, no Run.
    expect(storeB.requirements.count()).toBe(5);
    expect(storeB.works.count()).toBe(0);
    expect(storeB.runs.count()).toBe(0);

    for (const [id, lifecycle] of [
      [queuedId, 'queued'],
      [completedId, 'completed'],
      [cancelledId, 'cancelled'],
      [archivedId, 'archived'],
      [activeId, 'active'],
    ] as const) {
      expect(storeB.requirements.find(id)?.lifecycle).toBe(lifecycle);
      // Nothing was migrated except the Git fact (`requirements.md` §5).
      expect(storeB.requirements.find(id)?.evidenceAvailability).toBe('summary_only');
    }

    // ---- AC-087: identity, goal, scope, acceptance, decisions, questions survive ---
    const clonePool = readRequirementPoolAtRevision({
      git: gitPort,
      repoRoot: cloneRoot,
      revision: fact?.revision ?? deliveryRevision,
    });
    expect(clonePool.conflicts).toEqual([]);
    const metadataOf = (id: string): Record<string, unknown> => {
      const record = clonePool.records.find((candidate) => candidate.id === id);
      if (record === undefined) throw new Error(`record ${id} missing from the clone`);
      return JSON.parse(record.metadataJson) as Record<string, unknown>;
    };
    const queuedMetadata = metadataOf(queuedId);
    expect(queuedMetadata['goal']).toBe('任何服务器 Clone 后都能读取需求池');
    expect(queuedMetadata['scope']).toEqual({
      readPaths: ['src'],
      writePaths: [],
      operations: ['read'],
      networkTargets: [],
    });
    expect(queuedMetadata['acceptance']).toEqual([
      {
        id: 'ACC-POOL-1',
        given: '空白服务器只 Clone 了项目',
        when: '可信打开项目',
        then: '需求列表、目标、范围与未决项可读',
      },
    ]);
    expect(queuedMetadata['openQuestions']).toEqual(['README 索引是否需要随每次保存重建？']);
    expect(queuedMetadata['confirmedDecisions']).toEqual([
      {
        id: 'DEC-POOL-1',
        summary: '需求事实只写 .agentdev/requirements/<id>/',
        decidedAt: NOW,
        sourceKind: 'user_message',
      },
    ]);
    expect(queuedMetadata['featureIds']).toEqual([FEATURE_ID]);

    // The product read surface answers from the clone: the list is metadata-only and
    // the detail returns the committed body.
    const listed = call(protocolB, 'requirement.list', {});
    const items = listed['items'] as Json[];
    expect(items).toHaveLength(5);
    const listedQueued = items.find((item) => item['id'] === queuedId);
    expect(listedQueued?.['goal']).toBe('任何服务器 Clone 后都能读取需求池');
    expect(listedQueued?.['contentMarkdown']).toBeUndefined();
    const detail = call(protocolB, 'requirement.get', { requirementId: queuedId });
    expect(detail['contentMarkdown']).toContain('需求事实随 Git 迁移');

    // ---- AC-088: completed/cancelled/archived history is visible and honest --------
    const completedMetadata = metadataOf(completedId);
    expect(completedMetadata['completion']).toMatchObject({
      summary: completionSummary,
      codeRevision,
      codeTree,
      featureIds: [OTHER_FEATURE_ID],
    });
    expect(metadataOf(cancelledId)['cancellation']).toMatchObject({
      reason: '用户决定放弃该需求',
    });
    expect(metadataOf(archivedId)['previousLifecycle']).toBe('queued');

    const completedDetail = call(protocolB, 'requirement.get', { requirementId: completedId });
    expect(completedDetail['lifecycle']).toBe('completed');
    expect(completedDetail['contentMarkdown']).toContain(completionSummary);
    expect(completedDetail['evidenceAvailability']).toBe('summary_only');
    // The board shows all five lifecycle states on the clone.
    const boardB = call(protocolB, 'board', {});
    const columns = boardB['columns'] as Record<string, Json[]>;
    expect(columns['queued']?.map((card) => card['requirementId'])).toContain(queuedId);
    expect(columns['completed']?.map((card) => card['requirementId'])).toContain(completedId);
    expect(columns['archived']?.map((card) => card['requirementId'])).toContain(archivedId);
    expect(columns['archived']?.map((card) => card['requirementId'])).toContain(cancelledId);
    expect(columns['active']?.map((card) => card['requirementId'])).toContain(activeId);

    // ---- AC-089: the in-progress record waits; importing starts nothing -----------
    const importedActive = storeB.requirements.find(activeId);
    expect(importedActive?.executionAvailability).toBe('needs_replan');
    expect(importedActive?.workId).toBeUndefined();
    const activeCard = columns['active']?.find((card) => card['requirementId'] === activeId);
    expect(activeCard?.['executionAvailability']).toBe('needs_replan');
    // The detail surface labels it "待继续" without inventing a Work or a Run.
    const activeDetail = call(protocolB, 'requirement.get', { requirementId: activeId });
    expect(activeDetail['waitingToContinue']).toBe(true);
    expect(activeDetail['work']).toBeNull();
    expect(activeDetail['executionAvailability']).toBe('needs_replan');
    expect(storeB.runs.count()).toBe(0);

    // Continuing creates the new local Work and user authorization; every Gate is
    // unmet because the previous server's verification is not local evidence.
    const continued = call(
      protocolB,
      'requirement.continue',
      { requirementId: activeId, goal: '继续导入的进行中需求' },
      { idempotencyKey: 'drill-continue' },
    );
    expect(continued['status']).toBe('applied');
    expect(continued['reusedPreviousVerification']).toBe(false);
    expect(continued['firstGate']).toBe('product');
    expect(continued['requiresReplan']).toBe(true);
    const unmetGates = continued['unmetGates'] as Json[];
    expect(unmetGates.length).toBeGreaterThan(0);
    expect(unmetGates.every((gate) => gate['code'] === 'GATE_NOT_READY')).toBe(true);
    const workId = continued['workId'] as string;
    expect(workId).toBeTruthy();
    expect(storeB.works.find(workId)?.status).toBe('queued');
    expect(storeB.works.find(workId)?.requirementId).toBe(activeId);
    expect(storeB.authorizations.list({ where: 'work_id = ?', params: [workId] })).toHaveLength(1);
    expect(storeB.requirements.find(activeId)?.workId).toBe(workId);
    expect(storeB.requirements.find(activeId)?.executionAvailability).toBe('local');
    expect(storeB.requirements.find(activeId)?.phase).toBe('product');
    // Continuing plans and re-verifies; it never starts a Run by itself.
    expect(storeB.runs.count()).toBe(0);
  });
});
