/**
 * Shared scalar contracts.
 *
 * Every value type in `docs/architecture/data.md` §1 lives here so the server
 * and every client parse the same shapes: "共享Schema一次定义，服务端与客户端共用，
 * 测试不复制另一套类型".
 */
import { z } from 'zod';

/** Lowercase UUIDv7, the identifier form for every entity except Feature/Project. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Feature ids are `F-` plus 8 random lowercase hex digits. */
const FEATURE_ID = /^F-[0-9a-f]{8}$/;
/** Project ids are the first 32 hex digits of SHA256(canonicalRoot). */
const PROJECT_ID = /^[0-9a-f]{32}$/;
/** SHA256 digests are compared as lowercase 64 hex digits. */
const SHA256 = /^[0-9a-f]{64}$/;
/** Git revisions are full OIDs: sha1 (40) or sha256 (64) repositories. */
const GIT_REVISION = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** UTC time, ISO8601, millisecond precision. */
const TIME_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const idSchema = z.string().regex(UUID_V7, { message: 'expected a lowercase UUIDv7' });
export const featureIdSchema = z
  .string()
  .regex(FEATURE_ID, { message: 'expected F- followed by 8 lowercase hex digits' });
export const projectIdSchema = z
  .string()
  .regex(PROJECT_ID, { message: 'expected 32 lowercase hex digits' });
export const hashSchema = z
  .string()
  .regex(SHA256, { message: 'expected a lowercase SHA256 hex digest' });
export const gitRevisionSchema = z
  .string()
  .regex(GIT_REVISION, { message: 'expected a full git object id' });
export const timeSchema = z
  .string()
  .regex(TIME_UTC_MS, { message: 'expected UTC ISO8601 with millisecond precision' });

/** Ids are branded so a Feature id cannot be passed where an entity id belongs. */
export type Id = z.infer<typeof idSchema>;
export type FeatureId = z.infer<typeof featureIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type Hash = z.infer<typeof hashSchema>;
export type GitRevision = z.infer<typeof gitRevisionSchema>;
export type Time = z.infer<typeof timeSchema>;

/** Entity versions increment from 1; 0 means "expect absent" on create. */
export const versionSchema = z.number().int().positive();
export type Version = z.infer<typeof versionSchema>;

/** Version of a not-yet-created entity, used as `expectedVersion` on create. */
export const ABSENT_VERSION = 0;

/**
 * Repository-relative path: UTF-8, `/` separated, never absolute and never
 * escaping its root. `data.md` §1 forbids `..` and absolute paths outright.
 */
export const repoPathSchema = z.string().superRefine((value, ctx) => {
  const reject = (message: string): void => {
    ctx.addIssue({ code: 'custom', message });
  };
  if (value.length === 0) return reject('path must not be empty');
  if (value.includes('\0')) return reject('path must not contain NUL');
  if (value.includes('\\')) return reject('path must use / separators');
  if (value.startsWith('/')) return reject('path must be repository-relative');
  if (/^[A-Za-z]:/.test(value)) return reject('path must not be a drive path');
  const segments = value.split('/');
  if (segments.some((segment) => segment === '..')) return reject('path must not contain ..');
  if (segments.some((segment) => segment === ''))
    return reject('path must not contain empty segments');
  if (value.endsWith('/')) return reject('path must not end with /');
});
export type RepoPath = z.infer<typeof repoPathSchema>;

/** Maximum items in any array payload; `data.md` §1. */
export const MAX_ARRAY_ITEMS = 1000;
/** Default and maximum page size; `data.md` §1. */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

const boundedArray = <T extends z.ZodType>(item: T): z.ZodArray<T> =>
  z.array(item).max(MAX_ARRAY_ITEMS);

/** `Ref={id,version,hash}` — an immutable version pin. */
export const refSchema = z.strictObject({
  id: idSchema,
  version: versionSchema,
  hash: hashSchema,
});
export type Ref = z.infer<typeof refSchema>;

export const sourceRefKindSchema = z.enum([
  'git',
  'artifact',
  'message',
  'action',
  'decision',
  'policy',
]);
export type SourceRefKind = z.infer<typeof sourceRefKindSchema>;

/** `SourceRef` — a resolvable provenance handle, never free text. */
export const sourceRefSchema = z.strictObject({
  kind: sourceRefKindSchema,
  id: z.string().min(1),
  version: z.string().min(1),
  path: repoPathSchema.optional(),
  hash: hashSchema.optional(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

/** Tool-operation names accepted in `Scope.operations` and in Grants. */
export const operationNameSchema = z.enum([
  'read',
  'search',
  'artifact_write',
  'edit',
  'write',
  'bash',
  'git',
  'network',
  'secret',
  'push',
  'deploy',
  'delete_data',
]);
export type OperationName = z.infer<typeof operationNameSchema>;

/** `Scope` — the authorization envelope. Declared values only; unknown rejected. */
export const scopeSchema = z.strictObject({
  readPaths: boundedArray(repoPathSchema),
  writePaths: boundedArray(repoPathSchema),
  operations: boundedArray(operationNameSchema),
  networkTargets: boundedArray(z.string().min(1)),
});
export type Scope = z.infer<typeof scopeSchema>;

/** An empty scope: read nothing, write nothing, no operation allowed. */
export function emptyScope(): Scope {
  return { readPaths: [], writePaths: [], operations: [], networkTargets: [] };
}
