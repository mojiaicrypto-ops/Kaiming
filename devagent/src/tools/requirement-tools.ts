/**
 * Requirement tool (P3-e): `list`, `get` and the only way a proposal or an implementation requirement
 * is created, revised or has its status saved.
 *
 * The files under `.dev/requirements/` are the authority; the tool rebuilds from them, verifies the
 * cited user decision and refuses anything it cannot read as the record it claims to be. `save`
 * stamps the real save time into `updatedAt` and replaces the file by version check.
 */
import { resolveAuthorizationRefs } from '../runtime/authorization.ts';
import {
  IMPLEMENTATION_SECTIONS,
  SCHEMA_VERSION,
  STATUSES,
  draftToMarkdown,
  getRequirement,
  listRequirements,
  requirementFormatRules,
  requirementTemplate,
  requirementsDirOf,
  requirementPath,
  saveRequirement,
  splitSections,
} from '../runtime/requirement-store.ts';
import { asRecord, fail, messageOf, ok, readString, readStringArray } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';
import { OPEN_TASK_STATUSES, type Store } from '../store/store.ts';

export interface RequirementToolContext {
  readonly store: Store;
  readonly projectId: string;
  readonly cwd: string;
  readonly roleId: string;
}

/** Only the roles that own product/technical writing may create or revise a record (G1). */
const SAVE_ROLES = new Set(['chief', 'designer', 'settler']);

export type RequirementToolContextResolver = () => RequirementToolContext;

const MAX_LIMIT = 100;

export function createRequirementTool(contextOf: RequirementToolContextResolver): DomainTool {
  return {
    name: 'requirement',
    label: 'requirement',
    description: [
      'Work with requirement records: list, get, or save a proposal or implementation requirement (save is the only writer).',
      'save takes the content, not a file: the program writes schemaVersion, id, createdAt/updatedAt and the section headings.',
      'An implementation record needs title, status, and sections keyed by these headings (each a non-empty Markdown string):',
      IMPLEMENTATION_SECTIONS.map((section) => `  ${section}`).join(' / '),
      'A proposal needs title, status and a free `body` (目标/来源与决定/处理记录 recommended).',
      `status: proposal ${STATUSES.proposal.join('/')}; implementation ${STATUSES.implementation.join('/')}.`,
      `Optional lists: modules (existing project-relative markdown files), sourceRequirementIds, linkedTaskIds.`,
      'get returns the version and, for an implementation record, its current sections; revise by passing changed values with that exact version (expectedVersion null only creates).',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'get', 'save'] },
        kind: { type: 'string', enum: ['proposal', 'implementation'] },
        status: { type: 'string', description: 'record status; valid values depend on kind' },
        title: { type: 'string', description: 'the record title (non-empty)' },
        requirementId: { type: 'string', description: 'stable id, equal to the file name (e.g. req-password-reset)' },
        expectedVersion: { type: ['string', 'null'], description: 'the version op=get returned, or null to create a new record' },
        sections: {
          type: 'object',
          description: 'implementation records only: content per required heading, keyed by the heading (each entry a non-empty Markdown string)',
        },
        body: { type: 'string', description: 'proposal records only: the free body Markdown' },
        modules: { type: 'array', items: { type: 'string' }, description: 'existing project-relative markdown files this record relies on' },
        sourceRequirementIds: { type: 'array', items: { type: 'string' } },
        linkedTaskIds: { type: 'array', items: { type: 'string' } },
        authorizationRef: {
          type: 'object',
          properties: { inputId: { type: 'string' }, interactionId: { type: 'string' } },
          additionalProperties: false,
        },
        limit: { type: 'number' },
        cursor: { type: 'string' },
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
      const op = readString(params, 'op') ?? 'list';
      if (op === 'list') {
        return listOp(context, params);
      }
      if (op === 'get') {
        const id = readString(params, 'requirementId');
        if (id === undefined) {
          return fail('INVALID_ARGUMENT', 'get needs requirementId');
        }
        const found = getRequirement(context.cwd, id);
        if (!found.found) {
          return fail('NOT_FOUND', `requirement ${id} does not exist`, { requirementId: id });
        }
        const parsed = found.parsed;
        return ok(
          parsed.ok
            ? `Requirement ${id} (${parsed.record.metadata.kind}, ${parsed.record.metadata.status})`
            : `Requirement ${id} exists but is not valid`,
          {
            requirementId: id,
            version: found.version,
            path: requirementPath(context.cwd, id),
            text: found.text,
            ...(parsed.ok
              ? {
                  metadata: parsed.record.metadata,
                  // The Task edge is program-owned state; the file's list is traceability only.
                  implementationTasks: implementationTasksOf(context, id),
                  recordedTaskIds: parsed.record.metadata.linkedTaskIds,
                  // Three ways the record and the work can disagree, each reported rather than hidden.
                  recordedButMissing: parsed.record.metadata.linkedTaskIds.filter(
                    (taskId) => !context.store.listTasks(context.projectId).some((task) => task.id === taskId),
                  ),
                  recordedNotImplementing: parsed.record.metadata.linkedTaskIds.filter((taskId) =>
                    context.store
                      .listTasks(context.projectId)
                      .some((task) => task.id === taskId && task.requirementId !== id),
                  ),
                  // Revise by resubmitting these values: the same text comes back losslessly.
                  body: parsed.record.metadata.kind === 'proposal' ? parsed.record.body.trim() : undefined,
                  sections:
                    parsed.record.metadata.kind === 'implementation'
                      ? splitSections(parsed.record.body)
                      : undefined,
                }
              : {}),
            issues: parsed.issues,
            // A damaged file is repaired through save too: show the format it must end up in.
            ...(parsed.ok
              ? {}
              : {
                  format: requirementTemplate(
                    found.text.includes('kind: proposal') ? 'proposal' : 'implementation',
                    id,
                  ),
                  rules: requirementFormatRules(),
                }),
          },
        );
      }
      if (op !== 'save') {
        return fail('INVALID_ARGUMENT', `unknown op ${op}`);
      }
      return saveOp(context, params);
    },
  };
}

function listOp(context: RequirementToolContext, params: Record<string, unknown>): ReturnType<typeof ok> | ReturnType<typeof fail> {
  const kindFilter = readString(params, 'kind');
  const statusFilter = readString(params, 'status');
  const limitRaw = params['limit'];
  const limit =
    typeof limitRaw === 'number' && Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : 20;
  const cursor = readString(params, 'cursor') ?? undefined;
  const { valid, invalid } = listRequirements(context.cwd);
  // The reverse direction: a Task that implements a record the project cannot read.
  const known = new Set(valid.map((entry) => entry.id));
  const tasksWithoutRecord = context.store
    .listTasks(context.projectId)
    .filter((task) => task.requirementId !== null && !known.has(task.requirementId))
    .map((task) => ({ taskId: task.id, requirementId: task.requirementId, status: task.status }));
  const filtered = valid.filter(
    (entry) =>
      (kindFilter === undefined || entry.kind === kindFilter) &&
      (statusFilter === undefined || entry.status === statusFilter),
  );
  // The cursor is the sort boundary of the same filter: (updatedAt, id) of the last returned record.
  const start =
    cursor === undefined
      ? 0
      : filtered.findIndex((entry) => `${entry.updatedAt}|${entry.id}` === cursor) + 1;
  const page = filtered.slice(start, start + limit);
  const last = page[page.length - 1];
  const nextCursor = start + limit < filtered.length && last !== undefined ? `${last.updatedAt}|${last.id}` : null;
  return ok(
    `${page.length} requirement record(s)${filtered.length > page.length ? ` of ${filtered.length}` : ''}`,
    {
      items: page.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        status: entry.status,
        updatedAt: entry.updatedAt,
        modules: entry.modules,
        sourceRequirementIds: entry.sourceRequirementIds,
        linkedTaskIds: entry.linkedTaskIds,
        version: entry.version,
        path: entry.path,
      })),
      invalidFiles: invalid,
      ...(tasksWithoutRecord.length > 0 ? { tasksWithoutRecord } : {}),
      nextCursor,
      directory: requirementsDirOf(context.cwd),
    },
  );
}

/**
 * What the record's own status claims versus what its implementation Tasks show. The program only
 * reports: R-05 forbids deciding completion from Task counts, and a mismatch is a fact the chief
 * has to see, not a state the program may write.
 */
function consistencyOf(
  context: RequirementToolContext,
  id: string,
  kind: 'proposal' | 'implementation',
  status: string,
): { readonly pendingCheck: readonly string[]; readonly notes: readonly string[] } {
  const pendingCheck: string[] = [];
  const notes: string[] = [];
  const implementationTasks = context.store
    .listTasks(context.projectId)
    .filter((task) => task.requirementId === id);
  const openTasks = implementationTasks.filter((task) => OPEN_TASK_STATUSES.includes(task.status));
  if (kind === 'implementation') {
    if (status === 'in_progress' && implementationTasks.length === 0) {
      notes.push('no Task implements this requirement yet; in_progress is a claim without work');
    }
    if (status === 'completed' && openTasks.length > 0) {
      pendingCheck.push(
        `completion recorded while ${openTasks.map((task) => `${task.id}(${task.status})`).join(', ')} is still open`,
      );
    }
    if (status === 'completed' && implementationTasks.length > 0 && !implementationTasks.some((task) => task.status === 'completed')) {
      // A cancelled execution does not deliver anything (R-05): flag the completion claim, do not undo it.
      pendingCheck.push('completion recorded but no implementing Task completed');
    }
  }
  if (kind === 'proposal' && status === 'archived') {
    // R-05: a proposal is archived only once the produced implementation requirement is saved and
    // linked; the program checks the link exists, not whether the design was any good.
    const produced = listRequirements(context.cwd).valid.filter(
      (record) => record.kind === 'implementation' && record.sourceRequirementIds.includes(id),
    );
    if (produced.length === 0) {
      pendingCheck.push('no implementation requirement cites this proposal as its source');
    }
  }
  return { pendingCheck, notes };
}

function implementationTasksOf(context: RequirementToolContext, id: string): Array<Record<string, unknown>> {
  return context.store
    .listTasks(context.projectId)
    .filter((task) => task.requirementId === id)
    .map((task) => ({
      taskId: task.id,
      status: task.status,
      phase: task.phase,
      requiresTest: task.requiresTest,
      updatedAt: task.updatedAt,
    }));
}

function saveOp(
  context: RequirementToolContext,
  params: Record<string, unknown>,
): ReturnType<typeof ok> | ReturnType<typeof fail> {
  const id = readString(params, 'requirementId');
  const rawExpectedVersion = params['expectedVersion'];
  // Models routinely send the STRING "null" for a nullable field: treat it as null instead of
  // comparing it against a real file version.
  const expectedVersion = rawExpectedVersion === 'null' || rawExpectedVersion === undefined ? null : rawExpectedVersion;
  if (id === undefined) {
    return fail('INVALID_ARGUMENT', 'save needs requirementId');
  }
  if (expectedVersion !== null && typeof expectedVersion !== 'string') {
    return fail('INVALID_ARGUMENT', 'expectedVersion must be null (new record) or the version get returned');
  }
  if (!SAVE_ROLES.has(context.roleId)) {
    return fail('FORBIDDEN', `role ${context.roleId} may read requirements but not save them`);
  }
  const authorization = resolveAuthorizationRefs(context.store, context.projectId, params['authorizationRef']);
  if (!authorization.ok) {
    return fail('INVALID_ARGUMENT', `authorizationRef: ${authorization.message}`);
  }
  const existing = getRequirement(context.cwd, id);
  const existingKind = existing.found && existing.parsed.ok ? existing.parsed.record.metadata.kind : undefined;
  const declaredKind = readString(params, 'kind') ?? existingKind;
  if (declaredKind !== 'proposal' && declaredKind !== 'implementation') {
    return fail('INVALID_ARGUMENT', 'kind must be proposal or implementation (required for a new record)');
  }
  if (existingKind !== undefined && declaredKind !== existingKind) {
    // A record never changes its type in place (F1): a proposal becomes an implementation record as a
    // new, linked record instead.
    return fail('INVALID_ARGUMENT', 'a requirement record cannot change its kind', {
      requirementId: id,
      was: existingKind,
      now: declaredKind,
    });
  }
  const title = readString(params, 'title');
  const status = readString(params, 'status');
  if (title === undefined || status === undefined) {
    return fail('INVALID_ARGUMENT', 'save needs title and status');
  }
  const sectionsParam = params['sections'];
  let sections: Record<string, string> | undefined;
  if (sectionsParam !== undefined) {
    const record = asRecord(sectionsParam);
    if (record === undefined) {
      return fail('INVALID_ARGUMENT', 'sections must be an object keyed by the section headings');
    }
    sections = {};
    for (const [heading, content] of Object.entries(record)) {
      if (typeof content !== 'string') {
        return fail('INVALID_ARGUMENT', `section ${heading} must be a string`);
      }
      sections[heading] = content;
    }
  }
  const lists = ['modules', 'sourceRequirementIds', 'linkedTaskIds'] as const;
  const listValues: Record<(typeof lists)[number], string[]> = {
    modules: [],
    sourceRequirementIds: [],
    linkedTaskIds: [],
  };
  for (const key of lists) {
    if (params[key] === undefined) {
      continue;
    }
    const value = readStringArray(params, key);
    if (value === undefined) {
      return fail('INVALID_ARGUMENT', `${key} must be a list of strings`);
    }
    listValues[key] = value;
  }
  // The content and the decisions come from the caller; the serialization does not (F1/F2/F3).
  const now = new Date().toISOString();
  const createdAt =
    (existing.found && existing.parsed.ok ? existing.parsed.record.metadata.createdAt : undefined) ??
    (existing.found ? /^createdAt:\s*"?([^"\n]+)"?\s*$/m.exec(existing.text)?.[1]?.trim() : undefined) ??
    now;
  const draft = draftToMarkdown(
    {
      id,
      kind: declaredKind,
      title,
      status,
      modules: listValues.modules,
      sourceRequirementIds: listValues.sourceRequirementIds,
      linkedTaskIds: listValues.linkedTaskIds,
      sections,
      body: readString(params, 'body'),
    },
    { createdAt, updatedAt: now },
  );
  if (!draft.ok) {
    return fail('INVALID_ARGUMENT', `the record is not valid: ${draft.issues.join('; ')}`, {
      requirementId: id,
      issues: draft.issues,
      sections: declaredKind === 'implementation' ? [...IMPLEMENTATION_SECTIONS] : [],
    });
  }
  try {
    const saved = saveRequirement({
      cwd: context.cwd,
      id,
      expectedVersion: expectedVersion as string | null,
      markdown: draft.markdown,
    });
    if (!saved.ok) {
      return fail(saved.code, saved.message, {
        requirementId: id,
        ...(saved.issues !== undefined ? { issues: saved.issues } : {}),
      });
    }
    const consistency = consistencyOf(context, id, declaredKind, status.trim());
    const implementationTasks = implementationTasksOf(context, id);
    return ok(
      [
        `Requirement ${id} (${declaredKind}, ${status}) ${saved.reused ? 'was already saved' : 'saved'}`,
        ...consistency.pendingCheck.map((line) => `pending check: ${line}`),
        ...consistency.notes.map((line) => `note: ${line}`),
      ].join('\n'),
      {
      requirementId: id,
      path: saved.path,
      version: saved.version,
      reused: saved.reused,
      savedAt: now,
      ...(consistency.pendingCheck.length > 0 ? { pendingCheck: consistency.pendingCheck } : {}),
      ...(implementationTasks.length > 0 ? { implementationTasks } : {}),
      metadata: {
        schemaVersion: SCHEMA_VERSION,
        id,
        kind: declaredKind,
        title: title.trim(),
        status: status.trim(),
        createdAt,
        updatedAt: now,
        modules: listValues.modules,
        sourceRequirementIds: listValues.sourceRequirementIds,
        linkedTaskIds: listValues.linkedTaskIds,
      },
      authorizationRefs: authorization.refs,
      sections: declaredKind === 'implementation' ? [...IMPLEMENTATION_SECTIONS] : [],
      },
    );
  } catch (error) {
    return fail('STORAGE_UNAVAILABLE', `the record could not be saved: ${messageOf(error)}`, {
      requirementId: id,
    });
  }
}
