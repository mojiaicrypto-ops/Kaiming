/**
 * Work, requirement, task and review entities (`docs/architecture/data.md` §2).
 *
 * Work is the unit of authority: `data.md` §2 states "none不产生修改授权" and the
 * ledger rules in `docs/rules/workflow.md` §2 decide the level. Requirement is
 * the portable Git-persisted product fact, so its structured shape mirrors
 * `docs/product/requirements.md` §2 exactly.
 */
import { z } from 'zod';
import {
  gitRevisionSchema,
  hashSchema,
  idSchema,
  operationNameSchema,
  repoPathSchema,
  scopeSchema,
  sourceRefSchema,
  timeSchema,
} from '../primitives.js';
import { refSchema } from '../primitives.js';
import {
  decisionKindSchema,
  decisionStateSchema,
  discoveryKindSchema,
  evidenceAvailabilitySchema,
  executionAvailabilitySchema,
  findingSeveritySchema,
  findingStateSchema,
  findingTargetKindSchema,
  intentSchema,
  levelSchema,
  phaseSchema,
  requirementStateSchema,
  roleSchema,
  taskStageSchema,
  workStatusSchema,
} from '../enums.js';
import {
  entityBaseShape,
  idRefListSchema,
  idRefSchema,
  list,
  nonNegativeIntSchema,
} from './common.js';

/** `work` — one routed request and its authorization envelope. */
export const workSchema = z.strictObject({
  ...entityBaseShape,
  intent: intentSchema,
  purpose: z.string().min(1),
  level: levelSchema,
  goal: z.string().min(1),
  scope: scopeSchema,
  sourceMessageId: idRefSchema.optional(),
  sourceRef: sourceRefSchema,
  authorizationRef: idRefSchema.optional(),
  requirementId: idRefSchema.optional(),
  status: workStatusSchema,
  blockerIds: idRefListSchema,
  baseRevision: gitRevisionSchema.optional(),
  budgetId: idRefSchema,
  policyRevision: nonNegativeIntSchema,
});
export type Work = z.infer<typeof workSchema>;

export const requirementPreviousLifecycleSchema = z.enum(['queued', 'completed']);
export const requirementSourceKindSchema = z.enum(['user_message', 'user_action']);
export const portableRefSchema = z.strictObject({
  path: repoPathSchema,
  revision: z.string().min(1),
  hash: hashSchema,
});
export type PortableRef = z.infer<typeof portableRefSchema>;

/** `requirement` — the local projection row plus its execution fields. */
export const requirementSchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema.optional(),
  title: z.string().min(1),
  goal: z.string().min(1),
  lifecycle: requirementStateSchema,
  previousLifecycle: requirementPreviousLifecycleSchema.optional(),
  phase: phaseSchema.optional(),
  productRef: refSchema.optional(),
  planRef: refSchema.optional(),
  sourceRef: sourceRefSchema,
  finalManifestId: idRefSchema.optional(),
  recordVersion: z.number().int().positive(),
  portableRef: portableRefSchema,
  executionAvailability: executionAvailabilitySchema,
  evidenceAvailability: evidenceAvailabilitySchema,
});
export type Requirement = z.infer<typeof requirementSchema>;

/** `task` — one unit of work inside a Work's plan DAG. */
export const taskSchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema,
  requirementId: idRefSchema.optional(),
  planRef: refSchema,
  role: roleSchema,
  dependsOn: idRefListSchema,
  dependencyRevision: gitRevisionSchema.optional(),
  dependencyManifestRefs: idRefListSchema,
  scope: scopeSchema,
  stage: taskStageSchema,
  acceptanceIds: list(z.string().min(1)),
  worktreeId: idRefSchema.optional(),
  latestManifestId: idRefSchema.optional(),
});
export type Task = z.infer<typeof taskSchema>;

/** `assessment` — immutable routing record; each re-assessment is a new row. */
export const assessmentSchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema,
  intent: intentSchema,
  level: levelSchema,
  semanticImpact: z.boolean(),
  riskFlags: list(z.string().min(1)),
  uncertainties: list(z.string().min(1)),
  authorizationRef: idRefSchema.optional(),
  policyRevision: nonNegativeIntSchema,
  reason: z.string().min(1),
});
export type Assessment = z.infer<typeof assessmentSchema>;

/** `authorization` — a user-sourced authority envelope; revocable, never forged. */
export const authorizationSchema = z.strictObject({
  ...entityBaseShape,
  sourceRef: sourceRefSchema,
  workId: idRefSchema,
  goal: z.string().min(1),
  scope: scopeSchema,
  // The same vocabulary as `Scope.operations`; a free string would let a typo sit
  // in the database as a permanently unusable grant (R15-02).
  operations: list(operationNameSchema),
  acceptedAt: timeSchema,
  revokedAt: timeSchema.optional(),
});
export type Authorization = z.infer<typeof authorizationSchema>;

/** `decision` — a pending or resolved product/permission choice. */
export const decisionSchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema,
  kind: decisionKindSchema,
  targetRef: refSchema,
  choices: list(z.string().min(1)),
  state: decisionStateSchema,
  choice: z.string().min(1).optional(),
  sourceMessageId: idRefSchema.optional(),
  actor: z.literal('user'),
  effectRefs: idRefListSchema,
});
export type Decision = z.infer<typeof decisionSchema>;

export const discoveryStateSchema = z.enum(['open', 'routed', 'resolved']);

/** `discovery` — a routed finding-of-fact; "不自动成为Requirement" (`data.md` §2). */
export const discoverySchema = z.strictObject({
  ...entityBaseShape,
  workId: idRefSchema,
  taskId: idRefSchema.optional(),
  kind: discoveryKindSchema,
  evidenceRefs: idRefListSchema,
  impactFlags: list(z.string().min(1)),
  route: z.string().min(1),
  state: discoveryStateSchema,
  decisionId: idRefSchema.optional(),
});
export type Discovery = z.infer<typeof discoverySchema>;

/** `finding` — a review/test result item; task targets must name their task. */
export const findingSchema = z
  .strictObject({
    ...entityBaseShape,
    workId: idRefSchema,
    taskId: idRefSchema.optional(),
    reviewRunId: idRefSchema,
    manifestId: idRefSchema,
    targetKind: findingTargetKindSchema,
    targetRef: refSchema,
    severity: findingSeveritySchema,
    blocking: z.boolean(),
    path: repoPathSchema.optional(),
    line: z.number().int().positive().optional(),
    evidenceRefs: idRefListSchema,
    description: z.string().min(1),
    state: findingStateSchema,
    resolutionRef: idRefSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetKind === 'task' && value.taskId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'task-targeted finding requires taskId' });
    }
  });
export type Finding = z.infer<typeof findingSchema>;

/** `PortableRequirement.acceptance` entry (`requirements.md` §2). */
export const requirementAcceptanceSchema = z.strictObject({
  id: z.string().min(1),
  given: z.string(),
  when: z.string(),
  then: z.string(),
});
export type RequirementAcceptance = z.infer<typeof requirementAcceptanceSchema>;

export const confirmedDecisionSchema = z.strictObject({
  id: z.string().min(1),
  summary: z.string().min(1),
  decidedAt: timeSchema,
  sourceKind: requirementSourceKindSchema,
});
export type ConfirmedDecision = z.infer<typeof confirmedDecisionSchema>;

export const requirementCompletionSchema = z.strictObject({
  completedAt: timeSchema,
  summary: z.string().min(1),
  codeRevision: gitRevisionSchema,
  codeTree: hashSchema,
  featureIds: list(z.string().min(1)),
  verificationSummary: z.string().min(1),
  remainingIssues: list(z.string().min(1)),
});
export type RequirementCompletion = z.infer<typeof requirementCompletionSchema>;

export const requirementCancellationSchema = z.strictObject({
  cancelledAt: timeSchema,
  reason: z.string().min(1),
});
export type RequirementCancellation = z.infer<typeof requirementCancellationSchema>;

/**
 * `RequirementMetadata` — the exact `requirement.json` content
 * (`docs/product/requirements.md` §2). `contentFile` is a fixed literal so a
 * record can never point at an arbitrary path.
 */
const requirementMetadataBase = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  version: z.number().int().positive(),
  contentFile: z.literal('content.md'),
  contentHash: hashSchema,
  createdAt: timeSchema,
  updatedAt: timeSchema,
  title: z.string().min(1),
  goal: z.string().min(1),
  scope: scopeSchema,
  lifecycle: requirementStateSchema,
  previousLifecycle: requirementPreviousLifecycleSchema.optional(),
  featureIds: list(z.string().min(1)),
  acceptance: list(requirementAcceptanceSchema),
  openQuestions: list(z.string().min(1)),
  confirmedDecisions: list(confirmedDecisionSchema),
  relatedRequirementIds: list(idSchema),
  completion: requirementCompletionSchema.optional(),
  cancellation: requirementCancellationSchema.optional(),
});

/**
 * Lifecycle facts a record can never omit (`requirements.md` §2): a completed
 * record — including one archived after completion — needs its summary, and a
 * cancelled record needs its reason.
 */
function refineRequirementLifecycle(
  value: {
    lifecycle: z.infer<typeof requirementStateSchema>;
    previousLifecycle?: 'queued' | 'completed' | undefined;
    completion?: unknown;
    cancellation?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  const needsCompletion =
    value.lifecycle === 'completed' ||
    (value.lifecycle === 'archived' && value.previousLifecycle === 'completed');
  if (needsCompletion && value.completion === undefined) {
    ctx.addIssue({ code: 'custom', message: 'completed requirement requires completion' });
  }
  if (value.lifecycle === 'cancelled' && value.cancellation === undefined) {
    ctx.addIssue({ code: 'custom', message: 'cancelled requirement requires cancellation' });
  }
}

export const requirementMetadataSchema = requirementMetadataBase.superRefine(
  refineRequirementLifecycle,
);
export type RequirementMetadata = z.infer<typeof requirementMetadataSchema>;

/** `PortableRequirement` — metadata plus the non-empty Markdown body. */
export const portableRequirementSchema = requirementMetadataBase
  .safeExtend({ contentMarkdown: z.string().min(1) })
  .superRefine(refineRequirementLifecycle);
export type PortableRequirement = z.infer<typeof portableRequirementSchema>;
