/**
 * WP-06 T1 — graded delivery rules (AC-007…AC-022, AC-083).
 *
 * Every rule is a pure decision, so each test asserts the decision **and** the
 * negative case that would let a regression through:
 *
 * - a one-character change that alters permission/payment/interface is L3 and the
 *   line count can never downgrade it (AC-008, required failure test);
 * - an over-L1 diff or a logic change upgrades before any write-scope expansion
 *   and the old Plan becomes stale (AC-009, required failure test);
 * - a write without an approved Plan for the current revision is GATE_NOT_READY
 *   and the caller can assert the source hash is unchanged (AC-013);
 * - after a fix the old Review/Test are invalid and only a new independent pair
 *   closes the Finding (AC-017/AC-018, required failure test);
 * - `blocked` never completes and `not_covered` needs an explicit risk
 *   disposition (AC-019, required failure test);
 * - a reservation over the budget/rework allowance is refused atomically with no
 *   silent top-up (AC-022).
 */
import { describe, expect, it } from 'vitest';
import type { Ref, Scope } from '@agentdev/contracts';
import {
  STAGE_ORDER,
  bindFindingTarget,
  canReserveBudget,
  classifyChange,
  completionEvidenceKindFor,
  documentRouteRules,
  evaluateBehaviourChoice,
  evaluateEvidenceValidity,
  evaluateFindingClosure,
  evaluateFindingRouting,
  evaluateL1Eligibility,
  evaluateLevelUpgrade,
  evaluatePlanApproval,
  evaluateReworkAllowance,
  evaluateStageChain,
  evaluateWriteGate,
  evidenceBindsRevision,
  findingBlocksCompletion,
  findingCanBeVerified,
  invalidateEvidenceForChoice,
  isWithinScope,
  levelRank,
  requirementStateForChoice,
  stageOrderFor,
  workWriteBarrier,
  type ChangeDiff,
  type CodeSignals,
  type LevelUpgradeInput,
  type PlanRevision,
  type ReservationBudget,
  type StageManifest,
} from '../src/index.js';

const ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const ID2 = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const ID3 = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61';
const HASH = 'b'.repeat(64);
const HASH2 = 'c'.repeat(64);
const REV = 'd'.repeat(40);
const REV2 = 'e'.repeat(40);
const TIME = '2026-09-11T00:00:00.000Z';

const scope = (writePaths: readonly string[] = []): Scope => ({
  readPaths: [],
  writePaths: [...writePaths],
  operations: writePaths.length > 0 ? ['edit', 'read'] : ['read'],
  networkTargets: [],
});

const signals = (overrides: Partial<CodeSignals> = {}): CodeSignals => ({
  presentationOnly: true,
  goalSubstitutionExplicit: true,
  ...overrides,
});

/** A small presentation-only diff: the AC-007 typo shape. */
const typoDiff: ChangeDiff = {
  filesChanged: 1,
  diffLines: 2,
  changedCharacters: 1,
  signals: signals(),
};

const plan: PlanRevision = {
  id: ID2,
  version: 1,
  hash: HASH,
  revision: REV,
  stage: 'plan',
  approval: 'auto',
  approvedAt: TIME,
};

const planRef: Ref = { id: plan.id, version: plan.version, hash: plan.hash };

function manifest(stage: string, previous?: string, evidence?: string[]): StageManifest {
  return {
    stage,
    workId: ID,
    planRef,
    codeRevision: REV,
    codeTree: HASH,
    environmentRef: 'env-1',
    acceptanceIds: ['AC-010'],
    ...(evidence === undefined ? {} : { evidence }),
    ...(previous === undefined ? {} : { dependsOn: [previous] }),
  };
}

/**
 * A Manifest with the named optional fields actually absent.
 *
 * `exactOptionalPropertyTypes` refuses `field: undefined`, so the fields are
 * removed rather than nulled — which is also the real contract: a Plan Manifest
 * has no frozen code revision yet.
 */
function without(entry: StageManifest, fields: readonly (keyof StageManifest)[]): StageManifest {
  const copy: Record<string, unknown> = { ...entry };
  for (const field of fields) delete copy[field];
  return copy as unknown as StageManifest;
}

const NO_CODE_FIELDS = ['codeRevision', 'codeTree', 'environmentRef'] as const;

/** A complete, well-formed L2 chain: Plan → Develop → Review → Test → Settlement. */
function l2Chain(): StageManifest[] {
  return [
    without(manifest('Plan'), NO_CODE_FIELDS),
    manifest('Develop', 'Plan'),
    manifest('Review', 'Develop'),
    manifest('Test', 'Review'),
    without(manifest('Settlement', 'Test'), NO_CODE_FIELDS),
  ];
}

describe('L1 eligibility and bounds (AC-007/AC-008/AC-009)', () => {
  it('accepts an explicit typo change inside the L1 bounds (AC-007)', () => {
    const eligibility = evaluateL1Eligibility(typoDiff);
    expect(eligibility).toEqual({ eligible: true, level: 'L1', reasons: [] });
    expect(classifyChange(typoDiff)).toMatchObject({ level: 'L1', lockdown: false });
    // Exactly at the bounds is still inside them.
    const atBounds: ChangeDiff = {
      ...typoDiff,
      filesChanged: 3,
      diffLines: 20,
      changedCharacters: 19,
    };
    expect(evaluateL1Eligibility(atBounds).eligible).toBe(true);
  });

  it('never downgrades a one-character permission change by its line count (AC-008)', () => {
    // The required failure test: one character, one line, L3.
    const oneCharacter: ChangeDiff = {
      filesChanged: 1,
      diffLines: 1,
      changedCharacters: 1,
      signals: signals({ permissionChange: true }),
    };
    const classification = classifyChange(oneCharacter);
    expect(classification.level).toBe('L3');
    expect(classification.lockdown).toBe(true);
    expect(evaluateL1Eligibility(oneCharacter).eligible).toBe(false);

    // The same one-character shape changing an interface or an amount is L3 too.
    for (const flag of ['interfaceChange', 'paymentChange'] as const) {
      const diff: ChangeDiff = { ...oneCharacter, signals: signals({ [flag]: true }) };
      expect(classifyChange(diff).level).toBe('L3');
    }
    // ...and an L3 classification cannot be argued down through a risk flag list.
    expect(classifyChange(typoDiff, ['payment']).level).toBe('L3');
  });

  it('is L2 when the diff exceeds the L1 bounds or changes logic (AC-009)', () => {
    const fourFiles = evaluateL1Eligibility({ ...typoDiff, filesChanged: 4 });
    expect(fourFiles.eligible).toBe(false);
    if (!fourFiles.eligible) {
      expect(fourFiles.level).toBe('L2');
      expect(fourFiles.reasons.join(' ')).toContain('files changed 4');
    }
    const twentyOneLines = evaluateL1Eligibility({ ...typoDiff, diffLines: 21 });
    expect(twentyOneLines.eligible).toBe(false);
    if (!twentyOneLines.eligible) expect(twentyOneLines.reasons.join(' ')).toContain('21');
    expect(classifyChange({ ...typoDiff, signals: signals({ logicChange: true }) }).level).toBe(
      'L2',
    );
    expect(
      classifyChange({ ...typoDiff, signals: signals({ executableConfigChange: true }) }).level,
    ).toBe('L2');
    // An empty diff is not an L1 change either: there is nothing to observe.
    expect(evaluateL1Eligibility({ ...typoDiff, filesChanged: 0, diffLines: 0 }).eligible).toBe(
      false,
    );
  });

  it('upgrades an over-L1 diff to the same Work with a stale Plan (AC-009)', () => {
    const input: LevelUpgradeInput = {
      previousLevel: 'L1',
      diff: { ...typoDiff, filesChanged: 5, diffLines: 40 },
      logicChange: false,
      plan,
      workRevision: REV,
    };
    const upgrade = evaluateLevelUpgrade(input);
    expect(upgrade.ok).toBe(false);
    expect(upgrade.outcome).toBe('upgrade');
    expect(upgrade.upgradeRequired).toBe(true);
    expect(upgrade.level).toBe('L2');
    expect(upgrade.stalePlan).toBe(true);
    // Without a Plan there is nothing to reject as stale, but the upgrade stands.
    const { plan: omitted, ...noPlan } = input;
    void omitted;
    const withoutPlan = evaluateLevelUpgrade(noPlan);
    expect(withoutPlan.upgradeRequired).toBe(true);
    expect(withoutPlan.stalePlan).toBe(false);
  });

  it('upgrades a logic change that the line count hides (AC-009 required failure test)', () => {
    const upgrade = evaluateLevelUpgrade({
      previousLevel: 'L1',
      diff: typoDiff,
      logicChange: true,
      plan,
      workRevision: REV,
    });
    expect(upgrade.ok).toBe(false);
    expect(upgrade.upgradeRequired).toBe(true);
    expect(upgrade.level).toBe('L2');
    expect(upgrade.stalePlan).toBe(true);
    expect(upgrade.reasons.join(' ')).toContain('logic change');
  });

  it('never downgrades automatically (AC-008/AC-009)', () => {
    // A recorded L3 whose new classification is L1 keeps L3. The refusal is a
    // distinct outcome and leaves the current Plan valid: `stalePlan` is false even
    // though a Plan was supplied (W6R1-06).
    const downgrade = evaluateLevelUpgrade({
      previousLevel: 'L3',
      diff: typoDiff,
      logicChange: false,
      plan,
      workRevision: REV,
    });
    expect(downgrade.ok).toBe(false);
    expect(downgrade.outcome).toBe('downgrade_refused');
    expect(downgrade.level).toBe('L3');
    expect(downgrade.stalePlan).toBe(false);
    expect(downgrade.reasons.join(' ')).toContain('downgrade refused');

    // An unchanged L1 work is a no-op, not an upgrade.
    const unchanged = evaluateLevelUpgrade({
      previousLevel: 'L1',
      diff: typoDiff,
      logicChange: false,
      plan,
      workRevision: REV,
    });
    expect(unchanged.ok).toBe(true);
    expect(unchanged.outcome).toBe('noop');
    expect(unchanged.level).toBe('L1');
    expect(unchanged.stalePlan).toBe(false);
    expect(levelRank('L3')).toBeGreaterThan(levelRank('L2'));
    expect(levelRank('none')).toBe(0);
  });

  it('treats an unknown risk flag as inclusive, never as "no risk" (fail-closed)', () => {
    const known = classifyChange(typoDiff, ['gateRuleChange']);
    expect(known.level).toBe('L3');
    expect(known.reasons.join(' ')).toContain('gateRuleChange');
    expect(known.unknownRiskFlags).toEqual([]);

    // A flag nobody recognizes cannot be read as "no risk": the change would
    // otherwise route to L1 on the strength of a typo.
    const unknown = classifyChange(typoDiff, ['totally-made-up-risk']);
    expect(unknown.level).toBe('L3');
    expect(unknown.lockdown).toBe(true);
    expect(unknown.unknownRiskFlags).toEqual(['totally-made-up-risk']);
    expect(evaluateL1Eligibility(typoDiff, ['totally-made-up-risk']).eligible).toBe(false);
  });

  it('reports the measured reasons behind a classification (AC-009)', () => {
    const big = classifyChange({ ...typoDiff, filesChanged: 5, diffLines: 40 });
    expect(big.diffOverL1).toBe(true);
    expect(big.logicChange).toBe(false);
    expect(big.reasons.join(' ')).toContain('files changed 5');
    const logic = classifyChange({ ...typoDiff, signals: signals({ logicChange: true }) });
    expect(logic.diffOverL1).toBe(false);
    expect(logic.logicChange).toBe(true);
  });
});

describe('stage manifests and routes (AC-010/AC-011/AC-012)', () => {
  it('fixes the stage order per route and level (AC-010/AC-012)', () => {
    expect(STAGE_ORDER.code.L2).toEqual(['Plan', 'Develop', 'Review', 'Test', 'Settlement']);
    expect(STAGE_ORDER.code.L1).toEqual(['Develop', 'Review', 'Settlement']);
    expect(STAGE_ORDER.document.L2).toEqual(['Product', 'Planning', 'Review', 'Settlement']);
    expect(stageOrderFor('code', 'L2')).toEqual(STAGE_ORDER.code.L2);
    // The document route has no code Test stage.
    const rules = documentRouteRules('L2');
    expect(rules.codeTestStage).toBe(false);
    expect(rules.developmentRequirement).toBe(false);
    expect(rules.producesCandidateDiff).toBe(true);
    expect(rules.stages).not.toContain('Test');
    expect(rules.stages).not.toContain('Develop');
  });

  it('accepts a complete L2 chain and rejects a missing stage (AC-010)', () => {
    const input = {
      route: 'code' as const,
      level: 'L2' as const,
      requirement: { requirementId: ID },
    };
    const ok = evaluateStageChain({ ...input, manifests: l2Chain() });
    expect(ok.ok).toBe(true);

    const incomplete = evaluateStageChain({
      ...input,
      manifests: l2Chain().filter((entry) => entry.stage !== 'Test'),
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.code).toBe('GATE_NOT_READY');
      expect(incomplete.gaps.some((gap) => gap.stage === 'Test')).toBe(true);
      expect(incomplete.gaps.every((gap) => gap.code !== 'VALIDATION_ERROR')).toBe(true);
    }
  });

  it('requires each stage to depend on the previous one (AC-010)', () => {
    const broken = l2Chain().map((entry) =>
      entry.stage === 'Test' ? { ...entry, dependsOn: [] } : entry,
    );
    const decision = evaluateStageChain({
      route: 'code',
      level: 'L2',
      manifests: broken,
      requirement: { requirementId: ID },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.gaps.some((gap) => gap.stage === 'Test')).toBe(true);
    }
  });

  it('needs a Requirement for L2/L3 code and for L3 evidence (AC-011)', () => {
    const withoutRequirement = evaluateStageChain({
      route: 'code',
      level: 'L2',
      manifests: l2Chain(),
    });
    expect(withoutRequirement.ok).toBe(false);
    if (!withoutRequirement.ok) expect(withoutRequirement.code).toBe('MISSING_CONTEXT');

    const l3 = evaluateStageChain({
      route: 'code',
      level: 'L3',
      requirement: { requirementId: ID, previousLevel: 'L3' },
      manifests: [
        ...l2Chain().slice(0, 4),
        manifest('Recovery', 'Test'),
        without(manifest('Settlement', 'Recovery'), ['codeRevision', 'environmentRef']),
      ],
    });
    expect(l3.ok).toBe(false);
    if (!l3.ok) {
      const messages = l3.gaps.map((gap) => gap.message).join(' ');
      expect(messages).toContain('rollback');
      expect(messages).toContain('audit');
      expect(messages).toContain('drill');
    }

    // W6R3-06: the three L3 items are structured artifact references. Naming the
    // words in free text — even self-negating prose — is not evidence.
    const proseOnly = evaluateStageChain({
      route: 'code',
      level: 'L3',
      requirement: { requirementId: ID, previousLevel: 'L3' },
      manifests: [
        without(manifest('Plan', undefined, ['there is no rollback plan, but rollback']), [
          'codeRevision',
          'environmentRef',
        ]),
        manifest('Develop', 'Plan'),
        manifest('Review', 'Develop', ['NO audit was performed, audit absent']),
        manifest('Test', 'Review', ['NO audit was performed']),
        manifest('Recovery', 'Test', ['no drill happened, drill']),
        without(manifest('Settlement', 'Recovery'), ['codeRevision', 'environmentRef']),
      ],
    });
    expect(proseOnly.ok).toBe(false);
    if (!proseOnly.ok) {
      expect(proseOnly.code).toBe('MISSING_CONTEXT');
      const messages = proseOnly.gaps.map((gap) => gap.message).join(' ');
      expect(messages).toContain('rollback');
      expect(messages).toContain('audit');
      expect(messages).toContain('drill');
    }

    const completeL3 = evaluateStageChain({
      route: 'code',
      level: 'L3',
      requirement: { requirementId: ID, previousLevel: 'L3' },
      manifests: [
        without(
          {
            ...manifest('Plan', undefined, ['rollback plan: restore the previous revision']),
            rollbackPlanRef: { id: ID, version: 1, hash: HASH },
          },
          ['codeRevision', 'environmentRef'],
        ),
        manifest('Develop', 'Plan'),
        {
          ...manifest('Review', 'Develop', ['audit: per-item authorisation reviewed']),
          auditRef: { id: ID2, version: 1, hash: HASH },
        },
        manifest('Test', 'Review', ['audit: per-item verification result']),
        {
          ...manifest('Recovery', 'Test', ['drill: restore from backup in a clean root']),
          recoveryDrillRef: { id: ID3, version: 1, hash: HASH },
        },
        without(manifest('Settlement', 'Recovery'), ['codeRevision', 'environmentRef']),
      ],
    });
    expect(completeL3.ok).toBe(true);

    // An incomplete reference (`id` without a `hash`) is not a binding either.
    const incompleteRef = evaluateStageChain({
      route: 'code',
      level: 'L3',
      requirement: { requirementId: ID, previousLevel: 'L3' },
      manifests: [
        without(
          {
            ...manifest('Plan'),
            rollbackPlanRef: { id: '', version: 1, hash: '' },
          },
          ['codeRevision', 'environmentRef'],
        ),
        manifest('Develop', 'Plan'),
        {
          ...manifest('Review', 'Develop'),
          auditRef: { id: ID2, version: 1, hash: '' },
        },
        manifest('Test', 'Review'),
        {
          ...manifest('Recovery', 'Test'),
          recoveryDrillRef: { id: ID3, version: 1, hash: HASH },
        },
        without(manifest('Settlement', 'Recovery'), ['codeRevision', 'environmentRef']),
      ],
    });
    expect(incompleteRef.ok).toBe(false);
  });

  it('accepts a document chain that binds no code revision or environment (AC-012, W6R1-04/W6R2-10)', () => {
    // The document lane has no code Test and no code revision (`workflow.md` §3):
    // the chain validator used to demand both on Review, rejecting a compliant
    // document delivery.
    const documentChain = [
      without(manifest('Product'), NO_CODE_FIELDS),
      without(manifest('Planning', 'Product'), NO_CODE_FIELDS),
      without(
        {
          ...manifest('Review', 'Planning'),
          // W6R2-10: the candidate diff is a concrete artifact binding, not the
          // word "diff" in a free-text evidence line.
          candidateDiffRef: { id: ID, version: 1, hash: HASH },
        },
        NO_CODE_FIELDS,
      ),
      without(manifest('Settlement', 'Review'), NO_CODE_FIELDS),
    ];
    expect(
      evaluateStageChain({ route: 'document', level: 'L2', manifests: documentChain }),
    ).toEqual({ ok: true, stages: ['Product', 'Planning', 'Review', 'Settlement'] });

    // The exemption is not a blanket removal: the document Review still has to bind
    // the candidate diff it reviewed. W6R2-10: naming the words "candidate diff" in
    // free text — the old, substring-only rule — must not satisfy it any more.
    const stripCandidateDiff = (entry: StageManifest): StageManifest => {
      if (entry.stage !== 'Review') return entry;
      const copy: Record<string, unknown> = { ...entry };
      delete copy['candidateDiffRef'];
      return { ...(copy as unknown as StageManifest), evidence: ['candidate diff approved'] };
    };
    const noDiffEvidence = evaluateStageChain({
      route: 'document',
      level: 'L2',
      manifests: documentChain.map(stripCandidateDiff),
    });
    expect(noDiffEvidence.ok).toBe(false);
    if (!noDiffEvidence.ok) {
      expect(noDiffEvidence.code).toBe('VALIDATION_ERROR');
      expect(noDiffEvidence.gaps.map((gap) => gap.message).join(' ')).toContain('candidate diff');
    }
    // An incomplete binding is not a binding either.
    const incompleteRef = evaluateStageChain({
      route: 'document',
      level: 'L2',
      manifests: documentChain.map((entry) =>
        entry.stage === 'Review'
          ? { ...entry, candidateDiffRef: { id: '', version: 1, hash: '' } }
          : entry,
      ),
    });
    expect(incompleteRef.ok).toBe(false);

    // The code route keeps the code requirements: the same manifests without a
    // frozen revision are refused there.
    const codeWithoutRevision = evaluateStageChain({
      route: 'code',
      level: 'L2',
      requirement: { requirementId: ID },
      manifests: l2Chain().map((entry) =>
        entry.stage === 'Review' ? without(entry, ['codeRevision', 'environmentRef']) : entry,
      ),
    });
    expect(codeWithoutRevision.ok).toBe(false);
    if (!codeWithoutRevision.ok) {
      expect(codeWithoutRevision.code).toBe('VALIDATION_ERROR');
      expect(codeWithoutRevision.gaps.map((gap) => gap.stage)).toContain('Review');
    }
  });

  it('rejects an unknown route/level combination instead of guessing', () => {
    const decision = evaluateStageChain({
      route: 'code',
      level: 'none',
      manifests: [],
      requirement: { requirementId: ID },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('VALIDATION_ERROR');
  });
});

describe('gate readiness (AC-013/AC-014)', () => {
  const work = { id: ID, revision: REV, level: 'L2' as const };

  it('refuses a write without an approved Plan and leaves the source hash unchanged (AC-013)', () => {
    const before = HASH;
    const decision = evaluateWriteGate({
      revision: REV,
      work,
      authorizedTargets: ['src/'],
      expectedSourceHash: before,
      actualSourceHash: before,
      planHash: HASH,
      diffHash: HASH2,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('GATE_NOT_READY');
      expect(decision.gaps.join(' ')).toContain('no Plan');
      // The caller can still assert the source hash did not move.
      expect(before).toBe(HASH);
    }
  });

  it('refuses a Plan for another revision and a changed Plan hash (AC-013 required failure test)', () => {
    const stale = evaluateWriteGate({
      plan,
      revision: REV,
      work: { ...work, revision: REV2 },
      authorizedTargets: ['src/'],
      expectedSourceHash: HASH,
      actualSourceHash: HASH,
      planHash: HASH,
      diffHash: HASH2,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.gaps.join(' ')).toContain('does not match Work revision');

    const editedPlan = evaluateWriteGate({
      plan,
      revision: REV,
      work,
      authorizedTargets: ['src/'],
      expectedSourceHash: HASH,
      actualSourceHash: HASH,
      planHash: HASH2,
      diffHash: HASH2,
    });
    expect(editedPlan.ok).toBe(false);
    if (!editedPlan.ok) expect(editedPlan.gaps.join(' ')).toContain('Plan content changed');

    // A source that moved between admission and the write is refused as well.
    const moved = evaluateWriteGate({
      plan,
      revision: REV,
      work,
      authorizedTargets: ['src/'],
      expectedSourceHash: HASH,
      actualSourceHash: HASH2,
      planHash: HASH,
      diffHash: HASH2,
    });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.gaps.join(' ')).toContain('source hash changed');
  });

  it('admits the write when the Plan is approved for the current revision (AC-014)', () => {
    const decision = evaluateWriteGate({
      plan,
      revision: REV,
      work,
      authorizedTargets: ['src/'],
      expectedSourceHash: HASH,
      actualSourceHash: HASH,
      planHash: HASH,
      diffHash: HASH2,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.sourceHash).toBe(HASH);
      expect(decision.approvals.planRef).toEqual(planRef);
    }
  });

  it('auto-approves a compliant Plan with recorded evidence (AC-014)', () => {
    const decision = evaluatePlanApproval({
      plan,
      revision: REV,
      selection: {
        authorizationRef: ID3,
        authorizedTargets: ['src/'],
        authorizedOperations: ['edit', 'read'],
        workId: ID,
      },
      scope: scope(['src/a.ts']),
      budget: { tokenLimit: 1000, used: 0, reserved: 100, requested: 200 },
      productChanged: false,
      at: TIME,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.approval).toBe('auto');
      expect(decision.evidence).toMatchObject({
        planId: plan.id,
        planHash: HASH,
        revision: REV,
        approvedBy: 'auto',
        authorizationRef: ID3,
      });
    }
  });

  it('never auto-approves a product choice or an out-of-scope Plan (AC-014 negative)', () => {
    const base = {
      plan,
      revision: REV,
      selection: {
        authorizationRef: ID3,
        authorizedTargets: ['src/'],
        authorizedOperations: ['edit', 'read'],
        workId: ID,
      },
      budget: { tokenLimit: 1000, used: 0, reserved: 0, requested: 200 },
      at: TIME,
    };
    const productChange = evaluatePlanApproval({ ...base, productChanged: true });
    expect(productChange.ok).toBe(false);
    if (!productChange.ok) {
      expect(productChange.code).toBe('GATE_NOT_READY');
      expect(productChange.decisionRequired).toBe(true);
    }

    const outsideScope = evaluatePlanApproval({
      ...base,
      productChanged: false,
      scope: scope(['docs/other.md']),
    });
    expect(outsideScope.ok).toBe(false);
    if (!outsideScope.ok) expect(outsideScope.code).toBe('NOT_AUTHORIZED');

    const overBudget = evaluatePlanApproval({
      ...base,
      productChanged: false,
      scope: scope(['src/a.ts']),
      budget: { tokenLimit: 100, used: 0, reserved: 90, requested: 20 },
    });
    expect(overBudget.ok).toBe(false);
    if (!overBudget.ok) {
      expect(overBudget.code).toBe('BUDGET_EXCEEDED');
      expect(overBudget.decisionRequired).toBe(false);
    }

    const noAuthorization = evaluatePlanApproval({
      ...base,
      productChanged: false,
      selection: {
        authorizedTargets: base.selection.authorizedTargets,
        authorizedOperations: base.selection.authorizedOperations,
        workId: base.selection.workId,
      },
    });
    expect(noAuthorization.ok).toBe(false);
    if (!noAuthorization.ok) expect(noAuthorization.code).toBe('NOT_AUTHORIZED');

    const unauthorizedOperation = evaluatePlanApproval({
      ...base,
      productChanged: false,
      scope: {
        readPaths: [],
        writePaths: ['src/a.ts'],
        operations: ['push'],
        networkTargets: [],
      },
    });
    expect(unauthorizedOperation.ok).toBe(false);
    if (!unauthorizedOperation.ok) expect(unauthorizedOperation.code).toBe('NOT_AUTHORIZED');
  });

  it('covers targets only by equality or a directory prefix', () => {
    expect(isWithinScope('src/a.ts', ['src/'])).toBe(true);
    expect(isWithinScope('src/a.ts', ['src/a.ts'])).toBe(true);
    expect(isWithinScope('srcs/a.ts', ['src/'])).toBe(false);
    expect(isWithinScope('src/a.ts', [])).toBe(false);
    // W6R1-10 documents the boundary rather than leaving a dead branch: a path that
    // is schema-legal (`repoPathSchema` rejects a trailing `/`) covers only itself,
    // so `packages/core/src` neither covers its children nor a sibling prefix.
    expect(isWithinScope('packages/core/src/a.ts', ['packages/core/src'])).toBe(false);
    expect(isWithinScope('packages/core/srcX/a.ts', ['packages/core/src'])).toBe(false);
    expect(isWithinScope('packages/core/src', ['packages/core/src'])).toBe(true);
  });

  it('refuses an over-used budget instead of assuming a zero usage (AC-022, W6R1-03)', () => {
    const base = {
      plan,
      revision: REV,
      selection: {
        authorizationRef: ID3,
        authorizedTargets: ['src/'],
        authorizedOperations: ['edit', 'read'],
        workId: ID,
      },
      scope: scope(['src/a.ts']),
      productChanged: false,
      at: TIME,
    };
    // used 60 + reserved 30 + 50 > 100: the old code passed `tokensUsed: 0` and
    // approved this Plan, which is a silent top-up.
    const overUsed = evaluatePlanApproval({
      ...base,
      budget: { tokenLimit: 100, used: 60, reserved: 30, requested: 50 },
    });
    expect(overUsed.ok).toBe(false);
    if (!overUsed.ok) {
      expect(overUsed.code).toBe('BUDGET_EXCEEDED');
      expect(overUsed.decisionRequired).toBe(false);
    }

    // A caller that supplies no usage at all is refused as well: it must not be
    // read as `used = 0`. (The field is required by the type; this is the
    // JavaScript-caller path.)
    const missingUsed = evaluatePlanApproval({
      ...base,
      budget: { tokenLimit: 100, reserved: 30, requested: 50 } as unknown as {
        tokenLimit: number;
        used: number;
        reserved: number;
        requested: number;
      },
    });
    expect(missingUsed.ok).toBe(false);
    if (!missingUsed.ok) expect(missingUsed.code).toBe('VALIDATION_ERROR');

    // The same request fits once the real usage is small enough.
    const fits = evaluatePlanApproval({
      ...base,
      budget: { tokenLimit: 100, used: 10, reserved: 30, requested: 50 },
    });
    expect(fits.ok).toBe(true);
  });
});

describe('behaviour choices (AC-015/AC-016)', () => {
  const evidenceRefs = ['evidence:review-A', 'evidence:test-A', 'evidence:global'];

  it('handling now needs a new Product/Plan and invalidates affected evidence (AC-015)', () => {
    const decision = evaluateBehaviourChoice({
      workId: ID,
      choice: 'now',
      summary: 'the empty list must show an explanation',
      decidedAt: TIME,
      evidenceRefs,
      affectedEvidenceRefs: ['evidence:review-A', 'evidence:test-A'],
      removeOrChangePaths: ['src/list.ts'],
      sourceRequirementId: ID2,
    });
    expect(decision.newProductRequired).toBe(true);
    expect(decision.newPlanRequired).toBe(true);
    expect(decision.invalidatedEvidenceRefs).toEqual(['evidence:review-A', 'evidence:test-A']);
    expect(decision.reusableEvidenceRefs).toEqual(['evidence:global']);
    expect(decision.decision).toMatchObject({ kind: 'decision', state: 'accepted' });
    expect(decision.currentAcceptanceUnchanged).toBe(false);
    expect(decision.queuedRequirement).toBeUndefined();
  });

  it('queues a Requirement for later and leaves the acceptance alone (AC-016)', () => {
    const decision = evaluateBehaviourChoice({
      workId: ID,
      choice: 'later',
      summary: 'add an export button',
      decidedAt: TIME,
      evidenceRefs,
      removeOrChangePaths: ['src/list.ts'],
      sourceRequirementId: ID2,
    });
    expect(decision.queuedRequirement).toEqual({
      title: 'add an export button',
      goal: 'add an export button',
    });
    expect(decision.currentAcceptanceUnchanged).toBe(true);
    expect(decision.newProductRequired).toBe(false);
    expect(decision.invalidatedEvidenceRefs).toEqual([]);
    expect(decision.newPlanRequired).toBe(false);
  });

  it('declining records a reason and changes nothing (AC-016)', () => {
    const decision = evaluateBehaviourChoice({
      workId: ID,
      choice: 'decline',
      summary: 'out of scope for this requirement',
      decidedAt: TIME,
      evidenceRefs,
      removeOrChangePaths: ['src/list.ts'],
    });
    expect(decision.decision.state).toBe('rejected');
    expect(decision.reason).toBe('out of scope for this requirement');
    expect(decision.currentAcceptanceUnchanged).toBe(true);
    expect(decision.invalidatedEvidenceRefs).toEqual([]);
    expect(decision.queuedRequirement).toBeUndefined();
  });

  it('resolves the Requirement state for each branch (AC-016)', () => {
    expect(requirementStateForChoice('now', 'active')).toEqual({
      kind: 'current',
      lifecycle: 'active',
      phase: 'product',
    });
    expect(requirementStateForChoice('later', 'active')).toEqual({
      kind: 'queued',
      lifecycle: 'queued',
    });
    expect(requirementStateForChoice('decline', 'active')).toEqual({
      kind: 'current',
      lifecycle: 'active',
      unchanged: true,
    });
    // A terminal record cannot be revived by a "now" choice; it needs a new record.
    expect(requirementStateForChoice('now', 'archived')).toEqual({
      kind: 'queued',
      lifecycle: 'queued',
    });
  });

  it('invalidates by path and falls back to invalidating everything', () => {
    // Nothing can be proven unaffected: the whole evidence set is invalidated.
    expect(invalidateEvidenceForChoice(evidenceRefs)).toEqual({
      invalidated: evidenceRefs,
      reusable: [],
    });
    expect(invalidateEvidenceForChoice([], { affectedPaths: ['src/a.ts'] })).toEqual({
      invalidated: [],
      reusable: [],
    });
    // A ref that embeds the changed path is matched; the unrelated one survives.
    expect(
      invalidateEvidenceForChoice(['evidence:src/a.ts@1', 'evidence:docs/readme@2'], {
        affectedPaths: ['src/a.ts'],
      }),
    ).toEqual({
      invalidated: ['evidence:src/a.ts@1'],
      reusable: ['evidence:docs/readme@2'],
    });
    // An explicit ref list is authoritative over path matching.
    expect(
      invalidateEvidenceForChoice(evidenceRefs, {
        affectedRefs: ['evidence:global'],
        affectedPaths: ['src/list.ts'],
      }),
    ).toEqual({
      invalidated: ['evidence:global'],
      reusable: ['evidence:review-A', 'evidence:test-A'],
    });
  });
});

describe('findings (AC-017/AC-018/AC-019/AC-083)', () => {
  const openFinding = {
    state: 'open' as const,
    severity: 'P1' as const,
    targetKind: 'task' as const,
    taskId: ID3,
    reviewRunId: ID2,
    manifestId: ID,
    blocking: true,
  };

  const FIX_REV = 'f'.repeat(40);
  const reviewRun = {
    stage: 'review',
    reviewsCurrentRevision: true,
    evidenceValid: true,
    status: 'passed' as const,
    revision: FIX_REV,
  };
  const testRun = {
    stage: 'test',
    reviewsCurrentRevision: true,
    evidenceValid: true,
    status: 'passed' as const,
    revision: FIX_REV,
  };
  const fixingRevision = FIX_REV;

  it('returns work to development without a human forwarding step (AC-017)', () => {
    const routing = evaluateFindingRouting(openFinding);
    expect(routing.transition).toBe('return_to_development');
    expect(routing.requiresNewReview).toBe(true);
    expect(routing.requiresNewTest).toBe(true);
  });

  it('invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)', () => {
    const addressed = { ...openFinding, state: 'addressed' as const };

    // The required negative: the developer that fixed it cannot verify it.
    const selfVerify = findingCanBeVerified({
      finding: addressed,
      actorRole: 'backend',
      reviewRun,
      testRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
    });
    expect(selfVerify.ok).toBe(false);
    if (!selfVerify.ok) expect(selfVerify.code).toBe('NOT_AUTHORIZED');

    // Re-presenting the pre-fix evidence is not a new verification.
    const oldEvidence = findingCanBeVerified({
      finding: addressed,
      actorRole: 'review',
      reviewRun: { ...reviewRun, reviewsCurrentRevision: false },
      testRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
    });
    expect(oldEvidence.ok).toBe(false);
    if (!oldEvidence.ok) expect(oldEvidence.code).toBe('GATE_NOT_READY');

    // A new Review without a new Test is not closed either.
    const reviewOnly = findingCanBeVerified({
      finding: addressed,
      actorRole: 'review',
      reviewRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
    });
    expect(reviewOnly.ok).toBe(false);

    // A genuinely new independent pair verifies it.
    expect(
      findingCanBeVerified({
        finding: addressed,
        actorRole: 'review',
        reviewRun,
        testRun,
        fixingRevision,
        currentWorkRevision: FIX_REV,
      }),
    ).toEqual({ ok: true, state: 'verified' });
    // A review role may verify, a test role may too; neither may be the developer.
    expect(
      findingCanBeVerified({
        finding: addressed,
        actorRole: 'test',
        reviewRun,
        testRun,
        fixingRevision,
        currentWorkRevision: FIX_REV,
      }).ok,
    ).toBe(true);
    expect(
      findingCanBeVerified({
        finding: addressed,
        actorRole: 'frontend',
        reviewRun,
        testRun,
        fixingRevision,
        currentWorkRevision: FIX_REV,
      }).ok,
    ).toBe(false);
    // An open Finding is not verifiable at all.
    expect(
      findingCanBeVerified({
        finding: openFinding,
        actorRole: 'review',
        reviewRun,
        testRun,
        fixingRevision,
        currentWorkRevision: FIX_REV,
      }).ok,
    ).toBe(false);
  });

  it('binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08)', () => {
    const addressed = { ...openFinding, state: 'addressed' as const };
    const base = { finding: addressed, actorRole: 'review' as const };

    // A Review whose own evidence still belongs to the pre-fix revision is not a
    // verification of the fix, however new the Run is.
    const preFixReview = findingCanBeVerified({
      ...base,
      reviewRun: { ...reviewRun, revision: REV2 },
      testRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
    });
    expect(preFixReview.ok).toBe(false);
    if (!preFixReview.ok) expect(preFixReview.code).toBe('GATE_NOT_READY');

    // A Test that completed but concluded `failed` (or `not_covered`) cannot close
    // the Finding: `completed` is not `passed`.
    for (const status of ['failed', 'not_covered', 'blocked'] as const) {
      const notPassed = findingCanBeVerified({
        ...base,
        reviewRun,
        testRun: { ...testRun, status },
        fixingRevision,
        currentWorkRevision: FIX_REV,
      });
      expect(notPassed.ok).toBe(false);
      if (!notPassed.ok) expect(notPassed.code).toBe('GATE_NOT_READY');
    }

    // A Test Run that recorded no conclusion at all is refused, never assumed.
    const noConclusion = findingCanBeVerified({
      ...base,
      reviewRun,
      testRun: {
        stage: 'test',
        reviewsCurrentRevision: true,
        evidenceValid: true,
        revision: FIX_REV,
      },
      fixingRevision,
      currentWorkRevision: FIX_REV,
    });
    expect(noConclusion.ok).toBe(false);

    // Without a fixing revision there is nothing to bind to: fail closed.
    const unbound = findingCanBeVerified({ ...base, reviewRun, testRun });
    expect(unbound.ok).toBe(false);
    if (!unbound.ok) expect(unbound.code).toBe('GATE_NOT_READY');

    // W6R3-03: a fully new, passed Review/Test pair is still refused when the
    // fixing revision is one the Finding already invalidated — the closure cannot
    // be anchored back onto the rejected tree.
    const reanchored = findingCanBeVerified({
      ...base,
      reviewRun,
      testRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
      invalidatedRevisions: [FIX_REV],
    });
    expect(reanchored.ok).toBe(false);
    if (!reanchored.ok) {
      expect(reanchored.code).toBe('GATE_NOT_READY');
      expect(reanchored.message).toContain('invalidated');
    }
  });

  it('closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022)', () => {
    const addressed = { ...openFinding, state: 'addressed' as const };
    const closed = evaluateFindingClosure({
      finding: addressed,
      actorRole: 'review',
      reviewRun,
      testRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
    });
    expect(closed).toEqual({ closed: true, state: 'verified' });

    const exhausted = evaluateFindingClosure({
      finding: addressed,
      actorRole: 'review',
      reviewRun,
      testRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
      repairUsed: 3,
      repairLimit: 3,
    });
    expect(exhausted.closed).toBe(false);
    if (!exhausted.closed) {
      expect(exhausted.code).toBe('BUDGET_EXCEEDED');
      expect(exhausted.requiresNewReview).toBe(true);
    }
  });

  it('blocks completion for blocked and undisposed not_covered results (AC-019)', () => {
    const blocked = findingBlocksCompletion({
      status: 'blocked',
      uncovered: [],
    });
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) expect(blocked.code).toBe('GATE_NOT_READY');

    const notCovered = findingBlocksCompletion({
      status: 'not_covered',
      uncovered: [{ acceptanceId: 'AC-019', reason: 'no browser environment' }],
    });
    expect(notCovered.blocked).toBe(true);
    if (notCovered.blocked) {
      expect(notCovered.needsRiskDisposition).toEqual(['AC-019']);
    }

    // With an explicit user disposition the Gate opens; `blocked` never does.
    expect(
      findingBlocksCompletion({
        status: 'not_covered',
        uncovered: [
          { acceptanceId: 'AC-019', reason: 'no browser environment', riskDecisionId: ID3 },
        ],
      }).blocked,
    ).toBe(false);
    expect(findingBlocksCompletion({ status: 'passed', uncovered: [] }).blocked).toBe(false);
    expect(findingBlocksCompletion(undefined).blocked).toBe(true);
    expect(findingBlocksCompletion({ status: 'failed', uncovered: [] }).blocked).toBe(true);
  });

  it('binds a document/integration Finding without a taskId (AC-083)', () => {
    const targetRef: Ref = { id: ID, version: 1, hash: HASH };
    const manifestRef: Ref = { id: ID2, version: 2, hash: HASH2 };
    const binding = bindFindingTarget({
      target: { targetKind: 'document', targetRef },
      manifestRef,
    });
    expect(binding.ok).toBe(true);
    if (binding.ok) {
      expect(binding.taskId).toBeUndefined();
      expect(binding.manifestRef).toEqual(manifestRef);
    }
    const integration = bindFindingTarget({
      target: { targetKind: 'integration', targetRef },
      manifestRef,
    });
    expect(integration.ok).toBe(true);

    // A task target still needs a real task, and an incomplete Manifest is refused.
    const missingTask = bindFindingTarget({
      target: { targetKind: 'task', targetRef },
      manifestRef,
    });
    expect(missingTask.ok).toBe(false);
    if (!missingTask.ok) expect(missingTask.code).toBe('VALIDATION_ERROR');
    expect(
      bindFindingTarget({
        target: { targetKind: 'task', taskId: ID3, targetRef },
        manifestRef,
      }).ok,
    ).toBe(true);
    expect(
      bindFindingTarget({
        target: { targetKind: 'document', targetRef },
        manifestRef: { id: '', version: 1, hash: '' },
      }).ok,
    ).toBe(false);
  });

  it('routes a document Finding through the same closure rules (AC-083)', () => {
    const documentFinding = {
      state: 'addressed' as const,
      severity: 'P2' as const,
      targetKind: 'document' as const,
      reviewRunId: ID2,
      manifestId: ID,
      blocking: false,
    };
    const closure = evaluateFindingClosure({
      finding: documentFinding,
      actorRole: 'review',
      reviewRun,
      testRun,
      fixingRevision,
      currentWorkRevision: FIX_REV,
    });
    expect(closure).toEqual({ closed: true, state: 'verified' });
  });
});

describe('budget reservation (AC-022)', () => {
  const budget: ReservationBudget = { tokenLimit: 1000, tokensUsed: 100, tokensReserved: 800 };

  it('refuses an over-limit reservation atomically with no partial charge (AC-022)', () => {
    const decision = canReserveBudget({ budget, requested: 200 });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('BUDGET_EXCEEDED');
      expect(decision.requiresUserTopUp).toBe(true);
      // Atomic: the caller cannot persist a partially applied reservation.
      expect(decision.budgetAfter).toEqual(budget);
    }
    // The refused attempt did not mutate the input either.
    expect(budget.tokensReserved).toBe(800);
  });

  it('admits a reservation that fits, even just under the limit (AC-022)', () => {
    const decision = canReserveBudget({ budget, requested: 100 });
    expect(decision.ok).toBe(true);
    expect(decision.requiresUserTopUp).toBe(false);
    expect(decision.budgetAfter).toEqual({ ...budget, tokensReserved: 900 });
    expect(canReserveBudget({ budget, requested: 101 }).ok).toBe(false);
    expect(canReserveBudget({ budget, requested: -1 }).code).toBe('VALIDATION_ERROR');
  });

  it('reports that a top-up must be explicit and user sourced (AC-022)', () => {
    const refused = canReserveBudget({ budget, requested: 200 }, true);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('explicitly');
    expect(refused.requiresUserTopUp).toBe(true);
    // After the user raises the limit the same request fits — nothing was silently
    // topped up before that.
    expect(canReserveBudget({ budget: { ...budget, tokenLimit: 1100 }, requested: 200 }).ok).toBe(
      true,
    );
  });

  it('refuses the next rework round once the repair allowance is spent (AC-022)', () => {
    expect(evaluateReworkAllowance({ repairUsed: 2, repairLimit: 3 })).toMatchObject({
      ok: true,
      requiresUserTopUp: false,
    });
    const exhausted = evaluateReworkAllowance({ repairUsed: 3, repairLimit: 3 });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.code).toBe('BUDGET_EXCEEDED');
    expect(exhausted.requiresUserTopUp).toBe(true);
    expect(exhausted.repairLimit).toBe(3);
  });
});

/**
 * The shared evidence-validity + revision-lineage primitive (W6R2-01…W6R2-05).
 *
 * Completion, Finding closure and level re-evaluation all consult this one rule,
 * so each of its clauses is pinned here rather than only through its consumers.
 */
describe('evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05)', () => {
  const evidence = (
    overrides: Partial<Parameters<typeof evaluateEvidenceValidity>[0]['evidence']> = {},
  ) => ({
    ref: 'artifact-1',
    kind: 'test',
    validity: 'valid' as const,
    revision: REV,
    createdAt: TIME,
    ...overrides,
  });

  it('accepts only valid evidence frozen on the Work revision', () => {
    const decision = evaluateEvidenceValidity({
      evidence: evidence(),
      lineage: { workRevision: REV },
    });
    expect(decision.valid).toBe(true);
    expect(decision.code).toBe('VALID');
    expect(decision.revision).toBe(REV);
    expect(evidenceBindsRevision({ evidence: evidence(), lineage: { workRevision: REV } })).toBe(
      true,
    );
    expect(evidenceBindsRevision({ evidence: evidence(), lineage: { workRevision: REV2 } })).toBe(
      false,
    );
  });

  it('refuses invalidated evidence whatever revision it names (AC-017)', () => {
    for (const validity of ['invalid', 'superseded'] as const) {
      const decision = evaluateEvidenceValidity({
        evidence: evidence({ validity }),
        lineage: { workRevision: REV },
      });
      expect(decision.valid).toBe(false);
      expect(decision.code).toBe('INVALIDATED');
      expect(decision.message).toContain(validity);
    }
  });

  it('fails closed on evidence without a revision and on a Work without one (W6R2-04)', () => {
    const noRevision = evaluateEvidenceValidity({
      evidence: { ref: 'artifact-1', kind: 'test', validity: 'valid' },
      lineage: { workRevision: REV },
    });
    expect(noRevision.code).toBe('NO_REVISION');

    const unbound = evaluateEvidenceValidity({ evidence: evidence(), lineage: {} });
    expect(unbound.valid).toBe(false);
    // The old completion gate skipped the revision comparison entirely when
    // `work.baseRevision` was missing; the rule refuses instead.
    expect(unbound.code).toBe('REVISION_UNBOUND');
  });

  it('refuses an explicitly invalidated revision even when the evidence claims valid', () => {
    const decision = evaluateEvidenceValidity({
      evidence: evidence(),
      lineage: { workRevision: REV, invalidatedRevisions: [REV] },
    });
    expect(decision.code).toBe('INVALIDATED');
  });

  it('refuses pre-fix evidence and evidence produced at or before the fix (W6R2-01/03)', () => {
    const preFix = evaluateEvidenceValidity({
      evidence: evidence(),
      lineage: { workRevision: REV2, fixingRevision: REV2 },
    });
    expect(preFix.valid).toBe(false);
    expect(preFix.code).toBe('PRE_FIX_REVISION');

    const tooEarly = evaluateEvidenceValidity({
      evidence: evidence(),
      lineage: { workRevision: REV, fixingRevision: REV, producedAfter: TIME },
    });
    expect(tooEarly.valid).toBe(false);
    expect(tooEarly.code).toBe('PRODUCED_BEFORE_FIX');

    const after = evaluateEvidenceValidity({
      evidence: evidence(),
      lineage: {
        workRevision: REV,
        fixingRevision: REV,
        producedAfter: '2026-09-10T00:00:00.000Z',
      },
    });
    expect(after.valid).toBe(true);
  });

  it('refuses evidence bound to a different revision than the Work (binding, not order)', () => {
    const decision = evaluateEvidenceValidity({
      evidence: evidence(),
      lineage: { workRevision: REV2 },
    });
    expect(decision.valid).toBe(false);
    expect(decision.code).toBe('REVISION_MISMATCH');
    expect(decision.revision).toBe(REV);
  });
});

describe('route-aware completion evidence (AC-007/AC-012/AC-019, W6R2-09)', () => {
  it('selects a Test for code L2/L3 and the route Review otherwise', () => {
    expect(completionEvidenceKindFor('code', 'L2')).toBe('test');
    expect(completionEvidenceKindFor('code', 'L3')).toBe('test');
    // AC-007: the L1 chain has no Test stage, so L1 completes on its ReviewCheck.
    expect(completionEvidenceKindFor('code', 'L1')).toBe('review');
    // AC-012: the document lane has no code Test either.
    expect(completionEvidenceKindFor('document', 'L2')).toBe('review');
    expect(completionEvidenceKindFor('operation', 'L2')).toBe('review');
    // An undefined combination is not a rule: the caller must fail closed.
    expect(completionEvidenceKindFor('code', 'none')).toBeUndefined();
  });
});

describe('the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02)', () => {
  it('admits writes only while the Work is running', () => {
    // W6R3-02: the rule is a whitelist. The old test asserted the complement
    // (only paused/cancelling/cancelled blocked), which left `completed`,
    // `blocked`, `failed` and `queued` admitting writes and emitting
    // `delivery.write_admitted` events.
    expect(workWriteBarrier('running').blocked).toBe(false);
    for (const status of [
      'queued',
      'paused',
      'cancelling',
      'cancelled',
      'completed',
      'blocked',
      'failed',
    ] as const) {
      const barrier = workWriteBarrier(status);
      expect(barrier.blocked).toBe(true);
      if (barrier.blocked) {
        expect(barrier.code).toBe('INVALID_STATE');
        expect(barrier.message).toContain(status);
      }
    }
  });

  it('never lets a caller expectation replace the approved source hash (W6R2-02)', () => {
    const planRevision: PlanRevision = { ...plan, revision: REV };
    const base = {
      plan: planRevision,
      revision: REV,
      work: { id: ID, revision: REV, level: 'L2' as const },
      authorizedTargets: ['src/'],
      planHash: HASH,
      diffHash: HASH2,
    };
    // The source moved. Handing the gate the moved value as the caller's own
    // expectation used to select the gate out of moved-source detection.
    const override = evaluateWriteGate({
      ...base,
      expectedSourceHash: HASH,
      actualSourceHash: HASH2,
      callerExpectedSourceHash: HASH2,
    });
    expect(override.ok).toBe(false);
    if (!override.ok) expect(override.gaps.join(' ')).toContain('source hash changed');

    // A matching expectation adds nothing when the approved hash still matches.
    expect(
      evaluateWriteGate({
        ...base,
        expectedSourceHash: HASH,
        actualSourceHash: HASH,
        callerExpectedSourceHash: HASH,
      }).ok,
    ).toBe(true);
    // ...and a mismatching one refuses even then.
    const callerOnly = evaluateWriteGate({
      ...base,
      expectedSourceHash: HASH,
      actualSourceHash: HASH,
      callerExpectedSourceHash: HASH2,
    });
    expect(callerOnly.ok).toBe(false);
  });
});

describe('level re-evaluation consults the evidence rule (W6R2-06 lineage)', () => {
  const upgradeDiff: ChangeDiff = { ...typoDiff, filesChanged: 5, diffLines: 40 };

  it('does not supersede a Plan the persisted validity already rejects', () => {
    const invalidated = evaluateLevelUpgrade({
      previousLevel: 'L1',
      diff: upgradeDiff,
      logicChange: false,
      plan: { ...plan, validity: 'invalid' },
      workRevision: REV,
    });
    expect(invalidated.outcome).toBe('upgrade');
    // The Plan was already dead: this upgrade is not what supersedes it.
    expect(invalidated.stalePlan).toBe(false);
    expect(invalidated.planEvidence?.code).toBe('INVALIDATED');

    const bound = evaluateLevelUpgrade({
      previousLevel: 'L1',
      diff: upgradeDiff,
      logicChange: false,
      plan,
      workRevision: REV,
    });
    expect(bound.stalePlan).toBe(true);
    expect(bound.planEvidence?.valid).toBe(true);

    // A Plan bound to another revision is not the current authority either.
    const foreign = evaluateLevelUpgrade({
      previousLevel: 'L1',
      diff: upgradeDiff,
      logicChange: false,
      plan,
      workRevision: REV2,
    });
    expect(foreign.stalePlan).toBe(false);
    expect(foreign.planEvidence?.code).toBe('REVISION_MISMATCH');
  });
});
