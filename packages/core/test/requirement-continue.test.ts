import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PortableRequirement, Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { RequirementContinuation, RequirementProjection } from '../src/index.js';

/**
 * AC-089: an `active` Requirement that exists in Git with no local Work is
 * "waiting to continue".
 *
 * The record is written through the real `RequirementProjection`, so its
 * `needs_replan` availability is the projection's own output rather than a
 * hand-set field. Listing must not start a Run, and continuing must create the new
 * Work with a local authorization while treating the old server's verification as
 * a Git summary that no Gate may reuse.
 */
const ROOT = '/tmp/agentdev-requirement-continue-root';
const IMPORTED_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f01';
const QUEUED_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f02';
const LOCAL_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f03';
const EXISTING_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f10';
const ACTION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f20';
const UNKNOWN_ACTION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f21';
const USER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4f30';
const REVISION = 'a'.repeat(40);
const CONTENT_HASH = 'd'.repeat(64);
const HASH = 'e'.repeat(64);
const PATH = 'packages/core/src/requirement-continue.ts';
const AT = '2026-09-11T00:10:00.000Z';

const SCOPE: Scope = {
  readPaths: [],
  writePaths: [PATH],
  operations: ['read', 'edit'],
  networkTargets: [],
};

const CONTENT = [
  '# imported requirement',
  '',
  '## 目标与背景',
  '继续一个从 Git 导入的进行中需求。',
  '## 范围与行为',
  '重新规划并重新验证。',
  '## 验收说明',
  'AC-089。',
  '## 已确认决定',
  '无',
  '## 未决问题',
  '无',
  '## 完成摘要',
  '无',
  '',
].join('\n');

function portable(
  id: string,
  lifecycle: 'active' | 'queued',
  overrides: Partial<PortableRequirement> = {},
): PortableRequirement {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    contentFile: 'content.md',
    contentHash: CONTENT_HASH,
    createdAt: AT,
    updatedAt: AT,
    title: 'Keep the imported requirement going',
    goal: 'resume the imported requirement',
    scope: SCOPE,
    lifecycle,
    featureIds: [],
    acceptance: [
      { id: 'AC-089', given: 'a Git record', when: 'the user continues', then: 'a Work' },
    ],
    openQuestions: [],
    confirmedDecisions: [],
    relatedRequirementIds: [],
    contentMarkdown: CONTENT,
    ...overrides,
  };
}

describe('Requirement continuation (AC-089)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let projectId: string;
  let projection: RequirementProjection;
  let service: RequirementContinuation;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-req-continue-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'packages',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    projection = new RequirementProjection({ store });
    service = new RequirementContinuation({ store });

    // A Requirement that exists in Git as `active` and has no local Work.
    const imported = projection.import({
      record: portable(IMPORTED_ID, 'active'),
      portableRef: { path: `.agentdev/requirements/${IMPORTED_ID}`, revision: REVISION },
    });
    if (imported.verdict !== 'new') throw new Error('the fixture import failed');
    expect(imported.row?.executionAvailability).toBe('needs_replan');
    expect(imported.row?.workId).toBeUndefined();
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists an imported active Requirement as waiting to continue without starting a Run (AC-089)', () => {
    const cursorBefore = store.events.latestCursor();
    const listed = service.listContinuable();
    const cursorAfter = store.events.latestCursor();

    expect(listed.items).toHaveLength(1);
    const item = listed.items[0];
    if (item === undefined) throw new Error('unreachable');
    expect(item.requirementId).toBe(IMPORTED_ID);
    expect(item.lifecycle).toBe('active');
    expect(item.executionAvailability).toBe('needs_replan');
    expect(item.waitingToContinue).toBe(true);
    // No local site yet: no phase, and the old server's evidence is a summary.
    expect(item.phase).toBeNull();
    expect(item.evidenceAvailability).toBe('summary_only');
    expect(item.portableRef.revision).toBe(REVISION);

    // Listing is read-only: no Run, no Work, no event and no snapshot.
    expect(store.runs.count()).toBe(0);
    expect(store.works.count()).toBe(0);
    expect(store.stageResults.count()).toBe(0);
    expect(cursorAfter).toBe(cursorBefore);
  });

  it('continues into a new local Work with a recorded authorization and the unmet Gates (AC-089)', () => {
    const denied = service.continueRequirement({
      requirementId: IMPORTED_ID,
      authorizationRef: UNKNOWN_ACTION_ID,
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error('unreachable');
    expect(denied.code).toBe('NOT_AUTHORIZED');
    expect(store.works.count()).toBe(0);
    expect(store.requirements.find(IMPORTED_ID)?.workId).toBeUndefined();

    // The user's continue command is a real local action.
    store.userActions.insert({
      id: ACTION_ID,
      actorId: USER_ID,
      action: 'requirement.continue',
      targetId: IMPORTED_ID,
      payload: { requirementId: IMPORTED_ID },
      payloadHash: HASH,
    });

    const result = service.continueRequirement({
      requirementId: IMPORTED_ID,
      authorizationRef: ACTION_ID,
      baseRevision: REVISION,
      at: AT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.work.status).toBe('queued');
    expect(result.work.intent).toBe('delivery');
    expect(result.work.level).toBe('L2');
    expect(result.work.requirementId).toBe(IMPORTED_ID);
    expect(result.work.authorizationRef).toBe(result.authorization.id);
    expect(result.work.baseRevision).toBe(REVISION);
    expect(result.work.id).not.toBe(EXISTING_WORK_ID);

    // The local authorization is recorded against the new Work, from the user action.
    expect(result.authorization.workId).toBe(result.work.id);
    expect(result.authorization.sourceRef).toEqual({
      kind: 'action',
      id: ACTION_ID,
      version: '1',
    });
    expect(result.authorization.operations).toEqual(['read', 'edit']);
    expect(store.authorizations.find(result.authorization.id)?.workId).toBe(result.work.id);

    // The Requirement now has a local site and starts at the Product phase.
    const linked = store.requirements.find(IMPORTED_ID);
    expect(linked?.workId).toBe(result.work.id);
    expect(linked?.executionAvailability).toBe('local');
    expect(linked?.phase).toBe('product');
    expect(linked?.recordVersion).toBe(2);

    // Every Gate of the L2 code route is unmet: the previous verification is not
    // reused, so the chain has to be re-planned and re-verified on this server.
    expect(result.unmetGates.map((gate) => gate.gate)).toEqual([
      'Plan',
      'Develop',
      'Review',
      'Test',
      'Settlement',
    ]);
    expect(result.unmetGates.every((gate) => gate.code === 'GATE_NOT_READY')).toBe(true);
    expect(result.requiresReplan).toBe(true);
    expect(result.requiresReverification).toBe(true);
    expect(result.reusedPreviousVerification).toBe(false);
    expect(result.reusedManifestIds).toEqual([]);
    expect(result.firstGate).toBe('product');
    expect(result.evidenceAvailability).toBe('summary_only');

    // Continuing plans; it never starts execution by itself.
    expect(store.runs.count()).toBe(0);
    expect(store.stageResults.count()).toBe(0);

    // The queue no longer reports it, and the event trail names the new Work.
    expect(service.listContinuable().items).toHaveLength(0);
    const changed = store.events
      .readAfter(0, { names: ['requirement.changed'] })
      .filter((event) => event.entityId === IMPORTED_ID);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.data['workId']).toBe(result.work.id);
    expect(changed[0]?.data['reusedPreviousVerification']).toBe(false);
  });

  it('refuses a Requirement that is not active or already has a local Work (AC-089)', () => {
    projection.import({
      record: portable(QUEUED_ID, 'queued'),
      portableRef: { path: `.agentdev/requirements/${QUEUED_ID}`, revision: REVISION },
    });
    projection.import({
      record: portable(LOCAL_ID, 'active'),
      portableRef: { path: `.agentdev/requirements/${LOCAL_ID}`, revision: REVISION },
      workId: EXISTING_WORK_ID,
    });

    // Only the imported needs_replan record is continuable.
    expect(service.listContinuable().items.map((item) => item.requirementId)).toEqual([
      IMPORTED_ID,
    ]);

    const queued = service.continueRequirement({
      requirementId: QUEUED_ID,
      authorizationRef: ACTION_ID,
    });
    expect(queued.ok).toBe(false);
    if (queued.ok) throw new Error('unreachable');
    expect(queued.code).toBe('INVALID_STATE');

    const alreadyLocal = service.continueRequirement({
      requirementId: LOCAL_ID,
      authorizationRef: ACTION_ID,
    });
    expect(alreadyLocal.ok).toBe(false);
    if (alreadyLocal.ok) throw new Error('unreachable');
    expect(alreadyLocal.code).toBe('INVALID_STATE');
    expect(alreadyLocal.message).toContain(EXISTING_WORK_ID);

    const missing = service.continueRequirement({
      requirementId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4fff',
      authorizationRef: ACTION_ID,
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('unreachable');
    expect(missing.code).toBe('NOT_FOUND');

    expect(store.works.count()).toBe(0);
    expect(store.authorizations.count()).toBe(0);
  });

  it('reports the L3 stages plus the rollback/audit/drill evidence the continuation still owes (AC-089)', () => {
    // An L3 Requirement continues with the user's own action as its authorization,
    // which the recorded envelope makes explicit; the route then reports its stages
    // and the L3 evidence (`workflow.md` §4, AC-011).
    store.userActions.insert({
      id: ACTION_ID,
      actorId: USER_ID,
      action: 'requirement.continue',
      payload: { requirementId: IMPORTED_ID },
      payloadHash: HASH,
    });
    const result = service.continueRequirement({
      requirementId: IMPORTED_ID,
      authorizationRef: ACTION_ID,
      level: 'L3',
      at: AT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.level).toBe('L3');
    expect(result.work.level).toBe('L3');

    const stageGates = result.unmetGates
      .filter((gate) => gate.code === 'GATE_NOT_READY')
      .map((gate) => gate.gate);
    expect(stageGates).toEqual(['Plan', 'Develop', 'Review', 'Test', 'Recovery', 'Settlement']);

    // The L3 evidence gaps are reported as their own unmet items, not silently dropped.
    const evidence = result.unmetGates.filter((gate) => gate.code === 'MISSING_CONTEXT');
    expect(evidence.map((gate) => gate.message).join(' ')).toContain('rollback');
    expect(evidence.map((gate) => gate.message).join(' ')).toContain('audit');
    expect(evidence.map((gate) => gate.message).join(' ')).toContain('drill');
  });
});
