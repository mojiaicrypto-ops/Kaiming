/**
 * Storage and dispatch core (P1): durable input acceptance, claim, control intent and restart
 * classification. This module deliberately contains no model, tool or business logic — it records
 * facts and enforces state/version rules (see S1–S3 of the storage contract).
 *
 * Driver: Node's built-in `node:sqlite` (no native dependency).
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type InputStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'interrupted';

export type InputKind = 'user' | 'delegation' | 'continuation' | 'system_notice';

export type StoreErrorCode =
  | 'INVALID_ARGUMENT'
  | 'REQUEST_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'NOT_FOUND'
  | 'RECOVERY_REQUIRED'
  | 'WORKSPACE_BUSY'
  | 'TASK_BUSY'
  | 'STAGE_NOT_READY'
  | 'COMPLETION_INCOMPLETE'
  | 'INTERACTION_STALE'
  | 'STORAGE_UNAVAILABLE';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: StoreErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = 'StoreError';
    this.code = code;
    this.details = details;
  }
}

export type TaskType = 'read' | 'write';

export type TaskPhase =
  | 'clarify'
  | 'analyze'
  | 'design'
  | 'plan'
  | 'develop'
  | 'review'
  | 'test'
  | 'settle';

export type TaskStatus =
  | 'active'
  | 'waiting'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'completed';

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'active',
  'waiting',
  'pausing',
  'paused',
  'cancelling',
];

export interface ArtifactRef {
  readonly storage: 'project' | 'server';
  readonly path: string;
  readonly sha256: string;
}

export interface TaskRow {
  readonly id: string;
  readonly projectId: string;
  readonly chiefSessionId: string;
  readonly ownerEpoch: number;
  readonly requirementId: string | null;
  readonly type: TaskType;
  readonly requiresTest: boolean;
  readonly goal: string;
  readonly scope: string;
  readonly acceptanceRefs: readonly string[];
  readonly basisRefs: readonly string[];
  readonly planRef: ArtifactRef | null;
  readonly authorizationRefs: readonly string[];
  readonly phase: TaskPhase;
  readonly currentSessionIds: readonly string[];
  readonly status: TaskStatus;
  readonly revision: number;
  readonly summary: string;
  readonly nextStep: string | null;
  readonly blockReason: string | null;
  readonly completionResultId: string | null;
  readonly candidate: unknown;
  readonly sourceInputId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTaskParams {
  readonly id: string;
  readonly projectId: string;
  readonly chiefSessionId: string;
  readonly ownerEpoch: number;
  readonly requirementId?: string;
  readonly type: TaskType;
  readonly requiresTest: boolean;
  readonly goal: string;
  readonly scope: string;
  readonly acceptanceRefs: readonly string[];
  readonly basisRefs: readonly string[];
  readonly planRef: ArtifactRef;
  readonly authorizationRefs: readonly string[];
  readonly sourceInputId: string;
  readonly summary?: string;
}

export interface UpdateTaskParams {
  readonly taskId: string;
  readonly expectedRevision: number;
  readonly phase?: TaskPhase;
  readonly summary?: string;
  readonly nextStep?: string;
  readonly blockReason?: string;
  readonly status?: Extract<TaskStatus, 'active' | 'waiting'>;
  readonly planRef?: ArtifactRef;
  /** Substantive changes the chief decided on; recorded so the plan and the Task stay one story. */
  readonly goal?: string;
  readonly scope?: string;
  readonly acceptanceRefs?: readonly string[];
  readonly basisRefs?: readonly string[];
  readonly requiresTest?: boolean;
}

export type InteractionState = 'pending' | 'resolved' | 'stale';

/** A provider definition: where a model is reached. The key itself lives in the private file. */
export interface ProviderRow {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly api: string | null;
  /** JSON array of `{ id, name }`: the models this provider offers. */
  readonly models: string;
  /** Where the credential lives (private store); never the credential itself. */
  readonly credentialRef: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Which provider/model a role or a project uses, overriding the server default. */
export interface ModelOverrideRow {
  readonly scope: 'role' | 'project';
  readonly scopeId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InteractionRow {
  readonly interactionId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly inputId: string | null;
  readonly taskId: string | null;
  readonly method: 'confirm' | 'select' | 'input';
  readonly title: string;
  readonly message: string | null;
  readonly options: string | null;
  readonly placeholder: string | null;
  readonly state: InteractionState;
  readonly response: string | null;
  readonly answeredBy: string | null;
  readonly requestKey: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectRow {
  readonly id: string;
  readonly realPath: string;
  readonly revision: number;
  readonly initializationRef: unknown;
  readonly configRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskSessionRow {
  readonly sessionId: string;
  readonly taskId: string;
  readonly roleId: string;
  readonly specialization: string | null;
  readonly phase: TaskPhase;
  readonly label: string;
  readonly instructions: string;
  readonly refs: readonly string[];
  readonly dependencies: readonly string[];
  readonly expectedKind: string;
  readonly candidateId: string | null;
  readonly workspaceRef: string | null;
  readonly currentInputId: string | null;
}

export type ResultKind =
  | 'design'
  | 'implementation'
  | 'review'
  | 'test'
  | 'settlement'
  | 'investigation'
  | 'recovery';

/** Runtime list of the kinds (report-tools' schema enum and the member expectedKind check
 *  share this — a mismatch between them wedges a member's report forever). */
export const RESULT_KINDS: readonly ResultKind[] = [
  'design',
  'implementation',
  'review',
  'test',
  'settlement',
  'investigation',
  'recovery',
];

export interface ResultCheck {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'blocked' | 'not_run';
  readonly command?: string;
  readonly exitCode?: number;
  readonly reason?: string;
  readonly evidenceRefs?: readonly string[];
}

export interface ResultRow {
  readonly resultId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly roleId: string;
  readonly kind: ResultKind;
  readonly summary: string;
  readonly verdict: 'passed' | 'failed' | 'blocked' | null;
  readonly candidateId: string | null;
  readonly bodyRef: ArtifactRef;
  readonly basisRefs: readonly string[];
  readonly checks: readonly ResultCheck[];
  readonly supersedesResultId: string | null;
  readonly settlement: unknown;
  readonly createdAt: string;
}

export interface CreateTaskSessionParams {
  readonly sessionId: string;
  readonly taskId: string;
  readonly roleId: string;
  readonly specialization?: string;
  readonly phase: TaskPhase;
  readonly label: string;
  readonly instructions: string;
  readonly refs: readonly string[];
  readonly dependencies: readonly string[];
  readonly expectedKind: string;
  readonly candidateId?: string;
  readonly workspaceRef?: string;
  readonly inputId: string;
  readonly inputPayload: unknown;
}

export interface FileSaveRow {
  readonly requestKey: string;
  readonly target: string;
  readonly expectedVersion: string | null;
  readonly contentHash: string;
  readonly content: string;
  readonly state: 'pending' | 'saved' | 'conflict';
  readonly receipt: string | null;
}

export interface InputRow {
  readonly inputId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly taskId: string | null;
  readonly seq: number;
  readonly sourceKey: string;
  readonly paramsDigest: string;
  readonly kind: InputKind;
  readonly payload: string;
  readonly status: InputStatus;
  readonly revision: number;
  readonly serverEpoch: number | null;
  readonly claim: number;
  readonly deliveryStartedAt: string | null;
  /** Redacted effective configuration captured at delivery time (no credentials). */
  readonly effectiveConfig: string | null;
  /** Delivered boundary: Pi file, leaf entry, input marker and root input entry ids. */
  readonly checkpoint: string | null;
  readonly stopRequestKey: string | null;
  readonly stopReason: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /** The recovery verdict that closed an interrupted input, when one was recorded. */
  readonly recovery: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AcceptResult = {
  readonly inputId: string;
  readonly status: InputStatus;
  readonly revision: number;
  /** true when this call reused an already-accepted request instead of creating a new input. */
  readonly deduped: boolean;
};

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly input: InputRow }
  | { readonly kind: 'none' }
  | { readonly kind: 'busy'; readonly inputId: string }
  | { readonly kind: 'blocked'; readonly inputId: string; readonly code: 'RECOVERY_REQUIRED' }
  | { readonly kind: 'controlled'; readonly inputId: string; readonly code: 'TASK_CONTROLLED' };

export interface OpenStoreOptions {
  readonly path: string;
  /** Bumped on every server start; used to invalidate work from previous processes. */
  readonly serverEpoch: number;
  readonly now?: () => string;
}

export interface AcceptInputParams {
  readonly inputId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly taskId?: string;
  readonly sourceKey: string;
  readonly requestKey: string;
  readonly method: string;
  readonly kind: InputKind;
  readonly payload: unknown;
}

export interface CreateProjectParams {
  readonly id: string;
  readonly realPath: string;
}

export interface CreateSessionParams {
  readonly id: string;
  readonly projectId: string;
  readonly roleId: string;
  readonly cwd: string;
  readonly specialization?: string;
}

const REQUIRED_PRAGMAS = { journal_mode: 'wal', synchronous: 2, foreign_keys: 1 } as const;

export const SCHEMA_VERSION = 8;

/**
 * Tables added by the v4 → v5 migration: the formal results (reports) a Task's work is judged by.
 * A result is immutable; a revision is a new row that points at the one it supersedes.
 */
const V5_DDL = `
CREATE TABLE IF NOT EXISTS results (
  resultId TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks(id),
  sessionId TEXT NOT NULL,
  inputId TEXT NOT NULL,
  roleId TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  verdict TEXT,
  candidateId TEXT,
  bodyRef TEXT NOT NULL,
  basisRefs TEXT NOT NULL,
  checks TEXT NOT NULL,
  supersedesResultId TEXT,
  settlement TEXT,
  createdAt TEXT NOT NULL,
  serverEpoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_task ON results (taskId, createdAt);
CREATE INDEX IF NOT EXISTS idx_results_input ON results (inputId);`;

/**
 * Columns added by the v5 → v6 migration: the recovery verdict that closed an interrupted input
 * (what was verified, by whom, on whose evidence).
 */
const V6_DDL = `
ALTER TABLE session_inputs ADD COLUMN recovery TEXT;`;

/**
 * Interactions added by the v6 → v7 migration: one durable record per user decision a session asks
 * for (M5). The answer is written here before it is returned to the model, so a crash cannot lose or
 * repeat a decision.
 */
/**
 * Tables added by the v7 → v8 migration: the model configuration itself (R5) - the providers this
 * installation knows and the role/project assignments that pick one. A key lives in the private
 * credential store next to the database, never here: `credentialRef` is the only thing recorded.
 */
const V8_DDL = `
CREATE TABLE IF NOT EXISTS providers (
  providerId TEXT PRIMARY KEY,
  baseUrl TEXT NOT NULL,
  api TEXT,
  models TEXT NOT NULL,
  credentialRef TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_overrides (
  scope TEXT NOT NULL,
  scopeId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  modelId TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (scope, scopeId)
);`;

const V7_DDL = `
CREATE TABLE IF NOT EXISTS interactions (
  interactionId TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  inputId TEXT,
  taskId TEXT,
  method TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  options TEXT,
  placeholder TEXT,
  state TEXT NOT NULL,
  response TEXT,
  answeredBy TEXT,
  requestKey TEXT NOT NULL,
  revision INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_session_state ON interactions (sessionId, state, createdAt);`;

/** Tables added by the v3 → v4 migration (professional Session membership of a Task). */
const V4_DDL = `
CREATE TABLE IF NOT EXISTS task_sessions (
  sessionId TEXT PRIMARY KEY REFERENCES sessions(id),
  taskId TEXT NOT NULL REFERENCES tasks(id),
  roleId TEXT NOT NULL,
  specialization TEXT,
  phase TEXT NOT NULL,
  label TEXT NOT NULL,
  instructions TEXT NOT NULL,
  refs TEXT NOT NULL,
  dependencies TEXT NOT NULL,
  expectedKind TEXT NOT NULL,
  candidateId TEXT,
  workspaceRef TEXT,
  currentInputId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_sessions_task_phase ON task_sessions (taskId, phase);`;

/** Tables added by the v2 → v3 migration (chief Task records and host-owned file saves). */
const V3_DDL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  chiefSessionId TEXT NOT NULL REFERENCES sessions(id),
  ownerEpoch INTEGER NOT NULL,
  requirementId TEXT,
  type TEXT NOT NULL,
  requiresTest INTEGER NOT NULL,
  goal TEXT NOT NULL,
  scope TEXT NOT NULL,
  acceptanceRefs TEXT NOT NULL,
  basisRefs TEXT NOT NULL,
  planRef TEXT,
  authorizationRefs TEXT NOT NULL,
  phase TEXT NOT NULL,
  currentSessionIds TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  summary TEXT NOT NULL,
  nextStep TEXT,
  blockReason TEXT,
  completionResultId TEXT,
  candidate TEXT,
  sourceInputId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_open_per_chief ON tasks (chiefSessionId)
  WHERE status IN ('active', 'waiting', 'pausing', 'paused', 'cancelling');
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_open_per_requirement ON tasks (requirementId)
  WHERE requirementId IS NOT NULL AND type = 'write'
    AND status IN ('active', 'waiting', 'pausing', 'paused', 'cancelling');
CREATE TABLE IF NOT EXISTS file_saves (
  requestKey TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  expectedVersion TEXT,
  contentHash TEXT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL,
  receipt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);`;

/** Columns added by the v1 → v2 migration (checkpoint of the delivered input + redacted config). */
const V2_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'effectiveConfig', ddl: 'ALTER TABLE session_inputs ADD COLUMN effectiveConfig TEXT' },
  { name: 'checkpoint', ddl: 'ALTER TABLE session_inputs ADD COLUMN checkpoint TEXT' },
];

const ONE_PROCESSING_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS idx_inputs_one_processing
  ON session_inputs (sessionId) WHERE status = 'processing';`;

const SESSION_BINDINGS_SQL = `CREATE TABLE IF NOT EXISTS session_bindings (
  sessionId TEXT PRIMARY KEY REFERENCES sessions(id),
  piFile TEXT NOT NULL,
  branchEntryId TEXT,
  hasHistory INTEGER NOT NULL DEFAULT 0,
  configHash TEXT,
  rulesHash TEXT,
  updatedAt TEXT NOT NULL
);`;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  realPath TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  initializationRef TEXT,
  configRef TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  roleId TEXT NOT NULL,
  specialization TEXT,
  cwd TEXT NOT NULL,
  configRef TEXT,
  currentTaskId TEXT,
  recoveryBlock TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_inputs (
  inputId TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  taskId TEXT,
  seq INTEGER NOT NULL,
  sourceKey TEXT NOT NULL,
  paramsDigest TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  serverEpoch INTEGER,
  claim INTEGER NOT NULL DEFAULT 0,
  deliveryStartedAt TEXT,
  effectiveConfig TEXT,
  checkpoint TEXT,
  stopRequestKey TEXT,
  stopReason TEXT,
  errorCode TEXT,
  errorMessage TEXT,
  recovery TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (sessionId, seq),
  UNIQUE (sourceKey)
);
CREATE INDEX IF NOT EXISTS idx_inputs_session_status ON session_inputs (sessionId, status, seq);
-- Storage-level guarantee for "at most one running input per session" (S2/R3): the claim below
-- also checks this in its WHERE clause; the index makes a violation impossible even for a caller
-- that bypasses that check. ALSO created by migrate() so upgraded databases get it too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inputs_one_processing ON session_inputs (sessionId)
  WHERE status = 'processing';
CREATE TABLE IF NOT EXISTS session_bindings (
  sessionId TEXT PRIMARY KEY REFERENCES sessions(id),
  piFile TEXT NOT NULL,
  branchEntryId TEXT,
  hasHistory INTEGER NOT NULL DEFAULT 0,
  configHash TEXT,
  rulesHash TEXT,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS request_receipts (
  requestKey TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  paramsDigest TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
${V3_DDL}
${V4_DDL}
${V5_DDL}
${V7_DDL}

-- Model configuration (v8): providers and the role/project assignments that pick one.
CREATE TABLE IF NOT EXISTS providers (
  providerId TEXT PRIMARY KEY,
  baseUrl TEXT NOT NULL,
  api TEXT,
  models TEXT NOT NULL,
  credentialRef TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_overrides (
  scope TEXT NOT NULL,
  scopeId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  modelId TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (scope, scopeId)
);
`;

/** Canonical JSON (sorted object keys) so the same value always digests the same way. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

export function digestOf(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export class Store {
  private readonly db: DatabaseSync;
  private readonly serverEpoch: number;
  private readonly clock: () => string;
  /** Depth of the current transaction; nested helpers join the outer one. */
  private transactionDepth = 0;

  constructor(options: OpenStoreOptions) {
    this.serverEpoch = options.serverEpoch;
    this.clock = options.now ?? (() => new Date().toISOString());
    this.db = new DatabaseSync(options.path);
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec('PRAGMA synchronous=FULL;');
    this.db.exec('PRAGMA foreign_keys=ON;');
    // Concurrent processes open this database (server, recovery probes, host tooling).
    // Without a busy timeout any overlapping write window crashes the whole workbench with
    // SQLITE_BUSY instead of waiting the contended writer out.
    this.db.exec('PRAGMA busy_timeout=5000;');
    this.assertPragmas();
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /** The generation this store instance writes on claim (used by input correlation markers). */
  get epoch(): number {
    return this.serverEpoch;
  }

  createProject(params: CreateProjectParams): void {
    const timestamp = this.clock();
    this.db
      .prepare(
        'INSERT INTO projects (id, realPath, revision, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?)',
      )
      .run(params.id, params.realPath, timestamp, timestamp);
  }

  getProject(projectId: string): ProjectRow | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? undefined : toProjectRow(row);
  }

  /** Record the entries a project was initialized with, checked against the project revision. */
  setProjectInitialization(params: {
    projectId: string;
    expectedRevision: number;
    initializationRef: unknown;
  }): ProjectRow {
    return this.transaction(() => {
      const project = this.getProject(params.projectId);
      if (project === undefined) {
        throw new StoreError('NOT_FOUND', 'project does not exist', { projectId: params.projectId });
      }
      const outcome = this.db
        .prepare(
          'UPDATE projects SET initializationRef = ?, revision = revision + 1, updatedAt = ? WHERE id = ? AND revision = ?',
        )
        .run(
          JSON.stringify(params.initializationRef),
          this.clock(),
          params.projectId,
          params.expectedRevision,
        );
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'project revision does not match', {
          projectId: params.projectId,
          actual: project.revision,
        });
      }
      return this.getProject(params.projectId) as ProjectRow;
    });
  }

  /** realpath is the identity of a project (R5): the same directory is the same project. */
  getProjectByRealPath(realPath: string): ProjectRow | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE realPath = ?').get(realPath) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? undefined : toProjectRow(row);
  }

  /**
   * Why a project cannot be rebound right now: moving a directory while its sessions still hold
   * unfinished work would silently point them at the wrong place (R1/R5).
   */
  projectRebindGaps(projectId: string): string[] {
    const gaps: string[] = [];
    for (const session of this.listSessions().filter((entry) => entry.projectId === projectId)) {
      for (const input of this.listInputs(session.id)) {
        if (input.status === 'queued' || input.status === 'processing') {
          gaps.push(`session ${session.id} still has ${input.status} input ${input.inputId}`);
        }
        if (input.status === 'interrupted') {
          gaps.push(`session ${session.id} has an unverified interrupted input ${input.inputId}`);
        }
      }
    }
    for (const task of this.listTasks(projectId)) {
      if (task.status !== 'completed' && task.status !== 'cancelled') {
        gaps.push(`Task ${task.id} is ${task.status}`);
      }
    }
    return gaps;
  }

  /** Bind an existing project id to another real directory, checked against the project revision. */
  rebindProject(params: { projectId: string; expectedRevision: number; realPath: string; authorizationRefs: readonly string[] }): ProjectRow {
    return this.transaction(() => {
      const project = this.getProject(params.projectId);
      if (project === undefined) {
        throw new StoreError('NOT_FOUND', 'project does not exist', { projectId: params.projectId });
      }
      const occupant = this.getProjectByRealPath(params.realPath);
      if (occupant !== undefined && occupant.id !== params.projectId) {
        throw new StoreError('VERSION_CONFLICT', 'that directory already belongs to another project', {
          projectId: occupant.id,
        });
      }
      const outcome = this.db
        .prepare('UPDATE projects SET realPath = ?, revision = revision + 1, updatedAt = ? WHERE id = ? AND revision = ?')
        .run(params.realPath, this.clock(), params.projectId, params.expectedRevision);
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'project revision does not match', {
          projectId: params.projectId,
          actual: project.revision,
        });
      }
      this.db
        .prepare(
          `UPDATE sessions SET cwd = (SELECT realPath FROM projects WHERE id = ?), revision = revision + 1, updatedAt = ?
             WHERE projectId = ?`,
        )
        .run(params.projectId, this.clock(), params.projectId);
      return this.getProject(params.projectId) as ProjectRow;
    });
  }

  createSession(params: CreateSessionParams): void {
    const timestamp = this.clock();
    this.db
      .prepare(
        'INSERT INTO sessions (id, projectId, roleId, specialization, cwd, revision, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(params.id, params.projectId, params.roleId, params.specialization ?? null, params.cwd, timestamp, timestamp);
  }

  /**
   * Accept one input: deduplicate by requestKey, assign the per-session sequence number and store
   * the queued row together with its receipt (single transaction).
   */
  acceptInput(params: AcceptInputParams): AcceptResult {
    return this.transaction(() => {
      const paramsDigest = digestOf({
        method: params.method,
        projectId: params.projectId,
        sessionId: params.sessionId,
        taskId: params.taskId ?? null,
        kind: params.kind,
        payload: params.payload,
      });
      const receipt = this.db
        .prepare('SELECT method, paramsDigest, status, result FROM request_receipts WHERE requestKey = ?')
        .get(params.requestKey) as
        | { method: string; paramsDigest: string; status: string; result: string | null }
        | undefined;
      if (receipt !== undefined) {
        if (receipt.paramsDigest !== paramsDigest || receipt.method !== params.method) {
          throw new StoreError('REQUEST_CONFLICT', 'same requestKey with different parameters', {
            requestKey: params.requestKey,
          });
        }
        if (receipt.status !== 'committed' || receipt.result === null) {
          throw new StoreError('VERSION_CONFLICT', 'request is still pending', {
            requestKey: params.requestKey,
          });
        }
        const stored = JSON.parse(receipt.result) as { inputId: string };
        const existing = this.requireInput(stored.inputId);
        return {
          inputId: existing.inputId,
          status: existing.status,
          revision: existing.revision,
          deduped: true,
        };
      }

      const session = this.db
        .prepare('SELECT id FROM sessions WHERE id = ?')
        .get(params.sessionId) as { id: string } | undefined;
      if (session === undefined) {
        throw new StoreError('NOT_FOUND', 'session does not exist', { sessionId: params.sessionId });
      }

      const seqRow = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM session_inputs WHERE sessionId = ?')
        .get(params.sessionId) as { nextSeq: number };
      const timestamp = this.clock();
      this.db
        .prepare(
          `INSERT INTO session_inputs
             (inputId, projectId, sessionId, taskId, seq, sourceKey, paramsDigest, kind, payload,
              status, revision, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?)`,
        )
        .run(
          params.inputId,
          params.projectId,
          params.sessionId,
          params.taskId ?? null,
          seqRow.nextSeq,
          params.sourceKey,
          paramsDigest,
          params.kind,
          canonical(params.payload),
          timestamp,
          timestamp,
        );
      const result = { inputId: params.inputId, status: 'queued', revision: 1 };
      this.db
        .prepare(
          `INSERT INTO request_receipts (requestKey, method, paramsDigest, status, result, createdAt, updatedAt)
           VALUES (?, ?, ?, 'committed', ?, ?, ?)`,
        )
        .run(params.requestKey, params.method, paramsDigest, JSON.stringify(result), timestamp, timestamp);
      return { ...result, deduped: false } as AcceptResult;
    });
  }

  /**
   * Claim a request key for one RPC call: the first caller runs it, a repeat with the same method and
   * parameters replays the recorded outcome, a repeat with different parameters is a conflict, and a
   * still-pending repeat is refused instead of running twice (R1/S2).
   */
  beginRequest(params: { requestKey: string; method: string; paramsDigest: string }):
    | { readonly kind: 'run' }
    | { readonly kind: 'replay'; readonly result: unknown; readonly error: unknown } {
    return this.transaction(() => {
      const receipt = this.db
        .prepare('SELECT method, paramsDigest, status, result, error FROM request_receipts WHERE requestKey = ?')
        .get(params.requestKey) as
        | { method: string; paramsDigest: string; status: string; result: string | null; error: string | null }
        | undefined;
      if (receipt !== undefined) {
        if (receipt.method !== params.method || receipt.paramsDigest !== params.paramsDigest) {
          throw new StoreError('REQUEST_CONFLICT', 'the same requestId was used with different parameters', {
            requestKey: params.requestKey,
            method: receipt.method,
          });
        }
        if (receipt.status !== 'committed') {
          throw new StoreError('VERSION_CONFLICT', 'this request is still pending', {
            requestKey: params.requestKey,
          });
        }
        return {
          kind: 'replay' as const,
          result: receipt.result === null ? undefined : (JSON.parse(receipt.result) as unknown),
          error: receipt.error === null ? undefined : (JSON.parse(receipt.error) as unknown),
        };
      }
      const timestamp = this.clock();
      this.db
        .prepare(
          `INSERT INTO request_receipts (requestKey, method, paramsDigest, status, createdAt, updatedAt)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
        )
        .run(params.requestKey, params.method, params.paramsDigest, timestamp, timestamp);
      return { kind: 'run' as const };
    });
  }

  /** Record the real outcome of a claimed request; a failure is recorded as truthfully as a success. */
  commitRequest(params: {
    requestKey: string;
    result?: unknown;
    error?: { code: string; message: string; details?: unknown };
  }): void {
    const outcome = this.db
      .prepare(
        `UPDATE request_receipts SET status = 'committed', result = ?, error = ?, updatedAt = ?
           WHERE requestKey = ? AND status = 'pending'`,
      )
      .run(
        params.result === undefined ? null : JSON.stringify(params.result),
        params.error === undefined ? null : JSON.stringify(params.error),
        this.clock(),
        params.requestKey,
      );
    if (outcome.changes !== 1) {
      throw new StoreError('VERSION_CONFLICT', 'this request is not pending any more', {
        requestKey: params.requestKey,
      });
    }
  }

  getRequestReceipt(requestKey: string): {
    readonly method: string;
    readonly paramsDigest: string;
    readonly status: string;
    readonly result: unknown;
    readonly error: unknown;
  } | undefined {
    const row = this.db
      .prepare('SELECT method, paramsDigest, status, result, error FROM request_receipts WHERE requestKey = ?')
      .get(requestKey) as
      | { method: string; paramsDigest: string; status: string; result: string | null; error: string | null }
      | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      method: row.method,
      paramsDigest: row.paramsDigest,
      status: row.status,
      result: row.result === null ? undefined : (JSON.parse(row.result) as unknown),
      error: row.error === null ? undefined : (JSON.parse(row.error) as unknown),
    };
  }

  /**
   * Record one pending interaction before it is shown (M5): the request is durable, so a reconnect
   * re-reads it from the snapshot and a crash cannot lose the question.
   */
  createInteraction(params: {
    interactionId: string;
    projectId: string;
    sessionId: string;
    inputId?: string;
    taskId?: string;
    method: 'confirm' | 'select' | 'input';
    title: string;
    message?: string;
    options?: readonly string[];
    placeholder?: string;
    requestKey: string;
  }): InteractionRow {
    return this.transaction(() => {
      const existing = this.getInteraction(params.interactionId);
      if (existing !== undefined) {
        throw new StoreError('REQUEST_CONFLICT', 'this interaction already exists', {
          interactionId: params.interactionId,
        });
      }
      const timestamp = this.clock();
      this.db
        .prepare(
          `INSERT INTO interactions
             (interactionId, projectId, sessionId, inputId, taskId, method, title, message, options,
              placeholder, state, requestKey, revision, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?)`,
        )
        .run(
          params.interactionId,
          params.projectId,
          params.sessionId,
          params.inputId ?? null,
          params.taskId ?? null,
          params.method,
          params.title,
          params.message ?? null,
          params.options === undefined ? null : JSON.stringify(params.options),
          params.placeholder ?? null,
          params.requestKey,
          timestamp,
          timestamp,
        );
      return this.requireInteraction(params.interactionId);
    });
  }

  getInteraction(interactionId: string): InteractionRow | undefined {
    return this.db.prepare('SELECT * FROM interactions WHERE interactionId = ?').get(interactionId) as
      | InteractionRow
      | undefined;
  }

  /** Pending interactions of a session, oldest first: part of the snapshot boundary (M4/M5). */
  /**
   * Pending interactions the CHIEF must present (M5): its own, plus every member session's
   * questions for the Tasks it coordinates. A member's question reaches the user only through
   * the chief's channel — filtering strictly by sessionId hid it and the member waited forever.
   */
  listPendingInteractionsForChief(chiefSessionId: string): InteractionRow[] {
    return this.db
      .prepare(
        `SELECT i.* FROM interactions i
          WHERE i.state = 'pending'
            AND (i.sessionId = ?
                 OR i.taskId IN (SELECT id FROM tasks WHERE chiefSessionId = ?))
          ORDER BY i.createdAt, i.interactionId`,
      )
      .all(chiefSessionId, chiefSessionId) as unknown as InteractionRow[];
  }

  listPendingInteractions(sessionId: string): InteractionRow[] {
    return this.db
      .prepare("SELECT * FROM interactions WHERE sessionId = ? AND state = 'pending' ORDER BY createdAt, interactionId")
      .all(sessionId) as unknown as InteractionRow[];
  }

  listInteractions(sessionId: string): InteractionRow[] {
    return this.db
      .prepare('SELECT * FROM interactions WHERE sessionId = ? ORDER BY createdAt, interactionId')
      .all(sessionId) as unknown as InteractionRow[];
  }

  /**
   * Save the answer and close the interaction: a resolved answer is never overwritten, an identical
   * retry returns the original record, and a different answer is a conflict (M5/S2).
   */
  resolveInteraction(params: {
    interactionId: string;
    expectedRevision: number;
    response: unknown;
    answeredBy: string;
    requestKey: string;
  }): InteractionRow {
    return this.transaction(() => {
      const interaction = this.requireInteraction(params.interactionId);
      // The answer must fit the question: a select accepts only its own options (M5 trust boundary).
      const shapeIssue = answerIssue(interaction, params.response);
      if (shapeIssue !== undefined) {
        throw new StoreError('INVALID_ARGUMENT', shapeIssue, { interactionId: params.interactionId });
      }
      const response = JSON.stringify(params.response ?? null);
      if (interaction.state === 'resolved') {
        if (interaction.response === response) {
          return interaction;
        }
        throw new StoreError('REQUEST_CONFLICT', 'this interaction was already answered differently', {
          interactionId: params.interactionId,
        });
      }
      if (interaction.state !== 'pending') {
        throw new StoreError('INTERACTION_STALE', `the interaction is ${interaction.state}`, {
          interactionId: params.interactionId,
        });
      }
      const outcome = this.db
        .prepare(
          `UPDATE interactions
             SET state = 'resolved', response = ?, answeredBy = ?, requestKey = ?, revision = revision + 1, updatedAt = ?
           WHERE interactionId = ? AND revision = ? AND state = 'pending'`,
        )
        .run(response, params.answeredBy, params.requestKey, this.clock(), params.interactionId, params.expectedRevision);
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'interaction revision does not match', {
          interactionId: params.interactionId,
          actual: interaction.revision,
        });
      }
      return this.requireInteraction(params.interactionId);
    });
  }

  /**
   * Mark pending interactions stale because their source stopped (M5): a stopped input's question can
   * never be resumed, so it must not keep a page waiting.
   */
  staleInteractionsForInput(params: { inputId: string }): number {
    const outcome = this.db
      .prepare(
        `UPDATE interactions SET state = 'stale', revision = revision + 1, updatedAt = ?
           WHERE inputId = ? AND state = 'pending'`,
      )
      .run(this.clock(), params.inputId);
    return Number(outcome.changes);
  }

  private requireInteraction(interactionId: string): InteractionRow {
    const interaction = this.getInteraction(interactionId);
    if (interaction === undefined) {
      throw new StoreError('NOT_FOUND', 'interaction does not exist', { interactionId });
    }
    return interaction;
  }

  /**
   * Why a session cannot be cleaned up: it must have no unfinished work and must not be referenced by
   * a Task or by a recorded result (the record has to stay readable).
   */
  sessionCleanupGaps(sessionId: string): string[] {
    const gaps: string[] = [];
    const session = this.getSession(sessionId);
    if (session === undefined) {
      return ['the session does not exist'];
    }
    if (session.currentTaskId !== null) {
      gaps.push(`the session is bound to Task ${session.currentTaskId}`);
    }
    // A Task keeps referencing the chief session that coordinated it, so that record cannot be
    // deleted without destroying delivery history: it is a reason to refuse, not to cascade.
    const chiefing = this.db
      .prepare('SELECT COUNT(*) AS n FROM tasks WHERE chiefSessionId = ?')
      .get(sessionId) as { n: number };
    if (chiefing.n > 0) {
      gaps.push(`the session coordinated ${chiefing.n} recorded Task(s)`);
    }
    for (const input of this.listInputs(sessionId)) {
      if (input.status === 'queued' || input.status === 'processing') {
        gaps.push(`input ${input.inputId} is ${input.status}`);
      }
      if (input.status === 'interrupted') {
        gaps.push(`input ${input.inputId} is interrupted and not verified`);
      }
    }
    for (const member of this.listTaskSessions(sessionId)) {
      gaps.push(`the session is a member of Task ${member.taskId}`);
    }
    const referenced = this.db
      .prepare('SELECT COUNT(*) AS n FROM results WHERE sessionId = ?')
      .get(sessionId) as { n: number };
    if (referenced.n > 0) {
      gaps.push(`the session produced ${referenced.n} recorded result(s)`);
    }
    return gaps;
  }

  /**
   * Remove a session and its own rows once nothing references it (R1). The dependent rows go first,
   * because they reference the session; a revision mismatch rolls the whole transaction back.
   */
  deleteSession(params: { sessionId: string; expectedRevision: number }): void {
    this.transaction(() => {
      const session = this.getSession(params.sessionId);
      if (session === undefined) {
        throw new StoreError('NOT_FOUND', 'session does not exist', { sessionId: params.sessionId });
      }
      this.db.prepare('DELETE FROM interactions WHERE sessionId = ?').run(params.sessionId);
      this.db.prepare('DELETE FROM session_inputs WHERE sessionId = ?').run(params.sessionId);
      this.db.prepare('DELETE FROM session_bindings WHERE sessionId = ?').run(params.sessionId);
      this.db.prepare('DELETE FROM task_sessions WHERE sessionId = ?').run(params.sessionId);
      const outcome = this.db
        .prepare('DELETE FROM sessions WHERE id = ? AND revision = ?')
        .run(params.sessionId, params.expectedRevision);
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'session revision does not match', {
          sessionId: params.sessionId,
          actual: session.revision,
        });
      }
    });
  }

  /**
   * Close an interrupted input with the verdict a real verification reached (S7/R1): the evidence is
   * required, the status is checked and the revision compared, and nothing is re-sent to Pi.
   */
  resolveInterruptedInput(params: {
    sessionId: string;
    inputId: string;
    expectedRevision: number;
    resolution: 'completed' | 'failed' | 'stopped';
    evidenceRefs: readonly string[];
    resolvedBy: string;
  }): InputRow {
    return this.transaction(() => {
      const input = this.requireInput(params.inputId);
      if (input.sessionId !== params.sessionId) {
        throw new StoreError('NOT_FOUND', 'input does not belong to this session', { inputId: params.inputId });
      }
      if (input.status !== 'interrupted') {
        throw new StoreError('INVALID_ARGUMENT', `input ${params.inputId} is ${input.status}, not interrupted`, {
          inputId: params.inputId,
        });
      }
      if (params.evidenceRefs.length === 0 || params.evidenceRefs.some((ref) => ref.trim() === '')) {
        // Without real evidence the input stays interrupted: a verdict must cite what was verified.
        throw new StoreError('RECOVERY_REQUIRED', 'no evidence was cited for this resolution', {
          inputId: params.inputId,
        });
      }
      const outcome = this.db
        .prepare(
          `UPDATE session_inputs
             SET status = ?, recovery = ?, revision = revision + 1, updatedAt = ?
           WHERE inputId = ? AND revision = ? AND status = 'interrupted'`,
        )
        .run(
          params.resolution,
          JSON.stringify({
            resolution: params.resolution,
            evidenceRefs: params.evidenceRefs,
            resolvedBy: params.resolvedBy,
            resolvedAt: this.clock(),
          }),
          this.clock(),
          params.inputId,
          params.expectedRevision,
        );
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'input revision does not match', {
          inputId: params.inputId,
          actual: input.revision,
        });
      }
      return this.requireInput(params.inputId);
    });
  }

  /**
   * Claim the earliest consumable input of a session. Refuses while the session still has a
   * processing row (one run at a time) or an unresolved interrupted row (must be verified first).
   */
  claimNextInput(sessionId: string): ClaimResult {
    return this.transaction(() => {
      const processing = this.db
        .prepare("SELECT inputId FROM session_inputs WHERE sessionId = ? AND status = 'processing' LIMIT 1")
        .get(sessionId) as { inputId: string } | undefined;
      if (processing !== undefined) {
        return { kind: 'busy', inputId: processing.inputId } as ClaimResult;
      }
      const interrupted = this.db
        .prepare("SELECT inputId FROM session_inputs WHERE sessionId = ? AND status = 'interrupted' ORDER BY seq LIMIT 1")
        .get(sessionId) as { inputId: string } | undefined;
      if (interrupted !== undefined) {
        return {
          kind: 'blocked',
          inputId: interrupted.inputId,
          code: 'RECOVERY_REQUIRED',
        } as ClaimResult;
      }
      let candidate: { inputId: string } | undefined;
      for (;;) {
        candidate = this.db
          .prepare("SELECT inputId FROM session_inputs WHERE sessionId = ? AND status = 'queued' ORDER BY seq LIMIT 1")
          .get(sessionId) as { inputId: string } | undefined;
        if (candidate === undefined) {
          return { kind: 'none' } as ClaimResult;
        }
        // An input whose Task already ended can never run: close it so it does not block the queue.
        const owner = this.db
          .prepare('SELECT status FROM tasks WHERE id = (SELECT taskId FROM session_inputs WHERE inputId = ?)')
          .get(candidate.inputId) as { status: string } | undefined;
        if (owner !== undefined && (owner.status === 'completed' || owner.status === 'cancelled')) {
          this.db
            .prepare(
              `UPDATE session_inputs SET status = 'stopped', errorCode = 'TASK_ENDED',
                 errorMessage = ?, revision = revision + 1, updatedAt = ?
               WHERE inputId = ? AND status = 'queued'`,
            )
            .run(`Task ${owner.status} before this input could run`, this.clock(), candidate.inputId);
          continue;
        }
        break;
      }
      // While a chief session coordinates a Task, only that Task's own work is consumable: another
      // topic waits for the Task to end (R3) instead of overtaking it.
      const currentTask = this.db
        .prepare('SELECT currentTaskId FROM sessions WHERE id = ?')
        .get(sessionId) as { currentTaskId: string | null } | undefined;
      if (currentTask !== undefined && currentTask.currentTaskId !== null) {
        const owned = this.db
          .prepare(
            "SELECT inputId FROM session_inputs WHERE sessionId = ? AND status = 'queued' AND taskId = ? ORDER BY seq LIMIT 1",
          )
          .get(sessionId, currentTask.currentTaskId) as { inputId: string } | undefined;
        if (owned === undefined) {
          return { kind: 'busy', inputId: candidate.inputId } as ClaimResult;
        }
        candidate = owned;
      }
      const owner = this.db
        .prepare(
          `SELECT t.status AS taskStatus, ts.roleId AS roleId, ts.expectedKind AS expectedKind
           FROM session_inputs i
           JOIN tasks t ON t.id = i.taskId
           LEFT JOIN task_sessions ts ON ts.sessionId = i.sessionId AND ts.taskId = i.taskId
           WHERE i.inputId = ?`,
        )
        .get(candidate.inputId) as
        | { taskStatus: string; roleId: string | null; expectedKind: string | null }
        | undefined;
      if (owner !== undefined && owner.taskStatus !== 'active' && owner.taskStatus !== 'waiting') {
        // A Task that is not running hands out exactly one kind of work: the read-only recovery check.
        const recovery =
          (owner.taskStatus === 'paused' || owner.taskStatus === 'pausing') &&
          owner.roleId === 'investigator' &&
          owner.expectedKind === 'recovery';
        if (!recovery) {
          return { kind: 'controlled', inputId: candidate.inputId, code: 'TASK_CONTROLLED' } as ClaimResult;
        }
      }
      const claimed = this.tryClaimInput(candidate.inputId);
      if (!claimed) {
        throw new StoreError('WORKSPACE_BUSY', 'claim lost to a concurrent claimer', {
          inputId: candidate.inputId,
        });
      }
      return { kind: 'claimed', input: this.requireInput(candidate.inputId) } as ClaimResult;
    });
  }

  /** Compare-and-set claim of one input; false when it is not queued or the session already runs. */
  tryClaimInput(inputId: string): boolean {
    const timestamp = this.clock();
    try {
      const outcome = this.db
        .prepare(
          `UPDATE session_inputs
              SET status = 'processing', claim = claim + 1, revision = revision + 1,
                  serverEpoch = ?, deliveryStartedAt = ?, updatedAt = ?
            WHERE inputId = ? AND status = 'queued'
              AND NOT EXISTS (
                SELECT 1 FROM session_inputs running
                 WHERE running.sessionId = session_inputs.sessionId AND running.status = 'processing'
              )`,
        )
        .run(this.serverEpoch, timestamp, timestamp, inputId);
      return outcome.changes === 1;
    } catch (error) {
      // idx_inputs_one_processing fired: a concurrent claimer won for the same session.
      throw new StoreError('WORKSPACE_BUSY', 'session already has a running input', {
        inputId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Finish an input with a version-checked write; false means another writer moved it first. */
  finishInput(params: {
    inputId: string;
    expectedRevision: number;
    status: Extract<InputStatus, 'completed' | 'failed' | 'stopped' | 'interrupted'>;
    errorCode?: string;
    errorMessage?: string;
    /** Delivered boundary, recorded only when the run actually settled. */
    checkpoint?: unknown;
  }): boolean {
    const outcome = this.db
      .prepare(
        `UPDATE session_inputs
            SET status = ?, revision = revision + 1, errorCode = ?, errorMessage = ?,
                checkpoint = COALESCE(?, checkpoint), updatedAt = ?
          WHERE inputId = ? AND status = 'processing' AND revision = ?`,
      )
      .run(
        params.status,
        params.errorCode ?? null,
        params.errorMessage ?? null,
        params.checkpoint === undefined ? null : canonical(params.checkpoint),
        this.clock(),
        params.inputId,
        params.expectedRevision,
      );
    return outcome.changes === 1;
  }

  /**
   * Record the redacted effective configuration used for a claimed input and return the new
   * revision. Credentials never appear here (the caller passes a redacted view).
   */
  recordEffectiveConfig(params: { inputId: string; effectiveConfig: unknown }): number {
    return this.transaction(() => {
      const input = this.requireInput(params.inputId);
      if (input.status !== 'processing') {
        throw new StoreError(
          'INVALID_ARGUMENT',
          'effective config can only be recorded for a running input',
          { inputId: params.inputId, status: input.status },
        );
      }
      const outcome = this.db
        .prepare(
          `UPDATE session_inputs
              SET effectiveConfig = ?, revision = revision + 1, updatedAt = ?
            WHERE inputId = ? AND status = 'processing' AND revision = ?`,
        )
        .run(canonical(params.effectiveConfig), this.clock(), params.inputId, input.revision);
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'input moved while recording its config', {
          inputId: params.inputId,
        });
      }
      return this.requireInput(params.inputId).revision;
    });
  }

  /**
   * Startup classification: rows left `processing` by a *previous* process can never be confirmed,
   * so they become `interrupted` and block later inputs of their session until verified.
   *
   * Only foreign generations are touched (`serverEpoch` differs, or is unset for rows written
   * before epochs existed), so calling this again later — a periodic scan, or a second Store on the
   * same file — cannot destroy runs owned by the current process.
   */
  /**
   * Save a provider definition (R5). The caller writes the credential to the private store first and
   * passes only its reference, so a key can never end up in the database or in a response.
   */
  saveProvider(params: {
    providerId: string;
    baseUrl: string;
    api?: string;
    models: readonly { id: string; name: string }[];
    credentialRef?: string;
    expectedRevision: number | null;
  }): ProviderRow {
    return this.transaction(() => {
      const existing = this.getProvider(params.providerId);
      if (params.expectedRevision === null) {
        if (existing !== undefined) {
          throw new StoreError('VERSION_CONFLICT', `provider ${params.providerId} already exists`, {
            providerId: params.providerId,
            actual: existing.revision,
          });
        }
      } else if (existing === undefined || existing.revision !== params.expectedRevision) {
        throw new StoreError('VERSION_CONFLICT', `provider ${params.providerId} revision does not match`, {
          providerId: params.providerId,
          expected: params.expectedRevision,
          actual: existing?.revision ?? null,
        });
      }
      const timestamp = this.clock();
      const models = JSON.stringify(params.models);
      if (existing === undefined) {
        this.db
          .prepare(
            `INSERT INTO providers (providerId, baseUrl, api, models, credentialRef, revision, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(params.providerId, params.baseUrl, params.api ?? null, models, params.credentialRef ?? null, timestamp, timestamp);
      } else {
        this.db
          .prepare(
            `UPDATE providers SET baseUrl = ?, api = ?, models = ?, credentialRef = ?, revision = revision + 1, updatedAt = ?
              WHERE providerId = ? AND revision = ?`,
          )
          .run(
            params.baseUrl,
            params.api ?? null,
            models,
            params.credentialRef ?? existing.credentialRef,
            timestamp,
            params.providerId,
            params.expectedRevision ?? 0,
          );
      }
      return this.requireProvider(params.providerId);
    });
  }

  getProvider(providerId: string): ProviderRow | undefined {
    const row = this.db.prepare('SELECT * FROM providers WHERE providerId = ?').get(providerId) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? undefined : toProviderRow(row);
  }

  listProviders(): ProviderRow[] {
    const rows = this.db.prepare('SELECT * FROM providers ORDER BY providerId').all() as Array<Record<string, unknown>>;
    return rows.map(toProviderRow);
  }

  /** Save which provider/model one role or one project uses (R5), with the same revision discipline. */
  saveModelOverride(params: {
    scope: 'role' | 'project';
    scopeId: string;
    providerId: string;
    modelId: string;
    expectedRevision: number | null;
  }): ModelOverrideRow {
    return this.transaction(() => {
      const existing = this.getModelOverride(params.scope, params.scopeId);
      if (params.expectedRevision === null) {
        if (existing !== undefined) {
          throw new StoreError('VERSION_CONFLICT', `${params.scope} ${params.scopeId} already has an override`, {
            scope: params.scope,
            scopeId: params.scopeId,
            actual: existing.revision,
          });
        }
      } else if (existing === undefined || existing.revision !== params.expectedRevision) {
        throw new StoreError('VERSION_CONFLICT', `${params.scope} ${params.scopeId} revision does not match`, {
          scope: params.scope,
          scopeId: params.scopeId,
          expected: params.expectedRevision,
          actual: existing?.revision ?? null,
        });
      }
      const timestamp = this.clock();
      if (existing === undefined) {
        this.db
          .prepare(
            `INSERT INTO model_overrides (scope, scopeId, providerId, modelId, revision, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(params.scope, params.scopeId, params.providerId, params.modelId, timestamp, timestamp);
      } else {
        this.db
          .prepare(
            `UPDATE model_overrides SET providerId = ?, modelId = ?, revision = revision + 1, updatedAt = ?
              WHERE scope = ? AND scopeId = ? AND revision = ?`,
          )
          .run(params.providerId, params.modelId, timestamp, params.scope, params.scopeId, params.expectedRevision ?? 0);
      }
      const saved = this.getModelOverride(params.scope, params.scopeId);
      if (saved === undefined) {
        throw new StoreError('NOT_FOUND', `${params.scope} ${params.scopeId} override was not saved`);
      }
      return saved;
    });
  }

  getModelOverride(scope: 'role' | 'project', scopeId: string): ModelOverrideRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM model_overrides WHERE scope = ? AND scopeId = ?')
      .get(scope, scopeId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : toModelOverrideRow(row);
  }

  listModelOverrides(scope: 'role' | 'project'): ModelOverrideRow[] {
    const rows = this.db
      .prepare('SELECT * FROM model_overrides WHERE scope = ? ORDER BY scopeId')
      .all(scope) as Array<Record<string, unknown>>;
    return rows.map(toModelOverrideRow);
  }

  private requireProvider(providerId: string): ProviderRow {
    const provider = this.getProvider(providerId);
    if (provider === undefined) {
      throw new StoreError('NOT_FOUND', `provider ${providerId} does not exist`, { providerId });
    }
    return provider;
  }

  scanStartup(): { interrupted: number } {
    return this.transaction(() => {
      const timestamp = this.clock();
      const outcome = this.db
        .prepare(
          `UPDATE session_inputs SET status = 'interrupted', revision = revision + 1, updatedAt = ?
            WHERE status = 'processing' AND (serverEpoch IS NULL OR serverEpoch <> ?)`,
        )
        .run(timestamp, this.serverEpoch);
      // A run that was waiting for an answer died with its process: the question can never reach its
      // caller, so every question of an interrupted foreign run goes stale (M5). This is idempotent,
      // so it also repairs questions left pending by an earlier start that did not classify them.
      this.db
        .prepare(
          `UPDATE interactions SET state = 'stale', revision = revision + 1, updatedAt = ?
            WHERE state = 'pending' AND inputId IN (
              SELECT inputId FROM session_inputs
               WHERE status = 'interrupted' AND (serverEpoch IS NULL OR serverEpoch <> ?)
            )`,
        )
        .run(timestamp, this.serverEpoch);
      return { interrupted: Number(outcome.changes) };
    });
  }

  /**
   * Interrupted inputs that belong to a Task, with the chief session that must verify them.
   * The startup sweep marks foreign-generation runs interrupted but nobody tells the chief;
   * without this the Task, its step and the user's queue wait on work that will never finish.
   */
  listInterruptedTaskInputs(): Array<{
    inputId: string;
    sessionId: string;
    taskId: string;
    errorCode: string | null;
    chiefSessionId: string;
    taskStatus: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT i.inputId AS inputId, i.sessionId AS sessionId, i.taskId AS taskId,
                i.errorCode AS errorCode, t.chiefSessionId AS chiefSessionId, t.status AS taskStatus
           FROM session_inputs i
           JOIN tasks t ON t.id = i.taskId
          WHERE i.status = 'interrupted' AND i.taskId IS NOT NULL
            AND t.status IN ('active', 'waiting', 'paused')
          ORDER BY i.seq`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      inputId: String(row['inputId']),
      sessionId: String(row['sessionId']),
      taskId: String(row['taskId']),
      errorCode: row['errorCode'] === null ? null : String(row['errorCode']),
      chiefSessionId: String(row['chiefSessionId']),
      taskStatus: String(row['taskStatus']),
    }));
  }

  /**
   * Record a stop request. Queued work stops outright; running/awaiting-verification work keeps its
   * status and the intent is recorded for the runtime to act on; terminal rows are left untouched
   * (a late stop is reported but cannot rewrite history). Retrying the same requestKey is a no-op.
   */
  requestStop(params: { inputId: string; requestKey: string; reason: string }): {
    status: InputStatus;
    stopRequested: boolean;
  } {
    return this.transaction(() => {
      const input = this.requireInput(params.inputId);
      const timestamp = this.clock();
      if (input.stopRequestKey === params.requestKey) {
        // Retry of a stable requestId: report the recorded outcome, not a derived guess.
        return {
          status: input.status,
          stopRequested: input.status === 'processing' || input.status === 'stopped',
        };
      }
      if (input.status === 'queued') {
        this.db
          .prepare(
            `UPDATE session_inputs
                SET status = 'stopped', stopRequestKey = ?, stopReason = ?, revision = revision + 1, updatedAt = ?
              WHERE inputId = ? AND status = 'queued'`,
          )
          .run(params.requestKey, params.reason, timestamp, params.inputId);
        return { status: 'stopped' as InputStatus, stopRequested: true };
      }
      if (input.status === 'processing' || input.status === 'interrupted') {
        this.db
          .prepare(
            `UPDATE session_inputs
                SET stopRequestKey = ?, stopReason = ?, revision = revision + 1, updatedAt = ?
              WHERE inputId = ? AND status = ?`,
          )
          .run(params.requestKey, params.reason, timestamp, params.inputId, input.status);
        return { status: input.status, stopRequested: input.status === 'processing' };
      }
      return { status: input.status, stopRequested: false };
    });
  }

  listSessions(): Array<{ id: string; projectId: string; roleId: string; cwd: string; revision: number }> {
    return this.db
      .prepare('SELECT id, projectId, roleId, cwd, revision FROM sessions ORDER BY id')
      .all() as unknown as Array<{
      id: string;
      projectId: string;
      roleId: string;
      cwd: string;
      revision: number;
    }>;
  }

  getSession(sessionId: string): {
    id: string;
    projectId: string;
    roleId: string;
    specialization: string | null;
    cwd: string;
    configRef: string | null;
    currentTaskId: string | null;
    revision: number;
  } | undefined {
    return this.db
      .prepare(
        'SELECT id, projectId, roleId, specialization, cwd, configRef, currentTaskId, revision FROM sessions WHERE id = ?',
      )
      .get(sessionId) as
      | {
          id: string;
          projectId: string;
          roleId: string;
          specialization: string | null;
          cwd: string;
          configRef: string | null;
          currentTaskId: string | null;
          revision: number;
        }
      | undefined;
  }

  /** Pi file binding for a logical session (S2 session_bindings): never pick "the newest file". */
  recordSessionBinding(params: {
    sessionId: string;
    piFile: string;
    branchEntryId?: string;
    hasHistory: boolean;
    configHash: string;
    rulesHash?: string;
  }): void {
    const timestamp = this.clock();
    this.db
      .prepare(
        `INSERT INTO session_bindings (sessionId, piFile, branchEntryId, hasHistory, configHash, rulesHash, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sessionId) DO UPDATE SET
           piFile = excluded.piFile,
           branchEntryId = excluded.branchEntryId,
           hasHistory = excluded.hasHistory,
           configHash = excluded.configHash,
           rulesHash = excluded.rulesHash,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        params.sessionId,
        params.piFile,
        params.branchEntryId ?? null,
        params.hasHistory ? 1 : 0,
        params.configHash,
        params.rulesHash ?? null,
        timestamp,
      );
  }

  getSessionBinding(sessionId: string): {
    sessionId: string;
    piFile: string;
    branchEntryId: string | null;
    hasHistory: boolean;
    configHash: string | null;
    rulesHash: string | null;
  } | undefined {
    const row = this.db
      .prepare(
        'SELECT sessionId, piFile, branchEntryId, hasHistory, configHash, rulesHash FROM session_bindings WHERE sessionId = ?',
      )
      .get(sessionId) as
      | {
          sessionId: string;
          piFile: string;
          branchEntryId: string | null;
          hasHistory: number;
          configHash: string | null;
          rulesHash: string | null;
        }
      | undefined;
    return row === undefined ? undefined : { ...row, hasHistory: row.hasHistory === 1 };
  }

  getInput(inputId: string): InputRow | undefined {
    return this.db.prepare('SELECT * FROM session_inputs WHERE inputId = ?').get(inputId) as
      | InputRow
      | undefined;
  }

  listInputs(sessionId: string): InputRow[] {
    return this.db
      .prepare('SELECT * FROM session_inputs WHERE sessionId = ? ORDER BY seq')
      .all(sessionId) as unknown as InputRow[];
  }

  pragmas(): { journalMode: string; synchronous: number; foreignKeys: number; userVersion: number } {
    const journal = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const synchronous = this.db.prepare('PRAGMA synchronous').get() as { synchronous: number };
    const foreignKeys = this.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    const userVersion = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    return {
      journalMode: journal.journal_mode,
      synchronous: synchronous.synchronous,
      foreignKeys: foreignKeys.foreign_keys,
      userVersion: userVersion.user_version,
    };
  }

  /** Create a Task and take the chief's slot in one transaction (S3: createTask). */
  createTask(params: CreateTaskParams): TaskRow {
    if (params.type === 'read' && params.requiresTest) {
      throw new StoreError('INVALID_ARGUMENT', 'a read Task cannot declare requiresTest', {
        taskId: params.id,
      });
    }
    return this.transaction(() => {
      const session = this.getSession(params.chiefSessionId);
      if (session === undefined) {
        throw new StoreError('NOT_FOUND', 'chief session does not exist', {
          sessionId: params.chiefSessionId,
        });
      }
      if (session.roleId !== 'chief') {
        throw new StoreError('INVALID_ARGUMENT', 'only a chief session can own a Task', {
          sessionId: params.chiefSessionId,
          roleId: session.roleId,
        });
      }
      const timestamp = this.clock();
      try {
        this.db
          .prepare(
            `INSERT INTO tasks
               (id, projectId, chiefSessionId, ownerEpoch, requirementId, type, requiresTest, goal,
                scope, acceptanceRefs, basisRefs, planRef, authorizationRefs, phase,
                currentSessionIds, status, revision, summary, sourceInputId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plan', '[]', 'active', 1, ?, ?, ?, ?)`,
          )
          .run(
            params.id,
            params.projectId,
            params.chiefSessionId,
            params.ownerEpoch,
            params.requirementId ?? null,
            params.type,
            params.requiresTest ? 1 : 0,
            params.goal,
            params.scope,
            canonical(params.acceptanceRefs),
            canonical(params.basisRefs),
            canonical(params.planRef),
            canonical(params.authorizationRefs),
            params.summary ?? '',
            params.sourceInputId,
            timestamp,
            timestamp,
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // SQLite names the violated columns (or the index for a partial index), not the constraint we
        // meant: both spellings are accepted so the caller gets the documented code either way.
        if (message.includes('tasks.chiefSessionId') || message.includes('idx_tasks_one_open_per_chief')) {
          throw new StoreError('WORKSPACE_BUSY', 'the chief session already has an open Task', {
            chiefSessionId: params.chiefSessionId,
          });
        }
        if (
          message.includes('tasks.requirementId') ||
          message.includes('idx_tasks_one_open_per_requirement')
        ) {
          throw new StoreError('TASK_BUSY', 'the requirement already has an open implementation Task', {
            requirementId: params.requirementId ?? null,
          });
        }
        throw error;
      }
      this.db
        .prepare('UPDATE sessions SET currentTaskId = ?, revision = revision + 1, updatedAt = ? WHERE id = ?')
        .run(params.id, timestamp, params.chiefSessionId);
      return this.requireTask(params.id);
    });
  }

  getTask(taskId: string): TaskRow | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? undefined : toTaskRow(row);
  }

  listTasks(projectId: string): TaskRow[] {
    return (
      this.db
        .prepare('SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt, id')
        .all(projectId) as unknown as Array<Record<string, unknown>>
    ).map(toTaskRow);
  }

  /**
   * Version-checked Task update. Providing a phase starts a new step: the current-step members must be
   * finished (none yet in this slice) and are cleared after the previous step's summary is kept.
   */
  updateTask(params: UpdateTaskParams): TaskRow {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      if (task.revision !== params.expectedRevision) {
        throw new StoreError('VERSION_CONFLICT', 'Task revision does not match', {
          taskId: params.taskId,
          expected: params.expectedRevision,
          actual: task.revision,
        });
      }
      if (params.phase !== undefined && task.currentSessionIds.length > 0) {
        // Stage readiness is judged per member input, not by whether the step still lists
        // members (a settled step keeps its membership for traceability — see
        // taskCompletionGaps). currentSessionIds is only cleared BY a phase change, so a
        // membership-count gate made phase transitions impossible once a step ever had
        // members (STAGE_NOT_READY forever; t-20a6fbfd stuck in develop).
        const busy: string[] = [];
        for (const sessionId of task.currentSessionIds) {
          const member = this.getTaskSession(sessionId);
          const inputId = member?.currentInputId ?? null;
          const input = inputId === null ? undefined : this.getInput(inputId);
          if (input !== undefined && ['queued', 'processing', 'stopping', 'interrupted'].includes(input.status)) {
            busy.push(`${sessionId}:${input.inputId}(${input.status})`);
          }
        }
        if (busy.length > 0) {
          throw new StoreError(
            'STAGE_NOT_READY',
            'the current step still has unfinished member work; wait or continue them before starting the next step',
            { taskId: params.taskId, busy },
          );
        }
      }
      if (task.type === 'read' && params.requiresTest === true) {
        throw new StoreError('INVALID_ARGUMENT', 'a read Task cannot declare requiresTest', {
          taskId: params.taskId,
        });
      }
      const timestamp = this.clock();
      const outcome = this.db
        .prepare(
          `UPDATE tasks SET
             phase = ?, currentSessionIds = ?, status = ?, summary = ?, nextStep = ?, blockReason = ?,
             planRef = COALESCE(?, planRef), goal = COALESCE(?, goal), scope = COALESCE(?, scope),
             acceptanceRefs = COALESCE(?, acceptanceRefs), basisRefs = COALESCE(?, basisRefs),
             requiresTest = COALESCE(?, requiresTest),
             revision = revision + 1, updatedAt = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          params.phase ?? task.phase,
          params.phase === undefined ? canonical(task.currentSessionIds) : '[]',
          params.status ?? task.status,
          params.summary ?? task.summary,
          params.nextStep ?? task.nextStep,
          params.blockReason ?? task.blockReason,
          params.planRef === undefined ? null : canonical(params.planRef),
          params.goal ?? null,
          params.scope ?? null,
          params.acceptanceRefs === undefined ? null : canonical(params.acceptanceRefs),
          params.basisRefs === undefined ? null : canonical(params.basisRefs),
          params.requiresTest === undefined ? null : params.requiresTest ? 1 : 0,
          timestamp,
          params.taskId,
          params.expectedRevision,
        );
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'Task moved while updating', {
          taskId: params.taskId,
        });
      }
      return this.requireTask(params.taskId);
    });
  }

  /**
   * Completion check for this slice: everything the contract requires that the store can verify.
   * Independent review/test/settlement reports arrive with their tools, so an endTask attempt now
   * reports exactly what is missing instead of pretending the Task is complete.
   */
  taskCompletionGaps(taskId: string, completionResultId: string): string[] {
    const gaps: string[] = [];
    const task = this.requireTask(taskId);
    // "Every professional work has stopped" is judged per member input, not by whether the current
    // step still has members listed (a settled step keeps its membership for traceability).
    for (const member of this.listTaskSessions(taskId)) {
      for (const input of this.listInputs(member.sessionId)) {
        if (input.status === 'queued' || input.status === 'processing') {
          gaps.push(`member ${member.sessionId} still has unfinished work (${input.inputId})`);
        }
        if (input.status === 'interrupted') {
          gaps.push(`member ${member.sessionId} has an unverified interrupted input (${input.inputId})`);
        }
      }
    }
    if (completionResultId.trim() === '') {
      gaps.push('no completion result was referenced');
    } else {
      const result = this.getResult(completionResultId);
      if (result === undefined || result.taskId !== taskId) {
        gaps.push(`completion result ${completionResultId} is not recorded for this Task`);
      } else {
        const wanted: readonly ResultKind[] = task.type === 'read' ? ['investigation', 'recovery'] : ['settlement'];
        if (!wanted.includes(result.kind)) {
          gaps.push(`completion result must be ${wanted.join(' or ')} for a ${task.type} Task`);
        }
        if (this.supersededBy(result.resultId) !== undefined) {
          gaps.push(`completion result ${result.resultId} was superseded`);
        }
      }
    }
    if (task.type === 'write') {
      const candidateId = this.candidateIdOf(task.candidate);
      const valid = (entry: ResultRow): boolean => this.supersededBy(entry.resultId) === undefined;
      const reviews = this.listTaskResults(taskId).filter(
        (entry) => entry.kind === 'review' && entry.verdict === 'passed' && entry.candidateId === candidateId,
      );
      const tests = this.listTaskResults(taskId).filter(
        (entry) => entry.kind === 'test' && entry.verdict === 'passed' && entry.candidateId === candidateId,
      );
      if (candidateId === null) {
        gaps.push('no candidate version was frozen for this Task');
      } else {
        // Every implementation flow includes an independent check (D-04), and it precedes the Test.
        const review = reviews.filter(valid)[0];
        if (review === undefined) {
          gaps.push(`no passed independent review is recorded for candidate ${candidateId}`);
        } else {
          const test = tests.filter(valid)[0];
          if (test !== undefined && test.createdAt < review.createdAt) {
            gaps.push('the independent test was recorded before the independent review');
          }
          if (task.requiresTest && test === undefined) {
            gaps.push(`no passed independent test is recorded for candidate ${candidateId}`);
          }
        }
      }
    }
    return gaps;
  }

  /** Release the chief slot and finish the Task; refuses while completion gaps remain. */
  endTask(params: { taskId: string; expectedRevision: number; completionResultId: string }):
    | { readonly ok: true; readonly task: TaskRow }
    | { readonly ok: false; readonly gaps: readonly string[] } {
    return this.transaction(() => {
      const gaps = this.taskCompletionGaps(params.taskId, params.completionResultId);
      if (gaps.length > 0) {
        return { ok: false, gaps };
      }
      const timestamp = this.clock();
      const task = this.requireTask(params.taskId);
      const outcome = this.db
        .prepare(
          `UPDATE tasks SET status = 'completed', completionResultId = ?, revision = revision + 1, updatedAt = ?
             WHERE id = ? AND revision = ?`,
        )
        .run(params.completionResultId, timestamp, params.taskId, params.expectedRevision);
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'Task revision does not match', {
          taskId: params.taskId,
        });
      }
      this.db
        .prepare(
          'UPDATE sessions SET currentTaskId = NULL, revision = revision + 1, updatedAt = ? WHERE id = ?',
        )
        .run(timestamp, task.chiefSessionId);
      return { ok: true, task: this.requireTask(params.taskId) };
    });
  }

  /**
   * Record one immutable result row in a single transaction. The body file is written and verified by
   * the caller first (S6), so this only stores what really exists on disk; the returned row is the
   * receipt the caller and the waiting aggregate read.
   */
  recordResult(params: {
    resultId: string;
    taskId: string;
    sessionId: string;
    inputId: string;
    roleId: string;
    kind: ResultKind;
    summary: string;
    verdict?: 'passed' | 'failed' | 'blocked';
    candidateId?: string;
    bodyRef: ArtifactRef;
    basisRefs: readonly string[];
    checks: readonly ResultCheck[];
    supersedesResultId?: string;
    settlement?: unknown;
  }): ResultRow {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      const member = this.getTaskSession(params.sessionId);
      if (member === undefined || member.taskId !== params.taskId) {
        throw new StoreError('NOT_FOUND', 'the reporting session is not a member of this Task', {
          taskId: params.taskId,
          sessionId: params.sessionId,
        });
      }
      const input = this.requireInput(params.inputId);
      if (input.sessionId !== params.sessionId || input.taskId !== params.taskId) {
        throw new StoreError('NOT_FOUND', 'the source input does not belong to this reporting member', {
          inputId: params.inputId,
        });
      }
      const allowed: readonly ResultKind[] = task.type === 'read' ? ['investigation', 'recovery'] : [
        'design',
        'implementation',
        'review',
        'test',
        'settlement',
      ];
      if (!allowed.includes(params.kind)) {
        throw new StoreError('INVALID_ARGUMENT', `a ${task.type} Task does not accept ${params.kind} reports`, {
          taskId: params.taskId,
          kind: params.kind,
        });
      }
      if ((params.kind === 'review' || params.kind === 'test') && params.verdict === undefined) {
        throw new StoreError('INVALID_ARGUMENT', 'a review or test report needs a verdict', {
          kind: params.kind,
        });
      }
      if (params.kind === 'review' || params.kind === 'test') {
        const candidate = this.candidateIdOf(task.candidate);
        if (candidate === null || params.candidateId !== candidate) {
          // A check must name the version it checked; a report about another version is not evidence.
          throw new StoreError('INVALID_ARGUMENT', 'the report must name the Task candidate version', {
            expected: candidate,
            given: params.candidateId ?? null,
          });
        }
      }
      if (params.supersedesResultId !== undefined) {
        const superseded = this.getResult(params.supersedesResultId);
        if (superseded === undefined || superseded.taskId !== params.taskId) {
          throw new StoreError('NOT_FOUND', 'the superseded result is not part of this Task', {
            supersedesResultId: params.supersedesResultId,
          });
        }
      }
      const existing = this.db
        .prepare('SELECT taskId FROM results WHERE resultId = ?')
        .get(params.resultId) as { taskId: string } | undefined;
      if (existing !== undefined) {
        throw new StoreError('REQUEST_CONFLICT', 'this resultId is already recorded', {
          resultId: params.resultId,
          taskId: existing.taskId,
        });
      }
      this.db
        .prepare(
          `INSERT INTO results
             (resultId, taskId, sessionId, inputId, roleId, kind, summary, verdict, candidateId, bodyRef,
              basisRefs, checks, supersedesResultId, settlement, createdAt, serverEpoch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          params.resultId,
          params.taskId,
          params.sessionId,
          params.inputId,
          params.roleId,
          params.kind,
          params.summary,
          params.verdict ?? null,
          params.candidateId ?? null,
          JSON.stringify(params.bodyRef),
          JSON.stringify(params.basisRefs),
          JSON.stringify(params.checks),
          params.supersedesResultId ?? null,
          params.settlement === undefined ? null : JSON.stringify(params.settlement),
          this.clock(),
          this.serverEpoch,
        );
      return this.requireResult(params.resultId);
    });
  }

  getResult(resultId: string): ResultRow | undefined {
    const row = this.db.prepare('SELECT * FROM results WHERE resultId = ?').get(resultId) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? undefined : toResultRow(row);
  }

  requireResult(resultId: string): ResultRow {
    const result = this.getResult(resultId);
    if (result === undefined) {
      throw new StoreError('NOT_FOUND', 'result does not exist', { resultId });
    }
    return result;
  }

  /** All results of a Task, oldest first, with the id of whatever superseded each one. */
  listTaskResults(taskId: string): ResultRow[] {
    const rows = this.db
      .prepare('SELECT * FROM results WHERE taskId = ? ORDER BY createdAt, resultId')
      .all(taskId) as Record<string, unknown>[];
    return rows.map((row) => toResultRow(row));
  }

  /** Results whose source input is one of these inputs (the aggregate reports what each member produced). */
  resultsForInputs(inputIds: readonly string[]): ResultRow[] {
    if (inputIds.length === 0) {
      return [];
    }
    const placeholders = inputIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM results WHERE inputId IN (${placeholders}) ORDER BY createdAt, resultId`)
      .all(...inputIds) as Record<string, unknown>[];
    return rows.map((row) => toResultRow(row));
  }

  /** The result that declared this one superseded, if any (S6: history is never overwritten). */
  supersededBy(resultId: string): ResultRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM results WHERE supersedesResultId = ? ORDER BY createdAt LIMIT 1')
      .get(resultId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : toResultRow(row);
  }

  private candidateIdOf(candidate: unknown): string | null {
    if (typeof candidate !== 'object' || candidate === null) {
      return null;
    }
    const value = (candidate as Record<string, unknown>)['candidateId'];
    return typeof value === 'string' ? value : null;
  }

  /** Register (or re-read) a host-owned file save so retries are idempotent (S6). */
  registerFileSave(params: {
    requestKey: string;
    target: string;
    expectedVersion?: string;
    contentHash: string;
    content: string;
    state: FileSaveRow['state'];
    receipt?: string;
  }): void {
    const timestamp = this.clock();
    this.db
      .prepare(
        `INSERT INTO file_saves (requestKey, target, expectedVersion, contentHash, content, state, receipt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(requestKey) DO UPDATE SET
           state = excluded.state, receipt = excluded.receipt,
           contentHash = excluded.contentHash, content = excluded.content,
           expectedVersion = excluded.expectedVersion, updatedAt = excluded.updatedAt`,
      )
      .run(
        params.requestKey,
        params.target,
        params.expectedVersion ?? null,
        params.contentHash,
        params.content,
        params.state,
        params.receipt ?? null,
        timestamp,
        timestamp,
      );
  }

  getFileSave(requestKey: string): FileSaveRow | undefined {
    return this.db
      .prepare('SELECT requestKey, target, expectedVersion, contentHash, content, state, receipt FROM file_saves WHERE requestKey = ?')
      .get(requestKey) as FileSaveRow | undefined;
  }

  /**
   * Create the current step's professional members atomically (S3: create/continue 专业工作): the
   * session row, its Task membership and its first input are written together, then the Task's
   * currentSessionIds are replaced by the new members.
   */
  createTaskSessions(params: {
    readonly taskId: string;
    readonly members: readonly CreateTaskSessionParams[];
  }): TaskSessionRow[] {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      for (const member of params.members) {
        if (member.taskId !== params.taskId) {
          throw new StoreError('INVALID_ARGUMENT', 'member belongs to another Task', {
            sessionId: member.sessionId,
          });
        }
        if (member.phase !== task.phase) {
          throw new StoreError('INVALID_ARGUMENT', 'member phase must be the Task current phase', {
            sessionId: member.sessionId,
            memberPhase: member.phase,
            taskPhase: task.phase,
          });
        }
        // expectedKind becomes the member's ONLY acceptable report kind (report-tools demands
        // kind === member.expectedKind). Accepting an invented kind here wedges the member:
        // every agent_report fails (the enum rejects the invented value, the match rejects
        // the legal ones) and the step can never close. Fail at creation instead.
        if (!(RESULT_KINDS as readonly string[]).includes(member.expectedKind)) {
          throw new StoreError('INVALID_ARGUMENT', `member expectedKind must be one of ${RESULT_KINDS.join(', ')}`, {
            sessionId: member.sessionId,
            expectedKind: member.expectedKind,
          });
        }
      }
      const timestamp = this.clock();
      const created: TaskSessionRow[] = [];
      for (const member of params.members) {
        this.createSession({
          id: member.sessionId,
          projectId: task.projectId,
          roleId: member.roleId,
          cwd: this.requireTaskCwd(task),
          ...(member.specialization !== undefined ? { specialization: member.specialization } : {}),
        });
        this.acceptInput({
          inputId: member.inputId,
          projectId: task.projectId,
          sessionId: member.sessionId,
          taskId: params.taskId,
          sourceKey: `delegation:${member.inputId}`,
          requestKey: member.inputId,
          method: 'task.session',
          kind: 'delegation',
          payload: member.inputPayload,
        });
        this.db
          .prepare('UPDATE sessions SET currentTaskId = ?, revision = revision + 1, updatedAt = ? WHERE id = ?')
          .run(params.taskId, timestamp, member.sessionId);
        this.db
          .prepare(
            `INSERT INTO task_sessions
               (sessionId, taskId, roleId, specialization, phase, label, instructions, refs,
                dependencies, expectedKind, candidateId, workspaceRef, currentInputId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            member.sessionId,
            params.taskId,
            member.roleId,
            member.specialization ?? null,
            member.phase,
            member.label,
            member.instructions,
            canonical(member.refs),
            canonical(member.dependencies),
            member.expectedKind,
            member.candidateId ?? null,
            member.workspaceRef ?? null,
            member.inputId,
            timestamp,
            timestamp,
          );
        created.push(this.requireTaskSession(member.sessionId));
      }
      const currentSessionIds = [...new Set([...task.currentSessionIds, ...created.map((m) => m.sessionId)])];
      this.db
        .prepare(
          'UPDATE tasks SET currentSessionIds = ?, revision = revision + 1, updatedAt = ? WHERE id = ?',
        )
        .run(canonical(currentSessionIds), timestamp, params.taskId);
      return created;
    });
  }

  /** Append a continuation input to an already settled member and point currentInputId at it. */
  continueTaskSession(params: {
    readonly sessionId: string;
    readonly instructions: string;
    readonly refs: readonly string[];
    readonly dependencies: readonly string[];
    readonly inputId: string;
  }): TaskSessionRow {
    return this.transaction(() => {
      const member = this.requireTaskSession(params.sessionId);
      const timestamp = this.clock();
      this.db
        .prepare(
          `UPDATE task_sessions SET instructions = ?, refs = ?, dependencies = ?, currentInputId = ?, updatedAt = ?
             WHERE sessionId = ?`,
        )
        .run(
          params.instructions,
          canonical(params.refs),
          canonical(params.dependencies),
          params.inputId,
          timestamp,
          params.sessionId,
        );
      this.acceptInput({
        inputId: params.inputId,
        projectId: this.requireTask(member.taskId).projectId,
        sessionId: params.sessionId,
        taskId: member.taskId,
        sourceKey: `continuation:${params.inputId}`,
        requestKey: params.inputId,
        method: 'task.session',
        kind: 'continuation',
        payload: { content: [{ type: 'text', text: params.instructions }] },
      });
      return this.requireTaskSession(params.sessionId);
    });
  }

  getTaskSession(sessionId: string): TaskSessionRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM task_sessions WHERE sessionId = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : toTaskSessionRow(row);
  }

  listTaskSessions(taskId: string): TaskSessionRow[] {
    return (
      this.db
        .prepare('SELECT * FROM task_sessions WHERE taskId = ? ORDER BY createdAt, sessionId')
        .all(taskId) as unknown as Array<Record<string, unknown>>
    ).map(toTaskSessionRow);
  }

  /** The Task a professional session belongs to (its type drives the session's tool set). */
  getTaskForSession(sessionId: string): TaskRow | undefined {
    const member = this.getTaskSession(sessionId);
    return member === undefined ? undefined : this.getTask(member.taskId);
  }

  /** Record the Task's control intent; the caller stops the work and reports the real state. */
  controlTask(params: {
    taskId: string;
    expectedRevision: number;
    command: 'pause' | 'resume' | 'cancel';
  }): TaskRow {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      if (task.status === 'completed' || task.status === 'cancelled') {
        // A terminal Task is finished history: control cannot rewrite it back into a live lifecycle.
        throw new StoreError('VERSION_CONFLICT', 'the Task is already terminal', {
          taskId: params.taskId,
          status: task.status,
        });
      }
      if (task.revision !== params.expectedRevision) {
        throw new StoreError('VERSION_CONFLICT', 'Task revision does not match', {
          taskId: params.taskId,
          actual: task.revision,
        });
      }
      const unfinished = this.unfinishedMemberWork(params.taskId);
      const next =
        params.command === 'pause'
          ? unfinished > 0
            ? 'pausing'
            : 'paused'
          : params.command === 'resume'
            ? task.status === 'paused' || task.status === 'pausing'
              ? 'active'
              : task.status
            : unfinished > 0
              ? 'cancelling'
              : 'cancelled';
      this.db
        .prepare('UPDATE tasks SET status = ?, revision = revision + 1, updatedAt = ? WHERE id = ? AND revision = ?')
        .run(next, this.clock(), params.taskId, params.expectedRevision);
      if (next === 'cancelled') {
        // The Task is over: only completion, cancellation or a safe handover free the chief's slot.
        this.db
          .prepare('UPDATE sessions SET currentTaskId = NULL, revision = revision + 1, updatedAt = ? WHERE id = ?')
          .run(this.clock(), task.chiefSessionId);
      }
      if (next === 'active') {
        // A paused Task keeps the association; re-bind defensively so a reloaded row finds its Task.
        this.db
          .prepare(
            'UPDATE sessions SET currentTaskId = ?, revision = revision + 1, updatedAt = ? WHERE id = ? AND (currentTaskId IS NULL OR currentTaskId = ?)',
          )
          .run(params.taskId, this.clock(), task.chiefSessionId, params.taskId);
      }
      return this.requireTask(params.taskId);
    });
  }

  /**
   * How many current-step members of this Task still have work that has not reached a terminal state.
   * A controlled Task only reaches its final status once this is zero.
   */
  private unfinishedMemberWork(taskId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS unfinished
         FROM task_sessions ts
         JOIN session_inputs i ON i.inputId = ts.currentInputId
         WHERE ts.taskId = ? AND i.status IN ('queued', 'processing', 'stopping')`,
      )
      .get(taskId) as { unfinished: number };
    return row.unfinished;
  }

  /**
   * Finish a control request once the Task's own work has actually stopped: move `pausing` to
   * `paused` (or `cancelling` to `cancelled`) and release the chief's slot.
   */
  finalizeControl(params: { taskId: string; status: 'paused' | 'cancelled' }): TaskRow {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      if (task.status === params.status) {
        return task;
      }
      const allowed =
        params.status === 'paused' ? task.status === 'pausing' : task.status === 'pausing' || task.status === 'cancelling';
      if (!allowed) {
        throw new StoreError('VERSION_CONFLICT', 'Task is not waiting for this control transition', {
          taskId: params.taskId,
          status: task.status,
        });
      }
      const timestamp = this.clock();
      this.db
        .prepare('UPDATE tasks SET status = ?, revision = revision + 1, updatedAt = ? WHERE id = ?')
        .run(params.status, timestamp, params.taskId);
      if (params.status === 'cancelled') {
        this.db
          .prepare('UPDATE sessions SET currentTaskId = NULL, revision = revision + 1, updatedAt = ? WHERE id = ?')
          .run(timestamp, task.chiefSessionId);
      }
      return this.requireTask(params.taskId);
    });
  }

  /** Freeze the delivered candidate version (files + digests) for Review/Test. */
  setCandidate(params: { taskId: string; expectedRevision: number; candidate: unknown }): TaskRow {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      if (task.status === 'completed' || task.status === 'cancelled') {
        // A terminal Task is finished history: control cannot rewrite it back into a live lifecycle.
        throw new StoreError('VERSION_CONFLICT', 'the Task is already terminal', {
          taskId: params.taskId,
          status: task.status,
        });
      }
      if (task.revision !== params.expectedRevision) {
        throw new StoreError('VERSION_CONFLICT', 'Task revision does not match', {
          taskId: params.taskId,
          actual: task.revision,
        });
      }
      this.db
        .prepare('UPDATE tasks SET candidate = ?, revision = revision + 1, updatedAt = ? WHERE id = ? AND revision = ?')
        .run(canonical(params.candidate), this.clock(), params.taskId, params.expectedRevision);
      return this.requireTask(params.taskId);
    });
  }

  private requireTaskCwd(task: TaskRow): string {
    const session = this.getSession(task.chiefSessionId);
    if (session === undefined) {
      throw new StoreError('NOT_FOUND', 'the Task chief session is gone', { taskId: task.id });
    }
    return session.cwd;
  }

  private requireTaskSession(sessionId: string): TaskSessionRow {
    const member = this.getTaskSession(sessionId);
    if (member === undefined) {
      throw new StoreError('NOT_FOUND', 'this session is not a Task member', { sessionId });
    }
    return member;
  }

  private requireTask(taskId: string): TaskRow {
    const task = this.getTask(taskId);
    if (task === undefined) {
      throw new StoreError('NOT_FOUND', 'Task does not exist', { taskId });
    }
    return task;
  }

  private requireInput(inputId: string): InputRow {
    const input = this.getInput(inputId);
    if (input === undefined) {
      throw new StoreError('NOT_FOUND', 'input does not exist', { inputId });
    }
    return input;
  }

  private assertPragmas(): void {
    const actual = this.pragmas();
    if (
      actual.journalMode !== REQUIRED_PRAGMAS.journal_mode ||
      actual.synchronous !== REQUIRED_PRAGMAS.synchronous ||
      actual.foreignKeys !== REQUIRED_PRAGMAS.foreign_keys
    ) {
      throw new StoreError('INVALID_ARGUMENT', 'required SQLite pragmas are not in effect', {
        actual,
        required: REQUIRED_PRAGMAS,
      });
    }
  }

  private migrateV2ToV3(): void {
    this.transaction(() => {
      this.db.exec(V3_DDL);
      this.db.exec('PRAGMA user_version = 3;');
    });
  }

  private migrateV3ToV4(): void {
    this.transaction(() => {
      this.db.exec(V4_DDL);
      const column = this.db
        .prepare("SELECT COUNT(*) AS present FROM pragma_table_info('tasks') WHERE name = 'candidate'")
        .get() as { present: number };
      if (column.present === 0) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN candidate TEXT');
      }
      this.db.exec('PRAGMA user_version = 4;');
    });
  }

  private migrateV4ToV5(): void {
    this.transaction(() => {
      this.db.exec(V5_DDL);
      this.db.exec('PRAGMA user_version = 5;');
    });
  }

  private migrateV6ToV7(): void {
    this.transaction(() => {
      this.db.exec(V7_DDL);
      this.db.exec('PRAGMA user_version = 7;');
    });
  }

  private migrateV5ToV6(): void {
    this.transaction(() => {
      const column = this.db
        .prepare("SELECT COUNT(*) AS present FROM pragma_table_info('session_inputs') WHERE name = 'recovery'")
        .get() as { present: number };
      if (column.present === 0) {
        this.db.exec(V6_DDL);
      }
      this.db.exec('PRAGMA user_version = 6;');
    });
  }

  private migrateV7ToV8(): void {
    this.transaction(() => {
      this.db.exec(V8_DDL);
      this.db.exec('PRAGMA user_version = 8;');
    });
  }

  private migrate(): void {
    const { userVersion } = this.pragmas();
    if (userVersion === 0) {
      this.transaction(() => {
        this.db.exec(SCHEMA_SQL);
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      });
    } else if (userVersion === 1) {
      this.transaction(() => {
        for (const column of V2_COLUMNS) {
          this.db.exec(column.ddl);
        }
        this.db.exec(SESSION_BINDINGS_SQL);
        this.db.exec('PRAGMA user_version = 2;');
      });
      this.migrateV2ToV3();
      this.migrateV3ToV4();
      this.migrateV4ToV5();
      this.migrateV5ToV6();
      this.migrateV6ToV7();
      this.migrateV7ToV8();
    } else if (userVersion === 2) {
      this.migrateV2ToV3();
      this.migrateV3ToV4();
      this.migrateV4ToV5();
      this.migrateV5ToV6();
      this.migrateV6ToV7();
      this.migrateV7ToV8();
    } else if (userVersion === 3) {
      this.migrateV3ToV4();
      this.migrateV4ToV5();
      this.migrateV5ToV6();
      this.migrateV6ToV7();
      this.migrateV7ToV8();
    } else if (userVersion === 4) {
      this.migrateV4ToV5();
      this.migrateV5ToV6();
      this.migrateV6ToV7();
      this.migrateV7ToV8();
    } else if (userVersion === 5) {
      this.migrateV5ToV6();
      this.migrateV6ToV7();
      this.migrateV7ToV8();
    } else if (userVersion === 6) {
      this.migrateV6ToV7();
      this.migrateV7ToV8();
    } else if (userVersion === 7) {
      this.migrateV7ToV8();
    } else if (userVersion !== SCHEMA_VERSION) {
      throw new StoreError('VERSION_CONFLICT', 'unsupported store schema version', {
        userVersion,
        supported: SCHEMA_VERSION,
      });
    }
    // Idempotent invariant that must also hold on databases created by an earlier revision, where
    // the version gate above skips the schema script.
    try {
      this.db.exec(ONE_PROCESSING_INDEX_SQL);
    } catch (error) {
      throw new StoreError(
        'VERSION_CONFLICT',
        'this database already has more than one running input in a session; resolve them before upgrading',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Run work inside one transaction. Nested calls join the outer transaction instead of issuing a
   * second BEGIN (SQLite has no nested transactions), so composite operations stay atomic.
   */
  private transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) {
      return work();
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }
}

function parseStringList(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function parseArtifactRef(value: unknown): ArtifactRef | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const storage = record['storage'];
  const path = record['path'];
  const sha256 = record['sha256'];
  if ((storage !== 'project' && storage !== 'server') || typeof path !== 'string' || typeof sha256 !== 'string') {
    return null;
  }
  return { storage, path, sha256 };
}

function parseJsonOrNull(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Whether an answer fits the interaction it answers (M5). `{cancelled:true}` is always allowed: it is
 * how a dismissed dialog is reported.
 */
function answerIssue(interaction: InteractionRow, response: unknown): string | undefined {
  if (typeof response === 'object' && response !== null && (response as { cancelled?: unknown }).cancelled === true) {
    return undefined;
  }
  const value = (candidate: unknown): string | undefined =>
    typeof candidate === 'string'
      ? candidate
      : typeof candidate === 'object' && candidate !== null && typeof (candidate as { value?: unknown }).value === 'string'
        ? (candidate as { value: string }).value
        : undefined;
  if (interaction.method === 'confirm') {
    const confirmed =
      typeof response === 'boolean'
        ? response
        : typeof response === 'object' && response !== null && typeof (response as { confirmed?: unknown }).confirmed === 'boolean'
          ? (response as { confirmed: boolean }).confirmed
          : undefined;
    return confirmed === undefined ? 'a confirmation answer must be a boolean or {confirmed}' : undefined;
  }
  const answered = value(response);
  if (answered === undefined) {
    return 'the answer must be a string or {value}';
  }
  if (interaction.method === 'select') {
    const options = interaction.options === null ? [] : (JSON.parse(interaction.options) as string[]);
    return options.includes(answered) ? undefined : 'the answer is not one of the offered options';
  }
  return undefined;
}

function toProviderRow(row: Record<string, unknown>): ProviderRow {
  return {
    providerId: String(row['providerId']),
    baseUrl: String(row['baseUrl']),
    api: row['api'] === null ? null : String(row['api']),
    models: String(row['models']),
    credentialRef: row['credentialRef'] === null ? null : String(row['credentialRef']),
    revision: Number(row['revision']),
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}

function toModelOverrideRow(row: Record<string, unknown>): ModelOverrideRow {
  return {
    scope: String(row['scope']) === 'project' ? 'project' : 'role',
    scopeId: String(row['scopeId']),
    providerId: String(row['providerId']),
    modelId: String(row['modelId']),
    revision: Number(row['revision']),
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}

function toProjectRow(row: Record<string, unknown>): ProjectRow {
  const nullable = (value: unknown): string | null => (value === null ? null : String(value));
  return {
    id: String(row['id']),
    realPath: String(row['realPath']),
    revision: Number(row['revision']),
    initializationRef: parseJsonOrNull(row['initializationRef']),
    configRef: nullable(row['configRef']),
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}

function toResultRow(row: Record<string, unknown>): ResultRow {
  const nullable = (value: unknown): string | null => (value === null ? null : String(value));
  const verdict = row['verdict'];
  const checks = parseJsonOrNull(row['checks']);
  return {
    resultId: String(row['resultId']),
    taskId: String(row['taskId']),
    sessionId: String(row['sessionId']),
    inputId: String(row['inputId']),
    roleId: String(row['roleId']),
    kind: String(row['kind']) as ResultKind,
    summary: String(row['summary']),
    verdict: verdict === 'passed' || verdict === 'failed' || verdict === 'blocked' ? verdict : null,
    candidateId: nullable(row['candidateId']),
    bodyRef: parseArtifactRef(row['bodyRef']) ?? { storage: 'server', path: '', sha256: '' },
    basisRefs: parseStringList(row['basisRefs']),
    checks: Array.isArray(checks) ? (checks as ResultCheck[]) : [],
    supersedesResultId: nullable(row['supersedesResultId']),
    settlement: parseJsonOrNull(row['settlement']),
    createdAt: String(row['createdAt']),
  };
}

function toTaskSessionRow(row: Record<string, unknown>): TaskSessionRow {
  const nullable = (value: unknown): string | null => (value === null ? null : String(value));
  return {
    sessionId: String(row['sessionId']),
    taskId: String(row['taskId']),
    roleId: String(row['roleId']),
    specialization: nullable(row['specialization']),
    phase: String(row['phase']) as TaskPhase,
    label: String(row['label']),
    instructions: String(row['instructions']),
    refs: parseStringList(row['refs']),
    dependencies: parseStringList(row['dependencies']),
    expectedKind: String(row['expectedKind']),
    candidateId: nullable(row['candidateId']),
    workspaceRef: nullable(row['workspaceRef']),
    currentInputId: nullable(row['currentInputId']),
  };
}

function toTaskRow(row: Record<string, unknown>): TaskRow {
  const nullable = (value: unknown): string | null => (value === null ? null : String(value));
  return {
    id: String(row['id']),
    projectId: String(row['projectId']),
    chiefSessionId: String(row['chiefSessionId']),
    ownerEpoch: Number(row['ownerEpoch']),
    requirementId: nullable(row['requirementId']),
    type: row['type'] === 'write' ? 'write' : 'read',
    requiresTest: Number(row['requiresTest']) === 1,
    goal: String(row['goal']),
    scope: String(row['scope']),
    acceptanceRefs: parseStringList(row['acceptanceRefs']),
    basisRefs: parseStringList(row['basisRefs']),
    planRef: parseArtifactRef(row['planRef']),
    authorizationRefs: parseStringList(row['authorizationRefs']),
    phase: String(row['phase']) as TaskPhase,
    currentSessionIds: parseStringList(row['currentSessionIds']),
    status: String(row['status']) as TaskStatus,
    revision: Number(row['revision']),
    summary: String(row['summary']),
    nextStep: nullable(row['nextStep']),
    blockReason: nullable(row['blockReason']),
    completionResultId: nullable(row['completionResultId']),
    candidate: parseJsonOrNull(row['candidate']),
    sourceInputId: String(row['sourceInputId']),
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}