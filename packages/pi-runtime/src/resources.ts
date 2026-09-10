/**
 * Explicit resource loading.
 *
 * `docs/architecture/execution.md` §7: "Factory显式提供内存Settings、
 * ResourceLoader、SessionManager、ModelRuntime/适配网关及自定义工具。禁用默认环境
 * 资源自动发现；角色工具完全由注册表构造。" and "Project可引用Skill Markdown，需信任
 * 且由Chief选择，Skill不能扩大工具权限。"
 *
 * `ExplicitResourceLoader` therefore never scans the filesystem on its own: it
 * holds exactly the skills, agent files and system prompt the caller passed in.
 * Anything not selected is simply absent — that absence is the guarantee the
 * isolation tests assert.
 */
import {
  createExtensionRuntime,
  formatSkillsForPrompt,
  loadSkills,
  type LoadExtensionsResult,
  type ResourceDiagnostic,
  type ResourceLoader,
  type Skill,
} from '@earendil-works/pi-coding-agent';
import { PiRuntimeError } from './errors.js';

export interface AgentFileInput {
  readonly path: string;
  readonly content: string;
}

export interface ExplicitResourceInput {
  /** Project root the resources were selected inside. */
  readonly cwd: string;
  /** Agent config directory; only used to resolve relative explicit paths. */
  readonly agentDir: string;
  /** Project trust state. Untrusted projects contribute no skills. */
  readonly trusted: boolean;
  /** Skill files or directories chosen by the Chief. */
  readonly skillPaths?: readonly string[];
  /** Project context files the Chief selected, with their frozen content. */
  readonly agentsFiles?: readonly AgentFileInput[];
  /** System prompt text for this run. */
  readonly systemPrompt?: string;
  /** Path the system prompt came from, when it is a real document. */
  readonly systemPromptSource?: string;
}

export interface ExplicitResources {
  readonly loader: ResourceLoader;
  readonly diagnostics: readonly ResourceDiagnostic[];
  readonly skills: readonly Skill[];
}

const UNTRUSTED_SKILLS: ResourceDiagnostic = {
  type: 'warning',
  message: 'skills were selected in an untrusted project and were not loaded',
};

/**
 * Builds a resource loader over an explicit selection.
 *
 * @throws PiRuntimeError `UNTRUSTED_RESOURCE` when content is passed for an
 * untrusted project — trust must be granted before content is read at all.
 */
export function createExplicitResources(input: ExplicitResourceInput): ExplicitResources {
  if (!input.trusted && (input.agentsFiles?.length ?? 0) > 0) {
    throw new PiRuntimeError(
      'UNTRUSTED_RESOURCE',
      'project files were provided for an untrusted project',
      { cwd: input.cwd },
    );
  }

  const skillPaths = [...(input.skillPaths ?? [])];
  const diagnostics: ResourceDiagnostic[] = [];
  let skills: Skill[] = [];

  if (!input.trusted) {
    if (skillPaths.length > 0) diagnostics.push(UNTRUSTED_SKILLS);
  } else if (skillPaths.length > 0) {
    const loaded = loadSkills({
      cwd: input.cwd,
      agentDir: input.agentDir,
      skillPaths,
      includeDefaults: false,
    });
    skills = loaded.skills;
    diagnostics.push(...loaded.diagnostics);
  }

  const loader = new ExplicitResourceLoader({
    skills,
    diagnostics,
    agentsFiles: [...(input.agentsFiles ?? [])],
    ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
    ...(input.systemPromptSource === undefined
      ? {}
      : { systemPromptSource: input.systemPromptSource }),
  });

  return { loader, diagnostics, skills };
}

/** Options accepted by {@link ExplicitResourceLoader}. */
export interface ExplicitResourceLoaderOptions {
  readonly skills?: readonly Skill[];
  readonly diagnostics?: readonly ResourceDiagnostic[];
  readonly agentsFiles?: readonly AgentFileInput[];
  readonly systemPrompt?: string;
  readonly systemPromptSource?: string;
}

/**
 * A `ResourceLoader` whose contents are fixed at construction time.
 *
 * The Pi runtime is free to call `reload()`; it re-reads the same selection and
 * never widens it. `extendResources()` records what an extension asked for and
 * loads nothing, because resource scope is a Chief decision.
 */
export class ExplicitResourceLoader implements ResourceLoader {
  private readonly extensionsResult: LoadExtensionsResult;
  private skills: Skill[];
  private diagnostics: ResourceDiagnostic[];
  private readonly agentsFiles: AgentFileInput[];
  private readonly systemPromptText: string | undefined;
  private readonly systemPromptPath: string | undefined;
  private readonly extensionRequests: Array<{ kind: string; path: string }> = [];

  constructor(options: ExplicitResourceLoaderOptions = {}) {
    this.skills = [...(options.skills ?? [])];
    this.diagnostics = [...(options.diagnostics ?? [])];
    this.agentsFiles = [...(options.agentsFiles ?? [])];
    this.systemPromptText = options.systemPrompt;
    this.systemPromptPath = options.systemPromptSource;
    this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  }

  getExtensions(): LoadExtensionsResult {
    return this.extensionsResult;
  }

  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
    return { skills: [...this.skills], diagnostics: [...this.diagnostics] };
  }

  getPrompts(): { prompts: never[]; diagnostics: ResourceDiagnostic[] } {
    return { prompts: [], diagnostics: [] };
  }

  getThemes(): { themes: never[]; diagnostics: ResourceDiagnostic[] } {
    return { themes: [], diagnostics: [] };
  }

  getAgentsFiles(): { agentsFiles: AgentFileInput[] } {
    return { agentsFiles: [...this.agentsFiles] };
  }

  getSystemPrompt(): string | undefined {
    return this.systemPromptText;
  }

  getSystemPromptSource(): { path: string } | undefined {
    return this.systemPromptPath === undefined ? undefined : { path: this.systemPromptPath };
  }

  getAppendSystemPrompt(): string[] {
    return [];
  }

  getAppendSystemPromptSources(): Array<{ path: string }> {
    return [];
  }

  /** Records a requested extension of the resource set without loading it. */
  extendResources(paths: {
    skillPaths?: Array<{ path: string; metadata: unknown }>;
    promptPaths?: Array<{ path: string; metadata: unknown }>;
    themePaths?: Array<{ path: string; metadata: unknown }>;
  }): void {
    for (const [kind, entries] of Object.entries(paths)) {
      for (const entry of entries ?? []) {
        this.extensionRequests.push({ kind, path: entry.path });
      }
    }
    if (this.extensionRequests.length > 0) {
      this.diagnostics = [
        ...this.diagnostics,
        {
          type: 'warning',
          message: 'resource extension requests are ignored: resource scope is fixed by the Chief',
        },
      ];
    }
  }

  /** Re-reads the same explicit selection; never discovers anything new. */
  reload(): Promise<void> {
    return Promise.resolve();
  }

  skillNames(): string[] {
    return this.skills.map((skill) => skill.name);
  }
}

/**
 * Renders the selected skills for a system prompt.
 *
 * `disable-model-invocation` skills are excluded by the SDK formatter, so a
 * skill cannot widen the model-facing surface by itself.
 */
export function renderSkills(skills: readonly Skill[]): string {
  return formatSkillsForPrompt([...skills]);
}
