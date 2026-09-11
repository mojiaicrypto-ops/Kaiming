/**
 * SQLite access with the documented per-project pragmas.
 *
 * `data.md` §1: "每个ProjectSQLite启用foreign_keys=ON、journal_mode=WAL、
 * synchronous=FULL、busy_timeout=5000". Every Project gets its own file, so the
 * pragmas are applied on every open — including read-only opens, where
 * `foreign_keys` still guards integrity checks.
 */
import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  /** File path, or `:memory:` in tests. */
  readonly file: string;
  /** Open without write access; the file must already exist. */
  readonly readOnly?: boolean;
}

/** Opens a project database and applies the contract pragmas. */
export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const readOnly = options.readOnly === true;
  const db = new Database(options.file, { readonly: readOnly, fileMustExist: readOnly });
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  if (!readOnly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
  }
  return db;
}

/** Reads back the pragmas so a caller can assert the contract holds. */
export function readPragmas(db: SqliteDatabase): {
  foreignKeys: number;
  journalMode: string;
  synchronous: number;
  busyTimeout: number;
} {
  return {
    foreignKeys: db.pragma('foreign_keys', { simple: true }) as number,
    journalMode: String(db.pragma('journal_mode', { simple: true })),
    synchronous: db.pragma('synchronous', { simple: true }) as number,
    busyTimeout: db.pragma('busy_timeout', { simple: true }) as number,
  };
}

/**
 * Runs a synchronous write transaction in IMMEDIATE mode.
 *
 * `reliability.md` §1 fixes the mailbox boundary: validation, domain rows, the
 * command response, the event and the outbox entry commit together or not at
 * all. `BEGIN IMMEDIATE` takes the write lock upfront so two mailboxes on one
 * file cannot both read-then-write.
 */
export function withTransaction<T>(db: SqliteDatabase, work: () => T): T {
  const run = db.transaction(work);
  return run.immediate();
}

/** Closes the database; safe to call twice. */
export function closeDatabase(db: SqliteDatabase): void {
  if (db.open) db.close();
}
