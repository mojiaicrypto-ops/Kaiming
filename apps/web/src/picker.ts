/**
 * The **human-only** folder picker behind the workbench's "open a folder" action.
 *
 * `docs/product/experience.md` §1 makes `/projects` the page where a user opens or
 * creates a project, and the product owner's ruling for WP-12 is explicit: the picker
 * is **global** (it starts at the home directory, may go up to `/`, and accepts a
 * pasted absolute path), it lists **names only**, it is read-only, and it is audited.
 *
 * Safety is structural, not a promise, and rests on four facts:
 *
 * 1. **It is not a protocol method.** This module is imported by `app.ts` (the BFF)
 *    and by the host's `main.ts`; it is never registered in `WorkbenchProtocol`, in
 *    `GLOBAL_METHODS`/`WRITE_METHODS`, or in any tool catalogue. A `/rpc` request
 *    naming it cannot exist, so the daemon's `dispatch` never reaches it.
 * 2. **It is not a tool.** The agent's tool surface is the Runner's fixed tool union
 *    executed through the tool bridge under an Attempt capability; nothing in
 *    `packages/core` or `apps/daemon/src/tool-handler.ts` can call a BFF route. The
 *    model never holds a browser session cookie (`agentdev_web`, `HttpOnly`), and the
 *    BFF's own port is registered in the daemon's egress registry, so a tool call to
 *    it is a fixed, non-approvable network refusal (`w1-implementation.md` §7.2).
 * 3. **It reads no file contents.** The only filesystem calls are `readdirSync` and a
 *    per-entry `statSync` for the directory flag. There is no `readFile` on any path.
 * 4. **Every listing is audited** before the answer is returned: who (the BFF session
 *    id, the audit subject of `protocol.md` §2), what (the canonical path and the
 *    entry count) and when. If the audit sink cannot record the read, the read is
 *    refused rather than served unlogged.
 *
 * The owner asked for a deny-list proposal rather than an invented policy, so this
 * module defines no scope and no deny-list beyond "the path must be an existing
 * directory": the record discusses what, if anything, should be excluded.
 */
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** One directory entry: a name and two flags, never a size, hash or body. */
export interface PickerEntry {
  readonly name: string;
  /** True for a directory (a symlink to a directory resolves to `true`). */
  readonly isDirectory: boolean;
  /** True when the name starts with `.`; hidden entries are listed, not filtered. */
  readonly hidden: boolean;
}

/** The payload of one listing; deliberately not recursive. */
export interface PickerListing {
  /** The canonical absolute directory that was listed. */
  readonly path: string;
  /** The parent directory, or `null` at the filesystem root. */
  readonly parent: string | null;
  /** The directory's own entries, sorted by name, capped at {@link PICKER_MAX_ENTRIES}. */
  readonly entries: readonly PickerEntry[];
  /** True when the directory has more entries than the payload carries. */
  readonly truncated: boolean;
}

/** The maximum entries one answer carries; a listing is a page, not a mirror. */
export const PICKER_MAX_ENTRIES = 2000;

/** One audited read. `outcome` distinguishes a served listing from a refusal. */
export interface PickerAuditRecord {
  readonly at: string;
  /** The BFF browser-session id (`protocol.md` §2's audit subject). */
  readonly sessionId: string;
  /** The request's raw `path` parameter, before normalisation. */
  readonly requested: string | null;
  /** The canonical path when one was resolved, otherwise `null`. */
  readonly path: string | null;
  readonly outcome: 'listed' | 'refused';
  readonly code: string | null;
  readonly entryCount: number;
}

/** A typed refusal the BFF renders as the documented error envelope. */
export class PickerRefused extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    options: { readonly status?: number; readonly details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'PickerRefused';
    this.code = code;
    this.status = options.status ?? 422;
    this.details = options.details ?? {};
  }
}

/** What one picker read needs to know about its caller, for the audit trail. */
export interface PickerContext {
  readonly sessionId: string;
}

export interface FolderPickerPort {
  /**
   * Lists one directory's entries.
   *
   * @param requested An absolute path (a leading `~` is expanded), or `undefined`
   *   for the home directory the picker starts at.
   * @throws PickerRefused when the path is missing, relative, or not a directory.
   */
  list(requested: string | undefined, context: PickerContext): PickerListing;
}

export interface NodeFolderPickerOptions {
  /** The directory `undefined` resolves to; defaults to the process home. */
  readonly home?: string;
  /**
   * Records one read before the answer is returned.
   *
   * A sink that throws makes the read fail: an unaudited listing of an arbitrary
   * directory is exactly what the owner's ruling forbids.
   */
  readonly audit?: (record: PickerAuditRecord) => void;
  readonly now?: () => Date;
}

/**
 * The real filesystem picker.
 *
 * It is deliberately synchronous and non-recursive: one `readdir` of one directory,
 * with a `stat` per entry only to answer the directory flag (which follows symlinks so
 * a symlinked folder is navigable). No path scope is imposed, by owner decision.
 */
export class NodeFolderPicker implements FolderPickerPort {
  private readonly home: string;
  private readonly audit: (record: PickerAuditRecord) => void;
  private readonly now: () => Date;

  constructor(options: NodeFolderPickerOptions = {}) {
    this.home = options.home ?? homedir();
    this.audit = options.audit ?? ((): void => undefined);
    this.now = options.now ?? ((): Date => new Date());
  }

  list(requested: string | undefined, context: PickerContext): PickerListing {
    const raw = requested === undefined || requested.trim() === '' ? undefined : requested;
    let directory: string;
    try {
      directory = canonicalDirectory(raw, this.home);
    } catch (error) {
      const refused = error instanceof PickerRefused ? error : undefined;
      // A refusal is audited too: "who tried to list what" is part of the trail.
      this.record({
        requested: raw ?? null,
        path: null,
        outcome: 'refused',
        code: refused?.code ?? 'INTERNAL_ERROR',
        entryCount: 0,
        context,
      });
      throw error;
    }
    const entries: PickerEntry[] = [];
    let names: string[];
    try {
      // `withFileTypes` avoids a second syscall per entry for the common case; the
      // explicit `stat` below still resolves a symlinked directory.
      names = readdirSync(directory);
    } catch (error) {
      this.record({
        requested: raw ?? null,
        path: directory,
        outcome: 'refused',
        code: 'NOT_FOUND',
        entryCount: 0,
        context,
      });
      throw new PickerRefused(
        'NOT_FOUND',
        `${directory} could not be listed${error instanceof Error ? `: ${error.message}` : ''}`,
        {
          status: 404,
          details: { path: directory, reason: 'unreadable' },
        },
      );
    }
    names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const truncated = names.length > PICKER_MAX_ENTRIES;
    for (const name of names.slice(0, PICKER_MAX_ENTRIES)) {
      entries.push({
        name,
        isDirectory: isDirectoryEntry(join(directory, name)),
        hidden: name.startsWith('.'),
      });
    }
    // Audit first, answer after: an unaudited listing is never served.
    this.record({
      requested: raw ?? null,
      path: directory,
      outcome: 'listed',
      code: null,
      entryCount: entries.length,
      context,
    });
    return { path: directory, parent: parentOf(directory), entries, truncated };
  }

  private record(input: {
    readonly requested: string | null;
    readonly path: string | null;
    readonly outcome: 'listed' | 'refused';
    readonly code: string | null;
    readonly entryCount: number;
    readonly context: PickerContext;
  }): void {
    this.audit({
      at: this.now().toISOString(),
      sessionId: input.context.sessionId,
      requested: input.requested,
      path: input.path,
      outcome: input.outcome,
      code: input.code,
      entryCount: input.entryCount,
    });
  }
}

/**
 * Normalises one requested path to a canonical existing directory.
 *
 * `~` and `~/x` expand to the home directory; everything else must already be
 * absolute, so a bare relative name is a `VALIDATION_ERROR` rather than a guess about
 * a working directory the BFF does not have.
 */
export function canonicalDirectory(requested: string | undefined, home: string): string {
  const raw = requested === undefined || requested.trim() === '' ? home : requested.trim();
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw;
  if (!isAbsolute(expanded)) {
    throw new PickerRefused('VALIDATION_ERROR', 'path must be absolute (or start with ~)', {
      details: { path: requested ?? null, reason: 'not-absolute' },
    });
  }
  const normalised = resolve(expanded);
  let canonical: string;
  try {
    canonical = realpathSync(normalised);
  } catch {
    throw new PickerRefused('NOT_FOUND', `${normalised} does not exist`, {
      status: 404,
      details: { path: normalised, reason: 'missing' },
    });
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(canonical).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    // The owner's rule: "directories only". A file path is refused, and the answer
    // must not describe the file beyond saying it is not a directory.
    throw new PickerRefused('VALIDATION_ERROR', `${canonical} is not a directory`, {
      details: { path: canonical, reason: 'not-a-directory' },
    });
  }
  return canonical;
}

/** True when one entry is a directory, following a symlink once. */
function isDirectoryEntry(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The parent of a canonical directory, or `null` at the root. */
export function parentOf(path: string): string | null {
  if (path === '/' || /^[A-Za-z]:[\\/]$/u.test(path)) return null;
  const trimmed = path.replace(/[\\/]+$/u, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (index <= 0) return trimmed === '' ? null : path.slice(0, 1);
  return trimmed.slice(0, index);
}
