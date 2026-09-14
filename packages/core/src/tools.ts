/**
 * The Core-side tool catalog: name → Broker call, argument validation and the two
 * tools Core implements itself.
 *
 * `docs/architecture/execution.md` §7 fixes the tool set ("read/search/
 * context_request/artifact_write；修改角色另有edit/write/bash/git") and §2 says Core
 * handles file and domain tools directly, while a Shell request is executed by the
 * daemon. This module is what the daemon's `tool-handler.ts` uses to turn one
 * `tool.execute` request into the {@link ToolInvocation} the Broker admits:
 *
 * - the tool name is looked up in the **shared** contract catalog
 *   (`@agentdev/contracts` `BROKER_TOOLS`), never parsed from free text;
 * - the arguments are validated with the shared zod schemas, so the Runner's
 *   model-facing typebox schema and the server accept the same fields;
 * - `~`, a drive letter and an empty path are refused at the entry (`repoPathSchema`
 *   already refuses absolute paths and `..`; this is the extra entry check the security
 *   review asked for, mirroring `control-http.ts` `assertScopePaths`);
 * - `git` is an **allowlist** of read-only subcommands: `execution.md` §7 keeps
 *   delivery-ref changes in the Workspace service's CAS;
 * - a `bash` command whose program is `git` is held to the same allowlist, which is
 *   the documented mitigation for a shell that would otherwise `git update-ref`.
 *   `bash` can still write files under `.git` directly; that residual is registered in
 *   `.agentdev/work/WP-12/T3-implementation.md`, and the mitigation is the Workspace
 *   service's compare-and-swap: it updates `agentdev/main` with an expected old value,
 *   so a tampered working ref cannot be integrated.
 *
 * Validation and execution are separate on purpose: {@link planToolCall} decides what
 * would run, and the daemon attaches the executor. That keeps the security-relevant
 * decision testable without a database, and keeps `ArtifactService` (a domain service)
 * out of this pure module.
 */
import { readdirSync, lstatSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  BROKER_TOOLS,
  brokerOperationOf,
  isReadOnlyGitInvocation,
  roleHasBrokerTool,
  toolArgsSchemas,
  type BrokerToolName,
  type Role,
} from '@agentdev/contracts';
import type { BrokerErrorCode, ToolContext } from './broker.js';

/** The error codes planning can refuse with; the Broker's own subset. */
export type ToolPlanCode = Extract<
  BrokerErrorCode,
  'VALIDATION_ERROR' | 'NOT_AUTHORIZED' | 'PROVIDER_UNAVAILABLE'
>;

/**
 * What one tool call would be admitted as.
 *
 * `input` is the Broker's decoded input (what its hash is computed over), `targets`
 * are the repository-relative paths the Grant is evaluated against, and `cwd` is an
 * absolute directory the Broker re-checks against the same roots.
 */
export interface ToolCallPlan {
  readonly toolName: BrokerToolName;
  readonly operation: string;
  readonly access: 'read' | 'write';
  readonly targets: readonly string[];
  readonly input: Record<string, unknown>;
  readonly cwd?: string;
  /** The tool body, when Core implements the operation itself (read/search/edit/artifact). */
  readonly run?: (context: ToolContext) => unknown;
}

export type ToolPlanResult =
  | { readonly ok: true; readonly plan: ToolCallPlan }
  | { readonly ok: false; readonly code: ToolPlanCode; readonly reason: string };

function refuse(code: ToolPlanCode, reason: string): ToolPlanResult {
  return { ok: false, code, reason };
}

/**
 * Rejects a path the entry must never carry.
 *
 * `repoPathSchema` already refuses absolute paths, `..`, a drive letter and empty
 * segments; `~` is the one home-relative spelling that passes it, so it is refused
 * here — a tool call must not be able to name the operator's home directory.
 */
export function assertToolPath(field: string, path: string): ToolPlanResult | undefined {
  if (path.startsWith('~')) {
    return refuse('VALIDATION_ERROR', `${field} must be repository-relative, not home-relative`);
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return refuse('VALIDATION_ERROR', `${field} must be repository-relative`);
  }
  return undefined;
}

/**
 * Splits a shell command into its leading program and argument vector.
 *
 * Only the **first word** matters here: the git guard has to see the program a
 * command starts with, and a leading `FOO=bar` assignment is skipped because
 * `FOO=1 git update-ref …` starts git just as surely. Anything cleverer would be a
 * shell parser; the guard is documented as a refusal of the direct spelling, with the
 * CAS as the real mitigation.
 */
export function shellProgramOf(command: string): { program: string; args: string[] } {
  const tokens = [...command.matchAll(/(?:'([^']*)'|"([^"]*)"|(\S+))/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) {
    index += 1;
  }
  const program = tokens[index] ?? '';
  return { program, args: tokens.slice(index + 1) };
}

/** Whether a shell command invokes `git` with a ref-mutating (or unlisted) subcommand. */
export function isRefMutatingGitShellCommand(command: string): boolean {
  const { program, args } = shellProgramOf(command);
  const name = program.split('/').pop() ?? program;
  if (name !== 'git') return false;
  return !isReadOnlyGitInvocation(args);
}

/**
 * Validates one tool call and returns what the Broker should admit.
 *
 * `cwdRoot` is the absolute directory a repository-relative `cwd` resolves against;
 * the caller supplies the Run's workspace root (or the project root when a per-Task
 * worktree is not available yet, see the T3 plan's Q-T3-8 decision). The `role` gate is
 * checked **before** the arguments: a Review Run asking for `bash` is refused as
 * unauthorized rather than being told how to spell the arguments, and no Grant is
 * consulted (`execution.md` §7, `rules/agents.md` §1).
 */
export function planToolCall(input: {
  readonly toolName: string;
  readonly args: unknown;
  readonly cwdRoot: string;
  readonly role: Role;
}): ToolPlanResult {
  if (!Object.hasOwn(BROKER_TOOLS, input.toolName)) {
    return refuse(
      'VALIDATION_ERROR',
      `unknown tool ${input.toolName}; the Broker tool set is ${Object.keys(BROKER_TOOLS).join(', ')}`,
    );
  }
  const toolName = input.toolName as BrokerToolName;
  if (!roleHasBrokerTool(input.role, toolName)) {
    return refuse('NOT_AUTHORIZED', `${input.role} runs do not hold the ${toolName} tool`);
  }
  if (typeof input.args !== 'object' || input.args === null || Array.isArray(input.args)) {
    return refuse('VALIDATION_ERROR', `args for ${toolName} must be an object`);
  }
  const parsed = toolArgsSchemas[toolName].safeParse(input.args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? '' : issue.path.join('.');
    return refuse(
      'VALIDATION_ERROR',
      `${toolName} args are invalid${where === '' ? '' : ` at ${where}`}: ${issue?.message ?? 'unknown'}`,
    );
  }
  const args = parsed.data as Record<string, unknown>;
  const operation = brokerOperationOf(toolName);
  const access: 'read' | 'write' = toolName === 'read' || toolName === 'search' ? 'read' : 'write';
  const pathArg = typeof args['path'] === 'string' ? args['path'] : undefined;
  if (pathArg !== undefined) {
    const bad = assertToolPath('path', pathArg);
    if (bad !== undefined) return bad;
  }
  const cwdArg = typeof args['cwd'] === 'string' ? args['cwd'] : undefined;
  if (cwdArg !== undefined) {
    const bad = assertToolPath('cwd', cwdArg);
    if (bad !== undefined) return bad;
  }
  const cwd = cwdArg === undefined ? undefined : resolve(input.cwdRoot, cwdArg);

  switch (toolName) {
    case 'read':
      return {
        ok: true,
        plan: {
          toolName,
          operation,
          access,
          targets: [String(args['path'])],
          input: args,
          run: (context) => runReadTool(context, args),
        },
      };
    case 'search':
      return {
        ok: true,
        plan: {
          toolName,
          operation,
          access,
          targets: [String(args['path'])],
          input: args,
          run: (context) => runSearchTool(context, args),
        },
      };
    case 'edit':
      return {
        ok: true,
        plan: {
          toolName,
          operation,
          access,
          targets: [String(args['path'])],
          input: args,
          run: (context) => runEditTool(context, args),
        },
      };
    case 'write':
      return {
        ok: true,
        plan: {
          toolName,
          operation,
          access,
          targets: [String(args['path'])],
          // `write` keeps the Broker's built-in executor: it is exactly
          // "write this content to the checked target", which `execute` already does.
          input: { path: String(args['path']), content: String(args['content']) },
          ...(cwd === undefined ? {} : { cwd }),
        },
      };
    case 'artifact_write':
      return {
        ok: true,
        plan: {
          toolName,
          operation,
          access,
          targets: [String(args['path'])],
          // The executor is attached by the daemon, which owns `ArtifactService`
          // (`execution.md` §2: Core handles domain tools directly).
          input: args,
          ...(cwd === undefined ? {} : { cwd }),
        },
      };
    case 'bash': {
      const command = String(args['command']);
      if (isRefMutatingGitShellCommand(command)) {
        return refuse(
          'NOT_AUTHORIZED',
          'bash may not run a ref-mutating git command; delivery refs change only through the Workspace service CAS',
        );
      }
      return {
        ok: true,
        plan: {
          toolName,
          operation,
          access,
          targets: [],
          input: { command },
          ...(cwd === undefined ? {} : { cwd }),
        },
      };
    }
    case 'git': {
      const argv = (args['args'] as unknown[]).map((token) => String(token));
      if (!isReadOnlyGitInvocation(argv)) {
        return refuse(
          'NOT_AUTHORIZED',
          `git ${argv[0] ?? ''} is not a read-only subcommand; git ref changes are performed only by the Workspace service`,
        );
      }
      return {
        ok: true,
        plan: {
          toolName,
          operation,
          access,
          targets: [],
          // The Broker spawns argv directly (no shell), so a token containing `;`
          // stays an argument. The program is part of the vector because the Broker
          // spawns `argv[0]` and passes the rest as its arguments.
          input: { command: `git ${argv.join(' ')}`, argv: ['git', ...argv] },
          ...(cwd === undefined ? {} : { cwd }),
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Tools Core implements itself (`execution.md` §2: "Core直接处理文件和领域工具")
// ---------------------------------------------------------------------------

/** One `read` result: the content plus whether it was cut to the requested window. */
export interface ReadToolResult {
  readonly path: string;
  readonly content: string;
  readonly lines: number;
  readonly offset: number;
  readonly truncated: boolean;
}

/**
 * Reads one already-boundary-checked file with an optional line window.
 *
 * The path comes from `context.paths`, which the Broker resolved and checked, and the
 * read goes through `context.readFile`, which re-checks it at open time
 * (`execution.md` §3).
 */
export function runReadTool(context: ToolContext, args: Record<string, unknown>): ReadToolResult {
  const target = context.paths[0];
  if (target === undefined) {
    throw new Error('read requires exactly one resolved target');
  }
  const content = context.readFile(target);
  const offset = typeof args['offset'] === 'number' ? args['offset'] : 0;
  const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;
  const all = content.split('\n');
  const window = limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit);
  return {
    path: target,
    content: window.join('\n'),
    lines: all.length,
    offset,
    truncated: offset + window.length < all.length,
  };
}

/** One search hit, with a 1-based line number and the matching line. */
export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchToolResult {
  readonly matches: readonly SearchMatch[];
  readonly filesScanned: number;
  readonly truncated: boolean;
}

/** Directories a code search never descends into. */
const SEARCH_SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.cache']);

export const DEFAULT_SEARCH_RESULTS = 200;

/**
 * A bounded literal search over one resolved path.
 *
 * The walk starts from the path the Broker checked and re-reads every file through
 * `context.readFile`, so each individual read is boundary-checked again at open time;
 * symlinked directories are skipped rather than followed, so a link inside the root
 * cannot walk the search outside it. The search is **literal** (not a regular
 * expression) on purpose: a model-supplied pattern is not a place to run an
 * unaccountable regex engine over the operator's tree.
 */
export function runSearchTool(
  context: ToolContext,
  args: Record<string, unknown>,
): SearchToolResult {
  const start = context.paths[0];
  if (start === undefined) throw new Error('search requires exactly one resolved target');
  const query = String(args['query']);
  const maxResults =
    typeof args['maxResults'] === 'number' ? args['maxResults'] : DEFAULT_SEARCH_RESULTS;
  const root = context.roots[0] ?? start;
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  const visit = (path: string): void => {
    if (truncated) return;
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(path);
    } catch {
      return;
    }
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(path).sort();
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SEARCH_SKIP_DIRECTORIES.has(entry)) continue;
        visit(resolve(path, entry));
        if (truncated) return;
      }
      return;
    }
    if (!stats.isFile()) return;
    let content: string;
    try {
      content = context.readFile(path);
    } catch {
      // A file the boundary refuses (or that is not UTF-8 readable) is skipped: the
      // Broker's refusal is the authority, and a search must not turn it into an error.
      return;
    }
    filesScanned += 1;
    const display = relative(root, path).split(sep).join('/');
    const lines = content.split('\n');
    for (const [index, text] of lines.entries()) {
      if (!text.includes(query)) continue;
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
      matches.push({ path: display, line: index + 1, text: text.slice(0, 400) });
    }
  };

  visit(start);
  return { matches, filesScanned, truncated };
}

/** One `edit` result; `matched` is false when `expectedContent` did not match. */
export interface EditToolResult {
  readonly path: string;
  readonly written: boolean;
  readonly matched: boolean;
}

/**
 * Applies a whole-file edit, optionally guarded by the content the caller expects.
 *
 * `expectedContent` is the pre-image check a code edit needs: a model that read the
 * file earlier must not overwrite a version someone else changed. A mismatch writes
 * nothing and reports `matched:false` so the model can re-read instead of retrying
 * blindly.
 */
export function runEditTool(context: ToolContext, args: Record<string, unknown>): EditToolResult {
  const target = context.paths[0];
  if (target === undefined) throw new Error('edit requires exactly one resolved target');
  const expected = args['expectedContent'];
  if (typeof expected === 'string') {
    const current = context.readFile(target);
    if (current !== expected) {
      return { path: target, written: false, matched: false };
    }
  }
  context.writeFile(target, String(args['content']));
  return { path: target, written: true, matched: true };
}
