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
  getRequirement,
  listRequirements,
  parseRequirement,
  requirementFormatRules,
  requirementTemplate,
  requirementsDirOf,
  requirementPath,
  saveRequirement,
  serializeRequirement,
  type RequirementMetadata,
} from '../runtime/requirement-store.ts';
import { asRecord, fail, messageOf, ok, readString } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';
import type { Store } from '../store/store.ts';

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
      'A record is a Markdown file with a YAML front matter; `markdown` must be exactly this shape:',
      requirementTemplate('implementation'),
      'Rules: ' + requirementFormatRules() + '.',
      'Get the current version with op=get before revising an existing record (expectedVersion null only creates).',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'get', 'save'] },
        kind: { type: 'string', enum: ['proposal', 'implementation'] },
        status: { type: 'string', description: 'record status; valid values depend on kind' },
        requirementId: { type: 'string', description: 'stable id, equal to the file name (proposals: req-...; the id itself is part of markdown)' },
        expectedVersion: { type: ['string', 'null'], description: 'the version op=get returned, or null to create a new record' },
        markdown: { type: 'string', description: 'the complete record file content: YAML front matter (schemaVersion/id/kind/title/status/createdAt/updatedAt) followed by the body sections' },
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
            ...(parsed.ok ? { metadata: parsed.record.metadata } : {}),
            issues: parsed.issues,
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
      nextCursor,
      directory: requirementsDirOf(context.cwd),
    },
  );
}

function saveOp(
  context: RequirementToolContext,
  params: Record<string, unknown>,
): ReturnType<typeof ok> | ReturnType<typeof fail> {
  const id = readString(params, 'requirementId');
  const markdown = readString(params, 'markdown');
  const rawExpectedVersion = params['expectedVersion'];
  // Models routinely send the STRING "null" for a nullable field: treat it as null instead of
  // comparing it against a real file version.
  const expectedVersion = rawExpectedVersion === 'null' || rawExpectedVersion === undefined ? null : rawExpectedVersion;
  if (id === undefined || markdown === undefined) {
    return fail('INVALID_ARGUMENT', 'save needs requirementId and markdown');
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
  // The kind comes from the record itself (the caller may omit the parameter).
  const declaredKind = readString(params, 'kind');
  const parsed = parseRequirement(markdown, id, context.cwd);
  if (!parsed.ok) {
    // The issues alone left the author guessing at a format it was never shown: the exact
    // template and the rules travel with the refusal, so one retry can comply.
    return fail('INVALID_ARGUMENT', `the record is not valid: ${parsed.issues.join('; ')}`, {
      requirementId: id,
      issues: parsed.issues,
      format: requirementTemplate(declaredKind === 'proposal' ? 'proposal' : 'implementation', id),
      rules: requirementFormatRules(),
    });
  }
  const existing = getRequirement(context.cwd, id);
  if (existing.found && existing.parsed.ok && existing.parsed.record.metadata.kind !== parsed.record.metadata.kind) {
    // A record never changes its type in place (F1): a proposal becomes an implementation record as a
    // new, linked record instead.
    return fail('INVALID_ARGUMENT', 'a requirement record cannot change its kind', {
      requirementId: id,
      was: existing.parsed.record.metadata.kind,
      now: parsed.record.metadata.kind,
    });
  }
  // `save` keeps the caller's content and stamps the real save time (F1).
  const now = new Date().toISOString();
  const createdAt = existing.found && existing.parsed.ok ? existing.parsed.record.metadata.createdAt : parsed.record.metadata.createdAt;
  if (existing.found && existing.parsed.ok && parsed.record.metadata.createdAt !== createdAt) {
    return fail('INVALID_ARGUMENT', 'createdAt cannot change once a record exists', {
      requirementId: id,
      createdAt,
    });
  }
  const metadata: RequirementMetadata = { ...parsed.record.metadata, createdAt, updatedAt: now };
  const text = serializeRequirement(metadata, parsed.record.body);
  try {
    const saved = saveRequirement({
      cwd: context.cwd,
      id,
      expectedVersion: expectedVersion as string | null,
      markdown: text,
    });
    if (!saved.ok) {
      return fail(saved.code, saved.message, {
        requirementId: id,
        ...(saved.issues !== undefined ? { issues: saved.issues } : {}),
      });
    }
    return ok(
      `Requirement ${id} (${metadata.kind}, ${metadata.status}) ${saved.reused ? 'was already saved' : 'saved'}`,
      {
        requirementId: id,
        path: saved.path,
        version: saved.version,
        reused: saved.reused,
        savedAt: now,
        metadata,
        authorizationRefs: authorization.refs,
        sections: metadata.kind === 'implementation' ? [...IMPLEMENTATION_SECTIONS] : [],
      },
    );
  } catch (error) {
    return fail('STORAGE_UNAVAILABLE', `the record could not be saved: ${messageOf(error)}`, {
      requirementId: id,
    });
  }
}
