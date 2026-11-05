/**
 * Effective configuration resolution (P2): which model and tool set a logical session runs with.
 *
 * Order: role inside the project → global role override → project default → server default. Resolution
 * is a pure function so it can be tested without Pi; availability (does a credential actually exist?)
 * is checked separately by the runtime factory, and an unavailable selection blocks the input instead
 * of falling back.
 */

export interface ModelSelection {
  readonly providerId: string;
  readonly modelId: string;
}

/**
 * Pi's thinking level, as the SDK spells it. Defined here rather than imported because the package
 * root does not re-export the type, and a widened copy would let a typo reach `setThinkingLevel`.
 */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Everything a session must be created with; the level travels with the model it was chosen for. */
export interface ModelChoice extends ModelSelection {
  readonly thinkingLevel: ThinkingLevel;
}

export interface RuntimeDefaults {
  /** Model used when neither the role nor the project overrides it. */
  readonly model: ModelSelection;
  /** Pi config dir (models.json / auth.json live here); credentials stay outside project files. */
  readonly agentDir: string;
  /** Directory holding the role prompt files shipped with the server (docs/technicalnew/prompts). */
  readonly promptDir: string;
  /** Tool allowlist for sessions created by this runtime. */
  readonly tools: readonly string[];
}

export interface ProjectOverrides {
  readonly model?: ModelSelection;
  /** The level saved on the same row as `model`; absent means the row never set one. */
  readonly thinkingLevel?: ThinkingLevel;
}

export interface ResolveInput {
  readonly roleId: string;
  readonly server: RuntimeDefaults;
  readonly project?: ProjectOverrides;
  /** The role's own choice inside this project: narrower than both the role and the project. */
  readonly projectRole?: ModelSelection;
  readonly projectLevel?: ThinkingLevel;
  readonly roleOverrides?: Readonly<Record<string, ModelSelection>>;
  readonly roleLevels?: Readonly<Record<string, ThinkingLevel | undefined>>;
}

export interface EffectiveConfig {
  readonly selection: ModelSelection;
  /** The thinking level that travels with the winning layer; `off` when that layer never set one. */
  readonly thinkingLevel: ThinkingLevel;
  /** Where the selection came from — recorded so the user can tell why a model was used. */
  readonly source: 'project-role' | 'role' | 'project' | 'server';
  readonly agentDir: string;
  /** Directory of the role prompt files used for this session. */
  readonly promptDir: string;
  readonly tools: readonly string[];
}

export function resolveEffectiveConfig(input: ResolveInput): EffectiveConfig {
  const roleOverride = input.roleOverrides?.[input.roleId];
  const selection = input.projectRole ?? roleOverride ?? input.project?.model ?? input.server.model;
  const source: EffectiveConfig['source'] =
    input.projectRole !== undefined
      ? 'project-role'
      : roleOverride !== undefined
        ? 'role'
        : input.project?.model !== undefined
          ? 'project'
          : 'server';
  // The level belongs to the row that won the model: a level chosen for one model says nothing about
  // another, and the levels a model accepts are its own. No cross-layer mixing, no invented default —
  // an unset row keeps the behaviour every session had before this existed.
  const level =
    input.projectRole !== undefined
      ? input.projectLevel
      : roleOverride !== undefined
        ? input.roleLevels?.[input.roleId]
        : input.project?.model !== undefined
          ? input.project.thinkingLevel
          : undefined;
  return {
    selection,
    thinkingLevel: level ?? 'off',
    source,
    agentDir: input.server.agentDir,
    promptDir: input.server.promptDir,
    tools: input.server.tools,
  };
}

/** Where a stored override lives: the same table the config surface saves into. */
export interface OverrideSource {
  getModelOverride(
    scope: 'role' | 'project',
    scopeId: string,
    roleId?: string,
  ): { readonly providerId: string; readonly modelId: string; readonly thinkingLevel?: string } | undefined;
}

/**
 * The one place that turns stored overrides into an effective configuration: the config surface and
 * the runner both call this, so what a page reports and what a run uses cannot drift apart (R5).
 */
export function resolveStoredConfig(input: {
  readonly roleId: string;
  readonly projectId?: string;
  readonly server: RuntimeDefaults;
  readonly store: OverrideSource;
  readonly roleOverrides?: Readonly<Record<string, ModelSelection>>;
}): EffectiveConfig {
  const roleOverride = input.store.getModelOverride('role', input.roleId);
  const projectOverride =
    input.projectId === undefined ? undefined : input.store.getModelOverride('project', input.projectId);
  const projectRoleOverride =
    input.projectId === undefined
      ? undefined
      : input.store.getModelOverride('project', input.projectId, input.roleId);
  return resolveEffectiveConfig({
    roleId: input.roleId,
    server: input.server,
    ...(projectRoleOverride !== undefined
      ? { projectRole: { providerId: projectRoleOverride.providerId, modelId: projectRoleOverride.modelId } }
      : {}),
    ...(projectRoleOverride !== undefined && isLevel(projectRoleOverride.thinkingLevel)
      ? { projectLevel: projectRoleOverride.thinkingLevel }
      : {}),
    ...(projectOverride !== undefined
      ? {
          project: {
            model: { providerId: projectOverride.providerId, modelId: projectOverride.modelId },
            ...(isLevel(projectOverride.thinkingLevel) ? { thinkingLevel: projectOverride.thinkingLevel } : {}),
          },
        }
      : {}),
    ...(roleOverride !== undefined && isLevel(roleOverride.thinkingLevel)
      ? { roleLevels: { [input.roleId]: roleOverride.thinkingLevel } }
      : {}),
    ...(roleOverride !== undefined || input.roleOverrides !== undefined
      ? {
          roleOverrides: {
            ...(input.roleOverrides ?? {}),
            ...(roleOverride !== undefined
              ? {
                  [input.roleId]: { providerId: roleOverride.providerId, modelId: roleOverride.modelId },
                }
              : {}),
          },
        }
      : {}),
  });
}

/** Stored levels are free text until they are known to be a level Pi understands. */
function isLevel(value: string | undefined): value is ThinkingLevel {
  return (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  );
}

/** Redacted view written to the store: no credentials, no prompts, and no server-default tool list
 * (the runner records the role/task-trimmed `requestedTools`/`activeTools` instead). */
export function redactEffectiveConfig(config: EffectiveConfig): {
  providerId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  source: EffectiveConfig['source'];
  agentDir: string;
  promptDir: string;
} {
  return {
    providerId: config.selection.providerId,
    modelId: config.selection.modelId,
    thinkingLevel: config.thinkingLevel,
    source: config.source,
    agentDir: config.agentDir,
    promptDir: config.promptDir,
  };
}