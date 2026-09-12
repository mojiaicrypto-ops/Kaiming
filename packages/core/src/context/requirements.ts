/**
 * The per-stage required-input table (`docs/architecture/context.md` §1,
 * `docs/rules/agents.md` §2, `AC-079`).
 *
 * The table answers one question: for this role and stage, which inputs must be
 * present, which are optional, and which may be **absent on purpose** because a
 * later stage produces them. That third column is what breaks the bootstrapping
 * loop: an empty Project can start `initialize` without an overview/Product/Plan,
 * Planning runs with a ProductDefinition and no Plan, and an L1 Develop runs with
 * a CompactPlan and nothing else.
 *
 * Some rows are documented as a choice rather than a conjunction — "Project概览
 * **或**初始化观察摘要" and "CompactPlan **或** Plan" — so a row may carry `oneOf`
 * groups: at least one member of each group must be available.
 */
import {
  artifactKindSchema,
  missingSelectionReasons,
  type ArtifactKind,
  type ContextSelection,
  type ErrorCode,
  type SourceRef,
} from '@agentdev/contracts';
import {
  CONTEXT_INPUT_KEYS,
  FORBIDDEN_INPUT_KEYS,
  fromSourceRef,
  isFutureArtifact,
  sourceRefKey,
  stageRuleKey,
  type ContextGap,
  type ContextInputKey,
  type ContextRole,
  type ContextSourceRef,
  type ContextStage,
  type StageRules,
} from './types.js';

/** One catalog entry: what a key means and where it comes from. */
export interface InputSpec {
  readonly key: ContextInputKey;
  readonly description: string;
  /** Artifact class that satisfies the key, when an artifact carries it. */
  readonly artifactClass?: ArtifactKind;
  /** Repository-relative prefixes that satisfy the key. */
  readonly pathPrefixes?: readonly string[];
  /** `true` when the input never applies to any stage (`transcript`, Secret). */
  readonly forbidden?: boolean;
}

/** The catalog of logical inputs; every key has exactly one entry. */
export const INPUT_CATALOG: Readonly<Record<ContextInputKey, InputSpec>> = {
  roleContract: {
    key: 'roleContract',
    description: '角色契约（固定必需项，agents.md §2）',
    pathPrefixes: ['docs/rules'],
  },
  projectOverview: {
    key: 'projectOverview',
    description: 'Project 概览或初始化后正式概览',
    pathPrefixes: ['docs/INDEX.md', 'docs/product'],
  },
  bootstrapObservation: {
    key: 'bootstrapObservation',
    description: '首次初始化的 BootstrapObservation（受信路径/用户目标/读取来源/未知）',
  },
  userRequest: { key: 'userRequest', description: '用户问题或目标消息' },
  confirmedSource: { key: 'confirmedSource', description: '用户确认来源（决定/授权）' },
  workGoal: { key: 'workGoal', description: 'Work 目标' },
  authorization: { key: 'authorization', description: '适用授权 authorizationRef' },
  policy: { key: 'policy', description: '适用政策 revision' },
  currentFacts: { key: 'currentFacts', description: '当前相关事实/未知' },
  productDefinition: {
    key: 'productDefinition',
    description: '有效 ProductDefinition',
    artifactClass: 'product',
  },
  acceptance: { key: 'acceptance', description: '验收集合' },
  plan: { key: 'plan', description: '有效 Plan', artifactClass: 'plan' },
  compactPlan: { key: 'compactPlan', description: 'CompactPlan（L1 路线）', artifactClass: 'plan' },
  replacementTarget: { key: 'replacementTarget', description: '明确替换目标' },
  currentFiles: { key: 'currentFiles', description: '当前文件/路径' },
  taskAcceptance: { key: 'taskAcceptance', description: '任务验收及依赖产物' },
  dependencyArtifacts: { key: 'dependencyArtifacts', description: '依赖 Task 产物' },
  frozenDiff: { key: 'frozenDiff', description: '冻结 Diff', artifactClass: 'diff' },
  applicableChecks: { key: 'applicableChecks', description: '适用检查命令/程序' },
  reviewResult: {
    key: 'reviewResult',
    description: '有效 Review 结果',
    artifactClass: 'review',
  },
  testEvidence: { key: 'testEvidence', description: '客观测试证据', artifactClass: 'test' },
  frozenCode: { key: 'frozenCode', description: '冻结源码 revision' },
  environment: { key: 'environment', description: '验证环境' },
  verificationResult: { key: 'verificationResult', description: '最终验证结果' },
  impactSet: { key: 'impactSet', description: '影响集合' },
  knowledgeDiff: { key: 'knowledgeDiff', description: '待提交知识 Diff' },
  targetDocument: { key: 'targetDocument', description: '目标文档' },
  applicableRules: {
    key: 'applicableRules',
    description: '适用规则',
    pathPrefixes: ['docs/rules'],
  },
  technicalDoc: { key: 'technicalDoc', description: '技术文档路线所需目标/范围' },
  featureNavigation: {
    key: 'featureNavigation',
    description: 'Feature 导航',
    pathPrefixes: ['features'],
  },
  transcript: {
    key: 'transcript',
    description: '开发聊天/Transcript（任何角色不可读）',
    forbidden: true,
  },
  otherProject: { key: 'otherProject', description: '其他 Project 来源（禁止）', forbidden: true },
  secret: { key: 'secret', description: 'SecretStore（禁止注入）', forbidden: true },
};

/**
 * `true` when a caller may assert this input through `BuildContextInput.contextInputs`.
 *
 * Only a key with no resolvable handle at all may be asserted: the initialization
 * and meta inputs (`bootstrapObservation`, `acceptance`, `workGoal`, …). A key the
 * catalog binds to an artifact class (`productDefinition`, `plan`, `reviewResult`,
 * …) or to a path prefix (`projectOverview`, `roleContract`, `featureNavigation`,
 * …) must be satisfied by a *resolved source*, or a caller could declare its own
 * upstream input and hide a real `MISSING_CONTEXT` (`AC-031`, `AC-079`, W5R2-04).
 */
export function isAssertableInputKey(key: ContextInputKey): boolean {
  const spec: InputSpec | undefined = INPUT_CATALOG[key];
  if (spec === undefined) return false;
  return spec.artifactClass === undefined && spec.pathPrefixes === undefined;
}

/** One row of the required-input table. */
export interface RequirementRow extends StageRules {
  /** The stage row this one is documented under (`agents.md` §2). */
  readonly documentedAs: string;
  /** Groups where at least one member must be available. */
  readonly oneOf: readonly (readonly ContextInputKey[])[];
}

interface RowInput {
  readonly role: ContextRole;
  readonly stage: ContextStage;
  readonly documentedAs: string;
  readonly required: readonly ContextInputKey[];
  /** Keys the stage may use, which are simply absent when they are not supplied. */
  readonly optional?: readonly ContextInputKey[];
  /** Keys the stage expects to see only for a different route or a later version. */
  readonly allowedAbsent?: readonly ContextInputKey[];
  readonly oneOf?: readonly (readonly ContextInputKey[])[];
}

const row = (input: RowInput): RequirementRow => {
  const optional = input.optional ?? [];
  const oneOf = input.oneOf ?? [];
  // A `oneOf` alternative stays in `required` *and* in `allowedAbsent`: the
  // per-key check exempts it, and the group check is what enforces the choice.
  const allowedAbsent = [
    ...(input.allowedAbsent ?? []),
    ...oneOf.flat().filter((key) => !optional.includes(key)),
  ].filter((key, index, all) => all.indexOf(key) === index);
  const required = input.required.filter((key) => !optional.includes(key));
  const remaining = CONTEXT_INPUT_KEYS.filter(
    (key) =>
      !required.includes(key) &&
      !optional.includes(key) &&
      !allowedAbsent.includes(key) &&
      !FORBIDDEN_INPUT_KEYS.includes(key),
  );
  return {
    role: input.role,
    stage: input.stage,
    documentedAs: input.documentedAs,
    required,
    optional,
    allowedAbsent,
    oneOf,
    // Everything a row does not name is either a future artifact (`allowedAbsent`),
    // forbidden outright, or explicitly not part of that stage's route.
    notApplicable: [...allowedAbsent, ...remaining, ...FORBIDDEN_INPUT_KEYS].filter(
      (key, index, all) => all.indexOf(key) === index,
    ),
  };
};

/**
 * The table itself, keyed by `role:stage`.
 *
 * Rows follow `agents.md` §2 plus `context.md` §1/§4. Each delivery row adds only
 * inputs an earlier stage produced; a future artifact appears only in
 * `allowedAbsent`, never in `required` without that exemption.
 */
export const CONTEXT_REQUIREMENTS: Readonly<Record<string, RequirementRow>> = {
  [stageRuleKey('chief', 'assist')]: row({
    role: 'chief',
    stage: 'assist',
    documentedAs: 'assist/artifact/initialize调查',
    required: ['roleContract', 'userRequest', 'workGoal'],
    optional: [
      'projectOverview',
      'bootstrapObservation',
      'authorization',
      'policy',
      'currentFacts',
      'featureNavigation',
    ],
    allowedAbsent: ['productDefinition', 'plan', 'compactPlan', 'taskAcceptance'],
  }),
  [stageRuleKey('chief', 'coordinate')]: row({
    role: 'chief',
    stage: 'coordinate',
    documentedAs: 'assist/artifact/initialize调查',
    required: ['roleContract', 'userRequest', 'workGoal'],
    optional: [
      'projectOverview',
      'bootstrapObservation',
      'authorization',
      'policy',
      'currentFacts',
      'featureNavigation',
    ],
    allowedAbsent: ['productDefinition', 'plan', 'compactPlan', 'taskAcceptance'],
  }),
  [stageRuleKey('chief', 'initialize')]: row({
    role: 'chief',
    stage: 'initialize',
    documentedAs: 'assist/artifact/initialize调查',
    // `context.md` §4: with no Project overview the BootstrapObservation stands in
    // for it, so neither is a hard requirement on its own — `oneOf` below is.
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'projectOverview',
      'bootstrapObservation',
    ],
    optional: ['authorization', 'policy', 'currentFacts'],
    allowedAbsent: ['productDefinition', 'plan', 'compactPlan', 'taskAcceptance'],
    oneOf: [['projectOverview', 'bootstrapObservation']],
  }),
  [stageRuleKey('product', 'product')]: row({
    role: 'product',
    stage: 'product',
    documentedAs: 'Product设计/正式产品文档准备',
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'confirmedSource',
      'currentFacts',
      'projectOverview',
      'bootstrapObservation',
    ],
    optional: ['authorization', 'policy', 'featureNavigation'],
    allowedAbsent: [
      'plan',
      'compactPlan',
      'taskAcceptance',
      'dependencyArtifacts',
      'reviewResult',
      'testEvidence',
    ],
    oneOf: [['projectOverview', 'bootstrapObservation']],
  }),
  [stageRuleKey('product', 'document')]: row({
    role: 'product',
    stage: 'document',
    documentedAs: '文档修改',
    required: [
      'roleContract',
      'userRequest',
      'confirmedSource',
      'targetDocument',
      'applicableRules',
    ],
    optional: [
      'projectOverview',
      'bootstrapObservation',
      'compactPlan',
      'plan',
      'policy',
      'currentFacts',
    ],
    allowedAbsent: ['reviewResult', 'testEvidence', 'taskAcceptance'],
  }),
  [stageRuleKey('product', 'document_check')]: row({
    role: 'product',
    stage: 'document_check',
    documentedAs: 'L1/文档ReviewCheck',
    required: [
      'roleContract',
      'confirmedSource',
      'frozenDiff',
      'applicableChecks',
      'compactPlan',
      'plan',
    ],
    optional: ['projectOverview', 'bootstrapObservation', 'reviewResult', 'policy'],
    allowedAbsent: ['testEvidence', 'taskAcceptance'],
    oneOf: [['compactPlan', 'plan']],
  }),
  [stageRuleKey('planning', 'planning')]: row({
    role: 'planning',
    stage: 'planning',
    documentedAs: 'Planning生成Plan',
    required: ['roleContract', 'userRequest', 'productDefinition', 'acceptance'],
    optional: [
      'projectOverview',
      'bootstrapObservation',
      'technicalDoc',
      'policy',
      'currentFacts',
      'plan',
    ],
    allowedAbsent: ['reviewResult', 'testEvidence', 'taskAcceptance', 'dependencyArtifacts'],
  }),
  [stageRuleKey('planning', 'document')]: row({
    role: 'planning',
    stage: 'document',
    documentedAs: '文档修改',
    required: [
      'roleContract',
      'userRequest',
      'confirmedSource',
      'targetDocument',
      'applicableRules',
    ],
    optional: [
      'projectOverview',
      'bootstrapObservation',
      'compactPlan',
      'plan',
      'policy',
      'currentFacts',
    ],
    allowedAbsent: ['reviewResult', 'testEvidence', 'taskAcceptance'],
  }),
  [stageRuleKey('backend', 'develop-L1')]: row({
    role: 'backend',
    stage: 'develop-L1',
    documentedAs: 'L1 Develop',
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'compactPlan',
      'replacementTarget',
      'currentFiles',
    ],
    optional: ['authorization', 'policy', 'projectOverview', 'bootstrapObservation', 'frozenCode'],
    allowedAbsent: [
      'productDefinition',
      'plan',
      'taskAcceptance',
      'dependencyArtifacts',
      'frozenDiff',
      'reviewResult',
      'testEvidence',
    ],
  }),
  [stageRuleKey('frontend', 'develop-L1')]: row({
    role: 'frontend',
    stage: 'develop-L1',
    documentedAs: 'L1 Develop',
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'compactPlan',
      'replacementTarget',
      'currentFiles',
    ],
    optional: ['authorization', 'policy', 'projectOverview', 'bootstrapObservation', 'frozenCode'],
    allowedAbsent: [
      'productDefinition',
      'plan',
      'taskAcceptance',
      'dependencyArtifacts',
      'frozenDiff',
      'reviewResult',
      'testEvidence',
    ],
  }),
  [stageRuleKey('backend', 'develop-L2')]: row({
    role: 'backend',
    stage: 'develop-L2',
    documentedAs: 'L2/L3代码Develop',
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'productDefinition',
      'acceptance',
      'plan',
      'taskAcceptance',
      'authorization',
    ],
    optional: [
      'policy',
      'projectOverview',
      'bootstrapObservation',
      'dependencyArtifacts',
      'frozenCode',
    ],
    allowedAbsent: ['frozenDiff', 'reviewResult', 'testEvidence'],
  }),
  [stageRuleKey('frontend', 'develop-L2')]: row({
    role: 'frontend',
    stage: 'develop-L2',
    documentedAs: 'L2/L3代码Develop',
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'productDefinition',
      'acceptance',
      'plan',
      'taskAcceptance',
      'authorization',
    ],
    optional: [
      'policy',
      'projectOverview',
      'bootstrapObservation',
      'dependencyArtifacts',
      'frozenCode',
    ],
    allowedAbsent: ['frozenDiff', 'reviewResult', 'testEvidence'],
  }),
  [stageRuleKey('backend', 'develop-L3')]: row({
    role: 'backend',
    stage: 'develop-L3',
    documentedAs: 'L2/L3代码Develop',
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'productDefinition',
      'acceptance',
      'plan',
      'taskAcceptance',
      'authorization',
    ],
    optional: [
      'policy',
      'projectOverview',
      'bootstrapObservation',
      'dependencyArtifacts',
      'frozenCode',
    ],
    allowedAbsent: ['frozenDiff', 'reviewResult', 'testEvidence'],
  }),
  [stageRuleKey('frontend', 'develop-L3')]: row({
    role: 'frontend',
    stage: 'develop-L3',
    documentedAs: 'L2/L3代码Develop',
    required: [
      'roleContract',
      'userRequest',
      'workGoal',
      'productDefinition',
      'acceptance',
      'plan',
      'taskAcceptance',
      'authorization',
    ],
    optional: [
      'policy',
      'projectOverview',
      'bootstrapObservation',
      'dependencyArtifacts',
      'frozenCode',
    ],
    allowedAbsent: ['frozenDiff', 'reviewResult', 'testEvidence'],
  }),
  [stageRuleKey('review', 'document_check')]: row({
    role: 'review',
    stage: 'document_check',
    documentedAs: 'L1/文档ReviewCheck',
    // Document-route check: a CompactPlan or a Plan, the confirmed source, the
    // frozen diff and the applicable checks — no code ProductDefinition or Test.
    required: [
      'roleContract',
      'confirmedSource',
      'compactPlan',
      'plan',
      'frozenDiff',
      'applicableChecks',
    ],
    optional: ['projectOverview', 'bootstrapObservation', 'policy'],
    allowedAbsent: ['productDefinition', 'acceptance', 'testEvidence', 'taskAcceptance'],
    oneOf: [['compactPlan', 'plan']],
  }),
  [stageRuleKey('review', 'review')]: row({
    role: 'review',
    stage: 'review',
    documentedAs: 'L2/L3代码Review',
    required: [
      'roleContract',
      'productDefinition',
      'acceptance',
      'plan',
      'frozenDiff',
      'frozenCode',
      'applicableChecks',
    ],
    optional: ['projectOverview', 'bootstrapObservation', 'policy', 'testEvidence'],
    allowedAbsent: ['reviewResult', 'taskAcceptance'],
  }),
  [stageRuleKey('test', 'test')]: row({
    role: 'test',
    stage: 'test',
    documentedAs: 'Test',
    required: ['roleContract', 'reviewResult', 'plan', 'acceptance', 'frozenCode', 'environment'],
    optional: ['projectOverview', 'bootstrapObservation', 'policy', 'testEvidence'],
    allowedAbsent: ['knowledgeDiff', 'taskAcceptance'],
  }),
  [stageRuleKey('settlement', 'settlement')]: row({
    role: 'settlement',
    stage: 'settlement',
    documentedAs: 'Settlement及最终文档检查',
    required: ['roleContract', 'verificationResult', 'impactSet', 'knowledgeDiff'],
    optional: ['projectOverview', 'bootstrapObservation', 'reviewResult', 'testEvidence', 'policy'],
    allowedAbsent: ['plan', 'compactPlan', 'taskAcceptance'],
  }),
};

/** The table row for a `(role, stage)`, or `undefined` when the pair is not legal. */
export function requiredInputRow(
  role: ContextRole,
  stage: ContextStage,
): RequirementRow | undefined {
  return CONTEXT_REQUIREMENTS[stageRuleKey(role, stage)];
}

/** Every table row, in declaration order. */
export function requirementRows(): readonly RequirementRow[] {
  return Object.values(CONTEXT_REQUIREMENTS);
}

/** What one evaluation may draw on. */
export interface AvailableInputs {
  readonly roleContract?: boolean;
  readonly projectOverview?: boolean;
  readonly bootstrapObservation?: boolean;
  readonly userRequest?: boolean;
  readonly confirmedSource?: boolean;
  readonly workGoal?: boolean;
  readonly authorization?: boolean;
  readonly policy?: boolean;
  readonly currentFacts?: boolean;
  readonly productDefinition?: boolean;
  readonly acceptance?: boolean;
  readonly plan?: boolean;
  readonly compactPlan?: boolean;
  readonly replacementTarget?: boolean;
  readonly currentFiles?: boolean;
  readonly taskAcceptance?: boolean;
  readonly dependencyArtifacts?: boolean;
  readonly frozenDiff?: boolean;
  readonly applicableChecks?: boolean;
  readonly reviewResult?: boolean;
  readonly testEvidence?: boolean;
  readonly frozenCode?: boolean;
  readonly environment?: boolean;
  readonly verificationResult?: boolean;
  readonly impactSet?: boolean;
  readonly knowledgeDiff?: boolean;
  readonly targetDocument?: boolean;
  readonly applicableRules?: boolean;
  readonly technicalDoc?: boolean;
  readonly featureNavigation?: boolean;
  readonly transcript?: boolean;
  readonly otherProject?: boolean;
  readonly secret?: boolean;
}

/** What `evaluateRequirements` answers. */
export type RequirementEvaluation =
  | {
      readonly ok: true;
      readonly role: ContextRole;
      readonly stage: ContextStage;
      readonly satisfied: readonly ContextInputKey[];
      readonly absentAllowed: readonly ContextInputKey[];
      readonly gaps: readonly ContextGap[];
    }
  | { readonly ok: false; readonly errors: readonly ContextGap[] };

function gapFor(key: ContextInputKey, code: ErrorCode, message: string): ContextGap {
  return { code, message, input: key };
}

/**
 * `true` only when the caller explicitly reported the input as available.
 *
 * `Object.hasOwn` rather than truthiness: a caller that sets the key to `false`
 * is asserting absence, and both readings must not collapse into "available".
 */
function isAvailable(available: AvailableInputs, key: ContextInputKey): boolean {
  return Object.hasOwn(available, key) && available[key] === true;
}

/**
 * Evaluates the stage's required inputs against what the caller has.
 *
 * - a missing **required** input is `MISSING_CONTEXT` with the input key in the
 *   `input` field, so Chief gets a precise gap list (`AC-031`, `AC-079`);
 * - a **future artifact** that is missing is not a gap at all: it is listed in
 *   the stage's `allowedAbsent` column and reported in `absentAllowed`;
 * - a `oneOf` group with no member available is `MISSING_CONTEXT` naming the group;
 * - a **forbidden** input that is present is `CONTEXT_FORBIDDEN`, never resolved;
 * - an unknown `(role, stage)` pair is `VALIDATION_ERROR`.
 */
export function evaluateRequirements(input: {
  readonly role: ContextRole;
  readonly stage: ContextStage;
  readonly available: AvailableInputs;
}): RequirementEvaluation {
  const { role, stage, available } = input;
  const rules = requiredInputRow(role, stage);
  if (rules === undefined) {
    return {
      ok: false,
      errors: [{ code: 'VALIDATION_ERROR', message: `未登记的角色/阶段组合：${role}:${stage}` }],
    };
  }
  const errors: ContextGap[] = [];
  for (const key of FORBIDDEN_INPUT_KEYS) {
    if (isAvailable(available, key)) {
      errors.push(
        gapFor(key, 'CONTEXT_FORBIDDEN', `${INPUT_CATALOG[key].description}不可作为输入`),
      );
    }
  }
  for (const key of rules.required) {
    if (isAvailable(available, key)) continue;
    if (rules.allowedAbsent.includes(key)) continue;
    errors.push(
      gapFor(
        key,
        'MISSING_CONTEXT',
        `阶段 ${role}:${stage} 缺少必需输入 ${key}（${INPUT_CATALOG[key].description}）`,
      ),
    );
  }
  for (const group of rules.oneOf) {
    if (group.some((key) => isAvailable(available, key))) continue;
    errors.push(
      gapFor(
        group[0] ?? 'projectOverview',
        'MISSING_CONTEXT',
        `阶段 ${role}:${stage} 需要 ${group.join(' 或 ')} 之一`,
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  const satisfied: ContextInputKey[] = [];
  const absentAllowed: ContextInputKey[] = [];
  for (const key of [...rules.required, ...rules.optional, ...rules.allowedAbsent]) {
    if (satisfied.includes(key) || absentAllowed.includes(key)) continue;
    if (isAvailable(available, key)) satisfied.push(key);
    else if (rules.allowedAbsent.includes(key)) absentAllowed.push(key);
  }
  return { ok: true, role, stage, satisfied, absentAllowed, gaps: [] };
}

/** Availability derived from one `ContextSelection` (`data.md` §3). */
export interface SelectionAvailability {
  readonly inputs: AvailableInputs;
  /** Which selection entry (by `kind:id`) satisfied each input. */
  readonly evidence: Readonly<Record<string, string>>;
  /** Selection entries that could not be mapped onto an input key. */
  readonly unmapped: readonly SourceRef[];
}

const ARTIFACT_KIND_INPUT: Readonly<Record<ArtifactKind, ContextInputKey | null>> = {
  explanation: null,
  product: 'productDefinition',
  plan: 'plan',
  diff: 'frozenDiff',
  review: 'reviewResult',
  test: 'testEvidence',
  settlement: 'knowledgeDiff',
  decision: 'confirmedSource',
  recovery: null,
  attachment: null,
  log: null,
  evidence: 'testEvidence',
};

const PATH_INPUT_RULES: readonly { readonly prefix: string; readonly key: ContextInputKey }[] = [
  { prefix: 'docs/INDEX.md', key: 'projectOverview' },
  { prefix: 'docs/product', key: 'projectOverview' },
  { prefix: 'docs/rules', key: 'roleContract' },
  { prefix: 'features', key: 'featureNavigation' },
];

/**
 * Artifact blob paths whose class alone does not name the input they supply.
 *
 * `data.md` §3 keeps a `CompactPlan` as a `kind=plan` Artifact, so `plan` under an
 * L1 work is the CompactPlan the L1 table requires — never the full `Plan`.
 */
const ARTIFACT_PATH_INPUT_OVERRIDES: readonly {
  readonly marker: RegExp;
  readonly key: ContextInputKey;
}[] = [{ marker: /^artifacts\/plan\/l1(?:[-/]|$)/iu, key: 'compactPlan' }];

/**
 * Maps one selected source onto the logical input key it supplies.
 *
 * A `git` path is classified by its prefix first, then by the artifact tree.
 * Anything unrecognised is reported in `unmapped` instead of being guessed — a
 * requirement must never be considered satisfied by a source nobody selected.
 */
export function inputKeyForSource(source: ContextSourceRef): ContextInputKey | null {
  const rawPath = source.path;
  if (rawPath !== undefined) {
    const path = rawPath.replaceAll('\\', '/');
    for (const rule of PATH_INPUT_RULES) {
      if (path === rule.prefix || path.startsWith(`${rule.prefix}/`)) return rule.key;
    }
    for (const override of ARTIFACT_PATH_INPUT_OVERRIDES) {
      if (override.marker.test(path)) return override.key;
    }
    if (path.startsWith('artifacts/')) {
      const head = path.split('/')[1];
      if (head !== undefined && artifactKindSchema.safeParse(head).success) {
        return ARTIFACT_KIND_INPUT[head as ArtifactKind];
      }
    }
  }
  if (source.artifactClass !== undefined) return ARTIFACT_KIND_INPUT[source.artifactClass];
  switch (source.kind) {
    case 'policy':
      return 'policy';
    case 'role_contract':
      return 'roleContract';
    case 'transcript':
      return 'transcript';
    case 'message':
      return source.sender === 'user' ? 'userRequest' : null;
    case 'knowledge':
    case 'artifact':
    case 'git':
      return null;
  }
}

/**
 * Derives the available-input record from a selection.
 *
 * `selection.artifactRefs` are hash-pinned `Ref`s without a kind, so they cannot
 * be classified here; the Builder resolves them and reports the resulting keys.
 * They are therefore not guessed at, and they are not "unmapped" either — the
 * reason check for them lives in `selectionGaps`.
 */
export function availabilityFromSelection(selection: ContextSelection): SelectionAvailability {
  const inputs: Record<string, boolean> = {};
  const evidence: Record<string, string> = {};
  const unmapped: SourceRef[] = [];
  for (const source of selection.sourceRefs) {
    const widened = fromSourceRef(source);
    const key = inputKeyForSource(widened);
    if (key === null) {
      unmapped.push(source);
      continue;
    }
    inputs[key] = true;
    evidence[key] = sourceRefKey(source);
  }
  return { inputs, evidence, unmapped };
}

/**
 * The gaps a `ContextSelection` already carries by itself (`AC-030`).
 *
 * Every selection entry needs a reason: a `sourceRef` without one is unusable, so
 * it becomes a `MISSING_CONTEXT` gap with the entry's key instead of a silently
 * resolved source. The same rule applies to `artifactRefs`, which are addressed by
 * `artifact:<id>` in `reasonPerSource`.
 */
export function selectionGaps(selection: ContextSelection): readonly ContextGap[] {
  const gaps: ContextGap[] = [];
  const missing = new Set(missingSelectionReasons(selection));
  for (const source of selection.sourceRefs) {
    const key = sourceRefKey(source);
    const reason = selection.reasonPerSource[key];
    // `missingSelectionReasons` only sees an absent key; a blank reason is just as
    // unusable (`ContextSelection` requires a reason per source).
    if (missing.has(key) || reason === undefined || reason.trim() === '') {
      gaps.push({
        code: 'MISSING_CONTEXT',
        message: `来源缺少 reason：${key}`,
        ref: source,
      });
    }
  }
  for (const artifact of selection.artifactRefs) {
    const reason = selection.reasonPerSource[`artifact:${artifact.id}`];
    if (reason === undefined || reason.trim() === '') {
      const ref: SourceRef = {
        kind: 'artifact',
        id: artifact.id,
        version: String(artifact.version),
      };
      gaps.push({
        code: 'MISSING_CONTEXT',
        message: `Artifact 缺少 reason：artifact:${artifact.id}`,
        ref,
      });
    }
  }
  return gaps;
}
/** `true` when the input is required and missing for `(role, stage)`. */
export function isInputRequired(
  role: ContextRole,
  stage: ContextStage,
  key: ContextInputKey,
): boolean {
  const rules = requiredInputRow(role, stage);
  if (rules === undefined) return false;
  return rules.required.includes(key) && !rules.allowedAbsent.includes(key);
}

/** `true` when a missing input is deliberately permitted at this stage. */
export function absenceIsLegal(
  role: ContextRole,
  stage: ContextStage,
  key: ContextInputKey,
): boolean {
  const rules = requiredInputRow(role, stage);
  if (rules === undefined) return false;
  return rules.allowedAbsent.includes(key);
}

/**
 * The future artifacts a row still requires as a hard requirement.
 *
 * `AC-079` forbids exactly this: requiring a future artifact would deadlock the
 * earlier stage, so this must always return `[]`. Only `allowedAbsent` may name a
 * future product.
 */
export function referencesFutureArtifact(rule: RequirementRow): readonly ArtifactKind[] {
  const offenders: ArtifactKind[] = [];
  for (const key of rule.required) {
    if (rule.allowedAbsent.includes(key)) continue;
    const artifactClass = INPUT_CATALOG[key].artifactClass;
    if (artifactClass === undefined) continue;
    if (isFutureArtifact(artifactClass, rule.stage)) {
      offenders.push(artifactClass);
    }
  }
  return offenders;
}

/** `true` when the stage row sits before the artifact class becomes readable. */
export function stagePrecedesArtifact(stage: ContextStage, artifactClass: ArtifactKind): boolean {
  return isFutureArtifact(artifactClass, stage);
}

/** Every catalog key, exported so tests can prove coverage of the table. */
export const INPUT_KEYS: readonly ContextInputKey[] = CONTEXT_INPUT_KEYS;
