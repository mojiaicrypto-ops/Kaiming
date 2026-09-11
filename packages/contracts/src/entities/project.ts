/**
 * Project, conversation and message entities (`docs/architecture/data.md` §2).
 *
 * These rows carry the user-facing conversation surface: a Project is a real
 * repository root, a Conversation is the chat thread, and every message body
 * lives in a hash-addressed blob so "正文不是Artifact" (`data.md` §2 message_body)
 * while remaining immutable.
 */
import { z } from 'zod';
import { timeSchema } from '../primitives.js';
import { repoPathSchema } from '../primitives.js';
import { hashSchema, idSchema, projectIdSchema, versionSchema } from '../primitives.js';
import { projectStateSchema, trustStateSchema } from '../enums.js';
import { roleSchema } from '../enums.js';
import { messageSenderSchema, messageStateSchema } from '../enums.js';
import {
  blobRefFieldsSchema,
  entityBaseShape,
  idRefListSchema,
  idRefSchema,
  jsonObjectSchema,
  nonNegativeIntSchema,
} from './common.js';

/**
 * `project` — one opened repository root and its three roots.
 *
 * The project row is the only table without its own `project_id` column: its `id`
 * *is* the project id — `SHA256(canonicalRoot)` truncated to 32 hex
 * (`ARCHITECTURE.md` §4) — so repeating it would be a second source of truth, and
 * the id is deliberately not a UUIDv7. The client-facing summary still exposes
 * `projectId`.
 */
export const projectSchema = z.strictObject({
  id: projectIdSchema,
  version: versionSchema,
  createdAt: timeSchema,
  updatedAt: timeSchema,
  /** Canonical absolute root; unique per project (`data.md` §2). */
  root: z.string().min(1),
  /** `git rev-parse --show-toplevel`, when the root is a repository. */
  gitRoot: z.string().min(1).optional(),
  codeRoot: repoPathSchema,
  documentRoot: repoPathSchema,
  deliveryBranch: z.string().min(1),
  trust: trustStateSchema,
  state: projectStateSchema,
  head: z.string().min(1).optional(),
});
export type Project = z.infer<typeof projectSchema>;

/** `conversation` — "仅Chief创建切换" (`data.md` §2). */
export const conversationSchema = z.strictObject({
  ...entityBaseShape,
  title: z.string().min(1),
  focusWorkId: idRefSchema.optional(),
  archived: z.boolean(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageBodyOwnerKindSchema = z.enum(['user', 'agent', 'system']);
export type MessageBodyOwnerKind = z.infer<typeof messageBodyOwnerKindSchema>;

export const messageBodyMimeSchema = z.enum(['text/plain', 'text/markdown']);
export type MessageBodyMime = z.infer<typeof messageBodyMimeSchema>;

/**
 * `message_body` — the immutable message text.
 *
 * Ownership is enforced structurally: a user body must carry `ownerUserId`, an
 * agent body must carry `producerRunId`, and a system body carries neither.
 */
export const messageBodySchema = z
  .strictObject({
    ...entityBaseShape,
    ownerKind: messageBodyOwnerKindSchema,
    ownerUserId: idRefSchema.optional(),
    producerRunId: idRefSchema.optional(),
    mime: messageBodyMimeSchema,
    ...blobRefFieldsSchema.shape,
  })
  .superRefine((value, ctx) => {
    if (value.ownerKind === 'user' && value.ownerUserId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'user message body requires ownerUserId' });
    }
    if (value.ownerKind === 'agent' && value.producerRunId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'agent message body requires producerRunId' });
    }
    if (value.ownerKind === 'system' && value.producerRunId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'system message body cannot have producerRunId' });
    }
  });
export type MessageBody = z.infer<typeof messageBodySchema>;

/** `user_action` — an authenticated real user action; immutable (`data.md` §2). */
export const userActionSchema = z.strictObject({
  ...entityBaseShape,
  actorId: idRefSchema,
  action: z.string().min(1),
  targetId: idRefSchema.optional(),
  payload: jsonObjectSchema,
  payloadHash: hashSchema,
});
export type UserAction = z.infer<typeof userActionSchema>;

/** `message` — one row per chat message; UNIQUE(conversationId, seq). */
export const messageSchema = z.strictObject({
  ...entityBaseShape,
  conversationId: idRefSchema,
  seq: z.number().int().positive(),
  sender: messageSenderSchema,
  role: roleSchema.optional(),
  bodyRef: idRefSchema,
  targetWorkId: idRefSchema.optional(),
  targetRole: roleSchema.optional(),
  state: messageStateSchema,
  resultRefs: idRefListSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const attachmentStateSchema = z.enum(['staged', 'bound', 'expired']);
export type AttachmentState = z.infer<typeof attachmentStateSchema>;

/** `attachment` — staged upload, bound atomically by message.send. */
export const attachmentSchema = z.strictObject({
  ...entityBaseShape,
  conversationId: idRefSchema,
  ownerUserId: idRefSchema,
  mime: z.string().min(1),
  state: attachmentStateSchema,
  expiresAt: timeSchema,
  boundMessageId: idRefSchema.optional(),
  workId: idRefSchema.optional(),
  ...blobRefFieldsSchema.shape,
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** Project summary as returned by `project.list` (`protocol.md` §3). */
export const projectSummarySchema = z.strictObject({
  projectId: projectIdSchema,
  name: z.string().min(1),
  root: z.string().min(1),
  trust: trustStateSchema,
  state: projectStateSchema,
  version: versionSchema,
  updatedAt: timeSchema,
  runningRuns: nonNegativeIntSchema,
  executionReady: z.boolean(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

/** `connection.hello` client kind (`protocol.md` §2). */
export const clientKindSchema = z.enum(['web', 'cli']);
export type ClientKind = z.infer<typeof clientKindSchema>;

/** Identity of an authenticated caller inside the daemon. */
export const callerIdentitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: idSchema, sessionId: idSchema }),
  z.strictObject({ kind: z.literal('cli'), installationId: idSchema }),
  z.strictObject({ kind: z.literal('runner'), attemptId: idSchema, epoch: z.number().int() }),
]);
export type CallerIdentity = z.infer<typeof callerIdentitySchema>;
