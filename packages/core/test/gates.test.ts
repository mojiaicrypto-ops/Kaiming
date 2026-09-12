import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanTask, Ref, Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { scanEvents } from '../src/events.js';
import {
  ArtifactService,
  PlanGateService,
  StoreSourceHashPort,
  normalizePlan,
  type PlanDraft,
  type SourceHashPort,
  type SourceSnapshot,
  type SubmitPlanInput,
  type SubmitPlanResult,
} from '../src/index.js';
import { BlobStore } from '@agentdev/storage';

/**
 * The Plan gate over a real SQLite ProjectStore (AC-009/013/014).
 *
 * Every case drives the domain rules through persisted state: a refusal must leave
 * the measured source unchanged, an approval must leave readable evidence behind,
 * and an upgrade must make the old Plan unusable.
 */
const ROOT = '/tmp/agentdev-gates-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e01';
const OTHER_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e02';
const REVOKED_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e03';
const DOWNGRADE_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e04';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e10';
const DOWNGRADE_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e11';
const AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e20';
const REVOKED_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e21';
const FOREIGN_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e22';
const DOWNGRADE_AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e23';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e30';
const REVISION = 'a'.repeat(40);
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e40';

const PATH = 'packages/core/src/gates.ts';
const OTHER_PATH = 'packages/domain/src/delivery.ts';

const WELL_FORMED_SCOPE: Scope = {
  readPaths: [],
  writePaths: [PATH],
  operations: ['edit'],
  networkTargets: [],
};

let clock = Date.parse('2026-09-11T00:00:00.000Z');

function nextTime(): string {
  clock += 1_000;
  return new Date(clock).toISOString();
}

function task(id = TASK_ID): PlanTask {
  return {
    id,
    role: 'backend',
    goal: 'persist the gate',
    paths: [PATH],
    dependsOn: [],
    acceptanceIds: ['AC-013'],
    checks: ['pnpm test:unit'],
  };
}

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    goal: 'persist Plan approvals',
    scope: WELL_FORMED_SCOPE,
    tasks: [task()],
    interfaceChanges: [],
    dataChanges: [],
    risks: [],
    rollback: [],
    ...overrides,
  };
}

describe('Plan gate persistence (AC-009, AC-013, AC-014)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let gates: PlanGateService;
  let port: StoreSourceHashPort;
  let projectId: string;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-gates-'));
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
    const blobs = new BlobStore({ root: dataDir });
    gates = new PlanGateService({
      store,
      artifacts: new ArtifactService({ store, blobs, now: () => clock }),
      blobs,
    });
    port = new StoreSourceHashPort({ store });

    for (const [workId, level] of [
      [WORK_ID, 'L1'],
      [OTHER_WORK_ID, 'L1'],
      [REVOKED_WORK_ID, 'L1'],
      [DOWNGRADE_WORK_ID, 'L3'],
    ] as const) {
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
      store.works.insert({
        id: workId,
        projectId,
        intent: level === 'L1' ? 'delivery' : 'operation',
        purpose: 'persist the plan gate',
        level,
        goal: 'deliver WP-06 T2',
        scope: { readPaths: [], writePaths: [PATH], operations: ['edit'], networkTargets: [] },
        sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
        status: 'running',
        blockerIds: [],
        baseRevision: REVISION,
        budgetId: budget.id,
        policyRevision: 1,
        ...(workId === WORK_ID ? { requirementId: REQUIREMENT_ID } : {}),
      });
    }
    store.requirements.insert({
      id: REQUIREMENT_ID,
      projectId,
      workId: WORK_ID,
      title: 'Ship WP-06 gates',
      goal: 'persist Plan approvals and level upgrades',
      lifecycle: 'active',
      phase: 'plan',
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      recordVersion: 1,
      portableRef: {
        path: `.agentdev/requirements/${REQUIREMENT_ID}`,
        revision: 'working-tree',
        hash: 'b'.repeat(64),
      },
      executionAvailability: 'local',
      evidenceAvailability: 'full',
    });
    store.runs.insert({
      id: RUN_ID,
      projectId,
      workId: WORK_ID,
      role: 'planning',
      purpose: 'analysis',
      stage: 'Plan',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'a'.repeat(64),
      contextSnapshotId: 'b'.repeat(64),
      dispatchSnapshotId: 'c'.repeat(64),
      budgetAllocation: 1_000,
    });
    store.runs.insert({
      id: DOWNGRADE_RUN_ID,
      projectId,
      workId: DOWNGRADE_WORK_ID,
      role: 'planning',
      purpose: 'analysis',
      stage: 'Plan',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'a'.repeat(64),
      contextSnapshotId: 'b'.repeat(64),
      dispatchSnapshotId: 'c'.repeat(64),
      budgetAllocation: 1_000,
    });
    store.authorizations.insert({
      id: DOWNGRADE_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: DOWNGRADE_WORK_ID, version: '1' },
      workId: DOWNGRADE_WORK_ID,
      goal: 'authorized scope for the L3 Work',
      scope: WELL_FORMED_SCOPE,
      operations: ['edit'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
    store.authorizations.insert({
      id: AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorized plan write scope',
      scope: WELL_FORMED_SCOPE,
      operations: ['edit'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
    store.authorizations.insert({
      id: REVOKED_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'a revoked envelope',
      scope: WELL_FORMED_SCOPE,
      operations: ['edit'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
      revokedAt: '2026-09-11T00:01:00.000Z',
    });
    store.authorizations.insert({
      id: FOREIGN_AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: OTHER_WORK_ID, version: '1' },
      workId: OTHER_WORK_ID,
      goal: 'another Work envelope',
      scope: WELL_FORMED_SCOPE,
      operations: ['edit'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function submit(overrides: Partial<SubmitPlanInput> = {}): SubmitPlanResult {
    return gates.submitPlan({
      workId: WORK_ID,
      revision: REVISION,
      plan: draft(),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        at: nextTime(),
      },
      ...overrides,
    });
  }

  function approve(overrides: Partial<SubmitPlanInput> = {}): Ref {
    const result = submit(overrides);
    if (!result.approved) throw new Error(`expected an approval, got ${result.code}`);
    return result.planRef;
  }

  it('refuses a code write with no approved Plan and leaves the source hash unchanged (AC-013)', () => {
    const before: SourceSnapshot = port.snapshot(WORK_ID);
    const result = gates.requestCodeWrite({ workId: WORK_ID, revision: REVISION, targets: [PATH] });
    const after: SourceSnapshot = port.snapshot(WORK_ID);

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.code).toBe('GATE_NOT_READY');
    expect(result.stalePlan).toBe(false);
    // The measured source is identical before and after: the refusal wrote nothing.
    expect(result.sourceHash).toBe(before.sourceHash);
    expect(result.sourceHashAfter).toBe(before.sourceHash);
    expect(after.digest).toBe(before.digest);
    expect(after.storeCounts).toEqual(before.storeCounts);
    expect(store.artifacts.count()).toBe(0);
    expect(store.snapshots.count()).toBe(0);
    expect(gates.getCurrentPlanApproval(WORK_ID, REVISION).status).toBe('missing');
    expect(gates.getWorkLevel(WORK_ID)).toBe('L1');
  });

  it('auto-approves a compliant Plan, stores the evidence and admits the write (AC-014)', () => {
    const planRef = approve();

    const approval = gates.getCurrentPlanApproval(WORK_ID, REVISION);
    expect(approval.status).toBe('approved');
    expect(approval.current?.planRef.hash).toBe(planRef.hash);
    expect(approval.current?.approval.approvedBy).toBe('auto');
    expect(approval.current?.approval.authorizationRef).toBe(AUTHORIZATION_ID);
    expect(approval.current?.approval.revision).toBe(REVISION);
    expect(approval.current?.approval.planHash).toBe(planRef.hash);

    // The stored Plan is readable back through the blob store, hash included.
    const stored = gates.readPlanContent(planRef.id);
    expect(stored.goal).toBe('persist Plan approvals');
    expect(stored.approval).toBe('auto');
    expect(stored.version).toBe(1);
    expect(stored.tasks.map((entry) => entry.id)).toEqual([TASK_ID]);

    // The Requirement is re-associated with the approved Plan.
    expect(store.requirements.find(REQUIREMENT_ID)?.planRef?.hash).toBe(planRef.hash);
    expect(store.requirements.find(REQUIREMENT_ID)?.recordVersion).toBe(2);

    const write = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef,
    });
    expect(write.allowed).toBe(true);
    if (!write.allowed) throw new Error('unreachable');
    expect(write.planRef.hash).toBe(planRef.hash);
    expect(write.workLevel).toBe('L1');
    expect(write.sourceHash).toBe(write.sourceHashAfter);
    expect(write.evidenceRefs).toContain(planRef.id);
    expect(write.evidenceRefs).toContain(AUTHORIZATION_ID);

    // The approval is discoverable in the durable event trail too.
    const approved = scanEvents(store, { names: ['decision.created'] }).filter(
      (event) => event.data['workId'] === WORK_ID,
    );
    expect(approved).toHaveLength(1);
    expect(approved[0]?.data['planHash']).toBe(planRef.hash);
    expect(approved[0]?.data['approvedBy']).toBe('auto');
    expect(scanEvents(store, { names: ['delivery.write_admitted'] })).toHaveLength(1);
  });

  it('rejects a non-compliant Plan without writing any gate state (AC-014 negative)', () => {
    const before = port.snapshot(WORK_ID);
    // A new product choice is never auto-approved: it needs a product Decision.
    const productChange = submit({
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: true,
        at: nextTime(),
      },
    });
    expect(productChange.approved).toBe(false);
    if (productChange.approved) throw new Error('unreachable');
    expect(productChange.code).toBe('GATE_NOT_READY');
    expect(productChange.decisionRequired).toBe(true);

    // A Plan whose write scope leaves the authorized envelope cannot be approved.
    const outOfScope = submit({
      plan: draft({
        scope: {
          readPaths: [],
          writePaths: [OTHER_PATH],
          operations: ['edit'],
          networkTargets: [],
        },
      }),
    });
    expect(outOfScope.approved).toBe(false);
    if (outOfScope.approved) throw new Error('unreachable');
    expect(outOfScope.code).toBe('NOT_AUTHORIZED');

    // A revoked authorization is not a basis for approval.
    const expired = submit({
      approval: {
        authorizationRef: REVOKED_AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        at: nextTime(),
      },
    });
    expect(expired.approved).toBe(false);
    if (expired.approved) throw new Error('unreachable');
    expect(expired.code).toBe('NOT_AUTHORIZED');

    expect(port.snapshot(WORK_ID).digest).toBe(before.digest);
    expect(store.artifacts.count()).toBe(0);
    expect(store.snapshots.count()).toBe(0);
  });

  it('refuses a stale Plan after a level upgrade and marks it stale (AC-009)', () => {
    const planRef = approve();
    expect(
      gates.requestCodeWrite({ workId: WORK_ID, revision: REVISION, targets: [PATH], planRef })
        .allowed,
    ).toBe(true);

    // The real diff is over the L1 bounds, so the level must rise before any wider
    // write happens; the replacement Plan is approved for the raised level first.
    const replacement = approve({
      plan: draft({
        goal: 'complete delivery coordination',
        tasks: [task(), { ...task('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e41'), goal: 'second task' }],
      }),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        at: nextTime(),
      },
    });
    const upgrade = gates.upgradeLevel({
      workId: WORK_ID,
      diff: {
        filesChanged: 4,
        diffLines: 24,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true },
      },
      logicChange: false,
      newPlanRef: replacement,
    });
    expect(upgrade.upgraded).toBe(true);
    if (!upgrade.upgraded) throw new Error('unreachable');
    expect(upgrade.previousLevel).toBe('L1');
    expect(upgrade.level).toBe('L2');
    expect(upgrade.requirementId).toBe(REQUIREMENT_ID);
    expect(upgrade.stalePlanRefs).toEqual([planRef.hash]);
    expect(gates.getWorkLevel(WORK_ID)).toBe('L2');
    // The upgrade keeps the same Work but re-associates the Requirement.
    expect(store.requirements.find(REQUIREMENT_ID)?.planRef?.hash).toBe(replacement.hash);
    // The old Plan is explicitly invalidated as an artifact.
    expect(store.artifacts.find(planRef.id)?.validity).toBe('invalid');

    const staleWrite = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef,
    });
    expect(staleWrite.allowed).toBe(false);
    if (staleWrite.allowed) throw new Error('unreachable');
    expect(staleWrite.code).toBe('GATE_NOT_READY');
    expect(staleWrite.stalePlan).toBe(true);
    expect(staleWrite.currentPlanRef?.hash).toBe(replacement.hash);
    expect(staleWrite.sourceHash).toBe(staleWrite.sourceHashAfter);

    // The replacement Plan is the one the gate now admits.
    const fresh = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef: replacement,
    });
    expect(fresh.allowed).toBe(true);
  });

  it('refuses an upgrade whose replacement Plan was never approved (AC-009 negative)', () => {
    approve();
    const result = gates.upgradeLevel({
      workId: WORK_ID,
      diff: {
        filesChanged: 4,
        diffLines: 24,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true },
      },
      logicChange: false,
      newPlanRef: { id: 'f'.repeat(64), version: 9, hash: 'f'.repeat(64) },
    });
    expect(result.upgraded).toBe(false);
    if (result.upgraded) throw new Error('unreachable');
    expect(result.code).toBe('GATE_NOT_READY');
    expect(gates.getWorkLevel(WORK_ID)).toBe('L1');
  });

  it('keeps Plan versions monotonic across submissions (AC-014)', () => {
    const first = approve();
    expect(first.version).toBe(1);
    const second = approve({
      plan: draft({ goal: 'second version' }),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        at: nextTime(),
      },
    });
    expect(second.version).toBe(2);

    const approval = gates.getCurrentPlanApproval(WORK_ID, REVISION);
    expect(approval.current?.planRef.version).toBe(2);
    // The normalized Plan the gate persists must round-trip through its own schema.
    const normalized = normalizePlan(draft(), 3, AUTHORIZATION_ID);
    expect(normalized.tasks[0]?.paths).toEqual([PATH]);
    expect(normalized.approval).toBe('auto');
  });

  it('refuses a Plan whose reservation exceeds the budget once real usage counts (AC-022, W6R1-03)', () => {
    const work = store.works.find(WORK_ID);
    if (work === undefined) throw new Error('unreachable');
    const budget = store.budgets.find(work.budgetId);
    if (budget === undefined) throw new Error('unreachable');
    // The Work has already charged 95k and holds 4k; the Plan asks for 2k more.
    store.budgets.update(budget.id, { tokensUsed: 95_000, tokensReserved: 4_000 }, budget.version);

    const before = port.snapshot(WORK_ID);
    const overBudget = submit({
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        requestedTokens: 2_000,
        at: nextTime(),
      },
    });
    expect(overBudget.approved).toBe(false);
    if (overBudget.approved) throw new Error('unreachable');
    expect(overBudget.code).toBe('BUDGET_EXCEEDED');
    // No silent top-up: nothing was written and the usage was not zeroed.
    expect(store.artifacts.count()).toBe(0);
    expect(port.snapshot(WORK_ID).digest).toBe(before.digest);

    // A request that fits the real usage is still approved.
    const fitted = submit({
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        requestedTokens: 500,
        at: nextTime(),
      },
    });
    expect(fitted.approved).toBe(true);
  });

  it('re-reads the authorization at write time and refuses a revoked envelope (AC-013, W6R1-05)', () => {
    const planRef = approve();
    expect(
      gates.requestCodeWrite({ workId: WORK_ID, revision: REVISION, targets: [PATH], planRef })
        .allowed,
    ).toBe(true);

    // The user revokes the envelope the Plan was approved on.
    const authorization = store.authorizations.find(AUTHORIZATION_ID);
    if (authorization === undefined) throw new Error('unreachable');
    store.authorizations.update(AUTHORIZATION_ID, { revokedAt: nextTime() }, authorization.version);

    const before = port.snapshot(WORK_ID);
    const refused = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef,
    });
    expect(refused.allowed).toBe(false);
    if (refused.allowed) throw new Error('unreachable');
    expect(refused.code).toBe('NOT_AUTHORIZED');
    expect(refused.gaps.join(' ')).toContain('revoked');
    // The refusal is side-effect free and appends no admission event.
    expect(refused.sourceHash).toBe(refused.sourceHashAfter);
    expect(port.snapshot(WORK_ID).digest).toBe(before.digest);
    expect(scanEvents(store, { names: ['delivery.write_admitted'] })).toHaveLength(1);
  });

  it('compares the approval source hash with the live measurement (AC-013, W6R1-07)', () => {
    // A caller-owned measurement port, so the "source" can really move.
    let content = 'a'.repeat(40);
    const moving: SourceHashPort = {
      measure: () => content,
      contentHash: () => content,
    };
    const planRef = approve({ sourceHashPort: moving });

    // The source moves after the Plan was approved: the gate compares the frozen
    // approval hash with the live measurement instead of one value with itself.
    content = 'b'.repeat(40);
    const moved = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef,
      sourceHashPort: moving,
    });
    expect(moved.allowed).toBe(false);
    if (moved.allowed) throw new Error('unreachable');
    expect(moved.code).toBe('GATE_NOT_READY');
    expect(moved.gaps.join(' ')).toContain('source hash changed');

    // A caller-supplied pre-write expectation is compared the same way.
    content = 'a'.repeat(40);
    const mismatched = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef,
      sourceHashPort: moving,
      expectedSourceHash: 'c'.repeat(40),
    });
    expect(mismatched.allowed).toBe(false);
    if (mismatched.allowed) throw new Error('unreachable');
    expect(mismatched.gaps.join(' ')).toContain('source hash changed');

    // The agreed expectation still admits the write.
    const agreed = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef,
      sourceHashPort: moving,
      expectedSourceHash: 'a'.repeat(40),
    });
    expect(agreed.allowed).toBe(true);
  });

  it('distinguishes a no-op from a real upgrade and touches nothing on a no-op (AC-009, W6R1-06)', () => {
    const original = approve();
    const replacement = approve({
      plan: draft({ goal: 'a replacement Plan' }),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        at: nextTime(),
      },
    });

    const before = port.snapshot(WORK_ID);
    const snapshotsBefore = store.snapshots.count();
    const result = gates.upgradeLevel({
      workId: WORK_ID,
      // A presentation-only typo stays inside the recorded L1 level.
      diff: {
        filesChanged: 1,
        diffLines: 1,
        changedCharacters: 1,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true },
      },
      logicChange: false,
      newPlanRef: replacement,
    });
    expect(result.upgraded).toBe(false);
    if (result.upgraded) throw new Error('unreachable');
    expect(result.outcome).toBe('noop');
    expect(result.level).toBe('L1');
    expect(gates.getWorkLevel(WORK_ID)).toBe('L1');
    // No Plan was invalidated, no stale marker written, no upgrade event.
    expect(store.artifacts.find(original.id)?.validity).toBe('valid');
    expect(store.artifacts.find(replacement.id)?.validity).toBe('valid');
    expect(store.snapshots.count()).toBe(snapshotsBefore);
    expect(scanEvents(store, { names: ['delivery.level_upgraded'] })).toHaveLength(0);
    expect(port.snapshot(WORK_ID).digest).toBe(before.digest);
  });

  it('refuses a downgrade without invalidating the still-valid Plan (AC-008/AC-009, W6R1-06)', () => {
    const submitFor = (goal: string): Ref => {
      const result = gates.submitPlan({
        workId: DOWNGRADE_WORK_ID,
        revision: REVISION,
        plan: draft({ goal }),
        approval: {
          authorizationRef: DOWNGRADE_AUTHORIZATION_ID,
          runId: DOWNGRADE_RUN_ID,
          productChanged: false,
          at: nextTime(),
        },
      });
      if (!result.approved) {
        throw new Error(`expected an approval, got ${result.code}: ${result.message}`);
      }
      return result.planRef;
    };
    const original = submitFor('the L3 Plan that stays valid');
    const replacement = submitFor('the replacement the caller holds');

    const before = port.snapshot(DOWNGRADE_WORK_ID);
    const result = gates.upgradeLevel({
      workId: DOWNGRADE_WORK_ID,
      // The recorded level is L3; this diff classifies as L1, i.e. a downgrade.
      diff: {
        filesChanged: 1,
        diffLines: 1,
        changedCharacters: 1,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true },
      },
      logicChange: false,
      newPlanRef: replacement,
    });
    expect(result.upgraded).toBe(false);
    if (result.upgraded) throw new Error('unreachable');
    expect(result.outcome).toBe('downgrade_refused');
    expect(result.code).toBe('STALE_ARTIFACT');
    expect(gates.getWorkLevel(DOWNGRADE_WORK_ID)).toBe('L3');
    // The refusal changes no evidence: no Plan is stale or invalidated.
    expect(store.artifacts.find(original.id)?.validity).toBe('valid');
    expect(store.artifacts.find(replacement.id)?.validity).toBe('valid');
    expect(gates.getCurrentPlanApproval(DOWNGRADE_WORK_ID, REVISION).status).toBe('approved');
    expect(scanEvents(store, { names: ['delivery.level_upgraded'] })).toHaveLength(0);
    expect(port.snapshot(DOWNGRADE_WORK_ID).digest).toBe(before.digest);
  });
  it('never lets a caller expectation replace the approved source hash (AC-013, W6R2-02)', () => {
    // A caller-owned measurement port, so the "source" can really move.
    let content = 'a'.repeat(40);
    const moving: SourceHashPort = {
      measure: () => content,
      contentHash: () => content,
    };
    const planRef = approve({ sourceHashPort: moving });

    // The source moves before the write. Supplying the *moved* value as the
    // caller's own expectation used to select the gate out of moved-source
    // detection; the approved hash is now compared unconditionally.
    content = 'b'.repeat(40);
    const before = port.snapshot(WORK_ID);
    const overridden = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      planRef,
      sourceHashPort: moving,
      expectedSourceHash: 'b'.repeat(40),
    });
    expect(overridden.allowed).toBe(false);
    if (overridden.allowed) throw new Error('unreachable');
    expect(overridden.code).toBe('GATE_NOT_READY');
    expect(overridden.gaps.join(' ')).toContain('source hash changed');
    expect(overridden.sourceHash).toBe(overridden.sourceHashAfter);
    // The refusal admitted no write: no event, no new row.
    expect(scanEvents(store, { names: ['delivery.write_admitted'] })).toHaveLength(0);
    expect(port.snapshot(WORK_ID).digest).toBe(before.digest);
  });

  it('reserves the approved tokens so a second Plan cannot exceed the limit (AC-022, W6R2-06)', () => {
    const work = store.works.find(WORK_ID);
    if (work === undefined) throw new Error('unreachable');
    const budget = store.budgets.find(work.budgetId);
    if (budget === undefined) throw new Error('unreachable');
    store.budgets.update(budget.id, { tokenLimit: 100 }, budget.version);

    const first = submit({
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        requestedTokens: 60,
        at: nextTime(),
      },
    });
    expect(first.approved).toBe(true);
    // The approval is accounted for: the tokens are reserved, not forgotten.
    expect(store.budgets.find(budget.id)?.tokensReserved).toBe(60);

    // A second 60-token Plan sees the first reservation and is refused instead of
    // silently consuming the same headroom twice.
    const second = submit({
      plan: draft({ goal: 'the second 60-token Plan' }),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        requestedTokens: 60,
        at: nextTime(),
      },
    });
    expect(second.approved).toBe(false);
    if (second.approved) throw new Error('unreachable');
    expect(second.code).toBe('BUDGET_EXCEEDED');
    expect(store.budgets.find(budget.id)?.tokensReserved).toBe(60);

    // What still fits the remaining headroom is approved and reserved.
    const third = submit({
      plan: draft({ goal: 'the fitting remainder' }),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        requestedTokens: 40,
        at: nextTime(),
      },
    });
    expect(third.approved).toBe(true);
    expect(store.budgets.find(budget.id)?.tokensReserved).toBe(100);
  });

  it('refuses a code write on a paused or cancelled Work (AC-020/AC-021, W6R2-07)', () => {
    const planRef = approve();
    expect(
      gates.requestCodeWrite({ workId: WORK_ID, revision: REVISION, targets: [PATH], planRef })
        .allowed,
    ).toBe(true);

    for (const status of ['paused', 'cancelling', 'cancelled'] as const) {
      const work = store.works.find(WORK_ID);
      if (work === undefined) throw new Error('unreachable');
      store.works.update(WORK_ID, { status }, work.version);
      const before = port.snapshot(WORK_ID);
      const refused = gates.requestCodeWrite({
        workId: WORK_ID,
        revision: REVISION,
        targets: [PATH],
        planRef,
      });
      expect(refused.allowed).toBe(false);
      if (refused.allowed) throw new Error('unreachable');
      // The same fail-closed code the Run-level pause barrier reports.
      expect(refused.code).toBe('INVALID_STATE');
      expect(refused.gaps.join(' ')).toContain(status === 'paused' ? 'paused' : status);
      expect(port.snapshot(WORK_ID).digest).toBe(before.digest);
    }

    // Back at `running`, the same approved Plan is admitted again.
    const running = store.works.find(WORK_ID);
    if (running === undefined) throw new Error('unreachable');
    store.works.update(WORK_ID, { status: 'running' }, running.version);
    expect(
      gates.requestCodeWrite({ workId: WORK_ID, revision: REVISION, targets: [PATH], planRef })
        .allowed,
    ).toBe(true);
  });
});
