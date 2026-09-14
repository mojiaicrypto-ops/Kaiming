/**
 * The environment one Attempt really executed in (`protocol.md:123` `runner.ready`).
 *
 * `attempt.ready` reports this so a delivery's `VerificationManifest.environmentRef` names
 * the environment the verification ran in instead of a placeholder. The value is the
 * Runner's **own process observation**: nothing a model, a caller or a config file says can
 * change it.
 *
 * ## Why the shape is `host:…` / `container:…`
 *
 * - `host:<platform>/<arch>/node-<major>` — the Attempt ran as a host process. Every part
 *   comes from `process`, so two Runs on the same host report the same string and a
 *   different host or Node major is visible.
 * - `container:<image>` — the Attempt ran inside a container. The image is the reference the
 *   launcher exported (`AGENTDEV_EXEC_IMAGE`), i.e. the image that really started this
 *   process. A container that does not declare it reports `container:undeclared`: naming a
 *   guessed tag would put a fabricated value into a verification manifest, which is worse
 *   than reporting that the environment cannot be named.
 */
import { existsSync } from 'node:fs';

/** The image reference a launcher exports when it runs the Runner inside the image. */
export const EXEC_IMAGE_ENV = 'AGENTDEV_EXEC_IMAGE';

/** Files a container runtime drops into the filesystem of the container it started. */
const CONTAINER_MARKERS = ['/.dockerenv', '/run/.containerenv'];

/** Whether this process runs inside a container (Docker/containerd or Podman). */
export function inContainer(markers: readonly string[] = CONTAINER_MARKERS): boolean {
  return markers.some((marker) => existsSync(marker));
}

/** The Node major version, e.g. `24` — not the full semver, which changes per patch. */
export function nodeMajor(version: string = process.versions.node): string {
  return version.split('.')[0] ?? version;
}

/** The image this container was started from, or `undeclared` when nothing says so. */
export function containerImageRef(
  env: NodeJS.ProcessEnv = process.env,
  container: boolean = inContainer(),
): string | null {
  if (!container) return null;
  const declared = env[EXEC_IMAGE_ENV];
  return typeof declared === 'string' && declared.trim().length > 0
    ? declared.trim()
    : 'undeclared';
}

/** The `environmentRef` one Attempt reports in `attempt.ready`. */
export function environmentRef(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly container?: boolean;
    readonly platform?: string;
    readonly arch?: string;
    readonly nodeVersion?: string;
  } = {},
): string {
  const image = containerImageRef(options.env ?? process.env, options.container ?? inContainer());
  if (image !== null) return `container:${image}`;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return `host:${platform}/${arch}/node-${nodeMajor(options.nodeVersion)}`;
}
