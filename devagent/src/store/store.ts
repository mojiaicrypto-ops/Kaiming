/**
 * Storage and dispatch core (P1): durable input acceptance, claim, control intent and restart
 * classification. This module deliberately contains no model, tool or business logic — it records
 * facts and enforces state/version rules (see S1–S3 of the storage contract).
 *
 * Driver: Node's built-in `node:sqlite` (no native dependency).
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { digestOfPaths, type DeliveryState } from '../runtime/deliverable.ts';

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
  /** The name the user sees; NULL keeps showing providerId. */
  readonly name: string | null;
  /** JSON array of `{ id, name, upstream?, reasoning?, thinkingLevelMap? }`: the models this provider offers. */
  readonly models: string;
  /** Where the credential lives (private store); never the credential itself. */
  readonly credentialRef: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Which provider/model a role or a project uses, overriding the server default. For `scope=project`
 * a non-empty `roleId` narrows the override to one role inside that project; empty means the whole
 * project. A global role override keeps `roleId` empty because `scopeId` already names the role.
 */
export interface ModelOverrideRow {
  readonly scope: 'role' | 'project';
  readonly scopeId: string;
  readonly roleId: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Pi thinking level saved with this assignment; empty means "unset" (Pi runs it at `off`). */
  readonly thinkingLevel: string;
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
  /** Project-relative paths or globs this member owns in a parallel write step (G3/R-04). */
  readonly writeScope: readonly string[];
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
  /** What the program observed when this review/test arrived (G3); null for other kinds. */
  readonly deliveryState: DeliveryState | null;
  readonly bodyRef: ArtifactRef;
  readonly basisRefs: readonly string[];
  readonly checks: readonly ResultCheck[];
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
  readonly writeScope?: readonly string[];
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
  /** An external channel owns at most one session per project (unique index enforces it). */
  readonly channel?: string;
}

const REQUIRED_PRAGMAS = { journal_mode: 'wal', synchronous: 2, foreign_keys: 1 } as const;

export const SCHEMA_VERSION = 15;

/**
 * Tables added by the v4 → v5 migration: the formal results (reports) a Task's work is judged by.
 * A result is immutable; this is the v5 shape as shipped, and the v9 step drops the candidate and
 * supersession columns that the model-facing protocol no longer uses.
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

/** One fixed session per (project, external channel): the MCP surface must never create a second. */
const SESSIONS_CHANNEL_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_channel ON sessions (projectId, channel) WHERE channel IS NOT NULL;';

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
  writeScope TEXT NOT NULL DEFAULT '[]',
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

/**
 * Usage ledger: one row per (input, role, model), appended when the input reaches its end.
 *
 * A ledger rather than counters: the requirement asks for totals by role, by model, per project and
 * across projects, and a running counter cannot answer "which model cost this" after the fact, nor be
 * corrected. Rows are tiny (one input produces one row per model it touched), and every figure the
 * UI shows is a GROUP BY over this table.
 *
 * Numeric columns are nullable on purpose: a gateway that reports no usage must read as "not
 * reported", never as zero.
 */
const USAGE_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS usage_entries (
  inputId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  taskId TEXT,
  roleId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  modelId TEXT NOT NULL,
  inputTokens INTEGER,
  outputTokens INTEGER,
  cacheReadTokens INTEGER,
  cacheWriteTokens INTEGER,
  reasoningTokens INTEGER,
  costTotal REAL,
  responses INTEGER NOT NULL,
  startedAt TEXT NOT NULL,
  endedAt TEXT NOT NULL,
  PRIMARY KEY (inputId, providerId, modelId)
);
CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_entries (projectId, endedAt);
CREATE INDEX IF NOT EXISTS idx_usage_role ON usage_entries (roleId);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_entries (providerId, modelId);
`;

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
  /** The name the user gave this conversation; NULL keeps the derived title from the first input. */
  title TEXT,
  /** The external channel this session is the fixed home of ('mcp'), or NULL for an ordinary one. */
  channel TEXT,
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
  /** Display name the user can change; NULL falls back to providerId. */
  name TEXT,
  models TEXT NOT NULL,
  credentialRef TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_overrides (
  scope TEXT NOT NULL,
  scopeId TEXT NOT NULL,
  roleId TEXT NOT NULL DEFAULT '',
  providerId TEXT NOT NULL,
  modelId TEXT NOT NULL,
  thinkingLevel TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (scope, scopeId, roleId)
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

  /** Record the entries a project was initialized with (the files are already verified on disk). */
  setProjectInitialization(params: { projectId: string; initializationRef: unknown }): ProjectRow {
    return this.transaction(() => {
      const project = this.getProject(params.projectId);
      if (project === undefined) {
        throw new StoreError('NOT_FOUND', 'project does not exist', { projectId: params.projectId });
      }
      this.db
        .prepare('UPDATE projects SET initializationRef = ?, revision = revision + 1, updatedAt = ? WHERE id = ?')
        .run(JSON.stringify(params.initializationRef), this.clock(), params.projectId);
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
        'INSERT INTO sessions (id, projectId, roleId, specialization, cwd, channel, revision, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(
        params.id,
        params.projectId,
        params.roleId,
        params.specialization ?? null,
        params.cwd,
        params.channel ?? null,
        timestamp,
        timestamp,
      );
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
      // The answer must fit the question: a select takes a non-empty string (M5 trust boundary).
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
   * Name a conversation. An empty title removes the name, which puts the row back on its derived
   * title - the user asked for "default again", not for an empty label. Nothing else about the
   * session changes: history, ownership and authorization are not the name's business.
   */
  renameSession(params: { sessionId: string; title: string | null; expectedRevision: number }): {
    title: string | null;
    revision: number;
  } {
    return this.transaction(() => {
      const session = this.getSession(params.sessionId);
      if (session === undefined) {
        throw new StoreError('NOT_FOUND', 'session does not exist', { sessionId: params.sessionId });
      }
      const title = params.title === null || params.title.trim() === '' ? null : params.title.trim();
      const outcome = this.db
        .prepare('UPDATE sessions SET title = ?, revision = revision + 1, updatedAt = ? WHERE id = ? AND revision = ?')
        .run(title, this.clock(), params.sessionId, params.expectedRevision);
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'session revision does not match', {
          sessionId: params.sessionId,
          actual: session.revision,
        });
      }
      const updated = this.getSession(params.sessionId);
      return { title: updated?.title ?? null, revision: updated?.revision ?? params.expectedRevision + 1 };
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
        // A Task's work plus, when this session is its chief, the chief's own conversation inputs:
        // those are how a paused Task is discussed and resumed, not work the pause holds.
        const owned = this.db
          .prepare(
            `SELECT i.inputId AS inputId,
                    i.kind IN ('user', 'system_notice')
                      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = i.taskId AND t.chiefSessionId = i.sessionId)
                      AS held
               FROM session_inputs i
              WHERE i.sessionId = ? AND i.status = 'queued' AND i.taskId = ?
              ORDER BY i.seq LIMIT 1`,
          )
          .get(sessionId, currentTask.currentTaskId) as { inputId: string; held: number } | undefined;
        if (owned === undefined) {
          return { kind: 'busy', inputId: candidate.inputId } as ClaimResult;
        }
        if (owned.held !== 0) {
          // Not this Task's chief, and not Task work either: the job waits with the Task, and the gate
          // below says so (`controlled`), exactly as it did before the chief's own turn was exempted.
          return { kind: 'controlled', inputId: owned.inputId, code: 'TASK_CONTROLLED' } as ClaimResult;
        }
        candidate = { inputId: owned.inputId };
      }
      const owner = this.db
        .prepare(
          `SELECT t.status AS taskStatus, t.chiefSessionId AS chiefSessionId, i.kind AS kind,
                  ts.roleId AS roleId, ts.expectedKind AS expectedKind
           FROM session_inputs i
           JOIN tasks t ON t.id = i.taskId
           LEFT JOIN task_sessions ts ON ts.sessionId = i.sessionId AND ts.taskId = i.taskId
           WHERE i.inputId = ?`,
        )
        .get(candidate.inputId) as
        | { taskStatus: string; chiefSessionId: string; kind: InputKind; roleId: string | null; expectedKind: string | null }
        | undefined;
      if (owner !== undefined && owner.taskStatus !== 'active' && owner.taskStatus !== 'waiting') {
        // A paused Task hands out exactly two kinds of work: the chief's own turn, and the read-only
        // recovery check. The chief's conversation is not Task work - it is how the user finds out
        // what happened and how the Task gets resumed - so freezing it would leave the session with
        // no way back (R3/S3). It still may not write to the project: the tool set drops the writing
        // tools while the Task is not running.
        const chiefTurn =
          (owner.taskStatus === 'paused' || owner.taskStatus === 'pausing') &&
          owner.chiefSessionId === sessionId &&
          (owner.kind === 'user' || owner.kind === 'system_notice');
        const recovery =
          (owner.taskStatus === 'paused' || owner.taskStatus === 'pausing') &&
          owner.roleId === 'investigator' &&
          owner.expectedKind === 'recovery';
        if (!chiefTurn && !recovery) {
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
   * Write one input's usage to the ledger, aggregated per (role, model).
   *
   * The caller passes **absolute totals for that input**, so this is an upsert rather than an append:
   * the runner flushes after every completed response, which is what lets a long Task show its cost
   * while it runs, and the input's final flush simply overwrites with the same (or larger) figures.
   * Because the values are absolute, re-flushing or replaying an input cannot double-count — the row
   * for `(inputId, providerId, modelId)` always states "this input used this much on this model".
   *
   * Values are nullable because "the gateway reported nothing" and "the gateway reported zero" are
   * different facts, and only one of them means free.
   */
  recordUsage(params: {
    inputId: string;
    projectId: string;
    sessionId: string;
    taskId?: string | null;
    roleId: string;
    startedAt: string;
    endedAt: string;
    entries: readonly {
      providerId: string;
      modelId: string;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
      cacheWriteTokens: number | null;
      reasoningTokens: number | null;
      costTotal: number | null;
      responses: number;
    }[];
  }): number {
    if (params.entries.length === 0) return 0;
    return this.transaction(() => {
      const statement = this.db.prepare(
        `INSERT INTO usage_entries
           (inputId, projectId, sessionId, taskId, roleId, providerId, modelId, inputTokens, outputTokens,
            cacheReadTokens, cacheWriteTokens, reasoningTokens, costTotal, responses, startedAt, endedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(inputId, providerId, modelId) DO UPDATE SET
           inputTokens = excluded.inputTokens,
           outputTokens = excluded.outputTokens,
           cacheReadTokens = excluded.cacheReadTokens,
           cacheWriteTokens = excluded.cacheWriteTokens,
           reasoningTokens = excluded.reasoningTokens,
           costTotal = excluded.costTotal,
           responses = excluded.responses,
           endedAt = excluded.endedAt`,
      );
      let written = 0;
      for (const entry of params.entries) {
        const outcome = statement.run(
          params.inputId,
          params.projectId,
          params.sessionId,
          params.taskId ?? null,
          params.roleId,
          entry.providerId,
          entry.modelId,
          entry.inputTokens,
          entry.outputTokens,
          entry.cacheReadTokens,
          entry.cacheWriteTokens,
          entry.reasoningTokens,
          entry.costTotal,
          entry.responses,
          params.startedAt,
          params.endedAt,
        );
        written += Number(outcome.changes);
      }
      return written;
    });
  }

  /**
   * Usage totals, grouped three ways over the same rows.
   *
   * `projectId` omitted means every project — the scope switch is exactly this argument, so the two
   * views can never disagree about what "all projects" contains. Sums are `SUM()` over the ledger
   * (NULLs skipped by SQLite, so a model that never reported usage contributes no tokens and still
   * counts its responses).
   */
  usageReport(params: { projectId?: string } = {}): UsageReport {
    const where = params.projectId === undefined ? '' : 'WHERE projectId = ?';
    const args = params.projectId === undefined ? [] : [params.projectId];
    const group = (column: string): string =>
      `SELECT ${column} AS key,
              COUNT(*) AS rows,
              SUM(responses) AS responses,
              SUM(inputTokens) AS inputTokens,
              SUM(outputTokens) AS outputTokens,
              SUM(cacheReadTokens) AS cacheReadTokens,
              SUM(cacheWriteTokens) AS cacheWriteTokens,
              SUM(reasoningTokens) AS reasoningTokens,
              SUM(costTotal) AS costTotal
         FROM usage_entries ${where}
        GROUP BY ${column}
        ORDER BY SUM(COALESCE(inputTokens, 0) + COALESCE(outputTokens, 0)) DESC, key`;

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS rows,
                SUM(responses) AS responses,
                SUM(inputTokens) AS inputTokens,
                SUM(outputTokens) AS outputTokens,
                SUM(cacheReadTokens) AS cacheReadTokens,
                SUM(cacheWriteTokens) AS cacheWriteTokens,
                SUM(reasoningTokens) AS reasoningTokens,
                SUM(costTotal) AS costTotal
           FROM usage_entries ${where}`,
      )
      .get(...args) as Record<string, unknown>;

    const roleRows = this.db.prepare(group('roleId')).all(...args) as Array<Record<string, unknown>>;
    const modelRows = this.db
      .prepare(
        `SELECT providerId, modelId,
                COUNT(*) AS rows,
                SUM(responses) AS responses,
                SUM(inputTokens) AS inputTokens,
                SUM(outputTokens) AS outputTokens,
                SUM(cacheReadTokens) AS cacheReadTokens,
                SUM(cacheWriteTokens) AS cacheWriteTokens,
                SUM(reasoningTokens) AS reasoningTokens,
                SUM(costTotal) AS costTotal
           FROM usage_entries ${where}
          GROUP BY providerId, modelId
          ORDER BY SUM(COALESCE(inputTokens, 0) + COALESCE(outputTokens, 0)) DESC, providerId, modelId`,
      )
      .all(...args) as Array<Record<string, unknown>>;

    return {
      scope: params.projectId === undefined ? 'all' : 'project',
      totals: usageFigures(totals),
      byRole: roleRows.map((row) => ({ roleId: String(row['key']), ...usageFigures(row) })),
      byModel: modelRows.map((row) => ({
        providerId: String(row['providerId']),
        modelId: String(row['modelId']),
        ...usageFigures(row),
      })),
    };
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
    /** Display name; omitted on an update keeps the stored one. */
    name?: string;
    models: readonly {
      id: string;
      name: string;
      /** The catalogue model this endpoint id really is; the facts below are copied from it. */
      upstream?: string;
      reasoning?: boolean;
      thinkingLevelMap?: Readonly<Record<string, string | null>>;
    }[];
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
            `INSERT INTO providers (providerId, baseUrl, api, name, models, credentialRef, revision, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            params.providerId,
            params.baseUrl,
            params.api ?? null,
            params.name ?? null,
            models,
            params.credentialRef ?? null,
            timestamp,
            timestamp,
          );
      } else {
        this.db
          .prepare(
            `UPDATE providers SET baseUrl = ?, api = ?, name = ?, models = ?, credentialRef = ?, revision = revision + 1, updatedAt = ?
              WHERE providerId = ? AND revision = ?`,
          )
          .run(
            params.baseUrl,
            params.api ?? null,
            params.name ?? existing.name,
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
    /** Only for `scope=project`: the role this override is for; empty means the whole project. */
    roleId?: string;
    providerId: string;
    modelId: string;
    /** Pi thinking level for this assignment; empty/omitted means unset, never "keep the old one". */
    thinkingLevel?: string;
    expectedRevision: number | null;
  }): ModelOverrideRow {
    const roleId = params.roleId ?? '';
    return this.transaction(() => {
      const existing = this.getModelOverride(params.scope, params.scopeId, roleId);
      if (params.expectedRevision === null) {
        if (existing !== undefined) {
          throw new StoreError('VERSION_CONFLICT', `${params.scope} ${params.scopeId} already has an override`, {
            scope: params.scope,
            scopeId: params.scopeId,
            roleId,
            actual: existing.revision,
          });
        }
      } else if (existing === undefined || existing.revision !== params.expectedRevision) {
        throw new StoreError('VERSION_CONFLICT', `${params.scope} ${params.scopeId} revision does not match`, {
          scope: params.scope,
          scopeId: params.scopeId,
          roleId,
          expected: params.expectedRevision,
          actual: existing?.revision ?? null,
        });
      }
      const timestamp = this.clock();
      if (existing === undefined) {
        this.db
          .prepare(
            `INSERT INTO model_overrides (scope, scopeId, roleId, providerId, modelId, thinkingLevel, revision, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            params.scope,
            params.scopeId,
            roleId,
            params.providerId,
            params.modelId,
            params.thinkingLevel ?? '',
            timestamp,
            timestamp,
          );
      } else {
        this.db
          .prepare(
            `UPDATE model_overrides SET providerId = ?, modelId = ?, thinkingLevel = ?, revision = revision + 1, updatedAt = ?
              WHERE scope = ? AND scopeId = ? AND roleId = ? AND revision = ?`,
          )
          .run(
            params.providerId,
            params.modelId,
            params.thinkingLevel ?? '',
            timestamp,
            params.scope,
            params.scopeId,
            roleId,
            params.expectedRevision ?? 0,
          );
      }
      const saved = this.getModelOverride(params.scope, params.scopeId, roleId);
      if (saved === undefined) {
        throw new StoreError('NOT_FOUND', `${params.scope} ${params.scopeId} override was not saved`);
      }
      return saved;
    });
  }

  getModelOverride(scope: 'role' | 'project', scopeId: string, roleId = ''): ModelOverrideRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM model_overrides WHERE scope = ? AND scopeId = ? AND roleId = ?')
      .get(scope, scopeId, roleId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : toModelOverrideRow(row);
  }

  listModelOverrides(scope: 'role' | 'project'): ModelOverrideRow[] {
    const rows = this.db
      .prepare('SELECT * FROM model_overrides WHERE scope = ? ORDER BY scopeId, roleId')
      .all(scope) as Array<Record<string, unknown>>;
    return rows.map(toModelOverrideRow);
  }

  /** Remove one layer of the model configuration: an unnamed role (or the whole project) falls back. */
  deleteModelOverride(scope: 'role' | 'project', scopeId: string, roleId = ''): boolean {
    const outcome = this.db
      .prepare('DELETE FROM model_overrides WHERE scope = ? AND scopeId = ? AND roleId = ?')
      .run(scope, scopeId, roleId);
    return outcome.changes > 0;
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
  /**
   * Interrupted inputs of CHIEF sessions. A chief cannot resolve its own interrupted input
   * (the claim gate refuses the session while it exists, so it can never run), yet the same
   * gate then freezes every later input of that session — the user's messages included. The
   * host closes these directly at startup (R4: "while you yourself are still interrupted, the
   * host verifies and closes directly").
   */
  listInterruptedChiefInputs(): Array<{ inputId: string; sessionId: string; revision: number; taskId: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT i.inputId AS inputId, i.sessionId AS sessionId, i.revision AS revision, i.taskId AS taskId
           FROM session_inputs i
           JOIN sessions s ON s.id = i.sessionId
          WHERE i.status = 'interrupted' AND s.roleId = 'chief'
          ORDER BY i.seq`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      inputId: String(row['inputId']),
      sessionId: String(row['sessionId']),
      revision: Number(row['revision']),
      taskId: row['taskId'] === null ? null : String(row['taskId']),
    }));
  }

  /** Drop a foreign generation's pending interactions: their calling run no longer exists. */
  staleInteractionsOfInterruptedInputs(): number {
    const outcome = this.db
      .prepare(
        `UPDATE interactions SET state = 'stale', revision = revision + 1, updatedAt = ?
          WHERE state = 'pending' AND inputId IN (
            SELECT inputId FROM session_inputs WHERE status = 'interrupted'
          )`,
      )
      .run(this.clock());
    return Number(outcome.changes);
  }

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

  /**
   * The rows a session list needs, in two queries rather than two per session: the last activity
   * and the live status come from the input rows themselves (R2), and the first user text is the
   * title. `stopRequested` is carried so a caller can say "stopping" instead of "working".
   */
  listSessionSummaries(projectId: string): Array<{
    id: string;
    roleId: string;
    revision: number;
    currentTaskId: string | null;
    lastActivityAt: string | null;
    processing: number;
    queued: number;
    stopping: number;
    /** The name the user gave this conversation, or null when it still derives one. */
    storedTitle: string | null;
    /** The external channel this session is the fixed home of, or null for an ordinary one. */
    channel: string | null;
    /** The first user input's payload (JSON), the raw material for a derived title. */
    derivedTitle: string | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT s.id AS id, s.roleId AS roleId, s.revision AS revision, s.currentTaskId AS currentTaskId,
                s.title AS storedTitle, s.channel AS channel,
                MAX(i.updatedAt) AS lastActivityAt,
                SUM(CASE WHEN i.status = 'processing' THEN 1 ELSE 0 END) AS processing,
                SUM(CASE WHEN i.status = 'queued' THEN 1 ELSE 0 END) AS queued,
                SUM(CASE WHEN i.status = 'processing' AND i.stopRequestKey IS NOT NULL THEN 1 ELSE 0 END) AS stopping
           FROM sessions s LEFT JOIN session_inputs i ON i.sessionId = s.id
          WHERE s.projectId = ?
          GROUP BY s.id`,
      )
      .all(projectId) as unknown as Array<{
      id: string;
      roleId: string;
      revision: number;
      currentTaskId: string | null;
      storedTitle: string | null;
      channel: string | null;
      lastActivityAt: string | null;
      processing: number | null;
      queued: number | null;
      stopping: number | null;
    }>;
    // A name the user chose wins; otherwise the first user text is the title. A delegation body is a
    // host instruction, not something the user typed, so it never titles a session: a member row
    // would otherwise read as a chat that starts mid-sentence.
    const titles = new Map<string, string>();
    const firstInputs = this.db
      .prepare(
        `SELECT i.sessionId AS sessionId, i.payload AS payload
           FROM session_inputs i
           JOIN (SELECT sessionId AS sid, MIN(seq) AS seq
                   FROM session_inputs
                  WHERE kind = 'user' AND projectId = ?
                  GROUP BY sessionId) f
             ON f.sid = i.sessionId AND f.seq = i.seq`,
      )
      .all(projectId) as unknown as Array<{ sessionId: string; payload: string }>;
    for (const input of firstInputs) {
      titles.set(input.sessionId, input.payload);
    }
    return rows.map((row) => ({
      id: row.id,
      roleId: row.roleId,
      revision: row.revision,
      currentTaskId: row.currentTaskId,
      lastActivityAt: row.lastActivityAt,
      processing: row.processing ?? 0,
      queued: row.queued ?? 0,
      stopping: row.stopping ?? 0,
      storedTitle: row.storedTitle ?? null,
      channel: row.channel ?? null,
      derivedTitle: titles.get(row.id) ?? null,
    }));
  }

  /**
   * Every registered project with the two counts and the activity stamp the project menu shows,
   * in one query: the menu must not cost a query per project.
   */
  listProjectSummaries(): Array<ProjectRow & {
    sessionCount: number;
    taskCount: number;
    lastActivityAt: string | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM sessions s WHERE s.projectId = p.id) AS sessionCount,
                (SELECT COUNT(*) FROM tasks t WHERE t.projectId = p.id) AS taskCount,
                (SELECT MAX(i.updatedAt) FROM session_inputs i WHERE i.projectId = p.id) AS lastActivityAt
           FROM projects p
          ORDER BY p.updatedAt DESC, p.id`,
      )
      .all() as unknown as Array<Record<string, unknown> & { sessionCount: number; taskCount: number; lastActivityAt: string | null }>;
    return rows.map((row) => ({
      ...toProjectRow(row),
      sessionCount: row.sessionCount ?? 0,
      taskCount: row.taskCount ?? 0,
      lastActivityAt: row.lastActivityAt ?? null,
    }));
  }

  listSessions(): Array<{ id: string; projectId: string; roleId: string; cwd: string; revision: number; updatedAt: string }> {
    return this.db
      .prepare('SELECT id, projectId, roleId, cwd, revision, updatedAt FROM sessions ORDER BY id')
      .all() as unknown as Array<{
      id: string;
      projectId: string;
      roleId: string;
      cwd: string;
      revision: number;
      updatedAt: string;
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
    title: string | null;
    channel: string | null;
    revision: number;
  } | undefined {
    return this.db
      .prepare(
        'SELECT id, projectId, roleId, specialization, cwd, configRef, currentTaskId, title, channel, revision FROM sessions WHERE id = ?',
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
          title: string | null;
          channel: string | null;
          revision: number;
        }
      | undefined;
  }

  /** The fixed session of an external channel (`mcp`), if the project already has one. */
  getSessionByChannel(projectId: string, channel: string): { id: string; channel: string | null } | undefined {
    return this.db
      .prepare('SELECT id, channel FROM sessions WHERE projectId = ? AND channel = ?')
      .get(projectId, channel) as { id: string; channel: string | null } | undefined;
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
   * Task update. Providing a phase starts a new step: the current-step members must be finished and
   * are cleared after the previous step's summary is kept.
   *
   * No version is compared: one chief session owns the Task and the tools are executed one call at a
   * time, so a second writer cannot race this row (G2, sequence rule).
   */
  updateTask(params: UpdateTaskParams): TaskRow {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      if (task.status === 'completed' || task.status === 'cancelled') {
        throw new StoreError('VERSION_CONFLICT', 'the Task is already terminal', {
          taskId: params.taskId,
          status: task.status,
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
           WHERE id = ?`,
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
   * Facts that block completion regardless of which result is cited (G3): every member's input has
   * settled, and a write Task has a passed review of an unchanged delivery plus a passed test of that
   * same delivery when it requires one. One algorithm, shared by `endTask` and the tool guidance.
   */
  completionBlockers(taskId: string): string[] {
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
    if (task.type !== 'write') {
      return gaps;
    }
    const results = this.listTaskResults(taskId);
    // The latest passed report of a kind is its evidence: history is kept, never superseded.
    const latestPassed = (kind: ResultKind): ResultRow | undefined =>
      results.filter((entry) => entry.kind === kind && entry.verdict === 'passed').at(-1);
    const review = latestPassed('review');
    if (review === undefined) {
      gaps.push('no passed independent review is recorded');
      return gaps;
    }
    const reviewed = review.deliveryState;
    if (reviewed === null) {
      gaps.push(`review ${review.resultId} did not record the delivery it checked; review the current delivery`);
    } else if (digestOfPaths(this.requireTaskCwd(task), reviewed.paths) !== reviewed.digest) {
      gaps.push(
        `the delivery changed after the last passed review (${review.resultId}); review the current delivery again`,
      );
    }
    if (task.requiresTest) {
      const test = latestPassed('test');
      if (test === undefined) {
        gaps.push('no passed independent test is recorded');
      } else if (test.createdAt < review.createdAt) {
        gaps.push('the independent test was recorded before the independent review');
      } else if (
        reviewed === null ||
        test.deliveryState === null ||
        test.deliveryState.digest !== reviewed.digest
      ) {
        gaps.push('the independent test did not cover the reviewed delivery; test the reviewed delivery');
      }
    }
    return gaps;
  }

  /** Completion check: the blockers above, plus a completion result of the right kind that exists. */
  taskCompletionGaps(taskId: string, completionResultId: string): string[] {
    const gaps = this.completionBlockers(taskId);
    const task = this.requireTask(taskId);
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
      }
    }
    return gaps;
  }

  /** Release the chief slot and finish the Task; refuses while completion gaps remain. */
  endTask(params: { taskId: string; completionResultId: string }):
    | { readonly ok: true; readonly task: TaskRow }
    | { readonly ok: false; readonly gaps: readonly string[] } {
    return this.transaction(() => {
      // Checked inside the transaction: a project file written between the check and the commit must
      // not slip through (G3). Hashing the reviewed paths is short, and endTask is rare.
      const gaps = this.taskCompletionGaps(params.taskId, params.completionResultId);
      if (gaps.length > 0) {
        return { ok: false, gaps } as const;
      }
      const task = this.requireTask(params.taskId);
      if (task.status === 'cancelled') {
        throw new StoreError('VERSION_CONFLICT', 'the Task was cancelled', { taskId: params.taskId });
      }
      if (task.status === 'completed') {
        return { ok: true, task } as const;
      }
      const timestamp = this.clock();
      const outcome = this.db
        .prepare(
          `UPDATE tasks SET status = 'completed', completionResultId = ?, revision = revision + 1, updatedAt = ?
             WHERE id = ?`,
        )
        .run(params.completionResultId, timestamp, params.taskId);
      if (outcome.changes !== 1) {
        throw new StoreError('VERSION_CONFLICT', 'the Task could not be completed', { taskId: params.taskId });
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
    /** Observed by the caller (G3) for review/test; not a model-supplied value. */
    deliveryState?: DeliveryState;
    bodyRef: ArtifactRef;
    basisRefs: readonly string[];
    checks: readonly ResultCheck[];
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
      if ((params.kind === 'review' || params.kind === 'test') && params.deliveryState === undefined) {
        // The binding is what the report checked; without it the report cannot complete the Task.
        throw new StoreError('INVALID_ARGUMENT', 'a review or test report needs the observed delivery state', {
          kind: params.kind,
        });
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
             (resultId, taskId, sessionId, inputId, roleId, kind, summary, verdict, deliveryState, bodyRef,
              basisRefs, checks, settlement, createdAt, serverEpoch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          params.deliveryState === undefined ? null : JSON.stringify(params.deliveryState),
          JSON.stringify(params.bodyRef),
          JSON.stringify(params.basisRefs),
          JSON.stringify(params.checks),
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

  /** All results of a Task, oldest first. */
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
   * Create the current step's professional members and continue the settled ones atomically (S3:
   * create/continue 专业工作): the session row, its Task membership and its input are written
   * together, then the Task's currentSessionIds are replaced by the new members.
   */
  createTaskSessions(params: {
    readonly taskId: string;
    readonly members: readonly CreateTaskSessionParams[];
    readonly continuations?: ReadonlyArray<{
      readonly sessionId: string;
      readonly instructions: string;
      readonly refs: readonly string[];
      readonly dependencies: readonly string[];
      readonly inputId: string;
    }>;
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
                dependencies, expectedKind, writeScope, workspaceRef, currentInputId, createdAt, updatedAt)
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
            canonical(member.writeScope ?? []),
            member.workspaceRef ?? null,
            member.inputId,
            timestamp,
            timestamp,
          );
        created.push(this.requireTaskSession(member.sessionId));
      }
      // Continuations join the same transaction: a batch is accepted whole or not at all.
      for (const continuation of params.continuations ?? []) {
        this.continueTaskSession(continuation);
      }
      const currentSessionIds = [
        ...new Set([
          ...task.currentSessionIds,
          ...created.map((m) => m.sessionId),
          ...(params.continuations ?? []).map((entry) => entry.sessionId),
        ]),
      ];
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
    /** Host RPCs pass the revision the user saw; the model's tool passes none (single writer). */
    expectedRevision?: number;
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
      if (params.expectedRevision !== undefined && task.revision !== params.expectedRevision) {
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
        .run(next, this.clock(), params.taskId, task.revision);
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

  /**
   * Hand a Task to another chief session (G2 adopt). Both the current owner and the target must be
   * free of another Task, the Task must not be terminal or mid-control, and its members must have
   * settled; nothing is replayed.
   */
  adoptTask(params: { taskId: string; chiefSessionId: string }): TaskRow {
    return this.transaction(() => {
      const task = this.requireTask(params.taskId);
      if (task.status === 'completed' || task.status === 'cancelled') {
        throw new StoreError('VERSION_CONFLICT', 'the Task is already terminal', {
          taskId: params.taskId,
          status: task.status,
        });
      }
      if (task.status === 'pausing' || task.status === 'cancelling') {
        throw new StoreError('STAGE_NOT_READY', 'the Task is still being controlled; wait until it settles', {
          taskId: params.taskId,
          status: task.status,
        });
      }
      if (this.unfinishedMemberWork(params.taskId) > 0) {
        throw new StoreError('STAGE_NOT_READY', 'the Task still has unfinished member work', {
          taskId: params.taskId,
        });
      }
      if (params.chiefSessionId === task.chiefSessionId) {
        return task;
      }
      const target = this.getSession(params.chiefSessionId);
      if (target === undefined) {
        throw new StoreError('NOT_FOUND', 'the target session does not exist', {
          sessionId: params.chiefSessionId,
        });
      }
      if (target.roleId !== 'chief') {
        throw new StoreError('INVALID_ARGUMENT', 'only a chief session can own a Task', {
          sessionId: params.chiefSessionId,
          roleId: target.roleId,
        });
      }
      if (target.projectId !== task.projectId) {
        throw new StoreError('INVALID_ARGUMENT', 'the target session belongs to another project', {
          sessionId: params.chiefSessionId,
        });
      }
      if (target.currentTaskId !== null) {
        throw new StoreError('WORKSPACE_BUSY', 'the target session already coordinates a Task', {
          sessionId: params.chiefSessionId,
          taskId: target.currentTaskId,
        });
      }
      const timestamp = this.clock();
      this.db
        .prepare('UPDATE sessions SET currentTaskId = NULL, revision = revision + 1, updatedAt = ? WHERE id = ?')
        .run(timestamp, task.chiefSessionId);
      this.db
        .prepare('UPDATE sessions SET currentTaskId = ?, revision = revision + 1, updatedAt = ? WHERE id = ?')
        .run(params.taskId, timestamp, params.chiefSessionId);
      this.db
        .prepare(
          'UPDATE tasks SET chiefSessionId = ?, ownerEpoch = ?, revision = revision + 1, updatedAt = ? WHERE id = ?',
        )
        .run(params.chiefSessionId, this.epoch, timestamp, params.taskId);
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

  private migrateV8ToV9(): void {
    this.transaction(() => {
      this.applyV9();
      this.db.exec('PRAGMA user_version = 9;');
    });
  }

  private migrateV9ToV10(): void {
    this.transaction(() => {
      this.applyV10();
      this.db.exec('PRAGMA user_version = 10;');
    });
  }

  /**
   * v9 → v10: a conversation can be named, and a provider can carry a display name. Both columns are
   * additive and nullable, so an unnamed session keeps deriving its title from the first input and an
   * unnamed provider keeps showing its id. Column checks make this idempotent.
   */
  private applyV10(): void {
    this.addColumn('sessions', 'title', 'TEXT');
    this.addColumn('providers', 'name', 'TEXT');
  }

  /**
   * v11 → v12: a model assignment can record the Pi thinking level that goes with the model it names.
   * Additive and defaulted to empty, so an existing row keeps behaving exactly as before (unset =
   * `off`, which is what every session ran at until now).
   */
  private migrateV11ToV12(): void {
    this.transaction(() => {
      this.addColumn('model_overrides', 'thinkingLevel', "TEXT NOT NULL DEFAULT ''");
      this.db.exec('PRAGMA user_version = 12;');
    });
  }

  /**
   * v12 → v13: a provider model records which catalogue model it really is, and the facts copied from
   * it, so the configuration page can say what a model will do instead of asking the operator.
   *
   * No column changes: `providers.models` already holds a JSON array, and the new keys are optional.
   * Rows written by v12 keep working unchanged (an unresolvable model keeps Pi's fallback), which is
   * why the step only moves the version forward.
   */
  private migrateV12ToV13(): void {
    this.transaction(() => {
      this.db.exec('PRAGMA user_version = 13;');
    });
  }

  /**
   * v13 → v14: the usage ledger. Additive and `IF NOT EXISTS`, so an installation created by this
   * revision (whose schema script already contains the table) and one upgraded from v13 both end up
   * with the same shape. No existing record changes, and no history is back-filled: statistics start
   * when the installation starts recording them.
   */
  /**
   * v14 → v15: an external channel owns one fixed session per project. Additive — existing rows keep
   * channel NULL and the partial unique index ignores them — and idempotent, because a database this
   * revision creates already carries the column through SCHEMA_SQL.
   */
  private migrateV14ToV15(): void {
    this.transaction(() => {
      this.addColumn('sessions', 'channel', 'TEXT');
      this.db.exec(SESSIONS_CHANNEL_SQL);
      this.db.exec('PRAGMA user_version = 15;');
    });
  }

  private migrateV13ToV14(): void {
    this.transaction(() => {
      this.db.exec(USAGE_LEDGER_SQL);
      this.db.exec('PRAGMA user_version = 14;');
    });
  }

  private migrateV10ToV11(): void {
    this.transaction(() => {
      this.applyV11();
      this.db.exec('PRAGMA user_version = 11;');
    });
  }

  /**
   * v10 → v11: a model override can name a role inside a project, so the table gains `roleId` and the
   * key becomes (scope, scopeId, roleId). SQLite cannot widen a primary key in place, so the table is
   * rebuilt; existing rows keep roleId = '' (a global role override, or a project-wide default), which
   * is exactly what they meant before this version. Column check keeps it idempotent.
   */
  private applyV11(): void {
    if (this.hasColumn('model_overrides', 'roleId')) {
      return;
    }
    this.db.exec(`
      CREATE TABLE model_overrides_next (
        scope TEXT NOT NULL,
        scopeId TEXT NOT NULL,
        roleId TEXT NOT NULL DEFAULT '',
        providerId TEXT NOT NULL,
        modelId TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (scope, scopeId, roleId)
      );
      INSERT INTO model_overrides_next (scope, scopeId, roleId, providerId, modelId, revision, createdAt, updatedAt)
        SELECT scope, scopeId, '', providerId, modelId, revision, createdAt, updatedAt FROM model_overrides;
      DROP TABLE model_overrides;
      ALTER TABLE model_overrides_next RENAME TO model_overrides;
    `);
  }

  /**
   * v8 → v9: the model no longer carries tokens. The candidate object and the report/result versions it
   * bound are gone; a review/test report records the delivery state the program observed (G3), and a
   * member of a parallel write step declares the paths it owns. Column checks keep this idempotent, so
   * re-running a migration (or opening a database created by this revision) is harmless.
   */
  private applyV9(): void {
    this.dropColumn('tasks', 'candidate');
    this.dropColumn('task_sessions', 'candidateId');
    this.addColumn('task_sessions', 'writeScope', "TEXT NOT NULL DEFAULT '[]'");
    this.dropColumn('results', 'candidateId');
    this.dropColumn('results', 'supersedesResultId');
    this.addColumn('results', 'deliveryState', 'TEXT');
  }

  private hasColumn(table: string, column: string): boolean {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS present FROM pragma_table_info('${table}') WHERE name = ?`)
      .get(column) as { present: number };
    return row.present > 0;
  }

  private dropColumn(table: string, column: string): void {
    if (this.hasColumn(table, column)) {
      this.db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  }

  private addColumn(table: string, column: string, ddl: string): void {
    if (!this.hasColumn(table, column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  private migrate(): void {
    // `version 0` is a database this revision creates (or one written without a header): the ladder's
    // first entry builds the current schema and stamps 1, so the remaining steps still run.
    if (this.pragmas().userVersion === 0) {
      this.db.exec(SCHEMA_SQL);
    }
    const { userVersion } = this.pragmas();
    if (userVersion > SCHEMA_VERSION) {
      throw new StoreError('VERSION_CONFLICT', 'unsupported store schema version', {
        userVersion,
        supported: SCHEMA_VERSION,
      });
    } else {
      // One step per version, in order: a database at any older version runs exactly the remaining
      // ones, so adding a version is one entry here instead of an edit to every earlier branch.
      const steps: ReadonlyArray<readonly [number, () => void]> = [
        // A fresh database is created at v1 and then walks the same ladder as an old one, so a new
        // schema version is one entry here instead of an edit to both branches.
        [
          0,
          () =>
            this.transaction(() => {
              this.db.exec('PRAGMA user_version = 1;');
            }),
        ],
        [
          1,
          () =>
            this.transaction(() => {
              // A database created by this revision already carries them through SCHEMA_SQL; the
              // check keeps the step idempotent either way.
              for (const column of V2_COLUMNS) {
                if (!this.hasColumn('session_inputs', column.name)) {
                  this.db.exec(column.ddl);
                }
              }
              this.db.exec(SESSION_BINDINGS_SQL);
              this.db.exec('PRAGMA user_version = 2;');
            }),
        ],
        [2, () => this.migrateV2ToV3()],
        [3, () => this.migrateV3ToV4()],
        [4, () => this.migrateV4ToV5()],
        [5, () => this.migrateV5ToV6()],
        [6, () => this.migrateV6ToV7()],
        [7, () => this.migrateV7ToV8()],
        [8, () => this.migrateV8ToV9()],
        [9, () => this.migrateV9ToV10()],
        [10, () => this.migrateV10ToV11()],
        [11, () => this.migrateV11ToV12()],
        [12, () => this.migrateV12ToV13()],
        [13, () => this.migrateV13ToV14()],
        [14, () => this.migrateV14ToV15()],
      ];
      for (const [from, step] of steps) {
        if (this.pragmas().userVersion === from) {
          step();
        }
      }
      const migrated = this.pragmas().userVersion;
      if (migrated !== SCHEMA_VERSION) {
        throw new StoreError('VERSION_CONFLICT', 'unsupported store schema version', {
          userVersion: migrated,
          supported: SCHEMA_VERSION,
        });
      }
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
    // A choice is answered with a string: one of the offered options, or the user's own words. The
    // panel always offers that second door, because options can all be wrong — refusing the typed
    // answer would force a decision nobody made into the record. What stays forbidden is an *empty*
    // answer: silence is not a choice, and the asking model cannot act on it.
    return answered.trim() === '' ? 'a selection answer cannot be empty' : undefined;
  }
  return undefined;
}

/**
 * One slice of the usage ledger as the API reports it.
 *
 * Every figure but `responses` is nullable: `null` means the provider never reported that number
 * (or the response predates reporting), which the UI must show as "not reported" rather than as a
 * free request. `responses` is always known: it counts model requests, not tokens.
 */
export interface UsageFigures {
  readonly responses: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
  /** Estimated at the model catalogue's prices; a gateway may bill differently. */
  readonly costTotal: number | null;
}

export interface UsageReport {
  readonly scope: 'project' | 'all';
  readonly totals: UsageFigures;
  readonly byRole: ReadonlyArray<UsageFigures & { readonly roleId: string }>;
  readonly byModel: ReadonlyArray<UsageFigures & { readonly providerId: string; readonly modelId: string }>;
}

function usageFigures(row: Record<string, unknown>): UsageFigures {
  const number = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);
  return {
    responses: Number(row['responses'] ?? 0),
    inputTokens: number(row['inputTokens']),
    outputTokens: number(row['outputTokens']),
    cacheReadTokens: number(row['cacheReadTokens']),
    cacheWriteTokens: number(row['cacheWriteTokens']),
    reasoningTokens: number(row['reasoningTokens']),
    costTotal: number(row['costTotal']),
  };
}

function toProviderRow(row: Record<string, unknown>): ProviderRow {
  return {
    providerId: String(row['providerId']),
    baseUrl: String(row['baseUrl']),
    api: row['api'] === null ? null : String(row['api']),
    name: row['name'] === null || row['name'] === undefined ? null : String(row['name']),
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
    roleId: row['roleId'] === null || row['roleId'] === undefined ? '' : String(row['roleId']),
    providerId: String(row['providerId']),
    modelId: String(row['modelId']),
    thinkingLevel: row['thinkingLevel'] === null || row['thinkingLevel'] === undefined ? '' : String(row['thinkingLevel']),
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
    deliveryState: parseDeliveryState(row['deliveryState']),
    bodyRef: parseArtifactRef(row['bodyRef']) ?? { storage: 'server', path: '', sha256: '' },
    basisRefs: parseStringList(row['basisRefs']),
    checks: Array.isArray(checks) ? (checks as ResultCheck[]) : [],
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
    writeScope: parseStringList(row['writeScope']),
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
    sourceInputId: String(row['sourceInputId']),
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}
function parseDeliveryState(value: unknown): DeliveryState | null {
  const parsed = parseJsonOrNull(value);
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as { digest?: unknown; paths?: unknown };
  if (typeof record.digest !== 'string' || !Array.isArray(record.paths)) {
    return null;
  }
  return { digest: record.digest, paths: record.paths.filter((path): path is string => typeof path === 'string') };
}
