/**
 * The project-directory port the single-entry BFF routes through (WP-12 T5).
 *
 * `docs/architecture/ARCHITECTURE.md` §2 and `protocol.md` §2 keep exactly one BFF
 * in front of the installation, and the T5 supervisor ruling fixes the switching
 * model as **one BFF, one origin, route per request by `projectId`**. The BFF
 * therefore never owns a project: it asks the host's directory which daemon serves
 * the project a request names, and injects that `projectId` when the browser
 * omitted it (so a mis-routed request fails closed at the daemon's own
 * `projectId !== this.projectId` check rather than answering from the wrong
 * project).
 *
 * The directory is a host fact (registry + locks + open instances), so only its
 * *shape* lives here; `apps/daemon/src/project-directory.ts` implements it and
 * `main.ts` injects it. Keeping the port in the web package keeps one definition of
 * what the BFF needs without adding a dependency edge from `@agentdev/web` back to
 * the daemon.
 */

/** The lifecycle state of one navigable project, as the switcher reports it. */
export type ProjectEntryState =
  /** Assembled, serving, and in the active set. */
  | 'open'
  /** Registered but not currently serving (`project.close`, or not opened yet). */
  | 'closed'
  /** A registry entry whose root no longer exists on disk. */
  | 'missing'
  /** A registry entry that could not be read at all (WP-12 T5, Q2). */
  | 'unreadable';

/** One project the installation can navigate to. */
export interface ProjectEntry {
  /** `null` only for a registry entry too damaged to carry an id. */
  readonly projectId: string | null;
  /** Explicit `project.create` name, or the root's basename. */
  readonly name: string;
  readonly root: string;
  readonly trust: 'trusted' | 'untrusted';
  readonly state: ProjectEntryState;
  /** Durable `updated_at` for an open project, the registry's `lastOpenedAt` otherwise. */
  readonly updatedAt: string;
  /** Live `running` Runs; only knowable while the project is assembled. */
  readonly runningRuns: number;
  /** The role configuration resolves for the chief role. */
  readonly executionReady: boolean;
  readonly gitRoot: string | null;
  readonly head: string | null;
  /** The typed reason a `missing`/`unreadable` entry cannot be navigated to. */
  readonly problem: { readonly code: string; readonly message: string } | null;
  /** The project's current initialization state, when one has been driven (T5.3). */
  readonly initialization: ProjectInitializationFact | null;
  /** The first-open requirement-import summary (AC-087–AC-089). */
  readonly import: ProjectImportFact | null;
}

/** The initialization state a project currently reports (`project.snapshot.get`). */
export interface ProjectInitializationFact {
  readonly operationId: string;
  readonly phase: string;
  readonly status: string;
  readonly done: boolean;
  readonly blockerKind: string | null;
  readonly blockerMessage: string | null;
  /** Repo-relative paths of a dirty-workspace hash report (AC-028). */
  readonly dirtyPaths: readonly { readonly path: string; readonly sha256: string | null }[];
  /** Candidate documents written in this record. */
  readonly written: number;
  /** Candidate documents whose bytes already matched (hash-based resume, AC-029). */
  readonly unchanged: number;
}

/** The summary of the first-open requirement import (AC-087–AC-089). */
export interface ProjectImportFact {
  readonly revision: string | null;
  readonly source: string;
  readonly imported: number;
  readonly conflicts: number;
  readonly writeBlocked: boolean;
}

/** Where the BFF forwards one project's `/rpc` and `/ws` traffic. */
export interface ProjectTarget {
  /** e.g. `http://127.0.0.1:4318`. */
  readonly baseUrl: string;
  /** The exact `Origin` the daemon allowlists (`protocol.md` §2). */
  readonly origin: string;
  /** The 0600 installation credential. */
  readonly bearer: string;
}

/** The documented `accepted` result of a project lifecycle command. */
export interface ProjectCommandResult {
  readonly status: 'accepted';
  readonly operationId: string;
  readonly projectId: string | null;
  readonly root: string;
  /** The typed code when the command was refused synchronously. */
  readonly error: { readonly code: string; readonly message: string } | null;
}

/** The documented `applied` result of a synchronous project lifecycle command. */
export interface ProjectAppliedResult {
  readonly status: 'applied';
  readonly entityId: string;
  readonly version: number;
  readonly projectId: string;
  readonly entry: ProjectEntry;
}

export interface ProjectDirectoryPort {
  /** Every project the installation knows, opened and discoverable alike. */
  list(): readonly ProjectEntry[];
  /** One entry by project id, or `undefined` when unknown. */
  entryOf(projectId: string): ProjectEntry | undefined;
  /** One entry by canonical root (a subdirectory resolves to the same project). */
  findByRoot(root: string): ProjectEntry | undefined;
  /** The daemon target serving an open project; `undefined` when it is not open. */
  targetOf(projectId: string): ProjectTarget | undefined;
  /** The project a page serves when the URL names none (the first open project). */
  defaultProjectId(): string | undefined;
  /**
   * The project id a root resolves to, without opening anything (AC-024).
   *
   * @throws when the path does not exist, so a caller never answers `accepted` for a
   * root that cannot be served.
   */
  projectIdFor(root: string): string;
  /** Opens one root idempotently; resolves once its runtime is assembled. */
  open(
    root: string,
    options?: { readonly trust?: boolean; readonly name?: string },
  ): Promise<ProjectEntry>;
  /** Creates a project in an empty directory and opens it (`protocol.md` §3). */
  create(root: string, name: string): Promise<ProjectEntry>;
  /** Clones a remote into a root and opens it (`protocol.md` §3). */
  clone(remoteUrl: string, root: string, grantId: string): Promise<ProjectEntry>;
  /** Flips the stored trust flag; `trusted:false` stops new admission. */
  trust(projectId: string, trusted: boolean): ProjectEntry;
  /**
   * Navigation-level close: refuses while a live Run exists (`Q3`).
   *
   * The returned entry is the project's state *after* the close (`closed`), so the
   * protocol layer can answer the documented `applied` shape without a second read.
   */
  close(projectId: string): ProjectEntry;
  /** Drives the initialization state machine for one open project. */
  initialize(
    projectId: string,
    input: {
      readonly sourceMessageId: string;
      readonly budget?: { readonly files?: number; readonly bytes?: number };
    },
  ): Promise<ProjectEntry>;
  /**
   * The per-entry registry problems this installation reported at load (WP-12 T5,
   * Q2). A damaged entry is skipped there and surfaced here, never fatal.
   */
  readonly problems: readonly ProjectRegistryProblem[];
}

/** One registry entry the host skipped, mirroring `packages/core`'s report. */
export interface ProjectRegistryProblem {
  readonly index: number;
  readonly root: string | null;
  readonly code: 'PROJECT_ENTRY_INVALID' | 'PROJECT_ENTRY_DUPLICATE';
  readonly message: string;
}

/** The basename of a root, used when a project carries no explicit name. */
export function projectNameOf(root: string, name?: string): string {
  if (name !== undefined && name.trim() !== '') return name;
  const parts = root.split('/').filter((part) => part !== '');
  return parts.at(-1) ?? root;
}
