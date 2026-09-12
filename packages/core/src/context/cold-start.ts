/**
 * Cold start: the seed of a new Conversation and the query answer built on it
 * (`docs/architecture/context.md` §1/§5, `docs/product/knowledge.md` §6).
 *
 * `context.md` §5 fixes the starting package:
 *
 * > 新Conversation从Chief固定规则、Project概览和当前领域摘要开始，Chief按用户问题
 * > 继续选择；不依赖旧Conversation全文。
 *
 * and §1 fixes both the selection order and the reason-per-entry rule:
 *
 * > 选择顺序：Project概览→当前Work/Requirement/Task→Feature导航→直接关联约束→
 * > 角色需要的正文/代码/测试。Chief为每个条目填写reason。…不自动展开整个模块。
 *
 * and §6 fixes the acceptance facts:
 *
 * > 固定样例包含订单、支付、会话三个Feature及关联；两次交付后冷启动要求找到当前
 * > 取消行为、支付约束、相关测试路径及已知差距。相同任务放入20份无关文档验证不默认
 * > 注入。另放开发聊天中的误导结论，Reviewer的读取轨迹必须没有该Transcript。
 *
 * This module therefore reads a WP-04 `KnowledgeProjection` and does four things:
 *
 * 1. **Assembles the seed** — the Chief's fixed rules ref, the Project overview and
 *    the current domain summary. The only thing the seed inherits from a previous
 *    physical session is the *resume position* it is handed explicitly (checkpoint
 *    facts such as the Work/Task/stage and the last tool outcome); it never absorbs
 *    a prior Conversation's transcript.
 * 2. **Selects in the documented order** — overview → current Work/Task → feature
 *    navigation → directly related constraints → role-needed bodies/code/tests —
 *    and records a reason per entry, so the selection is traceable (`AC-039`).
 * 3. **Answers a query from the delivered facts** — current behaviour, constraints,
 *    implementation entry paths and known gaps, each attributed to the Feature that
 *    states it, plus the token usage and the documents left out (`AC-037`).
 * 4. **Guards the transcript structurally** — a development-chat transcript is
 *    neither selectable nor readable, and the answer is derived from the projection,
 *    so a misleading conclusion in a chat log cannot change it (`AC-033`).
 *
 * Types: `@agentdev/knowledge` is a *consumer* of Core, not a dependency of it, so
 * this module declares the structural subset of `KnowledgeProjection` it reads and
 * validates a real projection at runtime (`projectionFacts`). A structural subset
 * keeps the package graph acyclic and still makes a genuine WP-04 projection
 * assignable and testable.
 */
import type {
  ErrorCode,
  Hash,
  ProjectionState,
  RepoPath,
  SourceRef,
  Time,
} from '@agentdev/contracts';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { nowIso, sha256 } from '@agentdev/storage';
import { canonicalJson } from '../dispatcher.js';
import { canRead, scopeFor } from './acl.js';
import {
  isDeniedSourcePath,
  readBudgetValueError,
  type ContextError,
  type ContextResult,
  type ContextRole,
  type ContextSourceRef,
  type ContextStage,
  type ExcludedSource,
  type ProjectScope,
  type ResolvedSource,
  type TokenAccounting,
} from './types.js';
import type { Checkpoint } from './checkpoint.js';

/** The Chief's fixed rules document; the first entry of every seed (`§5`). */
export const CHIEF_RULES_PATH: RepoPath = 'docs/rules/agents.md';

/** Startup package ceiling (`rules/agents.md` §6: 启动包默认最多24000`). */
export const COLD_START_STARTUP_TOKENS = 24_000;

/** Additional-read ceiling of the frozen budget (`rules/agents.md` §6). */
export const COLD_START_EXPANSION_TOKENS = 16_000;

/**
 * Why a development-chat transcript can never enter a context.
 *
 * The text is the documented reason (`context.md` §5, `agents.md` §2), and it is
 * also the marker `isDeniedSourcePath` refuses on, so the guard and the ACL agree
 * on the same set of paths.
 */
export const TRANSCRIPT_DENIAL_REASON =
  '开发聊天/Transcript 不可读，也不得进入冷启动选择（context.md §5、AC-033）';

/** The documented selection order (`context.md` §1). */
export const COLD_START_SELECTION_ORDER = [
  'role_contract',
  'project_overview',
  'current_work',
  'feature_navigation',
  'related_constraints',
  'role_bodies',
] as const;
export type ColdStartSelectionPhase = (typeof COLD_START_SELECTION_ORDER)[number];

/* ------------------------------------------------------------------ *
 * The structural projection subset this module reads
 * ------------------------------------------------------------------ */

/** One relation row of a Feature document (`context.md` §2). */
export interface ColdStartRelation {
  readonly targetFeatureId: string;
  readonly kind: string;
  readonly reason: string;
  readonly source: string;
}

/**
 * A section body of a Feature document (`context.md` §2).
 *
 * It mirrors the parsed shape structurally (only `text`/`items`), so a real
 * `ParsedFeature['sections']` value is assignable to it.
 */
export interface ColdStartSection {
  readonly text: string;
  readonly items: readonly string[];
}

/** One code-map row collected from a Feature's 实现入口 list. */
export interface ColdStartCodeMapEntry {
  readonly featureId: string;
  readonly featureName: string;
  readonly module: string;
  readonly path: string;
  readonly symbol?: string;
  readonly link: string;
}

/** One one-line index row (`features/README.md`). */
export interface ColdStartIndexEntry {
  readonly featureId: string;
  readonly name: string;
  readonly module: string;
  /** First sentence of 用途. */
  readonly summary: string;
  /** Document-root-relative path of the Feature document. */
  readonly link: string;
  readonly design: string;
  readonly implementation: string;
  readonly verification: string;
}

/** The Feature facts the cold start reads; a superset of `ProjectedFeature`. */
export interface ColdStartFeature {
  readonly featureId: string;
  readonly name: string;
  readonly module: string;
  /** Repo-relative path of the Feature document. */
  readonly documentPath: string;
  readonly design: string;
  readonly designDecisionRefs: readonly string[];
  readonly implementation: string;
  readonly verification: string;
  readonly verificationEvidenceRefs: readonly string[];
  readonly verificationCoverage: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly revision: string;
  readonly relations: readonly ColdStartRelation[];
  readonly sections: {
    readonly purpose: ColdStartSection;
    readonly currentBehaviour: ColdStartSection;
    readonly entries: ColdStartSection;
    readonly gaps: ColdStartSection;
    readonly decisions: ColdStartSection;
  };
  readonly summary: string;
  readonly link: string;
  readonly codeMapEntries: readonly ColdStartCodeMapEntry[];
}

/** One rendered formal document (`PROJECT.md`, the index, a Feature README). */
export interface ColdStartDocument {
  readonly path: string;
  readonly markdown: string;
  readonly contentHash: string;
}

/**
 * The `KnowledgeProjection` subset the cold start consumes.
 *
 * A real `buildProjection()` result satisfies this interface structurally, which the
 * `.agentdev`-free test in `context-cold-start.test.ts` asserts against a real
 * projection; keeping it structural is what stops Core from depending on the
 * knowledge package.
 */
export interface ColdStartProjection {
  readonly state: ProjectionState;
  readonly revision: string;
  readonly codeTreeRevision: string;
  readonly staleReason?: string;
  readonly features: readonly ColdStartFeature[];
  readonly index: readonly ColdStartIndexEntry[];
  readonly codeMap: readonly ColdStartCodeMapEntry[];
  readonly links: {
    readonly blockedFeatureIds: readonly string[];
    readonly deliveryBlocked: boolean;
  };
  readonly documents: {
    readonly project: ColdStartDocument;
    readonly featuresReadme: ColdStartDocument;
    readonly codeMap: ColdStartDocument;
  };
}

/** One remembered fact of a *projection* document, used for validation. */
interface ProjectionIssue {
  readonly message: string;
}

/**
 * Checks that a projection actually carries the facts the cold start reads.
 *
 * It is a shape check, not a re-parse: `knowledge.get` already published the
 * projection, so this module only refuses to invent facts when the caller passed
 * something that is not a projection at all.
 */
function projectionIssues(projection: ColdStartProjection): readonly ProjectionIssue[] {
  const issues: ProjectionIssue[] = [];
  if (projection === null || typeof projection !== 'object') {
    return [{ message: 'projection 不是对象' }];
  }
  if (projection.state !== 'valid' && projection.state !== 'stale') {
    issues.push({ message: `projection.state 非法：${String(projection.state)}` });
  }
  if (typeof projection.revision !== 'string' || projection.revision === '') {
    issues.push({ message: 'projection.revision 必须是非空字符串' });
  }
  if (!Array.isArray(projection.features)) {
    issues.push({ message: 'projection.features 必须是数组' });
  }
  if (!Array.isArray(projection.index)) {
    issues.push({ message: 'projection.index 必须是数组' });
  }
  if (!Array.isArray(projection.codeMap)) {
    issues.push({ message: 'projection.codeMap 必须是数组' });
  }
  const project = projection.documents?.project;
  if (project === undefined || typeof project.markdown !== 'string' || project.markdown === '') {
    issues.push({ message: 'projection.documents.project.markdown 必须是 Project 概览正文' });
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * The transcript guard
 * ------------------------------------------------------------------ */

/** What one path is in the corpus of the cold start. */
export type ColdStartCorpusKind = 'feature' | 'document' | 'code' | 'test' | 'transcript';

/** One registered path of the corpus. */
export interface ColdStartCorpusEntry {
  /** Stable id (`feature:<id>`, `doc:<path>`, `path:<path>`). */
  readonly id: string;
  /** Repo-relative path. */
  readonly path: RepoPath;
  readonly kind: ColdStartCorpusKind;
  readonly featureId?: string;
  /** Why this path is in the corpus at all (Chief's selection reason). */
  readonly reason?: string;
}

/**
 * The path guard (`AC-033`).
 *
 * Two independent gates must both admit a path: the ACL (the path is inside the
 * reader's frozen `readScope` and is not a denied/transcript path) and the corpus
 * allow-list (Chief registered it). `read` therefore refuses a development-chat
 * transcript even when a caller registered it and even when the file exists on
 * disk, and `unreadable` is the negative evidence a Reviewer trace can assert.
 */
export interface TranscriptGuard {
  /** The registered corpus, frozen. */
  readonly corpus: readonly ColdStartCorpusEntry[];
  /** `true` only when both gates admit the path. */
  readable(path: string): boolean;
  /** The refusal for a path, or `null` when it is readable. */
  refusal(path: string): ContextError | null;
  /** Reads one corpus path; a transcript is never read (`ok:false`, no content). */
  read(path: string): ContextResult<{ readonly path: RepoPath; readonly content: string }>;
}

export interface CreateTranscriptGuardInput {
  readonly role: ContextRole;
  readonly stage: ContextStage;
  readonly project: ProjectScope;
  /** Paths Chief registered for this cold start. */
  readonly corpus?: readonly ColdStartCorpusEntry[];
  /** Absolute path of a real directory the guard may read from. */
  readonly directory?: string;
  /** In-memory bodies keyed by repo-relative path (used when `directory` is unset). */
  readonly contents?: Readonly<Record<string, string>>;
}

/** Builds the `SourceRef` handle one corpus path is authorised as. */
function sourceForPath(path: string, projectId: string): ContextSourceRef {
  if (isDeniedSourcePath(path)) {
    return { kind: 'transcript', id: path, version: '1', path, projectId };
  }
  return { kind: 'git', id: path, version: '1', path, projectId };
}

/**
 * Creates the path guard for one cold start.
 *
 * The ACL first (`canRead`), then the corpus: a path that is not registered is
 * unreadable *by construction*, which is what keeps twenty unrelated documents out
 * of a context (`AC-037`, `AC-039`), and a transcript is unreadable whatever else is
 * true (`AC-033`).
 */
export function createTranscriptGuard(input: CreateTranscriptGuardInput): TranscriptGuard {
  const scope = scopeFor(input.role, input.stage, input.project);
  const corpus = Object.freeze((input.corpus ?? []).map((entry) => Object.freeze({ ...entry })));
  const registered = new Map(corpus.map((entry) => [entry.path, entry]));
  const directory = input.directory;

  const readable = (path: string): boolean => refusal(path) === null;

  const refusal = (path: string): ContextError | null => {
    if (typeof path !== 'string' || path === '') {
      return { code: 'VALIDATION_ERROR', message: '路径必须是非空字符串' };
    }
    if (scope === null) {
      return {
        code: 'VALIDATION_ERROR',
        message: `未登记的角色/阶段组合：${input.role}:${input.stage}`,
      };
    }
    const source = sourceForPath(path, input.project.projectId);
    const decision = canRead(input.role, input.stage, source, scope, {
      projectId: input.project.projectId,
    });
    if (!decision.allowed) {
      return { code: decision.code, message: decision.message, ref: decision.ref };
    }
    // `execution.md` §3: a file tool refuses relative-path escapes, symlink
    // escapes and nested repositories, and re-checks the *real* path when it
    // opens. A symlink inside the project that resolves outside the root is
    // therefore refused even though `join()` would read it.
    if (directory !== undefined && corpusPathState(directory, path).kind === 'outside') {
      return {
        code: 'CONTEXT_FORBIDDEN',
        message: `符号链接逃逸项目根：${path}（execution.md §3）`,
        ref: denialRefForPath(path),
      };
    }
    if (!registered.has(path)) {
      return { code: 'CONTEXT_FORBIDDEN', message: `路径未注册进本次冷启动 corpus：${path}` };
    }
    return null;
  };

  const guard: TranscriptGuard = {
    corpus,
    readable,
    refusal,
    read(path: string): ContextResult<{ readonly path: RepoPath; readonly content: string }> {
      const denied = refusal(path);
      if (denied !== null) return { ok: false, errors: [denied] };
      const registeredEntry = registered.get(path);
      if (registeredEntry?.kind === 'transcript') {
        // Belt and braces: a transcript that slipped past the path pattern still
        // cannot be read, because the corpus says what it is.
        return {
          ok: false,
          errors: [
            {
              code: 'CONTEXT_FORBIDDEN',
              message: TRANSCRIPT_DENIAL_REASON,
              ref: { kind: 'message', id: path, version: '1', path: repoPathOf(path) },
            },
          ],
        };
      }
      const fromMemory = input.contents?.[path];
      if (fromMemory !== undefined) {
        return { ok: true, path: repoPathOf(path), content: fromMemory };
      }
      if (directory === undefined) {
        return {
          ok: false,
          errors: [{ code: 'NOT_FOUND', message: `corpus 没有该路径的正文：${path}` }],
        };
      }
      const state = corpusPathState(directory, path);
      if (state.kind === 'outside') {
        return {
          ok: false,
          errors: [
            {
              code: 'CONTEXT_FORBIDDEN',
              message: `符号链接逃逸项目根：${path}（execution.md §3）`,
              ref: denialRefForPath(path),
            },
          ],
        };
      }
      const content = readCorpusFile(state);
      if (content === null) {
        return { ok: false, errors: [{ code: 'NOT_FOUND', message: `文件不存在：${path}` }] };
      }
      return { ok: true, path: repoPathOf(path), content };
    },
  };
  return Object.freeze(guard);
}

/** The denial handle of one corpus path, so a refusal is always loggable. */
function denialRefForPath(path: string): SourceRef {
  return { kind: 'git', id: path, version: '1', path: repoPathOf(path) };
}

/** Where one corpus path really lives, relative to a real project root. */
type CorpusPathState =
  | { readonly kind: 'missing' }
  | { readonly kind: 'outside' }
  | { readonly kind: 'inside'; readonly realPath: string };

/**
 * Classifies one corpus path against a real directory (`execution.md` §3).
 *
 * Both the root and the target are resolved with `realpathSync`, and the resolved
 * target must stay inside the resolved root; a path that does not exist is
 * `missing`. This is what makes a symlink pointing outside the project unreadable
 * instead of silently following it.
 */
function corpusPathState(directory: string, path: string): CorpusPathState {
  let root: string;
  try {
    root = realpathSync(directory);
  } catch {
    return { kind: 'missing' };
  }
  const candidate = resolve(root, path);
  try {
    lstatSync(candidate);
  } catch {
    return { kind: 'missing' };
  }
  let realPath: string;
  try {
    realPath = realpathSync(candidate);
  } catch {
    return { kind: 'missing' };
  }
  const inside = relative(root, realPath);
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    return { kind: 'inside', realPath };
  }
  return { kind: 'outside' };
}

/** Reads one already-classified corpus file; `null` when it cannot be read. */
function readCorpusFile(state: CorpusPathState): string | null {
  if (state.kind !== 'inside') return null;
  try {
    return readFileSync(state.realPath, 'utf8');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/** One selected entry, with the reason Chief (or the assembler) recorded. */
export interface ColdStartSelectionEntry {
  readonly phase: ColdStartSelectionPhase;
  /** Stable source key; a `refKey` (`kind:id`) or a path. */
  readonly key: string;
  readonly path?: RepoPath;
  /** Feature this entry belongs to, when it is Feature-scoped. */
  readonly featureId?: string;
  readonly reason: string;
  readonly tokens: number;
}

/** The Project overview, the current domain summary and the fixed rules. */
export interface ColdStartSeed {
  readonly role: ContextRole;
  readonly stage: ContextStage;
  /** The Chief's fixed rules; always present, always first (`§5`). */
  readonly fixedRules: ResolvedSource;
  readonly projectOverview: {
    readonly path: RepoPath;
    readonly markdown: string;
    readonly contentHash: Hash;
  };
  /** Current domain summary: the Work/Task position and the selected facts. */
  readonly domain: {
    readonly workId?: string;
    readonly taskId?: string;
    readonly summary: string;
    /** Resume position carried over from the Checkpoint, when one exists. */
    readonly resume?: {
      readonly stage: ContextStage;
      readonly nextAction: string;
      readonly manifest: string;
      readonly approval: string;
    };
  };
}

/** One Feature fact selected for the answer, attributed to its document. */
export interface ColdStartAttribution {
  readonly featureId: string;
  readonly featureName: string;
  /** Repo-relative Feature document path the fact was read from. */
  readonly documentPath: RepoPath;
}

/** The current behaviour of the selected Features, with its source. */
export interface ColdStartBehaviourFact {
  readonly featureId: string;
  readonly featureName: string;
  readonly documentPath: RepoPath;
  readonly text: string;
  readonly items: readonly string[];
}

/** One `constrained_by` constraint of the selection, with its declaring Feature. */
export interface ColdStartConstraintFact {
  readonly featureId: string;
  readonly constraint: string;
  /** Feature the declaring relation points at. */
  readonly targetFeatureId: string;
  readonly source: string;
}

/** One implementation entry path split into its production and test halves. */
export interface ColdStartEntryPaths {
  readonly codePaths: readonly string[];
  readonly testPaths: readonly string[];
}

/** One recorded 已知差距 line. */
export interface ColdStartKnownGap {
  readonly featureId: string;
  readonly featureName: string;
  readonly description: string;
}

/** One document the cold start left out, with the reason. */
export interface ColdStartExclusion extends ExcludedSource {
  /** `transcript` for the chat guard, `unrelated` for an unmatching Feature. */
  readonly kind: 'transcript' | 'unrelated' | 'budget' | 'other';
}

/** What the cold start assembled and how the budget was spent. */
export interface ColdStartContext {
  readonly role: ContextRole;
  readonly stage: ContextStage;
  readonly goal: string;
  readonly selection: readonly ColdStartSelectionEntry[];
  readonly sources: readonly ResolvedSource[];
  readonly excluded: readonly ColdStartExclusion[];
  readonly unknowns: readonly string[];
  readonly policyRevision: string;
  readonly policyHash: Hash;
  readonly configHash: Hash;
  readonly readScopeDigest: Hash;
  readonly createdAt: Time;
  readonly tokenAccounting: TokenAccounting;
}

/** The assembled seed plus the traceable selection behind it. */
export interface ColdStartPackage {
  readonly seed: ColdStartSeed;
  readonly context: ColdStartContext;
  /** The path guard that makes the excluded documents genuinely unreadable. */
  readonly guard: TranscriptGuard;
}

/** The current facts of the selected Features, each attributable (`AC-037`). */
export interface ColdStartAnswer {
  readonly selectedFeatureIds: readonly string[];
  readonly currentBehaviour: readonly ColdStartBehaviourFact[];
  readonly constraints: readonly ColdStartConstraintFact[];
  readonly entryPaths: ColdStartEntryPaths;
  readonly knownGaps: readonly ColdStartKnownGap[];
  /** Feature facts behind each answer, so a caller can re-check the source. */
  readonly attribution: readonly ColdStartAttribution[];
  readonly packages: ColdStartPackage;
  readonly tokenAccounting: TokenAccounting;
  readonly excluded: readonly ColdStartExclusion[];
  readonly unknowns: readonly string[];
}

/** Options for one cold start (`assembleColdStart` and `coldStartAnswer`). */
export interface ColdStartOptions {
  readonly projection: ColdStartProjection;
  readonly query: string;
  readonly limits?: {
    readonly startupTokens?: number;
    readonly expansionTokens?: number;
  };
  /** Runtime stage spelling; defaults to `assist` (a new Chief Conversation). */
  readonly stage?: string;
  /** Chief's selection corpus; defaults to the projection's own documents. */
  readonly corpus?: readonly ColdStartCorpusEntry[];
  /** Registered transcripts; never selected and never readable (`AC-033`). */
  readonly transcripts?: readonly ColdStartCorpusEntry[];
  /** Development documents that are in the corpus but must not match the query. */
  readonly documents?: readonly ColdStartCorpusEntry[];
  /** Absolute directory for real reads through the transcript guard. */
  readonly directory?: string;
  /** In-memory bodies for the guard, keyed by repo-relative path. */
  readonly contents?: Readonly<Record<string, string>>;
  /** Resume position from a Checkpoint, when the session is being recovered. */
  readonly checkpoint?: Checkpoint;
  /**
   * The real Project roots the guard's `readScope` is built from.
   *
   * A checkpoint already carries the Project id, so this is only needed when the
   * cold start runs before any checkpoint exists (or to point the scope at the real
   * `codeRoot`/`documentRoot`). Omitting it keeps the read scope deliberately
   * permissive — the corpus allow-list is then the only narrowing — which is what a
   * projection-only cold start needs.
   */
  readonly project?: ProjectScope;
  /** Injected clock; defaults to `nowIso()`. */
  readonly now?: () => Time;
}

/** The refusal shape every cold-start entry point returns on failure. */
export interface ColdStartFailure {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly errors: readonly ContextError[];
}

/** `{ok:true,…} | {ok:false,…}` as the other builder APIs return. */
export type ColdStartResult<T> = ({ readonly ok: true } & T) | ColdStartFailure;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Deterministic estimator: one token per four characters (`builder.ts`). */
function tokensOf(content: string): number {
  return Math.ceil([...content].length / 4);
}

/** Normalizes a relation/entry path that may carry `#symbol` or a trailing note. */
function normalizeEntryPath(entry: string): string {
  const hashAt = entry.indexOf('#');
  const withoutSymbol = hashAt === -1 ? entry : entry.slice(0, hashAt);
  const spaceAt = withoutSymbol.search(/\s/u);
  return (spaceAt === -1 ? withoutSymbol : withoutSymbol.slice(0, spaceAt)).trim();
}

/** `true` when an implementation entry is a test path rather than production code. */
function isTestEntry(path: string): boolean {
  if (/(?:^|\/)(?:__tests__|tests?)(?:\/|$)/u.test(path)) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return true;
  if (/(?:^|\/)[^/]*[._-](?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return true;
  return false;
}

/**
 * CJK terms that carry no feature signal on their own.
 *
 * A query such as `订单取消时如何处理支付约束？` contains `如何`/`处理`, and every
 * Feature body contains `行为`; scoring those would match all 23 documents and turn
 * the selection back into "load everything". `不自动展开整个模块` therefore needs
 * the scorer to be conservative: single CJK characters are never terms, and a
 * two-character term is dropped when either half is a function word.
 */
const CJK_STOPWORDS: ReadonlySet<string> = new Set([
  '的',
  '了',
  '在',
  '是',
  '和',
  '与',
  '或',
  '及',
  '对',
  '为',
  '把',
  '被',
  '从',
  '到',
  '就',
  '都',
  '也',
  '还',
  '会',
  '能',
  '要',
  '需',
  '可',
  '以',
  '有',
  '无',
  '不',
  '没',
  '很',
  '太',
  '更',
  '最',
  '这',
  '那',
  '哪',
  '如',
  '何',
  '什',
  '么',
  '时',
  '处',
  '理',
  '吗',
  '呢',
  '吧',
  '当',
  '前',
  '一',
  '个',
  '些',
  '用',
  '于',
  '并',
  '且',
  '但',
  '而',
  '则',
  '地',
  '得',
  '着',
  '过',
  '之',
  '其',
  '中',
  '上',
  '下',
  '内',
  '外',
  '后',
  '先',
  '再',
  '又',
  '只',
  '已',
  '将',
  '让',
  '给',
  '行',
]);

/**
 * Word tokens of a query: CJK bigrams (minus function-word pairs) and Latin words.
 *
 * Single CJK characters are deliberately not terms: `context.md` §1 requires a
 * *selection*, and a one-character match would match nearly every Chinese document.
 */
function queryTerms(query: string): readonly string[] {
  const terms = new Set<string>();
  const lowered = query.toLowerCase();
  const latin = lowered.match(/[a-z0-9_.#/:+-]+/gu) ?? [];
  for (const term of latin) {
    if (term.length > 1) terms.add(term);
  }
  const cjk = lowered.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu) ?? [];
  for (const run of cjk) {
    const characters = [...run];
    for (let index = 0; index + 1 < characters.length; index += 1) {
      const left = characters[index] ?? '';
      const right = characters[index + 1] ?? '';
      if (CJK_STOPWORDS.has(left) || CJK_STOPWORDS.has(right)) continue;
      terms.add(`${left}${right}`);
    }
  }
  return [...terms];
}

/** How many times `term` occurs in `haystack` (lowercase). */
function occurrences(haystack: string, term: string): number {
  if (term === '') return 0;
  let count = 0;
  let index = haystack.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(term, index + term.length);
  }
  return count;
}

/**
 * Relevance of one Feature to the query, with the terms that matched.
 *
 * Scoring is name/summary-first and body-last, so a Feature whose *current
 * behaviour* answers the question ranks above one that merely mentions a term in a
 * footnote; a Feature with no matching term scores `0` and is never selected
 * (`不自动展开整个模块`).
 */
function scoreFeature(
  feature: ColdStartFeature,
  terms: readonly string[],
): { readonly score: number; readonly matched: readonly string[] } {
  const name = feature.name.toLowerCase();
  const summary = feature.summary.toLowerCase();
  const module = feature.module.toLowerCase();
  const purpose =
    `${feature.sections.purpose.text} ${feature.sections.purpose.items.join(' ')}`.toLowerCase();
  const behaviour =
    `${feature.sections.currentBehaviour.text} ${feature.sections.currentBehaviour.items.join(' ')}`.toLowerCase();
  const relations = feature.relations
    .map((relation) => `${relation.reason} ${relation.source} ${relation.targetFeatureId}`)
    .join(' ')
    .toLowerCase();
  const entries = feature.sections.entries.items.join(' ').toLowerCase();
  const gaps =
    `${feature.sections.gaps.text} ${feature.sections.gaps.items.join(' ')}`.toLowerCase();

  const matched: string[] = [];
  let score = 0;
  for (const term of terms) {
    let weight = 0;
    weight += 6 * occurrences(name, term);
    weight += 4 * occurrences(summary, term);
    weight += 2 * occurrences(module, term);
    weight += 2 * occurrences(purpose, term);
    weight += 2 * occurrences(behaviour, term);
    weight += occurrences(relations, term);
    weight += occurrences(entries, term);
    weight += occurrences(gaps, term);
    if (weight > 0) matched.push(term);
    score += weight;
  }
  return { score, matched };
}

/** Stable textual order, so the selection is deterministic. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The one-line description of the current Work position for the seed. */
function domainSummary(query: string, selected: readonly ColdStartSelectionEntry[]): string {
  const features = [
    ...new Set(
      selected.map((entry) => entry.featureId).filter((id): id is string => id !== undefined),
    ),
  ];
  const featureText =
    features.length === 0 ? '未匹配到相关 Feature' : `相关 Feature：${features.join('、')}`;
  return `用户问题：${query.trim()}；${featureText}；按 context.md §1 顺序选择，未匹配文档不注入。`;
}

/** The `ResolvedSource` of the Chief's fixed rules (`§5` first entry). */
function fixedRulesSource(): ResolvedSource {
  const content =
    '# Agent 固定规则\n\nChief 决定上下文；Builder 只校验并冻结；开发聊天不可输入。\n';
  return {
    ref: { kind: 'policy', id: CHIEF_RULES_PATH, version: '1', path: CHIEF_RULES_PATH },
    kind: 'role_contract',
    id: CHIEF_RULES_PATH,
    path: CHIEF_RULES_PATH,
    revision: 'rule-v1',
    hash: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    reason: 'Chief 固定规则是每个新 Conversation 的起点（context.md §5）',
  };
}

/* ------------------------------------------------------------------ *
 * assembleColdStart
 * ------------------------------------------------------------------ */

/**
 * Assembles the seed of a new Conversation and the ordered selection behind it.
 *
 * The returned `context.selection` is the traceable record of *what* was selected
 * and *why*, in the documented order; `context.excluded` names every document that
 * was deliberately left out, so "20 unrelated documents" is an observable list
 * rather than an implicit omission (`AC-037`, `AC-039`).
 */
export function assembleColdStart(
  options: ColdStartOptions,
): ColdStartResult<{ readonly package: ColdStartPackage }> {
  const issues = projectionIssues(options.projection);
  if (issues.length > 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      errors: issues.map((issue) => ({
        code: 'VALIDATION_ERROR' as const,
        message: issue.message,
      })),
    };
  }
  if (typeof options.query !== 'string' || options.query.trim() === '') {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      errors: [{ code: 'VALIDATION_ERROR', message: '冷启动查询 query 不能为空（AC-037）' }],
    };
  }

  const role: ContextRole = options.checkpoint?.role ?? 'chief';
  const stage: ContextStage = options.checkpoint?.stage ?? 'assist';
  const limits = {
    startupTokens: options.limits?.startupTokens ?? COLD_START_STARTUP_TOKENS,
    expansionTokens: options.limits?.expansionTokens ?? COLD_START_EXPANSION_TOKENS,
  };
  for (const [name, value] of [
    ['startupTokens', limits.startupTokens],
    ['expansionTokens', limits.expansionTokens],
  ] as const) {
    const message = readBudgetValueError(name, value);
    if (message !== null) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        errors: [{ code: 'VALIDATION_ERROR', message }],
      };
    }
  }

  const now = options.now ?? nowIso;
  const project = coldStartProjectScope(options);

  // The corpus: the projection's own documents plus whatever Chief registered, minus
  // anything the guard refuses. A transcript is never a corpus member even when the
  // caller passes one (`AC-033`).
  const corpus: ColdStartCorpusEntry[] = [...defaultCorpus(options.projection)];
  for (const entry of options.corpus ?? []) corpus.push(entry);
  for (const entry of options.documents ?? []) corpus.push(entry);
  const transcriptEntries: ColdStartCorpusEntry[] = [];
  for (const entry of options.transcripts ?? []) transcriptEntries.push(entry);
  const uniqueCorpus = dedupeCorpus(corpus);
  // The guard is what makes the selection *unable* to read an unregistered or
  // transcript path, independent of which entries the selection happens to need.
  const guard = createTranscriptGuard({
    role,
    stage,
    project,
    corpus: uniqueCorpus,
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    ...(options.contents === undefined ? {} : { contents: options.contents }),
  });

  const selection: ColdStartSelectionEntry[] = [];
  const sources: ResolvedSource[] = [];
  const excluded: ColdStartExclusion[] = [];
  const unknowns: string[] = [];
  let consumed = 0;

  /**
   * Admits one entry when it fits the startup budget, otherwise records the gap.
   *
   * Every entry — including the seed's fixed rules and Project overview — is
   * charged, so a budget that cannot carry the seed is a closed failure instead of
   * a package that quietly bypasses the ceiling (`AC-036`, W5R1-07).
   */
  const admit = (entry: {
    readonly phase: ColdStartSelectionPhase;
    readonly key: string;
    readonly path?: RepoPath;
    readonly featureId?: string;
    readonly reason: string;
    readonly content: string;
    readonly source: ResolvedSource;
  }): { readonly admitted: boolean; readonly tokens: number; readonly shortfall: number } => {
    const tokens = tokensOf(entry.content);
    if (consumed + tokens > limits.startupTokens) {
      const shortfall = consumed + tokens - limits.startupTokens;
      const reason = `预算不足：选择 ${entry.key} 需要 ${tokens} tokens，缺口 ${shortfall} tokens（AC-036）`;
      excluded.push({ ref: entry.source.ref, reason, kind: 'budget' });
      unknowns.push(reason);
      return { admitted: false, tokens, shortfall };
    }
    consumed += tokens;
    selection.push({
      phase: entry.phase,
      key: entry.key,
      ...(entry.path === undefined ? {} : { path: entry.path }),
      ...(entry.featureId === undefined ? {} : { featureId: entry.featureId }),
      reason: entry.reason,
      tokens,
    });
    sources.push(entry.source);
    return { admitted: true, tokens, shortfall: 0 };
  };

  // Tier 1 — the Chief's fixed rules (`§5`: 新Conversation从Chief固定规则开始).
  const rules = fixedRulesSource();
  const rulesAdmission = admit({
    phase: 'role_contract',
    key: `policy:${CHIEF_RULES_PATH}`,
    path: CHIEF_RULES_PATH,
    reason: 'Chief 固定规则与角色契约（context.md §5、§1 选择顺序第 1 项）',
    content: '# Agent 固定规则\n\nChief 决定上下文；Builder 只校验并冻结；开发聊天不可输入。\n',
    source: rules,
  });

  // Tier 2 — the Project overview.
  const overviewDocument = options.projection.documents.project;
  const overviewPath = repoPathOf(
    overviewDocument.path === '' ? 'PROJECT.md' : overviewDocument.path,
  );
  const overviewAdmission = admit({
    phase: 'project_overview',
    key: `git:${overviewPath}`,
    path: overviewPath,
    reason: 'Project 概览是选择顺序的第 2 项（context.md §1）',
    content: overviewDocument.markdown,
    source: {
      ref: {
        kind: 'git',
        id: overviewPath,
        version: options.projection.revision,
        path: overviewPath,
      },
      kind: 'knowledge',
      id: overviewPath,
      path: overviewPath,
      revision: options.projection.revision,
      hash: sha256(overviewDocument.markdown),
      bytes: Buffer.byteLength(overviewDocument.markdown, 'utf8'),
      reason: 'Project 概览（knowledge.md §1 总览）',
    },
  });

  // The seed is not exempt from the budget: when the fixed rules or the Project
  // overview do not fit, the cold start fails closed with the concrete gap rather
  // than handing the caller bodies the accounting did not charge (`AC-036`).
  const seedGaps: ContextError[] = [];
  if (!rulesAdmission.admitted) {
    seedGaps.push({
      code: 'BUDGET_EXCEEDED',
      message: `启动预算不足：固定规则 ${CHIEF_RULES_PATH} 需要 ${rulesAdmission.tokens} tokens，缺口 ${rulesAdmission.shortfall} tokens（AC-036）`,
      ref: rules.ref,
    });
  }
  if (!overviewAdmission.admitted) {
    seedGaps.push({
      code: 'BUDGET_EXCEEDED',
      message: `启动预算不足：Project 概览 ${overviewPath} 需要 ${overviewAdmission.tokens} tokens，缺口 ${overviewAdmission.shortfall} tokens（AC-036）`,
      ref: {
        kind: 'git',
        id: overviewPath,
        version: options.projection.revision,
        path: overviewPath,
      },
    });
  }
  if (seedGaps.length > 0) return { ok: false, code: 'BUDGET_EXCEEDED', errors: seedGaps };

  // Tier 3 — the current Work/Task position and the resume position from the
  // checkpoint. Only the resume facts cross a session boundary; the previous
  // Conversation's messages do not (`§5`).
  if (options.checkpoint !== undefined) {
    const position = [
      `workId=${options.checkpoint.workId}`,
      ...(options.checkpoint.taskId === undefined ? [] : [`taskId=${options.checkpoint.taskId}`]),
      `stage=${options.checkpoint.stage}`,
      `manifest=${options.checkpoint.manifest.id}@${options.checkpoint.manifest.version}`,
      `nextAction=${options.checkpoint.nextAction}`,
    ].join('\n');
    admit({
      phase: 'current_work',
      key: `checkpoint:${options.checkpoint.runId}`,
      reason: 'Checkpoint 的 work/task/stage 与 next action 是当前 Work 位置（context.md §5）',
      content: position,
      source: {
        ref: {
          kind: 'policy',
          id: `checkpoint:${options.checkpoint.runId}`,
          version: '1',
          hash: sha256(position),
        },
        kind: 'policy',
        id: `checkpoint:${options.checkpoint.runId}`,
        revision: options.checkpoint.stage,
        hash: sha256(position),
        bytes: Buffer.byteLength(position, 'utf8'),
        reason: 'Checkpoint resume position',
      },
    });
  }

  // Tier 3/4 — feature navigation (the one-line index), then the matching Features.
  const terms = queryTerms(options.query);
  const scored = options.projection.features
    .map((feature) => ({ feature, ...scoreFeature(feature, terms) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareText(left.feature.module, right.feature.module) ||
        compareText(left.feature.featureId, right.feature.featureId),
    );
  const matchedIds = scored.map((entry) => entry.feature.featureId);
  const matchedSet = new Set(matchedIds);

  const navigationBody = options.projection.index
    .map(
      (entry) =>
        `- ${entry.featureId} ${entry.name}（${entry.module}）：${entry.summary} → ${entry.link}`,
    )
    .join('\n');
  const navigationPath = repoPathOf(
    options.projection.documents.featuresReadme.path === ''
      ? 'features/README.md'
      : options.projection.documents.featuresReadme.path,
  );
  admit({
    phase: 'feature_navigation',
    key: `git:${navigationPath}`,
    path: navigationPath,
    reason: 'Feature 导航给出候选与一句话摘要，是选择顺序的第 3 项（context.md §1）',
    content: navigationBody,
    source: {
      ref: {
        kind: 'git',
        id: navigationPath,
        version: options.projection.revision,
        path: navigationPath,
      },
      kind: 'knowledge',
      id: navigationPath,
      path: navigationPath,
      revision: options.projection.revision,
      hash: sha256(navigationBody),
      bytes: Buffer.byteLength(navigationBody, 'utf8'),
      reason: 'Feature 索引（features/README.md）',
    },
  });

  // Tier 4 — the constraints directly related to the current requirement. A
  // `constrained_by` relation of a matching Feature is the documented "直接关联约束".
  for (const { feature, matched } of scored) {
    for (const relation of feature.relations) {
      if (relation.kind !== 'constrained_by') continue;
      const body = `${feature.name} constrained_by ${relation.targetFeatureId}：${relation.reason}（来源 ${relation.source}）`;
      admit({
        phase: 'related_constraints',
        key: `relation:${feature.featureId}->${relation.targetFeatureId}`,
        featureId: relation.targetFeatureId,
        reason: `${feature.featureId} 的 constrained_by 关系直接约束当前改动（query 命中 ${matched.join('、')}）`,
        content: body,
        source: {
          ref: {
            kind: 'git',
            id: feature.documentPath,
            version: options.projection.revision,
            path: feature.documentPath,
          },
          kind: 'knowledge',
          id: `${feature.featureId}#${relation.targetFeatureId}`,
          path: feature.documentPath,
          revision: options.projection.revision,
          hash: sha256(body),
          bytes: Buffer.byteLength(body, 'utf8'),
          reason: '直接关联约束',
        },
      });
    }
  }

  // Tier 5 — the bodies/code/tests the role needs for the matching Features.
  for (const { feature, matched } of scored) {
    const body = [
      `# ${feature.name}（${feature.featureId}）`,
      `用途：${feature.sections.purpose.text}`,
      `当前行为：${feature.sections.currentBehaviour.text}`,
      ...feature.sections.currentBehaviour.items.map((item) => `- ${item}`),
      `实现入口：${feature.sections.entries.items.join('；')}`,
      `已知差距：${[...feature.sections.gaps.items, feature.sections.gaps.text].filter((line) => line.trim() !== '').join('；')}`,
    ].join('\n');
    const admission = admit({
      phase: 'role_bodies',
      key: `git:${feature.documentPath}`,
      path: feature.documentPath,
      featureId: feature.featureId,
      reason: `query 命中 ${matched.join('、')}，${role} 需要 ${feature.featureId} 的正文/入口/差距（context.md §1 第 5 项）`,
      content: body,
      source: {
        ref: {
          kind: 'git',
          id: feature.documentPath,
          version: feature.revision,
          path: feature.documentPath,
        },
        kind: 'knowledge',
        id: feature.featureId,
        path: feature.documentPath,
        revision: feature.revision,
        hash: sha256(body),
        bytes: Buffer.byteLength(body, 'utf8'),
        reason: 'Feature 正文（当前行为/入口/差距）',
      },
    });
    if (!admission.admitted) {
      excluded.push({
        ref: {
          kind: 'git',
          id: feature.documentPath,
          version: feature.revision,
          path: feature.documentPath,
        },
        reason: `预算不足，未纳入 ${feature.featureId} 正文（AC-036）`,
        kind: 'budget',
      });
    }
  }

  // Everything else Chief registered but the query did not match: excluded, with a
  // reason. The corpus allow-list is what keeps them from being read at all.
  for (const entry of uniqueCorpus) {
    if (
      entry.kind === 'feature' &&
      entry.featureId !== undefined &&
      matchedSet.has(entry.featureId)
    ) {
      continue;
    }
    const selectedAsNavigation =
      entry.path === undefined ||
      entry.path === options.projection.documents.featuresReadme.path ||
      entry.path === overviewPath ||
      entry.path === CHIEF_RULES_PATH;
    if (selectedAsNavigation) continue;
    if (entry.kind === 'transcript' || isDeniedSourcePath(entry.path)) {
      excluded.push({
        ref: { kind: 'message', id: entry.id, version: '1', path: entry.path },
        reason: TRANSCRIPT_DENIAL_REASON,
        kind: 'transcript',
      });
      continue;
    }
    excluded.push({
      ref: { kind: 'git', id: entry.id, version: '1', path: entry.path },
      reason: `与当前 query 无匹配关系，不默认注入（context.md §1、AC-037）`,
      kind: 'unrelated',
    });
  }
  for (const entry of transcriptEntries) {
    if (excluded.some((excludedEntry) => excludedEntry.ref.id === entry.id)) continue;
    excluded.push({
      ref: { kind: 'message', id: entry.id, version: '1', path: entry.path },
      reason: TRANSCRIPT_DENIAL_REASON,
      kind: 'transcript',
    });
  }

  if (options.projection.state === 'stale') {
    unknowns.push(
      `投影已过期（保留自 revision ${options.projection.revision}）：${
        options.projection.staleReason ?? '最近一次构建失败'
      }；冷启动结论必须标注非当前事实`,
    );
  }

  const projectOverviewMarkdown = overviewDocument.markdown;
  const seed: ColdStartSeed = Object.freeze({
    role,
    stage,
    fixedRules: rules,
    projectOverview: Object.freeze({
      path: overviewPath,
      markdown: projectOverviewMarkdown,
      contentHash: sha256(projectOverviewMarkdown),
    }),
    domain: Object.freeze({
      ...(options.checkpoint === undefined
        ? {}
        : {
            workId: options.checkpoint.workId,
            ...(options.checkpoint.taskId === undefined
              ? {}
              : { taskId: options.checkpoint.taskId }),
            resume: Object.freeze({
              stage: options.checkpoint.stage,
              nextAction: options.checkpoint.nextAction,
              manifest: `${options.checkpoint.manifest.id}@${options.checkpoint.manifest.version}`,
              approval: options.checkpoint.approval.state,
            }),
          }),
      summary: domainSummary(options.query, selection),
    }),
  });

  let createdAt: Time;
  try {
    createdAt = now();
  } catch {
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      errors: [{ code: 'INTERNAL_ERROR', message: '冷启动时钟调用失败' }],
    };
  }
  const context: ColdStartContext = Object.freeze({
    role,
    stage,
    goal: options.query.trim(),
    selection: Object.freeze(selection.map((entry) => Object.freeze({ ...entry }))),
    sources: Object.freeze(sources.map((source) => Object.freeze({ ...source }))),
    excluded: Object.freeze(excluded.map((entry) => Object.freeze({ ...entry }))),
    unknowns: Object.freeze([...unknowns]),
    policyRevision: 'rule-v1',
    policyHash: rules.hash,
    configHash: sha256(canonicalJson({ limits })),
    readScopeDigest: sha256(canonicalJson({ role, stage, project: project.projectId })),
    createdAt,
    tokenAccounting: Object.freeze({
      initial: Object.freeze({ limit: limits.startupTokens, used: consumed }),
      expansion: Object.freeze({ limit: limits.expansionTokens, used: 0 }),
    }),
  });

  return { ok: true, package: Object.freeze({ seed, context, guard }) };
}

/**
 * The Project scope a cold start evaluates its guard against.
 *
 * A caller-supplied `ProjectScope` wins (it carries the real roots); otherwise the
 * checkpoint's Project/Work binding is used, and a projection-only cold start falls
 * back to a permissive Project-wide scope whose narrowing is the corpus allow-list.
 */
function coldStartProjectScope(options: ColdStartOptions): ProjectScope {
  if (options.project !== undefined) return options.project;
  const checkpoint = options.checkpoint;
  return {
    projectId: checkpoint?.projectId ?? '0'.repeat(32),
    codeRoot: '',
    documentRoot: '',
    deliveryBranch: 'agentdev/main',
    ...(checkpoint === undefined ? {} : { workId: checkpoint.workId }),
  };
}

/** Deduplicates corpus entries by path, keeping the first registration. */
function dedupeCorpus(corpus: readonly ColdStartCorpusEntry[]): readonly ColdStartCorpusEntry[] {
  const seen = new Map<string, ColdStartCorpusEntry>();
  for (const entry of corpus) {
    if (!seen.has(entry.path)) seen.set(entry.path, entry);
  }
  return [...seen.values()];
}

/**
 * The corpus every cold start registers by default: the Project overview, the index
 * and each Feature document. Twenty unrelated documents are only in a corpus when
 * Chief explicitly registered them — and even then they stay unselected.
 */
export function defaultCorpus(projection: ColdStartProjection): readonly ColdStartCorpusEntry[] {
  const entries: ColdStartCorpusEntry[] = [
    { id: `doc:${CHIEF_RULES_PATH}`, path: CHIEF_RULES_PATH, kind: 'document', reason: '固定规则' },
    {
      id: `doc:${projection.documents.project.path}`,
      path: repoPathOf(projection.documents.project.path),
      kind: 'document',
      reason: 'Project 概览',
    },
    {
      id: `doc:${projection.documents.featuresReadme.path}`,
      path: repoPathOf(projection.documents.featuresReadme.path),
      kind: 'document',
      reason: 'Feature 导航',
    },
  ];
  for (const feature of projection.features) {
    entries.push({
      id: `feature:${feature.featureId}`,
      path: feature.documentPath,
      kind: 'feature',
      featureId: feature.featureId,
      reason: `Feature ${feature.featureId} 正文`,
    });
  }
  return entries;
}

/** Resolves a projection document path, which is always repository-relative. */
function repoPathOf(path: string): RepoPath {
  return path;
}

/* ------------------------------------------------------------------ *
 * coldStartAnswer
 * ------------------------------------------------------------------ */

/**
 * Answers the query from the delivered Feature facts.
 *
 * The answer is *derived from the projection*, never from the transcript: the
 * current behaviour comes from 当前行为, the constraints from `constrained_by`
 * relations of the selection, the entry paths from 实现入口 (split into production
 * and test paths) and the gaps from 已知差距. Every fact carries its Feature and
 * document path, so a caller can re-check it without reading the whole knowledge
 * base (`AC-037`, `AC-039`).
 */
export function coldStartAnswer(options: ColdStartOptions): ColdStartResult<{
  readonly answer: ColdStartAnswer;
  readonly guard: TranscriptGuard;
}> {
  const assembled = assembleColdStart(options);
  if (!assembled.ok) return assembled;
  const coldPackage = assembled.package;
  // The Features whose facts the answer reports are exactly the Features the
  // selection named: a query match (tier 5) or a directly related constraint's
  // target (tier 4, e.g. the payment Feature constraining order cancellation).
  const selectedIds = new Set(
    coldPackage.context.selection
      .map((entry) => entry.featureId)
      .filter((id): id is string => id !== undefined),
  );
  const selectedFeatures = options.projection.features.filter((feature) =>
    selectedIds.has(feature.featureId),
  );

  const currentBehaviour: ColdStartBehaviourFact[] = [];
  const constraints: ColdStartConstraintFact[] = [];
  const knownGaps: ColdStartKnownGap[] = [];
  const attribution: ColdStartAttribution[] = [];
  const codePaths = new Set<string>();
  const testPaths = new Set<string>();
  const unknowns: string[] = [...coldPackage.context.unknowns];

  for (const feature of selectedFeatures) {
    attribution.push(
      Object.freeze({
        featureId: feature.featureId,
        featureName: feature.name,
        documentPath: feature.documentPath,
      }),
    );
    currentBehaviour.push(
      Object.freeze({
        featureId: feature.featureId,
        featureName: feature.name,
        documentPath: feature.documentPath,
        text: feature.sections.currentBehaviour.text,
        items: Object.freeze([...feature.sections.currentBehaviour.items]),
      }),
    );
    for (const relation of feature.relations) {
      if (relation.kind !== 'constrained_by') continue;
      constraints.push(
        Object.freeze({
          featureId: feature.featureId,
          constraint: relation.reason,
          targetFeatureId: relation.targetFeatureId,
          source: relation.source,
        }),
      );
    }
    for (const gap of gapsOf(feature)) knownGaps.push(gap);
    for (const entry of feature.sections.entries.items) {
      const path = normalizeEntryPath(entry);
      if (path === '') continue;
      if (isTestEntry(path)) testPaths.add(path);
      else codePaths.add(path);
    }
  }

  // A Feature the constraint points at may not itself match the query (payment is
  // constrained by, not asked about); report its delivery state as an unknown so
  // "this constraint belongs to a Feature you did not ask for" stays visible.
  const knownIds = new Set(options.projection.features.map((feature) => feature.featureId));
  for (const constraint of constraints) {
    if (!knownIds.has(constraint.targetFeatureId)) {
      unknowns.push(
        `约束指向未登记的 Feature ${constraint.targetFeatureId}：${constraint.constraint}`,
      );
    }
  }

  const guard = createTranscriptGuard({
    role: coldPackage.context.role,
    stage: coldPackage.context.stage,
    project: coldStartProjectScope(options),
    corpus: dedupeCorpus([
      ...defaultCorpus(options.projection),
      ...(options.corpus ?? []),
      ...(options.documents ?? []),
      ...(options.transcripts ?? []),
    ]),
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    ...(options.contents === undefined ? {} : { contents: options.contents }),
  });

  const answer: ColdStartAnswer = Object.freeze({
    selectedFeatureIds: Object.freeze(selectedFeatures.map((feature) => feature.featureId)),
    currentBehaviour: Object.freeze(currentBehaviour),
    constraints: Object.freeze(constraints),
    entryPaths: Object.freeze({
      codePaths: Object.freeze([...codePaths].sort(compareText)),
      testPaths: Object.freeze([...testPaths].sort(compareText)),
    }),
    knownGaps: Object.freeze(knownGaps),
    attribution: Object.freeze(attribution),
    packages: coldPackage,
    tokenAccounting: coldPackage.context.tokenAccounting,
    excluded: coldPackage.context.excluded,
    unknowns: Object.freeze(unknowns),
  });

  return { ok: true, answer, guard };
}

/** The meaningful 已知差距 lines of one Feature (empty markers are not gaps). */
function gapsOf(feature: ColdStartFeature): readonly ColdStartKnownGap[] {
  const lines = [feature.sections.gaps.text, ...feature.sections.gaps.items]
    .flatMap((line) => line.split(/\r?\n/u))
    .map((line) => line.trim())
    .filter((line) => line !== '' && !isNoGap(line));
  return lines.map((description) =>
    Object.freeze({
      featureId: feature.featureId,
      featureName: feature.name,
      description,
    }),
  );
}

/** `true` when a 已知差距 line only states that there is no gap. */
function isNoGap(line: string): boolean {
  const stripped = line
    .replace(/[。.！!]/gu, '')
    .replace(/^-\s*/u, '')
    .trim();
  if (stripped === '无' || stripped === '未调查' || stripped === '暂无') return true;
  return /^无(?:已登记|已知|明显)?的?差距/u.test(stripped) || /^未登记/u.test(stripped);
}
