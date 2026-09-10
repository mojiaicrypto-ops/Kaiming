/**
 * `@agentdev/pi-runtime` — the only package that imports the Pi SDK.
 *
 * It exposes a narrow, SDK-type-free surface to the Runner: session lifecycle,
 * an explicit resource loader and the built-in extension registry.
 */
export { PiRuntimeError, type PiRuntimeErrorCode } from './errors.js';
export {
  BUILTIN_EXTENSIONS,
  CRITICAL_CAPABILITIES,
  EXTENSION_API_VERSION,
  activateExtensions,
  type ActivateExtensionsOptions,
  type BuiltinExtensionSpec,
  type CriticalCapability,
  type ExtensionActivation,
  type ExtensionActivationResult,
  type ExtensionRequest,
} from './extensions.js';
export {
  ExplicitResourceLoader,
  createExplicitResources,
  renderSkills,
  type AgentFileInput,
  type ExplicitResourceInput,
  type ExplicitResourceLoaderOptions,
  type ExplicitResources,
} from './resources.js';
export {
  PiSessionFactory,
  type CreatePiSessionOptions,
  type PiRuntimeConfig,
  type PiSessionHandle,
  type PiToolSpec,
} from './session.js';
export { type PiSessionEvent, type PiSessionListener } from './events.js';
