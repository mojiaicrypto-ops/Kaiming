import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** `SHA256(canonicalRoot)[0:32]` — the project row's id form. */
const PROJECT_ID = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
import {
  CORE_SCHEMA_SQL,
  DELETE_BLOCKED_TABLES,
  UPDATE_BLOCKED_TABLES,
  MIGRATIONS,
  MIGRATION_TABLE,
  SCHEMA_TABLES,
  StorageError,
  backupDatabase,
  migrationChecksum,
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

describe('successive upgrades', () => {
  it('replaces a partial leftover and reuses a verified copy', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-partial-'));
    const db = openDatabase({ file: join(dataDir, 'project.sqlite') });
    const backupDir = join(dataDir, 'backups');
    const migration = (version: number): Migration => ({
      version,
      name: `m${String(version)}`,
      sql: `CREATE TABLE step_${String(version)} (id INTEGER PRIMARY KEY);`,
    });
    try {
      // An interrupted VACUUM INTO leaves a 0-byte file: it must not be trusted.
      const target = join(backupDir, 'pre-migration-v0.sqlite');
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(target, '');
      const first = runMigrations(db, [migration(1)], { backupDir });
      expect(first.applied).toEqual([1]);
      expect(first.backupPath).toBe(target);
      const copy = openDatabase({ file: target, readOnly: true });
      try {
        expect(readPragmas(copy).journalMode).toBeDefined();
        expect(
          copy.prepare('SELECT name FROM sqlite_master WHERE name = ?').get('schema_migrations'),
        ).toBeDefined();
      } finally {
        closeDatabase(copy);
      }

      // A verified copy of the source version is reused, not overwritten: only a
      // copy taken before step_1 existed can carry this sentinel.
      const sentinel = join(backupDir, 'pre-migration-v1.sqlite');
      const seed = openDatabase({ file: join(dataDir, 'seed.sqlite') });
      seed.exec('CREATE TABLE sentinel (id INTEGER PRIMARY KEY)');
      backupDatabase(seed, sentinel);
      closeDatabase(seed);
      const second = runMigrations(db, [migration(1), migration(2)], { backupDir });
      expect(second.applied).toEqual([2]);
      const reused = openDatabase({ file: sentinel, readOnly: true });
      try {
        expect(
          reused.prepare('SELECT name FROM sqlite_master WHERE name = ?').get('sentinel'),
        ).toBeDefined();
        expect(
          reused.prepare('SELECT name FROM sqlite_master WHERE name = ?').get('step_1'),
        ).toBeUndefined();
      } finally {
        closeDatabase(reused);
      }
    } finally {
      closeDatabase(db);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('keeps one backup per source version instead of colliding', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agentdev-upgrade-'));
    const db = openDatabase({ file: join(dataDir, 'project.sqlite') });
    const backupDir = join(dataDir, 'backups');
    const migration = (version: number): Migration => ({
      version,
      name: `m${String(version)}`,
      sql: `CREATE TABLE step_${String(version)} (id INTEGER PRIMARY KEY);`,
    });
    try {
      const first = runMigrations(db, [migration(1)], { backupDir });
      expect(first.applied).toEqual([1]);
      // The second upgrade runs from version 1 and must not target version 0's copy.
      const second = runMigrations(db, [migration(1), migration(2)], { backupDir });
      expect(second.applied).toEqual([2]);
      expect(existsSync(join(backupDir, 'pre-migration-v0.sqlite'))).toBe(true);
      expect(existsSync(join(backupDir, 'pre-migration-v1.sqlite'))).toBe(true);
      // A resumed attempt for the same version reuses its copy.
      const again = runMigrations(db, [migration(1), migration(2)], { backupDir });
      expect(again.applied).toEqual([]);
    } finally {
      closeDatabase(db);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('frozen migrations', () => {
  it('freezes migration 0001 and requires later changes to append a migration', () => {
    // WP-01 is the first release of this schema: 0001 was corrected in place before
    // any database shipped, and its checksum is frozen here. Editing 0001 again
    // would make every existing database fail MIGRATION_CHECKSUM_MISMATCH, so a
    // schema change must add a new migration instead (data.md §5).
    const first = MIGRATIONS[0];
    if (first === undefined) throw new Error('migration 0001 is missing');
    expect(migrationChecksum(first)).toBe(
      '8de041504378a4caf4292a38f6d542100c7b97fe90a4e560d43a623fc98e2dff',
    );
  });
});

describe('database-level invariants', () => {
  beforeEach(() => {
    migrate();
    db.prepare(
      `INSERT INTO project (id, version, created_at, updated_at, root, code_root, document_root, delivery_branch, trust, state)
       VALUES (?, 1, ?, ?, ?, 'src', 'docs', 'agentdev/main', 'trusted', 'open')`,
    ).run(PROJECT_ID, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', '/tmp/root');
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
           VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60', ?, 1, ?, ?, '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e6f', 1, 'user', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e7f', 'received', '[]')`,
        )
        .run(PROJECT_ID, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z'),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('makes events, snapshots and user actions immutable', () => {
    db.prepare(
      `INSERT INTO event (project_id, event_id, name, entity_id, entity_version, data, occurred_at)
       VALUES (?, '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60', 'work.control_changed', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61', 1, '{}', ?)`,
    ).run(PROJECT_ID, '2026-09-11T00:00:00.000Z');

    const triggersFor = (table: string): string[] =>
      (
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`)
          .all(table) as { name: string }[]
      )
        .map((row) => row.name)
        .sort();

    // UPDATE is blocked everywhere; DELETE stays available for events alone,
    // because `data.md` §5 requires retention truncation.
    for (const table of UPDATE_BLOCKED_TABLES) {
      expect(triggersFor(table), table).toContain(`${table}_no_update`);
    }
    for (const table of DELETE_BLOCKED_TABLES) {
      expect(triggersFor(table), table).toContain(`${table}_no_delete`);
    }
    expect(triggersFor('event')).toEqual(['event_no_update']);
    // The delete/update triggers are per row, so the probes need real rows.
    db.prepare(
      `INSERT INTO snapshot (type, hash, payload, blob_path, created_at)
       VALUES ('config', ?, '{}', 'blobs/ab/x', ?)`,
    ).run('a'.repeat(64), '2026-09-11T00:00:00.000Z');
    db.prepare(
      `INSERT INTO user_action (id, project_id, version, created_at, updated_at, actor_id, action, payload, payload_hash)
       VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70', ?, 1, ?, ?, '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71', 'work.pause', '{}', ?)`,
    ).run(PROJECT_ID, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'b'.repeat(64));

    // An assessment references a Work, which references a Budget.
    db.prepare(
      `INSERT INTO budget (id, project_id, version, created_at, updated_at, work_id, token_limit, tokens_used, tokens_reserved, active_time_limit, active_time_used, repair_limit, repair_used, cost_known)
       VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e82', ?, 1, ?, ?, '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e81', 1000, 0, 0, 60, 0, 3, 0, 1)`,
    ).run(PROJECT_ID, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z');
    db.prepare(
      `INSERT INTO work (id, project_id, version, created_at, updated_at, intent, purpose, level, goal, scope, source_ref, status, blocker_ids, budget_id, policy_revision)
       VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e81', ?, 1, ?, ?, 'delivery', 'purpose', 'L2', 'goal', '{"readPaths":[],"writePaths":[],"operations":[],"networkTargets":[]}', '{"kind":"message","id":"018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60","version":"1"}', 'running', '[]', '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e82', 1)`,
    ).run(PROJECT_ID, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z');
    db.prepare(
      `INSERT INTO assessment (id, project_id, version, created_at, updated_at, work_id, intent, level, semantic_impact, risk_flags, uncertainties, policy_revision, reason)
       VALUES ('018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e80', ?, 1, ?, ?, '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e81', 'delivery', 'L2', 1, '[]', '[]', 1, 'bounded change')`,
    ).run(PROJECT_ID, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z');
    // A re-assessment is a new row, never an edit (data.md §2).
    expect(() => db.prepare(`UPDATE assessment SET level = 'L1'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE event SET name = 'x'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE snapshot SET blob_path = 'x'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE user_action SET action = 'x'`).run()).toThrow(/immutable/);
    // Retention truncation is the one documented deletion (`data.md` §5).
    expect(db.prepare(`DELETE FROM event`).run().changes).toBe(1);
    expect(() => db.prepare(`DELETE FROM snapshot`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM user_action`).run()).toThrow(/immutable/);
  });
});
