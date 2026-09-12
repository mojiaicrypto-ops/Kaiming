import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Decision, PlanTask, Ref, Scope } from '@agentdev/contracts';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import { classifyChange, evaluateLevelUpgrade } from '@agentdev/domain';
import { scanEvents } from '../src/events.js';
import {
  ArtifactService,
  FindingService,
  PlanGateService,
  StoreSourceHashPort,
  type PlanDraft,
} from '../src/index.js';

/**
 * The five failure tests WP-06 requires (`docs/delivery/implementation.md` WP-06
 * "必需失败测试：一字符高风险、超L1升级、过期Plan、修复后证据失效、未覆盖阻断").
 *
 * Each one is a **negative** behaviour: the interesting assertion is that the
 * system refuses something, that the refusal is the documented code, and that the
 * refusal left no state behind. Every case is therefore also asserted against the
 * persisted store or the returned measurement, never against a claim.
 */
const ROOT = '/tmp/agentdev-delivery-failures-root';
const HASH = 'a'.repeat(64);
const REVISION = 'a'.repeat(40);
const CONFIG_HASH = HASH;
const PATH = 'packages/domain/src/permission.ts';
const OTHER_PATH = 'packages/domain/src/delivery.ts';

const IDS = {
  oneCharWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0001',
  upgradeWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0002',
  stalePlanWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0003',
  findingWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0004',
  uncoveredWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0005',
  noPlanWork: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0006',
} as const;

const AUTH = {
  oneChar: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0101',
  upgrade: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0102',
  stalePlan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0103',
  finding: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0104',
  uncovered: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0105',
  noPlan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0106',
} as const;

const RUNS = {
  oneCharPlan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0201',
  upgradePlan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0202',
  stalePlan: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0203',
  findingRaise: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0204',
  findingOldReview: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0205',
  findingOldTest: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0206',
  findingFix: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0207',
  findingNewReview: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0208',
  findingNewTest: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0209',
} as const;

const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0301';
const SECOND_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0302';
const FINDING_TARGET_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0310';
const FINDING_MANIFEST_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0311';
const RISK_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0320';

const SCOPE: Scope = {
  readPaths: [],
  writePaths: [PATH],
  operations: ['read', 'edit'],
  networkTargets: [],
};

const BASE_TIME = Date.parse('2026-09-11T00:00:00.000Z');

describe('required WP-06 failure tests', () => {
  let dataDir: string;
  let store: ProjectStore;
  let projectId: string;
  let blobs: BlobStore;
  let artifacts: ArtifactService;
  let gates: PlanGateService;
  let findings: FindingService;
  let clock: number;
  let runCount: number;

  const time = (): string => {
    clock += 1_000;
    return new Date(clock).toISOString();
  };

  beforeEach(() => {
    clock = BASE_TIME;
    runCount = 0;
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-failures-'));
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
    blobs = new BlobStore({ root: dataDir });
    artifacts = new ArtifactService({ store, blobs, now: () => (clock += 1_000) });
    gates = new PlanGateService({ store, artifacts, blobs });
    findings = new FindingService({ store, artifacts, blobs });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  function addWork(id: string, level: 'L1' | 'L2' | 'L3', authorizationId: string): void {
    const budget = store.budgets.insert({
      projectId,
      workId: id,
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
      id,
      projectId,
      intent: 'delivery',
      purpose: 'verify a required WP-06 failure',
      level,
      goal: `deliver ${id}`,
      scope: SCOPE,
      sourceRef: { kind: 'message', id, version: '1' },
      authorizationRef: authorizationId,
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      budgetId: budget.id,
      policyRevision: 1,
    });
    store.authorizations.insert({
      id: authorizationId,
      projectId,
      sourceRef: { kind: 'message', id, version: '1' },
      workId: id,
      goal: `authorized scope for ${id}`,
      scope: SCOPE,
      operations: [...SCOPE.operations],
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
  }

  function addRun(input: {
    readonly id: string;
    readonly workId: string;
    readonly role:
      'chief' | 'product' | 'planning' | 'backend' | 'frontend' | 'review' | 'test' | 'settlement';
    readonly stage: string;
    readonly status?: 'running' | 'completed';
  }): void {
    store.runs.insert({
      id: input.id,
      projectId,
      workId: input.workId,
      role: input.role,
      purpose:
        input.role === 'review'
          ? 'review'
          : input.role === 'test'
            ? 'test'
            : input.role === 'planning'
              ? 'analysis'
              : 'implementation',
      stage: input.stage,
      status: input.status ?? 'completed',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: CONFIG_HASH,
      contextSnapshotId: HASH,
      dispatchSnapshotId: HASH,
      budgetAllocation: 1_000,
      // Run order is evidence: a fix must precede the Review that verifies it.
      createdAt: new Date(BASE_TIME + (runCount += 1) * 1_000).toISOString(),
    });
  }

  function planTask(id = TASK_ID, paths: readonly string[] = [PATH]): PlanTask {
    return {
      id,
      role: 'backend',
      goal: `deliver ${id}`,
      paths: [...paths],
      dependsOn: [],
      acceptanceIds: ['AC-013'],
      checks: ['pnpm test:unit'],
    };
  }

  function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
    return {
      goal: 'verify the required failures',
      scope: SCOPE,
      tasks: [planTask()],
      interfaceChanges: [],
      dataChanges: [],
      risks: [],
      rollback: [],
      ...overrides,
    };
  }

  function approve(input: {
    readonly workId: string;
    readonly authorizationRef: string;
    readonly runId: string;
    readonly plan?: PlanDraft;
  }): Ref {
    const result = gates.submitPlan({
      workId: input.workId,
      revision: REVISION,
      plan: input.plan ?? draft(),
      approval: {
        authorizationRef: input.authorizationRef,
        runId: input.runId,
        productChanged: false,
        at: time(),
      },
    });
    if (!result.approved) {
      throw new Error(`expected an approved Plan, got ${result.code}: ${result.message}`);
    }
    return result.planRef;
  }

  // =========================================================================
  // 1. 一字符高风险
  // =========================================================================

  it('一字符高风险: a one-character permission/amount change is L3 and is not downgraded', () => {
    // One character, one file, one line — every size condition for L1 holds, and
    // the classification still refuses L1 because the character *is* the permission.
    const permissionCharacter = classifyChange({
      filesChanged: 1,
      diffLines: 1,
      changedCharacters: 1,
      signals: {
        presentationOnly: false,
        goalSubstitutionExplicit: true,
        permissionChange: true,
      },
    });
    expect(permissionCharacter.level).toBe('L3');
    expect(permissionCharacter.lockdown).toBe(true);
    expect(permissionCharacter.reasons.join(' ')).toContain('lockdown risk');
    // The line count cannot rescue it: the L1 bounds are conservative admission,
    // not a safety proof (`workflow.md` §2.4).
    expect(permissionCharacter.diffOverL1).toBe(false);

    const amountCharacter = classifyChange({
      filesChanged: 1,
      diffLines: 1,
      changedCharacters: 1,
      signals: {
        presentationOnly: false,
        goalSubstitutionExplicit: true,
        paymentChange: true,
      },
    });
    expect(amountCharacter.level).toBe('L3');
    // An interface change is the same L3 class: "公开协议不兼容".
    expect(
      classifyChange({
        filesChanged: 1,
        diffLines: 1,
        changedCharacters: 1,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true, interfaceChange: true },
      }).level,
    ).toBe('L3');
    // An unrecognized risk flag is fail-closed, never "no risk".
    expect(
      classifyChange(
        {
          filesChanged: 1,
          diffLines: 1,
          signals: { presentationOnly: true, goalSubstitutionExplicit: true },
        },
        ['something_new_and_unclassified'],
      ).level,
    ).toBe('L3');

    // No later evaluation may walk the L3 decision back down to L1/L2, in either
    // direction: an upgrade re-check on an L3 permission change stays L3.
    const upgrade = evaluateLevelUpgrade({
      previousLevel: 'L1',
      diff: {
        filesChanged: 1,
        diffLines: 1,
        changedCharacters: 1,
        signals: {
          presentationOnly: false,
          goalSubstitutionExplicit: true,
          permissionChange: true,
        },
      },
      logicChange: false,
      plan: {
        id: HASH,
        version: 1,
        hash: HASH,
        revision: REVISION,
        stage: 'Plan',
        approval: 'auto',
      },
    });
    expect(upgrade.upgradeRequired).toBe(true);
    expect(upgrade.level).toBe('L3');
    expect(upgrade.stalePlan).toBe(true);

    // The Work is really persisted at L3 and the L1 Plan it held is refused: the
    // classification above was not the only guard.
    addWork(IDS.oneCharWork, 'L1', AUTH.oneChar);
    addRun({ id: RUNS.oneCharPlan, workId: IDS.oneCharWork, role: 'chief', stage: 'CompactPlan' });
    const planRef = approve({
      workId: IDS.oneCharWork,
      authorizationRef: AUTH.oneChar,
      runId: RUNS.oneCharPlan,
    });
    const replacement = approve({
      workId: IDS.oneCharWork,
      authorizationRef: AUTH.oneChar,
      runId: RUNS.oneCharPlan,
      plan: draft({ goal: 'change one permission character' }),
    });
    const applied = gates.upgradeLevel({
      workId: IDS.oneCharWork,
      diff: {
        filesChanged: 1,
        diffLines: 1,
        changedCharacters: 1,
        signals: {
          presentationOnly: false,
          goalSubstitutionExplicit: true,
          permissionChange: true,
        },
      },
      logicChange: false,
      newPlanRef: replacement,
    });
    expect(applied.upgraded).toBe(true);
    if (!applied.upgraded) throw new Error('unreachable');
    expect(applied.level).toBe('L3');
    expect(gates.getWorkLevel(IDS.oneCharWork)).toBe('L3');

    // A second classification of the same one-character diff cannot walk the
    // recorded L3 down: the domain refuses the downgrade and keeps L3, so no
    // caller can treat "the diff looks tiny" as a reason to reopen the L1 lane.
    const downgrade = evaluateLevelUpgrade({
      previousLevel: 'L3',
      diff: {
        filesChanged: 1,
        diffLines: 1,
        changedCharacters: 1,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true },
      },
      logicChange: false,
      plan: {
        id: replacement.id,
        version: replacement.version,
        hash: replacement.hash,
        revision: REVISION,
        stage: 'Plan',
        approval: 'auto',
      },
    });
    expect(downgrade.upgradeRequired).toBe(true);
    expect(downgrade.ok).toBe(false);
    expect(downgrade.level).toBe('L3');
    expect(downgrade.reasons.join(' ')).toContain('downgrade refused');
    expect(gates.getWorkLevel(IDS.oneCharWork)).toBe('L3');

    const refusedWrite = gates.requestCodeWrite({
      workId: IDS.oneCharWork,
      revision: REVISION,
      targets: [PATH],
      planRef,
    });
    expect(refusedWrite.allowed).toBe(false);
    if (refusedWrite.allowed) throw new Error('unreachable');
    expect(refusedWrite.code).toBe('GATE_NOT_READY');
    expect(refusedWrite.stalePlan).toBe(true);
  });

  // =========================================================================
  // 2. 超L1升级
  // =========================================================================

  it('超L1升级: a diff above the L1 bounds upgrades the level, associates the Requirement, refills the Gate and rejects the old Plan', () => {
    // The measured diff is over the documented L1 bounds: 4 files and 24 lines.
    const overBounds = { filesChanged: 4, diffLines: 24 };
    const classification = classifyChange({
      ...overBounds,
      signals: { presentationOnly: true, goalSubstitutionExplicit: true },
    });
    expect(classification.level).toBe('L2');
    expect(classification.diffOverL1).toBe(true);
    // A pure logic change with a tiny diff also leaves L1.
    expect(
      classifyChange({
        filesChanged: 1,
        diffLines: 2,
        signals: { presentationOnly: true, goalSubstitutionExplicit: true, logicChange: true },
      }).level,
    ).toBe('L2');
    // 4 files/24 lines of a data migration is L3, not a quiet L2.
    expect(
      classifyChange(
        { ...overBounds, signals: { presentationOnly: true, goalSubstitutionExplicit: true } },
        ['data_deletion_or_migration'],
      ).level,
    ).toBe('L3');

    addWork(IDS.upgradeWork, 'L1', AUTH.upgrade);
    addRun({ id: RUNS.upgradePlan, workId: IDS.upgradeWork, role: 'planning', stage: 'Plan' });
    // The Requirement the upgraded Work must be associated with.
    store.requirements.insert({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0400',
      projectId,
      workId: IDS.upgradeWork,
      title: 'Extend the delivery scope',
      goal: 'widen the write scope safely',
      lifecycle: 'active',
      phase: 'execute',
      sourceRef: { kind: 'message', id: IDS.upgradeWork, version: '1' },
      recordVersion: 1,
      portableRef: {
        path: `.agentdev/requirements/${IDS.upgradeWork}`,
        revision: REVISION,
        hash: HASH,
      },
      executionAvailability: 'local',
      evidenceAvailability: 'full',
    });
    store.works.update(
      IDS.upgradeWork,
      { requirementId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0400' },
      store.works.find(IDS.upgradeWork)?.version ?? 1,
    );
    // The user's envelope for this Work covers both paths: an upgrade may only
    // widen the *Plan's* scope inside the authority the user already granted.
    store.authorizations.update(
      AUTH.upgrade,
      {
        scope: {
          readPaths: [],
          writePaths: [PATH, OTHER_PATH],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
      },
      store.authorizations.find(AUTH.upgrade)?.version ?? 1,
    );

    const original = approve({
      workId: IDS.upgradeWork,
      authorizationRef: AUTH.upgrade,
      runId: RUNS.upgradePlan,
    });
    const port = new StoreSourceHashPort({ store });
    expect(
      gates.requestCodeWrite({
        workId: IDS.upgradeWork,
        revision: REVISION,
        targets: [PATH],
        planRef: original,
      }).allowed,
    ).toBe(true);

    const replacement = approve({
      workId: IDS.upgradeWork,
      authorizationRef: AUTH.upgrade,
      runId: RUNS.upgradePlan,
      plan: draft({
        goal: 'the wider delivery',
        tasks: [planTask(TASK_ID), planTask(SECOND_TASK_ID, [OTHER_PATH])],
        scope: {
          readPaths: [],
          writePaths: [PATH, OTHER_PATH],
          operations: ['read', 'edit'],
          networkTargets: [],
        },
      }),
    });

    const upgrade = gates.upgradeLevel({
      workId: IDS.upgradeWork,
      diff: { ...overBounds, signals: { presentationOnly: true, goalSubstitutionExplicit: true } },
      logicChange: false,
      newPlanRef: replacement,
      requirementId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0400',
    });
    expect(upgrade.upgraded).toBe(true);
    if (!upgrade.upgraded) throw new Error('unreachable');
    expect(upgrade.previousLevel).toBe('L1');
    expect(upgrade.level).toBe('L2');
    // The same Work, now associated with the Requirement.
    expect(upgrade.requirementId).toBe('018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0400');
    expect(store.works.find(IDS.upgradeWork)?.requirementId).toBe(
      '018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0400',
    );
    expect(store.requirements.find('018f2c1e-9a4b-7c3d-8e5f-0a1b2c8d0400')?.planRef?.hash).toBe(
      replacement.hash,
    );
    // The Gate is refilled: the replacement is the current Plan, the old Plan is
    // explicitly stale and its artifact invalidated.
    expect(upgrade.stalePlanRefs).toEqual([original.hash]);
    expect(store.artifacts.find(original.id)?.validity).toBe('invalid');
    const approval = gates.getCurrentPlanApproval(IDS.upgradeWork, REVISION);
    expect(approval.status).toBe('approved');
    expect(approval.current?.planRef.hash).toBe(replacement.hash);
    const upgraded = scanEvents(store, { names: ['delivery.level_upgraded'] });
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]?.data).toMatchObject({
      previousLevel: 'L1',
      level: 'L2',
      newPlanId: replacement.id,
    });

    // The old Plan is rejected **before** any wider write, and the refusal writes
    // nothing: the measured source (content + the rows a gate may write) is
    // byte-identical before and after the refused attempt.
    const before = port.snapshot(IDS.upgradeWork);
    const refused = gates.requestCodeWrite({
      workId: IDS.upgradeWork,
      revision: REVISION,
      targets: [PATH],
      planRef: original,
    });
    expect(refused.allowed).toBe(false);
    if (refused.allowed) throw new Error('unreachable');
    expect(refused.code).toBe('GATE_NOT_READY');
    expect(refused.stalePlan).toBe(true);
    expect(refused.currentPlanRef?.hash).toBe(replacement.hash);
    expect(port.snapshot(IDS.upgradeWork).digest).toBe(before.digest);
    // The replacement Plan is the one that is admitted, and only for paths its own
    // scope names: a widened Plan is a real new Gate decision, not a rubber stamp.
    expect(
      gates.requestCodeWrite({
        workId: IDS.upgradeWork,
        revision: REVISION,
        targets: [OTHER_PATH],
        planRef: replacement,
      }).allowed,
    ).toBe(true);
    const outside = gates.requestCodeWrite({
      workId: IDS.upgradeWork,
      revision: REVISION,
      targets: ['packages/domain/src/transitions.ts'],
      planRef: replacement,
    });
    expect(outside.allowed).toBe(false);
    if (outside.allowed) throw new Error('unreachable');
    expect(outside.code).toBe('NOT_AUTHORIZED');
  });

  // =========================================================================
  // 3. 过期Plan
  // =========================================================================

  it('过期Plan: a stale Plan cannot authorise a write; the gate says GATE_NOT_READY and the source hash is unchanged', () => {
    addWork(IDS.stalePlanWork, 'L2', AUTH.stalePlan);
    addRun({ id: RUNS.stalePlan, workId: IDS.stalePlanWork, role: 'planning', stage: 'Plan' });
    const planRef = approve({
      workId: IDS.stalePlanWork,
      authorizationRef: AUTH.stalePlan,
      runId: RUNS.stalePlan,
    });
    const port = new StoreSourceHashPort({ store });
    expect(
      gates.requestCodeWrite({
        workId: IDS.stalePlanWork,
        revision: REVISION,
        targets: [PATH],
        planRef,
      }).allowed,
    ).toBe(true);

    // A second, newer Plan for the same revision supersedes the first one.
    const newer = approve({
      workId: IDS.stalePlanWork,
      authorizationRef: AUTH.stalePlan,
      runId: RUNS.stalePlan,
      plan: draft({ goal: 'the replacement Plan' }),
    });
    expect(newer.hash).not.toBe(planRef.hash);

    // Presenting the older Plan is GATE_NOT_READY, and `stalePlan` names why.
    const before = port.snapshot(IDS.stalePlanWork);
    const refused = gates.requestCodeWrite({
      workId: IDS.stalePlanWork,
      revision: REVISION,
      targets: [PATH],
      planRef,
    });
    expect(refused.allowed).toBe(false);
    if (refused.allowed) throw new Error('unreachable');
    expect(refused.code).toBe('GATE_NOT_READY');
    expect(refused.stalePlan).toBe(true);
    expect(refused.gaps.join(' ')).toContain('stale');
    expect(refused.currentPlanRef?.hash).toBe(newer.hash);
    // The source hash is unchanged: both halves of the measurement are equal, and
    // the full digest (content + the rows a gate may write) did not move either.
    expect(refused.sourceHash).toBe(refused.sourceHashAfter);
    const after = port.snapshot(IDS.stalePlanWork);
    expect(after.digest).toBe(before.digest);
    expect(after.storeCounts).toEqual(before.storeCounts);
    expect(scanEvents(store, { names: ['delivery.write_admitted'] })).toHaveLength(1);

    // A Work with no approved Plan at all is refused the same way, and the refusal
    // also writes nothing. (`requestCodeWrite` without a `planRef` uses whatever
    // Plan is current — the gate's contract is the Plan's *approval*, not the
    // caller naming it — so "no Plan" is tested on a Work that has none.)
    addWork(IDS.noPlanWork, 'L2', AUTH.noPlan);
    const noPlanBefore = port.snapshot(IDS.noPlanWork);
    const noPlan = gates.requestCodeWrite({
      workId: IDS.noPlanWork,
      revision: REVISION,
      targets: [PATH],
    });
    expect(noPlan.allowed).toBe(false);
    if (noPlan.allowed) throw new Error('unreachable');
    expect(noPlan.code).toBe('GATE_NOT_READY');
    expect(noPlan.gaps.join(' ')).toContain('no approved Plan');
    expect(noPlan.sourceHash).toBe(noPlan.sourceHashAfter);
    expect(port.snapshot(IDS.noPlanWork).digest).toBe(noPlanBefore.digest);

    // The current Plan still writes: the refusal was about staleness, not about a
    // blanket block on this Work.
    expect(
      gates.requestCodeWrite({
        workId: IDS.stalePlanWork,
        revision: REVISION,
        targets: [PATH],
        planRef: newer,
      }).allowed,
    ).toBe(true);
  });

  // =========================================================================
  // 4. 修复后证据失效
  // =========================================================================

  it('修复后证据失效: after a fix the previous Review/Test evidence cannot close the Finding', () => {
    addWork(IDS.findingWork, 'L2', AUTH.finding);
    addRun({ id: RUNS.findingRaise, workId: IDS.findingWork, role: 'review', stage: 'Review' });
    // The pre-fix Review/Test are real, completed Runs of the pre-fix revision.
    addRun({
      id: RUNS.findingOldReview,
      workId: IDS.findingWork,
      role: 'review',
      stage: 'Review',
    });
    addRun({ id: RUNS.findingOldTest, workId: IDS.findingWork, role: 'test', stage: 'Test' });
    const oldReview = artifacts.createAgent({
      run: { id: RUNS.findingOldReview, workId: IDS.findingWork, role: 'review' },
      kind: 'review',
      mime: 'text/markdown',
      bytes: Buffer.from('# pre-fix review: passed\n'),
    });
    const oldTest = artifacts.createAgent({
      run: { id: RUNS.findingOldTest, workId: IDS.findingWork, role: 'test' },
      kind: 'test',
      mime: 'text/markdown',
      bytes: Buffer.from('# pre-fix test: passed\n'),
    });

    const submitted = findings.submitFinding({
      reviewRunId: RUNS.findingRaise,
      target: {
        targetKind: 'integration',
        targetRef: { id: FINDING_TARGET_ID, version: 1, hash: HASH },
      },
      manifestRef: { id: FINDING_MANIFEST_ID, version: 1, hash: HASH },
      finding: { description: 'the gate is missing', severity: 'P1' },
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error('unreachable');
    const findingId = submitted.finding.id;
    // The return to development already invalidated the pre-fix evidence.
    expect(submitted.invalidatedEvidenceRefs).toEqual(
      expect.arrayContaining([oldReview.id, oldTest.id]),
    );
    expect(store.artifacts.find(oldReview.id)?.validity).toBe('invalid');
    expect(store.artifacts.find(oldTest.id)?.validity).toBe('invalid');

    addRun({
      id: RUNS.findingFix,
      workId: IDS.findingWork,
      role: 'backend',
      stage: 'Develop',
    });
    const addressed = findings.markAddressed({
      findingId,
      actorRole: 'backend',
      fixRunId: RUNS.findingFix,
    });
    expect(addressed.ok).toBe(true);
    if (!addressed.ok) throw new Error('unreachable');

    // The pre-fix Review cannot close the fix, even paired with a fresh Test.
    addRun({
      id: RUNS.findingNewTest,
      workId: IDS.findingWork,
      role: 'test',
      stage: 'Test',
    });
    const staleReview = findings.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: RUNS.findingOldReview },
      testRun: { runId: RUNS.findingNewTest },
    });
    expect(staleReview.ok).toBe(false);
    if (staleReview.ok) throw new Error('unreachable');
    expect(staleReview.code).toBe('GATE_NOT_READY');
    expect(staleReview.requiresNewReview).toBe(true);

    // The pre-fix Test cannot stand in as the post-fix verification either.
    addRun({
      id: RUNS.findingNewReview,
      workId: IDS.findingWork,
      role: 'review',
      stage: 'Review',
    });
    const staleTest = findings.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: RUNS.findingNewReview },
      testRun: { runId: RUNS.findingOldTest },
    });
    expect(staleTest.ok).toBe(false);
    if (staleTest.ok) throw new Error('unreachable');
    expect(staleTest.code).toBe('GATE_NOT_READY');
    expect(staleTest.requiresNewTest).toBe(true);

    // The Review that raised the Finding can never verify its own fix.
    const raisingReview = findings.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: RUNS.findingRaise },
      testRun: { runId: RUNS.findingNewTest },
    });
    expect(raisingReview.ok).toBe(false);
    if (raisingReview.ok) throw new Error('unreachable');
    expect(raisingReview.code).toBe('GATE_NOT_READY');

    // Still open for verification, and the verification evidence was never rewritten.
    expect(store.findings.find(findingId)?.state).toBe('addressed');
    expect(store.artifacts.find(oldReview.id)?.validity).toBe('invalid');
    expect(store.artifacts.find(oldTest.id)?.validity).toBe('invalid');
    expect(scanEvents(store, { names: ['finding.verified'] })).toHaveLength(0);

    // Only the new, independent post-fix pair closes it.
    const closed = findings.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: RUNS.findingNewReview },
      testRun: { runId: RUNS.findingNewTest },
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) throw new Error('unreachable');
    expect(closed.state).toBe('verified');
    expect(store.findings.find(findingId)?.state).toBe('verified');
  });

  // =========================================================================
  // 5. 未覆盖阻断
  // =========================================================================

  it('未覆盖阻断: a Test result with not_covered or blocked cannot complete the Work', () => {
    addWork(IDS.uncoveredWork, 'L2', AUTH.uncovered);

    // `blocked` is a hard stop: no disposition exists that opens the Gate.
    const blocked = findings.completeWork({
      workId: IDS.uncoveredWork,
      testResult: { status: 'blocked' },
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('unreachable');
    expect(blocked.code).toBe('GATE_NOT_READY');
    expect(blocked.reasons.join(' ')).toContain('blocked');
    expect(store.works.find(IDS.uncoveredWork)?.status).toBe('running');
    expect(scanEvents(store, { names: ['delivery.work_completed'] })).toHaveLength(0);

    // `not_covered` needs an explicit risk disposition per acceptance id.
    const uncovered = [
      { acceptanceId: 'AC-007', reason: 'the fixture has no live provider' },
      { acceptanceId: 'AC-009', reason: 'no environment for the upgrade path' },
    ];
    const undisposed = findings.completeWork({
      workId: IDS.uncoveredWork,
      testResult: { status: 'not_covered', uncovered },
    });
    expect(undisposed.ok).toBe(false);
    if (undisposed.ok) throw new Error('unreachable');
    expect(undisposed.code).toBe('GATE_NOT_READY');
    expect(undisposed.needsRiskDisposition).toEqual(['AC-007', 'AC-009']);
    expect(store.works.find(IDS.uncoveredWork)?.status).toBe('running');

    // A disposition for an acceptance id that was never uncovered is refused.
    const unmatched = findings.completeWork({
      workId: IDS.uncoveredWork,
      testResult: { status: 'not_covered', uncovered },
      riskDispositions: [{ acceptanceId: 'AC-999', decisionId: RISK_DECISION_ID }],
    });
    expect(unmatched.ok).toBe(false);
    if (unmatched.ok) throw new Error('unreachable');
    expect(unmatched.code).toBe('VALIDATION_ERROR');
    expect(store.works.find(IDS.uncoveredWork)?.status).toBe('running');

    // A decision that is not an accepted `risk` Decision of this Work is refused.
    store.decisions.insert({
      id: RISK_DECISION_ID,
      workId: IDS.uncoveredWork,
      kind: 'risk',
      targetRef: { id: IDS.uncoveredWork, version: 1, hash: HASH },
      choices: ['accept', 'reject'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const pending = findings.completeWork({
      workId: IDS.uncoveredWork,
      testResult: { status: 'not_covered', uncovered },
      riskDispositions: [{ acceptanceId: 'AC-007', decisionId: RISK_DECISION_ID }],
    });
    expect(pending.ok).toBe(false);
    if (pending.ok) throw new Error('unreachable');
    expect(pending.code).toBe('VALIDATION_ERROR');
    expect(pending.needsRiskDisposition).toEqual(['AC-007']);
    expect(store.works.find(IDS.uncoveredWork)?.status).toBe('running');

    // Only the accepted disposition for every uncovered id opens the Gate.
    const accepted: Decision = store.decisions.update(
      RISK_DECISION_ID,
      { state: 'accepted', choice: 'accept' },
      store.decisions.find(RISK_DECISION_ID)?.version ?? 1,
    );
    expect(accepted.state).toBe('accepted');
    const opened = findings.completeWork({
      workId: IDS.uncoveredWork,
      testResult: {
        status: 'not_covered',
        uncovered: [uncovered[0] ?? { acceptanceId: 'AC-007', reason: '' }],
      },
      riskDispositions: [{ acceptanceId: 'AC-007', decisionId: RISK_DECISION_ID }],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('unreachable');
    expect(opened.riskDecisionIds).toEqual([RISK_DECISION_ID]);
    expect(store.works.find(IDS.uncoveredWork)?.status).toBe('completed');
  });
});
