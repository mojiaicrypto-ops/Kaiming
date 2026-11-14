/**
 * Input runner (P2): claim one accepted input, deliver it to its own Pi session, observe what really
 * happened, and record the terminal state from message-level facts plus the persisted boundary.
 *
 * Rules it must not break (from the P0 findings and the storage contract):
 *  - `prompt()` resolving is not success: the assistant stop reason decides error/aborted.
 *  - A run whose boundary cannot be confirmed on disk is `interrupted`, never `completed`.
 *  - An unavailable model or directory leaves the input queued (blocked) instead of falling back.
 *  - Nothing is retried or replayed by this layer.
 *  - A stop requested during a run must end as `stopped` against the current revision, not as a
 *    model failure on a stale revision.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type SessionEntry } from '@earendil-works/pi-coding-agent';
import { OPEN_TASK_STATUSES, Store, StoreError, type InputRow, type TaskRow, type TaskStatus } from '../store/store.ts';
import { redactEffectiveConfig, type EffectiveConfig } from './config.ts';
import { digestJson } from './hash.ts';
import {
  assembleSystemPrompt,
  isPromptRoleId,
  loadPromptBodies,
  type PromptBodies,
} from './prompt-assembly.ts';
import { INPUT_MARKER_CUSTOM_TYPE, HistoryUnavailableError, type PiRuntimeFactory, type PiSessionHandle } from './pi-runtime.ts';
import { RunWatchdogError, runWithWatchdog } from './run-watchdog.ts';
import { SessionRegistry, type LogicalSessionSpec } from './registry.ts';
import { epochOf } from './epoch.ts';
import { rollupUsage } from './usage-rollup.ts';
import { partsOfPayload } from './input-text.ts';
import { formatDocumentText } from './document-text.ts';
import { compactionDue } from './compaction-policy.ts';
import { readDocument, readImage } from '../server/attachments.ts';
import { createRawQuestionRecovery } from './raw-question.ts';
import {
  ModelOutputGuard,
  REPORT_RETRY_EXHAUSTED,
  MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE,
  createModelOutputGuardExtension,
} from './model-output-guard.ts';
import { InteractionBridge, createUiAdapter } from './interactions.ts';
import { createQuestionTool } from '../tools/question-tool.ts';
import { createDeletionGate } from './deletion-gate.ts';
import { createBashTimeoutGuard, createFileBoundaryGuard, DEFAULT_BASH_TIMEOUT_SECONDS } from './tool-guard.ts';
import { toolSetFor, type WriteHold } from './tool-sets.ts';
import { asToolDefinitions, createTaskGetTool, createTaskTool, type DomainTool, type TaskToolContext } from '../tools/task-tools.ts';
import { createBrowserTool } from '../tools/browser-tool.ts';
import { createWebFetchTool } from '../tools/web-fetch.ts';
import { createWebSearchTool } from '../tools/web-search.ts';
import { createReportTool, type ReportToolContext } from '../tools/report-tools.ts';
import { createBacklogTool, type BacklogToolContext } from '../tools/backlog-tools.ts';
import { createProjectTool, type ProjectToolContext } from '../tools/project-tools.ts';
import type { DelegationReturn, MemberState } from '../tools/delegation-tools.ts';

export interface InputCheckpoint {
  readonly piFile: string;
  readonly leafEntryId: string;
  readonly inputMarkerId: string;
  readonly inputEntryId: string;
  readonly configHash: string;
}

/** The image attachment shape Pi's `prompt()` accepts: base64 plus mime, never a URL. */
interface PiImage {
  readonly type: 'image';
  readonly data: string;
  readonly mimeType: string;
}

export type TerminalStatus = 'completed' | 'failed' | 'stopped' | 'interrupted';

/** What one compaction attempt did, as the host can honestly report it. */
export type CompactionOutcome =
  | {
      readonly status: 'compacted';
      readonly tokensBefore: number;
      readonly estimatedTokensAfter: number | null;
    }
  | { readonly status: 'nothing' }
  | { readonly status: 'busy' }
  | { readonly status: 'recovery' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed'; readonly detail: string };

export type RunOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly inputId: string }
  | { readonly kind: 'blocked'; readonly inputId: string; readonly code: 'RECOVERY_REQUIRED' }
  | { readonly kind: 'controlled'; readonly inputId: string; readonly code: 'TASK_CONTROLLED' }
  | {
      readonly kind: 'blocked_config';
      readonly code: 'MODEL_UNAVAILABLE';
      readonly detail: string;
    }
  | {
      readonly kind: 'blocked_role';
      readonly code: 'INVALID_ARGUMENT';
      readonly detail: string;
    }
  | {
      readonly kind: 'blocked_project';
      readonly code: 'PROJECT_UNAVAILABLE';
      readonly detail: string;
    }
  | {
      readonly kind: TerminalStatus;
      readonly inputId: string;
      readonly detail: string;
      readonly checkpoint?: InputCheckpoint;
    };

/** Defaults for the run watchdog: a workstation run may legitimately be silent for a while
 *  (a long shell command emits no Pi events), so the stall window is generous. It exists to
 *  turn a dead provider/stream into a terminal state instead of an infinite wait. */
const DEFAULT_RUN_STALL_MS = 15 * 60 * 1000;
const DEFAULT_RUN_TOTAL_MS = 90 * 60 * 1000;

export interface RunnerOptions {
  readonly store: Store;
  readonly registry: SessionRegistry;
  readonly factory: PiRuntimeFactory;
  /** Resolve the effective configuration at claim time: role override → project override → server. */
  readonly resolveConfig: (roleId: string, projectId?: string) => EffectiveConfig;
  /** The server's own storage (data dir, credential dir): paths the model's tools must not reach. */
  readonly privateDirs?: readonly string[];
  /** Task type the session currently runs under; `undefined` while it has no Task yet. */
  readonly taskTypeOf?: (sessionId: string) => 'read' | 'write' | undefined;
  /** Extra session wiring (probe tools/extensions) used by tests and later work packages. */
  readonly sessionExtras?: (sessionId: string) => {
    readonly customTools?: LogicalSessionSpec['customTools'];
    readonly extensionFactories?: LogicalSessionSpec['extensionFactories'];
  };
  /**
   * Live observation (M4): every Pi session event is handed to the host synchronously. A listener
   * only broadcasts or records in memory - it must never await a durable transaction (R4).
   */
  readonly onEvent?: (sessionId: string, event: unknown, meta: { inputId: string; epoch: string }) => void;
  /**
   * A Task the chief just changed (or a member it just dispatched): the host publishes it, so the
   * browser does not have to poll for something it can be told.
   */
  readonly onTaskChange?: (sessionId: string, taskId: string) => void;
  /**
   * A run this runner started outside the worker (the chief's dispatch tool) has settled. The worker
   * reports its own runs; without this hook a member dispatched inside the chief's turn would finish
   * silently when that turn had already ended (no invalidate, no settled-step wake).
   */
  readonly onRunSettled?: (sessionId: string, outcome: RunOutcome) => void;
  /** A run with no Pi activity for this long is aborted (RUN_STALLED) instead of waiting forever. */
  readonly runStallMs?: number;
  /**
   * A run exceeding this total *charged* duration is aborted (RUN_TIMEOUT). Time spent waiting on
   * the user or on a dispatched step is not charged: that is not the run's own work.
   */
  readonly runTotalMs?: number;
  /**
   * Default timeout for a bash call that omits one (Pi's tool has no default). 0 disables the
   * guard. A timeout is a tool result the model can act on, not a run abort.
   */
  readonly bashTimeoutSeconds?: number;
}

export class InputRunner {
  private readonly options: RunnerOptions;
  /** Sessions where the user chose "trust all" at the deletion gate; survives Pi instance rebuilds. */
  private readonly trustedSessions = new Set<string>();
  /** The interaction bridge (M5); the runner binds its adapter to every session it prepares. */
  readonly interactions: InteractionBridge;
  /** `${sessionId}:${inputId}` of runs a host-owned tool asked to abort (S5 tool-initiated stop). */
  private readonly hostAborts = new Set<string>();
  /** Last Pi activity per session: a stalled provider/stream must not mean an infinite wait. */
  private readonly lastEventAt = new Map<string, number>();
  /**
   * Host-owned waits per `${sessionId}\0${inputId}`: the watchdog must not charge a dispatch wait to
   * the run that owns it. The input id is part of the key so a poll left behind by a stopped run
   * cannot freeze the next run's windows.
   */
  private readonly hostWaits = new Map<string, number>();
  /**
   * The active input's model-output guard per session. The registry reuses a Pi instance across
   * inputs without reinstalling extensions, so the guard bridge resolves the *current* input's
   * guard through this map; the state itself is per input and dies with the run.
   */
  private readonly activeOutputGuards = new Map<string, ModelOutputGuard>();
  private hostWaitKey(sessionId: string): string {
    return `${sessionId}\u0000${this.liveRuns.get(sessionId)?.inputId ?? ''}`;
  }
  /** Role prompt bodies, cached per prompt directory. */
  private readonly promptBodies = new Map<string, PromptBodies>();
  /** Identity of the run currently executing per session: a Pi instance is reused across inputs. */
  private readonly liveRuns = new Map<string, { readonly inputId: string; readonly serverWorkDir: string }>();
  /** Handles already wired to the observation hook (one subscription per Pi instance). */
  private readonly observed = new WeakSet<object>();
  /** Sessions whose Pi instance is compacting: claims wait, and a second compaction reports busy. */
  private readonly compacting = new Set<string>();
  private readonly compactionDone = new Map<string, Promise<void>>();

  constructor(options: RunnerOptions & { interactions?: InteractionBridge }) {
    this.options = options;
    this.interactions = options.interactions ?? new InteractionBridge({ store: options.store });
  }

  private bodiesFor(promptDir: string): PromptBodies {
    const cached = this.promptBodies.get(promptDir);
    if (cached !== undefined) {
      return cached;
    }
    const loaded = loadPromptBodies(promptDir);
    this.promptBodies.set(promptDir, loaded);
    return loaded;
  }

  /**
   * Called by host-owned tools right before they call `ctx.abort()`. Without this note an abort is
   * indistinguishable from a provider error, because Pi reports it as stopReason=error with the
   * message "This operation was aborted" — and classifying by message text is not allowed.
   */
  noteAbort(sessionId: string, inputId: string): void {
    this.hostAborts.add(abortKey(sessionId, inputId));
  }

  /** Claim and run the next input of a session; returns what was actually observed. */
  /**
   * `prompt()` under the run watchdog: a provider/stream that stops producing (or a run that
   * never ends) aborts and reports a watchdog failure, so the input reaches a terminal state
   * the chief can verify instead of staying `processing` forever.
   */
  private async promptWithWatchdog(
    handle: PiSessionHandle,
    sessionId: string,
    text: string,
    images: readonly PiImage[],
  ): Promise<void> {
    this.lastEventAt.set(sessionId, Date.now());
    await runWithWatchdog({
      // Base64 travels only here (U6): Pi's prompt takes image attachments, and its session file
      // keeps them as content blocks. Nothing about the bytes is cached in the host.
      prompt: () => handle.session.prompt(text, images.length > 0 ? { images: [...images] } : undefined),
      abort: () => handle.session.abort(),
      activityAt: () => this.lastEventAt.get(sessionId) ?? 0,
      // A question on screen means the run waits on the user: that wait is not a stalled provider.
      // The same holds while the chief waits on a dispatched step: the slow work belongs to member
      // runs with their own watchdogs, so charging it here would abort every Task longer than the
      // total window. The model's own generation still counts.
      waiting: () =>
        this.interactions.isWaiting(sessionId) ||
        (this.hostWaits.get(this.hostWaitKey(sessionId)) ?? 0) > 0,
      stallMs: this.options.runStallMs ?? DEFAULT_RUN_STALL_MS,
      totalMs: this.options.runTotalMs ?? DEFAULT_RUN_TOTAL_MS,
    });
  }

  /**
   * One corrective turn after a guard fault: a discarded degenerate response, or the report retry
   * budget tripping. The hidden custom message becomes user context for the model but never a
   * browser bubble; the report streak restarts with it, and a second fault is left for the
   * terminal classifier, so a broken provider cannot retry forever.
   */
  private async recoverModelOutput(
    handle: PiSessionHandle,
    sessionId: string,
    guard: ModelOutputGuard,
    inputId: string,
  ): Promise<void> {
    const fault = guard.fault;
    if (fault === undefined || guard.retryUsed) return;
    const live = this.options.store.getInput(inputId);
    if (live !== undefined && live.stopRequestKey !== null) return;
    guard.retryUsed = true;
    guard.fault = undefined;
    // The corrective turn starts a fresh report budget: N failures after it terminate the input.
    guard.resetReportStreak();
    await handle.session.waitForIdle();
    this.lastEventAt.set(sessionId, Date.now());
    await runWithWatchdog({
      prompt: () =>
        handle.session.sendCustomMessage(
          {
            customType: MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE,
            content: [
              {
                type: 'text',
                text:
                  fault.code === REPORT_RETRY_EXHAUSTED
                    ? `Your report attempts keep failing: ${fault.detail}. Reissue exactly one agent_report tool call with valid JSON arguments: both summary and body are required strings; keep the body under 8 KB and do not repeat the failed arguments.`
                    : `Your previous response was discarded as degenerate or malformed: ${fault.detail}. Do not repeat it. Reissue only a valid JSON tool call in the provider's declared format. For a report, keep the body under 8 KB: cite log paths and counts; do not paste full logs.`,
              },
            ],
            display: false,
          },
          { triggerTurn: true },
        ),
      abort: () => handle.session.abort(),
      activityAt: () => this.lastEventAt.get(sessionId) ?? 0,
      waiting: () =>
        this.interactions.isWaiting(sessionId) ||
        (this.hostWaits.get(this.hostWaitKey(sessionId)) ?? 0) > 0,
      stallMs: this.options.runStallMs ?? DEFAULT_RUN_STALL_MS,
      totalMs: this.options.runTotalMs ?? DEFAULT_RUN_TOTAL_MS,
    });
  }

  /**
   * Build only the external tools this role/task may call, so the allowlist and the registration
   * cannot disagree. The provider search key is resolved once per input: it is ambient configuration,
   * never something the model supplies.
   */
  private async externalTools(options: {
    readonly sessionId: string;
    readonly roleAllowed: (name: string) => boolean;
    readonly readOnly: boolean;
    readonly config: EffectiveConfig;
  }): Promise<DomainTool[]> {
    const tools: DomainTool[] = [];
    if (options.roleAllowed('web_search')) {
      // A credential file that cannot be read is not a reason to fail the run: the tool still has
      // its keyless path and reports the provider it really used.
      const key = await this.options.factory.searchKey(options.config.selection).catch(() => undefined);
      tools.push(createWebSearchTool(key === undefined ? {} : { modelKey: key }));
    }
    if (options.roleAllowed('web_fetch')) {
      tools.push(
        createWebFetchTool({ workDir: join(options.config.agentDir, 'work', options.sessionId, 'web') }),
      );
    }
    if (options.roleAllowed('browser')) {
      tools.push(
        createBrowserTool({
          sessionId: options.sessionId,
          agentDir: options.config.agentDir,
          readOnly: options.readOnly,
        }),
      );
    }
    return tools;
  }

  /**
   * Compact one session at the user's explicit request. The idle/interrupted checks run under the
   * same lock the worker uses, so a claim cannot slip between "idle" and the summary.
   */
  async compactManually(sessionId: string): Promise<CompactionOutcome> {
    if (this.compacting.has(sessionId)) return { status: 'busy' };
    return this.withCompaction(sessionId, async () => {
      const inputs = this.options.store.listInputs(sessionId);
      if (inputs.some((input) => input.status === 'processing')) {
        return { status: 'busy' } as const;
      }
      if (inputs.some((input) => input.status === 'interrupted')) {
        return { status: 'recovery' } as const;
      }
      const handle = this.options.registry.get(sessionId);
      if (handle === undefined) return { status: 'unavailable' } as const;
      return this.summarize(handle);
    });
  }

  /**
   * Proactive compaction before an input is delivered: only when the global policy is on and the
   * live estimate is at or above its percentage. Best-effort; the caller falls through on failure.
   */
  async compactIfDue(sessionId: string): Promise<CompactionOutcome | null> {
    const policy = this.options.store.getCompactionConfig();
    if (!policy.auto) return null;
    const handle = this.options.registry.get(sessionId);
    if (handle === undefined) return null;
    let percent: number | null | undefined;
    try {
      percent = handle.session.getContextUsage()?.percent;
    } catch {
      return null;
    }
    if (!compactionDue(percent, policy)) return null;
    if (this.compacting.has(sessionId)) return { status: 'busy' };
    return this.withCompaction(sessionId, () => this.summarize(handle));
  }

  /** Run Pi's own compaction (summary, keep-recent, usage, events) and classify its outcome. */
  private async summarize(handle: PiSessionHandle): Promise<CompactionOutcome> {
    try {
      const result = await handle.session.compact();
      return {
        status: 'compacted',
        tokensBefore: result.tokensBefore,
        estimatedTokensAfter: result.estimatedTokensAfter ?? null,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Pi's two ordinary "there is nothing to do" answers are not failures.
      if (detail.includes('Nothing to compact') || detail.includes('Already compacted')) {
        return { status: 'nothing' };
      }
      return { status: 'failed', detail };
    }
  }

  /** Serialize compaction with claims for one session; the flag and its promise are set together. */
  private async withCompaction<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const done = Promise.withResolvers<void>();
    this.compacting.add(sessionId);
    this.compactionDone.set(sessionId, done.promise);
    try {
      return await run();
    } finally {
      this.compacting.delete(sessionId);
      this.compactionDone.delete(sessionId);
      done.resolve();
    }
  }

  /** Wait until a manual compaction owns the session no more, so a claim cannot interleave. */
  private async waitForCompaction(sessionId: string): Promise<void> {
    while (this.compacting.has(sessionId)) {
      const done = this.compactionDone.get(sessionId);
      if (done === undefined) return;
      await done.catch(() => undefined);
    }
  }

  async runNext(sessionId: string): Promise<RunOutcome> {
    const session = this.options.store.getSession(sessionId);
    if (session === undefined) {
      throw new StoreError('NOT_FOUND', 'session does not exist', { sessionId });
    }
    const config = this.options.resolveConfig(session.roleId, session.projectId);
    if (!(await this.options.factory.isAvailable(config.selection))) {
      return {
        kind: 'blocked_config',
        code: 'MODEL_UNAVAILABLE',
        detail: `${config.selection.providerId}/${config.selection.modelId} has no usable credential`,
      };
    }
    const project = this.checkProject(session.cwd);
    if (!project.ok) {
      return { kind: 'blocked_project', code: 'PROJECT_UNAVAILABLE', detail: project.detail };
    }
    if (!isPromptRoleId(session.roleId)) {
      // Without a role body the model would run without its rules; refuse instead of guessing.
      return {
        kind: 'blocked_role',
        code: 'INVALID_ARGUMENT',
        detail: `unknown roleId ${JSON.stringify(session.roleId)}`,
      };
    }
    // Task-level control eligibility (pause/cancel of the owning Task) arrives with the task table
    // in P3; until then only the storage-level rules (busy / unresolved interrupted) are enforced.

    // A manual compaction owns the session until it finishes: claiming in the middle would make
    // the two writes (summary and input) race. The check and the claim below have no await between
    // them, so a compaction cannot start in the gap.
    await this.waitForCompaction(sessionId);
    const claim = this.options.store.claimNextInput(sessionId);
    if (claim.kind === 'none') {
      return { kind: 'idle' };
    }
    if (claim.kind === 'busy') {
      return { kind: 'busy', inputId: claim.inputId };
    }
    if (claim.kind === 'blocked') {
      return { kind: 'blocked', inputId: claim.inputId, code: claim.code };
    }
    if (claim.kind === 'controlled') {
      // The owning Task is paused or cancelled: its work waits for an explicit resume.
      return { kind: 'controlled', inputId: claim.inputId, code: claim.code };
    }
    const input = claim.input;

    // A stop recorded before the run starts is honoured without delivering anything.
    if (input.stopRequestKey !== null) {
      const detail = 'stop requested before delivery';
      const recorded = this.finishWithCurrentRevision(input.inputId, {
        status: 'stopped',
        errorCode: 'STOP_REQUESTED',
        errorMessage: input.stopReason ?? detail,
      });
      return recorded
        ? { kind: 'stopped', inputId: input.inputId, detail }
        : { kind: 'interrupted', inputId: input.inputId, detail: 'could not record the stop' };
    }

    const parts = partsOfPayload(input.payload);
    if (parts === undefined) {
      const detail = 'unreadable input content rejected';
      this.finishWithCurrentRevision(input.inputId, {
        status: 'failed',
        errorCode: 'INVALID_ARGUMENT',
        errorMessage: 'the stored input content is not a text or image block',
      });
      return { kind: 'failed', inputId: input.inputId, detail };
    }
    const text = parts.text;
    const documentTexts: string[] = [];
    for (const document of parts.documents) {
      const stored = readDocument(config.agentDir, document.id);
      if (stored === undefined) {
        const detail = `the document attachment ${document.id} is no longer available`;
        this.finishWithCurrentRevision(input.inputId, {
          status: 'failed',
          errorCode: 'INVALID_ARGUMENT',
          errorMessage: detail,
        });
        return { kind: 'failed', inputId: input.inputId, detail };
      }
      documentTexts.push(formatDocumentText(document.id, document.name, stored.mimeType, stored.text));
    }
    const promptText = [text, ...documentTexts].filter((part) => part !== '').join('\n\n');
    // Images are read here and only here: the bytes become base64 for this one prompt. A file the
    // user deleted is a refused input, not a message that silently lost its picture.
    const images: PiImage[] = [];
    for (const id of parts.images) {
      const image = readImage(config.agentDir, id);
      if (image === undefined) {
        const detail = `the image attachment ${id} is no longer available`;
        this.finishWithCurrentRevision(input.inputId, {
          status: 'failed',
          errorCode: 'INVALID_ARGUMENT',
          errorMessage: detail,
        });
        return { kind: 'failed', inputId: input.inputId, detail };
      }
      images.push({ type: 'image', data: image.bytes.toString('base64'), mimeType: image.mimeType });
    }

    // Attribute compaction events to the input that caused them: the run's identity must be set
    // before the summary, not only before delivery.
    const serverWorkDir = join(config.agentDir, 'work');
    this.liveRuns.set(sessionId, { inputId: input.inputId, serverWorkDir });
    // Proactive compaction: at or above the configured window percentage, summarize before this
    // input is delivered. It happens after the claim, so the worker cannot start a second run, and
    // it is best-effort — a failed summary falls through to the input (Pi's own limit stays a
    // backstop).
    await this.compactIfDue(sessionId).catch(() => undefined);
    // A stop can arrive while the summary runs; the input is still undelivered and must end stopped.
    const afterCompaction = this.options.store.getInput(input.inputId);
    if (afterCompaction !== undefined && afterCompaction.stopRequestKey !== null) {
      const detail = 'stop requested while compacting';
      // The run's identity was set before the summary; both entries must not outlive this path.
      this.hostAborts.delete(abortKey(sessionId, input.inputId));
      this.liveRuns.delete(sessionId);
      const recorded = this.finishWithCurrentRevision(input.inputId, {
        status: 'stopped',
        errorCode: 'STOP_REQUESTED',
        errorMessage: detail,
      });
      return recorded
        ? { kind: 'stopped', inputId: input.inputId, detail }
        : { kind: 'interrupted', inputId: input.inputId, detail: 'could not record the stop' };
    }

    // Everything from the claim onward runs inside one protected block: binding lookup, extras,
    // instance preparation, the first Pi write, delivery and classification. Any failure must end in
    // a recorded terminal state — a claimed input may never be left `processing`.
    let deliveryStarted = false;
    let status: TerminalStatus;
    let detail: string;
    let errorCode: string | undefined;
    let checkpoint: InputCheckpoint | undefined;
    try {
      const binding = this.options.store.getSessionBinding(sessionId);
      const extras = this.options.sessionExtras?.(sessionId);
      // A professional session inherits its Task's type; an injected hook (tests) wins.
      const taskType = this.options.taskTypeOf?.(sessionId) ?? this.options.store.getTaskForSession(sessionId)?.type;
      // S3 scopes the hold to the chief: its conversation runs while the Task is paused, its project
      // writes do not. A specialist's set stays the G1 table's, which the claim gate already guards.
      const hold = session.roleId === 'chief' ? holdOf(this.options.store, sessionId) : 'running';
      const toolSet = toolSetFor(session.roleId, taskType, hold);
      // Host-owned domain tools: the chief organizes Tasks, a specialist may only read its own. The
      // context is resolved per tool call, because this Pi instance is reused across inputs.
      const contextOf = (): TaskToolContext => {
        const live = this.liveRuns.get(sessionId);
        const currentTaskId = this.options.store.getSession(sessionId)?.currentTaskId;
        return {
          store: this.options.store,
          sessionId,
          projectId: session.projectId,
          cwd: session.cwd,
          roleId: session.roleId,
          inputId: live?.inputId ?? input.inputId,
          serverWorkDir: live?.serverWorkDir ?? serverWorkDir,
          controlTask: (control) => this.controlTask(control),
          ...(currentTaskId != null ? { currentTaskId } : {}),
        };
      };
      const backlogContext = (): BacklogToolContext => {
        const live = this.liveRuns.get(sessionId);
        const inputId = live?.inputId ?? input.inputId;
        const currentTaskId = this.options.store.getSession(sessionId)?.currentTaskId;
        return {
          cwd: session.cwd,
          roleId: session.roleId,
          actorId: this.options.store.getInput(inputId)?.actorId ?? 'local',
          sessionId,
          inputId,
          ...(currentTaskId != null ? { currentTaskId } : {}),
          tasksOf: (backlogId: string, taskIds?: readonly string[]) => {
            const tasks = this.options.store
              .listTasks(session.projectId)
              .filter((task) => task.backlogIds.includes(backlogId) || (taskIds ?? []).includes(task.id));
            const lastClosed = tasks
              .filter((task) => task.status === 'completed' || task.status === 'cancelled')
              .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
            return {
              open: tasks
                .filter((task) => OPEN_TASK_STATUSES.includes(task.status))
                .map((task) => ({ taskId: task.id, status: task.status })),
              ...(lastClosed === undefined
                ? {}
                : { lastClosed: { taskId: lastClosed.id, status: lastClosed.status } }),
            };
          },
        };
      };
      const backlogTools = ['chief', 'designer', 'developer', 'settler'].includes(session.roleId)
        ? [createBacklogTool(backlogContext)]
        : [];
      const projectTools =
        session.roleId === 'chief'
          ? [
              createProjectTool(
                (): ProjectToolContext => ({
                  store: this.options.store,
                  projectId: session.projectId,
                  cwd: session.cwd,
                  roleId: session.roleId,
                  sessionId,
                }),
              ),
            ]
          : [];
      const domainTools = asToolDefinitions(
        session.roleId === 'chief'
          ? [
              createTaskTool((): TaskToolContext => ({
                ...contextOf(),
                host: {
                  dispatch: async (memberSessionId: string) => {
                    // The worker does not own this run: report its outcome here, or a member that
                    // finishes after the chief's turn ended would be invisible to the host.
                    const outcome = await this.runNext(memberSessionId);
                    this.options.onRunSettled?.(memberSessionId, outcome);
                  },
                  settleStep: (taskId: string, timeoutMs: number) =>
                    this.settleStep(taskId, timeoutMs, sessionId),
                },
                ...(this.options.onTaskChange === undefined
                  ? {}
                  : { onTaskChange: (taskId: string) => this.options.onTaskChange?.(sessionId, taskId) }),
              }), { chief: true }),
              ...backlogTools,
              ...projectTools,
            ]
          : [
              createTaskGetTool(contextOf),
              ...backlogTools,
              // Every professional member delivers its result through the same formal report.
              createReportTool((): ReportToolContext => ({
                store: this.options.store,
                projectId: session.projectId,
                sessionId,
                inputId: this.liveRuns.get(sessionId)?.inputId ?? input.inputId,
                roleId: session.roleId,
                cwd: session.cwd,
                serverWorkDir: this.liveRuns.get(sessionId)?.serverWorkDir ?? serverWorkDir,
              })),
            ],
      );
      // External information and a real browser (S9): registered only for the roles whose allowlist
      // names them. They read the network and never the project, so a read Task keeps them.
      const external = await this.externalTools({
        sessionId,
        roleAllowed: (name) => toolSet.allowlist.includes(name),
        // Reviewer and investigator are documented as observers: a review runs inside a write Task,
        // so the Task kind alone would hand them an acting browser.
        readOnly:
          taskType === 'read' || session.roleId === 'reviewer' || session.roleId === 'investigator',
        config,
      });
      const hostTools = [
        ...domainTools,
        ...asToolDefinitions(external),
        // The ported official question tool: the model asks through the same ctx.ui channel (G2),
        // and the host tells it which interaction the request became.
        createQuestionTool(() => this.interactions.lastInteractionIdFor(sessionId)),
        ...(extras?.customTools ?? []),
      ];
      // Host-registered tools (domain tools, probe tools) join the allowlist so they stay usable, but a
      // name this role/task combination denies must not come back in through that union.
      const denied = new Set(toolSet.denied);
      const allowlist = [
        ...new Set([
          ...toolSet.allowlist,
          ...hostTools.map((tool) => tool.name).filter((name) => !denied.has(name)),
        ]),
      ];
      const taskId = this.options.store.getTaskForSession(sessionId)?.id;
      const bashTimeoutSeconds = this.options.bashTimeoutSeconds ?? DEFAULT_BASH_TIMEOUT_SECONDS;
      const modelGuard = new ModelOutputGuard();
      const handle = await this.options.registry.acquire(
        {
          sessionId,
          cwd: session.cwd,
          tools: allowlist,
          appendSystemPrompt: [
            assembleSystemPrompt(this.bodiesFor(config.promptDir), session.roleId).text,
          ],
          ...(binding !== undefined ? { piFile: binding.piFile } : {}),
          ...(extras?.customTools !== undefined ? { customTools: extras.customTools } : {}),
          // Always installed: the model's file tools stay inside the project (and never reach the
          // server's private storage); shell commands keep their own deletion gate.
          extensionFactories: [
            createModelOutputGuardExtension(() => this.activeOutputGuards.get(sessionId)),
            createRawQuestionRecovery({
              bridge: this.interactions,
              sessionId,
              inputId: input.inputId,
              ...(taskId !== undefined ? { taskId } : {}),
            }),
            ...(extras?.extensionFactories ?? []),
            createFileBoundaryGuard({
              cwd: session.cwd,
              // The project row is the authority, not the cwd: a session that ever ran in a
              // subdirectory must still be bounded by the whole project.
              projectRoot: this.options.store.getProject(session.projectId)?.realPath ?? session.cwd,
              privateDirs: this.options.privateDirs ?? [],
              // web_fetch saves the full page here and tells the model to grep it; reports and
              // screenshots live under the same root. Credentials and session files stay blocked.
              readableDirs: [join(config.agentDir, 'work')],
            }),
            // A deletion command asks the user before it runs, through the same durable interaction
            // surface the question tool uses. Trust is session-scoped in the runner, so a Pi
            // instance rebuild (Task type or tool-set change) does not ask again.
            createDeletionGate({
              isTrusted: () => this.trustedSessions.has(sessionId),
              trust: () => this.trustedSessions.add(sessionId),
            }),
            ...(bashTimeoutSeconds > 0 ? [createBashTimeoutGuard({ seconds: bashTimeoutSeconds })] : []),
          ],
          ...(hostTools.length > 0 ? { customTools: hostTools } : {}),
        },
        config,
      );
      // The bridge resolves this per-input guard; registration precedes the first event, and the
      // small finally below removes it together with the run.
      this.activeOutputGuards.set(sessionId, modelGuard);

      // Bind the interaction adapter: without a bound uiContext ctx.hasUI is false and the model
      // cannot ask anything (R4/M5). The adapter is a plain object on purpose.
      {
        // The task id is resolved once above; both the recovery and the UI adapter use it.
        handle.session.bindExtensions({
          // A deliberate subset: dialog methods are real, terminal-only surfaces are absent (as in
          // PI's own RPC host). The SDK spreads the object, so the missing keys are simply undefined.
          uiContext: createUiAdapter({
            bridge: this.interactions,
            sessionId,
            inputId: input.inputId,
            ...(taskId !== undefined ? { taskId } : {}),
          }) as never,
          mode: 'rpc',
        });
      }

      // Observe the live session: the listener is synchronous and only publishes in memory.
      if (this.options.onEvent !== undefined && !this.observed.has(handle)) {
        this.observed.add(handle);
        handle.session.subscribe((event) => {
          this.lastEventAt.set(sessionId, Date.now());
          this.options.onEvent?.(sessionId, event, {
            inputId: this.liveRuns.get(sessionId)?.inputId ?? input.inputId,
            // The same epoch definition the stream uses: server generation plus instance generation.
            epoch: epochOf({
              serverEpoch: this.options.store.epoch,
              instanceGeneration: this.options.registry.generationOf(sessionId),
            }),
          });
        });
      }

      // Bookmark first, then deliver: the bookmark's subtree contains this input's root entry.
      // From here on we are performing Pi writes, so a failure means the boundary is unconfirmed
      // rather than "the session could not be prepared".
      deliveryStarted = true;
      const markerId = handle.sessionManager.appendCustomEntry(INPUT_MARKER_CUSTOM_TYPE, {
        inputId: input.inputId,
        requestDigest: input.paramsDigest,
        generation: { serverEpoch: this.options.store.epoch, claim: input.claim },
      });
      this.options.store.recordEffectiveConfig({
        inputId: input.inputId,
        // Record what the session really has: the requested allowlist minus names Pi did not register.
        effectiveConfig: {
          ...redactEffectiveConfig(config),
          requestedTools: allowlist,
          activeTools: handle.session.getActiveToolNames(),
          taskType: taskType ?? null,
        },
      });

      /*
       * Usage is read as a slice of the session's own messages: this input's responses are exactly the
       * ones appended from here on. It is flushed after *every* completed response, not only when the
       * input ends — a delegated member can run for minutes, and "no numbers until it finishes" reads
       * as "nothing is being counted". Each flush writes the input's absolute totals for the models it
       * has touched so far, so the numbers converge instead of piling up, and the last flush is the
       * input's final cost.
       */
      const usageStart = handle.session.messages.length;
      const usageStartedAt = new Date().toISOString();
      const taskIdOfRun = this.options.store.getTaskForSession(sessionId)?.id;
      const flushUsage = (): void =>
        this.recordUsageOf(session, input.inputId, handle, usageStart, usageStartedAt, taskIdOfRun);
      const stopWatchingUsage = handle.session.subscribe((event) => {
        // Only assistant messages carry usage; the user and tool-result messages this event also
        // fires for would be writes with nothing to add.
        if (event.type === 'message_end' && event.message.role === 'assistant') flushUsage();
      });
      // Report-retry ledger: every toolResult message feeds the per-input guard; a tripped budget
      // aborts the run so the corrective turn (or the terminal classification) can take over. The
      // subscription is per input, so counting stays per input even when the registry reuses the
      // Pi instance and its older extension bridge.
      const stopReportLedger = handle.session.subscribe((event) => {
        if (modelGuard.observeEvent(event)) void handle.session.abort();
      });
      try {
        await this.promptWithWatchdog(handle, sessionId, promptText, images);
        await this.recoverModelOutput(handle, sessionId, modelGuard, input.inputId);
      } finally {
        // Also the path of a failed or stopped run: the responses that did complete were paid for.
        stopWatchingUsage();
        stopReportLedger();
        if (this.activeOutputGuards.get(sessionId) === modelGuard) this.activeOutputGuards.delete(sessionId);
        flushUsage();
      }

      const lastMessage = handle.session.messages[handle.session.messages.length - 1];
      const stopReason = lastMessage?.role === 'assistant' ? lastMessage.stopReason : 'none';
      const providerError =
        lastMessage?.role === 'assistant' ? String(lastMessage.errorMessage ?? '') : '';
      const piFile = handle.piFile();
      const inputEntryId = rootInputEntryId(handle.sessionManager.getEntries(), markerId);
      checkpoint =
        piFile !== undefined && inputEntryId !== undefined
          ? {
              piFile,
              leafEntryId: handle.sessionManager.getLeafId() ?? '',
              inputMarkerId: markerId,
              inputEntryId,
              configHash: digestJson(redactEffectiveConfig(config)),
            }
          : undefined;

      // The current persisted row decides what the stop facts are; the terminal write re-reads the
      // revision again (a stop may land between here and there).
      const live = this.options.store.getInput(input.inputId);
      if (live === undefined || live.status !== 'processing') {
        return {
          kind: 'interrupted',
          inputId: input.inputId,
          detail: 'input was finalized elsewhere while the run was in flight',
        };
      }
      const stoppedOnRequest =
        live.stopRequestKey !== null || this.hostAborts.has(abortKey(sessionId, input.inputId));

      // A stop request that landed while the input was processing is the outcome, even if the model
      // managed one final message before the abort unwound: the user asked for no further result.
      if (stoppedOnRequest) {
        status = 'stopped';
        detail = stopReason === 'error' ? 'run was aborted as requested' : 'run stopped on request';
      } else if (modelGuard.fault !== undefined) {
        status = 'failed';
        errorCode = modelGuard.fault.code;
        detail =
          modelGuard.fault.code === REPORT_RETRY_EXHAUSTED
            ? `report retry budget exhausted: ${modelGuard.fault.detail}`
            : `model output discarded: ${modelGuard.fault.detail}`;
      } else if (stopReason === 'error') {
        status = 'failed';
        errorCode = 'MODEL_ERROR';
        detail = `model run failed: ${providerError || 'unknown provider error'}`;
      } else if (stopReason === 'aborted') {
        status = 'stopped';
        detail = 'run was aborted';
      } else if (checkpoint === undefined || !boundaryPersistedOnDisk(checkpoint, {
        inputId: input.inputId,
        requestDigest: input.paramsDigest,
        cwd: session.cwd,
      })) {
        status = 'interrupted';
        errorCode = 'HISTORY_UNAVAILABLE';
        detail = 'the delivered boundary could not be read back from disk';
      } else {
        // A professional member owes the report kind fixed at dispatch. A normal stop with prose
        // only is not a delivered result: without this check the input would be `completed` and
        // the Task strip would show a check, while `results` has nothing for the reviewer/test.
        const member = this.options.store.getTaskSession(sessionId);
        const reportMissing =
          member !== undefined &&
          member.currentInputId === input.inputId &&
          this.options.store.resultsForInputs([input.inputId]).length === 0;
        if (reportMissing) {
          status = 'failed';
          errorCode = 'REPORT_MISSING';
          detail = `the run ended without the formal ${member.expectedKind} report this step requires`;
        } else {
          status = 'completed';
          detail = 'settled and persisted';
        }
      }
    } catch (error) {
      status = 'interrupted';
      if (error instanceof RunWatchdogError) {
        // The host aborted a stalled/over-long run: the delivered boundary cannot be trusted,
        // so the input is interrupted and the chief must verify (R4) instead of assuming.
        errorCode = error.code;
        detail = error.detail;
      } else if (!deliveryStarted) {
        // Nothing was written to Pi: report the precise cause instead of a delivery failure.
        errorCode =
          error instanceof HistoryUnavailableError ? 'HISTORY_UNAVAILABLE' : 'PROJECT_UNAVAILABLE';
        detail = `session could not be prepared: ${errorMessageOf(error)}`;
      } else {
        errorCode = 'HOST_SAVE_FAILED';
        detail = `delivery boundary unconfirmed: ${errorMessageOf(error)}`;
      }
    } finally {
      this.hostAborts.delete(abortKey(sessionId, input.inputId));
      this.liveRuns.delete(sessionId);
    }

    const recorded = this.finishWithCurrentRevision(input.inputId, {
      status,
      ...(errorCode !== undefined ? { errorCode } : {}),
      ...(status !== 'completed' ? { errorMessage: detail } : {}),
      ...(checkpoint !== undefined ? { checkpoint } : {}),
    });
    if (!recorded) {
      return {
        kind: 'interrupted',
        inputId: input.inputId,
        detail: 'terminal state could not be recorded (another writer moved the input)',
      };
    }
    if (checkpoint !== undefined) {
      // Keep the exact file binding so later inputs (and a rebuilt instance) resume this history.
      this.options.store.recordSessionBinding({
        sessionId,
        piFile: checkpoint.piFile,
        branchEntryId: checkpoint.leafEntryId,
        hasHistory: true,
        configHash: checkpoint.configHash,
      });
    }
    return {
      kind: status,
      inputId: input.inputId,
      detail,
      ...(checkpoint !== undefined ? { checkpoint } : {}),
    };
  }

  /**
   * Control a Task end to end: record the intent, actually stop the Task's own work (queued inputs are
   * marked, live runs are aborted and awaited), then write the final controlled status and release the
   * chief's slot. `resume` only records the intent.
   */
  async controlTask(params: {
    taskId: string;
    command: 'pause' | 'resume' | 'cancel';
  }): Promise<TaskRow> {
    const intent = this.options.store.controlTask(params);
    if (params.command === 'resume') {
      return intent;
    }
    if (intent.status === 'paused' || intent.status === 'cancelled') {
      // Nothing was unfinished, so the intent is already final.
      return intent;
    }
    for (const member of this.options.store.listTaskSessions(params.taskId)) {
      const input = member.currentInputId === null ? undefined : this.options.store.getInput(member.currentInputId);
      if (input === undefined) {
        continue;
      }
      // Pause keeps queued work for a later resume; cancel stops what never started. Live work is
      // always stopped, so nothing keeps writing while the Task is not running.
      const stop = input.status === 'processing' || (params.command === 'cancel' && input.status === 'queued');
      if (!stop) {
        continue;
      }
      await this.requestStop(member.sessionId, {
        inputId: input.inputId,
        requestKey: `control:${params.command}:${input.inputId}`,
        reason: `the Task was asked to ${params.command}`,
      });
    }
    return this.options.store.finalizeControl({
      taskId: params.taskId,
      status: params.command === 'pause' ? 'paused' : 'cancelled',
    });
  }

  /**
   * Record a stop request and, when the session has a live Pi instance, actually stop it and wait
   * for idleness before reporting the intent as handled.
   */
  async requestStop(
    sessionId: string,
    params: { inputId: string; requestKey: string; reason: string },
  ): Promise<{ status: InputRow['status']; stopRequested: boolean }> {
    // A queued input has no Pi run to abort: aborting here would also cancel an unrelated summary
    // that owns the session, so only a really processing input reaches the live handle.
    const before = this.options.store.getInput(params.inputId);
    const result = this.options.store.requestStop(params);
    if (result.stopRequested && before?.status === 'processing') {
      // Tell the runner which run is being stopped before aborting it, so the abort is classified
      // as `stopped` rather than as a provider error.
      this.noteAbort(sessionId, params.inputId);
      const handle = this.options.registry.get(sessionId);
      if (handle !== undefined) {
        await handle.session.abort();
        await handle.session.waitForIdle();
        // Idleness is not the same as a written terminal row: the run's own bookkeeping lands
        // just after it. The caller reports the settled row, so wait (bounded) for that row
        // instead of returning a status the row already contradicts.
        const deadline = Date.now() + 5_000;
        for (;;) {
          const row = this.options.store.getInput(params.inputId);
          if (row === undefined || row.status !== 'processing' || Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    }
    return result;
  }

  /**
   * Append this input's token usage to the ledger, aggregated per (role, model).
   *
   * Why here and not while streaming: usage is only reported with a completed response, and an input
   * performs several of them (every tool round is a request). One transaction per input keeps the
   * conversation path free of writes, and the ledger stays a plain append — the statistics are
   * GROUP BYs, so nothing has to be kept consistent.
   *
   * Attribution comes from the response itself (`provider`/`model`), not from the configuration: a
   * compaction or a fallback model must be counted where it was really spent. A response that reports
   * no usage still counts as a response, with null figures — "unreported" and "free" are different.
   *
   * Failure to record never changes the conversation's outcome: the run already happened, and the
   * input's terminal state is written by the caller regardless.
   */
  private recordUsageOf(
    session: { readonly id: string; readonly projectId: string; readonly roleId: string },
    inputId: string,
    handle: PiSessionHandle,
    from: number,
    startedAt: string,
    taskId: string | undefined,
  ): void {
    try {
      const entries = rollupUsage(handle.session.messages, from);
      if (entries.length === 0) return;
      this.options.store.recordUsage({
        inputId,
        projectId: session.projectId,
        sessionId: session.id,
        ...(taskId !== undefined ? { taskId } : {}),
        roleId: session.roleId,
        startedAt,
        endedAt: new Date().toISOString(),
        entries,
      });
    } catch {
      // Statistics are not the conversation's contract: a ledger write that fails must not turn a
      // successful run into a failed input. The gap shows up as a missing row, never as a wrong one.
    }
  }

  /**
   * Write a terminal state against the row's *current* revision. Between the claim and this write a
   * stop request (or any other writer) can move the row, and finishing with the claimed revision
   * would then fail the CAS and strand the input as `processing` forever.
   */
  private finishWithCurrentRevision(
    inputId: string,
    params: {
      status: TerminalStatus;
      errorCode?: string;
      errorMessage?: string;
      checkpoint?: InputCheckpoint;
    },
  ): boolean {
    const live = this.options.store.getInput(inputId);
    if (live === undefined || live.status !== 'processing') {
      return false;
    }
    return this.options.store.finishInput({
      inputId,
      expectedRevision: live.revision,
      status: params.status,
      ...(params.errorCode !== undefined ? { errorCode: params.errorCode } : {}),
      ...(params.errorMessage !== undefined ? { errorMessage: params.errorMessage } : {}),
      ...(params.checkpoint !== undefined ? { checkpoint: params.checkpoint } : {}),
    });
  }

  /** Pre-claim directory check (S3: 目录可用). */
  /**
   * Wait for the Task's current step: poll the members' real input states (the store is the truth, not
   * an in-memory promise), return a snapshot on timeout, and never cancel or rebuild member work.
   * The wait is host work, not the chief's own run: it is marked so the watchdog does not charge it.
   */
  private async settleStep(
    taskId: string,
    timeoutMs: number,
    sessionId: string,
  ): Promise<DelegationReturn> {
    const deadline = Date.now() + timeoutMs;
    const waitKey = this.hostWaitKey(sessionId);
    this.hostWaits.set(waitKey, (this.hostWaits.get(waitKey) ?? 0) + 1);
    try {
      for (;;) {
        const task = this.options.store.getTask(taskId);
        if (task === undefined) {
          throw new StoreError('NOT_FOUND', 'Task does not exist', { taskId });
        }
        const members = this.options.store
          .listTaskSessions(taskId)
          .filter((member) => task.currentSessionIds.includes(member.sessionId));
        const sessions = members.map((member) => this.memberState(member.currentInputId));
        const unfinished = sessions.filter(
          (member) =>
            member.state === 'queued' ||
            member.state === 'working' ||
            member.state === 'waiting_user' ||
            member.state === 'stopping',
        );
        if (unfinished.length === 0) {
          const failing = sessions.filter((member) => member.state !== 'completed');
          return { taskId, outcome: failing.length === 0 ? 'completed' : 'blocked', sessions };
        }
        if (Date.now() >= deadline) {
          return { taskId, outcome: 'timeout', sessions };
        }
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 25);
        await promise;
      }
    } finally {
      const remaining = (this.hostWaits.get(waitKey) ?? 1) - 1;
      if (remaining <= 0) this.hostWaits.delete(waitKey);
      else this.hostWaits.set(waitKey, remaining);
    }
  }

  private memberState(inputId: string | null): MemberState {
    const input = inputId === null ? undefined : this.options.store.getInput(inputId);
    // A member blocked on a question is not plain 'working': the chief must see that the user
    // has to answer something before this step can move (M1/M5).
    const waitingInteractions =
      inputId === null
        ? []
        : this.options.store.listPendingInteractions(this.memberSessionOf(inputId)).filter((row) => row.inputId === inputId);
    const state: MemberState['state'] =
      input === undefined
        ? 'stopped'
        : input.status === 'processing'
          ? waitingInteractions.length > 0
            ? 'waiting_user'
            : 'working'
          : input.status;
    return {
      sessionId: this.memberSessionOf(inputId),
      inputId: inputId ?? '',
      state,
      // What this member really delivered for the input the chief is waiting on.
      resultIds:
        inputId === null ? [] : this.options.store.resultsForInputs([inputId]).map((result) => result.resultId),
      interactionIds: waitingInteractions.map((row) => row.interactionId),
      ...(input?.errorCode != null
        ? { error: { code: input.errorCode, message: input.errorMessage ?? '' } }
        : {}),
    };
  }

  private memberSessionOf(inputId: string | null): string {
    return inputId === null ? '' : (this.options.store.getInput(inputId)?.sessionId ?? '');
  }

  private checkProject(cwd: string): { ok: true } | { ok: false; detail: string } {
    try {
      if (!statSync(cwd).isDirectory()) {
        return { ok: false, detail: `${cwd} is not a directory` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: `${cwd} is not accessible: ${errorMessageOf(error)}` };
    }
  }
}

/**
 * The write hold of the Task a chief coordinates. The Task stays bound through `pausing`/`paused`,
 * so the hold is read from the Task row - never from the input that is being claimed.
 */
function holdOf(store: Store, sessionId: string): WriteHold {
  const taskId = store.getSession(sessionId)?.currentTaskId ?? null;
  const status: TaskStatus | undefined = taskId === null ? undefined : store.getTask(taskId)?.status;
  return status === 'pausing' || status === 'paused' ? 'paused' : 'running';
}

function abortKey(sessionId: string, inputId: string): string {
  return `${sessionId}:${inputId}`;
}

/**
 * Read the exact Pi JSONL back from disk and confirm the recorded boundary is really there and really
 * belongs to this input (P0/R4: a checkpoint is only trustworthy when the designated history can be
 * read). Checking a set of ids is not enough — the marker must carry this input's identity, the root
 * entry must be its first user message, and the leaf must be reachable from that root.
 */
export function boundaryPersistedOnDisk(
  checkpoint: InputCheckpoint,
  expected: { readonly inputId: string; readonly requestDigest: string; readonly cwd: string },
): boolean {
  let text: string;
  try {
    text = readFileSync(checkpoint.piFile, 'utf8');
  } catch {
    return false;
  }
  const entries: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    entries.push(parsed as Record<string, unknown>);
  }
  const header = entries[0];
  if (header === undefined || header['type'] !== 'session') {
    return false;
  }
  if (!headerMatchesCwd(header, expected.cwd)) {
    return false;
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const id = entry['id'];
    if (typeof id === 'string') {
      byId.set(id, entry);
    }
  }

  const marker = byId.get(checkpoint.inputMarkerId);
  if (marker === undefined || marker['type'] !== 'custom' || marker['customType'] !== INPUT_MARKER_CUSTOM_TYPE) {
    return false;
  }
  const data = marker['data'];
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  // `typeof` above proves an object; bracket access keeps the value as unknown for comparison.
  const markerData = data as Record<string, unknown>;
  if (markerData['inputId'] !== expected.inputId) {
    return false;
  }
  // The digest must be present and match: a copied marker without it is not this input's marker.
  if (markerData['requestDigest'] !== expected.requestDigest) {
    return false;
  }

  const firstUser = firstDescendantUserEntry(entries, checkpoint.inputMarkerId);
  if (firstUser !== checkpoint.inputEntryId) {
    return false;
  }
  return leafReachableFromRoot(entries, checkpoint.inputEntryId, checkpoint.leafEntryId);
}

/** First `role=user` message reachable from a root entry, walking the parent chain downwards. */
function firstDescendantUserEntry(
  entries: readonly Record<string, unknown>[],
  rootId: string,
): string | undefined {
  const queue = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (parentId === undefined) {
      break;
    }
    for (const entry of entries) {
      if (entry['parentId'] !== parentId) {
        continue;
      }
      const id = entry['id'];
      if (typeof id !== 'string' || seen.has(id)) {
        continue; // a corrupt file can contain cycles; the walk must still terminate
      }
      seen.add(id);
      const message = entry['message'];
      if (
        entry['type'] === 'message' &&
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        message.role === 'user'
      ) {
        return id;
      }
      queue.push(id);
    }
  }
  return undefined;
}

/** Header identity: the file must belong to the expected working directory (symlinks resolved). */
function headerMatchesCwd(header: Record<string, unknown>, cwd: string): boolean {
  const headerCwd = header['cwd'];
  if (typeof headerCwd !== 'string' || headerCwd.length === 0) {
    return false;
  }
  try {
    return realpathSync(headerCwd) === realpathSync(cwd);
  } catch {
    return false;
  }
}

/** True when `targetId` is reachable from `rootId` following child links ('' target = no leaf check). */
function leafReachableFromRoot(
  entries: readonly Record<string, unknown>[],
  rootId: string,
  targetId: string,
): boolean {
  if (targetId === '') {
    return true;
  }
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (parentId === undefined) {
      break;
    }
    for (const entry of entries) {
      if (entry['parentId'] !== parentId) {
        continue;
      }
      const id = entry['id'];
      if (typeof id !== 'string' || seen.has(id)) {
        continue;
      }
      if (id === targetId) {
        return true;
      }
      seen.add(id);
      queue.push(id);
    }
  }
  return false;
}

/** First role=user message inside the bookmark's subtree (P0: append-only chain, take the first). */
function rootInputEntryId(entries: readonly SessionEntry[], markerId: string): string | undefined {
  const descendants: SessionEntry[] = [];
  const visit = (parentId: string): void => {
    for (const entry of entries) {
      if (entry.parentId === parentId) {
        descendants.push(entry);
        visit(entry.id);
      }
    }
  };
  visit(markerId);
  return descendants.find((entry) => entry.type === 'message' && entry.message.role === 'user')?.id;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}