/**
 * Runs, attempts, grants and budgets (`docs/architecture/data.md` §2).
 *
 * These rows carry execution authority: a Run is created only from a frozen
 * DispatchSnapshot, an Attempt owns exactly one epoch
 * ("每次Attempt分配递增epoch", `reliability.md` §2), and a Grant is only usable
 * when every documented binding matches ("全匹配后才准入", `data.md` §2 grant).
 */
import { z } from 'zod';
import { gitRevisionSchema, hashSchema, idSchema, refSchema, timeSchema } from '../primitives.js';
import {
  attemptStatusSchema,
  grantScopeSchema,
  purposeSchema,
  roleSchema,
  runStatusSchema,
  stageResultStatusSchema,
} from '../enums.js';
import {
  entityBaseShape,
  idRefListSchema,
  idRefSchema,
  jsonObjectSchema,
  list,
  nonNegativeIntSchema,
  positiveIntSchema,
  snapshotTypeSchema,
} from './common.js';
import { checkResultSchema } from './structures.js';

/**
 * A reference to an immutable snapshot.
 *
 * `data.md` §2 gives `snapshot` no id column — its primary key is `(type, hash)` —
 * so a snapshot is referenced by its content hash, never by a UUID.
 */
export const snapshotRefSchema = hashSchema;
export type SnapshotRef = z.infer<typeof snapshotRefSchema>;

/** `run` — one execution of a task or Chief step. */
export const runSchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema,
  taskId: idRefSchema.optional(),
  role: roleSchema,
  purpose: purposeSchema,
  parentRunId: idRefSchema.optional(),
  stage: z.string().min(1),
  status: runStatusSchema,
  requiredChild: z.boolean(),
  join: z.enum(['none', 'all']),
  childIds: idRefListSchema,
  configSnapshotId: snapshotRefSchema,
  contextSnapshotId: snapshotRefSchema,
  dispatchSnapshotId: snapshotRefSchema,
  budgetAllocation: nonNegativeIntSchema,
});
export type Run = z.infer<typeof runSchema>;

/** `attempt` — one Runner process for a Run; UNIQUE(runId, number). */
export const attemptSchema = z.strictObject({
  ...entityBaseShape,
  runId: idRefSchema,
  number: positiveIntSchema,
  status: attemptStatusSchema,
  ownerEpoch: z.number().int().nonnegative(),
  runnerId: z.string().min(1).optional(),
  heartbeatAt: timeSchema.optional(),
  sessionRef: idRefSchema.optional(),
  checkpointRef: idRefSchema.optional(),
  manifestId: idRefSchema.optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;

/** `stage_result` — what an Attempt submitted at the end of its stage. */
export const stageResultRowSchema = z.strictObject({
  ...entityBaseShape,
  taskId: idRefSchema.optional(),
  runId: idRefSchema,
  attemptId: idRefSchema,
  manifestId: idRefSchema.optional(),
  status: stageResultStatusSchema,
  summary: z.string().min(1),
  artifactRefs: list(refSchema),
  evidenceRefs: idRefListSchema,
  changedPaths: list(z.string().min(1)),
  findingIds: idRefListSchema,
  unknowns: list(z.string().min(1)),
  requestedActions: list(z.string().min(1)),
  readLedgerSeq: nonNegativeIntSchema,
  readLedgerHash: hashSchema,
  checkResult: checkResultSchema.optional(),
});
export type StageResultRow = z.infer<typeof stageResultRowSchema>;

/**
 * What an Attempt may submit (`rules/agents.md` §4 `stage.submit`).
 *
 * The storage columns (`id`/`projectId`/`version`/timestamps) are injected by the
 * repository, and `runId`/`attemptId`/`taskId` come from the capability, so the
 * client-visible contract is the row minus those — validating the full row before
 * insert would reject every submission for missing server fields.
 */
export const stageResultContentSchema = stageResultRowSchema.omit({
  id: true,
  projectId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  runId: true,
  attemptId: true,
  taskId: true,
});
export type StageResultContent = z.infer<typeof stageResultContentSchema>;

/** `snapshot` — an immutable frozen payload; content-addressed by `hash`. */
export const snapshotSchema = z.strictObject({
  type: snapshotTypeSchema,
  hash: hashSchema,
  payload: jsonObjectSchema,
  blobPath: z.string().min(1),
  createdAt: timeSchema,
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/**
 * `grant` — an authority token bound to its decision.
 *
 * Scope bindings are enforced structurally: `once` needs a run, a tool operation
 * and the input hash; `run` needs a run; `work` needs a work; `project` is bound
 * by the row's project.
 */
export const grantSchema = z
  .strictObject({
    ...entityBaseShape,
    workId: idRefSchema.optional(),
    runId: idRefSchema.optional(),
    toolOperationId: idRefSchema.optional(),
    scope: grantScopeSchema,
    role: roleSchema,
    stage: z.string().min(1),
    operation: z.string().min(1),
    targets: list(z.string().min(1)),
    expiresAt: timeSchema,
    limits: jsonObjectSchema,
    decisionId: idRefSchema,
    consumedAt: timeSchema.optional(),
    consumedByOperationId: idRefSchema.optional(),
    inputHash: hashSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'once') {
      if (value.runId === undefined || value.toolOperationId === undefined) {
        ctx.addIssue({ code: 'custom', message: 'once grant requires runId and toolOperationId' });
      }
      if (value.inputHash === undefined) {
        ctx.addIssue({ code: 'custom', message: 'once grant requires inputHash' });
      }
    }
    if (value.scope === 'run' && value.runId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'run grant requires runId' });
    }
    if (value.scope === 'work' && value.workId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'work grant requires workId' });
    }
  });
export type Grant = z.infer<typeof grantSchema>;

/** `budget` — dispatchable only while used + reserved <= limit. */
export const budgetSchema = z
  .strictObject({
    ...entityBaseShape,
    workId: idRefSchema,
    tokenLimit: nonNegativeIntSchema,
    tokensUsed: nonNegativeIntSchema,
    tokensReserved: nonNegativeIntSchema,
    activeTimeLimit: nonNegativeIntSchema,
    activeTimeUsed: nonNegativeIntSchema,
    repairLimit: nonNegativeIntSchema,
    repairUsed: nonNegativeIntSchema,
    costKnown: z.boolean(),
    cost: z.number().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tokensUsed + value.tokensReserved > value.tokenLimit) {
      ctx.addIssue({ code: 'custom', message: 'tokens used + reserved exceeds the limit' });
    }
    if (value.repairUsed > value.repairLimit) {
      ctx.addIssue({ code: 'custom', message: 'repair used exceeds the limit' });
    }
  });
export type Budget = z.infer<typeof budgetSchema>;

export const toolOperationStateSchema = z.enum(['prepared', 'started', 'finished', 'unknown']);
export type ToolOperationState = z.infer<typeof toolOperationStateSchema>;

/** `tool_operation` — the ledger that makes tool results replay-safe. */
export const toolOperationSchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema,
  runId: idRefSchema,
  attemptId: idRefSchema,
  epoch: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  inputHash: hashSchema,
  argsRef: idRefSchema,
  state: toolOperationStateSchema,
  grantId: idRefSchema.optional(),
  resultRef: idRefSchema.optional(),
  startedAt: timeSchema.optional(),
  finishedAt: timeSchema.optional(),
});
export type ToolOperation = z.infer<typeof toolOperationSchema>;

/** `lease` — one owner per resource, revoked when expired. */
export const leaseSchema = z.strictObject({
  ...entityBaseShape,
  resource: z.string().min(1),
  ownerAttemptId: idRefSchema,
  epoch: z.number().int().nonnegative(),
  expiresAt: timeSchema,
});
export type Lease = z.infer<typeof leaseSchema>;

/** A runner heartbeat/control answer (`protocol.md` §6 runner.heartbeat). */
export const runnerControlSchema = z.enum(['continue', 'pause', 'abort', 'shutdown']);
export type RunnerControl = z.infer<typeof runnerControlSchema>;

/** The frozen session reference an Attempt resumes from. */
export const sessionRefSchema = z.strictObject({
  sessionId: z.string().min(1),
  sessionFile: z.string().min(1).optional(),
  codeRevision: gitRevisionSchema.optional(),
});
export type SessionRef = z.infer<typeof sessionRefSchema>;

/** `operationId`-addressed operations recorded outside the mailbox transaction. */
export const operationKindSchema = z.enum([
  'initialize',
  'integrate',
  'settle',
  'recover',
  'backup',
  'requirement_save',
  'requirement_import',
]);
export type OperationKind = z.infer<typeof operationKindSchema>;

/** A hash-pinned id used by internal references to immutable knowledge files. */
export const documentRefSchema = z.strictObject({
  path: z.string().min(1),
  revision: z.string().min(1),
  hash: hashSchema,
});
export type DocumentRef = z.infer<typeof documentRefSchema>;

/** Internal helper: an id that must exist (used by storage layer guards). */
export const requiredIdSchema = idSchema;
