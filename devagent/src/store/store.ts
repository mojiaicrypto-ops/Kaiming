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
  | 'WORKSPACE_BUSY';

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
  | { readonly kind: 'blocked'; readonly inputId: string; readonly code: 'RECOVERY_REQUIRED' };

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
}

const REQUIRED_PRAGMAS = { journal_mode: 'wal', synchronous: 2, foreign_keys: 1 } as const;

const SCHEMA_VERSION = 2;

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

  constructor(options: OpenStoreOptions) {
    this.serverEpoch = options.serverEpoch;
    this.clock = options.now ?? (() => new Date().toISOString());
    this.db = new DatabaseSync(options.path);
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec('PRAGMA synchronous=FULL;');
    this.db.exec('PRAGMA foreign_keys=ON;');
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

  createSession(params: CreateSessionParams): void {
    const timestamp = this.clock();
    this.db
      .prepare(
        'INSERT INTO sessions (id, projectId, roleId, cwd, revision, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?)',
      )
      .run(params.id, params.projectId, params.roleId, params.cwd, timestamp, timestamp);
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
      const candidate = this.db
        .prepare("SELECT inputId FROM session_inputs WHERE sessionId = ? AND status = 'queued' ORDER BY seq LIMIT 1")
        .get(sessionId) as { inputId: string } | undefined;
      if (candidate === undefined) {
        return { kind: 'none' } as ClaimResult;
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
  scanStartup(): { interrupted: number } {
    return this.transaction(() => {
      const outcome = this.db
        .prepare(
          `UPDATE session_inputs SET status = 'interrupted', revision = revision + 1, updatedAt = ?
            WHERE status = 'processing' AND (serverEpoch IS NULL OR serverEpoch <> ?)`,
        )
        .run(this.clock(), this.serverEpoch);
      return { interrupted: Number(outcome.changes) };
    });
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

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}