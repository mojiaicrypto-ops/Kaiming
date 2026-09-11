/**
 * Entity-layer building blocks.
 *
 * `docs/architecture/data.md` §2 fixes the row shape: "除不可变事件/快照外，每行含
 * id、project_id、version、created_at、updated_at" and §1 fixes the scalar
 * forms (UUIDv7 ids, millisecond UTC times, SHA256 hashes, repository-relative
 * paths, arrays bounded by 1000). Everything here is shared by the server and
 * both clients: "共享Schema一次定义，服务端与客户端共用，测试不复制另一套类型".
 */
import { z } from 'zod';
import {
  MAX_ARRAY_ITEMS,
  hashSchema,
  idSchema,
  entityIdSchema,
  projectIdSchema,
  timeSchema,
} from '../primitives.js';

/** JSON payloads are validated as JSON, then narrowed per field by the writer. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema).max(MAX_ARRAY_ITEMS),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** A JSON object field, as used by `payload`/`data`/`stepResults`. */
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
export type JsonObject = z.infer<typeof jsonObjectSchema>;

/** Any array is bounded by `MAX_ARRAY_ITEMS` (`data.md` §1). */
export const list = <T extends z.ZodType>(item: T): z.ZodArray<T> =>
  z.array(item).max(MAX_ARRAY_ITEMS);

export const nonNegativeIntSchema = z.number().int().nonnegative();
export const positiveIntSchema = z.number().int().positive();

/** The five columns every mutable entity row carries. */
export const entityBaseShape = {
  id: idSchema,
  projectId: projectIdSchema,
  version: z.number().int().positive(),
  createdAt: timeSchema,
  updatedAt: timeSchema,
} as const;

/** Ids of other rows in the same project (never cross-project, `data.md` §1). */
export const idRefSchema = entityIdSchema;
export const idRefListSchema = list(entityIdSchema);

/** `Snapshot.type` — the five frozen-payload kinds (`data.md` §2). */
export const snapshotTypeSchema = z.enum([
  'context',
  'config',
  'verification',
  'checkpoint',
  'dispatch',
]);
export type SnapshotType = z.infer<typeof snapshotTypeSchema>;

/** Hash-pinned blob reference used by message bodies, attachments and artifacts. */
export const blobRefFieldsSchema = z.strictObject({
  contentHash: hashSchema,
  relativeBlobPath: z.string().min(1),
  bytes: nonNegativeIntSchema,
});
