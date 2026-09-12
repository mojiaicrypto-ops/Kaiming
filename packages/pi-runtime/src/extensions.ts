/**
 * Built-in extension registry.
 *
 * `docs/architecture/execution.md` §7 fixes the rules:
 * "Core Critical能力：policy/context/artifact/events/dispatch；初始化失败停止Run。
 *  可选内置Extension为发布包白名单清单，字段id/version/apiVersion/capabilities/
 *  enabled/critical；P0内置可选清单默认为空，配置未知ID拒绝。支持的内置扩展必须有
 *  契约测试，失败只禁用自身。"
 *
 * The registry never loads third-party code. It resolves a requested set of ids
 * against the shipped whitelist, activates each entry, and reports exactly what
 * happened so the Runner can decide whether the Attempt may start.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ErrorCode, TrustState } from '@agentdev/contracts';
import { PiRuntimeError } from './errors.js';

/** Capabilities the Core cannot run without. */
export const CRITICAL_CAPABILITIES = [
  'policy',
  'context',
  'artifact',
  'events',
  'dispatch',
] as const;
export type CriticalCapability = (typeof CRITICAL_CAPABILITIES)[number];

/** Extension API version this deployment implements. */
export const EXTENSION_API_VERSION = 1;

/** One entry of the built-in extension whitelist. */
export interface BuiltinExtensionSpec {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly capabilities: readonly string[];
  readonly critical: boolean;
  readonly enabledByDefault: boolean;
}

/**
 * The shipped optional-extension list. `execution.md` §7 fixes it at empty for
 * this release, so an enabled id can only be a configuration error.
 */
export const BUILTIN_EXTENSIONS: readonly BuiltinExtensionSpec[] = [];

/** What a caller wants enabled for one Attempt. */
export interface ExtensionRequest {
  readonly id: string;
  readonly enabled: boolean;
}

export interface ExtensionActivation {
  readonly id: string;
  readonly critical: boolean;
  readonly active: boolean;
  readonly reason?: string;
}

export interface ExtensionActivationResult {
  /** Ids that activated successfully. */
  readonly active: readonly string[];
  /** Ids that failed and were disabled; critical ones also block startup. */
  readonly disabled: readonly ExtensionActivation[];
  /** `true` when a critical entry failed — the Run must not start. */
  readonly startupBlocked: boolean;
  /** Critical capability names with no active provider. */
  readonly missingCapabilities: readonly string[];
}

export interface ActivateExtensionsOptions {
  readonly manifest?: readonly BuiltinExtensionSpec[];
  readonly requested?: readonly ExtensionRequest[];
  /** Performs the entry's own setup; a throw disables that entry. */
  readonly activate?: (spec: BuiltinExtensionSpec) => void | Promise<void>;
  /** Capabilities the Core reports as provided outside extensions. */
  readonly providedCapabilities?: readonly string[];
}

/**
 * Resolves and activates the requested extensions.
 *
 * @throws PiRuntimeError `UNKNOWN_EXTENSION` when configuration names an id the
 * release does not ship — "配置未知ID拒绝".
 */
export async function activateExtensions(
  options: ActivateExtensionsOptions = {},
): Promise<ExtensionActivationResult> {
  const manifest = options.manifest ?? BUILTIN_EXTENSIONS;
  const byId = new Map(manifest.map((spec) => [spec.id, spec]));

  const unknown = (options.requested ?? [])
    .map((request) => request.id)
    .filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new PiRuntimeError(
      'UNKNOWN_EXTENSION',
      `unknown extension id(s): ${unknown.join(', ')}`,
      {
        unknown,
      },
    );
  }

  const disabled: ExtensionActivation[] = [];
  const active: string[] = [];

  for (const spec of manifest) {
    const request = (options.requested ?? []).find((entry) => entry.id === spec.id);
    const enabled = request?.enabled ?? spec.enabledByDefault;
    if (!enabled) {
      disabled.push({ id: spec.id, critical: spec.critical, active: false, reason: 'disabled' });
      continue;
    }
    if (spec.apiVersion !== EXTENSION_API_VERSION) {
      // An unsupported apiVersion is a failure of that entry alone.
      disabled.push({
        id: spec.id,
        critical: spec.critical,
        active: false,
        reason: `unsupported apiVersion ${spec.apiVersion}`,
      });
      continue;
    }
    try {
      await options.activate?.(spec);
      active.push(spec.id);
    } catch (error) {
      disabled.push({
        id: spec.id,
        critical: spec.critical,
        active: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const startupBlocked = disabled.some((entry) => entry.critical);
  const provided = new Set<string>([
    ...(options.providedCapabilities ?? []),
    ...manifest.filter((spec) => active.includes(spec.id)).flatMap((spec) => spec.capabilities),
  ]);
  const missingCapabilities = CRITICAL_CAPABILITIES.filter(
    (capability) => !provided.has(capability),
  );

  return { active, disabled, startupBlocked, missingCapabilities };
}

/* -------------------------------------------------------------------------- */
/* Trust and skill loading boundary (AC-053)                                   */
/* -------------------------------------------------------------------------- */

/**
 * `docs/architecture/execution.md` §7 fixes the boundary: "禁用默认环境资源自动发现；
 * 角色工具完全由注册表构造" and "Project可引用Skill Markdown，需信任且由Chief选择".
 * `docs/delivery/acceptance.md` AC-053 states the observable behaviour: a repository
 * with auto-loaded extensions is not executed before trust, and after trust only the
 * selected skills and built-in resources are usable, with the loader trace as evidence.
 *
 * {@link loadTrustedExtensions} is the only place where a session decides what may be
 * read or executed. It never discovers anything on its own: the caller passes the
 * repository config paths and extension candidates it observed read-only, plus the
 * Chief's explicit selection. The boundary either refuses them (with a protocol error
 * code) or resolves them against the release whitelist, and appends every decision to
 * an ordered trace so a refusal is auditable instead of silent.
 */

/** A repository extension a config file pointed at, observed read-only by the caller. */
export interface RepositoryExtensionCandidate {
  readonly id: string;
  /** Repository-relative path of the module the config would import. */
  readonly modulePath: string;
  /** Repository-relative path of the config that named it, when known. */
  readonly configPath?: string;
}

/** What the boundary did with one candidate. */
export type LoaderDecision = 'loaded' | 'skipped' | 'refused';

/** Where a candidate came from: the release package or the project tree. */
export type ResourceOrigin = 'builtin' | 'repository';

/** One audited decision. AC-053's evidence is this ordered list. */
export interface LoaderTraceEntry {
  /** 1-based position in the trace. */
  readonly seq: number;
  readonly kind: 'extension' | 'skill' | 'config';
  readonly id: string;
  readonly origin: ResourceOrigin;
  readonly decision: LoaderDecision;
  /** Absolute path the decision is about, when one is involved. */
  readonly path: string | undefined;
  /** Protocol error code for a refusal, from `@agentdev/contracts`. */
  readonly code: ErrorCode | undefined;
  /** Precise, auditable reason for the decision. */
  readonly reason: string;
}

/** A resource that became usable for this session. */
export interface LoadedExtension {
  readonly id: string;
  readonly origin: ResourceOrigin;
  readonly path: string | undefined;
  readonly capabilities: readonly string[];
  readonly critical: boolean;
}

export interface LoadedSkill {
  readonly path: string;
  readonly name: string;
}

export interface TrustedExtensionLoadResult {
  readonly trust: TrustState;
  /**
   * `true` for an untrusted project: this path must not read or execute anything
   * from the repository, and the result contains only refusals and skips.
   */
  readonly readOnly: boolean;
  readonly loadedExtensions: readonly LoadedExtension[];
  readonly loadedSkills: readonly LoadedSkill[];
  /** Every decision, in order. */
  readonly trace: readonly LoaderTraceEntry[];
  readonly skipped: readonly LoaderTraceEntry[];
  readonly refused: readonly LoaderTraceEntry[];
  /** `true` when a critical entry failed; the Run must not start. */
  readonly startupBlocked: boolean;
  /** Critical capability names with no active provider. */
  readonly missingCapabilities: readonly string[];
}

export interface TrustedExtensionLoadOptions {
  /** Repository root the candidate paths are relative to. */
  readonly projectRoot: string;
  readonly trust: TrustState;
  /** Auto-load candidates observed in repository configuration. */
  readonly repositoryExtensions?: readonly RepositoryExtensionCandidate[];
  /** Repository config files that named candidates; recorded, never honoured. */
  readonly repositoryConfigPaths?: readonly string[];
  /** Extension ids the Chief explicitly selected. */
  readonly selectedExtensionIds?: readonly string[];
  /** Skill files or directories the Chief explicitly selected. */
  readonly selectedSkillPaths?: readonly string[];
  /** Release whitelist; defaults to the shipped {@link BUILTIN_EXTENSIONS}. */
  readonly manifest?: readonly BuiltinExtensionSpec[];
  /** Agent config directory; a second root selected skills may live under. */
  readonly agentDir?: string;
  /** Capabilities the Core reports as provided outside extensions. */
  readonly providedCapabilities?: readonly string[];
  /** Built-in activation hook, passed through to {@link activateExtensions}. */
  readonly activate?: (spec: BuiltinExtensionSpec) => void | Promise<void>;
  /** Import seam; a real dynamic import by default. */
  readonly importModule?: (absolutePath: string) => Promise<unknown>;
  /** Skill reader seam; a real file read by default. */
  readonly readSkillFile?: (absolutePath: string) => Promise<string>;
}

interface CanonicalPath {
  readonly path: string | undefined;
  readonly error: string | undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `true` when `target` is `root` or lives below it, without a `..` escape. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Resolves links and reports failure as a value instead of throwing. */
async function canonicalize(path: string): Promise<CanonicalPath> {
  try {
    return { path: await realpath(path), error: undefined };
  } catch (error) {
    return { path: undefined, error: `unresolvable path (${describeError(error)})` };
  }
}

/** The default import seam: a real dynamic import of the resolved module file. */
async function defaultImportModule(absolutePath: string): Promise<unknown> {
  const loaded: unknown = await import(pathToFileURL(absolutePath).href);
  return loaded;
}

/** The default skill reader seam: a real UTF-8 file read. */
function defaultReadSkillFile(absolutePath: string): Promise<string> {
  return readFile(absolutePath, 'utf8');
}

/** Front-matter `name:` when present, otherwise a deterministic path-derived name. */
function skillName(path: string, content: string): string {
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
  if (frontMatter !== undefined) {
    const declared = /^name:\s*(.+)$/m.exec(frontMatter)?.[1]?.trim();
    if (declared !== undefined && declared !== '') return declared;
  }
  if (basename(path) === 'SKILL.md') return basename(dirname(path));
  return basename(path, extname(path));
}

/** The unique refusals/skips derived from the ordered trace. */
function ofDecision(
  trace: readonly LoaderTraceEntry[],
  decision: LoaderDecision,
): LoaderTraceEntry[] {
  return trace.filter((entry) => entry.decision === decision);
}

/**
 * Resolves the session's loadable surface under the project trust state.
 *
 * Untrusted projects are read-only on this path: no repository module is imported,
 * no skill document is read, and no repository config is honoured — every candidate
 * is skipped with `NOT_AUTHORIZED` and an exact reason. Trusted projects may load the
 * release whitelist and the explicitly selected skills; a repository extension that
 * is not both selected and whitelisted is refused (`NOT_AUTHORIZED` / `VALIDATION_ERROR`),
 * and a path escaping the project root (including through a symlink) is rejected.
 *
 * @throws PiRuntimeError `CONTRACT_VIOLATION` when `projectRoot` is empty — a caller
 * error, not a project decision, so it never reaches the trace.
 */
export async function loadTrustedExtensions(
  options: TrustedExtensionLoadOptions,
): Promise<TrustedExtensionLoadResult> {
  if (options.projectRoot.trim() === '') {
    throw new PiRuntimeError(
      'CONTRACT_VIOLATION',
      'projectRoot is required to evaluate the trust boundary',
    );
  }

  const projectRoot = resolve(options.projectRoot);
  const trust = options.trust;
  const readOnly = trust === 'untrusted';
  const manifest = options.manifest ?? BUILTIN_EXTENSIONS;
  const manifestIds = new Set(manifest.map((spec) => spec.id));
  const selectedIds = new Set(options.selectedExtensionIds ?? []);
  const selectedSkills = [...(options.selectedSkillPaths ?? [])];

  const trace: LoaderTraceEntry[] = [];
  const record = (entry: Omit<LoaderTraceEntry, 'seq'>): void => {
    trace.push({ seq: trace.length + 1, ...entry });
  };
  const loadedExtensions: LoadedExtension[] = [];
  const loadedSkills: LoadedSkill[] = [];
  let startupBlocked = false;

  for (const configPath of options.repositoryConfigPaths ?? []) {
    record({
      kind: 'config',
      id: configPath,
      origin: 'repository',
      decision: 'skipped',
      path: configPath,
      code: readOnly ? 'NOT_AUTHORIZED' : undefined,
      reason: readOnly
        ? 'untrusted-project: repository configuration is not read before the user marks the project trusted'
        : 'configuration is not authoritative: extension discovery is explicit, never config-driven',
    });
  }

  // An untrusted project is never resolved on disk; only trusted paths are.
  const rootCanonical = readOnly ? projectRoot : await canonicalRoot(projectRoot);
  const repositoryCapabilities: string[] = [];
  for (const candidate of options.repositoryExtensions ?? []) {
    const spec = manifest.find((entry) => entry.id === candidate.id);
    const decide = (
      decision: LoaderDecision,
      code: ErrorCode | undefined,
      reason: string,
      path: string | undefined,
    ): void => {
      // A critical entry that did not load stops the Run, exactly as a failed
      // critical built-in does above.
      if (decision !== 'loaded' && spec?.critical === true) startupBlocked = true;
      record({
        kind: 'extension',
        id: candidate.id,
        origin: 'repository',
        decision,
        path,
        code,
        reason,
      });
    };
    if (readOnly) {
      decide(
        'skipped',
        'NOT_AUTHORIZED',
        'untrusted-project: repository extensions are never imported before the user marks the project trusted',
        candidate.modulePath,
      );
      continue;
    }
    if (!selectedIds.has(candidate.id)) {
      decide(
        'refused',
        'NOT_AUTHORIZED',
        'not-selected: the extension id is outside the explicitly selected set',
        candidate.modulePath,
      );
      continue;
    }
    if (!manifestIds.has(candidate.id)) {
      decide(
        'refused',
        'VALIDATION_ERROR',
        'not-in-builtin-whitelist: this release does not ship the extension id',
        candidate.modulePath,
      );
      continue;
    }
    const absolute = resolve(projectRoot, candidate.modulePath);
    if (!isInside(projectRoot, absolute)) {
      decide(
        'refused',
        'VALIDATION_ERROR',
        'path-escape: the extension module resolves outside the project root',
        absolute,
      );
      continue;
    }
    const canonical = await canonicalize(absolute);
    const modulePath = canonical.path;
    if (modulePath === undefined || !isInside(rootCanonical, modulePath)) {
      decide(
        'refused',
        'VALIDATION_ERROR',
        `path-escape or unreadable module: ${canonical.error ?? 'the module resolves outside the project root'}`,
        absolute,
      );
      continue;
    }
    const importer = options.importModule ?? defaultImportModule;
    try {
      await importer(modulePath);
    } catch (error) {
      decide(
        'refused',
        'VALIDATION_ERROR',
        `extension-import-failed: ${describeError(error)}`,
        modulePath,
      );
      continue;
    }
    repositoryCapabilities.push(...(spec?.capabilities ?? []));
    loadedExtensions.push({
      id: candidate.id,
      origin: 'repository',
      path: modulePath,
      capabilities: [...(spec?.capabilities ?? [])],
      critical: spec?.critical ?? false,
    });
    decide(
      'loaded',
      undefined,
      'trusted-project: explicitly selected and shipped by the release whitelist',
      modulePath,
    );
  }

  const skillRoots = [
    projectRoot,
    ...(options.agentDir === undefined ? [] : [resolve(options.agentDir)]),
  ];
  const canonicalSkillRoots = readOnly
    ? skillRoots
    : await Promise.all(skillRoots.map((root) => canonicalRoot(root)));
  for (const skillPath of selectedSkills) {
    if (readOnly) {
      record({
        kind: 'skill',
        id: skillPath,
        origin: 'repository',
        decision: 'skipped',
        path: skillPath,
        code: 'NOT_AUTHORIZED',
        reason:
          'untrusted-project: selected skills are not read before the user marks the project trusted',
      });
      continue;
    }
    const absolute = resolve(projectRoot, skillPath);
    if (!skillRoots.some((root) => isInside(root, absolute))) {
      record({
        kind: 'skill',
        id: skillPath,
        origin: 'repository',
        decision: 'refused',
        path: absolute,
        code: 'VALIDATION_ERROR',
        reason: 'path-escape: the selected skill resolves outside the project and agent roots',
      });
      continue;
    }
    const canonical = await canonicalize(absolute);
    const skillFile = canonical.path;
    if (skillFile === undefined || !canonicalSkillRoots.some((root) => isInside(root, skillFile))) {
      record({
        kind: 'skill',
        id: skillPath,
        origin: 'repository',
        decision: 'refused',
        path: absolute,
        code: 'VALIDATION_ERROR',
        reason: `skill-unreadable: ${canonical.error ?? 'the skill resolves outside the allowed roots'}`,
      });
      continue;
    }
    const document = await resolveSkillDocument(skillFile, canonicalSkillRoots);
    if (!document.ok) {
      record({
        kind: 'skill',
        id: skillPath,
        origin: 'repository',
        decision: 'refused',
        path: skillFile,
        code: 'VALIDATION_ERROR',
        reason: `skill-unreadable: ${document.reason}`,
      });
      continue;
    }
    const reader = options.readSkillFile ?? defaultReadSkillFile;
    try {
      const content = await reader(document.path);
      loadedSkills.push({ path: document.path, name: skillName(document.path, content) });
      record({
        kind: 'skill',
        id: skillPath,
        origin: 'repository',
        decision: 'loaded',
        path: document.path,
        code: undefined,
        reason: 'trusted-project: skill was explicitly selected',
      });
    } catch (error) {
      record({
        kind: 'skill',
        id: skillPath,
        origin: 'repository',
        decision: 'refused',
        path: document.path,
        code: 'VALIDATION_ERROR',
        reason: `skill-unreadable: ${describeError(error)}`,
      });
    }
  }

  // A whitelisted id backed by a repository module is decided by the trust gate
  // above; it is never additionally auto-activated as an in-process built-in.
  const repositoryIds = new Set(
    (options.repositoryExtensions ?? []).map((candidate) => candidate.id),
  );
  const builtinManifest = manifest.filter((spec) => !repositoryIds.has(spec.id));
  const activation = await activateExtensions({
    manifest: builtinManifest,
    ...(selectedIds.size === 0
      ? {}
      : {
          requested: builtinManifest
            .filter((spec) => selectedIds.has(spec.id))
            .map((spec) => ({ id: spec.id, enabled: true })),
        }),
    ...(options.activate === undefined ? {} : { activate: options.activate }),
    providedCapabilities: [...(options.providedCapabilities ?? []), ...repositoryCapabilities],
  });
  if (activation.startupBlocked) startupBlocked = true;

  for (const spec of builtinManifest) {
    if (activation.active.includes(spec.id)) {
      loadedExtensions.push({
        id: spec.id,
        origin: 'builtin',
        path: undefined,
        capabilities: [...spec.capabilities],
        critical: spec.critical,
      });
      record({
        kind: 'extension',
        id: spec.id,
        origin: 'builtin',
        decision: 'loaded',
        path: undefined,
        code: undefined,
        reason: 'built-in whitelist extension activated',
      });
      continue;
    }
    const disabled = activation.disabled.find((entry) => entry.id === spec.id);
    const reason = disabled?.reason ?? 'disabled';
    // "Not selected / disabled by default" is a non-error decision: it is recorded
    // as `skipped` with no code, matching the repository-extension
    // `NOT_AUTHORIZED(not-selected)` semantics instead of mislabelling it
    // `refused`/`INTERNAL_ERROR` (W7R1-12). An unsupported apiVersion is a
    // validation failure of that entry, and any other activation failure is the
    // refused/internal case.
    const unsupportedApi = reason.startsWith('unsupported apiVersion');
    const notSelected = disabled === undefined || reason === 'disabled';
    const decision: LoaderDecision = notSelected ? 'skipped' : 'refused';
    record({
      kind: 'extension',
      id: spec.id,
      origin: 'builtin',
      decision,
      path: undefined,
      code: notSelected ? undefined : unsupportedApi ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
      reason: notSelected ? `not-selected: ${reason}` : reason,
    });
  }

  return {
    trust,
    readOnly,
    loadedExtensions,
    loadedSkills,
    trace: [...trace],
    skipped: ofDecision(trace, 'skipped'),
    refused: ofDecision(trace, 'refused'),
    startupBlocked,
    missingCapabilities: [...activation.missingCapabilities],
  };
}

/** Canonical project root, falling back to the given path when it cannot be resolved. */
async function canonicalRoot(root: string): Promise<string> {
  const canonical = await canonicalize(root);
  return canonical.path ?? root;
}

/**
 * Resolves a selected skill path to its Markdown document, following `SKILL.md`.
 *
 * The document is resolved through the *same* canonicalisation and containment
 * check as a module, including when the selection names a directory (W7R1-03): a
 * `SKILL.md` that is a symlink pointing outside the project/agent roots must be
 * refused **before** it is read, not read and recorded as loaded. The returned
 * path is therefore always the canonical target inside an allowed root, and the
 * refusal reason says which check failed.
 */
async function resolveSkillDocument(
  path: string,
  allowedRoots: readonly string[],
): Promise<
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string }
> {
  let selected: string;
  try {
    const info = await stat(path);
    selected = info.isDirectory() ? join(path, 'SKILL.md') : path;
  } catch {
    // An unreadable selection is reported by the caller as `skill-unreadable`.
    return { ok: false, reason: 'no readable SKILL.md document at the selected path' };
  }
  const canonical = await canonicalize(selected);
  if (canonical.path === undefined) {
    return { ok: false, reason: canonical.error ?? 'the skill document is unresolvable' };
  }
  // The containment re-check is the W7R1-03 fix: the *document* (not only the
  // selected entry) has to resolve inside an allowed root.
  if (!allowedRoots.some((root) => isInside(root, canonical.path ?? ''))) {
    return { ok: false, reason: 'the skill document resolves outside the allowed roots' };
  }
  return { ok: true, path: canonical.path };
}
