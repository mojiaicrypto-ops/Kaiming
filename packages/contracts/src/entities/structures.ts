/**
 * Structured artifacts shared by commands and clients (`data.md` §3).
 *
 * These are the shapes a Run submits, a Plan freezes, and a VerificationManifest
 * binds. They are deliberately separate from the storage rows: a client never
 * sets `taskId`/`runId`/`attemptId`, which the Core derives from the capability
 * ("taskId/runId/attemptId由Capability与请求封装取得，客户端不能伪造归属").
 */
import { partialRecord, z } from 'zod';
import { LIMITS } from '../limits.js';
import {
  gitRevisionSchema,
  hashSchema,
  idSchema,
  refSchema,
  repoPathSchema,
  scopeSchema,
  sourceRefSchema,
  timeSchema,
} from '../primitives.js';
import {
  artifactKindSchema,
  checkStatusSchema,
  configPolicySchema,
  levelSchema,
  permissionModeSchema,
  providerTypeSchema,
  purposeSchema,
  reasoningLevelSchema,
  roleSchema,
  stageResultStatusSchema,
} from '../enums.js';
import { jsonObjectSchema, list, nonNegativeIntSchema } from './common.js';
import { requirementAcceptanceSchema } from './work.js';

/** `Assessment` — the routing payload Chief submits (`data.md` §3). */
export const assessmentPayloadSchema = z.strictObject({
  intent: z.enum(['assist', 'artifact', 'document', 'delivery', 'operation']),
  goal: z.string().min(1),
  scope: scopeSchema,
  level: levelSchema,
  semanticImpact: z.boolean(),
  riskFlags: list(z.string().min(1)),
  uncertainties: list(z.string().min(1)),
  authorizationRef: idSchema.optional(),
  policyRevision: nonNegativeIntSchema,
  reason: z.string().min(1),
});
export type AssessmentPayload = z.infer<typeof assessmentPayloadSchema>;

/** `ContextSelection` — Chief's explicit, justified input selection. */
export const contextSelectionSchema = z.strictObject({
  goal: z.string().min(1),
  sourceRefs: list(sourceRefSchema),
  /** Every `sourceRefs` entry needs a reason; enforced below. */
  reasonPerSource: z.record(z.string(), z.string().min(1)),
  featureRefs: list(z.string().min(1)),
  codePaths: list(repoPathSchema),
  artifactRefs: list(refSchema),
  excluded: list(z.string().min(1)),
  unknowns: list(z.string().min(1)),
  readBudget: z.strictObject({
    initialTokens: nonNegativeIntSchema,
    expansionTokens: nonNegativeIntSchema,
  }),
});
export type ContextSelection = z.infer<typeof contextSelectionSchema>;

/** Fails when any selected source lacks its written reason (`data.md` §3). */
export function missingSelectionReasons(selection: ContextSelection): string[] {
  return selection.sourceRefs
    .map((source) => `${source.kind}:${source.id}`)
    .filter((key) => selection.reasonPerSource[key] === undefined);
}

/** `Profile` — one role's model and tool configuration (`rules/agents.md` §5). */
export const profileSchema = z.strictObject({
  providerId: idSchema,
  modelId: z.string().min(1),
  reasoning: reasoningLevelSchema,
  skills: list(z.string().min(1)),
  toolSubset: list(z.string().min(1)),
  contextLimit: z.number().int().min(4_096).max(2_000_000),
  temperature: z.number().min(0).max(2).optional(),
});
export type Profile = z.infer<typeof profileSchema>;

/** Context limit bounds (`rules/agents.md` §6). */
export const CONTEXT_LIMIT_BOUNDS = { min: 4_096, max: 2_000_000 } as const;

/**
 * Overridable architecture limits (`ARCHITECTURE.md` §5).
 *
 * Only entries that the document does not mark as fixed constants appear here;
 * a fixed value such as `taskWriterCount` cannot be patched at all.
 */
const overridableLimitNames = [
  'globalConcurrentRunners',
  'projectConcurrentRunners',
  'roleConcurrency',
  'workInputOutputTokens',
  'workActiveTimeSec',
  'reviewRepairRounds',
  'shellTimeoutSec',
] as const;
export type OverridableLimitName = (typeof overridableLimitNames)[number];

const boundedLimit = (name: OverridableLimitName): z.ZodNumber => {
  const bounds = LIMITS[name];
  return z.number().int().min(bounds.min).max(bounds.max);
};

export const configLimitsSchema = z
  .strictObject(
    Object.fromEntries(
      overridableLimitNames.map((name) => [name, boundedLimit(name).optional()]),
    ) as { [K in OverridableLimitName]: z.ZodOptional<z.ZodNumber> },
  )
  .partial();
export type ConfigLimits = z.infer<typeof configLimitsSchema>;

/** `ConfigPatch` — the only configurable surface (`data.md` §3, protocol §5). */
export const configPatchSchema = z.strictObject({
  // `Role` keys are a table, not an exhaustive record: a patch overrides only the
  // roles it names, and the rest keep inheriting (data.md §3 config.update).
  roleOverrides: partialRecord(roleSchema, profileSchema.partial()).optional(),
  limits: configLimitsSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  /**
   * The sensitive-file tier a human sets (`T3-implementation.md` 附录 A.7).
   *
   * Deliberately part of the ordinary config patch and **not** a protocol method of its
   * own: it shares `permissionMode`'s model (global default, project override), and an
   * agent has no entry to either (`protocol.md` §5).
   */
  configPolicy: configPolicySchema.optional(),
  l3Paths: list(repoPathSchema).optional(),
  l3Keywords: list(z.string().min(1)).optional(),
  testCommands: list(z.string().min(1)).optional(),
});
export type ConfigPatch = z.infer<typeof configPatchSchema>;

/** One configured model of a provider (`rules/agents.md` §5). */
export const modelDescriptorSchema = z.strictObject({
  id: z.string().min(1),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  reasoningLevels: list(reasoningLevelSchema),
  vision: z.boolean(),
  inputPricePerMTokens: z.number().nonnegative().optional(),
  outputPricePerMTokens: z.number().nonnegative().optional(),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

/** `ProviderInput` — a connection; the secret itself never appears here. */
export const providerInputSchema = z.strictObject({
  providerId: idSchema.optional(),
  type: providerTypeSchema,
  baseUrl: z.string().url(),
  enabled: z.boolean(),
  secretRef: z.string().min(1).optional(),
  models: list(modelDescriptorSchema),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

/** A configured provider, as persisted in `config.toml` (`rules/agents.md` §5). */
export const providerConfigSchema = providerInputSchema.safeExtend({
  providerId: idSchema,
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** Deployment policy that `config.update` may patch (`protocol.md` §5). */
export const policyConfigSchema = z.strictObject({
  permissionMode: permissionModeSchema,
  /**
   * The sensitive-file tier (`T3-implementation.md` 附录 A.7).
   *
   * It lives in the policy document rather than in a Run column, so it travels with the
   * same global-default/project-override resolution as `permissionMode`, is part of
   * `policyHash` (what a `VerificationManifest` binds), and is part of the `policy`
   * context a Run is dispatched with — no migration and no new protocol method.
   *
   * A file written before the tier existed is normalised to the documented default
   * `strict` when it is read (`config.ts` `normalizePolicyTier`), so the effective policy
   * a caller sees always names its value instead of leaving it to be inferred.
   */
  configPolicy: configPolicySchema,
  l3Paths: list(repoPathSchema),
  l3Keywords: list(z.string().min(1)),
  testCommands: list(z.string().min(1)),
});
export type PolicyConfig = z.infer<typeof policyConfigSchema>;

/**
 * One configuration scope's document (`ARCHITECTURE.md` §5).
 *
 * `config.get` returns this shape, and `config.update` writes it: role overrides
 * are partial because inheritance fills the rest, the default profile is complete
 * because it is the last layer, and providers exist only in the global scope.
 */
export const configDocumentSchema = z.strictObject({
  version: nonNegativeIntSchema,
  defaultProfile: profileSchema.optional(),
  roleProfiles: partialRecord(roleSchema, profileSchema.partial()),
  providers: list(providerConfigSchema),
  limits: configLimitsSchema,
  policy: policyConfigSchema,
});
export type ConfigDocument = z.infer<typeof configDocumentSchema>;

/** `ProfessionalDispatchSpec` — a professional Run request (`data.md` §3). */
export const professionalDispatchSpecSchema = z.strictObject({
  kind: z.literal('professional'),
  workId: idSchema,
  requirementId: idSchema.optional(),
  taskId: idSchema.optional(),
  role: roleSchema.exclude(['chief']),
  purpose: purposeSchema,
  goal: z.string().min(1),
  scope: scopeSchema,
  stage: z.string().min(1),
  contextSelection: contextSelectionSchema,
  profileRevision: nonNegativeIntSchema,
  requiredOutputs: list(z.string().min(1)),
  requiredChild: z.boolean(),
  joinPolicy: z.enum(['none', 'all']),
  budgetAllocation: nonNegativeIntSchema,
  parentRunId: idSchema,
});
export type ProfessionalDispatchSpec = z.infer<typeof professionalDispatchSpecSchema>;

/** `ChiefDispatchSpec` — built by Core, never by an agent (`data.md` §3). */
export const chiefDispatchSpecSchema = z.strictObject({
  kind: z.literal('chief'),
  workId: idSchema,
  role: z.literal('chief'),
  purpose: z.enum(['analysis', 'artifact']),
  goal: z.string().min(1),
  scope: scopeSchema,
  stage: z.enum(['assist', 'coordinate']),
  contextSelection: contextSelectionSchema,
  profileRevision: nonNegativeIntSchema,
  requiredOutputs: list(z.string().min(1)),
  budgetAllocation: nonNegativeIntSchema,
});
export type ChiefDispatchSpec = z.infer<typeof chiefDispatchSpecSchema>;

export const dispatchSpecSchema = z.discriminatedUnion('kind', [
  chiefDispatchSpecSchema,
  professionalDispatchSpecSchema,
]);
export type DispatchSpec = z.infer<typeof dispatchSpecSchema>;

/**
 * The extra frozen inputs of a dispatch that are not part of the spec itself.
 *
 * `data.md` §3 freezes them with the DispatchSnapshot; validating them here keeps a
 * malformed request from leaving snapshot rows behind (DC-58).
 */
export const dispatchExtrasSchema = z.strictObject({
  authorizationRef: idSchema.optional(),
  requiredOutputSchemas: list(
    z.strictObject({ kind: z.string().min(1), schemaVersion: z.literal(1) }),
  ).optional(),
  contextPayload: jsonObjectSchema.optional(),
  /**
   * Authorized Run parameters (`agents.md` §5).
   *
   * Validated as a profile patch, so a bad field is a `VALIDATION_ERROR` instead of
   * a misleading `PROVIDER_UNAVAILABLE` from the availability check (R10-05).
   */
  runParams: profileSchema.partial().optional(),
});
export type DispatchExtras = z.infer<typeof dispatchExtrasSchema>;

/**
 * `agent.request_dispatch` (`protocol.md` §6).
 *
 * The documented parameters are `workId,reason,requestedRole,goal,sourceRefs`;
 * `runId` is the capability's Run binding and the remaining optional fields let a
 * caller be more specific without gaining the right to create the Run.
 */
export const dispatchRequestSchema = z.strictObject({
  runId: idSchema,
  workId: idSchema.optional(),
  reason: z.string().trim().min(1).optional(),
  requestedRole: roleSchema,
  goal: z.string().trim().min(1),
  sourceRefs: list(sourceRefSchema).optional(),
  parentRunId: idSchema.optional(),
  purpose: purposeSchema.optional(),
  // The value set is the Chief's dispatch vocabulary, documented by WP-04; the
  // bound keeps an arbitrary string from being persisted unbounded (R10-04/M-3).
  stage: z.string().trim().min(1).max(64).optional(),
  requiredOutputs: list(z.string().min(1)).optional(),
  requiredChild: z.boolean().optional(),
  budgetAllocation: nonNegativeIntSchema.optional(),
  // `reliability.md` §1 keys outbox delivery on operationId; a blank or unbounded
  // key would either collide or be stored verbatim in the event log.
  operationId: z.string().trim().min(1).max(128).optional(),
});
export type DispatchRequest = z.infer<typeof dispatchRequestSchema>;

/**
 * `assessment.submit` (`protocol.md` §6 names the parameter `assessment`).
 *
 * The Core API keeps its own `payload` field name; the protocol mapping is applied
 * at the boundary so both spellings cannot drift apart.
 */
export const assessRequestSchema = z.strictObject({
  workId: idSchema,
  assessment: assessmentPayloadSchema,
});
export type AssessRequest = z.infer<typeof assessRequestSchema>;

/** `DispatchSnapshot` — frozen before a Run is queued (`data.md` §3). */
export const dispatchSnapshotSchema = z.strictObject({
  dispatchSpec: dispatchSpecSchema,
  authorizationRef: idSchema.optional(),
  effectiveScope: scopeSchema,
  requiredOutputSchemas: list(
    z.strictObject({ kind: z.string().min(1), schemaVersion: z.literal(1) }),
  ),
  profileRevision: nonNegativeIntSchema,
  contextSnapshotId: hashSchema,
  hash: hashSchema,
});
export type DispatchSnapshot = z.infer<typeof dispatchSnapshotSchema>;

/** `ProductDefinition` — the approved product baseline for a Work. */
export const productDefinitionSchema = z.strictObject({
  goal: z.string().min(1),
  scope: scopeSchema,
  behaviors: list(
    z.strictObject({
      id: z.string().min(1),
      trigger: z.string().min(1),
      expected: z.string().min(1),
      failure: z.string().min(1),
    }),
  ),
  acceptance: list(requirementAcceptanceSchema),
  constraints: list(z.string().min(1)),
  decisionRefs: list(idSchema),
  featureRefs: list(z.string().min(1)),
});
export type ProductDefinition = z.infer<typeof productDefinitionSchema>;

export const planTaskSchema = z.strictObject({
  id: idSchema,
  role: roleSchema,
  goal: z.string().min(1),
  paths: list(repoPathSchema),
  dependsOn: list(idSchema),
  acceptanceIds: list(z.string().min(1)),
  checks: list(z.string().min(1)),
});
export type PlanTask = z.infer<typeof planTaskSchema>;

/** `Plan` — the versioned implementation plan (`data.md` §3). */
export const planSchema = z.strictObject({
  version: z.number().int().positive(),
  productRef: refSchema.optional(),
  goal: z.string().min(1),
  scope: scopeSchema,
  tasks: list(planTaskSchema),
  interfaceChanges: list(z.string().min(1)),
  dataChanges: list(z.string().min(1)),
  risks: list(z.string().min(1)),
  rollback: list(z.string().min(1)),
  approval: z.enum(['auto', 'user']),
  authorizationRef: idSchema,
});
export type Plan = z.infer<typeof planSchema>;

/** `CompactPlan` — the L1 one-liner, stored as a `plan` Artifact. */
export const compactPlanSchema = z.strictObject({
  goal: z.string().min(1),
  paths: list(repoPathSchema),
  expectedChange: z.string().min(1),
  check: z.string().min(1),
  authorizationRef: idSchema,
  policyRevision: nonNegativeIntSchema,
});
export type CompactPlan = z.infer<typeof compactPlanSchema>;

const checkEntrySchema = z
  .strictObject({
    acceptanceIds: list(z.string().min(1)),
    command: z.string().min(1).optional(),
    procedure: z.string().min(1).optional(),
    environmentRef: idSchema,
    inputTree: hashSchema,
    exitCode: z.number().int().optional(),
    outputRef: idSchema,
    result: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.command === undefined && value.procedure === undefined) {
      ctx.addIssue({ code: 'custom', message: 'a check needs a command or a procedure' });
    }
    if (value.command !== undefined && value.exitCode === undefined) {
      ctx.addIssue({ code: 'custom', message: 'an automated check must record its exit code' });
    }
  });

/** `CheckResult` — executed evidence, never a self-assessment (`data.md` §3). */
export const checkResultSchema = z.strictObject({
  status: checkStatusSchema,
  checks: list(checkEntrySchema),
  uncovered: list(
    z.strictObject({
      acceptanceId: z.string().min(1),
      reason: z.string().min(1),
      riskDecisionId: idSchema.optional(),
    }),
  ),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

/** `ReviewResult` / `TestResult` — a bound report; Test uses the same shape. */
export const reviewResultSchema = z.strictObject({
  manifestId: idSchema,
  findingIds: list(idSchema),
  checkResult: checkResultSchema,
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export const testResultSchema = reviewResultSchema;
export type TestResult = ReviewResult;

/** `SettlementResult` — what settlement changed and what remains open. */
export const settlementResultSchema = z.strictObject({
  finalRevision: gitRevisionSchema,
  codeTree: hashSchema,
  updatedDocs: list(repoPathSchema),
  featureIds: list(z.string().min(1)),
  navigationChecks: list(idSchema),
  evidenceRefs: list(idSchema),
  unresolved: list(idSchema),
});
export type SettlementResult = z.infer<typeof settlementResultSchema>;

/** `VerificationManifest` — what exactly was verified (`data.md` §3). */
export const verificationManifestSchema = z.strictObject({
  workId: idSchema,
  taskId: idSchema.optional(),
  level: levelSchema,
  route: z.string().min(1),
  productRef: refSchema.optional(),
  planRef: refSchema,
  dependencyRevision: gitRevisionSchema,
  dependencyManifestRefs: list(idSchema),
  codeRevision: gitRevisionSchema,
  codeTree: hashSchema,
  policyHash: hashSchema,
  contextSnapshotId: idSchema,
  readLedgerSeq: nonNegativeIntSchema,
  readLedgerHash: hashSchema,
  configHash: hashSchema,
  environmentRef: idSchema,
  acceptanceIds: list(z.string().min(1)),
});
export type VerificationManifest = z.infer<typeof verificationManifestSchema>;

/** `CompletionManifest` — the final, hash-bound completion list. */
export const completionManifestSchema = z.strictObject({
  workId: idSchema,
  requirementId: idSchema.optional(),
  verifiedManifestIds: list(idSchema),
  finalRevision: gitRevisionSchema,
  verifiedCodeTree: hashSchema,
  knowledgeTree: hashSchema,
  settlementResultRef: idSchema,
  riskDecisionIds: list(idSchema),
});
export type CompletionManifest = z.infer<typeof completionManifestSchema>;

/** `StageResult` — the submission shape of `stage_result` (`data.md` §3). */
export const stageResultSchema = z.strictObject({
  status: stageResultStatusSchema,
  summary: z.string().min(1),
  artifactRefs: list(refSchema),
  evidenceRefs: list(idSchema),
  changedPaths: list(repoPathSchema),
  findingIds: list(idSchema),
  unknowns: list(z.string().min(1)),
  requestedActions: list(z.string().min(1)),
  readLedgerSeq: nonNegativeIntSchema,
  readLedgerHash: hashSchema,
  manifestId: idSchema.optional(),
  checkResult: checkResultSchema.optional(),
});
export type StageResult = z.infer<typeof stageResultSchema>;

/** An artifact reference as rendered in lists and cards. */
export const artifactSummarySchema = z.strictObject({
  artifactId: idSchema,
  workId: idSchema.optional(),
  kind: artifactKindSchema,
  artifactVersion: z.number().int().positive(),
  mime: z.string().min(1),
  bytes: nonNegativeIntSchema,
  createdAt: timeSchema,
  validity: z.enum(['valid', 'invalid']),
});
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;

/** Free-form JSON payload column with a stable schema binding. */
export const payloadColumnSchema = jsonObjectSchema;
