/**
 * The workbench protocol surface: HTTP `/rpc`, the `/ws` event stream and the
 * commands/queries `protocol.md` defines for the browser.
 *
 * `docs/architecture/protocol.md` §1/§2/§5/§7 is the contract this module
 * implements. It owns three things and no business state:
 *
 * - envelope handling (`{v,type,id,method,projectId?,params}` in, one terminal
 *   response out) plus the HTTP status mapping of the error table;
 * - the read queries the nine workbench pages need, every one of them answered
 *   from the real `ProjectStore`/`EventHub`/services passed in — no mock state and
 *   no invented success;
 * - the WebSocket upgrade (Origin + cookie/credential), `connection.hello`, the
 *   subscription lifecycle with an `afterCursor` watermark and the live event
 *   stream.
 *
 * The transport is Node's built-in HTTP upgrade plus a minimal RFC6455 frame codec
 * in this repository: the dependency policy forbids adding `ws`, and the documented
 * protocol only needs text frames.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  DEFAULT_PAGE_LIMIT,
  LIMITS,
  MAX_PAGE_LIMIT,
  PROTOCOL_LIMITS,
  ROLES,
  contextSelectionSchema,
  errorCodeSchema,
  type ContextSelection,
  type ErrorCode,
  type FindingSeverity,
  type JsonObject,
  type JsonValue,
  type Plan,
  type PortableRequirement,
  type ProviderInput,
  type ProjectSummary,
  type Ref,
  type Requirement,
  type Role,
  type Scope,
  type SourceRef,
} from '@agentdev/contracts';
import {
  CHIEF_RULES_PATH,
  ProtocolError,
  ROLE_STAGES,
  RunLifecycle,
  backupProject,
  buildContext,
  isValidSecretRef,
  createNodeBackupGitPort,
  defaultBaseRevisionReader,
  assertPlanWithinAuthority,
  deliveryRoute,
  developStageFor,
  nextDeliveryStage,
  parseDeliveredPlanDocument,
  readRequirementPoolAtRevision,
  RequirementProjection,
  REQUIREMENT_CONTENT_FILE_NAME,
  SENSITIVE_FILE_TODO_KIND,
  restoreProject,
  sendMessage,
  userIdFromSubject,
  type BackupGitPort,
  type ConfigStore,
  type DecisionService,
  type L3ConfirmationService,
  type DownloadTokenStore,
  type EventHub,
  type FindingService,
  type PlanDraft,
  type PlanGateService,
  type RequirementContinuation,
  type RequirementSaveService,
  newAttemptAdmission,
  redact,
  type ArtifactService,
  type AttachmentService,
  type ContentFetchPort,
  type ContextGatesPort,
  type ContextInputKey,
  type ContextSourceRef,
  type ContextStage,
  type ModelGateway,
  type ProjectScope,
  type SnapshotWriterPort,
  type SourceResolutionResult,
  type SourceResolverPort,
  type Orchestrator,
  type SecretAudience,
  type SecretRepository,
  type SecretStore,
} from '@agentdev/core';
import {
  uuidv7,
  withTransaction,
  type BlobStore,
  type Event,
  type ProjectStore,
} from '@agentdev/storage';
import { createNodeWorktreeGitPort } from '@agentdev/workspace';
import type { ProjectDirectoryPort, ProjectEntry } from '@agentdev/web';

/** One authenticated caller, as the daemon resolved it from cookie or credential. */
export interface WorkbenchCaller {
  /** Audit subject: the session id or the installation credential. */
  readonly subject: string;
  /** Ownership identity for uploads and messages (single-user installation). */
  readonly userId: string;
  /** Role this connection reads artifacts as. */
  readonly role: Role;
}

/** The audit subject of a Bearer installation-credential caller (`protocol.md` §2). */
const INSTALLATION_SUBJECT = 'installation:local';

/**
 * Tokens the Chief's assessment Run is allocated from the Work budget.
 *
 * A routing assessment reads a bounded context and answers with a `DispatchSpec`, so it
 * never needs the whole Work budget; the rest stays available for the professional Runs the
 * Chief dispatches (`rules/agents.md` §6).
 */
const CHIEF_ASSESSMENT_TOKENS = 32_000;

/**
 * The Chief hold for a *coordinating* Run (`workflow.md` §3 L2/L3 route).
 *
 * A delivery Chief Run parents every stage of the route, and `orchestrator.effectiveBudget`
 * caps each child by the parent's *unallocated* hold (`allocated + requested <=
 * parent.budgetAllocation`). A one-turn 32k hold stopped an L2 delivery at its first stage;
 * reserving the whole Work (`available`) was the opposite mistake. This value funds a Plan,
 * a Develop, an independent Review, a Test and a Settlement Run in sequence, while the Work's
 * own `LIMITS.workInputOutputTokens` stays the authority and each stage's own request stays a
 * request (`STAGE_ROUTE_TOKENS`).
 */
const CHIEF_ROUTE_TOKENS = 120_000;

/**
 * What one continuation stage Run asks the Chief hold for (`protocol.continueDeliveryRoute`).
 *
 * Small enough that several stages can be reserved inside `CHIEF_ROUTE_TOKENS` while a
 * sibling is still live, large enough for a real planning/develop/review/test/settlement
 * turn. A stage the *Chief itself* dispatches keeps the model's own number: this is the
 * Core-queued continuation's request, not a new cap on the Chief.
 */
const STAGE_ROUTE_TOKENS = 20_000;

/**
 * Run statuses that are terminal (`workflow.md` §5.3).
 *
 * Restated here because the protocol layer only needs "is this Run still live" for the route
 * projection, and importing the whole lifecycle service for one predicate would hide that.
 */
const TERMINAL_RUN_STATUSES: readonly string[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'contract_violation',
];

/** Everything the protocol layer reads or writes; all of it is real Core. */
export interface WorkbenchServices {
  readonly store: ProjectStore;
  readonly blobs: BlobStore;
  readonly events: EventHub;
  readonly attachments: AttachmentService;
  readonly artifacts: ArtifactService;
  readonly tokens: DownloadTokenStore;
  readonly version: string;
  /** Optional real services; a missing one refuses its method instead of guessing. */
  readonly config?: ConfigStore;
  readonly gates?: PlanGateService;
  readonly decisions?: DecisionService;
  /**
   * The explicit L3 confirmation interaction (AC-011).
   *
   * Attached with the orchestrator (`attachOrchestrator`), because the routing
   * assessment is what raises the question and the dispatch guard is what holds the
   * route. `decision.resolve` reads it here so an L3 confirmation is answered through
   * the documented entry point instead of the product-behaviour branch, and the Inbox
   * names the risk flags the routing actually produced.
   */
  confirmations?: L3ConfirmationService;
  readonly findings?: FindingService;
  readonly requirements?: RequirementContinuation;
  readonly requirementSaves?: RequirementSaveService;
  /**
   * The durable credential repository and the in-memory store it feeds (WP-12 T1.1).
   *
   * `secret.set`/`secret.delete` write the repository and update the store so a running
   * daemon resolves the new credential without a restart; `config.get` reports
   * `secretConfigured` from the store, so "configured" means "registered", not
   * "a `secretRef` string exists". A missing pair refuses the secret methods instead of
   * inventing a success, like every other optional service here.
   */
  readonly secretRepository?: SecretRepository;
  readonly secrets?: SecretStore;
  /**
   * The project's Chief orchestrator (WP-12 T2.1).
   *
   * Attached by the daemon once the execution stack exists, like `runRecovery`: a method
   * that needs it refuses clearly when it is absent instead of pretending the Run exists.
   */
  orchestrator?: Orchestrator;
  /**
   * The project's model gateway, for the live `provider.test` probe (`protocol.md` §5).
   *
   * Also attached late, because the gateway is built with the execution stack.
   */
  gateway?: ModelGateway;
  /**
   * Reads a Requirement record's committed files at a revision.
   *
   * The local projection row does not carry `scope`, `acceptance`, the open
   * questions, the confirmed decisions or the feature ids — they live in the
   * portable `requirement.json` (`data.md` §2). An update or a cancellation must
   * therefore read the record back before rewriting it, or it silently resets the
   * fields the caller did not name (W9R2-02/W9R2-03). The daemon's default port
   * reads with the real `git` binary; a caller may inject its own.
   */
  readonly requirementRecords?: RequirementRecordPort;
  /**
   * Resolves the branch/commit/unpushed facts a requirement read surface reports
   * (`AC-090`). Defaults to a real `git`-backed port, like `requirementRecords`.
   */
  readonly requirementGit?: RequirementGitFactsPort;
  /**
   * Reads a revision's committed requirement pool (`requirement.import`). Defaults
   * to a real `git`-backed reader over `readRequirementPoolAtRevision`.
   */
  readonly requirementPool?: RequirementPoolReadPort;
  /**
   * Reads Git revisions for `file.list`/`file.read`; defaults to a real `git` port.
   */
  readonly workspaceFiles?: WorkspaceFilePort;
  /**
   * The shipped optional-extension whitelist (`protocol.md` §5). Defaults to the
   * release's built-in list, which is empty this release; a caller may inject one.
   */
  readonly extensions?: readonly ExtensionSpec[];
  /** Backup/restore port; defaults to the real `git`-backed implementation. */
  readonly backupGit?: BackupGitPort;
  /**
   * The executor's recovery actions (WP11) — set by the daemon bootstrap once the
   * supervisor exists. Without it a `recovery_required` Run has no product action at all
   * (`WP11R4-02`).
   */
  runRecovery?: RunRecoveryPort;
  /**
   * The tool bridge's permission chain and cancel cleanup (WP-12 T3).
   *
   * Attached late by the daemon, like `runRecovery`: the Grant service and the Broker are
   * built with the execution stack. A method that needs it refuses with
   * `PROVIDER_UNAVAILABLE` when it is absent, so a daemon whose tool bridge is not wired
   * never answers a permission request it cannot honour.
   */
  toolBridge?: ToolBridgePort;
  /**
   * The installation-level project directory (WP-12 T5).
   *
   * Attached by the host like `orchestrator`: the directory owns the registry, the
   * per-root locks and the open instances, so `project.*` commands delegate to it
   * instead of inventing a second runtime inside one project's daemon
   * (`ARCHITECTURE.md` §4: one `ProjectRuntime` per Git root). Without it the
   * lifecycle commands refuse with `INVALID_STATE` rather than fabricating a success.
   */
  projectDirectory?: ProjectDirectoryPort;
  readonly now?: () => number;
  /** Diagnostic sink for background work (the `provider.test` probe). */
  readonly log?: (line: string) => void;
}

/**
 * The tool bridge as the workbench protocol needs it (`protocol.md` §4 `permission.*`).
 *
 * `permission.request` records a pending user decision for one environment operation and
 * parks the Run; `permission.respond` applies the user's answer, mints the bound Grant and
 * emits `permission.resolved`. `cleanupRun` reaps a cancelled Run's tool processes and
 * Grants. All three are implemented by `ToolGrantService` + the execution stack, so the
 * protocol layer contributes only parameter validation and the caller's identity.
 */
export interface ToolBridgePort {
  requestPermission(input: {
    readonly workId: string;
    readonly runId: string;
    readonly role: Role;
    readonly stage: string;
    readonly operation: string;
    readonly targets: readonly string[];
    readonly toolOperationId: string;
    readonly inputHash: string;
    readonly scope?: 'once' | 'run';
    readonly expiresAt: string;
    readonly limits?: Readonly<Record<string, unknown>>;
  }): {
    readonly decisionId: string;
    readonly version: number;
    readonly state: string;
    readonly blockerAttached: boolean;
    readonly runStatus?: string;
  };
  respondPermission(input: {
    readonly decisionId: string;
    readonly choice: 'approve' | 'deny';
    readonly operation: string;
    readonly runId: string;
    readonly role: Role;
    readonly stage: string;
    readonly targets: readonly string[];
    readonly toolOperationId: string;
    readonly inputHash: string;
    readonly expiresAt: string;
    readonly scope?: 'once' | 'run';
    readonly limits?: Readonly<Record<string, unknown>>;
    /**
     * The user's denial reason (`protocol.md` §4 `permission.respond` optional
     * `reason`). Recorded on the durable `permission.resolved` event so a refusal is
     * auditable; an approval carries none.
     */
    readonly reason?: string;
  }): {
    readonly decisionId: string;
    readonly version: number;
    readonly state: string;
    readonly blockerAttached: boolean;
    readonly grantId?: string;
    readonly runStatus?: string;
  };
  cleanupRun(runId: string): { readonly killed: number; readonly revoked: number };
}

/** The executor's Run-recovery actions, as the workbench protocol needs them. */
export interface RunRecoveryPort {
  /** Records the operator's resume decision after a park; refuses while unsafe. */
  recordResumeDecision(input: { readonly runId: string; readonly sourceMessageId?: string }): {
    readonly ok: boolean;
    readonly code?: string;
    readonly message?: string;
  };
  /** Opens the next Attempt for a parked Run whose admission allows it. */
  resumeParkedRun(runId: string): {
    readonly ok: boolean;
    readonly code?: string;
    readonly message?: string;
  };
}

/** One Requirement record file's committed content at a Git revision. */
export interface RequirementRecordPort {
  /** The blob's text, or `null` when the revision or the path does not exist. */
  read(repoRoot: string, revision: string, path: string): string | null;
}

/**
 * The Git-side facts a requirement read surface reports (AC-090).
 *
 * `requirements.md` §3 and `reliability.md` §87 require the UI to show the branch and
 * revision a record lives on plus its synchronisation state with the remote. Those are
 * Git facts, not projection fields, so the daemon resolves them through the same real
 * `git` binary the rest of the deployment uses (the `WorktreeGitPort` subset below);
 * a caller may inject another port.
 */
export interface RequirementGitFactsPort {
  /** `git rev-parse --verify <revision>^{commit}`; `null` when the revision is unknown. */
  resolveRevision(
    repoRoot: string,
    revision: string,
  ): { readonly ok: true; readonly value: string | null } | { readonly ok: false };
  /** `git merge-base --is-ancestor <ancestor> <descendant>`. */
  isAncestor(
    repoRoot: string,
    ancestor: string,
    descendant: string,
  ): { readonly ok: true; readonly value: boolean } | { readonly ok: false };
}

/**
 * Reads one revision's committed requirement pool (`protocol.md` §4
 * `requirement.import`, §8 conflict removal).
 *
 * The pool reader itself lives in Core (`readRequirementPoolAtRevision`); this port
 * keeps the daemon's protocol layer free of Git plumbing and lets a test inject its
 * own reader. The daemon's default reads with the real `git` binary.
 */
export interface RequirementPoolReadPort {
  read(
    repoRoot: string,
    revision: string,
  ): {
    readonly records: readonly {
      readonly id: string;
      readonly recordPath: string;
      readonly metadataJson: string;
      readonly contentMarkdown: string;
      readonly recordHash: string;
    }[];
    readonly conflicts: readonly {
      readonly recordPath: string;
      readonly reason: string;
      readonly message: string;
    }[];
  };
}

/**
 * Reads one Git revision's tree and blobs for `file.list`/`file.read`
 * (`protocol.md` §5).
 *
 * A revision-addressed read is the only honest one: a working tree can be stale, so
 * the port resolves blobs at the named revision through the real `git` binary. A
 * missing revision/path answers `null`, which the caller reports as `NOT_FOUND`.
 */
export interface WorkspaceFilePort {
  list(
    repoRoot: string,
    revision: string,
    path: string,
  ):
    | readonly {
        readonly name: string;
        readonly path: string;
        readonly type: 'blob' | 'tree';
        readonly bytes: number | null;
      }[]
    | null;
  read(repoRoot: string, revision: string, path: string): { readonly content: Buffer } | null;
}

/** One entry of the built-in extension whitelist (`protocol.md` §5). */
export interface ExtensionSpec {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly capabilities: readonly string[];
  readonly critical: boolean;
  readonly enabledByDefault: boolean;
}

/** The upgrade decision for one WebSocket request. */
export interface UpgradeDecision {
  readonly ok: boolean;
  readonly caller?: WorkbenchCaller;
  readonly reason?: string;
}

/** The auth seam the daemon passes in, so the protocol never owns sessions. */
export interface WorkbenchAuthPort {
  readonly authenticate: (input: {
    readonly cookie?: string;
    readonly csrfToken?: string;
    readonly origin?: string;
    readonly isWrite: boolean;
  }) => {
    readonly ok: boolean;
    readonly status?: number;
    readonly code?: ErrorCode;
    readonly message?: string;
    readonly userId?: string;
    readonly subject?: string;
  };
  readonly cookieOf: (request: IncomingMessage) => string | undefined;
  readonly bearerOk: (header: string | undefined) => boolean;
}

/** A protocol-shaped HTTP failure with the status the error table implies. */
export class HttpFailure extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * The protocol error envelope's `details`.
   *
   * Typed as the shared JSON object so it passes straight through to
   * `ProtocolError`/`HttpFailure` without a re-shaping step (R-shape: the wire
   * shape is the contract's, not this module's).
   */
  readonly details: JsonObject;

  constructor(status: number, code: string, message: string, details: JsonObject = {}) {
    super(message);
    this.name = 'HttpFailure';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The HTTP status a protocol code maps onto (`protocol.md` §7). */
export function statusForCode(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
    case 'RESYNC_REQUIRED':
      return 404;
    case 'UNAUTHENTICATED':
    case 'AUTH_EXPIRED':
      return 401;
    case 'NOT_AUTHORIZED':
    case 'CONTEXT_FORBIDDEN':
      return 403;
    case 'VERSION_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'INVALID_STATE':
    case 'GATE_NOT_READY':
    case 'STALE_ARTIFACT':
    case 'RECOVERY_REQUIRED':
    case 'BUSY':
      return 409;
    case 'VALIDATION_ERROR':
    case 'MISSING_CONTEXT':
    case 'BUDGET_EXCEEDED':
    case 'ATTACHMENT_ALREADY_BOUND':
    case 'ARTIFACT_MISSING':
    case 'KNOWLEDGE_INVALID':
    case 'PROVIDER_UNAVAILABLE':
    case 'PROTOCOL_MISMATCH':
    case 'REQUIREMENT_CONFLICT':
    case 'REQUIREMENT_PATH_IGNORED':
    case 'LEGACY_REQUIREMENT_FORMAT':
      return 422;
    default:
      return 500;
  }
}

/**
 * Operations whose targets are real paths, so a Grant with no target authorizes nothing.
 *
 * `bash`/`git` carry a command rather than a path and legitimately record no targets
 * (`core/tools.ts` `planToolCall`), which is why they are absent here.
 */
const PATH_TARGET_OPERATIONS: readonly string[] = [
  'read',
  'search',
  'artifact_write',
  'edit',
  'write',
  'delete_data',
];

/**
 * Run states that never restart (`workflow.md` §5.3).
 *
 * A requirement with a Work whose Run is outside this set still has live execution,
 * so archiving it would hide work in flight.
 */
const TERMINAL_RUN_STATES: readonly string[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'contract_violation',
];

/**
 * Requirement lifecycle transitions (`workflow.md` §5.1).
 *
 * `restore` is deliberately absent: an archived record returns to the state it was
 * archived from, which is not a forward transition of this table and is handled by
 * `requirement.restore` itself.
 */
const REQUIREMENT_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  queued: ['active', 'archived', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: ['archived'],
  cancelled: [],
  archived: [],
};

/** Methods served without a Project scope (global configuration etc.). */
const GLOBAL_METHODS: readonly string[] = [
  'connection.hello',
  // `project.*` is installation-level by construction (WP-12 T5): the directory serves
  // the whole installation, so these carry no `projectId` requirement and a caller's
  // `projectId` is never compared against this daemon's own project
  // (`protocol.md` §1: "全局方法省略projectId").
  'projects',
  'project.list',
  'project.open',
  'project.create',
  'project.clone',
  'project.trust',
  'project.close',
  'project.initialize',
  'settings',
  'agents',
  'ui.translate',
  'config.get',
  'config.save',
  'config.test',
  'backup.run',
  'restore.run',
  'secret.set',
  'secret.delete',
  'secret.list',
  // Provider configuration is installation-level: `config.get` exposes providers only in
  // the global scope (`protocol.md` §5), so these two need no Project scope.
  'provider.upsert',
  'provider.test',
];

/** Methods that change state and therefore accept an `idempotencyKey`. */
export const WRITE_METHODS: readonly string[] = [
  'project.open',
  'project.create',
  'project.clone',
  'project.trust',
  'project.close',
  'project.initialize',
  'conversation.create',
  'conversation.message.send',
  'work.control',
  'requirement.save',
  'requirement.save.retry',
  'requirement.continue',
  'requirement.create',
  'requirement.update',
  'requirement.import',
  'requirement.start',
  'requirement.archive',
  'requirement.restore',
  'run.pause',
  'run.resume',
  'run.cancel',
  'work.retry',
  'recovery.inspect',
  'recovery.resolve',
  'work.budget.update',
  'extension.set',
  'plan.approve',
  'finding.submit',
  'decision.resolve',
  'permission.request',
  'permission.respond',
  'chief.todo.resolve',
  'config.save',
  'config.test',
  'backup.run',
  'restore.run',
  'secret.set',
  'secret.delete',
  'provider.upsert',
  'provider.test',
];

/**
 * Write methods whose idempotency ledger entry the generic wrapper owns.
 *
 * `provider.upsert` is deliberately absent, like `secret.set`: its payload carries the
 * credential, and the ledger's `payload_hash` would persist a digest of it (WP-12 decision
 * 2, `execution.md` §4). The write itself is replace-by-id, so no separate key is needed.
 *
 * `conversation.message.send` is deliberately absent: its effect owns its own
 * transaction and records its own ledger entry, so nesting the wrapper would
 * double-record the same command. `requirement.save` used to be excluded for the
 * same reason, but its Git-record service only de-duplicates *commits*: a replay
 * still minted a new Requirement id and a second projection row, and a same-key
 * different payload was accepted (W9R2-01). The wrapper now answers the replay
 * before any id is generated. `backup.run`/`restore.run` use the non-transactional
 * variant below.
 */
const LEDGER_WRAPPED_METHODS: readonly string[] = [
  'conversation.create',
  'project.open',
  'project.create',
  'project.clone',
  'project.trust',
  'project.close',
  'project.initialize',
  'work.control',
  'requirement.save',
  'requirement.continue',
  'requirement.create',
  'requirement.update',
  'requirement.import',
  'requirement.start',
  'requirement.archive',
  'requirement.restore',
  'run.pause',
  'run.resume',
  'run.cancel',
  'work.retry',
  'recovery.inspect',
  'recovery.resolve',
  'work.budget.update',
  'extension.set',
  'plan.approve',
  'finding.submit',
  'decision.resolve',
  'permission.request',
  'permission.respond',
  'chief.todo.resolve',
  'config.save',
  'config.test',
];

/**
 * Write methods whose ledger entry cannot share a transaction with its effect.
 *
 * `backupProject` snapshots the database with SQLite `VACUUM INTO` on the same
 * connection, and SQLite refuses that inside a transaction (W9R1-04). The ledger
 * row is therefore written and completed around the operation on its own; a crash
 * between the effect and `complete` can only cause a re-run, never a false replay.
 */
const NON_TRANSACTIONAL_LEDGER_METHODS: readonly string[] = ['backup.run', 'restore.run'];

/**
 * The six level-2 headings every `content.md` carries, in order
 * (`requirements.md` §6). The daemon generates a canonical record for a
 * cancellation, so the body is copied here instead of imported from Core's
 * validator; the real `RequirementSaveService` still validates every save.
 */
const REQUIREMENT_CONTENT_HEADINGS = [
  '目标与背景',
  '范围与行为',
  '验收说明',
  '已确认决定',
  '未决问题',
  '完成摘要',
] as const;

/** Placeholder for a requirement section that carries no content yet. */
const REQUIREMENT_EMPTY_SECTION = '待明确';

/** The daemon's own interface-string catalogue; the UI owns its wordings. */
const UI_STRINGS: Record<string, { readonly en: string; readonly zh: string }> = {
  'app.title': { en: 'AgentDev Workspace', zh: 'AgentDev 工作台' },
  'nav.projects': { en: 'Projects', zh: '项目' },
  'nav.chief': { en: 'Chief', zh: '主管' },
  'nav.requirements': { en: 'Requirements', zh: '需求' },
  'nav.docs': { en: 'Docs & Context', zh: '知识与上下文' },
  'nav.files': { en: 'Project Files', zh: '项目文件' },
  'nav.agents': { en: 'Agents', zh: '角色' },
  'nav.runs': { en: 'Runs', zh: '运行' },
  'nav.inbox': { en: 'Inbox', zh: '待处理' },
  'nav.live': { en: 'Live', zh: '实时' },
  'nav.settings': { en: 'Settings', zh: '设置' },
  'state.received': { en: 'Received', zh: '已接收' },
  'state.processing': { en: 'Processing', zh: '处理中' },
  'state.processed': { en: 'Processed', zh: '已处理' },
  'state.failed': { en: 'Failed', zh: '失败' },
  'state.decision_required': { en: 'Decision required', zh: '需要决定' },
  'board.queued': { en: 'Requirement queue', zh: '需求队列' },
  'board.active': { en: 'In iteration', zh: '迭代中需求' },
  'board.completed': { en: 'Completed', zh: '已完成' },
  'board.archived': { en: 'Archived', zh: '已归档' },
  'config.invalid': { en: 'The configuration was rejected', zh: '配置未通过校验' },
  // Machine-readable Plan-approval reasons (`plan.current`'s `approval.reasonCode`),
  // so the workbench can render the disabled reason in its own language instead of
  // echoing the daemon's English diagnostic (W9R2-05).
  'detail.approveReason.no_plan': {
    en: 'The gate holds no approved Plan for this Work revision.',
    zh: '该工作版本尚无已批准的计划。',
  },
  'detail.approveReason.stale_version': {
    en: 'This plan version is not current any more; refresh before approving.',
    zh: '该计划版本已非当前版本，请刷新后再批准。',
  },
  'detail.approveReason.gate_not_approved': {
    en: 'The gate no longer accepts this plan version.',
    zh: '该计划版本已不再被闸门接受。',
  },
  'detail.approveReason.plan_unreadable': {
    en: 'Approval is unavailable: the Plan body cannot be read.',
    zh: '当前无法批准：无法读取计划正文。',
  },
  'detail.approveReason.no_authorization': {
    en: 'Approval is unavailable: the Plan records no local authorization.',
    zh: '当前无法批准：计划未记录本地授权。',
  },
  'detail.approveReason.authorization_unreadable': {
    en: 'Approval is unavailable: the local authorization is not readable for this Work.',
    zh: '当前无法批准：该工作的本地授权不可读取。',
  },
  'detail.approveReason.gate_unavailable': {
    en: 'Approval is unavailable: the Plan gate is not readable.',
    zh: '当前无法批准：计划闸门不可读取。',
  },
  // The workbench catalogue, aligned with the keys the pages and the client script
  // actually ask for (`experience.md` §6, WP-12 D7): a key the DOM renders must
  // resolve remotely too, or every language switch logs one NOT_FOUND per key.
  // Project content is never translated, so only interface keys appear here.
  'agents.readOnly': { en: 'Role profiles are read-only here.', zh: '角色配置在此为只读。' },
  'agents.role': { en: 'Role', zh: '角色' },
  'agents.source': { en: 'Configuration source', zh: '配置来源' },
  'agents.tools': { en: 'Tool subset', zh: '工具集' },
  'agents.unavailable': { en: 'No usable model', zh: '无可用模型' },
  'app.projectWorkspace': { en: 'Project workspace', zh: '项目工作区' },
  'aria.composer': { en: 'Message composer', zh: '消息输入框' },
  'aria.detail': { en: 'Requirement detail', zh: '需求详情' },
  'aria.focusOrderNote': {
    en: 'On narrow screens the Live panel is an overlay; closing it returns focus to its restore control.',
    zh: '窄屏下实时面板为覆盖层，关闭后焦点回到恢复控件。',
  },
  'aria.liveDock': { en: 'Live panel', zh: '实时面板' },
  'aria.liveStream': { en: 'Live event stream', zh: '实时事件流' },
  'aria.messages': { en: 'Conversation messages', zh: '对话消息' },
  'auth.login': { en: 'Sign in', zh: '登录' },
  'auth.logout': { en: 'Sign out', zh: '退出' },
  'auth.showedOnce': {
    en: 'The installation token is shown once at install time and is never re-readable.',
    zh: '安装令牌仅在安装时显示一次，之后不可再次读取。',
  },
  'auth.submit': { en: 'Sign in', zh: '登录' },
  'auth.token': { en: 'Installation token', zh: '安装令牌' },
  'board.action.cancel': { en: 'Cancel', zh: '取消' },
  'board.action.pause': { en: 'Pause', zh: '暂停' },
  'board.actions': { en: 'Requirement actions', zh: '需求操作' },
  'board.card.blockers': { en: 'Blockers', zh: '阻断' },
  'board.card.decisions': { en: 'Decisions', zh: '决定' },
  'board.card.evidence': { en: 'Evidence availability', zh: '证据可用性' },
  'board.card.open': { en: 'Open detail', zh: '查看详情' },
  'board.card.phase': { en: 'Phase', zh: '阶段' },
  'board.card.previousState': { en: 'Previous state', zh: '先前状态' },
  'board.card.pushUnknown': { en: 'Push state not reported', zh: '推送状态未上报' },
  'board.card.role': { en: 'Role', zh: '角色' },
  'board.card.saveState': { en: 'Save state', zh: '保存状态' },
  'board.card.tasks': { en: 'Tasks done / total', zh: '已完成/总任务' },
  'board.card.waitingToContinue': { en: 'Waiting to continue', zh: '待继续' },
  'board.l1Hidden': {
    en: 'Direct-collaboration and L1 work stay in Chief and Runs, not on the board.',
    zh: '直接协作与 L1 工作仅在主管与运行中显示，不入看板。',
  },
  'board.pauseQueuedRefused': {
    en: 'A queued requirement without local work cannot be paused.',
    zh: '无本地工作的排队需求不能暂停。',
  },
  'chief.attach': { en: 'Add attachment', zh: '添加附件' },
  'chief.attachmentBound': { en: 'Bound to the message', zh: '已绑定到消息' },
  'chief.attachmentLimits': {
    en: 'Up to 5 attachments, 20 MiB each, 50 MiB total; PNG/JPEG/WebP and text/Markdown/HTML/PDF only.',
    zh: '最多 5 个附件，单个 20 MiB，总 50 MiB；仅支持 PNG/JPEG/WebP 与文本/Markdown/HTML/PDF。',
  },
  'chief.composer': { en: 'Message the Chief', zh: '给主管发消息' },
  'chief.newConversation': { en: 'New conversation', zh: '新建对话' },
  'chief.providerMissing': {
    en: 'No usable model is configured; the draft is kept.',
    zh: '未配置可用模型，草稿已保留。',
  },
  'chief.send': { en: 'Send message', zh: '发送消息' },
  'chief.switchConversation': { en: 'Switch conversation', zh: '切换对话' },
  'common.error': { en: 'The server refused the request', zh: '服务端拒绝了请求' },
  'common.none': { en: 'None', zh: '无' },
  'common.open': { en: 'Open', zh: '打开' },
  'common.refresh': { en: 'Refresh', zh: '刷新' },
  'common.retry': { en: 'Retry', zh: '重试' },
  'common.validity': { en: 'Validity', zh: '有效性' },
  'common.version': { en: 'Version', zh: '版本' },
  'common.waiting': { en: 'Waiting', zh: '等待中' },
  'connection.state': { en: 'Connection', zh: '连接' },
  'detail.approve': { en: 'Approve this plan version', zh: '批准此计划版本' },
  'detail.approveExpired': {
    en: 'This plan version is not current any more; refresh before approving.',
    zh: '该计划版本已非当前版本，请刷新后再批准。',
  },
  'detail.approveUnavailable': {
    en: 'Approval is unavailable: the Plan body or its local authorization cannot be read.',
    zh: '当前无法批准：计划正文或其本地授权不可读取。',
  },
  'detail.approvedAt': { en: 'Approved at', zh: '批准时间' },
  'detail.branch': { en: 'Delivery branch', zh: '交付分支' },
  'detail.commit': { en: 'Commit', zh: '提交' },
  'detail.download': { en: 'Download the full artifact', zh: '下载完整产物' },
  'detail.goal': { en: 'Goal', zh: '目标' },
  'detail.openQuestions': { en: 'Open questions', zh: '未决问题' },
  'detail.planCurrent': { en: 'Current plan version', zh: '当前计划版本' },
  'detail.planVersion': { en: 'Plan version', zh: '计划版本' },
  'detail.previewFailed': {
    en: 'The preview could not be rendered; the source download stays available.',
    zh: '预览渲染失败，仍可下载源码。',
  },
  'detail.previewTruncated': {
    en: 'Inline preview is truncated; download the full artifact.',
    zh: '内联预览已截断，请下载完整产物。',
  },
  'detail.pushState': { en: 'Push state', zh: '推送状态' },
  'detail.scope': { en: 'Scope', zh: '范围' },
  'files.binary': { en: 'Binary file; size and hash shown.', zh: '二进制文件，仅显示大小与哈希。' },
  'files.branch': { en: 'Delivery branch', zh: '交付分支' },
  'files.revision': { en: 'Target revision', zh: '目标版本' },
  'files.rootBoundary': {
    en: 'Only paths inside the project root are readable.',
    zh: '只能读取项目根目录内的路径。',
  },
  'files.search': { en: 'Search paths', zh: '搜索路径' },
  'files.snapshotUntouched': {
    en: 'Browsing does not change the Agent context snapshot.',
    zh: '浏览文件不会改变 Agent 上下文快照。',
  },
  'files.tree': { en: 'Project file tree', zh: '项目文件树' },
  'inbox.approve': { en: 'Approve once', zh: '批准一次' },
  'inbox.bindingMissing': {
    en: 'This daemon did not report the bound operation and targets, so approving is disabled. Denying still records a reason.',
    zh: '该 daemon 未报告绑定的操作与目标，因此批准已禁用；拒绝仍会记录原因。',
  },
  'inbox.decision': { en: 'Decision', zh: '决定' },
  'inbox.dedup': { en: 'One row per target version', zh: '每个目标版本一项' },
  'inbox.deny': { en: 'Deny', zh: '拒绝' },
  'inbox.denyReason': { en: 'Reason for denial (required)', zh: '拒绝原因（必填）' },
  'inbox.empty': { en: 'Nothing needs your decision.', zh: '当前没有待处理事项。' },
  'inbox.expiredDisabled': {
    en: 'An expired decision can no longer be applied.',
    zh: '过期决定不可再次应用。',
  },
  'inbox.finding': { en: 'Blocking finding', zh: '阻断发现' },
  'inbox.grantScopeOnce': { en: 'once (this call only)', zh: '一次（仅本次调用）' },
  'inbox.l3': { en: 'L3 high-risk confirmation', zh: 'L3 高风险确认' },
  'inbox.l3RiskFlags': { en: 'Risk flags the routing produced', zh: '路由给出的风险标记' },
  'inbox.l3NoRiskFlags': {
    en: 'The routing raised the level to L3 without naming a risk flag.',
    zh: '路由把等级提到 L3，但没有给出风险标记。',
  },
  'inbox.l3What': { en: 'What you are confirming', zh: '你要确认的内容' },
  'inbox.l3Work': { en: 'Work', zh: 'Work' },
  'inbox.l3Requirement': { en: 'Requirement', zh: '需求' },
  'inbox.l3Revision': { en: 'Revision', zh: '修订' },
  'inbox.l3Reason': { en: 'Why the routing says high risk', zh: '路由给出的高风险原因' },
  'inbox.l3WritePaths': { en: 'Write paths', zh: '写路径' },
  'inbox.l3ReadPaths': { en: 'Read paths', zh: '读路径' },
  'inbox.l3Operations': { en: 'Operations', zh: '操作' },
  'inbox.l3NetworkTargets': { en: 'Network targets', zh: '网络目标' },
  'inbox.l3NoPaths': { en: 'None declared', zh: '未声明' },
  'inbox.l3NoOperations': { en: 'None declared', zh: '未声明' },
  'inbox.l3NoTargets': { en: 'None declared', zh: '未声明' },
  'inbox.l3NoRequirement': { en: 'No Requirement yet', zh: '尚无需求' },
  'inbox.l3FieldUnavailable': { en: 'Not reported', zh: '未报告' },
  'inbox.l3DeclineReason': { en: 'Reason for declining (required)', zh: '拒绝原因（必填）' },
  'inbox.l3DeclineReasonRequired': {
    en: 'Declining an L3 confirmation must record a reason.',
    zh: '拒绝 L3 确认必须记录原因。',
  },
  'inbox.l3HoldNote': {
    en: 'Until this is confirmed, the Work does not execute: no Plan, Develop or verification stage is dispatched.',
    zh: '在确认之前，该 Work 不会执行：Plan、Develop 及后续验证阶段都不会被派发。',
  },
  'inbox.l3Confirmed': {
    en: 'Confirmed: the L3 delivery may proceed.',
    zh: '已确认：该 L3 交付可以继续。',
  },
  'inbox.l3Declined': {
    en: 'Declined: the Work stays blocked and the high-risk step is not implemented.',
    zh: '已拒绝：Work 保持 blocked，不会实施高风险步骤。',
  },
  'inbox.internalRepairs': { en: 'Internal repairs', zh: '内部修复' },
  'inbox.noTargets': {
    en: 'No targets recorded (a command operation).',
    zh: '未记录目标（命令类操作）。',
  },
  'inbox.options': { en: 'Saved options', zh: '已保存选项' },
  'inbox.permission': { en: 'Tool permission request', zh: '工具权限请求' },
  'inbox.permissionBinding': { en: 'What will be granted', zh: '将授予的内容' },
  'inbox.question': { en: 'Question', zh: '问题' },
  'inbox.questionEmpty': {
    en: 'The decision artifact carried no question text.',
    zh: '决定产物没有携带问题正文。',
  },
  'inbox.questionUnavailable': {
    en: 'The question text could not be read from the decision artifact.',
    zh: '无法从决定产物读取问题正文。',
  },
  'inbox.raisedBy': { en: 'Raised by', zh: '发起方' },
  'inbox.raisedByChief': { en: 'Chief', zh: '主管' },
  'inbox.raisedByRun': { en: 'the Run below', zh: '下方运行' },
  'inbox.raisedAt': { en: 'Raised at', zh: '提出时间' },
  'inbox.recovery': { en: 'Recovery', zh: '恢复' },
  'inbox.targetVersion': { en: 'Target version', zh: '目标版本' },
  'inbox.todo': { en: 'Chief todo', zh: '主管待办' },
  'inbox.todoAction': { en: 'Refused operation', zh: '被拒操作' },
  'inbox.todoConfigPolicy': { en: 'Config policy at refusal', zh: '拒绝时的配置档位' },
  'inbox.todoFieldUnavailable': {
    en: 'Not reported by the daemon',
    zh: '守护进程未上报',
  },
  'inbox.todoActions': { en: 'Close this todo', zh: '关闭该待办' },
  'inbox.todoHandled': { en: 'Handled', zh: '已处理' },
  'inbox.todoDismissed': { en: 'Ignore', zh: '忽略' },
  'inbox.todoReason': { en: 'Note (optional)', zh: '备注（可选）' },
  'inbox.todoResolved': { en: 'The todo was closed.', zh: '该待办已关闭。' },
  'inbox.todoHandling': {
    en: 'Handle this file yourself (fill it in, update it or provide the value another way). The agent continues with other work and does not need a decision from you here.',
    zh: '请你本人处理该文件（填写、更新或改用其他方式提供该值）。Agent 会继续做其他工作，这里不需要你提交决定。',
  },
  'inbox.todoKind': { en: 'Todo kind', zh: '待办类型' },
  'inbox.todoKindUnknown': { en: 'kind not reported', zh: '未上报类型' },
  'inbox.todoOtherHint': {
    en: 'This Chief todo was reported without a documented user action; its reported fields are below.',
    zh: '该主管待办没有对应文档化的用户动作；下方是它上报的字段。',
  },
  'inbox.todoPath': { en: 'File', zh: '文件' },
  'inbox.todoPattern': { en: 'Matched rule', zh: '命中规则' },
  'inbox.todoSensitiveFile': { en: 'Sensitive file needs you', zh: '敏感文件需你本人处理' },
  'inbox.todoSensitiveWhat': {
    en: 'The agent was refused this file because it is on the sensitive-file list. Its content was never read, and the agent will not read, search or edit it.',
    zh: '该文件在敏感文件清单内，Agent 的访问已被拒绝；文件内容从未被读取，Agent 也不会读取、搜索或修改它。',
  },
  'inbox.work': { en: 'Work', zh: '工作' },
  'language.label': { en: 'Interface language', zh: '界面语言' },
  'live.reconnect': { en: 'Reconnecting from the watermark', zh: '按水位重连' },
  'live.title': { en: 'Live events', zh: '实时事件' },
  'live.watermark': { en: 'Watermark', zh: '水位' },
  'nav.primary': { en: 'Project navigation', zh: '项目导航' },
  'nav.project': { en: 'Project', zh: '项目' },
  'nav.system': { en: 'System', zh: '系统' },
  'nav.workspace': { en: 'Workspace', zh: '工作区' },
  'run.topLive': { en: 'Live', zh: '实时' },
  'runs.attempt': { en: 'Attempt', zh: '尝试' },
  'runs.cancel': { en: 'Cancel run', zh: '取消运行' },
  'runs.epoch': { en: 'Epoch', zh: '纪元' },
  'runs.evidence': { en: 'Evidence', zh: '证据' },
  'runs.l1': { en: 'Direct collaboration / L1', zh: '直接协作 / L1' },
  'runs.outcome': { en: 'Outcome', zh: '结果' },
  'runs.pause': { en: 'Pause run', zh: '暂停运行' },
  'runs.resume': { en: 'Resume run', zh: '恢复运行' },
  'runs.run': { en: 'Run', zh: '运行' },
  'runs.status': { en: 'Status', zh: '状态' },
  'runs.tokens': { en: 'Tokens', zh: 'Token' },
  'settings.apiKey': { en: 'API key', zh: 'API 密钥' },
  'settings.apiKeyHint': {
    en: 'Leave empty to keep the stored credential. The value is never echoed back.',
    zh: '留空表示保留已保存的凭证。密钥值不会回显。',
  },
  'settings.baseUrl': { en: 'Base URL', zh: 'Base URL' },
  'settings.enabled': { en: 'Enabled', zh: '启用' },
  'settings.models': { en: 'Models', zh: '模型' },
  'settings.modelsHint': {
    en: 'ModelDescriptor array: id, contextWindow, maxOutputTokens, reasoningLevels, vision, optional prices.',
    zh: 'ModelDescriptor 数组：id、contextWindow、maxOutputTokens、reasoningLevels、vision、可选价格。',
  },
  'settings.newProvider': { en: 'New provider', zh: '新增 Provider' },
  'settings.providerId': { en: 'Provider id', zh: 'Provider 标识' },
  'settings.providerIdHint': {
    en: 'Leave empty to create a new provider; the server creates the id otherwise.',
    zh: '留空表示新建 Provider；否则使用已配置的标识。',
  },
  'settings.providerSave': { en: 'Save provider', zh: '保存 Provider' },
  'settings.providerSaved': { en: 'Provider saved', zh: 'Provider 已保存' },
  'settings.providerTest': { en: 'Test connection', zh: '连接测试' },
  'settings.providerType': { en: 'Type', zh: '类型' },
  'settings.rejected': { en: 'The configuration was rejected', zh: '配置未通过校验' },
  'settings.revision': { en: 'Active revision', zh: '活动版本' },
  'settings.save': { en: 'Save configuration', zh: '保存配置' },
  'settings.secretConfigured': { en: 'Secret configured', zh: '已配置密钥' },
  'settings.secretMissing': { en: 'No secret configured', zh: '未配置密钥' },
  'settings.test': { en: 'Test provider', zh: '测试提供方' },
  'settings.testAccepted': { en: 'Connection test accepted.', zh: '连接测试已接受。' },
  'settings.testCompleted': { en: 'Connection test result', zh: '连接测试结果' },
  'settings.testFailed': { en: 'The provider profile is not usable.', zh: '提供方配置不可用。' },
  'settings.testModel': { en: 'Model to test', zh: '测试模型' },
  'settings.testNeedsModel': {
    en: 'Save the provider before testing: it declares no model yet.',
    zh: '保存 Provider 后再测试：该 Provider 还没有模型。',
  },
  'settings.testOk': { en: 'The provider profile is usable.', zh: '提供方配置可用。' },
  'settings.testPending': {
    en: 'The result arrives later — check Runs or the Live event list.',
    zh: '结果稍后到达/查看 Runs 或事件。',
  },
  'settings.unchanged': {
    en: 'The active revision is unchanged and your input is preserved.',
    zh: '活动版本未改变，输入已保留。',
  },
  'settings.unsaved': { en: 'Unsaved edits', zh: '未保存的修改' },
  'shell.chiefOnlyControls': {
    en: 'Conversation controls exist only on the Chief page.',
    zh: '对话创建与切换仅在主管页面。',
  },
  'shell.discussInChief': { en: 'Discuss in Chief', zh: '在主管中讨论' },
  'shell.liveCount': { en: 'Live events', zh: '实时事件' },
  'shell.panelClose': { en: 'Close the Live panel', zh: '关闭实时面板' },
  'shell.skipToMain': { en: 'Skip to main content', zh: '跳到主要内容' },
  'state.active': { en: 'Active', zh: '进行中' },
  'state.invalidated': { en: 'Superseded', zh: '已失效' },
  'state.unknown': { en: 'Unknown', zh: '未知' },
  'state.valid': { en: 'Valid', zh: '有效' },

  disconnected: { en: 'Connection lost; background state pending', zh: '连接中断，后台状态待同步' },
  // WP-12 project UX: the browser-only project loading and switching surface.
  'projects.firstRunTitle': { en: 'No project yet', zh: '还没有项目' },
  'projects.firstRunHint': {
    en: 'Open an existing folder, create a new project folder, or clone from a Git URL. Everything here works in the browser; no command line is needed.',
    zh: '打开已有文件夹、新建项目文件夹，或从 Git 地址克隆。全部在浏览器内完成，不需要命令行。',
  },
  'projects.actions': { en: 'Project actions', zh: '项目操作' },
  'projects.openFolder': { en: 'Open a folder…', zh: '打开文件夹…' },
  'projects.createFolder': { en: 'New project folder…', zh: '新建项目文件夹…' },
  'projects.clone': { en: 'Clone from Git URL', zh: '从 Git 地址克隆' },
  'projects.cloneHint': {
    en: 'Cloning writes a new folder and needs your explicit confirmation; it uses a one-time installation Grant for that remote and path.',
    zh: '克隆会新建目录并需要你显式确认；它为该远端与路径铸一次安装级 Grant。',
  },
  'projects.remoteUrl': { en: 'Git remote URL', zh: 'Git 远端地址' },
  'projects.path': { en: 'Folder path', zh: '文件夹路径' },
  'projects.name': { en: 'Project name', zh: '项目名称' },
  'projects.pick': { en: 'Choose…', zh: '选择…' },
  'projects.open': { en: 'Open', zh: '打开' },
  'projects.opening': { en: 'Opening…', zh: '正在打开…' },
  'projects.trust': { en: 'Trust and work', zh: '信任并开始工作' },
  'projects.readOnly': { en: 'Read-only for now', zh: '暂时只读' },
  'projects.trustPromptTitle': { en: 'Trust this folder?', zh: '信任这个文件夹吗？' },
  'projects.trustPromptBody': {
    en: 'This folder is read-only (只看不改) until you trust it: your own instruction and extension resources are not loaded from it. Trust it now, or keep it read-only and change this later on the project row.',
    zh: '在信任之前，该项目只读（只看不改）：不会加载它自带的指令与扩展资源。可以现在信任，也可以暂时只读，之后在项目行里随时更改。',
  },
  'projects.trusted': { en: 'trusted', zh: '已信任' },
  'projects.untrusted': { en: 'read-only (untrusted)', zh: '只读（未信任）' },
  'projects.trustNow': { en: 'Trust', zh: '信任' },
  'projects.untrustNow': { en: 'Make read-only', zh: '改为只读' },
  'projects.initialize': { en: 'Initialize', zh: '初始化' },
  'projects.close': { en: 'Close', zh: '关闭' },
  'projects.closed': { en: 'closed', zh: '已关闭' },
  'projects.openAction': { en: 'Open', zh: '打开' },
  'projects.switch': { en: 'Switch', zh: '切换' },
  'projects.state': { en: 'state', zh: '状态' },
  'projects.chipTrust': { en: 'trust', zh: '信任' },
  'projects.chipRuns': { en: 'runs', zh: '运行中' },
  'projects.chipInit': { en: 'init', zh: '初始化' },
  'projects.lifecycleOpen': { en: 'open', zh: '已打开' },
  'projects.lifecycleClosed': { en: 'closed', zh: '已关闭' },
  'projects.lifecycleMissing': { en: 'path missing', zh: '路径不存在' },
  'projects.lifecycleUnreadable': { en: 'unreadable registry entry', zh: '注册表条目不可读' },
  'projects.opened': { en: 'Project opened.', zh: '项目已打开。' },
  'projects.trustApplied': { en: 'Trust updated.', zh: '信任状态已更新。' },
  'projects.closedNotice': {
    en: 'Project closed (navigation only).',
    zh: '项目已关闭（仅导航级）。',
  },
  'projects.picker': { en: 'Choose a folder', zh: '选择文件夹' },
  'projects.pickerHint': {
    en: 'Read-only browser of folder names. It starts at your home directory, can go up to the filesystem root, and accepts a pasted absolute path. Every listing is audited.',
    zh: '只读的文件夹名浏览：从主目录开始，可上溯到文件系统根目录，也接受粘贴的绝对路径。每次列表都进审计。',
  },
  'picker.title': { en: 'Choose a folder', zh: '选择文件夹' },
  'picker.path': { en: 'Path', zh: '路径' },
  'picker.go': { en: 'Go', zh: '前往' },
  'picker.up': { en: 'Up', zh: '上一级' },
  'picker.home': { en: 'Home', zh: '主目录' },
  'picker.root': { en: 'Filesystem root', zh: '文件系统根' },
  'picker.select': { en: 'Use this folder', zh: '使用此文件夹' },
  'picker.cancel': { en: 'Cancel', zh: '取消' },
  'picker.empty': { en: 'This folder is empty.', zh: '该文件夹为空。' },
  'picker.loading': { en: 'Loading…', zh: '加载中…' },
  'picker.truncated': { en: 'Showing the first 2000 entries.', zh: '只显示前 2000 个条目。' },
  'picker.hiddenEntry': { en: 'hidden', zh: '隐藏' },
  'picker.upEntry': { en: 'Parent folder', zh: '上级文件夹' },
  'picker.failed': { en: 'The folder could not be listed.', zh: '无法列出该文件夹。' },
  'picker.readOnlyNotice': {
    en: 'Names only: this picker never reads file contents.',
    zh: '只列名称：该选择器不读取文件内容。',
  },
};

/**
 * The daemon catalogue under its contract name, exported so a test can assert the
 * WebUI's used-key set is fully covered (`api-gap-audit.md` §2.5, WP-12 D7).
 */
export const WorkbenchServicesStrings = UI_STRINGS;

interface ParsedEnvelope {
  readonly id: string;
  readonly method: string;
  readonly params: JsonObject;
  readonly projectId?: string;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
}

interface SubscriptionRecord {
  readonly id: string;
  /** The scope this subscription observes; `subscription.set` replaces it. */
  scope: { readonly kind: string; readonly id?: string };
  /** Highest cursor handed to the client (the delivery watermark). */
  cursor: number;
}

/**
 * One user-facing Chief todo as the durable event log records it.
 *
 * `todoId` is the identity the Inbox reports and `chief.todo.resolve` accepts:
 * `workId:path:pattern`, exactly the key the tool handler de-duplicates a refusal on
 * (`protocol.md` §7).
 */
interface UserTodoRecord {
  readonly todoId: string;
  readonly workId: string;
  readonly action: string | null;
  readonly path: string | null;
  readonly pattern: string | null;
  readonly configPolicy: string | null;
  readonly runId: string | null;
  readonly role: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

/**
 * The workbench protocol over one Project's real Core.
 *
 * One instance per daemon; every method reads or writes the same `ProjectStore`,
 * so a query can never answer from a copy and a command can never skip the real
 * service.
 */
export class WorkbenchProtocol {
  private readonly services: WorkbenchServices;
  private readonly now: () => number;
  private readonly backupGit: BackupGitPort;
  private readonly requirementRecords: RequirementRecordPort;
  private readonly requirementGit: RequirementGitFactsPort;
  private readonly requirementPool: RequirementPoolReadPort;
  private readonly workspaceFiles: WorkspaceFilePort;
  private connectionSequence = 0;
  /** Live WebSocket connections, so a shutdown or failure can close them honestly. */
  private readonly sockets = new Set<ServerWebSocket>();

  constructor(services: WorkbenchServices) {
    this.services = services;
    this.now = services.now ?? (() => Date.now());
    this.backupGit = services.backupGit ?? createNodeBackupGitPort();
    this.requirementRecords = services.requirementRecords ?? createNodeRequirementRecordPort();
    this.requirementGit = services.requirementGit ?? createNodeRequirementGitFactsPort();
    this.requirementPool = services.requirementPool ?? createNodeRequirementPoolPort();
    this.workspaceFiles = services.workspaceFiles ?? createNodeWorkspaceFilePort();
  }

  /** The Project this daemon serves; also the ACL boundary of every query. */
  get projectId(): string {
    return this.services.store.projectId;
  }

  /** The HTTP status for one protocol failure. */
  statusOf(code: string): number {
    return statusForCode(code);
  }

  // -------------------------------------------------------------------------
  // HTTP /rpc
  // -------------------------------------------------------------------------

  /**
   * Answers one `/rpc` request.
   *
   * The envelope carries the whole request, including `idempotencyKey` and
   * `expectedVersion`; the response is the single terminal envelope
   * (`protocol.md` §1).
   */
  handleRpc(raw: string, auth: WorkbenchAuthPort, request: IncomingMessage): JsonObject {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpFailure(422, 'VALIDATION_ERROR', 'the request body is not JSON');
    }
    const envelope = parseEnvelope(parsed);
    const caller = this.authenticateRequest(request, auth, WRITE_METHODS.includes(envelope.method));
    // One request yields exactly one terminal response envelope (`protocol.md` §1);
    // a thrown `ProtocolError` is rewritten by the caller with the status its code
    // implies, so this method only builds the success shape.
    return {
      v: 1,
      type: 'response',
      id: envelope.id,
      ok: true,
      result: this.dispatchEnvelope(envelope, caller),
    };
  }

  /** Dispatches a parsed envelope synchronously; every command is synchronous. */
  dispatchEnvelope(envelope: ParsedEnvelope, caller: WorkbenchCaller): JsonObject {
    const result = this.dispatch(envelope.method, envelope.params, {
      caller,
      ...(envelope.idempotencyKey === undefined ? {} : { idempotencyKey: envelope.idempotencyKey }),
      ...(envelope.expectedVersion === undefined
        ? {}
        : { expectedVersion: envelope.expectedVersion }),
      ...(envelope.projectId === undefined ? {} : { projectId: envelope.projectId }),
    });
    // Every documented method answers synchronously; a command that returned a
    // Promise would be a Core contract break, not a slow request.
    if (result instanceof Promise) {
      throw new ProtocolError('INTERNAL_ERROR', `${envelope.method} answered asynchronously`);
    }
    // The result is the documented `result` member of the response envelope; the
    // protocol layer does not reshape domain rows.
    return JSON.parse(JSON.stringify(result ?? null)) as JsonObject;
  }

  /**
   * Attaches the executor's recovery actions once the supervisor exists.
   *
   * The protocol is constructed by `bootstrap.ts` before the daemon host builds the
   * execution stack, so the port arrives late; it is optional and its absence leaves the
   * `resume` behaviour exactly as before (a clearer refusal, never a silent success).
   */
  attachRunRecovery(port: RunRecoveryPort): void {
    this.services.runRecovery = port;
  }

  /**
   * Attaches the execution stack's orchestrator (WP-12 T2.1).
   *
   * `conversation.message.send` queues the Chief assessment Run through it and
   * `plan.approve` queues the next professional Run, so the protocol and the supervisor
   * share one lifecycle and one budget ledger.
   */
  attachOrchestrator(orchestrator: Orchestrator): void {
    this.services.orchestrator = orchestrator;
    // The orchestrator owns the one L3 confirmation service an execution stack has
    // (`Orchestrator.confirmations`): the routing assessment raises the question
    // through it and `decision.resolve` answers through the same instance, so the
    // admission gate and the Inbox can never disagree about which confirmation stands.
    this.services.confirmations = orchestrator.confirmations;
  }

  /** Attaches the stack's model gateway, which `provider.test` probes. */
  attachGateway(gateway: ModelGateway): void {
    this.services.gateway = gateway;
  }

  /**
   * Attaches the installation-level project directory (WP-12 T5).
   *
   * `project.list/open/create/clone/trust/close/initialize` are installation-level:
   * they must answer for every project the installation serves, not only this
   * daemon's own. The directory is the one owner of that truth (`main.ts` builds it),
   * and this method is the same late-attachment seam `attachOrchestrator` uses.
   * Without it those commands refuse with `INVALID_STATE` instead of fabricating a
   * navigation fact.
   */
  attachProjectDirectory(directory: ProjectDirectoryPort): void {
    this.services.projectDirectory = directory;
  }

  /** Resolves the caller from the session cookie / installation credential. */
  authenticateRequest(
    request: IncomingMessage,
    auth: WorkbenchAuthPort,
    isWrite: boolean,
  ): WorkbenchCaller {
    if (auth.bearerOk(request.headers.authorization)) {
      return {
        subject: INSTALLATION_SUBJECT,
        userId: userIdFromSubject('installation:local'),
        role: 'chief',
      };
    }
    const cookie = auth.cookieOf(request);
    const decision = auth.authenticate({
      ...(cookie === undefined ? {} : { cookie }),
      ...(typeof request.headers['x-csrf-token'] === 'string'
        ? { csrfToken: request.headers['x-csrf-token'] }
        : {}),
      ...(typeof request.headers.origin === 'string' ? { origin: request.headers.origin } : {}),
      isWrite,
    });
    if (!decision.ok) {
      const code = decision.code ?? 'UNAUTHENTICATED';
      throw new HttpFailure(
        decision.status ?? statusForCode(code),
        code,
        decision.message ?? 'the request is not authenticated',
      );
    }
    return {
      subject: decision.subject ?? `user:${cookie ?? 'unknown'}`,
      userId: decision.userId ?? userIdFromSubject('installation:local'),
      role: 'chief',
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket upgrade
  // -------------------------------------------------------------------------

  /**
   * Decides whether an upgrade may proceed.
   *
   * `protocol.md` §2: the WebSocket connect verifies Origin **and** cookie; a
   * Bearer installation credential is accepted for the BFF/CLI. A refusal never
   * reaches `101`, so an unauthenticated peer gets no socket and no event.
   */
  authorizeUpgrade(request: IncomingMessage, auth: WorkbenchAuthPort): UpgradeDecision {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (origin === undefined || origin === '') {
      return { ok: false, reason: 'the Origin header is required' };
    }
    if (auth.bearerOk(request.headers.authorization)) {
      return {
        ok: true,
        caller: {
          subject: INSTALLATION_SUBJECT,
          userId: userIdFromSubject('installation:local'),
          role: 'chief',
        },
      };
    }
    const cookie = auth.cookieOf(request);
    const decision = auth.authenticate({
      ...(cookie === undefined ? {} : { cookie }),
      origin,
      // The handshake carries no write; every command still re-checks CSRF over
      // its own envelope.
      isWrite: false,
    });
    if (!decision.ok) {
      return { ok: false, reason: decision.message ?? 'the session is not authorised' };
    }
    return {
      ok: true,
      caller: {
        subject: decision.subject ?? `user:${cookie ?? 'unknown'}`,
        userId: decision.userId ?? userIdFromSubject('installation:local'),
        role: 'chief',
      },
    };
  }

  /**
   * Handles one HTTP upgrade for `/ws`.
   *
   * Exported for the daemon's `upgrade` listener and directly for tests, which
   * drive a real socket over loopback.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex, auth: WorkbenchAuthPort): boolean {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') return false;
    if (request.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
      return true;
    }
    const decision = this.authorizeUpgrade(request, auth);
    if (!decision.ok || decision.caller === undefined) {
      socket.end(
        [
          'HTTP/1.1 401 Unauthorized',
          'connection: close',
          `x-agentdev-reason: ${encodeURIComponent(decision.reason ?? 'unauthorised')}`,
          '\r\n',
        ].join('\r\n'),
      );
      return true;
    }
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
      return true;
    }
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    this.connectionSequence += 1;
    const connection = new ServerWebSocket(
      socket,
      this,
      decision.caller,
      `conn-${String(this.connectionSequence)}-${randomBytes(6).toString('hex')}`,
    );
    this.sockets.add(connection);
    return true;
  }

  /** Drops a connection from the registry; called when its socket ends. */
  unregister(connection: ServerWebSocket): void {
    this.sockets.delete(connection);
    this.services.events.closeConnection(connection.connectionId);
  }

  /** Live WebSocket connections; used by tests and diagnostics. */
  get connectionCount(): number {
    return this.sockets.size;
  }

  /** Closes every live connection; the daemon calls this on `close`. */
  closeAll(code = 1001, reason = 'daemon closing'): void {
    for (const connection of [...this.sockets]) connection.close(code, reason);
  }

  // -------------------------------------------------------------------------
  // Command dispatch
  // -------------------------------------------------------------------------

  /**
   * Dispatches one method.
   *
   * Every branch either reads real state or calls a real service; a method whose
   * service is not wired refuses with a protocol code instead of fabricating a
   * success (`NOT_FOUND` for an unknown method, `INVALID_STATE` for a capability
   * this daemon instance does not hold).
   */
  dispatch(
    method: string,
    params: JsonObject,
    options: {
      readonly caller: WorkbenchCaller;
      readonly idempotencyKey?: string;
      readonly expectedVersion?: number;
      readonly projectId?: string;
    },
  ): unknown {
    const needsProject = !GLOBAL_METHODS.includes(method);
    if (needsProject && options.projectId !== undefined && options.projectId !== this.projectId) {
      // `protocol.md` §1: a cross-Project id is NOT_FOUND, never another Project's
      // data. This daemon holds exactly one ProjectRuntime, and the refusal echoes
      // only the id the caller sent — never this installation's own id (W9R1-03).
      throw new ProtocolError(
        'NOT_FOUND',
        `Project ${options.projectId} is not open on this daemon`,
        {
          details: { projectId: options.projectId },
        },
      );
    }
    if (WRITE_METHODS.includes(method)) {
      const key = options.idempotencyKey;
      if (
        key !== undefined &&
        (key.length < PROTOCOL_LIMITS.idempotencyKeyMinChars ||
          key.length > PROTOCOL_LIMITS.idempotencyKeyMaxChars)
      ) {
        throw new ProtocolError(
          'VALIDATION_ERROR',
          `idempotencyKey must be ${PROTOCOL_LIMITS.idempotencyKeyMinChars}–${PROTOCOL_LIMITS.idempotencyKeyMaxChars} characters`,
        );
      }
      if (options.expectedVersion !== undefined && !Number.isInteger(options.expectedVersion)) {
        throw new ProtocolError('VALIDATION_ERROR', 'expectedVersion must be an integer');
      }
    }
    if (LEDGER_WRAPPED_METHODS.includes(method) && options.idempotencyKey !== undefined) {
      // `protocol.md` §1: every `*` method honours the idempotency key. The two
      // methods whose effects own their own transaction keep their dedicated
      // ledger (see `sendMessageCommand`/`saveRequirement`); every other write is
      // recorded here in the same transaction as its answer (W9R1-04).
      return this.withCommandLedger(method, params, options, () =>
        this.dispatchUnwrapped(method, params, options),
      );
    }
    if (NON_TRANSACTIONAL_LEDGER_METHODS.includes(method) && options.idempotencyKey !== undefined) {
      return this.withNonTransactionalCommandLedger(method, params, options, () =>
        this.dispatchUnwrapped(method, params, options),
      );
    }
    return this.dispatchUnwrapped(method, params, options);
  }

  /**
   * Records one write command around `action` (W9R1-04).
   *
   * The ledger row and the command's own effects commit in one transaction, so a
   * crash cannot leave an accepted key without its recorded result. The backing
   * store is SQLite, so this nesting changes atomicity only, never durability.
   */
  private withCommandLedger(
    method: string,
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller; readonly idempotencyKey?: string },
    action: () => unknown,
  ): unknown {
    const store = this.services.store;
    return withTransaction(store.db, () => {
      const key = options.idempotencyKey as string;
      const begun = store.commands.begin({
        subject: options.caller.subject,
        operation: method,
        key,
        payloadHash: sha256Of(params),
      });
      if (begun.kind === 'conflict') {
        throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason, {
          details: { idempotencyKey: key },
        });
      }
      if (begun.kind === 'replay') return begun.response;
      const reply = action();
      store.commands.complete(begun.commandId, reply ?? null);
      return reply;
    });
  }

  /**
   * Records one write command whose effect cannot share this transaction (W9R1-04).
   *
   * The ledger row is durably accepted before the effect runs, so a replay after a
   * lost response returns the recorded result instead of running the operation a
   * second time. A refused effect deletes its accepted row, so a key never pins a
   * failure and a retry with the same key is free to run again.
   */
  private withNonTransactionalCommandLedger(
    method: string,
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller; readonly idempotencyKey?: string },
    action: () => unknown,
  ): unknown {
    const store = this.services.store;
    const key = options.idempotencyKey as string;
    const begun = store.commands.begin({
      subject: options.caller.subject,
      operation: method,
      key,
      payloadHash: sha256Of(params),
    });
    if (begun.kind === 'conflict') {
      throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason, {
        details: { idempotencyKey: key },
      });
    }
    if (begun.kind === 'replay') return begun.response;
    let reply: unknown;
    try {
      reply = action();
    } catch (error) {
      withTransaction(store.db, () => {
        store.db.prepare('DELETE FROM command WHERE id = ?').run(begun.commandId);
      });
      throw error;
    }
    withTransaction(store.db, () => {
      store.commands.complete(begun.commandId, reply ?? null);
    });
    return reply;
  }

  private dispatchUnwrapped(
    method: string,
    params: JsonObject,
    options: {
      readonly caller: WorkbenchCaller;
      readonly idempotencyKey?: string;
      readonly expectedVersion?: number;
      readonly projectId?: string;
    },
  ): unknown {
    switch (method) {
      // ----- project / conversation -----------------------------------------
      case 'projects':
      case 'project.list':
        return this.listProjects(params);
      case 'project.open':
        return this.openProject(params, options);
      case 'project.create':
        return this.createProject(params, options);
      case 'project.clone':
        return this.cloneProject(params, options);
      case 'project.trust':
        return this.trustProject(params, options);
      case 'project.close':
        return this.closeProject(params, options);
      case 'project.initialize':
        return this.initializeProject(params, options);
      case 'project.snapshot.get':
        return this.projectSnapshot();
      case 'conversation.list':
        return this.listConversations(params);
      case 'conversation.create':
        return this.createConversation(params, options);
      case 'conversation.get':
        return this.getConversation(params);
      case 'conversation.message.send':
        return this.sendMessageCommand(params, options);
      // ----- knowledge -------------------------------------------------------
      case 'knowledge.list':
        return this.listKnowledge(params);
      case 'knowledge.get':
        return this.getKnowledge(params);
      case 'context.preview':
        return this.previewContext(params);
      // ----- work / requirement / run ---------------------------------------
      case 'board':
        return this.board();
      case 'work.list':
        return this.listWorks(params);
      case 'work.get':
        return this.getWork(params);
      case 'work.control':
        return this.controlWork(params, options);
      case 'requirement.list':
        return this.listRequirements(params);
      case 'requirement.get':
        return this.getRequirement(params);
      case 'requirement.save':
        return this.saveRequirement(params, options, false);
      case 'requirement.save.retry':
        return this.saveRequirement(params, options, true);
      case 'requirement.continue':
        return this.continueRequirement(params);
      case 'requirement.create':
        return this.createRequirement(params, options);
      case 'requirement.update':
        return this.updateRequirement(params, options);
      case 'requirement.import':
        return this.importRequirement(params);
      case 'requirement.start':
        return this.startRequirement(params, options);
      case 'requirement.archive':
        return this.archiveRequirement(params, options);
      case 'requirement.restore':
        return this.restoreRequirement(params, options);
      case 'run.list':
        return this.listRuns(params);
      case 'run.get':
        return this.getRun(params);
      case 'run.pause':
        return this.controlRun('pause', params, options);
      case 'run.resume':
        return this.controlRun('resume', params, options);
      case 'run.cancel':
        return this.controlRun('cancel', params, options);
      case 'work.retry':
        return this.retryWork(params, options);
      case 'recovery.inspect':
        return this.inspectRecovery(params, options);
      case 'recovery.resolve':
        return this.resolveRecovery(params, options);
      case 'task.list':
        return this.listTasks(params);
      case 'task.get':
        return this.getTask(params);
      // ----- commands / files / extensions (`protocol.md` §4/§5) -------------
      case 'command.get':
        return this.getCommand(params, options);
      case 'file.list':
        return this.listFiles(params);
      case 'file.read':
        return this.readFile(params);
      case 'extension.list':
        return this.listExtensions();
      case 'extension.set':
        return this.setExtension(params);
      case 'work.budget.update':
        return this.updateWorkBudget(params);
      // ----- artifacts -------------------------------------------------------
      case 'artifact.list':
        return this.listArtifacts(params);
      case 'artifact.get':
        return this.getArtifact(params);
      case 'artifact.download.prepare':
        return this.prepareDownload(params);
      // ----- inbox / agents / settings / config -----------------------------
      case 'inbox':
        return this.inbox();
      case 'agents':
        return this.agentsView();
      case 'settings':
        return this.settingsView();
      case 'config.get':
        return this.getConfig(params);
      case 'config.save':
        return this.saveConfig(params, options);
      case 'config.test':
        return this.testConfig(params);
      // ----- credentials (installation-only, WP-12 T1.1) ---------------------
      case 'secret.set':
        return this.setSecret(params, options);
      case 'secret.delete':
        return this.deleteSecret(params, options);
      case 'secret.list':
        return this.listSecrets(options);
      // ----- providers (WP-12 T2.0, `protocol.md` §5) -----------------------
      case 'provider.upsert':
        return this.upsertProvider(params);
      case 'provider.test':
        return this.testProvider(params);
      // ----- gates / findings / decisions -----------------------------------
      case 'plan.current':
        return this.currentPlan(params);
      case 'plan.approve':
        return this.approvePlan(params, options);
      case 'finding.submit':
        return this.submitFinding(params);
      case 'decision.resolve':
        return this.resolveDecision(params, options);
      // ----- tool permissions (WP-12 T3, `protocol.md` §4) -------------------
      case 'permission.request':
        return this.requestPermission(params);
      case 'permission.respond':
        return this.respondPermission(params, options);
      // ----- user-facing Chief todos (WP-12 W2, `protocol.md` §4) -------------
      case 'chief.todo.resolve':
        return this.resolveChiefTodo(params, options);
      // ----- backup / restore ------------------------------------------------
      case 'backup.run':
        return this.runBackup(params);
      case 'restore.run':
        return this.runRestore(params);
      // ----- i18n ------------------------------------------------------------
      case 'ui.translate':
        return this.translate(params);
      default:
        throw new ProtocolError('NOT_FOUND', `no protocol method named ${method}`, {
          details: { method },
        });
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * `project.list` — the installation-wide navigation list (`protocol.md` §3, T5).
   *
   * With the directory attached the answer covers every project the installation
   * knows (open, closed and discoverable), which is what the single-entry switcher
   * renders; damaged registry entries are reported as typed `unreadable` items rather
   * than aborting the list (Q2). Without it this daemon can only answer for the one
   * Project it serves, which is the honest fallback for an older host.
   */
  private listProjects(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const filter = optionalString(params['filter']) ?? 'all';
    const directory = this.services.projectDirectory;
    if (directory !== undefined) {
      const items = directory
        .list()
        .filter((entry) => (filter === 'running' ? entry.runningRuns > 0 : true))
        .slice(0, limit)
        .map((entry) => this.projectSummaryOfEntry(entry));
      return { items, nextCursor: null, problems: directory.problems };
    }
    const rows = this.services.store.projects.list({ orderBy: 'updated_at DESC' });
    // `filter` narrows the navigation list; `recent`/`all` keep every open Project.
    const openOnly = filter === 'recent' || filter === 'all' ? false : true;
    const items = rows
      .filter(() => (filter === 'running' ? this.runningRunCount() > 0 : true))
      .filter((row) => (openOnly ? row.state === 'open' : true))
      .slice(0, limit)
      .map((row) => this.projectSummaryOf(row.id));
    return { items, nextCursor: null, problems: [] };
  }

  /**
   * `project.open` (`protocol.md` §3).
   *
   * An already-open root answers the documented `{projectId,version,trust,gitState}`
   * synchronously and idempotently; a root this installation does not serve yet is
   * assembled by the directory. Assembly binds listeners, so that case answers the
   * long-operation envelope `accepted` + `operationId` — `project.list` reports the
   * project `open` once it is serving, and a failure emits `operation.failed` into
   * this daemon's own stream (Q9).
   */
  private openProject(params: JsonObject, options: { readonly idempotencyKey?: string }): unknown {
    const root = requiredString(params, 'root');
    const directory = this.services.projectDirectory;
    if (directory === undefined) {
      const project = this.services.store.projects.find(this.projectId);
      if (project === undefined) {
        throw new ProtocolError('NOT_FOUND', `Project ${this.projectId} is not registered`);
      }
      // Identity normalisation is a real fact (`ARCHITECTURE.md` §4): a subdirectory
      // resolves to the repository root, and any other root belongs to a
      // ProjectRuntime this daemon does not hold, so it is NOT_FOUND rather than a
      // second Project invented on the wire.
      const normalized = normalizeRoot(root);
      const known = [project.root, project.gitRoot].filter(
        (candidate): candidate is string => candidate !== undefined,
      );
      if (!known.some((candidate) => normalizeRoot(candidate) === normalized)) {
        throw new ProtocolError(
          'NOT_FOUND',
          `root ${root} is not the Project this daemon has open (${project.root})`,
          { details: { root, projectId: this.projectId, openRoot: project.root } },
        );
      }
      return {
        status: 'applied',
        entityId: project.id,
        version: project.version,
        projectId: project.id,
        project,
        gitState: { gitRoot: project.gitRoot ?? null, head: project.head ?? null },
        trust: project.trust,
      };
    }
    const known = directory.findByRoot(root);
    if (known !== undefined && known.state === 'open' && known.projectId !== null) {
      return {
        status: 'applied',
        entityId: known.projectId,
        version: 0,
        projectId: known.projectId,
        project: known,
        gitState: { gitRoot: known.gitRoot, head: known.head },
        trust: known.trust,
      };
    }
    // The identity resolution below also rejects a missing path before the answer, so
    // "accepted" is never returned for a root that cannot exist.
    const projectId = directory.projectIdFor(root);
    const operationId = options.idempotencyKey ?? this.services.store.newId();
    // WP-12 project UX: opening a folder this installation does not serve yet must not
    // trust it silently. The default is the read-only state (`trust:false`, 只看不改),
    // which is also the CLI/admin default (`main.ts` `openImpl`); the browser marks a
    // folder trusted only through the explicit `project.trust` act the UI prompts for.
    // An already-open project keeps its recorded trust — `ProjectDirectory.open` is
    // idempotent for a live handle and ignores this option — so re-opening can never
    // launder a revocation.
    const trust = params['trust'];
    if (trust !== undefined && typeof trust !== 'boolean') {
      throw new ProtocolError('VALIDATION_ERROR', 'trust must be a boolean');
    }
    void directory
      .open(root, trust === undefined ? { trust: false } : { trust })
      .catch((error: unknown) => {
        this.emitOperationFailed(operationId, 'project.open', root, error);
      });
    return {
      status: 'accepted',
      operationId,
      projectId,
      root,
      version: 0,
      trust: trust === true ? 'trusted' : 'untrusted',
      gitState: { gitRoot: null, head: null },
    };
  }

  /** `project.create` (`protocol.md` §3, AC-025). */
  private createProject(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
  ): unknown {
    const directory = this.projectDirectoryOrThrow('project.create');
    const root = requiredString(params, 'root');
    const name = requiredString(params, 'name');
    const operationId = options.idempotencyKey ?? this.services.store.newId();
    void directory.create(root, name).catch((error: unknown) => {
      this.emitOperationFailed(operationId, 'project.create', root, error);
    });
    return { status: 'accepted', operationId, projectId: null, root, name };
  }

  /** `project.clone` (`protocol.md` §3, AC-087; Q4's installation-level Grant). */
  private cloneProject(params: JsonObject, options: { readonly idempotencyKey?: string }): unknown {
    const directory = this.projectDirectoryOrThrow('project.clone');
    const remoteUrl = requiredString(params, 'remoteUrl');
    const root = requiredString(params, 'root');
    const grantId = requiredString(params, 'grantId');
    const operationId = options.idempotencyKey ?? this.services.store.newId();
    void directory.clone(remoteUrl, root, grantId).catch((error: unknown) => {
      this.emitOperationFailed(operationId, 'project.clone', root, error);
    });
    return { status: 'accepted', operationId, projectId: null, root, remoteUrl };
  }

  /** `project.trust` (`protocol.md` §3: revoking trust stops new admission). */
  private trustProject(params: JsonObject, options: { readonly projectId?: string }): unknown {
    const directory = this.projectDirectoryOrThrow('project.trust');
    const projectId = this.lifecycleTarget(options, 'project.trust');
    const trusted = params['trusted'];
    if (typeof trusted !== 'boolean') {
      throw new ProtocolError('VALIDATION_ERROR', 'trusted must be a boolean');
    }
    const entry = directory.trust(projectId, trusted);
    return {
      status: 'applied',
      entityId: projectId,
      version: 0,
      projectId,
      trust: entry.trust,
      // `protocol.md` §3: the revocation is what matters, so the answer names it.
      admission: entry.trust === 'trusted' ? 'open' : 'stopped',
    };
  }

  /** `project.close` (`protocol.md` §3; navigation-level per Q3). */
  private closeProject(params: JsonObject, options: { readonly projectId?: string }): unknown {
    const directory = this.projectDirectoryOrThrow('project.close');
    const projectId = this.lifecycleTarget(options, 'project.close');
    const entry = directory.close(projectId);
    return {
      status: 'applied',
      entityId: projectId,
      version: 0,
      projectId,
      state: entry.state,
    };
  }

  /** `project.initialize` (`protocol.md` §3, T5.3). */
  private initializeProject(
    params: JsonObject,
    options: { readonly idempotencyKey?: string; readonly projectId?: string },
  ): unknown {
    const directory = this.projectDirectoryOrThrow('project.initialize');
    const projectId = this.lifecycleTarget(options, 'project.initialize');
    const sourceMessageId = requiredString(params, 'sourceMessageId');
    const mode = params['mode'];
    if (mode !== undefined && mode !== 'new' && mode !== 'legacy') {
      throw new ProtocolError('VALIDATION_ERROR', 'mode must be new or legacy');
    }
    const budget: { files?: number; bytes?: number } = {};
    const rawBudget = params['budget'];
    if (rawBudget !== undefined) {
      if (typeof rawBudget !== 'object' || rawBudget === null || Array.isArray(rawBudget)) {
        throw new ProtocolError('VALIDATION_ERROR', 'budget must be an object');
      }
      const record = rawBudget as JsonObject;
      for (const key of ['files', 'bytes'] as const) {
        const value = record[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
          throw new ProtocolError('VALIDATION_ERROR', `budget.${key} must be a positive integer`);
        }
        if (key === 'files') budget.files = value;
        else budget.bytes = value;
      }
    }
    const operationId = options.idempotencyKey ?? this.services.store.newId();
    void directory
      .initialize(projectId, {
        sourceMessageId,
        ...(mode === undefined ? {} : { mode }),
        ...(Object.keys(budget).length === 0 ? {} : { budget }),
      })
      .catch((error: unknown) => {
        this.emitOperationFailed(operationId, 'project.initialize', projectId, error);
      });
    return { status: 'accepted', operationId, projectId };
  }

  private projectSnapshot(): unknown {
    const project = this.services.store.projects.find(this.projectId) ?? null;
    const entry = this.services.projectDirectory?.entryOf(this.projectId);
    const initialization = entry?.initialization ?? null;
    return {
      projectId: this.projectId,
      project,
      cursor: this.services.events.watermark(),
      counts: {
        conversations: this.services.store.conversations.count(),
        works: this.services.store.works.count(),
        requirements: this.services.store.requirements.count(),
        runs: this.services.store.runs.count(),
      },
      // WP-12 T5: the facts `/projects` and the ADM read without a second round trip.
      trust: project?.trust ?? entry?.trust ?? 'untrusted',
      initialization,
      // The same state the Run gate (T2/T8) consumes: T5 only produces the facts
      // (WP-12 T5 Q7).
      deliveryReadiness:
        initialization === null
          ? null
          : initialization.done
            ? { ok: true, blockerKind: null, message: null, dirtyPaths: [] }
            : {
                ok: initialization.blockerKind === null,
                blockerKind: initialization.blockerKind,
                message: initialization.blockerMessage,
                dirtyPaths: initialization.dirtyPaths,
              },
      requirementImport: entry?.import ?? null,
    };
  }

  /** The directory, or the typed refusal of a daemon whose host did not attach one. */
  private projectDirectoryOrThrow(method: string): ProjectDirectoryPort {
    const directory = this.services.projectDirectory;
    if (directory === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        `${method} needs the installation project directory, which this daemon does not have`,
        { details: { method } },
      );
    }
    return directory;
  }

  /**
   * The project a lifecycle command targets.
   *
   * `project.trust/close/initialize` are global methods whose params carry no
   * `projectId` (`protocol.md` §1/§3), so the envelope's `projectId` is the target; a
   * missing one is a validation error rather than a guess.
   */
  private lifecycleTarget(options: { readonly projectId?: string }, method: string): string {
    const projectId = options.projectId;
    if (projectId === undefined || projectId === '') {
      throw new ProtocolError('VALIDATION_ERROR', `${method} requires the envelope's projectId`, {
        details: { method },
      });
    }
    return projectId;
  }

  /**
   * Emits `operation.failed` for a lifecycle command that failed after it answered
   * `accepted` (`protocol.md` §7, Q9).
   *
   * The event lands in the stream of the project the caller was talking to — never in
   * an installation-level stream, which does not exist (Q9). The command envelope
   * already said `accepted`, so this event is the honest follow-up; the admin/CLI
   * surfaces get the error code and the same `operationId` directly.
   */
  private emitOperationFailed(
    operationId: string,
    method: string,
    subject: string,
    error: unknown,
  ): void {
    const code =
      error instanceof Error && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    this.services.log?.(`agentdevd: ${method} failed (${code}) for ${subject}: ${message}`);
    try {
      this.services.store.events.append({
        name: 'operation.failed',
        entityId: operationId,
        entityVersion: 1,
        data: { operationId, method, subject, code, message },
      });
    } catch (appendError) {
      // A diagnostic must never replace the real failure.
      this.services.log?.(
        `agentdevd: operation.failed for ${operationId} could not be recorded: ${
          appendError instanceof Error ? appendError.message : String(appendError)
        }`,
      );
    }
  }

  private listConversations(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const rows = this.services.store.conversations.list({ orderBy: 'updated_at DESC' });
    return {
      items: rows.slice(0, limit).map((conversation) => ({
        ...conversation,
        messageCount: this.services.store.messages.count('conversation_id = ?', [conversation.id]),
      })),
      nextCursor: null,
    };
  }

  /**
   * `conversation.create` — a new Chief conversation (`protocol.md` §3).
   *
   * `experience.md` §1 keeps creation and switching on the Chief page; the row is
   * the real one the Chief page then reads, so the control that calls this method
   * is never a dead button (AC-072).
   */
  private createConversation(
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller },
  ): unknown {
    const store = this.services.store;
    const title = optionalString(params['title']) ?? 'Chief conversation';
    const focusWorkId = optionalString(params['focusWorkId']);
    if (focusWorkId !== undefined && store.works.find(focusWorkId) === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${focusWorkId} does not exist`, {
        details: { focusWorkId },
      });
    }
    return withTransaction(store.db, () => {
      const conversation = store.conversations.insert({
        title,
        archived: false,
        ...(focusWorkId === undefined ? {} : { focusWorkId }),
      });
      store.events.append({
        name: 'conversation.created',
        entityId: conversation.id,
        entityVersion: conversation.version,
        data: {
          conversationId: conversation.id,
          title: conversation.title,
          focusWorkId: conversation.focusWorkId ?? null,
          ownerUserId: options.caller.userId,
        },
      });
      return {
        status: 'applied',
        entityId: conversation.id,
        version: conversation.version,
        conversationId: conversation.id,
        conversation,
      };
    });
  }

  private getConversation(params: JsonObject): unknown {
    const conversationId = requiredString(params, 'conversationId');
    const conversation = this.services.store.conversations.find(conversationId);
    if (conversation === undefined) {
      throw new ProtocolError('NOT_FOUND', `conversation ${conversationId} does not exist`);
    }
    const limit = boundedLimit(params['limit']);
    const messages = this.services.store.messages
      .list({ where: 'conversation_id = ?', params: [conversationId], orderBy: 'seq ASC' })
      .slice(-limit)
      .map((message) => {
        const body = this.services.store.messageBodies.find(message.bodyRef);
        return {
          ...message,
          // The body text is a user fact returned verbatim; the UI never
          // machine-translates it (`experience.md` §6).
          body: body === undefined ? null : this.readMessageBody(body.relativeBlobPath),
          translatable: false,
        };
      });
    return { conversation, messages, nextCursor: null };
  }

  private listKnowledge(params: JsonObject): unknown {
    const view = knowledgeView(params['view']);
    const projections = this.services.store.featureProjections.list({
      orderBy: 'revision ASC, feature_id ASC',
    });
    const revision =
      optionalString(params['revision']) ?? projections.at(-1)?.revision ?? 'working-tree';
    const rows = projections.filter((row) => row.revision === revision);
    const query = optionalString(params['query'])?.toLowerCase();
    const items = rows
      .map((row) => ({
        featureId: row.featureId,
        documentPath: row.documentPath,
        documentHash: row.documentHash,
        state: row.state,
        // The listing carries the projection fields so a client never has to guess
        // which key belongs to which of the three separated answers.
        fields: row.fields,
        relations: row.relations,
      }))
      .filter((item) =>
        query === undefined
          ? true
          : item.featureId.toLowerCase().includes(query) ||
            item.documentPath.toLowerCase().includes(query),
      );
    return {
      view,
      items,
      sourceRevision: revision,
      projectionState: rows.some((row) => row.state === 'stale') ? 'stale' : 'valid',
      unknown: this.knowledgeUnknowns(revision, rows.length),
      nextCursor: null,
    };
  }

  private getKnowledge(params: JsonObject): unknown {
    const featureId = requiredString(params, 'featureId');
    const view = knowledgeView(params['view']);
    const rows = this.services.store.featureProjections.list({
      where: 'feature_id = ?',
      params: [featureId],
      orderBy: 'revision ASC',
    });
    const row = rows.at(-1);
    if (row === undefined) {
      throw new ProtocolError('NOT_FOUND', `unknown feature ${featureId}`, {
        details: { featureId },
      });
    }
    if (view === 'work') {
      const workId = requiredString(params, 'workId');
      const work = this.services.store.works.find(workId);
      if (work === undefined) {
        throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
      }
      const declared = Array.isArray(row.fields['featureRefs'])
        ? (row.fields['featureRefs'] as unknown[]).includes(featureId)
        : false;
      return {
        featureId,
        view,
        sourceRevision: row.revision,
        projectionState: row.state,
        baseRevision: work.baseRevision ?? null,
        // The overlay is a target and never changes the delivered answer
        // (`context.md` §3, `experience.md` §4).
        overlay: { workId, featureId, declared },
        delivered: this.featureView(row, 'delivered'),
        notDelivered: true,
        unknowns: [...this.knowledgeUnknowns(row.revision, rows.length), WORK_VIEW_UNKNOWN],
        sourceRefs: this.sourceRefsOf(row),
      };
    }
    return {
      ...this.featureView(row, view),
      unknowns: this.knowledgeUnknowns(row.revision, rows.length),
      sourceRefs: this.sourceRefsOf(row),
    };
  }

  /**
   * `context.preview` (`protocol.md` §5, `context.md` §1).
   *
   * Runs the **real** `buildContext` selection/ACL/gate/required-input/budget logic
   * in dry-run mode over production ports: the Project's config policy, the
   * `docs/rules/agents.md` role contract at the Work's base revision, Git blobs and
   * the artifact store. No snapshot directory is written, and an out-of-scope source
   * is refused by the same ACL that a real Run would hit — a preview can never widen
   * a scope (`context.md` §1 "需要读更广范围由 context.request 返回 Chief 处理").
   */
  private previewContext(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const role = requiredString(params, 'role');
    if (!(ROLES as readonly string[]).includes(role)) {
      throw new ProtocolError('VALIDATION_ERROR', `role ${role} is not a documented role`, {
        details: { role },
      });
    }
    const parsed = contextSelectionSchema.safeParse(params['selection'] ?? {});
    if (!parsed.success) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `selection is not a documented ContextSelection: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
        { details: { issues: parsed.error.issues.map((issue) => issue.message) } },
      );
    }
    const selection: ContextSelection = parsed.data;
    const store = this.services.store;
    const work = store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    const project = store.projects.find(this.projectId);
    if (project === undefined) {
      throw new ProtocolError('INVALID_STATE', `Project ${this.projectId} is not registered`);
    }
    const config = this.requireConfig();
    const root = project.gitRoot ?? project.root;
    const baseRevision = work.baseRevision ?? project.head ?? '';
    const stage = contextPreviewStage(role as Role, work.level);
    const scope: ProjectScope = {
      projectId: this.projectId,
      codeRoot: project.codeRoot,
      documentRoot: project.documentRoot,
      deliveryBranch: project.deliveryBranch,
      workId,
    };
    // The policy is the Project's own config policy (`config.ts` `policyConfigSchema`)
    // and the role contract is the committed `docs/rules/agents.md`; both are real
    // Project facts, never invented text.
    const policyContent = canonicalJson(config.project().policy);
    const policyHash = sha256Hex(Buffer.from(policyContent, 'utf8'));
    const roleContractBody =
      this.readGitText(root, baseRevision, CHIEF_RULES_PATH) ?? CHIEF_RULES_FALLBACK;
    const gates: ContextGatesPort = {
      current: () => ({
        ok: true,
        policyRevision: String(work.policyRevision),
        policyContent,
        roleContract: { id: CHIEF_RULES_PATH, body: roleContractBody },
      }),
    };
    const resolver: SourceResolverPort = {
      resolve: ({ ref }) =>
        this.resolveContextSource(ref, {
          root,
          baseRevision,
          policyContent,
          policyHash,
          policyRevision: String(work.policyRevision),
          role: role as Role,
          roleContractBody,
        }),
    };
    const content: ContentFetchPort = {
      fetch: (ref) => {
        if (ref.kind === 'git') {
          const blob = this.workspaceFiles.read(root, ref.revision, ref.path);
          if (blob === null) {
            return { ok: false, code: 'NOT_FOUND', message: `${ref.path}@${ref.revision} 不存在` };
          }
          return { ok: true, content: blob.content.toString('utf8') };
        }
        try {
          const artifact = this.services.artifacts.get(ref.id, Number(ref.version));
          return {
            ok: true,
            content: Buffer.from(this.services.artifacts.read(artifact)).toString('utf8'),
          };
        } catch {
          return { ok: false, code: 'ARTIFACT_MISSING', message: `artifact ${ref.id} 不可读` };
        }
      },
    };
    // Never reached: a dry-run returns before freezing, so the port is a guard that
    // turns an accidental write into a loud failure instead of a silent artifact.
    const snapshotWriter: SnapshotWriterPort = {
      write: () => {
        throw new ProtocolError('INTERNAL_ERROR', 'context.preview must not write a snapshot');
      },
    };
    // The logical inputs a preview may assert are the ones the store really holds:
    // the Work goal, the Project policy, a user message when the Work came from one,
    // and the Work's own authorization. Anything else stays missing, so the preview
    // reports it instead of claiming a ProductDefinition it never read.
    const contextInputs: ContextInputKey[] = ['workGoal', 'policy'];
    if (work.sourceRef.kind === 'message') contextInputs.push('userRequest');
    if (work.authorizationRef !== undefined) contextInputs.push('authorization');
    const built = buildContext({
      selection,
      role: role as never,
      stage,
      project: scope,
      configHash: policyHash,
      runId: `preview:${workId}`,
      workId,
      contextInputs,
      resolver,
      content,
      gates,
      snapshotWriter,
      preview: true,
    });
    if (!built.ok) {
      throw new ProtocolError(built.code, built.errors.map((error) => error.message).join('; '), {
        details: {
          errors: built.errors.map((error) => ({
            code: error.code,
            message: error.message,
            ref: error.ref === undefined ? null : jsonSafe(error.ref),
          })),
        },
      });
    }
    const snapshot = built.snapshot;
    return {
      status: 'accepted',
      workId,
      role,
      stage,
      revision: baseRevision,
      resolved: snapshot.resolvedSources.map((source) => ({ ...source })),
      excluded: snapshot.excluded.map((entry) => ({
        ref: jsonSafe(entry.ref),
        reason: entry.reason,
      })),
      missing: snapshot.unknowns.map((entry) => ({
        ref: jsonSafe(entry.ref),
        reason: entry.reason,
      })),
      estimatedTokens: snapshot.tokenAccounting.initial.used,
      initialLimit: snapshot.tokenAccounting.initial.limit,
      expansionLimit: snapshot.tokenAccounting.expansion.limit,
      policyHash: snapshot.policyHash,
      configHash: snapshot.configHash,
      readScopeDigest: snapshot.readScopeDigest,
    };
  }

  /** Reads one committed text file at a revision; `null` when it is absent. */
  private readGitText(root: string, revision: string, path: string): string | null {
    if (root === '' || revision === '') return null;
    const blob = this.workspaceFiles.read(root, revision, path);
    return blob === null ? null : blob.content.toString('utf8');
  }

  /**
   * Resolves one authorised context source into its frozen identity (`context.md` §1).
   *
   * The builder performs the ACL/scope checks before calling this; the resolver only
   * answers "what bytes, at which revision, with which hash". A transcript is refused
   * outright (`agents.md` §2), and a source kind this preview cannot read honestly is
   * `CONTEXT_FORBIDDEN` rather than a fabricated hash.
   */
  private resolveContextSource(
    ref: ContextSourceRef,
    context: {
      readonly root: string;
      readonly baseRevision: string;
      readonly policyContent: string;
      readonly policyHash: string;
      readonly policyRevision: string;
      readonly role: Role;
      readonly roleContractBody: string;
    },
  ): SourceResolutionResult {
    switch (ref.kind) {
      case 'git':
      case 'knowledge': {
        const revision = ref.version ?? context.baseRevision;
        const path = ref.path ?? ref.id;
        if (revision === '') {
          return { ok: false, code: 'NOT_FOUND', message: `${path} 没有可用 revision` };
        }
        const blob = this.workspaceFiles.read(context.root, revision, path);
        if (blob === null) {
          return { ok: false, code: 'NOT_FOUND', message: `${path}@${revision} 不存在` };
        }
        return {
          ok: true,
          kind: 'git',
          path,
          revision,
          hash: sha256Hex(blob.content),
          fetch: { kind: 'git', revision },
          fetchRef: { kind: 'git', path, revision },
        };
      }
      case 'artifact': {
        const version = ref.version ?? '1';
        try {
          const artifact = this.services.artifacts.get(ref.id, Number(version));
          return {
            ok: true,
            kind: 'artifact',
            version,
            hash: artifact.contentHash,
            fetch: { kind: 'artifact' },
            fetchRef: { kind: 'artifact', id: ref.id, version },
          };
        } catch {
          return { ok: false, code: 'NOT_FOUND', message: `artifact ${ref.id}@${version} 不存在` };
        }
      }
      case 'policy':
        return {
          ok: true,
          kind: 'policy',
          revision: context.policyRevision,
          hash: context.policyHash,
          fetch: { kind: 'none' },
          content: context.policyContent,
        };
      case 'role_contract':
        return {
          ok: true,
          kind: 'role_contract',
          role: context.role,
          revision: context.policyRevision,
          hash: sha256Hex(Buffer.from(context.roleContractBody, 'utf8')),
          fetch: { kind: 'none' },
          content: context.roleContractBody,
        };
      case 'message': {
        const message = this.services.store.messages.find(ref.id);
        const body =
          message === undefined
            ? undefined
            : this.services.store.messageBodies.find(message.bodyRef);
        const text = body === undefined ? null : this.readMessageBody(body.relativeBlobPath);
        if (text === null) {
          return { ok: false, code: 'NOT_FOUND', message: `message ${ref.id} has no body` };
        }
        return {
          ok: true,
          kind: 'policy',
          revision: ref.version ?? '1',
          hash: sha256Hex(Buffer.from(text, 'utf8')),
          fetch: { kind: 'none' },
          content: text,
        };
      }
      case 'transcript':
        return {
          ok: false,
          code: 'CONTEXT_FORBIDDEN',
          message: `transcript ${ref.id} 禁止作为上下文输入（agents.md §2）`,
        };
      default:
        return {
          ok: false,
          code: 'CONTEXT_FORBIDDEN',
          message: `source kind ${String(ref.kind)} 不可作为 context.preview 的内容输入`,
        };
    }
  }

  /**
   * The board projection (`experience.md` §4, AC-068).
   *
   * Requirements are read by their own id — no copied object — L1/report-only work
   * stays out of the board, and a Queued requirement with no local Work is still
   * cancellable while a pause on it is refused by `work.control`.
   */
  private board(): unknown {
    const requirements = this.services.store.requirements.list({ orderBy: 'created_at ASC' });
    const gitContext = this.gitContext();
    const columns: Record<string, unknown[]> = {
      queued: [],
      active: [],
      completed: [],
      archived: [],
    };
    for (const requirement of requirements) {
      const work =
        requirement.workId === undefined
          ? undefined
          : this.services.store.works.find(requirement.workId);
      const card = {
        requirementId: requirement.id,
        // The same Requirement id is always the board identity: the execution Work
        // is a projection of it, never a second object (`AC-068`).
        identity: requirement.id,
        title: requirement.title,
        goal: requirement.goal,
        lifecycle: requirement.lifecycle,
        previousLifecycle: requirement.previousLifecycle ?? null,
        phase: requirement.phase ?? null,
        recordVersion: requirement.recordVersion,
        portableRef: requirement.portableRef,
        // The Git-side facts the card's branch/commit/unpushed line renders
        // (`requirements.md` §3, AC-090); `null` only when the Project has no root.
        git: gitContext === null ? null : this.gitFactsOf(requirement, gitContext),
        executionAvailability: requirement.executionAvailability,
        evidenceAvailability: requirement.evidenceAvailability,
        saveState: this.saveStateOf(requirement.id),
        work:
          work === undefined
            ? null
            : {
                id: work.id,
                status: work.status,
                level: work.level,
                intent: work.intent,
                blockers: [...work.blockerIds],
              },
        tasks: work === undefined ? emptyTaskCounts() : this.taskCounts(work.id),
        awaitingDecision: work === undefined ? 0 : this.pendingDecisionCount(work.id),
        // A Queued requirement without local Work can be cancelled from the board;
        // pause is refused with INVALID_STATE (`AC-068`).
        canCancelWithoutWork: work === undefined && requirement.lifecycle === 'queued',
        canPause: work !== undefined,
      };
      if (requirement.lifecycle === 'queued') columns['queued']?.push(card);
      else if (requirement.lifecycle === 'active') columns['active']?.push(card);
      else if (requirement.lifecycle === 'completed') columns['completed']?.push(card);
      else columns['archived']?.push(card);
    }
    // Independent L1 / assist work never enters the board; it is visible in Chief
    // and Runs only (`experience.md` §4).
    const excluded = this.services.store.works
      .list({ orderBy: 'created_at ASC' })
      .filter((work) => work.level === 'L1' || work.level === 'none');
    return {
      columns,
      requirementIds: requirements.map((requirement) => requirement.id),
      excludedWorkIds: excluded.map((work) => work.id),
      rule: {
        l1NotOnBoard: true,
        queuedWithoutWorkCancellable: true,
        pauseQueuedWithoutWork: 'INVALID_STATE',
      },
    };
  }

  private listWorks(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const filter = optionalString(params['filter']);
    const rows = this.services.store.works.list({ orderBy: 'created_at DESC' });
    const items = rows
      .filter((work) => (filter === undefined ? true : work.status === filter))
      .slice(0, limit)
      .map((work) => ({
        ...work,
        taskCounts: this.taskCounts(work.id),
        runCount: this.services.store.runs.count('work_id = ?', [work.id]),
      }));
    return { items, nextCursor: null };
  }

  private getWork(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    return {
      work,
      tasks: this.services.store.tasks.list({ where: 'work_id = ?', params: [workId] }),
      runs: this.services.store.runs.list({
        where: 'work_id = ?',
        params: [workId],
        orderBy: 'created_at ASC',
      }),
      assessment:
        this.services.store.assessments
          .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at ASC' })
          .at(-1) ?? null,
      requirement:
        work.requirementId === undefined
          ? null
          : (this.services.store.requirements.find(work.requirementId) ?? null),
    };
  }

  private listRequirements(params: JsonObject): unknown {
    const limit = boundedLimit(params['limit']);
    const lifecycle = optionalString(params['lifecycle']);
    const rows = this.services.store.requirements.list({ orderBy: 'created_at DESC' });
    const gitContext = this.gitContext();
    const items = rows
      .filter((row) => (lifecycle === undefined ? true : row.lifecycle === lifecycle))
      .slice(0, limit)
      // `protocol.md` §8: the list carries metadata and the portable ref, never the
      // long Markdown body. The Git facts are metadata, so they are part of the row.
      .map((row) =>
        this.requirementSummary(row, gitContext === null ? null : this.gitFactsOf(row, gitContext)),
      );
    return { items, nextCursor: null };
  }

  private getRequirement(params: JsonObject): unknown {
    const requirementId = requiredString(params, 'requirementId');
    const row = this.services.store.requirements.find(requirementId);
    if (row === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`);
    }
    const work = row.workId === undefined ? undefined : this.services.store.works.find(row.workId);
    const gitContext = this.gitContext();
    return {
      ...row,
      work: work ?? null,
      saveState: this.saveStateOf(row.id),
      // `protocol.md` §8: `get` returns the complete `contentMarkdown` so the detail
      // page's body is the committed record, not an empty placeholder. A record whose
      // revision cannot be read back answers `null` rather than an invented body.
      contentMarkdown: this.contentMarkdownOf(row),
      // The card/detail branch/commit/unpushed facts (`requirements.md` §3, AC-090).
      git: gitContext === null ? null : this.gitFactsOf(row, gitContext),
      // An imported active record with no local site is honestly "waiting to
      // continue"; it has no Run (`experience.md` §4, `AC-089`).
      waitingToContinue: row.workId === undefined && row.lifecycle === 'active',
      continuationCandidates: this.continuableIds(),
    };
  }

  /**
   * The full Markdown body of one requirement record (`protocol.md` §8).
   *
   * The body lives in `content.md` at the record's own revision, so it is read back
   * through the same Git reader the save path uses. A record that was never committed
   * (`working-tree`) falls back to the working-tree file, which is the only truthful
   * source then; if neither exists the answer is `null`.
   */
  private contentMarkdownOf(row: Requirement): string | null {
    const record = this.readRequirementRecord(row);
    if (
      record !== null &&
      typeof record.contentMarkdown === 'string' &&
      record.contentMarkdown !== ''
    ) {
      return record.contentMarkdown;
    }
    const project = this.services.store.projects.find(this.projectId);
    const root = project?.gitRoot ?? project?.root;
    const directory = row.portableRef.path;
    if (root === undefined || root === '' || directory === undefined || directory === '') {
      return null;
    }
    try {
      return readFileSync(join(root, directory, REQUIREMENT_CONTENT_FILE_NAME), 'utf8');
    } catch {
      return null;
    }
  }

  private listRuns(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const rows = this.services.store.runs.list({
      where: 'work_id = ?',
      params: [workId],
      orderBy: 'created_at ASC',
    });
    return {
      items: rows.map((run) => ({
        ...run,
        attempts: this.services.store.attempts.list({
          where: 'run_id = ?',
          params: [run.id],
          orderBy: 'number ASC',
        }),
      })),
      nextCursor: null,
    };
  }

  private getRun(params: JsonObject): unknown {
    const runId = requiredString(params, 'runId');
    const run = this.services.store.runs.find(runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`);
    }
    return {
      run,
      attempts: this.services.store.attempts.list({
        where: 'run_id = ?',
        params: [runId],
        orderBy: 'number ASC',
      }),
      stageResults: this.services.store.stageResults.list({
        where: 'run_id = ?',
        params: [runId],
        orderBy: 'created_at ASC',
      }),
      task: run.taskId === undefined ? null : (this.services.store.tasks.find(run.taskId) ?? null),
    };
  }

  /**
   * `command.get` (`protocol.md` §4): the recorded terminal answer of one write key.
   *
   * The lookup is scoped to the calling subject ("仅同调用主体可查"), so one browser
   * session can never read another's recorded response. A key that was never used —
   * or belongs to another subject — is `NOT_FOUND`, which is also the honest answer
   * for a write that has not completed yet.
   */
  private getCommand(
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller },
  ): JsonObject {
    const operation = requiredString(params, 'operation');
    const key = requiredString(params, 'idempotencyKey');
    const found = this.services.store.commands.lookup(options.caller.subject, operation, key);
    if (found === undefined) {
      throw new ProtocolError('NOT_FOUND', `no ${operation} command with that idempotency key`, {
        details: { operation, idempotencyKey: key },
      });
    }
    return { state: found.state, response: jsonSafe(found.response) };
  }

  /**
   * `file.list` (`protocol.md` §5): the entries of one path at a named Git revision.
   *
   * A revision the repository does not hold, or a path outside it, is `NOT_FOUND`;
   * the answer never falls back to the working tree, which can be stale.
   */
  private listFiles(params: JsonObject): JsonObject {
    const revision = requiredString(params, 'revision');
    const path = optionalString(params['path']) ?? '';
    const limit = boundedLimit(params['limit']);
    const root = this.projectGitRoot();
    const entries = this.workspaceFiles.list(root, revision, path);
    if (entries === null) {
      throw new ProtocolError('NOT_FOUND', `revision ${revision} has no path ${path || '.'}`, {
        details: { revision, path },
      });
    }
    return {
      revision,
      path,
      items: entries.slice(0, limit).map((entry) => ({ ...entry })),
      nextCursor: entries.length > limit ? String(limit) : null,
    };
  }

  /**
   * `file.read` (`protocol.md` §5): one blob at a named revision.
   *
   * The content is bounded: a body over the caller's `limit` (KiB is not implied, the
   * limit is a byte count with the documented default) is truncated and reported as
   * such, so a preview can never pull an unbounded file into a response.
   */
  private readFile(params: JsonObject): JsonObject {
    const revision = requiredString(params, 'revision');
    const path = requiredString(params, 'path');
    const limit = optionalInteger(params['limit']) ?? 1_048_576;
    const root = this.projectGitRoot();
    const blob = this.workspaceFiles.read(root, revision, path);
    if (blob === null) {
      throw new ProtocolError('NOT_FOUND', `revision ${revision} has no path ${path}`, {
        details: { revision, path },
      });
    }
    const truncated = blob.content.byteLength > limit;
    const content = truncated ? blob.content.subarray(0, limit) : blob.content;
    return {
      revision,
      path,
      content: content.toString('utf8'),
      mime:
        FILE_MIME_TYPES[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream',
      hash: createHash('sha256').update(blob.content).digest('hex'),
      bytes: blob.content.byteLength,
      truncated,
    };
  }

  /** The Git root of the current Project, or `INVALID_STATE` when it has none. */
  private projectGitRoot(): string {
    const project = this.services.store.projects.find(this.projectId);
    const root = project?.gitRoot ?? project?.root;
    if (root === undefined || root === '') {
      throw new ProtocolError('INVALID_STATE', 'this Project has no Git root', {
        details: { projectId: this.projectId },
      });
    }
    return root;
  }

  /**
   * `extension.list` (`protocol.md` §5): the shipped whitelist with its state.
   *
   * `execution.md` §7 fixes this release's built-in list at empty, so the honest
   * answer is an empty manifest — not a fabricated extension entry.
   */
  private listExtensions(): JsonObject {
    const manifest = this.services.extensions ?? [];
    return {
      apiVersion: 1,
      items: manifest.map((extension) => ({
        id: extension.id,
        version: extension.version,
        apiVersion: extension.apiVersion,
        capabilities: [...extension.capabilities],
        critical: extension.critical,
        enabled: extension.enabledByDefault,
        health: 'ok',
      })),
    };
  }

  /**
   * `extension.set` (`protocol.md` §5): enable/disable one shipped extension.
   *
   * An id outside the release whitelist is `NOT_FOUND`, and disabling a `critical`
   * extension is refused as documented — the release that ships an entry says so.
   */
  private setExtension(params: JsonObject): JsonObject {
    const id = requiredString(params, 'id');
    const enabled = params['enabled'];
    if (typeof enabled !== 'boolean') {
      throw new ProtocolError('VALIDATION_ERROR', 'extension.set needs a boolean enabled', {
        details: { id, enabled: params['enabled'] ?? null },
      });
    }
    const extension = (this.services.extensions ?? []).find((entry) => entry.id === id);
    if (extension === undefined) {
      throw new ProtocolError('NOT_FOUND', `extension ${id} is not in this release's whitelist`, {
        details: { id },
      });
    }
    if (!enabled && extension.critical) {
      throw new ProtocolError(
        'INVALID_STATE',
        `extension ${id} is critical and cannot be disabled`,
        { details: { id, critical: true } },
      );
    }
    return {
      status: 'applied',
      entityId: extension.id,
      version: 1,
      extension: {
        id: extension.id,
        enabled,
        critical: extension.critical,
        // This release has no runtime enable/disable store, so the answer states the
        // requested state without claiming a persistence it does not have.
        persisted: false,
      },
    };
  }

  /**
   * `run.pause`/`run.resume`/`run.cancel` (`protocol.md` §4).
   *
   * A Run is a child of its Work, so these are thin views over the real
   * `FindingService` Work controls: the Run names its Work and the same durable
   * barrier/Gate semantics apply. A Run whose Work has a required child Run keeps the
   * Gate blocked, so cancelling never silently unblocks a dependent.
   */
  private controlRun(
    action: 'pause' | 'resume' | 'cancel',
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
  ): JsonObject {
    const runId = requiredString(params, 'runId');
    const reason = optionalString(params['reason']) ?? '';
    const store = this.services.store;
    const run = store.runs.find(runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`, { details: { runId } });
    }
    const work = store.works.find(run.workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${run.workId} does not exist`, {
        details: { runId, workId: run.workId },
      });
    }
    const operationId = options.idempotencyKey ?? store.newId();
    const findings = this.requireFindings();
    if (action === 'pause') {
      const result = findings.pauseWork({ workId: work.id, ...(reason === '' ? {} : { reason }) });
      if (!result.ok) {
        throw new ProtocolError(result.code, result.message, {
          details: { runId, workId: work.id },
        });
      }
      return {
        status: 'accepted',
        operationId,
        runId,
        workId: work.id,
        version: result.work.version,
        pausedRunIds: result.pausedRuns.map((entry) => entry.runId),
      };
    }
    if (action === 'resume') {
      const result = findings.resumeWork({ workId: work.id, expectedWorkVersion: work.version });
      if (!result.ok) {
        throw new ProtocolError(result.code, result.message, {
          details: { runId, workId: work.id, currentVersion: result.currentVersion },
        });
      }
      return {
        status: 'accepted',
        operationId,
        runId,
        workId: work.id,
        version: result.work.version,
        attempts: result.attempts.map((attempt) => ({ ...attempt })),
      };
    }
    const result = findings.cancelWork({
      workId: work.id,
      ...(reason === '' ? {} : { reason }),
      ...(params['sideEffectsUnknown'] === true ? { sideEffectsUnknown: true } : {}),
    });
    if (!result.ok) {
      throw new ProtocolError(result.code, result.message, { details: { runId, workId: work.id } });
    }
    for (const cancelled of result.cancelledRunIds) {
      this.services.toolBridge?.cleanupRun(cancelled);
    }
    return {
      status: 'accepted',
      operationId,
      runId,
      workId: work.id,
      version: result.work.version,
      workStatus: result.status,
      cancelledRunIds: [...result.cancelledRunIds],
      preservedArtifactIds: [...result.preservedArtifactIds],
      requirementStatus: result.requirementStatus,
      // A required child that is still unsatisfied keeps the Gate blocked, so the
      // caller sees the recovery obligation instead of a silent completion.
      recoveryRequired: result.recoveryRequired,
      recoveryDecisionId: result.recoveryDecisionId,
    };
  }

  /**
   * `work.budget.update` (`protocol.md` §4): the user raises a Work's budget.
   *
   * The limits are user decisions, so the new envelope is recorded as a `budget`
   * Decision whose source is the user message the caller names. A limit below what is
   * already spent or reserved is refused rather than making the ledger inconsistent
   * (`BUDGET_EXCEEDED` is the documented "user adjusts" path).
   */
  private updateWorkBudget(params: JsonObject): JsonObject {
    const workId = requiredString(params, 'workId');
    const store = this.services.store;
    const work = store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    const budget = store.budgets.find(work.budgetId);
    if (budget === undefined) {
      throw new ProtocolError('INVALID_STATE', `Work ${workId} has no budget row`, {
        details: { workId },
      });
    }
    const sourceMessageId = requiredString(params, 'sourceMessageId');
    const message = store.messages.find(sourceMessageId);
    if (message === undefined) {
      throw new ProtocolError('NOT_FOUND', `message ${sourceMessageId} does not exist`, {
        details: { sourceMessageId },
      });
    }
    const tokenLimit = requiredInteger(params, 'tokenLimit');
    const timeLimit = requiredInteger(params, 'timeLimit');
    const repairLimit = requiredInteger(params, 'repairLimit');
    for (const [name, value] of [
      ['tokenLimit', tokenLimit],
      ['timeLimit', timeLimit],
      ['repairLimit', repairLimit],
    ] as const) {
      if (value <= 0) {
        throw new ProtocolError('VALIDATION_ERROR', `${name} must be positive`, {
          details: { [name]: value },
        });
      }
    }
    if (tokenLimit < budget.tokensUsed + budget.tokensReserved) {
      throw new ProtocolError(
        'BUDGET_EXCEEDED',
        `tokenLimit ${tokenLimit} is below the ${budget.tokensUsed + budget.tokensReserved} tokens already used or reserved`,
        { details: { workId, tokenLimit, committed: budget.tokensUsed + budget.tokensReserved } },
      );
    }
    const updated = store.budgets.update(
      budget.id,
      {
        tokenLimit,
        activeTimeLimit: timeLimit,
        repairLimit,
      },
      budget.version,
    );
    const decision = store.decisions.insert({
      workId,
      kind: 'budget',
      targetRef: {
        id: workId,
        version: updated.version,
        hash: sha256Of({ workId, tokenLimit, timeLimit, repairLimit }),
      },
      choices: ['accepted'],
      state: 'accepted',
      choice: 'accepted',
      actor: 'user',
      effectRefs: [],
    } as never);
    store.events.append({
      name: 'decision.created',
      entityId: workId,
      entityVersion: work.version,
      data: {
        workId,
        decisionId: decision.id,
        decisionKind: 'budget',
        sourceMessageId,
        tokenLimit,
        timeLimit,
        repairLimit,
        budgetVersion: updated.version,
      },
    });
    return {
      status: 'applied',
      entityId: workId,
      version: updated.version,
      workId,
      decisionId: decision.id,
      budget: jsonSafe(updated),
    };
  }

  private listArtifacts(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const artifacts = this.services.artifacts.list(workId);
    const latestByKind = new Map<string, number>();
    for (const artifact of artifacts) {
      const current = latestByKind.get(artifact.kind) ?? 0;
      if (artifact.artifactVersion > current) {
        latestByKind.set(artifact.kind, artifact.artifactVersion);
      }
    }
    return {
      items: artifacts.map((artifact) => ({
        ...artifact,
        // History is never presented as current without the version it belongs to
        // (`experience.md` §3, AC-070).
        isLatest: latestByKind.get(artifact.kind) === artifact.artifactVersion,
        versionCount: artifacts.filter((item) => item.kind === artifact.kind).length,
      })),
      nextCursor: null,
    };
  }

  private getArtifact(params: JsonObject): unknown {
    const artifactId = requiredString(params, 'artifactId');
    const version = optionalInteger(params['artifactVersion']);
    const role = optionalString(params['role']) ?? 'chief';
    const artifact = this.services.artifacts.get(artifactId, version);
    if (!isRole(role) || !this.services.artifacts.isReadable(artifact, role)) {
      throw new ProtocolError('NOT_AUTHORIZED', 'the artifact is not readable by this role', {
        details: { artifactId, role },
      });
    }
    const chain = this.services.artifacts
      .list(artifact.workId)
      .filter((item) => item.kind === artifact.kind);
    return {
      artifact,
      latestVersion: chain.at(-1)?.artifactVersion ?? artifact.artifactVersion,
      versions: chain.map((item) => ({
        artifactId: item.id,
        artifactVersion: item.artifactVersion,
        createdAt: item.createdAt,
        validity: item.validity,
      })),
      // The preview contract: a truncated inline body always advertises the
      // download path (`experience.md` §3).
      preview: {
        href: `/artifacts/${artifact.id}/preview`,
        downloadPrepare: { method: 'POST', path: '/artifacts/download.prepare' },
        maxInlineBytes: 1024 * 1024,
      },
    };
  }

  private prepareDownload(params: JsonObject): unknown {
    const artifactId = requiredString(params, 'artifactId');
    const version = optionalInteger(params['artifactVersion']);
    const artifact = this.services.artifacts.get(artifactId, version);
    if (!this.services.artifacts.isReadable(artifact, 'chief')) {
      throw new ProtocolError('NOT_AUTHORIZED', 'the artifact is not readable by this role');
    }
    this.services.tokens.prune();
    const grant = this.services.tokens.issue(artifact);
    return {
      status: 'applied',
      entityId: artifact.id,
      version: artifact.version,
      artifactId: grant.artifactId,
      artifactVersion: grant.artifactVersion,
      downloadToken: grant.token,
      expiresAt: grant.expiresAt,
      validity: artifact.validity,
    };
  }

  /**
   * The Inbox: pending decisions, blocking findings and recovery waits.
   *
   * `experience.md` §5 deduplicates by target + version, so a decision seen in many
   * events is one row, an expired target is not actionable, and non-blocking
   * findings are summarised rather than listed as blocking items.
   */
  private inbox(): unknown {
    const items: unknown[] = [];
    const seen = new Set<string>();
    for (const decision of this.services.store.decisions.list({ orderBy: 'created_at ASC' })) {
      const key = `decision:${decision.targetRef.id}:${decision.targetRef.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A `permission` decision stays a decision row, but the Inbox must report the
      // exact tool call it binds: without `operation`/`targets`/`runId`/`inputHash`
      // the page cannot say what an approval would grant and disables approve
      // (`protocol.md` §4/§6). The binding is read from the same `tool_operation` row
      // `permission.request` and `tool.refused` report, never from a client payload.
      const binding =
        decision.kind === 'permission'
          ? this.services.store.toolOperations.find(decision.targetRef.id)
          : undefined;
      // AC-011: an L3 confirmation is a `product` Decision whose question, risk flags and
      // held route the Inbox must state. The record is the one the dispatch guard reads,
      // so the card and the gate can never describe different confirmations.
      const confirmation = this.services.confirmations?.find(decision.id);
      items.push({
        kind: 'decision',
        id: decision.id,
        workId: decision.workId,
        decisionKind: decision.kind,
        targetRef: decision.targetRef,
        targetVersion: decision.targetRef.version,
        choices: [...decision.choices],
        state: decision.state,
        // An already resolved/expired target stays visible but must not be applied
        // again (`experience.md` §5).
        actionable: decision.state === 'pending',
        createdAt: decision.createdAt,
        ...(confirmation === undefined
          ? {}
          : {
              l3Confirmation: {
                workId: confirmation.workId,
                level: 'L3',
                riskFlags: [...confirmation.riskFlags],
                reason: confirmation.reason,
                revision: confirmation.revision,
                requirementId: confirmation.requirementId,
                scope: {
                  readPaths: [...confirmation.scope.readPaths],
                  writePaths: [...confirmation.scope.writePaths],
                  operations: [...confirmation.scope.operations],
                  networkTargets: [...confirmation.scope.networkTargets],
                },
                outcome: confirmation.state,
                declineReason: confirmation.declineReason,
              },
            }),
        ...(decision.kind !== 'permission'
          ? {}
          : {
              operation: binding?.toolName ?? null,
              targets: binding === undefined ? [] : [...binding.targets],
              runId: binding?.runId ?? this.runAwaitingPermission(decision.workId) ?? null,
              inputHash: binding?.inputHash ?? decision.targetRef.hash,
            }),
      });
    }
    const findings = new Map<string, { count: number; workId: string; severity: string }>();
    for (const finding of this.services.store.findings.list({ orderBy: 'created_at ASC' })) {
      if (!finding.blocking) continue;
      if (finding.state === 'verified' || finding.state === 'accepted_risk') continue;
      const key = `finding:${finding.workId}:${finding.severity}`;
      const existing = findings.get(key);
      if (existing === undefined) {
        findings.set(key, { count: 1, workId: finding.workId, severity: finding.severity });
      } else {
        existing.count += 1;
      }
    }
    for (const [key, summary] of findings) {
      items.push({
        kind: 'finding',
        id: key,
        workId: summary.workId,
        severity: summary.severity,
        // "内部修复汇总" — one row per Work+severity with the true count.
        count: summary.count,
        actionable: true,
      });
    }
    for (const run of this.services.store.runs.list({ orderBy: 'created_at ASC' })) {
      if (run.status !== 'recovery_required') continue;
      items.push({
        kind: 'recovery',
        id: run.id,
        workId: run.workId,
        runId: run.id,
        status: run.status,
        actionable: true,
      });
    }
    for (const todo of this.inboxUserTodos()) items.push(todo);
    const actionable = items.filter(
      (item) => (item as { actionable?: boolean }).actionable === true,
    ).length;
    return { items, unread: actionable };
  }

  /**
   * The user-facing Chief todos the Inbox renders (`protocol.md` §7).
   *
   * The permission phase files `chief_action_required(kind='sensitive_file')` when a
   * sensitive file (附录 A.2) is refused, and the frozen spec names the todo's reader:
   * the user must handle the file themselves (`T3-implementation.md` 附录 A.1-3). The
   * Inbox surfaces exactly those filings, one row per `(work, path, pattern)`, and drops
   * the ones the user closed through `chief.todo.resolve` (`chief.todo_resolved`).
   *
   * The todo carries refusal metadata only (path/pattern/action/configPolicy); the
   * refused file's content is never part of the event and therefore cannot reach a page.
   */
  private inboxUserTodos(): unknown[] {
    const resolved = this.resolvedTodoIds();
    return this.readUserTodos()
      .filter((todo) => !resolved.has(todo.todoId))
      .map((todo) => ({
        kind: 'todo',
        id: todo.todoId,
        workId: todo.workId,
        todoKind: SENSITIVE_FILE_TODO_KIND,
        action: todo.action,
        path: todo.path,
        pattern: todo.pattern,
        configPolicy: todo.configPolicy,
        runId: todo.runId,
        role: todo.role,
        // The daemon's own sentence is a diagnostic: the page renders its translated
        // instruction and keeps this as the row's title.
        reason: todo.reason,
        createdAt: todo.createdAt,
        // The user handles the file themselves (附录 A.1-3); the row stays actionable
        // until `chief.todo.resolve` closes it.
        actionable: true,
      }));
  }

  /**
   * Every `chief_action_required(kind='sensitive_file')` filing, oldest first.
   *
   * De-duplicated on `(work, path, pattern)` — the tool handler's own idempotency key —
   * so an older build that wrote the same todo twice still shows one row.
   */
  private readUserTodos(): UserTodoRecord[] {
    const todos: UserTodoRecord[] = [];
    const seen = new Set<string>();
    for (const event of this.scanEvents(['chief_action_required'])) {
      const data = event.data;
      if (data['kind'] !== SENSITIVE_FILE_TODO_KIND) continue;
      const workId = typeof data['workId'] === 'string' ? data['workId'] : event.entityId;
      const path = typeof data['path'] === 'string' ? data['path'] : '';
      const pattern = typeof data['pattern'] === 'string' ? data['pattern'] : '';
      const todoId = `${workId}:${path}:${pattern}`;
      if (seen.has(todoId)) continue;
      seen.add(todoId);
      todos.push({
        todoId,
        workId,
        action: typeof data['action'] === 'string' ? data['action'] : null,
        path: path === '' ? null : path,
        pattern: pattern === '' ? null : pattern,
        configPolicy: typeof data['configPolicy'] === 'string' ? data['configPolicy'] : null,
        runId: typeof data['runId'] === 'string' ? data['runId'] : null,
        role: typeof data['role'] === 'string' ? data['role'] : null,
        reason: typeof data['reason'] === 'string' ? data['reason'] : null,
        createdAt: event.occurredAt,
      });
    }
    return todos;
  }

  /** The `todoId`s the user has already closed; any disposition closes the row. */
  private resolvedTodoIds(): Set<string> {
    const resolved = new Set<string>();
    for (const event of this.scanEvents(['chief.todo_resolved'])) {
      const todoId = event.data['todoId'];
      if (typeof todoId === 'string' && todoId !== '') resolved.add(todoId);
    }
    return resolved;
  }

  /** The disposition already recorded for one todo, if the user closed it. */
  private todoResolution(todoId: string): string | undefined {
    for (const event of this.scanEvents(['chief.todo_resolved'])) {
      if (event.data['todoId'] !== todoId) continue;
      const disposition = event.data['disposition'];
      return typeof disposition === 'string' ? disposition : 'handled';
    }
    return undefined;
  }

  /**
   * One event name, oldest first, over the whole retained log.
   *
   * The scan starts at the oldest retained cursor: an `after` older than retention
   * throws `RESYNC_REQUIRED`, which must not fail an Inbox read or a resolution.
   */
  private scanEvents(names: readonly string[]): Event[] {
    const events = this.services.store.events;
    const found: Event[] = [];
    let cursor = Math.max(0, events.oldestCursor() - 1);
    for (;;) {
      const page = events.readAfter(cursor, { limit: 1_000, names: [...names] });
      if (page.length === 0) return found;
      found.push(...page);
      cursor = page[page.length - 1]?.cursor ?? cursor;
    }
  }

  /** The eight roles with their effective configuration and its provenance. */
  private agentsView(): unknown {
    const config = this.services.config;
    const global = config?.global();
    const project = config?.project();
    const roles = ROLES.map((role) => {
      const resolution = config?.resolve(role);
      return {
        role,
        profile:
          resolution !== undefined && resolution.ok
            ? {
                ...resolution.resolution.profile,
                effectiveContextLimit: resolution.resolution.effectiveContextLimit,
                providerId: resolution.resolution.provider.providerId,
                modelId: resolution.resolution.model.id,
                model: resolution.resolution.model,
                revision: resolution.resolution.revision,
                // `agents.md` §5 inheritance provenance, per field.
                sources: resolution.resolution.sources,
              }
            : null,
        usable: resolution === undefined ? null : resolution.ok,
        unavailableReason: resolution !== undefined && !resolution.ok ? resolution.reason : null,
        overrides: { ...(project?.roleProfiles[role] ?? {}) },
        defaultProfile: global?.defaultProfile ?? null,
      };
    });
    return {
      roles,
      limits: config?.effectiveLimits() ?? null,
      providers: (global?.providers ?? []).map((provider) => ({
        providerId: provider.providerId,
        type: provider.type,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        // A secret value is never echoed; only whether one is really registered.
        secretConfigured: this.secretRegistered(provider.secretRef),
        models: provider.models.map((model) => model.id),
      })),
      activeRuns: this.runningRunCount(),
    };
  }

  /** `config.get`: one scope's document plus its revision. */
  private getConfig(params: JsonObject): unknown {
    const config = this.requireConfig();
    const scope = configScope(params['scope']);
    const document = scope === 'global' ? config.global() : config.project();
    return {
      scope,
      version: document.version,
      revision: config.versionOf(scope),
      // `protocol.md` §5: providers exist only in the global scope, and a secret
      // value is never echoed — only whether one is really registered (WP-12 T1.1).
      providers:
        scope === 'global'
          ? document.providers.map((provider) => ({
              ...provider,
              secretRef: provider.secretRef ?? null,
              secretConfigured: this.secretRegistered(provider.secretRef),
            }))
          : undefined,
      defaultProfile: document.defaultProfile ?? null,
      roleProfiles: document.roleProfiles,
      limits: document.limits,
      effectiveLimits: config.effectiveLimits(),
      policy: document.policy,
    };
  }

  /** Settings = the workbench's own state, kept separate from Project config. */
  private settingsView(): unknown {
    const config = this.services.config;
    return {
      projectId: this.projectId,
      // The config revision the page displays is the real one, so "unsaved" and
      // "stale" states are never guessed.
      configRevision: config === undefined ? null : config.versionOf('global'),
      projectConfigRevision: config === undefined ? null : config.versionOf('project'),
      // The installation token is shown exactly once at install time and never
      // re-readable through the API (`protocol.md` §2).
      installerTokenVisible: false,
      deployment: { transport: 'loopback', httpsRequired: false },
    };
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * `conversation.message.send` — the same transactional path the HTTP route uses.
   *
   * The message, its Work, the attachment bindings, the user artifacts, the
   * command-ledger entry and the `message.received` event commit together; a
   * failure leaves every upload staged so the client can retry with the same ids.
   */
  private sendMessageCommand(
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller; readonly idempotencyKey?: string },
  ): JsonObject {
    const conversationId = requiredString(params, 'conversationId');
    const body = requiredString(params, 'body');
    const attachmentIds = stringArray(params['attachmentIds']);
    const targetWorkId = optionalString(params['targetWorkId']);
    const commandParams: JsonObject = {
      conversationId,
      body,
      attachmentIds,
      ...(targetWorkId === undefined ? {} : { targetWorkId }),
    };
    const store = this.services.store;
    return withTransaction(store.db, () => {
      let commandId: string | undefined;
      if (options.idempotencyKey !== undefined) {
        const begun = store.commands.begin({
          subject: options.caller.subject,
          operation: 'conversation.message.send',
          key: options.idempotencyKey,
          payloadHash: sha256Of(commandParams),
        });
        if (begun.kind === 'conflict') {
          throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason, {
            details: { idempotencyKey: options.idempotencyKey },
          });
        }
        if (begun.kind === 'replay') return begun.response as JsonObject;
        commandId = begun.commandId;
      }
      const sent = sendMessage(
        {
          projectId: this.projectId,
          store,
          attachments: this.services.attachments,
          artifacts: this.services.artifacts,
          blobs: this.services.blobs,
          now: this.now,
          // `work.baseRevision` (Q-T3-4): a new Work is bound to the delivery ref the project
          // currently points at, so an approved Plan's `requestCodeWrite` has a revision to
          // compare against (AC-013).
          readBaseRevision: defaultBaseRevisionReader,
        },
        {
          conversationId,
          body,
          attachmentIds,
          ...(targetWorkId === undefined ? {} : { targetWorkId }),
          ownerUserId: options.caller.userId,
          acl: [options.caller.role],
        },
      );
      const reply: JsonObject = {
        messageId: sent.messageId,
        workId: sent.workId,
        workIds: [...sent.workIds],
        authorizationId: sent.authorizationId,
        state: sent.state,
        version: sent.version,
      };
      store.events.append({
        name: 'message.received',
        entityId: sent.messageId,
        entityVersion: sent.version,
        data: {
          messageId: sent.messageId,
          workId: sent.workId,
          workIds: [...sent.workIds],
          authorizationId: sent.authorizationId,
          attachmentIds: [...sent.attachmentIds],
          artifactIds: [...sent.artifactIds],
        },
      });
      // The Chief assessment is a real queued Run, created inside this transaction and
      // executed by the supervisor — the command itself stays synchronous (`WP-12 T2.4`).
      const chiefRunId = this.queueChiefAssessment({
        workId: sent.workId,
        messageId: sent.messageId,
        body,
      });
      if (commandId !== undefined) {
        // The response shape is the documented one; the Chief Run is observable through
        // `run.list`/`run.queued` rather than an undeclared response field.
        store.commands.complete(commandId, reply);
      }
      void chiefRunId;
      return reply;
    });
  }

  /**
   * Queues the Chief's assessment Run for one message (`WP-12 T2.4`).
   *
   * `data.md` §3: a `ChiefDispatchSpec` is built by Core from the user message and the Work
   * it created, never by a model. The Run is a normal queued Run, so the supervisor's
   * capability gateway, attempt/epoch fencing and budget accounting all apply.
   *
   * A Work whose role has no usable model is *not* an error for the message: the message is
   * accepted (the user's words are never lost) and the missing Run is reported in the log.
   * The `blocked(provider)` projection is WP-05 (DC-42).
   *
   * @returns the Chief Run id, or `null` when this stack cannot queue one.
   */
  private queueChiefAssessment(input: {
    readonly workId: string;
    readonly messageId: string;
    readonly body: string;
  }): string | null {
    const orchestrator = this.services.orchestrator;
    if (orchestrator === undefined) {
      // A protocol served without an execution stack (the headless query tests) queues
      // nothing; the message itself is still real.
      return null;
    }
    const store = this.services.store;
    const work = store.works.find(input.workId);
    if (work === undefined) return null;
    const budget = store.budgets.find(work.budgetId);
    if (budget === undefined) return null;
    const available = budget.tokenLimit - budget.tokensUsed - budget.tokensReserved;
    if (available <= 0) {
      this.logLine(`message.send: Work ${work.id} has no token budget left for a Chief Run`);
      return null;
    }
    const goal = work.goal.slice(0, 2_000);
    const codePaths = [...new Set([...work.scope.readPaths, ...work.scope.writePaths])];
    const coordinating =
      work.intent === 'delivery' || work.intent === 'document' || work.intent === 'operation';
    try {
      const { run } = orchestrator.dispatch({
        spec: {
          kind: 'chief',
          workId: work.id,
          role: 'chief',
          purpose: 'analysis',
          goal,
          // The Chief Run's own envelope: it reads what the message named and writes only
          // its own artifacts, so a `none`-level Work can carry it (R16-01).
          scope: { readPaths: codePaths, writePaths: [], operations: [], networkTargets: [] },
          stage: coordinating ? 'coordinate' : 'assist',
          contextSelection: {
            goal,
            sourceRefs: [{ kind: 'message', id: input.messageId, version: '1' }],
            reasonPerSource: {
              [`message:${input.messageId}`]: 'the user message this work came from',
            },
            featureRefs: [],
            codePaths,
            artifactRefs: [],
            excluded: [],
            unknowns: [],
            // `agents.md` §6 defaults: 24000 initial, 16000 expansion.
            readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
          },
          profileRevision: orchestrator.currentProfileRevision('chief'),
          requiredOutputs: ['assessment.submit'],
          // A coordinating Chief Run is the parent of the whole delivery route, and
          // `orchestrator.effectiveBudget` caps every stage Run by this Run's *unallocated*
          // hold (`allocated + requested <= parent.budgetAllocation`). Its hold is therefore
          // the route envelope (`CHIEF_ROUTE_TOKENS`) rather than a one-turn slice, while the
          // Work's own budget stays the authority; an assist/artifact Chief keeps the
          // one-turn slice.
          budgetAllocation: Math.min(
            coordinating ? CHIEF_ROUTE_TOKENS : CHIEF_ASSESSMENT_TOKENS,
            available,
          ),
        },
      });
      return run.id;
    } catch (error) {
      // Most often `PROVIDER_UNAVAILABLE`. `experience.md` §22 requires the message to reach
      // a terminal state instead of waiting in `received` forever (WP-12 fix round 2, P2-3):
      // the turn failed, and the user sees exactly that.
      const message = store.messages.find(input.messageId);
      if (message !== undefined && message.state !== 'failed') {
        const updated = store.messages.update(message.id, { state: 'failed' }, message.version);
        store.events.append({
          name: 'message.failed',
          entityId: updated.id,
          entityVersion: updated.version,
          data: {
            messageId: updated.id,
            workId: work.id,
            state: 'failed',
            outcome: 'provider_unavailable',
            reason: errorText(error),
          },
        });
      }
      this.logLine(`message.send: could not queue the Chief assessment: ${errorText(error)}`);
      return null;
    }
  }

  /**
   * `work.control` — pause / resume / cancel / continue.
   *
   * Every branch calls the real Core service, so a Queued requirement with no Work
   * is cancellable while a pause on it is refused with `INVALID_STATE` (`AC-068`),
   * and a `needs_replan` continuation goes through `RequirementContinuation` (a new
   * Work plus a real local authorization).
   */
  private controlWork(params: JsonObject, options: { readonly expectedVersion?: number }): unknown {
    const action = requiredString(params, 'action');
    const reason = optionalString(params['reason']) ?? '';
    const operationId = optionalString(params['operationId']) ?? this.services.store.newId();
    switch (action) {
      case 'pause': {
        const workId = optionalString(params['workId']);
        if (workId === undefined) {
          // A Queued requirement with no local Work has nothing to pause; saying so
          // is the documented INVALID_STATE rather than a silent success.
          const requirementId = optionalString(params['requirementId']);
          if (
            requirementId !== undefined &&
            this.services.store.requirements.find(requirementId) !== undefined
          ) {
            throw new ProtocolError(
              'INVALID_STATE',
              `Requirement ${requirementId} has no local Work to pause`,
              { details: { requirementId, action } },
            );
          }
          throw new ProtocolError('VALIDATION_ERROR', 'work.control pause needs workId', {
            details: { preservedInput: params },
          });
        }
        const result = this.requireFindings().pauseWork({
          workId,
          ...(reason === '' ? {} : { reason }),
        });
        if (!result.ok) {
          throw new ProtocolError(result.code, result.message, {
            details: { workId, recoveryRunIds: [...result.recoveryRunIds] },
          });
        }
        return {
          status: 'accepted',
          operationId,
          workId,
          version: result.work.version,
          previousStatus: result.previousStatus,
          pausedRunIds: result.pausedRuns.map((run) => run.runId),
          heldRunIds: [...result.heldRunIds],
          attemptsClosed: result.attemptsClosed,
        };
      }
      case 'resume': {
        const workId = requiredString(params, 'workId');
        const work = this.services.store.works.find(workId);
        if (work === undefined) {
          throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
        }
        // The command's `expectedVersion` is the target Work's version, so a stale
        // one is the documented conflict rather than a generic state refusal
        // (`protocol.md` §1 "版本冲突返回VERSION_CONFLICT和currentVersion").
        const expected = options.expectedVersion ?? work.version;
        if (expected !== work.version) {
          // The caller's Work version is stale; re-reading is the documented next
          // step, so this is an explicit conflict carrying the live version
          // (`protocol.md` §1) rather than a generic state refusal.
          throw new ProtocolError(
            'VERSION_CONFLICT',
            `Work ${workId} is at version ${work.version}, not ${expected}`,
            { details: { workId, currentVersion: work.version, requestedVersion: expected } },
          );
        }
        // A Run parked by the executor (`interrupted`/`recovery_required`) has no action
        // anywhere else: `pauseWork` refuses it and `resumeWork` needs a paused Work
        // (`WP11R4-02`). The operator's resume therefore records the Run-scoped recovery
        // decision first — which re-checks the real process state and refuses while the old
        // Runner may still be alive — and then lets the normal path resume the Work.
        const parked = this.services.store.runs.list({
          where: "work_id = ? AND status IN ('interrupted','recovery_required')",
          params: [workId],
        });
        if (parked.length > 0 && this.services.runRecovery !== undefined) {
          // Two-phase resume (`WP11R5-01`): every parked Run must pass the durable
          // admission gate **before** the first spawn, so a Run that cannot continue
          // refuses the whole command instead of leaving the earlier Runs resumed and
          // the later ones parked.
          for (const run of parked) {
            if (newAttemptAdmission(this.services.store, run.id).allowed) continue;
            const recorded = this.services.runRecovery.recordResumeDecision({ runId: run.id });
            if (!recorded.ok) {
              throw new ProtocolError(
                recorded.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'RECOVERY_REQUIRED',
                recorded.message ?? `Run ${run.id} 需要恢复决定`,
                { details: { workId, runId: run.id } },
              );
            }
          }
          for (const run of parked) {
            const admission = newAttemptAdmission(this.services.store, run.id);
            if (!admission.allowed) {
              throw new ProtocolError(
                'RECOVERY_REQUIRED',
                admission.message ?? `Run ${run.id} 的恢复判定未放行新 Attempt`,
                { details: { workId, runId: run.id, code: admission.code } },
              );
            }
          }
          if (work.status !== 'paused') {
            // Nothing to un-pause: the parked Runs are resumed by the executor directly.
            // Every admission check above already passed, so a failure here is a
            // capacity/spawn race rather than a business refusal; the already-resumed
            // Runs travel in `details` so the operation is resumable instead of opaque
            // (`WP11R5-01`).
            const resumed: string[] = [];
            for (const run of parked) {
              const attempt = this.services.runRecovery.resumeParkedRun(run.id);
              if (!attempt.ok) {
                const code =
                  attempt.code === 'BUSY'
                    ? 'BUSY'
                    : attempt.code === 'INVALID_STATE'
                      ? 'INVALID_STATE'
                      : 'RECOVERY_REQUIRED';
                throw new ProtocolError(code, attempt.message ?? `Run ${run.id} 无法续跑`, {
                  details: {
                    workId,
                    runId: run.id,
                    resumedRunIds: [...resumed],
                    pendingRunIds: parked
                      .filter((entry) => entry.id !== run.id && !resumed.includes(entry.id))
                      .map((entry) => entry.id),
                  },
                });
              }
              resumed.push(run.id);
            }
            // `protocol.md` §4/§7: resume answers `accepted` and emits a real
            // `work.control_changed`, so a client driving its UI from the event stream
            // sees the Runs leave the parked state (`WP11R5-02`).
            this.services.store.events.append({
              name: 'work.control_changed',
              entityId: work.id,
              entityVersion: work.version,
              data: {
                workId: work.id,
                control: 'resume',
                previousStatus: work.status,
                status: work.status,
                reason,
                resumedRunIds: [...resumed],
                parkedRunIds: parked.map((entry) => entry.id),
              },
            });
            return {
              status: 'accepted',
              operationId,
              workId,
              version: work.version,
              resumedRunIds: resumed,
            };
          }
        }
        const result = this.requireFindings().resumeWork({
          workId,
          expectedWorkVersion: expected,
        });
        if (!result.ok) {
          throw new ProtocolError(result.code, result.message, {
            details: { workId, currentVersion: result.currentVersion },
          });
        }
        return {
          status: 'accepted',
          operationId,
          workId,
          version: result.work.version,
          attempts: result.attempts.map((attempt) => ({ ...attempt })),
        };
      }
      case 'cancel': {
        const requirementId = optionalString(params['requirementId']);
        if (requirementId !== undefined && optionalString(params['workId']) === undefined) {
          return this.cancelRequirement(requirementId, reason, operationId, params);
        }
        const workId = requiredString(params, 'workId');
        const result = this.requireFindings().cancelWork({
          workId,
          ...(reason === '' ? {} : { reason }),
          ...(params['sideEffectsUnknown'] === true ? { sideEffectsUnknown: true } : {}),
        });
        if (!result.ok) {
          throw new ProtocolError(result.code, result.message, { details: { workId } });
        }
        // `reliability.md` §6: a cancel stops the tools too. The findings service stops
        // the attempt rows; the daemon-side tool process groups and the Grants those
        // Runs held are reaped here, before the response reports the cancel as applied.
        for (const cancelled of result.cancelledRunIds) {
          this.services.toolBridge?.cleanupRun(cancelled);
        }
        return {
          status: 'accepted',
          operationId,
          workId,
          version: result.work.version,
          workStatus: result.status,
          cancelledRunIds: [...result.cancelledRunIds],
          preservedArtifactIds: [...result.preservedArtifactIds],
          requirementStatus: result.requirementStatus,
          recoveryRequired: result.recoveryRequired,
          recoveryDecisionId: result.recoveryDecisionId,
        };
      }
      case 'continue':
        return this.continueRequirement(params);
      default:
        throw new ProtocolError('VALIDATION_ERROR', `unknown work.control action ${action}`, {
          details: { action, accepted: ['pause', 'resume', 'cancel', 'continue'] },
        });
    }
  }

  /**
   * Cancels a Queued requirement that has no local Work (`AC-068`).
   *
   * The Git record is the authority, so the local projection is updated only
   * through the real record service; without it the daemon refuses rather than
   * pretending the Git record changed.
   */
  private cancelRequirement(
    requirementId: string,
    reason: string,
    operationId: string,
    params: JsonObject,
  ): JsonObject {
    const requirement = this.services.store.requirements.find(requirementId);
    if (requirement === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`);
    }
    if (requirement.workId !== undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} has local Work ${requirement.workId}; cancel the Work instead`,
        { details: { requirementId, workId: requirement.workId } },
      );
    }
    if (requirement.lifecycle !== 'queued') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} is ${requirement.lifecycle}; only a Queued requirement cancels here`,
        { details: { requirementId, lifecycle: requirement.lifecycle } },
      );
    }
    const saves = this.services.requirementSaves;
    if (saves === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'requirement cancellation needs the Git record service, which is not wired on this daemon',
        { details: { requirementId } },
      );
    }
    const now = this.services.store.now();
    const cancellationReason = reason === '' ? '用户取消' : reason;
    // The cancellation adds lifecycle facts to the record that exists; it does not
    // replace it. The recorded metadata and body are read back from Git so the
    // scope, the acceptance list, the confirmed decisions, the open questions, the
    // feature ids and every content section survive the cancel, and only the
    // completion summary is rewritten with the reason (W9R2-03,
    // `experience.md`「取消保留部分成果及处置结果」).
    const record = this.readRequirementRecord(requirement);
    const metadata = (
      record === null
        ? {
            schemaVersion: 1 as const,
            id: requirement.id,
            version: requirement.recordVersion + 1,
            contentFile: 'content.md' as const,
            createdAt: requirement.createdAt,
            updatedAt: now,
            title: requirement.title,
            goal: requirement.goal,
            scope: emptyScope(),
            lifecycle: 'cancelled' as const,
            featureIds: [],
            acceptance: [],
            openQuestions: [],
            confirmedDecisions: [],
            relatedRequirementIds: [],
            cancellation: { cancelledAt: now, reason: cancellationReason },
          }
        : {
            ...stripRecordBody(record),
            id: requirement.id,
            version: requirement.recordVersion + 1,
            updatedAt: now,
            lifecycle: 'cancelled' as const,
            cancellation: { cancelledAt: now, reason: cancellationReason },
          }
    ) as Parameters<RequirementSaveService['save']>[0]['metadata'];
    const outcome = saves.save({
      operationId,
      metadata,
      contentMarkdown:
        record === null
          ? canonicalRequirementContent({
              title: requirement.title,
              goal: requirement.goal,
              completion: cancellationReason,
            })
          : withCompletionSummary(record.contentMarkdown, cancellationReason),
      expected: {
        recordVersion: requirement.recordVersion,
        recordHash: requirement.portableRef.hash,
      },
      sourceRef: this.sourceRefOf(params, 'action'),
      kind: 'cancel',
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: {
          requirementId,
          reasons: [...outcome.reasons],
          branchUntouched: outcome.branchUntouched,
          recovery: jsonSafe(outcome.operation ?? null),
        },
      });
    }
    return {
      status: 'accepted',
      operationId,
      version: outcome.row.version,
      requirementId: outcome.requirementId,
      lifecycle: outcome.row.lifecycle,
      git: jsonSafe(outcome.git),
    };
  }

  /**
   * `requirement.archive` (`protocol.md` §4, `workflow.md` §5.1).
   *
   * Archiving keeps the file as history (`workflow.md` §8): the committed body and
   * every metadata field survive, and only `lifecycle`/`previousLifecycle` change.
   * The transition table allows `queued → archived` and `completed → archived`; an
   * `active` requirement must be cancelled or completed first, and a requirement
   * whose Work still has a live Run is refused rather than archived underneath it.
   */
  private archiveRequirement(
    params: JsonObject,
    options: { readonly idempotencyKey?: string; readonly expectedVersion?: number },
  ): JsonObject {
    const requirementId = requiredString(params, 'requirementId');
    const requirement = this.requireRequirement(requirementId);
    this.assertRequirementVersion(requirement, options.expectedVersion);
    const live = this.liveRunOf(requirement);
    if (live !== null) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} still has a live Run ${live}; cancel or complete it before archiving`,
        { details: { requirementId, runId: live, lifecycle: requirement.lifecycle } },
      );
    }
    if (requirement.lifecycle !== 'queued' && requirement.lifecycle !== 'completed') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} is ${requirement.lifecycle}; only a Queued or Completed requirement archives (workflow.md §5.1)`,
        { details: { requirementId, lifecycle: requirement.lifecycle } },
      );
    }
    return this.writeRequirementLifecycle(params, options, {
      lifecycle: 'archived',
      previousLifecycle: requirement.lifecycle,
      kind: 'archive',
    });
  }

  /**
   * `requirement.restore` (`protocol.md` §4, `workflow.md` §5.1).
   *
   * Only an archived record restores, and only to the state it was archived from
   * (`previousLifecycle`: queued or completed). An archived record without that fact
   * cannot be restored, and restoring a non-archived requirement is refused.
   */
  private restoreRequirement(
    params: JsonObject,
    options: { readonly idempotencyKey?: string; readonly expectedVersion?: number },
  ): JsonObject {
    const requirementId = requiredString(params, 'requirementId');
    const requirement = this.requireRequirement(requirementId);
    this.assertRequirementVersion(requirement, options.expectedVersion);
    if (requirement.lifecycle !== 'archived') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} is ${requirement.lifecycle}; only an archived requirement restores`,
        { details: { requirementId, lifecycle: requirement.lifecycle } },
      );
    }
    const previous = requirement.previousLifecycle;
    if (previous !== 'queued' && previous !== 'completed') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} records no restorable previous lifecycle (workflow.md §5.1)`,
        { details: { requirementId, previousLifecycle: previous ?? null } },
      );
    }
    return this.writeRequirementLifecycle(params, options, {
      lifecycle: previous,
      kind: 'restore',
      clearPreviousLifecycle: true,
    });
  }

  private requireRequirement(requirementId: string): Requirement {
    const requirement = this.services.store.requirements.find(requirementId);
    if (requirement === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`, {
        details: { requirementId },
      });
    }
    return requirement;
  }

  /**
   * Enforces the documented `expectedVersion` precondition for one Requirement write
   * (`protocol.md` §1, `data.md` §2).
   *
   * `data.md` §2 fixes *which* version this is: "本机行version独立用于协议
   * expectedVersion并随本机字段变化递增" — the local projection row's `version`
   * (the same number `requirement.get` returns and every lifecycle answer reports),
   * never the cross-server `recordVersion`, which the Git CAS already checks
   * separately. A stale value is the documented `VERSION_CONFLICT` carrying the live
   * version, so the client re-reads instead of blindly overwriting (WP-12 G-T3).
   */
  private assertRequirementVersion(
    requirement: Requirement,
    expectedVersion: number | undefined,
  ): void {
    if (expectedVersion === undefined || expectedVersion === requirement.version) return;
    throw new ProtocolError(
      'VERSION_CONFLICT',
      `Requirement ${requirement.id} is at version ${requirement.version}, not ${expectedVersion}`,
      {
        details: {
          requirementId: requirement.id,
          currentVersion: requirement.version,
          requestedVersion: expectedVersion,
        },
      },
    );
  }

  /** The id of one non-terminal Run of a requirement's Work, or `null` (`workflow.md` §5.3). */
  private liveRunOf(requirement: Requirement): string | null {
    if (requirement.workId === undefined) return null;
    const runs = this.services.store.runs.list({
      where: 'work_id = ?',
      params: [requirement.workId],
    });
    const live = runs.find((run) => !TERMINAL_RUN_STATES.includes(run.status));
    return live?.id ?? null;
  }

  /**
   * Writes one lifecycle change to the Git record and the projection
   * (`protocol.md` §4/§8).
   *
   * The committed record is read back first so the archive keeps every metadata
   * field and content section (`workflow.md` §8 "归档/取消保留文件作为历史记录"); only
   * the lifecycle facts change. A save always answers `accepted` after the real
   * service reports the commit, and `requirement.saved` is the service's own event.
   */
  private writeRequirementLifecycle(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
    change: {
      readonly lifecycle: 'queued' | 'completed' | 'archived';
      readonly previousLifecycle?: 'queued' | 'completed';
      readonly kind: 'archive' | 'restore';
      readonly clearPreviousLifecycle?: boolean;
    },
  ): JsonObject {
    const requirementId = requiredString(params, 'requirementId');
    const requirement = this.requireRequirement(requirementId);
    const saves = this.services.requirementSaves;
    if (saves === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'requirement lifecycle changes need the Git record service, which is not wired on this daemon',
        { details: { requirementId } },
      );
    }
    const operationId =
      options.idempotencyKey ??
      optionalString(params['operationId']) ??
      this.services.store.newId();
    const now = this.services.store.now();
    const record = this.readRequirementRecord(requirement);
    const base =
      record === null
        ? {
            schemaVersion: 1 as const,
            id: requirement.id,
            contentFile: 'content.md' as const,
            createdAt: requirement.createdAt,
            title: requirement.title,
            goal: requirement.goal,
            scope: emptyScope(),
            featureIds: [],
            acceptance: [],
            openQuestions: [],
            confirmedDecisions: [],
            relatedRequirementIds: [],
          }
        : stripRecordBody(record);
    const { previousLifecycle: _previous, ...baseWithoutPrevious } = base;
    const metadata = {
      ...(change.clearPreviousLifecycle === true ? baseWithoutPrevious : base),
      version: requirement.recordVersion + 1,
      updatedAt: now,
      lifecycle: change.lifecycle,
      ...(change.previousLifecycle === undefined
        ? {}
        : { previousLifecycle: change.previousLifecycle }),
    } as Parameters<RequirementSaveService['save']>[0]['metadata'];
    const contentMarkdown =
      record?.contentMarkdown ??
      canonicalRequirementContent({
        title: requirement.title,
        goal: requirement.goal,
        completion: REQUIREMENT_EMPTY_SECTION,
      });
    const outcome = saves.save({
      operationId,
      metadata,
      contentMarkdown,
      expected: {
        recordVersion: requirement.recordVersion,
        recordHash: requirement.portableRef.hash,
      },
      sourceRef: this.sourceRefOf(params, 'action'),
      kind: change.kind,
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: {
          requirementId,
          reasons: [...outcome.reasons],
          branchUntouched: outcome.branchUntouched,
          recovery: jsonSafe(outcome.operation ?? null),
        },
      });
    }
    return {
      status: 'accepted',
      operationId,
      version: outcome.row.version,
      requirementId: outcome.requirementId,
      lifecycle: outcome.row.lifecycle,
      previousLifecycle: outcome.row.previousLifecycle ?? null,
      git: jsonSafe(outcome.git),
    };
  }

  /**
   * `requirement.create` (`protocol.md` §4).
   *
   * The documented create shape is the same write as `requirement.save` without a
   * `requirementId`, so it delegates to the real save service and answers the
   * documented `accepted` envelope. `requirement.saved` is emitted by the service
   * after Git committed (`protocol.md` §8).
   */
  private createRequirement(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
  ): JsonObject {
    const saveParams: JsonObject = {
      patch: {
        title: requiredString(params, 'title'),
        goal: requiredString(params, 'goal'),
        scope: objectField(params, 'scope'),
        contentMarkdown: requiredString(params, 'contentMarkdown'),
      },
      ...(optionalString(params['sourceMessageId']) === undefined
        ? {}
        : { sourceMessageId: params['sourceMessageId'] as string }),
    };
    return this.documentedRequirementSave(saveParams, options);
  }

  /**
   * `requirement.update` (`protocol.md` §4).
   *
   * The patch keeps the documented `PortableRequirement` field types; every field the
   * request omits keeps its committed value because the save reads the record back
   * first (`protocol.md` §8, W9R2-02).
   */
  private updateRequirement(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
  ): JsonObject {
    const saveParams: JsonObject = {
      requirementId: requiredString(params, 'requirementId'),
      patch: objectField(params, 'patch'),
      ...(optionalString(params['sourceMessageId']) === undefined
        ? {}
        : { sourceMessageId: params['sourceMessageId'] as string }),
    };
    return this.documentedRequirementSave(saveParams, options);
  }

  /** Runs the real save and rewrites its `applied` answer as the documented `accepted`. */
  private documentedRequirementSave(
    saveParams: JsonObject,
    options: { readonly idempotencyKey?: string },
  ): JsonObject {
    const result = this.saveRequirement(saveParams, options, false);
    return { ...result, status: 'accepted' };
  }

  /**
   * `requirement.import` (`protocol.md` §4/§8, AC-092).
   *
   * The current delivery revision's committed pool is re-read and applied through the
   * same `RequirementProjection` the save path uses, so conflict detection and the
   * `requirement.imported` event are the shared ones. A per-record conflict does not
   * abort the rest: the valid records are imported and the conflicting ones are
   * reported (`protocol.md` §8 "其他有效条仍可查询").
   */
  private importRequirement(params: JsonObject): JsonObject {
    const revision = requiredString(params, 'revision');
    const project = this.services.store.projects.find(this.projectId);
    const root = project?.gitRoot ?? project?.root;
    if (root === undefined || root === '') {
      throw new ProtocolError('INVALID_STATE', 'this Project has no Git root to import from', {
        details: { projectId: this.projectId },
      });
    }
    const pool = this.requirementPool.read(root, revision);
    const projection = new RequirementProjection({ store: this.services.store });
    const imported: JsonObject[] = [];
    const conflicts: JsonObject[] = pool.conflicts.map((conflict) => ({
      recordPath: conflict.recordPath,
      reason: conflict.reason,
      message: conflict.message,
    }));
    for (const record of pool.records) {
      let metadata: unknown;
      try {
        metadata = JSON.parse(record.metadataJson);
      } catch (error) {
        conflicts.push({
          recordPath: record.recordPath,
          reason: 'invalid-metadata',
          message: errorText(error),
        });
        continue;
      }
      if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
        conflicts.push({
          recordPath: record.recordPath,
          reason: 'invalid-metadata',
          message: 'requirement.json is not an object',
        });
        continue;
      }
      const outcome = projection.import({
        record: { ...(metadata as JsonObject), contentMarkdown: record.contentMarkdown },
        rawMetadata: record.metadataJson,
        portableRef: { path: record.recordPath, revision },
        recordCommitted: true,
      });
      if (outcome.verdict === 'conflict') {
        conflicts.push({
          recordPath: record.recordPath,
          reason: 'REQUIREMENT_CONFLICT',
          message: outcome.conflict.reason,
          requirementId: outcome.conflict.requirementId,
        });
        continue;
      }
      imported.push({
        requirementId: outcome.requirementId,
        recordVersion: outcome.recordVersion,
        recordHash: outcome.recordHash,
        verdict: outcome.verdict,
        lifecycle: outcome.row?.lifecycle ?? null,
      });
    }
    return {
      status: 'accepted',
      revision,
      imported,
      conflicts,
      // `protocol.md` §8: an unresolved conflict blocks writes to that record only,
      // and the caller sees that fact instead of a silent partial success.
      writeBlocked: conflicts.length > 0,
      total: pool.records.length,
    };
  }

  /**
   * `requirement.start` (`protocol.md` §4, `workflow.md` §8).
   *
   * The documented order is load-bearing: the `workId` is pre-allocated, the record is
   * committed as `active` **with** that binding, the Work row exists, and only then is
   * a Run admitted. A Queued record with a Work already, or one that is not Queued, is
   * the documented `INVALID_STATE`.
   */
  private startRequirement(
    params: JsonObject,
    options: { readonly idempotencyKey?: string; readonly expectedVersion?: number },
  ): JsonObject {
    const requirementId = requiredString(params, 'requirementId');
    const requirement = this.requireRequirement(requirementId);
    this.assertRequirementVersion(requirement, options.expectedVersion);
    if (requirement.workId !== undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} already has Work ${requirement.workId}`,
        { details: { requirementId, workId: requirement.workId } },
      );
    }
    if (requirement.lifecycle !== 'queued') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${requirementId} is ${requirement.lifecycle}; only a Queued requirement starts`,
        { details: { requirementId, lifecycle: requirement.lifecycle } },
      );
    }
    const saves = this.services.requirementSaves;
    if (saves === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'requirement.start needs the Git record service, which is not wired on this daemon',
        { details: { requirementId } },
      );
    }
    const store = this.services.store;
    const operationId =
      options.idempotencyKey ?? optionalString(params['operationId']) ?? store.newId();
    const workId = store.newId();
    const budgetPatch = objectField(params, 'budget');
    const now = store.now();
    const record = this.readRequirementRecord(requirement);
    const base =
      record === null
        ? {
            schemaVersion: 1 as const,
            id: requirement.id,
            contentFile: 'content.md' as const,
            createdAt: requirement.createdAt,
            title: requirement.title,
            goal: requirement.goal,
            scope: emptyScope(),
            featureIds: [],
            acceptance: [],
            openQuestions: [],
            confirmedDecisions: [],
            relatedRequirementIds: [],
          }
        : stripRecordBody(record);
    const metadata = {
      ...base,
      version: requirement.recordVersion + 1,
      updatedAt: now,
      lifecycle: 'active' as const,
    } as Parameters<RequirementSaveService['save']>[0]['metadata'];
    const contentMarkdown =
      record?.contentMarkdown ??
      canonicalRequirementContent({
        title: requirement.title,
        goal: requirement.goal,
        completion: REQUIREMENT_EMPTY_SECTION,
      });
    // The Work exists before the requirement row is re-projected, because the
    // projection's `work_id` is a foreign key into `work` (`data.md` §2).
    const budget = store.budgets.insert({
      projectId: this.projectId,
      workId,
      tokenLimit:
        optionalInteger(budgetPatch['tokenLimit']) ?? LIMITS.workInputOutputTokens.default,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit:
        optionalInteger(budgetPatch['timeLimit']) ?? LIMITS.workActiveTimeSec.default,
      activeTimeUsed: 0,
      repairLimit: optionalInteger(budgetPatch['repairLimit']) ?? LIMITS.reviewRepairRounds.default,
      repairUsed: 0,
      costKnown: true,
    });
    const project = store.projects.find(this.projectId);
    const baseRevision = project === undefined ? undefined : defaultBaseRevisionReader(project);
    store.works.insert({
      id: workId,
      projectId: this.projectId,
      requirementId,
      intent: 'delivery',
      purpose: requirement.title.slice(0, 200),
      level: 'L2',
      goal: requirement.goal.slice(0, 2_000),
      scope: record?.scope ?? emptyScope(),
      sourceRef: this.sourceRefOf(params, 'action'),
      status: 'queued',
      blockerIds: [],
      ...(baseRevision === undefined ? {} : { baseRevision }),
      budgetId: budget.id,
      policyRevision: 1,
    } as never);
    const outcome = saves.save({
      operationId,
      metadata,
      contentMarkdown,
      expected: {
        recordVersion: requirement.recordVersion,
        recordHash: requirement.portableRef.hash,
      },
      sourceRef: this.sourceRefOf(params, 'action'),
      kind: 'start',
      workId,
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: {
          requirementId,
          workId,
          reasons: [...outcome.reasons],
          branchUntouched: outcome.branchUntouched,
          recovery: jsonSafe(outcome.operation ?? null),
        },
      });
    }
    // Only after the Git record is `active` and the Work exists may a Run be admitted
    // (`workflow.md` §8). The Chief's Run is the real queued Run; a stack without a
    // model gateway still answers `accepted` and reports the missing Run honestly.
    const runId = this.queueRequirementStartRun({ workId, goal: requirement.goal });
    return {
      status: 'accepted',
      operationId,
      version: outcome.row.version,
      requirementId,
      lifecycle: outcome.row.lifecycle,
      workId,
      runId,
      git: jsonSafe(outcome.git),
      portableRef: outcome.row.portableRef,
    };
  }

  /** Queues the Chief's Run for a started requirement (same path as a message's assessment). */
  private queueRequirementStartRun(input: {
    readonly workId: string;
    readonly goal: string;
  }): string | null {
    return this.queueChiefRun({
      workId: input.workId,
      goal: input.goal,
      sourceRefId: this.services.store.works.find(input.workId)?.sourceRef.id ?? input.workId,
      reason: '需求启动的用户动作',
      label: 'requirement.start',
    });
  }

  /**
   * Queues one new Chief Run for a Work (`protocol.md` §4 `work.retry`, §6).
   *
   * A Chief Run is the generic "work on this Work again" entry: it carries the user's
   * source reference, reads the Work's own envelope and answers with the next
   * Assessment or dispatch, so a retry never fabricates a professional spec. The
   * caller decides whether a retry is admissible; this only produces the Run.
   */
  private queueChiefRun(input: {
    readonly workId: string;
    readonly goal: string;
    readonly sourceRefId: string;
    readonly reason: string;
    readonly label: string;
    readonly authorizationRef?: string;
  }): string | null {
    const orchestrator = this.services.orchestrator;
    if (orchestrator === undefined) return null;
    const store = this.services.store;
    const work = store.works.find(input.workId);
    if (work === undefined) return null;
    const budget = store.budgets.find(work.budgetId);
    if (budget === undefined) return null;
    const available = budget.tokenLimit - budget.tokensUsed - budget.tokensReserved;
    if (available <= 0) return null;
    const goal = input.goal.slice(0, 2_000);
    const codePaths = [...new Set([...work.scope.readPaths, ...work.scope.writePaths])];
    const coordinating =
      work.intent === 'delivery' || work.intent === 'document' || work.intent === 'operation';
    try {
      const { run } = orchestrator.dispatch({
        ...(input.authorizationRef === undefined
          ? {}
          : { authorizationRef: input.authorizationRef }),
        spec: {
          kind: 'chief',
          workId: work.id,
          role: 'chief',
          purpose: 'analysis',
          goal,
          scope: { readPaths: codePaths, writePaths: [], operations: [], networkTargets: [] },
          stage: coordinating ? 'coordinate' : 'assist',
          contextSelection: {
            goal,
            sourceRefs: [{ kind: 'action', id: input.sourceRefId, version: '1' }],
            reasonPerSource: {
              [`action:${input.sourceRefId}`]: input.reason,
            },
            featureRefs: [],
            codePaths,
            artifactRefs: [],
            excluded: [],
            unknowns: [],
            readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
          },
          profileRevision: orchestrator.currentProfileRevision('chief'),
          requiredOutputs: ['assessment.submit'],
          budgetAllocation: Math.min(CHIEF_ASSESSMENT_TOKENS, available),
        },
      });
      return run.id;
    } catch (error) {
      this.logLine(
        `${input.label}: could not queue the Chief Run for Work ${work.id}: ${errorText(error)}`,
      );
      return null;
    }
  }

  /**
   * `work.retry` (`protocol.md` §4): starts a new Run for a finished Work.
   *
   * `workflow.md` §5.1 allows a failed Work to continue with a new Run attempt while
   * keeping the original failure evidence, and `reliability.md` §6 requires the
   * unknown-side-effect precondition: while any Run is parked with an unresolved
   * recovery verdict, or any Run is still live/parked, the retry is refused with a
   * typed error instead of opening a second writer.
   */
  private retryWork(params: JsonObject, options: { readonly idempotencyKey?: string }): JsonObject {
    const workId = requiredString(params, 'workId');
    const reason = optionalString(params['reason']) ?? '';
    const store = this.services.store;
    const work = store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    const orchestrator = this.services.orchestrator;
    if (orchestrator === undefined) {
      throw new ProtocolError(
        'PROVIDER_UNAVAILABLE',
        'work.retry needs the execution stack to queue a new Run',
        { details: { workId } },
      );
    }
    const runs = store.runs.list({ where: 'work_id = ?', params: [workId] });
    const recovery = runs.find((run) => run.status === 'recovery_required');
    if (recovery !== undefined) {
      // The documented precondition: a Run whose side effects are not confirmed must
      // be resolved (`recovery.resolve`) before any retry may write again.
      throw new ProtocolError(
        'RECOVERY_REQUIRED',
        `Work ${workId} still has an unresolved recovery Run ${recovery.id}`,
        { details: { workId, runId: recovery.id } },
      );
    }
    const live = runs.find((run) => !TERMINAL_RUN_STATES.includes(run.status));
    if (live !== undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Work ${workId} still has Run ${live.id} in ${live.status}; resolve it before retrying`,
        { details: { workId, runId: live.id, status: live.status } },
      );
    }
    const budget = store.budgets.find(work.budgetId);
    if (budget === undefined) {
      throw new ProtocolError('INVALID_STATE', `Work ${workId} has no budget row`, {
        details: { workId },
      });
    }
    if (budget.tokenLimit - budget.tokensUsed - budget.tokensReserved <= 0) {
      throw new ProtocolError('BUDGET_EXCEEDED', `Work ${workId} has no token budget left`, {
        details: { workId, tokenLimit: budget.tokenLimit, tokensUsed: budget.tokensUsed },
      });
    }
    const operationId = options.idempotencyKey ?? store.newId();
    const action = this.recordUserAction('work.retry', workId, {
      workId,
      reason,
      previousRunIds: runs.map((run) => run.id),
    });
    // A retry is a user decision, so it carries its own authorization for the Work's
    // own scope (`rules/agents.md` §1: the Chief Run runs under a declared authority).
    const authorization = store.authorizations.insert({
      projectId: this.projectId,
      sourceRef: { kind: 'action', id: action.id, version: '1' },
      workId,
      goal: reason === '' ? `重试工作：${work.goal}` : reason,
      scope: work.scope,
      operations: [...work.scope.operations],
      acceptedAt: store.now(),
    });
    const resumed = this.queueChiefRun({
      workId,
      goal: work.goal,
      sourceRefId: action.id,
      reason: reason === '' ? '用户要求重试该工作' : reason,
      label: 'work.retry',
      authorizationRef: authorization.id,
    });
    if (resumed === null) {
      throw new ProtocolError(
        'PROVIDER_UNAVAILABLE',
        `Work ${workId} could not queue a retry Run (no usable model or budget)`,
        { details: { workId } },
      );
    }
    return {
      status: 'accepted',
      operationId,
      workId,
      runId: resumed,
      authorizationId: authorization.id,
      reason,
      previousRunIds: runs.map((run) => run.id),
      reusedEvidence: false,
    };
  }

  /**
   * `recovery.inspect` (`protocol.md` §4, `reliability.md` §6).
   *
   * The report is produced exactly once, by the restart recovery that parks the Run
   * (`RunRecoveryService.recordRestart`), which freezes the addresses in one
   * `recover` operation row and emits `recovery.report_ready` in the same
   * transaction. `inspect` therefore **returns the existing reports** — it never
   * builds a second report and never emits a second event — so a client sees one
   * `recovery.report_ready` per report (`protocol.md` §7 "恰好一次").
   */
  private inspectRecovery(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
  ): JsonObject {
    const workId = requiredString(params, 'workId');
    const store = this.services.store;
    const work = store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    const reports: JsonObject[] = [];
    const operations = store.operations.list({
      where: 'kind = ?',
      params: ['recover'],
      orderBy: 'created_at DESC',
    });
    for (const operation of operations) {
      const addresses = operation.stepResults['reports'];
      if (!Array.isArray(addresses)) continue;
      for (const raw of addresses) {
        const address = recordOf(raw);
        if (address?.['workId'] !== workId) continue;
        reports.push(
          jsonSafe({
            runId: typeof address['runId'] === 'string' ? address['runId'] : null,
            workId,
            reportRef: recordOf(address['reportRef']) ?? null,
            reportHash: typeof address['hash'] === 'string' ? address['hash'] : null,
          }),
        );
      }
    }
    if (reports.length === 0) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Work ${workId} has no frozen recovery report; the report is produced by restart recovery`,
        { details: { workId } },
      );
    }
    const operationId = options.idempotencyKey ?? store.newId();
    return { status: 'accepted', operationId, workId, reports };
  }

  /**
   * `recovery.resolve` (`protocol.md` §4, `reliability.md` §6).
   *
   * The named report is read back and its `expectedVersions` are compared with the
   * live Run/Attempt/Work before anything is applied; a moved target is the
   * documented `STALE_ARTIFACT` rather than a resolution against stale evidence. The
   * three documented choices are: `resume` (record the resume decision and open the
   * next Attempt), `accept_cancel` (cancel through the pending recovery Decision) and
   * `abandon` (stop the work while keeping the unresolved external effects on record).
   */
  private resolveRecovery(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
  ): JsonObject {
    const workId = requiredString(params, 'workId');
    const choice = requiredString(params, 'choice');
    if (choice !== 'resume' && choice !== 'accept_cancel' && choice !== 'abandon') {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `choice ${choice} must be resume, accept_cancel or abandon`,
        { details: { choice } },
      );
    }
    const reportRef = objectField(params, 'reportRef');
    const reportId = requiredString(reportRef, 'id');
    const reportHash = requiredString(reportRef, 'hash');
    const store = this.services.store;
    const work = store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    // The report is addressed by the `recover` operation row that froze it
    // (`RunRecoveryService.recordRestart`); the row's `stepResults.reports[]` holds
    // the address, and the `recovery.report_ready` event of the same transaction
    // holds the report's `expectedVersions`. Reading both is what lets this command
    // verify the target before applying anything — and it never re-emits the event.
    const reportOperation = store.operations.find(reportId);
    if (reportOperation === undefined || reportOperation.kind !== 'recover') {
      throw new ProtocolError('NOT_FOUND', `recovery report ${reportId} does not exist`, {
        details: { workId, reportRef },
      });
    }
    const addresses = reportOperation.stepResults['reports'];
    const address = Array.isArray(addresses)
      ? addresses
          .map((entry) => recordOf(entry))
          .find((entry) => entry?.['hash'] === reportHash && entry['workId'] === workId)
      : undefined;
    if (address === undefined) {
      throw new ProtocolError(
        'NOT_FOUND',
        `recovery report ${reportHash} is not recorded for Work ${workId}`,
        { details: { workId, reportRef } },
      );
    }
    const runId = typeof address['runId'] === 'string' ? address['runId'] : null;
    const ready = store.events
      .readAfter(0, { limit: 2_000 })
      .filter((event) => event.name === 'recovery.report_ready')
      .find(
        (event) =>
          event.data['reportHash'] === reportHash &&
          event.data['workId'] === workId &&
          event.data['runId'] === runId,
      );
    if (ready === undefined) {
      throw new ProtocolError(
        'STALE_ARTIFACT',
        `recovery report ${reportHash} has no durable report_ready record`,
        { details: { workId, runId, reportRef } },
      );
    }
    // `reliability.md` §6: the report carries the versions it was built from, so the
    // resolution is applied only while the target still matches them.
    const expected = recordOf(ready.data['expectedVersions']) as JsonObject | undefined;
    const currentRun = runId === null ? undefined : store.runs.find(runId);
    const latestAttempt =
      runId === null
        ? undefined
        : store.attempts
            .list({ where: 'run_id = ?', params: [runId], orderBy: 'number ASC' })
            .at(-1);
    const drift: JsonObject = {};
    if (expected !== undefined) {
      if (
        expected['run'] !== undefined &&
        currentRun !== undefined &&
        expected['run'] !== currentRun.version
      ) {
        drift['run'] = { expected: expected['run'], current: currentRun.version };
      }
      if (
        expected['attempt'] !== null &&
        expected['attempt'] !== undefined &&
        (latestAttempt?.version ?? null) !== expected['attempt']
      ) {
        drift['attempt'] = {
          expected: expected['attempt'],
          current: latestAttempt?.version ?? null,
        };
      }
      if (
        expected['work'] !== null &&
        expected['work'] !== undefined &&
        expected['work'] !== work.version
      ) {
        drift['work'] = { expected: expected['work'], current: work.version };
      }
    }
    if (Object.keys(drift).length > 0) {
      throw new ProtocolError(
        'STALE_ARTIFACT',
        `recovery report ${reportId} was built for a different target version`,
        { details: { workId, runId, drifted: drift } },
      );
    }
    const operationId = options.idempotencyKey ?? store.newId();
    // A pending `recovery` Decision is the Work-level disposition path
    // (`FindingService.resolveCancellation`); `resume` also works for a parked Run.
    const pending = store.decisions
      .list({
        where: 'work_id = ? AND kind = ?',
        params: [workId, 'recovery'],
        orderBy: 'created_at ASC',
      })
      .filter((decision) => decision.state === 'pending')
      .at(-1);
    if (pending !== undefined) {
      const resolved = this.requireFindings().resolveCancellation({
        workId,
        decisionId: pending.id,
        disposition: choice,
      });
      if (!resolved.ok) {
        throw new ProtocolError(resolved.code, resolved.message, {
          details: { workId, runId, decisionId: pending.id, choice },
        });
      }
      return {
        status: 'accepted',
        operationId,
        workId,
        runId,
        choice,
        reportRef,
        decisionId: pending.id,
        workStatus: resolved.status,
        cancelledRunIds: [...resolved.cancelledRunIds],
        preservedArtifactIds: [...resolved.preservedArtifactIds],
        requirementStatus: resolved.requirementStatus,
      };
    }
    if (choice !== 'resume') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Work ${workId} has no pending recovery decision to ${choice}`,
        { details: { workId, runId, choice } },
      );
    }
    const port = this.services.runRecovery;
    if (port === undefined || runId === null) {
      throw new ProtocolError(
        'PROVIDER_UNAVAILABLE',
        'recovery.resolve resume needs the execution stack and a Run',
        { details: { workId, runId } },
      );
    }
    if (!newAttemptAdmission(store, runId).allowed) {
      const recorded = port.recordResumeDecision({ runId });
      if (!recorded.ok) {
        throw new ProtocolError(
          recorded.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'RECOVERY_REQUIRED',
          recorded.message ?? `Run ${runId} 需要恢复决定`,
          { details: { workId, runId } },
        );
      }
    }
    const attempt = port.resumeParkedRun(runId);
    if (!attempt.ok) {
      throw new ProtocolError(
        attempt.code === 'BUSY' ? 'BUSY' : 'RECOVERY_REQUIRED',
        attempt.message ?? `Run ${runId} 无法续跑`,
        { details: { workId, runId } },
      );
    }
    store.events.append({
      name: 'work.control_changed',
      entityId: workId,
      entityVersion: work.version,
      data: { workId, control: 'recovery_resolve', choice, runId, reportRef },
    });
    return {
      status: 'accepted',
      operationId,
      workId,
      runId,
      choice,
      reportRef,
      resumedRunIds: [runId],
    };
  }

  /**
   * `task.list` (`protocol.md` §4): the Task DAG of one Work.
   *
   * The tasks are the rows `plan.approve` materialised from the approved Plan
   * (`data.md` §2), so the list is the Plan's executable units with their live stage.
   */
  private listTasks(params: JsonObject): unknown {
    const workId = requiredString(params, 'workId');
    const store = this.services.store;
    if (store.works.find(workId) === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    const tasks = store.tasks.list({
      where: 'work_id = ?',
      params: [workId],
      orderBy: 'created_at ASC',
    });
    return {
      items: tasks.map((task) => ({
        ...task,
        runCount: store.runs.count('task_id = ?', [task.id]),
      })),
      nextCursor: null,
    };
  }

  /** `task.get` (`protocol.md` §4): one Task and its Runs. */
  private getTask(params: JsonObject): unknown {
    const taskId = requiredString(params, 'taskId');
    const store = this.services.store;
    const task = store.tasks.find(taskId);
    if (task === undefined) {
      throw new ProtocolError('NOT_FOUND', `Task ${taskId} does not exist`, {
        details: { taskId },
      });
    }
    return {
      task,
      work: store.works.find(task.workId) ?? null,
      runs: store.runs.list({
        where: 'task_id = ?',
        params: [taskId],
        orderBy: 'created_at ASC',
      }),
    };
  }

  /**
   * Reads the committed record behind a projection row (W9R2-02/W9R2-03).
   *
   * The projection carries the record identity and version but not the portable
   * metadata, so a save that only changes one field must read `requirement.json`
   * and `content.md` back from the revision the projection points at. A missing or
   * unparseable record answers `null`, which makes the caller fall back to the
   * conservative behaviour instead of inventing metadata.
   */
  private readRequirementRecord(row: Requirement): PortableRequirement | null {
    const project = this.services.store.projects.find(this.projectId);
    const root = project?.gitRoot ?? project?.root;
    if (root === undefined || root === '') return null;
    const directory = row.portableRef.path;
    if (directory === undefined || directory === '') return null;
    const revision = row.portableRef.revision;
    if (revision === undefined || revision === '' || revision === 'working-tree') return null;
    const metadataJson = this.requirementRecords.read(
      root,
      revision,
      `${directory}/requirement.json`,
    );
    if (metadataJson === null) return null;
    const contentMarkdown =
      this.requirementRecords.read(root, revision, `${directory}/content.md`) ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(metadataJson);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { ...(parsed as Record<string, unknown>), contentMarkdown } as PortableRequirement;
  }

  /**
   * `requirement.save` / `requirement.save.retry`.
   *
   * Git is written first and the projection follows, so this answers only after the
   * real service reports the save (`AC-090/AC-093`). A refused save keeps the
   * caller's input in the error `details`, and the retry path names the original
   * `operationId` (`protocol.md` §8). An update or a cancellation reads the
   * committed record first and overrides only what the request names, so a partial
   * patch never resets the recorded scope, arrays or body (W9R2-02/W9R2-03).
   */
  private saveRequirement(
    params: JsonObject,
    options: { readonly idempotencyKey?: string },
    retry: boolean,
  ): JsonObject {
    const saves = this.services.requirementSaves;
    if (saves === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'requirement.save needs the Git record service, which is not wired on this daemon',
      );
    }
    if (retry) {
      const operationId = requiredString(params, 'operationId');
      const existing = this.services.store.operations.find(operationId);
      if (existing === undefined) {
        throw new ProtocolError('NOT_FOUND', `operation ${operationId} does not exist`, {
          details: { operationId },
        });
      }
      if (existing.state === 'completed') {
        // A retry of an already-completed save is idempotent: it reports the
        // current state instead of creating a second Requirement (`protocol.md` §8).
        const row = this.services.store.requirements.find(existing.requirementId ?? '');
        return {
          status: 'applied',
          entityId: row?.id ?? operationId,
          version: row?.version ?? 1,
          requirementId: row?.id ?? null,
          saveState: 'saved',
          reusedCommit: true,
          retry: true,
          idempotent: true,
        };
      }
      const stored = existing.stepResults as Record<string, unknown>;
      const original = stored['input'] as Parameters<RequirementSaveService['save']>[0] | undefined;
      if (original === undefined) {
        throw new ProtocolError(
          'INVALID_STATE',
          `operation ${operationId} has no recorded input to retry`,
          { details: { operationId } },
        );
      }
      // The original payload is replayed unchanged: a retry may not silently change
      // what is being saved (`protocol.md` §8 "旧payload不能重放为新内容").
      return this.requirementSaveResult(saves.retry(original), operationId, params, true);
    }

    const requirementId = optionalString(params['requirementId']);
    const patch = objectField(params, 'patch');
    const sourceMessageId = optionalString(params['sourceMessageId']);
    const existing =
      requirementId === undefined
        ? undefined
        : this.services.store.requirements.find(requirementId);
    if (requirementId !== undefined && existing === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`, {
        details: { requirementId, preservedInput: params },
      });
    }
    if (patch['contentMarkdown'] === undefined && existing === undefined) {
      throw new ProtocolError('VALIDATION_ERROR', 'a new requirement needs contentMarkdown', {
        details: { preservedInput: params },
      });
    }
    const now = this.services.store.now();
    const operationId =
      options.idempotencyKey ??
      optionalString(params['operationId']) ??
      this.services.store.newId();
    // A new record's identity is server-created; the client cannot choose it
    // (`protocol.md` §8 "version、contentFile及Hash由Core维护").
    const id = existing?.id ?? this.services.store.newId();
    // The committed record is the authority for every field the request does not
    // name (`protocol.md` §8 "未提供字段保持原值"): the projection row carries none of
    // the portable metadata, so reading it back is the only way a partial update
    // preserves scope/acceptance/decisions instead of resetting them (W9R2-02).
    const record = existing === undefined ? null : this.readRequirementRecord(existing);
    // An unnamed scope keeps the recorded envelope; a Requirement row has no scope
    // field, so it must never be filled from `sourceRef`, which is a source
    // reference and not a `Scope` (T4 §4.2, W9R1-05).
    const requestedScope = patch['scope'] ?? record?.scope ?? emptyScope();
    const requestedLifecycle = optionalString(patch['lifecycle']);
    const lifecycle = (requestedLifecycle ??
      record?.lifecycle ??
      existing?.lifecycle ??
      'queued') as 'queued' | 'active' | 'completed' | 'cancelled' | 'archived';
    // The committed state machine is enforced on the write, not discovered later in
    // Git: `workflow.md` §5.1 fixes the legal transitions, and a request outside it
    // is the documented INVALID_STATE rather than a record that cannot be replayed.
    if (
      requestedLifecycle !== undefined &&
      existing !== undefined &&
      requestedLifecycle !== existing.lifecycle &&
      !(REQUIREMENT_LIFECYCLE_TRANSITIONS[existing.lifecycle] ?? []).includes(requestedLifecycle)
    ) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Requirement ${existing.id} cannot move ${existing.lifecycle} → ${requestedLifecycle} (workflow.md §5.1)`,
        {
          details: {
            requirementId: existing.id,
            lifecycle: existing.lifecycle,
            requestedLifecycle,
            preservedInput: params,
          },
        },
      );
    }
    // A completion write needs the real completion fact (`requirements.md` §2: a
    // completed record always carries its summary/revision/tree). The daemon does not
    // invent one, so a request that reaches for `completed` without it is refused with
    // the documented "gate not ready" code the UI can render (`protocol.md` §7).
    const requestedCompletion = patch['completion'] ?? record?.completion;
    const previousLifecycle =
      optionalString(patch['previousLifecycle']) ??
      record?.previousLifecycle ??
      (lifecycle === 'archived' &&
      (existing?.lifecycle === 'queued' || existing?.lifecycle === 'completed')
        ? existing.lifecycle
        : undefined);
    if (lifecycle === 'completed' && requestedCompletion === undefined) {
      throw new ProtocolError(
        'GATE_NOT_READY',
        `Requirement ${id} cannot be completed without its completion fact (requirements.md §2, workflow.md §7)`,
        {
          details: {
            requirementId: id,
            lifecycle: existing?.lifecycle ?? 'queued',
            required: 'patch.completion',
            preservedInput: params,
          },
        },
      );
    }
    const metadata = {
      schemaVersion: 1 as const,
      id,
      version: (existing?.recordVersion ?? 0) + 1,
      contentFile: 'content.md' as const,
      // `contentHash` is recomputed by the save service from the real body bytes;
      // a client cannot supply it (`protocol.md` §8).
      createdAt: record?.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
      title: stringOr(patch, 'title', record?.title ?? existing?.title ?? ''),
      goal: stringOr(patch, 'goal', record?.goal ?? existing?.goal ?? ''),
      scope: isScope(requestedScope) ? requestedScope : emptyScope(),
      lifecycle,
      // Lifecycle facts recorded on the committed record survive an unrelated
      // update; dropping them would make a later archive of a completed record
      // structurally invalid.
      ...(previousLifecycle === undefined ? {} : { previousLifecycle }),
      ...(requestedCompletion === undefined ? {} : { completion: requestedCompletion }),
      ...(record?.cancellation === undefined ? {} : { cancellation: record.cancellation }),
      featureIds: stringArrayOr(patch['featureIds'], record?.featureIds ?? []),
      acceptance: arrayOr(patch, 'acceptance', record?.acceptance ?? []),
      openQuestions: stringArrayOr(patch['openQuestions'], record?.openQuestions ?? []),
      confirmedDecisions: arrayOr(patch, 'confirmedDecisions', record?.confirmedDecisions ?? []),
      relatedRequirementIds: stringArrayOr(
        patch['relatedRequirementIds'],
        record?.relatedRequirementIds ?? [],
      ),
    };
    const contentMarkdown =
      optionalString(patch['contentMarkdown']) ??
      record?.contentMarkdown ??
      `# ${metadata.title}\n\n${metadata.goal}\n`;
    const candidate: Parameters<RequirementSaveService['save']>[0] = {
      operationId,
      metadata: metadata as Parameters<RequirementSaveService['save']>[0]['metadata'],
      contentMarkdown,
      expected:
        existing === undefined
          ? { expectedAbsent: true }
          : { recordVersion: existing.recordVersion, recordHash: existing.portableRef.hash },
      sourceRef: this.sourceRefOf(params, sourceMessageId === undefined ? 'action' : 'message'),
      kind: existing === undefined ? 'create' : 'update',
    };
    return this.requirementSaveResult(saves.save(candidate), operationId, params, false);
  }

  private requirementSaveResult(
    outcome: ReturnType<RequirementSaveService['save']>,
    operationId: string,
    params: JsonObject,
    retry: boolean,
  ): JsonObject {
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: {
          operationId,
          retry,
          reasons: [...outcome.reasons],
          branchUntouched: outcome.branchUntouched,
          recovery: jsonSafe(outcome.operation ?? null),
          // Preservation: a refused save still hands the caller's input back so a
          // validation failure never discards an edit.
          preservedInput: params,
        },
      });
    }
    return {
      status: 'applied',
      entityId: outcome.requirementId,
      version: outcome.row.version,
      requirementId: outcome.requirementId,
      recordVersion: outcome.recordVersion,
      recordHash: outcome.recordHash,
      contentHash: outcome.contentHash,
      saveState: 'saved',
      git: jsonSafe(outcome.git),
      portableRef: outcome.row.portableRef,
      reusedCommit: outcome.reusedCommit,
      retry,
    };
  }

  /** `requirement.continue`: turns an imported `needs_replan` record into new Work. */
  private continueRequirement(params: JsonObject): unknown {
    const continuation = this.requireContinuation();
    const requirementId = requiredString(params, 'requirementId');
    const requirement = this.services.store.requirements.find(requirementId);
    if (requirement === undefined) {
      throw new ProtocolError('NOT_FOUND', `Requirement ${requirementId} does not exist`);
    }
    // The continuation needs a real, local user source; a caller that names none
    // gets the action Core records for this very command (never a forged Agent one).
    const named = optionalString(params['authorizationRef']);
    const namedMessage = named === undefined ? undefined : this.services.store.messages.find(named);
    const authorizationRef =
      named === undefined
        ? this.recordUserAction('requirement.continue', requirementId, params).id
        : namedMessage === undefined
          ? named
          : named;
    const result = continuation.continueRequirement({
      requirementId,
      authorizationRef,
      ...(optionalString(params['goal']) === undefined ? {} : { goal: params['goal'] as string }),
      ...(params['scope'] === undefined ? {} : { scope: params['scope'] as Scope }),
      ...(optionalString(params['level']) === undefined
        ? {}
        : { level: params['level'] as 'L1' | 'L2' | 'L3' }),
    });
    if (!result.ok) {
      throw new ProtocolError(result.code, result.message, {
        details: { requirementId, gaps: [...result.gaps] },
      });
    }
    return {
      status: 'applied',
      entityId: result.requirement.id,
      version: result.requirement.version,
      requirementId: result.requirement.id,
      workId: result.work.id,
      authorizationId: result.authorization.id,
      unmetGates: result.unmetGates.map((gate) => ({ ...gate })),
      // Imported history is never reused as local verification (`AC-089`).
      reusedPreviousVerification: result.reusedPreviousVerification,
      reusedManifestIds: [...result.reusedManifestIds],
      requiresReplan: result.requiresReplan,
      firstGate: result.firstGate,
      waitingToContinue: false,
    };
  }

  /**
   * `plan.current` — the Plan a card may approve, read from the real gate.
   *
   * The workbench needs two things before it can call `plan.approve` without
   * guessing (`AC-070`, W9R1-01): the Plan body the gate approved and the local
   * authorization the Plan rests on. Both come from the gate's own approval record
   * and its artifact — never from a second copy — so a card that cannot obtain them
   * reports `approval.enabled=false` with the reason instead of sending a request
   * that must fail.
   */
  private currentPlan(params: JsonObject): unknown {
    const gates = this.requireGates();
    const workId = requiredString(params, 'workId');
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    const revision = optionalString(params['revision']) ?? work.baseRevision ?? 'working-tree';
    const approval = gates.getCurrentPlanApproval(workId, revision);
    const current = approval.current;
    const currentVersion = current?.planRef.version ?? 0;
    const requestedVersion = optionalInteger(params['planVersion']) ?? currentVersion;
    const requested = requestedVersion === currentVersion;
    const response: JsonObject = {
      workId,
      revision,
      currentVersion,
      requestedVersion,
      current: requested,
      // `approved` is the gate's own verdict: a `stale` record is visible but not
      // approvable, so the card must not treat it as live (W9R1-12).
      approved: approval.status === 'approved' && current !== undefined,
      gateStatus: approval.status,
      approvedVersion: current?.planRef.version ?? null,
      approvedAt: current?.approval.at ?? null,
      // The Run that implements the approved Plan, when this Core queued one (WP-12 Q3=A);
      // a legacy approval that produced no Run still reports the Planning Run below.
      runId:
        current === undefined
          ? null
          : (this.approvedRunIdOf(workId, current.planRef.id) ??
            this.planningRunIdOf(current.planRef.id)),
      authorizationId: null,
      plan: null,
      approval: {
        enabled: false,
        reason: null,
        reasonCode: null,
      },
    };
    if (current === undefined) {
      // No approved Plan for this revision: the card renders the gate's own
      // "missing" verdict instead of an approve button that cannot work. The
      // `reasonCode` is the machine-readable half the UI localises; `reason` stays
      // the English diagnostic (W9R2-05).
      response['approval'] = {
        enabled: false,
        reasonCode: 'no_plan',
        reason: 'the gate holds no approved Plan for this Work revision',
      };
      return response;
    }
    if (!requested) {
      response['approval'] = {
        enabled: false,
        reasonCode: 'stale_version',
        reason: `Plan version ${requestedVersion} is not the current one (${currentVersion})`,
      };
      return response;
    }
    if (approval.status !== 'approved') {
      response['approval'] = {
        enabled: false,
        reasonCode: 'gate_not_approved',
        reason: `the gate no longer accepts the Plan of version ${currentVersion} (${approval.status})`,
      };
      return response;
    }
    // A legacy approval record that names no authorization leaves the card
    // unusable; saying so is better than approving the Plan with a fabricated ref.
    const authorizationRef =
      current.approval.authorizationRef === undefined || current.approval.authorizationRef === ''
        ? null
        : current.approval.authorizationRef;
    response['authorizationId'] = authorizationRef;
    const draft = this.readPlanBody(workId, current.planRef.id);
    if (draft === null) {
      response['approval'] = {
        enabled: false,
        reasonCode: 'plan_unreadable',
        reason: 'the Plan body could not be read back from the artifact store',
      };
      return response;
    }
    response['plan'] = draft;
    if (authorizationRef === null) {
      response['approval'] = {
        enabled: false,
        reasonCode: 'no_authorization',
        reason: 'the approved Plan records no local authorization envelope',
      };
      return response;
    }
    const authorization = this.services.store.authorizations.find(authorizationRef);
    if (authorization === undefined || authorization.workId !== workId) {
      response['approval'] = {
        enabled: false,
        reasonCode: 'authorization_unreadable',
        reason: `the local authorization ${authorizationRef} is not readable for this Work`,
      };
      return response;
    }
    response['approval'] = { enabled: true, reason: null, reasonCode: null };
    return response;
  }

  /**
   * Reads one approved Plan artifact back into a submittable draft.
   *
   * The bytes are the canonical Plan JSON the gate hashed at approval, so the same
   * body re-approves as the next version instead of a re-typed approximation.
   */
  /**
   * The Planning Run that produced the approved Plan artifact.
   *
   * `submitPlan` re-reads the Run and refuses a Plan whose producer belongs to
   * another Work, so the card must name this real run instead of a placeholder.
   */
  /**
   * The professional Run queued for an approved Plan (`plan.current.runId`, WP-12 Q3=A/R3-3).
   *
   * The UI's plan card needs "the Run that is implementing this Plan", not the Planning Run
   * that produced it. The link is the frozen dispatch snapshot's context selection, which
   * names the Plan artifact as its source; a Run without a matching snapshot is ignored.
   */
  private approvedRunIdOf(workId: string, planArtifactId: string): string | null {
    const runs = this.services.store.runs
      .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at DESC' })
      .filter((run) => run.role !== 'chief');
    for (const run of runs) {
      const frozen = this.services.store.snapshots.list({
        where: "type = 'dispatch' AND hash = ?",
        params: [run.dispatchSnapshotId],
      })[0];
      if (frozen === undefined) continue;
      const payload = frozen.payload as {
        dispatchSpec?: { contextSelection?: { sourceRefs?: { kind?: unknown; id?: unknown }[] } };
      };
      const refs = payload.dispatchSpec?.contextSelection?.sourceRefs ?? [];
      if (
        refs.some(
          (ref) =>
            ref.kind === 'artifact' && typeof ref.id === 'string' && ref.id === planArtifactId,
        )
      ) {
        return run.id;
      }
    }
    return null;
  }

  private planningRunIdOf(artifactId: string | undefined): string | null {
    if (artifactId === undefined) return null;
    const artifact = this.services.store.artifacts.find(artifactId);
    if (artifact === undefined || artifact.runId === undefined) return null;
    const run = this.services.store.runs.find(artifact.runId);
    if (run === undefined || run.workId !== artifact.workId || run.role !== 'planning') return null;
    return run.id;
  }

  private readPlanBody(workId: string, artifactId: string): JsonObject | null {
    const artifact = this.services.store.artifacts.find(artifactId);
    if (artifact === undefined || artifact.kind !== 'plan' || artifact.workId !== workId) {
      return null;
    }
    let parsed: unknown;
    try {
      const bytes = this.services.artifacts.read(artifact);
      parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const plan = parsed as JsonObject;
    if (!Array.isArray(plan['tasks']) || plan['tasks'].length === 0) return null;
    if (typeof plan['goal'] !== 'string' || plan['goal'] === '') return null;
    return plan;
  }

  /**
   * Materialises an approved Plan's Task DAG (`WP-12 T2.8`).
   *
   * `data.md` §2 defines `task` as the Plan's executable unit: role, dependencies, write
   * scope and acceptance mapping. Without these rows a professional Run could not bind a
   * `taskId` and no surface could show the DAG. The insert is keyed on the Plan's `planRef`
   * so a replay of the same approval never duplicates them.
   *
   * @returns the new Task id per Plan task id.
   */
  private materializePlanTasks(input: {
    readonly workId: string;
    readonly plan: PlanDraft;
    readonly planRef: { readonly id: string; readonly version: number; readonly hash: string };
  }): Map<string, string> {
    const store = this.services.store;
    const planRef = {
      id: input.planRef.id,
      version: input.planRef.version,
      hash: input.planRef.hash,
    };
    const describe = (task: {
      readonly role: string;
      readonly acceptanceIds: readonly string[];
      readonly paths?: readonly string[];
    }): string => `${task.role}\u0000${[...task.acceptanceIds].sort().join(',')}`;
    const existing = store.tasks.list({ where: 'work_id = ?', params: [input.workId] });
    // A Task this Plan already materialised names the approved Plan; anything else is either
    // the pre-Plan Task a route stage needed (`orchestrator.ensureStageTask`) or a Task of an
    // earlier Plan version, and is reused by (role, acceptance mapping) instead of being
    // duplicated — a duplicate would leave two Tasks for one role, and the later stages
    // would pick the one whose worktree never received the delivery (WP-12 W4b).
    const byPlanRef = existing.filter(
      (row) => row.planRef.id === planRef.id && row.planRef.version === planRef.version,
    );
    const reused = new Set<string>();
    const available = existing.filter((row) => !byPlanRef.includes(row));
    const ids = new Map<string, string>();
    for (const task of input.plan.tasks) {
      if (task.role === 'chief') continue;
      const already = byPlanRef.find((row) => describe(row) === describe(task));
      if (already !== undefined) {
        ids.set(task.id, already.id);
        reused.add(already.id);
        continue;
      }
      const candidate =
        available.find(
          (row) =>
            !reused.has(row.id) &&
            row.role === task.role &&
            row.acceptanceIds.join(',') === [...task.acceptanceIds].join(','),
        ) ?? available.find((row) => !reused.has(row.id) && row.role === task.role);
      if (candidate !== undefined) {
        reused.add(candidate.id);
        ids.set(task.id, candidate.id);
        // The Task the route already used becomes the Plan's Task: same row, so the worktree
        // and the candidate the develop Run froze stay addressable by the later stages.
        store.tasks.update(
          candidate.id,
          {
            planRef,
            scope: {
              readPaths: [...new Set([...input.plan.scope.readPaths, ...task.paths])],
              writePaths: [...task.paths],
              operations: [],
              networkTargets: [],
            },
            acceptanceIds: [...task.acceptanceIds],
          },
          candidate.version,
        );
        continue;
      }
      const taskId = store.newId();
      ids.set(task.id, taskId);
      store.tasks.insert({
        id: taskId,
        projectId: this.projectId,
        workId: input.workId,
        // `data.md` §2 `task.requirementId`: a Task of a Work that has a Requirement carries
        // it, like `orchestrator.ensureStageTask` already does.
        ...(this.services.store.works.find(input.workId)?.requirementId === undefined
          ? {}
          : { requirementId: this.services.store.works.find(input.workId)?.requirementId }),
        planRef,
        role: task.role,
        dependsOn: task.dependsOn
          .map((dependency) => ids.get(dependency))
          .filter((value): value is string => value !== undefined),
        dependencyManifestRefs: [],
        // The Task's write envelope is the union of the Plan's read scope and its own paths;
        // the real authority stays with the approved Plan's authorization (verified again
        // when the Run is frozen).
        scope: {
          readPaths: [...new Set([...input.plan.scope.readPaths, ...task.paths])],
          writePaths: [...task.paths],
          operations: [],
          networkTargets: [],
        },
        stage: 'ready',
        acceptanceIds: [...task.acceptanceIds],
      } as never);
    }
    return ids;
  }

  /**
   * `plan.approve` — approves a Plan through the real gate.
   *
   * An approval of a superseded version is refused with the version the user is
   * actually looking at, never applied to a different Plan (`AC-070`,
   * `experience.md` §3).
   */
  private approvePlan(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const gates = this.requireGates();
    const workId = requiredString(params, 'workId');
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    const revision = optionalString(params['revision']) ?? work.baseRevision ?? 'working-tree';
    const current = gates.getCurrentPlanApproval(workId, revision);
    const requestedVersion =
      optionalInteger(params['planVersion']) ??
      options.expectedVersion ??
      current.current?.planRef.version ??
      0;
    // The gate is the authority for "this Plan is still the approved one"; the
    // version check here is what makes an expired card an explicit conflict.
    const liveVersion = current.current?.planRef.version ?? 0;
    if (requestedVersion !== liveVersion) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `Plan version ${requestedVersion} is not the current one (${liveVersion})`,
        { details: { workId, currentVersion: liveVersion, requestedVersion } },
      );
    }
    const plan = parsePlanDraft(params['plan']);
    const approval = objectField(params, 'approval');
    const authorizationRef = requiredString(approval, 'authorizationRef');
    const requestedTokens = optionalInteger(approval['requestedTokens']);
    const result = gates.submitPlan({
      workId,
      revision,
      plan,
      approval: {
        authorizationRef,
        runId: requiredString(approval, 'runId'),
        productChanged: approval['productChanged'] === true,
        at: optionalString(approval['at']) ?? this.services.store.now(),
        ...(requestedTokens === undefined ? {} : { requestedTokens }),
      },
    });
    if (!result.approved) {
      throw new ProtocolError(protocolCode(result.code), result.message, {
        details: {
          workId,
          gaps: [...result.gaps],
          decisionRequired: result.decisionRequired,
          currentVersion: liveVersion,
        },
      });
    }
    // `WP-12` Q3=A: the dispatch decision is already persisted in the approved Plan, so
    // Core queues the next professional Run directly instead of asking a model to repeat it.
    const queued = this.queueApprovedRun({
      workId,
      plan,
      authorizationRef,
      planRef: result.planRef,
    });
    if (queued.runId === null) {
      // The approval is persisted, but the delivery hand-off did not happen. Returning
      // `applied` with a null `runId` used to leave the caller waiting forever (the
      // reason only reached an unwired log sink), so the command now fails with the
      // machine-readable reason; the Chief-settle hook (`resumeApprovedPlan`) retries
      // the hand-off once a live Chief Run exists again.
      this.logLine(
        `plan.approve: could not queue the professional Run: ${queued.reason ?? 'unknown'}`,
      );
      if (this.services.orchestrator === undefined) {
        // A daemon deliberately started without the execution stack (`execute:false`,
        // the headless query/drill surface) has no Run to queue by construction. The
        // approval is still real and `resumeApprovedPlan` hands it off once a stack is
        // attached, so this is not the silent `applied + null` defect: the reason is
        // explicit in the response and the log.
        return {
          status: 'applied',
          entityId: result.planRef.id,
          version: result.planRef.version,
          planRef: result.planRef,
          approvalRecordHash: result.approvalRecordHash,
          revision: result.revision,
          currentVersion: result.planRef.version,
          runId: null,
          pendingRun: true,
          reason: queued.reason,
        };
      }
      // With a live stack the hand-off must not fail silently: the caller gets the
      // machine-readable reason and the Chief-settle hook (`resumeApprovedPlan`)
      // retries once a live Chief Run exists again.
      throw new ProtocolError(
        'GATE_NOT_READY',
        `the Plan is approved but no professional Run could be queued: ${queued.reason ?? 'unknown'}`,
        { details: { workId, planRef: result.planRef, reason: queued.reason ?? null } },
      );
    }
    return {
      status: 'applied',
      entityId: result.planRef.id,
      version: result.planRef.version,
      planRef: result.planRef,
      approvalRecordHash: result.approvalRecordHash,
      revision: result.revision,
      currentVersion: result.planRef.version,
      runId: queued.runId,
    };
  }

  /**
   * Re-runs the professional-Run hand-off for a Work whose Plan is already approved.
   *
   * `plan.approve` can race a Chief Run's end: the approval is durable in the gate, but
   * the dispatch needs a live Chief parent. The daemon calls this when a Chief Run
   * settles, so the hand-off is retried exactly then instead of leaving an approved Plan
   * with no Run (G8 drill finding). A Work with no approved Plan, or one whose
   * professional Run already exists, is a no-op.
   */
  resumeApprovedPlan(workId: string): {
    readonly runId: string | null;
    readonly reason: string | null;
  } {
    const work = this.services.store.works.find(workId);
    if (work === undefined) return { runId: null, reason: `Work ${workId} does not exist` };
    const gates = this.services.gates;
    if (gates === undefined) return { runId: null, reason: 'this daemon has no Plan gate' };
    const revision = work.baseRevision ?? 'working-tree';
    const approval = gates.getCurrentPlanApproval(workId, revision);
    const current = approval.current;
    if (current === undefined) return { runId: null, reason: 'the gate holds no approved Plan' };
    const already = this.approvedRunIdOf(workId, current.planRef.id);
    if (already !== null) return { runId: already, reason: null };
    const plan = this.readPlanBody(workId, current.planRef.id);
    if (plan === null) return { runId: null, reason: 'the approved Plan body is unreadable' };
    const authorizationRef = current.approval.authorizationRef;
    if (authorizationRef === undefined || authorizationRef === '') {
      return { runId: null, reason: 'the approved Plan records no authorizationRef' };
    }
    return this.queueApprovedRun({
      workId,
      plan: plan as unknown as PlanDraft,
      authorizationRef,
      planRef: current.planRef,
    });
  }

  /**
   * The Plan gate's approval of the Plan a Planning Run *delivered* (WP-12 W4b).
   *
   * `workflow.md` §4 makes a Plan inside the effective authorization with no new product
   * choice `AutoApproved`; `docs/rules/agents.md` §1 makes the Planning Agent the author of
   * the Plan and `protocol.md` §6 makes the Run's delivered `artifactRefs` the transport
   * for its content (a `stage.submit` payload has no Plan field, by construction). This
   * method is the missing half of that contract: it reads the delivered Plan document,
   * validates it, asks the **Gate** to approve it (so `evaluatePlanApproval` — not this
   * code — decides auto-approval vs. `DecisionRequired`), and hands the approved Plan to
   * the same `queueApprovedRun` the user-facing approval uses. Nothing is approved here
   * that the Gate would refuse for a user-supplied draft.
   *
   * @returns the queued develop Run and the Plan artifact that carried the document.
   */
  approveDeliveredPlan(input: {
    readonly workId: string;
    readonly runId: string;
    readonly artifactRefs: readonly { readonly id: string; readonly version: number }[];
  }): {
    readonly runId: string | null;
    readonly planRef: Ref | null;
    readonly reason: string | null;
  } {
    const gates = this.services.gates;
    if (gates === undefined) return { runId: null, planRef: null, reason: 'no Plan gate' };
    const store = this.services.store;
    const work = store.works.find(input.workId);
    if (work === undefined) return { runId: null, planRef: null, reason: 'no such Work' };
    const approval = gates.getCurrentPlanApproval(
      input.workId,
      work.baseRevision ?? 'working-tree',
    );
    if (approval.current !== undefined) {
      // The Gate already approved a Plan for this revision (a replay, or a user who
      // approved a card first): the route continues from that record instead of approving
      // a second one.
      const queued = this.queueApprovedRun({
        workId: input.workId,
        plan: this.readPlanBody(input.workId, approval.current.planRef.id) as unknown as PlanDraft,
        authorizationRef: approval.current.approval.authorizationRef ?? '',
        planRef: approval.current.planRef,
      });
      return { runId: queued.runId, planRef: approval.current.planRef, reason: queued.reason };
    }
    const artifact = input.artifactRefs
      .map((ref) => store.artifacts.find(ref.id))
      .find(
        (row) =>
          row !== undefined &&
          row.workId === input.workId &&
          row.mime.includes('json') &&
          row.runId === input.runId,
      );
    if (artifact === undefined) {
      return {
        runId: null,
        planRef: null,
        reason:
          'the Plan stage delivered no JSON artifact of its own; a Plan must arrive as the Run’s artifact (docs/rules/agents.md §1, workflow.md §4)',
      };
    }
    const document = parseDeliveredPlanDocument(this.services.artifacts.read(artifact));
    if (document === null) {
      return {
        runId: null,
        planRef: null,
        reason: `artifact ${artifact.id} is not a Plan document (workflow.md §4 requires goal, scope and a task DAG)`,
      };
    }
    const authorizationRef = work.authorizationRef ?? '';
    const authorization = store.authorizations.find(authorizationRef);
    if (authorization === undefined) {
      return { runId: null, planRef: null, reason: 'the Work records no readable authorization' };
    }
    try {
      assertPlanWithinAuthority({
        plan: document,
        writePaths: authorization.scope.writePaths,
        operations: authorization.operations,
      });
    } catch (error) {
      return {
        runId: null,
        planRef: null,
        reason: `the delivered Plan is not authorized: ${errorText(error)}`,
      };
    }
    const draft: PlanDraft = {
      goal: document.goal.slice(0, 2_000),
      scope: {
        readPaths: [...document.scope.readPaths],
        writePaths: [...document.scope.writePaths],
        operations: [...document.scope.operations],
        networkTargets: [...document.scope.networkTargets],
      },
      tasks: document.tasks.map((task) => ({
        // `PlanTask.id` is an `idSchema`, i.e. a lowercase UUIDv7, so the Plan the delivered
        // document becomes must name its tasks the same way Core does (`data.md` §1). A
        // synthetic `…-task-1` id read back as "not a valid Plan" and blocked the first
        // write of the develop Run (WP-12 W4b).
        id: uuidv7(),
        role: task.role as PlanDraft['tasks'][number]['role'],
        goal: task.goal.slice(0, 2_000),
        paths: [...task.paths],
        dependsOn: [],
        acceptanceIds: [...task.acceptanceIds],
        checks: [...task.checks],
      })),
      // `Plan` requires non-empty entries when a list is present (`planSchema`:
      // `list(z.string().min(1))` and `normalizePlan` defaults the absent case to `[]`), so
      // an empty list is *omitted* rather than sent — exactly what `parsePlanDraft` does for
      // the user-facing draft.
      ...(document.interfaceChanges === undefined || document.interfaceChanges.length === 0
        ? {}
        : { interfaceChanges: [...document.interfaceChanges] }),
      ...(document.dataChanges === undefined || document.dataChanges.length === 0
        ? {}
        : { dataChanges: [...document.dataChanges] }),
      ...(document.risks === undefined || document.risks.length === 0
        ? {}
        : { risks: [...document.risks] }),
      ...(document.rollback === undefined || document.rollback.length === 0
        ? {}
        : { rollback: [...document.rollback] }),
    };
    // `productChanged` is the *user's* semantic decision, not something this path may
    // claim: a Plan that needs a new product choice must be refused as `DecisionRequired`
    // by the Gate and surface as a card. `false` here is therefore the honest declaration
    // "the Plan implements what the user's message authorized", and the Gate still refuses
    // it if the scope leaves the authorization (W4b).
    const result = gates.submitPlan({
      workId: input.workId,
      revision: work.baseRevision ?? 'working-tree',
      plan: draft,
      ...(work.requirementId === undefined ? {} : { requirementId: work.requirementId }),
      approval: {
        authorizationRef,
        runId: input.runId,
        productChanged: false,
        at: store.now(),
      },
    });
    if (!result.approved) {
      return {
        runId: null,
        planRef: null,
        reason: `${result.code}: ${result.message}${result.decisionRequired ? ' (a product Decision is required)' : ''}`,
      };
    }
    const queued = this.queueApprovedRun({
      workId: input.workId,
      plan: draft,
      authorizationRef,
      planRef: result.planRef,
    });
    return { runId: queued.runId, planRef: result.planRef, reason: queued.reason };
  }

  /**
   * Advances the documented L2/L3 route after one stage delivered (WP-12 W4b).
   *
   * The daemon calls this from the accepted `stage.submit` of a route stage
   * (`control-handler.ts`). `workflow.md` §3 fixes the order `Plan → Develop → Review →
   * Test → Accept → Settle` and `docs/rules/agents.md` §4 makes the Chief trigger the next
   * professional Run once a result reaches Core; `product-completion-plan.md` 判据③ makes
   * that continuation the difference between "a stage succeeded" and "one sentence reaches
   * a delivered Requirement". So this is deliberately **one** place that reads the route
   * from real records (`deliveryRoute`), refuses to queue what the Gate has not authorized,
   * and reuses `queueApprovedRun` for every stage — no drill-specific path exists.
   */
  continueDeliveryRoute(input: {
    readonly workId: string;
    readonly runId: string;
    readonly completedRole: string;
    readonly completedStage: string;
    readonly artifactRefs?: readonly { readonly id: string; readonly version: number }[];
  }): {
    readonly runId: string | null;
    readonly stage: string | null;
    readonly reason: string | null;
  } {
    const store = this.services.store;
    const gates = this.services.gates;
    const work = store.works.find(input.workId);
    if (work === undefined) return { runId: null, stage: null, reason: 'no such Work' };
    if (gates === undefined) return { runId: null, stage: null, reason: 'no Plan gate' };
    // The Plan stage is the one stage whose *delivery* is the approval: the Planning Run's
    // Plan document is read back, validated and submitted to the real gate (AC-014's
    // auto-approval included), which then queues the develop Run. Doing it here, before the
    // route projection is read, is what makes the projection see `Plan delivered` and move
    // on to Develop.
    //
    // The stage spelling is not the signal: `planning/planning` and `planning/document` are
    // both canonical Planning stages (`context/acl.ts` ROLE_STAGES), and a real model picks
    // either. What matters is that the Work has no approved Plan yet, so the delivered Plan
    // document is read back then.
    const approvedBefore = gates.getCurrentPlanApproval(
      input.workId,
      work.baseRevision ?? 'working-tree',
    );
    if (input.completedRole === 'planning' && approvedBefore.current === undefined) {
      const approval = this.approveDeliveredPlan({
        workId: input.workId,
        runId: input.runId,
        artifactRefs: input.artifactRefs ?? [],
      });
      if (approval.runId === null) {
        return { runId: null, stage: 'Plan', reason: approval.reason };
      }
      return { runId: approval.runId, stage: 'Develop', reason: null };
    }
    const approval = gates.getCurrentPlanApproval(
      input.workId,
      work.baseRevision ?? 'working-tree',
    );
    const route = deliveryRoute({
      store,
      work,
      planApproved: approval.status === 'approved' && approval.current !== undefined,
    });
    const next = nextDeliveryStage(route);
    if (next === undefined) {
      return { runId: null, stage: null, reason: null };
    }
    // The Develop stage is queued by the Plan approval itself (`plan.approve` / the
    // delivered-Plan path), so the route only *observes* it here; when the develop Run is
    // already queued and still running this is a no-op rather than a duplicate.
    if (next.stage === 'Develop') {
      const alreadyRunning = store.runs
        .list({ where: 'work_id = ?', params: [input.workId] })
        .some(
          (run) =>
            run.role === next.role &&
            (run.stage === developStageFor(work.level) ||
              run.stage === 'develop' ||
              run.stage.startsWith('develop-')),
        );
      if (alreadyRunning) return { runId: null, stage: 'Develop', reason: null };
    }
    if (next.stage === 'Plan') {
      return {
        runId: null,
        stage: 'Plan',
        reason: 'the Work has no approved Plan yet; the planning Run must deliver one first',
      };
    }
    const current = approval.current;
    if (current === undefined) {
      return {
        runId: null,
        stage: next.stage,
        reason: 'the route cannot advance without an approved Plan',
      };
    }
    const plan = this.readPlanBody(input.workId, current.planRef.id) as unknown as PlanDraft;
    if (plan === null || plan === undefined) {
      return { runId: null, stage: next.stage, reason: 'the approved Plan body is unreadable' };
    }
    // A stage the Chief already dispatched (it is awake and follows the same route) must not
    // be queued a second time: two live Runs for one stage are two deliveries of the same
    // step, and the second one can settle the Work again after the first completed it.
    // `workflow.md` §3 makes the route the *same* sequence for both triggers, so one live Run
    // per role is the invariant this projection can enforce.
    const liveForRole = store.runs
      .list({ where: 'work_id = ?', params: [input.workId] })
      .some((run) => run.role === next.role && !TERMINAL_RUN_STATUSES.includes(run.status));
    if (liveForRole) {
      return { runId: null, stage: next.stage, reason: null };
    }
    if (next.stage !== 'Develop') {
      if (next.role !== 'review' && next.role !== 'test' && next.role !== 'settlement') {
        return {
          runId: null,
          stage: next.stage,
          reason: `the route stage ${next.stage} has no professional role this path may queue (${next.role})`,
        };
      }
      const queued = this.queueRouteStage({
        workId: input.workId,
        plan,
        planRef: current.planRef,
        authorizationRef: current.approval.authorizationRef ?? '',
        role: next.role,
        purpose: next.purpose,
        runStage: next.runStage,
        goal: `${next.stage} the delivery for Work ${input.workId}: ${plan.goal}`.slice(0, 2_000),
        // The verification stages inspect the very Task the approved Plan tasked: the
        // develop Run froze its candidate in **that** Task's worktree
        // (`task-workspace.ts`), so Review/Test must bind to the same Task or they read a
        // different tree and honestly report that the change never landed (WP-12 W4b).
        ...(this.planTaskId(input.workId) === undefined
          ? {}
          : { taskId: this.planTaskId(input.workId) as string }),
      });
      return { runId: queued.runId, stage: next.stage, reason: queued.reason };
    }
    const queued = this.queueApprovedRun({
      workId: input.workId,
      plan,
      authorizationRef: current.approval.authorizationRef ?? '',
      planRef: current.planRef,
    });
    return { runId: queued.runId, stage: 'Develop', reason: queued.reason };
  }

  /**
   * Queues one continuation stage of an approved Plan's route (Review/Test/Settle).
   *
   * It shares `queueApprovedRun`'s shape — Core-owned `profileRevision`, budget injected by
   * the orchestrator, the approved Plan pinned in the context selection — and binds the
   * Run to the Plan's own Task so the verification roles read the same frozen candidate the
   * developer produced (`reliability.md` §4). The write envelope stays the Plan's; the
   * verification roles hold no file-write Grant by construction (`agents.md` §1).
   */
  /**
   * The Task the approved Plan materialised, which the route's Runs bind to.
   *
   * `plan.approve` writes the Plan's Task DAG with the approved `planRef`
   * (`materializePlanTasks`), while a pre-Plan stage's Task carries the placeholder
   * `planRef` `orchestrator.ensureStageTask` records (`version: 1`, a non-Plan hash). The
   * graded `planRef.version` of the real Plan is 1 too, so the discriminator is the Plan
   * artifact they name: the develop Run's Task is the one whose `planRef.id` is the
   * approved Plan's artifact.
   */
  private planTaskId(workId: string): string | undefined {
    const gates = this.services.gates;
    if (gates === undefined) return undefined;
    const work = this.services.store.works.find(workId);
    if (work === undefined) return undefined;
    const current = gates.getCurrentPlanApproval(
      workId,
      work.baseRevision ?? 'working-tree',
    ).current;
    if (current === undefined) return undefined;
    return this.services.store.tasks
      .list({ where: 'work_id = ?', params: [workId] })
      .find((task) => task.planRef.id === current.planRef.id)?.id;
  }

  private queueRouteStage(input: {
    readonly workId: string;
    readonly plan: PlanDraft;
    readonly planRef: { readonly id: string; readonly version: number; readonly hash: string };
    readonly authorizationRef: string;
    readonly role: 'review' | 'test' | 'settlement';
    readonly purpose: string;
    readonly runStage: string;
    readonly goal: string;
    readonly taskId?: string;
  }): { readonly runId: string | null; readonly reason: string | null } {
    const orchestrator = this.services.orchestrator;
    if (orchestrator === undefined) {
      return { runId: null, reason: 'the execution stack is not attached' };
    }
    const store = this.services.store;
    const chief = store.runs
      .list({ where: "work_id = ? AND role = 'chief'", params: [input.workId] })
      .filter((run) => RunLifecycle.canParentDispatch(run.status))
      .at(-1);
    if (chief === undefined) {
      return { runId: null, reason: 'no live Chief Run can parent the next stage' };
    }
    const task =
      (input.taskId === undefined ? undefined : store.tasks.find(input.taskId)) ??
      store.tasks
        .list({ where: 'work_id = ?', params: [input.workId] })
        .find((row) => row.role === (input.role === 'settlement' ? 'backend' : input.role)) ??
      store.tasks.list({ where: 'work_id = ?', params: [input.workId] }).at(0);
    const paths = [
      ...new Set([
        ...input.plan.scope.readPaths,
        ...input.plan.tasks.flatMap((entry) => entry.paths),
      ]),
    ];
    try {
      const { run } = orchestrator.dispatchProfessional({
        parentRunId: chief.id,
        authorizationRef: input.authorizationRef,
        spec: {
          ...(task === undefined ? {} : { taskId: task.id }),
          role: input.role,
          purpose: input.purpose as never,
          goal: input.goal,
          // A verification stage reads the frozen candidate and writes only its own report
          // (`execution.md` §1/§7): the scope carries the paths, never a write envelope.
          scope: {
            readPaths: paths,
            writePaths: [],
            operations: [],
            networkTargets: [],
          },
          stage: input.runStage,
          contextSelection: {
            goal: input.goal,
            sourceRefs: [
              {
                kind: 'artifact',
                id: input.planRef.id,
                version: String(input.planRef.version),
              },
            ],
            reasonPerSource: {
              [`artifact:${input.planRef.id}`]: 'the approved Plan this stage verifies',
            },
            featureRefs: [],
            codePaths: paths,
            artifactRefs: [],
            excluded: [],
            unknowns: [],
            readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
          },
          requiredOutputs: ['stage_result'],
          requiredChild: false,
          // `none`: the Chief is not waiting for this child, it is *driving* the route
          // (`continueDeliveryRoute` runs on the child's own delivery). The Chief Run stays
          // alive because an *earlier* stage used `join=all` (`supervisor.ts`).
          joinPolicy: 'none',
          budgetAllocation: STAGE_ROUTE_TOKENS,
        },
      });
      return { runId: run.id, reason: null };
    } catch (error) {
      return { runId: null, reason: errorText(error) };
    }
  }

  /**
   * Queues the professional Run an approved Plan authorizes (`WP-12` Q3=A).
   *
   * The Plan's own tasks name the role, the goal and the write paths, so no model runs in
   * between: `plan.approve` is the user's decision, and `agent.dispatch` would only restate
   * it. The Run is an ordinary professional Run — a direct child of the Work's Chief Run,
   * with `profileRevision` and the budget injected by Core (`orchestrator`).
   *
   * A Work with no live Chief Run cannot parent a professional Run at all (`rules/agents.md`
   * §3: every professional Run is a Chief child). The approval is not lost: it returns
   * `runId: null` and the reason is logged, so the operator can retry once the Chief Run
   * exists (the Plan stays approved).
   */
  private queueApprovedRun(input: {
    readonly workId: string;
    readonly plan: PlanDraft;
    readonly authorizationRef: string;
    readonly planRef: { readonly id: string; readonly version: number; readonly hash: string };
  }): { readonly runId: string | null; readonly reason: string | null } {
    const orchestrator = this.services.orchestrator;
    if (orchestrator === undefined) {
      return { runId: null, reason: 'the execution stack is not attached' };
    }
    const task = input.plan.tasks.find((entry) => entry.role !== 'chief');
    if (task === undefined) {
      return { runId: null, reason: 'the approved Plan has no professional task to dispatch' };
    }
    const chief = this.services.store.runs
      .list({ where: "work_id = ? AND role = 'chief'", params: [input.workId] })
      .filter((run) => RunLifecycle.canParentDispatch(run.status))
      .at(-1);
    if (chief === undefined) {
      return { runId: null, reason: 'no live Chief Run can parent the professional Run' };
    }
    const goal = task.goal.slice(0, 2_000);
    // `rules/workflow.md` §2: the Work's level fixes the develop stage, and the
    // context ACL / Grant envelope are keyed by `develop-L1|L2|L3`. Emitting the bare
    // `develop` here left the professional Run with no run-scope file Grant and a
    // degraded read ledger (T3 finding), so the canonical stage is computed at the
    // producer instead of being mapped downstream.
    const work = this.services.store.works.find(input.workId);
    const requirementId =
      work?.requirementId ??
      this.services.store.requirements
        .list({ where: 'work_id = ?', params: [input.workId] })
        .find((requirement) => requirement.lifecycle === 'active')?.id;
    const stage =
      task.role === 'backend' || task.role === 'frontend'
        ? work?.level === 'L1'
          ? 'develop-L1'
          : work?.level === 'L3'
            ? 'develop-L3'
            : 'develop-L2'
        : 'develop';
    try {
      // `WP-12 T2.8`: the approved Plan's Task DAG becomes real `task` rows, so a Run binds
      // to a Task and the board/detail can read the dependency and acceptance mapping
      // (`data.md` §2 `task`). Tasks are created once per Plan version.
      const taskRefs = this.materializePlanTasks({
        workId: input.workId,
        plan: input.plan,
        planRef: input.planRef,
      });
      const { run } = orchestrator.dispatchProfessional({
        parentRunId: chief.id,
        authorizationRef: input.authorizationRef,
        spec: {
          // The Task the approved Plan materialised for this role: `materializePlanTasks`
          // reuses the route's pre-Plan Task when it exists, so this is the same row the
          // verification stages bind to (and the same worktree the candidate lives in).
          taskId:
            taskRefs.get(task.id) ??
            orchestrator.claimStageTask({
              workId: input.workId,
              ...(requirementId === undefined ? {} : { requirementId }),
              role: task.role,
              planRef: input.planRef,
              readPaths: [...input.plan.scope.readPaths, ...task.paths],
              writePaths: task.paths,
            }),
          role: task.role,
          purpose: 'implementation',
          goal,
          scope: {
            readPaths: [...new Set([...input.plan.scope.readPaths, ...task.paths])],
            writePaths: [...task.paths],
            operations: [],
            networkTargets: [],
          },
          stage,
          contextSelection: {
            goal,
            sourceRefs: [
              {
                kind: 'artifact',
                id: input.planRef.id,
                version: String(input.planRef.version),
              },
            ],
            reasonPerSource: {
              [`artifact:${input.planRef.id}`]: 'the approved Plan this Run implements',
            },
            featureRefs: [],
            codePaths: [...task.paths],
            artifactRefs: [],
            excluded: [],
            unknowns: [],
            readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
          },
          requiredOutputs: ['stage_result'],
          requiredChild: false,
          joinPolicy: 'none',
          budgetAllocation: chief.budgetAllocation,
        },
      });
      return { runId: run.id, reason: null };
    } catch (error) {
      return { runId: null, reason: errorText(error) };
    }
  }

  /** `finding.submit` — records a Review/Test finding through the real service. */
  private submitFinding(params: JsonObject): unknown {
    const findings = this.requireFindings();
    const target = objectField(params, 'target');
    const result = findings.submitFinding({
      reviewRunId: requiredString(params, 'reviewRunId'),
      target: {
        targetKind: (optionalString(target['targetKind']) ?? 'task') as
          'task' | 'integration' | 'document',
        ...(optionalString(target['taskId']) === undefined
          ? {}
          : { taskId: target['taskId'] as string }),
        // The binding needs the resolved target version; the caller must name the
        // artifact/task ref it reviewed so the Finding cannot float free.
        targetRef: refField(target, 'targetRef'),
      },
      manifestRef: refField(params, 'manifestRef'),
      finding: {
        description: requiredString(params, 'description'),
        severity: requiredString(params, 'severity') as FindingSeverity,
        ...(typeof params['blocking'] === 'boolean' ? { blocking: params['blocking'] } : {}),
        ...(optionalString(params['path']) === undefined ? {} : { path: params['path'] as string }),
        ...(optionalInteger(params['line']) === undefined
          ? {}
          : { line: params['line'] as number }),
        ...(Array.isArray(params['evidenceRefs'])
          ? { evidenceRefs: stringArray(params['evidenceRefs']) }
          : {}),
      },
      ...(optionalString(params['taskId']) === undefined
        ? {}
        : { taskId: params['taskId'] as string }),
    });
    if (result.ok !== true) {
      throw new ProtocolError(result.code, result.message, {
        details: { gaps: [...result.gaps] },
      });
    }
    return {
      status: 'applied',
      entityId: result.finding.id,
      version: result.finding.version,
      finding: result.finding,
      binding: result.binding,
      routing: result.routing,
      invalidatedEvidenceRefs: [...result.invalidatedEvidenceRefs],
      returnedTaskIds: [...result.returnedTaskIds],
    };
  }

  /**
   * `decision.resolve` — records the user's choice on a pending decision.
   *
   * `experience.md` §5 / `AC-074`: the choice must be one the decision saved, the
   * target version must still be current, an expired decision can never be applied
   * again, and resolving twice with the same choice is idempotent.
   */
  private resolveDecision(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const decisionId = requiredString(params, 'decisionId');
    const choice = requiredString(params, 'choice');
    const targetVersion = optionalInteger(params['targetVersion']) ?? options.expectedVersion;
    const decision = this.services.store.decisions.find(decisionId);
    if (decision === undefined) {
      throw new ProtocolError('NOT_FOUND', `Decision ${decisionId} does not exist`, {
        details: { decisionId },
      });
    }
    if (targetVersion !== undefined && targetVersion !== decision.targetRef.version) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `Decision ${decisionId} targets version ${decision.targetRef.version}, not ${targetVersion}`,
        {
          details: {
            decisionId,
            currentVersion: decision.targetRef.version,
            requestedVersion: targetVersion,
          },
        },
      );
    }
    if (!decision.choices.includes(choice)) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `choice ${choice} is not one of the saved options`,
        {
          details: { decisionId, choices: [...decision.choices] },
        },
      );
    }
    if (decision.state === 'expired') {
      throw new ProtocolError('INVALID_STATE', `Decision ${decisionId} has expired`, {
        details: { decisionId, state: decision.state, currentVersion: decision.targetRef.version },
      });
    }
    if (decision.state !== 'pending') {
      if (decision.choice === choice) {
        return {
          status: 'applied',
          entityId: decision.id,
          version: decision.version,
          state: decision.state,
          choice,
          effectRefs: [...decision.effectRefs],
          idempotent: true,
        };
      }
      throw new ProtocolError(
        'INVALID_STATE',
        `Decision ${decisionId} is already ${decision.state} as ${decision.choice ?? 'unknown'}`,
        { details: { decisionId, state: decision.state, choice: decision.choice ?? null } },
      );
    }
    // A permission decision is the existing Inbox flow for `permission.respond`: the web
    // UI's approve/deny buttons submit `decision.resolve`, and routing it here is what
    // makes that button mint the bound Grant instead of only flipping the row (WP-12 T3).
    if (decision.kind === 'permission') {
      return this.respondPermission(
        {
          decisionId: decision.id,
          choice:
            choice === 'deny' || choice === 'reject' || choice === 'decline' ? 'deny' : 'approve',
          targetVersion: decision.targetRef.version,
          ...(params['targets'] === undefined ? {} : { targets: params['targets'] }),
        },
        {},
      );
    }
    // An L3 confirmation is also a `product` Decision, but its answer is not a
    // behaviour choice: `confirm` admits the high-risk delivery and `decline` records
    // the reason and leaves the Work blocked (`workflow.md` §2.3/§5.1, AC-011). It is
    // routed through the confirmation service before the `now/later/decline` branch
    // below, so the question's own choices are what is applied.
    const confirmation = this.services.confirmations?.find(decision.id);
    if (confirmation !== undefined) {
      const resolved = this.services.confirmations?.resolve({
        decisionId: decision.id,
        choice,
        ...(optionalString(params['reason']) === undefined
          ? {}
          : { reason: optionalString(params['reason']) as string }),
        ...(optionalString(params['decidedAt']) === undefined
          ? {}
          : { at: optionalString(params['decidedAt']) as string }),
      });
      if (resolved === undefined) {
        throw new ProtocolError('INTERNAL_ERROR', 'the L3 confirmation service disappeared');
      }
      // A confirmation the user accepted lifts the hold on a Work the routing had
      // parked before its route began; if any Run was already queued behind the hold
      // the ordinary supervisor pickup continues it, so `confirm` resumes the route
      // with no manual restart (`experience.md` §5, AC-011 item 2).
      return {
        status: 'applied',
        entityId: decision.id,
        version: resolved.confirmation.decisionVersion,
        state: resolved.confirmation.state,
        choice,
        effectRefs: [...decision.effectRefs],
        l3Confirmation: {
          workId: resolved.confirmation.workId,
          riskFlags: [...resolved.confirmation.riskFlags],
          accepted: resolved.accepted,
          workStatus: resolved.work.status,
          reason: resolved.confirmation.declineReason,
        },
      };
    }
    // A product decision resolves through the behaviour branch, so the choice's real
    // effect (evidence invalidation, a queued Requirement) is applied by Core.
    if (
      decision.kind === 'product' &&
      this.services.decisions !== undefined &&
      isBehaviourChoice(choice)
    ) {
      const recorded = this.services.decisions.recordBehaviourDecision({
        workId: decision.workId,
        choice,
        summary: optionalString(params['summary']) ?? `user choice ${choice}`,
        decidedAt: optionalString(params['decidedAt']) ?? this.services.store.now(),
      });
      return {
        status: 'applied',
        entityId: recorded.decisionId,
        version:
          this.services.store.decisions.find(recorded.decisionId)?.version ?? decision.version,
        state: recorded.decisionState,
        choice: recorded.choice,
        effectRefs: [...recorded.invalidatedEvidenceRefs],
        newDecisionId: recorded.decisionId,
      };
    }
    const effectRefs = stringArray(params['effectRefs']);
    return withTransaction(this.services.store.db, () => {
      const updated = this.services.store.decisions.update(
        decision.id,
        { state: choice === 'decline' ? 'rejected' : 'accepted', choice, effectRefs },
        decision.version,
      );
      this.services.store.events.append({
        name: 'decision.resolved',
        entityId: updated.id,
        entityVersion: updated.version,
        data: {
          decisionId: updated.id,
          workId: updated.workId,
          kind: updated.kind,
          choice,
          state: updated.state,
          targetVersion: updated.targetRef.version,
          effectRefs: [...effectRefs],
        },
      });
      return {
        status: 'applied',
        entityId: updated.id,
        version: updated.version,
        state: updated.state,
        choice,
        effectRefs: [...effectRefs],
      };
    });
  }

  /**
   * `permission.request` — records a pending user decision for one tool operation.
   *
   * `protocol.md` §4 gives the method's shape, and the plan's §6.3 makes the **server**
   * resolve the real binding instead of trusting the caller: when the request names a
   * `toolOperationId`, that row must exist, belong to the named Run/Work, and its recorded
   * `inputHash` is what the eventual `once` Grant is bound to. A caller therefore cannot
   * ask for authority over an operation it never attempted, nor substitute a hash that
   * would let a different tool call use the approval.
   */
  private requestPermission(params: JsonObject): JsonObject {
    const bridge = this.requireToolBridge('permission.request');
    const workId = requiredString(params, 'workId');
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    const operation = requiredString(params, 'operation');
    const role = requiredString(params, 'role');
    if (!(ROLES as readonly string[]).includes(role)) {
      throw new ProtocolError('VALIDATION_ERROR', `role ${role} is not a documented role`);
    }
    const stage = requiredString(params, 'stage');
    const targets = stringArray(params['targets']);
    const scope = optionalString(params['scope']) ?? 'once';
    if (scope !== 'once' && scope !== 'run' && scope !== 'work' && scope !== 'project') {
      throw new ProtocolError('VALIDATION_ERROR', `scope ${scope} is not a documented Grant scope`);
    }
    const runId = requiredString(params, 'runId');
    const run = this.services.store.runs.find(runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`, { details: { runId } });
    }
    if (run.workId !== work.id) {
      throw new ProtocolError('NOT_AUTHORIZED', `Run ${runId} belongs to another Work`, {
        details: { runId, workId: run.workId },
      });
    }
    const toolOperationId = requiredString(params, 'toolOperationId');
    const recorded = this.services.store.toolOperations.find(toolOperationId);
    if (recorded === undefined) {
      throw new ProtocolError(
        'NOT_FOUND',
        `tool operation ${toolOperationId} has not been attempted; a permission request must name a real call`,
        { details: { toolOperationId } },
      );
    }
    if (recorded.runId !== run.id || recorded.workId !== work.id) {
      throw new ProtocolError(
        'NOT_AUTHORIZED',
        `tool operation ${toolOperationId} belongs to Run ${recorded.runId}`,
        { details: { toolOperationId, runId: recorded.runId } },
      );
    }
    // The recorded hash wins over anything the caller sent: it is what the ledger keyed the
    // operation on, so the approval can only ever admit *that* call.
    const inputHash = recorded.inputHash;
    const requested = optionalString(params['inputHash']);
    if (requested !== undefined && requested !== inputHash) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `inputHash ${requested} is not the hash recorded for tool operation ${toolOperationId}`,
        { details: { toolOperationId, recorded: inputHash } },
      );
    }
    const expiresAt = optionalString(params['expiry']) ?? this.defaultGrantExpiry();
    const limits = recordOf(params['limits']);
    // The recorded targets win: the row is what the Broker admitted the call for, so an
    // approval cannot be minted against a target list the caller invented (T3 轮 2).
    const recordedTargets = recorded.targets;
    const decided = bridge.requestPermission({
      workId: work.id,
      runId: run.id,
      role: role as Role,
      stage,
      operation,
      targets: recordedTargets.length > 0 ? recordedTargets : targets,
      toolOperationId,
      inputHash,
      ...(scope === 'once' || scope === 'run' ? { scope } : {}),
      expiresAt,
      ...(limits === undefined ? {} : { limits }),
    });
    return {
      status: 'accepted',
      decisionId: decided.decisionId,
      version: decided.version,
      state: decided.state,
      workId: work.id,
      runId: run.id,
      operation,
      blockerAttached: decided.blockerAttached,
      runStatus: decided.runStatus ?? run.status,
    };
  }

  /**
   * `permission.respond` — applies the user's answer and emits `permission.resolved`.
   *
   * Only a pending `permission` Decision can be answered. An approval mints the bound
   * Grant (or a `run` Grant when the user chose "allow for this run"); a denial mints
   * nothing and returns the Run to `running` so the model can take another route
   * (`workflow.md` §57 keeps a refusal out of the transient-retry path).
   */
  /**
   * `protocol.md` §4 `chief.todo.resolve`: the user closes one user-facing Chief todo.
   *
   * The call is an acknowledgement, never an authorization: it records a user Action
   * plus a durable `chief.todo_resolved` event and nothing else — no Grant is minted, no
   * `configPolicy` changes and no tool call is admitted. Whether the refused file was
   * really handled stays the user's own action (`T3-implementation.md` 附录 A.1-3). The
   * Inbox drops the `(work, path, pattern)` this names.
   *
   * Unknown `todoId`s and a todo that belongs to another Work are both the same typed
   * `NOT_FOUND`: nothing outside the named Work can be closed through this method. A
   * second call is idempotent and reports the disposition already recorded.
   */
  private resolveChiefTodo(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const workId = requiredString(params, 'workId');
    const todoId = requiredString(params, 'todoId');
    const disposition = requiredString(params, 'disposition');
    if (disposition !== 'handled' && disposition !== 'dismissed') {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `disposition ${disposition} must be handled or dismissed`,
        { details: { workId, todoId, disposition } },
      );
    }
    const work = this.services.store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, {
        details: { workId },
      });
    }
    if (options.expectedVersion !== undefined && options.expectedVersion !== work.version) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `Work ${workId} is at version ${work.version}, not ${options.expectedVersion}`,
        {
          details: {
            workId,
            currentVersion: work.version,
            requestedVersion: options.expectedVersion,
          },
        },
      );
    }
    const todo = this.readUserTodos().find((entry) => entry.todoId === todoId);
    if (todo === undefined || todo.workId !== workId) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} has no user todo ${todoId}`, {
        details: { workId, todoId },
      });
    }
    const reason = optionalString(params['reason']);
    const recorded = this.todoResolution(todoId);
    if (recorded !== undefined) {
      // Closing a todo twice is a no-op that reports the disposition already recorded:
      // the first answer is the one that took effect, and no second effect is applied.
      return {
        status: 'applied',
        entityId: todoId,
        workId,
        todoId,
        disposition: recorded,
        state: 'resolved',
        idempotent: true,
      };
    }
    return withTransaction(this.services.store.db, () => {
      // The Action's target is the Work (a real entity id); the todo itself travels in
      // the payload, because a `(work, path, pattern)` key is not an entity id.
      const action = this.recordUserAction('chief.todo.resolve', workId, {
        workId,
        todoId,
        disposition,
        ...(reason === undefined ? {} : { reason }),
      });
      this.services.store.events.append({
        name: 'chief.todo_resolved',
        entityId: work.id,
        entityVersion: work.version,
        data: {
          workId,
          todoId,
          disposition,
          ...(reason === undefined ? {} : { reason }),
          actionId: action.id,
        },
      });
      return {
        status: 'applied',
        entityId: todoId,
        workId,
        todoId,
        disposition,
        state: 'resolved',
      };
    });
  }

  private respondPermission(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const bridge = this.requireToolBridge('permission.respond');
    const decisionId = requiredString(params, 'decisionId');
    const choice = requiredString(params, 'choice');
    if (choice !== 'approve' && choice !== 'deny') {
      throw new ProtocolError('VALIDATION_ERROR', `choice ${choice} must be approve or deny`, {
        details: { decisionId, choice },
      });
    }
    const decision = this.services.store.decisions.find(decisionId);
    if (decision === undefined) {
      throw new ProtocolError('NOT_FOUND', `Decision ${decisionId} does not exist`, {
        details: { decisionId },
      });
    }
    if (decision.kind !== 'permission') {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `Decision ${decisionId} is a ${decision.kind} decision; use decision.resolve for it`,
        { details: { decisionId, kind: decision.kind } },
      );
    }
    const expectedVersion = optionalInteger(params['targetVersion']) ?? options.expectedVersion;
    if (expectedVersion !== undefined && expectedVersion !== decision.targetRef.version) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `Decision ${decisionId} targets version ${decision.targetRef.version}, not ${expectedVersion}`,
        {
          details: {
            decisionId,
            currentVersion: decision.targetRef.version,
            requestedVersion: expectedVersion,
          },
        },
      );
    }
    if (decision.state !== 'pending') {
      // Answering twice with the same choice is idempotent; a different one is a conflict.
      const answered =
        decision.choice === choice ||
        (decision.state === 'accepted' && choice === 'approve') ||
        (decision.state === 'rejected' && choice === 'deny');
      if (answered) {
        return {
          status: 'applied',
          decisionId: decision.id,
          version: decision.version,
          state: decision.state,
          choice,
          reason: optionalString(params['reason']) ?? null,
          idempotent: true,
        };
      }
      throw new ProtocolError(
        'INVALID_STATE',
        `Decision ${decisionId} is already ${decision.state}`,
        { details: { decisionId, state: decision.state } },
      );
    }
    // The approval's binding comes from the recorded tool operation, never from the body:
    // the caller answers "yes" to the operation the Decision was created for.
    const recorded = this.services.store.toolOperations.find(decision.targetRef.id);
    const runId = recorded?.runId ?? this.runAwaitingPermission(decision.workId);
    const run = runId === undefined ? undefined : this.services.store.runs.find(runId);
    if (choice === 'deny') {
      // The user's denial reason is part of the answer (`protocol.md` §4): it is
      // recorded on the durable `permission.resolved` event, so a refusal is
      // auditable instead of only visible in the transient response. An empty reason
      // is the same as none.
      const reason = optionalString(params['reason']);
      const denied = bridge.respondPermission({
        decisionId: decision.id,
        choice: 'deny',
        operation: recorded?.toolName ?? '',
        runId: runId ?? '',
        role: run?.role ?? 'backend',
        stage: run?.stage ?? '',
        targets: [],
        toolOperationId: decision.targetRef.id,
        inputHash: decision.targetRef.hash,
        expiresAt: this.defaultGrantExpiry(),
        ...(reason === undefined ? {} : { reason }),
      });
      return {
        status: 'applied',
        decisionId: denied.decisionId,
        version: denied.version,
        state: denied.state,
        choice,
        reason: reason ?? null,
        runStatus: denied.runStatus ?? run?.status ?? null,
      };
    }
    if (recorded === undefined || run === undefined) {
      throw new ProtocolError(
        'MISSING_CONTEXT',
        `Decision ${decisionId} cannot be approved: its tool operation or Run is gone`,
        { details: { decisionId, toolOperationId: decision.targetRef.id } },
      );
    }
    const limits = recordOf(params['limits']);
    // The Grant's targets are the ones the `tool_operation` row recorded — the call the
    // Broker really admitted — falling back to the answered request for an operation with no
    // recorded targets. A path-shaped operation with neither is refused instead of minting a
    // Grant that authorizes nothing (or, worse, a target list nobody authorized).
    const answerTargets = stringArray(params['targets']);
    const grantTargets = recorded.targets.length > 0 ? recorded.targets : answerTargets;
    if (PATH_TARGET_OPERATIONS.includes(recorded.toolName) && grantTargets.length === 0) {
      throw new ProtocolError(
        'MISSING_CONTEXT',
        `tool operation ${recorded.id} recorded no targets; approving ${recorded.toolName} would mint a Grant that authorizes nothing`,
        { details: { decisionId, toolOperationId: recorded.id } },
      );
    }
    const approved = bridge.respondPermission({
      decisionId: decision.id,
      choice: 'approve',
      operation: recorded.toolName,
      runId: run.id,
      role: run.role,
      stage: run.stage,
      targets: grantTargets,
      toolOperationId: recorded.id,
      inputHash: recorded.inputHash,
      expiresAt: this.defaultGrantExpiry(),
      scope: optionalString(params['scope']) === 'run' ? 'run' : 'once',
      ...(limits === undefined ? {} : { limits }),
    });
    return {
      status: 'applied',
      decisionId: approved.decisionId,
      version: approved.version,
      state: approved.state,
      choice,
      grantId: approved.grantId ?? null,
      runStatus: approved.runStatus ?? run.status,
    };
  }

  /** The Run a Work's pending permission decision is about, when one exists. */
  private runAwaitingPermission(workId: string): string | undefined {
    return this.services.store.runs
      .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at DESC' })
      .find((run) => run.status === 'waiting_permission')?.id;
  }

  /** The expiry a permission Grant gets when the caller named none (`ARCHITECTURE.md` §5). */
  private defaultGrantExpiry(): string {
    return new Date(Date.now() + LIMITS.workActiveTimeSec.default * 1000).toISOString();
  }

  private requireToolBridge(method: string): ToolBridgePort {
    const bridge = this.services.toolBridge;
    if (bridge === undefined) {
      throw new ProtocolError(
        'PROVIDER_UNAVAILABLE',
        `${method} needs the tool bridge, which this daemon has not attached`,
        { details: { method } },
      );
    }
    return bridge;
  }

  /** Attaches the tool bridge once the execution stack exists (`permission.*`, cleanup). */
  attachToolBridge(port: ToolBridgePort): void {
    this.services.toolBridge = port;
  }

  /**
   * `config.save` — validates the patch, then writes it and bumps the revision.
   *
   * A rejected patch leaves the active configuration untouched and returns the
   * caller's input in the error details (`AC-075`); a stale `expectedVersion` is a
   * `VERSION_CONFLICT` carrying the live revision.
   */
  private saveConfig(
    params: JsonObject,
    options: { readonly expectedVersion?: number },
  ): JsonObject {
    const config = this.requireConfig();
    const scope = configScope(params['scope']);
    const patch = objectField(params, 'patch');
    const expected = optionalInteger(params['expectedVersion']) ?? options.expectedVersion;
    const currentVersion = config.versionOf(scope);
    if (expected !== undefined && expected !== currentVersion) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `config ${scope} revision is ${currentVersion}, not ${expected}`,
        { details: { scope, currentVersion, requestedVersion: expected, preservedInput: params } },
      );
    }
    try {
      const applied = config.update(scope, patch);
      return {
        status: 'applied',
        entityId: `${scope}:config`,
        version: applied.version,
        scope,
        revision: applied.version,
        previousVersion: currentVersion,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ConfigError') {
        // `ConfigStore.update` validates before it writes, so the active document
        // is provably unchanged when this branch is reached (`AC-075`).
        throw new ProtocolError('VALIDATION_ERROR', error.message, {
          details: { scope, currentVersion, preservedInput: params },
        });
      }
      throw error;
    }
  }

  /**
   * `config.test` — the provider stub.
   *
   * No model call is made: the documented behaviour under test is that an unusable
   * profile (missing provider, disabled provider, unsupported reasoning) is
   * reported clearly with the active configuration unchanged (`AC-075`).
   */
  private testConfig(params: JsonObject): unknown {
    const config = this.requireConfig();
    const role = (optionalString(params['role']) ?? 'chief') as Role;
    const resolution = config.resolve(role);
    const checkedAt = this.services.store.now();
    if (!resolution.ok) {
      throw new ProtocolError('PROVIDER_UNAVAILABLE', resolution.reason, {
        details: {
          role,
          reason: resolution.code,
          revision: config.versionOf('global'),
          preservedInput: params,
          checkedAt,
        },
      });
    }
    const { profile, model, provider, effectiveContextLimit, revision } = resolution.resolution;
    return {
      status: 'applied',
      entityId: provider.providerId,
      version: config.versionOf('global'),
      role,
      providerId: provider.providerId,
      modelId: model.id,
      reasoning: profile.reasoning,
      reasoningSupported: model.reasoningLevels.includes(profile.reasoning),
      effectiveContextLimit,
      revision,
      probe: 'capabilities-only',
      checkedAt,
    };
  }

  /**
   * `secret.set` (WP-12 T1.1).
   *
   * The installation master registers or replaces one credential. The value goes
   * straight into the durable repository and the in-memory store the Gateway resolves
   * against, so a running daemon honours the new credential on the next call without a
   * restart. Only metadata comes back; no branch here — including a validation error —
   * echoes the value (`execution.md` §4).
   *
   * **No command-ledger row is recorded.** Replacing a value on the same ref is
   * naturally idempotent, and the ledger's `payload_hash` would persist a digest of a
   * credential (WP-12 decision 2). An `idempotencyKey` is still accepted and validated
   * like any write, but the write simply runs and is not de-duplicated.
   */
  private setSecret(params: JsonObject, options: { readonly caller: WorkbenchCaller }): JsonObject {
    requireInstallationCaller(options.caller, 'secret.set');
    const { repository, store } = this.requireSecrets();
    const ref = requiredString(params, 'ref');
    const value = requiredString(params, 'value');
    const audience = secretAudience(params['audience']);
    try {
      const summary = repository.set(ref, value, { audience });
      // `put` re-validates ref/value/audience; an invalid one throws before the Gateway
      // could ever resolve the half-written registration.
      store.put({ ref, value, audience });
      return {
        status: 'applied',
        entityId: ref,
        version: 1,
        ref,
        configured: true,
        updatedAt: summary.updatedAt,
        backend: summary.backend,
      };
    } catch (error) {
      // Defence in depth (`execution.md` §4): even a future error path that embedded the
      // value is masked with the store's own redaction helper before it reaches the wire.
      const code = error instanceof ProtocolError ? error.code : 'VALIDATION_ERROR';
      throw new ProtocolError(code, redact(errorText(error), [value]));
    }
  }

  /**
   * `secret.delete` — removes the durable copy and the in-memory registration.
   *
   * Like `secret.set`, it records no command-ledger row (WP-12 decision 2): the
   * operation is naturally idempotent and no digest of a credential may be persisted.
   */
  private deleteSecret(
    params: JsonObject,
    options: { readonly caller: WorkbenchCaller },
  ): JsonObject {
    requireInstallationCaller(options.caller, 'secret.delete');
    const { repository, store } = this.requireSecrets();
    const ref = requiredString(params, 'ref');
    const deleted = repository.delete(ref);
    store.remove(ref);
    return { status: 'applied', entityId: ref, version: 1, ref, deleted };
  }

  /**
   * `secret.list` — metadata only: ref, configured, updatedAt, backend and health.
   *
   * An existing but undecryptable record is listed with `configured:false` and
   * `health:'unreadable'` plus the typed reason, and a file the backend could not treat as
   * a record at all is reported under `problems` (W12T1-01). Neither case throws, so this
   * query stays usable on a store that also makes the daemon log a warning.
   */
  private listSecrets(options: { readonly caller: WorkbenchCaller }): JsonObject {
    requireInstallationCaller(options.caller, 'secret.list');
    const { repository } = this.requireSecrets();
    return {
      backend: repository.backend,
      items: repository.list().map((entry) => ({
        ref: entry.ref,
        configured: entry.configured,
        updatedAt: entry.updatedAt,
        backend: entry.backend,
        health: entry.health,
        ...(entry.issue === undefined ? {} : { issue: { ...entry.issue } }),
      })),
      problems: repository.problems().map((problem) => ({ ...problem })),
    };
  }

  /** The credential services, or an honest refusal when this host wired none. */
  private requireSecrets(): { repository: SecretRepository; store: SecretStore } {
    const repository = this.services.secretRepository;
    const store = this.services.secrets;
    if (repository === undefined || store === undefined) {
      throw new ProtocolError('INVALID_STATE', 'this daemon has no credential store wired');
    }
    return { repository, store };
  }

  /**
   * `provider.upsert` (WP-12 T2.0, `protocol.md` §5).
   *
   * The command is the settings page's only way to register a Provider together with its
   * API key: `providerInputSchema` carries no secret (`secretRef` is server-created), so the
   * value arrives in the separate `secret` member and is written straight into the durable
   * repository the Gateway resolves against. Only metadata comes back — no branch here,
   * including a validation error, echoes the value (`execution.md` §4).
   *
   * A blank `secret` means "keep the stored credential": the provider keeps its
   * `secretRef`, exactly as the shipped editor documents.
   */
  private upsertProvider(params: JsonObject): JsonObject {
    const config = this.requireConfig();
    const providerInput = objectField(params, 'provider');
    const secret = optionalString(params['secret']);
    // The provider id is server-created (`protocol.md` §5); generating it here rather than
    // inside `upsertProvider` is what lets one config write carry the matching `secretRef`.
    const providerId = optionalString(providerInput['providerId']) ?? this.services.store.newId();
    // A blank `secret` means "keep the stored credential": the editor never round-trips the
    // value or the reference, so the existing provider's `secretRef` is preserved here
    // (`protocol.md` §5).
    let secretRef =
      optionalString(providerInput['secretRef']) ?? config.provider(providerId)?.secretRef;
    if (secret !== undefined) {
      const { repository, store } = this.requireSecrets();
      secretRef = secretRef ?? providerSecretRef(providerId);
      if (!isValidSecretRef(secretRef)) {
        throw new ProtocolError('VALIDATION_ERROR', 'the provider secret reference is invalid');
      }
      try {
        repository.set(secretRef, secret, { audience: 'gateway' });
        // `put` re-validates ref/value/audience before the Gateway could resolve a
        // half-written registration.
        store.put({ ref: secretRef, value: secret, audience: 'gateway' });
      } catch (error) {
        const code = error instanceof ProtocolError ? error.code : 'VALIDATION_ERROR';
        throw new ProtocolError(code, redact(errorText(error), [secret]));
      }
    }
    const effectiveRef = secretRef ?? optionalString(providerInput['secretRef']);
    try {
      const saved = config.upsertProvider({
        ...(providerInput as unknown as ProviderInput),
        providerId,
        ...(effectiveRef === undefined ? {} : { secretRef: effectiveRef }),
      });
      return {
        status: 'applied',
        entityId: saved.providerId,
        providerId: saved.providerId,
        version: saved.version,
        // "configured" means the store can really resolve it, not that a string exists.
        secretConfigured: this.secretRegistered(effectiveRef),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'ConfigError') {
        throw new ProtocolError('VALIDATION_ERROR', error.message, {
          details: { preservedInput: withoutSecret(params) },
        });
      }
      throw error;
    }
  }

  /**
   * `provider.test` (WP-12 T2.0, `protocol.md` §5).
   *
   * The command answers `accepted` synchronously — a real probe is a model round trip, and
   * `dispatchEnvelope` must never wait for one — and the outcome lands as the persistent
   * `provider.test_completed` event (`protocol.md` §7). A target that cannot even be
   * attempted (unknown provider or model, missing credential) is refused in the answer, so
   * the UI never shows "testing" for something that will not run.
   */
  private testProvider(params: JsonObject): JsonObject {
    const config = this.requireConfig();
    const gateway = this.services.gateway;
    if (gateway === undefined) {
      throw new ProtocolError('INVALID_STATE', 'this daemon has no model gateway wired');
    }
    const providerId = requiredString(params, 'providerId');
    const modelId = requiredString(params, 'modelId');
    const provider = config.provider(providerId);
    if (provider === undefined) {
      throw new ProtocolError('NOT_FOUND', `provider ${providerId} is not configured`, {
        details: { providerId },
      });
    }
    if (!provider.enabled) {
      return {
        status: 'accepted',
        accepted: false,
        providerId,
        modelId,
        reason: 'the provider is disabled',
      };
    }
    if (!provider.models.some((model) => model.id === modelId)) {
      throw new ProtocolError('NOT_FOUND', `model ${modelId} is not configured`, {
        details: { providerId, modelId },
      });
    }
    const checkedAt = this.services.store.now();
    const operationId = this.services.store.newId();
    // The probe runs after the answer; the event is the documented outcome channel.
    void this.probeProvider(gateway, { providerId, modelId, operationId, checkedAt });
    return { status: 'accepted', accepted: true, providerId, modelId, operationId, checkedAt };
  }

  /**
   * Runs one `provider.test` probe and appends its persistent outcome.
   *
   * Failures are reported as the event's `error`, never as an unhandled rejection: the
   * command already answered `accepted`, and an accepted test whose result never arrives
   * would be exactly the silent success `protocol.md` §7 forbids.
   */
  private async probeProvider(
    gateway: ModelGateway,
    input: {
      readonly providerId: string;
      readonly modelId: string;
      readonly operationId: string;
      readonly checkedAt: string;
    },
  ): Promise<void> {
    let outcome: { ok: boolean; latencyMs: number; error?: string };
    try {
      outcome = await gateway.testConnection(input.providerId, input.modelId);
    } catch (error) {
      outcome = { ok: false, latencyMs: 0, error: errorText(error) };
    }
    try {
      this.services.store.events.append({
        name: 'provider.test_completed',
        entityId: input.providerId,
        entityVersion: this.services.config?.versionOf('global') ?? 0,
        data: {
          providerId: input.providerId,
          modelId: input.modelId,
          operationId: input.operationId,
          accepted: outcome.ok,
          ok: outcome.ok,
          latencyMs: outcome.latencyMs,
          checkedAt: input.checkedAt,
          ...(outcome.error === undefined ? {} : { error: outcome.error }),
        },
      });
    } catch (error) {
      // The outcome could not be persisted; there is no honest client to tell, so this is
      // the only place a log line is the right answer.
      this.logLine(
        `provider.test: could not record the outcome for ${input.providerId}: ${errorText(error)}`,
      );
    }
  }

  /** Optional diagnostic sink; the daemon passes none in tests. */
  private logLine(line: string): void {
    this.services.log?.(line);
  }

  /**
   * Whether one Provider's `secretRef` is really registered (WP-12 T1.1).
   *
   * `protocol.md` §5 promises the browser only "whether one is configured"; the honest
   * answer is "a ref exists **and** the store can resolve it", which is what the
   * Gateway itself requires before it will attempt a call.
   */
  private secretRegistered(ref: string | undefined): boolean {
    if (ref === undefined) return false;
    if (this.services.secrets !== undefined) return this.services.secrets.has(ref);
    // `list()` never throws now (W12T1-01), so this fallback cannot turn a bad record
    // into a 500 on `config.get`/`agents`.
    return (
      this.services.secretRepository
        ?.list()
        .some((entry) => entry.ref === ref && entry.health === 'ok') ?? false
    );
  }

  /** `backup.run` — a complete backup or an honest refusal. */
  private runBackup(params: JsonObject): unknown {
    const outputDir = requiredString(params, 'outputDir');
    const outcome = backupProject({
      store: this.services.store,
      git: this.backupGit,
      outputDir,
      replace: params['replace'] === true,
      ...(optionalString(params['documentRoot']) === undefined
        ? {}
        : { documentRoot: params['documentRoot'] as string }),
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: { reasons: [...outcome.reasons], incomplete: outcome.incomplete, outputDir },
      });
    }
    return {
      status: 'applied',
      entityId: outcome.backupId,
      version: 1,
      backupId: outcome.backupId,
      directory: outcome.directory,
      manifestPath: outcome.manifestPath,
      manifest: outcome.manifest,
      // A backup that could not include a Git bundle says so rather than claiming a
      // complete delivery snapshot.
      gitIncluded: outcome.manifest.git !== null,
    };
  }

  /** `restore.run` — verifies every hash before writing, then reports readiness. */
  private runRestore(params: JsonObject): unknown {
    const backupDir = requiredString(params, 'backupDir');
    const targetDir = requiredString(params, 'targetDir');
    const outcome = restoreProject({
      backupDir,
      targetDir,
      git: this.backupGit,
      replace: params['replace'] === true,
    });
    if (!outcome.ok) {
      throw new ProtocolError(outcome.code, outcome.message, {
        details: { reasons: [...outcome.reasons], partial: outcome.partial, backupDir, targetDir },
      });
    }
    return {
      status: 'applied',
      entityId: outcome.projectId,
      version: 1,
      projectId: outcome.projectId,
      restoredStatus: outcome.status,
      dataDir: outcome.dataDir,
      repoRoot: outcome.repoRoot,
      revision: outcome.revision,
      consistency: outcome.consistency,
      recovery: outcome.recovery,
      doctor: outcome.doctor,
      provider: outcome.provider,
    };
  }

  /**
   * `ui.translate` — the interface-string catalogue.
   *
   * `experience.md` §6: only the UI's own strings are translated; user messages,
   * project documents and Agent output are returned untouched and flagged
   * `translatable:false`, so project content is never auto-translated.
   */
  private translate(params: JsonObject): unknown {
    const resourceId = requiredString(params, 'resourceId');
    const locale = optionalString(params['locale']) ?? 'en';
    if (locale !== 'en' && locale !== 'zh') {
      throw new ProtocolError('VALIDATION_ERROR', `unsupported interface locale ${locale}`);
    }
    if (params['content'] !== undefined) {
      return {
        resourceId,
        translatable: false,
        source: 'project-content',
        targetLocale: locale,
        content: params['content'],
        reason: 'user messages, project documents and Agent output are never machine-translated',
      };
    }
    const entry = UI_STRINGS[resourceId];
    if (entry === undefined) {
      throw new ProtocolError('NOT_FOUND', `unknown interface string ${resourceId}`, {
        details: { resourceId },
      });
    }
    return {
      resourceId,
      translatable: true,
      source: 'interface',
      targetLocale: locale,
      content: locale === 'zh' ? entry.zh : entry.en,
      original: { en: entry.en, zh: entry.zh },
    };
  }

  // -------------------------------------------------------------------------
  // Event routing (called by the socket layer)
  // -------------------------------------------------------------------------

  /**
   * Delivers every pending event of one connection's subscriptions.
   *
   * The scan watermark is reported for an empty batch as well (`protocol.md` §2),
   * and a disconnect only drops the in-memory bookkeeping: the persistent events
   * stay in the log, so a reconnect replays exactly what was missed.
   */
  pollConnection(
    connection: ServerWebSocket,
    subscriptions: Map<string, SubscriptionRecord>,
  ): void {
    for (const subscription of [...subscriptions.values()]) {
      // The scan watermark is taken before the read, so a `batch_end` never claims
      // a cursor whose events were not handed over (`protocol.md` §2).
      const scannedThrough = this.services.events.watermark();
      let pending: Event[];
      try {
        pending = this.services.store.events
          .readAfter(subscription.cursor, { limit: 200 })
          .filter((event) => event.cursor <= scannedThrough)
          .filter((event) => matchesSubscription(event, subscription.scope));
      } catch (error) {
        connection.sendError(
          null,
          error instanceof ProtocolError
            ? error
            : new ProtocolError('RESYNC_REQUIRED', 'the subscription cursor was truncated', {
                details: { subscriptionId: subscription.id },
              }),
        );
        continue;
      }
      for (const event of pending) {
        connection.sendEvent(event);
        if (event.cursor > subscription.cursor) subscription.cursor = event.cursor;
      }
      // Every scan reports its watermark, an empty batch included.
      connection.sendRaw({
        type: 'batch_end',
        subscriptionId: subscription.id,
        scannedThrough,
      });
    }
  }

  /** Opens one subscription for a connection (`project.subscribe`). */
  subscribe(
    connection: ServerWebSocket,
    params: JsonObject,
    projectId: string | undefined,
    subscriptions: Map<string, SubscriptionRecord>,
  ): JsonObject {
    if (projectId !== undefined && projectId !== this.projectId) {
      // A cross-Project subscription is refused before any snapshot exists; the
      // details echo the requested id only, never this installation's own
      // (`protocol.md` §1, W9R1-03).
      throw new ProtocolError('NOT_FOUND', `Project ${projectId} is not open on this daemon`, {
        details: { projectId },
      });
    }
    const scope = params['scope'];
    if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
      throw new ProtocolError('VALIDATION_ERROR', 'scope must be an object');
    }
    const afterCursor = params['afterCursor'];
    if (
      afterCursor !== undefined &&
      (typeof afterCursor !== 'number' || !Number.isInteger(afterCursor))
    ) {
      throw new ProtocolError('VALIDATION_ERROR', 'afterCursor must be an integer');
    }
    const typedScope = scope as { kind: 'summary' | 'conversation' | 'work' | 'run'; id?: string };
    // The hub owns snapshot consistency: a snapshot and its cursor come from one
    // watermark, and a resume from `afterCursor` answers `RESYNC_REQUIRED` when the
    // cursor was truncated. The connection keeps its own delivery watermark, so a
    // replayed event is never delivered twice (`AC-054`).
    const result = this.services.events.subscribe({
      connectionId: connection.connectionId,
      scope: typedScope,
      ...(afterCursor === undefined ? {} : { afterCursor }),
    });
    // A resume replays the events after `afterCursor`; a fresh subscribe starts at
    // the snapshot cursor because everything at or below it is already in the
    // snapshot.
    let watermark = afterCursor === undefined ? result.cursor : afterCursor;
    const record: SubscriptionRecord = {
      id: result.subscriptionId,
      scope: typedScope,
      cursor: watermark,
    };
    // One live subscription per (kind, id): a re-subscribe of the same scope
    // replaces the previous stream instead of leaving a second reader that would
    // replay the same events into the same connection (`AC-054`).
    for (const [id, existing] of [...subscriptions]) {
      if (sameScopeRecord(existing.scope, typedScope)) {
        subscriptions.delete(id);
        this.services.events.remove(id);
      }
    }
    subscriptions.set(result.subscriptionId, record);
    if (result.events !== undefined) {
      for (const event of result.events) {
        connection.sendEvent(event);
        if (event.cursor > watermark) watermark = event.cursor;
      }
      record.cursor = watermark;
    }
    connection.sendRaw({
      type: 'batch_end',
      subscriptionId: result.subscriptionId,
      scannedThrough: afterCursor === undefined ? result.cursor : watermark,
    });
    return {
      subscriptionId: result.subscriptionId,
      cursor: afterCursor === undefined ? result.cursor : watermark,
      mode: result.mode,
      ...(result.snapshot === undefined ? {} : { snapshot: result.snapshot }),
    };
  }

  /** `subscription.set` (`protocol.md` §2). */
  setScope(
    connection: ServerWebSocket,
    params: JsonObject,
    subscriptions: Map<string, SubscriptionRecord>,
  ): JsonObject {
    const subscriptionId = requiredString(params, 'subscriptionId');
    const existing = subscriptions.get(subscriptionId);
    if (existing === undefined) {
      throw new ProtocolError('NOT_FOUND', `subscription ${subscriptionId} does not exist`);
    }
    const scope = params['scope'];
    if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
      throw new ProtocolError('VALIDATION_ERROR', 'scope must be an object');
    }
    const result = this.services.events.setScope(
      subscriptionId,
      scope as { kind: 'summary' | 'conversation' | 'work' | 'run'; id?: string },
    );
    // A scope change always answers a fresh snapshot, so the delivery watermark
    // moves to the snapshot cursor and the previous scope's events are not replayed
    // into the enlarged scope.
    existing.cursor = result.cursor;
    existing.scope = scope as { kind: string; id?: string };
    connection.sendRaw({ type: 'batch_end', subscriptionId, scannedThrough: result.cursor });
    return { subscriptionId, snapshot: result.snapshot, cursor: result.cursor };
  }

  /** `subscription.remove` (`protocol.md` §2). */
  removeSubscription(
    params: JsonObject,
    subscriptions: Map<string, SubscriptionRecord>,
  ): JsonObject {
    const subscriptionId = requiredString(params, 'subscriptionId');
    subscriptions.delete(subscriptionId);
    return { removed: this.services.events.remove(subscriptionId).removed };
  }

  /** `project.events.ack` (`protocol.md` §2). */
  ackCursor(params: JsonObject, subscriptions: Map<string, SubscriptionRecord>): JsonObject {
    const subscriptionId = requiredString(params, 'subscriptionId');
    const cursor = params['cursor'];
    if (typeof cursor !== 'number' || !Number.isInteger(cursor)) {
      throw new ProtocolError('VALIDATION_ERROR', 'cursor must be an integer');
    }
    const { acknowledged } = this.services.events.ack(subscriptionId, cursor);
    const existing = subscriptions.get(subscriptionId);
    if (existing !== undefined) existing.cursor = acknowledged;
    return { acknowledged };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private runningRunCount(): number {
    return this.services.store.runs.count(
      "status IN ('running','starting','waiting_permission','waiting_children')",
    );
  }

  /**
   * One `project.list` item from the installation directory (WP-12 T5).
   *
   * The first nine fields are `ProjectSummary` (`protocol.md` §3); the rest are the
   * T5 additions the switcher needs — the real lifecycle state (`missing`/
   * `unreadable` cannot be expressed by `ProjectState`), the typed problem, the
   * initialization facts and the requirement-import summary. A `version` of `0` means
   * "no local row was read for this entry" rather than "version zero", which is a
   * fact the caller can act on.
   */
  private projectSummaryOfEntry(entry: ProjectEntry): JsonObject {
    return {
      projectId: entry.projectId ?? entry.root,
      name: entry.name,
      root: entry.root,
      trust: entry.trust,
      state: entry.state === 'open' ? 'open' : 'closed',
      version: 0,
      updatedAt: entry.updatedAt === '' ? new Date(0).toISOString() : entry.updatedAt,
      runningRuns: entry.runningRuns,
      executionReady: entry.executionReady,
      lifecycleState: entry.state,
      gitRoot: entry.gitRoot,
      head: entry.head,
      problem: entry.problem,
      initialization: asJsonValue(entry.initialization),
      requirementImport: asJsonValue(entry.import),
    };
  }

  private projectSummaryOf(projectId: string): ProjectSummary {
    const project = this.services.store.projects.find(projectId);
    if (project === undefined) {
      throw new ProtocolError('NOT_FOUND', `Project ${projectId} does not exist`);
    }
    const resolution = this.services.config?.resolve('chief');
    return {
      projectId: project.id,
      name: basename(project.root),
      root: project.root,
      trust: project.trust,
      state: project.state,
      version: project.version,
      updatedAt: project.updatedAt,
      runningRuns: this.runningRunCount(),
      executionReady: resolution === undefined ? true : resolution.ok,
    };
  }

  /**
   * The branch/commit/unpushed facts of one requirement record (AC-090).
   *
   * `requirements.md` §3: the UI shows the branch and commit the record lives on and
   * whether that commit is on the remote yet. `portableRef.revision` is the record's
   * own Git revision, so it is the commit; `working-tree` means the record has no
   * commit yet and is therefore reported as not pushed. `unpushed` is only `false`
   * when Git proves the commit is contained in the tracked upstream revision.
   */
  private gitFactsOf(
    row: { readonly portableRef: { readonly revision: string } },
    context: {
      readonly root: string;
      readonly branch: string;
      readonly upstreamRevision: string | null;
    },
  ): JsonObject {
    const revision = row.portableRef.revision;
    const commit = revision === '' || revision === 'working-tree' ? null : revision;
    if (commit === null) {
      return {
        branch: context.branch,
        commit: null,
        unpushed: true,
        upstreamRevision: context.upstreamRevision,
      };
    }
    if (context.upstreamRevision === null) {
      return {
        branch: context.branch,
        commit,
        // No upstream ref holds the branch, so nothing about it is pushed yet.
        unpushed: true,
        upstreamRevision: null,
      };
    }
    const contained = this.requirementGit.isAncestor(
      context.root,
      commit,
      context.upstreamRevision,
    );
    return {
      branch: context.branch,
      commit,
      // An unresolvable comparison is reported as "not pushed" rather than as a
      // false "in sync" (`reliability.md` §87 keeps the state honest).
      unpushed: !contained.ok || !contained.value,
      upstreamRevision: context.upstreamRevision,
    };
  }

  /**
   * The Git context of the current Project, or `null` when it carries no root/branch.
   *
   * Resolved once per read so a board of N requirements costs one upstream lookup
   * instead of N; the per-record cost is one `is-ancestor` probe.
   */
  private gitContext(): {
    readonly root: string;
    readonly branch: string;
    readonly upstreamRevision: string | null;
  } | null {
    const project = this.services.store.projects.find(this.projectId);
    const root = project?.gitRoot ?? project?.root;
    const branch = project?.deliveryBranch;
    if (root === undefined || root === '' || branch === undefined || branch === '') return null;
    let upstreamRevision: string | null = null;
    for (const name of [`refs/remotes/origin/${branch}`, `${branch}@{u}`]) {
      const found = this.requirementGit.resolveRevision(root, name);
      if (found.ok && found.value !== null) {
        upstreamRevision = found.value;
        break;
      }
    }
    return { root, branch, upstreamRevision };
  }

  private taskCounts(workId: string): JsonObject {
    const tasks = this.services.store.tasks.list({ where: 'work_id = ?', params: [workId] });
    return {
      total: tasks.length,
      done: tasks.filter((task) => task.stage === 'done').length,
      develop: tasks.filter((task) => task.stage === 'develop').length,
      review: tasks.filter((task) => task.stage === 'review').length,
      test: tasks.filter((task) => task.stage === 'test').length,
      ready: tasks.filter((task) => task.stage === 'ready').length,
    };
  }

  private pendingDecisionCount(workId: string): number {
    return this.services.store.decisions
      .list({ where: 'work_id = ?', params: [workId] })
      .filter((decision) => decision.state === 'pending').length;
  }

  private requirementSummary(
    row: {
      readonly id: string;
      readonly title: string;
      readonly goal: string;
      readonly lifecycle: string;
      readonly phase?: string | undefined;
      readonly workId?: string | undefined;
      readonly recordVersion: number;
      readonly portableRef: {
        readonly path: string;
        readonly revision: string;
        readonly hash: string;
      };
      readonly executionAvailability: string;
      readonly evidenceAvailability: string;
      readonly version: number;
      readonly createdAt: string;
      readonly updatedAt: string;
    },
    git: JsonObject | null,
  ): JsonObject {
    return {
      id: row.id,
      title: row.title,
      goal: row.goal,
      lifecycle: row.lifecycle,
      phase: row.phase ?? null,
      workId: row.workId ?? null,
      recordVersion: row.recordVersion,
      portableRef: row.portableRef,
      git,
      executionAvailability: row.executionAvailability,
      evidenceAvailability: row.evidenceAvailability,
      waitingToContinue: row.workId === undefined && row.lifecycle === 'active',
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      saveState: this.saveStateOf(row.id),
    };
  }

  /** The honest save state of one requirement (`protocol.md` §8). */
  private saveStateOf(requirementId: string): 'saved' | 'saving' | 'save_failed' {
    const operations = this.services.store.operations.list({
      where: 'requirement_id = ?',
      params: [requirementId],
      orderBy: 'created_at ASC',
    });
    const latest = operations.at(-1);
    if (latest === undefined) return 'saved';
    if (latest.state === 'completed') return 'saved';
    if (latest.state === 'failed') return 'save_failed';
    return 'saving';
  }

  /** Requirement ids this server imported as active and has not continued yet. */
  private continuableIds(): string[] {
    const continuation = this.services.requirements;
    if (continuation === undefined) return [];
    return continuation.listContinuable().items.map((item) => item.requirementId);
  }

  private featureView(
    row: { readonly fields: Record<string, unknown>; readonly relations: Record<string, unknown> },
    view: string,
  ): JsonObject {
    // The projection fields are contract JSON (`FeatureProjection.fields`), so the
    // serialisation round-trip only proves what the store already guarantees.
    return jsonSafe({
      view,
      fields: row.fields,
      design: row.fields['design'] ?? null,
      implementation: row.fields['implementation'] ?? null,
      verification: row.fields['verification'] ?? null,
      relations: row.relations,
    });
  }

  private sourceRefsOf(row: {
    readonly documentPath: string;
    readonly documentHash: string;
  }): SourceRef[] {
    return [
      {
        kind: 'git',
        id: row.documentPath,
        version: row.documentHash,
        path: row.documentPath,
        hash: row.documentHash,
      },
    ];
  }

  private knowledgeUnknowns(revision: string, featureCount: number): string[] {
    if (featureCount === 0) {
      return [
        `revision ${revision} 没有已发布的 feature 投影；先初始化或导入正式文档后才能回答（AC-025）`,
      ];
    }
    return [];
  }

  private readMessageBody(relativeBlobPath: string): string | null {
    try {
      return Buffer.from(this.services.blobs.read(relativeBlobPath)).toString('utf8');
    } catch {
      // A missing message body is reported as absent rather than invented; the
      // message row and its state stay visible.
      return null;
    }
  }

  private recordUserAction(action: string, targetId: string, payload: JsonObject) {
    return this.services.store.userActions.insert({
      actorId: userIdFromSubject('installation:local'),
      action,
      targetId,
      payload,
      payloadHash: sha256Of(payload),
    });
  }

  private sourceRefOf(
    params: JsonObject,
    kind: 'action' | 'message',
  ): { readonly kind: 'action' | 'message'; readonly id: string; readonly version: string } {
    const explicit = optionalString(params['sourceRefId']);
    if (explicit !== undefined) return { kind, id: explicit, version: '1' };
    const action = this.recordUserAction(
      'requirement.save',
      optionalString(params['requirementId']) ?? this.projectId,
      params,
    );
    return { kind: 'action', id: action.id, version: '1' };
  }

  private requireConfig(): ConfigStore {
    const config = this.services.config;
    if (config === undefined) {
      throw new ProtocolError('INVALID_STATE', 'this daemon was started without a ConfigStore');
    }
    return config;
  }

  private requireGates(): PlanGateService {
    const gates = this.services.gates;
    if (gates === undefined) {
      throw new ProtocolError('INVALID_STATE', 'this daemon was started without the Plan gate');
    }
    return gates;
  }

  private requireFindings(): FindingService {
    const findings = this.services.findings;
    if (findings === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'this daemon was started without the finding service',
      );
    }
    return findings;
  }

  private requireContinuation(): RequirementContinuation {
    const continuation = this.services.requirements;
    if (continuation === undefined) {
      throw new ProtocolError(
        'INVALID_STATE',
        'this daemon was started without the requirement continuation service',
      );
    }
    return continuation;
  }
}

// ---------------------------------------------------------------------------
// The WebSocket connection
// ---------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const WORK_VIEW_UNKNOWN = 'Work 视图是目标覆盖，不代表已交付行为（experience.md §4）';

/**
 * One accepted WebSocket connection.
 *
 * The socket owns the handshake (`connection.hello` first, nothing else before it),
 * its subscription registry and the frame codec. Anything unexpected still answers
 * a protocol-shaped response, so a client never has to guess why it heard nothing.
 */
export class ServerWebSocket {
  private readonly socket: Duplex;
  private readonly protocol: WorkbenchProtocol;
  readonly caller: WorkbenchCaller;
  readonly connectionId: string;
  readonly subscriptions = new Map<string, SubscriptionRecord>();
  private buffer = Buffer.alloc(0);
  private helloDone = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pendingPoll: ReturnType<typeof setImmediate> | undefined;
  private frameSequence = 0;

  constructor(
    socket: Duplex,
    protocol: WorkbenchProtocol,
    caller: WorkbenchCaller,
    connectionId: string,
  ) {
    this.socket = socket;
    this.protocol = protocol;
    this.caller = caller;
    this.connectionId = connectionId;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
    // The server greets with its identity; `connection.hello` is still required
    // before any other method is accepted (`protocol.md` §2).
    this.sendRaw({
      v: 1,
      type: 'hello',
      connectionId: this.connectionId,
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Sends one JSON frame to the peer. */
  sendRaw(value: JsonObject): void {
    if (this.closed) return;
    this.writeFrame(0x1, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  /** Sends one event frame (`protocol.md` §7 `Event`). */
  sendEvent(event: Event): void {
    this.sendRaw(
      jsonSafe({
        v: 1,
        type: 'event',
        eventId: event.eventId,
        projectId: this.protocol.projectId,
        cursor: event.cursor,
        name: event.name,
        entityId: event.entityId,
        entityVersion: event.entityVersion,
        data: event.data,
      }),
    );
  }

  sendResult(id: string, result: unknown): void {
    this.sendRaw(jsonSafe({ v: 1, type: 'response', id, ok: true, result }));
  }

  sendError(id: string | null, error: ProtocolError): void {
    this.frameSequence += 1;
    this.sendRaw(
      jsonSafe({
        v: 1,
        type: 'response',
        id: id ?? `server-${String(this.frameSequence)}`,
        ok: false,
        error: error.toBody(),
      }),
    );
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      let decoded: DecodedFrame | undefined;
      try {
        decoded = decodeFrame(this.buffer);
      } catch (error) {
        this.sendError(
          null,
          error instanceof ProtocolError
            ? error
            : new ProtocolError('VALIDATION_ERROR', 'the frame could not be decoded'),
        );
        this.close(1002, 'protocol error');
        return;
      }
      if (decoded === undefined) break;
      this.buffer = this.buffer.subarray(decoded.consumed);
      if (decoded.opcode === 0x8) {
        this.close(1000, 'peer closed');
        return;
      }
      if (decoded.opcode === 0x9) {
        this.writeFrame(0xa, decoded.payload);
        continue;
      }
      if (decoded.opcode !== 0x1) {
        this.sendError(
          null,
          new ProtocolError('VALIDATION_ERROR', 'only text frames are accepted'),
        );
        continue;
      }
      this.handleText(decoded.payload.toString('utf8'));
    }
  }

  private handleText(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.sendError(null, new ProtocolError('VALIDATION_ERROR', 'the frame is not JSON'));
      return;
    }
    this.handleEnvelope(parsed);
  }

  private handleEnvelope(parsed: unknown): void {
    let envelope: ParsedEnvelope;
    try {
      envelope = parseEnvelope(parsed);
    } catch (error) {
      this.fail(null, error);
      return;
    }
    if (!this.helloDone) {
      if (envelope.method !== 'connection.hello') {
        this.sendError(
          envelope.id,
          new ProtocolError('UNAUTHENTICATED', 'connection.hello must be the first request'),
        );
        this.close(1008, 'connection.hello required');
        return;
      }
      const negotiated = envelope.params['protocolVersion'];
      if (negotiated !== 1) {
        this.sendError(
          envelope.id,
          new ProtocolError(
            'PROTOCOL_MISMATCH',
            `unsupported protocol version ${describeValue(negotiated)}`,
          ),
        );
        this.close(1002, 'protocol mismatch');
        return;
      }
      this.helloDone = true;
      this.sendResult(envelope.id, this.helloResult());
      return;
    }
    try {
      switch (envelope.method) {
        case 'connection.hello':
          this.sendResult(envelope.id, this.helloResult());
          return;
        case 'project.subscribe':
          this.sendResult(
            envelope.id,
            this.protocol.subscribe(this, envelope.params, envelope.projectId, this.subscriptions),
          );
          this.ensurePolling();
          return;
        case 'subscription.set':
          this.sendResult(
            envelope.id,
            this.protocol.setScope(this, envelope.params, this.subscriptions),
          );
          return;
        case 'subscription.remove':
          this.sendResult(
            envelope.id,
            this.protocol.removeSubscription(envelope.params, this.subscriptions),
          );
          return;
        case 'project.events.ack':
          this.sendResult(
            envelope.id,
            this.protocol.ackCursor(envelope.params, this.subscriptions),
          );
          return;
        default: {
          const result = this.protocol.dispatch(envelope.method, envelope.params, {
            caller: this.caller,
            ...(envelope.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: envelope.idempotencyKey }),
            ...(envelope.expectedVersion === undefined
              ? {}
              : { expectedVersion: envelope.expectedVersion }),
            ...(envelope.projectId === undefined ? {} : { projectId: envelope.projectId }),
          });
          this.sendResult(envelope.id, result);
        }
      }
    } catch (error) {
      this.fail(envelope.id, error);
    }
  }

  private helloResult(): JsonObject {
    return {
      connectionId: this.connectionId,
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
    };
  }

  /** Polls the persisted log for this connection's subscriptions and streams it. */
  private ensurePolling(): void {
    if (this.pendingPoll !== undefined || this.closed) return;
    this.pendingPoll = setImmediate(() => {
      this.pendingPoll = undefined;
      this.protocol.pollConnection(this, this.subscriptions);
      if (this.subscriptions.size > 0 && this.timer === undefined && !this.closed) {
        this.timer = setInterval(() => this.protocol.pollConnection(this, this.subscriptions), 50);
      }
    });
  }

  private fail(id: string | null, error: unknown): void {
    const failure =
      error instanceof ProtocolError
        ? error
        : new ProtocolError('INTERNAL_ERROR', 'the request could not be completed');
    if (failure.code === 'AUTH_EXPIRED') {
      // `protocol.md` §2: an expired session closes the socket with AUTH_EXPIRED.
      this.sendRaw({ type: 'close', reason: failure.message, code: 'AUTH_EXPIRED' });
      this.close(1008, failure.message);
      return;
    }
    this.sendError(id, failure);
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (this.closed || !this.socket.writable) return;
    const header: number[] = [0x80 | opcode];
    if (payload.byteLength < 126) {
      header.push(payload.byteLength);
    } else if (payload.byteLength < 65_536) {
      header.push(126, (payload.byteLength >> 8) & 0xff, payload.byteLength & 0xff);
    } else {
      header.push(127, 0, 0, 0, 0, 0, 0, 0, 0);
      header[header.length - 4] = (payload.byteLength >>> 24) & 0xff;
      header[header.length - 3] = (payload.byteLength >>> 16) & 0xff;
      header[header.length - 2] = (payload.byteLength >>> 8) & 0xff;
      header[header.length - 1] = payload.byteLength & 0xff;
    }
    this.socket.write(Buffer.concat([Buffer.from(header), payload]));
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.pendingPoll !== undefined) clearImmediate(this.pendingPoll);
    const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBytes.byteLength);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.writeFrame(0x8, payload);
    this.socket.end();
    // Persistent events stay in the log; a disconnect never changes Work state
    // (`AC-054`). Only the in-memory subscription bookkeeping is dropped.
    this.protocol.unregister(this);
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.pendingPoll !== undefined) clearImmediate(this.pendingPoll);
    this.protocol.unregister(this);
  }
}

// ---------------------------------------------------------------------------
// Envelope, field and frame helpers
// ---------------------------------------------------------------------------

/** Parses one request envelope and refuses a malformed one with `VALIDATION_ERROR`. */
export function parseEnvelope(parsed: unknown): ParsedEnvelope {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError('VALIDATION_ERROR', 'the request envelope must be a JSON object');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope['v'] !== 1) {
    throw new ProtocolError(
      'PROTOCOL_MISMATCH',
      `unsupported protocol version ${String(envelope['v'])}`,
    );
  }
  if (envelope['type'] !== 'request') {
    throw new ProtocolError('VALIDATION_ERROR', 'the envelope type must be "request"');
  }
  const id = envelope['id'];
  const method = envelope['method'];
  if (typeof id !== 'string' || id === '') {
    throw new ProtocolError('VALIDATION_ERROR', 'the envelope id must be a non-empty string');
  }
  if (typeof method !== 'string' || method === '') {
    throw new ProtocolError('VALIDATION_ERROR', 'the envelope method must be a non-empty string');
  }
  const paramsValue = envelope['params'];
  if (
    paramsValue !== undefined &&
    (typeof paramsValue !== 'object' || paramsValue === null || Array.isArray(paramsValue))
  ) {
    throw new ProtocolError('VALIDATION_ERROR', 'params must be a JSON object');
  }
  const projectId = envelope['projectId'];
  if (projectId !== undefined && typeof projectId !== 'string') {
    throw new ProtocolError('VALIDATION_ERROR', 'projectId must be a string');
  }
  const idempotencyKey = envelope['idempotencyKey'];
  if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
    throw new ProtocolError('VALIDATION_ERROR', 'idempotencyKey must be a string');
  }
  const expectedVersion = envelope['expectedVersion'];
  if (expectedVersion !== undefined && typeof expectedVersion !== 'number') {
    throw new ProtocolError('VALIDATION_ERROR', 'expectedVersion must be a number');
  }
  return {
    id,
    method,
    params: (paramsValue ?? {}) as JsonObject,
    ...(projectId === undefined ? {} : { projectId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

interface DecodedFrame {
  readonly opcode: number;
  readonly payload: Buffer;
  readonly consumed: number;
}

/** Decodes one client frame; returns `undefined` when more bytes are needed. */
export function decodeFrame(buffer: Buffer): DecodedFrame | undefined {
  if (buffer.byteLength < 2) return undefined;
  const first = buffer[0] as number;
  const second = buffer[1] as number;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.byteLength < offset + 2) return undefined;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.byteLength < offset + 8) return undefined;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) throw new ProtocolError('VALIDATION_ERROR', 'frame is too large');
    length = low;
    offset += 8;
  }
  if (length > MAX_FRAME_BYTES) {
    throw new ProtocolError('VALIDATION_ERROR', 'frame is too large');
  }
  // RFC6455 §5.1: a client frame must be masked; an unmasked one is a protocol
  // error, which keeps a proxy from injecting unmasked frames.
  if (!masked) {
    throw new ProtocolError('VALIDATION_ERROR', 'client frames must be masked');
  }
  if (buffer.byteLength < offset + 4 + length) return undefined;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = (buffer[offset + index] as number) ^ (mask[index % 4] as number);
  }
  return { opcode, payload, consumed: offset + length };
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function requiredString(params: JsonObject, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value === '') {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be a non-empty string`, {
      details: { field: key },
    });
  }
  return value;
}

/**
 * The `secret.*` audience, defaulting to `gateway` (`execution.md` §4).
 *
 * A Provider credential is `gateway`-audience; a project-command credential is `tool`
 * and still needs an explicit Grant at use time. An unknown value is refused instead of
 * being coerced, so a typo cannot silently widen a credential's channel.
 */
/**
 * The server-created `secretRef` of one Provider (`protocol.md` §5).
 *
 * Provider credentials live under the `gateway` audience and the ref is derived from the
 * provider id, so re-saving a provider replaces its own credential instead of leaking a new
 * registration per editor submit.
 */
function providerSecretRef(providerId: string): string {
  return `provider:${providerId}`;
}

/** The caller's input with the credential removed, for error details. */
function withoutSecret(params: JsonObject): JsonObject {
  const rest: JsonObject = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'secret') continue;
    rest[key] = value;
  }
  return rest;
}

function secretAudience(value: unknown): SecretAudience {
  if (value === undefined || value === null || value === '') return 'gateway';
  if (value === 'gateway' || value === 'tool') return value;
  throw new ProtocolError('VALIDATION_ERROR', 'audience must be "gateway" or "tool"', {
    details: { field: 'audience' },
  });
}

/**
 * `secret.*` is an installation operation (WP-12 T1.1).
 *
 * `protocol.md` §2 authenticates the CLI/BFF with the 0600 installation credential, and
 * that is the only subject allowed to write a durable credential; a browser session —
 * even the single installation user's — must go through the admin surface or the CLI.
 */
function requireInstallationCaller(caller: WorkbenchCaller, method: string): void {
  if (caller.subject !== INSTALLATION_SUBJECT) {
    throw new ProtocolError('NOT_AUTHORIZED', `${method} is an installation operation`, {
      details: { subject: caller.subject },
    });
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Error text for a refusal; never a value, and never an empty string. */
function errorText(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'the command failed';
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** One required integer parameter (`protocol.md` §1: a missing field is VALIDATION_ERROR). */
function requiredInteger(params: JsonObject, key: string): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be an integer`, { details: { key } });
  }
  return value;
}

function stringOr(source: JsonObject, key: string, fallback: string): string {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value === '') {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be a non-empty string`);
  }
  return value;
}

/** A JSON object member, or `undefined` when the caller sent something else. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', 'expected an array of strings');
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new ProtocolError('VALIDATION_ERROR', 'expected an array of strings');
    }
    return entry;
  });
}

/**
 * An array field that keeps its recorded value when the request omits it
 * (`protocol.md` §8 "未提供字段保持原值", W9R2-02).
 */
function stringArrayOr(value: unknown, fallback: readonly string[]): string[] {
  return value === undefined ? [...fallback] : stringArray(value);
}

/** As `stringArrayOr`, for the arrays whose entries are objects. */
function arrayOr(source: JsonObject, key: string, fallback: readonly unknown[]): unknown[] {
  return source[key] === undefined ? [...fallback] : arrayField(source, key);
}

function arrayField(source: JsonObject, key: string): unknown[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be an array`);
  }
  return value;
}

function objectField(source: JsonObject, key: string): JsonObject {
  const value = source[key];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', `${key} must be an object`);
  }
  return value;
}

function refField(source: JsonObject, key: string): Ref {
  const value = objectField(source, key);
  const version = value['version'];
  const hash = value['hash'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throw new ProtocolError('VALIDATION_ERROR', `${key}.version must be a positive integer`);
  }
  if (typeof hash !== 'string' || hash === '') {
    throw new ProtocolError('VALIDATION_ERROR', `${key}.hash must be a non-empty string`);
  }
  return { id: requiredString(value, 'id'), version, hash };
}

function parsePlanDraft(value: unknown): PlanDraft {
  if (value === undefined) {
    throw new ProtocolError('VALIDATION_ERROR', 'plan is required', { details: { field: 'plan' } });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('VALIDATION_ERROR', 'plan must be an object');
  }
  const draft = value as JsonObject;
  const tasks = draft['tasks'];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new ProtocolError('VALIDATION_ERROR', 'plan.tasks must be a non-empty array');
  }
  return {
    goal: requiredString(draft, 'goal'),
    scope: draft['scope'] as Plan['scope'],
    tasks: JSON.parse(JSON.stringify(tasks)) as PlanDraft['tasks'],
    ...(Array.isArray(draft['interfaceChanges'])
      ? { interfaceChanges: draft['interfaceChanges'] as string[] }
      : {}),
    ...(Array.isArray(draft['dataChanges'])
      ? { dataChanges: draft['dataChanges'] as string[] }
      : {}),
    ...(Array.isArray(draft['risks']) ? { risks: draft['risks'] as string[] } : {}),
    ...(Array.isArray(draft['rollback']) ? { rollback: draft['rollback'] as string[] } : {}),
  };
}

function knowledgeView(value: unknown): 'design' | 'delivered' | 'work' {
  const view = optionalString(value);
  if (view !== 'design' && view !== 'delivered' && view !== 'work') {
    throw new ProtocolError('VALIDATION_ERROR', `unknown knowledge view ${String(value)}`, {
      details: { accepted: ['design', 'delivered', 'work'] },
    });
  }
  return view;
}

function configScope(value: unknown): 'global' | 'project' {
  const scope = optionalString(value) ?? 'global';
  if (scope !== 'global' && scope !== 'project') {
    throw new ProtocolError('VALIDATION_ERROR', `unknown config scope ${scope}`);
  }
  return scope;
}

/** `BehaviourChoice` guard: a product decision only accepts the three branches. */
function isBehaviourChoice(value: string): value is 'now' | 'later' | 'decline' {
  return value === 'now' || value === 'later' || value === 'decline';
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function boundedLimit(value: unknown): number {
  const limit = optionalInteger(value);
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  if (limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ProtocolError('VALIDATION_ERROR', `limit must be 1–${MAX_PAGE_LIMIT}`);
  }
  return limit;
}

/** A readable form of an arbitrary JSON value for an error message. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/** Re-serialises a value into the contract's JSON shape (drops `undefined`). */
/** Any serialisable value as the contract's `JsonValue`, for an opaque pass-through. */
function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function jsonSafe(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonObject;
}

/**
 * Whether one event belongs to a subscription scope.
 *
 * The routing input is the change summary in `event.data` plus the entity id, so
 * an event about a Task still reaches its Work's subscribers — the same rule the
 * EventHub applies server-side, kept here because the watermark read is per
 * connection.
 */
/** Whether two subscription scopes observe the same stream. */
function sameScopeRecord(
  left: { readonly kind: string; readonly id?: string },
  right: { readonly kind: string; readonly id?: string },
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function matchesSubscription(
  event: Event,
  scope: { readonly kind: string; readonly id?: string },
): boolean {
  if (scope.kind === 'summary') return true;
  if (scope.id === undefined) return false;
  if (event.entityId === scope.id) return true;
  const data = event.data as Record<string, unknown>;
  const field =
    scope.kind === 'conversation' ? 'conversationId' : scope.kind === 'work' ? 'workId' : 'runId';
  return data[field] === scope.id;
}

function emptyScope(): Scope {
  return { readPaths: [], writePaths: [], operations: [], networkTargets: [] };
}

/**
 * A committed record's metadata without the body and the derived content hash.
 *
 * A cancellation rewrites only lifecycle facts, so it starts from the read-back
 * record and drops the two members the save service owns: `contentMarkdown` is not
 * metadata at all, and `contentHash` is recomputed from the new body bytes
 * (`protocol.md` §8 "Hash由Core维护").
 */
function stripRecordBody(record: PortableRequirement): Record<string, unknown> {
  const { contentMarkdown: _body, contentHash: _hash, ...metadata } = record;
  return metadata;
}

/** The `## 完成摘要` heading every portable body carries (`requirements.md` §6). */
const REQUIREMENT_COMPLETION_HEADING = '完成摘要';

/**
 * Replaces only the completion summary of a recorded body (W9R2-03).
 *
 * A cancellation keeps every recorded content section; it appends the lifecycle
 * fact by rewriting the one section that reports the outcome. The rest of the body
 * — including the version marker Core prepends and every other level-2 section — is
 * handed back untouched, so the cancel cannot silently blank a delivered
 * requirement's record.
 */
function withCompletionSummary(content: string, summary: string): string {
  const lines = content.split('\n');
  const headingIndex = lines.findIndex((line) =>
    new RegExp(`^##\\s+${REQUIREMENT_COMPLETION_HEADING}\\s*$`, 'u').test(line.trim()),
  );
  if (headingIndex === -1) {
    // A legacy body without the section still gets a structurally valid record.
    return `${content.replace(/\s+$/u, '')}\n\n## ${REQUIREMENT_COMPLETION_HEADING}\n\n${summary}\n`;
  }
  let nextHeading = lines.length;
  for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
    if (/^##\s+/u.test((lines[cursor] ?? '').trim())) {
      nextHeading = cursor;
      break;
    }
  }
  const head = lines
    .slice(0, headingIndex + 1)
    .join('\n')
    .replace(/\s+$/u, '');
  const tail = lines.slice(nextHeading).join('\n').replace(/^\s+/u, '');
  return tail === '' ? `${head}\n\n${summary}\n` : `${head}\n\n${summary}\n\n${tail}\n`;
}

/**
 * The daemon's own record reader: real `git show <revision>:<path>`.
 *
 * `requirement.json` is the only place the portable metadata lives, so the daemon
 * reads the blob through the same `git` binary the rest of the deployment uses. A
 * missing revision or path is `null`; the caller then falls back rather than
 * fabricating a record.
 */
function createNodeRequirementRecordPort(): RequirementRecordPort {
  return {
    read: (repoRoot, revision, path) => {
      try {
        return execFileSync('git', ['-C', repoRoot, 'show', `${revision}:${path}`], {
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        return null;
      }
    },
  };
}

/**
 * The daemon's own Git fact reader (AC-090): real `git rev-parse` and
 * `git merge-base --is-ancestor` through the deployment's `git` binary.
 *
 * A revision Git cannot resolve answers `ok:false`, which the caller reports as
 * "not pushed" instead of pretending the commit is in sync.
 */
function createNodeRequirementGitFactsPort(): RequirementGitFactsPort {
  const execute = (
    args: readonly string[],
  ): { readonly status: number; readonly stdout: string } => {
    try {
      const stdout = execFileSync('git', [...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { status: 0, stdout };
    } catch (error) {
      const status =
        typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : 1;
      return { status, stdout: '' };
    }
  };
  return {
    resolveRevision: (repoRoot, revision) => {
      const result = execute([
        '-C',
        repoRoot,
        'rev-parse',
        '--verify',
        '--quiet',
        `${revision}^{commit}`,
      ]);
      const value = result.stdout.trim();
      if (result.status !== 0 || value === '') return { ok: true, value: null };
      return { ok: true, value };
    },
    isAncestor: (repoRoot, ancestor, descendant) => {
      const result = execute(['-C', repoRoot, 'merge-base', '--is-ancestor', ancestor, descendant]);
      // `git merge-base --is-ancestor` exits 1 for "not an ancestor" and 128 for an
      // unresolvable revision; only 0 is a positive proof.
      if (result.status === 0) return { ok: true, value: true };
      if (result.status === 1) return { ok: true, value: false };
      return { ok: false };
    },
  };
}

/**
 * The daemon's real committed-pool reader (`requirement.import`, `protocol.md` §4).
 *
 * Core owns the pool semantics (`readRequirementPoolAtRevision`); this only supplies
 * the real `git` port, so a `requirement.import` and a clone both apply the same
 * conflict rules.
 */
function createNodeRequirementPoolPort(): RequirementPoolReadPort {
  const git = createNodeWorktreeGitPort();
  return {
    read: (repoRoot, revision) => {
      const pool = readRequirementPoolAtRevision({ git, repoRoot, revision });
      return {
        records: pool.records.map((record) => ({
          id: record.id,
          recordPath: record.recordPath,
          metadataJson: record.metadataJson,
          contentMarkdown: record.contentMarkdown,
          recordHash: record.recordHash,
        })),
        conflicts: pool.conflicts.map((conflict) => ({
          recordPath: conflict.recordPath,
          reason: conflict.reason,
          message: conflict.message,
        })),
      };
    },
  };
}

/**
 * The daemon's real revision-addressed file reader (`protocol.md` §5
 * `file.list`/`file.read`).
 *
 * `git ls-tree` and `git show` are the only sanctioned readers: a working tree can be
 * stale, so a read that must answer for a named revision resolves the blob in Git. A
 * missing revision or path answers `null` rather than an empty directory.
 */
function createNodeWorkspaceFilePort(): WorkspaceFilePort {
  const run = (args: readonly string[]): { readonly status: number; readonly stdout: Buffer } => {
    try {
      const stdout = execFileSync('git', [...args], {
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
      return { status: 0, stdout };
    } catch (error) {
      const status =
        typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : 1;
      return { status, stdout: Buffer.alloc(0) };
    }
  };
  return {
    list: (repoRoot, revision, path) => {
      // A non-empty path names a directory whose *children* are the listing; Git's
      // pathspec would otherwise match the tree entry itself, so the child pathspec
      // (`<path>/`) is tried first and the exact path is the fallback for a blob.
      const attempts =
        path === ''
          ? [[]]
          : [
              ['--', `${path.replace(/\/+$/u, '')}/`],
              ['--', path],
            ];
      const parse = (
        stdout: Buffer,
      ): { name: string; path: string; type: 'blob' | 'tree'; bytes: number | null }[] => {
        const entries: {
          name: string;
          path: string;
          type: 'blob' | 'tree';
          bytes: number | null;
        }[] = [];
        for (const record of stdout.toString('utf8').split('\0')) {
          if (record === '') continue;
          // `<mode> <type> <object>\t<path>`; `-l` adds the blob size column.
          const match = /^(\d+)\s+(blob|tree)\s+([0-9a-f]+)\s+(-|\d+)\t(.+)$/u.exec(record);
          if (match === null) continue;
          entries.push({
            name: basename(match[5] ?? ''),
            path: match[5] ?? '',
            type: match[2] === 'tree' ? 'tree' : 'blob',
            bytes: match[4] === '-' ? null : Number(match[4]),
          });
        }
        return entries;
      };
      for (const pathspec of attempts) {
        const result = run(['-C', repoRoot, 'ls-tree', '-z', '-l', revision, ...pathspec]);
        if (result.status !== 0) return null;
        const entries = parse(result.stdout);
        if (entries.length > 0) return entries;
      }
      return [];
    },
    read: (repoRoot, revision, path) => {
      const result = run(['-C', repoRoot, 'show', `${revision}:${path}`]);
      if (result.status !== 0) return null;
      return { content: result.stdout };
    },
  };
}

/** The interface media types `file.read` reports (`protocol.md` §5). */
const FILE_MIME_TYPES: Readonly<Record<string, string>> = {
  md: 'text/markdown',
  json: 'application/json',
  ts: 'text/plain',
  tsx: 'text/plain',
  js: 'text/plain',
  mjs: 'text/plain',
  css: 'text/css',
  html: 'text/html',
  txt: 'text/plain',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  toml: 'text/plain',
};

/** Whether a JSON value is a `Scope` envelope rather than some other object. */
function isScope(value: unknown): value is Scope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['readPaths']) &&
    Array.isArray(candidate['writePaths']) &&
    Array.isArray(candidate['operations']) &&
    Array.isArray(candidate['networkTargets'])
  );
}

/**
 * The canonical `content.md` body of a generated requirement record.
 *
 * `requirements.md` §6 requires the six level-2 headings, each exactly once and in
 * order, with real content under them; the daemon generates this body when it
 * cancels a Queued requirement, so the save is a real Git record instead of the
 * structurally invalid body that made every cancellation fail (W9R1-05).
 */
function canonicalRequirementContent(input: {
  readonly title: string;
  readonly goal: string;
  readonly completion: string;
}): string {
  const sections: Record<(typeof REQUIREMENT_CONTENT_HEADINGS)[number], string> = {
    目标与背景: input.goal === '' ? REQUIREMENT_EMPTY_SECTION : input.goal,
    范围与行为: REQUIREMENT_EMPTY_SECTION,
    验收说明: REQUIREMENT_EMPTY_SECTION,
    已确认决定: REQUIREMENT_EMPTY_SECTION,
    未决问题: REQUIREMENT_EMPTY_SECTION,
    完成摘要: input.completion === '' ? REQUIREMENT_EMPTY_SECTION : input.completion,
  };
  const body = REQUIREMENT_CONTENT_HEADINGS.flatMap((heading) => [
    `## ${heading}`,
    '',
    sections[heading],
    '',
  ]);
  return [`# ${input.title}`, '', ...body].join('\n');
}

function emptyTaskCounts(): JsonObject {
  return { total: 0, done: 0, develop: 0, review: 0, test: 0, ready: 0 };
}

/** Maps a service refusal code onto the protocol error table. */
function protocolCode(code: string): ErrorCode {
  const parsed = errorCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : 'VALIDATION_ERROR';
}

/** SHA256 over the canonical JSON of a payload, for command idempotency. */
function sha256Of(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function basename(path: string): string {
  const parts = path.split('/').filter((part) => part !== '');
  return parts.at(-1) ?? path;
}

/** SHA256 hex of raw bytes (`data.md` §4 content identity). */
function sha256Hex(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The stage a role's preview is evaluated at (`rules/workflow.md` §2).
 *
 * A modifying role's stage is level-derived (`develop-L1/L2/L3`); every other role
 * uses its own first registered stage. The ACL then decides what that stage may read,
 * so a preview of a wider selection is refused exactly like a real Run's.
 */
function contextPreviewStage(role: Role, level: string | undefined): ContextStage {
  const stages = (ROLE_STAGES as Record<string, readonly ContextStage[]>)[role] ?? [];
  if (role === 'backend' || role === 'frontend') {
    const candidate: ContextStage =
      level === 'L1' ? 'develop-L1' : level === 'L3' ? 'develop-L3' : 'develop-L2';
    if (stages.includes(candidate)) return candidate;
  }
  return stages[0] ?? 'assist';
}

/** The fixed rules a preview falls back to when `docs/rules/agents.md` is absent. */
const CHIEF_RULES_FALLBACK =
  '# Agent 固定规则\n\nChief 决定上下文；Builder 只校验并冻结；开发聊天不可输入。\n';

/** Normalizes a root for identity comparison without inventing a second id. */
function normalizeRoot(root: string): string {
  const withoutTrailing = root.replace(/\/+$/u, '');
  return withoutTrailing === '' ? '/' : withoutTrailing;
}
