/**
 * The Task tool: one entry point for the whole Task lifecycle.
 *
 * The host fixes identity: the session, its project, the input currently running and the work
 * directories all come from the caller's context, resolved *at execution time* (a Pi session is reused
 * across inputs, so a snapshot would attribute the work to the wrong input). The model passes what it
 * knows — goal, work, members — and never a version, digest or candidate id: one chief session owns
 * the Task and its tool calls are executed one at a time, so there is no second writer to guard
 * against.
 */
import { randomUUID } from 'node:crypto';
import { type ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  StoreError,
  OPEN_TASK_STATUSES,
  WORK_KINDS,
  type ArtifactRef,
  type Store,
  type TaskPhase,
  type TaskRow,
  type WorkKind,
} from '../store/store.ts';
import { commitPlan, digestOfText, planRefFor, planTarget, readPlan } from '../runtime/plan-store.ts';
import { readReportBody } from '../runtime/report-store.ts';
import { acceptanceChanged, acceptanceGap, scopeCheckFor, scopeCheckText } from '../runtime/plan-contract.ts';
import { readBacklog } from '../runtime/backlog-store.ts';
import { resolveAuthorizationRefs } from '../runtime/authorization.ts';
import { dispatchOp, type DelegationHost } from './delegation-tools.ts';
import { asRecord, enrich, fail, messageOf, ok, readString, readStringArray, type ToolOutcome } from './tool-kit.ts';
import { dispatchRefusalFacts, guidanceFor } from './guidance.ts';
import { designCompletionGaps } from '../runtime/design-completion.ts';
import { deliveryCommitGaps } from './completion-git.ts';

export interface TaskToolContext {
  readonly store: Store;
  readonly sessionId: string;
  readonly projectId: string;
  readonly cwd: string;
  readonly roleId: string;
  /** The input this session is running right now; resolved per tool call, not per session instance. */
  readonly inputId: string;
  /** Host work area for read Tasks (`work/<taskId>/plan.md`). */
  readonly serverWorkDir: string;
  /** Host control hook: stops the Task's own work before the final status is written. */
  readonly controlTask?: (params: {
    taskId: string;
    command: 'pause' | 'resume' | 'cancel';
  }) => Promise<TaskRow>;
  /** Chief only: run and wait for the current step's members. */
  readonly host?: DelegationHost;
  /**
   * Called after an op that changed the Task (or its members): the host pushes the change to the
   * browser instead of letting the UI poll for it. Never called for a refusal.
   */
  readonly onTaskChange?: (taskId: string) => void;
  readonly currentTaskId?: string;
}

/** Reads the live context: identity must reflect the current input and the current Task. */
export type TaskToolContextResolver = () => TaskToolContext;

/**
 * A domain tool needs no Pi call context: the host fixes identity through the resolver. Keeping that
 * seam explicit lets the tools be called directly in tests and adapted to Pi in one place.
 */
export interface DomainTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(toolCallId: string, params: unknown): Promise<ToolOutcome>;
}

/** One adapter, so every domain tool reaches Pi with the same wiring. */
export function asToolDefinitions(tools: readonly DomainTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    // Tool-level sequential execution is a contract requirement: one tool call at a time per message.
    executionMode: 'sequential',
    async execute(toolCallId, params) {
      const outcome = await tool.execute(toolCallId, params);
      // Pi's result carries text and images in one array; a tool's own outcome keeps them apart so a
      // text-only tool (and every test over it) never has to think about images.
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        ...outcome.content,
      ];
      for (const image of outcome.images ?? []) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
      }
      return { content, details: outcome.details, isError: outcome.isError };
    },
  }));
}

const PHASES: readonly TaskPhase[] = ['clarify', 'analyze', 'design', 'plan', 'develop', 'review', 'test', 'settle'];

const CHIEF_OPS = ['create', 'update', 'dispatch', 'control', 'end', 'get', 'adopt', 'recover'] as const;
const SPECIALIST_OPS = ['get'] as const;

function taskSummaryJson(task: TaskRow): Record<string, unknown> {
  return {
    taskId: task.id,
    type: task.type,
    workKind: task.workKind,
    flowVersion: task.flowVersion,
    reworkCount: task.reworkCount,
    phase: task.phase,
    status: task.status,
    requiresTest: task.requiresTest,
    goal: task.goal,
    scope: task.scope,
    acceptanceRefs: task.acceptanceRefs,
    basisRefs: task.basisRefs,
    planRef: task.planRef,
    requirementId: task.requirementId,
    backlogIds: task.backlogIds,
    currentSessionIds: task.currentSessionIds,
    summary: task.summary,
    nextStep: task.nextStep,
    blockReason: task.blockReason,
    completionResultId: task.completionResultId,
  };
}

/** Loads the Task only when it belongs to this session's project; foreign ids are simply not found. */
function loadOwnedTask(
  context: TaskToolContext,
  taskId: string,
): { readonly task: TaskRow } | { readonly refusal: ToolOutcome } {
  const task = context.store.getTask(taskId);
  if (task === undefined || task.projectId !== context.projectId) {
    return { refusal: fail('NOT_FOUND', `Task ${taskId} is not in this project`) };
  }
  return { task };
}

/** The chief's tool: every operation. A specialist gets the same tool with only `get` (G1). */
export function createTaskTool(contextOf: TaskToolContextResolver, options: { readonly chief: boolean }): DomainTool {
  const ops = options.chief ? CHIEF_OPS : SPECIALIST_OPS;
  return {
    name: 'task',
    label: 'task',
    description: options.chief
      ? [
          'Create and run one Task: create, update (phase/summary/plan), dispatch (start or continue the current step professional Sessions, then wait), control (pause/resume/cancel), end, get, adopt, recover.',
          'No version or digest is passed: the host records what it observed.',
          'The overall Plan is yours; each member decides its internal plan. Wait for the whole step before judging it.',
          'A dispatch timeout is a status snapshot, not a stop. If members are still running, call dispatch again with no sessions in the same turn; do not end the turn with a status update.',
        ].join('\n')
      : 'Read the Task you belong to (op=get): goal, scope, plan, this step members and their reports.',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: [...ops] },
        taskId: { type: 'string', description: 'the Task to act on; defaults to the session current Task' },
        // create
        type: { type: 'string', enum: ['read', 'write'] },
        workKind: {
          type: 'string',
          enum: [...WORK_KINDS],
          description: 'completion chain: design/implement/document (write) or investigate (read)',
        },
        goal: { type: 'string' },
        scope: { type: 'string' },
        planMarkdown: { type: 'string' },
        acceptanceRefs: { type: 'array', items: { type: 'string' } },
        basisRefs: { type: 'array', items: { type: 'string' } },
        authorizationRef: {
          type: 'object',
          properties: { inputId: { type: 'string' }, interactionId: { type: 'string' } },
          additionalProperties: false,
        },
        requiresTest: { type: 'boolean' },

        backlogIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'backlog items this Task implements (0..n); each may belong to only one open Task',
        },
        // update
        phase: { type: 'string', enum: [...PHASES] },
        summary: { type: 'string' },
        nextStep: { type: 'string' },
        blockReason: { type: 'string' },
        status: { type: 'string', enum: ['active', 'waiting'] },
        changes: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            scope: { type: 'string' },
            acceptanceRefs: { type: 'array', items: { type: 'string' } },
            basisRefs: { type: 'array', items: { type: 'string' } },
            planMarkdown: { type: 'string' },
            requiresTest: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        // dispatch
        sessions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              roleId: { type: 'string', description: 'create a new professional Session with this role' },
              sessionId: { type: 'string', description: 'continue a settled member of the current step' },
              specialization: { type: 'string' },
              label: { type: 'string' },
              instructions: { type: 'string' },
              refs: { type: 'array', items: { type: 'string' } },
              dependsOnResultIds: { type: 'array', items: { type: 'string' } },
              expectedKind: { type: 'string' },
              writeScope: {
                type: 'array',
                items: { type: 'string' },
                description: 'project-relative paths or globs this member writes; overlapping scopes are reported',
              },
              workspaceRef: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        waitTimeoutMs: { type: 'number' },
        // control / end / get / adopt / recover
        command: { type: 'string', enum: ['pause', 'resume', 'cancel'] },
        completionResultId: { type: 'string' },
        includeResultBodies: { type: 'boolean' },
        chiefSessionId: { type: 'string', description: 'adopt: the chief session that takes the Task over' },
        sessionId: {
          type: 'string',
          description: 'recover: the member session whose interrupted input is being closed',
        },
        evidenceRefs: { type: 'array', items: { type: 'string' } },
        resolution: { type: 'string', enum: ['completed', 'failed', 'stopped'] },
      },
      required: ['op'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      const op = readString(params, 'op');
      if (op === undefined || !(ops as readonly string[]).includes(op)) {
        return fail('INVALID_ARGUMENT', `op must be one of ${ops.join(', ')}`, { op: op ?? null });
      }
      const session = context.store.getSession(context.sessionId);
      const currentTaskId = session?.currentTaskId ?? context.currentTaskId;
      const taskId = readString(params, 'taskId') ?? (op === 'create' ? undefined : currentTaskId);
      const outcome = await runOp(op, taskId, context, params, options.chief);
      // A change the user can see must be announced once, not polled for: every op that writes the
      // Task (or its members) publishes an invalidate, a read or a refusal does not.
      if (!outcome.isError && MUTATING_OPS.has(op) && context.onTaskChange !== undefined) {
        const changed = outcome.details['taskId'];
        const changedId = typeof changed === 'string' ? changed : taskId;
        if (changedId !== undefined) context.onTaskChange(changedId);
      }
      return outcome;
    },
  };
}

/** One op, after the tool has resolved identity: split out so the announce step has one place. */
async function runOp(
  op: string,
  taskId: string | undefined,
  context: TaskToolContext,
  params: Record<string, unknown>,
  chief: boolean,
): Promise<ToolOutcome> {
      const currentTaskId = context.store.getSession(context.sessionId)?.currentTaskId ?? context.currentTaskId;
      if (op === 'create') {
        return createOp(context, params);
      }
      if (taskId === undefined) {
        return fail('NOT_FOUND', 'this session has no current Task yet', {
          nextActions: [
            {
              action: 'task(op=create, type=..., goal=..., scope=..., planMarkdown=..., authorizationRef=...)',
              op: 'create',
              reason: 'a Task is created first; every other op needs one',
            },
          ],
        });
      }
      // A specialist may read its own Task only; the chief may act on Tasks of its own project.
      if (!chief && taskId !== currentTaskId) {
        return fail('NOT_FOUND', `Task ${taskId} is not this session's Task`);
      }
      const owned = loadOwnedTask(context, taskId);
      if ('refusal' in owned) {
        return owned.refusal;
      }
      const task = owned.task;
      // Every op except get changes the Task, and only its owning chief may do that.
      if (op !== 'get' && task.chiefSessionId !== context.sessionId) {
        return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
      }
      switch (op) {
        case 'update':
          return updateOp(context, task, params);
        case 'dispatch':
          if (context.host === undefined) {
            return fail('FORBIDDEN', 'only a chief session dispatches members');
          }
          return dispatchOp({ ...context, host: context.host }, taskId, params);
        case 'control':
          return controlOp(context, task, params);
        case 'end':
          return endOp(context, task, params);
        case 'adopt':
          return adoptOp(context, task, params);
        case 'recover':
          return recoverOp(context, task, params);
        default:
          return getOp(context, task, params, chief);
      }
}

/** Ops that write the Task or its membership: the ones a browser view must be told about. */
const MUTATING_OPS: ReadonlySet<string> = new Set(['create', 'update', 'dispatch', 'control', 'end', 'adopt', 'recover']);

/** Specialists may only read their own Task (G1). */
export function createTaskGetTool(contextOf: TaskToolContextResolver): DomainTool {
  return createTaskTool(contextOf, { chief: false });
}

function createOp(context: TaskToolContext, params: Record<string, unknown>): Promise<ToolOutcome> | ToolOutcome {
  const type = readString(params, 'type');
  if (type !== 'read' && type !== 'write') {
    return fail('INVALID_ARGUMENT', 'type must be read or write');
  }
  const rawKind = readString(params, 'workKind');
  if (rawKind !== undefined && !(WORK_KINDS as readonly string[]).includes(rawKind)) {
    return fail('INVALID_ARGUMENT', `workKind must be one of ${WORK_KINDS.join(', ')}`, { workKind: rawKind });
  }
  if (type === 'write' && rawKind === undefined) {
    return fail('INVALID_ARGUMENT', 'a write Task needs workKind (design, implement or document)', {
      missing: 'workKind',
      example: 'workKind: "implement"',
    });
  }
  const workKind: WorkKind = (rawKind as WorkKind | undefined) ?? 'investigate';
  if (type === 'read' && workKind !== 'investigate') {
    return fail('INVALID_ARGUMENT', 'a read Task must use workKind=investigate', { workKind });
  }
  if (type === 'write' && workKind === 'investigate') {
    return fail('INVALID_ARGUMENT', 'workKind=investigate is only for read Tasks', { workKind });
  }
  const goal = readString(params, 'goal');
  const scope = readString(params, 'scope');
  const planMarkdown = readString(params, 'planMarkdown');
  if (
    goal === undefined ||
    goal.trim() === '' ||
    scope === undefined ||
    scope.trim() === '' ||
    planMarkdown === undefined ||
    planMarkdown.trim() === ''
  ) {
    return fail('INVALID_ARGUMENT', 'goal, scope and planMarkdown are required non-empty strings');
  }
  if (type === 'write') {
    const gap = acceptanceGap(planMarkdown);
    if (gap !== undefined) {
      return fail('INVALID_ARGUMENT', `${gap}; add it before the Task is created`, {
        missing: 'acceptance',
        example: '## 验收\n- 登录页按钮文案为“进入”，点击行为不变。',
      });
    }
  }
  // The cited decision must be a real one in this project; only its identity/state is verified.
  // A chief creating a Task is running a user's own message, so that message is the decision: it is
  // the only input this run has, and making the model echo an id it was never given would only
  // invite a guess. A delegated instruction is not a user input, so a member cannot stand in.
  const authorization = resolveAuthorizationRefs(
    context.store,
    context.projectId,
    params['authorizationRef'] ?? { inputId: context.inputId },
  );
  if (!authorization.ok) {
    return fail('INVALID_ARGUMENT', `authorizationRef: ${authorization.message}`);
  }
  const rawTest = params['requiresTest'];
  if (rawTest !== undefined && typeof rawTest !== 'boolean') {
    return fail('INVALID_ARGUMENT', 'requiresTest must be a boolean when given');
  }
  if (workKind === 'implement' && typeof rawTest !== 'boolean') {
    return fail(
      'INVALID_ARGUMENT',
      'an implement Task must state requiresTest (true for behaviour code, false for visual work)',
    );
  }
  if (workKind !== 'implement' && rawTest === true) {
    return fail('INVALID_ARGUMENT', `a ${workKind} Task cannot declare requiresTest=true`);
  }
  const requiresTest = workKind === 'implement' ? (rawTest as boolean) : false;
  const acceptanceRefs = readStringArray(params, 'acceptanceRefs') ?? [];
  const basisRefs = readStringArray(params, 'basisRefs') ?? [];

  const backlogIds = readStringArray(params, 'backlogIds') ?? [];
  if (backlogIds.length > 0) {
    if (type === 'read') {
      return fail('INVALID_ARGUMENT', 'a read Task cannot implement backlog items; leave backlogIds empty');
    }
    const read = readBacklog(context.cwd);
    for (const id of backlogIds) {
      const item = read.items.find((entry) => entry.id === id);
      const problems = read.issues.filter((issue) => issue.id === id);
      if (item === undefined) {
        if (problems.length > 0) {
          return fail('INVALID_ARGUMENT', `backlog item ${id} has a format problem`, {
            backlogId: id,
            issues: problems,
          });
        }
        return fail('NOT_FOUND', `backlog item ${id} does not exist`, { backlogId: id });
      }
      if (problems.length > 0) {
        return fail('INVALID_ARGUMENT', `backlog item ${id} has a format problem`, {
          backlogId: id,
          issues: problems,
        });
      }
      if (item.state !== 'open') {
        return fail('INVALID_ARGUMENT', `backlog item ${id} is ${item.state}; only open items can be implemented`, {
          backlogId: id,
          state: item.state,
        });
      }
      for (const producerId of item.taskIds) {
        const producer = context.store.getTask(producerId);
        if (
          producer !== undefined &&
          OPEN_TASK_STATUSES.includes(producer.status) &&
          producer.workKind === 'design'
        ) {
          return fail(
            'DESIGN_NOT_READY',
            `backlog item ${id} is still produced by an unfinished design Task; confirm and settle the design first`,
            { backlogId: id, designTaskId: producer.id, designStatus: producer.status },
          );
        }
      }
    }
  }
  const taskId = `t-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const target = planTarget({ taskId, type, projectCwd: context.cwd, serverWorkDir: context.serverWorkDir });
  const intendedPlan = planRefFor(target, planMarkdown);
  try {
    // Task row first: a refused create must not leave a plan file or a save receipt behind.
    const task = context.store.createTask({
      id: taskId,
      projectId: context.projectId,
      chiefSessionId: context.sessionId,
      ownerEpoch: context.store.epoch,

      ...(backlogIds.length > 0 ? { backlogIds } : {}),
      type,
      workKind,
      flowVersion: 1,
      initialPhase: workKind === 'design' ? 'design' : 'plan',
      requiresTest,
      goal,
      scope,
      acceptanceRefs,
      basisRefs,
      planRef: intendedPlan,
      authorizationRefs: authorization.refs,
      sourceInputId: context.inputId,
      summary: `created (${workKind})`,
    });

    let planState = 'saved';
    try {
      commitPlan({
        store: context.store,
        requestKey: `${context.inputId}:plan:${taskId}`,
        target,
        markdown: planMarkdown,
      });
    } catch (error) {
      // The Task exists and points at the intended version; the file still has to be written.
      planState = 'pending';
      return ok(
        `Task ${task.id} created but its Plan file is not saved yet (${messageOf(error)}); retry with the same plan`,
        {
          taskId: task.id,
          workKind: task.workKind,
          phase: task.phase,
          currentSessionIds: task.currentSessionIds,
          planRef: task.planRef,
          planState,
          scopeCheck: scopeCheckFor(context.cwd, planMarkdown),
        },
      );
    }
    return ok(`Task ${task.id} created (${workKind}, requiresTest=${task.requiresTest}); plan at ${target.path}`, {
      taskId: task.id,
      workKind: task.workKind,
      phase: task.phase,
      currentSessionIds: task.currentSessionIds,
      planRef: task.planRef,
      planState,
      scopeCheck: scopeCheckFor(context.cwd, planMarkdown),
      ...guidanceFor(context.store, task),
    });
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
    return fail(code, messageOf(error), { taskId });
  }
}

function updateOp(context: TaskToolContext, existing: TaskRow, params: Record<string, unknown>): ToolOutcome {
  const taskId = existing.id;
  const phase = readString(params, 'phase');
  if (phase !== undefined && !PHASES.includes(phase as TaskPhase)) {
    return fail('INVALID_ARGUMENT', `unknown phase ${phase}`);
  }
  const status = readString(params, 'status');
  if (status !== undefined && status !== 'active' && status !== 'waiting') {
    return fail('INVALID_ARGUMENT', 'status must be active or waiting');
  }
  const changes = asRecord(params['changes']);
  const planMarkdown = changes === undefined ? undefined : readString(changes, 'planMarkdown');
  let planRef: ArtifactRef | undefined;
  let planState = 'unchanged';
  let acceptanceChangedFlag: boolean | undefined;
  if (planMarkdown !== undefined && existing.type === 'write') {
    const gap = acceptanceGap(planMarkdown);
    if (gap !== undefined) {
      return fail('INVALID_ARGUMENT', `${gap}; a revised Plan keeps the acceptance section`, {
        missing: 'acceptance',
      });
    }
  }
  if (planMarkdown !== undefined) {
    // The chief is the only writer of the Plan, but a person can edit the file. Never overwrite a
    // version nobody saw: compare the file with what the Task recorded and with what is being written.
    const recorded = existing.planRef?.sha256;
    const onDisk = existing.planRef === null ? undefined : readPlan(existing.planRef);
    const diskDigest = onDisk !== undefined && onDisk.text !== '' ? digestOfText(onDisk.text) : recorded;
    const requested = digestOfText(planMarkdown);
    if (diskDigest !== undefined && diskDigest !== recorded && diskDigest !== requested) {
      return fail('VERSION_CONFLICT', 'the Plan file changed since it was recorded; read it before revising', {
        currentText: onDisk?.text ?? null,
      });
    }
    acceptanceChangedFlag = acceptanceChanged(onDisk?.text ?? '', planMarkdown);
    const target = planTarget({
      taskId,
      type: existing.type,
      projectCwd: context.cwd,
      serverWorkDir: context.serverWorkDir,
    });
    planRef = planRefFor(target, planMarkdown);
  }
  try {
    const task = context.store.updateTask({
      taskId,
      ...(phase !== undefined ? { phase: phase as TaskPhase } : {}),
      ...(readString(params, 'summary') !== undefined ? { summary: readString(params, 'summary') as string } : {}),
      ...(readString(params, 'nextStep') !== undefined ? { nextStep: readString(params, 'nextStep') as string } : {}),
      ...(readString(params, 'blockReason') !== undefined
        ? { blockReason: readString(params, 'blockReason') as string }
        : {}),
      ...(status !== undefined ? { status: status as 'active' | 'waiting' } : {}),
      ...(planRef !== undefined ? { planRef } : {}),
      ...(changes !== undefined && readString(changes, 'goal') !== undefined
        ? { goal: readString(changes, 'goal') as string }
        : {}),
      ...(changes !== undefined && readString(changes, 'scope') !== undefined
        ? { scope: readString(changes, 'scope') as string }
        : {}),
      ...(changes !== undefined && readStringArray(changes, 'acceptanceRefs') !== undefined
        ? { acceptanceRefs: readStringArray(changes, 'acceptanceRefs') as string[] }
        : {}),
      ...(changes !== undefined && readStringArray(changes, 'basisRefs') !== undefined
        ? { basisRefs: readStringArray(changes, 'basisRefs') as string[] }
        : {}),
      ...(changes !== undefined && typeof changes['requiresTest'] === 'boolean'
        ? { requiresTest: changes['requiresTest'] as boolean }
        : {}),
    });
    if (planMarkdown !== undefined) {
      try {
        commitPlan({
          store: context.store,
          requestKey: `${context.inputId}:plan:${taskId}`,
          target: planTarget({
            taskId,
            type: task.type,
            projectCwd: context.cwd,
            serverWorkDir: context.serverWorkDir,
          }),
          markdown: planMarkdown,
        });
        planState = 'saved';
      } catch (error) {
        planState = 'pending';
        return ok(
          `Task ${task.id} updated to ${task.phase} but its Plan file is not saved yet (${messageOf(error)})`,
          {
            taskId: task.id,
            phase: task.phase,
            currentSessionIds: task.currentSessionIds,
            planRef: task.planRef,
            planState,
            ...(acceptanceChangedFlag === true ? { acceptanceChanged: true } : {}),
          },
        );
      }
    }
    const guidance = guidanceFor(context.store, task);
    return ok(
      `Task ${task.id} updated: phase=${task.phase}${
        acceptanceChangedFlag === true
          ? '; acceptance changed — if this exceeds the original authorization, ask the user (D-08); completed Review/Test do not cover the new acceptance'
          : ''
      }`,
      {
        taskId: task.id,
        phase: task.phase,
        status: task.status,
        currentSessionIds: task.currentSessionIds,
        planRef: task.planRef,
        planState,
        ...(acceptanceChangedFlag === true ? { acceptanceChanged: true } : {}),
        scopeCheck: scopeCheckFor(
          context.cwd,
          planMarkdown ?? (task.planRef === null ? '' : readPlan(task.planRef).text),
        ),
        ...guidance,
      },
    );
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
    // A refused phase change names the members still holding the step, so the caller can act on it.
    const refusal = fail(code, messageOf(error), {
      taskId,
      ...(error instanceof StoreError ? error.details : {}),
    });
    const current = context.store.getTask(taskId);
    return current === undefined ? refusal : enrich(refusal, dispatchRefusalFacts(context.store, current));
  }
}

async function controlOp(context: TaskToolContext, task: TaskRow, params: Record<string, unknown>): Promise<ToolOutcome> {
  const command = readString(params, 'command');
  if (command !== 'pause' && command !== 'resume' && command !== 'cancel') {
    return fail('INVALID_ARGUMENT', 'control needs command (pause/resume/cancel)');
  }
  try {
    // Control is a host operation: the Task can only reach its final status after its own work has
    // actually stopped, which the host knows.
    const updated =
      context.controlTask === undefined
        ? context.store.controlTask({ taskId: task.id, command })
        : await context.controlTask({ taskId: task.id, command });
    return ok(`Task ${task.id} is now ${updated.status}`, {
      taskId: task.id,
      status: updated.status,
      currentSessionIds: updated.currentSessionIds,
      ...guidanceFor(context.store, updated),
    });
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
    return fail(code, messageOf(error), {
      taskId: task.id,
      ...(error instanceof StoreError ? error.details : {}),
    });
  }
}

function endOp(context: TaskToolContext, task: TaskRow, params: Record<string, unknown>): ToolOutcome {
  const completionResultId = readString(params, 'completionResultId');
  if (completionResultId === undefined) {
    return fail('INVALID_ARGUMENT', 'end needs completionResultId (the settlement, investigation or recovery report)');
  }
  try {
    // The commit is the model's action, so the host only observes it - and asks the store for the
    // rest of the gaps so one refusal lists everything. Nothing is closed on this path.
    const uncommitted = deliveryCommitGaps(context.store, task);
    const designGaps = designCompletionGaps(context.store, context.cwd, task);
    if (uncommitted.length > 0 || designGaps.length > 0) {
      const gaps = [...context.store.taskCompletionGaps(task.id, completionResultId), ...designGaps, ...uncommitted];
      return fail('COMPLETION_INCOMPLETE', `the Task is not complete yet; missing: ${gaps.join('; ')}`, {
        gaps,
        nextActions: guidanceFor(context.store, task).nextActions,
      });
    }
    const result = context.store.endTask({ taskId: task.id, completionResultId });
    if (!result.ok) {
      return fail('COMPLETION_INCOMPLETE', `the Task is not complete yet; missing: ${result.gaps.join('; ')}`, {
        gaps: result.gaps,
        nextActions: guidanceFor(context.store, task).nextActions,
      });
    }
    return ok(`Task ${task.id} completed`, { taskId: task.id, status: result.task.status, nextActions: [] });
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
    return fail(code, messageOf(error), {
      taskId: task.id,
      ...(error instanceof StoreError ? error.details : {}),
    });
  }
}

function adoptOp(context: TaskToolContext, task: TaskRow, params: Record<string, unknown>): ToolOutcome {
  const chiefSessionId = readString(params, 'chiefSessionId');
  if (chiefSessionId === undefined) {
    return fail('INVALID_ARGUMENT', 'adopt needs chiefSessionId');
  }
  try {
    const adopted = context.store.adoptTask({ taskId: task.id, chiefSessionId });
    return ok(`Task ${task.id} now belongs to ${adopted.chiefSessionId}`, {
      taskId: task.id,
      chiefSessionId: adopted.chiefSessionId,
      status: adopted.status,
      ...guidanceFor(context.store, adopted),
    });
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
    return fail(code, messageOf(error), { taskId: task.id });
  }
}

/**
 * recover (recovery contract): close a KNOWN interrupted input with real verification.
 *
 * Without this the interrupted member input blocks its step forever: claim refuses the session
 * (RECOVERY_REQUIRED) and the chief has no path to the recovery service. It never starts a model or
 * replays work: the interrupted input of the named member is located, the evidence must belong to
 * this Task, and only then is the verdict recorded.
 */
function recoverOp(context: TaskToolContext, task: TaskRow, params: Record<string, unknown>): ToolOutcome {
  const sessionId = readString(params, 'sessionId');
  const resolution = readString(params, 'resolution');
  const evidenceRefs = readStringArray(params, 'evidenceRefs');
  if (sessionId === undefined || evidenceRefs === undefined) {
    return fail('INVALID_ARGUMENT', 'recover needs sessionId and evidenceRefs');
  }
  if (resolution !== 'completed' && resolution !== 'failed' && resolution !== 'stopped') {
    return fail('INVALID_ARGUMENT', 'resolution must be completed, failed or stopped');
  }
  const member = context.store.getTaskSession(sessionId);
  if (member === undefined || member.taskId !== task.id) {
    return fail('NOT_FOUND', `session ${sessionId} is not a member of Task ${task.id}`, { sessionId });
  }
  if (member.currentInputId === null) {
    return fail('NOT_FOUND', `session ${sessionId} has no input to recover`, { sessionId });
  }
  const inputId = member.currentInputId;
  const taskResults = new Set(context.store.listTaskResults(task.id).map((result) => result.resultId));
  const foreign = evidenceRefs.filter((ref) => !taskResults.has(ref) && !ref.startsWith('file:'));
  if (foreign.length > 0) {
    return fail('INVALID_ARGUMENT', "evidenceRefs must cite this Task's results or file: references", {
      unknown: foreign,
      knownResults: [...taskResults],
    });
  }
  const input = context.store.getInput(inputId);
  if (input === undefined) {
    return fail('NOT_FOUND', `input ${inputId} does not exist`, { inputId });
  }
  if (input.status !== 'interrupted') {
    return fail('INVALID_ARGUMENT', `input ${inputId} is ${input.status}, not interrupted`, { inputId });
  }
  try {
    const resolved = context.store.resolveInterruptedInput({
      sessionId,
      inputId,
      expectedRevision: input.revision,
      resolution,
      evidenceRefs,
      resolvedBy: `${context.sessionId}:recover`,
    });
    return ok(`Input ${resolved.inputId} closed as ${resolved.status}; the step can continue.`, {
      inputId: resolved.inputId,
      status: resolved.status,
      taskId: task.id,
      ...guidanceFor(context.store, task),
    });
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
    return fail(code, messageOf(error), { inputId });
  }
}

function getOp(
  context: TaskToolContext,
  task: TaskRow,
  params: Record<string, unknown>,
  chief: boolean,
): ToolOutcome {
  const plan = task.planRef === null ? { text: '', current: false } : readPlan(task.planRef);
  const withBodies = params['includeResultBodies'] === true;
  const results = context.store.listTaskResults(task.id).map((result) => ({
    resultId: result.resultId,
    kind: result.kind,
    verdict: result.verdict,
    summary: result.summary,
    sessionId: result.sessionId,
    delivery: result.deliveryState === null ? null : { digest: result.deliveryState.digest, files: result.deliveryState.paths.length },
    bodyRef: result.bodyRef,
    checks: result.checks,
    ...(withBodies ? { body: readReportBody(result.bodyRef).text } : {}),
  }));
  const members = context.store.listTaskSessions(task.id).map((member) => {
    const input = member.currentInputId === null ? undefined : context.store.getInput(member.currentInputId);
    const reportIds =
      member.currentInputId === null ? [] : context.store.resultsForInputs([member.currentInputId]).map((result) => result.resultId);
    return {
      sessionId: member.sessionId,
      roleId: member.roleId,
      label: member.label,
      phase: member.phase,
      expectedKind: member.expectedKind,
      writeScope: member.writeScope,
      currentInputId: member.currentInputId,
      inputState: input?.status ?? null,
      errorCode: input?.errorCode ?? null,
      reportMissing:
        reportIds.length === 0 &&
        (input?.status === 'completed' || input?.status === 'failed' || input?.status === 'stopped'),
    };
  });
  const backlogHints: string[] = [];
  if (task.backlogIds.length > 0) {
    const backlog = readBacklog(context.cwd);
    for (const id of task.backlogIds) {
      const item = backlog.items.find((entry) => entry.id === id);
      if (item === undefined) {
        backlogHints.push(`关联的待办不存在：${id}`);
      } else if (backlog.issues.some((issue) => issue.id === id)) {
        backlogHints.push(`关联的待办需要修复：${id}`);
      }
    }
  }
  return ok(`Task ${task.id}: ${task.phase} (${task.status})`, {
    task: taskSummaryJson(task),
    planText: plan.text,
    planCurrent: plan.current,
    scopeCheck: scopeCheckFor(context.cwd, plan.text),
    scopeCheckText: scopeCheckText(scopeCheckFor(context.cwd, plan.text)),
    ...(backlogHints.length > 0 ? { backlogHints } : {}),
    members,
    results,
    missing: task.planRef !== null && !plan.current ? ['plan file is missing or changed'] : [],
    // A Task that is not running holds project writes: say so here instead of letting the model find
    // out from a tool that is simply not there.
    ...(task.status === 'paused' || task.status === 'pausing' || task.status === 'cancelling'
      ? {
          context: {
            writeHold: 'paused',
            note: 'The Task is not running: project writes (write/edit/bash/backlog/project) are withheld here until it is resumed; reading, talking and Task control still work.',
          },
        }
      : {}),
    ...guidanceFor(context.store, task, { chief }),
  });
}
