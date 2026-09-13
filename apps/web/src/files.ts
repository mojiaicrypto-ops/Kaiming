/**
 * Read-only project files for the Docs/Files surface (AC-077).
 *
 * `experience.md` §1/§3 and `protocol.md` §5 define the promise: browsing shows the
 * **target revision** of the current delivery branch, every path is confined to the
 * project root, and reading a file never mutates anything the Agent sees — this
 * module only ever calls `readdir`/`readFile` and never touches a Context snapshot,
 * a Run or a worktree.
 *
 * The port exists because the daemon's workbench protocol does not yet expose
 * `file.list`/`file.read` (reported as an out-of-slice gap): the BFF serves the
 * documented behaviour from the real repository instead of inventing data, and the
 * seam keeps the boundary rule testable without a filesystem.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import type { JsonObject } from '@agentdev/contracts';

export const FILE_LIMITS = {
  /** Entries a listing returns before it reports truncation. */
  maxEntries: 2_000,
  /** Bytes returned inline; beyond this the file is a download. */
  maxInlineBytes: 1024 * 1024,
  /** Lines returned inline, as `experience.md` §3 fixes for diff previews. */
  maxInlineLines: 2_000,
  /** Largest file the BFF will read at all, to bound memory. */
  maxFileBytes: 8 * 1024 * 1024,
} as const;

/** Directory names never walked: build output, dependencies and VCS metadata. */
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.pnpm-store',
  '.turbo',
  '.next',
]);

export interface FileEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly bytes: number | null;
}

export interface FileListing {
  readonly root: string;
  readonly revision: string;
  readonly branch: string;
  readonly entries: readonly FileEntry[];
  readonly truncated: boolean;
}

export interface FileContent {
  readonly path: string;
  readonly revision: string;
  readonly mime: string;
  readonly hash: string;
  readonly bytes: number;
  readonly content: string;
  readonly truncated: boolean;
  readonly binary: boolean;
}

export interface FilePort {
  /** Lists the repository tree of one revision, confined to the project root. */
  list(input: {
    readonly projectId: string;
    readonly root: string | undefined;
    readonly revision: string;
    readonly branch: string;
    readonly query?: string;
  }): FileListing;
  /** Reads one file; a path outside the root is refused with `NOT_FOUND`. */
  read(input: {
    readonly projectId: string;
    readonly root: string | undefined;
    readonly revision: string;
    readonly path: string;
  }): FileContent;
}

/** The refusal a path outside the project root produces. */
export class FileBoundaryError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'FileBoundaryError';
  }
}

/**
 * Resolves a caller-supplied path inside `root`.
 *
 * `normalize` collapses `..` segments and the result must still be inside `root`, so
 * a symbolic-looking path cannot escape the project. An absolute path is refused
 * outright rather than re-rooted.
 */
export function resolveInsideRoot(root: string, candidate: string): string {
  if (candidate === '') return root;
  if (isAbsolute(candidate)) {
    throw new FileBoundaryError(
      `path ${candidate} is absolute; only project-relative paths are read`,
    );
  }
  const base = resolve(root);
  const target = resolve(base, normalize(candidate));
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new FileBoundaryError(`path ${candidate} is outside the project root`);
  }
  return target;
}

/** A stable, root-relative path for the wire. */
export function relativeToRoot(root: string, target: string): string {
  const value = relative(resolve(root), resolve(target));
  return value.split(sep).join('/');
}

/** Whether one entry looks textual enough to render inline. */
export function isTextMime(mime: string): boolean {
  return (
    mime.startsWith('text/') || mime === 'application/json' || mime === 'application/javascript'
  );
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.toml': 'text/plain',
  '.yml': 'text/plain',
  '.yaml': 'text/plain',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.sql': 'text/plain',
  '.sh': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
};

export function mimeOf(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'text/plain';
  const extension = path.slice(dot).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** True when the bytes look like a text file rather than binary. */
function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 8_000);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

/**
 * The real filesystem implementation.
 *
 * `root` is the repository root the daemon reports for the Project. A missing or
 * non-directory root yields a `FileBoundaryError`, so a page shows an honest refusal
 * instead of an empty tree that looks like an empty project.
 */
export class NodeFilePort implements FilePort {
  private readonly limits: typeof FILE_LIMITS;

  constructor(limits: typeof FILE_LIMITS = FILE_LIMITS) {
    this.limits = limits;
  }

  list(input: {
    readonly projectId: string;
    readonly root: string | undefined;
    readonly revision: string;
    readonly branch: string;
    readonly query?: string;
  }): FileListing {
    const root = this.requireRoot(input.root);
    const entries: FileEntry[] = [];
    const query = input.query?.toLowerCase();
    const walk = (directory: string): boolean => {
      const names = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const entry of names) {
        if (entries.length >= this.limits.maxEntries) return false;
        if (entry.name.startsWith('.') && entry.name !== '.agentdev') continue;
        if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const path = relativeToRoot(root, absolute);
        if (entry.isDirectory()) {
          if (query === undefined || path.toLowerCase().includes(query)) {
            entries.push({ path, kind: 'directory', bytes: null });
          }
          if (!walk(absolute)) return false;
          continue;
        }
        if (!entry.isFile()) continue;
        if (query !== undefined && !path.toLowerCase().includes(query)) continue;
        let bytes: number | null;
        try {
          bytes = statSync(absolute).size;
        } catch {
          bytes = null;
        }
        entries.push({ path, kind: 'file', bytes });
      }
      return true;
    };
    const complete = walk(root);
    return {
      root,
      revision: input.revision,
      branch: input.branch,
      entries,
      truncated: !complete,
    };
  }

  read(input: {
    readonly projectId: string;
    readonly root: string | undefined;
    readonly revision: string;
    readonly path: string;
  }): FileContent {
    const root = this.requireRoot(input.root);
    const target = resolveInsideRoot(root, input.path);
    let stats;
    try {
      stats = statSync(target);
    } catch {
      throw new FileBoundaryError(`path ${input.path} does not exist in the target revision`);
    }
    if (!stats.isFile()) {
      throw new FileBoundaryError(`path ${input.path} is not a file`);
    }
    if (stats.size > this.limits.maxFileBytes) {
      throw new FileBoundaryError(
        `path ${input.path} is ${String(stats.size)} bytes; the inline reader is bounded to ${String(this.limits.maxFileBytes)}`,
      );
    }
    const bytes = readFileSync(target);
    const hash = sha256Of(bytes);
    const mime = mimeOf(input.path);
    const binary = !isTextMime(mime) || looksBinary(bytes);
    const text = binary ? '' : bytes.toString('utf8');
    const lines = text === '' ? [] : text.split('\n');
    const truncatedByBytes = bytes.byteLength > this.limits.maxInlineBytes;
    const truncatedByLines = lines.length > this.limits.maxInlineLines;
    const content = truncatedByBytes
      ? bytes.subarray(0, this.limits.maxInlineBytes).toString('utf8')
      : truncatedByLines
        ? lines.slice(0, this.limits.maxInlineLines).join('\n')
        : text;
    return {
      path: input.path,
      revision: input.revision,
      mime,
      hash,
      bytes: bytes.byteLength,
      content,
      truncated: truncatedByBytes || truncatedByLines,
      binary,
    };
  }

  private requireRoot(root: string | undefined): string {
    if (root === undefined || root === '') {
      throw new FileBoundaryError('the Project root is not known to this BFF');
    }
    let stats;
    try {
      stats = statSync(root);
    } catch {
      throw new FileBoundaryError('the Project root is not readable on this host');
    }
    if (!stats.isDirectory()) {
      throw new FileBoundaryError('the Project root is not a directory');
    }
    return resolve(root);
  }
}

/** Content-addressed hash of file bytes, matching the protocol's 64 hex characters. */
export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The `file.list` query shape the page router hands to the port. */
export interface FileQuery extends JsonObject {
  readonly path?: string;
  readonly query?: string;
}
