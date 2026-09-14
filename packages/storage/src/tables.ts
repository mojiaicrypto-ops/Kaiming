/**
 * Table specs for every entity in `docs/architecture/data.md` §2.
 *
 * A spec says how a contract entity maps onto its SQLite row: which fields are
 * JSON text, which are 0/1 booleans, the primary key field, and the internal
 * columns storage adds. Keeping all of them in one place means a new table cannot
 * be added to the schema without deciding how it is read and written.
 */
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
  projectSchema,
  requirementSchema,
  runSchema,
  snapshotSchema,
  stageResultRowSchema,
  taskSchema,
  toolOperationSchema,
  userActionSchema,
  workSchema,
} from '@agentdev/contracts';
import type { TableSpec } from './repository.js';
import type {
  Artifact,
  Assessment,
  Attempt,
  Attachment,
  Authorization,
  Budget,
  Command,
  Conversation,
  Decision,
  Discovery,
  Event,
  FeatureProjection,
  Finding,
  Grant,
  Lease,
  Message,
  MessageBody,
  Operation,
  Outbox,
  Project,
  Requirement,
  Run,
  Snapshot,
  StageResultRow,
  Task,
  ToolOperation,
  UserAction,
  Work,
} from '@agentdev/contracts';

type Row = Record<string, unknown>;

/** Internal columns per table, mirrored from the migration DDL. */
const INTERNAL: Record<string, readonly string[]> = {
  command: [],
  event: ['projectId'],
};

const spec = <T extends Row>(value: TableSpec<T>): TableSpec<T> => value;

export const TABLES = {
  project: spec<Project>({
    table: 'project',
    schema: projectSchema,
    json: [],
    boolean: [],
    key: 'id',
  }),
  conversation: spec<Conversation>({
    table: 'conversation',
    schema: conversationSchema,
    json: [],
    boolean: ['archived'],
  }),
  messageBody: spec<MessageBody>({
    table: 'message_body',
    schema: messageBodySchema,
    json: [],
    boolean: [],
  }),
  userAction: spec<UserAction>({
    table: 'user_action',
    schema: userActionSchema,
    json: ['payload'],
    boolean: [],
  }),
  message: spec<Message>({
    table: 'message',
    schema: messageSchema,
    json: ['resultRefs'],
    boolean: [],
  }),
  work: spec<Work>({
    table: 'work',
    schema: workSchema,
    json: ['scope', 'sourceRef', 'blockerIds'],
    boolean: [],
  }),
  requirement: spec<Requirement>({
    table: 'requirement',
    schema: requirementSchema,
    json: ['productRef', 'planRef', 'sourceRef', 'portableRef'],
    boolean: [],
  }),
  task: spec<Task>({
    table: 'task',
    schema: taskSchema,
    json: ['planRef', 'dependsOn', 'dependencyManifestRefs', 'scope', 'acceptanceIds'],
    boolean: [],
  }),
  assessment: spec<Assessment>({
    table: 'assessment',
    schema: assessmentSchema,
    json: ['riskFlags', 'uncertainties'],
    boolean: ['semanticImpact'],
  }),
  authorization: spec<Authorization>({
    table: 'authorization',
    schema: authorizationSchema,
    json: ['sourceRef', 'scope', 'operations'],
    boolean: [],
  }),
  decision: spec<Decision>({
    table: 'decision',
    schema: decisionSchema,
    json: ['targetRef', 'choices', 'effectRefs'],
    boolean: [],
  }),
  discovery: spec<Discovery>({
    table: 'discovery',
    schema: discoverySchema,
    json: ['evidenceRefs', 'impactFlags'],
    boolean: [],
  }),
  finding: spec<Finding>({
    table: 'finding',
    schema: findingSchema,
    json: ['targetRef', 'evidenceRefs'],
    boolean: ['blocking'],
  }),
  run: spec<Run>({
    table: 'run',
    schema: runSchema,
    json: ['childIds'],
    boolean: ['requiredChild'],
    aliases: { join: 'join_policy' },
  }),
  attempt: spec<Attempt>({
    table: 'attempt',
    schema: attemptSchema,
    json: ['sessionRef'],
    boolean: [],
  }),
  attachment: spec<Attachment>({
    table: 'attachment',
    schema: attachmentSchema,
    json: [],
    boolean: [],
  }),
  artifact: spec<Artifact>({
    table: 'artifact',
    schema: artifactSchema,
    json: ['acl'],
    boolean: [],
  }),
  stageResult: spec<StageResultRow>({
    table: 'stage_result',
    schema: stageResultRowSchema,
    json: [
      'artifactRefs',
      'evidenceRefs',
      'changedPaths',
      'findingIds',
      'unknowns',
      'requestedActions',
      'checkResult',
    ],
    boolean: [],
  }),
  snapshot: spec<Snapshot>({
    table: 'snapshot',
    schema: snapshotSchema,
    json: ['payload'],
    boolean: [],
    key: 'hash',
  }),
  grant: spec<Grant>({
    table: 'grant',
    schema: grantSchema,
    json: ['targets', 'limits'],
    boolean: [],
  }),
  budget: spec<Budget>({
    table: 'budget',
    schema: budgetSchema,
    json: [],
    boolean: ['costKnown'],
  }),
  command: spec<Command>({
    table: 'command',
    schema: commandSchema,
    json: ['response'],
    boolean: [],
    internal: INTERNAL['command'] ?? [],
  }),
  event: spec<Event>({
    table: 'event',
    schema: eventSchema,
    json: ['data'],
    boolean: [],
    key: 'cursor',
    internal: INTERNAL['event'] ?? [],
  }),
  outbox: spec<Outbox>({
    table: 'outbox',
    schema: outboxSchema,
    json: ['payload'],
    boolean: [],
  }),
  toolOperation: spec<ToolOperation>({
    table: 'tool_operation',
    schema: toolOperationSchema,
    json: ['targets'],
    boolean: [],
  }),
  lease: spec<Lease>({
    table: 'lease',
    schema: leaseSchema,
    json: [],
    boolean: [],
  }),
  operation: spec<Operation>({
    table: 'operation',
    schema: operationSchema,
    json: ['sourceRef', 'stepResults', 'error'],
    boolean: [],
  }),
  featureProjection: spec<FeatureProjection>({
    table: 'feature_projection',
    schema: featureProjectionSchema,
    json: ['fields', 'relations'],
    boolean: [],
  }),
} as const;

export type TableName = keyof typeof TABLES;
