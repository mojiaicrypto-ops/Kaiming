/**
 * Role tool sets (P3): which tools a session may use.
 *
 * The sets follow the role/tool contract (G1): every write-capable role also reads (a role analyses the
 * code before it changes it), a read-only role never gains write tools even inside a write Task, and a
 * read Task opens neither project-writing tools nor arbitrary bash. The allowlist is static per role
 * and Task type — the model cannot switch its own permissions, and the host does not offer extra ops.
 *
 * `taskType` is `undefined` while a session has no Task yet: then the role's own documented set
 * applies (the chief still needs its requirement/project tools, for instance).
 */
import type { PromptRoleId } from './prompt-assembly.ts';
import { ROLE_IDS } from './prompt-assembly.ts';

export type TaskType = 'read' | 'write';

/** Tools that can modify the project (never available to a read-only role or a read Task). */
export const PROJECT_WRITE_TOOLS: readonly string[] = ['write', 'edit'];
/** Shell access: documented per role, and never in a read Task. */
const SHELL_TOOL = 'bash';
/** Domain tools that can write project files; their read ops arrive with their own permission work. */
const PROJECT_WRITING_DOMAIN_TOOLS: readonly string[] = ['requirement', 'project'];
/** Reading tools every role has, including the write-capable ones. */
const READ_TOOLS: readonly string[] = ['read', 'grep', 'find', 'ls'];

/** Native tool sets exactly as the contract documents them. */
const NATIVE_BY_ROLE: Readonly<Record<PromptRoleId, readonly string[]>> = {
  // The chief investigates and checks the real state itself (git, a test entry point, a file layout)
  // instead of trusting a summary; implementing Task work still belongs to the delegated roles.
  chief: [...READ_TOOLS, SHELL_TOOL],
  // Document work includes moving and deleting files (archive, rename, remove a duplicate body):
  // Pi has no rm/mv tool, so the shell is the native way to do it.
  designer: [...READ_TOOLS, ...PROJECT_WRITE_TOOLS, SHELL_TOOL],
  developer: [...READ_TOOLS, ...PROJECT_WRITE_TOOLS, SHELL_TOOL],
  reviewer: READ_TOOLS,
  tester: [...READ_TOOLS, SHELL_TOOL],
  settler: [...READ_TOOLS, ...PROJECT_WRITE_TOOLS, SHELL_TOOL],
  investigator: READ_TOOLS,
};

/**
 * External-information and browser tools (S9). They reach the network, never the project, so they
 * are not "project writing": a read Task keeps them, and no role's `projectReadOnly` flips.
 */
const WEB_TOOLS: readonly string[] = ['web_search', 'web_fetch'];
const BROWSER_TOOLS: readonly string[] = ['browser'];

/** Domain tools each role may call (registered later; the allowlist only lists their names). */
const DOMAIN_BY_ROLE: Readonly<Record<PromptRoleId, readonly string[]>> = {
  chief: ['task', 'requirement', 'project', 'question', ...WEB_TOOLS, ...BROWSER_TOOLS],
  designer: ['requirement', 'agent_report', 'task', 'question', ...WEB_TOOLS],
  developer: ['agent_report', 'task', 'requirement', 'question', ...WEB_TOOLS, ...BROWSER_TOOLS],
  reviewer: ['agent_report', 'task', 'question', ...WEB_TOOLS, ...BROWSER_TOOLS],
  tester: ['agent_report', 'task', 'question', ...WEB_TOOLS, ...BROWSER_TOOLS],
  // The settler records what was already verified: a fresh web lookup is not its job.
  settler: ['agent_report', 'task', 'requirement', 'question'],
  investigator: ['agent_report', 'task', 'question', ...WEB_TOOLS, ...BROWSER_TOOLS],
};

/**
 * Every domain tool name the host registers, in one place: P3-e must register exactly these names, so
 * the tables above and the host registration cannot drift apart (a registered-but-unlisted tool
 * would be admitted to every role through the host union).
 */
export const DOMAIN_TOOL_NAMES: readonly string[] = [
  'task',
  'agent_report',
  'requirement',
  'project',
  'question',
  ...WEB_TOOLS,
  ...BROWSER_TOOLS,
];

/**
 * Every tool name the host may hand to a session. A role/task combination denies all of the names it
 * does not hold, so a host-side union (domain tools, probe tools) can never widen its permissions.
 */
const TOOL_UNIVERSE: readonly string[] = [
  ...new Set([...Object.values(NATIVE_BY_ROLE).flat(), ...DOMAIN_TOOL_NAMES]),
].sort();

export interface RoleToolSet {
  /** Names handed to Pi as the session's allowlist (native + domain). */
  readonly allowlist: readonly string[];
  /** Native tools that only ever read. */
  readonly readTools: readonly string[];
  /** Names this role/task combination must never receive, so a host union cannot re-add them. */
  readonly denied: readonly string[];
  /** True when nothing in this set can change the project (including shell and project-writing tools). */
  readonly projectReadOnly: boolean;
  readonly taskType: TaskType | undefined;
}

/**
 * Tools for one role under one Task type. A `read` Task drops project-writing tools, arbitrary shell
 * and the project-writing domain tools; `agent_report` stays available because it writes a Server-side
 * report, not a project file.
 *
 * The allowlist names whole tools; the op subsets G1 narrows (a specialist's `task` is get-only) are
 * enforced by the tool itself, because the host fixes the caller's role.
 */
export function toolSetFor(roleId: PromptRoleId, taskType: TaskType | undefined): RoleToolSet {
  const readTask = taskType === 'read';
  const native = readTask
    ? NATIVE_BY_ROLE[roleId].filter(
        (tool) => !PROJECT_WRITE_TOOLS.includes(tool) && tool !== SHELL_TOOL,
      )
    : NATIVE_BY_ROLE[roleId];
  const domain = readTask
    ? DOMAIN_BY_ROLE[roleId].filter((tool) => !PROJECT_WRITING_DOMAIN_TOOLS.includes(tool))
    : DOMAIN_BY_ROLE[roleId];
  const denied = TOOL_UNIVERSE.filter((name) => !native.includes(name) && !domain.includes(name));
  return {
    allowlist: [...native, ...domain],
    readTools: native.filter((tool) => READ_TOOLS.includes(tool)),
    denied,
    projectReadOnly:
      !native.some((tool) => PROJECT_WRITE_TOOLS.includes(tool) || tool === SHELL_TOOL) &&
      !domain.some((tool) => PROJECT_WRITING_DOMAIN_TOOLS.includes(tool)),
    taskType,
  };
}

/** Read-only check used by tests and by the runtime's own assertions. */
export function isProjectReadOnly(roleId: PromptRoleId, taskType: TaskType | undefined): boolean {
  return toolSetFor(roleId, taskType).projectReadOnly;
}

export function toolSetMatrix(): Array<{
  readonly roleId: PromptRoleId;
  readonly taskType: TaskType | undefined;
  readonly allowlist: readonly string[];
  readonly projectReadOnly: boolean;
}> {
  const rows: Array<{
    roleId: PromptRoleId;
    taskType: TaskType | undefined;
    allowlist: readonly string[];
    projectReadOnly: boolean;
  }> = [];
  for (const roleId of ROLE_IDS) {
    for (const taskType of [undefined, 'read', 'write'] as const) {
      const set = toolSetFor(roleId, taskType);
      rows.push({
        roleId,
        taskType,
        allowlist: set.allowlist,
        projectReadOnly: set.projectReadOnly,
      });
    }
  }
  return rows;
}