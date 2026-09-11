/**
 * The command idempotency ledger.
 *
 * `protocol.md` §1: "幂等键同载荷返回原结果；同键不同载荷拒绝" and §4 keeps the
 * lookup scoped to the calling subject ("仅同调用主体可查"). A command row is
 * created in the same transaction as its effects, so a crash cannot leave an
 * accepted command without its result.
 */
import { StorageError } from './errors.js';
import { nowIso, uuidv7 } from './ids.js';
import { parseJson } from './repository.js';
import type { SqliteDatabase } from './sqlite.js';

export interface CommandKey {
  /** Stable identity of the caller: `user:<id>`, `cli:<installation>`, `runner:<attempt>`. */
  readonly subject: string;
  readonly operation: string;
  /** 1–128 characters (`protocol.md` §1). */
  readonly key: string;
  /** SHA256 of the canonical payload. */
  readonly payloadHash: string;
}

export type CommandBegin =
  /** The caller must execute the command and then call `complete`. */
  | { readonly kind: 'new'; readonly commandId: string }
  /** The same key and payload already ran: return the recorded result unchanged. */
  | { readonly kind: 'replay'; readonly state: string; readonly response: unknown }
  /** The same key was used with a different payload, or by another caller. */
  | { readonly kind: 'conflict'; readonly reason: string };

export class CommandLedger {
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

  /**
   * Starts or resolves a write command.
   *
   * @throws StorageError `VALIDATION_ERROR`-class failures are the caller's job;
   * this method only reports `new`/`replay`/`conflict`.
   */
  begin(input: CommandKey): CommandBegin {
    const existing = this.db
      .prepare(`SELECT * FROM command WHERE operation = ? AND key = ?`)
      .get(input.operation, input.key) as
      | { id: string; subject: string; payload_hash: string; state: string; response: string }
      | undefined;

    if (existing !== undefined) {
      if (existing.subject !== input.subject) {
        return {
          kind: 'conflict',
          reason: `idempotency key ${input.key} belongs to another caller`,
        };
      }
      if (existing.payload_hash !== input.payloadHash) {
        return {
          kind: 'conflict',
          reason: `idempotency key ${input.key} was used with a different payload`,
        };
      }
      return {
        kind: 'replay',
        state: existing.state,
        response: parseJson(existing.response, 'command.response'),
      };
    }

    const commandId = this.newId();
    const timestamp = this.now();
    try {
      this.db
        .prepare(
          `INSERT INTO command (id, project_id, version, created_at, updated_at, subject, operation, key, payload_hash, state, response)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'accepted', '{}')`,
        )
        .run(
          commandId,
          this.projectId,
          timestamp,
          timestamp,
          input.subject,
          input.operation,
          input.key,
          input.payloadHash,
        );
    } catch (error) {
      // A concurrent insert of the same key: re-read and treat it as a replay.
      const raced = this.db
        .prepare(`SELECT * FROM command WHERE operation = ? AND key = ?`)
        .get(input.operation, input.key) as
        | { id: string; subject: string; payload_hash: string; state: string; response: string }
        | undefined;
      if (raced === undefined) throw error;
      if (raced.subject === input.subject && raced.payload_hash === input.payloadHash) {
        return {
          kind: 'replay',
          state: raced.state,
          response: parseJson(raced.response, 'command.response'),
        };
      }
      return { kind: 'conflict', reason: `idempotency key ${input.key} is taken` };
    }
    return { kind: 'new', commandId };
  }

  /** Records the terminal result of a command. */
  complete(
    commandId: string,
    response: unknown,
    state: 'completed' | 'rejected' = 'completed',
  ): void {
    const info = this.db
      .prepare(`UPDATE command SET state = ?, response = ?, updated_at = ? WHERE id = ?`)
      .run(state, JSON.stringify(response ?? {}), this.now(), commandId);
    if (info.changes === 0) {
      throw new StorageError('NOT_FOUND', `command ${commandId} does not exist`, { commandId });
    }
  }

  /** Reads a recorded command by its key, for `command.get`. */
  lookup(
    subject: string,
    operation: string,
    key: string,
  ): { readonly state: string; readonly response: unknown } | undefined {
    const row = this.db
      .prepare(`SELECT subject, state, response FROM command WHERE operation = ? AND key = ?`)
      .get(operation, key) as { subject: string; state: string; response: string } | undefined;
    if (row === undefined || row.subject !== subject) return undefined;
    return { state: row.state, response: parseJson(row.response, 'command.response') };
  }

  /** Removes command rows older than the given time; used by retention. */
  pruneBefore(cutoff: string): number {
    const info = this.db.prepare(`DELETE FROM command WHERE created_at < ?`).run(cutoff);
    return info.changes;
  }
}
