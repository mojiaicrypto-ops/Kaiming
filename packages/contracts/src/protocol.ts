/**
 * Wire envelopes.
 *
 * `docs/architecture/protocol.md` §1/§7: one request yields exactly one
 * terminal response; writes carry an idempotency key plus the target
 * `expectedVersion`; long operations answer `accepted` while synchronous edits
 * answer `applied`. Unknown fields are rejected on every envelope.
 */
import { z } from 'zod';
import { errorBodySchema } from './errors.js';
import {
  gitRevisionSchema,
  hashSchema,
  idSchema,
  projectIdSchema,
  timeSchema,
  versionSchema,
} from './primitives.js';
import { PROTOCOL_LIMITS } from './limits.js';

/** Protocol version carried by every envelope. */
export const PROTOCOL_VERSION = 1;

export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const idempotencyKeySchema = z
  .string()
  .min(PROTOCOL_LIMITS.idempotencyKeyMinChars)
  .max(PROTOCOL_LIMITS.idempotencyKeyMaxChars);

export const requestEnvelopeSchema = z.strictObject({
  v: protocolVersionSchema,
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.string().min(1),
  projectId: projectIdSchema.optional(),
  params: z.unknown(),
});
export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;

/** Fields every write method must carry on top of its own params. */
export const writeCommandFieldsSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().nonnegative(),
});
export type WriteCommandFields = z.infer<typeof writeCommandFieldsSchema>;

export const successResponseEnvelopeSchema = z.strictObject({
  v: protocolVersionSchema,
  type: z.literal('response'),
  id: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown(),
});

export const failureResponseEnvelopeSchema = z.strictObject({
  v: protocolVersionSchema,
  type: z.literal('response'),
  id: z.string().min(1),
  ok: z.literal(false),
  error: errorBodySchema,
});

export const responseEnvelopeSchema = z.discriminatedUnion('ok', [
  successResponseEnvelopeSchema,
  failureResponseEnvelopeSchema,
]);
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;

export const eventEnvelopeSchema = z.strictObject({
  v: protocolVersionSchema,
  type: z.literal('event'),
  eventId: idSchema,
  projectId: projectIdSchema,
  cursor: z.number().int().nonnegative(),
  name: z.string().min(1),
  entityId: idSchema,
  entityVersion: versionSchema,
  data: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Result of an accepted long operation. */
export const acceptedResultSchema = z.strictObject({
  status: z.literal('accepted'),
  operationId: idSchema,
  workId: idSchema.optional(),
  runId: idSchema.optional(),
  version: versionSchema.optional(),
});
export type AcceptedResult = z.infer<typeof acceptedResultSchema>;

/** Result of a synchronous domain edit. */
export const appliedResultSchema = z.strictObject({
  status: z.literal('applied'),
  entityId: idSchema,
  version: versionSchema,
});
export type AppliedResult = z.infer<typeof appliedResultSchema>;

/** Opaque cursor pagination. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({
    items: z.array(item).max(PROTOCOL_LIMITS.maxArrayItems),
    nextCursor: z.string().optional(),
  });
}

/** A `git` sourced reference must carry a real revision and path. */
export const gitSourceRefFieldsSchema = z.strictObject({
  kind: z.literal('git'),
  id: gitRevisionSchema,
  version: gitRevisionSchema,
  hash: hashSchema.optional(),
});

/** Server time is always a UTC millisecond timestamp. */
export const serverTimeSchema = timeSchema;

/** `connection.hello` result. */
export const helloResultSchema = z.strictObject({
  connectionId: idSchema,
  protocolVersion: protocolVersionSchema,
  serverTime: serverTimeSchema,
});
export type HelloResult = z.infer<typeof helloResultSchema>;
