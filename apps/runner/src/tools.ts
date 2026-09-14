/**
 * The role → tool registry the Runner builds its Pi session from.
 *
 * `docs/architecture/execution.md` §7 fixes the tool set and the rule this module
 * implements: "角色工具完全由注册表构造" — "read/search/context_request/artifact_write；
 * 修改角色另有edit/write/bash/git；Chief有assessment_submit/agent_dispatch/
 * decision_request；专业角色有stage_yield/request_dispatch". `docs/rules/agents.md` §1
 * fixes the write boundary each role has, and `execution.md` §7 keeps "Git ref修改只由
 * Workspace服务完成".
 *
 * The **membership** of each role's set lives in `@agentdev/contracts`
 * (`ROLE_BROKER_TOOLS`) so Core and the Runner cannot disagree about which role may call
 * which tool; this module adds the model-facing schema and label per tool. Three
 * properties matter and are each asserted by `apps/runner/test/tools.test.ts`:
 *
 * 1. **The registry is the authority, the profile only narrows** (plan D-T3-1). The Pi
 *    SDK treats `tools` as both the allowlist and the initial active set, so a custom
 *    tool that is not named there is *discarded*. A review Run therefore never has
 *    `edit`/`write`/`bash`/`git` registered at all — the second line of defence behind
 *    the Broker's own role gate.
 * 2. **Tool names equal `Scope.operations` names.** The Pi SDK ships built-ins called
 *    `read`/`bash`/`edit`/`write`; registering our own definition under the same name
 *    replaces the built-in, which keeps the documented tool set the only authority
 *    instead of leaving a `bash` that bypasses the Broker active.
 * 3. **The model-facing parameters are the server-validated ones.** Each schema's field
 *    set is checked against `@agentdev/contracts` `toolArgsSchemas` by a test, so a tool
 *    cannot gain a parameter the server would refuse (or lose one it requires).
 *
 * `context_request` is deliberately **not** registered: `protocol.md` §6 documents it,
 * but no endpoint serves it in this slice (`api-gap-audit.md` §1.4), and registering a
 * tool the model can call but Core cannot answer would be a dead tool. That gap is
 * registered in `.agentdev/work/WP-12/T3-implementation.md`.
 */
import {
  BROKER_TOOLS,
  ROLES,
  ROLE_BROKER_TOOLS,
  toolArgumentNames,
  type BrokerToolName,
  type Role,
} from '@agentdev/contracts';
import { Type, type TSchema } from 'typebox';
import type { PiToolSpec } from '@agentdev/pi-runtime';

/** One tool a role may use, with its argument schema and authority character. */
export interface RoleToolSpec {
  /** The Pi tool name; identical to the Broker and `Scope.operations` name. */
  readonly name: BrokerToolName;
  /** Whether the tool can change state (`broker.toolCapability` agrees by construction). */
  readonly mutating: boolean;
  readonly label: string;
  readonly description: string;
  readonly parameters: TSchema;
}

/**
 * Every Broker tool's model-facing description.
 *
 * `mutating` mirrors `broker.toolCapability`: `read`/`search` only read; everything else
 * can change state, and `bash`/`git` run an arbitrary command that no root confines.
 */
export const TOOL_SPECS: Record<BrokerToolName, RoleToolSpec> = {
  read: {
    name: 'read',
    mutating: false,
    label: 'Read a file',
    description:
      'Read a repository-relative file inside the Run workspace. Optional offset/limit select a ' +
      '1-based line window. The path must be inside the Work authorization; a refusal comes back ' +
      'as NOT_AUTHORIZED and reads nothing.',
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
    }),
  },
  search: {
    name: 'search',
    mutating: false,
    label: 'Search the workspace',
    description:
      'Literal search over an authorized file or directory. Returns matching lines with their ' +
      'repository-relative path and 1-based line number. `node_modules`, `dist`, `build`, `.git` ' +
      'and symlinked directories are skipped.',
    parameters: Type.Object({
      query: Type.String(),
      path: Type.String(),
      maxResults: Type.Optional(Type.Number()),
    }),
  },
  write: {
    name: 'write',
    mutating: true,
    label: 'Write a file',
    description:
      'Write repository-relative content to an authorized path, creating it when absent. The ' +
      'Broker checks the resolved real path (symlinks included) before writing.',
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
    }),
  },
  edit: {
    name: 'edit',
    mutating: true,
    label: 'Edit a file',
    description:
      'Replace a file with new content. Pass expectedContent with the exact text you last read: ' +
      'if the file changed since, nothing is written and the result says matched:false, so re-read ' +
      'instead of retrying blindly.',
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
      expectedContent: Type.Optional(Type.String()),
    }),
  },
  bash: {
    name: 'bash',
    mutating: true,
    label: 'Run a shell command',
    description:
      'Run one shell command inside the Run workspace and return its exit status, stdout and ' +
      'stderr. The process runs in its own group; a timeout or cancel kills the whole tree. A ' +
      'ref-mutating git command is refused — delivery refs change only through the Workspace ' +
      'service — and network access requires an explicit Grant.',
    parameters: Type.Object({
      command: Type.String(),
      cwd: Type.Optional(Type.String()),
    }),
  },
  git: {
    name: 'git',
    mutating: true,
    label: 'Inspect the repository',
    description:
      'Run a read-only git subcommand (status, diff, log, show, rev-parse, ls-files, blame, ' +
      'show-ref, symbolic-ref, describe, shortlog, cat-file, grep) in the workspace. Commands ' +
      'that move a ref or the working tree are refused: the Workspace service owns delivery-ref ' +
      'changes.',
    parameters: Type.Object({
      args: Type.Array(Type.String()),
      cwd: Type.Optional(Type.String()),
    }),
  },
  artifact_write: {
    name: 'artifact_write',
    mutating: true,
    label: 'Write an artifact',
    description:
      'Store a report/product artifact for this Work and return its reference. Core handles the ' +
      'artifact directly (no shell); the content is content-addressed and bound to this Run.',
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
      mime: Type.Optional(Type.String()),
    }),
  },
};

/**
 * The registry, one entry per documented role (`rules/agents.md` §1).
 *
 * The role's *membership* comes from the contract (`ROLE_BROKER_TOOLS`) so Core's entry
 * check and the Runner's allowlist are the same list; this module only attaches the
 * schema and prose. `review`/`test` are the frozen-verification roles, so they hold no
 * mutating tool except `artifact_write`, which the Broker confines to the configured
 * report/scratch root (`execution.md` §3).
 */
export const ROLE_TOOL_REGISTRY: Record<Role, readonly RoleToolSpec[]> = Object.fromEntries(
  ROLES.map((role) => [role, ROLE_BROKER_TOOLS[role].map((name) => TOOL_SPECS[name])]),
) as unknown as Record<Role, readonly RoleToolSpec[]>;

/** The tool names a role holds, in registry order. */
export function roleToolNames(role: Role): string[] {
  return ROLE_TOOL_REGISTRY[role].map((spec) => spec.name);
}

/** The registry entry for one role/tool pair, or `undefined`. */
export function roleToolSpec(role: Role, name: string): RoleToolSpec | undefined {
  return ROLE_TOOL_REGISTRY[role].find((spec) => spec.name === name);
}

/** What one tool call needs from the transport (`apps/runner/src/tool-client.ts`). */
export interface ToolBridge {
  execute(input: {
    readonly toolName: BrokerToolName;
    readonly args: Record<string, unknown>;
    /**
     * The Pi tool-call id: the stable half of the idempotency key.
     *
     * Empty when a caller drove the tool spec directly without an SDK id; the bridge
     * then derives a call key of its own instead of colliding every call on `''`.
     */
    readonly toolCallId: string;
    readonly signal: AbortSignal | undefined;
  }): Promise<{ readonly text: string; readonly isError?: boolean }>;
}

/** The narrowing decision for one Attempt (plan D-T3-1). */
export interface RoleToolSelection {
  /** The tools to register, in registry order. */
  readonly tools: readonly RoleToolSpec[];
  /** Names the profile asked for that the role does not have; a non-empty list is fatal. */
  readonly rejected: readonly string[];
}

/**
 * Applies the profile's `toolSubset` to the role registry (plan D-T3-1).
 *
 * - an **empty** subset means the role's whole registry — the documented default, which
 *   is why a fresh installation still has working tools;
 * - a **non-empty** subset is an intersection: it may only narrow;
 * - a name the role does not have (for example `review` asking for `bash`) is reported
 *   in `rejected` instead of being dropped silently, and the caller fails the Attempt
 *   (`ATTEMPT_START_FAILED`). Silently dropping it would leave the model without the
 *   tool its profile declared and hide a configuration error.
 */
export function selectRoleTools(
  role: Role,
  subset: readonly string[] | undefined,
): RoleToolSelection {
  const registry = ROLE_TOOL_REGISTRY[role];
  if (subset === undefined || subset.length === 0) {
    return { tools: registry, rejected: [] };
  }
  const rejected = subset.filter((name) => !registry.some((spec) => spec.name === name));
  const wanted = new Set(subset);
  return { tools: registry.filter((spec) => wanted.has(spec.name)), rejected };
}

/**
 * Builds the Pi tools one Attempt registers, bound to its transport.
 *
 * The returned specs carry the registry's schema and forward exactly one call to
 * `bridge.execute`, which owns the `tool.execute` transport, the idempotency key and
 * the result text. Nothing policy-shaped happens here: the Broker re-checks every call.
 */
export function roleTools(
  role: Role,
  bridge: ToolBridge,
  subset?: readonly string[],
): PiToolSpec[] {
  return selectRoleTools(role, subset).tools.map((spec) => ({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (params, context) => {
      const result = await bridge.execute({
        toolName: spec.name,
        args: params,
        toolCallId: context.toolCallId ?? '',
        signal: context.signal,
      });
      return result.isError === true ? { text: result.text, isError: true } : { text: result.text };
    },
  }));
}

/**
 * Every role in `ROLES` has a registry entry.
 *
 * A future role added to the contract without a registry entry would otherwise leave an
 * Attempt with no tools at all; the Runner calls this at startup so the omission fails
 * loudly instead of silently.
 */
export function missingRegistryRoles(): string[] {
  return (ROLES as readonly string[]).filter(
    (role) => ROLE_TOOL_REGISTRY[role as Role] === undefined,
  );
}

/**
 * The names the Runner requires its session to have activated.
 *
 * The Pi SDK's `tools` option is both the allowlist and the initial active set; a
 * session whose `activeToolNames()` differs from this list has configured something
 * else (an SDK built-in left active, a name that failed to register), and the Attempt
 * must fail rather than run with a tool set nobody chose (plan §3.2).
 */
export function assertActiveTools(expected: readonly string[], active: readonly string[]): string {
  const activeSet = new Set(active);
  const missing = expected.filter((name) => !activeSet.has(name));
  const extra = active.filter((name) => !expected.includes(name));
  if (missing.length === 0 && extra.length === 0) return '';
  return `the session activated ${active.join(', ') || '<none>'}; expected exactly ${expected.join(', ')} (missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'})`;
}

/** The argument names one registered tool exposes; the contract cross-check uses it. */
export function registeredArgumentNames(role: Role, name: BrokerToolName): string[] {
  const spec = roleToolSpec(role, name);
  if (spec === undefined) return [];
  const properties = (spec.parameters as { properties?: Record<string, unknown> }).properties ?? {};
  return Object.keys(properties).sort();
}

/** The contract's own field list for one tool, for the cross-check test. */
export function contractArgumentNames(name: BrokerToolName): string[] {
  return toolArgumentNames(name);
}

/** Every Broker tool name the contracts define, for completeness assertions. */
export function registeredToolNames(): string[] {
  return Object.keys(BROKER_TOOLS).sort();
}
