import { describe, expect, it } from 'vitest';
import {
  diagnoseLinks,
  resolveSourceRef,
  type Feature,
  type FeatureSectionBody,
  type SourceResolutionContext,
} from '../src/index.js';

const REVISION = '9f2c1a4b8d3e5f60718293a4b5c6d7e8f9012345';
const OTHER_REVISION = '0123456789abcdef0123456789abcdef01234567';
const FEATURE_ID = 'F-1a2b3c4d';
const TARGET_ID = 'F-5e6f7a8b';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const UNKNOWN_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4eff';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61';
const ARTIFACT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';

const TREE = ['src/orders/cancel.ts', 'product/payment.md', 'tests/'];

function section(heading: string): FeatureSectionBody {
  return { heading, text: '', items: [] };
}

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    featureId: FEATURE_ID,
    name: '订单取消',
    module: 'orders',
    ownerDocument: `features/${FEATURE_ID}/README.md`,
    design: 'confirmed',
    designDecisionRefs: [`decision:${DECISION_ID}`],
    implementation: 'implemented',
    verification: 'passed',
    verificationEvidenceRefs: [`artifact:${ARTIFACT_ID}@1`],
    verificationCoverage: ['未付款可取消'],
    investigation: 'investigated',
    investigationScope: ['订单取消路由'],
    sourceRefs: [`git:${REVISION}:src/orders/cancel.ts`],
    revision: REVISION,
    relations: [
      {
        targetFeatureId: TARGET_ID,
        kind: 'constrained_by',
        reason: '付款状态决定可取消范围',
        source: 'product/payment.md',
      },
    ],
    sections: {
      purpose: section('用途'),
      currentBehaviour: section('当前行为'),
      entries: section('实现入口'),
      gaps: section('已知差距'),
      decisions: section('关键决定'),
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<SourceResolutionContext> = {}): SourceResolutionContext {
  return {
    trees: new Map([[REVISION, TREE]]),
    currentPaths: TREE,
    decisionIds: [DECISION_ID],
    requirementIds: [REQUIREMENT_ID],
    artifacts: new Map([[ARTIFACT_ID, ['1', '2']]]),
    ...overrides,
  };
}

describe('resolveSourceRef', () => {
  const ctx = makeContext();

  it('resolves git, decision, artifact and requirement refs', () => {
    expect(resolveSourceRef(`git:${REVISION}:src/orders/cancel.ts`, ctx)).toEqual({
      ok: true,
      kind: 'git',
      id: REVISION,
      path: 'src/orders/cancel.ts',
    });
    expect(resolveSourceRef(`decision:${DECISION_ID}`, ctx)).toEqual({
      ok: true,
      kind: 'decision',
      id: DECISION_ID,
    });
    expect(resolveSourceRef(`artifact:${ARTIFACT_ID}@2`, ctx)).toEqual({
      ok: true,
      kind: 'artifact',
      id: ARTIFACT_ID,
      version: '2',
    });
    expect(resolveSourceRef(`requirement:${REQUIREMENT_ID}`, ctx)).toEqual({
      ok: true,
      kind: 'requirement',
      id: REQUIREMENT_ID,
    });
  });

  it('resolves a bare repo-relative path against the frozen revision', () => {
    expect(resolveSourceRef('product/payment.md', ctx)).toEqual({
      ok: true,
      kind: 'git',
      id: 'product/payment.md',
      path: 'product/payment.md',
    });
    expect(resolveSourceRef(`git:${REVISION}:tests`, ctx).ok).toBe(true);
  });

  it('reports broken links with a typed code', () => {
    const cases: readonly (readonly [string, string])[] = [
      [`git:${OTHER_REVISION}:src/orders/cancel.ts`, 'NOT_FOUND'],
      [`git:${REVISION}:src/orders/missing.ts`, 'NOT_FOUND'],
      ['src/orders/missing.ts', 'NOT_FOUND'],
      [`decision:${UNKNOWN_DECISION_ID}`, 'NOT_FOUND'],
      ['requirement:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4eff', 'NOT_FOUND'],
      [`artifact:${ARTIFACT_ID}@9`, 'ARTIFACT_MISSING'],
      ['artifact:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4eff@1', 'ARTIFACT_MISSING'],
      [`git:${REVISION}`, 'KNOWLEDGE_INVALID'],
      ['', 'KNOWLEDGE_INVALID'],
      ['policy:knowledge-v1', 'KNOWLEDGE_INVALID'],
      ['decision:<真实ID>', 'KNOWLEDGE_INVALID'],
      [`artifact:${ARTIFACT_ID}`, 'KNOWLEDGE_INVALID'],
    ];
    for (const [ref, code] of cases) {
      const result = resolveSourceRef(ref, ctx);
      expect(result.ok, `expected ${ref} to fail`).toBe(false);
      if (result.ok) continue;
      expect(result.code, ref).toBe(code);
      expect(result.reason.length, ref).toBeGreaterThan(0);
    }
  });
});

describe('diagnoseLinks', () => {
  it('reports nothing for a fully resolvable feature', () => {
    const diagnostics = diagnoseLinks([makeFeature()], {
      sources: makeContext(),
      knownFeatureIds: [TARGET_ID],
    });
    expect(diagnostics).toEqual([]);
  });

  it('reports an unresolved relation target and blocks only the current requirement', () => {
    const feature = makeFeature({
      relations: [
        {
          targetFeatureId: 'F-99999999',
          kind: 'affects',
          reason: '影响退款流程',
          source: 'product/payment.md',
        },
      ],
    });
    const unrelated = diagnoseLinks([feature], { sources: makeContext() });
    expect(unrelated).toHaveLength(1);
    expect(unrelated[0]).toMatchObject({
      severity: 'error',
      featureId: FEATURE_ID,
      field: 'relations.targetFeatureId',
      targetFeatureId: 'F-99999999',
      blocksRequirement: false,
    });

    const unrelatedFeature = diagnoseLinks([feature], {
      sources: makeContext(),
      currentRequirementFeatureIds: ['F-00000000'],
    });
    expect(unrelatedFeature[0]?.blocksRequirement).toBe(false);

    const byTarget = diagnoseLinks([feature], {
      sources: makeContext(),
      currentRequirementFeatureIds: ['F-99999999'],
    });
    expect(byTarget[0]?.blocksRequirement).toBe(true);

    const bySource = diagnoseLinks([feature], {
      sources: makeContext(),
      currentRequirementFeatureIds: [FEATURE_ID],
    });
    expect(bySource[0]?.blocksRequirement).toBe(true);
  });

  it('treats a known feature id as a resolvable relation target', () => {
    const diagnostics = diagnoseLinks([makeFeature()], {
      sources: makeContext(),
      knownFeatureIds: [TARGET_ID],
    });
    expect(diagnostics.filter((item) => item.field === 'relations.targetFeatureId')).toEqual([]);
  });

  it('reports an unresolved relation source', () => {
    const feature = makeFeature({
      relations: [
        {
          targetFeatureId: TARGET_ID,
          kind: 'depends_on',
          reason: '取消依赖支付状态',
          source: 'product/missing.md',
        },
      ],
    });
    const diagnostics = diagnoseLinks([feature], {
      sources: makeContext(),
      knownFeatureIds: [TARGET_ID],
      requirementId: REQUIREMENT_ID,
    });
    expect(diagnostics.map((item) => item.field)).toEqual(['relations.source']);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.ref).toBe('product/missing.md');
    expect(diagnostics[0]?.message).toContain(REQUIREMENT_ID);
  });

  it('reports unresolved design, evidence and source refs', () => {
    const context = { sources: makeContext(), knownFeatureIds: [TARGET_ID] };
    expect(
      diagnoseLinks(
        [makeFeature({ designDecisionRefs: [`decision:${UNKNOWN_DECISION_ID}`] })],
        context,
      ).map((item) => item.field),
    ).toEqual(['designDecisionRefs']);
    expect(
      diagnoseLinks(
        [makeFeature({ verificationEvidenceRefs: [`artifact:${ARTIFACT_ID}@9`] })],
        context,
      ).map((item) => item.field),
    ).toEqual(['verificationEvidenceRefs']);
    expect(
      diagnoseLinks(
        [makeFeature({ sourceRefs: [`git:${OTHER_REVISION}:src/orders/cancel.ts`] })],
        context,
      ).map((item) => item.field),
    ).toEqual(['sourceRefs']);
  });

  it('reports design=confirmed with implementation=absent as a gap, not an error', () => {
    const diagnostics = diagnoseLinks([makeFeature({ implementation: 'absent' })], {
      sources: makeContext(),
      knownFeatureIds: [TARGET_ID],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'warning',
      featureId: FEATURE_ID,
      field: 'implementation',
      blocksRequirement: false,
    });
  });

  it('reports observed-not-confirmed when sources exist', () => {
    const diagnostics = diagnoseLinks([makeFeature({ design: 'unconfirmed' })], {
      sources: makeContext(),
      knownFeatureIds: [TARGET_ID],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'warning',
      featureId: FEATURE_ID,
      field: 'design',
      blocksRequirement: false,
    });
    expect(diagnostics[0]?.message).toContain('observed');
  });

  it('rejects an observed implementation without sources and blocks the current requirement', () => {
    const feature = makeFeature({ design: 'unconfirmed', sourceRefs: [] });
    const unrelated = diagnoseLinks([feature], {
      sources: makeContext(),
      knownFeatureIds: [TARGET_ID],
    });
    expect(unrelated.map((item) => item.field)).toEqual(['sourceRefs']);
    expect(unrelated[0]).toMatchObject({ severity: 'error', blocksRequirement: false });

    const blocking = diagnoseLinks([feature], {
      sources: makeContext(),
      knownFeatureIds: [TARGET_ID],
      currentRequirementFeatureIds: [FEATURE_ID],
    });
    expect(blocking[0]).toMatchObject({ severity: 'error', blocksRequirement: true });
  });
});
