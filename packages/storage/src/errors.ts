/**
 * Storage-layer failures.
 *
 * Migration and integrity problems must stop the daemon rather than degrade:
 * `data.md` §5 requires "checksum不一致停止启动；失败回滚并显示版本，不启动Runner"
 * and `protocol.md` §7 maps integrity failures to explicit error codes.
 */
export type StorageErrorCode =
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_FAILED'
  | 'SCHEMA_VERSION_AHEAD'
  | 'DATABASE_UNREADABLE'
  | 'CONSTRAINT_VIOLATION'
  | 'VERSION_CONFLICT'
  | 'DUPLICATE_KEY'
  | 'NOT_FOUND'
  | 'BLOB_MISSING'
  | 'BLOB_MISMATCH'
  | 'BUSY';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: StorageErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.details = details;
  }
}

/** Narrows an unknown throwable to our typed storage failure. */
export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError;
}
