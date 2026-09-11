/**
 * Leases: one owner per resource, with epoch fencing.
 *
 * `data.md` §2: "resource唯一；过期先撤销旧执行" and `reliability.md` §2:
 * "旧进程未确认终止时不把工作区授予新写者". A lease therefore carries the
 * owner's Attempt epoch, and an expired lease is replaced rather than shared.
 */
import { nowIso, uuidv7 } from './ids.js';
import { text } from './repository.js';
import { withTransaction, type SqliteDatabase } from './sqlite.js';
import type { Lease } from '@agentdev/contracts';

export interface AcquireLeaseInput {
  readonly resource: string;
  readonly ownerAttemptId: string;
  readonly epoch: number;
  readonly expiresAt: string;
  readonly at?: string;
}

export type AcquireResult =
  | { readonly acquired: true; readonly lease: Lease; readonly replacedExpired: boolean }
  | { readonly acquired: false; readonly heldBy: Lease };

export class LeaseStore {
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

  find(resource: string): Lease | undefined {
    const row = this.db.prepare(`SELECT * FROM lease WHERE resource = ?`).get(resource) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapLease(row);
  }

  /**
   * Acquires the resource for an Attempt.
   *
   * An expired lease is revoked in the same transaction and reported via
   * `replacedExpired`, so the caller knows a previous owner may still be running.
   */
  acquire(input: AcquireLeaseInput): AcquireResult {
    const at = input.at ?? this.now();
    return withTransaction(this.db, () => {
      const existing = this.find(input.resource);
      if (existing !== undefined) {
        const expired = Date.parse(existing.expiresAt) <= Date.parse(at);
        const sameOwner = existing.ownerAttemptId === input.ownerAttemptId;
        if (!expired && !(sameOwner && existing.epoch === input.epoch)) {
          return { acquired: false, heldBy: existing };
        }
        const timestamp = this.now();
        this.db
          .prepare(
            `UPDATE lease SET owner_attempt_id = ?, epoch = ?, expires_at = ?, updated_at = ?, version = version + 1
             WHERE resource = ?`,
          )
          .run(input.ownerAttemptId, input.epoch, input.expiresAt, timestamp, input.resource);
        const lease = this.find(input.resource) as Lease;
        return { acquired: true, lease, replacedExpired: expired && !sameOwner };
      }
      const timestamp = this.now();
      this.db
        .prepare(
          `INSERT INTO lease (id, project_id, version, created_at, updated_at, resource, owner_attempt_id, epoch, expires_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.newId(),
          this.projectId,
          timestamp,
          timestamp,
          input.resource,
          input.ownerAttemptId,
          input.epoch,
          input.expiresAt,
        );
      return { acquired: true, lease: this.find(input.resource) as Lease, replacedExpired: false };
    });
  }

  /** Extends a lease the caller still owns; a stolen or expired lease fails. */
  renew(
    resource: string,
    ownerAttemptId: string,
    epoch: number,
    expiresAt: string,
    at?: string,
  ): boolean {
    const timestamp = at ?? this.now();
    const info = this.db
      .prepare(
        `UPDATE lease SET expires_at = ?, updated_at = ?, version = version + 1
         WHERE resource = ? AND owner_attempt_id = ? AND epoch = ?`,
      )
      .run(expiresAt, timestamp, resource, ownerAttemptId, epoch);
    return info.changes === 1;
  }

  /** Releases a lease only when the caller still owns it. */
  release(resource: string, ownerAttemptId: string, epoch: number): boolean {
    const info = this.db
      .prepare(`DELETE FROM lease WHERE resource = ? AND owner_attempt_id = ? AND epoch = ?`)
      .run(resource, ownerAttemptId, epoch);
    return info.changes === 1;
  }

  /** Leases that have expired as of `at`, oldest expiry first. */
  expired(at?: string): Lease[] {
    const timestamp = at ?? this.now();
    const rows = this.db
      .prepare(`SELECT * FROM lease WHERE expires_at <= ? ORDER BY expires_at`)
      .all(timestamp) as Record<string, unknown>[];
    return rows.map(mapLease);
  }

  /** Revokes every expired lease; returns the resources that were freed. */
  releaseExpired(at?: string): string[] {
    const timestamp = at ?? this.now();
    return withTransaction(this.db, () => {
      const rows = this.db
        .prepare(`SELECT resource FROM lease WHERE expires_at <= ?`)
        .all(timestamp) as { resource: string }[];
      if (rows.length > 0) {
        this.db.prepare(`DELETE FROM lease WHERE expires_at <= ?`).run(timestamp);
      }
      return rows.map((row) => row.resource);
    });
  }

  /** Revokes every lease, e.g. after a restore (`reliability.md` §8). */
  releaseAll(): number {
    return this.db.prepare(`DELETE FROM lease`).run().changes;
  }
}

function mapLease(row: Record<string, unknown>): Lease {
  return {
    id: text(row['id'], 'lease.id'),
    projectId: text(row['project_id'], 'lease.project_id'),
    version: Number(row['version']),
    createdAt: text(row['created_at'], 'lease.created_at'),
    updatedAt: text(row['updated_at'], 'lease.updated_at'),
    resource: text(row['resource'], 'lease.resource'),
    ownerAttemptId: text(row['owner_attempt_id'], 'lease.owner_attempt_id'),
    epoch: Number(row['epoch']),
    expiresAt: text(row['expires_at'], 'lease.expires_at'),
  };
}
