/**
 * Artifact and system rows (`docs/architecture/data.md` §2).
 *
 * An Artifact is the immutable, hash-addressed product of a Run or an upload —
 * "blob不可变；修改新版本" — while `command`, `event`, `outbox`, `operation` and
 * `feature_projection` are the plumbing that makes commands idempotent, events
 * replayable and rebuildable knowledge explicit.
 */
import { z } from 'zod';
import {
  entityIdSchema,
  hashSchema,
  idSchema,
  refSchema,
  sourceRefSchema,
  timeSchema,
} from '../primitives.js';
import { artifactKindSchema, roleSchema } from '../enums.js';
import {
  entityBaseShape,
  idRefSchema,
  jsonObjectSchema,
  list,
  nonNegativeIntSchema,
  positiveIntSchema,
} from './common.js';

export const artifactOriginSchema = z.enum(['agent', 'user']);
export type ArtifactOrigin = z.infer<typeof artifactOriginSchema>;
export const artifactValiditySchema = z.enum(['valid', 'invalid']);
export type ArtifactValidity = z.infer<typeof artifactValiditySchema>;

/**
 * `artifact` — `origin=agent` implies a producing Run; `origin=user` implies a
 * bound Attachment and no Run (`data.md` §2 artifact constraint).
 */
export const artifactSchema = z
  .strictObject({
    ...entityBaseShape,
    workId: idRefSchema,
    runId: idRefSchema.optional(),
    origin: artifactOriginSchema,
    attachmentId: idRefSchema.optional(),
    kind: artifactKindSchema,
    artifactVersion: positiveIntSchema,
    contentHash: hashSchema,
    relativeBlobPath: z.string().min(1),
    mime: z.string().min(1),
    bytes: nonNegativeIntSchema,
    sourceRevision: z.string().min(1).optional(),
    validity: artifactValiditySchema,
    invalidReason: z.string().min(1).optional(),
    acl: list(roleSchema),
  })
  .superRefine((value, ctx) => {
    if (value.origin === 'agent' && value.runId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'agent artifact requires runId' });
    }
    if (value.origin === 'user' && value.attachmentId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'user artifact requires attachmentId' });
    }
    if (value.origin === 'user' && value.runId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'user artifact cannot have runId' });
    }
    if (value.validity === 'invalid' && value.invalidReason === undefined) {
      ctx.addIssue({ code: 'custom', message: 'invalid artifact requires invalidReason' });
    }
  });
export type Artifact = z.infer<typeof artifactSchema>;

export const commandStateSchema = z.enum(['accepted', 'completed', 'rejected']);
export type CommandState = z.infer<typeof commandStateSchema>;

/**
 * `command` — the idempotency ledger; UNIQUE(operation, key).
 *
 * `subject` is an internal column that scopes lookup ("仅同调用主体可查",
 * `protocol.md` §4); it is never returned to a caller.
 */
export const commandSchema = z.strictObject({
  ...entityBaseShape,
  subject: z.string().min(1),
  operation: z.string().min(1),
  key: z.string().min(1).max(128),
  payloadHash: hashSchema,
  state: commandStateSchema,
  response: jsonObjectSchema,
});
export type Command = z.infer<typeof commandSchema>;

/** `event` — immutable, cursor-ordered, the source of every subscription. */
export const eventSchema = z.strictObject({
  cursor: z.number().int().positive(),
  eventId: idSchema,
  name: z.string().min(1),
  entityId: entityIdSchema,
  entityVersion: z.number().int().nonnegative(),
  data: jsonObjectSchema,
  occurredAt: timeSchema,
});
export type Event = z.infer<typeof eventSchema>;

export const outboxStateSchema = z.enum(['pending', 'claimed', 'done']);
export type OutboxState = z.infer<typeof outboxStateSchema>;

/** `outbox` — at-least-once delivery of side effects; UNIQUE(operationId). */
export const outboxSchema = z.strictObject({
  ...entityBaseShape,
  operationId: idSchema,
  kind: z.string().min(1),
  payload: jsonObjectSchema,
  state: outboxStateSchema,
  attempts: nonNegativeIntSchema,
  leaseUntil: timeSchema.optional(),
});
export type Outbox = z.infer<typeof outboxSchema>;

export const operationStateSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'superseded',
  'conflict',
]);
export type OperationState = z.infer<typeof operationStateSchema>;

/** `operation` — multi-resource steps with persisted intent and retry evidence. */
export const operationSchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema.optional(),
  requirementId: idRefSchema.optional(),
  sourceRef: sourceRefSchema,
  kind: z.string().min(1),
  state: operationStateSchema,
  expectedHead: z.string().min(1).optional(),
  candidateRevision: z.string().min(1).optional(),
  stepResults: jsonObjectSchema,
  error: jsonObjectSchema.optional(),
});
export type Operation = z.infer<typeof operationSchema>;

export const projectionStateSchema = z.enum(['valid', 'stale']);
export type ProjectionState = z.infer<typeof projectionStateSchema>;

/** `feature_projection` — a rebuildable index row; UNIQUE(revision, featureId). */
export const featureProjectionSchema = z.strictObject({
  ...entityBaseShape,
  revision: z.string().min(1),
  featureId: z.string().min(1),
  documentPath: z.string().min(1),
  documentHash: hashSchema,
  fields: jsonObjectSchema,
  relations: jsonObjectSchema,
  state: projectionStateSchema,
});
export type FeatureProjection = z.infer<typeof featureProjectionSchema>;

/** A published domain event as clients receive it (`protocol.md` §7). */
export const eventEnvelopePayloadSchema = z.strictObject({
  name: z.string().min(1),
  entityId: entityIdSchema,
  entityVersion: z.number().int().nonnegative(),
  data: jsonObjectSchema,
  refs: list(refSchema),
});
export type EventEnvelopePayload = z.infer<typeof eventEnvelopePayloadSchema>;
