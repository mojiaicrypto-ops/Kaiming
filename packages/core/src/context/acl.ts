/**
 * The role ACL and per-stage read scope (`docs/architecture/context.md` §1/§5,
 * `docs/architecture/execution.md` §3, `docs/rules/agents.md` §1/§2).
 *
 * Three rules shape everything here:
 *
 * 1. **Chief chooses, the Builder only authorises.** `canRead` never widens a
 *    selection; it answers whether one selected source is inside the reader's
 *    frozen scope, and `explainDenial` reports the exact `ERROR_CODES` member so
 *    Chief can fix the selection instead of the Run guessing.
 * 2. **Isolation is structural.** A development conversation/Transcript is denied
 *    by *kind* and by *path marker* (`AC-033`), another Project's source is denied
 *    before its content is ever resolved (`AC-034`), and a Session/Checkpoint
 *    belongs to exactly one Run (`context.md` §5).
 * 3. **A stage cannot read its future.** An earlier stage may never satisfy an
 *    input that a later stage produces (`AC-079`): the ACL refuses a source whose
 *    artifact class is produced downstream of the reader's stage, so a
 *    `CompactPlan`-only L1 Develop is never blocked on a full `Plan`.
 */
import type { ErrorCode, RepoPath } from '@agentdev/contracts';
import { requiredInputRow } from './requirements.js';
import {
  ARTIFACT_ROOT,
  artifactClassFromPath,
  classifyMessageSender,
  denialSourceRef,
  isDeniedSourcePath,
  isFutureArtifact,
  PIPELINE_ORDER,
  type AclDecision,
  type ArtifactClass,
  type ContextRole,
  type ContextSourceRef,
  type ContextStage,
  type DeniedSource,
  type MessageClass,
  type PathRestriction,
  type ProjectScope,
  type ReadScope,
  type ReaderContext,
  type SourceKind,
  type StageRules,
} from './types.js';

/** One `(role, stage)` row: the access matrix plus the required-input table. */
export interface AclRule extends StageRules {
  readonly pathPrefixes: readonly RepoPath[];
  readonly artifactClasses: readonly ArtifactClass[];
  readonly messageClasses: readonly MessageClass[];
}

/** Every role's legal stages (`data.md` §2 `run.stage` × `agents.md` §2 table). */
export const ROLE_STAGES: Readonly<Record<ContextRole, readonly ContextStage[]>> = {
  chief: ['assist', 'coordinate', 'initialize'],
  product: ['product', 'document', 'document_check'],
  planning: ['planning', 'document'],
  backend: ['develop-L1', 'develop-L2', 'develop-L3'],
  frontend: ['develop-L1', 'develop-L2', 'develop-L3'],
  review: ['document_check', 'review'],
  test: ['test'],
  settlement: ['settlement'],
};

/** Artifact classes each role may resolve at any stage (`execution.md` §3). */
export const ROLE_ARTIFACT_CLASSES: Readonly<Record<ContextRole, readonly ArtifactClass[]>> = {
  chief: [
    'explanation',
    'product',
    'plan',
    'diff',
    'review',
    'test',
    'settlement',
    'decision',
    'recovery',
    'attachment',
    'log',
    'evidence',
  ],
  product: ['explanation', 'product', 'decision', 'attachment', 'log'],
  planning: ['explanation', 'product', 'plan', 'decision', 'attachment', 'log'],
  backend: [
    'explanation',
    'product',
    'plan',
    'diff',
    'decision',
    'recovery',
    'attachment',
    'log',
    'evidence',
  ],
  frontend: [
    'explanation',
    'product',
    'plan',
    'diff',
    'decision',
    'recovery',
    'attachment',
    'log',
    'evidence',
  ],
  review: [
    'explanation',
    'product',
    'plan',
    'diff',
    'review',
    'test',
    'attachment',
    'log',
    'evidence',
  ],
  test: [
    'explanation',
    'product',
    'plan',
    'diff',
    'review',
    'test',
    'attachment',
    'log',
    'evidence',
  ],
  settlement: [
    'explanation',
    'product',
    'plan',
    'diff',
    'review',
    'test',
    'settlement',
    'decision',
    'recovery',
    'attachment',
    'log',
    'evidence',
  ],
};

/**
 * Message classes each role may resolve.
 *
 * Review and Test read **none**: they are the independent verification roles, and
 * `AC-033` requires their inputs *and* their tools to contain no developer chat.
 * Every other role may read the user's own request; another Agent's result is
 * Chief's summarised business, never a professional Agent's raw input.
 */
export const ROLE_MESSAGE_CLASSES: Readonly<Record<ContextRole, readonly MessageClass[]>> = {
  chief: ['user_request', 'system_notice'],
  product: ['user_request'],
  planning: ['user_request'],
  backend: ['user_request'],
  frontend: ['user_request'],
  review: [],
  test: [],
  settlement: ['user_request'],
};

/** The source kinds a stage may resolve, per role (`execution.md` §3). */
type StageAccess = Readonly<
  Record<ContextRole, Partial<Record<ContextStage, readonly SourceKind[]>>>
>;

const READ_ALL_BUT_TRANSCRIPT: readonly SourceKind[] = [
  'git',
  'artifact',
  'policy',
  'role_contract',
  'knowledge',
  'message',
];

const READ_WITHOUT_MESSAGE: readonly SourceKind[] = [
  'git',
  'artifact',
  'policy',
  'role_contract',
  'knowledge',
];

export const STAGE_ACCESS: StageAccess = {
  chief: {
    assist: READ_ALL_BUT_TRANSCRIPT,
    coordinate: READ_ALL_BUT_TRANSCRIPT,
    initialize: READ_ALL_BUT_TRANSCRIPT,
  },
  product: {
    product: READ_ALL_BUT_TRANSCRIPT,
    document: READ_WITHOUT_MESSAGE,
    document_check: READ_WITHOUT_MESSAGE,
  },
  planning: {
    planning: READ_ALL_BUT_TRANSCRIPT,
    document: READ_WITHOUT_MESSAGE,
  },
  backend: {
    'develop-L1': READ_ALL_BUT_TRANSCRIPT,
    'develop-L2': READ_ALL_BUT_TRANSCRIPT,
    'develop-L3': READ_ALL_BUT_TRANSCRIPT,
  },
  frontend: {
    'develop-L1': READ_ALL_BUT_TRANSCRIPT,
    'develop-L2': READ_ALL_BUT_TRANSCRIPT,
    'develop-L3': READ_ALL_BUT_TRANSCRIPT,
  },
  review: {
    document_check: READ_WITHOUT_MESSAGE,
    review: READ_WITHOUT_MESSAGE,
  },
  test: {
    test: READ_WITHOUT_MESSAGE,
  },
  settlement: {
    settlement: READ_ALL_BUT_TRANSCRIPT,
  },
};

/** A path prefix plus the reason a scope admits it. */
interface PrefixRule {
  readonly kind: 'code' | 'document' | 'feature' | 'work';
  readonly reason: string;
}

/** Feature navigation is shared knowledge: every role may navigate it (`§3`). */
const FEATURE_NAVIGATION_PREFIX = 'features';

/**
 * The frozen Artifact tree (`data.md` §4) is readable in principle; the *class*
 * check in `canRead` is what limits a role to the Artifacts it may see, so this
 * prefix never widens access to a future stage's report.
 */
const ARTIFACT_PREFIX = ARTIFACT_ROOT;

/** Which prefixes each role's read scope is built from. */
const ROLE_PREFIX_RULES: Readonly<Record<ContextRole, readonly PrefixRule[]>> = {
  chief: [
    { kind: 'document', reason: 'Project 概览与正式文档（agents.md §2 选择顺序）' },
    { kind: 'code', reason: '授权冻结源码（execution.md §3 Chief 只读调查）' },
    { kind: 'feature', reason: 'Feature 导航（agents.md §2 选择顺序）' },
    { kind: 'work', reason: '当前 Work 过程记录' },
  ],
  product: [
    { kind: 'document', reason: '授权候选产品文档（agents.md §1 product 写入边界）' },
    { kind: 'code', reason: '已有能力调查所需源码' },
    { kind: 'feature', reason: 'Feature 导航（现有能力调查）' },
    { kind: 'work', reason: '当前 Work 过程记录' },
  ],
  planning: [
    { kind: 'document', reason: '产品/技术文档（agents.md §2 Planning 输入）' },
    { kind: 'code', reason: '技术方案所需冻结源码' },
    { kind: 'feature', reason: 'Feature 导航（关联影响）' },
    { kind: 'work', reason: '当前 Work 过程记录' },
  ],
  backend: [
    { kind: 'code', reason: '授权 Task 源码（execution.md §3 Developer）' },
    { kind: 'document', reason: '验收与设计文档（Developer 所选资料）' },
    { kind: 'feature', reason: 'Feature 导航（关联影响）' },
    { kind: 'work', reason: '当前 Work 过程记录' },
  ],
  frontend: [
    { kind: 'code', reason: '授权 Task 源码（execution.md §3 Developer）' },
    { kind: 'document', reason: '验收与设计文档（Developer 所选资料）' },
    { kind: 'feature', reason: 'Feature 导航（关联影响）' },
    { kind: 'work', reason: '当前 Work 过程记录' },
  ],
  review: [
    { kind: 'code', reason: '冻结代码只读（execution.md §3 Review）' },
    { kind: 'document', reason: '产品/Plan/验收（execution.md §3 Review）' },
    { kind: 'feature', reason: 'Feature 导航与关联影响（execution.md §3 Review）' },
    { kind: 'work', reason: '当前 Work 过程记录（不含聊天/Transcript）' },
  ],
  test: [
    { kind: 'code', reason: '冻结源码只读（execution.md §3 Test）' },
    { kind: 'document', reason: '验收与有效 Review 结论' },
    { kind: 'feature', reason: 'Feature 验收覆盖（execution.md §3 Test）' },
    { kind: 'work', reason: '当前 Work 过程记录（不含聊天/Transcript）' },
  ],
  settlement: [
    { kind: 'document', reason: '正式文档候选 Worktree（execution.md §3 Settlement）' },
    { kind: 'code', reason: '最终 Diff 与阶段证据' },
    { kind: 'feature', reason: 'Feature 索引更新（settlement KnowledgePatch）' },
    { kind: 'work', reason: '当前 Work 过程记录' },
  ],
};

/** Write prefixes each role owns; a read scope never widens them. */
const ROLE_WRITE_PREFIXES: Readonly<Record<ContextRole, readonly string[]>> = {
  chief: [`${ARTIFACT_ROOT}/explanation`, `${ARTIFACT_ROOT}/decision`],
  product: [`${ARTIFACT_ROOT}/product`, `${ARTIFACT_ROOT}/explanation`],
  planning: [`${ARTIFACT_ROOT}/plan`, `${ARTIFACT_ROOT}/explanation`],
  backend: [`${ARTIFACT_ROOT}/diff`, `${ARTIFACT_ROOT}/evidence`, `${ARTIFACT_ROOT}/log`],
  frontend: [`${ARTIFACT_ROOT}/explanation`, `${ARTIFACT_ROOT}/evidence`, `${ARTIFACT_ROOT}/log`],
  review: [`${ARTIFACT_ROOT}/review`, `${ARTIFACT_ROOT}/log`],
  test: [`${ARTIFACT_ROOT}/test`, `${ARTIFACT_ROOT}/evidence`, `${ARTIFACT_ROOT}/log`],
  settlement: [`${ARTIFACT_ROOT}/settlement`, `${ARTIFACT_ROOT}/explanation`],
};

/** The process tree of a Work; only the current Work's id may be read. */
const WORK_TREE_PATTERN = /^\.agentdev\/work\/([^/]+)(?:\/|$)/u;

/** Session/Checkpoint trees: they belong to one Run and are never shared (§5). */
const SESSION_TREE_PATTERNS: readonly RegExp[] = [
  /^\.agentdev\/sessions(?:\/|$)/iu,
  /^\.agentdev\/checkpoints(?:\/|$)/iu,
  /^sessions(?:\/|$)/iu,
  /^checkpoints(?:\/|$)/iu,
];

/** Paths permanently outside every role's scope, with the reason. */
export const DENIED_PATH_MARKERS: readonly PathRestriction[] = [
  { prefix: '.git', reason: '仓库元数据不进入上下文（data.md §1）' },
  { prefix: 'node_modules', reason: '依赖目录不作为来源' },
  { prefix: 'dist', reason: '构建产物不作为来源' },
  { prefix: '.agentdev/sessions', reason: '其他 Run 的 Session 不挂载（context.md §5）' },
  { prefix: '.agentdev/checkpoints', reason: '其他 Run 的 Checkpoint 不挂载（context.md §5）' },
];

/**
 * The scope's prefixes are repository-relative by construction (project roots plus
 * the fixed repository trees), so this keeps the `RepoPath` contract explicit.
 */
function repoPath(prefix: string): RepoPath {
  return prefix;
}

/**
 * Normalizes a Project root into a read prefix.
 *
 * A legacy Project is initialised with `code-root=.` (`knowledge.md` §5), which is
 * the whole repository rather than a directory literally named `.`, so it becomes
 * the empty prefix. Without this, a `"."`-rooted project could read no code at all.
 */
function rootPrefix(root: string): string {
  return root === '.' || root === './' ? '' : root;
}

/** The reason a path is refused regardless of role, or `null` when it is not. */
function permanentPathDenial(path: string, scope: ReadScope): string | null {
  const normalized = path.replaceAll('\\', '/');
  for (const entry of scope.deniedPaths) {
    if (pathInPrefix(normalized, entry.prefix)) return entry.reason;
  }
  const work = WORK_TREE_PATTERN.exec(normalized);
  if (work !== null) {
    const owner = scope.pathPrefixes.find((prefix) => prefix === `.agentdev/work/${work[1]}`);
    if (owner === undefined) return `其他 Work 的过程目录不可读：${work[1] ?? ''}`;
  }
  for (const pattern of SESSION_TREE_PATTERNS) {
    if (pattern.test(normalized)) return '其他 Run 的 Session/Checkpoint 不挂载（context.md §5）';
  }
  return null;
}

/** The stage's explicit denials, mirrored into `ReadScope.denied`. */
function denialsFor(role: ContextRole, stage: ContextStage): readonly DeniedSource[] {
  const allowed = STAGE_ACCESS[role][stage] ?? [];
  const denials: DeniedSource[] = [];
  for (const kind of [
    'git',
    'artifact',
    'policy',
    'role_contract',
    'knowledge',
    'message',
  ] as const) {
    if (!allowed.includes(kind)) {
      denials.push({ kind, reason: `阶段 ${role}:${stage} 不读取 ${kind}` });
    }
  }
  denials.push({
    kind: 'transcript',
    reason: '开发聊天/Transcript 任何角色都不可读（context.md §5、AC-033）',
  });
  if (ROLE_MESSAGE_CLASSES[role].length === 0) {
    denials.push({
      kind: 'message',
      reason: `${role} 角色不读取消息正文（agents.md §2 独立验证输入隔离）`,
    });
  }
  return denials;
}

/** Artifact classes a stage may resolve: readable at or before that stage. */
export function artifactClassesFor(
  role: ContextRole,
  stage: ContextStage,
): readonly ArtifactClass[] {
  return ROLE_ARTIFACT_CLASSES[role].filter(
    (artifactClass) => !isFutureArtifact(artifactClass, stage),
  );
}

/** The rule row the ACL evaluates one `(role, stage)` request against. */
export function aclRuleFor(role: ContextRole, stage: ContextStage): AclRule | undefined {
  if (!ROLE_STAGES[role].includes(stage)) return undefined;
  const inputs = requiredInputRow(role, stage);
  if (inputs === undefined) return undefined;
  return {
    ...inputs,
    pathPrefixes: [],
    artifactClasses: artifactClassesFor(role, stage),
    messageClasses: ROLE_MESSAGE_CLASSES[role],
  };
}

/**
 * Builds the read scope of one role/stage (`context.md` §1 "readScope默认同Project
 * 当前冻结源码和正式文档；执行记录需按角色ACL").
 *
 * The scope's `sourceKinds` is exactly the access matrix row, so a Run's
 * "may I read this class" answer and its frozen scope can never disagree.
 * `null` means the `(role, stage)` pair is not a legal row at all.
 */
export function scopeFor(
  role: ContextRole,
  stage: ContextStage,
  project: ProjectScope,
): ReadScope | null {
  if (!ROLE_STAGES[role].includes(stage)) return null;
  const prefixes = new Set<string>();
  for (const rule of ROLE_PREFIX_RULES[role]) {
    if (rule.kind === 'code') prefixes.add(rootPrefix(project.codeRoot));
    if (rule.kind === 'document') prefixes.add(rootPrefix(project.documentRoot));
    if (rule.kind === 'feature') {
      prefixes.add(FEATURE_NAVIGATION_PREFIX);
      prefixes.add(ARTIFACT_PREFIX);
    }
    if (rule.kind === 'work') {
      // The process tree itself is readable; the transcript deny-list inside it is
      // what keeps chats out (`AC-033`), and a missing Work only drops `work/<id>`.
      prefixes.add('.agentdev');
      if (project.workId !== undefined) prefixes.add(`.agentdev/work/${project.workId}`);
    }
  }
  return {
    projectId: project.projectId,
    pathPrefixes: [...prefixes].sort((left, right) => (left < right ? -1 : 1)).map(repoPath),
    artifactClasses: artifactClassesFor(role, stage),
    messageClasses: ROLE_MESSAGE_CLASSES[role],
    sourceKinds: STAGE_ACCESS[role][stage] ?? [],
    denied: denialsFor(role, stage),
    deniedPaths: DENIED_PATH_MARKERS,
    writePaths: ROLE_WRITE_PREFIXES[role].map(repoPath),
  };
}

/**
 * Whether one selected source is inside the reader's frozen scope.
 *
 * Denials are reported with the code Chief needs: `CONTEXT_FORBIDDEN` for a
 * policy refusal (cross-project, Session/Checkpoint of another Run, transcript or
 * message content, an artifact the stage cannot see) and `VALIDATION_ERROR` for a
 * handle whose class cannot even be established (`AC-034` still anchors the
 * cross-project answer on `CONTEXT_FORBIDDEN`).
 */
export function canRead(
  role: ContextRole,
  stage: ContextStage,
  source: ContextSourceRef,
  scope: ReadScope,
  reader: ReaderContext = {},
): AclDecision {
  const sourceProject = source.projectId;
  // AC-034 first, before any path or class reasoning: a B-Project source must be
  // refused even when its handle would be perfectly readable in A, so a caller can
  // never distinguish "not yours" from "not there" by probing.
  if (sourceProject !== undefined && sourceProject !== scope.projectId) {
    return forbidden(source, 'CONTEXT_FORBIDDEN', `来源属于其他 Project：${sourceProject}`);
  }
  if (!scope.sourceKinds.includes(source.kind)) {
    return forbidden(source, 'CONTEXT_FORBIDDEN', `阶段 ${role}:${stage} 不读取 ${source.kind}`);
  }
  if (source.kind === 'transcript') {
    return forbidden(source, 'CONTEXT_FORBIDDEN', '开发聊天/Transcript 不可读（context.md §5）');
  }
  const path = source.path;
  if (path !== undefined) {
    // `data.md` §1 forbids absolute paths and `..` outright: a handle that escapes
    // its root is refused before any prefix comparison, so path normalization can
    // never be the thing that decides access.
    if (path.startsWith('/') || path.split('/').includes('..')) {
      return forbidden(source, 'CONTEXT_FORBIDDEN', `路径逃逸 readScope 根：${path}`);
    }
    if (isDeniedSourcePath(path)) {
      return forbidden(source, 'CONTEXT_FORBIDDEN', `路径命中 Transcript 禁止表：${path}`);
    }
    const permanent = permanentPathDenial(path, scope);
    if (permanent !== null) return forbidden(source, 'CONTEXT_FORBIDDEN', permanent);
    if (!scope.pathPrefixes.some((prefix) => pathInPrefix(path, prefix))) {
      return forbidden(source, 'CONTEXT_FORBIDDEN', `路径不在 readScope 内：${path}`);
    }
  }
  const otherRun = sessionOfAnotherRun(source, reader);
  if (otherRun !== null) {
    return forbidden(source, 'CONTEXT_FORBIDDEN', otherRun);
  }
  if (source.kind === 'artifact') {
    const artifactClass = source.artifactClass ?? classOf(source);
    if (artifactClass === null) {
      return forbidden(
        source,
        'VALIDATION_ERROR',
        `无法识别 Artifact class：${source.path ?? source.id}`,
      );
    }
    if (!scope.artifactClasses.includes(artifactClass)) {
      return forbidden(
        source,
        'CONTEXT_FORBIDDEN',
        `阶段 ${role}:${stage} 不读取 ${artifactClass} 产物（不得读取未来阶段产物）`,
      );
    }
  }
  if (source.kind === 'message') {
    const messageClass = source.sender === undefined ? null : classifyMessageSender(source.sender);
    if (messageClass === null || !scope.messageClasses.includes(messageClass)) {
      return forbidden(source, 'CONTEXT_FORBIDDEN', `${role} 角色不读取该消息正文`);
    }
  }
  return {
    allowed: true,
    code: 'MISSING_CONTEXT',
    message: `允许读取 ${source.kind}:${source.id}`,
  };
}

/** `explainDenial` answers the same question as `canRead`, shaped for reporting. */
export function explainDenial(
  role: ContextRole,
  stage: ContextStage,
  source: ContextSourceRef,
  scope: ReadScope,
  reader: ReaderContext = {},
): Extract<AclDecision, { allowed: false }> | null {
  const decision = canRead(role, stage, source, scope, reader);
  return decision.allowed ? null : decision;
}

/** The source classes allowed for one `(role, stage)`; `null` when invalid. */
export function readableSourceKinds(
  role: ContextRole,
  stage: ContextStage,
): readonly SourceKind[] | null {
  if (!ROLE_STAGES[role].includes(stage)) return null;
  return STAGE_ACCESS[role][stage] ?? null;
}

/** `true` when the ACL refuses a source for this reader. */
export function isDeniedSource(
  role: ContextRole,
  stage: ContextStage,
  source: ContextSourceRef,
  scope: ReadScope,
  reader: ReaderContext = {},
): boolean {
  return !canRead(role, stage, source, scope, reader).allowed;
}

/** Canonical `(role, stage)` pairs, one entry per legal row. */
export function roleStagePairs(): readonly (readonly [ContextRole, ContextStage])[] {
  const pairs: (readonly [ContextRole, ContextStage])[] = [];
  for (const role of Object.keys(ROLE_STAGES) as ContextRole[]) {
    for (const stage of ROLE_STAGES[role]) pairs.push([role, stage]);
  }
  return pairs;
}

/** Every canonical stage, for completeness assertions in tests. */
export const ACL_STAGES: readonly ContextStage[] = PIPELINE_ORDER;

function classOf(source: ContextSourceRef): ArtifactClass | null {
  return source.path === undefined ? null : artifactClassFromPath(source.path);
}

function pathInPrefix(path: string, prefix: string): boolean {
  // `.`/`./` is the legacy whole-repository root (`knowledge.md` §5): it matches
  // every repository-relative path, exactly like the empty prefix.
  if (prefix === '' || prefix === '.' || prefix === './') return true;
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const normalized = path.replaceAll('\\', '/');
  return normalized === base || normalized.startsWith(`${base}/`);
}

/** The Session/Checkpoint of another Run is never readable (`context.md` §5). */
function sessionOfAnotherRun(source: ContextSourceRef, reader: ReaderContext): string | null {
  const runScopedKind = source.kind === 'policy' || source.kind === 'role_contract';
  const namesRunScopedObject =
    /session|checkpoint/iu.test(source.id) ||
    (source.path !== undefined && /session|checkpoint/iu.test(source.path));
  if (!runScopedKind || !namesRunScopedObject) return null;
  if (source.ownedRunId === undefined) {
    return `Session/Checkpoint 缺少所属 Run：${source.id}`;
  }
  if (reader.runId === undefined) {
    return `当前读者没有 Run 绑定，不能读取 Session/Checkpoint：${source.id}`;
  }
  if (source.ownedRunId !== reader.runId) {
    return `Session/Checkpoint 属于其他 Run：${source.ownedRunId}`;
  }
  return null;
}

function forbidden(
  ref: ContextSourceRef,
  code: ErrorCode,
  message: string,
): Extract<AclDecision, { allowed: false }> {
  // A denial is reported against the storage handle (`contracts.SourceRef`), so
  // the refusal is loggable even when the source is not one Resolve could address
  // — and a refusal never carries the refused content (`AC-033`, `AC-034`).
  return { allowed: false, code, message, ref: denialSourceRef(ref) };
}
