/**
 * `project.initialize` production wiring (WP-12 T5.3).
 *
 * `packages/workspace/src/initialize.ts` owns the initialization state machine but had
 * no production caller: `docs/architecture/ARCHITECTURE.md` §4 requires a real project
 * to be investigated (read-only), confirmed, then written as **candidate** documents
 * without touching any delivery ref, and `docs/product/requirements.md` §5/`context.md`
 * §4 fix the Ready gate. This module is the caller: it binds the state machine to the
 * project's real `dataDir` (durable state), the real `git` binary and the owning
 * project's own event stream.
 *
 * Two documented receipts are emitted here (`protocol.md` §7):
 * `initialization.progress` after every phase transition and `initialization.completed`
 * once the record is Ready. They go through a caller-supplied sink so they land in the
 * owning project's stream — never in an installation-level stream (WP-12 T5 Q9).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  createInitializer,
  createJsonFileInitStateStore,
  createNodeWorktreeGitPort,
  INIT_DELIVERY_BRANCH,
  investigateWorkspace,
  type InitBlocker,
  type InitOutcome,
  type InitPhase,
  type InitRecord,
  type InvestigationOutcome,
  type ScanBudget,
} from '@agentdev/workspace';

/** The budget `project.initialize` accepts (`protocol.md` §3: `{files,bytes}`). */
export interface InitializeBudget {
  readonly files?: number;
  readonly bytes?: number;
}

/** The caller's request, already validated by the protocol layer. */
export interface InitializeRequest {
  /** Stable idempotency/operation id; the durable record is keyed by it. */
  readonly operationId: string;
  readonly root: string;
  /** The real user action that authorized initialization (`protocol.md` §8). */
  readonly sourceMessageId: string;
  /** `new`/`legacy` is a **hint**; the root's real state is the authority (Q8). */
  readonly mode?: 'new' | 'legacy';
  readonly budget?: InitializeBudget;
  /**
   * Authorizes `git init` in a no-Git directory (Q8/Q9).
   *
   * Set by `project.create`/`project.clone` — whose explicit act it is — and by
   * `project.initialize` when the caller explicitly asked for `mode:'new'`. A plain
   * `initialize` never sets it, so a no-Git directory still surfaces the documented
   * authorization request (`AC-027`) instead of silently running `git init` over
   * content the user did not offer.
   */
  readonly authorizeGitInit?: boolean;
  /**
   * Confirms the observed facts as candidate documents.
   *
   * Set by every user-initiated initialization (`project.initialize` carries the real
   * user action in `sourceMessageId`, `protocol.md` §8). The confirmation only accepts
   * *observed* facts as `design=unconfirmed` candidates — it is not an approval of
   * behaviour, so it needs no second destructive-action confirmation (Q8).
   */
  readonly confirmObservedFacts?: boolean;
  readonly authorizationRef?: string;
}

export interface InitializeResult {
  /** `accepted` while running to Ready; `blocked`/`failed` carry the real reason. */
  readonly status: 'accepted' | 'blocked' | 'failed';
  readonly operationId: string;
  readonly phase: InitPhase | null;
  /** `true` when the record reached Ready in this call. */
  readonly done: boolean;
  readonly blocker: InitBlocker | null;
  readonly failure: { readonly kind: string; readonly message: string } | null;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  readonly record: InitRecord | null;
}

/** One emitted `initialization.progress`/`completed` payload (`protocol.md` §7). */
export interface InitializationEvent {
  readonly name: 'initialization.progress' | 'initialization.completed';
  readonly entityId: string;
  readonly data: {
    readonly operationId: string;
    readonly root: string;
    readonly phase: string;
    readonly status: string;
    readonly advanced: boolean;
    readonly done: boolean;
    readonly featureCount: number;
    readonly unknowns: number;
    readonly reads: number;
    readonly scanPartial: boolean;
    readonly blockerKind: string | null;
  };
}

export interface InitializeDriverOptions {
  /** The project's own state directory (`~/.agentdev/projects/<projectId>`). */
  readonly dataDir: string;
  readonly documentRoot: string;
  readonly branch?: string;
  readonly budget?: InitializeBudget;
  /** Where the documented events go; the owning project's stream. */
  readonly emit?: (event: InitializationEvent) => void;
  readonly now?: () => string;
}

/** A refused initialization: the caller's input cannot be applied to this root. */
export class InitializeRefused extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'InitializeRefused';
    this.code = code;
    this.details = details;
  }
}

/** `{files,bytes}` → the state machine's documented `ScanBudget` field names. */
export function scanBudgetOf(
  budget: InitializeBudget | undefined,
): Partial<ScanBudget> | undefined {
  if (budget === undefined) return undefined;
  const mapped: Partial<ScanBudget> = {
    ...(budget.files === undefined ? {} : { maxBodyFiles: budget.files }),
    ...(budget.bytes === undefined ? {} : { maxBodyBytes: budget.bytes }),
  };
  return Object.keys(mapped).length === 0 ? undefined : mapped;
}

/** How many entries a directory holds; a missing/unreadable path counts as `0`. */
function directoryEntryCount(root: string): number {
  try {
    return readdirSync(root).length;
  } catch {
    return 0;
  }
}

/**
 * Derives the initialization mode from the real root state (WP-12 T5 Q8).
 *
 * The mode is never asked of the user and never overrides the scan: a directory with
 * no Git and no content is `new`, anything else is `legacy`.
 */
export function deriveInitializeMode(input: {
  readonly hasGit: boolean;
  readonly entryCount: number;
}): 'new' | 'legacy' {
  return !input.hasGit && input.entryCount === 0 ? 'new' : 'legacy';
}

/** One drive of the machine: start (or resume) and step until terminal. */
export function runInitialize(
  options: InitializeDriverOptions,
  request: InitializeRequest,
): InitializeResult {
  const git = createNodeWorktreeGitPort();
  // `Q8`: the mode is derived from the real root state. A caller hint that asks for the
  // destructive `new` path over existing content is refused with the observed facts —
  // `ARCHITECTURE.md` §52 forbids automatic cleanup.
  const resolved = git.resolveRoot(request.root);
  const hasGit = resolved.ok && resolved.value !== null;
  const entryCount = directoryEntryCount(request.root);
  const derivedMode = deriveInitializeMode({ hasGit, entryCount });
  if (request.mode === 'new' && hasGit) {
    // Refused only when a repository already exists: `git init` over existing content
    // preserves it, but re-initializing a history the user already has would replace a
    // delivery basis (`ARCHITECTURE.md` §52 forbids that implicitly).
    throw new InitializeRefused(
      'INVALID_STATE',
      `${request.root} is already a Git repository; "new" initialization would replace its history`,
      { root: request.root, hasGit, entryCount, derivedMode },
    );
  }

  const initializer = createInitializer({
    store: createJsonFileInitStateStore(join(options.dataDir, 'initialization.json')),
    git,
    documentRoot: options.documentRoot,
    branch: options.branch ?? INIT_DELIVERY_BRANCH,
    ...(scanBudgetOf(options.budget ?? request.budget) === undefined
      ? {}
      : { budget: scanBudgetOf(options.budget ?? request.budget) as Partial<ScanBudget> }),
    ...(options.now === undefined ? {} : { now: options.now }),
    // Deliberately no `writeBatchSize`: with the state machine as shipped, a finite
    // batch never progresses past its first batch (documents already written are
    // counted again against the batch), so the drive would spin in Writing forever.
    // Registered as a T5 known gap; one step per phase is what the real path uses.
  });

  const emit = (outcome: InitOutcome): void => {
    if (outcome.status === 'not-found') return;
    const record = outcome.record;
    const done = record.status === 'ready';
    options.emit?.({
      name: done ? 'initialization.completed' : 'initialization.progress',
      entityId: record.id,
      data: {
        operationId: record.id,
        root: record.root,
        phase: record.phase,
        status: record.status,
        advanced: outcome.status === 'failed' ? false : outcome.ok && outcome.advanced,
        done,
        featureCount: record.featureCount,
        unknowns: record.unknowns.length,
        reads: record.reads.length,
        scanPartial: record.scanPartial,
        blockerKind: record.blocked?.kind ?? null,
      },
    });
  };

  let outcome: InitOutcome =
    initializer.get(request.operationId) === null
      ? initializer.start({
          id: request.operationId,
          root: request.root,
          documentRoot: options.documentRoot,
          branch: options.branch ?? INIT_DELIVERY_BRANCH,
        })
      : initializer.step(request.operationId);
  emit(outcome);

  // Bounded: every iteration must make progress. A blocker `create`/`clone` may
  // resolve (Git initialization, observed-facts confirmation) is resolved on the next
  // turn; anything else returns the identical outcome and stops the loop, so a machine
  // that cannot progress is reported rather than spun.
  for (let index = 0; index < 16; index += 1) {
    if (outcome.status === 'not-found') break;
    if (outcome.record.status === 'ready') break;
    const next = advance(initializer, outcome, request);
    if (next === outcome) break;
    outcome = next;
    emit(outcome);
  }

  if (outcome.status === 'not-found') {
    throw new InitializeRefused(
      'NOT_FOUND',
      `initialization ${request.operationId} does not exist`,
      {
        operationId: request.operationId,
      },
    );
  }
  const record = outcome.record;
  const errors: readonly { readonly code: string; readonly message: string }[] = outcome.ok
    ? []
    : outcome.errors.map((error) => ({ code: error.code, message: error.message }));
  return {
    status: outcome.ok ? 'accepted' : outcome.status === 'blocked' ? 'blocked' : 'failed',
    operationId: request.operationId,
    phase: outcome.phase,
    done: record?.status === 'ready',
    blocker: !outcome.ok && outcome.status === 'blocked' ? outcome.blocker : null,
    failure:
      !outcome.ok && outcome.status === 'failed'
        ? { kind: outcome.failure.kind, message: outcome.failure.message }
        : null,
    errors,
    record,
  };
}

/**
 * Advances once, resolving only the blockers an explicit create/clone act may resolve:
 * the Git-initialization authorization and the observed-facts confirmation. Every other
 * blocker is returned to the caller unchanged.
 */
function advance(
  initializer: ReturnType<typeof createInitializer>,
  outcome: InitOutcome,
  request: InitializeRequest,
): InitOutcome {
  if (outcome.status === 'not-found') return outcome;
  const blocker = outcome.record.blocked;
  if (blocker !== null) {
    const authorizationRef =
      request.authorizationRef ?? `project.create:${request.sourceMessageId}`;
    if (blocker.kind === 'git-initialization' && request.authorizeGitInit === true) {
      return initializer.authorizeGitInitialization(request.operationId, {
        authorizationRef,
        request: blocker.request,
      });
    }
    if (blocker.kind === 'confirmation-required' && request.confirmObservedFacts === true) {
      // The explicit create/clone act confirms the *observed facts*; the documents stay
      // `design=unconfirmed` (`ARCHITECTURE.md` §52).
      return initializer.confirm(request.operationId, {
        authorizationRef,
        by: 'user',
        note: 'the user-initiated initialization confirms the observed-fact candidates',
      });
    }
    // A blocker the caller has to resolve: report it unchanged so the drive stops.
    return outcome;
  }
  if (!outcome.ok) return outcome;
  return initializer.step(request.operationId);
}

/**
 * Read-only investigation for one project (`ARCHITECTURE.md` §4).
 *
 * This is the documented allowance that keeps working in every state — no Git, dirty
 * workspace, blocked, failed — and it never writes a file (AC-026/AC-027).
 */
export function investigateProject(options: {
  readonly root: string;
  readonly documentRoot: string;
  readonly budget?: InitializeBudget;
}): InvestigationOutcome {
  const budget = scanBudgetOf(options.budget);
  return investigateWorkspace({
    root: options.root,
    git: createNodeWorktreeGitPort(),
    documentRoot: options.documentRoot,
    ...(budget === undefined ? {} : { budget }),
  });
}
