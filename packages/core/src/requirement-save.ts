/**
 * Immediate Git persistence of Requirement facts (`docs/product/requirements.md`
 * §1–§6, `docs/architecture/reliability.md` §4/§5/§9, AC-090/AC-091/AC-093).
 *
 * A saved Requirement is **two files** that share one `version` and one combined
 * `recordHash` (`requirements.md` §6): `.agentdev/requirements/<id>/requirement.json`
 * and `.../content.md`, plus the rebuildable pool `README.md`. This module owns the
 * whole documented save path and nothing else:
 *
 * - **One integration lock per Project.** `reliability.md` §4 fixes a single
 *   `integration:<projectId>` mutex for final integration, and §9 puts requirement
 *   saving under the same lock. `ProjectIntegrationLock` is that mutex: a
 *   requirement save and a code-delivery integration can never run at once, and a
 *   save that lost the race is refused with `BUSY` instead of overwriting Git.
 * - **The commit is written in a throw-away worktree, the branch moves by CAS.**
 *   Writing on the delivery branch would move it before the compare-and-swap, so
 *   the record is committed in a detached `git worktree` at the expected baseline
 *   and only then installed with `git update-ref <ref> <new> <expected>`
 *   (`reliability.md` §4 step 8, implemented by `@agentdev/workspace`).
 * - **Git and the projection must agree before `saved` is reported.** On a Git or
 *   projection failure the outcome carries the `requirement.save.retry` operation
 *   (`reliability.md` §9 "失败标save_failed并保留操作"). When Git already holds the
 *   commit, the retry repairs only the local projection and creates no second
 *   commit (`AC-090`).
 * - **A stale projection never overwrites Git.** `reliability.md` §9 and AC-093
 *   compare the *directory* `recordHash` at the current HEAD with the caller's
 *   expectation before anything is built; a Git record that moved for the same
 *   `recordVersion` — or one that exists although the caller expected it absent —
 *   is `REQUIREMENT_CONFLICT` (AC-092's rule), and only an explicit repair lets the
 *   save proceed onto the repaired Git state.
 * - **A metadata-only change is never code verification.** `checkCompletionSettlement`
 *   is the integration-time consistency check: a CompletionManifest claiming code
 *   verification must bind the final revision the Settlement verified, and a
 *   revision whose change set is only `.agentdev/requirements/**` is reported as
 *   metadata rather than accepted as verified code.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  portableRequirementSchema,
  requirementMetadataSchema,
  type ErrorCode,
  type JsonObject,
  type OperationState,
  type PortableRequirement,
  type Requirement,
  type RequirementMetadata,
  type SettlementResult,
  type Work,
} from '@agentdev/contracts';
import { type DeliveryRoute, type ImportVerdict } from '@agentdev/domain';
import {
  normalizeContentMarkdown,
  rebuildPoolReadme,
  requirementRecordDirectory,
  requirementRecordHash,
  REQUIREMENTS_README,
  REQUIREMENTS_ROOT,
  sha256Hex,
  WORKING_TREE_REVISION,
  type RequirementPoolRecord,
} from '@agentdev/knowledge';
import { withTransaction, type ProjectStore } from '@agentdev/storage';
import {
  canonicalPath,
  createCasService,
  dirtyPathsOf,
  requirementPoolPaths,
  type CasEventPort,
  type CasJournal,
  type CasJournalRecord,
  type CasOutcome,
  type CasService,
  type GitResult,
  type RequirementPoolCommit,
  type WorktreeGitPort,
} from '@agentdev/workspace';
import { ProtocolError } from './errors.js';
import { RequirementProjection } from './requirements.js';

/** The recovery operation a failed save hands back (`reliability.md` §9). */
export const REQUIREMENT_SAVE_RETRY_KIND = 'requirement.save.retry';

/** `operation.kind` of every durable save record (`data.md` §2). */
export const REQUIREMENT_SAVE_OPERATION_KIND = 'requirement_save';

/** `Event.name` of a completed save. */
export const REQUIREMENT_SAVED_EVENT = 'requirement.saved';

/** `Event.name` of a refused or failed save. */
export const REQUIREMENT_SAVE_FAILED_EVENT = 'requirement.save_failed';

/** `Event.name` of a save whose projection was repaired after a Git/CAS failure. */
export const REQUIREMENT_REPAIRED_EVENT = 'requirement.save_repaired';

/** `Event.name` of a working-copy refresh that failed for a non-dirty reason. */
export const REQUIREMENT_WORKTREE_REFRESH_FAILED_EVENT = 'requirement.save_worktree_refresh_failed';

/**
 * `Event.name` of a refused working-copy refresh (`W8R2-06`): the delivery working
 * tree held uncommitted local edits in the very paths the committed bytes describe,
 * so writing them back would have replaced content that exists nowhere else.
 */
export const REQUIREMENT_WORKTREE_DIRTY_EVENT = 'requirement.save_worktree_overwrite_blocked';

/** The fixed file names inside one record directory. */
export const REQUIREMENT_CONTENT_FILE_NAME = 'content.md';
export const REQUIREMENT_METADATA_FILE_NAME = 'requirement.json';

/** The six level-2 headings `requirements.md` §6 requires, in order. */
export const REQUIREMENT_CONTENT_HEADINGS = [
  '目标与背景',
  '范围与行为',
  '验收说明',
  '已确认决定',
  '未决问题',
  '完成摘要',
] as const;

/** Placeholder for a section that carries no content yet. */
export const REQUIREMENT_EMPTY_SECTION = '待明确';

/** Placeholder of an explicitly empty completion summary. */
export const REQUIREMENT_EMPTY_COMPLETION = '无';

/**
 * A delivery working tree whose uncommitted local edits would be silently replaced
 * by the bytes the save just committed (`W8R2-06`, AC-028).
 *
 * The working copy of the requirement pool is written *after* Git moved, so a dirty
 * target path is not a reason to undo the commit — it is a reason to stop before
 * discarding content that exists nowhere else and report which paths are in the way.
 */
export class DeliveryWorktreeDirtyError extends Error {
  readonly paths: readonly string[];
  readonly porcelainLines: readonly string[];

  constructor(paths: readonly string[], porcelainLines: readonly string[]) {
    super(
      `交付工作树有 ${paths.length} 个未提交的本地修改：${paths.join('、')}；拒绝用提交字节覆盖`,
    );
    this.name = 'DeliveryWorktreeDirtyError';
    this.paths = [...paths];
    this.porcelainLines = [...porcelainLines];
  }
}

/**
 * Whether one `git status --porcelain` line touches `path`.
 *
 * An untracked directory is reported as `?? dir/`, so a target *inside* it counts as
 * touched; that is what lets the write-back refuse to overwrite untracked content
 * (`W8R2-06`) instead of silently replacing it.
 */
function porcelainTouches(line: string, path: string): boolean {
  return dirtyPathsOf(line).some((entry) => {
    const normalized = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

/**
 * The integration mutex of one Project (`reliability.md` §4/§9).
 *
 * `lease.resource` is unique in `data.md` §2, so this string is the *whole*
 * mutual-exclusion contract: requirement saves and code-delivery integrations
 * must agree on it to exclude each other.
 */
export function integrationLockResource(projectId: string): string {
  return `integration:${projectId}`;
}

// ---------------------------------------------------------------------------
// Integration lock (AC-091)
// ---------------------------------------------------------------------------

/** Who currently holds the Project integration lock. */
export interface IntegrationLockHolder {
  readonly ownerAttemptId: string;
  readonly epoch: number;
  readonly expiresAt: string;
}

export type IntegrationLockResult =
  | { readonly acquired: true; readonly resource: string; readonly replacedExpired: boolean }
  | { readonly acquired: false; readonly code: 'BUSY'; readonly heldBy: IntegrationLockHolder };

/** The minimal lease surface the lock needs; `LeaseStore` satisfies it. */
export interface IntegrationLeaseStore {
  acquire(input: {
    readonly resource: string;
    readonly ownerAttemptId: string;
    readonly epoch: number;
    readonly expiresAt: string;
    readonly at?: string;
  }):
    | {
        readonly acquired: true;
        readonly replacedExpired: boolean;
        readonly lease: {
          readonly ownerAttemptId: string;
          readonly epoch: number;
          readonly expiresAt: string;
        };
      }
    | {
        readonly acquired: false;
        readonly heldBy: {
          readonly ownerAttemptId: string;
          readonly epoch: number;
          readonly expiresAt: string;
        };
      };
  release(resource: string, ownerAttemptId: string, epoch: number): boolean;
}

/**
 * The shared Project integration lock (`reliability.md` §4/§9).
 *
 * The *same* instance (or two instances over the same `lease` rows) must guard
 * requirement saving and code delivery; that is what makes the two mutually
 * exclusive rather than merely individually serialized.
 */
export class ProjectIntegrationLock {
  private readonly projectId: string;
  private readonly leases: IntegrationLeaseStore;
  private readonly now: () => string;

  constructor(options: {
    readonly projectId: string;
    readonly leases: IntegrationLeaseStore;
    readonly now?: () => string;
  }) {
    this.projectId = options.projectId;
    this.leases = options.leases;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** The resource every writer of this Project must contend for. */
  get resource(): string {
    return integrationLockResource(this.projectId);
  }

  /**
   * Takes the lock, or reports the live holder.
   *
   * An expired lease is replaced rather than shared (`reliability.md` §2), which is
   * what lets a crashed save be retried without operator intervention.
   */
  acquire(input: {
    readonly ownerAttemptId: string;
    readonly epoch: number;
    readonly ttlMs?: number;
    readonly at?: string;
  }): IntegrationLockResult {
    if (input.ownerAttemptId.trim() === '') {
      throw new ProtocolError('VALIDATION_ERROR', 'integration lock needs an owner');
    }
    const at = input.at ?? this.now();
    const ttlMs = input.ttlMs ?? 60_000;
    const result = this.leases.acquire({
      resource: this.resource,
      ownerAttemptId: input.ownerAttemptId,
      epoch: input.epoch,
      expiresAt: new Date(Date.parse(at) + ttlMs).toISOString(),
      at,
    });
    if (result.acquired) {
      return { acquired: true, resource: this.resource, replacedExpired: result.replacedExpired };
    }
    return {
      acquired: false,
      code: 'BUSY',
      heldBy: {
        ownerAttemptId: result.heldBy.ownerAttemptId,
        epoch: result.heldBy.epoch,
        expiresAt: result.heldBy.expiresAt,
      },
    };
  }

  /** Releases the lock; only its owner may do so. */
  release(ownerAttemptId: string, epoch: number): boolean {
    return this.leases.release(this.resource, ownerAttemptId, epoch);
  }
}

// ---------------------------------------------------------------------------
// Record preparation (AC-093)
// ---------------------------------------------------------------------------

/**
 * The caller-supplied metadata of one save.
 *
 * `contentHash` is **derived** from the body by this module, so a caller cannot
 * declare a hash that does not describe the bytes being committed
 * (`requirements.md` §6, AC-093: "两文件共享版本并原子提交").
 */
export type RequirementMetadataDraft = Omit<RequirementMetadata, 'contentHash'>;

export interface PrepareRequirementSaveInput {
  readonly metadata: RequirementMetadataDraft;
  /** The raw Markdown body as authored; normalized to UTF-8/LF before hashing. */
  readonly contentMarkdown: string;
  /** The row currently projected from Git, when one exists. */
  readonly previous?: Requirement;
}

export type RequirementPrepareFailureCode =
  'VALIDATION_ERROR' | 'INVALID_STATE' | 'REQUIREMENT_CONFLICT';

export interface PreparedRequirementRecord {
  readonly record: PortableRequirement;
  /** Raw bytes written to `requirement.json` (trailing LF included). */
  readonly metadataJson: string;
  /** Normalized bytes written to `content.md`, version marker included. */
  readonly contentMarkdown: string;
  readonly metadataHash: string;
  readonly contentHash: string;
  readonly recordHash: string;
  readonly directoryPath: string;
  readonly metadataPath: string;
  readonly contentPath: string;
}

export type PrepareRequirementSaveResult =
  | ({ readonly ok: true } & PreparedRequirementRecord)
  | {
      readonly ok: false;
      readonly code: RequirementPrepareFailureCode;
      readonly message: string;
      readonly issues: readonly string[];
    };

function prepareRefusal(
  code: RequirementPrepareFailureCode,
  message: string,
  issues: readonly string[] = [],
): PrepareRequirementSaveResult {
  return { ok: false, code, message, issues: issues.length === 0 ? [message] : issues };
}

/** The `<!-- record-version: n -->` marker the body mirrors (`requirements.md` §6). */
export function contentVersionMarker(version: number): string {
  return `<!-- record-version: ${version} -->`;
}

/** Reads the version marker back out of a body; `undefined` when absent. */
export function readContentVersionMarker(markdown: string): number | undefined {
  const match = /<!--\s*record-version:\s*(\d+)\s*-->/u.exec(markdown);
  return match === null ? undefined : Number.parseInt(match[1] ?? '', 10);
}

/** One structural problem of a body. */
export interface RequirementContentIssue {
  readonly heading: string;
  readonly message: string;
}

function headingPattern(): RegExp {
  const escaped = REQUIREMENT_CONTENT_HEADINGS.map((heading) =>
    heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
  ).join('|');
  return new RegExp(`^##[ \\t]+(${escaped})[ \\t]*$`, 'gmu');
}

/**
 * Checks the body against `requirements.md` §6: the six level-2 headings, each
 * exactly once, in order, plus a non-empty body.
 *
 * Nothing here parses prose into state; the check is structural, which is what
 * makes a malformed body a deterministic refusal instead of an interpretation.
 */
export function validateRequirementContent(markdown: string): readonly RequirementContentIssue[] {
  const normalized = normalizeContentMarkdown(markdown);
  const issues: RequirementContentIssue[] = [];
  if (normalized.trim() === '') {
    issues.push({ heading: '', message: 'content.md must not be empty' });
    return issues;
  }
  const seen = new Map<string, number>();
  const order: string[] = [];
  const pattern = headingPattern();
  let match = pattern.exec(normalized);
  while (match !== null) {
    const heading = match[1] ?? '';
    seen.set(heading, (seen.get(heading) ?? 0) + 1);
    order.push(heading);
    match = pattern.exec(normalized);
  }
  for (const heading of REQUIREMENT_CONTENT_HEADINGS) {
    const count = seen.get(heading) ?? 0;
    if (count === 0) {
      issues.push({ heading, message: `content.md is missing the "## ${heading}" heading` });
    } else if (count > 1) {
      issues.push({
        heading,
        message: `content.md repeats the "## ${heading}" heading (${count} times)`,
      });
    }
  }
  const expectedOrder = REQUIREMENT_CONTENT_HEADINGS.filter((heading) => seen.has(heading));
  if (
    order.length === expectedOrder.length &&
    order.some((heading, index) => heading !== expectedOrder[index])
  ) {
    issues.push({
      heading: '',
      message: `content.md headings must appear in the documented order: ${REQUIREMENT_CONTENT_HEADINGS.join('、')}`,
    });
  }
  return issues;
}

/** The text under one level-2 heading, trimmed; `''` when the heading is absent. */
export function contentSection(markdown: string, heading: string): string {
  const normalized = normalizeContentMarkdown(markdown);
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`^##[ \\t]+${escaped}[ \\t]*$`, 'gmu');
  const match = pattern.exec(normalized);
  if (match === null) return '';
  const rest = normalized.slice(match.index + match[0].length);
  const next = /^##[ \t]+/mu.exec(rest);
  return (next === null ? rest : rest.slice(0, next.index)).trim();
}

/**
 * Builds the two files of one save and their hashes (AC-093).
 *
 * The returned `metadataJson` is the exact byte sequence to commit, its SHA256 is
 * `metadataHash`, and `recordHash` is the documented combination
 * `requirement.json\0<metadataHash>\ncontent.md\0<contentHash>\n`
 * (`requirements.md` §6). Because both files come from one call they always share
 * one `version`, and the body carries the same version in its `record-version`
 * marker, so a half-updated pair is detectable.
 */
export function prepareRequirementSave(
  input: PrepareRequirementSaveInput,
): PrepareRequirementSaveResult {
  const bodyIssues = validateRequirementContent(input.contentMarkdown);
  if (bodyIssues.length > 0) {
    return prepareRefusal(
      'VALIDATION_ERROR',
      'content.md 结构不符合需求池规范（六个二级标题各一次）',
      bodyIssues.map((issue) => issue.message),
    );
  }

  const normalizedBody = normalizeContentMarkdown(input.contentMarkdown);
  const bodyHash = sha256Hex(normalizedBody);
  const parsed = requirementMetadataSchema.safeParse({
    ...input.metadata,
    contentHash: bodyHash,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    return prepareRefusal('VALIDATION_ERROR', `需求元数据不符合契约：${issues.join('; ')}`, issues);
  }
  const metadata = parsed.data;

  // The bytes this call would write, and the combined hash of the pair
  // (`requirements.md` §6). Both halves are computed the same way whether the call
  // turns out to be an update, a create or an idempotent replay.
  const contentMarkdown = normalizeContentMarkdown(
    `${contentVersionMarker(metadata.version)}\n${normalizedBody}`,
  );
  const contentHash = sha256Hex(contentMarkdown);
  const metadataWithHash: RequirementMetadata = { ...metadata, contentHash };
  const metadataJson = `${JSON.stringify(metadataWithHash, null, 2)}\n`;
  const metadataHash = sha256Hex(metadataJson);
  const recordHash = requirementRecordHash(metadataHash, contentHash);

  // The version guard runs on the record this call would write: a strictly greater
  // version is an update, and the *identical* record is an idempotent replay of the
  // caller's own save (`AC-090` retries). Anything else is a regression, which is the
  // `REQUIREMENT_CONFLICT` `AC-093` refuses to overwrite.
  if (input.previous !== undefined) {
    if (metadata.id !== input.previous.id) {
      return prepareRefusal(
        'VALIDATION_ERROR',
        `元数据 id ${metadata.id} 与要更新的需求 ${input.previous.id} 不一致`,
      );
    }
    // A strictly greater version is an update; the same version is only legal when it
    // is the *identical* record, i.e. an idempotent replay of the caller's own save.
    const sameVersionWithoutReplay =
      metadata.version === input.previous.recordVersion &&
      input.previous.portableRef.hash !== recordHash;
    if (metadata.version < input.previous.recordVersion || sameVersionWithoutReplay) {
      return prepareRefusal(
        'REQUIREMENT_CONFLICT',
        `recordVersion 必须递增：当前投影为 ${input.previous.recordVersion}，本次为 ${metadata.version}`,
      );
    }
  }

  const record: PortableRequirement = {
    ...metadataWithHash,
    contentMarkdown,
  };
  const parsedRecord = portableRequirementSchema.safeParse(record);
  if (!parsedRecord.success) {
    return prepareRefusal('VALIDATION_ERROR', '需求记录未通过 PortableRequirement 校验');
  }
  const directoryPath = requirementRecordDirectory(metadata.id);
  return {
    ok: true,
    record: parsedRecord.data,
    metadataJson,
    contentMarkdown,
    metadataHash,
    contentHash,
    recordHash,
    directoryPath,
    metadataPath: `${directoryPath}/${REQUIREMENT_METADATA_FILE_NAME}`,
    contentPath: `${directoryPath}/${REQUIREMENT_CONTENT_FILE_NAME}`,
  };
}

// ---------------------------------------------------------------------------
// Reading the pool out of one Git revision (AC-091/AC-093)
// ---------------------------------------------------------------------------

/** One record as it exists in the Git tree of one revision. */
export interface RequirementPoolRevisionRecord {
  readonly id: string;
  readonly recordPath: string;
  readonly metadataPath: string;
  readonly contentPath: string;
  readonly metadataJson: string;
  readonly contentMarkdown: string;
  readonly metadataHash: string;
  readonly contentHash: string;
  readonly recordHash: string;
  readonly version: number;
}

/**
 * One record-level problem in a revision's pool (`T-03`, AC-093).
 *
 * `requirements.md` §4 requires such records to be reported per record ("缺任一文件、
 * Hash 不一致…标该条冲突，不静默补空正文") instead of being dropped from the reader's
 * output with no diagnostic.
 */
export interface RequirementPoolConflict {
  /** Repository-relative record directory, e.g. `.agentdev/requirements/<id>`. */
  readonly recordPath: string;
  /** The files that are missing or inconsistent. */
  readonly paths: readonly string[];
  readonly reason: 'missing-content' | 'missing-metadata' | 'hash-mismatch' | 'invalid-metadata';
  readonly message: string;
}

/** The pool as committed at one revision. */
export interface RequirementPoolAtRevision {
  readonly revision: string | null;
  readonly records: readonly RequirementPoolRevisionRecord[];
  /** Per-record conflicts; a record listed here is not in `records`. */
  readonly conflicts: readonly RequirementPoolConflict[];
  /** The committed pool README text, when it exists at that revision. */
  readonly readme?: string;
}

/** The Git port surface the pool reader needs. */
export interface RequirementPoolGitPort {
  resolveRevision(repoRoot: string, revision: string): GitResult<string | null>;
  listTree(
    repoRoot: string,
    revision: string,
    paths: readonly string[],
  ): GitResult<readonly string[]>;
  pathAtRevision(repoRoot: string, revision: string, path: string): GitResult<boolean>;
  /**
   * Reads a blob at `<revision>:<path>` (`W8R1-02`).
   *
   * **Required, never optional**: a caller that cannot read the committed bytes of
   * the target revision must not fall back to the working tree, because a branch can
   * move without a checkout — the checked-out record would then be an older
   * projection that silently overwrites the newer one on Git (`AC-094`).
   */
  readBlob(repoRoot: string, revision: string, path: string): GitResult<string | null>;
}

function toPoolRecord(record: RequirementPoolRevisionRecord): RequirementPoolRecord {
  const parsed = requirementMetadataSchema.safeParse(JSON.parse(record.metadataJson));
  if (!parsed.success) {
    throw new ProtocolError('REQUIREMENT_CONFLICT', `Git 记录元数据非法：${record.metadataPath}`, {
      details: { path: record.metadataPath },
    });
  }
  return {
    id: record.id,
    directoryPath: record.recordPath,
    metadataPath: record.metadataPath,
    contentPath: record.contentPath,
    metadata: parsed.data,
    contentMarkdown: record.contentMarkdown,
    metadataHash: record.metadataHash,
    contentHash: record.contentHash,
    recordHash: record.recordHash,
    revision: WORKING_TREE_REVISION,
  };
}

/**
 * Reads every requirement record out of the revision's Git tree.
 *
 * `AC-091` requires a code integration to carry the latest requirement pool, so the
 * reader is revision-addressed rather than working-tree-addressed: a delivery built
 * on an old baseline can fold in the requirement files exactly as they exist at the
 * current delivery revision, including records another server saved.
 */
export function readRequirementPoolAtRevision(input: {
  readonly git: RequirementPoolGitPort;
  readonly repoRoot: string;
  readonly revision: string | null;
}): RequirementPoolAtRevision {
  const revision = input.revision;
  if (revision === null) return { revision: null, records: [], conflicts: [] };
  const listed = input.git.listTree(input.repoRoot, revision, [REQUIREMENTS_ROOT]);
  if (!listed.ok) {
    throw new ProtocolError('INTERNAL_ERROR', `读取需求池树失败：${revision}`, {
      details: { errors: listed.errors.length },
    });
  }
  const files = listed.value;
  const present = new Set(files);
  const metadataPaths = files
    .filter(
      (path) =>
        path.startsWith(`${REQUIREMENTS_ROOT}/`) &&
        path.endsWith(`/${REQUIREMENT_METADATA_FILE_NAME}`),
    )
    .sort();
  const contentPaths = files
    .filter(
      (path) =>
        path.startsWith(`${REQUIREMENTS_ROOT}/`) &&
        path.endsWith(`/${REQUIREMENT_CONTENT_FILE_NAME}`),
    )
    .sort();
  const records: RequirementPoolRevisionRecord[] = [];
  const conflicts: RequirementPoolConflict[] = [];
  for (const metadataPath of metadataPaths) {
    const segments = metadataPath.split('/');
    const id = segments[segments.length - 2] ?? '';
    const recordPath = `${REQUIREMENTS_ROOT}/${id}`;
    const contentPath = `${recordPath}/${REQUIREMENT_CONTENT_FILE_NAME}`;
    if (!present.has(contentPath)) {
      // `T-03`: report the half pair instead of dropping it silently, and never
      // fabricate an empty body for it.
      conflicts.push({
        recordPath,
        paths: [metadataPath, contentPath],
        reason: 'missing-content',
        message: `需求记录 ${recordPath} 只有 requirement.json（缺少 content.md）；标该条冲突，不补空正文`,
      });
      continue;
    }
    const metadataJson = readBlobAt(input, revision, metadataPath);
    const contentMarkdown = readBlobAt(input, revision, contentPath);
    const metadataHash = sha256Hex(metadataJson);
    const contentHash = sha256Hex(normalizeContentMarkdown(contentMarkdown));
    let declaredContentHash: string | undefined;
    let version: number;
    try {
      const parsed: unknown = JSON.parse(metadataJson);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('需求记录元数据不是对象');
      }
      const candidate = parsed as { readonly contentHash?: unknown; readonly version?: unknown };
      declaredContentHash =
        typeof candidate.contentHash === 'string' ? candidate.contentHash : undefined;
      version = typeof candidate.version === 'number' ? candidate.version : 0;
    } catch (error) {
      conflicts.push({
        recordPath,
        paths: [metadataPath],
        reason: 'invalid-metadata',
        message: `需求记录 ${recordPath} 的 requirement.json 无法解析：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }
    if (declaredContentHash !== undefined && declaredContentHash !== contentHash) {
      // The record is still readable (the caller can show the original bytes), but
      // the mismatch is a per-record conflict rather than a silent recomputation.
      conflicts.push({
        recordPath,
        paths: [metadataPath, contentPath],
        reason: 'hash-mismatch',
        message: `需求记录 ${recordPath} 的 metadata.contentHash=${declaredContentHash} 与正文哈希 ${contentHash} 不一致；标该条冲突`,
      });
    }
    records.push({
      id,
      recordPath,
      metadataPath,
      contentPath,
      metadataJson,
      contentMarkdown,
      metadataHash,
      contentHash,
      recordHash: requirementRecordHash(metadataHash, contentHash),
      version,
    });
  }
  // The other half of a half pair: a committed body with no metadata.
  for (const contentPath of contentPaths) {
    const directory = contentPath.slice(0, contentPath.lastIndexOf('/'));
    if (present.has(`${directory}/${REQUIREMENT_METADATA_FILE_NAME}`)) continue;
    conflicts.push({
      recordPath: directory,
      paths: [contentPath],
      reason: 'missing-metadata',
      message: `需求记录 ${directory} 只有 content.md（缺少 requirement.json）；标该条冲突`,
    });
  }
  records.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const hasReadme = present.has(REQUIREMENTS_README);
  const readme = hasReadme ? readBlobAt(input, revision, REQUIREMENTS_README) : undefined;
  return {
    revision,
    records,
    conflicts: conflicts.sort((left, right) =>
      left.recordPath < right.recordPath ? -1 : left.recordPath > right.recordPath ? 1 : 0,
    ),
    ...(readme === undefined ? {} : { readme }),
  };
}

/**
 * Reads one committed blob, converting every failure into a structured error.
 *
 * The revision is the only source of truth (`W8R1-02/03`): the working tree is never
 * consulted, so a stale checkout can neither supply an older projection nor make the
 * reader throw `ENOENT` for a record that exists only in Git.
 */
function readBlobAt(
  input: {
    readonly git: RequirementPoolGitPort;
    readonly repoRoot: string;
  },
  revision: string,
  path: string,
): string {
  const blob = input.git.readBlob(input.repoRoot, revision, path);
  if (!blob.ok) {
    throw new ProtocolError('INTERNAL_ERROR', `读取 Git blob 失败：${revision}:${path}`, {
      details: { revision, path, errors: blob.errors.length },
    });
  }
  if (blob.value === null) {
    throw new ProtocolError(
      'REQUIREMENT_CONFLICT',
      `Git 修订 ${revision} 的树缺少记录文件：${path}`,
      { details: { revision, path } },
    );
  }
  return blob.value;
}

/** The rebuilt README text for a set of records (`requirements.md` §6). */
export function requirementPoolReadme(records: readonly RequirementPoolRevisionRecord[]): string {
  // Ordered by id, which is the order the pool reader produces and the order the
  // on-disk index must have for a rebuild to be deterministic (`requirements.md` §6).
  const ordered = [...records].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  return rebuildPoolReadme(ordered.map(toPoolRecord));
}

/**
 * Builds the `RequirementPoolCommit` entries for a set of records.
 *
 * The README is always rebuilt from the records being committed, so the index can
 * never disagree with the directory it indexes (`requirements.md` §6).
 */
export function requirementPoolCommits(
  records: readonly RequirementPoolRevisionRecord[],
): readonly RequirementPoolCommit[] {
  // Building the README here validates every record's metadata, so a malformed
  // record is refused before the CAS ever sees the pool.
  requirementPoolReadme(records);
  return records.map((record) => ({
    recordPath: record.recordPath,
    metadataPath: record.metadataPath,
    contentPath: record.contentPath,
    recordHash: record.recordHash,
    version: record.version,
    readmePath: REQUIREMENTS_README,
  }));
}

// ---------------------------------------------------------------------------
// Completion/settlement consistency (AC-091)
// ---------------------------------------------------------------------------

/** The completion record a Settlement wrote (`requirements.md` §2). */
export interface RequirementCompletionFact {
  readonly completedAt: string;
  readonly summary: string;
  /** The *verified* code commit (`requirements.md` §2: never a self-reference). */
  readonly codeRevision: string;
  readonly codeTree: string;
  readonly featureIds: readonly string[];
  readonly verificationSummary: string;
  readonly remainingIssues: readonly string[];
}

/** One verification contract a CompletionManifest may rest on. */
export interface VerifiedManifestFact {
  readonly id: string;
  readonly workId: string;
  readonly kind: 'task' | 'integration' | 'document';
  readonly codeRevision: string;
  readonly codeTree: string;
  readonly acceptanceIds: readonly string[];
  /** `false` when the artifact/evidence behind the manifest was invalidated. */
  readonly valid: boolean;
}

/** One path-level fact of a revision, as reported by Git. */
export interface RevisionPathChange {
  readonly path: string;
  readonly change: 'added' | 'modified' | 'deleted' | 'other';
}

export interface CompletionSettlementInput {
  readonly work: Pick<Work, 'id' | 'level' | 'requirementId'>;
  readonly route: DeliveryRoute;
  /** The completion summary the Settlement writes; `null` when it wrote none. */
  readonly completion: RequirementCompletionFact | null;
  /** The final revision the delivery branch holds. */
  readonly finalRevision: string;
  /** The tree of `finalRevision`. */
  readonly finalTree: string;
  readonly settlement: Pick<
    SettlementResult,
    'finalRevision' | 'codeTree' | 'updatedDocs' | 'unresolved'
  >;
  readonly verifiedManifests: readonly VerifiedManifestFact[];
  /** Paths under the `codeStartRevision..finalRevision` diff. */
  readonly changedPaths: readonly RevisionPathChange[];
  /** The delivery revision the code work started from. */
  readonly codeStartRevision: string | null;
}

export type CompletionRefusalCode =
  'INVALID_STATE' | 'STALE_ARTIFACT' | 'GATE_NOT_READY' | 'MISSING_CONTEXT';

export type CompletionSettlementCheck =
  | {
      readonly ok: true;
      readonly metadataOnly: boolean;
      readonly codeChanged: boolean;
      readonly verifiedManifestIds: readonly string[];
      readonly verifiedRevisions: readonly string[];
      readonly verifiedTree: string;
      readonly finalRevision: string;
      readonly finalTree: string;
      /** Paths of the change set that are requirement-pool metadata. */
      readonly metadataPaths: readonly string[];
      readonly changedPaths: readonly string[];
      /** The revision the (non-empty) change set was measured from (`W8R1-07`). */
      readonly codeStartRevision: string;
    }
  | {
      readonly ok: false;
      readonly code: CompletionRefusalCode;
      readonly message: string;
      /** `true` when the completion record claims verification of metadata only. */
      readonly metadataOnly: boolean;
      readonly reasons: readonly string[];
    };

/** `true` when a repository path belongs to the requirement pool. */
export function isRequirementMetadataPath(path: string): boolean {
  return path === REQUIREMENTS_ROOT || path.startsWith(`${REQUIREMENTS_ROOT}/`);
}

/**
 * Checks a `CompletionManifest` against the Settlement it claims to describe
 * (AC-091: "完成记录与结算一致，metadata变更不冒充代码验证").
 *
 * Four facts are compared, never asserted:
 *
 * 1. the Settlement's `finalRevision`/`codeTree` must be the revision and tree the
 *    completion record binds;
 * 2. every verified Manifest must belong to the Work, be valid, and name that same
 *    code revision and tree — an integration may only reuse evidence whose tree is
 *    literally the final one;
 * 3. the change set under `codeStartRevision..finalRevision` decides whether the
 *    revision is a **code** revision. When every changed path is
 *    `.agentdev/requirements/**` the delivery is metadata-only, and evidence that
 *    claims to verify code for it is refused rather than accepted;
 * 4. a **zero-path** change set is refused too: no change is no code verification
 *    (`W8R1-07`), and the range must actually start somewhere other than the final
 *    revision, otherwise the "diff" it claims to describe is empty by construction.
 */
export function checkCompletionSettlement(
  input: CompletionSettlementInput,
): CompletionSettlementCheck {
  const reasons: string[] = [];
  const changedPaths = input.changedPaths.map((entry) => entry.path);
  const metadataPaths = changedPaths.filter((path) => isRequirementMetadataPath(path));
  const codePaths = changedPaths.filter((path) => !isRequirementMetadataPath(path));
  const metadataOnly = changedPaths.length > 0 && codePaths.length === 0;
  const codeChanged = codePaths.length > 0;
  const refusal = (
    code: CompletionRefusalCode,
    message: string,
  ): Extract<CompletionSettlementCheck, { ok: false }> => ({
    ok: false,
    code,
    message,
    metadataOnly,
    reasons: reasons.length === 0 ? [message] : reasons,
  });

  if (input.completion === null) {
    return refusal(
      'MISSING_CONTEXT',
      '完成记录缺少摘要；仅有元数据变更不能作为代码验证结果（requirements.md §6）',
    );
  }
  if (input.settlement.finalRevision !== input.finalRevision) {
    reasons.push(
      `结算 finalRevision ${input.settlement.finalRevision} 与交付分支实际 ${input.finalRevision} 不一致`,
    );
  }
  if (input.settlement.codeTree !== input.finalTree) {
    reasons.push(
      `结算 codeTree ${input.settlement.codeTree} 与 ${input.finalRevision} 的实际 tree ${input.finalTree} 不一致`,
    );
  }
  if (input.completion.codeRevision !== input.finalRevision) {
    reasons.push(
      `完成记录 codeRevision ${input.completion.codeRevision} 必须引用已验证的最终交付提交 ${input.finalRevision}`,
    );
  }
  if (input.completion.codeTree !== input.finalTree) {
    reasons.push(
      `完成记录 codeTree ${input.completion.codeTree} 与最终 code tree ${input.finalTree} 不一致`,
    );
  }
  if (input.settlement.unresolved.length > 0) {
    reasons.push(`结算仍有未解决项：${input.settlement.unresolved.join('、')}`);
  }
  if (input.verifiedManifests.length === 0) {
    reasons.push('完成记录没有引用任何已通过的验证 Manifest');
  }
  for (const manifest of input.verifiedManifests) {
    if (manifest.workId !== input.work.id) {
      reasons.push(`Manifest ${manifest.id} 属于其他 Work ${manifest.workId}`);
      continue;
    }
    if (!manifest.valid) {
      reasons.push(`Manifest ${manifest.id} 已失效，不能作为完成证据`);
      continue;
    }
    if (manifest.codeRevision !== input.finalRevision || manifest.codeTree !== input.finalTree) {
      reasons.push(
        `Manifest ${manifest.id} 验证的是 ${manifest.codeRevision}（tree ${manifest.codeTree}），不是最终 ${input.finalRevision}`,
      );
    }
  }

  if (reasons.length > 0) return refusal('STALE_ARTIFACT', reasons.join('；'));

  // An empty change set is not evidence of a code change (`W8R1-07`): without at
  // least one path there is nothing the verified Manifests could have verified.
  if (input.changedPaths.length === 0) {
    return refusal(
      'GATE_NOT_READY',
      `最终提交 ${input.finalRevision} 的变更集为空（${input.codeStartRevision ?? 'unknown'}..${input.finalRevision} 没有任何路径），不能作为代码验证结果`,
    );
  }
  // The claimed range must be a real range: a `codeStartRevision` equal to the final
  // revision (or absent) makes `codeStartRevision..finalRevision` empty by
  // construction, so the change set cannot have been measured from it.
  const codeStartRevision = input.codeStartRevision;
  if (codeStartRevision === null || codeStartRevision === input.finalRevision) {
    return refusal(
      'GATE_NOT_READY',
      `无法证明变更集来自 codeStartRevision..finalRevision：codeStartRevision 为 ${codeStartRevision ?? 'null'}，与最终 ${input.finalRevision} 不构成有效范围`,
    );
  }

  // A metadata-only revision is a legitimate record change (AC-090) but it is not
  // code verification: the completion record must say so instead of presenting the
  // metadata edit as a verified code result.
  if (metadataOnly) {
    return refusal(
      'GATE_NOT_READY',
      `最终提交 ${input.finalRevision} 只改动了需求池文件（${metadataPaths.join('、') || REQUIREMENTS_ROOT}），不能作为代码验证结果`,
    );
  }

  return {
    ok: true,
    metadataOnly,
    codeChanged,
    verifiedManifestIds: input.verifiedManifests.map((manifest) => manifest.id),
    verifiedRevisions: input.verifiedManifests.map((manifest) => manifest.codeRevision),
    verifiedTree: input.finalTree,
    finalRevision: input.finalRevision,
    finalTree: input.finalTree,
    metadataPaths,
    changedPaths,
    codeStartRevision,
  };
}

// ---------------------------------------------------------------------------
// Save service (AC-090)
// ---------------------------------------------------------------------------

/** Where a save request came from (`SourceRef.kind`, `data.md` §2). */
export type SaveSourceKind = 'action' | 'message' | 'git' | 'artifact' | 'decision' | 'policy';

/** Which record the caller expects to find at the current delivery revision. */
export interface RequirementSaveExpectation {
  /**
   * The `recordVersion` the caller believes is committed. Omitted when the caller
   * expects no record at all (`expectedAbsent`), which is a create
   * (`reliability.md` §9 "创建使用expectedAbsent=true").
   */
  readonly recordVersion?: number;
  /** The combined `recordHash` the caller believes is committed. */
  readonly recordHash?: string;
  /** `true` for a create: any existing record with this id is a conflict. */
  readonly expectedAbsent?: boolean;
}

export interface SaveRequirementInput {
  /** Idempotency key of the save; also the CAS operation id. */
  readonly operationId: string;
  readonly metadata: RequirementMetadataDraft;
  readonly contentMarkdown: string;
  /** What the caller expects to find at HEAD; enforced inside the lock. */
  readonly expected: RequirementSaveExpectation;
  /** Where the save request came from, for `operation.source_ref`. */
  readonly sourceRef: {
    readonly kind: SaveSourceKind;
    readonly id: string;
    readonly version?: string;
  };
  /**
   * `true` only for an explicit repair retry after the caller resolved a Git
   * conflict; it relaxes the *expectation* (never the version monotonicity) so the
   * save may proceed onto the repaired Git state (AC-092/AC-093).
   */
  readonly explicitRepair?: boolean;
  /** The Work binding to preserve on the local row, when one exists. */
  readonly workId?: string;
  readonly ownerAttemptId?: string;
  readonly epoch?: number;
  readonly ttlMs?: number;
  readonly leaseAt?: string;
  /**
   * `true` keeps the temporary save worktree for inspection. Default `false`
   * (`W8R2-01`): a leftover worktree parked at an old base is exactly the crash
   * residue whose reuse moved the delivery branch backwards, so the safe default is
   * to delete it.
   */
  readonly keepWorktree?: boolean;
  /** Explicit worktree path; defaults to `<dataDir>/save-worktrees/<operationId>`. */
  readonly worktreePath?: string;
  /** The command that produced the save, for the commit message and the event. */
  readonly kind?: 'create' | 'update' | 'archive' | 'cancel' | 'restore' | 'start' | 'complete';
}

/** The `requirement.save.retry` recovery operation a failure hands back. */
export interface RequirementSaveRecoveryOperation {
  readonly kind: typeof REQUIREMENT_SAVE_RETRY_KIND;
  readonly operationId: string;
  /** The delivery ref the save moves. */
  readonly ref: string;
  /** The baseline the retry must still find, or `null` after Git already committed. */
  readonly expectedRevision: string | null;
  readonly expectedRecordVersion?: number;
  readonly expectedRecordHash?: string;
  readonly expectedAbsent: boolean;
  /** The record the completed commit already carries, when Git moved. */
  readonly targetRevision?: string;
  readonly targetTree?: string;
  readonly recordHash?: string;
  /** `true` when only the local projection still has to be repaired. */
  readonly repairOnly: boolean;
  readonly recordPath: string;
  readonly messages: readonly string[];
}

/** What a save reports about the repository state (`AC-090`). */
export interface RequirementSaveGitState {
  /** Short branch name the commit landed on. */
  readonly branch: string;
  /** Full ref name, e.g. `refs/heads/agentdev/main`. */
  readonly ref: string;
  /** The commit the branch now holds. */
  readonly commit: string;
  /** The commit the branch held before this save. */
  readonly previousCommit: string;
  readonly tree: string;
  /** `true` when Git created the commit during this call. */
  readonly createdCommit: boolean;
  /** `true` when the ref moved during this call. */
  readonly refUpdated: boolean;
  /** `true` when no upstream ref contains the commit. */
  readonly unpushed: boolean;
  /** The upstream revision, when the branch tracks one. */
  readonly upstreamRevision: string | null;
}

/** One record the projection still has to absorb after a completed save. */
export interface PendingRequirementRepair {
  readonly operationId: string;
  readonly requirementId: string;
  readonly targetRevision: string;
  readonly recordHash: string;
  readonly state: string;
}

export interface RequirementSaveServiceOptions {
  readonly store: ProjectStore;
  readonly worktrees: WorktreeGitPort;
  readonly cas: CasService;
  readonly journal: CasJournal;
  readonly events: CasEventPort;
  /** The shared Project mutex (`reliability.md` §4/§9). */
  readonly lock?: ProjectIntegrationLock;
  readonly leases?: IntegrationLeaseStore;
  /** Root directory for temporary save worktrees; defaults to `<dataDir>/save-worktrees`. */
  readonly worktreeRoot?: string;
  readonly now?: () => string;
  /** Defaults to `false`; a leftover worktree is crash residue, not reuse material. */
  readonly keepWorktree?: boolean;
}

const SAVE_OPERATION_STATE = {
  running: 'running',
  /**
   * Git holds the commit but the local projection is behind (`AC-090`). `pending`
   * is the contract's word for "the operation has not reached completion"; the
   * `stepResults` carry the target revision the projection repair needs.
   */
  projectionFailed: 'pending',
  completed: 'completed',
  failed: 'failed',
} as const;

export type RequirementSaveStatus = 'saved' | 'projection_repaired';

export type RequirementSaveOutcome =
  | {
      readonly ok: true;
      readonly status: RequirementSaveStatus;
      readonly requirementId: string;
      readonly row: Requirement;
      readonly record: PortableRequirement;
      readonly recordPath: string;
      readonly recordHash: string;
      readonly recordVersion: number;
      readonly metadataHash: string;
      readonly contentHash: string;
      readonly git: RequirementSaveGitState;
      /** `true` when this call did not create a commit (`AC-090`). */
      readonly reusedCommit: boolean;
      readonly projection: {
        readonly verdict: ImportVerdict;
        readonly revision: string;
        readonly repaired: boolean;
      };
      readonly operationId: string;
      readonly recovery: RequirementSaveRecoveryOperation | null;
    }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      readonly message: string;
      readonly reasons: readonly string[];
      readonly operation?: RequirementSaveRecoveryOperation;
      /** `true` when the refused call did not touch the branch. */
      readonly branchUntouched: boolean;
    };

/**
 * Requirement instant save: Git commit plus local projection (`AC-090`), under the
 * Project integration lock shared with code delivery (`AC-091`), refusing to
 * overwrite a Git record the caller's projection does not match (`AC-093`).
 */
export class RequirementSaveService {
  private readonly store: ProjectStore;
  private readonly worktrees: WorktreeGitPort;
  private readonly cas: CasService;
  private readonly journal: CasJournal;
  private readonly events: CasEventPort;
  private readonly lock: ProjectIntegrationLock;
  private readonly worktreeRoot: string;
  private readonly now: () => string;
  private readonly keepWorktree: boolean;

  constructor(options: RequirementSaveServiceOptions) {
    this.store = options.store;
    this.worktrees = options.worktrees;
    this.cas = options.cas;
    this.journal = options.journal;
    this.events = options.events;
    this.lock =
      options.lock ??
      new ProjectIntegrationLock({
        projectId: options.store.projectId,
        leases: options.leases ?? options.store.leases,
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    this.worktreeRoot = options.worktreeRoot ?? join(options.store.dataDir, 'save-worktrees');
    this.now = options.now ?? (() => new Date().toISOString());
    // `W8R2-01`: keeping the worktree by default is what let a crash retry reuse one
    // parked at an old base. Cleanup is now the default; a caller that wants the
    // residue for forensics must opt in.
    this.keepWorktree = options.keepWorktree ?? false;
  }

  /** The shared integration lock this service competes for. */
  get integrationLock(): ProjectIntegrationLock {
    return this.lock;
  }

  /** The CAS journal, so a caller can inspect recovery state. */
  get casJournal(): CasJournal {
    return this.journal;
  }

  /**
   * Saves a created or modified Requirement, or refuses before writing anything.
   *
   * The order is the one `reliability.md` §9 fixes: take the integration lock,
   * compare the target record at the current HEAD with the caller's expectation,
   * build the commit in a detached worktree, CAS the delivery ref, refresh the
   * projection, and only then report `saved`.
   */
  save(input: SaveRequirementInput): RequirementSaveOutcome {
    if (input.operationId.trim() === '') {
      return this.refusal('VALIDATION_ERROR', '需求保存需要 operationId', [
        'operationId is the CAS idempotency key',
      ]);
    }
    // `W8R3-05`: the owner id is subsystem-prefixed so a save and a delivery that
    // happen to reuse one raw operation id (or an explicit owner id) are still two
    // different lock owners and cannot re-enter each other's critical section.
    const ownerAttemptId = `save:${input.ownerAttemptId ?? input.operationId}`;
    const epoch = input.epoch ?? 1;
    const taken = this.lock.acquire({
      ownerAttemptId,
      epoch,
      ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
      ...(input.leaseAt === undefined ? {} : { at: input.leaseAt }),
    });
    if (!taken.acquired) {
      return this.refusal(
        'BUSY',
        `Project 集成锁由 ${taken.heldBy.ownerAttemptId} 持有（epoch ${taken.heldBy.epoch}，到期 ${taken.heldBy.expiresAt}），需求保存未开始`,
        ['另一个需求保存或代码交付正在集成；未接受，可退避重发同幂等键'],
      );
    }
    try {
      return this.saveUnderLock(input);
    } catch (error) {
      // `W8R1-03`: no exception may escape `save()`. Every read/parse failure of the
      // pool path is already structured by `readBlobAt`, so this catch keeps the
      // precise code and the record path instead of letting an `ENOENT` (or a
      // storage error) reach the caller as a crash.
      return this.unexpectedFailure(error);
    } finally {
      this.lock.release(ownerAttemptId, epoch);
    }
  }

  /**
   * Retries the original save after a Git or projection failure (`AC-090`).
   *
   * With Git already holding the commit, the retry repairs only the projection and
   * creates no second commit; otherwise it re-runs the original operation under the
   * same `operationId` and the same expectation.
   */
  retry(input: SaveRequirementInput): RequirementSaveOutcome {
    return this.save(input);
  }

  /** Requirements whose Git commit exists but whose projection is still behind. */
  pendingRepairs(): readonly PendingRequirementRepair[] {
    const rows = this.store.operations.list({
      where: 'kind = ? AND state = ?',
      params: [REQUIREMENT_SAVE_OPERATION_KIND, SAVE_OPERATION_STATE.projectionFailed],
      orderBy: 'created_at ASC',
    });
    const repairs: PendingRequirementRepair[] = [];
    for (const row of rows) {
      const operationId = stepString(row.stepResults, 'operationId');
      const targetRevision = stepString(row.stepResults, 'targetRevision');
      if (operationId === undefined || targetRevision === undefined) continue;
      repairs.push({
        operationId,
        requirementId: row.requirementId ?? '',
        targetRevision,
        recordHash: stepString(row.stepResults, 'recordHash') ?? '',
        state: row.state,
      });
    }
    return repairs;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private refusal(
    code: ErrorCode,
    message: string,
    reasons: readonly string[] = [],
    operation?: RequirementSaveRecoveryOperation,
    /** `false` once Git holds the commit and only the projection is behind. */
    branchUntouched = true,
  ): RequirementSaveOutcome {
    return {
      ok: false,
      code,
      message,
      reasons: reasons.length === 0 ? [message] : reasons,
      ...(operation === undefined ? {} : { operation }),
      branchUntouched,
    };
  }

  /**
   * Turns an escaped read/parse/storage failure into a structured refusal
   * (`W8R1-03`). A `ProtocolError` keeps its own code and message — which names the
   * record path for a pool read — and anything else becomes `INTERNAL_ERROR`.
   */
  private unexpectedFailure(error: unknown): RequirementSaveOutcome {
    if (error instanceof ProtocolError) {
      return this.refusal(error.code, error.message, [error.message]);
    }
    const message = error instanceof Error ? error.message : String(error);
    return this.refusal('INTERNAL_ERROR', `需求保存失败：${message}`, [message]);
  }

  private saveUnderLock(input: SaveRequirementInput): RequirementSaveOutcome {
    const project = this.store.projects.find(this.store.projectId);
    if (project === undefined) {
      return this.refusal('INVALID_STATE', `Project ${this.store.projectId} 不存在`);
    }
    const branch = project.deliveryBranch;
    const ref = `refs/heads/${branch}`;
    const previous = this.store.requirements.find(input.metadata.id);
    if (previous === undefined && input.expected.expectedAbsent !== true) {
      return this.refusal(
        'REQUIREMENT_CONFLICT',
        `需求 ${input.metadata.id} 没有本机投影；创建保存必须声明 expectedAbsent=true（reliability.md §9）`,
        ['创建保存使用 expectedAbsent=true'],
      );
    }
    if (previous !== undefined && input.expected.expectedAbsent === true) {
      return this.refusal(
        'REQUIREMENT_CONFLICT',
        `需求 ${input.metadata.id} 已存在（recordVersion ${previous.recordVersion}），不能按创建保存`,
        ['创建保存要求 expectedAbsent=true 且本机无投影'],
        this.recoveryOperation({
          input,
          ref: `refs/heads/${project.deliveryBranch}`,
          expectedRevision: previous.portableRef.revision,
          recordHash: previous.portableRef.hash,
          repairOnly: false,
          messages: ['a local projection already exists for this create'],
        }),
      );
    }
    if (
      previous !== undefined &&
      input.expected.recordVersion !== undefined &&
      previous.recordVersion !== input.expected.recordVersion
    ) {
      return this.refusal(
        'VERSION_CONFLICT',
        `需求 ${previous.id} 的本机 recordVersion 为 ${previous.recordVersion}，期望 ${input.expected.recordVersion}`,
        ['读取并重评，禁止盲改版本重发'],
      );
    }

    const prepared = prepareRequirementSave({
      metadata: input.metadata,
      contentMarkdown: input.contentMarkdown,
      ...(previous === undefined ? {} : { previous }),
    });
    if (!prepared.ok) return this.refusal(prepared.code, prepared.message, prepared.issues);
    const record = prepared.record;

    const base = this.readHead(project.gitRoot ?? project.root, ref);
    if (!base.ok) return base.failure;
    const { repoRoot, revision: headRevision } = base.value;

    // A retry whose own CAS operation already installed the commit may not re-run
    // the compare half: Git *has* moved, by this operation (`AC-090`).
    const journal = this.journal.load(input.operationId);
    const repairOnly =
      journal !== null &&
      journal.targetRevision !== undefined &&
      journal.targetRevision === headRevision &&
      journal.expectedRevision !== headRevision;

    if (repairOnly) {
      return this.repairProjection({
        input,
        project: { branch, ref, repoRoot },
        previousRevision: journal.expectedRevision,
        targetRevision: headRevision,
        targetTree: journal.targetTree ?? this.treeOf(repoRoot, headRevision),
        prepared,
        poolRecords: this.poolRecordsAt(repoRoot, headRevision, prepared, record.id),
      });
    }

    // `W8R2-05`: the operation journaled a commit the ref never received — the crash
    // landed between the journal write and the ref swap. The symmetric recovery to
    // `SettlementService.recover` installs *that* commit through the CAS instead of
    // building a second one (and instead of failing with "nothing to commit").
    const pendingJournal =
      journal !== null &&
      journal.state === 'pending' &&
      journal.targetRevision !== undefined &&
      journal.expectedRevision === headRevision &&
      journal.targetRevision !== headRevision
        ? journal
        : null;
    if (pendingJournal !== null && pendingJournal.targetRevision !== undefined) {
      const targetRevision = pendingJournal.targetRevision;
      return this.installJournaledCommit({
        input,
        project: { branch, ref, repoRoot },
        previousRevision: pendingJournal.expectedRevision,
        targetRevision,
        targetTree: pendingJournal.targetTree ?? this.treeOf(repoRoot, targetRevision),
        prepared,
        record,
      });
    }

    // The expectation is compared against the *committed* directory record at the
    // delivery ref revision — bytes read with `git cat-file`, never from the
    // working tree — not against the local row (`reliability.md` §9, AC-093/094).
    const expectation = this.compareExpectation({
      repoRoot,
      revision: headRevision,
      ref,
      input,
      ...(previous === undefined ? {} : { previous }),
    });
    if (!expectation.ok) return expectation.failure;

    const worktreePath = this.worktreePathFor(input);
    const worktree = this.prepareWorktree({
      repoRoot,
      worktreePath,
      baseRevision: headRevision,
    });
    if (!worktree.ok) return worktree.failure;

    try {
      const poolRecords = this.poolRecordsAt(repoRoot, headRevision, prepared, record.id);
      const pool = requirementPoolCommits(poolRecords);
      const readme = requirementPoolReadme(poolRecords);

      this.writeRecord(worktreePath, prepared.metadataPath, prepared.metadataJson);
      this.writeRecord(worktreePath, prepared.contentPath, prepared.contentMarkdown);
      this.writeRecord(worktreePath, REQUIREMENTS_README, readme);

      const message = this.commitMessage(input, record);
      const commitPaths = [...requirementPoolPaths(pool), REQUIREMENTS_README];
      const candidate = this.worktrees.commitPaths(worktreePath, message, commitPaths);
      if (!candidate.ok) {
        return this.refusal(
          'INTERNAL_ERROR',
          '需求保存提交失败',
          candidate.errors.map((error) => error.message),
          this.recoveryOperation({
            input,
            ref,
            expectedRevision: headRevision,
            recordHash: prepared.recordHash,
            repairOnly: false,
            messages: candidate.errors.map((error) => error.message),
          }),
        );
      }

      const operationRowId = this.store.newId();
      this.recordOperation({
        id: operationRowId,
        input,
        state: SAVE_OPERATION_STATE.running,
        expectedHead: headRevision,
        candidateRevision: candidate.value.revision,
        stepResults: {
          operationId: input.operationId,
          recordPath: prepared.directoryPath,
          recordHash: prepared.recordHash,
          recordVersion: record.version,
          targetRevision: candidate.value.revision,
        },
      });

      const cas = this.integrateUnderLock({
        operationId: input.operationId,
        repoRoot,
        ref,
        expectedRevision: headRevision,
        candidateRevision: candidate.value.revision,
        message,
        pool,
        requirementId: record.id,
      });
      if (!cas.ok) {
        // The CAS journal is the durable record of what the operation already did:
        // a journaled `committed` state means the ref moved and only the projection
        // is left, which is the repair-only retry `AC-090` describes.
        const journalAfterFailure = this.journal.load(input.operationId);
        const targetRevision = journalAfterFailure?.targetRevision ?? cas.actualRevision;
        const currentHead = this.worktrees.headRevision(repoRoot);
        const repairOnly =
          journalAfterFailure?.state === 'committed' &&
          targetRevision !== null &&
          currentHead.ok &&
          currentHead.value === targetRevision;
        const code: ErrorCode = repairOnly ? 'RECOVERY_REQUIRED' : cas.code;
        this.updateOperation(operationRowId, {
          state: repairOnly ? SAVE_OPERATION_STATE.projectionFailed : SAVE_OPERATION_STATE.failed,
          candidateRevision: targetRevision ?? candidate.value.revision,
          stepResults: {
            operationId: input.operationId,
            recordPath: prepared.directoryPath,
            recordHash: prepared.recordHash,
            recordVersion: record.version,
            ...(targetRevision === null ? {} : { targetRevision }),
            casCode: cas.code,
          },
          error: { code: cas.code, message: cas.message },
        });
        return this.refusal(
          code,
          cas.message,
          [cas.message],
          this.recoveryOperation({
            input,
            ref,
            expectedRevision: repairOnly ? null : headRevision,
            ...(targetRevision === null ? {} : { targetRevision }),
            ...(journalAfterFailure?.targetTree === undefined
              ? {}
              : { targetTree: journalAfterFailure.targetTree }),
            recordHash: prepared.recordHash,
            repairOnly,
            messages: [cas.message],
          }),
          targetRevision !== null && targetRevision === journalAfterFailure?.targetRevision,
        );
      }

      // Git moved. From here on, a retry of this operation may only repair the
      // projection: the commit already exists and must not be recreated (AC-090).
      const stepResults = {
        operationId: input.operationId,
        recordPath: prepared.directoryPath,
        recordHash: prepared.recordHash,
        recordVersion: record.version,
        targetRevision: cas.targetRevision,
        targetTree: cas.targetTree,
        refUpdated: cas.refUpdated,
      };
      this.updateOperation(operationRowId, {
        state: SAVE_OPERATION_STATE.running,
        candidateRevision: cas.targetRevision,
        stepResults,
      });
      try {
        this.refreshWorkingTree({
          repoRoot,
          baselineRevision: headRevision,
          targetRevision: cas.targetRevision,
          branch,
          prepared,
          poolRecords,
        });
      } catch (error) {
        if (error instanceof DeliveryWorktreeDirtyError) {
          // `W8R2-06`: never replace uncommitted local edits; the commit stands and a
          // repair-only retry finishes the working copy once the caller has handled
          // the dirty paths.
          return this.dirtyWorktreeRefusal({
            input,
            project: { branch, ref, repoRoot },
            record,
            operationRowId,
            stepResults,
            targetRevision: cas.targetRevision,
            targetTree: cas.targetTree,
            recordHash: prepared.recordHash,
            error,
          });
        }
        // `W8R3-02`: the commit is durable but the working copy could not be written
        // (a read-only pool directory, an `EISDIR` at a target path, ...). Reporting
        // `saved` would claim a working copy that does not exist, so this is the same
        // repair-only recovery the dirty case takes.
        return this.worktreeRefreshRefusal({
          input,
          project: { branch, ref, repoRoot },
          record,
          operationRowId,
          stepResults,
          targetRevision: cas.targetRevision,
          targetTree: cas.targetTree,
          recordHash: prepared.recordHash,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return this.finishSave({
        input,
        project: { branch, ref, repoRoot },
        previousRevision: cas.previousRevision,
        targetRevision: cas.targetRevision,
        targetTree: cas.targetTree,
        emittedCompletionEvent: cas.emittedCompletionEvent,
        prepared,
        operationRowId,
        stepResults,
      });
    } finally {
      this.cleanupWorktree(repoRoot, worktreePath);
    }
  }

  /** Refreshes the projection for an already-committed save (`AC-090` retry). */
  private repairProjection(args: {
    readonly input: SaveRequirementInput;
    readonly project: { readonly branch: string; readonly ref: string; readonly repoRoot: string };
    readonly previousRevision: string;
    readonly targetRevision: string;
    readonly targetTree: string;
    readonly prepared: PreparedRequirementRecord;
    readonly poolRecords: readonly RequirementPoolRevisionRecord[];
  }): RequirementSaveOutcome {
    const { input, project, prepared } = args;
    const candidates = this.store.operations
      .list({
        where: 'kind = ?',
        params: [REQUIREMENT_SAVE_OPERATION_KIND],
        orderBy: 'created_at DESC',
      })
      .filter((row) => stepString(row.stepResults, 'operationId') === input.operationId);
    const existing = candidates[0];
    try {
      this.refreshWorkingTree({
        repoRoot: project.repoRoot,
        baselineRevision: args.previousRevision,
        targetRevision: args.targetRevision,
        branch: project.branch,
        prepared,
        poolRecords: args.poolRecords,
      });
      const projection = this.refreshProjection({
        record: prepared.record,
        revision: args.targetRevision,
        rawMetadata: prepared.metadataJson,
        ...(input.workId === undefined ? {} : { workId: input.workId }),
      });
      const row = this.store.requirements.find(prepared.record.id);
      if (row === undefined) {
        return this.refusal('INTERNAL_ERROR', `投影刷新后仍找不到需求 ${prepared.record.id}`);
      }
      this.onProjectionCommitted?.();
      if (existing !== undefined) {
        this.updateOperation(existing.id, {
          state: SAVE_OPERATION_STATE.completed,
          stepResults: {
            operationId: input.operationId,
            recordPath: prepared.directoryPath,
            recordHash: prepared.recordHash,
            recordVersion: prepared.record.version,
            targetRevision: args.targetRevision,
            targetTree: args.targetTree,
            projectionRevision: projection.revision,
            repaired: true,
          },
        });
      }
      // Reachable only when the CAS never appended its completion event (the crash
      // landed between the ref update and the status write); on a second repair the
      // journal is already `completed` and this repairs only the projection.
      const journal = this.journal.load(input.operationId);
      const emitted =
        journal?.state === 'completed'
          ? false
          : this.emitSavedEventOnce({
              operationId: input.operationId,
              record: prepared.record,
              revision: args.targetRevision,
            });
      this.appendDiagnostic(REQUIREMENT_REPAIRED_EVENT, input, prepared.record.id, {
        targetRevision: args.targetRevision,
        emitted,
      });
      const upstream = this.upstreamState(project.repoRoot, project.branch, args.targetRevision);
      return {
        ok: true,
        status: 'projection_repaired',
        requirementId: prepared.record.id,
        row,
        record: prepared.record,
        recordPath: prepared.directoryPath,
        recordHash: prepared.recordHash,
        recordVersion: prepared.record.version,
        metadataHash: prepared.metadataHash,
        contentHash: prepared.contentHash,
        git: {
          branch: project.branch,
          ref: project.ref,
          commit: args.targetRevision,
          previousCommit: args.previousRevision,
          tree: args.targetTree,
          createdCommit: false,
          refUpdated: false,
          unpushed: upstream.unpushed,
          upstreamRevision: upstream.upstreamRevision,
        },
        reusedCommit: true,
        projection: { ...projection, repaired: true },
        operationId: input.operationId,
        recovery: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendDiagnostic(REQUIREMENT_SAVE_FAILED_EVENT, input, prepared.record.id, {
        reason: 'projection_failed',
        message,
      });
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: `需求已提交 ${args.targetRevision}，但本机投影修复失败：${message}`,
        reasons: [message],
        operation: this.recoveryOperation({
          input,
          ref: project.ref,
          expectedRevision: null,
          targetRevision: args.targetRevision,
          targetTree: args.targetTree,
          recordHash: prepared.recordHash,
          repairOnly: true,
          messages: [message],
        }),
        branchUntouched: false,
      };
    }
  }

  /**
   * Installs a commit a previous attempt journaled but never swapped in (`W8R2-05`).
   *
   * The symmetric counterpart of `SettlementService.recover`: when the CAS journal is
   * `pending` with a `targetRevision` and the delivery ref still holds the journal's
   * `expectedRevision`, the crash landed between the journal write and the ref swap.
   * The retry must **install that commit** (never build a second one) and then finish
   * the projection. A body that no longer matches the journaled bytes is refused with
   * the exact hash mismatch instead of an opaque "nothing to commit".
   */
  private installJournaledCommit(args: {
    readonly input: SaveRequirementInput;
    readonly project: { readonly branch: string; readonly ref: string; readonly repoRoot: string };
    readonly previousRevision: string;
    readonly targetRevision: string;
    readonly targetTree: string;
    readonly prepared: PreparedRequirementRecord;
    readonly record: PortableRequirement;
  }): RequirementSaveOutcome {
    const { input, prepared, record } = args;
    const journal = this.journal.load(input.operationId);
    // `W8R3-01`: the journal must name *this* record path with *this* body hash. The
    // old lookup returned `null` for a different path and skipped the check, so
    // reusing a crashed operationId for another requirement installed the journaled
    // commit of the other record while reporting the new one as saved. A journal that
    // does not describe this exact record is an idempotency conflict.
    const journaled =
      journal === null ? null : this.journaledRecord(journal, prepared.directoryPath);
    if (journaled === null || journaled.recordHash !== prepared.recordHash) {
      const recorded =
        journaled === null
          ? `未记录记录路径 ${prepared.directoryPath}`
          : `记录路径 ${journaled.recordPath} 的 recordHash 为 ${journaled.recordHash}`;
      const message = `operationId ${input.operationId} 已在 ${args.targetRevision} 记录的是另一份需求记录（${recorded}），与本次 ${prepared.directoryPath} 的 ${prepared.recordHash} 不一致：原操作挂起的是另一条记录或另一份正文；用原记录/原正文重试，或改用新的 operationId`;
      return this.refusal(
        'IDEMPOTENCY_CONFLICT',
        message,
        [message],
        this.recoveryOperation({
          input,
          ref: args.project.ref,
          expectedRevision: args.previousRevision,
          targetRevision: args.targetRevision,
          targetTree: args.targetTree,
          recordHash: prepared.recordHash,
          repairOnly: false,
          messages: [message],
        }),
      );
    }

    const poolRecords = this.poolRecordsAt(
      args.project.repoRoot,
      args.previousRevision,
      prepared,
      record.id,
    );
    const pool = requirementPoolCommits(poolRecords);
    const message = this.commitMessage(input, record);
    const existingRow = this.operationRowFor(input.operationId);
    const operationRowId = existingRow?.id ?? this.store.newId();
    const stepResults: JsonObject = {
      operationId: input.operationId,
      recordPath: prepared.directoryPath,
      recordHash: prepared.recordHash,
      recordVersion: record.version,
      targetRevision: args.targetRevision,
      targetTree: args.targetTree,
      journaledInstall: true,
    };
    if (existingRow === undefined) {
      this.recordOperation({
        id: operationRowId,
        input,
        state: SAVE_OPERATION_STATE.running,
        expectedHead: args.previousRevision,
        candidateRevision: args.targetRevision,
        stepResults,
      });
    }

    const cas = this.integrateUnderLock({
      operationId: input.operationId,
      repoRoot: args.project.repoRoot,
      ref: args.project.ref,
      expectedRevision: args.previousRevision,
      candidateRevision: args.targetRevision,
      message,
      pool,
      requirementId: record.id,
    });
    if (!cas.ok) {
      this.updateOperation(operationRowId, {
        state: SAVE_OPERATION_STATE.failed,
        candidateRevision: args.targetRevision,
        stepResults: { ...stepResults, casCode: cas.code },
        error: { code: cas.code, message: cas.message },
      });
      return this.refusal(
        cas.code,
        cas.message,
        [cas.message],
        this.recoveryOperation({
          input,
          ref: args.project.ref,
          expectedRevision: args.previousRevision,
          targetRevision: args.targetRevision,
          targetTree: args.targetTree,
          recordHash: prepared.recordHash,
          repairOnly: false,
          messages: [cas.message],
        }),
        cas.branchUntouched,
      );
    }

    const after = { ...stepResults, refUpdated: cas.refUpdated, targetTree: cas.targetTree };
    this.updateOperation(operationRowId, {
      state: SAVE_OPERATION_STATE.running,
      candidateRevision: cas.targetRevision,
      stepResults: after,
    });
    try {
      this.refreshWorkingTree({
        repoRoot: args.project.repoRoot,
        baselineRevision: args.previousRevision,
        targetRevision: cas.targetRevision,
        branch: args.project.branch,
        prepared,
        poolRecords,
      });
    } catch (error) {
      if (error instanceof DeliveryWorktreeDirtyError) {
        return this.dirtyWorktreeRefusal({
          input,
          project: args.project,
          record,
          operationRowId,
          stepResults: after,
          targetRevision: cas.targetRevision,
          targetTree: cas.targetTree,
          recordHash: prepared.recordHash,
          error,
        });
      }
      // `W8R3-02`: the journaled commit is installed but the working copy could not be
      // written; the caller gets the repair-only recovery instead of a false `saved`.
      return this.worktreeRefreshRefusal({
        input,
        project: args.project,
        record,
        operationRowId,
        stepResults: after,
        targetRevision: cas.targetRevision,
        targetTree: cas.targetTree,
        recordHash: prepared.recordHash,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return this.finishSave({
      input,
      project: args.project,
      previousRevision: cas.previousRevision,
      targetRevision: cas.targetRevision,
      targetTree: cas.targetTree,
      emittedCompletionEvent: cas.emittedCompletionEvent,
      prepared,
      operationRowId,
      stepResults: after,
    });
  }

  /** The journal entry the CAS recorded for one record path, if any (`W8R3-01`). */
  private journaledRecord(
    journal: CasJournalRecord,
    recordPath: string,
  ): { readonly recordPath: string; readonly recordHash: string; readonly version: number } | null {
    const records = journal.stepResults['requirementRecords'];
    if (!Array.isArray(records)) return null;
    for (const entry of records) {
      if (typeof entry !== 'object' || entry === null) continue;
      const candidate = entry as {
        readonly recordPath?: unknown;
        readonly recordHash?: unknown;
        readonly version?: unknown;
      };
      if (candidate.recordPath === recordPath && typeof candidate.recordHash === 'string') {
        return {
          recordPath,
          recordHash: candidate.recordHash,
          version: typeof candidate.version === 'number' ? candidate.version : 0,
        };
      }
    }
    return null;
  }

  /** The newest durable save row for one `operationId`, when it exists. */
  private operationRowFor(operationId: string): { readonly id: string } | undefined {
    return this.store.operations
      .list({
        where: 'kind = ?',
        params: [REQUIREMENT_SAVE_OPERATION_KIND],
        orderBy: 'created_at DESC',
      })
      .find((row) => stepString(row.stepResults, 'operationId') === operationId);
  }

  /** The shared tail of a save: projection refresh, operation row, outcome. */
  private finishSave(args: {
    readonly input: SaveRequirementInput;
    readonly project: { readonly branch: string; readonly ref: string; readonly repoRoot: string };
    readonly previousRevision: string;
    readonly targetRevision: string;
    readonly targetTree: string;
    /** `true` when the CAS appended its completion event during this call. */
    readonly emittedCompletionEvent: boolean;
    readonly prepared: PreparedRequirementRecord;
    readonly operationRowId: string;
    readonly stepResults: JsonObject;
  }): RequirementSaveOutcome {
    const { input, prepared, project } = args;
    try {
      const projection = this.refreshProjection({
        record: prepared.record,
        revision: args.targetRevision,
        rawMetadata: prepared.metadataJson,
        ...(input.workId === undefined ? {} : { workId: input.workId }),
      });
      // The projection row is durable; the completion event is the next step, so this
      // is the documented fault point for a projection-only failure (`AC-090`).
      this.onProjectionCommitted?.();
      if (args.emittedCompletionEvent) {
        this.emitSavedEventOnce({
          operationId: input.operationId,
          record: prepared.record,
          revision: args.targetRevision,
        });
      }
      this.updateOperation(args.operationRowId, {
        state: SAVE_OPERATION_STATE.completed,
        stepResults: { ...args.stepResults, projectionRevision: projection.revision },
      });
      const row = this.store.requirements.find(prepared.record.id);
      if (row === undefined) {
        return this.refusal('INTERNAL_ERROR', `投影刷新后仍找不到需求 ${prepared.record.id}`);
      }
      const upstream = this.upstreamState(project.repoRoot, project.branch, args.targetRevision);
      return {
        ok: true,
        status: 'saved',
        requirementId: prepared.record.id,
        row,
        record: prepared.record,
        recordPath: prepared.directoryPath,
        recordHash: prepared.recordHash,
        recordVersion: prepared.record.version,
        metadataHash: prepared.metadataHash,
        contentHash: prepared.contentHash,
        git: {
          branch: project.branch,
          ref: project.ref,
          commit: args.targetRevision,
          previousCommit: args.previousRevision,
          tree: args.targetTree,
          createdCommit: true,
          refUpdated: true,
          unpushed: upstream.unpushed,
          upstreamRevision: upstream.upstreamRevision,
        },
        // A requirement save always builds its own commit for the operation, so
        // nothing was *reused* from an earlier attempt of this operationId.
        reusedCommit: false,
        projection: { ...projection, repaired: false },
        operationId: input.operationId,
        recovery: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateOperation(args.operationRowId, {
        state: SAVE_OPERATION_STATE.projectionFailed,
        stepResults: args.stepResults,
        error: { code: 'projection_failed', message },
      });
      this.appendDiagnostic(REQUIREMENT_SAVE_FAILED_EVENT, input, prepared.record.id, {
        reason: 'projection_failed',
        targetRevision: args.targetRevision,
        message,
      });
      return {
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: `需求已提交 ${args.targetRevision}，但本机投影刷新失败：${message}`,
        reasons: [message],
        operation: this.recoveryOperation({
          input,
          ref: project.ref,
          // Git already holds the target: the retry must not expect the baseline.
          expectedRevision: null,
          targetRevision: args.targetRevision,
          targetTree: args.targetTree,
          recordHash: prepared.recordHash,
          repairOnly: true,
          messages: [message],
        }),
        branchUntouched: false,
      };
    }
  }

  /**
   * The pool the next commit will carry: the records already at `revision`, with
   * the record under save replaced by the bytes this call prepared (`AC-091`).
   */
  private poolRecordsAt(
    repoRoot: string,
    revision: string,
    prepared: PreparedRequirementRecord,
    id: string,
  ): readonly RequirementPoolRevisionRecord[] {
    const current = readRequirementPoolAtRevision({
      git: this.worktrees,
      repoRoot,
      revision,
    });
    const others = current.records.filter((entry) => entry.id !== id);
    const next: RequirementPoolRevisionRecord = {
      id,
      recordPath: prepared.directoryPath,
      metadataPath: prepared.metadataPath,
      contentPath: prepared.contentPath,
      metadataJson: prepared.metadataJson,
      contentMarkdown: prepared.contentMarkdown,
      metadataHash: prepared.metadataHash,
      contentHash: prepared.contentHash,
      recordHash: prepared.recordHash,
      version: prepared.record.version,
    };
    return [...others, next].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  }

  /** Runs the CAS, turning a thrown CAS step into an explicit refusal. */
  private integrateUnderLock(request: {
    readonly operationId: string;
    readonly repoRoot: string;
    readonly ref: string;
    readonly expectedRevision: string;
    readonly candidateRevision: string;
    readonly message: string;
    readonly pool: readonly RequirementPoolCommit[];
    readonly requirementId: string;
  }): CasOutcome {
    try {
      return this.cas.integrate({
        operationId: request.operationId,
        kind: REQUIREMENT_SAVE_OPERATION_KIND,
        repoRoot: request.repoRoot,
        ref: request.ref,
        expectedRevision: request.expectedRevision,
        candidateRevision: request.candidateRevision,
        message: request.message,
        requirementPool: request.pool,
        requirementId: request.requirementId,
      });
    } catch (error) {
      // A CAS step that threw (the completion-event sink, the journal write) left
      // the operation recoverable: the journal names the commit, so the retry reuses
      // it instead of creating a second one (`reliability.md` §5).
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        actualRevision: null,
        expectedRevision: request.expectedRevision,
        message: `CAS 步骤失败：${error instanceof Error ? error.message : String(error)}`,
        branchUntouched: true,
        errors: [],
      };
    }
  }

  /**
   * Test seam: called once the projection row is committed, before the saved event.
   *
   * A caller that must inject the documented "Git committed, projection half done"
   * fault (`AC-090`) closes the database here; the projection then fails with the
   * real error instead of a mocked one.
   */
  onProjectionCommitted?: () => void;

  /**
   * The revision of the delivery ref the save will compare-and-swap.
   *
   * The ref — never `HEAD` and never the working tree — is the target revision
   * (`W8R1-02`): a branch can move without a checkout, so `HEAD`/the checked-out
   * files may still describe an older baseline than the ref the CAS will move.
   */
  private readHead(
    repoRoot: string,
    ref: string,
  ):
    | { ok: true; value: { repoRoot: string; revision: string } }
    | { ok: false; failure: RequirementSaveOutcome } {
    const resolved = this.worktrees.resolveRoot(repoRoot);
    if (!resolved.ok || resolved.value === null) {
      return { ok: false, failure: this.refusal('INVALID_STATE', `交付仓库不可用：${repoRoot}`) };
    }
    const root = resolved.value;
    const head = this.worktrees.resolveRevision(root, ref);
    if (!head.ok) {
      return {
        ok: false,
        failure: this.refusal(
          'INTERNAL_ERROR',
          `读取交付 ref ${ref} 失败`,
          head.errors.map((error) => error.message),
        ),
      };
    }
    if (head.value === null) {
      return {
        ok: false,
        failure: this.refusal('INVALID_STATE', `交付分支 ${ref} 还没有提交，无法保存需求：${root}`),
      };
    }
    return { ok: true, value: { repoRoot: root, revision: head.value } };
  }

  /**
   * Compares the caller's expectation against the record committed at the delivery
   * ref revision (`AC-093`/`AC-094`).
   *
   * `expectedAbsent` is a create guard; a record that exists at the target revision
   * although the caller expected none is a conflict, never a silent overwrite. A
   * changed directory hash for the version the projection already knows is the
   * `stale_projection` conflict `requirements.md` §4 describes.
   */
  private compareExpectation(args: {
    readonly repoRoot: string;
    readonly revision: string;
    readonly ref: string;
    readonly previous?: Requirement;
    readonly input: SaveRequirementInput;
  }): { ok: true } | { ok: false; failure: RequirementSaveOutcome } {
    const pool = readRequirementPoolAtRevision({
      git: this.worktrees,
      repoRoot: args.repoRoot,
      revision: args.revision,
    });
    const directoryPath = requirementRecordDirectory(args.input.metadata.id);
    const recordConflict = pool.conflicts.find((conflict) => conflict.recordPath === directoryPath);
    if (recordConflict !== undefined && args.input.explicitRepair !== true) {
      // `T-03`: a half pair at the delivery ref is a per-record conflict, never a
      // silent overwrite (or a silent skip that would add a second half pair).
      return {
        ok: false,
        failure: this.refusal(
          'REQUIREMENT_CONFLICT',
          recordConflict.message,
          [`${recordConflict.reason}: ${recordConflict.paths.join('、')}`],
          this.recoveryOperation({
            input: args.input,
            ref: args.ref,
            expectedRevision: args.revision,
            recordHash: args.previous?.portableRef.hash ?? '',
            repairOnly: false,
            messages: [recordConflict.message],
          }),
        ),
      };
    }
    const head = pool.records.find((entry) => entry.id === args.input.metadata.id);
    if (args.input.explicitRepair === true) return { ok: true };
    const conflict = (
      message: string,
      reasons: readonly string[],
      recordHash?: string,
    ): { ok: false; failure: RequirementSaveOutcome } => ({
      ok: false,
      failure: this.refusal(
        'REQUIREMENT_CONFLICT',
        message,
        reasons,
        this.recoveryOperation({
          input: args.input,
          ref: args.ref,
          expectedRevision: args.revision,
          recordHash: recordHash ?? head?.recordHash ?? args.previous?.portableRef.hash ?? '',
          repairOnly: false,
          messages: reasons,
        }),
      ),
    });

    if (head === undefined) {
      if (args.input.expected.expectedAbsent !== true && args.previous !== undefined) {
        return conflict(
          `Git 交付基线 ${args.revision} 已不含需求 ${args.input.metadata.id}，本机投影仍在；先在 Git 恢复记录并显式重新导入`,
          ['REQUIREMENT_CONFLICT: 本机投影存在但 Git 记录缺失'],
        );
      }
      return { ok: true };
    }
    if (args.input.expected.expectedAbsent === true) {
      return conflict(
        `需求 ${args.input.metadata.id} 已存在于 Git 基线 ${args.revision}（recordVersion ${head.version}，记录路径 ${head.recordPath}），不能按创建保存`,
        [
          'REQUIREMENT_CONFLICT: 预期不存在却已存在',
          '用户修复 Git 记录后显式重新导入再保存（requirements.md §4）',
        ],
      );
    }
    const expectedVersion = args.input.expected.recordVersion ?? args.previous?.recordVersion;
    const expectedHash = args.input.expected.recordHash ?? args.previous?.portableRef.hash;
    if (expectedVersion !== undefined && head.version < expectedVersion) {
      return conflict(
        `Git 基线 ${args.revision} 的需求 ${args.input.metadata.id}（记录路径 ${head.recordPath}）recordVersion 为 ${head.version}，低于期望 ${expectedVersion}；禁止旧投影覆盖`,
        ['REQUIREMENT_CONFLICT: HEAD 版本低于期望'],
      );
    }
    if (
      expectedVersion !== undefined &&
      head.version === expectedVersion &&
      expectedHash !== undefined &&
      head.recordHash !== expectedHash
    ) {
      return conflict(
        `Git 基线 ${args.revision} 的需求 ${args.input.metadata.id}（记录路径 ${head.recordPath}）与期望内容不同：期望 ${expectedHash}，实际 ${head.recordHash}；投影未刷新时拒绝覆盖`,
        [
          'REQUIREMENT_CONFLICT: 同 recordVersion 不同内容',
          '用户修复 Git 后显式重试才能基于新投影保存（AC-093）',
        ],
      );
    }
    if (
      expectedVersion !== undefined &&
      head.version > expectedVersion &&
      args.previous !== undefined &&
      args.previous.recordVersion === expectedVersion
    ) {
      return conflict(
        `Git 基线 ${args.revision} 的需求 ${args.input.metadata.id}（记录路径 ${head.recordPath}）已前进到 recordVersion ${head.version}（本机投影 ${expectedVersion}）；先刷新投影或显式重试`,
        ['REQUIREMENT_CONFLICT: Git 记录已前进，本机投影未刷新'],
      );
    }
    return { ok: true };
  }

  /** Creates or rewinds the detached worktree the requirement commit is built in. */
  private prepareWorktree(input: {
    readonly repoRoot: string;
    readonly worktreePath: string;
    readonly baseRevision: string;
  }): { ok: true } | { ok: false; failure: RequirementSaveOutcome } {
    const listed = this.worktrees.listWorktrees(input.repoRoot);
    if (!listed.ok) {
      return {
        ok: false,
        failure: this.refusal(
          'INTERNAL_ERROR',
          '无法列出 Git worktree',
          listed.errors.map((error) => error.message),
        ),
      };
    }
    const wanted = canonicalPath(input.worktreePath) ?? input.worktreePath;
    const existing = listed.value.find((entry) => canonicalPath(entry.path) === wanted);
    if (existing !== undefined) {
      // `W8R2-01`: a leftover worktree is only reusable at the expected base. A
      // crashed attempt can have committed on it (or left it parked elsewhere), and
      // building the retry's commit there would move the delivery branch back to a
      // stale basis. The base is re-established with a real `git reset --hard`, so
      // the retry still starts from exactly the revision it compared against.
      if (existing.head !== input.baseRevision) {
        const reset = this.worktrees.resetHard(existing.path, input.baseRevision);
        if (!reset.ok) {
          return {
            ok: false,
            failure: this.refusal(
              'INTERNAL_ERROR',
              `需求保存 worktree ${existing.path} 停在 ${existing.head ?? 'unknown'}，不是期望基点 ${input.baseRevision}，且无法复位`,
              reset.errors.map((error) => error.message),
            ),
          };
        }
      }
      return { ok: true };
    }
    mkdirSync(dirname(input.worktreePath), { recursive: true });
    const added = this.worktrees.addWorktree({
      repoRoot: input.repoRoot,
      path: input.worktreePath,
      baseRevision: input.baseRevision,
    });
    if (!added.ok) {
      return {
        ok: false,
        failure: this.refusal(
          'INTERNAL_ERROR',
          `创建需求保存 worktree 失败：${input.worktreePath}`,
          added.errors.map((error) => error.message),
        ),
      };
    }
    return { ok: true };
  }

  private cleanupWorktree(repoRoot: string, worktreePath: string): void {
    if (this.keepWorktree) return;
    const listed = this.worktrees.listWorktrees(repoRoot);
    if (!listed.ok) return;
    const wanted = canonicalPath(worktreePath) ?? worktreePath;
    const entry = listed.value.find((candidate) => canonicalPath(candidate.path) === wanted);
    if (entry === undefined) {
      rmSync(worktreePath, { recursive: true, force: true });
      return;
    }
    this.worktrees.removeWorktree(repoRoot, entry.path, true);
  }

  private writeRecord(worktreePath: string, relativePath: string, content: string): void {
    const absolute = join(worktreePath, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }

  /**
   * Writes the committed record bytes back into the delivery working tree.
   *
   * The bytes are the ones Git just committed, so this is the working-copy half of
   * the save: without it the pool directory on disk would lag the branch that now
   * holds the record. The README is rebuilt from the same records, which keeps the
   * index (`requirements.md` §6 "可重建导航索引") consistent with the directory.
   *
   * `W8R2-06`: the write-back is gated on the target paths being clean. Before this
   * check the committed bytes unconditionally replaced whatever was on disk, so a
   * locally edited `content.md` was silently lost. A dirty target raises
   * `DeliveryWorktreeDirtyError` and the caller reports it (AC-028).
   *
   * `W8R3-03`: a *clean* checkout parked at another revision is not a local edit. The
   * delivery worktree is rewound to the ref revision (never while any local change is
   * present, and never when it is on an unrelated branch) so the projection repair
   * converges instead of refusing forever.
   */
  private refreshWorkingTree(input: {
    readonly repoRoot: string;
    /** The revision the new commit was based on. */
    readonly baselineRevision: string;
    /** The revision the delivery ref now holds. */
    readonly targetRevision: string;
    readonly branch: string;
    readonly prepared: PreparedRequirementRecord;
    readonly poolRecords: readonly RequirementPoolRevisionRecord[];
  }): void {
    const targets = [
      { path: input.prepared.metadataPath, content: input.prepared.metadataJson },
      { path: input.prepared.contentPath, content: input.prepared.contentMarkdown },
      { path: REQUIREMENTS_README, content: requirementPoolReadme(input.poolRecords) },
    ];
    const dirty = this.dirtyDeliveryPaths({
      repoRoot: input.repoRoot,
      baselineRevision: input.baselineRevision,
      targets,
      knownRevisions: this.knownDeliveryRevisions(input.prepared.record.id),
    });
    if (dirty.paths.length > 0) {
      throw new DeliveryWorktreeDirtyError(dirty.paths, dirty.porcelainLines);
    }
    this.rewindCleanCheckout({
      repoRoot: input.repoRoot,
      branch: input.branch,
      targetRevision: input.targetRevision,
    });
    for (const target of targets) this.writeRecord(input.repoRoot, target.path, target.content);
  }

  /**
   * Committed revisions this machine may legitimately have checked out (`W8R3-03`).
   *
   * The local projection records the revision of the last record this machine saved;
   * when the delivery ref moves underneath (another server committed without a
   * checkout) the on-disk bytes still describe that revision, which is a stale
   * checkout rather than an uncommitted local edit.
   */
  private knownDeliveryRevisions(recordId: string): readonly string[] {
    const local = this.store.requirements.find(recordId);
    return local === undefined ? [] : [local.portableRef.revision];
  }

  /**
   * The target paths that carry *uncommitted local edits* (`W8R2-06`, `W8R3-03`).
   *
   * Git's own worktree column is the authority: an unstaged modification (` M`, ` D`)
   * is a local edit. A path whose bytes differ from the patch but which Git reports as
   * staged-only (after a ref move without checkout) or as a clean checkout of another
   * revision is *not* a local edit — its delete/overwrite is exactly what the save is
   * repairing. Untracked content that differs from what the save would write is a
   * local edit too, because there is no committed revision that explains it.
   */
  private dirtyDeliveryPaths(input: {
    readonly repoRoot: string;
    readonly baselineRevision: string;
    readonly targets: readonly { readonly path: string; readonly content: string }[];
    readonly knownRevisions: readonly string[];
  }): { readonly paths: readonly string[]; readonly porcelainLines: readonly string[] } {
    const { repoRoot, baselineRevision, targets } = input;
    const status = this.worktrees.statusPorcelain(repoRoot);
    const lines = status.ok ? status.value : [];
    // A completely clean worktree has no local edits by definition: whatever the
    // bytes are, they belong to a committed checkout, and the caller rewinds it.
    if (status.ok && lines.length === 0) return { paths: [], porcelainLines: [] };
    const head = this.worktrees.headRevision(repoRoot);
    const knownRevisions = [
      ...(head.ok && head.value !== null ? [head.value] : []),
      ...input.knownRevisions,
    ];
    const dirty = new Set<string>();
    const porcelainLines: string[] = [];
    for (const target of targets) {
      const relevant = lines.filter((line) => porcelainTouches(line, target.path));
      const worktreeSide = relevant.filter((line) => {
        const code = line.slice(1, 2);
        return code !== ' ' && code !== '?';
      });
      const untracked = relevant.filter((line) => line.startsWith('??'));
      let onDisk: string | null;
      let unreadable = false;
      try {
        onDisk = readFileSync(join(repoRoot, target.path), 'utf8');
      } catch (error) {
        onDisk = null;
        // Anything other than "the path does not exist" (a directory, a permission
        // problem) is left to the write itself, which reports it as a refresh
        // failure instead of a dirty path (`W8R3-02`).
        unreadable = (error as { readonly code?: unknown }).code !== 'ENOENT';
      }
      if (!unreadable && onDisk !== null && onDisk === target.content) continue;
      if (!unreadable && onDisk !== null) {
        const committed = this.worktrees.readBlob(repoRoot, baselineRevision, target.path);
        if (committed.ok && committed.value === onDisk) continue;
        if (worktreeSide.length > 0) {
          dirty.add(target.path);
          porcelainLines.push(...worktreeSide);
          continue;
        }
        // Bytes that equal a committed revision this machine legitimately has checked
        // out are a stale checkout (`W8R3-03`), even when the index is far enough
        // behind that Git reports the whole pool directory as untracked.
        if (
          knownRevisions.some((revision) => {
            const blob = this.worktrees.readBlob(repoRoot, revision, target.path);
            return blob.ok && blob.value === onDisk;
          })
        ) {
          continue;
        }
        if (untracked.length > 0) {
          dirty.add(target.path);
          porcelainLines.push(...untracked);
          continue;
        }
        dirty.add(target.path);
        porcelainLines.push(...relevant);
        continue;
      }
      // Absent paths are the normal create case; a worktree-side deletion is a local
      // edit and must never be silently recreated.
      if (!unreadable && worktreeSide.length > 0) {
        dirty.add(target.path);
        porcelainLines.push(...worktreeSide);
      }
    }
    return { paths: [...dirty].sort(), porcelainLines };
  }

  /**
   * Rewinds a *completely clean* delivery worktree that is parked at another revision
   * (`W8R3-03`).
   *
   * Only a worktree with no tracked modification and no untracked file is rewound, and
   * only when it is detached or on the delivery branch — an unrelated branch is never
   * moved. After the CAS the ref revision is the correct checkout, so this makes the
   * repair converge instead of leaving the branch ahead of the working copy.
   */
  private rewindCleanCheckout(input: {
    readonly repoRoot: string;
    readonly branch: string;
    readonly targetRevision: string;
  }): void {
    const status = this.worktrees.statusPorcelain(input.repoRoot);
    if (!status.ok || status.value.length > 0) return;
    const head = this.worktrees.headRevision(input.repoRoot);
    if (!head.ok || head.value === null || head.value === input.targetRevision) return;
    const listed = this.worktrees.listWorktrees(input.repoRoot);
    if (listed.ok) {
      const wanted = canonicalPath(input.repoRoot) ?? input.repoRoot;
      const entry = listed.value.find(
        (candidate) => (canonicalPath(candidate.path) ?? candidate.path) === wanted,
      );
      if (
        entry !== undefined &&
        !entry.detached &&
        entry.branchRef !== `refs/heads/${input.branch}`
      ) {
        return;
      }
    }
    const reset = this.worktrees.resetHard(input.repoRoot, input.targetRevision);
    if (!reset.ok) {
      throw new ProtocolError(
        'INTERNAL_ERROR',
        `交付工作树停在 ${head.value}，无法复位到 ${input.targetRevision}`,
        { details: { errors: reset.errors.length } },
      );
    }
  }

  /**
   * Reports a working-copy write-back that failed for a reason other than a dirty
   * path (`W8R3-02`).
   *
   * Git already holds the commit, but the on-disk pool could not be updated (a
   * read-only directory, an `EISDIR` where a file is expected, ...). Reporting
   * `saved` here would claim a working copy that does not exist; the caller gets a
   * repair-only `RECOVERY_REQUIRED` and can retry the write-back.
   */
  private worktreeRefreshRefusal(args: {
    readonly input: SaveRequirementInput;
    readonly project: { readonly branch: string; readonly ref: string; readonly repoRoot: string };
    readonly record: PortableRequirement;
    readonly operationRowId: string;
    readonly stepResults: JsonObject;
    readonly targetRevision: string;
    readonly targetTree: string;
    readonly recordHash: string;
    readonly message: string;
  }): RequirementSaveOutcome {
    const message = `需求已提交 ${args.targetRevision}，但交付工作副本写回失败：${args.message}；分支未被回滚，修复工作副本后用同一 operationId 重试（只补投影）`;
    this.updateOperation(args.operationRowId, {
      state: SAVE_OPERATION_STATE.projectionFailed,
      candidateRevision: args.targetRevision,
      stepResults: { ...args.stepResults, worktreeRefreshFailed: true },
      error: { code: 'RECOVERY_REQUIRED', message },
    });
    this.appendDiagnostic(REQUIREMENT_WORKTREE_REFRESH_FAILED_EVENT, args.input, args.record.id, {
      message: args.message,
      targetRevision: args.targetRevision,
    });
    return this.refusal(
      'RECOVERY_REQUIRED',
      message,
      [args.message],
      this.recoveryOperation({
        input: args.input,
        ref: args.project.ref,
        expectedRevision: null,
        targetRevision: args.targetRevision,
        targetTree: args.targetTree,
        recordHash: args.recordHash,
        repairOnly: true,
        messages: [args.message],
      }),
      false,
    );
  }

  /** Reports a refused working-copy refresh without touching the dirty content. */
  private dirtyWorktreeRefusal(args: {
    readonly input: SaveRequirementInput;
    readonly project: { readonly branch: string; readonly ref: string; readonly repoRoot: string };
    readonly record: PortableRequirement;
    readonly operationRowId: string;
    readonly stepResults: JsonObject;
    readonly targetRevision: string;
    readonly targetTree: string;
    readonly recordHash: string;
    readonly error: DeliveryWorktreeDirtyError;
  }): RequirementSaveOutcome {
    const message = `需求已提交 ${args.targetRevision}，但交付工作树中的 ${args.error.paths.join('、')} 有未提交的本地修改，拒绝用提交字节覆盖；先提交、暂存或丢弃这些修改后重试`;
    this.updateOperation(args.operationRowId, {
      state: SAVE_OPERATION_STATE.projectionFailed,
      candidateRevision: args.targetRevision,
      stepResults: { ...args.stepResults, dirtyPaths: [...args.error.paths] },
      error: { code: 'RECOVERY_REQUIRED', message },
    });
    this.appendDiagnostic(REQUIREMENT_WORKTREE_DIRTY_EVENT, args.input, args.record.id, {
      paths: [...args.error.paths],
      porcelain: [...args.error.porcelainLines],
      targetRevision: args.targetRevision,
    });
    return this.refusal(
      'RECOVERY_REQUIRED',
      message,
      [message],
      this.recoveryOperation({
        input: args.input,
        ref: args.project.ref,
        expectedRevision: null,
        targetRevision: args.targetRevision,
        targetTree: args.targetTree,
        recordHash: args.recordHash,
        repairOnly: true,
        messages: [message],
      }),
      false,
    );
  }

  private treeOf(repoRoot: string, revision: string): string {
    const tree = this.worktrees.mergeTree(repoRoot, revision);
    if (!tree.ok || tree.value === null) {
      throw new ProtocolError('INTERNAL_ERROR', `读取 ${revision} 的 tree 失败`);
    }
    return tree.value;
  }

  /**
   * Refreshes the local projection through the shared importer, so the save path
   * and the Clone-import path apply exactly the same conflict rules (`AC-092/093`).
   */
  private refreshProjection(input: {
    readonly record: PortableRequirement;
    readonly revision: string;
    readonly rawMetadata: string;
    readonly workId?: string;
  }): { readonly verdict: ImportVerdict; readonly revision: string } {
    return withTransaction(this.store.db, () => {
      const projection = new RequirementProjection({ store: this.store });
      const outcome = projection.import({
        record: input.record,
        rawMetadata: input.rawMetadata,
        portableRef: {
          path: requirementRecordDirectory(input.record.id),
          revision: input.revision,
        },
        ...(input.workId === undefined ? {} : { workId: input.workId }),
        recordCommitted: true,
      });
      if (outcome.verdict === 'conflict') {
        throw new ProtocolError('REQUIREMENT_CONFLICT', outcome.conflict.reason, {
          details: {
            requirementId: outcome.conflict.requirementId,
            localRecordHash: outcome.conflict.localRecordHash,
            incomingRecordHash: outcome.conflict.incomingRecordHash,
          },
        });
      }
      return { verdict: outcome.verdict, revision: input.revision };
    });
  }

  /**
   * Emits the one `requirement.saved` event of an operation, exactly once.
   *
   * The normal path lets the CAS service own the completion event. A projection
   * repair can be the first call to reach this point — the crash happened between
   * the ref update and the status write — so it emits the event itself, guarded by
   * the event log (`reliability.md` §5).
   */
  private emitSavedEventOnce(input: {
    readonly operationId: string;
    readonly record: PortableRequirement;
    readonly revision: string;
  }): boolean {
    // The event log itself is the guard (`reliability.md` §5): the same
    // `operationId` must never produce a second `requirement.saved`.
    const existing = this.store.db
      .prepare(`SELECT data FROM event WHERE name = ?`)
      .all(REQUIREMENT_SAVED_EVENT) as { readonly data: string }[];
    for (const row of existing) {
      const data: unknown = JSON.parse(row.data);
      if (typeof data !== 'object' || data === null) continue;
      if ((data as { readonly operationId?: unknown }).operationId === input.operationId) {
        return false;
      }
    }
    this.store.events.append({
      name: REQUIREMENT_SAVED_EVENT,
      entityId: input.record.id,
      entityVersion: this.store.requirements.find(input.record.id)?.version ?? 0,
      data: {
        operationId: input.operationId,
        revision: input.revision,
        contentHash: input.record.contentHash,
      },
    });
    return true;
  }

  /** Records the durable intent of one save (`operation` row, `reliability.md` §9). */
  private recordOperation(input: {
    readonly id: string;
    readonly input: SaveRequirementInput;
    readonly state: OperationState;
    readonly expectedHead: string;
    readonly candidateRevision: string;
    readonly stepResults: JsonObject;
  }): void {
    this.store.operations.insert({
      id: input.id,
      projectId: this.store.projectId,
      // `operation.requirement_id` is a foreign key, so it is only set when the
      // record already has a local row; a *create* save has no row until its
      // projection is written, and the id still travels in `stepResults`.
      ...(this.store.requirements.find(input.input.metadata.id) === undefined
        ? {}
        : { requirementId: input.input.metadata.id }),
      sourceRef: {
        kind: input.input.sourceRef.kind,
        id: input.input.sourceRef.id,
        version: input.input.sourceRef.version ?? '1',
      },
      kind: REQUIREMENT_SAVE_OPERATION_KIND,
      state: input.state,
      expectedHead: input.expectedHead,
      candidateRevision: input.candidateRevision,
      stepResults: input.stepResults,
      createdAt: this.now(),
      updatedAt: this.now(),
    });
  }

  private updateOperation(
    id: string,
    patch: {
      readonly state: OperationState;
      readonly stepResults: JsonObject;
      readonly candidateRevision?: string;
      readonly error?: JsonObject;
    },
  ): void {
    const row = this.store.operations.find(id);
    if (row === undefined) return;
    this.store.operations.update(
      id,
      {
        state: patch.state,
        stepResults: patch.stepResults,
        ...(patch.candidateRevision === undefined
          ? {}
          : { candidateRevision: patch.candidateRevision }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
      },
      row.version,
    );
  }

  private appendDiagnostic(
    name: string,
    input: SaveRequirementInput,
    requirementId: string,
    data: JsonObject,
  ): void {
    this.store.events.append({
      name,
      entityId: requirementId,
      entityVersion: this.store.requirements.find(requirementId)?.version ?? 0,
      data: { operationId: input.operationId, ...data },
    });
  }

  private commitMessage(input: SaveRequirementInput, record: PortableRequirement): string {
    const title = record.title.replace(/\s+/gu, ' ').trim();
    return `doc(requirement): ${input.kind ?? 'update'} 需求 ${title}`;
  }

  private worktreePathFor(input: SaveRequirementInput): string {
    return input.worktreePath ?? join(this.worktreeRoot, input.operationId);
  }

  /** Whether any upstream ref already contains `revision` (`AC-090` UI state). */
  private upstreamState(
    repoRoot: string,
    branch: string,
    revision: string,
  ): { readonly unpushed: boolean; readonly upstreamRevision: string | null } {
    let upstreamRevision: string | null = null;
    for (const name of [`refs/remotes/origin/${branch}`, `${branch}@{u}`]) {
      const found = this.worktrees.resolveRevision(repoRoot, name);
      if (found.ok && found.value !== null) {
        upstreamRevision = found.value;
        break;
      }
    }
    if (upstreamRevision === null) return { unpushed: true, upstreamRevision: null };
    const contained = this.worktrees.isAncestor(repoRoot, revision, upstreamRevision);
    if (!contained.ok) return { unpushed: true, upstreamRevision };
    return { unpushed: !contained.value, upstreamRevision };
  }

  private recoveryOperation(input: {
    readonly input: SaveRequirementInput;
    readonly ref: string;
    readonly expectedRevision: string | null;
    readonly targetRevision?: string;
    readonly targetTree?: string;
    readonly recordHash?: string;
    readonly repairOnly: boolean;
    readonly messages: readonly string[];
  }): RequirementSaveRecoveryOperation {
    return {
      kind: REQUIREMENT_SAVE_RETRY_KIND,
      operationId: input.input.operationId,
      ref: input.ref,
      expectedRevision: input.expectedRevision,
      ...(input.input.expected.recordVersion === undefined
        ? {}
        : { expectedRecordVersion: input.input.expected.recordVersion }),
      ...(input.input.expected.recordHash === undefined
        ? {}
        : { expectedRecordHash: input.input.expected.recordHash }),
      expectedAbsent: input.input.expected.expectedAbsent === true,
      ...(input.targetRevision === undefined ? {} : { targetRevision: input.targetRevision }),
      ...(input.targetTree === undefined ? {} : { targetTree: input.targetTree }),
      ...(input.recordHash === undefined ? {} : { recordHash: input.recordHash }),
      repairOnly: input.repairOnly,
      recordPath: requirementRecordDirectory(input.input.metadata.id),
      messages: [...input.messages],
    };
  }
}

/** One string field of an `operation.stepResults` payload. */
function stepString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

/** Convenience factory wiring the production CAS pieces together. */
export function createRequirementSaveService(options: {
  readonly store: ProjectStore;
  readonly worktrees: WorktreeGitPort;
  readonly journal: CasJournal;
  readonly events: CasEventPort;
  readonly cas?: CasService;
  readonly lock?: ProjectIntegrationLock;
  readonly worktreeRoot?: string;
  readonly now?: () => string;
  readonly keepWorktree?: boolean;
}): RequirementSaveService {
  return new RequirementSaveService({
    store: options.store,
    worktrees: options.worktrees,
    journal: options.journal,
    events: options.events,
    cas:
      options.cas ??
      createCasService({
        git: options.worktrees,
        journal: options.journal,
        events: options.events,
      }),
    ...(options.lock === undefined ? {} : { lock: options.lock }),
    ...(options.worktreeRoot === undefined ? {} : { worktreeRoot: options.worktreeRoot }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.keepWorktree === undefined ? {} : { keepWorktree: options.keepWorktree }),
  });
}

/** A `Requirement` row's combined record hash. */
export function projectedRecordHash(row: Requirement): string {
  return row.portableRef.hash;
}

/** `true` when the row was projected from `revision`. */
export function projectedFrom(row: Requirement, revision: string): boolean {
  return row.portableRef.revision === revision;
}
