/**
 * Chief shell audit (A): after a shell call, report whether the project's tracked state moved.
 *
 * The chief needs a shell for observation and operations (ssh, curl, docker, ports, logs, ignored
 * local env files). P0-4 removed the shell because a chief could also write tracked files and finish
 * without a Task. This audit restores the visibility half of that boundary without pretending to be
 * the boundary itself:
 *
 *  - it runs only for the chief, only after a shell call has already executed;
 *  - it compares `HEAD`, porcelain status, dirty tracked content and untracked file stamps - not the
 *    whole project;
 *  - a change is appended to the tool result and marked `isError`, naming the paths;
 *  - it never restores or blocks anything. Concurrent developer/tester writes, `nohup` background
 *    work, remote `ssh` commands and a project without git are outside what it can attribute.
 *
 * The structural boundary remains the tool set: the chief has no `write`/`edit`, a read Task or a
 * paused hold keeps no `bash`, and the settlement commit belongs to the settler. An OS sandbox is the
 * only way to make "the shell cannot change the project" true, and is deliberately future work.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ExtensionAPI, ExtensionFactory, ToolCallEvent, ToolResultEvent } from '@earendil-works/pi-coding-agent';

const execFileAsync = promisify(execFile);

const SHELL_TOOLS = new Set(['bash', 'powershell']);
const TIMEOUT_MS = 5_000;
const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_PATHS = 200;
const MAX_UNTRACKED_STATS = 500;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface GitRun {
  readonly ok: boolean;
  readonly stdout: string;
}

async function git(cwd: string, args: readonly string[]): Promise<GitRun> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/** One observation of the project's git-visible state. */
export interface WorktreeFingerprint {
  /** True when `rev-parse --verify HEAD` answered; false when there is no HEAD or the read failed. */
  readonly headAvailable: boolean;
  readonly head: string | null;
  /** Digest of the full porcelain status; content changes of already-dirty files use `diffHash`. */
  readonly statusHash: string;
  /** Project-relative paths from the porcelain status, bounded for the message. */
  readonly statusPaths: readonly string[];
  /** Digest of `git diff HEAD`; `null` when there is no HEAD or the bounded read failed. */
  readonly diffHash: string | null;
  /** Digest of untracked paths and their size/mtime stamps (content hashes would be too costly). */
  readonly untrackedHash: string;
  /** False when git is a repository but its status could not be read (timeout/size cap). */
  readonly statusAvailable: boolean;
  /** True when a size/time cap made the observation incomplete. */
  readonly limited: boolean;
}

interface StatusRecord {
  readonly code: string;
  readonly path: string;
}

/** Parse `git status --porcelain=v1 -z` records; `--no-renames` keeps one path per record. */
function parseStatus(output: string): StatusRecord[] {
  const records: StatusRecord[] = [];
  for (const entry of output.split('\0')) {
    if (entry.length < 4) continue;
    // XY SP PATH: the first two characters are the status, the third is a space.
    records.push({ code: entry.slice(0, 2), path: entry.slice(3) });
  }
  return records;
}

function stripPrefix(path: string, prefix: string): string {
  return prefix !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Observe the project now. `null` means git cannot describe it (not a repository, unreadable
 * gitdir, missing git): the audit is skipped rather than turning a diagnostic shell into an error.
 */
export async function readWorktreeFingerprint(cwd: string): Promise<WorktreeFingerprint | null> {
  const prefixRun = await git(cwd, ['rev-parse', '--show-prefix']);
  if (!prefixRun.ok) return null;
  const prefix = prefixRun.stdout.trim();

  const headRun = await git(cwd, ['rev-parse', '--verify', 'HEAD']);
  const head = headRun.ok ? headRun.stdout.trim() : null;

  const statusRun = await git(cwd, [
    '-c',
    'core.fsmonitor=false',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
    '--',
    '.',
  ]);
  if (!statusRun.ok) {
    // A repository whose status could not be read is not "no project": report the blind spot
    // instead of letting the audit disappear for every call.
    return {
      head,
      headAvailable: headRun.ok,
      statusAvailable: false,
      statusHash: sha256(''),
      statusPaths: [],
      diffHash: null,
      untrackedHash: sha256(''),
      limited: true,
    };
  }
  const records = parseStatus(statusRun.stdout);
  const statusPaths = records
    .map((record) => stripPrefix(record.path, prefix))
    .slice(0, MAX_PATHS);

  let limited = false;
  let diffHash: string | null = null;
  if (head !== null && records.some((record) => record.code !== '??')) {
    const diffRun = await git(cwd, [
      '-c',
      'core.fsmonitor=false',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--binary',
      'HEAD',
      '--',
      '.',
    ]);
    if (diffRun.ok) {
      diffHash = sha256(diffRun.stdout);
    } else {
      limited = true;
    }
  }

  const untracked = records
    .filter((record) => record.code === '??')
    .map((record) => stripPrefix(record.path, prefix));
  const stamps: string[] = [];
  for (const path of untracked.slice(0, MAX_UNTRACKED_STATS)) {
    try {
      const stat = lstatSync(join(cwd, path));
      stamps.push(`${path}\0${String(stat.size)}\0${String(stat.mtimeMs)}`);
    } catch {
      stamps.push(`${path}\0missing`);
    }
  }
  if (untracked.length > MAX_UNTRACKED_STATS) limited = true;

  return {
    head,
    headAvailable: headRun.ok,
    statusAvailable: true,
    statusHash: sha256(statusRun.stdout),
    statusPaths,
    diffHash,
    untrackedHash: sha256(stamps.sort().join('\n')),
    limited,
  };
}

export interface ShellAuditFinding {
  readonly changed: boolean;
  readonly headChanged: boolean;
  readonly statusChanged: boolean;
  readonly diffChanged: boolean;
  readonly untrackedChanged: boolean;
  /** One side could not read git status; the status comparison for this call is missing. */
  readonly statusUnavailable: boolean;
  /** Project-relative paths to show: changed status paths plus untracked paths, bounded. */
  readonly paths: readonly string[];
  readonly limited: boolean;
  readonly headBefore: string | null;
  readonly headAfter: string | null;
}

/** Compare two observations; any difference is an audit finding, not a rollback. */
export function compareWorktreeFingerprints(
  before: WorktreeFingerprint,
  after: WorktreeFingerprint,
): ShellAuditFinding {
  const statusComparable = before.statusAvailable && after.statusAvailable;
  const headComparable = before.headAvailable && after.headAvailable;
  const headChanged = headComparable && before.head !== after.head;
  const statusUnavailable = !before.statusAvailable || !after.statusAvailable;
  const statusChanged = statusComparable && before.statusHash !== after.statusHash;
  const diffChanged = statusComparable && before.diffHash !== after.diffHash;
  const untrackedChanged = statusComparable && before.untrackedHash !== after.untrackedHash;
  const paths = [...new Set([...after.statusPaths, ...before.statusPaths])].slice(0, 20);
  return {
    changed: headChanged || statusChanged || diffChanged || untrackedChanged,
    headChanged,
    statusChanged,
    diffChanged,
    untrackedChanged,
    statusUnavailable,
    paths,
    limited: before.limited || after.limited,
    headBefore: before.head,
    headAfter: after.head,
  };
}

function auditText(finding: ShellAuditFinding): string {
  const lines = ['[chief shell audit] The project state changed while this command ran.'];
  if (finding.headChanged) {
    lines.push(`HEAD: ${finding.headBefore ?? '(none)'} -> ${finding.headAfter ?? '(none)'}`);
  }
  if (finding.paths.length > 0) {
    lines.push(`Changed or now dirty paths: ${finding.paths.join(', ')}`);
  }
  if (finding.statusUnavailable) {
    lines.push(
      'The project status could not be read on one side of this command; this call\'s status comparison is missing.',
    );
  } else if (finding.limited) {
    lines.push('The audit hit a size or time cap; HEAD and status were still compared.');
  }
  lines.push(
    'Check whether your command caused the change (a member or background job may also have written it) before reverting. The command already ran; this is an audit, not a rollback or a sandbox. Tracked project changes and the settlement commit belong to a Task/member: if the change is yours, revert it or create/continue the Task.',
  );
  return lines.join('\n');
}

function statusUnavailableText(): string {
  return [
    '[chief shell audit] The project status could not be read on one side of this command; this call\'s status comparison is missing.',
    'The command already ran; this is an audit, not a rollback. Check the project with `git status` or `inspect` before deciding what changed.',
  ].join('\n');
}

export interface ShellAuditOptions {
  /** The project root whose git state is observed; the shell may itself cd elsewhere. */
  readonly cwd: string;
}

/**
 * Install the chief's shell audit. The before-fingerprint is taken in `tool_call` (after the
 * deletion gate has answered) and paired by `toolCallId`; the after-fingerprint runs before the
 * tool result reaches the model, so the warning travels with the command output.
 */
export function createShellAudit(options: ShellAuditOptions): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    const pending = new Map<string, WorktreeFingerprint | null>();

    pi.on('tool_call', async (event: ToolCallEvent) => {
      if (!SHELL_TOOLS.has(event.toolName)) return undefined;
      // A blocked call may never produce a result; bound the map instead of growing it forever.
      if (pending.size > 64) pending.clear();
      pending.set(event.toolCallId, await readWorktreeFingerprint(options.cwd));
      return undefined;
    });

    pi.on('tool_result', async (event: ToolResultEvent) => {
      if (!SHELL_TOOLS.has(event.toolName)) return undefined;
      const before = pending.get(event.toolCallId);
      if (before === undefined) return undefined;
      pending.delete(event.toolCallId);
      if (before === null) return undefined;
      const after = await readWorktreeFingerprint(options.cwd);
      if (after === null) return undefined;
      const finding = compareWorktreeFingerprints(before, after);
      if (!finding.changed && !finding.statusUnavailable) return undefined;
      return {
        content: [
          ...event.content,
          { type: 'text', text: finding.changed ? auditText(finding) : statusUnavailableText() },
        ],
        ...(finding.changed ? { isError: true } : {}),
        ...(event.structuredContent !== undefined
          ? { structuredContent: event.structuredContent }
          : {}),
      };
    });
  };
}
