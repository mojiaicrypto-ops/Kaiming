/**
 * The portable Requirement pool (`docs/product/requirements.md` §1–§6,
 * `docs/architecture/data.md` §2, `docs/delivery/acceptance.md` AC-087/088/092/093).
 *
 * Requirement facts live in `.agentdev/requirements/<requirement-id>/` as two
 * files — `requirement.json` (metadata) and `content.md` (body) — which share one
 * `version` and publish in one Git commit. The pool README is a rebuildable
 * navigation index and is never an import source. Nothing here is inferred from
 * prose: the JSON owns state and references, the body explains them, and the list
 * operation needs no model call at all.
 *
 * Three properties drive the design:
 *
 * - **Recomputable integrity.** `metadataHash` is the hash of the *actual* JSON
 *   file bytes, `contentHash` the hash of the normalized body bytes, and the
 *   combined `recordHash` is what idempotency and conflict detection compare
 *   (`requirements.md` §6). A record is either fully consistent or diagnosed.
 * - **No silent repair.** A missing file, a hash mismatch, a version mismatch, a
 *   malformed JSON, a duplicate id, a legacy location or an ignored Git path is
 *   reported one issue per record; nothing is deleted, blank-filled or
 *   overwritten. Valid records stay usable next to broken ones, so one bad
 *   directory cannot hide the rest of the pool.
 * - **Local state is a projection.** `importRequirementPool` may only write when
 *   the incoming record is strictly newer *and* the Git revision the records were
 *   read from matches the revision the projection was built from. A pull that
 *   moved Git while the projection is stale is refused per record
 *   (`REQUIREMENT_CONFLICT`) instead of overwriting local work.
 *
 * All parsing/validation entry points return explicit result objects
 * (`{ok:true,…} | {ok:false, errors:[…], records:[…]}`) and never throw for
 * malformed input. `ok:false` still carries the records that validated, so a
 * caller can list the readable pool while showing the diagnostics.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  portableRequirementSchema,
  requirementMetadataSchema,
  type ErrorCode,
  type PortableRequirement,
  type RequirementMetadata,
  type RequirementState,
} from '@agentdev/contracts';

/** Repository root directory of the pool (`requirements.md` §1). */
export const REQUIREMENTS_ROOT = '.agentdev/requirements';
/** Rebuildable navigation index; never an import source. */
export const REQUIREMENTS_README = `${REQUIREMENTS_ROOT}/README.md`;
/** Fixed metadata file name inside a record directory. */
export const REQUIREMENT_METADATA_FILE = 'requirement.json';
/** Fixed body file name; `contentFile` in the JSON is the literal same value. */
export const REQUIREMENT_CONTENT_FILE = 'content.md';
/**
 * Legacy single-JSON layout (`requirements.md` §6): records that used to live as
 * `document-root/requirements/<id>.json`. There is no automatic migration —
 * `LEGACY_REQUIREMENT_FORMAT` demands an explicit, validated conversion.
 */
export const LEGACY_REQUIREMENTS_DIR = 'requirements';

/** Document-root searched for the legacy `requirements/<id>.json` layout. */
export const DEFAULT_LEGACY_DOCUMENT_ROOT = 'docs/agentdev';

/** Literal shown when a Git record arrived without its original detailed evidence. */
export const EVIDENCE_NOT_MIGRATED = '详细证据未迁移';

/** Git revision stamped on records parsed from an in-memory (uncommitted) pool. */
export const WORKING_TREE_REVISION = 'working-tree';

/** One per-record (or pool-level) diagnostic. */
export interface RequirementPoolIssue {
  /** One of the requirement codes of `contracts.ERROR_CODES`. */
  readonly code: ErrorCode;
  /** Human-readable explanation naming the offending field or file. */
  readonly message: string;
  /** Requirement id the issue belongs to; absent for pool-level issues. */
  readonly requirementId?: string;
  /** Pool-relative path of the file or directory the issue is about. */
  readonly path?: string;
}

/**
 * One record directory as read from disk (or assembled in memory before writing).
 *
 * `directoryName` is the on-disk directory name: it must equal the record `id`
 * (`requirements.md` §6), and it is what a duplicate-id diagnostic reports.
 */
export interface RequirementPoolRecordInput {
  readonly directoryName: string;
  /** Raw `requirement.json` bytes exactly as stored; its hash is `metadataHash`. */
  readonly metadataJson: string;
  /** Raw `content.md` bytes exactly as stored; normalized to LF before hashing. */
  readonly contentMarkdown: string;
  /** Set only for a `LEGACY_REQUIREMENT_FORMAT` file; the format has no body. */
  readonly legacyPath?: string;
}

/** A validated record plus the hashes and provenance needed for import. */
export interface RequirementPoolRecord {
  readonly id: string;
  /** Repository-relative record directory. */
  readonly directoryPath: string;
  /** Repository-relative metadata path. */
  readonly metadataPath: string;
  /** Repository-relative body path. */
  readonly contentPath: string;
  /** Parsed `requirement.json`. */
  readonly metadata: RequirementMetadata;
  /** `content.md` as stored (BOM stripped, line endings normalized to LF). */
  readonly contentMarkdown: string;
  /** SHA256 of the raw `requirement.json` file bytes. */
  readonly metadataHash: string;
  /** SHA256 of the normalized `content.md` bytes. */
  readonly contentHash: string;
  /** Combined `recordHash` (`requirements.md` §6). */
  readonly recordHash: string;
  /** Git revision the record was read at; `working-tree` when uncommitted. */
  readonly revision: string;
}

/** The raw files a pool parse consumes, before any validation. */
export interface RequirementPoolInputFiles {
  /** Record directories with both required files present and readable. */
  readonly records: readonly RequirementPoolRecordInput[];
  /** Directories missing `requirement.json` or `content.md`. */
  readonly missing?: readonly RequirementPoolMissingFile[];
  /** `LEGACY_REQUIREMENT_FORMAT` files. */
  readonly legacy?: readonly RequirementPoolRecordInput[];
}

/** One missing required file inside a record directory. */
export interface RequirementPoolMissingFile {
  readonly directoryName: string;
  readonly file: typeof REQUIREMENT_METADATA_FILE | typeof REQUIREMENT_CONTENT_FILE;
}

export interface RequirementPoolSuccess {
  readonly ok: true;
  readonly pool: RequirementPool;
  /** The records that validated, in id order. */
  readonly records: readonly RequirementPoolRecord[];
  readonly errors: readonly [];
}

export interface RequirementPoolFailure {
  readonly ok: false;
  readonly pool: null;
  /**
   * Every valid record of the same read, so diagnostics never hide readable
   * requirements (`requirements.md` §4: 其他有效需求继续可见).
   */
  readonly records: readonly RequirementPoolRecord[];
  readonly errors: readonly RequirementPoolIssue[];
}

/** Result of parsing/validating a pool; both branches carry `records`. */
export type RequirementPoolResult = RequirementPoolSuccess | RequirementPoolFailure;

/** One validated pool plus its rebuildable navigation. */
export interface RequirementPool {
  /** Repository-relative pool root. */
  readonly rootPath: string;
  /** Git revision the records were read at. */
  readonly revision: string;
  /** Valid records, sorted by id. */
  readonly records: readonly RequirementPoolRecord[];
  /** Always rebuilt from `records`; the on-disk README is never trusted. */
  readonly readme: string;
  /** `true` when the on-disk README is missing or differs from `readme`. */
  readonly readmeOutOfDate: boolean;
  /** The on-disk README text, or `undefined` when it does not exist. */
  readonly storedReadme?: string;
  /** Repository-relative paths of `LEGACY_REQUIREMENT_FORMAT` files. */
  readonly legacyPaths: readonly string[];
}

export interface ReadRequirementPoolOptions {
  /** Repository root; the pool is `<repoRoot>/.agentdev/requirements`. */
  readonly repoRoot: string;
  /** Git revision the files were read at; defaults to `working-tree`. */
  readonly revision?: string;
  /** Document root used to find the legacy `requirements/<id>.json` layout. */
  readonly legacyDocumentRoot?: string;
}

/** Parses an already-read pool without touching the filesystem. */
export interface ParseRequirementPoolOptions {
  readonly revision?: string;
  readonly rootPath?: string;
  /** The on-disk README text, when it exists, for the out-of-date check. */
  readonly storedReadme?: string;
}

/** Local projection row the import compares against (`data.md` §2). */
export interface LocalRequirementRecord {
  readonly id: string;
  /** Local row `version`; independent of `recordVersion`, advanced by local changes. */
  readonly localVersion: number;
  /** Git record version last projected. */
  readonly recordVersion: number;
  /** Combined Git record hash last projected. */
  readonly recordHash: string;
  readonly title: string;
  readonly goal: string;
  readonly lifecycle: RequirementState;
  readonly previousLifecycle?: 'queued' | 'completed';
  readonly metadata: RequirementMetadata;
  readonly contentMarkdown: string;
  /** Git revision the row was projected from. */
  readonly sourceRevision: string;
  /** Repository-relative record directory. */
  readonly sourcePath: string;
  /** `true` when the original detail files were never migrated to this server. */
  readonly evidenceNotMigrated: boolean;
  readonly evidenceAvailability: 'full' | 'summary_only';
  /** Required for `active` + `local` rows (`data.md` §2). */
  readonly workId?: string;
}

/**
 * The local projection the import reads and extends.
 *
 * `revision` is the Git revision the projection was last built from; when it is
 * older than the revision the incoming records were read at, the projection is
 * stale and the import refuses to overwrite rows whose Git identity changed.
 */
export interface LocalRequirementState {
  readonly projectId: string;
  readonly revision: string;
  readonly records: readonly LocalRequirementRecord[];
  /** Local Work id bound to an `active` record, when a Work already exists. */
  readonly workIdByRequirementId?: Readonly<Record<string, string>>;
}

/** Per-record conflict report; a conflict blocks writes for that record only. */
export interface RequirementPoolConflict {
  readonly requirementId: string;
  /** Present unless the conflict came from an unreadable record. */
  readonly recordVersion?: number;
  /** Present unless the conflict came from an unreadable record. */
  readonly recordHash?: string;
  readonly localRecordVersion?: number;
  readonly localRecordHash?: string;
  /** Reason token the UI/protocol displays next to `REQUIREMENT_CONFLICT`. */
  readonly reason:
    | 'same_version_different_content'
    | 'incoming_version_older'
    | 'duplicate_id_in_batch'
    | 'record_unreadable'
    | 'stale_projection';
  readonly message: string;
}

/** One imported record's outcome. */
export interface AppliedRequirementRecord {
  readonly requirementId: string;
  readonly verdict: 'created' | 'updated' | 'unchanged';
  readonly recordVersion: number;
  readonly recordHash: string;
  /** Local row version after the verdict; unchanged verdicts keep the prior value. */
  readonly localVersion: number;
  readonly record: LocalRequirementRecord;
}

export interface SkippedRequirementRecord {
  readonly requirementId: string;
  readonly reason: 'conflict';
}

export interface ImportRequirementPoolOptions {
  /** Validated Git records; unreadable records are reported, never imported. */
  readonly records: readonly RequirementPoolRecord[];
  readonly local: LocalRequirementState;
  /**
   * Requirement ids whose pool directory failed validation (missing file, hash
   * mismatch, malformed JSON, legacy location, ignored path). `requirements.md`
   * §4 requires a conflict, not a silent drop, whenever a local row exists.
   */
  readonly unresolvedIds?: readonly string[];
  /** Set only after the caller verified the two files are committed to Git. */
  readonly commit?: boolean;
}

/** Outcome of one import. */
export interface ImportRequirementPoolResult {
  readonly imported: readonly AppliedRequirementRecord[];
  /** Conflicts keyed by requirement id, so a repeated import does not accumulate. */
  readonly conflicts: readonly RequirementPoolConflict[];
  readonly skipped: readonly SkippedRequirementRecord[];
  /** The projection after the import; a refused record keeps its prior row. */
  readonly state: LocalRequirementState;
  readonly summary: {
    readonly received: number;
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly conflicts: number;
    readonly skipped: number;
  };
}

/** SHA256 of the UTF-8 bytes of `input` (`data.md` §1). */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Normalizes line endings to LF and strips a leading BOM (`requirements.md` §6). */
export function normalizeContentMarkdown(markdown: string): string {
  return markdown.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

/**
 * The combined record hash (`requirements.md` §6): SHA256 over
 * `requirement.json\0<metadataHash>\ncontent.md\0<contentHash>\n`.
 *
 * The same formula as `@agentdev/storage`'s `requirementRecordHash`; duplicated
 * here because the knowledge package must not depend on storage.
 */
export function requirementRecordHash(metadataHash: string, contentHash: string): string {
  return sha256Hex(`requirement.json\u0000${metadataHash}\ncontent.md\u0000${contentHash}\n`);
}

/** `true` when `value` is a lowercase UUIDv7, the only legal Requirement id form. */
export function isRequirementId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

/**
 * Reads the record version `content.md` mirrors in its version marker.
 *
 * The marker is an HTML comment — `<!-- record-version: 3 -->` — so the body stays
 * plain Markdown (`requirements.md` §6). It is optional in v1; when present it
 * must equal the JSON `version`, which is how a half-updated pair (new body, old
 * metadata) is caught. A missing marker is not an error.
 */
export function readContentVersion(markdown: string): number | undefined {
  const match = /<!--\s*record-version:\s*(\d+)\s*-->/u.exec(markdown);
  if (match === null) return undefined;
  return Number.parseInt(match[1] ?? '', 10);
}

function issue(
  code: ErrorCode,
  message: string,
  extras: { readonly requirementId?: string; readonly path?: string } = {},
): RequirementPoolIssue {
  return {
    code,
    message,
    ...(extras.requirementId === undefined ? {} : { requirementId: extras.requirementId }),
    ...(extras.path === undefined ? {} : { path: extras.path }),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function missingFileIssue(
  missing: RequirementPoolMissingFile,
  rootPath: string,
): RequirementPoolIssue {
  const path = `${rootPath}/${missing.directoryName}/${missing.file}`;
  return issue(
    'REQUIREMENT_CONFLICT',
    `${path} is missing; a Requirement directory needs both ${REQUIREMENT_METADATA_FILE} and ${REQUIREMENT_CONTENT_FILE}`,
    { requirementId: missing.directoryName, path },
  );
}

/**
 * Parses and validates one already-read record pair.
 *
 * Every problem is returned as a `REQUIREMENT_CONFLICT` issue; nothing is
 * repaired. The checks, in order: JSON syntax, `RequirementMetadata` schema,
 * UUIDv7 id, directory-name/id equality, `contentFile`, body version marker, body
 * hash, and a non-empty body.
 */
export function parseRequirementRecordInput(
  input: RequirementPoolRecordInput,
  revision: string = WORKING_TREE_REVISION,
):
  | { readonly record: RequirementPoolRecord }
  | { readonly errors: readonly RequirementPoolIssue[] } {
  const directoryPath = `${REQUIREMENTS_ROOT}/${input.directoryName}`;
  const metadataPath = `${directoryPath}/${REQUIREMENT_METADATA_FILE}`;
  const contentPath = `${directoryPath}/${REQUIREMENT_CONTENT_FILE}`;
  const metadataJson = input.metadataJson.replace(/^\uFEFF/u, '');
  const contentMarkdown = normalizeContentMarkdown(input.contentMarkdown);
  const errors: RequirementPoolIssue[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(metadataJson) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      errors: [
        issue('REQUIREMENT_CONFLICT', `${metadataPath} is not valid JSON: ${detail}`, {
          path: metadataPath,
        }),
      ],
    };
  }

  const parsed = requirementMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((item) => `${item.path.join('.') || '(root)'}: ${item.message}`)
      .join('; ');
    return {
      errors: [
        issue(
          'REQUIREMENT_CONFLICT',
          `${metadataPath} violates the RequirementMetadata schema: ${detail}`,
          { path: metadataPath },
        ),
      ],
    };
  }
  const metadata = parsed.data;
  const id = metadata.id;

  if (!isRequirementId(id)) {
    errors.push(
      issue('REQUIREMENT_CONFLICT', `${metadataPath} id must be a lowercase UUIDv7: ${id}`, {
        requirementId: id,
        path: metadataPath,
      }),
    );
  }
  if (input.directoryName !== id) {
    errors.push(
      issue(
        'REQUIREMENT_CONFLICT',
        `directory name ${input.directoryName} must equal the record id ${id} (${directoryPath})`,
        { requirementId: id, path: directoryPath },
      ),
    );
  }
  const contentVersion = readContentVersion(contentMarkdown);
  if (contentVersion !== undefined && contentVersion !== metadata.version) {
    errors.push(
      issue(
        'REQUIREMENT_CONFLICT',
        `${contentPath} declares record-version ${contentVersion} but ${metadataPath} declares version ${metadata.version}; both files must share one version`,
        { requirementId: id, path: contentPath },
      ),
    );
  }

  const contentHash = sha256Hex(contentMarkdown);
  if (metadata.contentHash !== contentHash) {
    errors.push(
      issue(
        'REQUIREMENT_CONFLICT',
        `${metadataPath} contentHash ${metadata.contentHash} does not match ${contentPath} hash ${contentHash}`,
        { requirementId: id, path: contentPath },
      ),
    );
  }

  if (contentMarkdown.trim() === '') {
    errors.push(
      issue('REQUIREMENT_CONFLICT', `${contentPath} must not be empty`, {
        requirementId: id,
        path: contentPath,
      }),
    );
  }

  if (errors.length > 0) return { errors };

  const metadataHash = sha256Hex(metadataJson);
  return {
    record: {
      id,
      directoryPath,
      metadataPath,
      contentPath,
      metadata,
      contentMarkdown,
      metadataHash,
      contentHash,
      recordHash: requirementRecordHash(metadataHash, contentHash),
      revision,
    },
  };
}

/**
 * Validates already-read pool files and builds the pool.
 *
 * This is the pure core: it never touches the filesystem, so a caller that
 * already holds the bytes (a Git object store, or the save path) reuses the exact
 * same rules. Malformed records are reported one by one and the valid records are
 * still returned in id order.
 */
export function parseRequirementPoolInput(
  files: RequirementPoolInputFiles,
  options: ParseRequirementPoolOptions = {},
): RequirementPoolResult {
  const revision = options.revision ?? WORKING_TREE_REVISION;
  const rootPath = options.rootPath ?? REQUIREMENTS_ROOT;
  const errors: RequirementPoolIssue[] = [];
  const parsed: RequirementPoolRecord[] = [];
  const legacyPaths: string[] = [];

  for (const missing of files.missing ?? []) {
    errors.push(missingFileIssue(missing, rootPath));
  }

  for (const legacy of files.legacy ?? []) {
    const path =
      legacy.legacyPath ?? `${rootPath}/${legacy.directoryName}/${REQUIREMENT_METADATA_FILE}`;
    legacyPaths.push(path);
    errors.push(
      issue(
        'LEGACY_REQUIREMENT_FORMAT',
        `${path} uses the pre-pool single-JSON format; convert it explicitly and validate before importing (no automatic migration)`,
        { path },
      ),
    );
  }

  for (const input of files.records) {
    const result = parseRequirementRecordInput(input, revision);
    if ('errors' in result) errors.push(...result.errors);
    else parsed.push(result.record);
  }

  const byId = new Map<string, RequirementPoolRecord[]>();
  for (const record of parsed) {
    const list = byId.get(record.id);
    if (list === undefined) byId.set(record.id, [record]);
    else list.push(record);
  }
  const unique: RequirementPoolRecord[] = [];
  const duplicates: RequirementPoolRecord[] = [];
  for (const record of parsed) {
    const list = byId.get(record.id) ?? [];
    if (list.length > 1) duplicates.push(record);
    else unique.push(record);
  }
  for (const id of [...new Set(duplicates.map((record) => record.id))].sort(compareText)) {
    const paths = (byId.get(id) ?? []).map((item) => item.directoryPath);
    for (const record of duplicates.filter((item) => item.id === id)) {
      errors.push(
        issue(
          'REQUIREMENT_CONFLICT',
          `duplicate requirement id ${id} appears in ${paths.join(', ')}`,
          { requirementId: id, path: record.directoryPath },
        ),
      );
    }
  }

  const records = [...unique].sort((left, right) => compareText(left.id, right.id));
  const readme = rebuildPoolReadme(records);
  const storedReadme = options.storedReadme;
  const pool: RequirementPool = {
    rootPath,
    revision,
    records,
    readme,
    readmeOutOfDate: storedReadme !== readme,
    ...(storedReadme === undefined ? {} : { storedReadme }),
    legacyPaths,
  };
  if (errors.length > 0) return { ok: false, pool: null, records, errors };
  return { ok: true, pool, records, errors: [] };
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDirectory(path: string): readonly string[] {
  try {
    return readdirSync(path).sort(compareText);
  } catch {
    return [];
  }
}

interface ReadPoolFilesResult {
  readonly files: RequirementPoolInputFiles;
  /** Pool-level issues found while reading (ignored paths, for instance). */
  readonly errors: readonly RequirementPoolIssue[];
  readonly storedReadme?: string;
}

/** Reads the filesystem snapshot a `parseRequirementPoolInput` call needs. */
function readPoolFiles(options: ReadRequirementPoolOptions): ReadPoolFilesResult {
  const records: RequirementPoolRecordInput[] = [];
  const missing: RequirementPoolMissingFile[] = [];
  const legacy: RequirementPoolRecordInput[] = [];
  const errors: RequirementPoolIssue[] = [];
  const poolRoot = join(options.repoRoot, REQUIREMENTS_ROOT);
  const ignored = isPathIgnored(options.repoRoot, REQUIREMENTS_ROOT);

  // `requirements.md` §1: the directory must be tracked and must not be swallowed
  // by a wholesale `.agentdev` ignore rule.
  if (ignored) {
    errors.push(
      issue(
        'REQUIREMENT_PATH_IGNORED',
        `${REQUIREMENTS_ROOT} is ignored by Git; un-ignore it (.agentdev must not be ignored wholesale) so requirements survive a clone`,
        { path: REQUIREMENTS_ROOT },
      ),
    );
  }

  for (const entryName of listDirectory(poolRoot)) {
    const entry = join(poolRoot, entryName);
    // A bare `<id>.json` at the pool root is the legacy single-JSON layout.
    if (!isDirectory(entry)) {
      if (entryName.endsWith('.json') && !entryName.endsWith(REQUIREMENT_METADATA_FILE)) {
        legacy.push({
          directoryName: entryName.slice(0, -'.json'.length),
          metadataJson: readText(entry),
          contentMarkdown: '',
          legacyPath: `${REQUIREMENTS_ROOT}/${entryName}`,
        });
      }
      continue;
    }
    const directoryName = entryName;
    const directory = entry;
    const metadataPath = join(directory, REQUIREMENT_METADATA_FILE);
    const contentPath = join(directory, REQUIREMENT_CONTENT_FILE);
    const directoryPath = `${REQUIREMENTS_ROOT}/${directoryName}`;

    // A directory holding only `<id>.json` is a legacy pre-pool location too.
    const legacyCandidate = join(directory, `${directoryName}.json`);
    if (!isRegularFile(metadataPath) && isRegularFile(legacyCandidate)) {
      legacy.push({
        directoryName,
        metadataJson: readText(legacyCandidate),
        contentMarkdown: '',
        legacyPath: `${directoryPath}/${directoryName}.json`,
      });
      continue;
    }

    if (!isRegularFile(metadataPath))
      missing.push({ directoryName, file: REQUIREMENT_METADATA_FILE });
    if (!isRegularFile(contentPath))
      missing.push({ directoryName, file: REQUIREMENT_CONTENT_FILE });
    if (!isRegularFile(metadataPath) || !isRegularFile(contentPath)) {
      if (isPathIgnored(options.repoRoot, directoryPath)) {
        errors.push(
          issue(
            'REQUIREMENT_PATH_IGNORED',
            `${directoryPath} is ignored by Git; un-ignore the requirements directory so saved requirements can be cloned`,
            { requirementId: directoryName, path: directoryPath },
          ),
        );
      }
      continue;
    }

    records.push({
      directoryName,
      metadataJson: readText(metadataPath),
      contentMarkdown: readText(contentPath),
    });
  }

  // The legacy layout lived under the document root (`requirements.md` §6).
  const legacyDocumentRoot = options.legacyDocumentRoot ?? DEFAULT_LEGACY_DOCUMENT_ROOT;
  const legacyDirectory = join(options.repoRoot, legacyDocumentRoot, LEGACY_REQUIREMENTS_DIR);
  for (const fileName of listDirectory(legacyDirectory)) {
    if (!fileName.endsWith('.json')) continue;
    const path = `${legacyDocumentRoot}/${LEGACY_REQUIREMENTS_DIR}/${fileName}`;
    legacy.push({
      directoryName: fileName.slice(0, -'.json'.length),
      metadataJson: readText(join(legacyDirectory, fileName)),
      contentMarkdown: '',
      legacyPath: path,
    });
  }

  const readmePath = join(options.repoRoot, REQUIREMENTS_README);
  const storedReadme = isRegularFile(readmePath) ? readText(readmePath) : undefined;
  return {
    files: { records, missing, legacy },
    errors,
    ...(storedReadme === undefined ? {} : { storedReadme }),
  };
}

/**
 * Reads, validates and rebuilds one pool directory (`AC-087`, `AC-093`).
 *
 * Layout: `<repoRoot>/.agentdev/requirements/README.md` plus one directory per
 * record. The README is recreated from the records; a missing or stale README is
 * reported through `pool.readmeOutOfDate` and never blocks a valid import. Every
 * other problem is one issue per record, and the valid records remain in
 * `records`.
 */
export function parseRequirementPool(options: ReadRequirementPoolOptions): RequirementPoolResult {
  const read = readPoolFiles(options);
  const parsed = parseRequirementPoolInput(read.files, {
    revision: options.revision ?? WORKING_TREE_REVISION,
    rootPath: REQUIREMENTS_ROOT,
    ...(read.storedReadme === undefined ? {} : { storedReadme: read.storedReadme }),
  });
  if (read.errors.length === 0) return parsed;
  return {
    ok: false,
    pool: null,
    records: parsed.records,
    errors: [...read.errors, ...parsed.errors],
  };
}

/**
 * Asks the real Git for the ignore verdict, so a `.gitignore` case the rule
 * matcher does not model cannot silently pass (`AC-093`, `REQUIREMENT_PATH_IGNORED`).
 */
export function isPathIgnored(repoRoot: string, relativePath: string): boolean {
  if (!existsSync(join(repoRoot, '.git'))) return false;
  try {
    execFileSync('git', ['-C', repoRoot, 'check-ignore', '--quiet', '--', relativePath], {
      stdio: 'ignore',
    });
    return true;
  } catch (error: unknown) {
    const status = (error as { status?: number | null }).status;
    // `check-ignore` exits 1 for "not ignored"; anything else means Git could not
    // answer, so fall back to the rule matcher rather than assume it is tracked.
    if (status === 1) return false;
    return isIgnoredByRules(repoRoot, relativePath);
  }
}

/**
 * Applies the `.gitignore` rules of `repoRoot` to `relativePath`.
 *
 * A self-contained matcher for callers that must not shell out. A path is ignored
 * when a pattern matches it or any of its ancestor directories and no deeper
 * negation takes it back, which mirrors `git check-ignore` for the pool's paths.
 */
export function isIgnoredByRules(repoRoot: string, relativePath: string): boolean {
  const rules: string[] = [];
  const rootIgnore = join(repoRoot, '.gitignore');
  if (isRegularFile(rootIgnore)) rules.push(...readText(rootIgnore).split('\n'));
  const parts = relativePath.split('/');
  for (let depth = 1; depth < parts.length; depth += 1) {
    const nested = join(repoRoot, ...parts.slice(0, depth), '.gitignore');
    if (isRegularFile(nested)) rules.push(...readText(nested).split('\n'));
  }
  let ignored = false;
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const candidate = parts.slice(0, depth).join('/');
    const candidateIsDirectory = depth < parts.length;
    for (const rule of rules) {
      const verdict = matchIgnoreRule(rule, candidate, candidateIsDirectory);
      if (verdict !== undefined) ignored = verdict;
    }
  }
  return ignored;
}

/**
 * Applies one gitignore line to one candidate path.
 *
 * Returns `true` (ignored), `false` (re-included by `!`), or `undefined` when the
 * rule does not apply.
 */
function matchIgnoreRule(
  rule: string,
  candidate: string,
  candidateIsDirectory: boolean,
): boolean | undefined {
  let body = rule.trim();
  if (body === '' || body.startsWith('#')) return undefined;
  const negated = body.startsWith('!');
  if (negated) body = body.slice(1);
  const directoryOnly = body.endsWith('/');
  if (directoryOnly) {
    if (!candidateIsDirectory) return undefined;
    body = body.replace(/\/+$/u, '');
  }
  if (body === '') return undefined;
  let anchored = false;
  if (body.startsWith('/')) {
    anchored = true;
    body = body.replace(/^\/+/u, '');
  } else if (body.slice(0, -1).includes('/')) {
    anchored = true;
  }
  const names = candidate.split('/');
  const limit = anchored ? 1 : names.length;
  for (let start = 0; start < limit; start += 1) {
    const slice = names.slice(start).join('/');
    if (globToRegExp(body).test(slice)) {
      if (directoryOnly && start === names.length - 1 && !candidateIsDirectory) continue;
      return negated ? false : true;
    }
  }
  return undefined;
}

/** Translates a gitignore glob (`*`, `?`, `**`, `[...]`) into a RegExp. */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? '';
    if (char === '*') {
      if (glob[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '[') {
      const close = glob.indexOf(']', index + 1);
      if (close === -1) {
        source += '\\[';
        continue;
      }
      source += glob.slice(index, close + 1);
      index = close;
      continue;
    }
    source += char.replace(/[.+^${}()|\\]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

/** Renders the pool README from the records; the index is always recreatable. */
export function rebuildPoolReadme(records: readonly RequirementPoolRecord[]): string {
  const lines = [
    '# 需求池索引',
    '',
    '> 本文件由需求记录重建，不作为导入依据；需求事实以各目录的 requirement.json 与 content.md 为准。',
    '',
  ];
  if (records.length === 0) {
    lines.push('需求池为空。', '');
    return lines.join('\n');
  }
  lines.push('| requirement_id | 标题 | 状态 | 正文 |', '|---|---|---|---|');
  for (const record of records) {
    lines.push(
      `| ${cell(record.id)} | ${cell(record.metadata.title)} | ${cell(record.metadata.lifecycle)} | [content.md](${record.id}/${REQUIREMENT_CONTENT_FILE}) |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Escapes a table cell so a pipe cannot end it and a newline cannot end the row. */
function cell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ').trim();
}

/** Repository-relative directory of one record (`requirements.md` §1). */
export function requirementRecordDirectory(id: string): string {
  return `${REQUIREMENTS_ROOT}/${id}`;
}

/**
 * Reads and normalizes an already-parsed `requirement.json` value; the write path
 * uses it to validate metadata before serializing a pool directory.
 */
export function parseRequirementMetadata(input: unknown): RequirementMetadata | undefined {
  const parsed = requirementMetadataSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

/** Validates a full `PortableRequirement` (metadata plus body), or `undefined`. */
export function parsePortableRequirement(input: unknown): PortableRequirement | undefined {
  const parsed = portableRequirementSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

/** A `PortableRequirement` as it would be written; `contentMarkdown` is the body. */
export function portableRequirementOf(record: RequirementPoolRecord): PortableRequirement {
  return { ...record.metadata, contentMarkdown: record.contentMarkdown };
}

type ImportVerdict = 'new' | 'unchanged' | 'update' | 'conflict';

/**
 * Mirrors `domain.classifyImport`: identity is `recordVersion` + `recordHash`,
 * never the local row `version` (`data.md` §2).
 */
function classifyIncoming(
  local: LocalRequirementRecord | undefined,
  record: RequirementPoolRecord,
): ImportVerdict {
  if (local === undefined) return 'new';
  if (local.recordVersion === record.metadata.version) {
    return local.recordHash === record.recordHash ? 'unchanged' : 'conflict';
  }
  return record.metadata.version > local.recordVersion ? 'update' : 'conflict';
}

function conflictFor(
  local: LocalRequirementRecord,
  record: RequirementPoolRecord,
): RequirementPoolConflict {
  const sameVersion = local.recordVersion === record.metadata.version;
  return {
    requirementId: record.id,
    recordVersion: record.metadata.version,
    recordHash: record.recordHash,
    localRecordVersion: local.recordVersion,
    localRecordHash: local.recordHash,
    reason: sameVersion ? 'same_version_different_content' : 'incoming_version_older',
    message: sameVersion
      ? `requirement ${record.id} has recordVersion ${record.metadata.version} with different content (local ${local.recordHash}, incoming ${record.recordHash})`
      : `requirement ${record.id} incoming recordVersion ${record.metadata.version} is older than the local projection ${local.recordVersion}`,
  };
}

function buildLocalRecord(
  record: RequirementPoolRecord,
  local: LocalRequirementRecord | undefined,
  workId: string | undefined,
  committed: boolean,
): LocalRequirementRecord {
  const metadata = record.metadata;
  const boundWorkId = workId ?? local?.workId;
  return {
    id: record.id,
    localVersion: (local?.localVersion ?? 0) + 1,
    recordVersion: metadata.version,
    recordHash: record.recordHash,
    title: metadata.title,
    goal: metadata.goal,
    lifecycle: metadata.lifecycle,
    ...(metadata.previousLifecycle === undefined
      ? {}
      : { previousLifecycle: metadata.previousLifecycle }),
    metadata,
    contentMarkdown: record.contentMarkdown,
    sourceRevision: committed ? record.revision : WORKING_TREE_REVISION,
    sourcePath: record.directoryPath,
    // `requirements.md` §5: the Git record carries the historical summary; the
    // original messages/Decisions/Review/Test artifacts did not travel with it, so
    // the detail is marked as not migrated and never counts as local evidence.
    evidenceNotMigrated: true,
    evidenceAvailability: 'summary_only',
    ...(boundWorkId === undefined ? {} : { workId: boundWorkId }),
  };
}

/**
 * Applies a validated pool to the local projection (`AC-087`, `AC-088`, `AC-092`).
 *
 * Rules, per record:
 *
 * - a local row with the same `recordVersion` and `recordHash` is `unchanged`, so
 *   importing the same pool twice leaves the state identical;
 * - a strictly newer `recordVersion` is `updated`, rebuilding the row fields while
 *   the local `version` stays its own counter;
 * - the same `recordVersion` with different content, or an older incoming version,
 *   is a `REQUIREMENT_CONFLICT` reported for that record only;
 * - a record listed in `unresolvedIds` is conflicted when a local row exists
 *   (`requirements.md` §4), and stays conflicted until Git is repaired and the
 *   record is explicitly re-imported;
 * - when Git moved past the projection (`local.revision` older than the records'
 *   revision), a changed record is refused with a `stale_projection` conflict
 *   instead of overwriting the local row. Unchanged records stay importable, so a
 *   repeated import is idempotent.
 *
 * The returned `state` is a new value; the caller persists it. No conflict is ever
 * silently dropped and no refused record is removed.
 */
export function importRequirementPool(
  options: ImportRequirementPoolOptions,
): ImportRequirementPoolResult {
  const localById = new Map(options.local.records.map((row) => [row.id, row]));
  const incomingIds = options.records.map((record) => record.id);
  const duplicateIds = new Set(
    incomingIds.filter((id, index) => incomingIds.indexOf(id) !== index),
  );
  const unresolved = new Set(options.unresolvedIds ?? []);

  const imported: AppliedRequirementRecord[] = [];
  const conflicts: RequirementPoolConflict[] = [];
  const skipped: SkippedRequirementRecord[] = [];
  const nextRows = new Map<string, LocalRequirementRecord>(localById);

  for (const record of options.records) {
    const local = localById.get(record.id);

    if (duplicateIds.has(record.id)) {
      conflicts.push({
        requirementId: record.id,
        recordVersion: record.metadata.version,
        recordHash: record.recordHash,
        reason: 'duplicate_id_in_batch',
        message: `requirement id ${record.id} appears more than once in the incoming pool; fix the duplicates in Git and re-import`,
      });
      skipped.push({ requirementId: record.id, reason: 'conflict' });
      continue;
    }
    const verdict = classifyIncoming(local, record);

    if (verdict === 'unchanged' && local !== undefined) {
      imported.push({
        requirementId: record.id,
        verdict: 'unchanged',
        recordVersion: record.metadata.version,
        recordHash: record.recordHash,
        localVersion: local.localVersion,
        record: local,
      });
      continue;
    }
    if (verdict === 'conflict' && local !== undefined) {
      conflicts.push(conflictFor(local, record));
      skipped.push({ requirementId: record.id, reason: 'conflict' });
      continue;
    }

    if (
      options.local.revision !== record.revision &&
      local !== undefined &&
      local.recordHash !== record.recordHash
    ) {
      conflicts.push({
        requirementId: record.id,
        recordVersion: record.metadata.version,
        recordHash: record.recordHash,
        localRecordVersion: local.recordVersion,
        localRecordHash: local.recordHash,
        reason: 'stale_projection',
        message: `projection is built from revision ${options.local.revision} but the records were read at ${record.revision}; refresh the projection and re-import instead of overwriting local requirement ${record.id}`,
      });
      skipped.push({ requirementId: record.id, reason: 'conflict' });
      continue;
    }

    const workId = options.local.workIdByRequirementId?.[record.id];
    const row = buildLocalRecord(record, local, workId, options.commit === true);
    nextRows.set(record.id, row);
    imported.push({
      requirementId: record.id,
      verdict: local === undefined ? 'created' : 'updated',
      recordVersion: record.metadata.version,
      recordHash: record.recordHash,
      localVersion: row.localVersion,
      record: row,
    });
  }

  // A local row whose Git record disappeared or is unreadable must not be dropped
  // silently (`requirements.md` §4): report it and keep the row.
  const readableIds = new Set(incomingIds);
  for (const row of options.local.records) {
    if (readableIds.has(row.id)) continue;
    if (!unresolved.has(row.id)) continue;
    conflicts.push({
      requirementId: row.id,
      localRecordVersion: row.recordVersion,
      localRecordHash: row.recordHash,
      reason: 'record_unreadable',
      message: `local requirement ${row.id} has no readable Git record (${row.sourcePath}); restore it in Git and re-import explicitly before the conflict can be cleared`,
    });
    skipped.push({ requirementId: row.id, reason: 'conflict' });
  }

  const advancedRevision = options.records[0]?.revision;
  const state: LocalRequirementState = {
    projectId: options.local.projectId,
    // Only a conflict-free import advances the projection revision; a refused
    // record must stay refused on the next attempt until Git is repaired.
    revision:
      conflicts.length === 0 && advancedRevision !== undefined
        ? advancedRevision
        : options.local.revision,
    records: [...nextRows.values()].sort((left, right) => compareText(left.id, right.id)),
    ...(options.local.workIdByRequirementId === undefined
      ? {}
      : { workIdByRequirementId: options.local.workIdByRequirementId }),
  };

  return {
    imported,
    conflicts,
    skipped,
    state,
    summary: {
      received: options.records.length,
      created: imported.filter((item) => item.verdict === 'created').length,
      updated: imported.filter((item) => item.verdict === 'updated').length,
      unchanged: imported.filter((item) => item.verdict === 'unchanged').length,
      conflicts: conflicts.length,
      skipped: skipped.length,
    },
  };
}

/**
 * The Git/code/feature references an imported completed/cancelled/archived record
 * exposes (`AC-088`), plus the explicit "detail not migrated" marker.
 */
export interface ImportedHistorySummary {
  readonly requirementId: string;
  readonly lifecycle: RequirementState;
  readonly title: string;
  readonly goal: string;
  /** Present exactly when the record (or its pre-archive state) completed. */
  readonly completion:
    | {
        readonly summary: string;
        readonly completedAt: string;
        readonly codeRevision: string;
        readonly codeTree: string;
        readonly featureIds: readonly string[];
        readonly verificationSummary: string;
        readonly remainingIssues: readonly string[];
      }
    | undefined;
  /** Present exactly for a cancelled record. */
  readonly cancellation: { readonly cancelledAt: string; readonly reason: string } | undefined;
  /** The lifecycle an archived record must be restored to. */
  readonly previousLifecycle: 'queued' | 'completed' | undefined;
  /** Git revision the summary points at, kept even when the code is gone. */
  readonly codeRevision: string | undefined;
  readonly featureIds: readonly string[];
  /** Literal `详细证据未迁移`; present whenever the detail files stayed local. */
  readonly evidenceNotice: typeof EVIDENCE_NOT_MIGRATED | undefined;
  /** `summary_only`: the summary is readable but is not local evidence. */
  readonly evidenceAvailability: 'full' | 'summary_only';
  /** Always `false`: a migrated summary must not pass a local verification gate. */
  readonly countsAsLocalVerification: false;
}

/**
 * Builds the display facts of an imported completed/cancelled/archived record.
 *
 * Returns `undefined` for a record with no historical state to show. The
 * completion summary, cancellation reason and pre-archive lifecycle survive an
 * import that brought no reports, while `countsAsLocalVerification` stays `false`
 * (`requirements.md` §5, `AC-088`).
 */
export function importedHistorySummary(
  row: Pick<
    LocalRequirementRecord,
    | 'id'
    | 'title'
    | 'goal'
    | 'lifecycle'
    | 'previousLifecycle'
    | 'metadata'
    | 'evidenceNotMigrated'
    | 'evidenceAvailability'
  >,
): ImportedHistorySummary | undefined {
  const historical =
    row.lifecycle === 'completed' || row.lifecycle === 'cancelled' || row.lifecycle === 'archived';
  if (!historical) return undefined;
  const completion = row.metadata.completion;
  const cancellation = row.metadata.cancellation;
  return {
    requirementId: row.id,
    lifecycle: row.lifecycle,
    title: row.title,
    goal: row.goal,
    completion:
      completion === undefined
        ? undefined
        : {
            summary: completion.summary,
            completedAt: completion.completedAt,
            codeRevision: completion.codeRevision,
            codeTree: completion.codeTree,
            featureIds: [...completion.featureIds],
            verificationSummary: completion.verificationSummary,
            remainingIssues: [...completion.remainingIssues],
          },
    cancellation:
      cancellation === undefined
        ? undefined
        : { cancelledAt: cancellation.cancelledAt, reason: cancellation.reason },
    previousLifecycle: row.previousLifecycle,
    codeRevision: completion?.codeRevision,
    featureIds: completion === undefined ? [] : [...completion.featureIds],
    evidenceNotice: row.evidenceNotMigrated ? EVIDENCE_NOT_MIGRATED : undefined,
    evidenceAvailability: row.evidenceAvailability,
    countsAsLocalVerification: false,
  };
}
