/**
 * Keep the model's file tools out of the server's private storage (R5/P-05).
 *
 * The provider key lives in `<agentDir>/models.json` because that is the file Pi reads, and that file
 * sits beside the database and the session history. A role holding Pi's built-in tools could read any
 * of it with a plain `read` call - and whatever a tool returns becomes part of the conversation, which
 * is exactly where a credential must never be. This guard refuses such calls before they execute.
 *
 * The shapes it understands are the POSIX ones Pi normalizes (`@`, `~/`, `file://`): this workbench
 * runs on POSIX, and mirroring Pi's Windows-only branches would be code nothing here exercises.
 *
 * What it does not do: it is not a sandbox. `bash` is checked by the text of the command, so a shell
 * can still reach the same file by other means. Confining the shell itself needs an operating-system
 * sandbox, which is a separate piece of work; the honest statement of the boundary is in the README.
 */
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent';

export interface GuardInput {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  /** The session's working directory, which relative arguments resolve against. */
  readonly cwd: string;
  readonly privateDirs: readonly string[];
}

/** The path argument each built-in file tool uses, when it has one. */
const PATH_ARGUMENT: Record<string, string> = {
  read: 'path',
  edit: 'path',
  write: 'path',
  ls: 'path',
  find: 'path',
  grep: 'path',
};

/** The shell tools whose command text is checked for a literal reference. */
const COMMAND_TOOLS = new Set(['bash', 'powershell']);

/**
 * The same shapes Pi's own file tools accept before they resolve a path, **in the same order**:
 * unicode spaces, one leading `@`, `~/`, `file://`. The order matters - Pi strips `@` before it
 * converts a URL, so `@file://<path>` reaches the credential file and a guard that did the two the
 * other way round would let it through (the third check proved exactly that).
 */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function normalizeInput(raw: string, cwd: string): string {
  let candidate = raw.trim().replace(UNICODE_SPACES, ' ');
  if (candidate.startsWith('@')) {
    candidate = candidate.slice(1);
  }
  if (candidate === '~' || candidate.startsWith('~/')) {
    candidate = join(homedir(), candidate.slice(1));
  }
  if (/^file:\/\//.test(candidate)) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      // Not a usable file URL: fall through and treat it as a literal path.
    }
  }
  return isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
}

/**
 * Resolve the deepest part of the path that exists and re-append the rest: a path that does not exist
 * yet (a file about to be written, a directory about to be created) still gets compared through any
 * symlinked parent instead of falling back to a plain string comparison.
 */
function resolveThroughAncestors(candidate: string): string {
  let current = candidate;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return rest.length === 0 ? real : join(real, ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return candidate;
      }
      rest.push(basename(current));
      current = parent;
    }
  }
}

function normalize(candidate: string, cwd: string): string {
  return resolveThroughAncestors(normalizeInput(candidate, cwd));
}

function inside(target: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(normalizedRoot);
}

/**
 * Why this call must be refused, or `undefined` when it may proceed. Exported so the rule can be
 * tested without a running session.
 */
export function privatePathBlockReason(input: GuardInput): string | undefined {
  // The private dirs belong to the server, not to the session: resolved against the server's own
  // working directory, never against the project (which would make a relative value meaningless).
  const privateDirs = input.privateDirs
    .filter((dir) => dir !== '')
    .map((dir) => normalize(dir, process.cwd()));
  if (privateDirs.length === 0) {
    return undefined;
  }
  const hit = (path: string): string | undefined => {
    const target = normalize(path, input.cwd);
    return privateDirs.some((dir) => inside(target, dir))
      ? `${path} is inside the workbench's private storage (${privateDirs.join(', ')}); it holds credentials, the database and session history and is not part of the project`
      : undefined;
  };
  const pathArgument = PATH_ARGUMENT[input.toolName];
  if (pathArgument !== undefined) {
    const value = input.args[pathArgument];
    if (typeof value === 'string' && value !== '') {
      return hit(value);
    }
    return undefined;
  }
  if (COMMAND_TOOLS.has(input.toolName)) {
    const command = input.args['command'] ?? input.args['script'];
    if (typeof command !== 'string' || command === '') {
      return undefined;
    }
    // Compared as raw text: enough to stop a command that names the storage, not a sandbox.
    const named = input.privateDirs.find((dir) => dir !== '' && command.includes(dir));
    if (named !== undefined) {
      return `the command names the workbench's private storage (${named}); it holds credentials and is not part of the project`;
    }
  }
  return undefined;
}

/** The extension that installs the guard for one session (its cwd plus the server's private dirs). */
export function createPrivatePathGuard(options: {
  readonly cwd: string;
  readonly privateDirs: readonly string[];
}): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('tool_call', (event: ToolCallEvent) => {
      const reason = privatePathBlockReason({
        toolName: event.toolName,
        args: event.input as Record<string, unknown>,
        cwd: options.cwd,
        privateDirs: options.privateDirs,
      });
      return reason === undefined ? undefined : { block: true, reason };
    });
  };
}
