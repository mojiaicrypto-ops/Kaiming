/**
 * Dispatch mechanics (P3-d): one step of a Task gets its professional members, and the call returns
 * when the whole step has settled (or the wait expired).
 *
 * The model no longer chooses a mode: an entry with `roleId` creates a member, an entry with
 * `sessionId` continues a settled member, and a call without entries only waits. Identity, phase
 * eligibility and the report kind each member must deliver are fixed by the host; the model supplies
 * the work, not the routing.
 */
import { randomUUID } from 'node:crypto';
import { RESULT_KINDS, StoreError, type ResultKind, type Store, type TaskPhase, type TaskRow, type TaskSessionRow } from '../store/store.ts';
import { asRecord, fail, messageOf, ok, readString, readStringArray, type ToolOutcome } from './tool-kit.ts';
import type { TaskToolContext } from './task-tools.ts';

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

export interface DispatchContext extends TaskToolContext {
  readonly host: DelegationHost;
}

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

interface PlannedMember {
  readonly kind: 'create';
  readonly member: Parameters<Store['createTaskSessions']>[0]['members'][number];
}

interface PlannedContinuation {
  readonly kind: 'continue';
  readonly sessionId: string;
  readonly instructions: string;
  readonly refs: readonly string[];
  readonly dependencies: readonly string[];
  readonly inputId: string;
}

/**
 * Accept the entries (all validated first, then one transaction) and wait for the whole step. An empty
 * entry list is a pure wait: it never adds work.
 */
export async function dispatchOp(
  context: DispatchContext,
  taskId: string,
  params: Record<string, unknown>,
): Promise<ToolOutcome> {
  const task = context.store.getTask(taskId);
  if (task === undefined || task.projectId !== context.projectId) {
    return fail('NOT_FOUND', `Task ${taskId} is not in this project`);
  }
  if (task.chiefSessionId !== context.sessionId) {
    return fail('FORBIDDEN', `Task ${taskId} is coordinated by another session`);
  }
  const waitMs = clampWait(params['waitTimeoutMs']);
  const entries = Array.isArray(params['sessions']) ? params['sessions'] : [];
  if (entries.length === 0) {
    const returned = await context.host.settleStep(taskId, waitMs);
    return ok(describe(returned), returned as unknown as Record<string, unknown>);
  }

  const created: PlannedMember[] = [];
  const continued: PlannedContinuation[] = [];
  for (const entry of entries) {
    const request = asRecord(entry);
    if (request === undefined) {
      return fail('INVALID_ARGUMENT', 'each sessions entry must be an object');
    }
    const roleId = readString(request, 'roleId');
    const sessionId = readString(request, 'sessionId');
    if ((roleId === undefined) === (sessionId === undefined)) {
      return fail('INVALID_ARGUMENT', 'each sessions entry needs exactly one of roleId or sessionId');
    }
    if (roleId !== undefined) {
      const invalid = checkMember(request, task);
      if (invalid !== undefined) {
        return invalid;
      }
      created.push({
        kind: 'create',
        member: {
          sessionId: `s-${randomUUID().slice(0, 8)}`,
          taskId,
          roleId,
          ...(readString(request, 'specialization') !== undefined
            ? { specialization: readString(request, 'specialization') as string }
            : {}),
          phase: task.phase,
          label: readString(request, 'label') as string,
          instructions: readString(request, 'instructions') as string,
          refs: readStringArray(request, 'refs') ?? [],
          dependencies: readStringArray(request, 'dependsOnResultIds') ?? [],
          expectedKind: readString(request, 'expectedKind') as string,
          writeScope: readStringArray(request, 'writeScope') ?? [],
          ...(readString(request, 'workspaceRef') !== undefined
            ? { workspaceRef: readString(request, 'workspaceRef') as string }
            : {}),
          inputId: `i-${randomUUID().slice(0, 8)}`,
          inputPayload: {
            content: [{ type: 'text', text: readString(request, 'instructions') as string }],
          },
        },
      });
      continue;
    }
    const instructions = readString(request, 'instructions');
    if (instructions === undefined || instructions.trim() === '') {
      return fail('INVALID_ARGUMENT', 'a continuation needs instructions');
    }
    const member = context.store.getTaskSession(sessionId as string);
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
      return fail('STAGE_NOT_READY', 'that member has not settled yet; wait instead of continuing', { state: live });
    }
    if (live === 'interrupted') {
      return fail('RECOVERY_REQUIRED', 'that member was interrupted; verify its work before continuing', {
        inputId: member.currentInputId,
      });
    }
    continued.push({
      kind: 'continue',
      sessionId: sessionId as string,
      instructions,
      refs: readStringArray(request, 'refs') ?? [],
      dependencies: readStringArray(request, 'dependsOnResultIds') ?? [],
      inputId: `i-${randomUUID().slice(0, 8)}`,
    });
  }

  const touched = [
    ...created.map((entry) => entry.member.sessionId),
    ...continued.map((entry) => entry.sessionId),
  ];
  try {
    context.store.createTaskSessions({
      taskId,
      members: created.map((entry) => entry.member),
      continuations: continued.map((entry) => ({
        sessionId: entry.sessionId,
        instructions: entry.instructions,
        refs: entry.refs,
        dependencies: entry.dependencies,
        inputId: entry.inputId,
      })),
    });
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORAGE_UNAVAILABLE';
    return fail(code, messageOf(error), { taskId });
  }
  const returned = await runAndWait(context, taskId, touched, waitMs);
  return ok(describe(returned), {
    ...returned,
    members: touched
      .map((sessionId) => context.store.getTaskSession(sessionId))
      .filter((member): member is TaskSessionRow => member !== undefined)
      .map(summaryOf),
  } as Record<string, unknown>);
}

/** Dispatch the members that still have queued work, then wait for the whole step. */
async function runAndWait(
  context: DispatchContext,
  taskId: string,
  sessionIds: readonly string[],
  waitMs: number,
): Promise<DelegationReturn> {
  // Dispatching a member means "run it in its own session". That takes as long as the member takes,
  // so the runs are started without being awaited: the wait below owns the deadline and returns a
  // snapshot when it expires. A rejected run is a member outcome, never a lost dispatch.
  const started = sessionIds.map(async (sessionId) => {
    const member = context.store.getTaskSession(sessionId);
    if (member === undefined || memberInputState(context.store, member) !== 'queued') {
      return;
    }
    try {
      await context.host.dispatch(sessionId);
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

function checkMember(request: Record<string, unknown>, task: TaskRow): ToolOutcome | undefined {
  const roleId = readString(request, 'roleId');
  const label = readString(request, 'label');
  const instructions = readString(request, 'instructions');
  const expectedKind = readString(request, 'expectedKind');
  if (roleId === undefined || label === undefined || instructions === undefined || expectedKind === undefined) {
    return fail('INVALID_ARGUMENT', 'roleId, label, instructions and expectedKind are required');
  }
  // The expected kind IS the report kind the member must deliver: reject an invented one now
  // (with the legal values) instead of wedging the member at agent_report time.
  if (!RESULT_KINDS.includes(expectedKind as ResultKind)) {
    return fail('INVALID_ARGUMENT', `expectedKind must be one of ${RESULT_KINDS.join(', ')}`, { expectedKind });
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
    const allowed = Object.entries(ROLE_PHASE)
      .filter(([, phases]) => phases.includes(task.phase))
      .map(([role]) => role);
    return fail(
      'STAGE_NOT_READY',
      `role ${roleId} is not dispatched in phase ${task.phase}; phase ${task.phase} dispatches ${allowed.join(', ') || 'no role'}`,
      { phase: task.phase, allowed, hint: 'design documents belong to designer in a design step, code to developer in develop' },
    );
  }
  if (task.type === 'read' && expectedKind !== 'investigation' && expectedKind !== 'recovery') {
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
    writeScope: member.writeScope,
    currentInputId: member.currentInputId,
  };
}

function describe(returned: DelegationReturn): string {
  const parts = returned.sessions.map((member) => `${member.sessionId}:${member.state}`);
  return `${returned.taskId} ${returned.outcome} (${parts.join(', ')})`;
}
