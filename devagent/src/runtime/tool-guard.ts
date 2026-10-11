/**
 * Keep the model's file tools out of the server's private storage (R5/P-05).
 *
 * The provider key lives in `<agentDir>/models.json` because that is the file Pi reads, and that file
 * sits beside the database and the session history. A role holding Pi's built-in tools could read any
 * of it with a plain `read` call - and whatever a tool returns becomes part of the conversation, which
 * is exactly where a credential must never be. This guard refuses such calls before they execute.
 *
 * What it does not do: it is not a sandbox. `bash` is checked by the text of the command, so a shell
 * can still reach the same file by other means. Confining the shell itself needs an operating-system
 * sandbox, which is a separate piece of work; the honest statement of the boundary is in the README.
 */
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
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

function normalize(candidate: string, cwd: string): string {
  const absolute = isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
  try {
    // A real path resolves symlinks, so a link inside the project cannot point the tool outside it.
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
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
  const privateDirs = input.privateDirs.filter((dir) => dir !== '').map((dir) => normalize(dir, input.cwd));
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
