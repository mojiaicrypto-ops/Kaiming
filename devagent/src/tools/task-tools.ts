/**
 * Chief Task tools (P3): createTask, updateTask, endTask and task(get).
 *
 * The host fixes identity: the session, its project, the input currently running and the work
 * directories all come from the caller's context, resolved *at execution time* (a Pi session is reused
 * across inputs, so a snapshot would attribute the work to the wrong input). Every persistent change is
 * version-checked, every tool checks that the Task really belongs to the calling session's project, and
 * a refusal states what is missing instead of pretending success.
 */
import { randomUUID } from 'node:crypto';
import { type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { StoreError, type ArtifactRef, type Store, type TaskPhase, type TaskRow } from '../store/store.ts';
import { commitPlan, digestOfText, planRefFor, planTarget, readPlan } from '../runtime/plan-store.ts';

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
      return tool.execute(toolCallId, params);
    },
  }));
}

const PHASES: readonly TaskPhase[] = [
  'clarify',
  'analyze',
  'design',
  'plan',
  'develop',
  'review',
  'test',
  'settle',
];

interface ToolOutcome {
  readonly content: Array<{ type: 'text'; text: string }>;
  readonly details: Record<string, unknown>;
  readonly isError: boolean;
}

function ok(text: string, details: Record<string, unknown>): ToolOutcome {
  return { content: [{ type: 'text', text }], details, isError: false };
}

function fail(code: string, text: string, details: Record<string, unknown> = {}): ToolOutcome {
  return { content: [{ type: 'text', text: `Error: ${text}` }], details: { code, ...details }, isError: true };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === 'string') ? (value as string[]) : undefined;
}

function taskSummaryJson(task: TaskRow): Record<string, unknown> {
  return {
    taskId: task.id,
    type: task.type,
    phase: task.phase,
    status: task.status,
    revision: task.revision,
    requiresTest: task.requiresTest,
    goal: task.goal,
    scope: task.scope,
    acceptanceRefs: task.acceptanceRefs,
    basisRefs: task.basisRefs,
    planRef: task.planRef,
    requirementId: task.requirementId,
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

export function createChiefTaskTools(contextOf: TaskToolContextResolver): DomainTool[] {
  return [createTaskTool(contextOf), updateTaskTool(contextOf), endTaskTool(contextOf), taskGetTool(contextOf)];
}

/** Specialists may only read their own Task (G1: `task.get`). */
export function createTaskGetTool(contextOf: TaskToolContextResolver): DomainTool {
  return taskGetTool(contextOf);
}

function createTaskTool(contextOf: TaskToolContextResolver): DomainTool {
  return {
    name: 'createTask',
    label: 'createTask',
    description:
      'Create one Task (type=read|write) with its overall Plan. write requires requiresTest (boolean); read forbids it.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['read', 'write'] },
        goal: { type: 'string' },
        scope: { type: 'string' },
        acceptanceRefs: { type: 'array', items: { type: 'string' } },
        basisRefs: { type: 'array', items: { type: 'string' } },
        planMarkdown: { type: 'string' },
        authorizationRef: { type: 'string' },
        requiresTest: { type: 'boolean' },
        requirementId: { type: 'string' },
      },
      required: ['type', 'goal', 'scope', 'planMarkdown', 'authorizationRef'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      const type = readString(params, 'type');
      if (type !== 'read' && type !== 'write') {
        return fail('INVALID_ARGUMENT', 'type must be read or write');
      }
      const goal = readString(params, 'goal');
      const scope = readString(params, 'scope');
      const planMarkdown = readString(params, 'planMarkdown');
      const authorizationRef = readString(params, 'authorizationRef');
      if (
        goal === undefined ||
        goal.trim() === '' ||
        scope === undefined ||
        scope.trim() === '' ||
        planMarkdown === undefined ||
        planMarkdown.trim() === '' ||
        authorizationRef === undefined ||
        authorizationRef.trim() === ''
      ) {
        return fail('INVALID_ARGUMENT', 'goal, scope, planMarkdown and authorizationRef are required non-empty strings');
      }
      const requiresTest = params['requiresTest'];
      if (type === 'read' && requiresTest !== undefined && requiresTest !== false) {
        return fail('INVALID_ARGUMENT', 'a read Task cannot declare requiresTest=true');
      }
      if (type === 'write' && typeof requiresTest !== 'boolean') {
        return fail(
          'INVALID_ARGUMENT',
          'a write Task must state requiresTest (true for behaviour code, false for lightweight/document work)',
        );
      }
      const acceptanceRefs = readStringArray(params, 'acceptanceRefs') ?? [];
      const basisRefs = readStringArray(params, 'basisRefs') ?? [];
      const requirementId = readString(params, 'requirementId');
      const taskId = `t-${randomUUID().slice(0, 8)}`;
      const target = planTarget({
        taskId,
        type,
        projectCwd: context.cwd,
        serverWorkDir: context.serverWorkDir,
      });
      const intendedPlan = planRefFor(target, planMarkdown);
      try {
        // Task row first: a refused create must not leave a plan file or a save receipt behind.
        const task = context.store.createTask({
          id: taskId,
          projectId: context.projectId,
          chiefSessionId: context.sessionId,
          ownerEpoch: context.store.epoch,
          ...(requirementId !== undefined ? { requirementId } : {}),
          type,
          requiresTest: type === 'write' ? (requiresTest as boolean) : false,
          goal,
          scope,
          acceptanceRefs,
          basisRefs,
          planRef: intendedPlan,
          authorizationRefs: [authorizationRef],
          sourceInputId: context.inputId,
          summary: `created (${type})`,
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
              revision: task.revision,
              phase: task.phase,
              currentSessionIds: task.currentSessionIds,
              planRef: task.planRef,
              planState,
            },
          );
        }
        return ok(`Task ${task.id} created (${type}, requiresTest=${task.requiresTest}); plan at ${target.path}`, {
          taskId: task.id,
          revision: task.revision,
          phase: task.phase,
          currentSessionIds: task.currentSessionIds,
          planRef: task.planRef,
          planState,
        });
      } catch (error) {
        const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
        return fail(code, messageOf(error), { taskId });
      }
    },
  };
}

function updateTaskTool(contextOf: TaskToolContextResolver): DomainTool {
  return {
    name: 'updateTask',
    label: 'updateTask',
    description:
      'Update the current Task: record the finished step summary and start the next phase, or revise goal/scope/plan.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        expectedRevision: { type: 'number' },
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
            expectedPlanVersion: { type: 'string' },
            requiresTest: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      required: ['taskId', 'expectedRevision'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      const taskId = readString(params, 'taskId');
      const expectedRevision = params['expectedRevision'];
      if (taskId === undefined || typeof expectedRevision !== 'number') {
        return fail('INVALID_ARGUMENT', 'taskId and expectedRevision are required');
      }
      const phase = readString(params, 'phase');
      if (phase !== undefined && !PHASES.includes(phase as TaskPhase)) {
        return fail('INVALID_ARGUMENT', `unknown phase ${phase}`);
      }
      const status = readString(params, 'status');
      if (status !== undefined && status !== 'active' && status !== 'waiting') {
        return fail('INVALID_ARGUMENT', 'status must be active or waiting');
      }
      const owned = loadOwnedTask(context, taskId);
      if ('refusal' in owned) {
        return owned.refusal;
      }
      const existing = owned.task;
      // Ownership and revision are checked *before* any file write: a losing writer must not touch
      // another writer's Plan (S6).
      if (existing.chiefSessionId !== context.sessionId) {
        return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
      }
      if (existing.revision !== expectedRevision) {
        return fail('VERSION_CONFLICT', 'Task revision does not match', {
          actual: existing.revision,
          expected: expectedRevision,
        });
      }
      const changes = asRecord(params['changes']);
      const planMarkdown = changes === undefined ? undefined : readString(changes, 'planMarkdown');
      let planRef: ArtifactRef | undefined;
      let planState = 'unchanged';
      if (planMarkdown !== undefined) {
        const expectedPlanVersion = readString(changes ?? {}, 'expectedPlanVersion');
        // The recorded version is the expected one unless the caller names another: protection must not
        // depend on the model opting in. Compare against the file when it is readable.
        const recordedVersion = existing.planRef?.sha256;
        const onDisk = existing.planRef === null ? undefined : readPlan(existing.planRef);
        const actualVersion =
          onDisk !== undefined && onDisk.text !== '' ? digestOfText(onDisk.text) : recordedVersion;
        const requestedVersion = digestOfText(planMarkdown);
        if (expectedPlanVersion !== undefined) {
          if (actualVersion !== undefined && actualVersion !== expectedPlanVersion) {
            return fail('VERSION_CONFLICT', `the Plan changed since ${expectedPlanVersion}`, {
              currentPlanVersion: actualVersion,
            });
          }
        } else if (
          actualVersion !== undefined &&
          actualVersion !== recordedVersion &&
          actualVersion !== requestedVersion
        ) {
          return fail('VERSION_CONFLICT', 'the Plan file on disk is neither the recorded nor the requested version', {
            recorded: recordedVersion ?? 'none',
            onDisk: actualVersion,
          });
        }
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
          expectedRevision,
          ...(phase !== undefined ? { phase: phase as TaskPhase } : {}),
          ...(readString(params, 'summary') !== undefined
            ? { summary: readString(params, 'summary') as string }
            : {}),
          ...(readString(params, 'nextStep') !== undefined
            ? { nextStep: readString(params, 'nextStep') as string }
            : {}),
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
              requestKey: `${context.inputId}:plan:${taskId}:r${expectedRevision}`,
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
              `Task ${task.id} updated to ${task.phase} (revision ${task.revision}) but its Plan file is not saved yet (${messageOf(error)})`,
              {
                taskId: task.id,
                revision: task.revision,
                phase: task.phase,
                currentSessionIds: task.currentSessionIds,
                planRef: task.planRef,
                planState,
              },
            );
          }
        }
        return ok(`Task ${task.id} updated: phase=${task.phase} revision=${task.revision}`, {
          taskId: task.id,
          revision: task.revision,
          phase: task.phase,
          currentSessionIds: task.currentSessionIds,
          planRef: task.planRef,
          planState,
        });
      } catch (error) {
        const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
        return fail(code, messageOf(error), { taskId });
      }
    },
  };
}

function endTaskTool(contextOf: TaskToolContextResolver): DomainTool {
  return {
    name: 'endTask',
    label: 'endTask',
    description: 'Finish the Task once every completion requirement is recorded.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        expectedRevision: { type: 'number' },
        completionResultId: { type: 'string' },
      },
      required: ['taskId', 'expectedRevision', 'completionResultId'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      const taskId = readString(params, 'taskId');
      const expectedRevision = params['expectedRevision'];
      const completionResultId = readString(params, 'completionResultId');
      if (taskId === undefined || typeof expectedRevision !== 'number' || completionResultId === undefined) {
        return fail('INVALID_ARGUMENT', 'taskId, expectedRevision and completionResultId are required');
      }
      const owned = loadOwnedTask(context, taskId);
      if ('refusal' in owned) {
        return owned.refusal;
      }
      if (owned.task.chiefSessionId !== context.sessionId) {
        return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
      }
      try {
        const result = context.store.endTask({ taskId, expectedRevision, completionResultId });
        if (!result.ok) {
          return fail('COMPLETION_INCOMPLETE', `the Task is not complete yet; missing: ${result.gaps.join('; ')}`, {
            gaps: result.gaps,
          });
        }
        return ok(`Task ${taskId} completed`, {
          taskId,
          status: result.task.status,
          revision: result.task.revision,
        });
      } catch (error) {
        const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
        return fail(code, messageOf(error), { taskId });
      }
    },
  };
}

function taskGetTool(contextOf: TaskToolContextResolver): DomainTool {
  return {
    name: 'task',
    label: 'task',
    description: 'Read the current Task (or a given taskId): fields, overall Plan text and open items.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams) ?? {};
      const session = context.store.getSession(context.sessionId);
      const currentTaskId = session?.currentTaskId ?? undefined;
      const taskId = readString(params, 'taskId') ?? currentTaskId;
      if (taskId === undefined) {
        return fail('NOT_FOUND', 'this session has no current Task');
      }
      // A specialist may read its own Task only; the chief may read Tasks of its own project.
      if (context.roleId !== 'chief' && taskId !== currentTaskId) {
        return fail('NOT_FOUND', `Task ${taskId} is not this session's Task`);
      }
      const owned = loadOwnedTask(context, taskId);
      if ('refusal' in owned) {
        return owned.refusal;
      }
      const task = owned.task;
      const plan = task.planRef === null ? { text: '', current: false } : readPlan(task.planRef);
      return ok(`Task ${task.id}: ${task.phase} (${task.status}), revision ${task.revision}`, {
        task: taskSummaryJson(task),
        planText: plan.text,
        planCurrent: plan.current,
        results: [],
        missing: task.planRef !== null && !plan.current ? ['plan file is missing or changed'] : [],
      });
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}