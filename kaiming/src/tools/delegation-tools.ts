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
import { asRecord, enrich, fail, messageOf, ok, readString, readStringArray, type ToolOutcome } from './tool-kit.ts';
import { ROLE_PHASE, dispatchRefusalFacts, guidanceFor } from './guidance.ts';
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

/** Roles that write project files in a write Task and therefore declare a writeScope. */
const WRITING_ROLES = new Set(['designer', 'developer', 'settler']);

/** The report kind a role delivers; G2 marks expectedKind optional, so the host derives it. */
const EXPECTED_KIND_BY_ROLE: Readonly<Record<string, ResultKind>> = {
  designer: 'design',
  developer: 'implementation',
  reviewer: 'review',
  tester: 'test',
  settler: 'settlement',
  investigator: 'investigation',
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
  if (params['sessions'] !== undefined && !Array.isArray(params['sessions'])) {
    return fail('INVALID_ARGUMENT', 'sessions must be a list of entries (omit it to only wait)');
  }
  const entries = Array.isArray(params['sessions']) ? params['sessions'] : [];
  if (entries.length === 0) {
    const returned = await context.host.settleStep(taskId, waitMs);
    const current = context.store.getTask(taskId) ?? task;
    return ok(describe(returned), {
      ...returned,
      ...timeoutHint(returned),
      ...guidanceFor(context.store, current),
    } as Record<string, unknown>);
  }

  const created: PlannedMember[] = [];
  const continued: PlannedContinuation[] = [];
  // Set for a new tester or a tester's continuation: both re-run the same pre-gate.
  let wantsTest = false;
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
        // Name what the step really holds now, so a refused dispatch is actionable.
        return enrich(invalid, dispatchRefusalFacts(context.store, task));
      }
      // The gate must see the kind the member will really deliver, not only an explicit field.
      wantsTest = wantsTest || (readString(request, 'expectedKind') ?? EXPECTED_KIND_BY_ROLE[roleId]) === 'test';
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
          label: readString(request, 'label') ?? roleId,
          instructions: readString(request, 'instructions') as string,
          refs: readStringArray(request, 'refs') ?? [],
          dependencies: readStringArray(request, 'dependsOnResultIds') ?? [],
          expectedKind: readString(request, 'expectedKind') ?? EXPECTED_KIND_BY_ROLE[roleId] ?? '',
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
      return enrich(
        fail('STAGE_NOT_READY', 'that member belongs to an earlier step', {
          memberPhase: member.phase,
          taskPhase: task.phase,
        }),
        dispatchRefusalFacts(context.store, task),
      );
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
    wantsTest = wantsTest || member.expectedKind === 'test';
    continued.push({
      kind: 'continue',
      sessionId: sessionId as string,
      instructions,
      refs: readStringArray(request, 'refs') ?? [],
      dependencies: readStringArray(request, 'dependsOnResultIds') ?? [],
      inputId: `i-${randomUUID().slice(0, 8)}`,
    });
  }

  // A Test only makes sense after an independent review of this delivery has passed and settled (G2).
  if (wantsTest) {
    const refusal = testDispatchRefusal(context, taskId);
    if (refusal !== undefined) {
      return enrich(refusal, dispatchRefusalFacts(context.store, task));
    }
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
  const warnings = overlapWarnings(
    touched
      .map((sessionId) => context.store.getTaskSession(sessionId))
      .filter((member): member is TaskSessionRow => member !== undefined),
  );
  const returned = await runAndWait(context, taskId, touched, waitMs);
  const current = context.store.getTask(taskId) ?? task;
  return ok(`${describe(returned)}${warnings.length > 0 ? ` | warning: ${warnings.join('; ')}` : ''}`, {
    ...returned,
    ...timeoutHint(returned),
    ...(warnings.length > 0 ? { warnings } : {}),
    members: touched
      .map((sessionId) => context.store.getTaskSession(sessionId))
      .filter((member): member is TaskSessionRow => member !== undefined)
      .map(summaryOf),
    ...guidanceFor(context.store, current),
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
  const instructions = readString(request, 'instructions');
  if (roleId === undefined || instructions === undefined || instructions.trim() === '') {
    return fail('INVALID_ARGUMENT', 'a new member needs roleId and instructions', {
      hint: 'label and expectedKind are optional; the host derives them from the role',
    });
  }
  // G2 marks both optional: the host fills them in, so a slip here cannot wedge the member.
  const expectedKind = readString(request, 'expectedKind') ?? EXPECTED_KIND_BY_ROLE[roleId];
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
  // Every member that writes into the project declares what it owns, so overlapping work is visible
  // before two writers touch the same file (G3/R-04).
  if (task.type === 'write' && WRITING_ROLES.has(roleId)) {
    const scope = readStringArray(request, 'writeScope') ?? [];
    if (scope.length === 0) {
      return fail('INVALID_ARGUMENT', `role ${roleId} must declare writeScope in a write Task`, {
        hint: 'project-relative paths or globs this member owns',
      });
    }
  }
  return undefined;
}

/**
 * The pre-gate for any Test work: a passed review must exist and the step it belongs to must have
 * settled. Both a new tester and a tester continuation run it.
 */
function testDispatchRefusal(context: DispatchContext, taskId: string): ToolOutcome | undefined {
  const passed = context.store
    .listTaskResults(taskId)
    .filter((result) => result.kind === 'review' && result.verdict === 'passed')
    .at(-1);
  if (passed === undefined) {
    return fail('STAGE_NOT_READY', 'dispatch the tester only after an independent review has passed', {
      hint: 'dispatch the reviewer in the review step first',
    });
  }
  const reviewMember = context.store.getTaskSession(passed.sessionId);
  const phase = reviewMember === undefined ? undefined : reviewMember.phase;
  const unsettled = context.store
    .listTaskSessions(taskId)
    .filter((member) => member.phase === phase)
    .filter((member) => {
      const input = member.currentInputId === null ? undefined : context.store.getInput(member.currentInputId);
      return input !== undefined && ['queued', 'processing', 'stopping', 'interrupted'].includes(input.status);
    });
  if (unsettled.length > 0) {
    return fail('STAGE_NOT_READY', 'the review step still has unfinished member work', {
      members: unsettled.map((member) => member.sessionId),
    });
  }
  return undefined;
}

/**
 * Path prefixes that overlap: equal, nested, or sharing a glob's directory prefix. A root-level glob
 * (`*.ts`) has the project root as its prefix and therefore overlaps everything (a warning, never a
 * refusal).
 */
function overlapWarnings(members: readonly { readonly sessionId: string; readonly roleId: string; readonly writeScope?: readonly string[] }[]): string[] {
  const warnings: string[] = [];
  const scopes = members
    .map((member) => ({
      sessionId: member.sessionId,
      roleId: member.roleId,
      roots: (member.writeScope ?? []).map((scope) => {
        const normalized = scope.trim().replace(/^\.\//, '').replace(/\/+$/, '');
        const wildcard = normalized.indexOf('*');
        const prefix = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
        return prefix.replace(/\/+$/, '');
      }),
    }))
    .filter((entry) => entry.roots.length > 0);
  for (let i = 0; i < scopes.length; i += 1) {
    for (let j = i + 1; j < scopes.length; j += 1) {
      const left = scopes[i];
      const right = scopes[j];
      if (left === undefined || right === undefined) continue;
      const overlap = left.roots.some((a) =>
        right.roots.some((b) => a === '' || b === '' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)),
      );
      if (overlap) {
        warnings.push(`${left.sessionId} (${left.roleId}) and ${right.sessionId} (${right.roleId}) declare overlapping writeScope`);
      }
    }
  }
  return warnings;
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

/** A timeout is a snapshot, not a conclusion: make the next action impossible to misread. */
function timeoutHint(returned: DelegationReturn): { readonly hint?: string } {
  return returned.outcome === 'timeout'
    ? {
        hint:
          'Member work is still running. This is a status snapshot, not a report or a stop: ' +
          'call task(op=dispatch) with no sessions again in this turn; do not end with a status update.',
      }
    : {};
}

function describe(returned: DelegationReturn): string {
  const parts = returned.sessions.map((member) => `${member.sessionId}:${member.state}`);
  return `${returned.taskId} ${returned.outcome} (${parts.join(', ')})`;
}
