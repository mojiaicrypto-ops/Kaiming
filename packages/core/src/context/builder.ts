/**
 * The ContextBuilder: authorise → resolve → check required inputs → freeze →
 * account tokens (`docs/architecture/context.md` §1, `docs/rules/agents.md` §2/§6).
 *
 * The builder is deliberately the *only* place where a `ContextSelection` turns
 * into content, and it never does more than the Chief asked for:
 *
 * 1. **The selection is validated first.** Every `sourceRefs`/`artifactRefs` entry
 *    needs a written reason and the goal must be non-empty (`AC-030`); otherwise
 *    the whole build fails with `VALIDATION_ERROR` listing the offenders, because
 *    a selection nobody can justify must not be frozen.
 * 2. **Every source is authorised before it is resolved.** A transcript, a source
 *    owned by another Project, a future artifact or a path outside `readScope` is
 *    refused by `canRead` (`AC-033`, `AC-034`) and the refusal never reaches the
 *    resolver, so the denied content cannot enter the result.
 * 3. **Resolution goes through ports.** Git/path, artifact, policy and role-contract
 *    lookups are performed by the injected `SourceResolverPort`/`ContentFetchPort`/
 *    `ContextGatesPort`; a reference that does not exist in this Project is
 *    `NOT_FOUND`, an artifact whose version moved on is `STALE_ARTIFACT`, and a
 *    module is *never* expanded on its own to close a gap (`context.md` §1).
 * 4. **Content is frozen, not referenced.** The resolved content is copied into an
 *    immutable snapshot directory through the `SnapshotWriterPort`, each file named
 *    by its content hash, and `snapshotRef` is the digest of the frozen payload —
 *    so re-freezing identical inputs is idempotent and a later edit of the source
 *    file cannot alter a started Run (`AC-030`, "Snapshot 失效").
 * 5. **Required inputs are checked after authorisation and the budget, not before.**
 *    A genuine gap is `MISSING_CONTEXT` with the precise gap list and *no* frozen
 *    snapshot (`AC-031`), while the four documented bootstrap positives stay legal
 *    (`AC-079`). A required input that only fails because its source did not fit
 *    the budget is reported as `BUDGET_EXCEEDED` instead (`AC-036`).
 * 6. **Tokens are accounted as sources are included.** `initialTokens` from the
 *    selection shrinks with every bundled source; a source that does not fit is
 *    dropped **explicitly** — recorded in `excluded`/`unknowns` and named in the
 *    `BUDGET_EXCEEDED` gap — so the whole repository is never injected (`AC-036`).
 * 7. **Failure is closed.** Every failure path returns `{ok:false, code, errors}`
 *    and leaves no frozen snapshot behind.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ContextSelection,
  ErrorCode,
  Hash,
  RepoPath,
  SourceRef,
  Time,
} from '@agentdev/contracts';
import { nowIso, sha256 } from '@agentdev/storage';
import { canonicalJson } from '../dispatcher.js';
import { canRead, scopeFor } from './acl.js';
import {
  evaluateRequirements,
  inputKeyForSource,
  selectionGaps,
  type AvailableInputs,
} from './requirements.js';
import {
  denialSourceRef,
  fromSourceRef,
  fromSourceRefKind,
  normalizeContextStage,
  sourceRefKey,
  toSourceRefKind,
  type ContextError,
  type ContextGap,
  type ContextInputKey,
  type ContextRole,
  type ContextSnapshot,
  type ContextSourceRef,
  type ContextStage,
  type ContextUnknown,
  type ExcludedSource,
  type ProjectScope,
  type ReaderContext,
  type ReadScope,
  type ResolvedSource,
  type TokenAccounting,
} from './types.js';

/** Counts the tokens one resolved body costs against the budget. */
export type TokenCounter = (content: string) => number;

/**
 * The documented deterministic estimator: one token per four characters.
 *
 * It is an *estimate*, not a provider tokenizer: the builder only needs a stable,
 * offline number to prove that a package fits or does not, and a later slice may
 * inject a real counter through `TokenCounter` without changing any behaviour.
 */
export function characterTokenCounter(content: string): number {
  return Math.ceil([...content].length / 4);
}

/** The estimation rule used when the caller supplies no counter. */
export const DEFAULT_TOKEN_COUNTER: TokenCounter = characterTokenCounter;

/**
 * A logical fetch handle: what a content port needs to read the raw bytes.
 *
 * The builder never opens files or the Git object store itself, so the same code
 * runs against real ports in production and against memory ports in tests.
 */
export type FetchRef =
  | { readonly kind: 'git'; readonly path: RepoPath; readonly revision: string }
  | { readonly kind: 'artifact'; readonly id: string; readonly version: string };

/** What one fetch answers: the raw content of a resolved source. */
export type ContentFetchResult =
  | { readonly ok: true; readonly content: string }
  | {
      readonly ok: false;
      readonly code: 'NOT_FOUND' | 'STALE_ARTIFACT' | 'ARTIFACT_MISSING' | 'INTERNAL_ERROR';
      readonly message: string;
    };

/** The raw-content port a caller injects (a Git/Artifact reader in production). */
export interface ContentFetchPort {
  fetch(ref: FetchRef): ContentFetchResult;
}

/** How the builder must obtain the content of a resolved source. */
export type ResolveFetchRef =
  | { readonly kind: 'git'; readonly revision: string }
  | { readonly kind: 'artifact' }
  | { readonly kind: 'none' };

/**
 * One resolved source's identity.
 *
 * `hash` is the frozen-content identity of `AC-030`; `revision` is the exact Git
 * revision (or artifact version) the content was read from, so a `ResolvedSource`
 * can always be traced back to what it was frozen from. The four documented forms
 * are: git path+revision (`path`+`revision`), artifact id@version (`version`),
 * policy revision (`revision`) and role contract (`role`).
 */
export interface ResolvedSourceContent {
  readonly hash: Hash;
  readonly kind: 'git' | 'artifact' | 'policy' | 'role_contract';
  readonly path?: RepoPath;
  readonly revision?: string;
  readonly version?: string;
  readonly role?: ContextRole;
  /**
   * `git`/`artifact` need a fetch through the content port; `policy` and
   * `role_contract` are small structured documents that arrive inline.
   */
  readonly fetch: ResolveFetchRef;
  /** Present when `fetch.kind !== 'none'`. */
  readonly fetchRef?: FetchRef;
  /** Inline content for `policy`/`role_contract` resolutions. */
  readonly content?: string;
}

/** What a resolver may answer for one authorised source. */
export type SourceResolutionResult =
  | ({ readonly ok: true } & ResolvedSourceContent)
  | {
      readonly ok: false;
      readonly code: 'NOT_FOUND' | 'STALE_ARTIFACT' | 'CONTEXT_FORBIDDEN' | 'INTERNAL_ERROR';
      readonly message: string;
    };

/** What the resolver receives: the authorised ref plus the reader's frozen scope. */
export interface SourceResolveInput {
  readonly ref: ContextSourceRef;
  readonly role: ContextRole;
  readonly stage: ContextStage;
  readonly scope: ReadScope;
  readonly reader: ReaderContext;
}

/** The resolver port: turns an authorised `ContextSourceRef` into a frozen identity. */
export interface SourceResolverPort {
  resolve(input: SourceResolveInput): SourceResolutionResult;
}

/**
 * The Project-level facts every build freezes: the policy revision and the role
 * contract (`context.md` §1 "Policy revision、角色契约").
 *
 * They are not selection entries — they are the policy the read was evaluated
 * under — so they arrive through their own port and are read by the builder
 * itself, never by an agent.
 */
export interface ContextGatesPort {
  current(input: {
    readonly role: ContextRole;
    readonly stage: ContextStage;
    readonly project: ProjectScope;
  }): ContextGatesResult;
}

/** The gate answer: the policy revision, its hash, and the role's contract. */
export type ContextGatesResult =
  | {
      readonly ok: true;
      /** The applicable policy revision (`Run.policy` / `policyRevision`). */
      readonly policyRevision: string;
      readonly policyContent: string;
      readonly roleContract: {
        readonly id: string;
        readonly body: string;
      };
    }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/** One immutable file copied into the snapshot directory. */
export interface SnapshotContentFile {
  /** Hash-addressed name: the file is written as `<hash>` in the directory. */
  readonly address: Hash;
  /** Logical name of the source (path/id), recorded in the manifest. */
  readonly name: string;
  readonly content: string;
  readonly bytes: number;
}

/** What the writer receives once a snapshot has been frozen. */
export interface ContextSnapshotFreezeRequest {
  /** Content digest of the frozen payload (`ContextSnapshot.snapshotRef`). */
  readonly snapshotRef: Hash;
  readonly files: readonly SnapshotContentFile[];
  readonly policyHash: Hash;
  readonly configHash: Hash;
  readonly selection: ContextSelection;
  readonly readScopeDigest: Hash;
  readonly createdAt: Time;
}

/** What the writer answers after the content tree exists. */
export interface ContextSnapshotDirectory {
  readonly directory: string;
  /** `false` when the same content-addressed snapshot already existed. */
  readonly created: boolean;
}

/**
 * The snapshot writer port (`context.md` §1 "实际内容复制进不可变快照目录").
 *
 * `directory` must be derived from `snapshotRef` only, never from `createdAt`, so
 * that re-freezing identical inputs lands on the same directory with the same
 * files and a changed source file cannot rewrite an already frozen snapshot.
 */
export interface SnapshotWriterPort {
  write(request: ContextSnapshotFreezeRequest): ContextSnapshotDirectory;
}

/** Everything `buildContext` needs from its caller. */
export interface BuildContextInput {
  readonly selection: ContextSelection;
  readonly role: ContextRole;
  /** Runtime spelling (`develop`, `plan`, …); normalized to a domain stage. */
  readonly stage: string;
  readonly project: ProjectScope;
  /** Frozen configuration hash (`data.md` §3 `configSnapshotId`). */
  readonly configHash: Hash;
  /** The Run this context is assembled for (`AC-035` Run isolation). */
  readonly runId: string;
  /**
   * The Work whose process tree this Run may read (`.agentdev/work/<id>/`).
   *
   * It is the ACL's `ProjectScope.workId`, not a source of its own.
   */
  readonly workId?: string;
  readonly sessionRef?: string;
  /**
   * Full `ContextSourceRef` handles for the sources in this selection.
   *
   * `contracts.SourceRef` carries no sender, artifact class or Project id, so the
   * Core passes both the narrow selection and these handles. Two cases exist:
   *
   * - a handle whose `kind:id` matches a `selection.sourceRefs`/`artifactRefs`
   *   entry is the metadata that entry cannot carry (a user message's sender, an
   *   artifact's class); it is *not* read twice, it only makes the ACL able to
   *   classify the selected source.
   * - any other handle is an additional source the selection cannot express — a
   *   cross-Project reference, a Transcript attack, an initialization file — and is
   *   authorised, resolved and budgeted exactly like a `sourceRefs` entry.
   */
  readonly contextSources?: readonly ContextSourceRef[];
  /**
   * Logical inputs the caller can assert without a resolvable handle.
   *
   * `context.md` §4 describes initialization inputs such as
   * `bootstrapObservation` that are not a Git path, an Artifact or a policy
   * revision; the caller asserts them and they enter the required-input check
   * without any content being fabricated for them.
   */
  readonly contextInputs?: readonly ContextInputKey[];
  readonly resolver: SourceResolverPort;
  readonly content: ContentFetchPort;
  readonly gates: ContextGatesPort;
  readonly snapshotWriter: SnapshotWriterPort;
  readonly tokenCounter?: TokenCounter;
  /** Injectable clock; defaults to `nowIso()`. */
  readonly now?: () => Time;
}

/** One source the budget forced out of the package (`AC-036`). */
export interface DroppedSource {
  readonly ref: SourceRef;
  /** What the source would have been called in the manifest. */
  readonly name: string;
  readonly tokens: number;
  /** Tokens the package was short of including it. */
  readonly shortfall: number;
  readonly reason: string;
}

/** What a successful build consumed and what it had to drop. */
export interface ContextUsage {
  /** `selection.readBudget.initialTokens` — the startup package ceiling. */
  readonly initialTokens: number;
  readonly consumedTokens: number;
  readonly remainingTokens: number;
  readonly dropped: readonly DroppedSource[];
}

/** The builder's closed result: a frozen snapshot or explicit errors. */
export type BuildContextResult =
  | {
      readonly ok: true;
      readonly snapshot: ContextSnapshot;
      readonly usage: ContextUsage;
      /** Absolute immutable content directory the sources were copied into. */
      readonly directory: string;
    }
  | {
      readonly ok: false;
      /** First error's `ERROR_CODES` member; every error is in `errors`. */
      readonly code: ErrorCode;
      readonly errors: readonly ContextError[];
      /** Present once the budget was evaluated (e.g. `BUDGET_EXCEEDED`). */
      readonly usage?: ContextUsage;
    };

/** A source that survived authorisation, resolution and the budget check. */
interface GatheredSource {
  readonly ref: SourceRef;
  readonly source: ContextSourceRef;
  readonly name: string;
  readonly reason: string;
  readonly content: string;
  readonly bytes: number;
  readonly hash: Hash;
  readonly tokens: number;
  readonly path?: RepoPath;
  readonly revision?: string;
  readonly version?: string;
}

/** Internals of one gather step: a source, a fatal failure, or a recorded refusal. */
type GatherStep =
  | { readonly ok: true; readonly gathered: GatheredSource }
  | {
      readonly ok: false;
      readonly fatal: true;
      readonly code: ErrorCode;
      readonly errors: readonly ContextError[];
    }
  | {
      readonly ok: false;
      readonly fatal: false;
      readonly message: string;
      readonly ref: SourceRef;
    };

/** Maps a domain stage spelling onto a canonical stage (`null` when unknown). */
function stageOf(raw: string): ContextStage | null {
  return normalizeContextStage(raw);
}

/** A deterministic, human-readable manifest name for one resolved source. */
function manifestName(source: ContextSourceRef, resolved?: ResolvedSourceContent): string {
  if (resolved?.path !== undefined) return resolved.path;
  if (source.kind === 'artifact' || resolved?.kind === 'artifact') {
    return `artifact/${source.id}@${source.version}`;
  }
  if (resolved?.role !== undefined) return `role_contract/${resolved.role}`;
  if (source.kind === 'policy' || resolved?.kind === 'policy') return `policy/${source.id}`;
  return `${source.kind}/${source.id}`;
}

/** The `key` form of a Context source, used in reason and error messages. */
function contextSourceRefKey(source: ContextSourceRef): string {
  return `${source.kind}:${source.id}`;
}

/**
 * Widens a selection entry into the Context vocabulary with its Project binding.
 *
 * A selection entry belongs to this Project by construction; a handle that names
 * another Project keeps its own id so `canRead` refuses it (`AC-034`). A
 * `SourceRef` carries no sender/class metadata, so an equivalent full handle from
 * `contextSources` is preferred when one exists: without it the ACL could not
 * classify a user message and would refuse it ("chief 角色不读取该消息正文").
 */
function bondSource(
  source: ContextSourceRef,
  project: ProjectScope,
  contextSources: ReadonlyMap<string, ContextSourceRef>,
): ContextSourceRef {
  const full = contextSources.get(contextSourceRefKey(source)) ?? source;
  return {
    kind: full.kind,
    id: full.id,
    version: full.version,
    projectId: full.projectId ?? project.projectId,
    ...(full.path === undefined ? {} : { path: full.path }),
    ...(full.hash === undefined ? {} : { hash: full.hash }),
    ...(full.sender === undefined ? {} : { sender: full.sender }),
    ...(full.artifactClass === undefined ? {} : { artifactClass: full.artifactClass }),
    ...(full.ownedRunId === undefined ? {} : { ownedRunId: full.ownedRunId }),
  };
}

/**
 * The `SourceRef` a resolution outcome is reported against.
 *
 * Built from the storage-level kind mapping, so a `knowledge`/`transcript` source
 * still produces a loggable handle instead of a fabricated kind.
 */
function refFor(source: ContextSourceRef, resolved?: ResolvedSourceContent): SourceRef {
  return {
    kind: toSourceRefKind(source.kind),
    id: source.id,
    version: resolved?.version ?? source.version,
    ...(resolved?.path === undefined
      ? source.path === undefined
        ? {}
        : { path: source.path }
      : { path: resolved.path }),
    ...(source.hash === undefined ? {} : { hash: source.hash }),
  };
}

/** Maps a resolver failure code onto the builder's failure vocabulary. */
function resolutionCode(
  code: 'NOT_FOUND' | 'STALE_ARTIFACT' | 'CONTEXT_FORBIDDEN' | 'INTERNAL_ERROR',
): ErrorCode {
  return code;
}

/**
 * The canonical payload a snapshot's content digest is computed over.
 *
 * `createdAt` is excluded so that freezing the same selection twice is idempotent:
 * the identity is *what* was read, not when it was read.
 */
function snapshotIdentity(snapshot: Omit<ContextSnapshot, 'snapshotRef' | 'createdAt'>): unknown {
  return {
    selection: snapshot.selection,
    resolvedSources: snapshot.resolvedSources,
    excluded: snapshot.excluded,
    unknowns: snapshot.unknowns,
    policyHash: snapshot.policyHash,
    configHash: snapshot.configHash,
    readScopeDigest: snapshot.readScopeDigest,
    tokenAccounting: snapshot.tokenAccounting,
  };
}

/** Digest of the frozen payload (`ContextSnapshot.snapshotRef`). */
export function contextSnapshotRef(
  snapshot: Omit<ContextSnapshot, 'snapshotRef' | 'createdAt'>,
): Hash {
  return sha256(canonicalJson(snapshotIdentity(snapshot)));
}

/** Stable digest of the read scope a Run is confined to. */
export function readScopeDigest(scope: ReadScope): Hash {
  return sha256(canonicalJson(scope));
}

/**
 * The canonical payload of one snapshot, i.e. the object minus `snapshotRef`.
 *
 * `snapshotRef = sha256(canonicalJson(identityPayload))`, so a caller that freezes
 * the snapshot through `SnapshotWriter.freeze(type, payload, { identityPayload })`
 * gets a row hash equal to the builder's `snapshotRef`. `createdAt` is part of the
 * stored payload but not of the identity.
 */
export function snapshotIdentityPayload(snapshot: ContextSnapshot): unknown {
  return snapshotIdentity(snapshot);
}

/**
 * The default content-addressed snapshot directory writer.
 *
 * Every file is written as `<directory>/<hash>` and the directory is derived from
 * `snapshotRef` only, so the same frozen payload lands in the same place: a second
 * freeze is a no-op for the content tree and a later edit of the source file can
 * never rewrite it. Writes go through a temporary file + rename so a crash cannot
 * leave a half-written file under a hash name.
 */
export function createSnapshotDirectoryWriter(options: {
  /** Root under which `snapshots/context/<snapshotRef>/` is created. */
  readonly root: string;
}): SnapshotWriterPort {
  return {
    write(request: ContextSnapshotFreezeRequest): ContextSnapshotDirectory {
      const directory = join(options.root, 'snapshots', 'context', request.snapshotRef);
      const created = !existsSync(directory);
      mkdirSync(directory, { recursive: true });
      let counter = 0;
      for (const file of request.files) {
        const target = join(directory, file.address);
        if (existsSync(target)) continue;
        const temporary = `${target}.tmp-${process.pid}-${counter}`;
        counter += 1;
        writeFileSync(temporary, file.content, 'utf8');
        const verified = readFileSync(temporary, 'utf8');
        if (sha256(verified) !== file.address) {
          rmSync(temporary, { force: true });
          throw new Error(
            `context snapshot content for ${file.name} hashes to ${sha256(verified)}, expected ${file.address}`,
          );
        }
        renameSync(temporary, target);
      }
      // The manifest records which logical source each hash-addressed file holds;
      // it is metadata, not content, so it never changes the snapshot identity.
      const manifest = {
        snapshotRef: request.snapshotRef,
        policyHash: request.policyHash,
        configHash: request.configHash,
        readScopeDigest: request.readScopeDigest,
        createdAt: request.createdAt,
        files: request.files.map((file) => ({
          address: file.address,
          name: file.name,
          bytes: file.bytes,
        })),
      };
      writeFileSync(join(directory, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8');
      return { directory, created };
    },
  };
}

/** The policy refusal of one source: always fatal, never silently omitted. */
function fatal(code: ErrorCode, message: string, ref: SourceRef): GatherStep {
  return { ok: false, fatal: true, code, errors: [{ code, message, ref }] };
}

/**
 * Authorises one source and resolves its identity through the ports.
 *
 * A refusal by the ACL is always fatal: a context that quietly omitted a source
 * Chief explicitly asked for would hide an authorisation failure (`AC-033`,
 * `AC-034`). A stale artifact is fatal for the same reason; a reference that does
 * not exist in this Project is recorded as excluded/unknown so Chief can see it.
 */
function gatherSource(args: {
  readonly source: ContextSourceRef;
  readonly reason: string;
  readonly role: ContextRole;
  readonly stage: ContextStage;
  readonly scope: ReadScope;
  readonly reader: ReaderContext;
  readonly input: BuildContextInput;
  readonly counter: TokenCounter;
}): GatherStep {
  const { source, reason, role, stage, scope, reader, input, counter } = args;
  const decision = canRead(role, stage, source, scope, reader);
  if (!decision.allowed) {
    return fatal(decision.code, decision.message, decision.ref);
  }
  if (reason.trim() === '') {
    // `selectionGaps` already rejects this, so reaching here means a caller built
    // the selection object by hand; refuse rather than resolve an unjustified read.
    return fatal(
      'VALIDATION_ERROR',
      `来源缺少 reason：${contextSourceRefKey(source)}`,
      denialSourceRef(source),
    );
  }
  const resolution = input.resolver.resolve({ ref: source, role, stage, scope, reader });
  if (!resolution.ok) {
    const code = resolutionCode(resolution.code);
    if (code === 'NOT_FOUND') {
      return { ok: false, fatal: false, message: resolution.message, ref: refFor(source) };
    }
    return fatal(code, resolution.message, refFor(source));
  }
  const resolved: ResolvedSourceContent = resolution;
  let content: string;
  if (resolved.fetch.kind === 'none') {
    content = resolved.content ?? '';
  } else {
    const fetchRef = resolved.fetchRef;
    if (fetchRef === undefined) {
      return fatal(
        'INTERNAL_ERROR',
        `resolver 未提供 fetchRef：${contextSourceRefKey(source)}`,
        refFor(source, resolved),
      );
    }
    const fetched = input.content.fetch(fetchRef);
    if (!fetched.ok) {
      if (fetched.code === 'NOT_FOUND' || fetched.code === 'ARTIFACT_MISSING') {
        return {
          ok: false,
          fatal: false,
          message: fetched.message,
          ref: refFor(source, resolved),
        };
      }
      const code: ErrorCode =
        fetched.code === 'STALE_ARTIFACT' ? 'STALE_ARTIFACT' : 'INTERNAL_ERROR';
      return fatal(code, fetched.message, refFor(source, resolved));
    }
    content = fetched.content;
    const actual = sha256(content);
    if (actual !== resolved.hash) {
      return fatal(
        'STALE_ARTIFACT',
        `来源内容与声明的 hash 不一致：${contextSourceRefKey(source)}（声明 ${resolved.hash}，实际 ${actual}）`,
        refFor(source, resolved),
      );
    }
  }
  const gathered: GatheredSource = {
    ref: refFor(source, resolved),
    source,
    name: manifestName(source, resolved),
    reason,
    content,
    bytes: Buffer.byteLength(content, 'utf8'),
    hash: resolved.hash,
    tokens: counter(content),
    ...(resolved.path === undefined ? {} : { path: resolved.path }),
    ...(resolved.revision === undefined ? {} : { revision: resolved.revision }),
    ...(resolved.version === undefined ? {} : { version: resolved.version }),
  };
  return { ok: true, gathered };
}

/** The logical inputs the required-input table can see in the delivered package. */
function availabilityOf(
  included: readonly GatheredSource[],
  asserted: readonly ContextInputKey[] = [],
): AvailableInputs {
  const inputs: Record<string, boolean> = {};
  for (const source of included) {
    const key = inputKeyForSource(source.source);
    if (key === null) continue;
    inputs[key] = true;
  }
  for (const key of asserted) inputs[key] = true;
  return inputs;
}

/** Narrows a requirement gap into the builder's error shape. */
function toContextError(gap: ContextGap): ContextError {
  return {
    code: gap.code,
    message: gap.message,
    ...(gap.ref === undefined ? {} : { ref: gap.ref }),
    ...(gap.input === undefined ? {} : { input: gap.input }),
  };
}

/**
 * Builds one Run's frozen context from Chief's selection.
 *
 * The steps are ordered exactly as the document requires: validate, authorise,
 * resolve, include what the budget allows, check the required inputs, then freeze
 * what survived. Nothing is fetched before authorisation and no snapshot exists
 * unless the build succeeds.
 */
export function buildContext(input: BuildContextInput): BuildContextResult {
  const counter = input.tokenCounter ?? DEFAULT_TOKEN_COUNTER;
  const now = input.now ?? nowIso;
  const project = input.project;
  const selection = input.selection;

  // Step 1 — the selection must be justifiable before anything else happens.
  const selectionErrors: ContextError[] = [];
  const goal = typeof selection.goal === 'string' ? selection.goal.trim() : '';
  if (goal === '') {
    selectionErrors.push({
      code: 'VALIDATION_ERROR',
      message: 'ContextSelection.goal 不能为空（AC-030）',
    });
  }
  for (const gap of selectionGaps(selection)) {
    selectionErrors.push({
      code: 'VALIDATION_ERROR',
      message: gap.message,
      ...(gap.ref === undefined ? {} : { ref: gap.ref }),
    });
  }
  // The budget is part of the frozen record (`AC-036`), so a negative or
  // fractional ceiling is refused here instead of being silently rounded.
  for (const [name, value] of [
    ['initialTokens', selection.readBudget?.initialTokens],
    ['expansionTokens', selection.readBudget?.expansionTokens],
  ] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      selectionErrors.push({
        code: 'VALIDATION_ERROR',
        message: `readBudget.${name} 必须是非负整数（AC-036）`,
      });
    }
  }
  if (selectionErrors.length > 0) {
    return { ok: false, code: 'VALIDATION_ERROR', errors: selectionErrors };
  }

  // Step 2 — the ACL row must exist for this role/stage.
  const stage = stageOf(input.stage);
  if (stage === null) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      errors: [{ code: 'VALIDATION_ERROR', message: `未知的阶段拼写：${input.stage}` }],
    };
  }
  const scope = scopeFor(input.role, stage, project);
  if (scope === null) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      errors: [
        { code: 'VALIDATION_ERROR', message: `未登记的角色/阶段组合：${input.role}:${stage}` },
      ],
    };
  }
  const reader: ReaderContext = {
    runId: input.runId,
    projectId: project.projectId,
    ...(input.sessionRef === undefined ? {} : { sessionRef: input.sessionRef }),
  };

  // Step 3 — the Project gates: the policy revision and the role contract.
  const gates = input.gates.current({ role: input.role, stage, project });
  if (!gates.ok) {
    return { ok: false, code: gates.code, errors: [{ code: gates.code, message: gates.message }] };
  }
  const policyHash = sha256(gates.policyContent);
  // The role contract and the policy revision are Project-level facts, not Chief's
  // selection: they arrive through the gate port (`agents.md` §2) so the ACL's
  // selection rules never have to carve out an exception for them.
  const roleContractSource: ContextSourceRef = {
    kind: 'role_contract',
    id: gates.roleContract.id,
    version: '1',
    projectId: project.projectId,
  };
  const roleContractResolution: ResolvedSourceContent = {
    hash: sha256(gates.roleContract.body),
    kind: 'role_contract',
    role: input.role,
    revision: gates.policyRevision,
    fetch: { kind: 'none' },
    content: gates.roleContract.body,
  };

  // Step 4 — authorise and resolve every selected source (artifact refs included).
  const excluded: ExcludedSource[] = selection.excluded.map((reason) => ({
    ref: { kind: 'policy', id: `selection-excluded:${reason}`, version: 'selection' },
    reason,
  }));
  const unknowns: ContextUnknown[] = selection.unknowns.map((reason) => ({
    ref: { kind: 'policy', id: `selection-unknown:${reason}`, version: 'selection' },
    reason,
  }));
  const gathered: GatheredSource[] = [];
  // Full handles keyed by `kind:id`: `selection.sourceRefs` are storage handles
  // (`SourceRef`) that carry no sender/class metadata, so a caller-supplied
  // `contextSources` entry with the same key supplies it for the ACL and manifest.
  const fullSources = new Map<string, ContextSourceRef>();
  for (const entry of input.contextSources ?? [])
    fullSources.set(contextSourceRefKey(entry), entry);
  const selectedKeys = new Set<string>([
    ...selection.sourceRefs.map((entry) => `${fromSourceRefKind(entry.kind)}:${entry.id}`),
    ...selection.artifactRefs.map((entry) => `artifact:${entry.id}`),
  ]);

  for (const raw of selection.sourceRefs) {
    // `selection.sourceRefs` are storage handles (`SourceRef`); `fromSourceRef`
    // restates the same scalar shape in the Context vocabulary (`types.ts`).
    const source = bondSource(fromSourceRef(raw), project, fullSources);
    const reason = selection.reasonPerSource[sourceRefKey(raw)] ?? '';
    const step = gatherSource({
      source,
      reason,
      role: input.role,
      stage,
      scope,
      reader,
      input,
      counter,
    });
    if (step.ok) {
      gathered.push(step.gathered);
      continue;
    }
    if (step.fatal) return { ok: false, code: step.code, errors: step.errors };
    excluded.push({ ref: step.ref, reason: step.message });
    unknowns.push({ ref: step.ref, reason: step.message });
  }

  for (const artifact of selection.artifactRefs) {
    const base: ContextSourceRef = {
      kind: 'artifact',
      id: artifact.id,
      version: String(artifact.version),
      projectId: project.projectId,
    };
    // An artifact `Ref` carries no class, so the ACL needs the full handle from
    // `contextSources`; without one the source cannot be classified at all.
    const source = bondSource(base, project, fullSources);
    const reason = selection.reasonPerSource[`artifact:${artifact.id}`] ?? '';
    const step = gatherSource({
      source,
      reason,
      role: input.role,
      stage,
      scope,
      reader,
      input,
      counter,
    });
    if (step.ok) {
      gathered.push(step.gathered);
      continue;
    }
    if (step.fatal) return { ok: false, code: step.code, errors: step.errors };
    excluded.push({ ref: step.ref, reason: step.message });
    unknowns.push({ ref: step.ref, reason: step.message });
  }

  for (const contextual of input.contextSources ?? []) {
    // An entry that overlays a selected source (same `kind:id`) only supplies its
    // metadata; anything else is an additional, fully specified handle.
    if (selectedKeys.has(contextSourceRefKey(contextual))) continue;
    const source = bondSource(contextual, project, fullSources);
    const reason = selection.reasonPerSource[contextSourceRefKey(contextual)] ?? '';
    const step = gatherSource({
      source,
      reason,
      role: input.role,
      stage,
      scope,
      reader,
      input,
      counter,
    });
    if (step.ok) {
      gathered.push(step.gathered);
      continue;
    }
    if (step.fatal) return { ok: false, code: step.code, errors: step.errors };
    excluded.push({ ref: step.ref, reason: step.message });
    unknowns.push({ ref: step.ref, reason: step.message });
  }

  // The role contract is a fixed selection of every build (`agents.md` §2); it is
  // added last so a budget overflow is reported against the Chief's own choices
  // first, and it is deduplicated when the Chief already selected it.
  const roleContractGathered = gatherResolved({
    source: roleContractSource,
    resolved: roleContractResolution,
    reason: `角色契约是 ${input.role}:${stage} 的固定必需项（agents.md §2）`,
    counter,
  });
  if (roleContractGathered === undefined) {
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      errors: [{ code: 'INTERNAL_ERROR', message: `角色契约缺少内联正文：${input.role}` }],
    };
  }
  if (
    !gathered.some(
      (source) => source.ref.kind === 'policy' && source.name === roleContractGathered.name,
    )
  ) {
    gathered.push(roleContractGathered);
  }

  // Step 5 — the budget decides which gathered sources are actually bundled.
  const limit = selection.readBudget.initialTokens;
  let consumed = 0;
  const included: GatheredSource[] = [];
  const dropped: DroppedSource[] = [];
  const droppedByInput = new Map<string, DroppedSource>();
  for (const source of gathered) {
    if (consumed + source.tokens <= limit) {
      consumed += source.tokens;
      included.push(source);
      continue;
    }
    const shortfall = consumed + source.tokens - limit;
    const reason = `预算不足：包含 ${source.name} 需要 ${source.tokens} tokens，缺口 ${shortfall} tokens（AC-036）`;
    const record: DroppedSource = {
      ref: source.ref,
      name: source.name,
      tokens: source.tokens,
      shortfall,
      reason,
    };
    dropped.push(record);
    excluded.push({ ref: source.ref, reason });
    unknowns.push({ ref: source.ref, reason });
    const droppedInput = inputKeyForSource(source.source);
    if (droppedInput !== null && !droppedByInput.has(droppedInput)) {
      droppedByInput.set(droppedInput, record);
    }
  }
  const usage: ContextUsage = {
    initialTokens: limit,
    consumedTokens: consumed,
    remainingTokens: limit - consumed,
    dropped,
  };

  // Step 6 — required inputs are evaluated against what survived the budget.
  const evaluation = evaluateRequirements({
    role: input.role,
    stage,
    available: availabilityOf(included, input.contextInputs ?? []),
  });
  if (!evaluation.ok) {
    // A gap is a *budget* gap only when the very source that would have supplied
    // it was dropped: a source dropped from an input another delivered source
    // already satisfies is an optional loss, not the reason the build failed.
    // Only the sources the table can classify can be attributed to an input: the
    // builder therefore records *both* the delivered and the dropped key→source
    // mapping. `undelivered` keeps a dropped-but-still-satisfied input (a policy
    // file standing in for the role contract) from being reported as a budget gap.
    const deliveredByInput = new Map<string, string>();
    for (const source of included) {
      const key = inputKeyForSource(source.source);
      if (key !== null && !deliveredByInput.has(key)) deliveredByInput.set(key, source.source.id);
    }
    const budgetGaps = evaluation.errors.filter(
      (gap) =>
        gap.input !== undefined &&
        !deliveredByInput.has(gap.input) &&
        droppedByInput.has(gap.input),
    );
    if (budgetGaps.length > 0) {
      const keys = [
        ...new Set(
          budgetGaps.map((gap) => gap.input).filter((key): key is string => key !== undefined),
        ),
      ];
      const budgetErrors: ContextError[] = keys.map((key) => {
        const record = droppedByInput.get(key);
        return {
          code: 'BUDGET_EXCEEDED',
          message: `预算不足：${record?.name ?? key} 被排除，缺口 ${record?.shortfall ?? 0} tokens（AC-036）`,
          ...(record === undefined ? {} : { ref: record.ref }),
          input: key,
        };
      });
      const others = evaluation.errors
        .filter((gap) => gap.input === undefined || !budgetGaps.includes(gap))
        .map(toContextError);
      return { ok: false, code: 'BUDGET_EXCEEDED', errors: [...budgetErrors, ...others], usage };
    }
    return {
      ok: false,
      code: evaluation.errors[0]?.code ?? 'MISSING_CONTEXT',
      errors: evaluation.errors.map(toContextError),
    };
  }

  // Step 7 — freeze what survived; nothing above this line leaves a snapshot.
  const scopeDigest = readScopeDigest(scope);
  const createdAt = now();
  const resolvedSources: ResolvedSource[] = included.map((source) => {
    const resolved: {
      ref: SourceRef;
      kind: ResolvedSource['kind'];
      id: string;
      hash: Hash;
      bytes: number;
      reason: string;
      path?: RepoPath;
      revision?: string;
      version?: string;
    } = {
      ref: source.ref,
      kind: source.source.kind,
      id: source.source.id,
      hash: source.hash,
      bytes: source.bytes,
      reason: source.reason,
    };
    if (source.path !== undefined) resolved.path = source.path;
    if (source.revision !== undefined) resolved.revision = source.revision;
    if (source.version !== undefined) resolved.version = source.version;
    return resolved;
  });
  const identity: Omit<ContextSnapshot, 'snapshotRef' | 'createdAt'> = {
    selection,
    resolvedSources,
    excluded,
    unknowns,
    policyHash,
    configHash: input.configHash,
    readScopeDigest: scopeDigest,
    tokenAccounting: {
      initial: { limit, used: consumed },
      expansion: { limit: selection.readBudget.expansionTokens, used: 0 },
    } satisfies TokenAccounting,
  };
  const snapshotRef = contextSnapshotRef(identity);
  let directory: ContextSnapshotDirectory;
  try {
    directory = input.snapshotWriter.write({
      snapshotRef,
      files: included.map((source) => ({
        address: source.hash,
        name: source.name,
        content: source.content,
        bytes: source.bytes,
      })),
      policyHash,
      configHash: input.configHash,
      selection,
      readScopeDigest: scopeDigest,
      createdAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      errors: [{ code: 'INTERNAL_ERROR', message: `冻结 ContextSnapshot 失败：${message}` }],
    };
  }
  const snapshot: ContextSnapshot = { snapshotRef, createdAt, ...identity };
  return { ok: true, snapshot, usage, directory: directory.directory };
}

/**
 * Builds the gathered form of a resolution the caller already obtained.
 *
 * Used for the gate-provided role contract, whose content is inline. `undefined`
 * means the resolution did not carry the inline body it promised.
 */
function gatherResolved(args: {
  readonly source: ContextSourceRef;
  readonly resolved: ResolvedSourceContent;
  readonly reason: string;
  readonly counter: TokenCounter;
}): GatheredSource | undefined {
  const { source, resolved, reason, counter } = args;
  if (resolved.fetch.kind !== 'none' || resolved.content === undefined) return undefined;
  return {
    ref: refFor(source, resolved),
    source,
    name: manifestName(source, resolved),
    reason,
    content: resolved.content,
    bytes: Buffer.byteLength(resolved.content, 'utf8'),
    hash: resolved.hash,
    tokens: counter(resolved.content),
    ...(resolved.path === undefined ? {} : { path: resolved.path }),
    ...(resolved.revision === undefined ? {} : { revision: resolved.revision }),
    ...(resolved.version === undefined ? {} : { version: resolved.version }),
  };
}

/**
 * Exposed so a caller can tell which logical input a source supplies, exactly as
 * the builder does when it checks the required-input table.
 */
export const inputKeyFor = inputKeyForSource;
