/**
 * The shared Context vocabulary (`docs/architecture/context.md` §1 and §5).
 *
 * Everything the Context layer does is expressed with the names in this file:
 * who is reading (`ContextRole`), at which stage (`ContextStage`), from which
 * class of source (`SourceKind`), inside which authorised scope (`ReadScope`),
 * and what the frozen result of that read looks like (`ContextSnapshot`).
 *
 * The document is the authority for each field:
 *
 * - §1 输入权威与读取 — inputs are `ref`s, never free text; every selection entry
 *   carries a `reason`; the snapshot records selection/resolvedSources/excluded/
 *   unknowns/policy+config hash/createdAt and binds the read ledger; expansion
 *   reads stay inside `readScope` and are reported as `ContextRequest`s when they
 *   do not.
 * - §5 冷启动与会话 — a new Conversation starts from Chief's fixed rules, the
 *   Project overview and the current domain summary, never from another
 *   Conversation's transcript; a Checkpoint belongs to the current Run only, and
 *   a Reviewer can never read another Run's Session/Checkpoint.
 * - `data.md` §1 fixes the scalar forms (hash = lowercase SHA256, time = UTC
 *   ISO8601 with milliseconds, paths = repository-relative) and §3 fixes
 *   `ContextSelection`, which `ContextSnapshot.selection` freezes verbatim.
 */
import type {
  ArtifactKind,
  ContextSelection,
  ErrorCode,
  Hash,
  MessageSender,
  RepoPath,
  Role,
  SourceRef,
  Time,
} from '@agentdev/contracts';

/**
 * Re-exported so a caller of the Context layer can name the selection it passes
 * (`data.md` §3 `ContextSelection`) without depending on `contracts` directly.
 */
export type { ContextSelection } from '@agentdev/contracts';

/** The eight fixed roles (`rules/agents.md` §1); Chief included. */
export type ContextRole = Role;

/** Every role, in the documented order, for exhaustive matrices. */
export const CONTEXT_ROLES = [
  'chief',
  'product',
  'planning',
  'backend',
  'frontend',
  'review',
  'test',
  'settlement',
] as const satisfies readonly ContextRole[];

/**
 * The domain stages of one Run (`data.md` §2 `run.stage`, `agents.md` §2 table).
 *
 * Names are canonical: `normalizeContextStage` maps the runtime spellings the
 * Orchestrator already accepts (`develop`, `plan`, `document_review`, …) onto
 * them, and refuses anything outside this vocabulary.
 */
export const CONTEXT_STAGES = [
  'assist',
  'coordinate',
  'initialize',
  'product',
  'planning',
  'develop-L1',
  'develop-L2',
  'develop-L3',
  'document',
  'document_check',
  'review',
  'test',
  'settlement',
] as const;
export type ContextStage = (typeof CONTEXT_STAGES)[number];

/** Normalizes a stage spelling; `null` when it is not a domain stage. */
export function normalizeContextStage(raw: string): ContextStage | null {
  const lowered = raw.trim().toLowerCase();
  if (lowered === '') return null;
  const direct = CONTEXT_STAGES.find((stage) => stage.toLowerCase() === lowered);
  if (direct !== undefined) return direct;
  const aliases: Readonly<Record<string, ContextStage>> = {
    plan: 'planning',
    develop: 'develop-L2',
    develop_l1: 'develop-L1',
    develop_l2: 'develop-L2',
    develop_l3: 'develop-L3',
    implementation: 'develop-L2',
    code_review: 'review',
    document_review: 'document_check',
    init: 'initialize',
  };
  return aliases[lowered] ?? null;
}

/** Development level carried by a stage; `null` for non-code stages. */
export function developmentLevelOf(stage: ContextStage): 1 | 2 | 3 | null {
  if (stage === 'develop-L1') return 1;
  if (stage === 'develop-L2') return 2;
  if (stage === 'develop-L3') return 3;
  return null;
}

/**
 * The classes of input the Builder may resolve (`context.md` §1, `agents.md` §2).
 *
 * `contracts.SourceRefKind` only names the storage handle (`git|artifact|message|
 * action|decision|policy`); this wider vocabulary is what the ACL and the
 * required-input table switch on. `toSourceRefKind` is the single mapping between
 * the two so the two vocabularies cannot drift.
 */
export const SOURCE_KINDS = [
  'git',
  'artifact',
  'policy',
  'role_contract',
  'knowledge',
  'transcript',
  'message',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Maps a Context source class onto the storage-level `SourceRef.kind`. */
export function toSourceRefKind(kind: SourceKind): SourceRef['kind'] {
  switch (kind) {
    case 'git':
      return 'git';
    case 'artifact':
      return 'artifact';
    case 'policy':
      return 'policy';
    case 'role_contract':
      return 'policy';
    case 'knowledge':
      return 'git';
    case 'transcript':
      return 'message';
    case 'message':
      return 'message';
  }
}

/** Maps a storage-level `SourceRef.kind` back onto a Context source class. */
export function fromSourceRefKind(kind: SourceRef['kind']): SourceKind {
  switch (kind) {
    case 'git':
      return 'git';
    case 'artifact':
      return 'artifact';
    case 'policy':
      return 'policy';
    case 'message':
      return 'message';
    case 'action':
      return 'message';
    case 'decision':
      return 'policy';
  }
}

/**
 * Widens a storage-level `SourceRef` into the Context vocabulary.
 *
 * A `decision` is a policy-class fact and an `action` is a recorded user message,
 * which is why both round-trip through `fromSourceRefKind`.
 */
export function fromSourceRef(ref: SourceRef): ContextSourceRef {
  const widened: {
    kind: SourceKind;
    id: string;
    version: string;
    path?: RepoPath;
    hash?: Hash;
  } = { kind: fromSourceRefKind(ref.kind), id: ref.id, version: ref.version };
  if (ref.path !== undefined) widened.path = ref.path;
  if (ref.hash !== undefined) widened.hash = ref.hash;
  return widened;
}

/** Artifact classes, exactly the `ArtifactKind` value set (`data.md` §3). */
export type ArtifactClass = ArtifactKind;

/** Message classes: who authored the body and what it may be used for. */
export const MESSAGE_CLASSES = ['user_request', 'agent_result', 'system_notice'] as const;
export type MessageClass = (typeof MESSAGE_CLASSES)[number];

/** Classifies a message body by its sender (`data.md` §2 `message`). */
export function classifyMessageSender(sender: MessageSender): MessageClass {
  if (sender === 'user') return 'user_request';
  if (sender === 'system') return 'system_notice';
  return 'agent_result';
}

/** Project identity and roots the ACL resolves read scopes against. */
export interface ProjectScope {
  /** `project.id` — 32 lowercase hex (`data.md` §1/§2). */
  readonly projectId: string;
  /** Repository-relative code root (`project.codeRoot`). */
  readonly codeRoot: RepoPath;
  /** Repository-relative document root (`project.documentRoot`). */
  readonly documentRoot: RepoPath;
  /** The delivery branch a Run may resolve knowledge from (`project.deliveryBranch`). */
  readonly deliveryBranch: string;
  /** Optional Work whose process directory this Run may read (`.agentdev/work/<id>/`). */
  readonly workId?: string;
}

/** Repository-relative prefix of the artifact blob tree (`data.md` §4). */
export const ARTIFACT_ROOT = 'artifacts';

/**
 * Paths that must never enter a context object at all.
 *
 * `context.md` §5 forbids reading a development Conversation/Transcript and the
 * `agents.md` §2 rule "引用其他Agent Transcript…禁止输入返回CONTEXT_FORBIDDEN"
 * makes this structural rather than role-dependent, so the deny-list is by *kind*
 * (`transcript`) **and** by path marker. The patterns are anchored on a file or
 * directory *named* like a chat/transcript record, so an ordinary source file
 * such as `src/chat.ts` (a chat feature, not a chat log) stays readable.
 */
export const DENIED_SOURCE_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)(?:transcripts?)(?:\/|$)/iu,
  /(?:^|\/)chat[-_ ](?:log|history|transcript|record|export)[^/]*$/iu,
  /(?:^|\/)(?:chat|conversation|transcript|chat_history)[^/]*\.(?:log|md|txt|json|jsonl)$/iu,
  // A chat/transcript record exported from a development or agent session:
  // `docs/dev-chat.md` and `docs/developer-transcript.md` are the same class of
  // record as `chat.log`, so the developer/agent prefix must not evade the net.
  /(?:^|\/)(?:dev(?:elop(?:er|ment)?)?|agent)[-_ ]?(?:chat|conversation|transcripts?)(?:[-_ ]?(?:log|history|record|export|notes?))?\.(?:log|md|txt|json|jsonl)$/iu,
  /(?:^|\/)(?:dev(?:elop(?:er|ment)?)?|agent)[-_ ]?(?:chat|conversation|transcripts?)(?:\/|$)/iu,
];

/** `true` when a repository-relative path carries a denied transcript marker. */
export function isDeniedSourcePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return DENIED_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Where each artifact class is produced.
 *
 * The ACL uses it to refuse "reading the future": a stage may never satisfy an
 * input that a later stage produces (`AC-079`), which is what keeps a
 * `CompactPlan`-only L1 Develop from being forced to wait for a full `Plan`.
 */
export const ARTIFACT_PRODUCER_STAGE: Readonly<Record<ArtifactClass, ContextStage>> = {
  explanation: 'product',
  product: 'product',
  plan: 'planning',
  diff: 'develop-L1',
  review: 'review',
  test: 'test',
  settlement: 'settlement',
  decision: 'assist',
  recovery: 'assist',
  attachment: 'assist',
  log: 'assist',
  evidence: 'develop-L1',
};

/**
 * Artifact classes the Chief/user conversation produces (`assist`/`coordinate`).
 *
 * `agents.md` §2 documents a user-confirmed decision and a selected attachment as
 * inputs to *professional* stages — a Product takes its `confirmedSource` from a
 * decision Artifact and a Developer reads the attachment it was pointed at — so
 * these classes are readable from the first professional stage on. A Chief session
 * is not a stage of the artifact pipeline, so its products are not "future
 * products" of an earlier pipeline stage; only `plan`/`review`/`test`/… keep the
 * "a stage cannot read its own future artifact" rule (`AC-079`).
 */
export const CHIEF_SESSION_ARTIFACT_CLASSES: readonly ArtifactClass[] = [
  'decision',
  'recovery',
  'attachment',
  'log',
];

/**
 * The pipeline position a class becomes readable at.
 *
 * Chief-session classes rank before `initialize` (i.e. at every stage); a pipeline
 * class ranks at its producer stage. This is the single ordering the ACL and the
 * required-input table must agree on, so the two tables cannot contradict.
 */
export function artifactReadRank(artifactClass: ArtifactClass): number {
  if (CHIEF_SESSION_ARTIFACT_CLASSES.includes(artifactClass)) return -1;
  return pipelineRank(ARTIFACT_PRODUCER_STAGE[artifactClass]);
}

/** Ordering of the stages an artifact pipeline passes through (`workflow.md` §2). */
export const PIPELINE_ORDER: readonly ContextStage[] = [
  // The professional pipeline runs product → plan → implement → verify → settle.
  // `assist`/`coordinate` are Chief stages that wrap the whole conversation: they
  // rank *after* settlement so a Chief may read every role's structured result,
  // while a professional stage can still never read its own future.
  'initialize',
  'product',
  'planning',
  'document',
  'develop-L1',
  'develop-L2',
  'develop-L3',
  'review',
  'test',
  'document_check',
  'settlement',
  'assist',
  'coordinate',
];

/**
 * Position of a stage in `PIPELINE_ORDER`.
 *
 * An unknown stage ranks *last*, so a stage the vocabulary does not know can never
 * be treated as "early" and thereby be allowed to read a future artifact.
 */
export function pipelineRank(stage: ContextStage): number {
  const rank = PIPELINE_ORDER.indexOf(stage);
  return rank === -1 ? PIPELINE_ORDER.length : rank;
}

/** `true` when `producer` runs after `consumer`, so it is a future artifact. */
export function isFutureProduct(producer: ContextStage, consumer: ContextStage): boolean {
  return pipelineRank(producer) > pipelineRank(consumer);
}

/**
 * `true` when `consumer` sits before `artifactClass` becomes readable.
 *
 * This is the artifact-level form of the "no future read" rule (`AC-079`): it uses
 * `artifactReadRank`, so a Chief-session class (a user decision or an attachment)
 * is never a future product for a professional stage.
 */
export function isFutureArtifact(artifactClass: ArtifactClass, consumer: ContextStage): boolean {
  return artifactReadRank(artifactClass) > pipelineRank(consumer);
}

/** One documented denial: the scope excludes it and says why. */
export interface DeniedSource {
  readonly kind: SourceKind;
  readonly reason: string;
}

/** One path restriction inside a read scope. */
export interface PathRestriction {
  readonly prefix: string;
  readonly reason: string;
}

/**
 * The maximum a Run of one role/stage may read (`context.md` §1 "readScope",
 * `execution.md` §3 role ACL).
 *
 * A Run may append reads only inside this scope; a wider read must go back to
 * Chief as a `ContextRequest`. Adding a field here is what makes a new
 * restriction auditable, so every per-role rule must be represented.
 */
export interface ReadScope {
  /** The Project the scope belongs to; a source from another one is refused. */
  readonly projectId: string;
  /** Repository-relative prefixes ("" means the whole repository). */
  readonly pathPrefixes: readonly RepoPath[];
  /** Artifact classes the scope may resolve (`artifactRefs`). */
  readonly artifactClasses: readonly ArtifactClass[];
  /** Message classes the scope may resolve (`message`/`transcript` refs). */
  readonly messageClasses: readonly MessageClass[];
  /** Source classes the scope may resolve at all. */
  readonly sourceKinds: readonly SourceKind[];
  /** Explicit per-kind denials with their reason. */
  readonly denied: readonly DeniedSource[];
  /** Paths permanently outside the scope, with their reason. */
  readonly deniedPaths: readonly PathRestriction[];
  /** Write prefixes this Run owns; a read scope never grants a read outside them. */
  readonly writePaths: readonly RepoPath[];
}

/**
 * A requested input handle plus the metadata the ACL needs beyond `SourceRef`.
 *
 * `kind` is the wider `SourceKind` vocabulary, so the shared scalar shape of a
 * `SourceRef` is restated here rather than narrowed: a `knowledge` file or a
 * `transcript` is addressable as an input even though the storage handle for both
 * is `git`/`message`. `toSourceRef` is the one mapping back to the storage form.
 */
export interface ContextSourceRef {
  readonly kind: SourceKind;
  readonly id: string;
  readonly version: string;
  readonly path?: RepoPath;
  readonly hash?: Hash;
  /**
   * Public label of the source (e.g. a message sender), used for classification.
   *
   * Never body content: `context.md` §4 keeps message bodies out of Artifacts.
   */
  readonly sender?: MessageSender;
  /** Artifact class when `kind=artifact`; derived from the blob path otherwise. */
  readonly artifactClass?: ArtifactClass;
  /** The Run that owns the source, for Session/Checkpoint isolation (`§5`). */
  readonly ownedRunId?: string;
  /** Project the source belongs to; a mismatch is cross-project (`AC-034`). */
  readonly projectId?: string;
}

/**
 * Narrows a Context source onto the storage-level `SourceRef`.
 *
 * `knowledge` has no single storage handle (a projected Feature is a Git file),
 * so it is reported unresolved instead of being given a fabricated kind.
 */
export function toSourceRef(source: ContextSourceRef): SourceRef | null {
  if (source.kind === 'knowledge') return null;
  const kind: SourceRef['kind'] =
    source.kind === 'role_contract'
      ? 'policy'
      : source.kind === 'transcript'
        ? 'message'
        : source.kind;
  const shaped: {
    kind: SourceRef['kind'];
    id: string;
    version: string;
    path?: RepoPath;
    hash?: Hash;
  } = { kind, id: source.id, version: source.version };
  if (source.path !== undefined) shaped.path = source.path;
  if (source.hash !== undefined) shaped.hash = source.hash;
  return shaped;
}

/**
 * The `SourceRef` a denial is reported against.
 *
 * A denial must be loggable even when the refused source is not addressable as a
 * storage handle, so this always yields a shape instead of `null`.
 */
export function denialSourceRef(source: ContextSourceRef): SourceRef {
  const narrowed = toSourceRef(source);
  return narrowed ?? { kind: 'policy', id: source.id, version: source.version };
}

/**
 * The ACL's answer for one source.
 *
 * A denial always carries the `contracts.ERROR_CODES` member so the caller can
 * fail with the documented code instead of inventing one
 * (`AC-034` needs `CONTEXT_FORBIDDEN`/`NOT_FOUND`).
 */
export type AclDecision =
  | { readonly allowed: true; readonly code: ErrorCode; readonly message: string }
  | {
      readonly allowed: false;
      readonly code: ErrorCode;
      readonly message: string;
      readonly ref: SourceRef;
    };

/** What the ACL knows about the reader (`context.md` §5 cold start). */
export interface ReaderContext {
  /** The Run on whose behalf the read happens. */
  readonly runId?: string;
  /** The physical session of that Run, if any. */
  readonly sessionRef?: string;
  /** The Project that owns the Run. */
  readonly projectId?: string;
}

/**
 * One resolved source inside the frozen context (`context.md` §1).
 *
 * `hash`/`bytes` are the frozen content's identity and size, so a later file
 * change can be detected instead of silently polluting a started Run.
 */
export interface ResolvedSource {
  readonly ref: SourceRef;
  readonly kind: SourceKind;
  readonly id: string;
  readonly path?: RepoPath;
  readonly revision?: string;
  readonly version?: string;
  readonly hash: Hash;
  readonly bytes: number;
  /** `selection.reasonPerSource[refKey]` — a reason is mandatory to resolve. */
  readonly reason: string;
}

/** A selected source the ACL or the resolver refused (`context.md` §1). */
export interface ExcludedSource {
  readonly ref: SourceRef;
  readonly reason: string;
}

/** A selection entry the Builder could not answer (`context.md` §1). */
export interface ContextUnknown {
  readonly ref: SourceRef;
  readonly reason: string;
}

/** A reasoned request to read beyond the current scope (`context.md` §1/§5). */
export interface ContextRequest {
  readonly ref: SourceRef;
  readonly reason: string;
  /** Optional stage/role hint so Chief can route the escalation. */
  readonly requestedBy?: ContextRole;
  readonly createdAt?: Time;
}

/**
 * A gap between the context a Run needs and the context it was given.
 *
 * `code` is a `contracts.ERROR_CODES` member: `MISSING_CONTEXT` for an absent but
 * obtainable input (`AC-031`/`AC-079`), `CONTEXT_FORBIDDEN` for one that is
 * refused by policy, `STALE_ARTIFACT` for a source whose revision moved on.
 */
export interface ContextGap {
  readonly code: ErrorCode;
  readonly message: string;
  readonly ref?: SourceRef;
  /** Required-input key the gap belongs to, when the gap came from the table. */
  readonly input?: string;
}

/**
 * The frozen result of one authorised read (`context.md` §1, `data.md` §2
 * `snapshot` with `type='context'`).
 */
export interface ContextSnapshot {
  /** Content hash of the frozen payload; the `(type, hash)` snapshot key. */
  readonly snapshotRef: Hash;
  /** Chief's selection, frozen verbatim (`data.md` §3 `ContextSelection`). */
  readonly selection: ContextSelection;
  /** The sources that were actually resolved, with hash and size. */
  readonly resolvedSources: readonly ResolvedSource[];
  /** Selected sources the ACL refused, with the reason. */
  readonly excluded: readonly ExcludedSource[];
  /** Selection entries that could not be answered yet. */
  readonly unknowns: readonly ContextUnknown[];
  /** Hash of the policy revision the ACL was evaluated under. */
  readonly policyHash: Hash;
  /** Hash of the frozen configuration (`data.md` §3 `configSnapshotId`). */
  readonly configHash: Hash;
  /** When the snapshot was frozen; UTC ISO8601 milliseconds. */
  readonly createdAt: Time;
  /** Digest of the `ReadScope` this Run is confined to. */
  readonly readScopeDigest: Hash;
  /** Token accounting for the initial package and later expansion reads. */
  readonly tokenAccounting: TokenAccounting;
}

/** The assembled context an agent actually receives. */
export interface ResolvedContext {
  readonly snapshot: ContextSnapshot;
  readonly sources: readonly ResolvedSource[];
  readonly gaps: readonly ContextGap[];
}

/** A structured failure carrying a `contracts.ERROR_CODES` member. */
export interface ContextError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly ref?: SourceRef;
}

/** `{ok:true,…} | {ok:false,errors:[…]}` as used by the builder and ledger APIs. */
export type ContextResult<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly errors: readonly ContextError[] };

/** Token budget bookkeeping for one Run (`rules/agents.md` §6). */
export interface TokenAccounting {
  /** Startup package ceiling and usage. */
  readonly initial: { readonly limit: number; readonly used: number };
  /** Additional-read ceiling and usage. */
  readonly expansion: { readonly limit: number; readonly used: number };
}

/**
 * The documented adjustable range of a configured read budget (`agents.md` §6:
 * `限制可以在配置范围4096–2000000内调整`).
 *
 * `0` is deliberately *inside* the accepted set as the explicit "this package may
 * carry nothing" budget: `AC-036` requires a zero-budget startup to fail with a
 * reported gap rather than with a validation error, and a ledger uses
 * `expansionTokens: 0` for "no additional reads were granted".
 */
export const READ_BUDGET_MIN_TOKENS = 4_096;
export const READ_BUDGET_MAX_TOKENS = 2_000_000;

/**
 * Validates one configured budget value; `null` when it is acceptable.
 *
 * The single validator the builder, the ledger and the cold-start limits share, so
 * a value accepted in one place can never be refused in another. Non-integers,
 * negatives, and anything outside `[4096, 2000000]` (except the explicit `0`) are
 * refused rather than clamped, so a mis-sized ceiling is surfaced to Chief.
 */
export function readBudgetValueError(name: string, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `readBudget.${name} 必须是整数（AC-036）`;
  }
  if (value < 0) {
    return `readBudget.${name} 不能为负（AC-036）`;
  }
  if (value === 0) return null;
  if (value < READ_BUDGET_MIN_TOKENS) {
    return `readBudget.${name} ${value} 低于配置下限 ${READ_BUDGET_MIN_TOKENS}（agents.md §6）`;
  }
  if (value > READ_BUDGET_MAX_TOKENS) {
    return `readBudget.${name} ${value} 超过配置上限 ${READ_BUDGET_MAX_TOKENS}（agents.md §6）`;
  }
  return null;
}

/**
 * Logical input keys the required-input table speaks in (`context.md` §1).
 *
 * They are deliberately coarse: the Builder resolves a `SourceRef`/`Path` into
 * one of these keys, and the table then decides whether that key is required,
 * optional, or illegal for the stage.
 */
export const CONTEXT_INPUT_KEYS = [
  'roleContract',
  'projectOverview',
  'bootstrapObservation',
  'userRequest',
  'confirmedSource',
  'workGoal',
  'authorization',
  'policy',
  'currentFacts',
  'productDefinition',
  'acceptance',
  'plan',
  'compactPlan',
  'replacementTarget',
  'currentFiles',
  'taskAcceptance',
  'dependencyArtifacts',
  'frozenDiff',
  'applicableChecks',
  'reviewResult',
  'testEvidence',
  'frozenCode',
  'environment',
  'verificationResult',
  'impactSet',
  'knowledgeDiff',
  'targetDocument',
  'applicableRules',
  'technicalDoc',
  'featureNavigation',
  'transcript',
  'otherProject',
  'secret',
] as const;
export type ContextInputKey = (typeof CONTEXT_INPUT_KEYS)[number];

/** Inputs that can never enter a context, whatever the stage (`§1`/`§5`). */
export const FORBIDDEN_INPUT_KEYS: readonly ContextInputKey[] = [
  'transcript',
  'otherProject',
  'secret',
];

/** What each stage row of `agents.md` §2 needs, using the canonical keys. */
export interface StageRules {
  readonly role: ContextRole;
  readonly stage: ContextStage;
  readonly required: readonly ContextInputKey[];
  readonly optional: readonly ContextInputKey[];
  /** Required inputs that may legitimately be absent at this stage. */
  readonly allowedAbsent: readonly ContextInputKey[];
  /** Input keys that must never be satisfied for this row (future artifacts). */
  readonly notApplicable: readonly ContextInputKey[];
}

/** The `(role, stage)` lookup key of a rule row. */
export function stageRuleKey(role: ContextRole, stage: ContextStage): string {
  return `${role}:${stage}`;
}

/** Repository-relative prefix test that treats `""`/`"."` as "everything". */
export function pathIsInsidePrefix(path: string, prefix: string): boolean {
  // `.`/`./` is the legacy "whole repository" root (`knowledge.md` §5 old-Project
  // initialisation: `code-root=.`, code range excludes only the document root), so
  // it must match every repository-relative path instead of being a literal name.
  if (prefix === '' || prefix === '.' || prefix === './') return true;
  const normalized = path.replaceAll('\\', '/');
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return normalized === base || normalized.startsWith(`${base}/`);
}

/** `true` when `path` sits inside one of the scope's read prefixes. */
export function pathIsInScope(path: string, scope: ReadScope): boolean {
  return scope.pathPrefixes.some((prefix) => pathIsInsidePrefix(path, prefix));
}

/** Derives the `SourceRef` key Chief's `reasonPerSource` is indexed by. */
export function sourceRefKey(ref: SourceRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** The `reasonPerSource` value for one reference, or `undefined`. */
export function reasonForSource(selection: ContextSelection, ref: SourceRef): string | undefined {
  const key = sourceRefKey(ref);
  const reasons: Readonly<Record<string, string>> = selection.reasonPerSource;
  return reasons[key];
}

/** Classifies an artifact blob path (`artifacts/<class>/…`) into its class. */
export function artifactClassFromPath(path: string): ArtifactClass | null {
  const normalized = path.replaceAll('\\', '/');
  const withoutRoot = normalized.startsWith(`${ARTIFACT_ROOT}/`)
    ? normalized.slice(ARTIFACT_ROOT.length + 1)
    : normalized;
  const head = withoutRoot.split('/')[0] ?? '';
  const classes: readonly ArtifactClass[] = [
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
  ];
  return classes.find((entry) => entry === head) ?? null;
}

/** The repository-relative path of one artifact class' frozen content tree. */
export function artifactPathFor(artifactClass: ArtifactClass): RepoPath {
  return `${ARTIFACT_ROOT}/${artifactClass}`;
}
