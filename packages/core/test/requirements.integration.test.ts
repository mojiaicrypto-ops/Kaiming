import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectStore as Store,
  projectIdFromRoot,
  sha256,
  type ProjectStore,
} from '@agentdev/storage';
import {
  RequirementProjection,
  RequirementRecordError,
  metadataHashOf,
  recordHashOf,
} from '../src/index.js';

/**
 * Requirement import (AC-092 partial, `requirements.md` §4): the same record
 * imports idempotently, a newer recordVersion refreshes the projection, and the
 * same recordVersion with different content is a conflict that changes no row.
 */
const ROOT = '/tmp/agentdev-requirements-root';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const TIME = '2026-09-11T00:00:00.000Z';

let dataDir: string;
let store: ProjectStore;
let projectId: string;
let projection: RequirementProjection;

const emptyScope = { readPaths: [], writePaths: [], operations: [], networkTargets: [] };

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const contentMarkdown =
    (overrides['contentMarkdown'] as string | undefined) ?? '# 目标与背景\n做一件事\n';
  return {
    schemaVersion: 1,
    id: REQUIREMENT_ID,
    version: 1,
    contentFile: 'content.md',
    contentHash: sha256(contentMarkdown),
    createdAt: TIME,
    updatedAt: TIME,
    title: 'Ship WP-01',
    goal: 'deliver the storage core',
    scope: emptyScope,
    lifecycle: 'queued',
    featureIds: [],
    acceptance: [],
    openQuestions: [],
    confirmedDecisions: [],
    relatedRequirementIds: [],
    contentMarkdown,
    ...overrides,
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-req-'));
  store = Store.open({
    dataDir,
    canonicalRoot: ROOT,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  projectId = projectIdFromRoot(ROOT);
  store.projects.insert({
    id: projectId,
    root: ROOT,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
  });
  projection = new RequirementProjection({ store });
});

afterEach(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('requirement projection', () => {
  it('creates a local row and reports a needs_replan record without a Work', () => {
    const outcome = projection.import({ record: record({ lifecycle: 'active' }) });
    expect(outcome.verdict).toBe('new');
    if (outcome.verdict === 'conflict') throw new Error('unexpected conflict');
    expect(outcome.recordVersion).toBe(1);
    expect(outcome.row).toMatchObject({
      id: REQUIREMENT_ID,
      recordVersion: 1,
      lifecycle: 'active',
      executionAvailability: 'needs_replan',
    });
    // The record hash is the conflict key and lives in portableRef.hash.
    expect(outcome.row?.portableRef.hash).toBe(outcome.recordHash);
    // The projection points at the requirement *directory*, not the JSON file.
    expect(outcome.row?.portableRef.path).toBe(`.agentdev/requirements/${REQUIREMENT_ID}`);
    expect(outcome.row?.sourceRef).toMatchObject({
      kind: 'git',
      id: REQUIREMENT_ID,
      path: `.agentdev/requirements/${REQUIREMENT_ID}`,
      hash: outcome.recordHash,
    });
    expect(store.projects.find(projectId)).toBeDefined();
    expect(store.events.latestForEntity(REQUIREMENT_ID)?.name).toBe('requirement.imported');
  });

  it('binds local execution when the Project has a Work', () => {
    const outcome = projection.import({
      record: record({ lifecycle: 'active' }),
      workId: WORK_ID,
      recordCommitted: true,
    });
    if (outcome.verdict === 'conflict') throw new Error('unexpected conflict');
    expect(outcome.row).toMatchObject({ workId: WORK_ID, executionAvailability: 'local' });
  });

  it('imports the same record twice without a second write', () => {
    const first = projection.import({ record: record() });
    const cursors = store.events.latestCursor();
    const second = projection.import({ record: record() });
    expect(second.verdict).toBe('unchanged');
    if (first.verdict === 'conflict' || second.verdict === 'conflict') {
      throw new Error('unexpected conflict');
    }
    expect(second.recordHash).toBe(first.recordHash);
    expect(second.row?.version).toBe(1);
    expect(projection.list()).toHaveLength(1);
    expect(store.events.latestCursor()).toBe(cursors);
  });

  it('refreshes the projection when the record version advances', () => {
    const first = projection.import({ record: record() });
    if (first.verdict === 'conflict') throw new Error('unexpected conflict');
    const outcome = projection.import({
      record: record({
        version: 2,
        title: 'Ship WP-01 and WP-02',
        contentMarkdown: '# 目标与背景\n下一版\n',
      }),
    });
    expect(outcome.verdict).toBe('update');
    if (outcome.verdict === 'conflict') throw new Error('unexpected conflict');
    expect(outcome.row).toMatchObject({
      title: 'Ship WP-01 and WP-02',
      recordVersion: 2,
      version: 2,
    });
    expect(outcome.recordHash).not.toBe(first.recordHash);
    expect(store.events.latestForEntity(REQUIREMENT_ID)?.name).toBe('requirement.imported');
  });

  it('refuses the same recordVersion with different content', () => {
    projection.import({ record: record() });
    const outcome = projection.import({
      record: record({ contentMarkdown: '# 目标与背景\n被本地篡改\n' }),
    });
    expect(outcome.verdict).toBe('conflict');
    if (outcome.verdict !== 'conflict') throw new Error('expected a conflict');
    expect(outcome.conflict).toMatchObject({
      requirementId: REQUIREMENT_ID,
      localRecordVersion: 1,
      incomingRecordVersion: 1,
      reason: 'same recordVersion with different content',
    });
    // Nothing was written except the diagnostic event.
    const row = store.requirements.get(REQUIREMENT_ID);
    expect(row.version).toBe(1);
    expect(row.title).toBe('Ship WP-01');
    const latest = store.events.latestForEntity(REQUIREMENT_ID);
    expect(latest?.name).toBe('requirement.save_failed');
    expect(latest?.data).toMatchObject({ reason: 'REQUIREMENT_CONFLICT', recordVersion: 1 });
  });

  it('treats an older recordVersion as a conflict, not a downgrade', () => {
    projection.import({ record: record({ version: 3 }) });
    const outcome = projection.import({ record: record({ version: 2 }) });
    expect(outcome.verdict).toBe('conflict');
    if (outcome.verdict !== 'conflict') throw new Error('expected a conflict');
    expect(outcome.conflict.reason).toBe(
      'incoming recordVersion is older than the local projection',
    );
    expect(store.requirements.get(REQUIREMENT_ID).recordVersion).toBe(3);
  });

  it('rejects a malformed record before touching the database', () => {
    expect(() => projection.import({ record: record({ lifecycle: 'completed' }) })).toThrowError(
      RequirementRecordError,
    );
    expect(() => projection.import({ record: { id: 'nope' } })).toThrowError(
      /invalid requirement record/,
    );
    expect(store.requirements.list()).toEqual([]);
    expect(store.events.latestCursor()).toBe(0);
  });

  it('hashes the exact requirement.json bytes when the caller supplies them', () => {
    const raw = '{\n  "schemaVersion": 1,\n  "id": "' + REQUIREMENT_ID + '"\n}';
    const outcome = projection.import({ record: record(), rawMetadata: raw });
    if (outcome.verdict === 'conflict') throw new Error('unexpected conflict');
    expect(outcome.recordHash).toBe(recordHashOf(record() as never, raw));
    expect(outcome.recordHash).not.toBe(recordHashOf(record() as never));
    expect(metadataHashOf(record() as never, raw)).toBe(sha256(raw));
    expect(outcome.row?.portableRef.hash).toBe(outcome.recordHash);
  });

  it('writes the row and its event in one transaction', () => {
    // A failing event append must leave no projection behind: the caller sees the
    // failure and the row is absent, so a retry imports cleanly.
    const failing = new RequirementProjection({
      store: {
        ...store,
        events: {
          append: () => {
            throw new Error('event log unavailable');
          },
        },
      } as unknown as ProjectStore,
    });
    expect(() => failing.import({ record: record() })).toThrowError('event log unavailable');
    expect(store.requirements.find(REQUIREMENT_ID)).toBeUndefined();
    expect(projection.import({ record: record() }).verdict).toBe('new');
  });

  it('hashes metadata separately from the body', () => {
    const metadata = record();
    const { contentMarkdown, ...rest } = metadata as { contentMarkdown: string };
    void contentMarkdown;
    const parsed = record();
    const hashA = metadataHashOf(rest as never);
    const hashB = recordHashOf({ ...parsed, contentMarkdown: 'other' } as never);
    const hashC = recordHashOf(parsed as never);
    expect(hashA).toHaveLength(64);
    expect(hashB).toBe(hashC); // contentHash is explicit, not derived from the body
    expect(metadataHashOf({ ...rest, title: 'changed' } as never)).not.toBe(hashA);
  });
});
