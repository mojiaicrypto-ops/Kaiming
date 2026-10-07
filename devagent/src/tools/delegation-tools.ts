/**
 * Delegation tool (P3-d): `createTaskSessions` creates the current step's professional members,
 * waits for the whole step, and reports per-member facts (M1/M2).
 *
 * The host fixes identity and runs the work; the model only says which roles it needs, what each one
 * must achieve and what to read. Only the Task's chief session may delegate, only into the Task's
 * current phase, and a paused/cancelled Task only accepts a read-only recovery check.
 */
import { randomUUID } from 'node:crypto';
import { StoreError, type Store, type TaskPhase, type TaskRow, type TaskSessionRow } from '../store/store.ts';
import type { DomainTool, TaskToolContext } from './task-tools.ts';

export interface MemberState {
  readonly sessionId: string;
  readonly inputId: string;
  readonly state: 'queued' | 'working' | 'waiting_user' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'interrupted';
  readonly resultIds: readonly string[];
  readonly interactionIds: readonly string[];
  readonly error?: { readonly code: string; readonly message: string };
}

export interface DelegationReturn {
  readonly taskId: string;
  readonly outcome: 'completed' | 'blocked' | 'timeout';
  readonly sessions: readonly MemberState[];
}

export interface DelegationHost {
  /** Runs one member session's next input and resolves when that run settled. */
  dispatch(sessionId: string): Promise<void>;
  /** Waits for the Task's current step to settle (or the timeout) and snapshots its members. */
  settleStep(taskId: string, timeoutMs: number): Promise<DelegationReturn>;
}

export interface DelegationToolContext extends TaskToolContext {
  readonly host: DelegationHost;
}

export type DelegationContextResolver = () => DelegationToolContext;

const DEFAULT_WAIT_MS = 120_000;
const MIN_WAIT_MS = 1_000;
const MAX_WAIT_MS = 300_000;

/** Which phase each role may be dispatched in (G2: Review/Test/settler are step-specific). */
const ROLE_PHASE: Readonly<Record<string, readonly TaskPhase[]>> = {
  designer: ['clarify', 'analyze', 'design', 'plan'],
  developer: ['develop'],
  reviewer: ['review'],
  tester: ['test'],
  settler: ['settle'],
  investigator: ['clarify', 'analyze', 'design', 'plan'],
};

export function createTaskSessionsTool(contextOf: DelegationContextResolver): DomainTool {
  return {
    name: 'createTaskSessions',
    label: 'createTaskSessions',
    description:
      'Create (or continue/wait for) the current step professional Sessions of a Task, then wait for the whole step.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        mode: { type: 'string', enum: ['create', 'wait', 'continue'] },
        sessions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              roleId: { type: 'string' },
              specialization: { type: 'string' },
              label: { type: 'string' },
              instructions: { type: 'string' },
              refs: { type: 'array', items: { type: 'string' } },
              dependsOnResultIds: { type: 'array', items: { type: 'string' } },
              expectedKind: { type: 'string' },
              candidateId: { type: 'string' },
              workspaceRef: { type: 'string' },
            },
            required: ['roleId', 'label', 'instructions', 'expectedKind'],
            additionalProperties: false,
          },
        },
        sessionId: { type: 'string' },
        waitTimeoutMs: { type: 'number' },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      // The host already knows the Task of this session, so the model need not repeat it.
      const taskId = readString(params, 'taskId') ?? context.currentTaskId;
      if (taskId === undefined) {
        return fail('NOT_FOUND', 'this session has no current Task');
      }
      const task = context.store.getTask(taskId);
      if (task === undefined || task.projectId !== context.projectId) {
        return fail('NOT_FOUND', `Task ${taskId} is not in this project`);
      }
      if (task.chiefSessionId !== context.sessionId) {
        return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
      }
      const mode = readString(params, 'mode') ?? 'create';
      const waitMs = clampWait(params['waitTimeoutMs']);
      const taskType = task.type;

      if (mode === 'create') {
        const sessions = Array.isArray(params['sessions']) ? params['sessions'] : [];
        if (sessions.length === 0) {
          return fail('INVALID_ARGUMENT', 'create needs at least one session');
        }
        const members: Array<Parameters<Store['createTaskSessions']>[0]['members'][number]> = [];
        for (const entry of sessions) {
          const request = asRecord(entry);
          if (request === undefined) {
            return fail('INVALID_ARGUMENT', 'each session must be an object');
          }
          const invalid = checkMember(request, task, taskType);
          if (invalid !== undefined) {
            return invalid;
          }
          members.push({
            sessionId: `s-${randomUUID().slice(0, 8)}`,
            taskId,
            roleId: readString(request, 'roleId') as string,
            ...(readString(request, 'specialization') !== undefined
              ? { specialization: readString(request, 'specialization') as string }
              : {}),
            phase: task.phase,
            label: readString(request, 'label') as string,
            instructions: readString(request, 'instructions') as string,
            refs: readStringArray(request, 'refs') ?? [],
            dependencies: readStringArray(request, 'dependsOnResultIds') ?? [],
            expectedKind: readString(request, 'expectedKind') as string,
            ...(readString(request, 'candidateId') !== undefined
              ? { candidateId: readString(request, 'candidateId') as string }
              : {}),
            ...(readString(request, 'workspaceRef') !== undefined
              ? { workspaceRef: readString(request, 'workspaceRef') as string }
              : {}),
            inputId: `i-${randomUUID().slice(0, 8)}`,
            inputPayload: {
              content: [{ type: 'text', text: readString(request, 'instructions') as string }],
            },
          });
        }
        try {
          const created = context.store.createTaskSessions({ taskId, members });
          const returned = await runAndWait(context, taskId, created, waitMs);
          return ok(describe(returned), { ...returned, members: created.map(summaryOf) });
        } catch (error) {
          const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
          return fail(code, messageOf(error), { taskId });
        }
      }

      if (mode === 'continue') {
        const sessionId = readString(params, 'sessionId');
        const instructions = readString(params, 'instructions');
        if (sessionId === undefined || instructions === undefined) {
          return fail('INVALID_ARGUMENT', 'continue needs sessionId and instructions');
        }
        const member = context.store.getTaskSession(sessionId);
        if (member === undefined || member.taskId !== taskId) {
          return fail('NOT_FOUND', `session ${sessionId} is not a member of Task ${taskId}`);
        }
        if (member.phase !== task.phase) {
          return fail('STAGE_NOT_READY', 'that member belongs to an earlier step', {
            memberPhase: member.phase,
            taskPhase: task.phase,
          });
        }
        if (task.status !== 'active' && task.status !== 'waiting') {
          return fail('TASK_CONTROLLED', 'this Task is not running; resume it before continuing members', {
            status: task.status,
          });
        }
        const live = memberInputState(context.store, member);
        if (live === 'queued' || live === 'processing' || live === 'stopping') {
          return fail('STAGE_NOT_READY', 'that member has not settled yet; wait instead of continuing', {
            state: live,
          });
        }
        if (live === 'interrupted') {
          return fail('RECOVERY_REQUIRED', 'that member was interrupted; verify its work before continuing', {
            inputId: member.currentInputId,
          });
        }
        try {
          context.store.continueTaskSession({
            sessionId,
            instructions,
            refs: readStringArray(params, 'refs') ?? [],
            dependencies: Array.isArray(params['dependsOnResultIds'])
              ? (readStringArray(params, 'dependsOnResultIds') ?? [])
              : [],
            inputId: `i-${randomUUID().slice(0, 8)}`,
          });
          const member2 = context.store.getTaskSession(sessionId) as TaskSessionRow;
          const returned = await runAndWait(context, taskId, [member2], waitMs);
          return ok(describe(returned), { ...returned, members: [summaryOf(member2)] });
        } catch (error) {
          const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
          return fail(code, messageOf(error), { taskId });
        }
      }

      // wait: observe only, never add work.
      const returned = await context.host.settleStep(taskId, waitMs);
      return ok(describe(returned), returned);
    },
  };
}

/** Dispatch the members that still have queued work, then wait for the whole step. */
async function runAndWait(
  context: DelegationToolContext,
  taskId: string,
  members: readonly TaskSessionRow[],
  waitMs: number,
): Promise<DelegationReturn> {
  // Dispatching a member means "run it in its own session". That takes as long as the member takes,
  // so the runs are started without being awaited: the wait below owns the deadline and returns a
  // snapshot when it expires. A rejected run is a member outcome, never a lost dispatch.
  const started = members.map(async (member) => {
    if (memberInputState(context.store, member) !== 'queued') {
      return;
    }
    try {
      await context.host.dispatch(member.sessionId);
    } catch {
      // The member's own input carries the failure state; the aggregate reports it.
    }
  });
  void Promise.all(started);
  return context.host.settleStep(taskId, waitMs);
}

function memberInputState(
  store: Store,
  member: TaskSessionRow,
): 'queued' | 'processing' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'interrupted' | 'none' {
  if (member.currentInputId === null) {
    return 'none';
  }
  const input = store.getInput(member.currentInputId);
  return input === undefined ? 'none' : input.status;
}

function checkMember(
  request: Record<string, unknown>,
  task: TaskRow,
  taskType: 'read' | 'write',
) : ToolOutcome | undefined {
  const roleId = readString(request, 'roleId');
  const label = readString(request, 'label');
  const instructions = readString(request, 'instructions');
  const expectedKind = readString(request, 'expectedKind');
  if (roleId === undefined || label === undefined || instructions === undefined || expectedKind === undefined) {
    return fail('INVALID_ARGUMENT', 'roleId, label, instructions and expectedKind are required');
  }
  if (!(roleId in ROLE_PHASE)) {
    return fail('INVALID_ARGUMENT', `unknown roleId ${roleId}`);
  }
  if (task.status === 'cancelling' || task.status === 'cancelled') {
    // A cancelled Task accepts no new work at all, not even the recovery check.
    return fail('TASK_CONTROLLED', 'this Task was cancelled; it accepts no new work');
  }
  if (task.status === 'paused' || task.status === 'pausing') {
    // A Task that is not running accepts exactly one kind of work: the read-only recovery check.
    if (roleId !== 'investigator' || expectedKind !== 'recovery') {
      return fail('TASK_CONTROLLED', 'this Task is not running; only a read-only recovery check is allowed');
    }
    return undefined;
  }
  const phases = ROLE_PHASE[roleId] ?? [];
  if (phases.length > 0 && !phases.includes(task.phase)) {
    return fail('STAGE_NOT_READY', `role ${roleId} is not dispatched in phase ${task.phase}`);
  }
  if (taskType === 'read' && expectedKind !== 'investigation' && expectedKind !== 'recovery') {
    return fail('INVALID_ARGUMENT', 'a read Task only accepts investigation or recovery reports');
  }
  return undefined;
}

function clampWait(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_WAIT_MS;
  }
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.round(value)));
}

function summaryOf(member: TaskSessionRow): Record<string, unknown> {
  return {
    sessionId: member.sessionId,
    roleId: member.roleId,
    label: member.label,
    phase: member.phase,
    expectedKind: member.expectedKind,
    currentInputId: member.currentInputId,
  };
}

function describe(returned: DelegationReturn): string {
  const parts = returned.sessions.map((member) => `${member.sessionId}:${member.state}`);
  return `${returned.taskId} ${returned.outcome} (${parts.join(', ')})`;
}

interface ToolOutcome {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly details: Record<string, unknown>;
  readonly isError: boolean;
}

function ok(text: string, details: object): ToolOutcome {
  return { content: [{ type: 'text', text }], details: { ...details }, isError: false };
}

function fail(code: string, text: string, details: object = {}): ToolOutcome {
  return {
    content: [{ type: 'text', text: `Error: ${text}` }],
    details: { code, ...details },
    isError: true,
  };
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}