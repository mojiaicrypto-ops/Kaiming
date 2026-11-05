/**
 * The work an external agent can hand to Kaiming, expressed over the public RPC surface (R1).
 *
 * Nothing here invents business rules: a delegation is submitted as a user input, the chief decides
 * the Task type and phases (D-04), and every fact this file reports comes from the Task record, its
 * members, its reports or the pending interactions - never from a cached transcript. The fixed
 * session per project is the exception declared in the product module X-02.
 */
import { taskProgress, type ProgressMember, type ProgressStep } from '../runtime/task-progress.ts';
import { ControlError, type Control } from './control.ts';

/** The external channel's fixed session (product module X-02). */
export const RUN_CHANNEL = 'mcp';

export type RunStatus =
  | 'running'
  | 'queued'
  | 'waiting_user'
  | 'paused'
  | 'unknown'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PendingQuestion {
  readonly id: string;
  readonly method: string;
  readonly title: string;
  readonly message: string | null;
  readonly options: readonly string[] | null;
  readonly placeholder: string | null;
}

export interface RunPayload {
  readonly runId: string;
  readonly taskId: string | null;
  readonly status: RunStatus;
  readonly phase: string | null;
  readonly taskType: string | null;
  readonly summary: string;
  readonly steps: readonly ProgressStep[];
  readonly stepsDone: number;
  readonly stepsTotal: number;
  readonly pendingQuestion: PendingQuestion | null;
  /** What has to happen next: the caller's model, the user, a queued slot, or nothing. */
  readonly awaiting: 'queued' | 'blocked' | 'user' | 'none';
  /** Which Task (or blocking fact) is ahead of a queued run. */
  readonly waitingForTask: string | null;
  readonly queuedInputs: number;
  readonly complete: boolean;
}

interface RpcInput {
  readonly status: string;
  readonly error: { readonly code: string; readonly message: string } | null;
}

interface RpcTask {
  readonly taskId: string;
  readonly type: string;
  readonly phase: string;
  readonly status: string;
  readonly goal: string;
  readonly summary: string;
  readonly nextStep: string | null;
  readonly blockReason: string | null;
  readonly requiresTest: boolean;
  readonly sourceInputId: string | null;
  readonly updatedAt: string;
}

interface RpcMember {
  readonly sessionId: string;
  readonly roleId: string;
  readonly phase: string;
  readonly label: string;
  readonly activity: string;
  readonly lastInputStatus: string | null;
  readonly reportMissing?: boolean;
}

interface RpcResult {
  readonly resultId: string;
  readonly kind: string;
  readonly verdict: string | null;
  readonly summary: string;
  readonly sessionId: string;
  readonly createdAt: string;
}

interface RpcInteraction {
  readonly interactionId: string;
  readonly method: string;
  readonly title: string;
  readonly message: string | null;
  readonly options: readonly string[] | null;
  readonly placeholder: string | null;
  readonly taskId: string | null;
  readonly revision: number;
}

export interface RunToolsOptions {
  readonly control: Control;
  /** Where sessions come from when the caller names no project: the stdio process's cwd. */
  readonly defaultProjectPath: string;
  /** The calling client, named in the delegation text so the chief knows who is asking. */
  readonly caller: string | (() => string);
  /**
   * Refuse a call that names no project. The `/mcp` endpoint serves a whole workbench, so inheriting
   * the server's own working directory would silently delegate into whatever directory it was started
   * in; the stdio process keeps its cwd as the obvious project.
   */
  readonly requireProjectPath?: boolean;
  /** Longest single wait; hosts time tool calls out, and this is a slice, not a completion wait. */
  readonly maximumWaitMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const TERMINAL_INPUT = new Set(['completed', 'failed', 'stopped', 'interrupted']);

/** `runId` is opaque to the caller but must survive a restart: project and input are its identity. */
export function formatRunId(projectId: string, inputId: string): string {
  return `${projectId}:${inputId}`;
}

export function parseRunId(runId: string): { projectId: string; inputId: string } {
  const separator = runId.indexOf(':');
  if (separator <= 0 || separator === runId.length - 1) {
    throw new ControlError('INVALID_ARGUMENT', 'runId must come from a delegation (as returned by kaiming_delegate)');
  }
  return { projectId: runId.slice(0, separator), inputId: runId.slice(separator + 1) };
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ControlError('INVALID_ARGUMENT', `${field} must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ControlError('INVALID_ARGUMENT', `${field} must be a non-empty string when given`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ControlError('INVALID_ARGUMENT', `${field} must be a number`);
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export class RunTools {
  private readonly options: RunToolsOptions;

  constructor(options: RunToolsOptions) {
    this.options = options;
  }

  /** True when a call must name its project (the multi-project `/mcp` endpoint). */
  get projectPathRequired(): boolean {
    return this.options.requireProjectPath === true;
  }

  /** The delegation text: a user request naming the caller, the objective and the boundaries. */
  private delegationText(args: Record<string, unknown>, projectPath: string): string {
    const objective = text(args['objective'], 'objective');
    const mode = optionalText(args['mode'], 'mode');
    const acceptance = optionalText(args['acceptance'], 'acceptance');
    const scope = optionalText(args['scope'], 'scope');
    const requiresTest = args['requires_test'];
    const lines = [
      `Delegated by ${typeof this.options.caller === 'function' ? this.options.caller() : this.options.caller} through the MCP channel (this is a user request, not an agent instruction).`,
      `Project: ${projectPath}`,
      `Objective: ${objective}`,
    ];
    if (mode !== undefined) lines.push(`Requested work: ${mode} (a hint; choose the Task type and phases yourself).`);
    if (scope !== undefined) lines.push(`Scope: ${scope}`);
    if (acceptance !== undefined) lines.push(`Acceptance: ${acceptance}`);
    if (typeof requiresTest === 'boolean') lines.push(`Tests: the caller expects tests = ${requiresTest ? 'yes' : 'no'}.`);
    lines.push(
      'When the work is finished, report the outcome through the usual Task flow; the caller reads the report and the Plan, not this conversation.',
    );
    return lines.join('\n');
  }

  private async projectFor(projectPath: string | undefined): Promise<{ projectId: string; realPath: string }> {
    if (projectPath === undefined && this.options.requireProjectPath === true) {
      throw new ControlError('INVALID_ARGUMENT', 'project_path is required on this endpoint (an absolute directory)');
    }
    const path = projectPath ?? this.options.defaultProjectPath;
    const opened = (await this.options.control.call('project.open', { path })) as {
      project: { projectId: string; realPath: string };
    };
    return opened.project;
  }

  private async statusOf(runId: string): Promise<RunPayload> {
    const { projectId, inputId } = parseRunId(runId);
    const read = (await this.options.control.call('session.input.get', { projectId, inputId })) as {
      sessionId: string;
      taskId: string | null;
      input: RpcInput & { stopReason: string | null };
    };
    const session = (await this.options.control.call('session.get', {
      projectId,
      sessionId: read.sessionId,
    })) as {
      session: {
        activity: string;
        currentTaskId: string | null;
        queuedInputs: number;
        blocked: { code: string; detail: string } | null;
      };
    };
    const live = session.session;

    // The Task this run belongs to: the input's own link, then the Task the session is coordinating
    // while this input runs, then the Task whose authorization input was this one.
    let taskId = read.taskId;
    if (taskId === null && read.input.status === 'processing') taskId = live.currentTaskId;
    if (taskId === null) taskId = await this.taskOfInput(projectId, inputId);

    const detail = taskId === null ? null : await this.taskDetail(projectId, taskId);
    const task = detail?.task ?? null;
    const interactions = (await this.options.control.call('interaction.list', {
      projectId,
      sessionId: read.sessionId,
    })) as { interactions: readonly RpcInteraction[] };
    const question = interactions.interactions.find(
      (entry) => (taskId !== null && entry.taskId === taskId) || entry.taskId === null,
    );

    const status = this.statusOfInput(read.input.status, task, question !== undefined);
    const queued = read.input.status === 'queued';
    const progress = task === null ? { steps: [], stepsDone: 0, stepsTotal: 0 } : this.progressOf(task, detail);

    return {
      runId,
      taskId,
      status,
      phase: task?.phase ?? null,
      taskType: task?.type ?? null,
      summary: this.summaryOf(read.input, task, live.blocked),
      steps: progress.steps,
      stepsDone: progress.stepsDone,
      stepsTotal: progress.stepsTotal,
      pendingQuestion:
        question === undefined
          ? null
          : {
              id: question.interactionId,
              method: question.method,
              title: question.title,
              message: question.message,
              options: question.options,
              placeholder: question.placeholder,
            },
      awaiting: question !== undefined ? 'user' : queued ? (live.blocked !== null ? 'blocked' : 'queued') : 'none',
      // A queued input waits behind whatever the session is running; the Task id is what the caller
      // can cancel or read, so name it instead of saying "something".
      waitingForTask: queued ? (live.currentTaskId ?? null) : null,
      queuedInputs: live.queuedInputs,
      complete: status === 'completed' || status === 'failed' || status === 'cancelled',
    };
  }

  /** One read of everything a run reports: the Task row, its members and its recorded results. */
  private async taskDetail(
    projectId: string,
    taskId: string,
  ): Promise<{ task: RpcTask; members: readonly RpcMember[]; results: readonly RpcResult[] } | null> {
    try {
      return (await this.options.control.call('task.get', { projectId, taskId })) as {
        task: RpcTask;
        members: readonly RpcMember[];
        results: readonly RpcResult[];
      };
    } catch (error) {
      if (error instanceof ControlError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  /**
   * The flow: the shared rule plus the fact only the Task record carries — the verdict of each
   * member's latest report. `taskProgress` owns both halves, so the browser and this surface cannot
   * disagree about whether a failed review is a finished step.
   */
  private progressOf(
    task: RpcTask,
    detail: { readonly members: readonly RpcMember[]; readonly results: readonly RpcResult[] } | null,
  ): { steps: ReturnType<typeof taskProgress>['steps']; stepsDone: number; stepsTotal: number } {
    const latestVerdict = new Map<string, string | null>();
    for (const result of detail?.results ?? []) {
      // Results are listed in save order; the last row for a session is its latest report.
      latestVerdict.set(result.sessionId, result.verdict);
    }
    const members: ProgressMember[] = (detail?.members ?? []).map((member) => ({
      phase: member.phase,
      sessionId: member.sessionId,
      roleId: member.roleId,
      label: member.label,
      activity: member.activity,
      lastInputStatus: member.lastInputStatus,
      reportMissing: member.reportMissing === true,
      latestVerdict: latestVerdict.get(member.sessionId) ?? null,
    }));
    return taskProgress({ task, members });
  }

  /** The Task whose authorization input was this run: the stored fact, not a time-window guess. */
  private async taskOfInput(projectId: string, inputId: string): Promise<string | null> {
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const listed = (await this.options.control.call('task.list', {
        projectId,
        limit: 200,
        ...(cursor === null ? {} : { cursor }),
      })) as { tasks: readonly RpcTask[]; nextCursor: string | null };
      const match = listed.tasks.find((task) => task.sourceInputId === inputId);
      if (match !== undefined) return match.taskId;
      if (listed.nextCursor === null) return null;
      cursor = listed.nextCursor;
    }
    return null;
  }

  private statusOfInput(inputStatus: string, task: RpcTask | null, waitingUser: boolean): RunStatus {
    if (waitingUser) return 'waiting_user';
    if (inputStatus === 'failed') return 'failed';
    if (inputStatus === 'stopped') return 'cancelled';
    if (inputStatus === 'interrupted') return 'unknown';
    if (inputStatus === 'queued') return 'queued';
    if (inputStatus === 'processing') {
      if (task?.status === 'paused' || task?.status === 'pausing') return 'paused';
      return 'running';
    }
    // The input finished. The run is over only when the Task it authorized is over: an active Task
    // left open means the chief stopped its turn and needs something, not that the work completed.
    if (task === null) return 'completed';
    if (task.status === 'completed') return 'completed';
    if (task.status === 'cancelled') return 'cancelled';
    if (task.status === 'paused' || task.status === 'pausing') return 'paused';
    return 'waiting_user';
  }

  private summaryOf(input: RpcInput, task: RpcTask | null, blocked: { code: string; detail: string } | null): string {
    if (input.error !== null) return `${input.error.code}: ${input.error.message}`;
    if (input.status === 'interrupted') {
      return 'outcome unknown: the process that ran it is gone; verify the real state in the workbench before continuing';
    }
    if (task !== null) {
      const parts = [`${task.type} Task ${task.taskId} · ${task.phase} · ${task.status}`];
      if (task.summary !== '') parts.push(task.summary);
      if (task.nextStep !== null) parts.push(`next: ${task.nextStep}`);
      if (task.blockReason !== null) parts.push(`blocked: ${task.blockReason}`);
      if (blocked !== null) parts.push(`cannot run: ${blocked.code} ${blocked.detail}`);
      return parts.join(' · ');
    }
    if (input.status === 'queued') {
      return blocked === null
        ? 'queued: the session still has unfinished work; it runs when that work ends'
        : `queued but cannot start: ${blocked.code} ${blocked.detail}`;
    }
    return `input ${input.status}`;
  }

  // ---- tools -------------------------------------------------------------------------------

  async delegate(args: Record<string, unknown>): Promise<RunPayload> {
    const project = await this.projectFor(optionalText(args['project_path'], 'project_path'));
    const session = (await this.options.control.call('session.open', {
      projectId: project.projectId,
      channel: RUN_CHANNEL,
    })) as { session: { sessionId: string } };
    const submitted = (await this.options.control.call('session.input.submit', {
      projectId: project.projectId,
      sessionId: session.session.sessionId,
      content: [{ type: 'text', text: this.delegationText(args, project.realPath) }],
    })) as { inputId: string; status: string };
    const runId = formatRunId(project.projectId, submitted.inputId);
    const seconds = integer(args['wait_seconds'], 'wait_seconds', 0, 45, 20);
    if (seconds === 0) return this.statusOf(runId);
    return this.waitUntil(runId, seconds * 1000, undefined);
  }

  async status(args: Record<string, unknown>): Promise<RunPayload> {
    return this.statusOf(text(args['run_id'], 'run_id'));
  }

  async wait(args: Record<string, unknown>, onProgress?: (message: string) => void): Promise<RunPayload> {
    const runId = text(args['run_id'], 'run_id');
    const seconds = integer(args['seconds'], 'seconds', 0, 45, 25);
    const current = await this.statusOf(runId);
    if (current.complete || seconds === 0) return current;
    return this.waitUntil(runId, seconds * 1000, onProgress);
  }

  /** Poll until something changes, the run finishes, or the slice ends; never an error at the end. */
  private async waitUntil(
    runId: string,
    limitMs: number,
    onProgress: ((message: string) => void) | undefined,
  ): Promise<RunPayload> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = this.options.now ?? (() => Date.now());
    const deadline = now() + Math.min(limitMs, this.options.maximumWaitMs ?? 45_000);
    const previous = await this.statusOf(runId);
    const signature = (payload: RunPayload): string =>
      JSON.stringify([
        payload.status,
        payload.phase,
        payload.stepsDone,
        payload.stepsTotal,
        payload.pendingQuestion?.id ?? null,
        payload.taskId,
      ]);
    let last = signature(previous);
    while (now() < deadline) {
      await sleep(1000);
      const next = await this.statusOf(runId);
      if (next.complete) return next;
      const current = signature(next);
      if (current !== last) {
        last = current;
        onProgress?.(`${next.status} · ${next.phase ?? 'no phase'} · ${next.stepsDone}/${next.stepsTotal} steps`);
        return next;
      }
      if (now() >= deadline) return next;
    }
    return this.statusOf(runId);
  }

  /** A follow-up instruction for the Task this run is coordinating (R1: submit with the taskId). */
  async tell(args: Record<string, unknown>): Promise<RunPayload> {
    const runId = text(args['run_id'], 'run_id');
    const message = text(args['message'], 'message');
    const current = await this.statusOf(runId);
    if (current.taskId === null) {
      throw new ControlError('INVALID_ARGUMENT', 'this run has no Task yet; delegate first or wait for the chief to create one');
    }
    const { projectId } = parseRunId(runId);
    const sessionId = await this.sessionOfRun(projectId, runId);
    await this.options.control.call('session.input.submit', {
      projectId,
      sessionId,
      taskId: current.taskId,
      content: [{ type: 'text', text: message }],
    });
    return this.statusOf(runId);
  }

  async answer(args: Record<string, unknown>): Promise<RunPayload> {
    const runId = text(args['run_id'], 'run_id');
    const questionId = text(args['question_id'], 'question_id');
    const { projectId } = parseRunId(runId);
    const sessionId = await this.sessionOfRun(projectId, runId);
    const listed = (await this.options.control.call('interaction.list', { projectId, sessionId })) as {
      interactions: readonly RpcInteraction[];
    };
    const question = listed.interactions.find((entry) => entry.interactionId === questionId);
    if (question === undefined) {
      throw new ControlError('INTERACTION_STALE', `question ${questionId} is no longer waiting for an answer`);
    }
    const answer = args['answer'];
    if (question.method === 'confirm') {
      if (typeof answer !== 'boolean') {
        throw new ControlError('INVALID_ARGUMENT', 'this question needs a boolean answer (true = yes)');
      }
    } else if (typeof answer !== 'string' && (typeof answer !== 'object' || answer === null)) {
      throw new ControlError('INVALID_ARGUMENT', 'answer must be the chosen text (or the chosen option)');
    }
    await this.options.control.call('interaction.respond', {
      projectId,
      chiefSessionId: sessionId,
      interactionId: questionId,
      expectedRevision: question.revision,
      response: answer,
    });
    return this.statusOf(runId);
  }

  async cancel(args: Record<string, unknown>): Promise<RunPayload> {
    const runId = text(args['run_id'], 'run_id');
    const { projectId, inputId } = parseRunId(runId);
    const read = (await this.options.control.call('session.input.get', { projectId, inputId })) as {
      sessionId: string;
      taskId: string | null;
      input: RpcInput;
    };
    if (!TERMINAL_INPUT.has(read.input.status)) {
      await this.options.control.call('session.input.stop', { projectId, sessionId: read.sessionId, inputId });
    }
    const current = await this.statusOf(runId);
    if (current.taskId !== null) {
      const details = (await this.options.control.call('task.get', { projectId, taskId: current.taskId })) as {
        task: { revision: number; status: string };
      };
      // Every non-terminal status is cancellable (active, waiting, paused, pausing, cancelling):
      // a paused Task keeps the session's only slot, so refusing to cancel it would strand the run.
      if (details.task.status !== 'completed' && details.task.status !== 'cancelled') {
        await this.options.control.call('task.control', {
          projectId,
          taskId: current.taskId,
          expectedRevision: details.task.revision,
          command: 'cancel',
        });
      }
    }
    return this.statusOf(runId);
  }

  async read(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const runId = text(args['run_id'], 'run_id');
    const kind = text(args['kind'], 'kind');
    const { projectId } = parseRunId(runId);
    const status = await this.statusOf(runId);
    const sessionId = await this.sessionOfRun(projectId, runId);
    if (kind === 'report') {
      if (status.taskId === null) throw new ControlError('REPORT_MISSING', 'this run has no Task, so there is no report');
      const detail = (await this.options.control.call('task.get', { projectId, taskId: status.taskId })) as {
        results: readonly { resultId: string; kind: string; verdict: string | null; summary: string; createdAt: string }[];
      };
      const latest = [...detail.results].sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))[0];
      if (latest === undefined) throw new ControlError('REPORT_MISSING', 'no report has been submitted for this Task yet');
      const report = (await this.options.control.call('task.report.get', {
        projectId,
        taskId: status.taskId,
        resultId: latest.resultId,
      })) as Record<string, unknown>;
      return { kind, ...report, verdict: latest.verdict, summary: latest.summary };
    }
    if (kind === 'plan') {
      if (status.taskId === null) throw new ControlError('NOT_FOUND', 'this run has no Task, so there is no Plan');
      const detail = (await this.options.control.call('task.get', {
        projectId,
        taskId: status.taskId,
        includePlan: true,
      })) as { plan: { markdown: string; current: boolean } | null };
      if (detail.plan === null) throw new ControlError('REPORT_MISSING', 'this Task has no saved Plan');
      return { kind, markdown: detail.plan.markdown, current: detail.plan.current };
    }
    if (kind === 'transcript') {
      const limit = integer(args['limit'], 'limit', 1, 100, 20);
      const page = (await this.options.control.call('session.messages.list', {
        projectId,
        sessionId,
        limit,
      })) as { messages?: readonly { inputId?: string | null }[] };
      // The session is fixed and shared (X-02), so the tail also holds other callers' turns. A run
      // reads its own; entries that predate the run's association are reported as the unfiltered tail.
      const inputId = parseRunId(runId).inputId;
      const entries = page.messages ?? [];
      const own = entries.filter((entry) => entry.inputId === inputId);
      if (own.length === 0) {
        // Older entries may predate the run association; other callers' turns may not.
        if (entries.every((entry) => entry.inputId === null || entry.inputId === undefined)) {
          return page as Record<string, unknown>;
        }
        return { ...page, messages: [], filteredByInput: inputId } as Record<string, unknown>;
      }
      return { ...page, messages: own, filteredByInput: inputId } as Record<string, unknown>;
    }
    if (kind === 'files') {
      const path = optionalText(args['path'], 'path');
      return (await this.options.control.call('project.files.list', {
        projectId,
        ...(path === undefined ? {} : { path }),
      })) as Record<string, unknown>;
    }
    throw new ControlError('INVALID_ARGUMENT', 'kind must be one of report, plan, transcript, files');
  }

  async runs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const projectPath = optionalText(args['project_path'], 'project_path');
    const project = await this.projectFor(projectPath);
    const limit = integer(args['limit'], 'limit', 1, 50, 10);
    const listed = (await this.options.control.call('task.list', { projectId: project.projectId, limit })) as {
      tasks: readonly RpcTask[];
      nextCursor: string | null;
    };
    return {
      projectId: project.projectId,
      runs: listed.tasks.map((task) => ({
        runId: task.sourceInputId === null ? null : formatRunId(project.projectId, task.sourceInputId),
        taskId: task.taskId,
        goal: task.goal,
        type: task.type,
        phase: task.phase,
        status: task.status,
        updatedAt: task.updatedAt,
      })),
      nextCursor: listed.nextCursor,
    };
  }

  async projects(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.options.control.call('project.list', {
      limit: integer(args['limit'], 'limit', 1, 200, 50),
      ...(optionalText(args['cursor'], 'cursor') === undefined ? {} : { cursor: optionalText(args['cursor'], 'cursor') }),
    }) as Promise<Record<string, unknown>>;
  }

  async requirements(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const project = await this.projectFor(optionalText(args['project_path'], 'project_path'));
    const requirementId = optionalText(args['requirement_id'], 'requirement_id');
    if (requirementId !== undefined) {
      return this.options.control.call('requirement.get', {
        projectId: project.projectId,
        requirementId,
      }) as Promise<Record<string, unknown>>;
    }
    return this.options.control.call('requirement.list', {
      projectId: project.projectId,
      limit: integer(args['limit'], 'limit', 1, 200, 50),
      ...(optionalText(args['kind'], 'kind') === undefined ? {} : { kind: optionalText(args['kind'], 'kind') }),
      ...(optionalText(args['status'], 'status') === undefined ? {} : { status: optionalText(args['status'], 'status') }),
      ...(optionalText(args['cursor'], 'cursor') === undefined ? {} : { cursor: optionalText(args['cursor'], 'cursor') }),
    }) as Promise<Record<string, unknown>>;
  }

  /** The session a run belongs to: the channel's fixed session, resolved through the input row. */
  private async sessionOfRun(projectId: string, runId: string): Promise<string> {
    const { inputId } = parseRunId(runId);
    const read = (await this.options.control.call('session.input.get', { projectId, inputId })) as {
      sessionId: string;
    };
    return read.sessionId;
  }
}
