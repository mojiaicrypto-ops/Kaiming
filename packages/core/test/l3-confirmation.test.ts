import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  sha256,
  type ProjectStore,
} from '@agentdev/storage';
import { ArtifactService, L3ConfirmationService, SnapshotWriter } from '../src/index.js';
import { scanEvents } from '../src/events.js';

/**
 * The explicit L3 confirmation interaction (`l3-confirmation.ts`, AC-011).
 *
 * The service owns four things the daemon's gate and the Inbox both read: the raised
 * Decision (with its question Artifact and choices), the Work hold (blocker + parked
 * status), the answer (accept/decline, with the decline reason), and the dispatch
 * verdict. The cases below check those records directly, so a later refactor of the
 * protocol layer cannot silently weaken the hold.
 */
const ROOT = '/tmp/agentdev-l3-unit-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e01';
const OTHER_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e02';
const L2_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e03';
/** An L3 Work with no Chief Run at all: the fail-closed case. */
const UNROUTED_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e04';
const CHIEF_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e10';
const OTHER_CHIEF_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e11';
const REVISION = 'd'.repeat(40);

const SCOPE: Scope = {
  readPaths: ['src'],
  writePaths: ['src/db'],
  operations: ['read', 'edit'],
  networkTargets: [],
};

function workRow(
  projectId: string,
  workId: string,
  level: 'L2' | 'L3',
  budgetId: string,
): Record<string, unknown> {
  return {
    id: workId,
    projectId,
    intent: 'delivery',
    purpose: 'migrate the delivery tables',
    level,
    goal: 'migrate the delivery tables',
    scope: SCOPE,
    sourceRef: { kind: 'message', id: workId, version: '1' },
    status: 'running',
    blockerIds: [],
    baseRevision: REVISION,
    budgetId,
    policyRevision: 1,
  };
}

function runRow(projectId: string, workId: string, runId: string): Record<string, unknown> {
  return {
    id: runId,
    projectId,
    workId,
    role: 'chief',
    purpose: 'analysis',
    stage: 'assess',
    status: 'running',
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: sha256(`config:${runId}`),
    contextSnapshotId: sha256(`context:${runId}`),
    dispatchSnapshotId: sha256(`dispatch:${runId}`),
    budgetAllocation: 10_000,
  };
}

describe('L3 confirmation service (AC-011)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let service: L3ConfirmationService;
  let projectId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-l3-unit-'));
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
      head: REVISION,
    });
    for (const workId of [WORK_ID, OTHER_WORK_ID, L2_WORK_ID, UNROUTED_WORK_ID]) {
      const budget = store.budgets.insert({
        projectId,
        workId,
        tokenLimit: 100_000,
        tokensUsed: 0,
        tokensReserved: 0,
        activeTimeLimit: 600,
        activeTimeUsed: 0,
        repairLimit: 3,
        repairUsed: 0,
        costKnown: true,
      });
      store.works.insert(
        workRow(projectId, workId, workId === L2_WORK_ID ? 'L2' : 'L3', budget.id),
      );
    }
    store.runs.insert(runRow(projectId, WORK_ID, CHIEF_RUN_ID));
    store.runs.insert(runRow(projectId, OTHER_WORK_ID, OTHER_CHIEF_RUN_ID));
    const blobs = new BlobStore({ root: dataDir });
    service = new L3ConfirmationService({
      store,
      blobs,
      artifacts: new ArtifactService({ store, blobs }),
      snapshots: new SnapshotWriter({ store }),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function raise(workId = WORK_ID, runId = CHIEF_RUN_ID) {
    return service.raise({
      workId,
      runId,
      goal: 'migrate the delivery tables',
      riskFlags: ['数据删除/迁移'],
      reason: 'the migration rewrites stored delivery rows',
      revision: REVISION,
      scope: SCOPE,
    });
  }

  it('raises one pending Decision with a real question Artifact and parks the Work', () => {
    const raised = raise();
    expect(raised.state).toBe('pending');
    expect(raised.riskFlags).toEqual(['数据删除/迁移']);
    expect(raised.scope.writePaths).toEqual(['src/db']);
    expect(raised.revision).toBe(REVISION);

    const decision = store.decisions.find(raised.decisionId);
    expect(decision?.kind).toBe('product');
    expect(decision?.state).toBe('pending');
    expect(decision?.choices).toEqual(['confirm', 'decline']);
    expect(decision?.targetRef.id).toBe(raised.artifactId);
    // The question body is content: a `kind=decision` markdown Artifact the Inbox reads
    // from `targetRef` (`protocol.md` §6).
    const artifact = store.artifacts.find(raised.artifactId);
    expect(artifact?.kind).toBe('decision');
    expect(artifact?.mime).toBe('text/markdown');
    expect(raised.question).toContain('数据删除/迁移');
    expect(raised.question).toContain(WORK_ID);
    expect(raised.question).toContain('src/db');

    const work = store.works.find(WORK_ID);
    expect(work?.status).toBe('blocked');
    expect(work?.blockerIds).toEqual([raised.decisionId]);
    expect(service.pending(WORK_ID)).toBe(true);
    expect(service.admitDispatch(WORK_ID)).toMatchObject({
      allowed: false,
      state: 'pending',
      decisionId: raised.decisionId,
    });
    // Nothing else is held: an L2 Work and a Work the risk rules did not route to L3
    // are unaffected by the guard.
    expect(service.pending(L2_WORK_ID)).toBe(false);
    expect(service.admitDispatch(L2_WORK_ID).allowed).toBe(true);
    // The raise is auditable in the documented order.
    const events = scanEvents(store, { names: ['decision.created', 'work.control_changed'] });
    expect(
      events.some(
        (event) =>
          event.name === 'decision.created' &&
          event.entityId === raised.decisionId &&
          event.data['kind'] === 'l3_confirmation',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.name === 'work.control_changed' &&
          event.data['control'] === 'l3-confirmation-required',
      ),
    ).toBe(true);
  });

  it('never raises a second question for the same hold', () => {
    const first = raise();
    const second = service.sync({
      workId: WORK_ID,
      runId: CHIEF_RUN_ID,
      goal: 'migrate the delivery tables',
      riskFlags: ['数据删除/迁移'],
      reason: 'a re-assessment of the same migration',
      revision: REVISION,
      scope: SCOPE,
    });
    expect(second?.decisionId).toBe(first.decisionId);
    expect(store.decisions.list({ where: 'work_id = ?', params: [WORK_ID] })).toHaveLength(1);
    // An L2 Work is never asked at all.
    expect(
      service.sync({
        workId: L2_WORK_ID,
        goal: 'a normal change',
        riskFlags: [],
        reason: 'nothing high risk',
        scope: SCOPE,
      }),
    ).toBeUndefined();
  });

  it('accepts the confirmation, clears the hold and admits the high-risk step', () => {
    const raised = raise();
    const resolved = service.resolve({ decisionId: raised.decisionId, choice: 'confirm' });
    expect(resolved.accepted).toBe(true);
    expect(resolved.confirmation.state).toBe('accepted');
    expect(resolved.work.status).toBe('running');
    expect(resolved.work.blockerIds).toEqual([]);
    expect(service.pending(WORK_ID)).toBe(false);
    expect(service.admitDispatch(WORK_ID)).toMatchObject({ allowed: true, state: 'accepted' });
    expect(service.find(raised.decisionId)?.state).toBe('accepted');
    // Resolving again is refused: the Decision is no longer pending.
    expect(() =>
      service.resolve({ decisionId: raised.decisionId, choice: 'decline' }),
    ).toThrowError(/already accepted/u);
  });

  it('records the decline reason, keeps the Work blocked and refuses the high-risk step', () => {
    const raised = raise(OTHER_WORK_ID, OTHER_CHIEF_RUN_ID);
    const resolved = service.resolve({
      decisionId: raised.decisionId,
      choice: 'decline',
      reason: 'the migration is not acceptable yet',
    });
    expect(resolved.accepted).toBe(false);
    expect(resolved.confirmation.state).toBe('rejected');
    expect(resolved.confirmation.declineReason).toBe('the migration is not acceptable yet');
    expect(resolved.work.status).toBe('blocked');
    // The refused Decision stays the Work's blocker: the hold is not silently released.
    expect(resolved.work.blockerIds).toEqual([raised.decisionId]);
    expect(service.pending(OTHER_WORK_ID)).toBe(true);
    expect(service.admitDispatch(OTHER_WORK_ID)).toMatchObject({
      allowed: false,
      state: 'rejected',
      decisionId: raised.decisionId,
    });
    // The reason is on the documented event and in the frozen record.
    const answered = scanEvents(store, { names: ['decision.resolved'] }).find(
      (event) => event.entityId === raised.decisionId,
    );
    expect(answered?.data['choice']).toBe('decline');
    expect(answered?.data['reason']).toBe('the migration is not acceptable yet');
    expect(service.latest(OTHER_WORK_ID)?.declineReason).toBe(
      'the migration is not acceptable yet',
    );

    // A re-assessment after a decline asks again: a fresh, pending confirmation.
    const raisedAgain = service.sync({
      workId: OTHER_WORK_ID,
      runId: OTHER_CHIEF_RUN_ID,
      goal: 'migrate the delivery tables',
      riskFlags: ['数据删除/迁移'],
      reason: 'the user asked again after reconsidering the risk',
      revision: REVISION,
      scope: SCOPE,
    });
    expect(raisedAgain?.decisionId).not.toBe(raised.decisionId);
    expect(raisedAgain?.state).toBe('pending');
    expect(service.admitDispatch(OTHER_WORK_ID)).toMatchObject({
      allowed: false,
      state: 'pending',
    });
  });

  it("falls back to the Work's own Chief Run, and refuses a Work with none", () => {
    // An assessment always arrives from the Work's Chief Run, so naming it is optional:
    // the service resolves the Work's own Chief Run when the caller does not.
    const resolved = service.raise({
      workId: WORK_ID,
      goal: 'migrate the delivery tables',
      riskFlags: ['数据删除/迁移'],
      reason: 'no explicit run id',
      scope: SCOPE,
    });
    expect(store.artifacts.find(resolved.artifactId)?.runId).toBe(CHIEF_RUN_ID);

    // A Work with no Chief Run at all has no producing Run to attribute the question
    // Artifact to, so the confirmation is refused fail-closed instead of written with a
    // dangling producer. The Work row is untouched by the refusal.
    expect(() =>
      service.raise({
        workId: UNROUTED_WORK_ID,
        runId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e99',
        goal: 'migrate',
        riskFlags: ['数据删除/迁移'],
        reason: 'unknown run',
        scope: SCOPE,
      }),
    ).toThrowError(/no Chief Run/u);
    expect(store.works.find(UNROUTED_WORK_ID)?.blockerIds).toEqual([]);
    expect(store.works.find(UNROUTED_WORK_ID)?.status).toBe('running');
  });
});
