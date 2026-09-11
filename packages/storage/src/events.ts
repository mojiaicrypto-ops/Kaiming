/**
 * The append-only event log.
 *
 * `protocol.md` §2/§7 and `reliability.md` §1 define the contract: a cursor is
 * monotonically increasing, a snapshot and its cursor come from one consistent
 * watermark C, real-time delivery carries only events after C, and a cursor that
 * has been truncated yields `RESYNC_REQUIRED` (data.md §5).
 */
import { StorageError } from './errors.js';
import { nowIso, uuidv7 } from './ids.js';
import { withTransaction, type SqliteDatabase } from './sqlite.js';
import { fromColumns, translateSqliteError } from './repository.js';
import { TABLES } from './tables.js';
import type { Event, JsonObject } from '@agentdev/contracts';

export interface AppendEventInput {
  readonly name: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly data?: JsonObject;
  readonly occurredAt?: string;
}

export interface ReadEventsOptions {
  /** Inclusive earliest cursor to consider; defaults to the cursor after `after`. */
  readonly limit?: number;
  /** Restrict to these event names. */
  readonly names?: readonly string[];
}

/** Thrown when a subscription asks for a cursor that retention removed. */
export class ResyncRequiredError extends StorageError {
  constructor(oldestCursor: number, requested: number) {
    super('NOT_FOUND', 'RESYNC_REQUIRED: the requested cursor was truncated', {
      code: 'RESYNC_REQUIRED',
      oldestCursor,
      requested,
    });
    this.name = 'ResyncRequiredError';
  }
}

export class EventStore {
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

  /** Appends one durable event and returns it with its assigned cursor. */
  append(input: AppendEventInput): Event {
    const timestamp = input.occurredAt ?? this.now();
    const eventId = this.newId();
    try {
      const info = this.db
        .prepare(
          `INSERT INTO event (project_id, event_id, name, entity_id, entity_version, data, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.projectId,
          eventId,
          input.name,
          input.entityId,
          input.entityVersion,
          JSON.stringify(input.data ?? {}),
          timestamp,
        );
      return {
        cursor: Number(info.lastInsertRowid),
        eventId,
        name: input.name,
        entityId: input.entityId,
        entityVersion: input.entityVersion,
        data: input.data ?? {},
        occurredAt: timestamp,
      };
    } catch (error) {
      throw translateSqliteError(error, 'event');
    }
  }

  /** Highest committed cursor, or 0 when nothing has been appended. */
  latestCursor(): number {
    const row = this.db.prepare(`SELECT MAX(cursor) AS c FROM event`).get() as { c: number | null };
    return row.c ?? 0;
  }

  /** Lowest cursor still stored, or `latest + 1` when the log is empty. */
  oldestCursor(): number {
    const row = this.db.prepare(`SELECT MIN(cursor) AS c FROM event`).get() as { c: number | null };
    return row.c ?? this.latestCursor() + 1;
  }

  /**
   * Reads events after `after` in cursor order.
   *
   * @throws ResyncRequiredError when `after` is older than the retained window.
   */
  readAfter(after: number, options: ReadEventsOptions = {}): Event[] {
    const oldest = this.oldestCursor();
    if (after + 1 < oldest) throw new ResyncRequiredError(oldest, after);
    const limit = options.limit ?? 200;
    const names = options.names ?? [];
    const filter = names.length === 0 ? '' : ` AND name IN (${names.map(() => '?').join(', ')})`;
    const rows = this.db
      .prepare(`SELECT * FROM event WHERE cursor > ?${filter} ORDER BY cursor LIMIT ?`)
      .all(after, ...names, limit) as Record<string, unknown>[];
    return rows.map((row) => fromColumns(TABLES.event, row));
  }

  /** Reads one event by entity, newest first — the Activity view helper. */
  latestForEntity(entityId: string): Event | undefined {
    const row = this.db
      .prepare(`SELECT * FROM event WHERE entity_id = ? ORDER BY cursor DESC LIMIT 1`)
      .get(entityId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : fromColumns(TABLES.event, row);
  }

  /**
   * Removes events older than the retention cutoff.
   *
   * Truncation is a documented retention action (`data.md` §5), which is why the
   * event table blocks UPDATE but not DELETE.
   */
  truncateBefore(cursor: number): number {
    return withTransaction(this.db, () => {
      const info = this.db.prepare(`DELETE FROM event WHERE cursor < ?`).run(cursor);
      return info.changes;
    });
  }
}
