/**
 * Unit tests for the requirement save contract (`AC-090`, `AC-091`, `AC-093`).
 *
 * These cover the pure half of `packages/core/src/requirement-save.ts`: the two
 * files of a record and their combined hash, the body structure the pool reader
 * validates, the rebuilt README, the two-file completion summary, and the
 * completion/settlement consistency check that keeps a metadata-only change from
 * being presented as code verification. The Git/SQLite half lives in
 * `requirement-save.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  requirementMetadataSchema,
  type PortableRequirement,
  type Requirement,
  type RequirementMetadata,
} from '@agentdev/contracts';
import {
  normalizeContentMarkdown,
  requirementRecordHash,
  REQUIREMENTS_README,
  REQUIREMENTS_ROOT,
  sha256Hex,
} from '@agentdev/knowledge';
import {
  checkCompletionSettlement,
  contentSection,
  contentVersionMarker,
  isRequirementMetadataPath,
  prepareRequirementSave,
  readContentVersionMarker,
  requirementPoolCommits,
  requirementPoolReadme,
  validateRequirementContent,
  integrationLockResource,
  ProjectIntegrationLock,
  type RequirementMetadataDraft,
  type RequirementPoolRevisionRecord,
} from '../src/index.js';

const TIME = '2026-09-11T00:00:00.000Z';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const OTHER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';

const emptyScope = { readPaths: [], writePaths: [], operations: ['edit'], networkTargets: [] };

/** A body with the six documented level-2 headings (`requirements.md` §6). */
function body(overrides: Partial<Record<string, string>> = {}, completion = '待明确'): string {
  const sections: readonly (readonly [string, string])[] = [
    ['目标与背景', overrides['目标与背景'] ?? '让未付款订单可取消。'],
    ['范围与行为', overrides['范围与行为'] ?? '仅订单模块。'],
    ['验收说明', overrides['验收说明'] ?? 'AC-090：保存后 Git 立即包含需求。'],
    ['已确认决定', overrides['已确认决定'] ?? '无'],
    ['未决问题', overrides['未决问题'] ?? '无'],
    ['完成摘要', overrides['完成摘要'] ?? completion],
  ];
  return sections.map(([heading, text]) => `## ${heading}\n\n${text}\n`).join('\n');
}

function draft(overrides: Record<string, unknown> = {}): RequirementMetadataDraft {
  return {
    schemaVersion: 1,
    id: REQUIREMENT_ID,
    version: 1,
    contentFile: 'content.md',
    createdAt: TIME,
    updatedAt: TIME,
    title: '未付款订单可取消',
    goal: 'deliver the requirement pool',
    scope: emptyScope,
    lifecycle: 'queued',
    featureIds: [],
    acceptance: [{ id: 'AC-090', given: 'g', when: 'w', then: 't' }],
    openQuestions: [],
    confirmedDecisions: [],
    relatedRequirementIds: [],
    ...overrides,
  } as RequirementMetadataDraft;
}

/** A projected row as the store would hold it, for the monotonicity checks. */
function projectedRow(record: PortableRequirement): Requirement {
  return {
    id: record.id,
    projectId: 'a'.repeat(32),
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
    title: record.title,
    goal: record.goal,
    lifecycle: record.lifecycle,
    sourceRef: { kind: 'git', id: record.id, version: 'working-tree' },
    recordVersion: record.version,
    portableRef: {
      path: `${REQUIREMENTS_ROOT}/${record.id}`,
      revision: 'r1',
      hash: 'f'.repeat(64),
    },
    executionAvailability: 'needs_replan',
    evidenceAvailability: 'summary_only',
  };
}

describe('prepareRequirementSave (AC-093)', () => {
  it('builds both files with one version and the documented combined record hash', () => {
    const prepared = prepareRequirementSave({
      metadata: draft(),
      contentMarkdown: body(),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);

    expect(prepared.metadataPath).toBe(`${REQUIREMENTS_ROOT}/${REQUIREMENT_ID}/requirement.json`);
    expect(prepared.contentPath).toBe(`${REQUIREMENTS_ROOT}/${REQUIREMENT_ID}/content.md`);
    expect(prepared.directoryPath).toBe(`${REQUIREMENTS_ROOT}/${REQUIREMENT_ID}`);

    // Both files share the version, and the body mirrors it in its marker.
    const parsed = JSON.parse(prepared.metadataJson) as RequirementMetadata;
    expect(parsed.version).toBe(1);
    expect(readContentVersionMarker(prepared.contentMarkdown)).toBe(1);

    // requirement.json is exactly what was committed, and `contentHash` describes
    // the committed bytes.
    expect(prepared.metadataHash).toBe(sha256Hex(prepared.metadataJson));
    expect(prepared.contentHash).toBe(sha256Hex(prepared.contentMarkdown));
    expect(parsed.contentHash).toBe(prepared.contentHash);
    // The combined hash is the documented formula, not a hash of one file.
    expect(prepared.recordHash).toBe(
      requirementRecordHash(prepared.metadataHash, prepared.contentHash),
    );
    expect(prepared.recordHash).not.toBe(prepared.metadataHash);
    expect(prepared.record).toMatchObject({ id: REQUIREMENT_ID, version: 1 });
    expect(prepared.record.contentMarkdown).toBe(prepared.contentMarkdown);
  });

  it('changes the combined record hash when the body changes', () => {
    const first = prepareRequirementSave({
      metadata: draft({ version: 1 }),
      contentMarkdown: body(),
    });
    const second = prepareRequirementSave({
      metadata: draft({ version: 2 }),
      contentMarkdown: body({ 目标与背景: '改后的背景说明。' }),
    });
    if (!first.ok || !second.ok) throw new Error('preparation must succeed');
    expect(second.recordHash).not.toBe(first.recordHash);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(second.metadataHash).not.toBe(first.metadataHash);
    // The version really is the one both files carry.
    expect(readContentVersionMarker(second.contentMarkdown)).toBe(2);
  });

  it('normalizes CRLF to LF before hashing so the same text hashes the same', () => {
    const lf = prepareRequirementSave({ metadata: draft(), contentMarkdown: body() });
    const crlf = prepareRequirementSave({
      metadata: draft(),
      contentMarkdown: body().replace(/\n/gu, '\r\n'),
    });
    if (!lf.ok || !crlf.ok) throw new Error('preparation must succeed');
    expect(crlf.contentHash).toBe(lf.contentHash);
    expect(crlf.recordHash).toBe(lf.recordHash);
    expect(crlf.contentMarkdown.includes('\r')).toBe(false);
    expect(normalizeContentMarkdown('a\r\nb')).toBe('a\nb');
  });

  it('refuses a body that does not have the six documented headings', () => {
    const missing = prepareRequirementSave({
      metadata: draft(),
      contentMarkdown: '# 目标与背景\n\n只有一级标题。\n',
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('expected a refusal');
    expect(missing.code).toBe('VALIDATION_ERROR');
    expect(missing.issues.join(' ')).toContain('目标与背景');

    const empty = prepareRequirementSave({ metadata: draft(), contentMarkdown: '   \n' });
    expect(empty.ok).toBe(false);

    const duplicated = prepareRequirementSave({
      metadata: draft(),
      contentMarkdown: `${body()}\n## 目标与背景\n\n再来一次。\n`,
    });
    expect(duplicated.ok).toBe(false);
    if (duplicated.ok) throw new Error('expected a refusal');
    expect(duplicated.issues.join(' ')).toContain('repeats');

    const reordered = prepareRequirementSave({
      metadata: draft(),
      contentMarkdown: [
        '## 完成摘要',
        '',
        '无',
        '',
        '## 目标与背景',
        '',
        'x',
        '',
        '## 范围与行为',
        '',
        'x',
        '',
        '## 验收说明',
        '',
        'x',
        '',
        '## 已确认决定',
        '',
        'x',
        '',
        '## 未决问题',
        '',
        'x',
        '',
      ].join('\n'),
    });
    expect(reordered.ok).toBe(false);
  });

  it('refuses metadata that violates the RequirementMetadata contract', () => {
    const prepared = prepareRequirementSave({
      metadata: draft({ title: '' }),
      contentMarkdown: body(),
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) throw new Error('expected a refusal');
    expect(prepared.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a non-increasing recordVersion', () => {
    const first = prepareRequirementSave({ metadata: draft(), contentMarkdown: body() });
    if (!first.ok) throw new Error(first.message);
    const stale = prepareRequirementSave({
      metadata: draft({ version: 1 }),
      contentMarkdown: body(),
      previous: projectedRow(first.record),
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('expected a refusal');
    expect(stale.code).toBe('REQUIREMENT_CONFLICT');

    const next = prepareRequirementSave({
      metadata: draft({ version: 2 }),
      contentMarkdown: body(),
      previous: projectedRow(first.record),
    });
    expect(next.ok).toBe(true);
  });

  it('validates the body structurally without interpreting prose', () => {
    expect(validateRequirementContent(body())).toEqual([]);
    expect(contentSection(body(), '未决问题')).toBe('无');
    expect(contentSection(body(), '不存在的标题')).toBe('');
  });

  it('produces metadata that its own schema accepts', () => {
    const prepared = prepareRequirementSave({ metadata: draft(), contentMarkdown: body() });
    if (!prepared.ok) throw new Error(prepared.message);
    const { contentMarkdown, ...metadata } = prepared.record;
    expect(contentMarkdown.startsWith(contentVersionMarker(1))).toBe(true);
    expect(requirementMetadataSchema.safeParse(metadata).success).toBe(true);
  });
});

describe('pool records and README (AC-093)', () => {
  function revisionRecord(
    id: string,
    version: number,
    title: string,
  ): RequirementPoolRevisionRecord {
    const prepared = prepareRequirementSave({
      metadata: draft({ id, version, title }),
      contentMarkdown: body(),
    });
    if (!prepared.ok) throw new Error(prepared.message);
    return {
      id,
      recordPath: prepared.directoryPath,
      metadataPath: prepared.metadataPath,
      contentPath: prepared.contentPath,
      metadataJson: prepared.metadataJson,
      contentMarkdown: prepared.contentMarkdown,
      metadataHash: prepared.metadataHash,
      contentHash: prepared.contentHash,
      recordHash: prepared.recordHash,
      version,
    };
  }

  it('rebuilds the README from the records and commits both files of each', () => {
    const records = [
      revisionRecord(REQUIREMENT_ID, 1, '未付款订单可取消'),
      revisionRecord(OTHER_ID, 2, '第二条需求'),
    ];
    const readme = requirementPoolReadme(records);
    expect(readme).toContain('需求池索引');
    expect(readme).toContain(REQUIREMENT_ID);
    expect(readme).toContain('未付款订单可取消');
    expect(readme).toContain(`${OTHER_ID}/${'content.md'}`);

    const commits = requirementPoolCommits(records);
    expect(commits).toHaveLength(2);
    for (const commit of commits) {
      // Both files travel together, with one version and one record hash.
      expect(commit.metadataPath).toBe(`${commit.recordPath}/requirement.json`);
      expect(commit.contentPath).toBe(`${commit.recordPath}/content.md`);
      expect(commit.readmePath).toBe(REQUIREMENTS_README);
      expect(commit.recordHash).toHaveLength(64);
    }
    expect(commits[0]?.version).toBe(1);
    expect(commits[1]?.version).toBe(2);
  });

  it('sorts the index by id so a rebuild is deterministic', () => {
    const readme = requirementPoolReadme([
      revisionRecord(OTHER_ID, 1, 'b'),
      revisionRecord(REQUIREMENT_ID, 1, 'a'),
    ]);
    expect(readme.indexOf(REQUIREMENT_ID)).toBeLessThan(readme.indexOf(OTHER_ID));
  });
});

describe('completion/settlement consistency (AC-091)', () => {
  const work = { id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70', level: 'L2' as const };
  const finalRevision = 'b'.repeat(40);
  const finalTree = 'c'.repeat(40);
  const completion = {
    completedAt: TIME,
    summary: '交付完成',
    codeRevision: finalRevision,
    codeTree: finalTree,
    featureIds: [],
    verificationSummary: 'Review+Test 通过',
    remainingIssues: [],
  };
  const settlement = { finalRevision, codeTree: finalTree, updatedDocs: [], unresolved: [] };
  const manifest = {
    id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71',
    workId: work.id,
    kind: 'integration' as const,
    codeRevision: finalRevision,
    codeTree: finalTree,
    acceptanceIds: ['AC-091'],
    valid: true,
  };

  it('accepts a completion record that binds the Settlement revision, tree and manifests', () => {
    const result = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.metadataOnly).toBe(false);
    expect(result.codeChanged).toBe(true);
    expect(result.verifiedManifestIds).toEqual([manifest.id]);
    expect(result.verifiedTree).toBe(finalTree);
  });

  it('refuses a completion record whose code revision is not the final revision', () => {
    const result = checkCompletionSettlement({
      work,
      route: 'code',
      completion: { ...completion, codeRevision: 'd'.repeat(40) },
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.code).toBe('STALE_ARTIFACT');
    expect(result.reasons.join(' ')).toContain('codeRevision');
  });

  it('refuses a Settlement that verified a different code tree', () => {
    const result = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement: { ...settlement, codeTree: 'e'.repeat(40) },
      verifiedManifests: [manifest],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reasons.join(' ')).toContain('codeTree');
  });

  it('refuses a manifest that invalidated or verified another tree', () => {
    const invalidated = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [{ ...manifest, valid: false }],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(invalidated.ok).toBe(false);

    const otherTree = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [{ ...manifest, codeTree: 'f'.repeat(40) }],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(otherTree.ok).toBe(false);
    if (otherTree.ok) throw new Error('expected a refusal');
    expect(otherTree.reasons.join(' ')).toContain('不是最终');
  });

  it('refuses to present a metadata-only change as code verification', () => {
    const result = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      changedPaths: [
        { path: `${REQUIREMENTS_ROOT}/${REQUIREMENT_ID}/requirement.json`, change: 'modified' },
        { path: `${REQUIREMENTS_ROOT}/${REQUIREMENT_ID}/content.md`, change: 'modified' },
        { path: REQUIREMENTS_README, change: 'modified' },
      ],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.metadataOnly).toBe(true);
    expect(result.code).toBe('GATE_NOT_READY');
    expect(result.message).toContain('需求池文件');
    expect(isRequirementMetadataPath(`${REQUIREMENTS_ROOT}/x/content.md`)).toBe(true);
    expect(isRequirementMetadataPath('src/orders.ts')).toBe(false);
  });

  it('requires a completion summary at all', () => {
    const result = checkCompletionSettlement({
      work,
      route: 'code',
      completion: null,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.code).toBe('MISSING_CONTEXT');
  });

  it('refuses an empty change set as code verification (W8R1-07)', () => {
    const result = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      // Zero paths: nothing the Manifests could have verified.
      changedPaths: [],
      codeStartRevision: 'a'.repeat(40),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.code).toBe('GATE_NOT_READY');
    expect(result.message).toContain('变更集为空');
    expect(result.metadataOnly).toBe(false);
  });

  it('refuses a revision range that starts at the final revision (W8R1-07)', () => {
    const sameRange = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      // `codeStartRevision === finalRevision` makes the diff empty by construction.
      codeStartRevision: finalRevision,
    });
    expect(sameRange.ok).toBe(false);
    if (sameRange.ok) throw new Error('expected a refusal');
    expect(sameRange.code).toBe('GATE_NOT_READY');
    expect(sameRange.message).toContain('codeStartRevision');

    const unknownRange = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: null,
    });
    expect(unknownRange.ok).toBe(false);
    if (unknownRange.ok) throw new Error('expected a refusal');
    expect(unknownRange.code).toBe('GATE_NOT_READY');
  });

  it('reports the range it verified on success (W8R1-07)', () => {
    const start = 'a'.repeat(40);
    const result = checkCompletionSettlement({
      work,
      route: 'code',
      completion,
      finalRevision,
      finalTree,
      settlement,
      verifiedManifests: [manifest],
      changedPaths: [{ path: 'src/orders.ts', change: 'modified' }],
      codeStartRevision: start,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.codeChanged).toBe(true);
    expect(result.codeStartRevision).toBe(start);
  });
});

describe('Project integration lock (AC-091)', () => {
  function lockFixture(): {
    /** The resource the fixture's leases are stored under. */
    readonly resource: string;
    readonly resources: string[];
    acquire(input: {
      readonly ownerAttemptId: string;
      readonly epoch: number;
      readonly ttlMs?: number;
      readonly at?: string;
    }): ReturnType<ProjectIntegrationLock['acquire']>;
    release(ownerAttemptId: string, epoch: number): boolean;
    releaseAll(): void;
  } {
    const holders = new Map<string, { owner: string; epoch: number; expiresAt: string }>();
    const resources: string[] = [];
    const leases = {
      acquire(input: {
        readonly resource: string;
        readonly ownerAttemptId: string;
        readonly epoch: number;
        readonly expiresAt: string;
        readonly at?: string;
      }) {
        resources.push(input.resource);
        const existing = holders.get(input.resource);
        const at = input.at ?? TIME;
        if (existing !== undefined) {
          const expired = Date.parse(existing.expiresAt) <= Date.parse(at);
          const sameOwner = existing.owner === input.ownerAttemptId;
          if (!expired && !sameOwner) {
            return {
              acquired: false as const,
              heldBy: { ...existing, ownerAttemptId: existing.owner },
            };
          }
        }
        holders.set(input.resource, {
          owner: input.ownerAttemptId,
          epoch: input.epoch,
          expiresAt: input.expiresAt,
        });
        return {
          acquired: true as const,
          replacedExpired: existing !== undefined,
          lease: {
            ownerAttemptId: input.ownerAttemptId,
            epoch: input.epoch,
            expiresAt: input.expiresAt,
          },
        };
      },
      release(resource: string, ownerAttemptId: string): boolean {
        const existing = holders.get(resource);
        if (existing === undefined || existing.owner !== ownerAttemptId) return false;
        holders.delete(resource);
        return true;
      },
    };
    // The lock instance stays inside the fixture: every exposed member is a plain
    // function, so a test can never call one detached from its receiver.
    const instance = new ProjectIntegrationLock({
      projectId: 'a'.repeat(32),
      leases,
      now: () => TIME,
    });
    const take = (input: {
      readonly ownerAttemptId: string;
      readonly epoch: number;
      readonly ttlMs?: number;
      readonly at?: string;
    }): ReturnType<ProjectIntegrationLock['acquire']> => instance.acquire(input);
    const drop = (ownerAttemptId: string, epoch: number): boolean =>
      instance.release(ownerAttemptId, epoch);
    return {
      resource: instance.resource,
      resources,
      acquire: take,
      release: drop,
      releaseAll: () => holders.clear(),
    };
  }

  it('names the one resource requirement saves and code delivery share', () => {
    expect(integrationLockResource('a'.repeat(32))).toBe(`integration:${'a'.repeat(32)}`);
  });

  it('refuses a second writer while the lock is held, and frees it for a retry', () => {
    const fixture = lockFixture();
    const first = fixture.acquire({ ownerAttemptId: 'save-1', epoch: 1 });
    expect(first.acquired).toBe(true);
    expect(fixture.resources.every((entry) => entry === fixture.resource)).toBe(true);

    const second = fixture.acquire({ ownerAttemptId: 'delivery-1', epoch: 2 });
    expect(second.acquired).toBe(false);
    if (second.acquired) throw new Error('expected BUSY');
    expect(second.code).toBe('BUSY');
    expect(second.heldBy.ownerAttemptId).toBe('save-1');

    expect(fixture.release('save-1', 1)).toBe(true);
    expect(fixture.acquire({ ownerAttemptId: 'delivery-1', epoch: 2 }).acquired).toBe(true);
    fixture.releaseAll();
  });

  it('replaces an expired lock so a crashed save can be retried', () => {
    const fixture = lockFixture();
    expect(
      fixture.acquire({ ownerAttemptId: 'save-1', epoch: 1, at: TIME, ttlMs: 1 }).acquired,
    ).toBe(true);
    const retry = fixture.acquire({
      ownerAttemptId: 'save-1-retry',
      epoch: 2,
      at: '2026-09-11T00:00:01.000Z',
    });
    expect(retry.acquired).toBe(true);
    if (!retry.acquired) throw new Error('expected the expired lock to be replaced');
    expect(retry.replacedExpired).toBe(true);
  });
});
