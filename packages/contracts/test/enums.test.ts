import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CARD_KINDS,
  PROFESSIONAL_ROLES,
  ROLES,
  TERMINAL_RUN_STATUSES,
  artifactKindSchema,
  attemptStatusSchema,
  blockerKindSchema,
  checkStatusSchema,
  decisionKindSchema,
  decisionStateSchema,
  discoveryKindSchema,
  evidenceAvailabilitySchema,
  executionAvailabilitySchema,
  findingSeveritySchema,
  findingStateSchema,
  findingTargetKindSchema,
  grantScopeSchema,
  intentSchema,
  levelSchema,
  messageSenderSchema,
  messageStateSchema,
  permissionModeSchema,
  phaseSchema,
  professionalRoleSchema,
  projectStateSchema,
  providerTypeSchema,
  purposeSchema,
  reasoningLevelSchema,
  requirementStateSchema,
  roleSchema,
  runStatusSchema,
  stageResultStatusSchema,
  taskStageSchema,
  trustStateSchema,
  workStatusSchema,
} from '../src/index.js';

/**
 * These assertions pin the value sets to the specification. A changed length
 * means a contract change, not a refactor.
 */
describe('enum membership', () => {
  const cases: ReadonlyArray<[string, { options: readonly string[] }, number]> = [
    ['role', roleSchema, 8],
    ['professionalRole', professionalRoleSchema, 7],
    ['intent', intentSchema, 5],
    ['level', levelSchema, 4],
    ['workStatus', workStatusSchema, 8],
    ['blockerKind', blockerKindSchema, 7],
    ['requirementState', requirementStateSchema, 5],
    ['phase', phaseSchema, 5],
    ['taskStage', taskStageSchema, 5],
    ['runStatus', runStatusSchema, 13],
    ['attemptStatus', attemptStatusSchema, 6],
    ['discoveryKind', discoveryKindSchema, 5],
    ['findingSeverity', findingSeveritySchema, 4],
    ['findingState', findingStateSchema, 4],
    ['findingTargetKind', findingTargetKindSchema, 3],
    ['decisionKind', decisionKindSchema, 6],
    ['decisionState', decisionStateSchema, 4],
    ['artifactKind', artifactKindSchema, 12],
    ['purpose', purposeSchema, 10],
    ['grantScope', grantScopeSchema, 4],
    ['messageSender', messageSenderSchema, 4],
    ['messageState', messageStateSchema, 5],
    ['stageResultStatus', stageResultStatusSchema, 3],
    ['checkStatus', checkStatusSchema, 4],
    ['permissionMode', permissionModeSchema, 3],
    ['projectState', projectStateSchema, 2],
    ['trustState', trustStateSchema, 2],
    ['executionAvailability', executionAvailabilitySchema, 2],
    ['evidenceAvailability', evidenceAvailabilitySchema, 2],
    ['providerType', providerTypeSchema, 3],
    ['reasoningLevel', reasoningLevelSchema, 4],
  ];

  for (const [name, schema, size] of cases) {
    it(`${name} has ${size} documented values`, () => {
      expect(schema.options).toHaveLength(size);
    });
  }
});

describe('role model', () => {
  it('is chief plus the seven professional roles', () => {
    expect(ROLES).toContain('chief');
    expect(PROFESSIONAL_ROLES).not.toContain('chief');
    expect(ROLES).toHaveLength(PROFESSIONAL_ROLES.length + 1);
    expect([...PROFESSIONAL_ROLES]).toEqual([
      'product',
      'planning',
      'backend',
      'frontend',
      'review',
      'test',
      'settlement',
    ]);
  });
});

describe('run and artifact specifics', () => {
  it('marks exactly five terminal run statuses', () => {
    expect([...TERMINAL_RUN_STATUSES].sort()).toEqual(
      ['cancelled', 'completed', 'contract_violation', 'failed', 'timed_out'].sort(),
    );
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(runStatusSchema.options).toContain(status);
    }
  });

  it('renders nine artifact cards and keeps attachment/log/evidence as references', () => {
    expect(ARTIFACT_CARD_KINDS).toHaveLength(9);
    expect(ARTIFACT_CARD_KINDS).toEqual([
      'explanation',
      'product',
      'plan',
      'diff',
      'review',
      'test',
      'settlement',
      'decision',
      'recovery',
    ]);
    expect(artifactKindSchema.options).toHaveLength(ARTIFACT_CARD_KINDS.length + 3);
  });

  it('rejects an undeclared value', () => {
    expect(roleSchema.safeParse('architect').success).toBe(false);
    expect(runStatusSchema.safeParse('done').success).toBe(false);
    expect(levelSchema.safeParse('L4').success).toBe(false);
  });
});
