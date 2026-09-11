/**
 * Project initialization state machine (`docs/product/knowledge.md` §4/§5,
 * `docs/architecture/context.md` §4, `docs/architecture/ARCHITECTURE.md` §4).
 *
 * Phases: Identifying → Mapping → Confirming → Writing → Ready, with Blocked and
 * Failed as explicit non-terminal/terminal outcomes. One `step` advances one
 * phase and records evidence; every state change is persisted through
 * `InitStateStore` (in-memory or JSON file) so a process that dies mid-way is
 * resumed rather than restarted.
 *
 * Guarantees this module implements:
 *
 * - **Interruption recovery**: Writing persists a receipt after each document. On
 *   retry, every document is compared by content hash against what is on disk;
 *   a matching file is skipped (`unchanged`), so already-written candidates are
 *   never rewritten.
 * - **Conflict, never clobber**: an existing file whose hash differs from the
 *   candidate hash stops Writing with a `content-conflict` failure that reports
 *   both hashes. `resume` refuses until the file is removed or changed; the file
 *   is never overwritten.
 * - **Dirty workspace** (`ARCHITECTURE.md` §4): uncommitted user files block the
 *   delivery write with a per-path hash report until the user chooses an explicit
 *   handling (`committed` / `patch` / `discard` / `authorized`); read-only
 *   investigation keeps working in every state.
 * - **No Git** (`knowledge.md` §5): investigation and candidate documents are
 *   produced, but Writing returns `Blocked` carrying the Git-initialization
 *   authorization request until the user explicitly authorizes it.
 * - **Design conflict** (AC-042): a candidate that disagrees with an existing
 *   formal document blocks Confirming and is reported; the candidate stays
 *   `design=unconfirmed` and the existing document is never silently confirmed.
 * - **Delivery refs**: nothing here updates a delivery ref; every candidate
 *   document is marked `candidate: true` / `deliveryRef: null` and the Ready gate
 *   re-checks that invariant.
 */
import { Buffer } from 'node:buffer';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parseFeatureDocument } from '@agentdev/knowledge';
import {
  WorkspaceError,
  canonicalPath,
  isMissingPathError,
  parsePorcelainLine,
  sha256Hex,
  type GitPort,
  type WorkspaceDiagnostic,
} from './git-port.js';
import {
  DEFAULT_DOCUMENT_ROOT,
  generateCandidateKnowledge,
  normalizeDocumentRoot,
  readKnowledgeDocuments,
  resolveProject,
  scanProject,
  type CandidateDocument,
  type KnowledgeConflict,
  type Observation,
  type ScanBudget,
  type ScanRead,
  type ScanUnknown,
} from './scan.js';

/** Default delivery branch for a project (`ARCHITECTURE.md` §4). */
export const INIT_DELIVERY_BRANCH = 'agentdev/main';

/** Ordered phases of the initialization state machine. */
export const INIT_PHASES = ['identifying', 'mapping', 'confirming', 'writing', 'ready'] as const;
export type InitPhase = (typeof INIT_PHASES)[number];

export type InitStatus = InitPhase | 'blocked' | 'failed';

/** The file-system seam: real (node) and in-memory implementations below. */
export interface FileSystemPort {
  /** UTF-8 file content, or `null` when the path is not a readable file. */
  readFile(path: string): string | null;
  /** Writes atomically (temp file + rename), creating parent directories. */
  writeFile(path: string, content: string): void;
  pathExists(path: string): boolean;
}

let temporaryCounter = 0;

/** Real file system: temp file + fsync + rename, so a reader never sees a partial file. */
export function createNodeFileSystemPort(): FileSystemPort {
  return {
    readFile(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch (error) {
        if (isMissingPathError(error)) return null;
        const code = (error as { readonly code?: unknown }).code;
        if (code === 'EISDIR') return null;
        throw new WorkspaceError('INTERNAL_ERROR', `无法读取文件：${path}`, { cause: error });
      }
    },
    writeFile(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      temporaryCounter += 1;
      const temporary = `${path}.agentdev-${process.pid}-${temporaryCounter}.tmp`;
      const descriptor = openSync(temporary, 'w');
      try {
        writeSync(descriptor, content, null, 'utf8');
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, path);
    },
    pathExists(path) {
      try {
        readFileSync(path);
        return true;
      } catch (error) {
        if (isMissingPathError(error)) return false;
        const code = (error as { readonly code?: unknown }).code;
        if (code === 'EISDIR') return true;
        throw new WorkspaceError('INTERNAL_ERROR', `无法检查路径：${path}`, { cause: error });
      }
    },
  };
}

export interface MemoryFileSystemPort extends FileSystemPort {
  /** The in-memory file contents, keyed by absolute path. */
  files(): Readonly<Record<string, string>>;
}

/** In-memory `FileSystemPort` for tests and callers without a real disk. */
export function createMemoryFileSystemPort(
  initial: Readonly<Record<string, string>> = {},
): MemoryFileSystemPort {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    readFile(path) {
      return files.get(path) ?? null;
    },
    writeFile(path, content) {
      files.set(path, content);
    },
    pathExists(path) {
      return files.has(path);
    },
    files() {
      return Object.fromEntries(files);
    },
  };
}

export type InitEvidenceKind =
  | 'start'
  | 'identify'
  | 'scan'
  | 'conflict'
  | 'confirmation'
  | 'git-authorization'
  | 'git-init'
  | 'commit'
  | 'dirty-report'
  | 'write'
  | 'gate'
  | 'blocked'
  | 'failure'
  | 'resume'
  | 'conflict-resolution';

/** One recorded step result; the evidence trail the caller reports. */
export interface InitEvidence {
  /** Phase that produced the evidence. */
  readonly phase: InitPhase;
  /** UTC ISO8601 milliseconds. */
  readonly at: string;
  readonly kind: InitEvidenceKind;
  readonly detail: string;
  readonly refs: readonly string[];
}

/** One dirty path with its observed working-tree hash. */
export interface DirtyPathReport {
  readonly path: string;
  /** The porcelain XY state. */
  readonly state: string;
  /** `sha256` of the working-tree content, or `null` for a deleted path. */
  readonly sha256: string | null;
}

/** The Git-initialization authorization Writing requires for a no-Git directory. */
export interface GitInitializationRequest {
  readonly kind: 'git-initialization';
  readonly root: string;
  readonly branch: string;
  /** `true` when the directory is empty and needs an empty initial commit. */
  readonly initialCommit: boolean;
  readonly reason: string;
}

/** One fact the initialization inferred and the user must confirm. */
export interface InitInference {
  readonly id: string;
  readonly kind: 'module-intent' | 'empty-project' | 'design-conflict';
  readonly detail: string;
  readonly requiresConfirmation: boolean;
  readonly refs: readonly string[];
}

export type InitBlocker =
  | {
      readonly kind: 'git-initialization';
      readonly request: GitInitializationRequest;
      readonly message: string;
    }
  | {
      readonly kind: 'git-error';
      readonly message: string;
      readonly errors: readonly WorkspaceDiagnostic[];
    }
  | {
      readonly kind: 'dirty-workspace';
      readonly hashReport: readonly DirtyPathReport[];
      readonly message: string;
    }
  | {
      readonly kind: 'confirmation-required';
      readonly inferences: readonly InitInference[];
      readonly message: string;
    }
  | {
      readonly kind: 'design-conflict';
      readonly conflicts: readonly KnowledgeConflict[];
      readonly message: string;
    };

/** Error code each blocker kind is reported under. */
export const BLOCKER_CODES: Readonly<Record<InitBlocker['kind'], WorkspaceDiagnostic['code']>> = {
  'git-initialization': 'NOT_AUTHORIZED',
  'git-error': 'INTERNAL_ERROR',
  'dirty-workspace': 'INVALID_STATE',
  'confirmation-required': 'GATE_NOT_READY',
  'design-conflict': 'KNOWLEDGE_INVALID',
};

export type InitFailureKind =
  'interrupted' | 'content-conflict' | 'ready-gate' | 'git-error' | 'internal';

export interface InitFailure {
  readonly kind: InitFailureKind;
  readonly message: string;
  /** `true` when `resume` may retry the same phase after the cause is handled. */
  readonly recoverable: boolean;
  readonly details: Readonly<Record<string, string>> | null;
}

/** A candidate file that already exists on disk with different content. */
export interface FileConflict {
  readonly path: string;
  readonly diskHash: string;
  readonly candidateHash: string;
  readonly at: string;
}

export interface InitWriteReceipt {
  /** Repo-relative path under `documentRoot`. */
  readonly path: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly state: 'written' | 'unchanged';
  readonly at: string;
}

export interface InitConfirmation {
  readonly authorizationRef: string;
  readonly by: string;
  readonly note: string | null;
  readonly at: string;
}

export interface GitAuthorization {
  readonly authorizationRef: string;
  readonly branch: string;
  readonly initialCommit: boolean;
  readonly at: string;
}

export type DirtyHandlingChoice = 'committed' | 'patch' | 'discard' | 'authorized';

export interface DirtyHandling {
  readonly authorizationRef: string;
  readonly choice: DirtyHandlingChoice;
  readonly hashReport: readonly DirtyPathReport[];
  readonly at: string;
}

export interface ConflictResolution {
  readonly documentPath: string;
  readonly kind: KnowledgeConflict['kind'];
  readonly decisionRef: string;
  readonly at: string;
}

/**
 * Durable initialization state.
 *
 * `candidate`/`deliveryRef` are literal invariants: this machine produces
 * candidates and never updates a delivery ref.
 */
export interface InitRecord {
  readonly id: string;
  /** Canonical project root (Git root once one exists). */
  readonly root: string;
  readonly projectId: string | null;
  readonly documentRoot: string;
  readonly branch: string;
  readonly phase: InitPhase;
  readonly status: InitStatus;
  readonly candidate: true;
  readonly deliveryRef: null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly gitRoot: string | null;
  readonly gitRevision: string | null;
  readonly emptyProject: boolean;
  readonly needsGitInitialization: boolean;
  readonly scanPartial: boolean;
  readonly featureCount: number;
  readonly unknowns: readonly string[];
  readonly observations: readonly Observation[];
  readonly reads: readonly ScanRead[];
  readonly conflicts: readonly KnowledgeConflict[];
  readonly inferences: readonly InitInference[];
  readonly documents: readonly CandidateDocument[];
  readonly writes: readonly InitWriteReceipt[];
  readonly fileConflicts: readonly FileConflict[];
  readonly evidence: readonly InitEvidence[];
  readonly blockers: readonly InitBlocker[];
  readonly blocked: InitBlocker | null;
  readonly failure: InitFailure | null;
  readonly confirmation: InitConfirmation | null;
  readonly gitAuthorization: GitAuthorization | null;
  readonly dirtyHandling: DirtyHandling | null;
  readonly conflictResolutions: readonly ConflictResolution[];
}

/** Persistence seam for initialization state. */
export interface InitStateStore {
  load(id: string): InitRecord | null;
  save(record: InitRecord): void;
  list(): readonly InitRecord[];
}

/** In-memory store; records are cloned so callers cannot mutate stored state. */
export function createMemoryInitStateStore(initial: readonly InitRecord[] = []): InitStateStore {
  const records = new Map<string, InitRecord>();
  for (const record of initial) records.set(record.id, structuredClone(record));
  return {
    load(id) {
      const record = records.get(id);
      return record === undefined ? null : structuredClone(record);
    },
    save(record) {
      records.set(record.id, structuredClone(record));
    },
    list() {
      return [...records.values()].map((record) => structuredClone(record));
    },
  };
}

interface InitStateFile {
  readonly version: 1;
  readonly records: Readonly<Record<string, InitRecord>>;
}

/**
 * JSON-file store: one file holds every record so a resumed process sees exactly
 * the state the interrupted one persisted. A corrupt file is reported
 * (`INVALID_STATE`), never treated as empty.
 */
export function createJsonFileInitStateStore(filePath: string): InitStateStore {
  const read = (): Record<string, InitRecord> => {
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (error) {
      if (isMissingPathError(error)) return {};
      throw new WorkspaceError('INTERNAL_ERROR', `无法读取初始化状态文件：${filePath}`, {
        cause: error,
      });
    }
    if (text.trim() === '') return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new WorkspaceError('INVALID_STATE', `初始化状态文件不是合法 JSON：${filePath}`, {
        cause: error,
      });
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new WorkspaceError('INVALID_STATE', `初始化状态文件结构非法：${filePath}`);
    }
    const records = (parsed as { readonly records?: unknown }).records;
    if (typeof records !== 'object' || records === null) {
      throw new WorkspaceError('INVALID_STATE', `初始化状态文件缺少 records：${filePath}`);
    }
    return records as Record<string, InitRecord>;
  };

  const write = (records: Readonly<Record<string, InitRecord>>): void => {
    mkdirSync(dirname(filePath), { recursive: true });
    temporaryCounter += 1;
    const temporary = `${filePath}.agentdev-${process.pid}-${temporaryCounter}.tmp`;
    const payload: InitStateFile = { version: 1, records };
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(temporary, filePath);
  };

  return {
    load(id) {
      return read()[id] ?? null;
    },
    save(record) {
      write({ ...read(), [record.id]: record });
    },
    list() {
      return Object.values(read());
    },
  };
}

/** Result of the delivery-start readiness check. */
export type DeliveryReadiness =
  | { readonly ok: true; readonly root: string; readonly gitRevision: string | null }
  | { readonly ok: false; readonly blocker: InitBlocker };

export interface DeliveryReadinessInput {
  readonly root: string;
  readonly git: GitPort;
  readonly fileSystem?: FileSystemPort;
  readonly branch?: string;
  /** `true` when the directory is empty and needs an empty initial commit. */
  readonly initialCommit?: boolean;
  /** `true` once the user explicitly handled a reported dirty workspace. */
  readonly handled?: boolean;
}

/** Builds the per-path hash report of a dirty workspace. */
export function dirtyHashReport(input: {
  readonly root: string;
  readonly lines: readonly string[];
  readonly fileSystem: FileSystemPort;
}): readonly DirtyPathReport[] {
  const report: DirtyPathReport[] = [];
  for (const line of input.lines) {
    const entry = parsePorcelainLine(line);
    for (const path of entry.paths) {
      const content = input.fileSystem.readFile(join(input.root, path));
      report.push({
        path,
        state: entry.state,
        sha256: content === null ? null : sha256Hex(content),
      });
    }
  }
  return report;
}

/**
 * Checks whether a delivery write may start.
 *
 * A no-Git directory returns the Git-initialization authorization request; a
 * dirty workspace returns its hash report; a Git failure returns the raw
 * diagnostics. Read-only investigation does not call this at all.
 */
export function checkDeliveryReadiness(input: DeliveryReadinessInput): DeliveryReadiness {
  const fileSystem = input.fileSystem ?? createNodeFileSystemPort();
  const branch = input.branch ?? INIT_DELIVERY_BRANCH;
  const resolved = input.git.resolveRoot(input.root);
  if (!resolved.ok) {
    return {
      ok: false,
      blocker: {
        kind: 'git-error',
        message: 'Git 探测失败，无法判定交付就绪',
        errors: resolved.errors,
      },
    };
  }
  if (resolved.value === null) {
    return {
      ok: false,
      blocker: {
        kind: 'git-initialization',
        request: {
          kind: 'git-initialization',
          root: input.root,
          branch,
          initialCommit: input.initialCommit ?? true,
          reason: '正式写入候选文档前需用户明确授权在无 Git 目录初始化仓库并建立交付分支',
        },
        message: `目录不是 Git 仓库：${input.root}；正式写入需先获得 Git 初始化授权`,
      },
    };
  }
  const status = input.git.statusPorcelain(resolved.value);
  if (!status.ok) {
    return {
      ok: false,
      blocker: {
        kind: 'git-error',
        message: 'git status 失败，无法判定工作区状态',
        errors: status.errors,
      },
    };
  }
  if (status.value.length > 0 && input.handled !== true) {
    const hashReport = dirtyHashReport({ root: resolved.value, lines: status.value, fileSystem });
    return {
      ok: false,
      blocker: {
        kind: 'dirty-workspace',
        hashReport,
        message: `工作区有 ${hashReport.length} 个未提交路径，交付写入被阻断；需用户明确处置（只读调查不受影响）`,
      },
    };
  }
  const head = input.git.headRevision(resolved.value);
  if (!head.ok) {
    return {
      ok: false,
      blocker: { kind: 'git-error', message: 'git rev-parse HEAD 失败', errors: head.errors },
    };
  }
  return { ok: true, root: resolved.value, gitRevision: head.value };
}

export interface ReadyGateCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ReadyGateResult {
  readonly ok: boolean;
  readonly checks: readonly ReadyGateCheck[];
  readonly missing: readonly string[];
}

/** `document-root`-relative paths of the four entry documents. */
export const READY_ENTRY_DOCUMENTS: readonly string[] = [
  'PROJECT.md',
  'INDEX.md',
  'CODE_MAP.md',
  'features/README.md',
];

/**
 * The minimal Ready gate (`context.md` §4): the four entry documents are on disk,
 * there is at least one real capability or an explicit empty-project state,
 * sources/unknowns are discoverable, every candidate Feature document parses, no
 * conflict is unresolved, and no delivery ref was touched.
 */
export function evaluateReadyGate(input: {
  readonly record: InitRecord;
  readonly fileSystem: FileSystemPort;
}): ReadyGateResult {
  const { record, fileSystem } = input;
  const checks: ReadyGateCheck[] = [];

  const diskMismatch: string[] = [];
  const missingEntries: string[] = [];
  for (const document of record.documents) {
    const disk = fileSystem.readFile(join(record.root, document.path));
    if (disk === null || sha256Hex(disk) !== document.contentHash) diskMismatch.push(document.path);
  }
  for (const entry of READY_ENTRY_DOCUMENTS) {
    if (!record.documents.some((document) => document.documentPath === entry)) {
      missingEntries.push(entry);
    }
  }
  checks.push({
    id: 'candidate-documents-written',
    passed: diskMismatch.length === 0 && missingEntries.length === 0,
    detail:
      diskMismatch.length === 0 && missingEntries.length === 0
        ? `${record.documents.length} 个候选文档与磁盘 Hash 一致`
        : `磁盘不一致：${diskMismatch.join('、') || '无'}；缺少入口：${missingEntries.join('、') || '无'}`,
  });

  checks.push({
    id: 'feature-or-empty-project',
    passed: record.featureCount > 0 || record.emptyProject,
    detail:
      record.featureCount > 0
        ? `观察到 ${record.featureCount} 个候选能力`
        : record.emptyProject
          ? '明确空项目状态（尚无已实现能力）'
          : '既没有候选能力也不是明确的空项目状态',
  });

  checks.push({
    id: 'sources-and-unknowns',
    passed:
      (record.reads.length > 0 || record.emptyProject) &&
      (!record.scanPartial || record.unknowns.length > 0),
    detail: `读取正文 ${record.reads.length} 个（${record.scanPartial ? '部分地图' : '完整地图'}），未知 ${record.unknowns.length} 项`,
  });

  const parseFailures: string[] = [];
  for (const document of record.documents) {
    if (document.kind !== 'feature') continue;
    const parsed = parseFeatureDocument(document.markdown, {
      relativePath: document.documentPath,
      revision: record.gitRevision ?? '未调查',
    });
    if (!parsed.ok) {
      parseFailures.push(`${document.documentPath}: ${parsed.errors[0]?.message ?? '未知错误'}`);
    }
  }
  checks.push({
    id: 'documents-parse',
    passed: parseFailures.length === 0,
    detail:
      parseFailures.length === 0 ? '候选 Feature 文档全部符合规范格式' : parseFailures.join('；'),
  });

  const unresolved = record.conflicts.filter(
    (conflict) =>
      !record.conflictResolutions.some(
        (resolution) =>
          resolution.documentPath === conflict.documentPath && resolution.kind === conflict.kind,
      ),
  );
  checks.push({
    id: 'no-unresolved-conflict',
    passed: unresolved.length === 0,
    detail:
      unresolved.length === 0
        ? `冲突 ${record.conflicts.length} 项，均已处置或不存在`
        : `未处置冲突：${unresolved.map((conflict) => conflict.documentPath).join('、')}`,
  });

  const candidateOnly =
    record.candidate === true &&
    record.deliveryRef === null &&
    record.documents.every(
      (document) => document.candidate === true && document.deliveryRef === null,
    );
  checks.push({
    id: 'candidate-only-no-delivery-ref',
    passed: candidateOnly,
    detail: candidateOnly
      ? '全部产物为候选文档，未更新任何交付 ref'
      : '存在非候选产物或交付 ref 更新',
  });

  const missing = checks.filter((check) => !check.passed).map((check) => check.id);
  return { ok: missing.length === 0, checks, missing };
}

export interface StartInitInput {
  /** Stable initialization/operation id. */
  readonly id: string;
  /** Directory the user opened (realpath + Git root resolve in Identifying). */
  readonly root: string;
  readonly documentRoot?: string;
  readonly branch?: string;
}

export interface ConfirmInitInput {
  readonly authorizationRef: string;
  readonly by?: string;
  readonly note?: string;
}

export interface AuthorizeGitInitInput {
  readonly authorizationRef: string;
  /** The request the blocked result carried, echoed back unchanged. */
  readonly request: GitInitializationRequest;
}

export interface ResolveBlockerInput {
  readonly authorizationRef: string;
  /** Required for a dirty-workspace blocker. */
  readonly dirtyChoice?: DirtyHandlingChoice;
  readonly note?: string;
}

export interface ResolveConflictInput {
  readonly documentPath: string;
  readonly kind: KnowledgeConflict['kind'];
  readonly decisionRef: string;
}

export interface InitSuccess {
  readonly ok: true;
  readonly record: InitRecord;
  readonly phase: InitPhase;
  readonly status: InitStatus;
  /** `true` when this call changed the phase. */
  readonly advanced: boolean;
  /** `true` when the record reached Ready. */
  readonly done: boolean;
}

export interface InitBlocked {
  readonly ok: false;
  readonly status: 'blocked';
  readonly record: InitRecord;
  readonly phase: InitPhase;
  readonly blocker: InitBlocker;
  readonly errors: readonly WorkspaceDiagnostic[];
}

export interface InitFailed {
  readonly ok: false;
  readonly status: 'failed';
  readonly record: InitRecord;
  readonly phase: InitPhase;
  readonly failure: InitFailure;
  readonly errors: readonly WorkspaceDiagnostic[];
}

export interface InitNotFound {
  readonly ok: false;
  readonly status: 'not-found';
  readonly record: null;
  readonly phase: null;
  readonly errors: readonly WorkspaceDiagnostic[];
}

export type InitOutcome = InitSuccess | InitBlocked | InitFailed | InitNotFound;

export interface InvestigationResult {
  readonly ok: true;
  readonly root: string;
  readonly gitRoot: string | null;
  readonly gitRevision: string | null;
  readonly reads: readonly ScanRead[];
  readonly unknowns: readonly ScanUnknown[];
  readonly observations: readonly Observation[];
  readonly conflicts: readonly KnowledgeConflict[];
  readonly featureCount: number;
  readonly emptyProject: boolean;
  readonly partial: boolean;
  readonly candidateDocumentPaths: readonly string[];
  /** Always `false`: investigation never writes a file. */
  readonly wroteFiles: false;
}

export type InvestigationOutcome =
  InvestigationResult | { readonly ok: false; readonly errors: readonly WorkspaceDiagnostic[] };

export interface InvestigateOptions {
  readonly root: string;
  readonly git: GitPort;
  readonly documentRoot?: string;
  readonly budget?: Partial<ScanBudget>;
  /** Decision/requirement ids resolvable in the current context. */
  readonly knownIds?: readonly string[];
}

/**
 * Read-only investigation: scan + candidate generation with no writes.
 *
 * This works in every state — no Git, dirty workspace, blocked, failed — which is
 * exactly the documented allowance (`ARCHITECTURE.md` §4: 脏工作区只读调查可继续).
 */
export function investigateWorkspace(options: InvestigateOptions): InvestigationOutcome {
  const scan = scanProject({
    root: options.root,
    git: options.git,
    ...(options.documentRoot === undefined ? {} : { documentRoot: options.documentRoot }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  });
  if (!scan.ok) return { ok: false, errors: scan.errors };
  const existing = readKnowledgeDocuments({
    root: scan.root,
    documentRoot: options.documentRoot ?? scan.documentRoot,
  });
  const knowledge = generateCandidateKnowledge({
    scan,
    documentRoot: options.documentRoot ?? scan.documentRoot,
    existingDocuments: existing.documents,
    readDiagnostics: existing.diagnostics,
    ...(options.knownIds === undefined ? {} : { knownIds: options.knownIds }),
  });
  return {
    ok: true,
    root: scan.root,
    gitRoot: scan.gitRoot,
    gitRevision: scan.gitRevision,
    reads: scan.bodyFiles.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
      category: file.category,
    })),
    unknowns: knowledge.unknowns,
    observations: knowledge.observations,
    conflicts: knowledge.conflicts,
    featureCount: knowledge.features.length,
    emptyProject: knowledge.emptyProject,
    partial: scan.partial,
    candidateDocumentPaths: knowledge.documents.map((document) => document.path),
    wroteFiles: false,
  };
}

export interface InitializerOptions {
  readonly store: InitStateStore;
  readonly git: GitPort;
  readonly fileSystem?: FileSystemPort;
  readonly documentRoot?: string;
  readonly branch?: string;
  readonly budget?: Partial<ScanBudget>;
  /** Decision/requirement ids resolvable in the current context. */
  readonly knownIds?: readonly string[];
  /**
   * Documents written per `step` while in Writing. Omitted means "all of them";
   * a finite value keeps each step short and leaves durable receipts behind.
   */
  readonly writeBatchSize?: number;
  /** Clock seam; defaults to the real UTC clock with millisecond precision. */
  readonly now?: () => string;
}

/** The public initialization API. */
export interface Initializer {
  start(input: StartInitInput): InitOutcome;
  get(id: string): InitRecord | null;
  /** Advances one phase (re-evaluating the current phase when it is blocked). */
  step(id: string): InitOutcome;
  /** Clears a recoverable failure and continues the same phase. */
  resume(id: string): InitOutcome;
  /** Records the user confirmation and advances Confirming. */
  confirm(id: string, input: ConfirmInitInput): InitOutcome;
  /** Records the Git-initialization authorization and advances Writing. */
  authorizeGitInitialization(id: string, input: AuthorizeGitInitInput): InitOutcome;
  /** Records the explicit handling of a blocker and continues. */
  resolveBlocker(id: string, input: ResolveBlockerInput): InitOutcome;
  /** Records the user decision for one design/code conflict and continues. */
  resolveConflict(id: string, input: ResolveConflictInput): InitOutcome;
  /** Read-only scan of the record's root; never writes. */
  investigate(id: string): InvestigationOutcome;
  /** Re-checks the minimal Ready gate against what is on disk now. */
  verifyReady(
    id: string,
  ): ReadyGateResult | { readonly ok: false; readonly errors: readonly WorkspaceDiagnostic[] };
}

function defaultNow(): string {
  return new Date().toISOString();
}

function toPhase(record: InitRecord, phase: InitPhase): InitRecord {
  return { ...record, phase, status: phase, blocked: null, failure: null };
}

function isDirectoryEmpty(root: string): boolean {
  try {
    return readdirSync(root).length === 0;
  } catch (error) {
    if (isMissingPathError(error)) return true;
    throw new WorkspaceError('INTERNAL_ERROR', `无法检查目录是否为空：${root}`, { cause: error });
  }
}

function upsertReceipt(
  receipts: readonly InitWriteReceipt[],
  receipt: InitWriteReceipt,
): readonly InitWriteReceipt[] {
  return [...receipts.filter((entry) => entry.path !== receipt.path), receipt];
}

/** Creates the initialization state machine over the given ports. */
export function createInitializer(options: InitializerOptions): Initializer {
  const store = options.store;
  const git = options.git;
  const fileSystem = options.fileSystem ?? createNodeFileSystemPort();
  const documentRoot = normalizeDocumentRoot(options.documentRoot ?? DEFAULT_DOCUMENT_ROOT);
  const branch = options.branch ?? INIT_DELIVERY_BRANCH;
  const now = options.now ?? defaultNow;
  const writeBatchSize = options.writeBatchSize;

  const persist = (record: InitRecord): InitRecord => {
    const next: InitRecord = { ...record, updatedAt: now() };
    store.save(next);
    return next;
  };

  /** Appends one evidence entry stamped with the current clock. */
  const addEvidence = (
    record: InitRecord,
    phase: InitPhase,
    kind: InitEvidenceKind,
    detail: string,
    refs: readonly string[],
  ): InitRecord => {
    const evidence: InitEvidence = { phase, at: now(), kind, detail, refs: [...refs] };
    return { ...record, evidence: [...record.evidence, evidence] };
  };

  const notFound = (id: string): InitNotFound => ({
    ok: false,
    status: 'not-found',
    record: null,
    phase: null,
    errors: [{ code: 'NOT_FOUND', message: `未找到初始化记录：${id}` }],
  });

  const ok = (record: InitRecord, advanced: boolean): InitSuccess => ({
    ok: true,
    record,
    phase: record.phase,
    status: record.status,
    advanced,
    done: record.status === 'ready',
  });

  const blocked = (record: InitRecord, blocker: InitBlocker): InitBlocked => {
    const message = blocker.message;
    const withEvidence = addEvidence(record, record.phase, 'blocked', message, []);
    const last = withEvidence.blockers.at(-1);
    // Repeated re-evaluation of the same blocker appends no duplicate history row.
    const blockers =
      last !== undefined && last.kind === blocker.kind && last.message === blocker.message
        ? withEvidence.blockers
        : [...withEvidence.blockers, blocker];
    const next = persist({
      ...withEvidence,
      status: 'blocked',
      blocked: blocker,
      blockers,
    });
    return {
      ok: false,
      status: 'blocked',
      record: next,
      phase: next.phase,
      blocker,
      errors: [{ code: BLOCKER_CODES[blocker.kind], message }],
    };
  };

  const failed = (
    record: InitRecord,
    failure: InitFailure,
    errors: readonly WorkspaceDiagnostic[],
  ): InitFailed => {
    const withEvidence = addEvidence(record, record.phase, 'failure', failure.message, []);
    const next = persist({ ...withEvidence, status: 'failed', failure });
    return {
      ok: false,
      status: 'failed',
      record: next,
      phase: next.phase,
      failure,
      errors,
    };
  };

  const identifyPhase = (record: InitRecord): InitOutcome => {
    const identity = resolveProject(record.root, { git });
    if (!identity.ok) {
      return failed(
        record,
        {
          kind: 'internal',
          message: `项目路径识别失败：${identity.errors[0]?.message ?? '未知错误'}`,
          recoverable: false,
          details: null,
        },
        identity.errors,
      );
    }
    const withEvidence = addEvidence(
      record,
      'identifying',
      'identify',
      `realpath/Git 根识别：root=${identity.root}；project=${identity.projectId}；git=${identity.gitRoot ?? 'none'}；HEAD=${identity.gitRevision ?? 'none'}`,
      [identity.root, identity.projectId],
    );
    const next = persist(
      toPhase(
        {
          ...withEvidence,
          root: identity.root,
          projectId: identity.projectId,
          gitRoot: identity.gitRoot,
          gitRevision: identity.gitRevision,
          needsGitInitialization: identity.gitRoot === null,
        },
        'mapping',
      ),
    );
    return ok(next, true);
  };

  const mappingPhase = (record: InitRecord): InitOutcome => {
    const scan = scanProject({
      root: record.root,
      git,
      documentRoot: record.documentRoot,
      ...(options.budget === undefined ? {} : { budget: options.budget }),
    });
    if (!scan.ok) {
      return failed(
        record,
        {
          kind: 'internal',
          message: `扫描失败：${scan.errors[0]?.message ?? '未知错误'}`,
          recoverable: false,
          details: null,
        },
        scan.errors,
      );
    }
    const existing = readKnowledgeDocuments({ root: scan.root, documentRoot: record.documentRoot });
    const knowledge = generateCandidateKnowledge({
      scan,
      documentRoot: record.documentRoot,
      existingDocuments: existing.documents,
      readDiagnostics: existing.diagnostics,
      ...(options.knownIds === undefined ? {} : { knownIds: options.knownIds }),
    });
    const unknowns = knowledge.unknowns.map((unknown) =>
      unknown.path === null ? unknown.message : `${unknown.path}：${unknown.message}`,
    );
    const inferences: InitInference[] = knowledge.features.map((candidate) => ({
      id: `module-intent:${candidate.moduleKey}`,
      kind: 'module-intent',
      detail: `模块 ${candidate.moduleKey} 的产品意图未确认；候选文档仅记录观察事实（design=unconfirmed）`,
      requiresConfirmation: true,
      refs: candidate.sourceRefs.slice(0, 8),
    }));
    if (knowledge.emptyProject) {
      inferences.push({
        id: 'empty-project',
        kind: 'empty-project',
        detail: '目录为空项目；候选文档按 observed 记录实现状态 absent，无需额外产品推断确认',
        requiresConfirmation: false,
        refs: [],
      });
    }
    const reads: ScanRead[] = scan.bodyFiles.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
      category: file.category,
    }));

    let next: InitRecord = {
      ...record,
      root: scan.root,
      projectId: scan.projectId,
      gitRoot: scan.gitRoot,
      gitRevision: scan.gitRevision,
      needsGitInitialization: scan.gitRoot === null,
      emptyProject: knowledge.emptyProject,
      scanPartial: scan.partial,
      featureCount: knowledge.features.length,
      unknowns,
      observations: knowledge.observations,
      reads,
      conflicts: knowledge.conflicts,
      inferences,
      documents: knowledge.documents,
    };
    next = addEvidence(
      next,
      'mapping',
      'scan',
      `扫描完成：正文 ${reads.length} 个 / ${scan.bodyBytesRead} 字节（${scan.completeness}）；索引 ${scan.indexTotal} 条（上限 ${scan.indexLimit}）；候选能力 ${knowledge.features.length} 个；未知 ${unknowns.length} 项；嵌套仓库 ${scan.nestedRepositories.length} 个`,
      reads.map((read) => `${read.path}#${read.sha256}`),
    );
    if (knowledge.conflicts.length > 0) {
      next = addEvidence(
        next,
        'mapping',
        'conflict',
        `发现 ${knowledge.conflicts.length} 项已有文档与观察事实冲突：${knowledge.conflicts.map((conflict) => `${conflict.documentPath}(${conflict.kind})`).join('、')}`,
        knowledge.conflicts.map((conflict) => conflict.documentPath),
      );
    }
    next = persist(toPhase(next, 'confirming'));
    return ok(next, true);
  };

  const confirmingPhase = (record: InitRecord): InitOutcome => {
    const unresolved = record.conflicts.filter(
      (conflict) =>
        !record.conflictResolutions.some(
          (resolution) =>
            resolution.documentPath === conflict.documentPath && resolution.kind === conflict.kind,
        ),
    );
    if (unresolved.length > 0) {
      return blocked(record, {
        kind: 'design-conflict',
        conflicts: unresolved,
        message: `存在 ${unresolved.length} 项已有文档与观察事实冲突，需用户处置后才能继续；候选文档保持 design=unconfirmed，绝不擅自确认`,
      });
    }
    const required = record.inferences.filter((inference) => inference.requiresConfirmation);
    if (required.length > 0 && record.confirmation === null) {
      return blocked(record, {
        kind: 'confirmation-required',
        inferences: required,
        message: `初始化包含 ${required.length} 项产品意图推断，需用户确认后进入 Writing`,
      });
    }
    const detail =
      record.confirmation === null
        ? '仅观察事实，无需额外产品推断确认，进入 Writing'
        : `用户确认：${record.confirmation.authorizationRef}（by ${record.confirmation.by}）`;
    const next = persist(
      toPhase(
        addEvidence(
          record,
          'confirming',
          'confirmation',
          detail,
          required.map((inference) => inference.id),
        ),
        'writing',
      ),
    );
    return ok(next, true);
  };

  const writingPhase = (record: InitRecord): InitOutcome => {
    let next = record;

    // 1. Git initialization authorization for a no-Git directory.
    const resolved = git.resolveRoot(next.root);
    if (!resolved.ok) {
      return failed(
        next,
        {
          kind: 'git-error',
          message: 'Git 探测失败，无法进入写入阶段',
          recoverable: true,
          details: null,
        },
        resolved.errors,
      );
    }
    if (resolved.value === null) {
      if (next.gitAuthorization === null) {
        return blocked(next, {
          kind: 'git-initialization',
          request: {
            kind: 'git-initialization',
            root: next.root,
            branch: next.branch,
            initialCommit: isDirectoryEmpty(next.root),
            reason: '正式写入候选文档前需用户明确授权在无 Git 目录初始化仓库并建立交付分支',
          },
          message: `目录不是 Git 仓库：${next.root}；正式写入需先获得 Git 初始化授权（只读调查不受影响）`,
        });
      }
      const authorization = next.gitAuthorization;
      const initialized = git.initRepository(next.root, { branch: authorization.branch });
      if (!initialized.ok) {
        return failed(
          next,
          {
            kind: 'git-error',
            message: `Git 初始化失败：${initialized.errors[0]?.message ?? '未知错误'}`,
            recoverable: true,
            details: null,
          },
          initialized.errors,
        );
      }
      next = addEvidence(
        next,
        'writing',
        'git-init',
        `用户授权后初始化 Git：root=${initialized.value.root}；branch=${initialized.value.branch}`,
        [initialized.value.root, initialized.value.branch],
      );
      if (authorization.initialCommit) {
        const head = git.headRevision(next.root);
        if (!head.ok) {
          return failed(
            next,
            {
              kind: 'git-error',
              message: 'git rev-parse HEAD 失败',
              recoverable: true,
              details: null,
            },
            head.errors,
          );
        }
        if (head.value === null) {
          const committed = git.commit(next.root, {
            message: 'chore: 初始化 AgentDev 项目（空仓库初始提交）',
            paths: [],
          });
          if (!committed.ok) {
            return failed(
              next,
              {
                kind: 'git-error',
                message: `初始提交失败：${committed.errors[0]?.message ?? '未知错误'}`,
                recoverable: true,
                details: null,
              },
              committed.errors,
            );
          }
          next = addEvidence(
            next,
            'writing',
            'commit',
            `空仓库初始提交：${committed.value.revision}`,
            [committed.value.revision],
          );
        }
      }
      const identity = resolveProject(next.root, { git });
      if (!identity.ok) {
        return failed(
          next,
          {
            kind: 'git-error',
            message: `Git 初始化后重新识别失败：${identity.errors[0]?.message ?? '未知错误'}`,
            recoverable: true,
            details: null,
          },
          identity.errors,
        );
      }
      next = {
        ...next,
        root: identity.root,
        projectId: identity.projectId,
        gitRoot: identity.gitRoot,
        gitRevision: identity.gitRevision,
        needsGitInitialization: identity.gitRoot === null,
      };
    } else {
      const gitRoot = canonicalPath(resolved.value) ?? resolved.value;
      const head = git.headRevision(gitRoot);
      if (!head.ok) {
        return failed(
          next,
          {
            kind: 'git-error',
            message: 'git rev-parse HEAD 失败',
            recoverable: true,
            details: null,
          },
          head.errors,
        );
      }
      next = {
        ...next,
        root: gitRoot,
        gitRoot,
        gitRevision: head.value,
        needsGitInitialization: false,
      };
    }

    // 2. Delivery start must not clobber an unhandled dirty workspace.
    let readiness = checkDeliveryReadiness({
      root: next.root,
      git,
      fileSystem,
      branch: next.branch,
      initialCommit: isDirectoryEmpty(next.root),
      handled: next.dirtyHandling !== null,
    });
    if (!readiness.ok && readiness.blocker.kind === 'dirty-workspace' && next.writes.length > 0) {
      // Files this initialization already wrote are its own product, not user
      // dirt: a resumed/batched Writing step must not block on them. Anything else
      // in the workspace still blocks.
      const ownPaths = new Set(next.writes.map((receipt) => receipt.path));
      const foreign = readiness.blocker.hashReport.filter((report) => !ownPaths.has(report.path));
      readiness =
        foreign.length === 0
          ? { ok: true, root: next.root, gitRevision: next.gitRevision }
          : {
              ok: false,
              blocker: {
                kind: 'dirty-workspace',
                hashReport: foreign,
                message: `工作区有 ${foreign.length} 个未提交路径，交付写入被阻断；需用户明确处置（只读调查不受影响）`,
              },
            };
    }
    if (!readiness.ok) {
      if (readiness.blocker.kind === 'git-error') {
        return failed(
          next,
          {
            kind: 'git-error',
            message: readiness.blocker.message,
            recoverable: true,
            details: null,
          },
          readiness.blocker.errors,
        );
      }
      return blocked(next, readiness.blocker);
    }

    // 3. Write candidate documents, comparing hashes with what is on disk.
    let receipts = next.writes;
    let processed = 0;
    for (const document of next.documents) {
      if (writeBatchSize !== undefined && processed >= writeBatchSize) break;
      const absolute = join(next.root, document.path);
      let disk: string | null;
      try {
        disk = fileSystem.readFile(absolute);
      } catch (error) {
        const failure: InitFailure = {
          kind: 'interrupted',
          message: `写入阶段读取磁盘失败而中断：${document.path}（${String(error)}）`,
          recoverable: true,
          details: { path: document.path },
        };
        const interrupted = persist({ ...next, writes: receipts });
        return failed(interrupted, failure, [
          { code: 'INTERNAL_ERROR', message: failure.message, path: absolute },
        ]);
      }
      if (disk !== null) {
        const diskHash = sha256Hex(disk);
        if (diskHash === document.contentHash) {
          receipts = upsertReceipt(receipts, {
            path: document.path,
            contentHash: document.contentHash,
            bytes: Buffer.byteLength(document.markdown, 'utf8'),
            state: 'unchanged',
            at: now(),
          });
          next = persist({
            ...next,
            writes: receipts,
            fileConflicts: next.fileConflicts.filter((entry) => entry.path !== document.path),
          });
          processed += 1;
          continue;
        }
        // An existing file that is not ours: stop and report, never overwrite.
        const conflict: FileConflict = {
          path: document.path,
          diskHash,
          candidateHash: document.contentHash,
          at: now(),
        };
        const failure: InitFailure = {
          kind: 'content-conflict',
          message: `已存在内容不同的文件，停止写入且不覆盖：${document.path}（disk=${diskHash} candidate=${document.contentHash}）`,
          recoverable: true,
          details: {
            path: document.path,
            diskHash,
            candidateHash: document.contentHash,
          },
        };
        const conflicted = persist({
          ...next,
          writes: receipts,
          fileConflicts: [
            ...next.fileConflicts.filter((entry) => entry.path !== document.path),
            conflict,
          ],
        });
        return failed(conflicted, failure, [
          { code: 'KNOWLEDGE_INVALID', message: failure.message, path: absolute },
        ]);
      }
      try {
        fileSystem.writeFile(absolute, document.markdown);
      } catch (error) {
        const failure: InitFailure = {
          kind: 'interrupted',
          message: `写入中断：${document.path}（${String(error)}）`,
          recoverable: true,
          details: { path: document.path },
        };
        const interrupted = persist({ ...next, writes: receipts });
        return failed(interrupted, failure, [
          { code: 'INTERNAL_ERROR', message: failure.message, path: absolute },
        ]);
      }
      receipts = upsertReceipt(receipts, {
        path: document.path,
        contentHash: document.contentHash,
        bytes: Buffer.byteLength(document.markdown, 'utf8'),
        state: 'written',
        at: now(),
      });
      next = persist({
        ...addEvidence(next, 'writing', 'write', `写入候选文档：${document.path}`, [
          document.path,
          document.contentHash,
        ]),
        writes: receipts,
        fileConflicts: next.fileConflicts.filter((entry) => entry.path !== document.path),
      });
      processed += 1;
    }

    const unreconciled = next.documents.filter((document) => {
      const disk = fileSystem.readFile(join(next.root, document.path));
      return disk === null || sha256Hex(disk) !== document.contentHash;
    });
    if (unreconciled.length > 0) {
      const pending = persist({ ...next, status: 'writing' });
      return ok(pending, true);
    }

    const gate = evaluateReadyGate({ record: next, fileSystem });
    if (gate.ok) {
      const ready = persist(
        toPhase(
          addEvidence(
            next,
            'writing',
            'gate',
            `Ready 最小门禁通过：${gate.checks.map((check) => check.id).join('、')}`,
            READY_ENTRY_DOCUMENTS.map((entry) => `${next.documentRoot}/${entry}`),
          ),
          'ready',
        ),
      );
      return ok(ready, true);
    }
    const failure: InitFailure = {
      kind: 'ready-gate',
      message: `Ready 最小门禁未通过：${gate.missing.join('、')}`,
      recoverable: true,
      details: Object.fromEntries(gate.checks.map((check) => [check.id, check.detail])),
    };
    return failed({ ...next, status: 'failed', failure }, failure, [
      { code: 'GATE_NOT_READY', message: failure.message },
    ]);
  };

  const stepPhase = (record: InitRecord): InitOutcome => {
    switch (record.phase) {
      case 'identifying':
        return identifyPhase(record);
      case 'mapping':
        return mappingPhase(record);
      case 'confirming':
        return confirmingPhase(record);
      case 'writing':
        return writingPhase(record);
      case 'ready':
        return ok(record, false);
      default:
        throw new WorkspaceError(
          'INTERNAL_ERROR',
          `未知初始化阶段：${String((record as { readonly phase?: unknown }).phase)}`,
        );
    }
  };

  const step = (id: string): InitOutcome => {
    const record = store.load(id);
    if (record === null) return notFound(id);
    if (record.status === 'ready') return ok(record, false);
    if (record.status === 'failed' && record.failure !== null) {
      if (record.failure.kind === 'interrupted') {
        const resumed = persist(
          addEvidence(
            { ...record, status: record.phase, failure: null },
            record.phase,
            'resume',
            `中断后继续：${record.failure.message}`,
            [record.phase],
          ),
        );
        return stepPhase(resumed);
      }
      return failed(
        record,
        {
          ...record.failure,
          message: `${record.failure.message}；需先处置失败原因再 resume`,
        },
        [
          {
            code: 'INVALID_STATE',
            message: `初始化处于失败状态（${record.failure.kind}），需先处置`,
          },
        ],
      );
    }
    return stepPhase(record);
  };

  const resume = (id: string): InitOutcome => {
    const record = store.load(id);
    if (record === null) return notFound(id);
    if (record.status === 'ready') return ok(record, false);
    if (record.status === 'blocked' || record.failure === null) return step(id);

    if (!record.failure.recoverable) {
      return failed(record, record.failure, [
        {
          code: 'INVALID_STATE',
          message: `失败不可自动恢复（${record.failure.kind}），需重新开始或修复输入`,
        },
      ]);
    }

    if (record.failure.kind === 'content-conflict') {
      const unresolved = record.fileConflicts.filter((conflict) => {
        const disk = fileSystem.readFile(join(record.root, conflict.path));
        return disk !== null && sha256Hex(disk) === conflict.diskHash;
      });
      if (unresolved.length > 0) {
        return failed(
          record,
          {
            ...record.failure,
            message: `冲突文件仍未处置，拒绝恢复：${unresolved.map((conflict) => conflict.path).join('、')}`,
          },
          [
            {
              code: 'INVALID_STATE',
              message: `冲突文件未处置，不能恢复写入：${unresolved.map((conflict) => conflict.path).join('、')}`,
            },
          ],
        );
      }
    }

    const resumed = persist(
      addEvidence(
        { ...record, status: record.phase, failure: null, fileConflicts: [] },
        record.phase,
        'resume',
        `恢复初始化：${record.failure.kind}`,
        [record.phase],
      ),
    );
    return stepPhase(resumed);
  };

  const confirm = (id: string, input: ConfirmInitInput): InitOutcome => {
    const record = store.load(id);
    if (record === null) return notFound(id);
    if (record.phase !== 'confirming') {
      return failed(
        record,
        {
          kind: 'internal',
          message: `当前阶段 ${record.phase} 不接受确认`,
          recoverable: false,
          details: null,
        },
        [{ code: 'INVALID_STATE', message: `当前阶段 ${record.phase} 不接受确认` }],
      );
    }
    if (input.authorizationRef.trim() === '') {
      return failed(
        record,
        {
          kind: 'internal',
          message: '用户确认必须携带 authorizationRef',
          recoverable: false,
          details: null,
        },
        [{ code: 'VALIDATION_ERROR', message: '用户确认必须携带 authorizationRef' }],
      );
    }
    const confirmed = persist({
      ...record,
      confirmation: {
        authorizationRef: input.authorizationRef,
        by: input.by ?? 'user',
        note: input.note ?? null,
        at: now(),
      },
      blocked: null,
      status: 'confirming',
    });
    return step(confirmed.id);
  };

  const authorizeGitInitialization = (id: string, input: AuthorizeGitInitInput): InitOutcome => {
    const record = store.load(id);
    if (record === null) return notFound(id);
    if (record.phase !== 'writing') {
      return failed(
        record,
        {
          kind: 'internal',
          message: `当前阶段 ${record.phase} 不接受 Git 初始化授权`,
          recoverable: false,
          details: null,
        },
        [{ code: 'INVALID_STATE', message: `当前阶段 ${record.phase} 不接受 Git 初始化授权` }],
      );
    }
    const errors: WorkspaceDiagnostic[] = [];
    if (input.authorizationRef.trim() === '') {
      errors.push({ code: 'VALIDATION_ERROR', message: 'Git 初始化授权必须携带 authorizationRef' });
    }
    if (input.request.branch.trim() === '') {
      errors.push({ code: 'VALIDATION_ERROR', message: 'Git 初始化分支不能为空' });
    }
    if (input.request.root !== record.root) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: `授权请求根与初始化根不一致：${input.request.root} != ${record.root}`,
      });
    }
    if (errors.length > 0) {
      return failed(
        record,
        {
          kind: 'internal',
          message: errors[0]?.message ?? '授权请求非法',
          recoverable: false,
          details: null,
        },
        errors,
      );
    }
    const authorized = persist(
      addEvidence(
        {
          ...record,
          gitAuthorization: {
            authorizationRef: input.authorizationRef,
            branch: input.request.branch,
            initialCommit: input.request.initialCommit,
            at: now(),
          },
          blocked: null,
          status: 'writing',
        },
        'writing',
        'git-authorization',
        `用户授权 Git 初始化：branch=${input.request.branch}；initialCommit=${String(input.request.initialCommit)}；ref=${input.authorizationRef}`,
        [record.root, input.request.branch, input.authorizationRef],
      ),
    );
    return step(authorized.id);
  };

  const resolveBlocker = (id: string, input: ResolveBlockerInput): InitOutcome => {
    const record = store.load(id);
    if (record === null) return notFound(id);
    const blocker = record.blocked;
    if (blocker === null) {
      return failed(
        record,
        {
          kind: 'internal',
          message: '当前没有待处置的阻断',
          recoverable: false,
          details: null,
        },
        [{ code: 'INVALID_STATE', message: '当前没有待处置的阻断' }],
      );
    }
    if (blocker.kind === 'git-initialization') {
      return failed(
        record,
        {
          kind: 'internal',
          message: 'Git 初始化阻断需使用 authorizeGitInitialization 处置',
          recoverable: false,
          details: null,
        },
        [
          {
            code: 'VALIDATION_ERROR',
            message: 'Git 初始化阻断需使用 authorizeGitInitialization 处置',
          },
        ],
      );
    }
    if (blocker.kind === 'confirmation-required') {
      return failed(
        record,
        {
          kind: 'internal',
          message: '待确认推断需使用 confirm 处置',
          recoverable: false,
          details: null,
        },
        [{ code: 'VALIDATION_ERROR', message: '待确认推断需使用 confirm 处置' }],
      );
    }
    if (blocker.kind === 'design-conflict') {
      return failed(
        record,
        {
          kind: 'internal',
          message: '设计/实现冲突需使用 resolveConflict 逐项处置',
          recoverable: false,
          details: null,
        },
        [{ code: 'VALIDATION_ERROR', message: '设计/实现冲突需使用 resolveConflict 逐项处置' }],
      );
    }
    if (blocker.kind === 'git-error') {
      return step(id);
    }
    if (input.dirtyChoice === undefined) {
      return failed(
        record,
        {
          kind: 'internal',
          message: '处置脏工作区必须明确 choice：committed/patch/discard/authorized',
          recoverable: false,
          details: null,
        },
        [
          {
            code: 'VALIDATION_ERROR',
            message: '处置脏工作区必须明确 choice：committed/patch/discard/authorized',
          },
        ],
      );
    }
    if (input.dirtyChoice === 'committed' || input.dirtyChoice === 'discard') {
      const status = git.statusPorcelain(record.root);
      if (!status.ok) {
        return failed(
          record,
          {
            kind: 'git-error',
            message: 'git status 失败，无法确认工作区已处置',
            recoverable: true,
            details: null,
          },
          status.errors,
        );
      }
      if (status.value.length > 0) {
        const hashReport = dirtyHashReport({
          root: record.root,
          lines: status.value,
          fileSystem,
        });
        return blocked(record, {
          kind: 'dirty-workspace',
          hashReport,
          message: `工作区仍有 ${hashReport.length} 个未提交路径；${input.dirtyChoice === 'committed' ? '提交' : '放弃'}后再继续`,
        });
      }
    }
    const handled = persist(
      addEvidence(
        {
          ...record,
          dirtyHandling: {
            authorizationRef: input.authorizationRef,
            choice: input.dirtyChoice,
            hashReport: blocker.hashReport,
            at: now(),
          },
          blocked: null,
          status: record.phase,
        },
        record.phase,
        'dirty-report',
        `用户处置脏工作区：${input.dirtyChoice}（${input.authorizationRef}）；报告 ${blocker.hashReport.length} 个路径`,
        blocker.hashReport.map(
          (report) => `${report.path}@${report.sha256 ?? 'deleted'}（${report.state}）`,
        ),
      ),
    );
    return step(handled.id);
  };

  const resolveConflict = (id: string, input: ResolveConflictInput): InitOutcome => {
    const record = store.load(id);
    if (record === null) return notFound(id);
    if (input.decisionRef.trim() === '') {
      return failed(
        record,
        {
          kind: 'internal',
          message: '冲突处置必须携带 decisionRef',
          recoverable: false,
          details: null,
        },
        [{ code: 'VALIDATION_ERROR', message: '冲突处置必须携带 decisionRef' }],
      );
    }
    const known = record.conflicts.some(
      (conflict) => conflict.documentPath === input.documentPath && conflict.kind === input.kind,
    );
    if (!known) {
      return failed(
        record,
        {
          kind: 'internal',
          message: `没有匹配的待处置冲突：${input.documentPath}（${input.kind}）`,
          recoverable: false,
          details: null,
        },
        [
          {
            code: 'NOT_FOUND',
            message: `没有匹配的待处置冲突：${input.documentPath}（${input.kind}）`,
          },
        ],
      );
    }
    const resolved: ConflictResolution = {
      documentPath: input.documentPath,
      kind: input.kind,
      decisionRef: input.decisionRef,
      at: now(),
    };
    const next = persist(
      addEvidence(
        {
          ...record,
          conflictResolutions: [
            ...record.conflictResolutions.filter(
              (resolution) =>
                !(
                  resolution.documentPath === resolved.documentPath &&
                  resolution.kind === resolved.kind
                ),
            ),
            resolved,
          ],
          blocked: null,
          status: record.phase,
        },
        record.phase,
        'conflict-resolution',
        `用户处置设计/实现冲突：${input.documentPath}（${input.kind}）-> ${input.decisionRef}`,
        [input.documentPath, input.decisionRef],
      ),
    );
    return step(next.id);
  };

  const investigate = (id: string): InvestigationOutcome => {
    const record = store.load(id);
    if (record === null) {
      return { ok: false, errors: [{ code: 'NOT_FOUND', message: `未找到初始化记录：${id}` }] };
    }
    return investigateWorkspace({
      root: record.root,
      git,
      documentRoot: record.documentRoot,
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      ...(options.knownIds === undefined ? {} : { knownIds: options.knownIds }),
    });
  };

  const verifyReady = (
    id: string,
  ): ReadyGateResult | { readonly ok: false; readonly errors: readonly WorkspaceDiagnostic[] } => {
    const record = store.load(id);
    if (record === null) {
      return { ok: false, errors: [{ code: 'NOT_FOUND', message: `未找到初始化记录：${id}` }] };
    }
    return evaluateReadyGate({ record, fileSystem });
  };

  return {
    start(input) {
      if (input.id.trim() === '') {
        return {
          ok: false,
          status: 'not-found',
          record: null,
          phase: null,
          errors: [{ code: 'VALIDATION_ERROR', message: '初始化 id 不能为空' }],
        };
      }
      const existing = store.load(input.id);
      if (existing !== null) {
        const requestedRoot =
          input.documentRoot === undefined
            ? documentRoot
            : normalizeDocumentRoot(input.documentRoot);
        const requestedBranch = input.branch ?? branch;
        if (
          existing.root !== input.root &&
          existing.root !== (canonicalPath(input.root) ?? input.root)
        ) {
          return failed(
            existing,
            {
              kind: 'internal',
              message: `初始化 id ${input.id} 已绑定其它根：${existing.root}`,
              recoverable: false,
              details: null,
            },
            [
              {
                code: 'INVALID_STATE',
                message: `初始化 id ${input.id} 已绑定其它根：${existing.root}`,
              },
            ],
          );
        }
        if (existing.documentRoot !== requestedRoot || existing.branch !== requestedBranch) {
          return failed(
            existing,
            {
              kind: 'internal',
              message: `初始化 id ${input.id} 已绑定其它 document-root/branch`,
              recoverable: false,
              details: null,
            },
            [
              {
                code: 'INVALID_STATE',
                message: `初始化 id ${input.id} 已绑定其它 document-root/branch`,
              },
            ],
          );
        }
        return ok(existing, false);
      }
      const createdAt = now();
      const record: InitRecord = {
        id: input.id,
        root: input.root,
        projectId: null,
        documentRoot:
          input.documentRoot === undefined
            ? documentRoot
            : normalizeDocumentRoot(input.documentRoot),
        branch: input.branch ?? branch,
        phase: 'identifying',
        status: 'identifying',
        candidate: true,
        deliveryRef: null,
        createdAt,
        updatedAt: createdAt,
        gitRoot: null,
        gitRevision: null,
        emptyProject: false,
        needsGitInitialization: false,
        scanPartial: false,
        featureCount: 0,
        unknowns: [],
        observations: [],
        reads: [],
        conflicts: [],
        inferences: [],
        documents: [],
        writes: [],
        fileConflicts: [],
        evidence: [
          {
            phase: 'identifying',
            at: createdAt,
            kind: 'start',
            detail: `初始化开始：root=${input.root}；document-root=${input.documentRoot ?? documentRoot}；branch=${input.branch ?? branch}`,
            refs: [input.root],
          },
        ],
        blockers: [],
        blocked: null,
        failure: null,
        confirmation: null,
        gitAuthorization: null,
        dirtyHandling: null,
        conflictResolutions: [],
      };
      const saved = persist(record);
      return ok(saved, false);
    },
    get(id) {
      return store.load(id);
    },
    step,
    resume,
    confirm,
    authorizeGitInitialization,
    resolveBlocker,
    resolveConflict,
    investigate,
    verifyReady,
  };
}
