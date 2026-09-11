/**
 * Frozen, content-addressed snapshots (`data.md` §2 `snapshot`, §3 structures).
 *
 * A snapshot's identity is its content hash, so writing the same payload twice is
 * idempotent and a Run can reference exactly what it was assembled from. The table
 * has no `id`/`version` columns — its primary key is `(type, hash)` — so rows are
 * written and read with explicit SQL, and storage blocks UPDATE and DELETE.
 */
import {
  snapshotSchema,
  type JsonObject,
  type Snapshot,
  type SnapshotType,
} from '@agentdev/contracts';
import { nowIso, parseJson, sha256, text, type ProjectStore } from '@agentdev/storage';
import { canonicalJson } from './dispatcher.js';

export interface FrozenSnapshot {
  readonly hash: string;
  readonly type: SnapshotType;
  readonly payload: JsonObject;
  /** `false` when the same payload was already frozen under this type. */
  readonly created: boolean;
}

type Row = Record<string, unknown>;

function rowToSnapshot(row: Row): Snapshot {
  return snapshotSchema.parse({
    type: text(row['type'], 'snapshot.type'),
    hash: text(row['hash'], 'snapshot.hash'),
    payload: parseJson(row['payload'], 'snapshot.payload'),
    blobPath: text(row['blob_path'], 'snapshot.blob_path'),
    createdAt: text(row['created_at'], 'snapshot.created_at'),
  });
}

export class SnapshotWriter {
  private readonly store: ProjectStore;

  constructor(options: { store: ProjectStore }) {
    this.store = options.store;
  }

  /**
   * Writes a payload and returns its hash.
   *
   * The same payload under the same type yields the same row: callers may freeze
   * repeatedly without accumulating duplicates, which is what makes a retried
   * dispatch or config freeze idempotent.
   */
  freeze(type: SnapshotType, payload: JsonObject): FrozenSnapshot {
    const serialized = canonicalJson(payload);
    const hash = sha256(serialized);
    const existing = this.read(hash);
    if (existing !== undefined) {
      return { hash, type: existing.type, payload, created: false };
    }
    this.store.db
      .prepare(
        'INSERT INTO snapshot (type, hash, payload, blob_path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(type, hash, serialized, `snapshots/${type}/${hash}.json`, nowIso());
    return { hash, type, payload, created: true };
  }

  /** Reads a frozen payload back; the hash is the whole identity. */
  read(hash: string): Snapshot | undefined {
    const row = this.store.db
      .prepare(
        'SELECT type, hash, payload, blob_path, created_at FROM snapshot WHERE hash = ? LIMIT 1',
      )
      .get(hash) as Row | undefined;
    return row === undefined ? undefined : rowToSnapshot(row);
  }

  byType(type: SnapshotType): Snapshot[] {
    const rows = this.store.db
      .prepare(
        'SELECT type, hash, payload, blob_path, created_at FROM snapshot WHERE type = ? ORDER BY created_at DESC',
      )
      .all(type) as Row[];
    return rows.map(rowToSnapshot);
  }
}
