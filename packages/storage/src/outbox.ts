/**
 * The outbox: at-least-once delivery of side effects.
 *
 * `reliability.md` §1: "Outbox以operationId至少一次投递；Supervisor先检查已存在的
 * 同operationId Runner/结果，避免重复创建。每次Claim设30秒lease，进程重启后重新
 * 核对未完成claim". A claim that expires is reclaimable; a completed entry never is.
 */
import { StorageError } from './errors.js';
import { nowIso, uuidv7 } from './ids.js';
import { parseJson, text, translateSqliteError } from './repository.js';
import type { SqliteDatabase } from './sqlite.js';
import type { JsonObject, Outbox } from '@agentdev/contracts';

export interface EnqueueInput {
  readonly operationId: string;
  readonly kind: string;
  readonly payload?: JsonObject;
}

export interface ClaimOptions {
  readonly at?: string;
  readonly leaseSeconds?: number;
  readonly limit?: number;
}

const LEASE_SECONDS = 30;

export class OutboxStore {
  private readonly db: SqliteDatabase;
  private readonly projectId: string;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(
    db: SqliteDatabase,
    projectId: string,
    options: { now?: () => string; newId?: () => string } = {},
  ) {
    this.db = db;
    this.projectId = projectId;
    this.now = options.now ?? nowIso;
    this.newId = options.newId ?? uuidv7;
  }

  /** Enqueues exactly one entry per operationId; a repeat is a no-op replay. */
  enqueue(input: EnqueueInput): Outbox {
    const existing = this.find(input.operationId);
    if (existing !== undefined) return existing;
    const timestamp = this.now();
    try {
      this.db
        .prepare(
          `INSERT INTO outbox (id, project_id, version, created_at, updated_at, operation_id, kind, payload, state, attempts)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'pending', 0)`,
        )
        .run(
          this.newId(),
          this.projectId,
          timestamp,
          timestamp,
          input.operationId,
          input.kind,
          JSON.stringify(input.payload ?? {}),
        );
    } catch (error) {
      const raced = this.find(input.operationId);
      if (raced !== undefined) return raced;
      throw translateSqliteError(error, 'outbox');
    }
    return this.get(input.operationId);
  }

  find(operationId: string): Outbox | undefined {
    const row = this.db.prepare(`SELECT * FROM outbox WHERE operation_id = ?`).get(operationId) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapOutbox(row);
  }

  get(operationId: string): Outbox {
    const found = this.find(operationId);
    if (found === undefined) {
      throw new StorageError('NOT_FOUND', `outbox ${operationId} does not exist`, { operationId });
    }
    return found;
  }

  /**
   * Claims up to `limit` deliverable entries.
   *
   * An entry is deliverable when it is `pending`, or `claimed` with an expired
   * lease — the crash-recovery path from `reliability.md` §1.
   */
  claim(options: ClaimOptions = {}): Outbox[] {
    const at = options.at ?? this.now();
    const leaseSeconds = options.leaseSeconds ?? LEASE_SECONDS;
    const leaseUntil = new Date(Date.parse(at) + leaseSeconds * 1000).toISOString();
    const limit = options.limit ?? 1;

    const rows = this.db
      .prepare(
        `SELECT * FROM outbox
         WHERE state = 'pending' OR (state = 'claimed' AND (lease_until IS NULL OR lease_until <= ?))
         ORDER BY created_at, operation_id
         LIMIT ?`,
      )
      .all(at, limit) as Record<string, unknown>[];

    const claimed: Outbox[] = [];
    for (const row of rows) {
      const info = this.db
        .prepare(
          `UPDATE outbox SET state = 'claimed', lease_until = ?, attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND (state = 'pending' OR (state = 'claimed' AND (lease_until IS NULL OR lease_until <= ?)))`,
        )
        .run(leaseUntil, at, text(row['id'], 'outbox.id'), at);
      if (info.changes === 1) {
        claimed.push(
          mapOutbox({
            ...row,
            state: 'claimed',
            lease_until: leaseUntil,
            attempts: Number(row['attempts']) + 1,
            updated_at: at,
          }),
        );
      }
    }
    return claimed;
  }

  /** Marks an entry done; repeated completion is a no-op. */
  complete(operationId: string): void {
    const timestamp = this.now();
    this.db
      .prepare(
        `UPDATE outbox SET state = 'done', lease_until = NULL, updated_at = ? WHERE operation_id = ?`,
      )
      .run(timestamp, operationId);
  }

  /** Returns an entry to the queue after a failed delivery attempt. */
  release(operationId: string): void {
    const timestamp = this.now();
    this.db
      .prepare(
        `UPDATE outbox SET state = 'pending', lease_until = NULL, updated_at = ? WHERE operation_id = ?`,
      )
      .run(timestamp, operationId);
  }

  /** Entries still awaiting delivery, oldest first. */
  pending(): Outbox[] {
    const rows = this.db
      .prepare(`SELECT * FROM outbox WHERE state <> 'done' ORDER BY created_at, operation_id`)
      .all() as Record<string, unknown>[];
    return rows.map(mapOutbox);
  }

  countByState(): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT state, COUNT(*) AS n FROM outbox GROUP BY state`)
      .all() as { state: string; n: number }[];
    return Object.fromEntries(rows.map((row) => [row.state, row.n]));
  }
}

function mapOutbox(row: Record<string, unknown>): Outbox {
  return {
    id: text(row['id'], 'outbox.id'),
    projectId: text(row['project_id'], 'outbox.project_id'),
    version: Number(row['version']),
    createdAt: text(row['created_at'], 'outbox.created_at'),
    updatedAt: text(row['updated_at'], 'outbox.updated_at'),
    operationId: text(row['operation_id'], 'outbox.operation_id'),
    kind: text(row['kind'], 'outbox.kind'),
    payload: parseJson(row['payload'], 'outbox.payload') as JsonObject,
    state: text(row['state'], 'outbox.state') as Outbox['state'],
    attempts: Number(row['attempts']),
    ...(row['lease_until'] === null || row['lease_until'] === undefined
      ? {}
      : { leaseUntil: text(row['lease_until'], 'outbox.lease_until') }),
  };
}
