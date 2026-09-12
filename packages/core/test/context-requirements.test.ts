/**
 * The per-stage required-input table (`docs/architecture/context.md` §1,
 * `docs/rules/agents.md` §2, `AC-079`).
 *
 * The four `AC-079` positives are asserted directly: an empty Project starting
 * `initialize`, a Product stage in that Project, a Planning stage holding only a
 * ProductDefinition, and an L1 Develop holding only a CompactPlan. The negatives
 * prove the other half of the rule: a genuinely missing upstream input must fail
 * with `MISSING_CONTEXT` and a precise gap, while a future artifact must not.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_INPUT_KEYS,
  CONTEXT_STAGES,
  roleStagePairs,
  type ContextInputKey,
  type ContextRole,
  type ContextSelection,
  type ContextStage,
} from '../src/context/index.js';
import {
  CONTEXT_REQUIREMENTS,
  INPUT_CATALOG,
  INPUT_KEYS,
  absenceIsLegal,
  availabilityFromSelection,
  evaluateRequirements,
  inputKeyForSource,
  isAssertableInputKey,
  isInputRequired,
  referencesFutureArtifact,
  requiredInputRow,
  requirementRows,
  selectionGaps,
  stagePrecedesArtifact,
} from '../src/context/requirements.js';

/** A selection with one `git` source per given path, each with a reason. */
function selectionOf(
  entries: readonly { readonly id: string; readonly path?: string; readonly reason?: string }[],
): ContextSelection {
  return {
    goal: '实现 WP-05 context 层',
    sourceRefs: entries.map((entry) => ({
      kind: 'git' as const,
      id: entry.id,
      version: 'revision-1',
      ...(entry.path === undefined ? {} : { path: entry.path }),
    })),
    reasonPerSource: Object.fromEntries(
      entries
        .filter((entry) => entry.reason !== undefined)
        .map((entry) => [`git:${entry.id}`, entry.reason as string]),
    ),
    featureRefs: [],
    codePaths: [],
    artifactRefs: [],
    excluded: [],
    unknowns: [],
    readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
  };
}

describe('context requirements — table integrity', () => {
  it('catalogs every input key exactly once', () => {
    expect(INPUT_KEYS).toEqual(CONTEXT_INPUT_KEYS);
    for (const key of CONTEXT_INPUT_KEYS) {
      expect(INPUT_CATALOG[key], key).toBeDefined();
      expect(INPUT_CATALOG[key].description.length, key).toBeGreaterThan(0);
      expect(INPUT_CATALOG[key].key).toBe(key);
    }
  });

  it('classifies every documented key in every row', () => {
    for (const rule of requirementRows()) {
      const classified = new Set<ContextInputKey>([
        ...rule.required,
        ...rule.optional,
        ...rule.allowedAbsent,
        ...rule.notApplicable,
      ]);
      for (const key of CONTEXT_INPUT_KEYS) {
        expect(classified.has(key), `${rule.role}:${rule.stage} ${key}`).toBe(true);
      }
    }
  });

  it('lists every key a row requires as either classified or not-applicable', () => {
    for (const rule of requirementRows()) {
      const alternatives = new Set(rule.oneOf.flat());
      for (const key of rule.required) {
        // A key may be "required" and exempt only as a `oneOf` alternative, where
        // the group check is what enforces the choice.
        expect(
          !rule.optional.includes(key) &&
            (!rule.allowedAbsent.includes(key) || alternatives.has(key)),
          `${rule.role}:${rule.stage} ${key} must not be both required and exempt`,
        ).toBe(true);
      }
      for (const key of rule.optional) {
        expect(rule.required, `${rule.role}:${rule.stage} ${key}`).not.toContain(key);
      }
      for (const key of rule.allowedAbsent) {
        if (alternatives.has(key)) continue;
        expect(rule.required, `${rule.role}:${rule.stage} ${key}`).not.toContain(key);
      }
    }
  });

  it('covers exactly the canonical role/stage pairs of the ACL', () => {
    const tablePairs = new Set(requirementRows().map((rule) => `${rule.role}:${rule.stage}`));
    for (const [role, stage] of roleStagePairs()) {
      expect(tablePairs.has(`${role}:${stage}`), `${role}:${stage}`).toBe(true);
    }
    expect(tablePairs.size).toBe(roleStagePairs().length);
  });

  it('classifies every catalog key somewhere in the table', () => {
    const seen = new Set<ContextInputKey>();
    for (const rule of requirementRows()) {
      for (const key of [...rule.required, ...rule.optional, ...rule.allowedAbsent]) seen.add(key);
    }
    for (const key of CONTEXT_INPUT_KEYS) {
      if (INPUT_CATALOG[key].forbidden === true) continue;
      expect(seen.has(key), key).toBe(true);
    }
  });

  it('never lists a required input twice or in two columns by accident', () => {
    for (const rule of requirementRows()) {
      expect(new Set(rule.required).size, `${rule.role}:${rule.stage}`).toBe(rule.required.length);
      expect(new Set(rule.optional).size, `${rule.role}:${rule.stage}`).toBe(rule.optional.length);
    }
  });

  it('lists every requirement row in the canonical stage vocabulary', () => {
    for (const rule of requirementRows()) {
      expect(CONTEXT_STAGES).toContain(rule.stage);
      expect(rule.documentedAs.length).toBeGreaterThan(0);
    }
  });

  it('has no row that still requires a future artifact (AC-079)', () => {
    for (const rule of requirementRows()) {
      expect(referencesFutureArtifact(rule), `${rule.role}:${rule.stage}`).toEqual([]);
    }
  });

  it('marks a downstream artifact as unproduced for an earlier stage', () => {
    expect(stagePrecedesArtifact('planning', 'review')).toBe(true);
    expect(stagePrecedesArtifact('planning', 'product')).toBe(false);
    expect(stagePrecedesArtifact('develop-L1', 'plan')).toBe(false);
    expect(stagePrecedesArtifact('develop-L1', 'review')).toBe(true);
  });

  it('rules on a legal pair and stays silent on an illegal one', () => {
    expect(requiredInputRow('review', 'review')).toBeDefined();
    expect(requiredInputRow('review', 'develop-L2')).toBeUndefined();
    expect(isInputRequired('review', 'develop-L2', 'plan')).toBe(false);
    expect(absenceIsLegal('review', 'develop-L2', 'plan')).toBe(false);
    expect(CONTEXT_REQUIREMENTS['review:review']?.role).toBe('review');
  });
});

describe('context requirements — AC-079 positives', () => {
  it('starts initialize in an empty Project with no overview/Product/Plan', () => {
    // The empty Project has no `docs/INDEX.md`, no ProductDefinition and no Plan;
    // only the BootstrapObservation (trusted paths, user goal, read sources,
    // unknowns) exists, and that is exactly what `context.md` §4 allows.
    const result = evaluateRequirements({
      role: 'chief',
      stage: 'initialize',
      available: {
        roleContract: true,
        bootstrapObservation: true,
        userRequest: true,
        workGoal: true,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gaps).toEqual([]);
    expect(result.absentAllowed).toEqual(
      expect.arrayContaining(['productDefinition', 'plan', 'compactPlan', 'taskAcceptance']),
    );
  });

  it('rejects initialize when neither the overview nor a BootstrapObservation exists', () => {
    const result = evaluateRequirements({
      role: 'chief',
      stage: 'initialize',
      available: { roleContract: true, userRequest: true, workGoal: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(['MISSING_CONTEXT']);
    expect(result.errors[0]?.message).toContain('projectOverview 或 bootstrapObservation');
  });

  it('runs a Product stage in that same empty Project', () => {
    const result = evaluateRequirements({
      role: 'product',
      stage: 'product',
      available: {
        roleContract: true,
        bootstrapObservation: true,
        userRequest: true,
        workGoal: true,
        confirmedSource: true,
        currentFacts: true,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No downstream Plan / Task / Review requirement may gate Product.
    expect(result.absentAllowed).toEqual(
      expect.arrayContaining(['plan', 'compactPlan', 'taskAcceptance', 'dependencyArtifacts']),
    );
  });

  it('runs Planning with a ProductDefinition and no Plan (future artifact)', () => {
    const result = evaluateRequirements({
      role: 'planning',
      stage: 'planning',
      available: {
        roleContract: true,
        userRequest: true,
        productDefinition: true,
        acceptance: true,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absentAllowed).toContain('taskAcceptance');
    expect(result.absentAllowed).toContain('dependencyArtifacts');
    expect(result.absentAllowed).toContain('testEvidence');
  });

  it('runs an L1 Develop with only a CompactPlan and no full Plan/Task', () => {
    const result = evaluateRequirements({
      role: 'backend',
      stage: 'develop-L1',
      available: {
        roleContract: true,
        userRequest: true,
        workGoal: true,
        compactPlan: true,
        replacementTarget: true,
        currentFiles: true,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.satisfied).toContain('compactPlan');
    expect(result.absentAllowed).toEqual(
      expect.arrayContaining([
        'productDefinition',
        'plan',
        'taskAcceptance',
        'dependencyArtifacts',
      ]),
    );
  });

  it('accepts an L1 document check with either a CompactPlan or a Plan', () => {
    for (const available of [{ compactPlan: true }, { plan: true }] as const) {
      const result = evaluateRequirements({
        role: 'review',
        stage: 'document_check',
        available: {
          roleContract: true,
          confirmedSource: true,
          frozenDiff: true,
          applicableChecks: true,
          ...available,
        },
      });
      expect(result.ok, JSON.stringify(available)).toBe(true);
    }
  });
});

describe('context requirements — AC-079 negatives', () => {
  it('fails Planning without a ProductDefinition and names the gap', () => {
    const result = evaluateRequirements({
      role: 'planning',
      stage: 'planning',
      available: { roleContract: true, userRequest: true, acceptance: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(['MISSING_CONTEXT']);
    expect(result.errors[0]?.input).toBe('productDefinition');
    expect(result.errors[0]?.message).toContain('productDefinition');
  });

  it('fails L2 Develop without the Plan and lists every missing upstream input', () => {
    const result = evaluateRequirements({
      role: 'backend',
      stage: 'develop-L2',
      available: { roleContract: true, userRequest: true, workGoal: true, authorization: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.input)).toEqual(
      expect.arrayContaining(['productDefinition', 'acceptance', 'plan', 'taskAcceptance']),
    );
    for (const error of result.errors) {
      expect(error.code).toBe('MISSING_CONTEXT');
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('fails Test without a valid Review', () => {
    const result = evaluateRequirements({
      role: 'test',
      stage: 'test',
      available: {
        roleContract: true,
        plan: true,
        acceptance: true,
        frozenCode: true,
        environment: true,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.input)).toContain('reviewResult');
  });

  it('fails Settlement without the final verification result', () => {
    const result = evaluateRequirements({
      role: 'settlement',
      stage: 'settlement',
      available: { roleContract: true, impactSet: true, knowledgeDiff: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.input)).toContain('verificationResult');
  });

  it('rejects a forbidden input even when everything required is present', () => {
    for (const key of ['transcript', 'otherProject', 'secret'] as const) {
      const result = evaluateRequirements({
        role: 'review',
        stage: 'review',
        available: {
          roleContract: true,
          productDefinition: true,
          acceptance: true,
          plan: true,
          frozenDiff: true,
          frozenCode: true,
          applicableChecks: true,
          [key]: true,
        },
      });
      expect(result.ok, key).toBe(false);
      if (result.ok) continue;
      expect(result.errors.map((error) => error.code)).toContain('CONTEXT_FORBIDDEN');
      expect(result.errors.map((error) => error.input)).toContain(key);
    }
  });

  it('returns VALIDATION_ERROR for a pair the table does not define', () => {
    // The table, not the caller, is what declares a pair legal: an unknown role or
    // stage must be refused even though the type system says it cannot happen.
    const role: ContextRole = 'test';
    // A value outside the vocabulary, as an untyped caller could still send.
    const stage = 'not-a-stage' as unknown as ContextStage;
    const result = evaluateRequirements({ role, stage, available: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe('VALIDATION_ERROR');
  });
});

describe('context requirements — selection-derived availability', () => {
  it('derives the input keys of the four positive cases from a selection', () => {
    const availability = availabilityFromSelection(
      selectionOf([
        { id: 'docs/rules/agents.md', path: 'docs/rules/agents.md', reason: '角色契约' },
        { id: 'docs/INDEX.md', path: 'docs/INDEX.md', reason: 'Project 概览' },
        {
          id: 'features/F-a1b2c3d4/README.md',
          path: 'features/F-a1b2c3d4/README.md',
          reason: '导航',
        },
      ]),
    );
    expect(availability.inputs.roleContract).toBe(true);
    expect(availability.inputs.projectOverview).toBe(true);
    expect(availability.inputs.featureNavigation).toBe(true);
    expect(availability.evidence['projectOverview']).toBe('git:docs/INDEX.md');
    expect(availability.unmapped).toEqual([]);
  });

  it('leaves a plain source path unmapped, because a file is not an input key', () => {
    // `src/orders/cancel.ts` is a real selected source, but it is not the logical
    // input of any table row: the stage names `currentFiles` instead, so mapping the
    // path to an input would let a requirement pass on an unselected guess.
    const availability = availabilityFromSelection(
      selectionOf([
        { id: 'docs/INDEX.md', path: 'docs/INDEX.md', reason: '概览' },
        { id: 'src/orders/cancel.ts', path: 'src/orders/cancel.ts', reason: '当前文件' },
      ]),
    );
    expect(availability.unmapped.map((source) => source.id)).toEqual(['src/orders/cancel.ts']);
  });

  it('classifies an artifact path into the input it supplies', () => {
    expect(
      inputKeyForSource({
        kind: 'artifact',
        id: '0191f000-0000-7000-8000-0000000000aa',
        version: '1',
        path: 'artifacts/product/abcd',
      }),
    ).toBe('productDefinition');
    expect(
      inputKeyForSource({
        kind: 'artifact',
        id: '0191f000-0000-7000-8000-0000000000aa',
        version: '1',
        path: 'artifacts/plan/abcd',
        artifactClass: 'plan',
      }),
    ).toBe('plan');
    expect(
      inputKeyForSource({
        kind: 'artifact',
        id: '0191f000-0000-7000-8000-0000000000aa',
        version: '1',
        path: 'artifacts/diff/abcd',
      }),
    ).toBe('frozenDiff');
    expect(inputKeyForSource({ kind: 'message', id: 'm-1', version: '1', sender: 'user' })).toBe(
      'userRequest',
    );
    expect(
      inputKeyForSource({ kind: 'message', id: 'm-2', version: '1', sender: 'role' }),
    ).toBeNull();
    expect(
      inputKeyForSource({ kind: 'role_contract', id: 'docs/rules/agents.md', version: '1' }),
    ).toBe('roleContract');
    expect(inputKeyForSource({ kind: 'knowledge', id: 'F-a1b2c3d4', version: '1' })).toBeNull();
    expect(inputKeyForSource({ kind: 'git', id: 'src/a.ts', version: '1' })).toBeNull();
  });

  it('maps an L1 plan artifact onto the CompactPlan input, never the full Plan', () => {
    expect(
      inputKeyForSource({
        kind: 'artifact',
        id: '0191f000-0000-7000-8000-0000000000aa',
        version: '1',
        path: 'artifacts/plan/l1-compact-plan',
      }),
    ).toBe('compactPlan');
    expect(
      inputKeyForSource({
        kind: 'artifact',
        id: '0191f000-0000-7000-8000-0000000000aa',
        version: '1',
        path: 'artifacts/plan/v3',
      }),
    ).toBe('plan');
  });

  it('reports an unmapped source instead of guessing an input', () => {
    const availability = availabilityFromSelection(
      selectionOf([{ id: 'src/orders/cancel.ts', path: 'src/orders/cancel.ts', reason: '代码' }]),
    );
    expect(availability.inputs).toEqual({});
    expect(availability.unmapped.map((source) => source.id)).toEqual(['src/orders/cancel.ts']);
  });

  it('drives evaluateRequirements end to end for the L1 case', () => {
    const availability = availabilityFromSelection(
      selectionOf([
        { id: 'docs/rules/agents.md', path: 'docs/rules/agents.md', reason: '角色契约' },
        { id: 'artifacts/plan/l1', path: 'artifacts/plan/l1', reason: 'CompactPlan' },
        { id: 'src/orders/cancel.ts', path: 'src/orders/cancel.ts', reason: '当前文件' },
      ]),
    );
    const result = evaluateRequirements({
      role: 'frontend',
      stage: 'develop-L1',
      available: {
        ...availability.inputs,
        userRequest: true,
        workGoal: true,
        replacementTarget: true,
        currentFiles: true,
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe('context requirements — selection reasons', () => {
  it('turns a sourceRef without a reason into a gap', () => {
    const gaps = selectionGaps(
      selectionOf([
        { id: 'docs/INDEX.md', path: 'docs/INDEX.md', reason: '概览' },
        { id: 'src/orders/cancel.ts', path: 'src/orders/cancel.ts' },
      ]),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.code).toBe('MISSING_CONTEXT');
    expect(gaps[0]?.message).toContain('git:src/orders/cancel.ts');
    expect(gaps[0]?.ref?.id).toBe('src/orders/cancel.ts');
  });

  it('turns an artifactRef without a reason into a gap', () => {
    const selection: ContextSelection = {
      ...selectionOf([]),
      artifactRefs: [
        { id: '0191f000-0000-7000-8000-0000000000aa', version: 1, hash: 'a'.repeat(64) },
      ],
    };
    const gaps = selectionGaps(selection);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.code).toBe('MISSING_CONTEXT');
    expect(gaps[0]?.message).toContain('artifact:0191f000-0000-7000-8000-0000000000aa');
    expect(gaps[0]?.ref?.kind).toBe('artifact');
  });

  it('accepts a selection where every entry has a reason', () => {
    const gaps = selectionGaps(
      selectionOf([
        { id: 'docs/INDEX.md', path: 'docs/INDEX.md', reason: '概览' },
        { id: 'src/orders/cancel.ts', path: 'src/orders/cancel.ts', reason: '代码' },
      ]),
    );
    expect(gaps).toEqual([]);
  });

  it('treats a blank reason as missing', () => {
    const gaps = selectionGaps(
      selectionOf([{ id: 'docs/INDEX.md', path: 'docs/INDEX.md', reason: '   ' }]),
    );
    expect(gaps).toHaveLength(1);
  });

  it('keeps missing reasons out of the availability record', () => {
    const availability = availabilityFromSelection(
      selectionOf([{ id: 'docs/INDEX.md', path: 'docs/INDEX.md' }]),
    );
    const result = evaluateRequirements({
      role: 'chief',
      stage: 'initialize',
      available: { ...availability.inputs, userRequest: true, workGoal: true },
    });
    expect(result.ok).toBe(false);
  });
});

describe('context requirements — helper predicates', () => {
  it('answers required/absent-legal for documented rows', () => {
    expect(isInputRequired('review', 'review', 'frozenDiff')).toBe(true);
    expect(isInputRequired('review', 'review', 'testEvidence')).toBe(false);
    expect(absenceIsLegal('review', 'review', 'testEvidence')).toBe(false);
    expect(absenceIsLegal('backend', 'develop-L1', 'plan')).toBe(true);
    expect(absenceIsLegal('test', 'test', 'knowledgeDiff')).toBe(true);
  });

  it('never requires a forbidden key anywhere', () => {
    for (const rule of requirementRows()) {
      for (const key of rule.required) {
        expect(INPUT_CATALOG[key].forbidden ?? false, `${rule.role}:${rule.stage} ${key}`).toBe(
          false,
        );
      }
    }
  });

  it('exposes a positive requirement count for every row', () => {
    for (const rule of requirementRows()) {
      expect(rule.required.length, `${rule.role}:${rule.stage}`).toBeGreaterThan(0);
    }
  });

  it('only lets a handle-less input be asserted by the caller (W5R2-04)', () => {
    // Initialization/meta inputs have no artifact class and no path prefix, so a
    // caller assertion is the only way to supply them.
    for (const key of ['bootstrapObservation', 'acceptance', 'workGoal', 'currentFacts'] as const) {
      expect(isAssertableInputKey(key), key).toBe(true);
    }
    // Artifact-backed and path-backed inputs must come from a resolved source: an
    // assertion would otherwise satisfy Planning's upstream ProductDefinition.
    for (const key of [
      'productDefinition',
      'plan',
      'compactPlan',
      'frozenDiff',
      'reviewResult',
      'testEvidence',
      'projectOverview',
      'roleContract',
      'applicableRules',
      'featureNavigation',
    ] as const) {
      expect(isAssertableInputKey(key), key).toBe(false);
    }
  });
});
