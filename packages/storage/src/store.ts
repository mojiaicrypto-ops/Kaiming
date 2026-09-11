/**
 * One Project's storage: database, repositories, ledger, events, outbox, leases
 * and blobs.
 *
 * This is the only handle `@agentdev/core` needs. Opening performs migrations
 * first, because `data.md` §5 refuses to start a Runner when migrations fail, and
 * `reliability.md` §7 loads the database, migrates, then checks the outbox.
 */
import { join } from 'node:path';
import type {
  Artifact,
  Attempt,
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
  StageResultRow,
  Task,
  ToolOperation,
  UserAction,
  Work,
  Assessment,
  Authorization,
  Attachment,
  Snapshot,
} from '@agentdev/contracts';
import { BlobStore } from './blobs.js';
import { CommandLedger } from './commands.js';
import { EventStore } from './events.js';
import { LeaseStore } from './leases.js';
import { runMigrations, type MigrationResult, type RunMigrationsOptions } from './migrations.js';
import { OutboxStore } from './outbox.js';
import { EntityRepository, type EntityRepositoryOptions } from './repository.js';
import { closeDatabase, openDatabase, type SqliteDatabase } from './sqlite.js';
import { TABLES } from './tables.js';
import { nowIso, projectIdFromRoot, uuidv7 } from './ids.js';

export interface OpenProjectStoreOptions {
  /** Project state directory; holds `project.sqlite` and `blobs/`. */
  readonly dataDir: string;
  /** Canonical repository root, used to derive the project id when absent. */
  readonly canonicalRoot?: string;
  readonly projectId?: string;
  /** Migration behaviour, including the mandatory pre-migration backup. */
  readonly migrations?: RunMigrationsOptions;
  readonly repository?: EntityRepositoryOptions;
}

export interface ProjectStoreHandle {
  readonly db: SqliteDatabase;
  readonly projectId: string;
  readonly dataDir: string;
  readonly migration: MigrationResult;
}

/** Everything a ProjectRuntime needs to read and write business state. */
export class ProjectStore {
  readonly db: SqliteDatabase;
  readonly projectId: string;
  readonly dataDir: string;
  readonly migration: MigrationResult;
  readonly blobs: BlobStore;
  readonly commands: CommandLedger;
  readonly events: EventStore;
  readonly outbox: OutboxStore;
  readonly leases: LeaseStore;

  readonly projects: EntityRepository<Project>;
  readonly conversations: EntityRepository<Conversation>;
  readonly messageBodies: EntityRepository<MessageBody>;
  readonly userActions: EntityRepository<UserAction>;
  readonly messages: EntityRepository<Message>;
  readonly works: EntityRepository<Work>;
  readonly requirements: EntityRepository<Requirement>;
  readonly tasks: EntityRepository<Task>;
  readonly assessments: EntityRepository<Assessment>;
  readonly authorizations: EntityRepository<Authorization>;
  readonly decisions: EntityRepository<Decision>;
  readonly discoveries: EntityRepository<Discovery>;
  readonly findings: EntityRepository<Finding>;
  readonly runs: EntityRepository<Run>;
  readonly attempts: EntityRepository<Attempt>;
  readonly attachments: EntityRepository<Attachment>;
  readonly artifacts: EntityRepository<Artifact>;
  readonly stageResults: EntityRepository<StageResultRow>;
  readonly snapshots: EntityRepository<Snapshot>;
  readonly grants: EntityRepository<Grant>;
  readonly budgets: EntityRepository<Budget>;
  readonly commandRows: EntityRepository<Command>;
  readonly outboxRows: EntityRepository<Outbox>;
  readonly toolOperations: EntityRepository<ToolOperation>;
  readonly leases_: EntityRepository<Lease>;
  readonly operations: EntityRepository<Operation>;
  readonly featureProjections: EntityRepository<FeatureProjection>;

  private constructor(handle: ProjectStoreHandle, options: EntityRepositoryOptions) {
    this.db = handle.db;
    this.projectId = handle.projectId;
    this.dataDir = handle.dataDir;
    this.migration = handle.migration;
    this.blobs = new BlobStore({ root: handle.dataDir });
    this.commands = new CommandLedger(this.db, this.projectId, options);
    this.events = new EventStore(this.db, this.projectId, options);
    this.outbox = new OutboxStore(this.db, this.projectId, options);
    this.leases = new LeaseStore(this.db, this.projectId, options);

    const repository = <T extends Record<string, unknown>>(
      spec: (typeof TABLES)[keyof typeof TABLES],
    ): EntityRepository<T> => new EntityRepository<T>(this.db, spec as never, options);

    this.projects = repository<Project>(TABLES.project);
    this.conversations = repository<Conversation>(TABLES.conversation);
    this.messageBodies = repository<MessageBody>(TABLES.messageBody);
    this.userActions = repository<UserAction>(TABLES.userAction);
    this.messages = repository<Message>(TABLES.message);
    this.works = repository<Work>(TABLES.work);
    this.requirements = repository<Requirement>(TABLES.requirement);
    this.tasks = repository<Task>(TABLES.task);
    this.assessments = repository<Assessment>(TABLES.assessment);
    this.authorizations = repository<Authorization>(TABLES.authorization);
    this.decisions = repository<Decision>(TABLES.decision);
    this.discoveries = repository<Discovery>(TABLES.discovery);
    this.findings = repository<Finding>(TABLES.finding);
    this.runs = repository<Run>(TABLES.run);
    this.attempts = repository<Attempt>(TABLES.attempt);
    this.attachments = repository<Attachment>(TABLES.attachment);
    this.artifacts = repository<Artifact>(TABLES.artifact);
    this.stageResults = repository<StageResultRow>(TABLES.stageResult);
    this.snapshots = repository<Snapshot>(TABLES.snapshot);
    this.grants = repository<Grant>(TABLES.grant);
    this.budgets = repository<Budget>(TABLES.budget);
    this.commandRows = repository<Command>(TABLES.command);
    this.outboxRows = repository<Outbox>(TABLES.outbox);
    this.toolOperations = repository<ToolOperation>(TABLES.toolOperation);
    this.leases_ = repository<Lease>(TABLES.lease);
    this.operations = repository<Operation>(TABLES.operation);
    this.featureProjections = repository<FeatureProjection>(TABLES.featureProjection);
  }

  /** Opens, migrates and returns the store. */
  static open(options: OpenProjectStoreOptions): ProjectStore {
    const db = openDatabase({ file: join(options.dataDir, 'project.sqlite') });
    const migration = runMigrations(db, undefined, options.migrations ?? {});
    const projectId =
      options.projectId ??
      (options.canonicalRoot === undefined ? undefined : projectIdFromRoot(options.canonicalRoot));
    if (projectId === undefined) {
      closeDatabase(db);
      throw new Error('ProjectStore.open needs projectId or canonicalRoot');
    }
    return new ProjectStore(
      { db, projectId, dataDir: options.dataDir, migration },
      options.repository ?? {},
    );
  }

  /** The current contract timestamp for this store's clock. */
  now(): string {
    return (this as unknown as { clockNow?: () => string }).clockNow?.() ?? nowIso();
  }

  /** A fresh entity id for rows created outside a repository insert. */
  newId(): string {
    return uuidv7();
  }

  /** Closes the database; safe to call twice. */
  close(): void {
    closeDatabase(this.db);
  }
}

export type { Event };
