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
