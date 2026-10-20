/**
 * Read-only query surface (R1's P4-b methods): projects, sessions, inputs, tasks, results,
 * requirements, project files and recovery inspection. Nothing here calls a model, writes project
 * files, or accepts a caller-chosen path outside a project.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RpcError, type RpcRouter } from './rpc.ts';
import { pageHistory, readPiHistory } from './history.ts';
import { digestOfText, getRequirement, listRequirements, requirementPath } from '../runtime/requirement-store.ts';
import { readReportBody } from '../runtime/report-store.ts';
import { resolveAuthorizationRefs } from '../runtime/authorization.ts';
import type { Store } from '../store/store.ts';

const MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** The knowledge entries a workspace is usable through (K-02). */
const ENTRY_PATHS = ['AGENTS.md', join('.dev', 'INDEX.md'), join('.dev', 'PROJECT.md')] as const;

export interface ReadMethodsOptions {
  readonly store: Store;
}

export function registerReadMethods(router: RpcRouter, options: ReadMethodsOptions): void {
  const { store } = options;

  router.register('project.open', {
    // Registering a project row is a persistent write, so it takes a requestId and the CSRF token.
    write: true,
    run: (params): unknown => {
      const raw = params['path'];
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new RpcError('INVALID_ARGUMENT', 'path is required');
      }
      let realPath: string;
      try {
        realPath = realpathSync(raw);
      } catch {
        throw new RpcError('PROJECT_UNAVAILABLE', `the directory ${raw} does not exist or cannot be read`, { path: raw });
      }
      if (!statSync(realPath).isDirectory()) {
        throw new RpcError('PROJECT_UNAVAILABLE', `${raw} is not a directory`, { path: raw });
      }
      const existing = store.getProjectByRealPath(realPath);
      if (existing !== undefined) {
        // The same directory is the same project: no second project row, no new session, no file.
        return { project: projectSummary(store, existing), opened: 'existing' };
      }
      const id = `p-${digestOfText(realPath).slice(0, 12)}`;
      store.createProject({ id, realPath });
      const created = store.getProject(id);
      if (created === undefined) {
        throw new RpcError('STORAGE_UNAVAILABLE', 'the project could not be registered');
      }
      return { project: projectSummary(store, created), opened: 'registered' };
    },
  });

  router.register('project.get', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      return { project: projectSummary(store, project) };
    },
  });

  router.register('project.rebind', {
    write: true,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const expectedRevision = readNumber(params, 'expectedRevision');
      const raw = params['path'];
      if (expectedRevision === undefined || typeof raw !== 'string' || raw.trim() === '') {
        throw new RpcError('INVALID_ARGUMENT', 'expectedRevision and path are required');
      }
      // A directory move is a real user decision, and it cannot happen while work is in flight.
      const authorization = resolveAuthorizationRefs(store, project.id, params['authorizationRef']);
      if (!authorization.ok) {
        throw new RpcError('FORBIDDEN', `rebinding needs the user decision (${authorization.message})`);
      }
      const gaps = store.projectRebindGaps(project.id);
      if (gaps.length > 0) {
        throw new RpcError('WORKSPACE_BUSY', 'the project still has work that must stop first', { gaps });
      }
      let realPath: string;
      try {
        realPath = realpathSync(raw);
      } catch {
        throw new RpcError('PROJECT_UNAVAILABLE', `the directory ${raw} does not exist or cannot be read`, { path: raw });
      }
      if (!statSync(realPath).isDirectory()) {
        throw new RpcError('PROJECT_UNAVAILABLE', `${raw} is not a directory`, { path: raw });
      }
      const rebound = store.rebindProject({
        projectId: project.id,
        expectedRevision,
        realPath,
        authorizationRefs: authorization.refs,
      });
      return { project: projectSummary(store, rebound), authorizationRefs: authorization.refs };
    },
  });

  router.register('session.create', {
    write: true,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const id = `s-${digestOfText(`${project.id}:${Date.now()}:${Math.random()}`).slice(0, 12)}`;
      store.createSession({ id, projectId: project.id, roleId: 'chief', cwd: project.realPath });
      // Pi is created lazily: creating a session needs no model and writes nothing into the project.
      return { session: requireSession(store, project.id, id) };
    },
  });

  router.register('session.get', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      if (sessionId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId is required');
      }
      return { session: requireSession(store, project.id, sessionId) };
    },
  });

  router.register('session.messages.list', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      if (sessionId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId is required');
      }
      requireSession(store, project.id, sessionId);
      const limit = clampLimit(readNumber(params, 'limit'));
      const cursor = readString(params, 'cursor');
      const binding = store.getSessionBinding(sessionId);
      const read = readPiHistory(binding?.piFile);
      // A session whose history is bound but missing, empty or without a session header must say so,
      // not look like an empty conversation (R4).
      const identifiable = read.found && read.header !== null;
      if (!identifiable && binding?.hasHistory === true) {
        throw new RpcError('HISTORY_UNAVAILABLE', 'the bound history file is missing, empty or not a session', {
          sessionId,
          piFile: binding.piFile,
        });
      }
      if (!read.found) {
        return { messages: [], nextCursor: null, boundary: null, correlation: null, problems: [] };
      }
      const page = pageHistory(read, cursor, limit);
      if (page.unknownCursor) {
        throw new RpcError('INVALID_ARGUMENT', 'the cursor does not belong to this history', { cursor });
      }
      return {
        messages: page.records.map((record) => {
          const input = record.inputId === null ? undefined : store.getInput(record.inputId);
          return {
            entryId: record.id,
            role: record.role,
            content: record.content,
            // The tool identity travels with a result message here too, as it does in the snapshot.
            ...(record.toolCallId !== null ? { toolCallId: record.toolCallId } : {}),
            ...(record.toolName !== null ? { toolName: record.toolName } : {}),
            ...(record.isError !== null ? { isError: record.isError } : {}),
            timestamp: record.timestamp,
            inputId: record.inputId,
            inputStatus: input?.status ?? null,
          };
        }),
        nextCursor: page.nextCursor,
        // The public boundary: where the caller's view of the history starts and how far it reaches.
        boundary: scrollBoundary(read),
        correlation: correlationSummary(read),
        problems: read.problems,
      };
    },
  });

  router.register('session.input.get', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      const inputId = readString(params, 'inputId');
      if (sessionId === undefined || inputId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId and inputId are required');
      }
      requireSession(store, project.id, sessionId);
      const input = store.getInput(inputId);
      if (input === undefined || input.sessionId !== sessionId) {
        throw new RpcError('NOT_FOUND', `input ${inputId} does not exist in this session`, { inputId });
      }
      return {
        input: {
          inputId: input.inputId,
          kind: input.kind,
          status: input.status,
          revision: input.revision,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          // The original content is returned unchanged; the payload is the source of truth.
          payload: input.payload,
          // Public references only: the delivered boundary and the stop/error facts.
          boundary: input.checkpoint,
          // What this input actually ran with (R5): the redacted effective configuration as recorded at
          // claim time, so a difference from the current settings is visible instead of silent.
          effectiveConfig: parseRecordedConfig(input.effectiveConfig),
          stopReason: input.stopReason,
          error: input.errorCode === null ? null : { code: input.errorCode, message: input.errorMessage ?? '' },
        },
      };
    },
  });

  router.register('task.list', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const limit = clampLimit(readNumber(params, 'limit'));
      const cursor = readString(params, 'cursor');
      const tasks = store.listTasks(project.id);
      const start = cursor === undefined ? 0 : tasks.findIndex((task) => task.id === cursor) + 1;
      if (cursor !== undefined && start === 0) {
        throw new RpcError('INVALID_ARGUMENT', 'the cursor does not belong to this project', { cursor });
      }
      const page = tasks.slice(start, start + limit);
      return {
        tasks: page.map((task) => taskSummary(store, task)),
        nextCursor: start + limit < tasks.length ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  });

  router.register('task.get', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const taskId = readString(params, 'taskId');
      if (taskId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'taskId is required');
      }
      const task = store.getTask(taskId);
      if (task === undefined || task.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `Task ${taskId} does not exist in this project`, { taskId });
      }
      return {
        task: taskSummary(store, task),
        members: store.listTaskSessions(task.id).map((member) => {
          // The delegation-time currentInputId is history; the live session state tells the
          // Task card whether the member is working right now (R2: derived, not stored).
          const live = liveSessionState(store, member.sessionId);
          // How the member's assignment actually ended: idle alone cannot distinguish a
          // finished member from an aborted or failed one.
          const lastInput = store
            .listInputs(member.sessionId)
            .filter((input) => input.kind === 'delegation' || input.kind === 'continuation')
            .at(-1);
          return {
            sessionId: member.sessionId,
            roleId: member.roleId,
            phase: member.phase,
            label: member.label,
            expectedKind: member.expectedKind,
            writeScope: member.writeScope,
            currentInputId: member.currentInputId,
            activity: live.activity,
            liveInputId: live.currentInputId,
            queuedInputs: live.queuedInputs,
            lastInputStatus: lastInput?.status ?? null,
          };
        }),
        results: store.listTaskResults(task.id).map((result) => resultSummary(store, result)),
      };
    },
  });

  router.register('task.report.get', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const taskId = readString(params, 'taskId');
      const resultId = readString(params, 'resultId');
      if (taskId === undefined || resultId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'taskId and resultId are required');
      }
      const task = store.getTask(taskId);
      if (task === undefined || task.projectId !== project.id) {
        throw new RpcError('NOT_FOUND', `Task ${taskId} does not exist in this project`, { taskId });
      }
      const result = store.getResult(resultId);
      if (result === undefined || result.taskId !== task.id) {
        throw new RpcError('NOT_FOUND', `result ${resultId} does not belong to Task ${taskId}`, { resultId });
      }
      // The body is read through the recorded reference: a caller never supplies a path.
      const body = readReportBody(result.bodyRef);
      if (!body.current) {
        throw new RpcError('REPORT_STALE', 'the report body is missing or changed on disk', {
          path: result.bodyRef.path,
        });
      }
      const truncated = body.text.length > MAX_FILE_BYTES;
      return {
        result: resultSummary(store, result),
        text: truncated ? body.text.slice(0, MAX_FILE_BYTES) : body.text,
        truncated,
        version: result.bodyRef.sha256,
        path: result.bodyRef.path,
      };
    },
  });

  router.register('requirement.list', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const kind = readString(params, 'kind');
      const status = readString(params, 'status');
      const limit = clampLimit(readNumber(params, 'limit'));
      const { valid, invalid } = listRequirements(project.realPath);
      const filtered = valid.filter(
        (entry) => (kind === undefined || entry.kind === kind) && (status === undefined || entry.status === status),
      );
      const cursor = readString(params, 'cursor');
      const index = cursor === undefined ? -1 : filtered.findIndex((entry) => `${entry.updatedAt}|${entry.id}` === cursor);
      if (cursor !== undefined && index < 0) {
        throw new RpcError('INVALID_ARGUMENT', 'the cursor does not belong to this listing', { cursor });
      }
      const start = index + 1;
      const page = filtered.slice(start, start + limit);
      const last = page[page.length - 1];
      return {
        items: page.map((entry) => ({ ...entry })),
        invalidFiles: invalid,
        nextCursor: start + limit < filtered.length && last !== undefined ? `${last.updatedAt}|${last.id}` : null,
      };
    },
  });

  router.register('requirement.get', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const requirementId = readString(params, 'requirementId');
      if (requirementId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'requirementId is required');
      }
      if (!/^[A-Za-z0-9_-]+$/.test(requirementId)) {
        throw new RpcError('INVALID_ARGUMENT', 'requirementId has an invalid form', { requirementId });
      }
      const found = getRequirement(project.realPath, requirementId);
      if (!found.found) {
        throw new RpcError('NOT_FOUND', `requirement ${requirementId} does not exist`, { requirementId });
      }
      return {
        requirementId,
        path: requirementPath(project.realPath, requirementId),
        version: found.version,
        text: found.text,
        ...(found.parsed.ok ? { metadata: found.parsed.record.metadata } : {}),
        issues: found.parsed.issues,
      };
    },
  });

  router.register('project.files.list', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const limit = clampLimit(readNumber(params, 'limit'));
      const requested = readString(params, 'path') ?? '.';
      const target = resolveInsideProject(project.realPath, requested);
      if (!existsSync(target)) {
        throw new RpcError('NOT_FOUND', `${requested} does not exist in this project`, { path: requested });
      }
      if (!statSync(target).isDirectory()) {
        throw new RpcError('INVALID_ARGUMENT', `${requested} is not a directory`, { path: requested });
      }
      const names = readdirSync(target).sort();
      const cursor = readString(params, 'cursor');
      const index = cursor === undefined ? -1 : names.indexOf(cursor);
      if (cursor !== undefined && index < 0) {
        throw new RpcError('INVALID_ARGUMENT', 'the cursor does not belong to this listing', { cursor });
      }
      const start = index + 1;
      const page = names.slice(start, start + limit);
      const entries = page.map((name) => {
        const full = join(target, name);
        // `lstatSync`: the listing classifies the entry itself, so a symlink is never followed (an
        // external or dangling link would otherwise leak size/mtime or throw).
        const info = lstatSync(full);
        return {
          name,
          path: relative(project.realPath, full).split(sep).join('/'),
          type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
          size: info.isFile() ? info.size : null,
          updatedAt: info.mtime.toISOString(),
        };
      });
      return {
        path: requested,
        entries,
        nextCursor: start + limit < names.length ? (page[page.length - 1] ?? null) : null,
      };
    },
  });

  router.register('project.files.read', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const requested = readString(params, 'path');
      if (requested === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'path is required');
      }
      const target = resolveInsideProject(project.realPath, requested);
      if (!existsSync(target) || !statSync(target).isFile()) {
        throw new RpcError('NOT_FOUND', `${requested} is not a file in this project`, { path: requested });
      }
      const info = statSync(target);
      const expectedVersion = readString(params, 'expectedVersion');
      const content = readFileSync(target);
      const version = digestOfText(content.toString('utf8'));
      if (expectedVersion !== undefined && expectedVersion !== version) {
        throw new RpcError('VERSION_CONFLICT', 'the file changed since it was read', {
          path: requested,
          actual: version,
        });
      }
      const truncated = content.byteLength > MAX_FILE_BYTES;
      const slice = truncated ? content.subarray(0, MAX_FILE_BYTES) : content;
      const binary = slice.includes(0);
      return {
        path: requested,
        version,
        size: content.byteLength,
        updatedAt: info.mtime.toISOString(),
        truncated,
        binary,
        text: binary ? null : slice.toString('utf8'),
      };
    },
  });

  router.register('session.recovery.inspect', {
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const sessionId = readString(params, 'sessionId');
      if (sessionId === undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'sessionId is required');
      }
      requireSession(store, project.id, sessionId);
      const binding = store.getSessionBinding(sessionId);
      const inputs = store.listInputs(sessionId);
      const interrupted = inputs.filter((input) => input.status === 'interrupted');
      const task = store.getTaskForSession(sessionId);
      return {
        sessionId,
        binding:
          binding === undefined
            ? null
            : {
                piFile: binding.piFile,
                hasHistory: binding.hasHistory,
                configHash: binding.configHash,
                rulesHash: binding.rulesHash,
                fileExists: existsSync(binding.piFile),
              },
        interruptedInputs: interrupted.map((input) => ({
          inputId: input.inputId,
          kind: input.kind,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          checkpoint: input.checkpoint,
          updatedAt: input.updatedAt,
        })),
        pendingInputs: inputs
          .filter((input) => input.status === 'queued' || input.status === 'processing')
          .map((input) => ({ inputId: input.inputId, status: input.status })),
        taskId: task?.id ?? null,
        results: task === undefined ? [] : store.listTaskResults(task.id).map((result) => resultSummary(store, result)),
      };
    },
  });
}

function requireProject(store: Store, params: Record<string, unknown>) {
  const projectId = readString(params, 'projectId');
  if (projectId === undefined) {
    throw new RpcError('INVALID_ARGUMENT', 'projectId is required');
  }
  const project = store.getProject(projectId);
  if (project === undefined) {
    throw new RpcError('NOT_FOUND', `project ${projectId} does not exist`, { projectId });
  }
  return project;
}

function requireSession(store: Store, projectId: string, sessionId: string) {
  const session = store.getSession(sessionId);
  if (session === undefined || session.projectId !== projectId) {
    throw new RpcError('NOT_FOUND', `session ${sessionId} does not exist in this project`, { sessionId });
  }
  const inputs = store.listInputs(sessionId);
  const live = liveSessionState(store, sessionId);
  const queued = live.queuedInputs;
  const current = inputs.find((input) => input.status === 'processing');
  const task = session.currentTaskId === null ? undefined : store.getTask(session.currentTaskId);
  return {
    sessionId: session.id,
    projectId: session.projectId,
    roleId: session.roleId,
    specialization: session.specialization,
    currentTaskId: session.currentTaskId,
    revision: session.revision,
    cwd: session.cwd,
    // activity is derived from real rows, never stored twice (R2).
    activity:
      current === undefined
        ? queued > 0
          ? 'queued'
          : 'idle'
        : 'processing',
    currentInputId: current?.inputId ?? null,
    queuedInputs: queued,
    waitingReason:
      current === undefined
        ? null
        : current.status === 'processing' && current.taskId !== null
          ? `Task ${current.taskId}`
          : null,
    task: task === undefined ? null : { taskId: task.id, type: task.type, phase: task.phase, status: task.status },
  };
}

/** Derived live state for one session, from real input rows (R2). Shared by session.get and
 *  task.get members so a Task card sees the same live state the session view shows. */
export function liveSessionState(store: Store, sessionId: string): {
  activity: 'idle' | 'queued' | 'processing';
  currentInputId: string | null;
  queuedInputs: number;
} {
  const inputs = store.listInputs(sessionId);
  const current = inputs.find((input) => input.status === 'processing');
  const queued = inputs.filter((input) => input.status === 'queued').length;
  return {
    activity: current === undefined ? (queued > 0 ? 'queued' : 'idle') : 'processing',
    currentInputId: current?.inputId ?? null,
    queuedInputs: queued,
  };
}

function projectSummary(store: Store, project: { id: string; realPath: string; revision: number; initializationRef: unknown; updatedAt: string }) {
  const exists = existsSync(project.realPath);
  const entryStates = ENTRY_PATHS.map((path) => {
    const full = join(project.realPath, path);
    return { path: path.split(sep).join('/'), present: exists && existsSync(full) };
  });
  return {
    projectId: project.id,
    realPath: project.realPath,
    revision: project.revision,
    directoryExists: exists,
    ...(exists ? {} : { problem: 'the directory is missing; rebind it or restore it' }),
    initializationRef: project.initializationRef,
    entries: entryStates,
    sessions: store
      .listSessions()
      .filter((session) => session.projectId === project.id)
      .map((session) => ({ sessionId: session.id, roleId: session.roleId })),
    tasks: store.listTasks(project.id).map((task) => taskSummary(store, task)),
  };
}

function taskSummary(store: Store, task: ReturnType<Store['getTask']> & object) {
  return {
    taskId: task.id,
    type: task.type,
    phase: task.phase,
    status: task.status,
    revision: task.revision,
    goal: task.goal,
    scope: task.scope,
    requiresTest: task.requiresTest,
    summary: task.summary,
    nextStep: task.nextStep,
    blockReason: task.blockReason,
    completionResultId: task.completionResultId,
    phaseMembers: store.listTaskSessions(task.id).map((member) => member.sessionId),
    updatedAt: task.updatedAt,
  };
}

function resultSummary(store: Store, result: ReturnType<Store['getResult']> & object) {
  return {
    resultId: result.resultId,
    kind: result.kind,
    verdict: result.verdict,
    summary: result.summary,
    sessionId: result.sessionId,
    delivery: result.deliveryState === null ? null : { digest: result.deliveryState.digest, files: result.deliveryState.paths.length },
    createdAt: result.createdAt,
    version: result.bodyRef.sha256,
  };
}

function scrollBoundary(read: ReturnType<typeof readPiHistory>): string | null {
  const first = read.records.find((record) => record.type === 'message');
  return first?.id ?? null;
}

function correlationSummary(read: ReturnType<typeof readPiHistory>): { readonly markers: number; readonly uncorrelated: number } {
  const markers = read.records.filter((record) => record.marker !== null).length;
  const uncorrelated = read.records.filter((record) => record.type === 'message' && record.inputId === null).length;
  return { markers, uncorrelated };
}

/** A project-relative path that really stays inside the project, with no escaping symlink (R1). */
function resolveInsideProject(projectRoot: string, requested: string): string {
  const root = realpathSync(projectRoot);
  const target = join(root, requested);
  const inside = target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  if (!inside) {
    throw new RpcError('FORBIDDEN', `${requested} is not inside the project`, { path: requested });
  }
  if (!existsSync(target)) {
    return target;
  }
  const real = realpathSync(target);
  if (real !== root && !real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    throw new RpcError('FORBIDDEN', `${requested} resolves outside the project`, { path: requested });
  }
  return real;
}

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || value <= 0) {
    return DEFAULT_PAGE;
  }
  return Math.min(Math.floor(value), MAX_PAGE);
}

/**
 * The effective configuration a claim recorded, as stored JSON. It is already redacted before it is
 * written (no credential material), so it is returned as-is; an unreadable value is reported as absent
 * rather than thrown, because an input's record must stay readable.
 */
function parseRecordedConfig(recorded: string | null): unknown {
  if (recorded === null || recorded === '') {
    return null;
  }
  try {
    return JSON.parse(recorded) as unknown;
  } catch {
    return null;
  }
}
