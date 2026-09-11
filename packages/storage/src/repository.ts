/**
 * Spec-driven entity persistence.
 *
 * One repository serves every table: a `TableSpec` names the table, its contract
 * schema, which fields are JSON text and which are 0/1 booleans, and which columns
 * storage adds internally. Writes always go through the version CAS, because
 * `protocol.md` §1 makes "expectedVersion" the only legal way to change a row
 * ("禁止盲改版本重发").
 */
import { StorageError } from './errors.js';
import { nowIso, uuidv7 } from './ids.js';
import { withTransaction, type SqliteDatabase } from './sqlite.js';

/**
 * Structural view of a contract schema.
 *
 * Storage deliberately keeps its dependency set to `contracts` +
 * better-sqlite3 (`ARCHITECTURE.md` §2), so it describes the parts of a Zod
 * schema it uses instead of importing Zod itself.
 */
export interface ContractSchema<T> {
  readonly shape: Record<string, unknown>;
  parse(value: unknown): T;
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: unknown };
}

interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

function schemaIssues(error: unknown): SchemaIssue[] {
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [{ path: [], message: String(error) }];
  return issues.map((issue) => {
    const entry = issue as { path?: unknown; message?: unknown };
    const path = Array.isArray(entry.path) ? (entry.path as PropertyKey[]) : [];
    return { path, message: typeof entry.message === 'string' ? entry.message : 'invalid value' };
  });
}

function describeIssues(error: unknown): string {
  return schemaIssues(error)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

export interface TableSpec<T extends Record<string, unknown>> {
  readonly table: string;
  readonly schema: ContractSchema<T>;
  /** Fields stored as JSON text. */
  readonly json: readonly string[];
  /** Fields stored as 0/1. */
  readonly boolean: readonly string[];
  /** Primary key field; defaults to `id`. */
  readonly key?: string;
  /** Internal columns that are not part of the contract shape. */
  readonly internal?: readonly string[];
  /** Field → column overrides for the few documented renames. */
  readonly aliases?: Readonly<Record<string, string>>;
}

const toSnakeCase = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function columnFor<T extends Record<string, unknown>>(
  spec: TableSpec<T>,
  field: string,
): string {
  return spec.aliases?.[field] ?? toSnakeCase(field);
}

type Row = Record<string, unknown>;

function encodeValue<T extends Record<string, unknown>>(
  spec: TableSpec<T>,
  field: string,
  value: unknown,
): unknown {
  if (value === undefined) return null;
  if (spec.json.includes(field)) return JSON.stringify(value);
  if (spec.boolean.includes(field)) return value === true ? 1 : 0;
  return value;
}

/** Reads a TEXT column without ever falling back to `[object Object]`. */
export function text(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  throw new StorageError('CONSTRAINT_VIOLATION', `${field} is not a text column`, { field });
}

/** Parses a JSON text column; the DDL guarantees `json_valid` on these. */
export function parseJson(value: unknown, field: string): unknown {
  if (typeof value !== 'string') {
    throw new StorageError('CONSTRAINT_VIOLATION', `${field} is not a JSON text column`, { field });
  }
  return JSON.parse(value) as unknown;
}

function decodeValue<T extends Record<string, unknown>>(
  spec: TableSpec<T>,
  field: string,
  value: unknown,
): unknown {
  if (value === null) return undefined;
  if (spec.json.includes(field)) return parseJson(value, field);
  if (spec.boolean.includes(field)) return value === 1;
  return value;
}

/** Converts a contract entity into a column map (internal columns excluded). */
export function toColumns<T extends Record<string, unknown>>(spec: TableSpec<T>, entity: T): Row {
  const row: Row = {};
  for (const [field, value] of Object.entries(entity)) {
    if ((spec.internal ?? []).includes(field)) continue;
    row[columnFor(spec, field)] = encodeValue(spec, field, value);
  }
  return row;
}

/** Converts a database row back into a validated contract entity. */
export function fromColumns<T extends Record<string, unknown>>(spec: TableSpec<T>, row: Row): T {
  const entity: Row = {};
  const columnToField = new Map<string, string>();
  // Rebuild the field list from the schema so a renamed column cannot be missed.
  for (const field of Object.keys(spec.schema.shape)) {
    columnToField.set(columnFor(spec, field), field);
  }
  for (const [column, value] of Object.entries(row)) {
    const field = columnToField.get(column);
    if (field === undefined) continue; // internal column
    const decoded = decodeValue(spec, field, value);
    if (decoded === undefined) continue; // optional/nullable absent
    entity[field] = decoded;
  }
  const parsed = spec.schema.safeParse(entity);
  if (!parsed.success) {
    throw new StorageError(
      'CONSTRAINT_VIOLATION',
      `${spec.table} row failed its contract schema: ${describeIssues(parsed.error)}`,
      { table: spec.table, issues: schemaIssues(parsed.error) },
    );
  }
  return parsed.data;
}

export interface EntityRepositoryOptions {
  /** Clock injection for deterministic tests. */
  readonly now?: () => string;
  /** Id injection for deterministic tests. */
  readonly newId?: () => string;
}

/** Read/write access to one entity table with optimistic concurrency. */
export class EntityRepository<T extends Record<string, unknown>> {
  private readonly spec: TableSpec<T>;
  private readonly db: SqliteDatabase;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(db: SqliteDatabase, spec: TableSpec<T>, options: EntityRepositoryOptions = {}) {
    this.db = db;
    this.spec = spec;
    this.now = options.now ?? nowIso;
    this.newId = options.newId ?? uuidv7;
  }

  get keyField(): string {
    return this.spec.key ?? 'id';
  }

  /** Returns the row, or `undefined` when it does not exist. */
  find(key: string): T | undefined {
    const row = this.db
      .prepare(`SELECT * FROM ${this.spec.table} WHERE ${columnFor(this.spec, this.keyField)} = ?`)
      .get(key) as Row | undefined;
    return row === undefined ? undefined : fromColumns(this.spec, row);
  }

  /** Returns the row or throws `NOT_FOUND`. */
  get(key: string): T {
    const found = this.find(key);
    if (found === undefined) {
      throw new StorageError('NOT_FOUND', `${this.spec.table} ${key} does not exist`, {
        table: this.spec.table,
        key,
      });
    }
    return found;
  }

  /** Lists rows ordered by an explicit column; `limit` is capped by the caller. */
  list(
    options: { where?: string; params?: readonly unknown[]; orderBy?: string; limit?: number } = {},
  ): T[] {
    const where = options.where === undefined ? '' : ` WHERE ${options.where}`;
    const orderBy = options.orderBy === undefined ? '' : ` ORDER BY ${options.orderBy}`;
    const limit = options.limit === undefined ? '' : ` LIMIT ${options.limit}`;
    const rows = this.db
      .prepare(`SELECT * FROM ${this.spec.table}${where}${orderBy}${limit}`)
      .all(...(options.params ?? [])) as Row[];
    return rows.map((row) => fromColumns(this.spec, row));
  }

  count(where?: string, params: readonly unknown[] = []): number {
    const clause = where === undefined ? '' : ` WHERE ${where}`;
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${this.spec.table}${clause}`)
      .get(...params) as { n: number };
    return row.n;
  }

  /**
   * Inserts a new row.
   *
   * The caller may omit `id`, `version`, `createdAt` and `updatedAt`; a provided
   * `version` must be 1 because version 0 means "expects absent" on the wire.
   */
  insert(entity: Partial<T> & Record<string, unknown>, options: { projectId?: string } = {}): T {
    const timestamp = this.now();
    const candidate: Row = {
      ...entity,
      [this.keyField]: entity[this.keyField] ?? this.newId(),
      version: 1,
      createdAt: entity['createdAt'] ?? timestamp,
      updatedAt: entity['updatedAt'] ?? timestamp,
    };
    if (candidate['projectId'] === undefined && options.projectId !== undefined) {
      candidate['projectId'] = options.projectId;
    }
    const parsed = this.spec.schema.safeParse(candidate);
    if (!parsed.success) {
      throw new StorageError(
        'CONSTRAINT_VIOLATION',
        `${this.spec.table} insert failed its contract schema: ${describeIssues(parsed.error)}`,
        { table: this.spec.table, issues: schemaIssues(parsed.error) },
      );
    }
    const columns = toColumns(this.spec, parsed.data);
    const names = Object.keys(columns);
    try {
      this.db
        .prepare(
          `INSERT INTO ${this.spec.table} (${names.join(', ')}) VALUES (${names
            .map(() => '?')
            .join(', ')})`,
        )
        .run(...names.map((name) => columns[name] as never));
    } catch (error) {
      throw translateSqliteError(error, this.spec.table);
    }
    return parsed.data;
  }

  /**
   * Applies a patch under a version check.
   *
   * @throws StorageError `VERSION_CONFLICT` when the row moved on, `NOT_FOUND`
   * when it is gone.
   */
  update(key: string, patch: Partial<T> & Record<string, unknown>, expectedVersion: number): T {
    const current = this.get(key);
    const merged: Row = {
      ...current,
      ...patch,
      [this.keyField]: key,
      version: expectedVersion + 1,
      createdAt: current['createdAt'],
      updatedAt: this.now(),
    };
    const parsed = this.spec.schema.safeParse(merged);
    if (!parsed.success) {
      throw new StorageError(
        'CONSTRAINT_VIOLATION',
        `${this.spec.table} update failed its contract schema: ${describeIssues(parsed.error)}`,
        { table: this.spec.table, issues: schemaIssues(parsed.error) },
      );
    }
    const columns = toColumns(this.spec, parsed.data);
    const names = Object.keys(columns).filter(
      (name) => name !== columnFor(this.spec, this.keyField),
    );
    try {
      const info = this.db
        .prepare(
          `UPDATE ${this.spec.table} SET ${names
            .map((name) => `${name} = ?`)
            .join(', ')} WHERE ${columnFor(this.spec, this.keyField)} = ? AND version = ?`,
        )
        .run(...names.map((name) => columns[name] as never), key, expectedVersion);
      if (info.changes === 0) {
        const existing = this.find(key);
        if (existing === undefined) {
          throw new StorageError('NOT_FOUND', `${this.spec.table} ${key} does not exist`, {
            table: this.spec.table,
            key,
          });
        }
        throw new StorageError(
          'VERSION_CONFLICT',
          `${this.spec.table} ${key} moved from version ${expectedVersion} to ${String(
            existing['version'],
          )}`,
          { table: this.spec.table, key, expectedVersion, currentVersion: existing['version'] },
        );
      }
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw translateSqliteError(error, this.spec.table);
    }
    return parsed.data;
  }

  /** Runs `work` inside one immediate transaction. */
  transact<R>(work: () => R): R {
    return withTransaction(this.db, work);
  }

  /** Exposes the raw handle for statement-level work (events, outbox, leases). */
  get handle(): SqliteDatabase {
    return this.db;
  }
}

/** Maps SQLite constraint failures onto the storage error vocabulary. */
export function translateSqliteError(error: unknown, table: string): StorageError {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code ?? '';
  if (code.startsWith('SQLITE_CONSTRAINT_UNIQUE') || message.includes('UNIQUE constraint failed')) {
    return new StorageError('DUPLICATE_KEY', `${table}: ${message}`, { table });
  }
  if (message.includes('CHECK constraint failed')) {
    return new StorageError('CONSTRAINT_VIOLATION', `${table}: ${message}`, { table });
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new StorageError('CONSTRAINT_VIOLATION', `${table}: ${message}`, { table });
  }
  if (code === 'SQLITE_BUSY' || message.includes('database is locked')) {
    return new StorageError('BUSY', `${table}: ${message}`, { table });
  }
  return new StorageError('CONSTRAINT_VIOLATION', `${table}: ${message}`, { table });
}
