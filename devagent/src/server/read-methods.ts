/**
 * Read-only query surface (R1's P4-b methods): projects, sessions, inputs, tasks, results,
 * requirements, project files and recovery inspection. Nothing here calls a model, writes project
 * files, or accepts a caller-chosen path outside a project.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RpcError, type RpcRouter } from './rpc.ts';
import { pageHistory, pageHistoryBefore, readPiHistory } from './history.ts';
import { digestOfText, getRequirement, listRequirements, requirementPath } from '../runtime/requirement-store.ts';
import { readReportBody } from '../runtime/report-store.ts';
import { resolveAuthorizationRefs } from '../runtime/authorization.ts';
import type { Store } from '../store/store.ts';
import { textOfPayload } from '../runtime/input-text.ts';
import { recordedConfigOf, summarizeRecordedConfig } from '../runtime/recorded-config.ts';

const MAX_FILE_BYTES = 1024 * 1024;
/** A session's title is derived from its first user message; longer than this adds no information. */
const TITLE_LIMIT = 60;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** The knowledge entries a workspace is usable through (K-02). */
const ENTRY_PATHS = ['AGENTS.md', join('.dev', 'INDEX.md'), join('.dev', 'PROJECT.md')] as const;

export interface ReadMethodsOptions {
  readonly store: Store;
  /**
   * Why a session cannot run right now, if it cannot. The snapshot carries it for a connecting
   * reader; this method carries it for a reader who is already here and asks "why is nothing
   * happening" after a submit.
   */
  readonly blockedOf?: (sessionId: string) => { code: string; detail: string } | null;
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

  router.register('project.list', {
    // A read, not a registration: opening the workbench must not touch the projects it lists.
    write: false,
    run: (params): unknown => {
      const limit = clampLimit(readNumber(params, 'limit'));
      const cursor = readString(params, 'cursor');
      const rows = store.listProjectSummaries();
      const key = (entry: { projectId: string; updatedAt: string }): string => `${entry.updatedAt}|${entry.projectId}`;
      const start =
        cursor === undefined
          ? 0
          : (() => {
              const index = rows.findIndex((row) => `${row.updatedAt}|${row.id}` === cursor);
              return index < 0 ? -1 : index + 1;
            })();
      if (start < 0) {
        throw new RpcError('INVALID_ARGUMENT', 'the cursor does not belong to this listing', { cursor });
      }
      const page = rows.slice(start, start + limit);
      const last = page[page.length - 1];
      return {
        projects: page.map((row) => {
          const exists = existsSync(row.realPath);
          return {
            projectId: row.id,
            realPath: row.realPath,
            // The revision rebind takes: a menu row must not force a second read to act on it.
            revision: row.revision,
            directoryExists: exists,
            ...(exists ? {} : { problem: 'the directory is missing; rebind it or restore it' }),
            sessionCount: row.sessionCount,
            taskCount: row.taskCount,
            lastActivityAt: row.lastActivityAt,
            updatedAt: row.updatedAt,
          };
        }),
        nextCursor:
          start + limit < rows.length && last !== undefined
            ? key({ projectId: last.id, updatedAt: last.updatedAt })
            : null,
      };
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
      // Moving a directory is a user decision, and this method is only reachable from the
      // authenticated browser: no model tool exposes it, so the cookie is the decision. A supplied
      // reference is still validated (an agent-style caller may pass one), but it is not the gate -
      // requiring it made the feature unreachable, since the browser has no decision to cite.
      const supplied = params['authorizationRef'];
      const authorization =
        supplied === undefined
          ? { ok: true as const, refs: [] as string[] }
          : resolveAuthorizationRefs(store, project.id, supplied);
      if (!authorization.ok) {
        throw new RpcError('FORBIDDEN', `rebinding cites a reference that cannot be verified (${authorization.message})`);
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
      return {
        project: projectSummary(store, rebound),
        // What the row pointed at before the move: the caller just changed a fact, so it must be
        // able to show which fact changed without a second read.
        previousRealPath: project.realPath,
        authorizationRefs: authorization.refs,
      };
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
      return { session: requireSession(store, project.id, sessionId, options.blockedOf) };
    },
  });

  router.register('session.list', {
    // One request for the rail: the alternative was two per session, and one of those opened a
    // stream subscription nobody ever claimed (R1: a list is a list, not a prepared stream).
    write: false,
    run: (params): unknown => {
      const project = requireProject(store, params);
      const limit = clampLimit(readNumber(params, 'limit'));
      const cursor = readString(params, 'cursor');
      const rows = store
        .listSessionSummaries(project.id)
        .map((row) => ({
          sessionId: row.id,
          roleId: row.roleId,
          title: titleOf(row.title),
          activity: activityOfCounts(row.processing, row.queued, row.stopping),
          lastActivityAt: row.lastActivityAt,
          currentTaskId: row.currentTaskId,
          queuedInputs: row.queued,
        }))
        // Newest activity first; a session with no input yet is the newest and sorts first, which
        // is also where a freshly created session should appear.
        .sort((left, right) => {
          const leftKey = left.lastActivityAt ?? '~';
          const rightKey = right.lastActivityAt ?? '~';
          if (leftKey === rightKey) return left.sessionId < right.sessionId ? -1 : 1;
          return leftKey > rightKey ? -1 : 1;
        });
      const key = (entry: { sessionId: string; lastActivityAt: string | null }): string =>
        `${entry.lastActivityAt ?? ''}|${entry.sessionId}`;
      const start = cursor === undefined ? 0 : rows.findIndex((entry) => key(entry) === cursor) + 1;
      if (cursor !== undefined && start === 0) {
        throw new RpcError('INVALID_ARGUMENT', 'the cursor does not belong to this listing', { cursor });
      }
      const page = rows.slice(start, start + limit);
      const last = page[page.length - 1];
      return {
        sessions: page,
        nextCursor: start + limit < rows.length && last !== undefined ? key(last) : null,
      };
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
      const before = readString(params, 'before');
      if (cursor !== undefined && before !== undefined) {
        throw new RpcError('INVALID_ARGUMENT', 'pass either cursor (forward) or before (backward), not both', {});
      }
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
        return { messages: [], nextCursor: null, previousCursor: null, boundary: null, correlation: null, problems: [] };
      }
      const page =
        before === undefined ? pageHistory(read, cursor, limit) : pageHistoryBefore(read, before, limit);
      if (page.unknownCursor) {
        throw new RpcError('INVALID_ARGUMENT', 'the cursor does not belong to this history', { cursor: cursor ?? before });
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
        nextCursor: 'nextCursor' in page ? page.nextCursor : null,
        // Backwards paging: the first entry of this page, or null at the beginning of history.
        previousCursor: 'previousCursor' in page ? page.previousCursor : null,
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
          // What this input actually ran with (R5): the recorded configuration, cut to the three
          // fields that describe a selection. The server's own directories are not public.
          effectiveConfig: summarizeRecordedConfig(input.effectiveConfig),
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

function requireSession(
  store: Store,
  projectId: string,
  sessionId: string,
  blockedOf?: (sessionId: string) => { code: string; detail: string } | null,
) {
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
    activity: live.activity,
    // The same fact, named for a caller that only wants the one condition.
    stopping: live.activity === 'stopping',
    // Why nothing is running, if nothing is running because of a block.
    blocked: blockedOf?.(sessionId) ?? null,
    currentInputId: current?.inputId ?? null,
    // What this session is running with, from the claim's own record: a change in the settings
    // must be visible as a difference, not silently applied to work already running.
    config: summarizeRecordedConfig(recordedConfigOf(inputs)),
    queuedInputs: queued,
    waitingReason:
      current === undefined
        ? null
        : current.status === 'processing' && current.taskId !== null
          ? `Task ${current.taskId}`
          : null,
    task: task === undefined ? null : { taskId: task.id, type: task.type, phase: task.phase, status: task.status },
    // Last activity, from the input rows that already exist: the session list needs a stamp the
    // database does not keep per row, and deriving it here avoids a second source of truth.
    lastActivityAt: inputs.reduce<string | null>(
      (latest, input) => (latest === null || input.updatedAt > latest ? input.updatedAt : latest),
      null,
    ),
  };
}

/** Derived live state for one session, from real input rows (R2). Shared by session.get and
 *  task.get members so a Task card sees the same live state the session view shows. */
export function liveSessionState(store: Store, sessionId: string): {
  activity: 'idle' | 'queued' | 'processing' | 'stopping';
  currentInputId: string | null;
  queuedInputs: number;
} {
  const inputs = store.listInputs(sessionId);
  const current = inputs.find((input) => input.status === 'processing');
  const queued = inputs.filter((input) => input.status === 'queued').length;
  return {
    // A stop was requested but the run has not settled: saying "working" would be a lie, and
    // saying "stopped" would be worse (the durable status is still processing until it settles).
    activity:
      current === undefined
        ? queued > 0
          ? 'queued'
          : 'idle'
        : current.stopRequestKey === null
          ? 'processing'
          : 'stopping',
    currentInputId: current?.inputId ?? null,
    queuedInputs: queued,
  };
}

/** The same three-way derivation for the aggregate row a list query returns. */
function activityOfCounts(processing: number, queued: number, stopping: number): 'idle' | 'queued' | 'processing' | 'stopping' {
  if (processing > 0) return stopping > 0 ? 'stopping' : 'processing';
  return queued > 0 ? 'queued' : 'idle';
}

/**
 * A session's title is the first non-empty line of its first user message: derived, never stored,
 * so there is no second place for a title to disagree with the conversation.
 */
function titleOf(payload: string | null): string | null {
  if (payload === null) return null;
  const text = textOfPayload(payload);
  if (text === undefined) return null;
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry !== '');
  if (line === undefined) return null;
  const points = [...line];
  return points.length <= TITLE_LIMIT ? line : `${points.slice(0, TITLE_LIMIT).join('')}…`;
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
    // Tasks are a paged resource (`task.list`); carrying every one on every project read would
    // make a long-lived project's summary grow without bound.
  };
}

function taskSummary(store: Store, task: ReturnType<Store['getTask']> & object) {
  return {
    taskId: task.id,
    type: task.type,
    phase: task.phase,
    status: task.status,
    revision: task.revision,
    // Which chief session coordinates it: the board links a Task to the conversation that runs it.
    chiefSessionId: task.chiefSessionId,
    requirementId: task.requirementId,
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

