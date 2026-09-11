/**
 * Workspace scanning, budgeted read selection and candidate knowledge
 * (`docs/product/knowledge.md` §5, `docs/architecture/ARCHITECTURE.md` §4,
 * `docs/architecture/context.md` §4).
 *
 * The scanner answers one question: what can be *observed* about a code tree
 * inside the initialization read budget, and what is explicitly still unknown?
 * It never claims full understanding:
 *
 * - `.git`, dependency directories, generated output and binary files are excluded;
 * - nested repositories become independent Projects and the parent stops at their
 *   boundary (`ARCHITECTURE.md` §4: 父项目文件读写排除其路径);
 * - symlinks are indexed and flagged but never followed for content, so a symlink
 *   can neither duplicate a repository nor escape its root;
 * - the primary index (directory/file names) is capped at 10000 entries and paged,
 *   and does not consume the body budget;
 * - at most 40 body files / 512 KiB are read, in the documented order
 *   README → manifest → build/test entry points → routes/models; hitting a limit
 *   yields a partial map plus explicit unknowns.
 *
 * Candidate knowledge is built from those observations only. Every candidate
 * Feature records `implementation` as observed-but-partial with
 * `design=unconfirmed`, points `source_refs` at real paths, and never invents
 * behaviour. Existing formal documents are compared against the observed tree;
 * a conflict is reported and never silently confirmed
 * (`docs/delivery/acceptance.md` AC-042).
 */
import { Buffer } from 'node:buffer';
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  type Dirent,
} from 'node:fs';
import { basename, join, sep } from 'node:path';
import { DEFAULT_PAGE_LIMIT, INITIALIZATION_BUDGET, MAX_PAGE_LIMIT } from '@agentdev/contracts';
import {
  contentHash,
  parseFeatureDocument,
  renderCodeMap,
  renderIndex,
  renderReadme,
  type CodeMapEntry,
  type FeatureDocumentInput,
  type FeatureIndexEntry,
  type FeatureSectionBody,
  type ParsedFeature,
} from '@agentdev/knowledge';
import {
  WorkspaceError,
  canonicalPath,
  isMissingPathError,
  sha256Hex,
  type GitPort,
  type WorkspaceDiagnostic,
} from './git-port.js';

/** Default `document-root` (`docs/architecture/context.md` §4). */
export const DEFAULT_DOCUMENT_ROOT = 'docs/agentdev';

/** Directory names pruned at any depth. */
export const SCAN_EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
];

/** Primary index ceiling; `INITIALIZATION_BUDGET.maxIndexEntries` (10000). */
export const SCAN_INDEX_LIMIT = INITIALIZATION_BUDGET.maxIndexEntries;

/** Module key for files that sit at the repository root. */
export const ROOT_MODULE_KEY = 'root';

/** Files whose names mark the build/test entry-point tier. */
const ENTRY_POINT_FILES: readonly string[] = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile',
  'Justfile',
  'tsconfig.json',
  'vitest.config.ts',
  'vitest.config.js',
  'vite.config.ts',
  'vite.config.js',
  'jest.config.js',
  'jest.config.ts',
  'jest.config.cjs',
  'eslint.config.js',
  'turbo.json',
  'nx.json',
  'lerna.json',
];

/** Files that declare dependencies or build metadata. */
const MANIFEST_FILES: readonly string[] = [
  'package.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'composer.json',
  'Gemfile',
  'requirements.txt',
  'CMakeLists.txt',
  'mix.exs',
  'Package.swift',
  'pubspec.yaml',
];

/** Generated files that are never read as body content. */
const GENERATED_FILES: readonly string[] = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
  'Gemfile.lock',
  'Thumbs.db',
  '.DS_Store',
];

/** Generated suffixes that are never read as body content. */
const GENERATED_SUFFIXES: readonly string[] = ['.map', '.min.js', '.min.css', '.tsbuildinfo'];

/** Extensions treated as binary without sniffing. */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.tar',
  '.jar',
  '.war',
  '.class',
  '.o',
  '.a',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.bin',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.wav',
  '.ogg',
  '.webm',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.pyc',
  '.pyd',
  '.node',
  '.snap',
  '.parquet',
  '.avro',
]);

/** Extensions considered source code for module detection. */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.swift',
  '.scala',
  '.ex',
  '.exs',
  '.vue',
  '.svelte',
  '.sql',
  '.sh',
]);

/** Directory names that usually hold one module per child. */
const SOURCE_ROOTS: ReadonlySet<string> = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'services',
  'modules',
  'server',
  'client',
  'api',
  'core',
  'internal',
  'cmd',
]);

/** Banner every initialization candidate document starts with. */
export const CANDIDATE_BANNER =
  '> 候选文档（初始化调查，未经用户确认）：仅记录观察事实，不更新任何交付 ref。';

/**
 * Read tiers, in selection order (`knowledge.md` §5).
 *
 * The documented order is README → manifest → build/test entry points →
 * routes/models. `source` is appended as the last, lowest-priority tier so a legacy
 * project whose only evidence is plain source files still yields observable
 * modules; it can never displace a documented tier inside the budget.
 */
export const SCAN_CATEGORIES = [
  'readme',
  'manifest',
  'entry-point',
  'routes-models',
  'source',
] as const;
export type ScanCategory = (typeof SCAN_CATEGORIES)[number];

const CATEGORY_ORDER: Readonly<Record<ScanCategory, number>> = {
  readme: 0,
  manifest: 1,
  'entry-point': 2,
  'routes-models': 3,
  source: 4,
};

export interface ScanBudget {
  readonly maxBodyFiles: number;
  readonly maxBodyBytes: number;
  readonly maxIndexEntries: number;
}

/** The documented initialization budget (`knowledge.md` §5). */
export const DEFAULT_SCAN_BUDGET: ScanBudget = {
  maxBodyFiles: INITIALIZATION_BUDGET.maxBodyFiles,
  maxBodyBytes: INITIALIZATION_BUDGET.maxBodyBytes,
  maxIndexEntries: INITIALIZATION_BUDGET.maxIndexEntries,
};

export type ScanUnknownKind =
  | 'budget-body-files'
  | 'budget-body-bytes'
  | 'index-truncated'
  | 'nested-repository'
  | 'symlink-escape'
  | 'broken-symlink'
  | 'unreadable-file'
  | 'unreadable-manifest'
  | 'empty-project'
  | 'git-unavailable';

/** One explicit gap in the observed map. */
export interface ScanUnknown {
  readonly kind: ScanUnknownKind;
  readonly path: string | null;
  readonly message: string;
}

/** One row of the primary directory/file index. */
export interface IndexEntry {
  /** Repo-relative path, `/` separated. */
  readonly path: string;
  readonly kind: 'directory' | 'file';
  readonly depth: number;
  readonly bytes: number | null;
  readonly binary: boolean;
  readonly generated: boolean;
  readonly symlink: boolean;
  readonly nestedRepository: boolean;
}

/** One repository nested inside the scanned tree, excluded from the parent. */
export interface NestedRepository {
  /** Canonical realpath of the nested repository root. */
  readonly root: string;
  /** Repo-relative path inside the parent project. */
  readonly relativePath: string;
  /** Project id of the nested repository (`sha256(canonicalRoot)` first 32 hex). */
  readonly projectId: string;
}

/** A body file that was read inside the budget. */
export interface ScanRead {
  /** Repo-relative path. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly category: ScanCategory;
}

export interface ScannedBodyFile extends ScanRead {
  readonly content: string;
  /** `git:<revision>:<path>` when a revision is known, otherwise `file:<path>`. */
  readonly ref: string;
}

/** A body-level candidate skipped because the budget was exhausted. */
export interface SkippedBodyFile {
  readonly path: string;
  readonly bytes: number;
  readonly category: ScanCategory;
  readonly reason: 'body-files' | 'body-bytes';
}

export interface ScanResult {
  readonly ok: true;
  /** The path the caller asked to scan. */
  readonly requestedPath: string;
  /** Canonical project root actually scanned (git root when inside a repository). */
  readonly root: string;
  readonly gitRoot: string | null;
  readonly gitRevision: string | null;
  readonly projectId: string;
  readonly documentRoot: string;
  readonly index: readonly IndexEntry[];
  /** Entries discovered before the index cap. */
  readonly indexTotal: number;
  readonly indexLimit: number;
  readonly indexTruncated: boolean;
  readonly excludedDirectories: readonly string[];
  readonly binaryFiles: readonly string[];
  readonly generatedFiles: readonly string[];
  readonly nestedRepositories: readonly NestedRepository[];
  readonly bodyFiles: readonly ScannedBodyFile[];
  readonly skippedFiles: readonly SkippedBodyFile[];
  readonly bodyBytesRead: number;
  readonly budget: ScanBudget;
  readonly unknowns: readonly ScanUnknown[];
  /** `true` when the budget stopped the read short of every candidate. */
  readonly partial: boolean;
  readonly completeness: 'complete' | 'partial';
  readonly claimsFullUnderstanding: false;
}

export interface ScanFailure {
  readonly ok: false;
  readonly requestedPath: string;
  readonly errors: readonly WorkspaceDiagnostic[];
}

export type ScanOutcome = ScanResult | ScanFailure;

export interface ScanOptions {
  readonly root: string;
  readonly git: GitPort;
  /** `document-root`; excluded from the code scan. Defaults to `docs/agentdev`. */
  readonly documentRoot?: string;
  readonly budget?: Partial<ScanBudget>;
}

/** Canonical project id: first 32 hex of `sha256(canonicalRoot)`. */
export function projectIdFor(canonicalRoot: string): string {
  return sha256Hex(canonicalRoot).slice(0, 32);
}

/** Source ref for an observed path (`context.md` §2 source_refs form). */
export function sourceRefFor(revision: string | null, path: string): string {
  return revision === null || revision === '' ? `file:${path}` : `git:${revision}:${path}`;
}

/** Normalizes a document-root value; an empty value falls back to the default. */
export function normalizeDocumentRoot(value: string | undefined): string {
  const trimmed = (value ?? DEFAULT_DOCUMENT_ROOT)
    .replace(/\\/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/+$/u, '');
  return trimmed === '' ? DEFAULT_DOCUMENT_ROOT : trimmed;
}

export interface ProjectIdentity {
  readonly ok: true;
  readonly requestedPath: string;
  /** Canonical root: the containing Git root when there is one. */
  readonly root: string;
  readonly projectId: string;
  readonly gitRoot: string | null;
  readonly gitRevision: string | null;
  /** Git probe failures; the identity still resolves from the realpath. */
  readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export type ProjectIdentityOutcome = ProjectIdentity | ScanFailure;

/**
 * Resolves a user-supplied path to one Project identity.
 *
 * Different subdirectories and symlinked paths of the same repository normalize
 * to the same canonical root and therefore the same project id. A path inside a
 * nested repository resolves to that nested root instead of its parent
 * (`ARCHITECTURE.md` §4).
 */
export function resolveProject(
  path: string,
  options: { readonly git: GitPort },
): ProjectIdentityOutcome {
  const canonical = canonicalPath(path);
  if (canonical === null) {
    return {
      ok: false,
      requestedPath: path,
      errors: [{ code: 'NOT_FOUND', message: `路径不存在：${path}`, path }],
    };
  }
  if (!statSync(canonical).isDirectory()) {
    return {
      ok: false,
      requestedPath: path,
      errors: [{ code: 'NOT_FOUND', message: `不是目录：${path}`, path }],
    };
  }

  const diagnostics: WorkspaceDiagnostic[] = [];
  let gitRoot: string | null = null;
  const resolved = options.git.resolveRoot(canonical);
  if (resolved.ok) {
    if (resolved.value !== null) gitRoot = canonicalPath(resolved.value) ?? resolved.value;
  } else {
    diagnostics.push(...resolved.errors);
  }

  const root = gitRoot ?? canonical;
  let gitRevision: string | null = null;
  if (gitRoot !== null) {
    const head = options.git.headRevision(gitRoot);
    if (head.ok) gitRevision = head.value;
    else diagnostics.push(...head.errors);
  }

  return {
    ok: true,
    requestedPath: path,
    root,
    projectId: projectIdFor(root),
    gitRoot,
    gitRevision,
    diagnostics,
  };
}

interface WalkedFile {
  readonly path: string;
  readonly absolutePath: string;
  readonly bytes: number;
  readonly category: ScanCategory | null;
  readonly binary: boolean;
  readonly generated: boolean;
}

interface WalkState {
  readonly root: string;
  readonly budget: ScanBudget;
  readonly documentRoot: string;
  readonly prunedExactPaths: ReadonlySet<string>;
  readonly index: IndexEntry[];
  readonly files: WalkedFile[];
  readonly excludedDirectories: string[];
  readonly binaryFiles: string[];
  readonly generatedFiles: string[];
  readonly nestedRepositories: NestedRepository[];
  readonly unknowns: ScanUnknown[];
  indexTotal: number;
  indexTruncated: boolean;
}

function resolveBudget(partial: Partial<ScanBudget> | undefined): ScanBudget {
  const budget: ScanBudget = { ...DEFAULT_SCAN_BUDGET, ...(partial ?? {}) };
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new WorkspaceError(
        'VALIDATION_ERROR',
        `预算 ${name} 必须是正整数，收到：${String(value)}`,
      );
    }
  }
  return budget;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function isBinaryName(name: string): boolean {
  if (name === '.DS_Store' || name === 'Thumbs.db') return true;
  return BINARY_EXTENSIONS.has(extensionOf(name));
}

function isGeneratedName(name: string): boolean {
  if (GENERATED_FILES.includes(name)) return true;
  const lower = name.toLowerCase();
  return GENERATED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** `true` for a path whose extension marks source code. */
export function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(extensionOf(basename(path)));
}

/** Reads the first 8 KiB of an extension-less file to detect NUL bytes. */
function sniffBinary(absolutePath: string): boolean {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(absolutePath, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw new WorkspaceError('INTERNAL_ERROR', `无法判定文件是否为二进制：${absolutePath}`, {
      cause: error,
    });
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** Assigns a body-selection tier, or `null` when the file is not a candidate. */
function categorize(path: string): ScanCategory | null {
  const name = basename(path);
  const lower = name.toLowerCase();
  if (/^readme(\..+)?$/u.test(lower)) return 'readme';
  if (MANIFEST_FILES.includes(name) || name.endsWith('.csproj') || name.endsWith('.sln')) {
    return 'manifest';
  }
  if (ENTRY_POINT_FILES.includes(name)) return 'entry-point';
  if (
    /(^|\/)(tests?|__tests__|spec|scripts|ci|workflows)(\/)/u.test(path) ||
    /\.(test|spec)\.[a-z0-9]+$/iu.test(name) ||
    /^(test|spec)[._-]/iu.test(name)
  ) {
    return 'entry-point';
  }
  if (
    /(^|\/)(routes?|routers?|controllers?|api|handlers?|services?|models?|schemas?|entities|migrations?|resolvers?)(\/|\.|$)/iu.test(
      path,
    )
  ) {
    return 'routes-models';
  }
  if (isCodeFile(path)) return 'source';
  return null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function depthOf(path: string): number {
  return path.split('/').length;
}

function hasGitMarker(directory: string): boolean {
  try {
    statSync(join(directory, '.git'));
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw new WorkspaceError('INTERNAL_ERROR', `无法检查嵌套仓库标记：${directory}`, {
      cause: error,
    });
  }
}

function addIndex(state: WalkState, entry: IndexEntry): void {
  state.indexTotal += 1;
  if (state.index.length < state.budget.maxIndexEntries) state.index.push(entry);
  else state.indexTruncated = true;
}

function walkDirectory(state: WalkState, relativeDir: string): void {
  const absoluteDir = relativeDir === '' ? state.root : join(state.root, relativeDir);
  const entries = readdirSync(absoluteDir, { withFileTypes: true }).sort((left, right) =>
    compareText(left.name, right.name),
  );

  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

    if (entry.isSymbolicLink()) {
      const target = canonicalPath(join(absoluteDir, entry.name));
      const inside =
        target !== null && (target === state.root || target.startsWith(`${state.root}${sep}`));
      addIndex(state, {
        path: relativePath,
        kind: entry.isDirectory() ? 'directory' : 'file',
        depth: depthOf(relativePath),
        bytes: null,
        binary: false,
        generated: false,
        symlink: true,
        nestedRepository: false,
      });
      if (target === null) {
        state.unknowns.push({
          kind: 'broken-symlink',
          path: relativePath,
          message: `符号链接目标不存在，未跟随：${relativePath}`,
        });
      } else if (!inside) {
        state.unknowns.push({
          kind: 'symlink-escape',
          path: relativePath,
          message: `符号链接指向项目根之外，未跟随：${relativePath} -> ${target}`,
        });
      }
      continue;
    }

    if (entry.isDirectory()) {
      if (
        SCAN_EXCLUDED_DIRECTORIES.includes(entry.name) ||
        state.prunedExactPaths.has(relativePath)
      ) {
        state.excludedDirectories.push(relativePath);
        continue;
      }
      if (hasGitMarker(join(absoluteDir, entry.name))) {
        const nestedRoot =
          canonicalPath(join(absoluteDir, entry.name)) ?? join(absoluteDir, entry.name);
        state.nestedRepositories.push({
          root: nestedRoot,
          relativePath,
          projectId: projectIdFor(nestedRoot),
        });
        state.unknowns.push({
          kind: 'nested-repository',
          path: relativePath,
          message: `嵌套仓库 ${relativePath} 独立为 Project；父项目不读取其文件`,
        });
        addIndex(state, {
          path: relativePath,
          kind: 'directory',
          depth: depthOf(relativePath),
          bytes: null,
          binary: false,
          generated: false,
          symlink: false,
          nestedRepository: true,
        });
        continue;
      }
      addIndex(state, {
        path: relativePath,
        kind: 'directory',
        depth: depthOf(relativePath),
        bytes: null,
        binary: false,
        generated: false,
        symlink: false,
        nestedRepository: false,
      });
      walkDirectory(state, relativePath);
      continue;
    }

    if (!entry.isFile()) continue;

    let bytes: number;
    try {
      bytes = statSync(join(absoluteDir, entry.name)).size;
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw new WorkspaceError('INTERNAL_ERROR', `无法读取文件大小：${relativePath}`, {
        cause: error,
      });
    }
    const binary = isBinaryName(entry.name) || sniffBinary(join(absoluteDir, entry.name));
    const generated = isGeneratedName(entry.name);
    addIndex(state, {
      path: relativePath,
      kind: 'file',
      depth: depthOf(relativePath),
      bytes,
      binary,
      generated,
      symlink: false,
      nestedRepository: false,
    });
    if (binary) {
      state.binaryFiles.push(relativePath);
      continue;
    }
    if (generated) {
      state.generatedFiles.push(relativePath);
      continue;
    }
    state.files.push({
      path: relativePath,
      absolutePath: join(absoluteDir, entry.name),
      bytes,
      category: categorize(relativePath),
      binary,
      generated,
    });
  }
}

interface BodySelection {
  readonly bodyFiles: readonly ScannedBodyFile[];
  readonly skippedFiles: readonly SkippedBodyFile[];
  readonly bodyBytesRead: number;
  readonly unknowns: readonly ScanUnknown[];
}

/** Selects and reads body files in tier order until the budget is exhausted. */
function selectBodyFiles(
  files: readonly WalkedFile[],
  options: { readonly budget: ScanBudget; readonly revision: string | null },
): BodySelection {
  const candidates = files
    .filter((file) => file.category !== null && !file.binary && !file.generated)
    .sort(
      (left, right) =>
        CATEGORY_ORDER[left.category ?? 'readme'] - CATEGORY_ORDER[right.category ?? 'readme'] ||
        depthOf(left.path) - depthOf(right.path) ||
        compareText(left.path, right.path),
    );

  const bodyFiles: ScannedBodyFile[] = [];
  const skippedFiles: SkippedBodyFile[] = [];
  const unknowns: ScanUnknown[] = [];
  let bodyBytesRead = 0;
  let stoppedByFiles = false;
  let stoppedByBytes = false;

  for (const candidate of candidates) {
    const category = candidate.category ?? 'readme';
    if (bodyFiles.length >= options.budget.maxBodyFiles) {
      stoppedByFiles = true;
      skippedFiles.push({
        path: candidate.path,
        bytes: candidate.bytes,
        category,
        reason: 'body-files',
      });
      continue;
    }
    if (bodyBytesRead + candidate.bytes > options.budget.maxBodyBytes) {
      stoppedByBytes = true;
      skippedFiles.push({
        path: candidate.path,
        bytes: candidate.bytes,
        category,
        reason: 'body-bytes',
      });
      continue;
    }
    let content: string;
    try {
      content = readFileSync(candidate.absolutePath, 'utf8');
    } catch (error) {
      if (isMissingPathError(error)) continue;
      unknowns.push({
        kind: 'unreadable-file',
        path: candidate.path,
        message: `无法读取正文，已跳过：${candidate.path}（${String(error)}）`,
      });
      continue;
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    bodyBytesRead += bytes;
    bodyFiles.push({
      path: candidate.path,
      bytes,
      sha256: sha256Hex(content),
      category,
      content,
      ref: sourceRefFor(options.revision, candidate.path),
    });
  }

  if (stoppedByFiles) {
    unknowns.push({
      kind: 'budget-body-files',
      path: null,
      message: `正文文件预算用尽：最多 ${options.budget.maxBodyFiles} 个，未读取 ${skippedFiles.filter((file) => file.reason === 'body-files').length} 个候选文件；当前地图为部分结果`,
    });
  }
  if (stoppedByBytes) {
    unknowns.push({
      kind: 'budget-body-bytes',
      path: null,
      message: `正文字节预算用尽：最多 ${options.budget.maxBodyBytes} 字节，未读取 ${skippedFiles.filter((file) => file.reason === 'body-bytes').length} 个候选文件；当前地图为部分结果`,
    });
  }
  return { bodyFiles, skippedFiles, bodyBytesRead, unknowns };
}

/**
 * Scans one project root inside the initialization budget.
 *
 * Returns a partial map plus explicit unknowns rather than throwing when the
 * budget runs out; a path that does not resolve is an explicit failure.
 */
export function scanProject(options: ScanOptions): ScanOutcome {
  const identity = resolveProject(options.root, { git: options.git });
  if (!identity.ok) return identity;

  const documentRoot = normalizeDocumentRoot(options.documentRoot);
  const budget = resolveBudget(options.budget);
  const state: WalkState = {
    root: identity.root,
    budget,
    documentRoot,
    prunedExactPaths: new Set([documentRoot, '.agentdev/work']),
    index: [],
    files: [],
    excludedDirectories: [],
    binaryFiles: [],
    generatedFiles: [],
    nestedRepositories: [],
    unknowns: [],
    indexTotal: 0,
    indexTruncated: false,
  };
  walkDirectory(state, '');

  const selection = selectBodyFiles(state.files, {
    budget,
    revision: identity.gitRevision,
  });
  const unknowns: ScanUnknown[] = [...state.unknowns, ...selection.unknowns];

  if (state.indexTruncated) {
    unknowns.push({
      kind: 'index-truncated',
      path: null,
      message: `目录/文件索引达到上限 ${budget.maxIndexEntries} 条，已发现 ${state.indexTotal} 条；索引分页只覆盖前 ${budget.maxIndexEntries} 条`,
    });
  }
  for (const diagnostic of identity.diagnostics) {
    unknowns.push({
      kind: 'git-unavailable',
      path: diagnostic.path ?? null,
      message: `Git 探测失败，按无 revision 处理：${diagnostic.message}`,
    });
  }
  if (state.indexTotal === 0) {
    unknowns.push({
      kind: 'empty-project',
      path: null,
      message: '索引为空：目录中没有可观察文件（明确空项目状态）',
    });
  }

  const partial = selection.skippedFiles.length > 0 || state.indexTruncated;
  return {
    ok: true,
    requestedPath: identity.requestedPath,
    root: identity.root,
    gitRoot: identity.gitRoot,
    gitRevision: identity.gitRevision,
    projectId: identity.projectId,
    documentRoot,
    index: state.index,
    indexTotal: state.indexTotal,
    indexLimit: budget.maxIndexEntries,
    indexTruncated: state.indexTruncated,
    excludedDirectories: state.excludedDirectories,
    binaryFiles: state.binaryFiles,
    generatedFiles: state.generatedFiles,
    nestedRepositories: state.nestedRepositories,
    bodyFiles: selection.bodyFiles,
    skippedFiles: selection.skippedFiles,
    bodyBytesRead: selection.bodyBytesRead,
    budget,
    unknowns,
    partial,
    completeness: partial ? 'partial' : 'complete',
    claimsFullUnderstanding: false,
  };
}

export interface IndexPage {
  readonly entries: readonly IndexEntry[];
  readonly offset: number;
  readonly limit: number;
  /** Pageable entries in the capped index. */
  readonly total: number;
  /** Entries discovered before the cap (`indexTotal`). */
  readonly discoverable: number;
  readonly truncated: boolean;
  readonly nextOffset: number | null;
}

export interface IndexPageSuccess {
  readonly ok: true;
  readonly page: IndexPage;
}

export interface IndexPageFailure {
  readonly ok: false;
  readonly errors: readonly WorkspaceDiagnostic[];
}

export type IndexPageOutcome = IndexPageSuccess | IndexPageFailure;

export interface IndexPageOptions {
  readonly offset?: number;
  readonly limit?: number;
}

/**
 * Reads one page of the primary index.
 *
 * The index itself never consumes the body budget; it is capped at
 * `SCAN_INDEX_LIMIT` entries and paged here with the protocol default/max page
 * size (`data.md` §1: default 50, max 200).
 */
export function indexPage(
  result: Pick<ScanResult, 'index' | 'indexTotal' | 'indexTruncated'>,
  options: IndexPageOptions = {},
): IndexPageOutcome {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  const errors: WorkspaceDiagnostic[] = [];
  if (!Number.isInteger(offset) || offset < 0) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `分页 offset 必须是非负整数，收到：${String(offset)}`,
    });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    errors.push({
      code: 'VALIDATION_ERROR',
      message: `分页 limit 必须在 1..${MAX_PAGE_LIMIT}，收到：${String(limit)}`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const entries = result.index.slice(offset, offset + limit);
  const nextOffset = offset + limit < result.index.length ? offset + limit : null;
  return {
    ok: true,
    page: {
      entries,
      offset,
      limit,
      total: result.index.length,
      discoverable: result.indexTotal,
      truncated: result.indexTruncated,
      nextOffset,
    },
  };
}

/** One observed fact carried into candidate knowledge. */
export interface Observation {
  readonly kind: ScanCategory | 'empty-project' | 'nested-repository';
  readonly path: string | null;
  readonly detail: string;
}

export interface CandidateDocument {
  /** Repo-relative path under `documentRoot`. */
  readonly path: string;
  /** Document-root-relative path (used by the Feature format and links). */
  readonly documentPath: string;
  readonly markdown: string;
  /** `sha256` of the Markdown; the write/recovery comparison key. */
  readonly contentHash: string;
  readonly kind: 'project' | 'index' | 'code-map' | 'features-index' | 'feature';
  readonly featureId: string | null;
  /** Always `true`: a candidate is never a delivered document. */
  readonly candidate: true;
  /** Always `null`: candidates never touch a delivery ref. */
  readonly deliveryRef: null;
}

export interface CandidateFeature {
  /** Valid Feature facts; the rendered document parses back to the same fields. */
  readonly feature: ParsedFeature;
  readonly observed: true;
  readonly candidate: true;
  readonly design: 'unconfirmed';
  readonly moduleKey: string;
  readonly sourceRefs: readonly string[];
  readonly document: CandidateDocument;
}

export type KnowledgeConflictKind =
  | 'invalid-document'
  | 'implementation-not-observed'
  | 'missing-implementation-entry'
  | 'design-code-conflict';

/** A disagreement between an existing formal document and the observed tree. */
export interface KnowledgeConflict {
  readonly kind: KnowledgeConflictKind;
  /** Repo-relative path of the existing document. */
  readonly documentPath: string;
  readonly featureId: string | null;
  readonly moduleKey: string | null;
  /** Claimed entry paths the scan could not observe. */
  readonly paths: readonly string[];
  readonly claimed: string;
  readonly observed: string;
  readonly detail: string;
}

export interface CandidateKnowledge {
  readonly candidate: true;
  /** Always `false`: initialization candidates never update a delivery ref. */
  readonly updatesDeliveryRef: false;
  readonly deliveryRef: null;
  readonly documentRoot: string;
  readonly revision: string | null;
  readonly emptyProject: boolean;
  readonly features: readonly CandidateFeature[];
  readonly documents: readonly CandidateDocument[];
  readonly conflicts: readonly KnowledgeConflict[];
  readonly observations: readonly Observation[];
  readonly unknowns: readonly ScanUnknown[];
}

export interface CandidateKnowledgeInput {
  readonly scan: ScanResult;
  readonly documentRoot?: string;
  readonly existingDocuments?: readonly FeatureDocumentInput[];
  readonly readDiagnostics?: readonly WorkspaceDiagnostic[];
  /**
   * Decision/requirement ids the current context can resolve for
   * `design_decision_refs` (`parseFeatureDocument`). Initialization usually has
   * none, so a confirmed design document is then reported as a conflict instead of
   * being silently trusted.
   */
  readonly knownIds?: readonly string[];
}

/** Entry path of one 实现入口 item (`path#symbol note` → `path`). */
function entryPathOf(item: string): string {
  const trimmed = item.trim();
  const hashAt = trimmed.indexOf('#');
  const pathPart = (hashAt === -1 ? trimmed : trimmed.slice(0, hashAt)).trim();
  const spaceAt = pathPart.search(/\s/u);
  return (spaceAt === -1 ? pathPart : pathPart.slice(0, spaceAt)).trim();
}

/** Module key of a repo-relative path, or `null` for a root-level file. */
export function moduleKeyOf(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment !== '');
  // A root-level file is still an observable capability: it belongs to the `root`
  // module. Returning `null` here used to strand a project whose only files are at
  // the repository root between "no capability" and "not an empty project", which
  // made the Ready gate unsatisfiable (W4R1-01).
  if (segments.length < 2) return ROOT_MODULE_KEY;
  const first = segments[0] ?? '';
  if (SOURCE_ROOTS.has(first))
    return segments.length >= 3 ? `${first}/${segments[1] ?? ''}` : first;
  return first;
}

/** Compares existing formal documents against the observed tree. */
export function detectKnowledgeConflicts(input: {
  readonly documents: readonly FeatureDocumentInput[];
  readonly observedPaths: readonly string[];
  readonly revision: string;
  readonly knownIds?: readonly string[];
}): readonly KnowledgeConflict[] {
  const observed = new Set(input.observedPaths);
  const conflicts: KnowledgeConflict[] = [];
  for (const document of input.documents) {
    const parsed = parseFeatureDocument(document.markdown, {
      relativePath: document.relativePath,
      revision: input.revision,
      ...(input.knownIds === undefined ? {} : { knownIds: input.knownIds }),
    });
    if (!parsed.ok) {
      const first = parsed.errors[0];
      conflicts.push({
        kind: 'invalid-document',
        documentPath: document.relativePath,
        featureId: null,
        moduleKey: null,
        paths: [],
        claimed: '可解析的 Feature 文档',
        observed: '解析失败',
        detail: `已有文档不符合 Feature 格式：${first === undefined ? '未知错误' : first.message}`,
      });
      continue;
    }
    const feature = parsed.feature;
    if (feature.implementation === 'absent') continue;
    const entries = feature.sections.entries.items.map((item) => entryPathOf(item));
    const missing = entries.filter((path) => path !== '' && !observed.has(path));
    if (missing.length === 0) continue;
    const moduleKey = moduleKeyOf(missing[0] ?? '') ?? null;
    const kind: KnowledgeConflictKind =
      feature.design === 'confirmed'
        ? 'design-code-conflict'
        : missing.length === entries.length
          ? 'implementation-not-observed'
          : 'missing-implementation-entry';
    const detail =
      kind === 'design-code-conflict'
        ? `已有确认设计文档与观察事实冲突：${document.relativePath} 的入口在扫描索引中不存在`
        : `已有文档声明的实现入口未在扫描索引中观察到：${document.relativePath}`;
    conflicts.push({
      kind,
      documentPath: document.relativePath,
      featureId: feature.featureId,
      moduleKey,
      paths: missing,
      claimed: `design=${feature.design} implementation=${feature.implementation}（入口 ${entries.length} 个）`,
      observed: `索引中不存在：${missing.join('、')}`,
      detail,
    });
  }
  return conflicts;
}

function section(heading: string, text: string, items: readonly string[] = []): FeatureSectionBody {
  return { heading, text, items };
}

function withCandidateBanner(markdown: string): string {
  return `${CANDIDATE_BANNER}\n\n${markdown}`;
}

function candidateDocument(input: {
  readonly documentRoot: string;
  readonly documentPath: string;
  readonly markdown: string;
  readonly kind: CandidateDocument['kind'];
  readonly featureId: string | null;
}): CandidateDocument {
  const markdown = withCandidateBanner(input.markdown);
  return {
    path: `${input.documentRoot}/${input.documentPath}`,
    documentPath: input.documentPath,
    markdown,
    contentHash: contentHash(markdown),
    kind: input.kind,
    featureId: input.featureId,
    candidate: true,
    deliveryRef: null,
  };
}

function tableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ').trim();
}

/** Builds candidate knowledge from observed facts only. */
export function generateCandidateKnowledge(input: CandidateKnowledgeInput): CandidateKnowledge {
  const scan = input.scan;
  const documentRoot = normalizeDocumentRoot(input.documentRoot ?? scan.documentRoot);
  const revision = scan.gitRevision;
  const observations: Observation[] = [];
  const unknowns: ScanUnknown[] = [...scan.unknowns];
  for (const diagnostic of input.readDiagnostics ?? []) {
    unknowns.push({
      kind: 'unreadable-file',
      path: diagnostic.path ?? null,
      message: `已有知识文档读取诊断：${diagnostic.message}`,
    });
  }

  for (const file of scan.bodyFiles) {
    if (file.category === 'manifest' && basename(file.path) === 'package.json') {
      let detail = `清单 ${file.path}（${file.bytes} 字节）`;
      try {
        const parsed: unknown = JSON.parse(file.content);
        if (typeof parsed === 'object' && parsed !== null) {
          const record = parsed as { readonly name?: unknown; readonly scripts?: unknown };
          const name = typeof record.name === 'string' ? record.name : '未声明';
          const scripts =
            typeof record.scripts === 'object' && record.scripts !== null
              ? Object.keys(record.scripts).join('、')
              : '无';
          detail = `清单 ${file.path}：name=${name}；scripts=${scripts === '' ? '无' : scripts}`;
        }
      } catch (error) {
        unknowns.push({
          kind: 'unreadable-manifest',
          path: file.path,
          message: `清单 JSON 解析失败，未记录其字段：${file.path}（${String(error)}）`,
        });
      }
      observations.push({ kind: 'manifest', path: file.path, detail });
      continue;
    }
    observations.push({
      kind: file.category,
      path: file.path,
      detail: `读取 ${file.category}：${file.path}（sha256 ${file.sha256.slice(0, 12)}）`,
    });
  }

  const indexedEmpty = scan.indexTotal === 0;
  if (indexedEmpty) {
    observations.push({
      kind: 'empty-project',
      path: null,
      detail: '索引为空：明确空项目状态，尚无已实现能力',
    });
  }
  for (const nested of scan.nestedRepositories) {
    observations.push({
      kind: 'nested-repository',
      path: nested.relativePath,
      detail: `嵌套仓库 ${nested.relativePath} 独立为 Project（父项目不读取其文件）`,
    });
  }

  const observedPaths = scan.index
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.path);
  const conflicts = detectKnowledgeConflicts({
    documents: input.existingDocuments ?? [],
    observedPaths,
    revision: revision ?? '未调查',
    ...(input.knownIds === undefined ? {} : { knownIds: input.knownIds }),
  });

  const filesByModule = new Map<string, ScannedBodyFile[]>();
  for (const file of scan.bodyFiles) {
    const key = moduleKeyOf(file.path);
    if (key === null) continue;
    const list = filesByModule.get(key) ?? [];
    list.push(file);
    filesByModule.set(key, list);
  }
  const moduleKeys = [...filesByModule.entries()]
    .filter(([, files]) =>
      files.some((file) => isCodeFile(file.path) || file.category === 'routes-models'),
    )
    .map(([key]) => key)
    .sort(compareText);

  const usedIds = new Set<string>();
  const features: readonly CandidateFeature[] = moduleKeys.map((moduleKey) =>
    buildCandidateFeature({
      moduleKey,
      files: filesByModule.get(moduleKey) ?? [],
      revision,
      documentRoot,
      conflicts,
      scan,
      usedIds,
    }),
  );

  // A project has a capability once at least one candidate Feature was observed;
  // otherwise it is an explicit empty (no-capability) project, even when the index
  // holds non-code files such as a lone README (W4R1-01).
  const emptyProject = features.length === 0;
  if (emptyProject && !indexedEmpty) {
    observations.push({
      kind: 'empty-project',
      path: null,
      detail: '观察到文件但未识别出可确认能力：明确空项目状态，尚无已实现能力',
    });
  }

  const indexEntries: FeatureIndexEntry[] = features.map((candidate) => ({
    featureId: candidate.feature.featureId,
    name: candidate.feature.name,
    module: candidate.feature.module,
    summary: candidate.feature.sections.purpose.text.split(/[。\n]/u)[0] ?? '未调查',
    link: candidate.feature.ownerDocument,
    design: candidate.feature.design,
    implementation: candidate.feature.implementation,
    verification: candidate.feature.verification,
  }));
  const codeMap: CodeMapEntry[] = features.flatMap((candidate) =>
    candidate.feature.sections.entries.items.map((item) => ({
      featureId: candidate.feature.featureId,
      featureName: candidate.feature.name,
      module: candidate.feature.module,
      path: entryPathOf(item),
      link: candidate.feature.ownerDocument,
    })),
  );

  const documents: CandidateDocument[] = [
    candidateDocument({
      documentRoot,
      documentPath: 'PROJECT.md',
      markdown: renderCandidateProject({ scan, documentRoot, features, unknowns, emptyProject }),
      kind: 'project',
      featureId: null,
    }),
    candidateDocument({
      documentRoot,
      documentPath: 'INDEX.md',
      markdown: renderCandidateIndex({ scan, features, unknowns }),
      kind: 'index',
      featureId: null,
    }),
    candidateDocument({
      documentRoot,
      documentPath: 'CODE_MAP.md',
      markdown: renderCodeMap(codeMap),
      kind: 'code-map',
      featureId: null,
    }),
    candidateDocument({
      documentRoot,
      documentPath: 'features/README.md',
      markdown: renderIndex(indexEntries),
      kind: 'features-index',
      featureId: null,
    }),
    ...features.map((candidate) => candidate.document),
  ];

  return {
    candidate: true,
    updatesDeliveryRef: false,
    deliveryRef: null,
    documentRoot,
    revision,
    emptyProject,
    features,
    documents,
    conflicts,
    observations,
    unknowns,
  };
}

function featureIdFor(moduleKey: string, used: ReadonlySet<string>): string {
  for (let salt = 0; salt <= 32; salt += 1) {
    const id = `F-${sha256Hex(`${moduleKey}#${salt}`).slice(0, 8)}`;
    if (!used.has(id)) return id;
  }
  throw new WorkspaceError('INTERNAL_ERROR', `无法为模块生成唯一 feature_id：${moduleKey}`);
}

function renderCandidateProject(input: {
  readonly scan: ScanResult;
  readonly documentRoot: string;
  readonly features: readonly CandidateFeature[];
  readonly unknowns: readonly ScanUnknown[];
  readonly emptyProject: boolean;
}): string {
  const { scan } = input;
  const lines: string[] = [
    '# 项目知识导航（候选）',
    '',
    '## 用户',
    '未调查。',
    '',
    '## 目标',
    '未调查（初始化仅记录观察事实，产品意图待用户确认）。',
    '',
    '## 边界',
    '',
    `- Git 根：${scan.gitRoot ?? '无 Git（仅调查；正式写入前需用户授权 Git 初始化）'}`,
    `- 扫描根：${scan.root}`,
    `- document-root：${input.documentRoot}`,
    `- 代码 revision：${scan.gitRevision ?? '未调查'}`,
    `- 实现状态：${input.emptyProject ? 'absent（未实现，明确空项目）' : 'partial（观察到代码，未经确认）'}`,
    `- 观察模块：${input.features.length} 个`,
    `- 正文预算：最多 ${scan.budget.maxBodyFiles} 个文件 / ${scan.budget.maxBodyBytes} 字节；已读取 ${scan.bodyFiles.length} 个 / ${scan.bodyBytesRead} 字节（${scan.completeness}）`,
    '',
    '## 主要模块',
    '',
  ];
  if (input.features.length === 0) {
    lines.push('无已观察模块。', '');
  } else {
    lines.push('| module | 功能 |', '|---|---|');
    for (const candidate of input.features) {
      lines.push(
        `| ${tableCell(candidate.feature.module)} | [${tableCell(candidate.feature.name)}](features/${candidate.feature.featureId}/README.md) |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## 导航',
    '',
    '- [知识索引](INDEX.md)',
    '- [代码地图](CODE_MAP.md)',
    '- [功能索引](features/README.md)',
    '',
    '## 未知',
    '',
  );
  if (input.unknowns.length === 0) {
    lines.push('无。', '');
  } else {
    for (const unknown of input.unknowns) {
      lines.push(`- ${unknown.path === null ? '' : `${unknown.path}：`}${unknown.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderCandidateIndex(input: {
  readonly scan: ScanResult;
  readonly features: readonly CandidateFeature[];
  readonly unknowns: readonly ScanUnknown[];
}): string {
  const lines: string[] = ['# 知识索引（候选）', '', '## 功能', ''];
  if (input.features.length === 0) {
    lines.push('无。', '');
  } else {
    lines.push('| feature_id | module | 文档 |', '|---|---|---|');
    for (const candidate of input.features) {
      lines.push(
        `| ${candidate.feature.featureId} | ${tableCell(candidate.feature.module)} | [${candidate.feature.featureId}](features/${candidate.feature.featureId}/README.md) |`,
      );
    }
    lines.push('');
  }
  lines.push('## 正文读取清单', '');
  if (input.scan.bodyFiles.length === 0) {
    lines.push('无。', '');
  } else {
    lines.push('| 路径 | 层级 | 字节 | sha256 |', '|---|---|---|---|');
    for (const file of input.scan.bodyFiles) {
      lines.push(`| ${tableCell(file.path)} | ${file.category} | ${file.bytes} | ${file.sha256} |`);
    }
    lines.push('');
  }
  lines.push(
    '## 索引统计',
    '',
    `- 已发现条目：${input.scan.indexTotal}`,
    `- 索引上限：${input.scan.indexLimit}`,
    `- 截断：${input.scan.indexTruncated ? '是' : '否'}`,
    '',
  );
  lines.push('## 未知', '');
  if (input.unknowns.length === 0) {
    lines.push('无。', '');
  } else {
    for (const unknown of input.unknowns) {
      lines.push(`- ${unknown.path === null ? '' : `${unknown.path}：`}${unknown.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildCandidateFeature(input: {
  readonly moduleKey: string;
  readonly files: readonly ScannedBodyFile[];
  readonly revision: string | null;
  readonly documentRoot: string;
  readonly conflicts: readonly KnowledgeConflict[];
  readonly scan: ScanResult;
  readonly usedIds: Set<string>;
}): CandidateFeature {
  const moduleKey = input.moduleKey;
  const featureId = featureIdFor(moduleKey, input.usedIds);
  input.usedIds.add(featureId);
  const module = moduleKey.split('/').at(-1) ?? moduleKey;
  const ownerDocument = `features/${featureId}/README.md`;
  const sourceRefs = input.files.map((file) => sourceRefFor(input.revision, file.path));
  const moduleConflicts = input.conflicts.filter(
    (conflict) =>
      conflict.moduleKey === moduleKey ||
      conflict.paths.some((path) => moduleKeyOf(path) === moduleKey),
  );

  const gapItems: string[] = [];
  for (const conflict of moduleConflicts) {
    gapItems.push(
      `设计/实现冲突（${conflict.kind}）：${conflict.detail}；声明 ${conflict.claimed}；观察 ${conflict.observed}。保持 design=unconfirmed，等待用户处置，不擅自认可行为。`,
    );
  }
  if (input.scan.skippedFiles.length > 0) {
    gapItems.push(
      `未读取正文：${input.scan.skippedFiles.length} 个候选文件（预算上限 ${input.scan.budget.maxBodyFiles} 个 / ${input.scan.budget.maxBodyBytes} 字节）`,
    );
  }
  if (input.scan.indexTruncated) {
    gapItems.push(
      `索引截断：已发现 ${input.scan.indexTotal} 条，只索引前 ${input.scan.indexLimit} 条`,
    );
  }

  const feature: ParsedFeature = {
    title: moduleKey,
    documentPath: ownerDocument,
    documentRevision: input.revision ?? '未调查',
    featureId,
    name: moduleKey,
    module,
    ownerDocument,
    design: 'unconfirmed',
    designDecisionRefs: [],
    implementation: 'partial',
    verification: 'unverified',
    verificationEvidenceRefs: [],
    verificationCoverage: [],
    investigation: 'partial',
    investigationScope: [`路径观察：${moduleKey}`],
    sourceRefs,
    revision: input.revision ?? '未调查',
    relations: [],
    sections: {
      purpose: section('用途', '未调查。候选由路径与文件观察生成；产品意图与用户目标尚未确认。'),
      currentBehaviour: section(
        '当前行为',
        '观察事实（候选）：以下由扫描得到，不代表已确认行为。',
        input.files.map(
          (file) => `观察文件 ${file.path}（${file.category}，sha256 ${file.sha256}）`,
        ),
      ),
      entries: section(
        '实现入口',
        '',
        input.files.map((file) => file.path),
      ),
      gaps: section(
        '已知差距',
        gapItems.length === 0 ? '无已登记差距。' : '候选观察差距：',
        gapItems,
      ),
      decisions: section('关键决定', '无。'),
    },
  };

  return {
    feature,
    observed: true,
    candidate: true,
    design: 'unconfirmed',
    moduleKey,
    sourceRefs,
    document: candidateDocument({
      documentRoot: input.documentRoot,
      documentPath: ownerDocument,
      markdown: renderReadme(feature),
      kind: 'feature',
      featureId,
    }),
  };
}

export interface KnowledgeDocumentRead {
  readonly ok: true;
  /** Existing Feature documents under `<documentRoot>/features/<id>/README.md`. */
  readonly documents: readonly FeatureDocumentInput[];
  readonly paths: readonly string[];
  readonly diagnostics: readonly WorkspaceDiagnostic[];
}

/**
 * Reads existing Feature documents at the document root.
 *
 * A missing document root is an empty set (the project has no knowledge yet), not
 * an error; a file that exists but cannot be read is reported as a diagnostic.
 */
export function readKnowledgeDocuments(options: {
  readonly root: string;
  readonly documentRoot?: string;
}): KnowledgeDocumentRead {
  const documentRoot = normalizeDocumentRoot(options.documentRoot);
  const featuresDir = join(options.root, documentRoot, 'features');
  const documents: FeatureDocumentInput[] = [];
  const paths: string[] = [];
  const diagnostics: WorkspaceDiagnostic[] = [];

  let entries: readonly Dirent[];
  try {
    entries = readdirSync(featuresDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return { ok: true, documents, paths, diagnostics };
    throw new WorkspaceError('INTERNAL_ERROR', `无法读取功能目录：${featuresDir}`, {
      cause: error,
    });
  }

  for (const entry of [...entries].sort((left, right) => compareText(left.name, right.name))) {
    if (!entry.isDirectory()) continue;
    const relativePath = `features/${entry.name}/README.md`;
    const absolutePath = join(featuresDir, entry.name, 'README.md');
    let markdown: string;
    try {
      markdown = readFileSync(absolutePath, 'utf8');
    } catch (error) {
      if (isMissingPathError(error)) continue;
      diagnostics.push({
        code: 'INTERNAL_ERROR',
        message: `无法读取已有 Feature 文档：${absolutePath}`,
        path: absolutePath,
      });
      continue;
    }
    documents.push({ relativePath, markdown });
    paths.push(`${documentRoot}/${relativePath}`);
  }
  return { ok: true, documents, paths, diagnostics };
}
