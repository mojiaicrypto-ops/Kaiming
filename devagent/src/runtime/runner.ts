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
import { Store, StoreError, type InputRow, type TaskRow } from '../store/store.ts';
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
import { textOfPayload } from './input-text.ts';
import { InteractionBridge, createUiAdapter } from './interactions.ts';
import { createQuestionTool } from '../tools/question-tool.ts';
import { createPrivatePathGuard } from './tool-guard.ts';
import { toolSetFor } from './tool-sets.ts';
import { asToolDefinitions, createTaskGetTool, createTaskTool, type TaskToolContext } from '../tools/task-tools.ts';
import { createReportTool, type ReportToolContext } from '../tools/report-tools.ts';
import { createRequirementTool, type RequirementToolContext } from '../tools/requirement-tools.ts';
import { createProjectTool, type ProjectToolContext } from '../tools/project-tools.ts';
import type { DelegationReturn, MemberState } from '../tools/delegation-tools.ts';

export interface InputCheckpoint {
  readonly piFile: string;
  readonly leafEntryId: string;
  readonly inputMarkerId: string;
  readonly inputEntryId: string;
  readonly configHash: string;
}

export type TerminalStatus = 'completed' | 'failed' | 'stopped' | 'interrupted';

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
  /** A run with no Pi activity for this long is aborted (RUN_STALLED) instead of waiting forever. */
  readonly runStallMs?: number;
  /** A run exceeding this total duration is aborted (RUN_TIMEOUT). */
  readonly runTotalMs?: number;
}

export class InputRunner {
  private readonly options: RunnerOptions;
  /** The interaction bridge (M5); the runner binds its adapter to every session it prepares. */
  readonly interactions: InteractionBridge;
  /** `${sessionId}:${inputId}` of runs a host-owned tool asked to abort (S5 tool-initiated stop). */
  private readonly hostAborts = new Set<string>();
  /** Last Pi activity per session: a stalled provider/stream must not mean an infinite wait. */
  private readonly lastEventAt = new Map<string, number>();
  /** Role prompt bodies, cached per prompt directory. */
  private readonly promptBodies = new Map<string, PromptBodies>();
  /** Identity of the run currently executing per session: a Pi instance is reused across inputs. */
  private readonly liveRuns = new Map<string, { readonly inputId: string; readonly serverWorkDir: string }>();
  /** Handles already wired to the observation hook (one subscription per Pi instance). */
  private readonly observed = new WeakSet<object>();

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
  private async promptWithWatchdog(handle: PiSessionHandle, sessionId: string, text: string): Promise<void> {
    this.lastEventAt.set(sessionId, Date.now());
    await runWithWatchdog({
      prompt: () => handle.session.prompt(text),
      abort: () => handle.session.abort(),
      activityAt: () => this.lastEventAt.get(sessionId) ?? 0,
      // A question on screen means the run waits on the user: that wait is not a stalled provider.
      waiting: () => this.interactions.isWaiting(sessionId),
      stallMs: this.options.runStallMs ?? DEFAULT_RUN_STALL_MS,
      totalMs: this.options.runTotalMs ?? DEFAULT_RUN_TOTAL_MS,
    });
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

    const text = textOfPayload(input.payload);
    if (text === undefined) {
      const detail = 'non-text input content rejected';
      this.finishWithCurrentRevision(input.inputId, {
        status: 'failed',
        errorCode: 'INVALID_ARGUMENT',
        errorMessage: 'this runtime only delivers text content',
      });
      return { kind: 'failed', inputId: input.inputId, detail };
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
      const toolSet = toolSetFor(session.roleId, taskType);
      // Host-owned domain tools: the chief organizes Tasks, a specialist may only read its own. The
      // context is resolved per tool call, because this Pi instance is reused across inputs.
const serverWorkDir = join(config.agentDir, 'work');
      this.liveRuns.set(sessionId, { inputId: input.inputId, serverWorkDir });
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
      const requirementContext = (): RequirementToolContext => ({
        store: this.options.store,
        projectId: session.projectId,
        cwd: session.cwd,
        roleId: session.roleId,
        sessionId,
      });
      const requirementTools = ['chief', 'designer', 'settler', 'developer'].includes(session.roleId)
        ? [createRequirementTool(requirementContext)]
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
                    await this.runNext(memberSessionId);
                  },
                  settleStep: (taskId: string, timeoutMs: number) => this.settleStep(taskId, timeoutMs),
                },
                ...(this.options.onTaskChange === undefined
                  ? {}
                  : { onTaskChange: (taskId: string) => this.options.onTaskChange?.(sessionId, taskId) }),
              }), { chief: true }),
              ...requirementTools,
              ...projectTools,
            ]
          : [
              createTaskGetTool(contextOf),
              ...requirementTools,
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
      const hostTools = [
        ...domainTools,
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
          // Always installed: the model's file tools never reach the server's private storage.
          extensionFactories: [
            ...(extras?.extensionFactories ?? []),
            createPrivatePathGuard({
              cwd: session.cwd,
              privateDirs: this.options.privateDirs ?? [],
            }),
          ],
          ...(hostTools.length > 0 ? { customTools: hostTools } : {}),
        },
        config,
      );

      // Bind the interaction adapter: without a bound uiContext ctx.hasUI is false and the model
      // cannot ask anything (R4/M5). The adapter is a plain object on purpose.
      {
        const taskId = this.options.store.getTaskForSession(sessionId)?.id;
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

      await this.promptWithWatchdog(handle, sessionId, text);

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

      if (stopReason === 'error') {
        if (stoppedOnRequest) {
          status = 'stopped';
          detail = 'run was aborted as requested';
        } else {
          status = 'failed';
          errorCode = 'MODEL_ERROR';
          detail = `model run failed: ${providerError || 'unknown provider error'}`;
        }
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
        status = 'completed';
        detail = 'settled and persisted';
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
    const result = this.options.store.requestStop(params);
    if (result.stopRequested) {
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
   */
  private async settleStep(taskId: string, timeoutMs: number): Promise<DelegationReturn> {
    const deadline = Date.now() + timeoutMs;
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