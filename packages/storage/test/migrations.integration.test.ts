import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORE_SCHEMA_SQL,
  IMMUTABLE_TABLES,
  MIGRATIONS,
  MIGRATION_TABLE,
  SCHEMA_TABLES,
  StorageError,
  backupDatabase,
  closeDatabase,
  openDatabase,
  readAppliedMigrations,
  readPragmas,
  runMigrations,
  verifyMigrations,
  type Migration,
  type MigrationResult,
  type SqliteDatabase,
} from '../src/index.js';
import {
  artifactSchema,
  assessmentSchema,
  attachmentSchema,
  attemptSchema,
  authorizationSchema,
  budgetSchema,
  commandSchema,
  conversationSchema,
  decisionSchema,
  discoverySchema,
  eventSchema,
  featureProjectionSchema,
  findingSchema,
  grantSchema,
  leaseSchema,
  messageBodySchema,
  messageSchema,
  operationSchema,
  outboxSchema,
  projectSchema,
  requirementSchema,
  runSchema,
  snapshotSchema,
  stageResultRowSchema,
  taskSchema,
  toolOperationSchema,
  userActionSchema,
  workSchema,
} from '@agentdev/contracts';

/**
 * AC-065 migration evidence, on a real SQLite file.
 *
 * The suite proves the ledger contract (`data.md` §5), the pragmas of §1, and
 * that migration 0001 really carries every entity schema — a renamed column or a
 * missing table fails here instead of at runtime.
 */
const schemas = {
  project: projectSchema,
  conversation: conversationSchema,
  message_body: messageBodySchema,
  user_action: userActionSchema,
  message: messageSchema,
  work: workSchema,
  requirement: requirementSchema,
  task: taskSchema,
  assessment: assessmentSchema,
  authorization: authorizationSchema,
  decision: decisionSchema,
  discovery: discoverySchema,
  finding: findingSchema,
  run: runSchema,
  attempt: attemptSchema,
  attachment: attachmentSchema,
  artifact: artifactSchema,
  stage_result: stageResultRowSchema,
  snapshot: snapshotSchema,
  grant: grantSchema,
  budget: budgetSchema,
  command: commandSchema,
  event: eventSchema,
  outbox: outboxSchema,
  tool_operation: toolOperationSchema,
  lease: leaseSchema,
  operation: operationSchema,
  feature_projection: featureProjectionSchema,
} satisfies Record<string, { readonly shape: Record<string, unknown> }>;

const toSnakeCase = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Schema field name → column name, for the few documented renames. */
const COLUMN_ALIASES: Record<string, string> = {
  'run.join': 'join_policy',
};

/** Columns the storage layer adds for its own bookkeeping. */
const INTERNAL_COLUMNS: Record<string, readonly string[]> = {
  command: ['subject'],
  event: ['project_id'],
};

let root: string;
let databaseFile: string;
let db: SqliteDatabase;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentdev-storage-'));
  databaseFile = join(root, 'project.sqlite');
  db = openDatabase({ file: databaseFile });
});

afterEach(() => {
  closeDatabase(db);
  rmSync(root, { recursive: true, force: true });
});

function migrate(options: Parameters<typeof runMigrations>[2] = {}): MigrationResult {
  return runMigrations(db, MIGRATIONS, options);
}

describe('migrations', () => {
  it('applies the core schema and records a checksum', () => {
    const result = migrate();
    expect(result.applied).toEqual([1]);
    expect(result.currentVersion).toBe(1);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((row) => row.name);
    for (const table of SCHEMA_TABLES) expect(names, table).toContain(table);
    expect(names).toContain(MIGRATION_TABLE);

    const applied = readAppliedMigrations(db);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.name).toBe('0001-core-schema');
    expect(applied[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent on the second start', () => {
    migrate();
    const second = migrate();
    expect(second.applied).toEqual([]);
    expect(second.currentVersion).toBe(1);
  });

  it('applies the documented pragmas', () => {
    migrate();
    const pragmas = readPragmas(db);
    expect(pragmas.foreignKeys).toBe(1);
    expect(pragmas.journalMode).toBe('wal');
    // synchronous=FULL is 2 in SQLite.
    expect(pragmas.synchronous).toBe(2);
    expect(pragmas.busyTimeout).toBe(5000);
  });

  it('backs up before pending work and writes a usable copy', () => {
    const backupPath = join(root, 'pre-migration.backup');
    migrate({ backup: (destination) => backupDatabase(db, destination), backupPath });
    expect(existsSync(backupPath)).toBe(true);

    const copy = openDatabase({ file: backupPath, readOnly: true });
    try {
      const tables = copy
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'`)
        .all();
      // The backup was taken before migration, so the copy has no schema yet —
      // but it is a readable SQLite database.
      expect(tables).toEqual([]);
      expect(copy.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
    } finally {
      closeDatabase(copy);
    }
  });

  it('stops on a checksum mismatch instead of starting', () => {
    migrate();
    db.prepare(`UPDATE ${MIGRATION_TABLE} SET checksum = ? WHERE version = 1`).run('0'.repeat(64));
    expect(() => migrate()).toThrowError(
      expect.objectContaining({ code: 'MIGRATION_CHECKSUM_MISMATCH' }),
    );
  });

  it('refuses a database written by a newer build', () => {
    migrate();
    db.prepare(
      `INSERT INTO ${MIGRATION_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
    ).run(99, '0099-future', '1'.repeat(64), '2026-09-11T00:00:00.000Z');
    expect(() => verifyMigrations(db)).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_VERSION_AHEAD' }),
    );
  });

  it('rolls a failed migration back and reports its version', () => {
    const broken: Migration[] = [
      MIGRATIONS[0] as Migration,
      {
        version: 2,
        name: '0002-broken',
        // Real SQL failure: an unrunnable statement, not just an odd type name
        // (SQLite accepts arbitrary type names through type affinity).
        sql: 'CREATE TABLE good_table (id TEXT PRIMARY KEY); THIS IS NOT SQL;',
      },
    ];
    let error: unknown;
    try {
      runMigrations(db, broken);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe('MIGRATION_FAILED');
    expect((error as StorageError).details['version']).toBe(2);

    const versions = readAppliedMigrations(db).map((row) => row.version);
    expect(versions).toEqual([1]);
    const leftover = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'good_table'`)
      .all();
    expect(leftover).toEqual([]);
  });
});

describe('schema matches the entity contracts', () => {
  beforeEach(() => migrate());

  it('has every entity table with all documented columns', () => {
    for (const table of SCHEMA_TABLES) {
      const schema = schemas[table];
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (row) => row.name,
      );
      const expected = Object.keys(schema.shape).map(
        (field) => COLUMN_ALIASES[`${table}.${field}`] ?? toSnakeCase(field),
      );
      for (const column of expected) {
        expect(columns, `${table}.${column}`).toContain(column);
      }
      for (const column of columns) {
        const known =
          expected.includes(column) ||
          (INTERNAL_COLUMNS[table] ?? []).includes(column) ||
          column === 'project_id';
        // snapshot/event/outbox keep their own key shapes; anything else that is
        // neither a schema field nor a declared internal column is a mistake.
        if (table === 'snapshot' || table === 'event') continue;
        expect(known, `${table} has an undeclared column ${column}`).toBe(true);
      }
    }
  });

  it('records the base columns on every mutable table', () => {
    for (const table of SCHEMA_TABLES) {
      // Documented exceptions: `snapshot` is keyed by (type, hash) and `event` by
      // its cursor, and both are immutable so they carry none of the five base
      // columns; `project` has no separate project_id.
      if (table === 'snapshot' || table === 'event' || table === 'project') continue;
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (row) => row.name,
      );
      expect(columns, table).toContain('id');
      expect(columns, table).toContain('project_id');
      expect(columns, table).toContain('version');
      expect(columns, table).toContain('created_at');
      expect(columns, table).toContain('updated_at');
    }
  });

  it('declares the documented unique constraints', () => {
    // Table-level UNIQUE constraints live in the table DDL, not in a separate
    // index row, so read the CREATE TABLE statements.
    const tables = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL`)
      .all() as { name: string; sql: string }[];
    const ddl = tables.map((row) => row.sql.replace(/\s+/g, ' ')).join('\n');
    expect(ddl).toContain('UNIQUE (conversation_id, seq)');
    expect(ddl).toContain('UNIQUE (run_id, number)');
    expect(ddl).toContain('UNIQUE (operation, key)');
    expect(ddl).toContain('UNIQUE (revision, feature_id)');
    expect((CORE_SCHEMA_SQL.match(/resource TEXT NOT NULL UNIQUE/g) ?? []).length).toBe(1);
  });
});

describe('database-level invariants', () => {
  beforeEach(() => {
    migrate();
    db.prepare(
      `INSERT INTO project (id, version, created_at, updated_at, root, code_root, document_root, delivery_branch, trust, state)
       VALUES (?, 1, ?, ?, ?, 'src', 'docs', 'agentdev/main', 'trusted', 'open')`,
    ).run(
      '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f',
      '2026-09-11T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z',
      '/tmp/root',
    );
  });

  it('rejects an enum outside the documented set', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO conversation (id, project_id, version, created_at, updated_at, title, archived)
           VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f', 1, ?, ?, 't', 7)`,
        )
        .run('2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z'),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects a non-JSON payload and an oversized array', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO user_action (id, project_id, version, created_at, updated_at, actor_id, action, payload, payload_hash)
           VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f', 1, ?, ?, 'a', 'x', 'not json', ?)`,
        )
        .run('2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'a'.repeat(64)),
    ).toThrow(/CHECK constraint failed/);

    const oversized = JSON.stringify(Array.from({ length: 1001 }, (_, index) => String(index)));
    expect(() =>
      db
        .prepare(
          `INSERT INTO decision (id, project_id, version, created_at, updated_at, work_id, kind, target_ref, choices, state, actor, effect_refs)
           VALUES (?, '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f', 1, ?, ?, ?, 'product', '{}', ?, 'pending', 'user', '[]')`,
        )
        .run(
          '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60',
          '2026-09-11T00:00:00.000Z',
          '2026-09-11T00:00:00.000Z',
          '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61',
          oversized,
        ),
    ).toThrow(/CHECK constraint failed/);
  });

  it('enforces foreign keys inside the project', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO message (id, project_id, version, created_at, updated_at, conversation_id, seq, sender, body_ref, state, result_refs)
           VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f', 1, ?, ?, '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e6f', 1, 'user', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e7f', 'received', '[]')`,
        )
        .run('2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z'),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('makes events, snapshots and user actions immutable', () => {
    db.prepare(
      `INSERT INTO event (project_id, event_id, name, entity_id, entity_version, data, occurred_at)
       VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60', 'work.control_changed', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61', 1, '{}', ?)`,
    ).run('2026-09-11T00:00:00.000Z');

    for (const table of IMMUTABLE_TABLES) {
      const triggers = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`)
        .all(table) as { name: string }[];
      expect(triggers.map((row) => row.name).sort(), table).toEqual([
        `${table}_no_delete`,
        `${table}_no_update`,
      ]);
    }
    expect(() => db.prepare(`UPDATE event SET name = 'x'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM event`).run()).toThrow(/immutable/);
  });
});
