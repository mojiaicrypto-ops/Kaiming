/**
 * Knowledge query views (`docs/architecture/context.md` §3,
 * `docs/product/knowledge.md` §3).
 *
 * The same facts support three separated answers, and each answer must be able to
 * state what it is:
 *
 * - `design` — the confirmed intent: `design`, the decision refs behind it, 用途
 *   and 关键决定, plus the independent implementation state;
 * - `delivered` — the current reality: 当前行为/约束, design vs implementation vs
 *   verification, the implementation entries and the 已知差距;
 * - `work` — the current Work's ProductDefinition overlay, explicitly marked not
 *   delivered. A Work overlay never changes the `design`/`delivered` answers and
 *   never leaks into another Work.
 *
 * Every response carries `sourceRevision`, `projectionState` and `unknowns`
 * (context.md §3). A stale projection stays readable but reports
 * `current:false`, so it can never be presented as the current truth.
 *
 * `listGaps` and `observedVsConfirmed` expose the two cross-feature gaps:
 * recorded 已知差距, and the difference between code-observed facts
 * (`implementation`/`source_refs` with `design=unconfirmed`) and confirmed
 * intent. Neither invents confirmed behaviour from observed code.
 */
import type { ErrorCode, ProductDefinition, ProjectionState } from '@agentdev/contracts';
import {
  isEmptyValue,
  type DesignState,
  type Feature,
  type FeatureRelation,
  type FeatureSectionBody,
  type ImplementationState,
  type VerificationState,
} from './model.js';
import type { CodeMapEntry, KnowledgeProjection, ProjectedFeature } from './projection.js';

/** The three separated query views (`context.md` §3). */
export const FEATURE_VIEWS = ['design', 'delivered', 'work'] as const;
export type KnowledgeView = (typeof FEATURE_VIEWS)[number];

/** One recorded 已知差距 line. */
export interface FeatureGap {
  readonly featureId: string;
  readonly featureName: string;
  readonly description: string;
  readonly source: '已知差距';
}

/**
 * A line that only states there is no gap. Kept narrow on purpose: a real gap
 * such as `无法在离线环境验证` must not be swallowed by a leading 无.
 */
const NO_GAP_PATTERNS: readonly RegExp[] = [
  /^无$/u,
  /^未调查$/u,
  /^无(?:已登记|已知|明显)?的?差距/u,
  /^暂无/u,
  /^未登记/u,
];

function isNoGap(line: string): boolean {
  const stripped = line.replace(/[。.！!]/gu, '').trim();
  return isEmptyValue(stripped) || NO_GAP_PATTERNS.some((pattern) => pattern.test(stripped));
}

function gapsOf(feature: Feature): readonly FeatureGap[] {
  const section = feature.sections.gaps;
  const lines = [...section.items, ...section.text.split(/\r?\n/u)]
    .map((line) => line.trim())
    .filter((line) => line !== '' && !isNoGap(line));
  return lines.map((description) => ({
    featureId: feature.featureId,
    featureName: feature.name,
    description,
    source: '已知差距' as const,
  }));
}

/** Every 已知差距 recorded across the projection, in projection order. */
export function listGaps(projection: KnowledgeProjection): readonly FeatureGap[] {
  const gaps: FeatureGap[] = [];
  for (const feature of projection.features) gaps.push(...gapsOf(feature));
  return gaps;
}

/** How observed code differs from confirmed intent. */
export type ObservedVsConfirmedKind = 'observed_not_confirmed' | 'confirmed_not_observed';

/** One observed-vs-confirmed divergence (`AC-042`). */
export interface ObservedVsConfirmed {
  readonly featureId: string;
  readonly featureName: string;
  readonly kind: ObservedVsConfirmedKind;
  readonly design: DesignState;
  readonly implementation: ImplementationState;
  readonly sourceRefs: readonly string[];
  readonly message: string;
  /** `true` when the observed behaviour must not be treated as accepted intent. */
  readonly mustNotAcceptObserved: boolean;
}

/**
 * Lists the gap between code-observed facts and confirmed intent:
 *
 * - `observed_not_confirmed` — the code implements something (or carries
 *   `source_refs`) while `design=unconfirmed`, so the behaviour is recorded as
 *   observed only and must not be accepted as user intent;
 * - `confirmed_not_observed` — `design=confirmed` with `implementation=absent`,
 *   a confirmed design that the code does not (yet) deliver.
 *
 * Features whose design and implementation agree produce no entry.
 */
export function observedVsConfirmed(features: readonly Feature[]): readonly ObservedVsConfirmed[] {
  const divergences: ObservedVsConfirmed[] = [];
  for (const feature of features) {
    const observed = feature.implementation !== 'absent' || feature.sourceRefs.length > 0;
    if (feature.design === 'unconfirmed' && observed) {
      const sources =
        feature.sourceRefs.length === 0 ? '' : `，source_refs ${feature.sourceRefs.length} 条`;
      divergences.push({
        featureId: feature.featureId,
        featureName: feature.name,
        kind: 'observed_not_confirmed',
        design: feature.design,
        implementation: feature.implementation,
        sourceRefs: feature.sourceRefs,
        message: `代码已观察（implementation=${feature.implementation}${sources}）但设计未确认；按 observed 记录，不得作为已确认意图`,
        mustNotAcceptObserved: true,
      });
    }
    if (feature.design === 'confirmed' && feature.implementation === 'absent') {
      divergences.push({
        featureId: feature.featureId,
        featureName: feature.name,
        kind: 'confirmed_not_observed',
        design: feature.design,
        implementation: feature.implementation,
        sourceRefs: feature.sourceRefs,
        message: '设计已确认但代码未实现（implementation=absent）；作为已知差距，不得视为已交付',
        mustNotAcceptObserved: false,
      });
    }
  }
  return divergences;
}

/**
 * The current Work's ProductDefinition overlay (`knowledge.md` §3:
 * 正在开发的需求行为以Work下ProductDefinition覆盖层保存). `confirmed` is `false`
 * until the user accepts it; a draft overlay is never shown as confirmed intent.
 */
export interface WorkOverlay {
  readonly workId: string;
  /** The Work's code baseline, compared with the projection's code tree. */
  readonly baseRevision: string;
  /** The overlay definition, or `null` when the Work has none yet. */
  readonly definition: ProductDefinition | null;
  /** `true` only when the overlay was accepted by the user. */
  readonly confirmed: boolean;
}

/** The Work's target for one feature. */
export interface WorkTarget {
  readonly workId: string;
  readonly featureId: string;
  readonly state: 'confirmed' | 'draft';
  readonly goal: string;
  readonly behaviors: ProductDefinition['behaviors'];
  readonly acceptance: ProductDefinition['acceptance'];
  readonly constraints: readonly string[];
  readonly decisionRefs: readonly string[];
  readonly featureRefs: readonly string[];
  readonly source: 'work_product_definition';
}

/** Fields every view response carries (`context.md` §3). */
export interface FeatureViewBase {
  readonly featureId: string;
  readonly name: string;
  readonly module: string;
  /** Revision the projection was built from. */
  readonly sourceRevision: string;
  readonly codeTreeRevision: string;
  readonly projectionState: ProjectionState;
  /** `false` when the projection is stale; a stale projection is never current. */
  readonly current: boolean;
  readonly unknowns: readonly string[];
}

/** Confirmed intent view. */
export interface DesignView extends FeatureViewBase {
  readonly view: 'design';
  readonly design: DesignState;
  readonly designDecisionRefs: readonly string[];
  readonly purpose: FeatureSectionBody;
  /** Independent implementation state, shown next to the confirmed design. */
  readonly implementation: ImplementationState;
  readonly relations: readonly FeatureRelation[];
  readonly decisions: FeatureSectionBody;
}

/** Current reality view. */
export interface DeliveredView extends FeatureViewBase {
  readonly view: 'delivered';
  readonly currentBehaviour: FeatureSectionBody;
  /** Constraints declared by `constrained_by` relations. */
  readonly constraints: readonly string[];
  readonly design: DesignState;
  readonly implementation: ImplementationState;
  readonly implementationEntries: readonly CodeMapEntry[];
  readonly verification: VerificationState;
  readonly verificationEvidenceRefs: readonly string[];
  readonly verificationCoverage: readonly string[];
  readonly gaps: readonly FeatureGap[];
  /** Revision the Feature document records (the code tree verification applies to). */
  readonly revision: string;
}

/** Current Work overlay view; never modifies the other views. */
export interface WorkView extends FeatureViewBase {
  readonly view: 'work';
  readonly workId: string;
  readonly baseRevision: string;
  /** `true` when the Work baseline differs from the projection's code tree. */
  readonly baselineChanged: boolean;
  /** Always `true`: an overlay is a target, never delivered. */
  readonly notDelivered: true;
  /** This Work's target for the feature; `null` when it does not declare it. */
  readonly overlay: WorkTarget | null;
  /** The delivered baseline the overlay builds on, read from the projection. */
  readonly delivered: DeliveredView;
}

export type FeatureView = DesignView | DeliveredView | WorkView;

export interface QueryFeatureViewOptions {
  readonly featureId: string;
  readonly view: KnowledgeView;
  /** Required for `view=work`; names the Work and carries its overlay. */
  readonly workOverlay?: WorkOverlay;
}

/** A typed view failure; no partial view is returned. */
export interface FeatureViewError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly featureId?: string;
}

export interface FeatureViewSuccess {
  readonly ok: true;
  readonly view: FeatureView;
}

export interface FeatureViewFailure {
  readonly ok: false;
  readonly errors: readonly FeatureViewError[];
}

export type FeatureViewResult = FeatureViewSuccess | FeatureViewFailure;

function baseOf(projection: KnowledgeProjection, feature: ProjectedFeature): FeatureViewBase {
  const unknowns: string[] = [];
  if (projection.state === 'stale') {
    unknowns.push(
      `投影已过期（保留自 revision ${projection.revision}）：${
        projection.staleReason ?? '最近一次构建失败'
      }；不得作为当前事实`,
    );
  }
  if (feature.design === 'unconfirmed') unknowns.push('设计尚未确认，当前行为属观察事实');
  return {
    featureId: feature.featureId,
    name: feature.name,
    module: feature.module,
    sourceRevision: projection.revision,
    codeTreeRevision: projection.codeTreeRevision,
    projectionState: projection.state,
    current: projection.state === 'valid',
    unknowns,
  };
}

function constraintsOf(feature: ProjectedFeature): readonly string[] {
  return feature.relations
    .filter((relation) => relation.kind === 'constrained_by')
    .map((relation) => relation.reason);
}

function designViewOf(feature: ProjectedFeature, base: FeatureViewBase): DesignView {
  return {
    ...base,
    view: 'design',
    design: feature.design,
    designDecisionRefs: feature.designDecisionRefs,
    purpose: feature.sections.purpose,
    implementation: feature.implementation,
    relations: feature.relations,
    decisions: feature.sections.decisions,
  };
}

function deliveredViewOf(feature: ProjectedFeature, base: FeatureViewBase): DeliveredView {
  return {
    ...base,
    view: 'delivered',
    currentBehaviour: feature.sections.currentBehaviour,
    constraints: constraintsOf(feature),
    design: feature.design,
    implementation: feature.implementation,
    implementationEntries: feature.codeMapEntries,
    verification: feature.verification,
    verificationEvidenceRefs: feature.verificationEvidenceRefs,
    verificationCoverage: feature.verificationCoverage,
    gaps: gapsOf(feature),
    revision: feature.revision,
  };
}

function workTargetOf(featureId: string, overlay: WorkOverlay): WorkTarget | null {
  const definition = overlay.definition;
  if (definition === null) return null;
  if (!definition.featureRefs.includes(featureId)) return null;
  return {
    workId: overlay.workId,
    featureId,
    state: overlay.confirmed ? 'confirmed' : 'draft',
    goal: definition.goal,
    behaviors: definition.behaviors,
    acceptance: definition.acceptance,
    constraints: definition.constraints,
    decisionRefs: definition.decisionRefs,
    featureRefs: definition.featureRefs,
    source: 'work_product_definition',
  };
}

function workViewOf(
  projection: KnowledgeProjection,
  feature: ProjectedFeature,
  base: FeatureViewBase,
  overlay: WorkOverlay,
): WorkView {
  const unknowns = [...base.unknowns];
  const baselineChanged = overlay.baseRevision !== projection.codeTreeRevision;
  if (baselineChanged) {
    unknowns.push(
      `Work 基线 ${overlay.baseRevision} 与当前代码树 ${projection.codeTreeRevision} 不一致，集成前需重新分析`,
    );
  }
  const target = workTargetOf(feature.featureId, overlay);
  if (target === null) {
    unknowns.push('该 Work 的 ProductDefinition 未声明此 Feature，无覆盖目标');
  } else if (target.state === 'draft') {
    unknowns.push('本需求目标尚未确认（draft），不得作为已确认意图');
  }
  return {
    ...base,
    unknowns,
    view: 'work',
    workId: overlay.workId,
    baseRevision: overlay.baseRevision,
    baselineChanged,
    notDelivered: true,
    overlay: target,
    delivered: deliveredViewOf(feature, base),
  };
}

/**
 * Answers one of the three separated views for one feature.
 *
 * Returns `{ok:false, errors}` with `NOT_FOUND` for an unknown feature and
 * `VALIDATION_ERROR` for `view=work` without a Work overlay (or with an empty
 * `workId`); it never returns a partial view or a stale projection as current.
 */
export function queryFeatureView(
  projection: KnowledgeProjection,
  options: QueryFeatureViewOptions,
): FeatureViewResult {
  const feature = projection.features.find((item) => item.featureId === options.featureId);
  if (feature === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: 'NOT_FOUND',
          message: `unknown feature: ${options.featureId}`,
          featureId: options.featureId,
        },
      ],
    };
  }
  const base = baseOf(projection, feature);
  if (options.view === 'design') return { ok: true, view: designViewOf(feature, base) };
  if (options.view === 'delivered') return { ok: true, view: deliveredViewOf(feature, base) };
  if (options.view === 'work') {
    const overlay = options.workOverlay;
    if (overlay === undefined || overlay.workId === '') {
      return {
        ok: false,
        errors: [
          {
            code: 'VALIDATION_ERROR',
            message: 'view=work requires a workOverlay with a non-empty workId',
            featureId: options.featureId,
          },
        ],
      };
    }
    return { ok: true, view: workViewOf(projection, feature, base, overlay) };
  }
  return {
    ok: false,
    errors: [
      {
        code: 'VALIDATION_ERROR',
        message: `unknown view: ${String(options.view)}`,
        featureId: options.featureId,
      },
    ],
  };
}
