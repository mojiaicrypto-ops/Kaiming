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
import { resolveAuthorizationRefs } from '../runtime/authorization.ts';
import { asRecord, fail, messageOf, ok, readString, readStringArray, type ToolOutcome } from './tool-kit.ts';

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
    expectedRevision: number;
    command: 'pause' | 'resume' | 'cancel';
  }) => Promise<TaskRow>;
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
  return [createTaskTool(contextOf), updateTaskTool(contextOf), reconcileTaskTool(contextOf), endTaskTool(contextOf), taskGetTool(contextOf)];
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
        authorizationRef: {
          type: 'object',
          properties: { inputId: { type: 'string' }, interactionId: { type: 'string' } },
          additionalProperties: false,
        },
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
      // The cited decision must be a real one in this project; only its identity/state is verified.
      const authorization = resolveAuthorizationRefs(context.store, context.projectId, params['authorizationRef']);
      if (!authorization.ok) {
        return fail('INVALID_ARGUMENT', `authorizationRef: ${authorization.message}`);
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
          authorizationRefs: authorization.refs,
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

/**
 * task.reconcile (recovery contract): close a KNOWN interrupted input with real verification.
 *
 * Without this tool an interrupted member input blocks its step forever: claim refuses the
 * session (RECOVERY_REQUIRED), updateTask reports STAGE_NOT_READY, and the chief has no path
 * to the recovery service that already exists on the host (R1 session.recovery.resolve) — so
 * the Task, its chief and the user's queue wait indefinitely. The contract (agents-and-tools
 * `reconcile`) defines exactly this call; it was simply never implemented.
 *
 * It never starts a model or replays work: it records the verdict on the original input after
 * checking ownership, membership and that the evidence really belongs to this Task.
 */
function reconcileTaskTool(contextOf: TaskToolContextResolver): DomainTool {
  return {
    name: 'reconcile',
    label: 'reconcile',
    description:
      'Close a known interrupted input of this Task after real verification: cite the evidence (report/result ids) and the conclusion. Does not restart the run.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        sessionId: { type: 'string' },
        inputId: { type: 'string' },
        expectedInputRevision: { type: 'number' },
        evidenceRefs: { type: 'array', items: { type: 'string' } },
        resolution: { type: 'string', enum: ['completed', 'failed', 'stopped'] },
      },
      required: ['taskId', 'sessionId', 'inputId', 'evidenceRefs', 'resolution'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) return fail('INVALID_ARGUMENT', 'params must be an object');
      const taskId = readString(params, 'taskId');
      const sessionId = readString(params, 'sessionId');
      const inputId = readString(params, 'inputId');
      const resolution = readString(params, 'resolution');
      const evidenceRefs = readStringArray(params, 'evidenceRefs');
      const expectedInputRevision = params['expectedInputRevision'];
      if (taskId === undefined || sessionId === undefined || inputId === undefined || evidenceRefs === undefined) {
        return fail('INVALID_ARGUMENT', 'taskId, sessionId, inputId and evidenceRefs are required');
      }
      if (resolution !== 'completed' && resolution !== 'failed' && resolution !== 'stopped') {
        return fail('INVALID_ARGUMENT', 'resolution must be completed, failed or stopped');
      }
      const owned = loadOwnedTask(context, taskId);
      if ('refusal' in owned) return owned.refusal;
      if (owned.task.chiefSessionId !== context.sessionId) {
        return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
      }
      const member = context.store.getTaskSession(sessionId);
      if (member === undefined || member.taskId !== taskId) {
        return fail('NOT_FOUND', `session ${sessionId} is not a member of Task ${taskId}`, { sessionId, taskId });
      }
      // Evidence must be real: cited results of THIS Task (or explicit file refs the host can see).
      const taskResults = new Set(context.store.listTaskResults(taskId).map((result) => result.resultId));
      const foreign = evidenceRefs.filter((ref) => !taskResults.has(ref) && !ref.startsWith('file:'));
      if (foreign.length > 0) {
        return fail('INVALID_ARGUMENT', 'evidenceRefs must cite this Task\'s results or file: references', {
          unknown: foreign,
          knownResults: [...taskResults],
        });
      }
      const input = context.store.getInput(inputId);
      if (input === undefined || input.sessionId !== sessionId) {
        return fail('NOT_FOUND', `input ${inputId} is not in session ${sessionId}`, { inputId });
      }
      if (input.status !== 'interrupted') {
        return fail('INVALID_ARGUMENT', `input ${inputId} is ${input.status}, not interrupted`, { inputId });
      }
      const revision =
        typeof expectedInputRevision === 'number' ? expectedInputRevision : input.revision;
      try {
        const resolved = context.store.resolveInterruptedInput({
          sessionId,
          inputId,
          expectedRevision: revision,
          resolution,
          evidenceRefs,
          resolvedBy: `${context.sessionId}:reconcile`,
        });
        return ok(
          `Input ${resolved.inputId} closed as ${resolved.status}; the step can continue.`,
          { inputId: resolved.inputId, status: resolved.status, taskId },
        );
      } catch (error) {
        return fail(messageOf(error), 'the interrupted input was not closed', {
          inputId,
          hint: 're-read the input revision (task.get) and cite evidence from this Task',
        });
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
    description:
      'Read the current Task (op=get), freeze a candidate version (op=prepare_candidate) or control it (op=control).',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['get', 'prepare_candidate', 'control'] },
        taskId: { type: 'string' },
        includeResultBodies: { type: 'boolean' },
        expectedRevision: { type: 'number' },
        candidate: { type: 'object' },
        command: { type: 'string', enum: ['pause', 'resume', 'cancel'] },
      },
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams) ?? {};
      const op = readString(params, 'op') ?? 'get';
      if (op !== 'get' && context.roleId !== 'chief') {
        return fail('FORBIDDEN', 'only the coordinating session may control a Task or freeze a candidate');
      }
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

      if (op === 'control') {
        if (task.chiefSessionId !== context.sessionId) {
          return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
        }
        const command = readString(params, 'command');
        const expectedRevision = params['expectedRevision'];
        if (
          (command !== 'pause' && command !== 'resume' && command !== 'cancel') ||
          typeof expectedRevision !== 'number'
        ) {
          return fail('INVALID_ARGUMENT', 'control needs command (pause/resume/cancel) and expectedRevision');
        }
        try {
          // Control is a host operation: the Task can only reach its final status after its own
          // work has actually stopped, which the host knows.
          const updated =
            context.controlTask === undefined
              ? context.store.controlTask({ taskId, expectedRevision, command })
              : await context.controlTask({ taskId, expectedRevision, command });
          return ok(`Task ${taskId} is now ${updated.status}`, {
            taskId,
            status: updated.status,
            revision: updated.revision,
            currentSessionIds: updated.currentSessionIds,
          });
        } catch (error) {
          const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
          return fail(code, messageOf(error), { taskId });
        }
      }

      if (op === 'prepare_candidate') {
        if (task.chiefSessionId !== context.sessionId) {
          return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
        }
        const expectedRevision = params['expectedRevision'];
        const candidate = params['candidate'];
        if (typeof expectedRevision !== 'number' || typeof candidate !== 'object' || candidate === null) {
          return fail('INVALID_ARGUMENT', 'prepare_candidate needs expectedRevision and candidate');
        }
        try {
          const updated = context.store.setCandidate({ taskId, expectedRevision, candidate });
          return ok(`Task ${taskId} candidate frozen`, {
            taskId,
            revision: updated.revision,
            candidate: updated.candidate,
          });
        } catch (error) {
          const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
          return fail(code, messageOf(error), { taskId });
        }
      }

      const plan = task.planRef === null ? { text: '', current: false } : readPlan(task.planRef);
      const results = context.store.listTaskResults(task.id).map((result) => ({
        resultId: result.resultId,
        kind: result.kind,
        verdict: result.verdict,
        candidateId: result.candidateId,
        summary: result.summary,
        sessionId: result.sessionId,
        supersedesResultId: result.supersedesResultId,
        // A result is no longer evidence once a later report superseded it (S6 keeps the history).
        supersededBy: context.store.supersededBy(result.resultId)?.resultId ?? null,
        bodyRef: result.bodyRef,
        checks: result.checks,
      }));
      return ok(`Task ${task.id}: ${task.phase} (${task.status}), revision ${task.revision}`, {
        task: taskSummaryJson(task),
        planText: plan.text,
        planCurrent: plan.current,
        results,
        missing: task.planRef !== null && !plan.current ? ['plan file is missing or changed'] : [],
      });
    },
  };
}
