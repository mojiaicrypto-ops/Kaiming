/**
 * Feature knowledge model (`docs/architecture/context.md` §2).
 *
 * The Feature Markdown format is fixed: one field table with fourteen keys, six
 * mandatory section headings, and a four-column relation table. This module owns
 * the vocabularies and the value rules (multi-value separator, empty-value
 * markers) next to the types so the parser, the projection and the views cannot
 * drift apart.
 */
import type { ErrorCode } from '@agentdev/contracts';

/** `design`: 已确认意图的状态. */
export const DESIGN_STATES = ['unconfirmed', 'confirmed', 'retired'] as const;
export type DesignState = (typeof DESIGN_STATES)[number];

/** `implementation`: 代码实际状态. */
export const IMPLEMENTATION_STATES = ['absent', 'partial', 'implemented', 'removed'] as const;
export type ImplementationState = (typeof IMPLEMENTATION_STATES)[number];

/** `verification`: 证据状态，仅对记录的代码树成立. */
export const VERIFICATION_STATES = ['unverified', 'partial', 'passed', 'failed'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** `investigation`: 调查状态. */
export const INVESTIGATION_STATES = ['unexplored', 'partial', 'investigated'] as const;
export type InvestigationState = (typeof INVESTIGATION_STATES)[number];

/** Relation kinds of the four-column relation table. */
export const RELATION_KINDS = ['depends_on', 'shared_data', 'constrained_by', 'affects'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const isDesignState = (value: string): value is DesignState =>
  (DESIGN_STATES as readonly string[]).includes(value);

export const isImplementationState = (value: string): value is ImplementationState =>
  (IMPLEMENTATION_STATES as readonly string[]).includes(value);

export const isVerificationState = (value: string): value is VerificationState =>
  (VERIFICATION_STATES as readonly string[]).includes(value);

export const isInvestigationState = (value: string): value is InvestigationState =>
  (INVESTIGATION_STATES as readonly string[]).includes(value);

export const isRelationKind = (value: string): value is RelationKind =>
  (RELATION_KINDS as readonly string[]).includes(value);

/** One row of the relation table. */
export interface FeatureRelation {
  readonly targetFeatureId: string;
  readonly kind: RelationKind;
  readonly reason: string;
  readonly source: string;
}

/** A section body: free text plus the list items written under it. */
export interface FeatureSectionBody {
  readonly heading: string;
  /** Non-list, non-table body text, trimmed; empty when the section only holds a list. */
  readonly text: string;
  /** List items in document order (bullets and ordered items). */
  readonly items: readonly string[];
}

/** The five bodies carried by the Feature document (关系 holds the table). */
export interface FeatureSections {
  readonly purpose: FeatureSectionBody;
  readonly currentBehaviour: FeatureSectionBody;
  readonly entries: FeatureSectionBody;
  readonly gaps: FeatureSectionBody;
  readonly decisions: FeatureSectionBody;
}

/** The field table keys, in the order `context.md` §2 lists them. */
export interface FeatureFieldSpec {
  /** Key as written in the Markdown field table. */
  readonly key: string;
  /** Model/JSON name used in errors and in the projection. */
  readonly model: string;
}

export const FEATURE_FIELDS: readonly FeatureFieldSpec[] = [
  { key: 'feature_id', model: 'featureId' },
  { key: 'name', model: 'name' },
  { key: 'module', model: 'module' },
  { key: 'owner_document', model: 'ownerDocument' },
  { key: 'design', model: 'design' },
  { key: 'design_decision_refs', model: 'designDecisionRefs' },
  { key: 'implementation', model: 'implementation' },
  { key: 'verification', model: 'verification' },
  { key: 'verification_evidence_refs', model: 'verificationEvidenceRefs' },
  { key: 'verification_coverage', model: 'verificationCoverage' },
  { key: 'investigation', model: 'investigation' },
  { key: 'investigation_scope', model: 'investigationScope' },
  { key: 'source_refs', model: 'sourceRefs' },
  { key: 'revision', model: 'revision' },
];

export const FEATURE_FIELD_KEYS: readonly string[] = FEATURE_FIELDS.map((field) => field.key);

/** Maps a Markdown key to the model name; unknown keys are returned unchanged. */
export function featureFieldModelName(key: string): string {
  return FEATURE_FIELDS.find((field) => field.key === key)?.model ?? key;
}

/** Mandatory second-level headings, in `context.md` §2 order. */
export const FEATURE_SECTION_HEADINGS = [
  '用途',
  '当前行为',
  '关系',
  '实现入口',
  '已知差距',
  '关键决定',
] as const;
export type FeatureSectionHeading = (typeof FEATURE_SECTION_HEADINGS)[number];

export const FEATURE_RELATION_HEADING: FeatureSectionHeading = '关系';
export const FEATURE_ENTRIES_HEADING: FeatureSectionHeading = '实现入口';

/** The relation table header; any other header is a format error. */
export const RELATION_COLUMNS = ['target_feature_id', 'kind', 'reason', 'source'] as const;

/** `空值用“无”或“未调查”` (context.md §2). */
export const EMPTY_VALUE_MARKERS = ['无', '未调查'] as const;

/** Multi-value refs are semicolon-separated; the example uses both widths. */
const MULTI_VALUE_SEPARATOR = /[;；]/u;

/** Splits a semicolon-separated multi-value cell, dropping empty entries. */
export function splitMultiValue(value: string): readonly string[] {
  return value
    .split(MULTI_VALUE_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** `true` when the cell is the literal empty marker 无/未调查 (trailing 。 allowed). */
export function isEmptyValue(value: string): boolean {
  const marker = value
    .trim()
    .replace(/[。.]$/u, '')
    .trim();
  return (EMPTY_VALUE_MARKERS as readonly string[]).includes(marker);
}

/**
 * Reads a cell as a multi-value list. The literal empty markers mean "no value"
 * and must not leak into the list as a member.
 */
export function readMultiValue(value: string): readonly string[] {
  if (isEmptyValue(value)) return [];
  return splitMultiValue(value);
}

/** The parsed field table of a Feature document. */
export interface FeatureFields {
  readonly featureId: string;
  readonly name: string;
  readonly module: string;
  readonly ownerDocument: string;
  readonly design: DesignState;
  readonly designDecisionRefs: readonly string[];
  readonly implementation: ImplementationState;
  readonly verification: VerificationState;
  readonly verificationEvidenceRefs: readonly string[];
  readonly verificationCoverage: readonly string[];
  readonly investigation: InvestigationState;
  readonly investigationScope: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly revision: string;
}

/** A fully validated Feature document. */
export interface Feature extends FeatureFields {
  readonly relations: readonly FeatureRelation[];
  readonly sections: FeatureSections;
}

/**
 * A format violation. Every violation is `KNOWLEDGE_INVALID`: `context.md` §2
 * requires 重复ID、未知枚举、缺必需标题 to reject publication rather than degrade.
 */
export interface FeatureDocumentError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field?: string;
}

/** Builds a `KNOWLEDGE_INVALID` document error, omitting `field` when unknown. */
export function knowledgeError(field: string | undefined, message: string): FeatureDocumentError {
  return field === undefined || field === ''
    ? { code: 'KNOWLEDGE_INVALID', message }
    : { code: 'KNOWLEDGE_INVALID', message, field };
}
