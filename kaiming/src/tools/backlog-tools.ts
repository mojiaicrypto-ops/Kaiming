/**
 * The model-facing `backlog` tool (G2). Every write the model makes to `.dev/backlog.md` goes
 * through here: `add` allocates an id and stamps source/actor/time, `close` requires a note, and
 * `edit` is an exact-text replacement limited to that one file. The file stays ordinary: users edit
 * it directly, and reads always rebuild from its current content.
 */
import {
  BacklogConflictError,
  BacklogNotFoundError,
  BacklogProblemError,
  addItem,
  closeItem,
  editRaw,
  readBacklog,
  type BacklogItem,
  type BacklogReadResult,
} from '../runtime/backlog-store.ts';
import { asRecord, fail, messageOf, ok, readString, readStringArray, type ToolOutcome } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';

export interface BacklogTaskRef {
  readonly taskId: string;
  readonly status: string;
}

export interface BacklogToolContext {
  readonly cwd: string;
  readonly roleId: string;
  readonly actorId: string;
  /** Used for the recorded source (`<roleId> <sessionId> / <inputId>`). */
  readonly sessionId?: string;
  readonly inputId?: string;
  /** settler's `close` defaults to the Task it is currently settling. */
  readonly currentTaskId?: string;
  /**
   * Association facts come from the database (WP-3). Until that wiring exists this is absent and the
   * tool reports no associated Task; the shape is already the one the UI needs.
   */
  readonly tasksOf?: (backlogId: string) => {
    readonly open: readonly BacklogTaskRef[];
    readonly lastClosed?: BacklogTaskRef;
  };
}

export type BacklogToolContextResolver = () => BacklogToolContext;

const OPS = ['list', 'get', 'add', 'close', 'edit'] as const;
type Op = (typeof OPS)[number];

/** G2 op-level permissions: designer cannot close, settler can; developer is read-only. */
const OP_ROLES: Readonly<Record<Op, readonly string[]>> = {
  list: ['chief', 'designer', 'developer', 'settler'],
  get: ['chief', 'designer', 'developer', 'settler'],
  add: ['chief', 'designer', 'settler'],
  close: ['chief', 'settler'],
  edit: ['chief', 'designer', 'settler'],
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const FORMAT_HINT = [
  '格式：`### B-12 标题`，下面是 `- 状态: open|done|dropped` 等 `- 键: 值` 行；',
  '只有一个条目以 ### 开头、写明状态且编号不重复时才能被工具改写；修复用 edit 改原文。',
].join('');

function itemView(
  context: BacklogToolContext,
  item: BacklogItem,
  issues: BacklogReadResult['issues'],
  warnings: BacklogReadResult['warnings'],
): Record<string, unknown> {
  const tasks = context.tasksOf?.(item.id);
  const ownIssues = issues.filter((issue) => issue.id === item.id);
  const ownWarnings = warnings.filter((issue) => issue.id === item.id);
  return {
    id: item.id,
    title: item.title,
    state: item.state,
    ready: item.specRefs.length > 0,
    specRefs: item.specRefs,
    taskIds: item.taskIds,
    source: item.source,
    createdBy: item.createdBy,
    closedBy: item.closedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    closedAt: item.closedAt,
    note: item.note,
    external: item.external,
    body: item.body,
    line: item.line,
    openTasks: tasks?.open ?? [],
    ...(tasks?.lastClosed === undefined ? {} : { lastClosedTask: tasks.lastClosed }),
    problems: ownIssues,
    warnings: ownWarnings,
  };
}

function readOrFail(context: BacklogToolContext): BacklogReadResult {
  return readBacklog(context.cwd);
}

function describe(result: BacklogReadResult): string {
  const parts = [`${String(result.items.length)} 条待办`];
  if (result.issues.length > 0) {
    parts.push(`${String(result.issues.length)} 处问题`);
  }
  if (result.warnings.length > 0) {
    parts.push(`${String(result.warnings.length)} 个警告`);
  }
  return parts.join('，');
}

function sourceOf(context: BacklogToolContext): string {
  const session = context.sessionId ?? '-';
  const input = context.inputId ?? '-';
  return `${context.roleId} ${session} / ${input}`;
}

function errorOutcome(error: unknown): ToolOutcome {
  if (error instanceof BacklogConflictError) {
    return fail('VERSION_CONFLICT', '待办已被他人修改，请重新读取后再提交', {
      current: {
        id: error.item.id,
        digest: error.item.digest,
        title: error.item.title,
        state: error.item.state,
      },
    });
  }
  if (error instanceof BacklogProblemError) {
    return fail('BACKLOG_PROBLEM', '这条待办有问题，需要先用 edit 修改原文', {
      backlogId: error.id,
      issues: error.issues,
    });
  }
  if (error instanceof BacklogNotFoundError) {
    return fail('NOT_FOUND', `待办 ${error.id} 不存在`, { backlogId: error.id });
  }
  return fail('INVALID_ARGUMENT', `${messageOf(error)}；${FORMAT_HINT}`);
}

export function createBacklogTool(contextOf: BacklogToolContextResolver): DomainTool {
  return {
    name: 'backlog',
    label: 'backlog',
    description: [
      'Work with the project backlog file `.dev/backlog.md`: list/get entries, add one, close one (note required), or edit its原文 by exact replacement.',
      'Writes allocate ids, record the source/actor/time and re-read the file immediately, so a broken edit is visible at once. Use edit — not bash — for fixes, merges, splits, renumbering and reopen.',
      'A backlog item with a format problem cannot be added to, closed or edited through the entry operations; fix its原文 with edit first.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: [...OPS] },
        state: { type: 'string', enum: ['open', 'done', 'dropped', 'all'] },
        query: { type: 'string' },
        limit: { type: 'number' },
        id: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        specRefs: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
        taskIds: { type: 'array', items: { type: 'string' } },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['op'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      const op = readString(params, 'op') as Op | undefined;
      if (op === undefined || !OPS.includes(op)) {
        return fail('INVALID_ARGUMENT', `unknown op ${String(params['op'])}`);
      }
      const context = contextOf();
      if (!OP_ROLES[op].includes(context.roleId)) {
        return fail('FORBIDDEN', `${context.roleId} may not call backlog(${op})`);
      }
      try {
        if (op === 'list') {
          const filtered = readOrFail(context);
          const state = readString(params, 'state') ?? 'open';
          const query = (readString(params, 'query') ?? '').trim().toLowerCase();
          const limit = Math.min(
            MAX_LIMIT,
            Math.max(1, Math.floor(params['limit'] === undefined ? DEFAULT_LIMIT : Number(params['limit']) || DEFAULT_LIMIT)),
          );
          const items = filtered.items
            .filter((item) => (state === 'all' ? true : item.state === state))
            .filter(
              (item) =>
                query === '' ||
                item.title.toLowerCase().includes(query) ||
                item.body.toLowerCase().includes(query),
            )
            .slice(0, limit)
            .map((item) => itemView(context, item, filtered.issues, filtered.warnings));
          return ok(describe(filtered), {
            items,
            issues: filtered.issues,
            warnings: filtered.warnings,
          });
        }
        if (op === 'get') {
          const id = readString(params, 'id');
          if (id === undefined || id.trim() === '') {
            return fail('INVALID_ARGUMENT', 'get needs id');
          }
          const read = readOrFail(context);
          const item = read.items.find((entry) => entry.id === id);
          if (item === undefined) {
            const problems = read.issues.filter((issue) => issue.id === id);
            return problems.length > 0
              ? fail('BACKLOG_PROBLEM', '这条待办有问题，需要先用 edit 修改原文', {
                  backlogId: id,
                  issues: problems,
                })
              : fail('NOT_FOUND', `待办 ${id} 不存在`, { backlogId: id });
          }
          return ok(`待办 ${id}`, itemView(context, item, read.issues, read.warnings));
        }
        if (op === 'add') {
          const title = readString(params, 'title');
          if (title === undefined || title.trim() === '') {
            return fail('INVALID_ARGUMENT', 'add needs title');
          }
          const item = await addItem(context.cwd, {
            title,
            ...(readString(params, 'body') === undefined ? {} : { body: readString(params, 'body') ?? '' }),
            ...(readStringArray(params, 'specRefs') === undefined
              ? {}
              : { specRefs: readStringArray(params, 'specRefs') ?? [] }),
            source: sourceOf(context),
            actorId: context.actorId,
          });
          return ok(`已记为 ${item.id}`, {
            item: itemView(context, item, [], []),
          });
        }
        if (op === 'close') {
          const id = readString(params, 'id');
          const state = readString(params, 'state');
          const note = readString(params, 'note');
          if (id === undefined || id.trim() === '') {
            return fail('INVALID_ARGUMENT', 'close needs id');
          }
          if (state !== 'done' && state !== 'dropped') {
            return fail('INVALID_ARGUMENT', 'close needs state done or dropped');
          }
          if (note === undefined || note.trim() === '') {
            return fail('INVALID_ARGUMENT', 'close needs a one-line note');
          }
          const requested = readStringArray(params, 'taskIds') ?? [];
          const defaults =
            context.currentTaskId === undefined ? [] : [context.currentTaskId];
          const item = await closeItem(
            context.cwd,
            id,
            undefined,
            { state, note, taskIds: [...new Set([...requested, ...defaults])] },
            context.actorId,
          );
          return ok(`已关闭 ${item.id}`, {
            item: itemView(context, item, [], []),
          });
        }
        // edit
        const oldText = readString(params, 'oldText');
        const newText = readString(params, 'newText');
        if (oldText === undefined || oldText === '') {
          return fail('INVALID_ARGUMENT', 'edit needs oldText');
        }
        if (newText === undefined) {
          return fail('INVALID_ARGUMENT', 'edit needs newText');
        }
        const after = await editRaw(context.cwd, oldText, newText);
        return ok(describe(after), {
          items: after.items,
          issues: after.issues,
          warnings: after.warnings,
        });
      } catch (error) {
        return errorOutcome(error);
      }
    },
  };
}
