/**
 * Effective configuration resolution (P2): which model and tool set a logical session runs with.
 *
 * Order: role override → project default → server default. Resolution is a pure function so it can
 * be tested without Pi; availability (does a credential actually exist?) is checked separately by
 * the runtime factory, and an unavailable selection blocks the input instead of falling back.
 */

export interface ModelSelection {
  readonly providerId: string;
  readonly modelId: string;
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
}

export interface ResolveInput {
  readonly roleId: string;
  readonly server: RuntimeDefaults;
  readonly project?: ProjectOverrides;
  readonly roleOverrides?: Readonly<Record<string, ModelSelection>>;
}

export interface EffectiveConfig {
  readonly selection: ModelSelection;
  /** Where the selection came from — recorded so the user can tell why a model was used. */
  readonly source: 'role' | 'project' | 'server';
  readonly agentDir: string;
  /** Directory of the role prompt files used for this session. */
  readonly promptDir: string;
  readonly tools: readonly string[];
}

export function resolveEffectiveConfig(input: ResolveInput): EffectiveConfig {
  const roleOverride = input.roleOverrides?.[input.roleId];
  const selection = roleOverride ?? input.project?.model ?? input.server.model;
  const source: EffectiveConfig['source'] =
    roleOverride !== undefined ? 'role' : input.project?.model !== undefined ? 'project' : 'server';
  return {
    selection,
    source,
    agentDir: input.server.agentDir,
    promptDir: input.server.promptDir,
    tools: input.server.tools,
  };
}

/** Redacted view written to the store: no credentials, no prompts, and no server-default tool list
 * (the runner records the role/task-trimmed `requestedTools`/`activeTools` instead). */
export function redactEffectiveConfig(config: EffectiveConfig): {
  providerId: string;
  modelId: string;
  source: EffectiveConfig['source'];
  agentDir: string;
  promptDir: string;
} {
  return {
    providerId: config.selection.providerId,
    modelId: config.selection.modelId,
    source: config.source,
    agentDir: config.agentDir,
    promptDir: config.promptDir,
  };
}