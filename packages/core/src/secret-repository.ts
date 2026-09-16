/**
 * Durable secret repository (WP-12 T1.1).
 *
 * `docs/architecture/execution.md` §4 fixes the storage model this module implements:
 *
 * > Secret按用途使用，模型Secret仅在Gateway；项目命令Secret按Grant短时注入目标工具…
 * > Store在macOS使用Keychain，Linux使用0600加密文件，密钥由安装时生成的0600独立主密钥
 * > 文件或系统credential提供。
 *
 * and `docs/architecture/reliability.md` §7 puts the installation state under
 * `~/.agentdev` (overridable through `AGENTDEV_HOME`). Two backends sit behind one
 * interface and are **namespaced on disk**, so neither can mistake the other's files for
 * its own records:
 *
 * ```
 * <home>/secrets/master.key          0600 random 32-byte master key (shared)
 * <home>/secrets/file/<sha256>.json  0600 AES-256-GCM record
 * <home>/secrets/keychain/index.json 0600 metadata index (values live in the Keychain)
 * ```
 *
 * Properties the callers rely on:
 *
 * 1. **The query surface never carries a value.** `list()` returns refs and metadata
 *    derived from plaintext headers (file) or the index (Keychain); only `get()` — the
 *    startup-load and CLI-direct path — returns a value.
 * 2. **Reading is tolerant, never fatal.** A stray, foreign, symlinked or corrupt file
 *    is reported through {@link SecretRepository.problems} and skipped; an existing but
 *    undecryptable record is listed with `health:'unreadable'`. `list()` never throws,
 *    so a bad file can never stop the daemon from starting (W12T1-01).
 * 3. **A wrong or absent master key fails loudly.** Decryption verifies the GCM tag; a
 *    missing key raises `SECRET_MASTER_KEY_MISSING`, and `set` never regenerates a key
 *    while records exist, because that would orphan them (W12T1-04).
 * 4. **`file` is the default, Keychain is opt-in.** The macOS `security` CLI takes the
 *    value as an argv element, so `AGENTDEV_SECRET_BACKEND=keychain` must be set
 *    explicitly (WP-12 decision 3).
 * 5. **Errors never echo a value.** Every failure is a typed
 *    {@link SecretRepositoryError} whose message names the ref or the path at most.
 */
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import type { Purpose, Role } from '@agentdev/contracts';

import { enforcePrivateMode } from './auth.js';
import { writePrivateFile } from './runtime.js';
import {
  MAX_SECRET_ENV_NAME_LENGTH,
  isValidSecretRef,
  secretEnvName,
  type SecretAudience,
  type SecretStore,
} from './secrets.js';

/** Environment variable that selects the durable backend (`execution.md` §4). */
export const SECRET_BACKEND_ENV = 'AGENTDEV_SECRET_BACKEND';

/** Backends `execution.md` §4 allows: macOS Keychain or a 0600 encrypted file. */
export type SecretBackendName = 'file' | 'keychain';

/** Absolute path of the macOS `security` binary. */
export const SECURITY_BINARY = '/usr/bin/security';

/** Keychain service every AgentDev secret is filed under. */
export const KEYCHAIN_SERVICE = 'agentdev-secret';

const SECRETS_DIR_NAME = 'secrets';
const FILE_DIR_NAME = 'file';
const KEYCHAIN_DIR_NAME = 'keychain';
const MASTER_KEY_FILE = 'master.key';
const KEYCHAIN_INDEX_FILE = 'index.json';
const MASTER_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const MAX_VALUE_LENGTH = 64 * 1024;
const DIR_MODE = 0o700;
const RECORD_VERSION = 1;
/** `O_NOFOLLOW` on POSIX; `0` on platforms that do not define it. */
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;
/** `errSecItemNotFound`: `security` exits 44 when no matching item exists. */
const SECURITY_NOT_FOUND = 44;

/** Ref-keyed metadata persisted beside a value; never contains the value itself. */
export interface SecretRecordMetadata {
  readonly audience: SecretAudience;
  /** Environment variable a tool-audience secret is injected as. */
  readonly envName?: string;
  /** Purposes allowed to resolve it; omitted means "any Grant-admitted purpose". */
  readonly purposes?: readonly Purpose[];
  /** Roles allowed to resolve it; omitted means "any Grant-admitted role". */
  readonly roles?: readonly Role[];
}

/**
 * Whether a stored record can actually produce its value.
 *
 * `missing` is the Keychain case where the metadata index still lists a ref whose
 * Keychain item is gone (R2-01); `unreadable` means the record exists but cannot be
 * opened with the current key.
 */
export type SecretRecordHealth = 'ok' | 'unreadable' | 'missing';

/** Why a record is unreadable; a typed code plus a message that never holds a value. */
export interface SecretRecordIssue {
  readonly code: SecretRepositoryErrorCode;
  readonly message: string;
}

/** One stored secret **with** its value; only {@link SecretRepository.get} returns it. */
export interface StoredSecretRecord {
  readonly ref: string;
  readonly value: string;
  readonly metadata: SecretRecordMetadata;
  readonly updatedAt: string;
  readonly backend: SecretBackendName;
}

/** The query shape of one stored secret; never contains a value. */
export interface SecretRecordSummary {
  readonly ref: string;
  /** True only when the record is readable; an undecryptable one is `false`. */
  readonly configured: boolean;
  readonly updatedAt: string;
  readonly backend: SecretBackendName;
  readonly health: SecretRecordHealth;
  /** Present whenever `health` is not `ok` (W12T1-01/03, R2-01). */
  readonly issue?: SecretRecordIssue;
}

/** A file or index row the active backend could not treat as a record. */
export interface SecretRecordProblem {
  /** Absolute path of the offending file or index; it holds no value. */
  readonly path: string;
  readonly code: SecretRepositoryErrorCode;
  readonly message: string;
}

/** The durable store the daemon and the CLI share. */
export interface SecretRepository {
  readonly backend: SecretBackendName;
  /** Registers or replaces one secret; returns metadata only. */
  set(ref: string, value: string, metadata?: SecretRecordMetadata): SecretRecordSummary;
  /** Reads one value; `null` when the ref is not stored. */
  get(ref: string): StoredSecretRecord | null;
  /**
   * Removes one secret; `true` when a registration existed.
   *
   * A path that is not this backend's regular record (a symlink, a directory) is a typed
   * `SECRET_RECORD_INVALID` refusal rather than an untyped filesystem error (R2-02).
   */
  delete(ref: string): boolean;
  /** Every stored ref with metadata only, sorted by ref; never throws. */
  list(): readonly SecretRecordSummary[];
  /** Files/rows the backend could not read, so a caller can log or surface them. */
  problems(): readonly SecretRecordProblem[];
}

/** Codes a repository operation can fail with; the CLI prints them verbatim. */
export type SecretRepositoryErrorCode =
  | 'SECRET_BACKEND_INVALID'
  | 'SECRET_VALUE_INVALID'
  | 'SECRET_MASTER_KEY_MISSING'
  | 'SECRET_MASTER_KEY_INVALID'
  | 'SECRET_RECORD_INVALID'
  | 'SECRET_NOT_FOUND'
  | 'SECRET_DECRYPT_FAILED'
  | 'SECRET_STORE_FAILED'
  | 'SECRET_KEYCHAIN_FAILED';

/** A repository failure with a stable code and no value in its message. */
export class SecretRepositoryError extends Error {
  readonly code: SecretRepositoryErrorCode;

  constructor(code: SecretRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'SecretRepositoryError';
    this.code = code;
  }
}

/** The outcome of one injected `security` invocation. */
export interface SecretCommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the platform credential tool; injected so tests never touch the Keychain. */
export type SecretCommandRunner = (command: string, args: readonly string[]) => SecretCommandResult;

export interface CreateSecretRepositoryOptions {
  /** Installation state directory (`runtimePaths(home)`, honouring `AGENTDEV_HOME`). */
  readonly home: string;
  /** Environment used to resolve `AGENTDEV_SECRET_BACKEND`; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Explicit backend, overriding the environment (the daemon's test seam). */
  readonly backend?: SecretBackendName;
  /** Command runner for the Keychain backend; defaults to `spawnSync`. */
  readonly commandRunner?: SecretCommandRunner;
  readonly now?: () => Date;
}

/** Files the repository owns inside the runtime home. */
export interface SecretRepositoryPaths {
  /** Root of the secret store. */
  readonly dir: string;
  /** Namespace of the AES-256-GCM file backend. */
  readonly fileDir: string;
  /** Namespace of the macOS Keychain backend (its metadata index only). */
  readonly keychainDir: string;
  /** 0600 master key shared by the file backend. */
  readonly masterKey: string;
  /** 0600 metadata index of the Keychain backend. */
  readonly keychainIndex: string;
}

/** Builds the path set of the secret store inside one runtime home. */
export function secretRepositoryPaths(home: string): SecretRepositoryPaths {
  const dir = join(home, SECRETS_DIR_NAME);
  const fileDir = join(dir, FILE_DIR_NAME);
  const keychainDir = join(dir, KEYCHAIN_DIR_NAME);
  return {
    dir,
    fileDir,
    keychainDir,
    masterKey: join(dir, MASTER_KEY_FILE),
    keychainIndex: join(keychainDir, KEYCHAIN_INDEX_FILE),
  };
}

/**
 * Resolves which backend this installation uses.
 *
 * `AGENTDEV_SECRET_BACKEND` selects the backend; an unknown value fails loudly instead of
 * silently falling back, because a user who asked for the Keychain must not get a file
 * (and the other way round).
 *
 * The default is **`file` on every platform, including darwin** (WP-12 decision 3): the
 * macOS `security` CLI takes the value as an argv element (`-w <value>`), which is
 * visible in `ps` for the lifetime of the call, so the Keychain backend stays strictly
 * opt-in. `file` keeps the value inside an AES-256-GCM record and never in argv.
 */
export function resolveSecretBackend(options: CreateSecretRepositoryOptions): SecretBackendName {
  // An omitted `env` means the process environment: that is how `AGENTDEV_SECRET_BACKEND`
  // reaches the CLI and the daemon without either one having to thread it through.
  const requested = options.backend ?? (options.env ?? process.env)[SECRET_BACKEND_ENV];
  if (requested !== undefined && requested !== '') {
    if (requested === 'file' || requested === 'keychain') return requested;
    throw new SecretRepositoryError(
      'SECRET_BACKEND_INVALID',
      `${SECRET_BACKEND_ENV} must be "file" or "keychain"`,
    );
  }
  return 'file';
}

/** Opens the durable repository for one installation. */
export function createSecretRepository(options: CreateSecretRepositoryOptions): SecretRepository {
  const backend = resolveSecretBackend(options);
  const paths = secretRepositoryPaths(options.home);
  const now = options.now ?? (() => new Date());
  return backend === 'keychain'
    ? new KeychainSecretRepository(paths, now, options.commandRunner ?? defaultCommandRunner)
    : new FileSecretRepository(paths, now);
}

/** Why one stored ref could not be loaded into the in-memory store. */
export interface SecretLoadFailure {
  readonly ref: string;
  readonly code: string;
  readonly message: string;
}

/** The outcome of the daemon-start load; `problems` are files without a usable ref. */
export interface SecretLoadResult {
  readonly loaded: number;
  readonly failed: readonly SecretLoadFailure[];
  readonly problems: readonly SecretRecordProblem[];
}

/**
 * Loads every stored secret into the in-memory store the Gateway resolves against.
 *
 * This is the seam WP-12 T1.1 adds at daemon start: registration is not authorization
 * (`execution.md` §4), so this only re-registers the refs; a Grant is still required to
 * resolve one, and a Provider secret is still `gateway`-audience only.
 *
 * The load is **per-record tolerant and never throws** (W12T1-01): an unreadable record
 * is reported through `failed`/`problems`, the daemon still starts, and resolving that
 * ref fails closed with the typed reason.
 */
export function loadSecretsIntoStore(
  repository: SecretRepository,
  store: SecretStore,
): SecretLoadResult {
  let loaded = 0;
  const failed: SecretLoadFailure[] = [];
  let summaries: readonly SecretRecordSummary[];
  let problems: readonly SecretRecordProblem[];
  try {
    summaries = repository.list();
    problems = repository.problems();
  } catch (error) {
    // `list()` is documented never to throw, but a future backend bug must still not
    // take the daemon down with it.
    return {
      loaded: 0,
      failed: [],
      problems: [
        {
          path: repository.backend,
          code: error instanceof SecretRepositoryError ? error.code : 'SECRET_STORE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  for (const summary of summaries) {
    if (summary.health !== 'ok') {
      failed.push({
        ref: summary.ref,
        code: summary.issue?.code ?? 'SECRET_DECRYPT_FAILED',
        message: summary.issue?.message ?? `secret ${summary.ref} is not readable`,
      });
      continue;
    }
    try {
      const record = repository.get(summary.ref);
      if (record === null) continue;
      store.put({
        ref: record.ref,
        value: record.value,
        audience: record.metadata.audience,
        ...(record.metadata.envName === undefined ? {} : { envName: record.metadata.envName }),
        ...(record.metadata.purposes === undefined ? {} : { purposes: record.metadata.purposes }),
        ...(record.metadata.roles === undefined ? {} : { roles: record.metadata.roles }),
      });
      loaded += 1;
    } catch (error) {
      failed.push({
        ref: summary.ref,
        code: error instanceof SecretRepositoryError ? error.code : 'SECRET_STORE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { loaded, failed, problems };
}

// ---------------------------------------------------------------------------
// File backend
// ---------------------------------------------------------------------------

/** One ciphertext record on disk: plaintext header plus a sealed value. */
interface FileRecordEnvelope {
  readonly v: number;
  readonly ref: string;
  readonly backend: 'file';
  readonly audience: SecretAudience;
  readonly updatedAt: string;
  readonly algorithm: 'aes-256-gcm';
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
  readonly envName?: string;
  readonly purposes?: readonly string[];
  readonly roles?: readonly string[];
}

/** AES-256-GCM over `<home>/secrets/file`, keyed by a 0600 master key file. */
class FileSecretRepository implements SecretRepository {
  readonly backend = 'file' as const;
  private readonly paths: SecretRepositoryPaths;
  private readonly now: () => Date;

  constructor(paths: SecretRepositoryPaths, now: () => Date) {
    this.paths = paths;
    this.now = now;
  }

  set(ref: string, value: string, metadata?: SecretRecordMetadata): SecretRecordSummary {
    assertRef(ref);
    assertValue(value);
    const updatedAt = this.now().toISOString();
    // The key is read (or created only for a clean store) *before* anything is written,
    // so a refused `set` leaves no record behind (W12T1-03/04).
    const key = this.requireMasterKey(true);
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    // The ref is authenticated as additional data, so a renamed record cannot be
    // replayed under another ref.
    cipher.setAAD(Buffer.from(ref, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const envelope: FileRecordEnvelope = {
      v: RECORD_VERSION,
      ref,
      backend: 'file',
      audience: metadata?.audience ?? 'gateway',
      updatedAt,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      ...(metadata?.envName === undefined ? {} : { envName: metadata.envName }),
      ...(metadata?.purposes === undefined ? {} : { purposes: [...metadata.purposes] }),
      ...(metadata?.roles === undefined ? {} : { roles: [...metadata.roles] }),
    };
    this.ensureDir();
    const path = this.recordPath(ref);
    assertReplaceable(path, 'secret record');
    writePrivateFile(path, `${JSON.stringify(envelope)}\n`);
    return { ref, configured: true, updatedAt, backend: this.backend, health: 'ok' };
  }

  get(ref: string): StoredSecretRecord | null {
    assertRef(ref);
    const path = this.recordPath(ref);
    if (fileKind(path) === 'missing') return null;
    const envelope = parseEnvelope(readRecord(path), path);
    if (envelope.ref !== ref) {
      // The file name is the ref hash, so this only happens if a record was copied.
      throw new SecretRepositoryError(
        'SECRET_RECORD_INVALID',
        `the secret record ${path} belongs to another ref`,
      );
    }
    const value = this.decrypt(envelope);
    return {
      ref: envelope.ref,
      value,
      metadata: {
        audience: envelope.audience,
        ...(envelope.envName === undefined ? {} : { envName: envelope.envName }),
        ...(envelope.purposes === undefined
          ? {}
          : { purposes: envelope.purposes as readonly Purpose[] }),
        ...(envelope.roles === undefined ? {} : { roles: envelope.roles as readonly Role[] }),
      },
      updatedAt: envelope.updatedAt,
      backend: this.backend,
    };
  }

  /**
   * Removes one record, refusing anything that is not this backend's regular file.
   *
   * A directory or a symlink at the record path would otherwise surface as an untyped
   * `EISDIR`/`EPERM` and become a 500 on the admin surface (R2-02); it is refused with
   * the path and the reason instead.
   */
  delete(ref: string): boolean {
    assertRef(ref);
    const path = this.recordPath(ref);
    const kind = fileKind(path);
    if (kind === 'missing') return false;
    if (kind !== 'file') {
      throw new SecretRepositoryError(
        'SECRET_RECORD_INVALID',
        `the secret record ${path} is not a regular file (${kind})`,
      );
    }
    try {
      rmSync(path, { force: true });
    } catch (error) {
      throw new SecretRepositoryError(
        'SECRET_STORE_FAILED',
        `the secret record ${path} could not be deleted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return true;
  }

  /**
   * Every readable record, plus an `unreadable` entry for each record the current master
   * key cannot open. A file that is not this backend's record (foreign, corrupt,
   * symlinked) is never listed here; it is reported by {@link problems} instead.
   */
  list(): readonly SecretRecordSummary[] {
    return this.scan().items;
  }

  problems(): readonly SecretRecordProblem[] {
    return this.scan().problems;
  }

  private scan(): {
    readonly items: readonly SecretRecordSummary[];
    readonly problems: readonly SecretRecordProblem[];
  } {
    const items: SecretRecordSummary[] = [];
    const problems: SecretRecordProblem[] = [];
    const dirKind = fileKind(this.paths.fileDir);
    if (dirKind === 'missing') return { items, problems };
    if (dirKind !== 'directory') {
      problems.push(
        toProblem(
          this.paths.fileDir,
          new SecretRepositoryError(
            'SECRET_RECORD_INVALID',
            `the secret record directory ${this.paths.fileDir} is not a directory`,
          ),
        ),
      );
      return { items, problems };
    }
    let names: string[];
    try {
      names = readdirSync(this.paths.fileDir).sort();
    } catch (error) {
      problems.push(toProblem(this.paths.fileDir, error));
      return { items, problems };
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.paths.fileDir, name);
      let envelope: FileRecordEnvelope;
      try {
        // A too-permissive record is repaired here rather than ignored (P3), and a
        // symlink or directory is refused instead of followed.
        envelope = parseEnvelope(readRecord(path), path);
        if (this.recordName(envelope.ref) !== name) {
          throw new SecretRepositoryError(
            'SECRET_RECORD_INVALID',
            `the secret record ${path} does not match its file name`,
          );
        }
      } catch (error) {
        problems.push(toProblem(path, error));
        continue;
      }
      try {
        this.decrypt(envelope);
        items.push({
          ref: envelope.ref,
          configured: true,
          updatedAt: envelope.updatedAt,
          backend: this.backend,
          health: 'ok',
        });
      } catch (error) {
        items.push({
          ref: envelope.ref,
          configured: false,
          updatedAt: envelope.updatedAt,
          backend: this.backend,
          health: 'unreadable',
          issue: toIssue(error),
        });
      }
    }
    return { items: items.sort((left, right) => left.ref.localeCompare(right.ref)), problems };
  }

  private decrypt(envelope: FileRecordEnvelope): string {
    const key = this.requireMasterKey(false);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(envelope.ref, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // The GCM tag did not verify: the master key changed or the record was tampered
      // with. Never return a partially decrypted value.
      throw new SecretRepositoryError(
        'SECRET_DECRYPT_FAILED',
        `secret ${envelope.ref} cannot be decrypted with the current master key`,
      );
    }
  }

  /** The record file of one ref: a hash, so no ref can escape the directory. */
  private recordPath(ref: string): string {
    return join(this.paths.fileDir, this.recordName(ref));
  }

  private recordName(ref: string): string {
    return `${createHash('sha256').update(ref, 'utf8').digest('hex')}.json`;
  }

  /** Whether this backend already holds at least one record file. */
  private hasRecords(): boolean {
    if (fileKind(this.paths.fileDir) === 'missing') return false;
    try {
      return readdirSync(this.paths.fileDir).some((name) => name.endsWith('.json'));
    } catch {
      return false;
    }
  }

  /**
   * Reads the master key, creating it only for a store that holds no records.
   *
   * A missing key beside existing records is fatal for those records (W12T1-04): a fresh
   * random key would silently orphan them, so `set` refuses instead of regenerating. The
   * key file itself is never a symlink; a foreign file is refused.
   */
  private requireMasterKey(create: boolean): Buffer {
    const path = this.paths.masterKey;
    const kind = fileKind(path);
    if (kind === 'missing') {
      if (!create) {
        throw new SecretRepositoryError(
          'SECRET_MASTER_KEY_MISSING',
          `the secret master key ${path} is missing; stored secrets cannot be read`,
        );
      }
      if (this.hasRecords()) {
        throw new SecretRepositoryError(
          'SECRET_MASTER_KEY_MISSING',
          `the secret master key ${path} is missing while records exist; those records are unreadable without it — restore the key or delete the records`,
        );
      }
      this.ensureDir();
      try {
        writePrivateFile(path, `${randomBytes(MASTER_KEY_BYTES).toString('base64')}\n`, {
          exclusive: true,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } else if (kind !== 'file') {
      throw new SecretRepositoryError(
        'SECRET_MASTER_KEY_INVALID',
        `the secret master key ${path} is not a regular file`,
      );
    }
    enforcePrivateMode(path);
    const text = readPrivateFile(path, 'secret master key').trim();
    const key = Buffer.from(text, 'base64');
    if (key.length !== MASTER_KEY_BYTES) {
      throw new SecretRepositoryError(
        'SECRET_MASTER_KEY_INVALID',
        `the secret master key ${path} is not ${String(MASTER_KEY_BYTES)} bytes`,
      );
    }
    return key;
  }

  private ensureDir(): void {
    for (const dir of [this.paths.dir, this.paths.fileDir]) {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      chmodSync(dir, DIR_MODE);
    }
  }
}

// ---------------------------------------------------------------------------
// Keychain backend
// ---------------------------------------------------------------------------

/** One index row; metadata only, so `list()` never asks the Keychain for a value. */
interface KeychainIndexEntry {
  readonly ref: string;
  readonly audience: SecretAudience;
  readonly updatedAt: string;
  readonly envName?: string;
  readonly purposes?: readonly string[];
  readonly roles?: readonly string[];
}

interface KeychainIndex {
  readonly v: number;
  readonly entries: readonly KeychainIndexEntry[];
}

/** macOS Keychain via `security`; values live in the Keychain, metadata in an index. */
class KeychainSecretRepository implements SecretRepository {
  readonly backend = 'keychain' as const;
  private readonly paths: SecretRepositoryPaths;
  private readonly now: () => Date;
  private readonly run: SecretCommandRunner;

  constructor(paths: SecretRepositoryPaths, now: () => Date, run: SecretCommandRunner) {
    this.paths = paths;
    this.now = now;
    this.run = run;
  }

  set(ref: string, value: string, metadata?: SecretRecordMetadata): SecretRecordSummary {
    assertRef(ref);
    assertValue(value);
    const result = this.run(SECURITY_BINARY, [
      'add-generic-password',
      '-a',
      ref,
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
      value,
      // `-U` updates the item in place, which is what makes `set` a rotation.
      '-U',
    ]);
    if (result.status !== 0) {
      throw new SecretRepositoryError(
        'SECRET_KEYCHAIN_FAILED',
        `the Keychain refused to store secret ${ref} (status ${String(result.status)})`,
      );
    }
    const updatedAt = this.now().toISOString();
    const entries = this.readIndex().entries.filter((entry) => entry.ref !== ref);
    entries.push({
      ref,
      audience: metadata?.audience ?? 'gateway',
      updatedAt,
      ...(metadata?.envName === undefined ? {} : { envName: metadata.envName }),
      ...(metadata?.purposes === undefined ? {} : { purposes: [...metadata.purposes] }),
      ...(metadata?.roles === undefined ? {} : { roles: [...metadata.roles] }),
    });
    this.writeIndex(entries);
    return { ref, configured: true, updatedAt, backend: this.backend, health: 'ok' };
  }

  get(ref: string): StoredSecretRecord | null {
    assertRef(ref);
    const value = this.readKeychainValue(ref);
    if (value === null) return null;
    const entry = this.readIndex().entries.find((candidate) => candidate.ref === ref);
    return {
      ref,
      value,
      metadata: {
        audience: entry?.audience ?? 'gateway',
        ...(entry?.envName === undefined ? {} : { envName: entry.envName }),
        ...(entry?.purposes === undefined
          ? {}
          : { purposes: entry.purposes as readonly Purpose[] }),
        ...(entry?.roles === undefined ? {} : { roles: entry.roles as readonly Role[] }),
      },
      updatedAt: entry?.updatedAt ?? new Date(0).toISOString(),
      backend: this.backend,
    };
  }

  /**
   * Reads one Keychain value, decoding the two forms `security` can print.
   *
   * `security find-generic-password -w` prints the stored bytes verbatim only while they
   * are printable ASCII; as soon as the value holds any other byte (a non-ASCII character
   * or a control byte) it prints the value **hex-encoded**. Treating that hex answer as
   * the value corrupts such credentials, so an all-hex `-w` answer is disambiguated with
   * `-g`, whose `password:` line quotes printable data and prints `0x…` for the rest.
   */
  private readKeychainValue(ref: string): string | null {
    const result = this.run(SECURITY_BINARY, [
      'find-generic-password',
      '-a',
      ref,
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ]);
    if (result.status === SECURITY_NOT_FOUND) return null;
    if (result.status !== 0) {
      throw new SecretRepositoryError(
        'SECRET_KEYCHAIN_FAILED',
        `the Keychain could not read secret ${ref} (status ${String(result.status)})`,
      );
    }
    // `security -w` prints the value plus one newline; strip exactly that newline so a
    // value that legitimately ends in whitespace is preserved.
    const text = stripOneTrailingNewline(result.stdout);
    return isHexEncodedLooking(text) ? this.decodeHexValue(ref, text) : text;
  }

  /**
   * Decides whether an all-hex `-w` answer is the value itself or its hex encoding.
   *
   * Only a value whose bytes are all printable ASCII and all in `[0-9a-f]` can produce an
   * ambiguous `-w` answer; for those `security -g` prints `password: "…"`, while a real
   * hex encoding prints `password: 0x…`. Either way the bytes were already proven readable
   * by the `-w` call above, so a `-g` failure here is a real read failure, not a "missing
   * item" and must not be turned into a silently wrong value.
   */
  private decodeHexValue(ref: string, text: string): string {
    const probe = this.run(SECURITY_BINARY, [
      'find-generic-password',
      '-a',
      ref,
      '-s',
      KEYCHAIN_SERVICE,
      '-g',
    ]);
    if (probe.status !== 0) {
      throw new SecretRepositoryError(
        'SECRET_KEYCHAIN_FAILED',
        `the Keychain could not disambiguate secret ${ref} (status ${String(probe.status)})`,
      );
    }
    const match = KEYCHAIN_PASSWORD_HEX_LINE.exec(`${probe.stdout}\n${probe.stderr}`);
    return match === null ? text : Buffer.from(match[1]!.slice(2), 'hex').toString('utf8');
  }

  /**
   * Removes one Keychain item **and** its index row, reporting honestly.
   *
   * A stale row (the item is gone) is still cleaned up and reported as removed, so the
   * index converges instead of hiding the ref forever (R2-01).
   */
  delete(ref: string): boolean {
    assertRef(ref);
    const result = this.run(SECURITY_BINARY, [
      'delete-generic-password',
      '-a',
      ref,
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    if (result.status !== 0 && result.status !== SECURITY_NOT_FOUND) {
      throw new SecretRepositoryError(
        'SECRET_KEYCHAIN_FAILED',
        `the Keychain could not delete secret ${ref} (status ${String(result.status)})`,
      );
    }
    const index = this.readIndex();
    const hadRow = index.entries.some((entry) => entry.ref === ref);
    if (hadRow) {
      this.writeIndex(index.entries.filter((entry) => entry.ref !== ref));
    }
    // `true` when there was something to remove: the item and/or its index row.
    return result.status === 0 || hadRow;
  }

  list(): readonly SecretRecordSummary[] {
    return this.scan().items;
  }

  problems(): readonly SecretRecordProblem[] {
    return this.scan().problems;
  }

  /**
   * Validates every index row against the Keychain itself (R2-01).
   *
   * The index is only metadata; a row can outlive its item (a manual `security` delete, a
   * failed write). Listing it as `health:'ok'` would make the load silently skip the ref,
   * so each row is probed: a gone item is `missing`, an unreadable one is `unreadable`,
   * and both are reported through {@link problems}.
   */
  private scan(): {
    readonly items: readonly SecretRecordSummary[];
    readonly problems: readonly SecretRecordProblem[];
  } {
    const index = this.tryReadIndex();
    if (!index.ok) {
      return {
        items: [],
        problems: [{ path: this.paths.keychainIndex, code: index.code, message: index.message }],
      };
    }
    const items: SecretRecordSummary[] = [];
    const problems: SecretRecordProblem[] = [];
    for (const entry of index.index.entries) {
      const probe = this.run(SECURITY_BINARY, [
        'find-generic-password',
        '-a',
        entry.ref,
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
      ]);
      if (probe.status === 0) {
        items.push({
          ref: entry.ref,
          configured: true,
          updatedAt: entry.updatedAt,
          backend: this.backend,
          health: 'ok',
        });
        continue;
      }
      const missing = probe.status === SECURITY_NOT_FOUND;
      const code: SecretRepositoryErrorCode = missing
        ? 'SECRET_NOT_FOUND'
        : 'SECRET_KEYCHAIN_FAILED';
      const message = missing
        ? `the Keychain secret index lists ${entry.ref} but the Keychain has no such item`
        : `the Keychain could not read secret ${entry.ref} (status ${String(probe.status)})`;
      items.push({
        ref: entry.ref,
        configured: false,
        updatedAt: entry.updatedAt,
        backend: this.backend,
        health: missing ? 'missing' : 'unreadable',
        issue: { code, message },
      });
      problems.push({ path: this.paths.keychainIndex, code, message });
    }
    return { items: items.sort((left, right) => left.ref.localeCompare(right.ref)), problems };
  }

  private tryReadIndex():
    | { readonly ok: true; readonly index: KeychainIndex }
    | { readonly ok: false; readonly code: SecretRepositoryErrorCode; readonly message: string } {
    try {
      return { ok: true, index: this.readIndex() };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof SecretRepositoryError ? error.code : 'SECRET_RECORD_INVALID',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private readIndex(): KeychainIndex {
    const path = this.paths.keychainIndex;
    if (fileKind(path) === 'missing') return { v: RECORD_VERSION, entries: [] };
    enforcePrivateMode(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readPrivateFile(path, 'Keychain secret index'));
    } catch (error) {
      if (error instanceof SecretRepositoryError) throw error;
      throw new SecretRepositoryError(
        'SECRET_RECORD_INVALID',
        `the Keychain secret index ${path} is not valid JSON`,
      );
    }
    const index = parsed as Partial<KeychainIndex>;
    if (index.v !== RECORD_VERSION || !Array.isArray(index.entries)) {
      throw new SecretRepositoryError(
        'SECRET_RECORD_INVALID',
        `the Keychain secret index ${path} does not match the contract`,
      );
    }
    return { v: RECORD_VERSION, entries: index.entries };
  }

  private writeIndex(entries: readonly KeychainIndexEntry[]): void {
    for (const dir of [this.paths.dir, this.paths.keychainDir]) {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      chmodSync(dir, DIR_MODE);
    }
    assertReplaceable(this.paths.keychainIndex, 'Keychain secret index');
    writePrivateFile(
      this.paths.keychainIndex,
      `${JSON.stringify({ v: RECORD_VERSION, entries }, null, 2)}\n`,
    );
  }
}

/** The production runner: `spawnSync` with an argv array, never a shell string. */
function defaultCommandRunner(command: string, args: readonly string[]): SecretCommandResult {
  const result = spawnSync(command, [...args], { encoding: 'utf8', windowsHide: true });
  return {
    // A missing binary reports `status: null` with `error` set; both are failures.
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ---------------------------------------------------------------------------
// Validation, no-follow reads and parsing
// ---------------------------------------------------------------------------

/**
 * Validates a ref against **both** bounds the store enforces (W12T1-03).
 *
 * `isValidSecretRef` only covers the ref shape; `SecretStore.put` additionally bounds the
 * derived environment variable name. Checking both here, before any write, is what keeps
 * a refused `set` free of side effects.
 */
function assertRef(ref: string): void {
  if (!isValidSecretRef(ref)) {
    throw new SecretRepositoryError(
      'SECRET_VALUE_INVALID',
      'a secret ref must be 1–128 printable characters without whitespace',
    );
  }
  if (secretEnvName(ref).length > MAX_SECRET_ENV_NAME_LENGTH) {
    throw new SecretRepositoryError(
      'SECRET_VALUE_INVALID',
      `secret ref ${ref} derives an environment variable name longer than ${String(MAX_SECRET_ENV_NAME_LENGTH)} characters`,
    );
  }
}

function assertValue(value: string): void {
  if (value.length === 0 || value.length > MAX_VALUE_LENGTH || value.includes('\0')) {
    throw new SecretRepositoryError(
      'SECRET_VALUE_INVALID',
      `a secret value must be non-empty, free of NUL and shorter than ${String(MAX_VALUE_LENGTH)} bytes`,
    );
  }
}

/** What a path is, without following a symbolic link. */
function fileKind(path: string): 'missing' | 'file' | 'directory' | 'other' {
  try {
    const info = lstatSync(path);
    if (info.isFile()) return 'file';
    return info.isDirectory() ? 'directory' : 'other';
  } catch {
    return 'missing';
  }
}

/** Refuses to write over a symlink, directory or other non-regular file. */
function assertReplaceable(path: string, what: string): void {
  if (fileKind(path) === 'other' || fileKind(path) === 'directory') {
    throw new SecretRepositoryError(
      'SECRET_RECORD_INVALID',
      `the ${what} ${path} is not a regular file`,
    );
  }
}

/** Reads one private file, refusing a symlink even if it appeared since the check. */
function readPrivateFile(path: string, what: string): string {
  if (fileKind(path) !== 'file') {
    throw new SecretRepositoryError(
      'SECRET_RECORD_INVALID',
      `the ${what} ${path} is not a regular file`,
    );
  }
  let fd: number;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | NO_FOLLOW);
  } catch {
    throw new SecretRepositoryError(
      'SECRET_RECORD_INVALID',
      `the ${what} ${path} cannot be opened without following a symbolic link`,
    );
  }
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/** Repairs the mode of one record and reads it without following a symlink. */
function readRecord(path: string): string {
  if (fileKind(path) !== 'file') {
    throw new SecretRepositoryError(
      'SECRET_RECORD_INVALID',
      `the secret record ${path} is not a regular file`,
    );
  }
  enforcePrivateMode(path);
  return readPrivateFile(path, 'secret record');
}

/** `security -g` prints a non-printable value as `password: 0x<hex>`; printable data is quoted. */
const KEYCHAIN_PASSWORD_HEX_LINE = /^password: (0x[0-9A-Fa-f]+)/m;

/**
 * Whether a `security -w` answer could be either the value or the hex encoding of the value.
 *
 * `security` only hex-encodes data holding a byte outside printable ASCII, and such an
 * encoding is always an even-length run of hex digits — the same shape a printable ASCII
 * value made only of `[0-9a-f]` produces, which is why `-g` decides the ambiguous case.
 */
function isHexEncodedLooking(text: string): boolean {
  return text.length > 0 && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text);
}

/** Strips the one trailing newline `security -w` appends; keeps every other byte. */
function stripOneTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** Parses one ciphertext record; a corrupt record is typed, never silently skipped. */
function parseEnvelope(text: string, path: string): FileRecordEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SecretRepositoryError(
      'SECRET_RECORD_INVALID',
      `the secret record ${path} is not valid JSON`,
    );
  }
  const record = parsed as Partial<FileRecordEnvelope>;
  if (
    record.v !== RECORD_VERSION ||
    typeof record.ref !== 'string' ||
    record.algorithm !== 'aes-256-gcm' ||
    typeof record.iv !== 'string' ||
    typeof record.tag !== 'string' ||
    typeof record.ciphertext !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    throw new SecretRepositoryError(
      'SECRET_RECORD_INVALID',
      `the secret record ${path} does not match the contract`,
    );
  }
  return record as FileRecordEnvelope;
}

function toProblem(path: string, error: unknown): SecretRecordProblem {
  return {
    path,
    code: error instanceof SecretRepositoryError ? error.code : 'SECRET_RECORD_INVALID',
    message: error instanceof Error ? error.message : String(error),
  };
}

function toIssue(error: unknown): SecretRecordIssue {
  return {
    code: error instanceof SecretRepositoryError ? error.code : 'SECRET_DECRYPT_FAILED',
    message: error instanceof Error ? error.message : 'the record is not readable',
  };
}
