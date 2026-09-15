/**
 * Enumerations shared by every layer.
 *
 * The state machines and their transitions are owned by
 * `docs/rules/workflow.md` (data.md §2: "WorkStatus/RequirementState/TaskStage/
 * RunStatus/AttemptStatus/Phase枚举及转换以流程规则为唯一来源"), and roles,
 * purposes and intents come from `docs/rules/agents.md` +
 * `docs/product/experience.md`. This module only pins the *value sets*; the
 * domain package owns the legal transitions.
 */
import { z } from 'zod';

/** The eight fixed roles: chief plus the seven professional roles. */
export const roleSchema = z.enum([
  'chief',
  'product',
  'planning',
  'backend',
  'frontend',
  'review',
  'test',
  'settlement',
]);
export type Role = z.infer<typeof roleSchema>;
export const ROLES = roleSchema.options;

/** Roles a professional dispatch may target (every role except chief). */
export const professionalRoleSchema = roleSchema.exclude(['chief']);
export type ProfessionalRole = z.infer<typeof professionalRoleSchema>;
export const PROFESSIONAL_ROLES = professionalRoleSchema.options;

/** `Intent` — how a request is routed. */
export const intentSchema = z.enum(['assist', 'artifact', 'document', 'delivery', 'operation']);
export type Intent = z.infer<typeof intentSchema>;

/** Delivery level. `none` grants no modification authority. */
export const levelSchema = z.enum(['none', 'L1', 'L2', 'L3']);
export type Level = z.infer<typeof levelSchema>;

export const workStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'blocked',
  'paused',
  'cancelling',
  'cancelled',
  'failed',
]);
export type WorkStatus = z.infer<typeof workStatusSchema>;

export const blockerKindSchema = z.enum([
  'decision',
  'permission',
  'budget',
  'dependency',
  'provider',
  'test_environment',
  'recovery',
]);
export type BlockerKind = z.infer<typeof blockerKindSchema>;

export const requirementStateSchema = z.enum([
  'queued',
  'active',
  'completed',
  'cancelled',
  'archived',
]);
export type RequirementState = z.infer<typeof requirementStateSchema>;

/** Phases are only meaningful while a Requirement is active. */
export const phaseSchema = z.enum(['product', 'plan', 'execute', 'accept', 'settle']);
export type Phase = z.infer<typeof phaseSchema>;

export const taskStageSchema = z.enum(['ready', 'develop', 'review', 'test', 'done']);
export type TaskStage = z.infer<typeof taskStageSchema>;

export const runStatusSchema = z.enum([
  'queued',
  'starting',
  'running',
  'waiting_permission',
  'waiting_children',
  'paused',
  'interrupted',
  'recovery_required',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'contract_violation',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

/** Terminal Run states never continue; further work creates a new Run. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'contract_violation',
];

export const attemptStatusSchema = z.enum([
  'starting',
  'running',
  'stopped',
  'completed',
  'failed',
  'lost',
]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const discoveryKindSchema = z.enum([
  'defect',
  'technical_correction',
  'product_change',
  'followup',
  'blocking_risk',
]);
export type DiscoveryKind = z.infer<typeof discoveryKindSchema>;

export const findingSeveritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const findingStateSchema = z.enum(['open', 'addressed', 'verified', 'accepted_risk']);
export type FindingState = z.infer<typeof findingStateSchema>;

/** Findings may target a task, an integration or a document; only `task` needs taskId. */
export const findingTargetKindSchema = z.enum(['task', 'integration', 'document']);
export type FindingTargetKind = z.infer<typeof findingTargetKindSchema>;

export const decisionKindSchema = z.enum([
  'product',
  'start',
  'permission',
  'risk',
  'budget',
  'recovery',
]);
export type DecisionKind = z.infer<typeof decisionKindSchema>;

export const decisionStateSchema = z.enum(['pending', 'accepted', 'rejected', 'expired']);
export type DecisionState = z.infer<typeof decisionStateSchema>;

/** The nine artifact kinds the client renders as cards. */
export const ARTIFACT_CARD_KINDS = [
  'explanation',
  'product',
  'plan',
  'diff',
  'review',
  'test',
  'settlement',
  'decision',
  'recovery',
] as const;

/** The nine card-rendered artifact kinds plus attachment/log/evidence. */
export const artifactKindSchema = z.enum([...ARTIFACT_CARD_KINDS, 'attachment', 'log', 'evidence']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

/** Purpose of a dispatch or run (`agents.md` §3 plus the document/operation purposes). */
export const purposeSchema = z.enum([
  'analysis',
  'artifact',
  'implementation',
  'review',
  'test',
  'settlement',
  'initialize',
  'document',
  'document_check',
  'operation',
]);
export type Purpose = z.infer<typeof purposeSchema>;

export const grantScopeSchema = z.enum(['once', 'run', 'work', 'project']);
export type GrantScope = z.infer<typeof grantScopeSchema>;

export const messageSenderSchema = z.enum(['user', 'chief', 'role', 'system']);
export type MessageSender = z.infer<typeof messageSenderSchema>;

export const messageStateSchema = z.enum([
  'received',
  'processing',
  'processed',
  'decision_required',
  'failed',
]);
export type MessageState = z.infer<typeof messageStateSchema>;

export const stageResultStatusSchema = z.enum(['success', 'needs_input', 'failed']);
export type StageResultStatus = z.infer<typeof stageResultStatusSchema>;

/** Check outcomes used by Review and Test results. */
export const checkStatusSchema = z.enum(['passed', 'failed', 'not_covered', 'blocked']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

/** Execution permission modes. */
export const permissionModeSchema = z.enum(['workspace', 'autonomous', 'full_access']);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

/**
 * How the frozen sensitive-file table is read (`T3-implementation.md` 附录 A.7).
 *
 * `strict` (the global default) refuses the whole frozen list for read/search/edit;
 * `test` additionally allows the application-configuration subset while still refusing
 * the credential and key-material entries. There is deliberately no `open` tier: the
 * switch is a human declaration, and "the repository may leave the machine" must not
 * exist as a one-click setting.
 */
export const configPolicySchema = z.enum(['strict', 'test']);
export type ConfigPolicy = z.infer<typeof configPolicySchema>;

export const projectStateSchema = z.enum(['open', 'closed']);
export type ProjectState = z.infer<typeof projectStateSchema>;

export const trustStateSchema = z.enum(['untrusted', 'trusted']);
export type TrustState = z.infer<typeof trustStateSchema>;

/** Requirement execution availability after a Git import. */
export const executionAvailabilitySchema = z.enum(['local', 'needs_replan']);
export type ExecutionAvailability = z.infer<typeof executionAvailabilitySchema>;

/** Whether the full evidence or only a Git summary survived a migration. */
export const evidenceAvailabilitySchema = z.enum(['full', 'summary_only']);
export type EvidenceAvailability = z.infer<typeof evidenceAvailabilitySchema>;

/** Provider connection kinds accepted by the model gateway. */
export const providerTypeSchema = z.enum(['openai-compatible', 'anthropic', 'google']);
export type ProviderType = z.infer<typeof providerTypeSchema>;

/** Reasoning effort levels; a provider that cannot map a value must fail validation. */
export const reasoningLevelSchema = z.enum(['off', 'low', 'medium', 'high']);
export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;
