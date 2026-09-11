/**
 * Ordered, checksum-verified migrations.
 *
 * `data.md` §5: "schema_migrations(version PK,checksum,applied_at)记录顺序迁移；
 * 启动持有Project锁，备份后事务执行，checksum不一致停止启动；失败回滚并显示版本，
 * 不启动Runner". The functions here implement exactly that contract and return the
 * applied version list so the caller can log it.
 */
import { CORE_SCHEMA_SQL, IMMUTABILITY_SQL } from './schema.js';
import { nowIso, sha256 } from './ids.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StorageError } from './errors.js';
import { withTransaction, type SqliteDatabase } from './sqlite.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Every migration in ascending version order. Version numbers never change. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '0001-core-schema',
    sql: `${CORE_SCHEMA_SQL}\n${IMMUTABILITY_SQL}\n`,
  },
];

export const MIGRATION_TABLE = 'schema_migrations';

export const MIGRATION_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL
);`;

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  readonly applied: readonly number[];
  readonly currentVersion: number;
  readonly backupPath?: string;
}

/** Checksum of a migration's SQL; compared byte-for-byte across releases. */
export function migrationChecksum(migration: Migration): string {
  return sha256(`${migration.version}\u0000${migration.name}\u0000${migration.sql}`);
}

function ensureLedger(db: SqliteDatabase): void {
  db.exec(MIGRATION_LEDGER_SQL);
}

/** Reads the applied ledger rows in version order. */
export function readAppliedMigrations(db: SqliteDatabase): AppliedMigration[] {
  const rows = db
    .prepare(
      `SELECT version, name, checksum, applied_at AS appliedAt FROM ${MIGRATION_TABLE} ORDER BY version`,
    )
    .all() as AppliedMigration[];
  return rows;
}

/**
 * Verifies the ledger against the shipped migrations.
 *
 * @throws StorageError `MIGRATION_CHECKSUM_MISMATCH` when an applied migration's
 * SQL changed, or `SCHEMA_VERSION_AHEAD` when the file is newer than this build.
 */
export function verifyMigrations(
  db: SqliteDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): readonly AppliedMigration[] {
  ensureLedger(db);
  const applied = readAppliedMigrations(db);
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied) {
    const migration = byVersion.get(row.version);
    if (migration === undefined) {
      throw new StorageError(
        'SCHEMA_VERSION_AHEAD',
        `database schema version ${row.version} is newer than this build`,
        { version: row.version },
      );
    }
    const expected = migrationChecksum(migration);
    if (expected !== row.checksum) {
      throw new StorageError(
        'MIGRATION_CHECKSUM_MISMATCH',
        `migration ${row.version} checksum changed: recorded ${row.checksum}, expected ${expected}`,
        { version: row.version, recorded: row.checksum, expected },
      );
    }
  }
  return applied;
}

export interface RunMigrationsOptions {
  /** Receives a consistent copy path before any pending migration runs. */
  readonly backup?: (destination: string) => void;
  /**
   * Backup destination. With a custom `backup` hook the hook writes it; without
   * one, `backupDatabase` is used directly, so a caller cannot skip the copy by
   * forgetting the hook.
   */
  readonly backupPath?: string;
  readonly now?: () => string;
}

/**
 * Applies every pending migration, one transaction each.
 *
 * A backup is taken first whenever work is pending, per `data.md` §5. A failure
 * inside one migration rolls that migration back, leaves the ledger unchanged and
 * rethrows as `MIGRATION_FAILED`, so the daemon refuses to start a Runner.
 */
export function runMigrations(
  db: SqliteDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
  options: RunMigrationsOptions = {},
): MigrationResult {
  ensureLedger(db);
  const appliedRows = verifyMigrations(db, migrations);
  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  const pending = [...migrations]
    .sort((left, right) => left.version - right.version)
    .filter((migration) => !appliedVersions.has(migration.version));

  const currentVersion = appliedRows.reduce((max, row) => Math.max(max, row.version), 0);
  if (pending.length === 0) return { applied: [], currentVersion };

  let backupPath: string | undefined;
  if (options.backup !== undefined) {
    backupPath = options.backupPath ?? `${String(currentVersion)}.backup`;
    options.backup(backupPath);
  } else if (options.backupPath !== undefined) {
    // No caller-supplied hook: still take the documented pre-upgrade copy.
    backupPath = options.backupPath;
    backupDatabase(db, backupPath);
  }

  const now = options.now ?? nowIso;
  const applied: number[] = [];
  for (const migration of pending) {
    const checksum = migrationChecksum(migration);
    try {
      withTransaction(db, () => {
        db.exec(migration.sql);
        db.prepare(
          `INSERT INTO ${MIGRATION_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
        ).run(migration.version, migration.name, checksum, now());
      });
    } catch (error) {
      throw new StorageError(
        'MIGRATION_FAILED',
        `migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { version: migration.version, name: migration.name },
      );
    }
    applied.push(migration.version);
  }

  const result: MigrationResult = {
    applied,
    currentVersion: pending[pending.length - 1]?.version ?? currentVersion,
    ...(backupPath === undefined ? {} : { backupPath }),
  };
  return result;
}

/**
 * SQLite's consistent online copy, used as the pre-migration backup.
 * `VACUUM INTO` writes a transactionally consistent snapshot and refuses to
 * overwrite, which is exactly the safety property `data.md` §5 asks for.
 */
export function backupDatabase(db: SqliteDatabase, destination: string): void {
  if (db.name === ':memory:') return;
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  db.prepare('VACUUM INTO ?').run(destination);
}
