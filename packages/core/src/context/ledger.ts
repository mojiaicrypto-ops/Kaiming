/**
 * The append-only read ledger (`docs/architecture/context.md` §1/§5,
 * `docs/architecture/data.md` §2 `stage_result`, `docs/rules/agents.md` §2/§4).
 *
 * One ledger belongs to one Run, and it is the only proof of *what that Run
 * actually read after it started*:
 *
 * - `context.md` §1 fixes the shape of one entry — `seq、path、revision/hash、
 *   reason、size` — and the rule that a wider read is *requested* from Chief
 *   (`context.request`) instead of being taken unilaterally.
 * - A read is admitted only when it is inside the Run's frozen `readScope`
 *   (`ACL-verified` through the existing `canRead`) **and** carries a written
 *   reason. A path outside the scope is `CONTEXT_FORBIDDEN`; a missing reason is
 *   `VALIDATION_ERROR`; the two can never be traded for each other (`AC-032`).
 * - Tokens are charged against the frozen budget. A read that does not fit is
 *   refused with `BUDGET_EXCEEDED` naming the path, the tokens it needs and the
 *   tokens that remain — and is **not** appended, so the gap is reported instead
 *   of the whole repository being injected (`AC-036`).
 * - `seal()` commits the ordered entries to one `(seq, hash)` binding. A stage
 *   result submits that binding (`stage_result.read_ledger_seq/hash`); after the
 *   seal another append is `INVALID_STATE`, and a result presenting an older seq
 *   or a different hash fails `verifySeal` with `STALE_ARTIFACT` (`AC-085`).
 *
 * Seal hash input (exact and stable — see `readLedgerSealHash`):
 *
 * ```text
 * acc₀ = sha256("agentdev.read-ledger.seal.v1")
 * accᵢ = sha256(canonicalJson({
 *   prev: accᵢ₋₁, seq, path, revision, hash, reason, bytes,
 * }))
 * seal.hash = accₙ,  seal.seq = last entry's seq (0 for an empty ledger)
 * ```
 *
 * Every documented entry field is inside that payload, so two ledgers that agree
 * on `seq/path/revision/hash/reason/size` seal to the same value and any change to
 * one of them changes the seal. `seal()` is idempotent: the binding is computed
 * once and returned unchanged on every later call.
 *
 * The object is deliberately write-only through `append`/`requestExpansion`/
 * `grantExpansion`/`seal`; `entries()`, `usage()`, `readScope()`, `identity()` and
 * `expansions()` hand back frozen copies so a caller can read state but never
 * mutate the ledger through the returned objects.
 */
import {
  sourceRefKindSchema,
  type ErrorCode,
  type Hash,
  type RepoPath,
  type Time,
} from '@agentdev/contracts';
import { nowIso, sha256 } from '@agentdev/storage';
import { canonicalJson } from '../dispatcher.js';
import { canRead } from './acl.js';
import { characterTokenCounter, type TokenCounter } from './builder.js';
import {
  ARTIFACT_ROOT,
  CONTEXT_ROLES,
  CONTEXT_STAGES,
  artifactClassFromPath,
  denialSourceRef,
  isDeniedSourcePath,
  pathIsInsidePrefix,
  readBudgetValueError,
  type ContextError,
  type ContextRequest,
  type ContextRole,
  type ContextSourceRef,
  type ContextStage,
  type DeniedSource,
  type PathRestriction,
  type ReadScope,
  type ReaderContext,
} from './types.js';

/** SHA256 of a lowercase hex digest, as `data.md` §1 requires. */
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

/** The `SourceRef.kind` value set, derived from the contract instead of restated. */
const SOURCE_REF_KINDS: readonly string[] = sourceRefKindSchema.options;

/** Genesis constant of the seal chain; part of the documented hash input. */
export const READ_LEDGER_SEAL_GENESIS = 'agentdev.read-ledger.seal.v1';

/** One appended read (`context.md` §1: seq、path、revision/hash、reason、size). */
export interface ReadLedgerEntry {
  /** 1-based position; `append` allocates the next value and never reuses one. */
  readonly seq: number;
  readonly path: RepoPath;
  /** Exact Git revision / artifact version the content was read at. */
  readonly revision: string;
  /** Content identity (`sha256(content)`), the hash part of the entry. */
  readonly hash: Hash;
  /** The written reason the read happened (`AC-032`). */
  readonly reason: string;
  /** Frozen size of the content in UTF-8 bytes. */
  readonly bytes: number;
  /** Tokens this read charged against the budget. */
  readonly tokens: number;
  /** When the read was appended; UTC ISO8601 milliseconds. */
  readonly at: Time;
}

/**
 * The budget a ledger charges reads against (`rules/agents.md` §6).
 *
 * It mirrors `ContextSelection.readBudget` (`initialTokens`/`expansionTokens`) so a
 * builder can pass the frozen selection budget straight through, plus the optional
 * `initialUsed` when the startup package already spent part of the ceiling.
 */
export interface ReadLedgerBudget {
  /** Startup-package ceiling. */
  readonly initialTokens: number;
  /** Additional-read ceiling before any expansion grant. */
  readonly expansionTokens: number;
  /** Tokens the frozen startup package already consumed; defaults to `0`. */
  readonly initialUsed?: number;
}

/** Immutable token/size state of one ledger. */
export interface ReadLedgerUsage {
  readonly initial: { readonly limit: number; readonly used: number };
  readonly expansion: { readonly limit: number; readonly used: number };
  /** Tokens the *appended* reads consumed (startup usage excluded). */
  readonly consumedTokens: number;
  readonly remainingTokens: number;
  /** Number of appended reads (the ledger's `seq` once sealed). */
  readonly entries: number;
}

/** The binding a stage result submits (`stage_result.read_ledger_seq/hash`). */
export interface ReadLedgerSeal {
  readonly seq: number;
  readonly hash: Hash;
}

/** What happened to one reasoned expansion request. */
export type ExpansionDecision = 'pending' | 'granted' | 'denied';

/** One recorded `context.request` and Chief's decision on it (`AC-032`). */
export interface ExpansionRecord {
  readonly request: ContextRequest;
  readonly decision: ExpansionDecision;
  readonly requestedAt: Time;
  readonly decidedAt?: Time;
  /** The wider scope, present only on a grant. */
  readonly expandedScope?: ReadScope;
  /** Extra tokens added to the expansion ceiling, present only on a grant. */
  readonly extraTokens?: number;
  /** Optional note from Chief explaining the decision. */
  readonly note?: string;
}

/**
 * A ledger failure carrying a `contracts.ERROR_CODES` member.
 *
 * The extra fields are the structured form of what `AC-036` requires the refusal
 * to name, so a caller can render the gap without parsing the message.
 */
export interface LedgerError extends ContextError {
  /** Path the refused read targeted. */
  readonly path?: RepoPath;
  /** Tokens the refused read would have needed. */
  readonly requiredTokens?: number;
  /** Tokens that remained when the read was refused. */
  readonly remainingTokens?: number;
  /** Sequence number a refused seal/expansion operation referred to. */
  readonly seq?: number;
  /** Hash a refused seal/expansion operation referred to. */
  readonly hash?: Hash;
}

/** `{ok:true,…} | {ok:false,errors:[…]}`, as every builder/ledger API returns. */
export type ReadLedgerResult<T> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly errors: readonly LedgerError[] };

/** What `createReadLedger` needs to start one Run's ledger. */
export interface CreateReadLedgerInput {
  /** The Run that owns every entry (`context.md` §5 Run isolation). */
  readonly runId: string;
  readonly role: ContextRole;
  /** Canonical domain stage; the `readScope` is the one `acl.scopeFor` returned. */
  readonly stage: ContextStage;
  /** Frozen scope from `acl.scopeFor(role, stage, project)`. */
  readonly scope: ReadScope;
  readonly budget: ReadLedgerBudget;
  /**
   * The Run's frozen revision (`AC-030` `ResolvedSource.revision`).
   *
   * Entries inherit it unless `append` supplies a more specific revision, so an
   * appended read is always attributable to the tree it was read from.
   */
  readonly revision?: string;
  /** Deterministic token estimator; defaults to the builder's character counter. */
  readonly tokenCounter?: TokenCounter;
  /** Injectable clock; defaults to `nowIso()`. */
  readonly now?: () => Time;
}

/** One admitted read: the fields `append` returns to the caller. */
export interface ReadLedgerAppendOk {
  readonly seq: number;
  readonly path: RepoPath;
  readonly revision: string;
  readonly hash: Hash;
  readonly bytes: number;
  readonly consumedTokens: number;
  readonly remainingTokens: number;
}

/** The input of one in-scope append. */
export interface ReadLedgerAppendInput {
  readonly path: RepoPath;
  readonly reason: string;
  readonly content: string;
  /** Overrides the ledger's default revision for this read. */
  readonly revision?: string;
}

/** Chief's answer to a recorded `context.request`. */
export interface GrantExpansionInput {
  /** The exact request `requestExpansion` recorded. */
  readonly request: ContextRequest;
  readonly granted: boolean;
  /** Required when `granted`; must widen, never narrow, the current scope. */
  readonly expandedScope?: ReadScope;
  /** Extra tokens added to the expansion ceiling when `granted`. */
  readonly extraTokens?: number;
  readonly note?: string;
}

/**
 * One Run's append-only read ledger.
 *
 * There is intentionally no update/delete API: a read that happened is history,
 * and `AC-085` depends on the ordered entries being impossible to rewrite.
 */
export interface ReadLedger {
  /** Appends one ACL-verified, reasoned read; charges its tokens. */
  append(input: ReadLedgerAppendInput): ReadLedgerResult<ReadLedgerAppendOk>;
  /** Records a reasoned request for a wider scope (`context.request`). */
  requestExpansion(input: {
    readonly request: ContextRequest;
  }): ReadLedgerResult<{ readonly expansion: ExpansionRecord }>;
  /** Records Chief's decision; only a grant widens the scope / raises the budget. */
  grantExpansion(
    input: GrantExpansionInput,
  ): ReadLedgerResult<{ readonly expansion: ExpansionRecord }>;
  /** Commits the ordered entries to one `(seq, hash)` binding; idempotent. */
  seal(): ReadLedgerResult<ReadLedgerSeal>;
  /** Checks a stage result's binding against the seal (`AC-085`). */
  verifySeal(input: {
    readonly seq: number;
    readonly hash: Hash;
  }): ReadLedgerResult<ReadLedgerSeal>;
  /** The current binding, or `null` while the ledger is still open. */
  sealedBinding(): ReadLedgerSeal | null;
  /** Immutable copy of the appended reads, in order. */
  entries(): readonly ReadLedgerEntry[];
  /** Immutable copy of the token/size state. */
  usage(): ReadLedgerUsage;
  /** Immutable copy of the scope the ledger currently admits reads in. */
  readScope(): ReadScope;
  /** Immutable copy of the recorded requests and their decisions. */
  expansions(): readonly ExpansionRecord[];
  /** The Run/role/stage this ledger belongs to. */
  identity(): { readonly runId: string; readonly role: ContextRole; readonly stage: ContextStage };
}

/** `createReadLedger`'s closed result. */
export type CreateReadLedgerResult = ReadLedgerResult<{ readonly ledger: ReadLedger }>;

/** The seal commitment over the ordered entries; the documented hash input. */
export function readLedgerSealHash(entries: readonly ReadLedgerEntry[]): Hash {
  let accumulator = sha256(READ_LEDGER_SEAL_GENESIS);
  for (const entry of entries) {
    accumulator = sha256(
      canonicalJson({
        prev: accumulator,
        seq: entry.seq,
        path: entry.path,
        revision: entry.revision,
        hash: entry.hash,
        reason: entry.reason,
        bytes: entry.bytes,
      }),
    );
  }
  return accumulator;
}

/** Deep immutable copy of a scope. */
export function freezeReadScope(scope: ReadScope): ReadScope {
  return Object.freeze({
    projectId: scope.projectId,
    pathPrefixes: Object.freeze([...scope.pathPrefixes]),
    artifactClasses: Object.freeze([...scope.artifactClasses]),
    messageClasses: Object.freeze([...scope.messageClasses]),
    sourceKinds: Object.freeze([...scope.sourceKinds]),
    denied: Object.freeze(scope.denied.map((entry) => Object.freeze({ ...entry }))),
    deniedPaths: Object.freeze(scope.deniedPaths.map((entry) => Object.freeze({ ...entry }))),
    writePaths: Object.freeze([...scope.writePaths]),
  });
}

/** `true` when every member of `inner` is a member of `outer`. */
function coversAll<T>(outer: readonly T[], inner: readonly T[]): boolean {
  return inner.every((value) => outer.includes(value));
}

/** `true` when every prefix of `inner` sits inside one prefix of `outer`. */
function coversPrefixes(outer: readonly string[], inner: readonly string[]): boolean {
  return inner.every((prefix) => outer.some((candidate) => pathIsInsidePrefix(prefix, candidate)));
}

/** `true` when every permanent path denial of `inner` is restated by `outer`. */
function coversPathRestrictions(
  outer: readonly PathRestriction[],
  inner: readonly PathRestriction[],
): boolean {
  return inner.every((entry) =>
    outer.some(
      (candidate) => candidate.prefix === entry.prefix && candidate.reason === entry.reason,
    ),
  );
}

/** `true` when every source-class denial of `inner` is restated by `outer`. */
function coversDenials(outer: readonly DeniedSource[], inner: readonly DeniedSource[]): boolean {
  return inner.every((entry) =>
    outer.some((candidate) => candidate.kind === entry.kind && candidate.reason === entry.reason),
  );
}

/**
 * Counts one body through an injected counter; `null` on a throw or an illegal
 * value, so a bad counter becomes a closed `INTERNAL_ERROR` (W5R1-10) instead of
 * escaping with the caller's stack.
 */
function safeTokens(counter: TokenCounter, content: string): number | null {
  try {
    const value = counter(content);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/** Reads an injected clock; `null` on a throw, so the failure stays closed. */
function safeClock(clock: () => Time): Time | null {
  try {
    return clock();
  } catch {
    return null;
  }
}

/** Validation of one `append`; `null` means the shape is acceptable. */
function appendShapeErrors(input: ReadLedgerAppendInput): readonly LedgerError[] {
  const errors: LedgerError[] = [];
  if (typeof input.path !== 'string' || input.path === '') {
    errors.push({ code: 'VALIDATION_ERROR', message: 'read ledger 追加读取需要非空 path' });
  } else if (input.path.includes('\0') || input.path.includes('\\')) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `read ledger path 必须是仓库相对路径：${input.path}`,
    });
  }
  if (typeof input.content !== 'string') {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `read ledger 追加读取需要字符串 content：${String(input.path)}`,
      ...(typeof input.path === 'string' && input.path !== '' ? { path: input.path } : {}),
    });
  }
  if (input.revision !== undefined && typeof input.revision !== 'string') {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `read ledger revision 必须是字符串：${String(input.path)}`,
    });
  }
  return errors;
}

/** Builds the ACL handle one appended path is authorised as. */
function sourceForPath(path: RepoPath, revision: string, projectId: string): ContextSourceRef {
  const base = { id: path, version: revision, path, projectId };
  if (pathIsInsidePrefix(path, ARTIFACT_ROOT)) {
    const artifactClass = artifactClassFromPath(path);
    return artifactClass === null
      ? { kind: 'artifact', ...base }
      : { kind: 'artifact', artifactClass, ...base };
  }
  if (pathIsInsidePrefix(path, 'features')) {
    // Feature navigation is knowledge shared by every role (`execution.md` §3).
    return { kind: 'knowledge', ...base };
  }
  return { kind: 'git', ...base };
}

/** Frozen copy of one recorded request. */
function freezeRequest(request: ContextRequest): ContextRequest {
  return Object.freeze({
    ref: Object.freeze({ ...request.ref }),
    reason: request.reason,
    ...(request.requestedBy === undefined ? {} : { requestedBy: request.requestedBy }),
    ...(request.createdAt === undefined ? {} : { createdAt: request.createdAt }),
  });
}

/** Frozen copy of one recorded decision. */
function freezeExpansion(record: ExpansionRecord): ExpansionRecord {
  return Object.freeze({
    request: freezeRequest(record.request),
    decision: record.decision,
    requestedAt: record.requestedAt,
    ...(record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt }),
    ...(record.expandedScope === undefined
      ? {}
      : { expandedScope: freezeReadScope(record.expandedScope) }),
    ...(record.extraTokens === undefined ? {} : { extraTokens: record.extraTokens }),
    ...(record.note === undefined ? {} : { note: record.note }),
  });
}

/** The key Chief's rerouting uses to match a decision to a request. */
function requestKey(request: ContextRequest): string {
  return `${request.ref.kind}:${request.ref.id}`;
}

class ReadLedgerImpl implements ReadLedger {
  private readonly runId: string;
  private readonly role: ContextRole;
  private readonly stage: ContextStage;
  private readonly counter: TokenCounter;
  private readonly clock: () => Time;
  private readonly defaultRevision: string;
  private readonly baseInitialUsed: number;
  private readonly initialLimit: number;

  private initialUsed: number;
  private expansionLimit: number;
  private expansionUsed = 0;
  private scope: ReadScope;
  private readonly appended: ReadLedgerEntry[] = [];
  private readonly requested: ExpansionRecord[] = [];
  private frozenSeal: ReadLedgerSeal | null = null;

  constructor(input: CreateReadLedgerInput, counter: TokenCounter, clock: () => Time) {
    this.runId = input.runId;
    this.role = input.role;
    this.stage = input.stage;
    this.counter = counter;
    this.clock = clock;
    this.defaultRevision = input.revision ?? '';
    this.baseInitialUsed = input.budget.initialUsed ?? 0;
    this.initialLimit = input.budget.initialTokens;
    this.initialUsed = this.baseInitialUsed;
    this.expansionLimit = input.budget.expansionTokens;
    this.scope = freezeReadScope(input.scope);
  }

  append(input: ReadLedgerAppendInput): ReadLedgerResult<ReadLedgerAppendOk> {
    if (this.frozenSeal !== null) {
      return fail(
        'INVALID_STATE',
        `read ledger 已封口（seq=${this.frozenSeal.seq}），不能再追加读取（AC-085）`,
        { seq: this.frozenSeal.seq, hash: this.frozenSeal.hash },
      );
    }
    const shapeErrors = appendShapeErrors(input);
    if (shapeErrors.length > 0) return { ok: false, errors: shapeErrors };

    const revision = input.revision ?? this.defaultRevision;
    const source = sourceForPath(input.path, revision, this.scope.projectId);
    const reader: ReaderContext = { runId: this.runId, projectId: this.scope.projectId };
    const decision = canRead(this.role, this.stage, source, this.scope, reader);
    if (!decision.allowed) {
      return {
        ok: false,
        errors: [{ code: decision.code, message: decision.message, ref: decision.ref }],
      };
    }
    if (typeof input.reason !== 'string' || input.reason.trim() === '') {
      return fail('VALIDATION_ERROR', `追加读取缺少 reason：${input.path}（AC-032）`, {
        path: input.path,
      });
    }

    const required = safeTokens(this.counter, input.content);
    if (required === null) {
      return fail('INTERNAL_ERROR', `token 计数器调用失败：${input.path}`);
    }
    const at = safeClock(this.clock);
    if (at === null) return fail('INTERNAL_ERROR', 'read ledger 时钟调用失败');
    const remaining = this.remaining();
    if (required > remaining) {
      return fail(
        'BUDGET_EXCEEDED',
        `预算不足：追加读取 ${input.path} 需要 ${required} tokens，剩余 ${remaining} tokens（AC-036）`,
        {
          path: input.path,
          requiredTokens: required,
          remainingTokens: remaining,
          ref: denialSourceRef(source),
        },
      );
    }

    this.charge(required);
    const entry: ReadLedgerEntry = Object.freeze({
      seq: this.appended.length + 1,
      path: input.path,
      revision,
      hash: sha256(input.content),
      reason: input.reason,
      bytes: Buffer.byteLength(input.content, 'utf8'),
      tokens: required,
      at,
    });
    this.appended.push(entry);
    return {
      ok: true,
      seq: entry.seq,
      path: entry.path,
      revision: entry.revision,
      hash: entry.hash,
      bytes: entry.bytes,
      consumedTokens: required,
      remainingTokens: this.remaining(),
    };
  }

  requestExpansion(input: {
    readonly request: ContextRequest;
  }): ReadLedgerResult<{ readonly expansion: ExpansionRecord }> {
    if (this.frozenSeal !== null) {
      return fail(
        'INVALID_STATE',
        `read ledger 已封口（seq=${this.frozenSeal.seq}），不能请求扩展`,
      );
    }
    const request = input.request;
    if (request === undefined || request === null || typeof request !== 'object') {
      return fail('VALIDATION_ERROR', 'context.request 需要 request 对象（AC-032）');
    }
    if (typeof request.reason !== 'string' || request.reason.trim() === '') {
      return fail('VALIDATION_ERROR', 'context.request 缺少 reason（AC-032）');
    }
    const ref = request.ref;
    if (
      ref === undefined ||
      ref === null ||
      typeof ref.id !== 'string' ||
      ref.id === '' ||
      !SOURCE_REF_KINDS.includes(ref.kind)
    ) {
      return fail('VALIDATION_ERROR', 'context.request 的 ref 不合法（AC-032）');
    }
    // A transcript, a path outside the repository or a denied marker can never be
    // granted by an expansion: those are structural rules, not scope settings
    // (`context.md` §5, `AC-033`).
    if (ref.path !== undefined && isDeniedSourcePath(ref.path)) {
      return fail('CONTEXT_FORBIDDEN', `扩展请求命中 Transcript 禁止表：${ref.path}（AC-033）`);
    }
    if (
      ref.path !== undefined &&
      (ref.path.startsWith('/') || ref.path.split('/').includes('..'))
    ) {
      return fail('CONTEXT_FORBIDDEN', `扩展请求的路径逃逸仓库根：${ref.path}`);
    }
    const key = requestKey(request);
    if (
      this.requested.some(
        (entry) => entry.decision === 'pending' && requestKey(entry.request) === key,
      )
    ) {
      return fail('INVALID_STATE', `该来源已有待处理的扩展请求：${key}（AC-032）`);
    }
    const requestedAt = safeClock(this.clock);
    if (requestedAt === null) return fail('INTERNAL_ERROR', 'read ledger 时钟调用失败');
    const record: ExpansionRecord = Object.freeze({
      request: freezeRequest(request),
      decision: 'pending',
      requestedAt,
    });
    this.requested.push(record);
    return { ok: true, expansion: freezeExpansion(record) };
  }

  grantExpansion(
    input: GrantExpansionInput,
  ): ReadLedgerResult<{ readonly expansion: ExpansionRecord }> {
    if (this.frozenSeal !== null) {
      return fail(
        'INVALID_STATE',
        `read ledger 已封口（seq=${this.frozenSeal.seq}），不能处理扩展请求`,
      );
    }
    const request = input.request;
    if (request === undefined || request === null || typeof request !== 'object') {
      return fail('VALIDATION_ERROR', 'grantExpansion 需要 request 对象（AC-032）');
    }
    const key = requestKey(request);
    const index = this.requested.findIndex(
      (entry) => entry.decision === 'pending' && requestKey(entry.request) === key,
    );
    if (index === -1) {
      return fail('NOT_FOUND', `没有待处理的扩展请求：${key}（AC-032）`);
    }
    const pending = this.requested[index];
    if (pending === undefined) {
      return fail('NOT_FOUND', `没有待处理的扩展请求：${key}（AC-032）`);
    }

    if (input.granted !== true) {
      if (input.expandedScope !== undefined || input.extraTokens !== undefined) {
        return fail(
          'VALIDATION_ERROR',
          `被拒绝的扩展请求不能携带 expandedScope/extraTokens：${key}（AC-036）`,
        );
      }
      const deniedAt = safeClock(this.clock);
      if (deniedAt === null) return fail('INTERNAL_ERROR', 'read ledger 时钟调用失败');
      const denied: ExpansionRecord = Object.freeze({
        ...pending,
        decision: 'denied',
        decidedAt: deniedAt,
        ...(input.note === undefined ? {} : { note: input.note }),
      });
      this.requested[index] = denied;
      return { ok: true, expansion: freezeExpansion(denied) };
    }

    const expandedScope = input.expandedScope;
    if (expandedScope === undefined) {
      return fail('VALIDATION_ERROR', `授予扩展必须提供 expandedScope：${key}`);
    }
    // An expansion may widen the ceiling, but only inside the documented
    // configurable range (`agents.md` §6: 4096–2000000). Both the granted extra and
    // the resulting ceiling are validated with the same shared validator as the
    // builder and the cold start, so `extraTokens: 3_000_000` can no longer push the
    // ledger past the ceiling and admit a 2 025 000-token read (W5R2-05).
    const extra = input.extraTokens ?? 0;
    const extraError = readBudgetValueError('extraTokens', extra);
    if (extraError !== null) return fail('VALIDATION_ERROR', `${extraError}：${key}`);
    const ceiling = this.expansionLimit + extra;
    const ceilingError = readBudgetValueError('expansionLimit', ceiling);
    if (ceilingError !== null) return fail('VALIDATION_ERROR', `${ceilingError}：${key}`);
    if (expandedScope.projectId !== this.scope.projectId) {
      return fail(
        'VALIDATION_ERROR',
        `扩展后的 scope 必须仍属于本 Project：${expandedScope.projectId}`,
      );
    }
    // An expansion widens; a grant that narrowed any dimension would silently
    // revoke access the Run already had, so it is refused instead.
    if (!coversPrefixes(expandedScope.pathPrefixes, this.scope.pathPrefixes)) {
      return fail('VALIDATION_ERROR', `扩展后的 scope 必须覆盖原有 pathPrefixes：${key}`);
    }
    if (!coversAll(expandedScope.sourceKinds, this.scope.sourceKinds)) {
      return fail('VALIDATION_ERROR', `扩展后的 scope 必须覆盖原有 sourceKinds：${key}`);
    }
    if (!coversAll(expandedScope.artifactClasses, this.scope.artifactClasses)) {
      return fail('VALIDATION_ERROR', `扩展后的 scope 必须覆盖原有 artifactClasses：${key}`);
    }
    if (!coversAll(expandedScope.messageClasses, this.scope.messageClasses)) {
      return fail('VALIDATION_ERROR', `扩展后的 scope 必须覆盖原有 messageClasses：${key}`);
    }
    // Permanent denials are not a setting an expansion may trade away: `.git`,
    // `node_modules` and the other markers stay refused, with the same reason, or
    // the grant is refused (`AC-032`; `acl.ts` DENIED_PATH_MARKERS).
    if (!coversPathRestrictions(expandedScope.deniedPaths, this.scope.deniedPaths)) {
      return fail(
        'VALIDATION_ERROR',
        `扩展后的 scope 必须保留原有 deniedPaths（含 reason）：${key}`,
      );
    }
    if (!coversDenials(expandedScope.denied, this.scope.denied)) {
      return fail('VALIDATION_ERROR', `扩展后的 scope 必须保留原有 denied（含 reason）：${key}`);
    }

    const grantedAt = safeClock(this.clock);
    if (grantedAt === null) return fail('INTERNAL_ERROR', 'read ledger 时钟调用失败');
    this.scope = freezeReadScope(expandedScope);
    this.expansionLimit += extra;
    const granted: ExpansionRecord = Object.freeze({
      ...pending,
      decision: 'granted',
      decidedAt: grantedAt,
      expandedScope: freezeReadScope(expandedScope),
      extraTokens: extra,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    this.requested[index] = granted;
    return { ok: true, expansion: freezeExpansion(granted) };
  }

  seal(): ReadLedgerResult<ReadLedgerSeal> {
    if (this.frozenSeal === null) {
      const last = this.appended[this.appended.length - 1];
      this.frozenSeal = Object.freeze({
        seq: last === undefined ? 0 : last.seq,
        hash: readLedgerSealHash(this.appended),
      });
    }
    return { ok: true, seq: this.frozenSeal.seq, hash: this.frozenSeal.hash };
  }

  verifySeal(input: {
    readonly seq: number;
    readonly hash: Hash;
  }): ReadLedgerResult<ReadLedgerSeal> {
    const sealed = this.frozenSeal;
    if (sealed === null) {
      return fail('INVALID_STATE', 'read ledger 尚未封口，无法校验阶段结果绑定（AC-085）');
    }
    if (!Number.isInteger(input.seq) || input.seq < 0) {
      return fail(
        'VALIDATION_ERROR',
        `read ledger seq 必须是非负整数：${String(input.seq)}`,
        Number.isInteger(input.seq) ? { seq: input.seq } : {},
      );
    }
    if (typeof input.hash !== 'string' || !HASH_PATTERN.test(input.hash)) {
      return fail(
        'VALIDATION_ERROR',
        `read ledger hash 必须是 64 位小写 SHA256：${String(input.hash)}`,
      );
    }
    if (input.seq > sealed.seq) {
      return fail(
        'VALIDATION_ERROR',
        `阶段结果声明的 seq ${input.seq} 超过 ledger 末尾 ${sealed.seq}（AC-085）`,
        { seq: input.seq },
      );
    }
    if (input.seq < sealed.seq) {
      return fail(
        'STALE_ARTIFACT',
        `阶段结果绑定的是旧 seq ${input.seq}，ledger 已封口到 ${sealed.seq}（AC-085）`,
        { seq: input.seq, hash: input.hash },
      );
    }
    if (input.hash !== sealed.hash) {
      return fail(
        'STALE_ARTIFACT',
        `阶段结果绑定的 hash 与 ledger 封口不一致：${input.hash}（AC-085）`,
        { seq: input.seq, hash: input.hash },
      );
    }
    // The seal is committed and appends are refused, so this can only fail if an
    // internal invariant broke; report that instead of a fabricated success.
    const recomputed = readLedgerSealHash(this.appended);
    if (recomputed !== sealed.hash) {
      return fail('INTERNAL_ERROR', 'read ledger 封口 hash 与当前条目不一致（AC-085）');
    }
    return { ok: true, seq: sealed.seq, hash: sealed.hash };
  }

  sealedBinding(): ReadLedgerSeal | null {
    return this.frozenSeal === null ? null : Object.freeze({ ...this.frozenSeal });
  }

  entries(): readonly ReadLedgerEntry[] {
    return Object.freeze(this.appended.map((entry) => Object.freeze({ ...entry })));
  }

  usage(): ReadLedgerUsage {
    return Object.freeze({
      initial: Object.freeze({ limit: this.initialLimit, used: this.initialUsed }),
      expansion: Object.freeze({ limit: this.expansionLimit, used: this.expansionUsed }),
      consumedTokens: this.initialUsed - this.baseInitialUsed + this.expansionUsed,
      remainingTokens: this.remaining(),
      entries: this.appended.length,
    });
  }

  readScope(): ReadScope {
    return freezeReadScope(this.scope);
  }

  expansions(): readonly ExpansionRecord[] {
    return Object.freeze(this.requested.map((record) => freezeExpansion(record)));
  }

  identity(): {
    readonly runId: string;
    readonly role: ContextRole;
    readonly stage: ContextStage;
  } {
    return Object.freeze({ runId: this.runId, role: this.role, stage: this.stage });
  }

  private remaining(): number {
    return this.initialLimit - this.initialUsed + (this.expansionLimit - this.expansionUsed);
  }

  /** Charges the initial ceiling first, then the granted expansion allowance. */
  private charge(tokens: number): void {
    const fromInitial = Math.min(tokens, this.initialLimit - this.initialUsed);
    this.initialUsed += fromInitial;
    this.expansionUsed += tokens - fromInitial;
  }
}

/** Builds one `LedgerError` with optional structured detail. */
function fail(
  code: ErrorCode,
  message: string,
  extra: Omit<LedgerError, 'code' | 'message'> = {},
): { readonly ok: false; readonly errors: readonly LedgerError[] } {
  return { ok: false, errors: [{ code, message, ...extra }] };
}

/**
 * Creates one Run's read ledger.
 *
 * The `scope` must be the object `acl.scopeFor(role, stage, project)` returned, so
 * the ledger's admission test is exactly the ACL the Run was dispatched under; the
 * optional `revision` is the frozen tree appended reads are attributed to. Invalid
 * input (empty Run id, unknown role/stage, a non-integer or over-spent budget) is
 * `VALIDATION_ERROR`, never a silently repaired ledger.
 */
export function createReadLedger(input: CreateReadLedgerInput): CreateReadLedgerResult {
  const errors: LedgerError[] = [];
  if (typeof input.runId !== 'string' || input.runId.trim() === '') {
    errors.push({ code: 'VALIDATION_ERROR', message: 'read ledger 需要非空 runId' });
  }
  if (!CONTEXT_ROLES.includes(input.role)) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `未登记的角色：${String(input.role)}`,
    });
  }
  if (!CONTEXT_STAGES.includes(input.stage)) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `未登记的阶段：${String(input.stage)}`,
    });
  }
  if (
    input.scope === undefined ||
    input.scope === null ||
    typeof input.scope.projectId !== 'string' ||
    input.scope.projectId === '' ||
    !Array.isArray(input.scope.pathPrefixes)
  ) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: 'read ledger 需要 acl.scopeFor 产出的 scope',
    });
  }
  if (input.revision !== undefined && typeof input.revision !== 'string') {
    errors.push({ code: 'VALIDATION_ERROR', message: 'read ledger revision 必须是字符串' });
  }
  const budget = input.budget;
  if (budget === undefined || budget === null) {
    errors.push({ code: 'VALIDATION_ERROR', message: 'read ledger 需要 budget（AC-036）' });
  } else {
    for (const [name, value] of [
      ['initialTokens', budget.initialTokens],
      ['expansionTokens', budget.expansionTokens],
    ] as const) {
      const message = readBudgetValueError(name, value);
      if (message !== null) {
        errors.push({ code: 'VALIDATION_ERROR', message });
      }
    }
    const used = budget.initialUsed ?? 0;
    if (!Number.isInteger(used) || used < 0) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: 'readBudget.initialUsed 必须是非负整数（AC-036）',
      });
    } else if (Number.isInteger(budget.initialTokens) && used > budget.initialTokens) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: `readBudget.initialUsed ${used} 超过 initialTokens ${budget.initialTokens}（AC-036）`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const counter = input.tokenCounter ?? characterTokenCounter;
  const clock = input.now ?? nowIso;
  return { ok: true, ledger: new ReadLedgerImpl(input, counter, clock) };
}
