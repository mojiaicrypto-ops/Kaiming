/**
 * The tool bridge's read ledger: who read what, in which Attempt, and the seal a stage
 * result is bound to (`docs/delivery/acceptance.md` AC-085).
 *
 * `docs/rules/agents.md` §4 makes `readLedgerSeq`/`readLedgerHash` **required** members of
 * every stage result, and `reliability.md` §2 makes the binding the evidence that a
 * delivery was verified against the material it claims to have read. Before this module the
 * two values had no source at all: `stage.ts` stored whatever an Attempt sent, and a real
 * model's `stage_yield` had nothing to send — T2's live drill stopped at exactly that point.
 *
 * The authority is deliberately split the way the coordinator fixed it:
 *
 * - **Core records** every evidence read that happens through the tool bridge, in this
 *   process, in occurrence order. The entry is the one `core/context/ledger.ts` already
 *   defines (`seq`, `path`, `revision`, `hash`, `reason`, `bytes`, `tokens`, `at`), so the
 *   read ledger used by the context builder and the one behind `tool.execute` are the same
 *   ledger, not two.
 * - **Core recomputes** the binding and compares it with what the Runner reported
 *   (`verify`). A mismatch is refused, never repaired.
 * - **The Runner only reports**: every `tool.execute` answer carries the Attempt's current
 *   binding, the Runner remembers the last one it saw, and `stage_yield` injects it. The
 *   model never supplies either value.
 *
 * ## The exact binding
 *
 * `seq` is the number of appended entries; `hash` is `readLedgerSealHash(entries)` —
 * the accumulator `context/ledger.ts` already implements and tests
 * ("agentdev.read-ledger.seal.v1" genesis, then one SHA-256 per entry over
 * `{prev, seq, path, revision, hash, reason, bytes}` in occurrence order). An Attempt that
 * read nothing therefore reports the **derived** empty binding
 * `{seq: 0, hash: readLedgerSealHash([])}`; a placeholder such as zeroes is refused, which
 * is why `verify` compares the empty case too.
 */
import { CONTEXT_LIMITS, type Hash, type Role, type Time } from '@agentdev/contracts';
import { canonicalJson } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';
import {
  createReadLedger,
  readLedgerSealHash,
  type ReadLedger,
  type ReadLedgerEntry,
} from './context/ledger.js';
import { canRead, scopeFor } from './context/acl.js';
import { ARTIFACT_ROOT, type ContextStage } from './context/types.js';

/** The `(seq, hash)` pair `stage_result` is bound to (`AC-085`). */
export interface ReadLedgerBinding {
  readonly seq: number;
  readonly hash: Hash;
}

/** The documented empty binding: nothing read, so the genesis seal. */
export function emptyReadLedgerBinding(): ReadLedgerBinding {
  return { seq: 0, hash: readLedgerSealHash([]) };
}

/** Feature navigation is shared knowledge rather than plain source (`execution.md` §3). */
const FEATURE_ROOT = 'features';

/**
 * The source kind one bridge path has, mirroring `context/ledger.ts` `sourceForPath`.
 *
 * The ledger classifies an `artifacts/…` path as an `artifact` (and then checks the class
 * against the stage) and a `features/…` path as `knowledge`; every other path is `git`.
 * Admission must use the same classification or a path could pass the pre-check and be
 * refused by the append it was admitted for.
 */
function bridgeSourceKind(path: string): 'git' | 'knowledge' | 'artifact' {
  const inside = (root: string): boolean => path === root || path.startsWith(`${root}/`);
  if (inside(ARTIFACT_ROOT)) return 'artifact';
  if (inside(FEATURE_ROOT)) return 'knowledge';
  return 'git';
}

export interface EnsureReadLedgerInput {
  readonly attemptId: string;
  readonly runId: string;
  readonly role: Role;
  readonly stage: string;
  /** The revision appended reads are attributed to (`work.baseRevision`). */
  readonly revision?: string;
}

/** What one recorded read produced, or why it could not be recorded. */
export type RecordReadResult =
  | { readonly ok: true; readonly entry: ReadLedgerEntry }
  | {
      readonly ok: false;
      readonly code: 'MISSING_CONTEXT' | 'VALIDATION_ERROR';
      readonly message: string;
    };

/**
 * The Attempt-scoped read ledgers of one project.
 *
 * In-process runtime state, like `ToolProcessRegistry`: a daemon restart loses the
 * in-memory ledgers, and the durable half of the same story is the `stage_result` row the
 * seal was accepted for (`reliability.md` §2). An Attempt whose ledger could not be opened
 * is marked **degraded**, and `verify` then refuses to certify it rather than accepting an
 * unverifiable binding.
 */
export class ReadLedgerRegistry {
  private readonly store: ProjectStore;
  private readonly ledgers = new Map<string, ReadLedger>();
  private readonly degraded = new Map<string, string>();
  private readonly now: (() => Time) | undefined;

  constructor(options: { readonly store: ProjectStore; readonly now?: () => Time }) {
    this.store = options.store;
    this.now = options.now;
  }

  /**
   * The Attempt's ledger, created on first use.
   *
   * The read scope is the Run's own ACL row (`acl.scopeFor`), so a read the Ledger admits
   * is exactly a read `rules/agents.md` §2 allows for that role and stage. A Run whose
   * `(role, stage)` has no ACL row (or whose stage is not a canonical context stage) is
   * marked degraded and reports why.
   */
  ensure(
    input: EnsureReadLedgerInput,
  ): { readonly ok: true } | { readonly ok: false; readonly message: string } {
    const existing = this.ledgers.get(input.attemptId);
    if (existing !== undefined) return { ok: true };
    const degraded = this.degraded.get(input.attemptId);
    if (degraded !== undefined) return { ok: false, message: degraded };

    const run = this.store.runs.find(input.runId);
    const work = run === undefined ? undefined : this.store.works.find(run.workId);
    if (run === undefined || work === undefined) {
      return this.markDegraded(input.attemptId, `Run ${input.runId} or its Work is missing`);
    }
    const project = this.store.projects.find(work.projectId);
    if (project === undefined) {
      return this.markDegraded(input.attemptId, `Project ${work.projectId} is not open`);
    }
    // The Run's own stage: an unrecognised spelling finds no ACL row and the Attempt is
    // marked degraded (fail-closed) rather than being mapped to a guessed stage.
    const stage = input.stage as ContextStage;
    const scope = scopeFor(input.role, stage, {
      projectId: project.id,
      codeRoot: project.codeRoot,
      documentRoot: project.documentRoot,
      deliveryBranch: project.deliveryBranch,
      workId: work.id,
    });
    if (scope === null) {
      return this.markDegraded(
        input.attemptId,
        `${input.role} may not read at stage ${input.stage}; no ACL row exists`,
      );
    }
    const created = createReadLedger({
      runId: run.id,
      role: input.role,
      stage,
      scope,
      budget: {
        initialTokens: CONTEXT_LIMITS.startupTokens,
        expansionTokens: CONTEXT_LIMITS.expansionTokens,
      },
      ...(input.revision === undefined ? {} : { revision: input.revision }),
      ...(this.now === undefined ? {} : { now: this.now }),
    });
    if (!created.ok) {
      return this.markDegraded(
        input.attemptId,
        `the read ledger could not be opened: ${created.errors.map((error) => error.message).join('; ')}`,
      );
    }
    this.ledgers.set(input.attemptId, created.ledger);
    return { ok: true };
  }

  private markDegraded(
    attemptId: string,
    message: string,
  ): { readonly ok: false; readonly message: string } {
    this.degraded.set(attemptId, message);
    return { ok: false, message };
  }

  /**
   * Marks an Attempt's ledger unverifiable because a read that really happened could not be
   * recorded.
   *
   * The **Broker** admits a read the Work's authorization covers (`protocol.md` §4) while
   * the ledger admits a read the Run's frozen `(role, stage)` scope covers (`context.md`
   * §1) — two different questions, and a path can pass the first and fail the second. The
   * read then entered the model's context while the ledger cannot name it, and a stage
   * result reporting the current binding would assert "these are the reads this delivery
   * was verified against" over a ledger Core knows to be incomplete. Logging that and
   * accepting the stage anyway (the T3b vertical drill produced exactly this) turns `AC-085`
   * into a claim Core cannot confirm, so the Attempt is marked unverifiable and `verify`
   * then refuses **every** binding of it — the same fail-closed answer as a ledger that
   * could not be opened at all.
   */
  markUnverifiable(attemptId: string, message: string): void {
    this.markDegraded(attemptId, message);
  }

  /** Whether the Attempt's ledger could not be opened, and why. */
  degradedReason(attemptId: string): string | undefined {
    return this.degraded.get(attemptId);
  }

  /**
   * Whether one bridge read is inside the Attempt's frozen `readScope` (`context.md` §1).
   *
   * "追加读取只能在readScope内 … 需要读更广范围由context.request返回Chief处理，授权未完成
   * 不读取": a read the scope does not cover must be refused **before** it produces any
   * content, and the wider need travels to Chief as `context.request` — it is never taken
   * and merely logged. The same path rule the ledger applies when it appends is applied
   * here (`context/acl.ts` `canRead`), so admission and the ledger cannot disagree: a call
   * this admits is a call `record` will accept.
   *
   * The return value carries the documented code, so the caller refuses with
   * `CONTEXT_FORBIDDEN` (Chief handles it, `protocol.md` §7) or `MISSING_CONTEXT` when the
   * Run has no readable scope at all.
   */
  admitsPath(input: EnsureReadLedgerInput & { readonly path: string }):
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly code: 'CONTEXT_FORBIDDEN' | 'MISSING_CONTEXT';
        readonly message: string;
      } {
    const ready = this.ensure(input);
    if (!ready.ok) return { ok: false, code: 'MISSING_CONTEXT', message: ready.message };
    const ledger = this.ledgers.get(input.attemptId);
    if (ledger === undefined) {
      return {
        ok: false,
        code: 'MISSING_CONTEXT',
        message: `Attempt ${input.attemptId} has no read ledger`,
      };
    }
    const scope = ledger.readScope();
    const decision = canRead(
      input.role,
      input.stage as ContextStage,
      {
        kind: bridgeSourceKind(input.path),
        id: input.path,
        version: input.revision ?? 'working-tree',
        path: input.path,
        projectId: scope.projectId,
      },
      scope,
      { runId: input.runId, projectId: scope.projectId },
    );
    if (decision.allowed) return { ok: true };
    return { ok: false, code: 'CONTEXT_FORBIDDEN', message: decision.message };
  }

  /**
   * Appends one evidence read.
   *
   * `content` is what the model actually received (the file body, or the tool's result
   * payload for a directory search), so the entry's `hash` is the identity of the evidence
   * that entered the context. A repeated read appends a second entry: the ledger is
   * append-only on purpose ("a read that happened is history").
   */
  record(input: {
    readonly attemptId: string;
    readonly runId: string;
    readonly role: Role;
    readonly stage: string;
    readonly revision?: string;
    readonly path: string;
    readonly reason: string;
    readonly content: string;
  }): RecordReadResult {
    const ready = this.ensure(input);
    if (!ready.ok) return { ok: false, code: 'MISSING_CONTEXT', message: ready.message };
    const ledger = this.ledgers.get(input.attemptId);
    if (ledger === undefined) {
      return {
        ok: false,
        code: 'MISSING_CONTEXT',
        message: `Attempt ${input.attemptId} has no read ledger`,
      };
    }
    const appended = ledger.append({
      path: input.path,
      reason: input.reason,
      content: input.content,
      ...(input.revision === undefined ? {} : { revision: input.revision }),
    });
    if (!appended.ok) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: appended.errors.map((error) => error.message).join('; '),
      };
    }
    const entry = ledger.entries()[appended.seq - 1];
    if (entry === undefined) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `read ledger entry ${String(appended.seq)} is missing after append`,
      };
    }
    return { ok: true, entry };
  }

  /**
   * Records a reasoned request for evidence the Run's scope does not cover (`AC-032`).
   *
   * "越权…有可核对记录": the refusal is not merely a `tool.refused` event, it is an entry in
   * the same ledger the stage seal commits to, so a delivery cannot hide that it was
   * refused material it asked for.
   */
  recordOutOfScope(input: {
    readonly attemptId: string;
    readonly runId: string;
    readonly role: Role;
    readonly stage: string;
    readonly revision?: string;
    readonly path: string;
    readonly reason: string;
  }): { readonly ok: boolean; readonly message?: string } {
    const ready = this.ensure(input);
    if (!ready.ok) return { ok: false, message: ready.message };
    const ledger = this.ledgers.get(input.attemptId);
    if (ledger === undefined) return { ok: false, message: 'no read ledger' };
    const recorded = ledger.requestExpansion({
      request: {
        ref: {
          kind: 'artifact',
          id: input.path,
          version: input.revision ?? 'working-tree',
        },
        reason: input.reason,
        requestedBy: input.role,
      },
    });
    if (recorded.ok) return { ok: true };
    return {
      ok: false,
      ...(recorded.errors[0]?.message === undefined ? {} : { message: recorded.errors[0].message }),
    };
  }

  /** The Attempt's current binding: `{seq, hash}` over everything appended so far. */
  binding(attemptId: string): ReadLedgerBinding {
    const ledger = this.ledgers.get(attemptId);
    if (ledger === undefined) return emptyReadLedgerBinding();
    const entries = ledger.entries();
    return { seq: entries.length, hash: readLedgerSealHash(entries) };
  }

  /**
   * Commits the ledger's seal; afterwards no further read is admitted.
   *
   * Called when a stage result whose binding matched is accepted, so a read that happens
   * after delivery cannot change what the delivery was sealed against (`AC-085`).
   */
  seal(attemptId: string): ReadLedgerBinding {
    const ledger = this.ledgers.get(attemptId);
    if (ledger === undefined) return emptyReadLedgerBinding();
    const sealed = ledger.seal();
    return sealed.ok ? { seq: sealed.seq, hash: sealed.hash } : this.binding(attemptId);
  }

  /** Checks a reported binding against the ledger, without repairing it. */
  verify(input: { readonly attemptId: string; readonly seq: number; readonly hash: Hash }):
    | { readonly ok: true; readonly binding: ReadLedgerBinding }
    | {
        readonly ok: false;
        readonly code: 'STALE_ARTIFACT' | 'VALIDATION_ERROR' | 'MISSING_CONTEXT';
        readonly message: string;
      } {
    const degraded = this.degraded.get(input.attemptId);
    if (degraded !== undefined) {
      return {
        ok: false,
        code: 'MISSING_CONTEXT',
        message: `Attempt ${input.attemptId} has no verifiable read ledger: ${degraded}`,
      };
    }
    const binding = this.binding(input.attemptId);
    if (!Number.isInteger(input.seq) || input.seq < 0) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `read ledger seq must be a non-negative integer, got ${String(input.seq)}`,
      };
    }
    if (input.seq > binding.seq) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `the stage result claims ${String(input.seq)} reads but the ledger has ${String(binding.seq)} (AC-085)`,
      };
    }
    if (input.seq < binding.seq) {
      return {
        ok: false,
        code: 'STALE_ARTIFACT',
        message: `the stage result is bound to read ${String(input.seq)} but the ledger ends at ${String(binding.seq)} (AC-085)`,
      };
    }
    if (input.hash !== binding.hash) {
      return {
        ok: false,
        code: 'STALE_ARTIFACT',
        message: `the stage result's read ledger hash ${input.hash} is not the ledger's seal ${binding.hash} (AC-085)`,
      };
    }
    return { ok: true, binding };
  }

  /** The entries one Attempt appended, for diagnostics and tests. */
  entries(attemptId: string): readonly ReadLedgerEntry[] {
    return this.ledgers.get(attemptId)?.entries() ?? [];
  }

  /** Forgets an Attempt's ledger when the Attempt ends (`reliability.md` §2). */
  release(attemptId: string): void {
    this.ledgers.delete(attemptId);
    this.degraded.delete(attemptId);
  }

  /** Attempts with a live ledger (diagnostics and tests). */
  size(): number {
    return this.ledgers.size;
  }

  /** The JSON payload the seal commits to, for tests that recompute independently. */
  static sealInputOf(entry: ReadLedgerEntry): string {
    return canonicalJson({
      seq: entry.seq,
      path: entry.path,
      revision: entry.revision,
      hash: entry.hash,
      reason: entry.reason,
      bytes: entry.bytes,
    });
  }
}
