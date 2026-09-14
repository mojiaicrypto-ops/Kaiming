/**
 * The `tool.execute` wire contract (`docs/architecture/protocol.md` §6).
 *
 * §6 lists the internal method as
 *
 * > tool.execute* | attemptId,epoch,toolName,args,expectedInputHash? | accepted或工具结果Ref
 *
 * and this module is the single definition of that request/response shape plus the
 * tool-name vocabulary, so the Runner (`apps/runner/src/tool-client.ts`), the Core
 * endpoint (`packages/core/src/tool-http.ts`) and the daemon handler agree on one
 * shape instead of three (`protocol.md` §1: "共享Schema一次定义，服务端与客户端共用，
 * 测试不复制另一套类型").
 *
 * **Two documented result shapes** (Q-T3-1). A tool result is returned **inline** when
 * it is small enough, because the Pi tool call is a request/answer exchange and the
 * model needs the text in the same turn:
 *
 * - inline: `{status:'executed'|'replayed', result, resultRef:null, truncated:false}`;
 * - deferred: `{status:..., result:<bounded preview>, resultRef:<id>, truncated:true}` —
 *   the full value is stored in the durable deferred-result store the Grant ledger
 *   already uses (`reliability.md` §2), and the model is told in the tool text that the
 *   complete result lives under `resultRef`.
 *
 * A refusal is never a body shape of its own: the endpoint answers the protocol error
 * envelope `{error:{code,message,details?}}` with the status `protocol.md` §7 assigns
 * to the code (`statusForControlCode`), so a Runner can tell a correctable
 * `VALIDATION_ERROR` from a terminal `NOT_AUTHORIZED` without parsing prose.
 *
 * The `accepted` reading of §6 is deliberately **not** used for this tool set: every
 * operation it carries is a bounded, synchronous call whose result is known before the
 * endpoint replies, so returning `accepted` plus a second un-documented read surface
 * would invent protocol the product does not specify (plan D-T3-3/Q-T3-1 option A).
 */
import { z } from 'zod';
import { roleSchema, type Role } from './enums.js';
import { repoPathSchema, type operationNameSchema } from './primitives.js';

/**
 * Tool names that execute through the Broker, and the `Scope.operations` name each
 * one is admitted as.
 *
 * The names are deliberately **identical** to `execution.md` §7's tool list and to
 * `Scope.operations`: the Pi SDK treats the allowlist as tool names, and a role whose
 * `bash` tool were called something else would leave the SDK's own built-in `bash`
 * active. Registering the same name lets our definition replace the built-in one, so
 * the documented tool set is the only authority (`execution.md` §7 "角色工具完全由
 * 注册表构造").
 */
export const BROKER_TOOLS = {
  read: 'read',
  search: 'search',
  edit: 'edit',
  write: 'write',
  bash: 'bash',
  git: 'git',
  artifact_write: 'artifact_write',
} as const satisfies Record<string, z.infer<typeof operationNameSchema>>;

export type BrokerToolName = keyof typeof BROKER_TOOLS;

export function isBrokerToolName(name: string): name is BrokerToolName {
  return Object.hasOwn(BROKER_TOOLS, name);
}

/** Read-only investigation tools every role holds (`execution.md` §7). */
const READ_ONLY_TOOLS: readonly BrokerToolName[] = ['read', 'search', 'artifact_write'];

/** Investigation plus the source-modifying set (`execution.md` §7). */
const MODIFYING_TOOLS: readonly BrokerToolName[] = [
  'read',
  'search',
  'edit',
  'write',
  'bash',
  'git',
  'artifact_write',
];

/**
 * Which Broker tool each role may call (`execution.md` §7, `rules/agents.md` §1).
 *
 * This is the **name-level** half of the registry, shared by Core and the Runner. The
 * Runner derives the Pi session's allowlist and argument schemas from it
 * (`apps/runner/src/tools.ts`); Core uses it to refuse a tool the caller's role does not
 * hold *before* any Grant is consulted, which is the second line of defence behind the
 * Broker's capability gate (`broker.ts` `isReadOnlyRole`/`toolCapability`).
 *
 * `review` and `test` hold no source-writing and no shell tool: `execution.md` §1 keeps
 * them in a frozen verification copy in every mode, and §7 gives Review only "自己报告与
 * 检查临时目录" (through `artifact_write`, which the Broker confines to the report root).
 * `settlement` edits authorized documentation candidates but runs no build commands.
 */
export const ROLE_BROKER_TOOLS: Record<Role, readonly BrokerToolName[]> = {
  chief: READ_ONLY_TOOLS,
  product: READ_ONLY_TOOLS,
  planning: READ_ONLY_TOOLS,
  backend: MODIFYING_TOOLS,
  frontend: MODIFYING_TOOLS,
  review: READ_ONLY_TOOLS,
  test: READ_ONLY_TOOLS,
  settlement: ['read', 'search', 'edit', 'write', 'artifact_write'],
};

/** Whether one role holds one Broker tool. */
export function roleHasBrokerTool(role: Role, name: string): boolean {
  return (ROLE_BROKER_TOOLS[role] as readonly string[]).includes(name);
}

/** The team roles the registry covers; `ROLE_BROKER_TOOLS` is keyed by all of them. */
export const ROLE_BROKER_TOOL_ROLES = roleSchema.options;

/** The Broker operation a tool name is admitted as. */
export function brokerOperationOf(name: BrokerToolName): string {
  return BROKER_TOOLS[name];
}

/**
 * The only `git` subcommands the tool exposes (`execution.md` §7).
 *
 * "Git ref修改只由Workspace服务完成" — delivery-ref changes belong to the Workspace
 * service's CAS alone, so the `git` tool is a **read-only** viewer. Mutating
 * subcommands are refused with `NOT_AUTHORIZED` by the daemon handler before any
 * process is spawned, and the same `bash` guard covers the `git <mutating>` spelling.
 */
export const GIT_READ_ONLY_SUBCOMMANDS: readonly string[] = [
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'blame',
  'show-ref',
  'symbolic-ref',
  'describe',
  'shortlog',
  'cat-file',
  'grep',
] as const;

/**
 * `git` subcommands that change a ref or the working tree, refused outright.
 *
 * The list exists so the refusal names the operation it blocked; it is *documentation*
 * for the error message, not the gate. `isReadOnlyGitInvocation` uses the allowlist, so
 * a subcommand missing from both lists is refused as well.
 */
export const GIT_REF_MUTATING_SUBCOMMANDS: readonly string[] = [
  'add',
  'am',
  'apply',
  'branch',
  'checkout',
  'cherry-pick',
  'clean',
  'clone',
  'commit',
  'config',
  'fetch',
  'filter-branch',
  'gc',
  'init',
  'merge',
  'mv',
  'notes',
  'prune',
  'push',
  'rebase',
  'remote',
  'repack',
  'replace',
  'reset',
  'revert',
  'rm',
  'stash',
  'submodule',
  'switch',
  'tag',
  'update-index',
  'update-ref',
  'worktree',
] as const;

/**
 * The `git` global flags that consume the next token, so the subcommand scan is not
 * fooled by their value (`git -C /repo log` names `log`, not `/repo`).
 */
const GIT_GLOBAL_FLAGS_WITH_VALUE: readonly string[] = [
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
];

/** The subcommand of a `git` argument vector, or `undefined` when there is none. */
export function gitSubcommandOf(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (GIT_GLOBAL_FLAGS_WITH_VALUE.includes(token)) {
      index += 1;
      continue;
    }
    if (token === '--') return argv[index + 1];
    if (token.startsWith('-')) continue;
    return token;
  }
  return undefined;
}

/**
 * Whether a parsed `git` argument vector is a read-only invocation.
 *
 * `args[0]` is the subcommand; global flags such as `-C <dir>` and `--no-pager` may
 * precede it, so they are skipped before the check. A subcommand that is neither
 * listed as read-only nor known to be mutating is still refused: the allowlist, not a
 * denylist, is the authority.
 */
export function isReadOnlyGitInvocation(argv: readonly string[]): boolean {
  const subcommand = gitSubcommandOf(argv);
  if (subcommand === undefined) return false;
  return GIT_READ_ONLY_SUBCOMMANDS.includes(subcommand);
}

/**
 * The genesis string of the read-ledger seal (`AC-085`).
 *
 * `core/context/ledger.ts` accumulates one SHA-256 per read over
 * `{prev, seq, path, revision, hash, reason, bytes}`, starting from `sha256(genesis)`; an
 * Attempt that read nothing therefore seals `{seq: 0, hash: sha256(genesis)}`. The constant
 * lives in contracts so the Runner can compute **the same** empty binding without importing
 * the Core ledger (`apps/runner/src/tool-client.ts`); nothing else about the seal is needed
 * on that side, because Core sends the binding with every `tool.execute` answer.
 */
export const READ_LEDGER_SEAL_GENESIS = 'agentdev.read-ledger.seal.v1';

/** Tool-result byte ceiling before the result is deferred (Q-T3-1). */
export const TOOL_RESULT_INLINE_BYTES = 64 * 1024;

/** The documented `tool.execute` body members; anything else is `VALIDATION_ERROR`. */
export const TOOL_EXECUTE_FIELDS: readonly string[] = [
  'attemptId',
  'epoch',
  'toolName',
  'args',
  'toolOperationId',
  'expectedInputHash',
  'timeoutMs',
] as const;

/**
 * One `tool.execute` request (`protocol.md` §6).
 *
 * `toolOperationId`/`expectedInputHash` are optional on the wire: the Runner normally
 * derives both so a transport retry is idempotent, and the endpoint generates the id
 * when a caller omits it (the generated id is echoed in the response).
 */
export const toolExecuteRequestSchema = z.strictObject({
  attemptId: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  toolOperationId: z.string().min(1).optional(),
  expectedInputHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, { message: 'expected a lowercase SHA256 input hash' })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type ToolExecuteRequest = z.infer<typeof toolExecuteRequestSchema>;

/** Where one tool call ran; the audit row records it next to the operation. */
export const executionModeSchema = z.enum(['container', 'host']);
export type ToolExecutionMode = z.infer<typeof executionModeSchema>;

/**
 * One successful `tool.execute` answer (see the module note for the two result shapes).
 *
 * `resultRef` is non-null exactly when the value was deferred, and `truncated` mirrors
 * it so a model can act on the flag without knowing the storage detail. `result` is
 * always present: the full value inline, or a bounded preview when deferred.
 */
export const toolExecuteResultSchema = z.strictObject({
  v: z.literal(1),
  status: z.enum(['executed', 'replayed']),
  mode: executionModeSchema,
  operation: z.string().min(1),
  toolName: z.string().min(1),
  toolOperationId: z.string().min(1),
  inputHash: z.string().min(1),
  grantId: z.string().min(1),
  result: z.unknown(),
  resultRef: z.string().min(1).nullable(),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
export type ToolExecuteResult = z.infer<typeof toolExecuteResultSchema>;

// ---------------------------------------------------------------------------
// Tool argument shapes
// ---------------------------------------------------------------------------

/**
 * The arguments each Broker tool accepts, as one zod definition.
 *
 * The Broker-side validator (`packages/core/src/tools.ts`) and the daemon handler both
 * read the shapes from here, and `apps/runner/src/tools.ts` derives the model-facing
 * typebox schema from the same field lists; a test asserts the two agree field for
 * field, so a tool cannot gain a parameter the server does not validate.
 */
export const toolArgsSchemas = {
  read: z.strictObject({
    path: repoPathSchema,
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  }),
  search: z.strictObject({
    query: z.string().min(1),
    path: repoPathSchema,
    maxResults: z.number().int().positive().max(1000).optional(),
  }),
  write: z.strictObject({
    path: repoPathSchema,
    content: z.string(),
  }),
  edit: z.strictObject({
    path: repoPathSchema,
    content: z.string(),
    expectedContent: z.string().optional(),
  }),
  bash: z.strictObject({
    command: z.string().min(1),
    cwd: repoPathSchema.optional(),
  }),
  git: z.strictObject({
    args: z.array(z.string().min(1)).min(1),
    cwd: repoPathSchema.optional(),
  }),
  artifact_write: z.strictObject({
    path: repoPathSchema,
    content: z.string(),
    mime: z.string().min(1).optional(),
  }),
} as const satisfies Record<BrokerToolName, z.ZodType>;

export type ToolArgs<K extends BrokerToolName> = z.infer<(typeof toolArgsSchemas)[K]>;

/** The model-facing parameter names of one tool, sorted; the cross-check uses it. */
export function toolArgumentNames(name: BrokerToolName): string[] {
  return Object.keys(toolArgsSchemas[name].shape).sort();
}
