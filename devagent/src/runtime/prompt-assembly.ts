/**
 * Context assembly (P3): the text a host injects into a model.
 *
 * Bodies come from the role prompt files and are sliced exactly as the context contract (G4) says:
 * base from `## Base rules` to EOF, specialists from `## Shared rules` up to `## Role file map`, and
 * each role from `## Role and goal` to EOF. Everything injected here is English; the model answers in
 * the user's language. A missing or duplicated boundary is a hard error — a silently partial role
 * body would give the model half its rules.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PromptRoleId =
  | 'chief'
  | 'designer'
  | 'developer'
  | 'reviewer'
  | 'tester'
  | 'settler'
  | 'investigator';

export const ROLE_IDS: readonly PromptRoleId[] = [
  'chief',
  'designer',
  'developer',
  'reviewer',
  'tester',
  'settler',
  'investigator',
];

export function isPromptRoleId(value: string): value is PromptRoleId {
  return (ROLE_IDS as readonly string[]).includes(value);
}

export interface InjectedBody {
  readonly name: PromptRoleId | 'base' | 'specialists';
  readonly path: string;
  readonly text: string;
}

const BOUNDARY = {
  base: { start: '## Base rules', end: undefined },
  specialists: { start: '## Shared rules', end: '## Role file map' },
  role: { start: '## Role and goal', end: undefined },
} as const;

/** Slice the injected body out of a prompt file, failing loudly on an unusable boundary. */
export function sliceInjectedBody(
  text: string,
  kind: keyof typeof BOUNDARY,
  path: string,
): string {
  const { start, end } = BOUNDARY[kind];
  const startIndex = text.indexOf(start);
  if (startIndex === -1) {
    throw new Error(`prompt boundary ${JSON.stringify(start)} is missing in ${path}`);
  }
  if (text.indexOf(start, startIndex + start.length) !== -1) {
    throw new Error(`prompt boundary ${JSON.stringify(start)} appears more than once in ${path}`);
  }
  if (end === undefined) {
    return text.slice(startIndex);
  }
  const endIndex = text.indexOf(end, startIndex);
  if (endIndex === -1) {
    throw new Error(`prompt boundary ${JSON.stringify(end)} is missing in ${path}`);
  }
  if (text.indexOf(end, endIndex + end.length) !== -1) {
    throw new Error(`prompt boundary ${JSON.stringify(end)} appears more than once in ${path}`);
  }
  return text.slice(startIndex, endIndex);
}

export interface PromptBodies {
  readonly base: InjectedBody;
  readonly specialists: InjectedBody;
  readonly roles: Readonly<Record<PromptRoleId, InjectedBody>>;
}

export function loadPromptBodies(promptDir: string): PromptBodies {
  const read = (file: string): string => readFileSync(join(promptDir, file), 'utf8');
  const basePath = join(promptDir, 'base.md');
  const specialistsPath = join(promptDir, 'specialists.md');
  const roles = Object.fromEntries(
    ROLE_IDS.map((roleId) => {
      const path = join(promptDir, `${roleId}.md`);
      return [
        roleId,
        { name: roleId, path, text: sliceInjectedBody(read(`${roleId}.md`), 'role', path) },
      ];
    }),
  ) as Record<PromptRoleId, InjectedBody>;
  return {
    base: {
      name: 'base',
      path: basePath,
      text: sliceInjectedBody(read('base.md'), 'base', basePath),
    },
    specialists: {
      name: 'specialists',
      path: specialistsPath,
      text: sliceInjectedBody(read('specialists.md'), 'specialists', specialistsPath),
    },
    roles,
  };
}

export interface AssembledSystemPrompt {
  /** Appended to Pi's own instructions (never replacing them). */
  readonly text: string;
  readonly sources: readonly InjectedBody[];
}

/**
 * chief gets base + its own role body; every specialist gets base + the shared specialist rules +
 * its own role body. Only the current role is injected.
 */
export function assembleSystemPrompt(
  bodies: PromptBodies,
  roleId: PromptRoleId,
): AssembledSystemPrompt {
  const role = bodies.roles[roleId];
  const sources = roleId === 'chief' ? [bodies.base, role] : [bodies.base, bodies.specialists, role];
  return { text: sources.map((body) => body.text).join('\n\n'), sources };
}