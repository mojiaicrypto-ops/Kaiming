import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  artifactSchema,
  assessmentSchema,
  attachmentSchema,
  attemptSchema,
  authorizationSchema,
  budgetSchema,
  commandSchema,
  conversationSchema,
  decisionSchema,
  discoverySchema,
  eventSchema,
  featureProjectionSchema,
  findingSchema,
  grantSchema,
  leaseSchema,
  messageBodySchema,
  messageSchema,
  operationSchema,
  outboxSchema,
  portableRequirementSchema,
  projectSchema,
  requirementSchema,
  runSchema,
  snapshotSchema,
  stageResultRowSchema,
  taskSchema,
  toolOperationSchema,
  userActionSchema,
  workSchema,
} from '../src/index.js';

/**
 * AC-055 / AC-065 schema evidence: every table in `data.md` §2 has a schema, and
 * the cross-field constraints the document states hold. The table list below is
 * the document's own list — a table without a schema fails the first test.
 */
const ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const ID2 = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
/** `SHA256(canonicalRoot)` truncated to 32 hex (`ARCHITECTURE.md` §4). */
const PROJECT_ID = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const PROJECT = 'a'.repeat(32);
const HASH = 'b'.repeat(64);
const TIME = '2026-09-11T00:00:00.000Z';
const REVISION = 'c'.repeat(40);
const REF = { id: ID, version: 1, hash: HASH };
const SCOPE = { readPaths: [], writePaths: [], operations: [], networkTargets: [] };
const SOURCE_REF = { kind: 'message' as const, id: ID, version: '1' };
const BASE = { id: ID, projectId: PROJECT, version: 1, createdAt: TIME, updatedAt: TIME };

/** The table list exactly as written in `docs/architecture/data.md` §2. */
const DOCUMENTED_TABLES = [
  'project',
  'conversation',
  'message_body',
  'user_action',
  'message',
  'work',
  'requirement',
  'task',
  'assessment',
  'authorization',
  'decision',
  'discovery',
  'finding',
  'run',
  'attempt',
  'attachment',
  'artifact',
  'stage_result',
  'snapshot',
  'grant',
  'budget',
  'command',
  'event',
  'outbox',
  'tool_operation',
  'lease',
  'operation',
  'feature_projection',
] as const;

/** Union of the documented table names. */
type TableName = (typeof DOCUMENTED_TABLES)[number];

/** One minimal valid row per documented table. */
const rows = {
  project: {
    // The project row's id *is* the project id: 32 hex, not a UUIDv7.
    id: PROJECT_ID,
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
    root: '/tmp/root',
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
  },
  conversation: { ...BASE, title: 'chat', archived: false },
  message_body: {
    ...BASE,
    ownerKind: 'user',
    ownerUserId: ID2,
    mime: 'text/markdown',
    contentHash: HASH,
    relativeBlobPath: 'blobs/aa',
    bytes: 3,
  },
  user_action: { ...BASE, actorId: ID2, action: 'work.pause', payload: {}, payloadHash: HASH },
  message: {
    ...BASE,
    conversationId: ID2,
    seq: 1,
    sender: 'user',
    bodyRef: ID2,
    state: 'received',
    resultRefs: [],
  },
  work: {
    ...BASE,
    intent: 'delivery',
    purpose: 'implementation',
    level: 'L2',
    goal: 'ship WP-01',
    scope: SCOPE,
    sourceRef: SOURCE_REF,
    status: 'queued',
    blockerIds: [],
    budgetId: ID2,
    policyRevision: 0,
  },
  requirement: {
    ...BASE,
    title: 'req',
    goal: 'goal',
    lifecycle: 'queued',
    sourceRef: SOURCE_REF,
    recordVersion: 1,
    portableRef: { path: '.agentdev/requirements/x', revision: REVISION, hash: HASH },
    executionAvailability: 'local',
    evidenceAvailability: 'full',
  },
  task: {
    ...BASE,
    workId: ID2,
    planRef: REF,
    role: 'backend',
    dependsOn: [],
    dependencyManifestRefs: [],
    scope: SCOPE,
    stage: 'ready',
    acceptanceIds: ['AC-055'],
  },
  assessment: {
    ...BASE,
    workId: ID2,
    intent: 'delivery',
    level: 'L2',
    semanticImpact: false,
    riskFlags: [],
    uncertainties: [],
    policyRevision: 0,
    reason: 'routed',
  },
  authorization: {
    ...BASE,
    sourceRef: SOURCE_REF,
    workId: ID2,
    goal: 'goal',
    scope: SCOPE,
    operations: ['read'],
    acceptedAt: TIME,
  },
  decision: {
    ...BASE,
    workId: ID2,
    kind: 'product',
    targetRef: REF,
    choices: ['a', 'b'],
    state: 'pending',
    actor: 'user',
    effectRefs: [],
  },
  discovery: {
    ...BASE,
    workId: ID2,
    kind: 'defect',
    evidenceRefs: [],
    impactFlags: ['P1'],
    route: 'rework',
    state: 'open',
  },
  finding: {
    ...BASE,
    workId: ID2,
    taskId: ID2,
    reviewRunId: ID2,
    manifestId: ID2,
    targetKind: 'task',
    targetRef: REF,
    severity: 'P1',
    blocking: true,
    evidenceRefs: [],
    description: 'bug',
    state: 'open',
  },
  run: {
    ...BASE,
    workId: ID2,
    role: 'chief',
    purpose: 'analysis',
    stage: 'assist',
    status: 'queued',
    requiredChild: false,
    join: 'none',
    childIds: [],
    // Snapshots are content-addressed, so Runs reference hashes (`data.md` §2).
    configSnapshotId: HASH,
    contextSnapshotId: HASH,
    dispatchSnapshotId: HASH,
    budgetAllocation: 1000,
  },
  attempt: {
    ...BASE,
    runId: ID2,
    number: 1,
    status: 'starting',
    ownerEpoch: 1,
  },
  attachment: {
    ...BASE,
    conversationId: ID2,
    ownerUserId: ID2,
    mime: 'text/plain',
    state: 'staged',
    expiresAt: TIME,
    contentHash: HASH,
    relativeBlobPath: 'blobs/aa',
    bytes: 1,
  },
  artifact: {
    ...BASE,
    workId: ID2,
    runId: ID2,
    origin: 'agent',
    kind: 'diff',
    artifactVersion: 1,
    contentHash: HASH,
    relativeBlobPath: 'blobs/aa',
    mime: 'text/plain',
    bytes: 1,
    validity: 'valid',
    acl: ['chief'],
  },
  stage_result: {
    ...BASE,
    taskId: ID2,
    runId: ID2,
    attemptId: ID2,
    status: 'success',
    summary: 'done',
    artifactRefs: [],
    evidenceRefs: [],
    changedPaths: [],
    findingIds: [],
    unknowns: [],
    requestedActions: [],
    readLedgerSeq: 1,
    readLedgerHash: HASH,
  },
  snapshot: { type: 'context', hash: HASH, payload: {}, blobPath: 'blobs/aa', createdAt: TIME },
  grant: {
    ...BASE,
    workId: ID2,
    scope: 'work',
    role: 'backend',
    stage: 'develop',
    operation: 'edit',
    targets: ['src/a.ts'],
    expiresAt: TIME,
    limits: {},
    decisionId: ID2,
  },
  budget: {
    ...BASE,
    workId: ID2,
    tokenLimit: 100,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 60,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  },
  command: {
    ...BASE,
    subject: 'user:abc',
    operation: 'work.pause',
    key: 'k1',
    payloadHash: HASH,
    state: 'accepted',
    response: {},
  },
  event: {
    cursor: 1,
    eventId: ID,
    name: 'work.control_changed',
    entityId: ID2,
    entityVersion: 2,
    data: {},
    occurredAt: TIME,
  },
  outbox: {
    ...BASE,
    operationId: ID,
    kind: 'integrate',
    payload: {},
    state: 'pending',
    attempts: 0,
  },
  tool_operation: {
    ...BASE,
    workId: ID2,
    runId: ID2,
    attemptId: ID2,
    epoch: 1,
    toolName: 'edit',
    inputHash: HASH,
    argsRef: ID2,
    state: 'prepared',
  },
  lease: { ...BASE, resource: 'integration:proj', ownerAttemptId: ID2, epoch: 1, expiresAt: TIME },
  operation: {
    ...BASE,
    sourceRef: SOURCE_REF,
    kind: 'requirement_save',
    state: 'pending',
    stepResults: {},
  },
  feature_projection: {
    ...BASE,
    revision: REVISION,
    featureId: 'F-12345678',
    documentPath: 'docs/features/a.md',
    documentHash: HASH,
    fields: {},
    relations: {},
    state: 'valid',
  },
};

const schemas: Record<TableName, z.ZodType> = {
  project: projectSchema,
  conversation: conversationSchema,
  message_body: messageBodySchema,
  user_action: userActionSchema,
  message: messageSchema,
  work: workSchema,
  requirement: requirementSchema,
  task: taskSchema,
  assessment: assessmentSchema,
  authorization: authorizationSchema,
  decision: decisionSchema,
  discovery: discoverySchema,
  finding: findingSchema,
  run: runSchema,
  attempt: attemptSchema,
  attachment: attachmentSchema,
  artifact: artifactSchema,
  stage_result: stageResultRowSchema,
  snapshot: snapshotSchema,
  grant: grantSchema,
  budget: budgetSchema,
  command: commandSchema,
  event: eventSchema,
  outbox: outboxSchema,
  tool_operation: toolOperationSchema,
  lease: leaseSchema,
  operation: operationSchema,
  feature_projection: featureProjectionSchema,
};

describe('entity schemas', () => {
  it('covers every table documented in data.md §2', () => {
    expect(Object.keys(schemas).sort()).toEqual([...DOCUMENTED_TABLES].sort());
  });

  it('accepts one valid row per table', () => {
    for (const table of DOCUMENTED_TABLES) {
      const schema = schemas[table];
      const parsed = schema.safeParse(rows[table]);
      expect(parsed.success, `${table}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('rejects an undeclared field on every table', () => {
    for (const table of DOCUMENTED_TABLES) {
      const row = { ...(rows[table] as Record<string, unknown>), undeclared: 1 };
      expect(schemas[table].safeParse(row).success, table).toBe(false);
    }
  });
});

describe('documented cross-field constraints', () => {
  const row = (table: TableName, patch: Record<string, unknown>): unknown => ({
    ...(rows[table] as Record<string, unknown>),
    ...patch,
  });

  it('keys the project row by the canonical-root hash, not a UUIDv7', () => {
    expect(projectSchema.safeParse(rows.project).success).toBe(true);
    // A UUIDv7 is the id form of every other table; the project id is not.
    expect(projectSchema.safeParse({ ...rows.project, id: ID }).success).toBe(false);
    expect(projectSchema.safeParse({ ...rows.project, id: 'A'.repeat(32) }).success).toBe(false);
  });

  it('requires an owner for user/agent message bodies', () => {
    expect(
      messageBodySchema.safeParse(
        row('message_body', { ownerUserId: undefined, ownerKind: 'user' }),
      ).success,
    ).toBe(false);
    expect(messageBodySchema.safeParse(row('message_body', { ownerKind: 'agent' })).success).toBe(
      false,
    );
    expect(
      messageBodySchema.safeParse(
        row('message_body', { ownerKind: 'agent', ownerUserId: undefined, producerRunId: ID2 }),
      ).success,
    ).toBe(true);
  });

  it('requires taskId for a task-targeted finding', () => {
    expect(findingSchema.safeParse(row('finding', { taskId: undefined })).success).toBe(false);
    expect(
      findingSchema.safeParse(row('finding', { taskId: undefined, targetKind: 'integration' }))
        .success,
    ).toBe(true);
  });

  it('binds once/run/work grants to their targets', () => {
    expect(grantSchema.safeParse(row('grant', { scope: 'once' })).success).toBe(false);
    expect(
      grantSchema.safeParse(
        row('grant', { scope: 'once', runId: ID2, toolOperationId: ID2, inputHash: HASH }),
      ).success,
    ).toBe(true);
    expect(grantSchema.safeParse(row('grant', { scope: 'run', runId: undefined })).success).toBe(
      false,
    );
    expect(grantSchema.safeParse(row('grant', { scope: 'work', workId: undefined })).success).toBe(
      false,
    );
  });

  it('separates agent and user artifacts', () => {
    expect(artifactSchema.safeParse(row('artifact', { runId: undefined })).success).toBe(false);
    expect(artifactSchema.safeParse(row('artifact', { origin: 'user', runId: ID2 })).success).toBe(
      false,
    );
    expect(
      artifactSchema.safeParse(row('artifact', { origin: 'user', runId: undefined })).success,
    ).toBe(false);
    expect(
      artifactSchema.safeParse(
        row('artifact', { origin: 'user', runId: undefined, attachmentId: ID2 }),
      ).success,
    ).toBe(true);
  });

  it('refuses a budget whose used + reserved exceeds its limit', () => {
    expect(
      budgetSchema.safeParse(row('budget', { tokensUsed: 60, tokensReserved: 50 })).success,
    ).toBe(false);
    expect(
      budgetSchema.safeParse(row('budget', { tokensUsed: 60, tokensReserved: 40 })).success,
    ).toBe(true);
  });

  it('refuses a completed or cancelled requirement without its summary', () => {
    const metadata = {
      schemaVersion: 1 as const,
      id: ID,
      version: 1,
      contentFile: 'content.md' as const,
      contentHash: HASH,
      createdAt: TIME,
      updatedAt: TIME,
      title: 'title',
      goal: 'goal',
      scope: SCOPE,
      lifecycle: 'completed' as const,
      featureIds: [],
      acceptance: [],
      openQuestions: [],
      confirmedDecisions: [],
      relatedRequirementIds: [],
      contentMarkdown: '# 目标与背景',
    };
    expect(portableRequirementSchema.safeParse(metadata).success).toBe(false);
    expect(
      portableRequirementSchema.safeParse({
        ...metadata,
        lifecycle: 'cancelled',
        cancellation: undefined,
      }).success,
    ).toBe(false);
    expect(
      portableRequirementSchema.safeParse({
        ...metadata,
        completion: {
          completedAt: TIME,
          summary: 'done',
          codeRevision: REVISION,
          codeTree: HASH,
          featureIds: [],
          verificationSummary: 'tests passed',
          remainingIssues: [],
        },
      }).success,
    ).toBe(true);
  });

  it('refuses undeclared enum values and malformed scalars', () => {
    expect(workSchema.safeParse(row('work', { status: 'unknown' })).success).toBe(false);
    expect(workSchema.safeParse(row('work', { goal: '' })).success).toBe(false);
    expect(
      workSchema.safeParse(row('work', { scope: { ...SCOPE, operations: ['nope'] } })).success,
    ).toBe(false);
    expect(projectSchema.safeParse(row('project', { codeRoot: '../escape' })).success).toBe(false);
    expect(projectSchema.safeParse(row('project', { codeRoot: '/abs' })).success).toBe(false);
    expect(eventSchema.safeParse(row('event', { data: undefined })).success).toBe(false);
    expect(
      featureProjectionSchema.safeParse(row('feature_projection', { documentHash: 'B'.repeat(64) }))
        .success,
    ).toBe(false);
  });

  it('rejects a non-UUIDv7 identifier and a non-millisecond timestamp', () => {
    expect(workSchema.safeParse(row('work', { id: 'not-a-uuid' })).success).toBe(false);
    expect(workSchema.safeParse(row('work', { createdAt: '2026-09-11T00:00:00Z' })).success).toBe(
      false,
    );
  });
});
