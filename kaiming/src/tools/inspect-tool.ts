/**
 * Read-only git inspection for the chief (P0-4).
 *
 * The chief must be able to check the real repository state itself (`git status/log/diff/show`),
 * but it must not have a shell: a shell is a general write tool, and an orchestrator that can write
 * files can finish a "just do it" request by bypassing the Task pipeline entirely. This tool exists
 * for that difference: a fixed subcommand table executed with `execFile` — no shell, no model
 * supplied flags, no path for a write.
 *
 * Read-only is enforced structurally, not by scanning command text:
 *  - the argument vector is built here from a small enum (`status`, `log`, `diff`, `show`,
 *    `rev-parse`); the model only supplies a bounded limit, a validated revision and a
 *    project-relative path;
 *  - external diff/textconv helpers are disabled (`--no-ext-diff --no-textconv`), optional index
 *    locks are off (`GIT_OPTIONAL_LOCKS=0`), the fsmonitor hook is off, and the pager/network
 *    prompts are disabled: `git status` must not rewrite the index or run repository hooks.
 *
 * Running tests, implementation and the settlement commit stay with the delegated roles; a command
 * an inspector cannot express is a reason to dispatch a member, not to widen this tool.
 */
import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { asRecord, fail, ok, readNumber, readString } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';

const OPS = ['status', 'log', 'diff', 'show', 'rev-parse'] as const;
type InspectOp = (typeof OPS)[number];

const OUTPUT_LIMIT = 20_000;
const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 1024 * 1024;

/** Global flags every call carries: no pager, no fsmonitor hook, optional locks off (env below). */
const GIT_PREFIX = ['--no-pager', '-c', 'core.fsmonitor=false'] as const;

export type GitArgsResult =
  | { readonly ok: true; readonly args: readonly string[] }
  | { readonly ok: false; readonly message: string };

function isInspectOp(value: string): value is InspectOp {
  return (OPS as readonly string[]).includes(value);
}

/** A revision git may receive as a positional: no leading dash, no control characters, bounded. */
function validRev(value: string): boolean {
  return value.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._/@^~-]*$/.test(value);
}

/** A project-relative path passed after `--`: never absolute, never escaping, no control bytes. */
function validPath(value: string): boolean {
  return (
    value.trim() !== '' &&
    value.length <= 400 &&
    !isAbsolute(value) &&
    !value.startsWith('-') &&
    !value.includes('\\') &&
    !/[\0\r\n]/.test(value) &&
    !value.split('/').includes('..')
  );
}

/**
 * The exact argv one `inspect` call runs. Exported so the read-only property is tested directly:
 * every path through this function ends in a read subcommand and a fixed flag set.
 */
export function gitInspectArgs(rawParams: unknown): GitArgsResult {
  const params = asRecord(rawParams);
  if (params === undefined) return { ok: false, message: 'params must be an object' };
  const unknownKeys = Object.keys(params).filter(
    (key) => !['op', 'limit', 'rev', 'path'].includes(key),
  );
  if (unknownKeys.length > 0) {
    return { ok: false, message: `unknown argument(s): ${unknownKeys.join(', ')}` };
  }
  const op = readString(params, 'op');
  if (op === undefined || !isInspectOp(op)) {
    return { ok: false, message: `op must be one of ${OPS.join(', ')}` };
  }
  const limit = readNumber(params, 'limit');
  const rev = readString(params, 'rev');
  const path = readString(params, 'path');

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    return { ok: false, message: 'limit must be an integer between 1 and 50' };
  }
  if (limit !== undefined && op !== 'log') {
    return { ok: false, message: 'limit only applies to log' };
  }
  if (rev !== undefined && op !== 'show') {
    return { ok: false, message: 'rev only applies to show' };
  }
  if (rev !== undefined && !validRev(rev)) {
    return { ok: false, message: 'rev must be a revision name, not a flag or a path' };
  }
  if (path !== undefined && (op === 'rev-parse' || !validPath(path))) {
    return { ok: false, message: 'path must be a project-relative path without .. or a leading dash' };
  }

  switch (op) {
    case 'status':
      return { ok: true, args: [...GIT_PREFIX, 'status', '--porcelain=v1', '-b', ...(path ? ['--', path] : [])] };
    case 'log':
      return {
        ok: true,
        args: [
          ...GIT_PREFIX,
          'log',
          '--oneline',
          '--no-decorate',
          '-n',
          String(limit ?? 10),
          ...(path ? ['--', path] : []),
        ],
      };
    case 'diff':
      return {
        ok: true,
        args: [
          ...GIT_PREFIX,
          'diff',
          '--stat',
          '--no-ext-diff',
          '--no-textconv',
          'HEAD',
          ...(path ? ['--', path] : []),
        ],
      };
    case 'show':
      return {
        ok: true,
        args: [
          ...GIT_PREFIX,
          'show',
          '--stat',
          '--oneline',
          '--no-ext-diff',
          '--no-textconv',
          rev ?? 'HEAD',
          ...(path ? ['--', path] : []),
        ],
      };
    case 'rev-parse':
      return { ok: true, args: [...GIT_PREFIX, 'rev-parse', '--show-toplevel'] };
    default: {
      // Exhaustiveness: adding an op without a case must fail the typecheck, not run rev-parse.
      const unexpected: never = op;
      return { ok: false, message: `unsupported op ${String(unexpected)}` };
    }
  }
}

function truncate(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT)}\n… output truncated (${String(text.length - OUTPUT_LIMIT)} more characters)`;
}

export interface InspectToolContext {
  readonly cwd: string;
}

export function createInspectTool(contextOf: () => InspectToolContext): DomainTool {
  return {
    name: 'inspect',
    label: 'inspect',
    description: [
      'Read-only git inspection for the supervisor: `status`, `log`, `diff`, `show`, `rev-parse`. Runs a fixed argv with no shell and cannot write files, run tests or commit.',
      'Use it to verify the real state (what changed, what is committed, recent history) instead of trusting a summary. Implementation, test runs and the settlement commit belong to the delegated members.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: [...OPS] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        rev: { type: 'string', maxLength: 120 },
        path: { type: 'string', maxLength: 400 },
      },
      required: ['op'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const built = gitInspectArgs(rawParams);
      if (!built.ok) return fail('INVALID_ARGUMENT', built.message);
      const { cwd } = contextOf();
      try {
        const stdout = execFileSync('git', [...built.args], {
          cwd,
          encoding: 'utf8',
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: '0',
            GIT_PAGER: 'cat',
            GIT_TERMINAL_PROMPT: '0',
          },
        });
        // The git output is the whole answer; this tool has no ids or versions for the UI payload.
        return ok(truncate(stdout.trim() === '' ? '(no output)' : stdout.trimEnd()), {});
      } catch (error) {
        const stderr = (error as { stderr?: unknown }).stderr;
        const message =
          typeof stderr === 'string' && stderr.trim() !== ''
            ? stderr.trim()
            : error instanceof Error
              ? error.message
              : 'git failed';
        return fail('INSPECT_FAILED', truncate(message));
      }
    },
  };
}
