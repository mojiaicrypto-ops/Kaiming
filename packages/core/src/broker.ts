/**
 * The tool Broker: admission, execution modes, file and network boundaries.
 *
 * `docs/architecture/execution.md` §1–4 and `reliability.md` §2 fix the rules
 * this module implements, and `docs/delivery/acceptance.md` fixes the observable
 * promise: AC-048 ("缺环境拒绝；容器及Broker阻止越权，源码只读者不可写") and
 * AC-050 ("宿主开发执行…领域Gate保留，Review/Test仍隔离").
 *
 * The Broker is the single gate every tool call passes through, and it never
 * trusts the caller for any of it:
 *
 * 1. **Admission is a Grant.** `invoke` delegates the decision to
 *    `core/grants.ts` (`consumeOnce`), which evaluates the persisted Grant with
 *    `domain/evaluateGrant`: role, stage, operation, target, expiry and — for a
 *    `once` Grant — the exact tool operation and input hash. A mismatch refuses
 *    with the documented code (`NOT_AUTHORIZED`, `AUTH_EXPIRED`,
 *    `IDEMPOTENCY_CONFLICT`) and executes nothing. An admitted call gets a
 *    `tool_operation` row carrying the operation, the input hash and the Grant
 *    reference, plus a `tool.invoked` audit event; a refusal is recorded as a
 *    `tool.refused` event *before* anything runs.
 * 2. **Execution mode is explicit.** `container` runs the WP-00 image with the
 *    documented hardening (`--read-only`, `--cap-drop=ALL`,
 *    `--security-opt no-new-privileges`, non-root uid, pid/memory limits,
 *    writable tmpfs only, `--network none` unless the Grant explicitly covers
 *    network). When Docker is unavailable the container mode is **refused with a
 *    precise reason** — there is deliberately no host fallback, because falling
 *    back would silently change the isolation the caller asked for. `host` keeps
 *    exactly the same domain gates: the file boundary, the role write gate and
 *    the network policy are evaluated before either mode runs. A read-only role's
 *    caller-supplied `writableRoots` are stripped in container mode, so only its
 *    report/scratch root can ever be mounted `rw` (W7R2-01).
 * 3. **The write gate is a capability, not a name.** {@link toolCapability}
 *    classifies a tool by what it does: `read`/`search`/`network`/`secret` read,
 *    everything else may mutate, and `bash`/`git` run an arbitrary command that no
 *    root can confine. Review/Test therefore get no mutating tool at all, and
 *    specifically no arbitrary-command tool, in **both** modes (W7R2-01) — an
 *    operation-name list that happened to omit `bash`/`git` used to let them write
 *    source through a shell.
 * 4. **File boundary is a real path, not a string.** `resolveWithinRoots`
 *    resolves symlinks (including a symlinked parent of a not-yet-existing
 *    file), refuses `..` and absolute escapes, and refuses a path inside a
 *    protected root. The Broker checks it before admission and re-checks it
 *    inside `readFile`/`writeFile`, so `open` cannot be tricked by a race. The
 *    protected roots are **derived from the store** (project state directory,
 *    run database, blobs, backups) rather than trusted from the caller, so a
 *    Grant cannot authorize reading the run database (W7R1-04). A hard link
 *    inside the root is a documented limit of any path-containment rule
 *    (W7R1-08).
 * 5. **Network boundary is per hop and per resolution.** `NetworkPolicy` refuses
 *    loopback, private, link-local and metadata addresses by default; a user may
 *    authorize an exact target (`host` or `host:port`) and only then does it pass.
 *    Every hostname is resolved through an injectable {@link HostResolver} before
 *    the decision, and **any** answer in loopback/private/link-local/CGNAT/
 *    metadata space refuses the request (W7R1-01), including the hexadecimal
 *    IPv4-mapped IPv6 spellings the URL parser produces (W7R1-02) and the RFC 8215
 *    local-use NAT64 prefixes (W7R2-06). A resolver that throws is a refusal, not
 *    an escaped exception (W7R2-05). Plain `http:` is refused unless the caller
 *    explicitly opted in for an authorized local test endpoint (W7R1-07).
 *    Admission **awaits** this decision (W7R2-02), so a target whose name resolves
 *    privately leaves the Grant unconsumed and writes no `tool_operation` row.
 *    `GuardedRequester` performs a request with `redirect: 'manual'` and
 *    re-validates every hop through the same async decision, handing the validated
 *    answers to the transport as `pinnedAddresses`; the built-in transport then
 *    connects with a `lookup` that can only return those answers, so a rebinding
 *    between the guard and the connection cannot reach a private address
 *    (W7R2-03). A caller that injects its own `fetcher` is handed the same pin and
 *    is responsible for honouring it.
 *
 * Everything here is deliberately explicit: refusals are typed results, never
 * silently swallowed exceptions, and no secret value is ever read from or written
 * into an audit row. Secret resolution is `core/secrets.ts` (AC-051) and is not
 * re-implemented here.
 */
import { spawnSync } from 'node:child_process';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIPv4, isIPv6 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  LIMITS,
  type ConfigPolicy,
  type ErrorCode,
  type Grant,
  type JsonObject,
  type Role,
  type ToolOperation,
} from '@agentdev/contracts';
import { sha256, uuidv7, type ProjectStore } from '@agentdev/storage';
import { canonicalJson } from './dispatcher.js';
import {
  EGRESS_COMMAND_ENV,
  egressToolEnv,
  egressWrapperCommand,
  type ContainerEgressChannel,
} from './egress-channel.js';
import { ProtocolError } from './errors.js';
import type { GrantStore } from './grants.js';
import {
  defaultAsyncProcessRunner,
  type AsyncProcessHandle,
  type AsyncProcessResult,
  type AsyncProcessRunner,
} from './process-async.js';
import { ToolProcessRegistry } from './tool-processes.js';

/** The two execution modes the product supports (`execution.md` §1). */
export type ExecutionMode = 'container' | 'host';

/**
 * Codes a Broker call can be refused with.
 *
 * This is the contracts vocabulary, not a private one: the refusal a caller
 * receives is the code `protocol.md` §7 documents.
 */
export type BrokerErrorCode = Extract<
  ErrorCode,
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE'
  | 'NOT_AUTHORIZED'
  | 'AUTH_EXPIRED'
  | 'NOT_FOUND'
  | 'MISSING_CONTEXT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RECOVERY_REQUIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'INTERNAL_ERROR'
>;

/** Events the Broker appends; one per admission and one per refusal. */
export const TOOL_EVENTS = {
  invoked: 'tool.invoked',
  refused: 'tool.refused',
} as const;

/** Every code a Broker call may report; a code outside it becomes `INTERNAL_ERROR`. */
const BROKER_ERROR_CODES: readonly string[] = [
  'VALIDATION_ERROR',
  'INVALID_STATE',
  'NOT_AUTHORIZED',
  'AUTH_EXPIRED',
  'NOT_FOUND',
  'MISSING_CONTEXT',
  'IDEMPOTENCY_CONFLICT',
  'RECOVERY_REQUIRED',
  'PROVIDER_UNAVAILABLE',
  'BUDGET_EXCEEDED',
  'INTERNAL_ERROR',
];

/** Narrows an arbitrary contracts error code onto the Broker's subset. */
export function asBrokerErrorCode(code: ErrorCode): BrokerErrorCode {
  return BROKER_ERROR_CODES.includes(code) ? (code as BrokerErrorCode) : 'INTERNAL_ERROR';
}

/**
 * The deadline a tool call gets when it names none.
 *
 * `ARCHITECTURE.md` §5 / `LIMITS.shellTimeoutSec` fix 120s as the default and 1800s as
 * the ceiling a Grant may authorize; the Broker derives an operator call's deadline
 * from this constant so a Grant's `maxDurationSec` is checked against the **effective**
 * deadline rather than an absent one.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = LIMITS.shellTimeoutSec.default * 1000;

/** The digest the tool operation and a `once` Grant are bound to. */
export function hashToolInput(input: unknown): string {
  return sha256(canonicalJson(input ?? {}));
}

// ---------------------------------------------------------------------------
// Process port
// ---------------------------------------------------------------------------

/** The result of one real child process. */
export interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly signal: NodeJS.Signals | null;
  /** Present when the process could not be started at all. */
  readonly error?: string;
}

export interface ProcessRunOptions {
  readonly cwd?: string;
  /** Extra environment for the child; merged over the parent's for host runs. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /**
   * Bytes written to the child's stdin.
   *
   * The container write path uses this instead of embedding the content in the
   * shell command (W7R1-09): a here-document can be terminated early by content
   * that contains its delimiter line, and stdin has no delimiter to forge.
   */
  readonly stdin?: string;
}

/**
 * The seam every child process goes through.
 *
 * The Broker and the test environment both use it, so a test can prove that a
 * refusal happened *without* spawning anything by handing in a runner that
 * records its calls.
 */
export interface ProcessRunner {
  run(command: string, args: readonly string[], options?: ProcessRunOptions): ProcessResult;
}

function toProcessResult(result: {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}): ProcessResult {
  return result.error === undefined
    ? { status: result.status, stdout: result.stdout, stderr: result.stderr, signal: result.signal }
    : {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        signal: result.signal,
        error: result.error.message,
      };
}

/**
 * The legacy synchronous runner: a real child process, but blocking.
 *
 * It stays for the two bounded primitives that must complete inside a synchronous
 * context — a container `cat` for a read and a container `base64 -d` for a write
 * (`readFile`/`writeFile` are synchronous members of {@link ToolContext}) — and as the
 * default of the injectable `process` seam the Broker's tests stub. The **tool shell
 * path** deliberately does not use it: `spawnSync` blocks the daemon's event loop for
 * the whole command, cannot be cancelled and signals only the direct child, which
 * contradicts `reliability.md` §5/§6. {@link defaultAsyncProcessRunner} is the port
 * the `bash`/`git` tools execute through.
 */
export const defaultProcessRunner: ProcessRunner = {
  run(command, args, options = {}) {
    const result = spawnSync(command, [...args], {
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 120_000,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      ...(options.stdin === undefined ? {} : { input: options.stdin }),
      maxBuffer: 16 * 1024 * 1024,
    });
    return toProcessResult({
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      signal: result.signal,
      ...(result.error === undefined ? {} : { error: result.error }),
    });
  },
};

// ---------------------------------------------------------------------------
// Docker availability
// ---------------------------------------------------------------------------

export type DockerAvailability =
  | { readonly available: true; readonly version: string }
  | { readonly available: false; readonly reason: string };

export type DockerProbe = (imageTag: string) => DockerAvailability;

/**
 * Probes the Docker daemon.
 *
 * A failed probe returns the observed reason; it never reports availability it
 * did not measure (`doctor` does the same, AC-048).
 */
export function probeDockerAvailability(imageTag: string): DockerAvailability {
  const result = defaultProcessRunner.run(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    {
      timeoutMs: 15_000,
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    const reason = (
      (result.stderr.trim() || result.error || 'docker daemon is not reachable').split('\n')[0] ??
      ''
    ).trim();
    return { available: false, reason: reason === '' ? 'docker daemon is not reachable' : reason };
  }
  const version = result.stdout.trim();
  if (version === '') {
    return { available: false, reason: `docker daemon reported no version for ${imageTag}` };
  }
  return { available: true, version };
}

// ---------------------------------------------------------------------------
// Role gates (AC-050)
// ---------------------------------------------------------------------------

/**
 * Roles whose input is a frozen verification copy.
 *
 * `execution.md` §1 keeps Review and Test in an isolated container in every
 * mode: "Review与Test在所有模式仍使用隔离容器，确保源码只读". The Broker
 * therefore refuses any write for these roles even in host mode, which is the
 * AC-050 promise that a host-side developer path does not remove the gate.
 *
 * §3 also assigns each of them one write boundary — Review "自己报告与检查临时
 * 目录", Test "隔离构建目录、测试数据和报告" — so a write is admitted **only**
 * inside a root the caller declared through `BrokerOptions.writableReportRoots`,
 * and that root is mounted `rw` while every source root stays `ro` (W7R1-13).
 */
export const READ_ONLY_ROLES: readonly Role[] = ['review', 'test'];

export function isReadOnlyRole(role: Role): boolean {
  return READ_ONLY_ROLES.includes(role);
}

/**
 * Operations whose only effect is to read.
 *
 * The write gate is a **capability** question, not an operation-name question
 * (W7R2-01): classifying `bash`/`git` as reads because their names were absent
 * from a write list let a read-only Review/Test role write source through a shell.
 * Everything not listed here is treated as possibly mutating, so an unknown tool
 * name fails closed rather than being assumed harmless.
 */
const READ_ONLY_OPERATIONS: readonly string[] = ['read', 'search', 'network', 'secret'];

/**
 * Operations that execute an arbitrary caller-supplied command.
 *
 * Such a tool cannot be confined to a directory: a single `bash`/`git` call can
 * write anywhere the process may write, so no path boundary makes it safe for a
 * read-only role. They are refused for Review/Test outright, in both modes.
 */
const ARBITRARY_COMMAND_OPERATIONS: readonly string[] = ['bash', 'git'];

export type ToolCapability = 'read-only' | 'mutating';

/** Whether a tool can change state, classified by what it does, not by its name. */
export function toolCapability(operation: string): ToolCapability {
  return READ_ONLY_OPERATIONS.includes(operation) ? 'read-only' : 'mutating';
}

/** Whether an operation runs an arbitrary command that no root can confine. */
export function isArbitraryCommandOperation(operation: string): boolean {
  return ARBITRARY_COMMAND_OPERATIONS.includes(operation);
}

/** Operations whose targets name real filesystem paths. */
const FILE_OPERATIONS: readonly string[] = [
  'read',
  'search',
  'write',
  'edit',
  'artifact_write',
  'delete_data',
  'bash',
  'git',
];

/** The access a call has unless it declared one, derived from the capability. */
function declaredAccess(operation: string, declared?: 'read' | 'write'): 'read' | 'write' {
  return declared ?? (toolCapability(operation) === 'mutating' ? 'write' : 'read');
}

function isFileOperation(operation: string): boolean {
  return FILE_OPERATIONS.includes(operation);
}

/**
 * Operations whose whole purpose is a path.
 *
 * `bash`/`git` may carry a command rather than a path, so they are boundary-
 * checked only when the caller declared roots; the path-shaped operations
 * cannot be verified without them and are refused instead.
 */
function requiresRoots(operation: string): boolean {
  return isFileOperation(operation) && operation !== 'bash' && operation !== 'git';
}

// ---------------------------------------------------------------------------
// File boundary
// ---------------------------------------------------------------------------

export interface FileAccessRequest {
  /** The requested path: absolute, or relative to the first root. */
  readonly path: string;
  readonly access: 'read' | 'write';
  /** Absolute roots the resolved real path must stay inside. */
  readonly roots: readonly string[];
  /** Roots that are never readable/writable, whatever the caller asked for. */
  readonly protectedPaths?: readonly string[];
  /**
   * Extra roots a *write* may target even when they are outside `roots`.
   *
   * Only the report/scratch directories `execution.md` §3 assigns to Review and
   * Test are passed here; a read never uses them, so the widened write boundary
   * cannot become a read boundary (W7R1-13).
   */
  readonly writeRoots?: readonly string[];
}

export type FileAccessDecision =
  | { readonly ok: true; readonly realPath: string; readonly requestedPath: string }
  | { readonly ok: false; readonly code: BrokerErrorCode; readonly reason: string };

/** Canonicalises an existing path, or normalises it when it does not exist. */
function canonicalExisting(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return stripTrailingSeparator(absolute);
  }
}

function stripTrailingSeparator(path: string): string {
  if (path.length > 1 && path.endsWith(sep)) return path.slice(0, -1);
  return path;
}

/** Whether `child` is `root` itself or lives beneath it. */
export function isWithinRoot(child: string, root: string): boolean {
  const normalized = stripTrailingSeparator(root);
  if (child === normalized) return true;
  return child.startsWith(`${normalized}${sep}`);
}

/**
 * Resolves the deepest existing ancestor and re-appends the missing segments.
 *
 * A plain `realpath` throws for a file that does not exist yet, which would make
 * a write fail to open *and* skip the symlink check. Resolving the ancestor
 * keeps the check meaningful: a symlinked parent directory is still detected.
 */
function resolveRealPath(absolute: string): string {
  let current = absolute;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return missing.length === 0 ? real : join(real, ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Decides whether a requested path may be touched at all.
 *
 * The decision is on the **resolved** path, so a symlink that points outside the
 * allowed roots is refused exactly like an absolute or `..` escape
 * (`execution.md` §3: "文件工具拒绝相对路径逃逸、符号链接逃逸…通过open时再校验
 * 真实路径与快照避免仅检查字符串").
 *
 * **Known limit (W7R1-08):** this is a path-containment rule, not an inode rule.
 * A *hard link* created inside the root names an inode that may also be linked
 * from outside it; the resolved path is genuinely inside the root, so no
 * path-based check can tell the difference. Creating such a link already requires
 * write access to the root, and `execution.md` §3 promises refusal of relative
 * path, symlink and nested-repository escapes only — there is no AC that covers
 * hard links. This function therefore documents the boundary instead of claiming
 * to block it.
 */
export function resolveWithinRoots(request: FileAccessRequest): FileAccessDecision {
  const path = request.path;
  if (path === '' || path.includes('\0')) {
    return refuseFile('VALIDATION_ERROR', 'path must be a non-empty path without NUL');
  }
  const roots = request.roots.map(canonicalExisting);
  if (roots.length === 0) {
    return refuseFile(
      'VALIDATION_ERROR',
      `no allowed root was declared for ${request.access} of ${path}`,
    );
  }
  const requestedPath = isAbsolute(path) ? resolve(path) : resolve(roots[0] ?? '.', path);
  const realPath = resolveRealPath(requestedPath);
  // Protected roots are reported before the allowed-roots comparison: the precise
  // reason matters for audit ("the run database is never readable"), and the
  // refusal is the same either way.
  for (const protectedRoot of request.protectedPaths ?? []) {
    if (isWithinRoot(realPath, canonicalExisting(protectedRoot))) {
      return refuseFile(
        'NOT_AUTHORIZED',
        `resolved path ${realPath} is inside protected root ${protectedRoot}`,
      );
    }
  }
  // A read-only role's write is confined to its declared report/scratch roots:
  // the source roots stay readable but never become writable (W7R1-13). A read
  // never uses `writeRoots`.
  const writeRoots = (request.writeRoots ?? []).map(canonicalExisting);
  const allowed = request.access === 'write' && writeRoots.length > 0 ? writeRoots : roots;
  if (!allowed.some((root) => isWithinRoot(realPath, root))) {
    return refuseFile(
      'NOT_AUTHORIZED',
      `resolved path ${realPath} is outside the allowed roots [${allowed.join(', ')}]`,
    );
  }
  return { ok: true, realPath, requestedPath };
}

function refuseFile(code: BrokerErrorCode, reason: string): FileAccessDecision {
  return { ok: false, code, reason };
}

// ---------------------------------------------------------------------------
// Network boundary
// ---------------------------------------------------------------------------

export interface NetworkTargetSpec {
  readonly url?: string;
  readonly host?: string;
  readonly port?: number;
}

export type NetworkPolicyDecision =
  | {
      readonly ok: true;
      /**
       * The answers that were validated, when the policy classified an address.
       *
       * The transport uses them to pin its connection to the checked address so a
       * second lookup cannot rebind to a private one (W7R2-03). A literal carries
       * its own normalised address: the URL host already *is* the address, and
       * returning it pins the built-in transport to the value that was checked
       * instead of re-deriving it (W7R3-05). A name admitted without a successful
       * lookup carries none.
       */
      readonly addresses?: readonly string[];
      /**
       * Whether the target is loopback/private/link-local/CGNAT.
       *
       * `w1-implementation.md` §7.1 opens these by default; the flag survives because
       * the plaintext-`http:` rule is scoped to them (a local dev server is `http:`,
       * a public origin is `https:`), and the Egress proxy uses it for the same
       * decision on an absolute-URI request.
       */
      readonly internal?: boolean;
    }
  | { readonly ok: false; readonly code: BrokerErrorCode; readonly reason: string };

/** Hosts that always mean an internal service, never a public target. */
const METADATA_HOSTS: readonly string[] = ['metadata.google.internal', 'metadata', 'instance-data'];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Normalises a hostname or bracketed literal for classification and allowlisting. */
function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

/**
 * Hostnames that name a local or internal service without an address literal.
 *
 * `localhost` and the metadata aliases are unconditional: no DNS answer can make
 * them public. `.local`/`.internal` names are *resolver-classified* names — they
 * are refused unless the caller explicitly authorized the exact target, which is
 * checked before this predicate (see {@link NetworkPolicy.decide}).
 */
function isAlwaysInternalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    METADATA_HOSTS.includes(host) ||
    host === 'metadata.google.internal' ||
    host.endsWith('.metadata.google.internal')
  );
}

/** `.local`/`.internal` names: internal unless exactly authorized. */
function isResolverInternalName(host: string): boolean {
  return host.endsWith('.local') || host.endsWith('.internal');
}

/**
 * The cloud metadata endpoints the egress refuses forever (`w1-implementation.md` §7.2).
 *
 * These are the addresses behind the instance-credential services of the major clouds;
 * `w1-implementation.md` §7.2 makes them one of the **two** fixed denials that no
 * configuration, Grant or authorization may ever admit. The whole `169.254.0.0/16`
 * link-local range is refused with them rather than only the handful of well-known
 * spellings, because an address in that range is never a development target and the
 * metadata services live inside it.
 */
export const METADATA_ADDRESSES: readonly string[] = [
  '100.100.100.200', // Alibaba Cloud ECS
  '192.0.0.192', // Oracle Cloud
  'fd00:ec2::254', // AWS IMDS over IPv6
];

/** The metadata *names*: DNS aliases of the same service (`w1-implementation.md` §7.2). */
export function isMetadataHostname(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    normalized === 'metadata' ||
    normalized.startsWith('metadata.') ||
    normalized === 'instance-data' ||
    normalized.endsWith('.instance-data') ||
    normalized === 'instance-data.ec2.internal' ||
    METADATA_HOSTS.includes(normalized) ||
    normalized.endsWith('.metadata.google.internal')
  );
}

/** The four octets of an IPv4 literal, or `undefined` when it is not one. */
function ipv4Octets(address: string): number[] | undefined {
  const normalized = normalizeHost(address);
  if (!isIPv4(normalized)) return undefined;
  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return undefined;
  }
  return parts;
}

/**
 * Whether an address is a cloud metadata endpoint or link-local (the first fixed denial).
 *
 * An IPv4-mapped IPv6 literal (`::ffff:169.254.169.254`) is decoded and inherits the
 * IPv4 rule, exactly like the private-address classifier, so the metadata denial cannot
 * be spelled around (`W7R1-02`).
 */
export function isMetadataAddress(
  address: string,
  nat64Prefixes: readonly string[] = DEFAULT_NAT64_PREFIXES,
): boolean {
  const normalized = normalizeHost(address);
  const octets = ipv4Octets(normalized);
  if (octets !== undefined) {
    // 169.254.0.0/16 is link-local and holds every IPv4 IMDS endpoint.
    if (octets[0] === 169 && octets[1] === 254) return true;
    return METADATA_ADDRESSES.includes(normalized);
  }
  const bytes = ipv6Bytes(normalized);
  if (bytes === undefined) return false;
  if (METADATA_ADDRESSES.includes(normalized)) return true;
  const asIpv4 = (parts: readonly number[]): string => parts.map((part) => String(part)).join('.');
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (mapped || compatible) {
    return isMetadataAddress(asIpv4(bytes.slice(12, 16)), nat64Prefixes);
  }
  // A NAT64 prefix embeds an IPv4 address; decoding it is what keeps
  // `https://[64:ff9b::a9fe:a9fe]/` from being an opaque IPv6 string (W7R2-06).
  for (const text of nat64Prefixes) {
    const prefix = parseIpv6Prefix(text);
    if (prefix === undefined || !matchesIpv6Prefix(bytes, prefix)) continue;
    const embedded = nat64EmbeddedIpv4(bytes, prefix, asIpv4);
    return embedded === undefined ? false : isMetadataAddress(embedded, nat64Prefixes);
  }
  return false;
}

/** Whether an address literal is loopback (`127.0.0.0/8`, `::1`, `0.0.0.0`). */
export function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeHost(address);
  const octets = ipv4Octets(normalized);
  if (octets !== undefined) return octets[0] === 127 || octets[0] === 0;
  const bytes = ipv6Bytes(normalized);
  if (bytes === undefined) return false;
  if (bytes.every((byte) => byte === 0)) return true;
  return bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
}

/**
 * The host names that always mean "the machine this daemon runs on".
 *
 * The docker/containerd aliases are the ones `w1-implementation.md` §7.4 requires the
 * egress to cover explicitly: `host.docker.internal` (and the containerd spelling) is the
 * documented way a container reaches its host, so a request that names it *through the
 * proxy* is a request for this machine and must meet the same refusal as `127.0.0.1`.
 */
export const LOCAL_HOST_ALIASES: readonly string[] = [
  'localhost',
  'localhost.localdomain',
  'host.docker.internal',
  'gateway.docker.internal',
  'host.containers.internal',
  'kubernetes.docker.internal',
];

/**
 * The host's own interface addresses — the second half of "this machine" for the fixed
 * daemon-port denial.
 *
 * `os.networkInterfaces()` does not report `127.0.0.1` on every platform, so loopback is
 * checked separately ({@link isLoopbackAddress}); the list covers a daemon bound to a
 * concrete LAN address (a deployment that sets `AGENTDEV_HOST`). The docker bridge gateway
 * is *not* in this list — the gateway is an interface inside the Docker VM, not on the host
 * — which is why a container naming it is caught by the name alias (`host.docker.internal`,
 * `gateway.docker.internal`) or, when it names the raw gateway address, by the fact that the
 * daemon's own listeners are loopback-only and the address is therefore not local at all:
 * the container has no route to it in the first place.
 */
export function hostInterfaceAddresses(): readonly string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) addresses.push(entry.address);
  }
  return addresses;
}

/**
 * NAT64 prefixes whose embedded IPv4 is decoded before classification (W7R2-06).
 *
 * `64:ff9b::/96` is the RFC 6052 well-known prefix and `64:ff9b:1::/48` the RFC
 * 8215 local-use prefix — the second was previously judged public, so a network
 * using local NAT64 could be used to reach internal addresses through the
 * translator. The set is configurable through {@link NetworkPolicy}.
 */
export const DEFAULT_NAT64_PREFIXES: readonly string[] = ['64:ff9b::/96', '64:ff9b:1::/48'];

/** The 16 bytes of an IPv6 prefix and its length in bits. */
interface Ipv6Prefix {
  readonly bytes: readonly number[];
  readonly length: number;
}

/** Parses an IPv6 CIDR (`64:ff9b::/96`); `undefined` when it is malformed. */
function parseIpv6Prefix(text: string): Ipv6Prefix | undefined {
  const [address, lengthText] = text.trim().split('/');
  const bytes = ipv6Bytes(address ?? '');
  if (bytes === undefined) return undefined;
  const length = lengthText === undefined ? 128 : Number.parseInt(lengthText, 10);
  if (!Number.isInteger(length) || length < 0 || length > 128) return undefined;
  return { bytes, length };
}

/** Whether a 16-byte address falls inside an IPv6 prefix. */
function matchesIpv6Prefix(bytes: readonly number[], prefix: Ipv6Prefix): boolean {
  const wholeBytes = Math.floor(prefix.length / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefix.bytes[index]) return false;
  }
  const remaining = prefix.length % 8;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return ((bytes[wholeBytes] ?? 0) & mask) === ((prefix.bytes[wholeBytes] ?? 0) & mask);
}

/**
 * Classifies an address literal as loopback, private, link-local, CGNAT,
 * benchmarking, multicast/reserved or metadata space.
 *
 * Literal addresses are the only thing this function can decide on its own: a
 * hostname needs DNS, which is why it returns `undefined` for one. The review
 * (W7R1-01/W7R1-02) showed both halves of that rule matter — a name resolving to
 * `127.0.0.1` and a hexadecimal IPv4-mapped literal (`::ffff:7f00:1`) each slipped
 * through a name-only/literal-prefix check.
 */
export function classifyAddressLiteral(
  address: string,
  nat64Prefixes: readonly string[] = DEFAULT_NAT64_PREFIXES,
): boolean | undefined {
  const normalized = normalizeHost(address);
  if (normalized === '') return true;
  if (isIPv4(normalized)) return isPrivateIpv4(normalized);
  if (isIPv6(normalized)) return isPrivateIpv6(normalized, nat64Prefixes);
  return undefined;
}

/**
 * Whether a host is loopback, private, link-local, CGNAT, multicast or a
 * metadata endpoint.
 *
 * `execution.md` §4 forbids these by default: "禁止默认访问loopback/私网/
 * metadata；用户可按精确目标显式授权内网". An address literal is classified
 * directly, and so is a name that is internal by construction (`localhost`, the
 * metadata aliases, `.local`/`.internal`). Any *other* hostname is a question no
 * synchronous check can answer, so it is reported as unclassified (`false`): the
 * caller must resolve it through {@link resolvesToPrivateAddress} before deciding
 * (W7R1-01).
 */
export function isPrivateAddress(
  host: string,
  classifyHost?: HostClassifier,
  nat64Prefixes: readonly string[] = DEFAULT_NAT64_PREFIXES,
): boolean {
  const normalized = normalizeHost(host);
  if (normalized === '') return true;
  if (isAlwaysInternalHost(normalized)) return true;
  const literal = classifyAddressLiteral(normalized, nat64Prefixes);
  if (literal !== undefined) return literal;
  if (isResolverInternalName(normalized)) return true;
  const classified = classifyHost?.(normalized);
  return typeof classified === 'boolean' ? classified : false;
}

/** Binds a resolver to the synchronous host classification (see {@link isPrivateAddress}). */
export type HostClassifier = (host: string) => boolean | string;

function isPrivateIpv4(address: string): boolean {
  const parsed = parseIpv4(address);
  if (parsed === undefined) return true;
  const { a, b } = parsed;
  // 0.0.0.0/8 "this network", RFC1918 10/8 and 127/8 loopback.
  if (a === 0 || a === 10 || a === 127) return true;
  // 100.64.0.0/10 CGNAT.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16 link-local; 172.16.0.0/12 private; 192.168.0.0/16 private.
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 192.0.0.0/24 IETF protocol assignments, 192.0.2.0/24 TEST-NET-1.
  if (a === 192 && b === 0) return true;
  // 198.18.0.0/15 benchmarking.
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 and 203.0.113.0/24 documentation ranges.
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  // 224/4 multicast, 240/4 reserved and 255.255.255.255 broadcast.
  if (a >= 224) return true;
  return false;
}

function parseIpv4(address: string): { readonly a: number; readonly b: number } | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (match === null) return undefined;
  const values = match.slice(1).map((part) => Number.parseInt(part, 10));
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255))
    return undefined;
  return { a: values[0] ?? 0, b: values[1] ?? 0 };
}

/** The 16 bytes of an IPv6 literal, or `undefined` when it is not one. */
export function ipv6Bytes(address: string): number[] | undefined {
  const value = normalizeHost(address);
  if (!isIPv6(value)) return undefined;
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  // A trailing dotted-quad is an embedded IPv4 address and occupies two groups.
  // `isIPv6` accepts mixed notation, so both `::ffff:127.0.0.1` and the
  // `::ffff:7f00:1` form the URL parser emits have to be decoded.
  const parseGroups = (part: string): number[] | undefined => {
    if (part === '') return [];
    const segments = part.split(':');
    const trailing = segments.at(-1) ?? '';
    const embedded = isIPv4(trailing)
      ? trailing.split('.').map((o) => Number.parseInt(o, 10))
      : undefined;
    const head = [...segments];
    if (embedded !== undefined) head.pop();
    const groups: number[] = [];
    for (const segment of head) {
      const parsed = Number.parseInt(segment, 16);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) return undefined;
      groups.push(parsed);
    }
    if (embedded !== undefined) {
      groups.push(((embedded[0] ?? 0) << 8) | (embedded[1] ?? 0));
      groups.push(((embedded[2] ?? 0) << 8) | (embedded[3] ?? 0));
    }
    return groups;
  };
  const head = parseGroups(halves[0] ?? '');
  if (head === undefined) return undefined;
  const groups = [...head];
  if (halves.length === 2) {
    const tail = parseGroups(halves[1] ?? '');
    if (tail === undefined) return undefined;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return undefined;
    groups.push(...Array.from({ length: missing }, () => 0), ...tail);
  }
  if (groups.length !== 8) return undefined;
  const bytes: number[] = [];
  for (const group of groups) {
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

/**
 * Classifies an IPv6 address by its numeric value, never by string prefix.
 *
 * WHATWG normalises `http://[::ffff:127.0.0.1]/` to `::ffff:7f00:1`, so the
 * IPv4-mapped form must be decoded from bytes and inherit **every** IPv4 rule
 * (loopback, RFC1918, link-local, CGNAT, `0.0.0.0/8`), not just the dotted-quad
 * spelling (W7R1-02). Every configured NAT64 prefix is decoded the same way
 * (W7R2-06); a matching address whose embedded IPv4 cannot be decoded is treated
 * as internal rather than public.
 */
function isPrivateIpv6(
  address: string,
  nat64Prefixes: readonly string[] = DEFAULT_NAT64_PREFIXES,
): boolean {
  const bytes = ipv6Bytes(address);
  if (bytes === undefined) return true;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && (bytes[15] ?? 0) === 1;
  if (allZero || loopback) return true;
  const ipv4At = (offset: number): number[] => bytes.slice(offset, offset + 4);
  const asIpv4 = (parts: readonly number[]): string => parts.map((part) => String(part)).join('.');
  // ::ffff:0:0/96 IPv4-mapped and ::/96 IPv4-compatible.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4(asIpv4(ipv4At(12)));
  }
  if (bytes.slice(0, 12).every((byte) => byte === 0)) {
    return isPrivateIpv4(asIpv4(ipv4At(12)));
  }
  // NAT64 prefixes: decode the embedded IPv4 and apply the whole IPv4 rule set.
  for (const text of nat64Prefixes) {
    const prefix = parseIpv6Prefix(text);
    if (prefix === undefined || !matchesIpv6Prefix(bytes, prefix)) continue;
    const embedded = nat64EmbeddedIpv4(bytes, prefix, asIpv4);
    // An address under a NAT64 prefix whose embedded IPv4 we cannot decode is not
    // a public destination (W7R2-06: "a prefix you cannot decode must be treated
    // as private").
    return embedded === undefined ? true : isPrivateIpv4(embedded);
  }
  // fe80::/10 link-local.
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return true;
  // fc00::/7 unique-local.
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return true;
  // ff00::/8 multicast.
  if (bytes[0] === 0xff) return true;
  // 2001:db8::/32 documentation.
  if (
    (bytes[0] ?? 0) === 0x20 &&
    (bytes[1] ?? 0) === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return true;
  }
  return false;
}

/**
 * The IPv4 address a NAT64 prefix embeds, or `undefined` when it cannot be decoded.
 *
 * RFC 6052 puts the IPv4 in the last 32 bits for a `/96` (and longer) prefix; the
 * RFC 8215 local-use `/48` places it in bits 48..79 with the reserved `u` octet
 * zero. Both layouts are examined, and a short prefix that cannot certify a public
 * embedded address returns `undefined` so the caller treats it as internal.
 */
function nat64EmbeddedIpv4(
  bytes: readonly number[],
  prefix: Ipv6Prefix,
  asIpv4: (parts: readonly number[]) => string,
): string | undefined {
  const trailing = asIpv4(bytes.slice(12, 16));
  if (prefix.length >= 96) return trailing;
  if ((bytes[8] ?? 0) !== 0) return undefined;
  const shortForm = asIpv4([bytes[6] ?? 0, bytes[7] ?? 0, bytes[8] ?? 0, bytes[9] ?? 0]);
  if (isPrivateIpv4(shortForm)) return shortForm;
  // A local-use prefix leaves too little structure to certify the trailing word as
  // the destination, so an address that is private by either reading is private
  // and anything else stays fail-closed.
  return isPrivateIpv4(trailing) ? trailing : undefined;
}

/**
 * The injected DNS port.
 *
 * The policy never calls the operating system resolver directly, so a test can
 * prove the DNS branch with a stub (offline) and a caller can plug in its own
 * resolver. Returning a *reason* instead of throwing keeps a resolution failure a
 * refusal rather than an escaped exception.
 */
export interface HostResolver {
  resolve(host: string): Promise<ResolvedAddresses>;
}

export type ResolvedAddresses =
  | { readonly ok: true; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** The default resolver: a real `dns.lookup` returning every answer. */
export const defaultHostResolver: HostResolver = {
  async resolve(host) {
    try {
      const answers = await lookup(host, { all: true });
      const addresses = answers.map((answer) => answer.address);
      if (addresses.length === 0) {
        return { ok: false, reason: `${host} resolved to no address` };
      }
      return { ok: true, addresses };
    } catch (error) {
      return { ok: false, reason: `${host} could not be resolved: ${messageOf(error)}` };
    }
  },
};

/**
 * What a host name resolves to and how it classifies.
 *
 * `classification` is `true` (internal), `false` (public) or a reason string when
 * the host cannot be verified at all. `addresses` carries the answers that were
 * validated so the transport can pin its connection to one of them (W7R2-03); it
 * is absent when no lookup happened (a literal or an unverifiable name).
 */
export interface HostResolution {
  readonly classification: boolean | string;
  readonly addresses?: readonly string[];
}

/**
 * Resolves a host without ever throwing.
 *
 * A resolver that throws is a refusal, not an escaped exception (W7R2-05): the
 * failure is reported exactly like an unresolvable name, so
 * `docs/architecture/execution.md` §4 "an unverifiable target is refused" holds
 * for a misbehaving resolver too.
 */
async function safeResolve(host: string, resolver: HostResolver): Promise<ResolvedAddresses> {
  try {
    return await resolver.resolve(host);
  } catch (error) {
    return { ok: false, reason: `${host} could not be resolved: ${messageOf(error)}` };
  }
}

/**
 * The full decision for a host name: internal-by-construction, literal, or DNS.
 *
 * A name that resolves to *any* private/loopback/link-local/CGNAT/metadata
 * address is internal, because the transport may pick that answer. A name that
 * cannot be resolved (or whose resolver throws) is also refused: an unverifiable
 * target is not a public one. The validated answers are returned so the transport
 * can connect to them directly rather than resolving the name a second time.
 */
export async function classifyHostResolution(
  host: string,
  resolver: HostResolver,
  nat64Prefixes: readonly string[] = DEFAULT_NAT64_PREFIXES,
): Promise<HostResolution> {
  const normalized = normalizeHost(host);
  if (normalized === '') return { classification: true };
  if (isAlwaysInternalHost(normalized)) {
    const addresses = await resolvedAddresses(normalized, resolver);
    return addresses === undefined ? { classification: true } : { classification: true, addresses };
  }
  const literal = classifyAddressLiteral(normalized, nat64Prefixes);
  // A literal is its own validated address; it is returned so the transport can
  // pin to it as well, rather than being treated as an unclassified host.
  if (literal !== undefined) return { classification: literal, addresses: [normalized] };
  if (isResolverInternalName(normalized)) {
    const addresses = await resolvedAddresses(normalized, resolver);
    return addresses === undefined ? { classification: true } : { classification: true, addresses };
  }
  const resolved = await safeResolve(normalized, resolver);
  if (!resolved.ok) return { classification: resolved.reason };
  const addresses: string[] = [];
  for (const address of resolved.addresses) {
    const classified = classifyAddressLiteral(address, nat64Prefixes);
    if (classified === undefined) {
      return {
        classification: `resolved address ${address} is not an address literal and cannot be classified`,
      };
    }
    addresses.push(address);
    if (classified) return { classification: true, addresses };
  }
  return { classification: false, addresses };
}

/** The addresses a name resolves to, or `undefined` when the lookup failed. */
async function resolvedAddresses(
  host: string,
  resolver: HostResolver,
): Promise<readonly string[] | undefined> {
  const resolved = await safeResolve(host, resolver);
  return resolved.ok ? resolved.addresses : undefined;
}

/**
 * Whether a host name resolves into internal address space.
 *
 * Kept as the boolean/reason projection of {@link classifyHostResolution} for
 * callers that only need the admission decision.
 */
export async function resolvesToPrivateAddress(
  host: string,
  resolver: HostResolver,
): Promise<boolean | string> {
  return (await classifyHostResolution(host, resolver)).classification;
}

/**
 * The network admission policy (`w1-implementation.md` §7, superseding the earlier
 * allowlist idea).
 *
 * §7.1 fixes the first-phase semantics: **the network is open by default** — public
 * hosts, local dev servers (`127.0.0.1:3000`), local databases (`:5432`) and an
 * internal dependency mirror need no configured allowlist and no per-call approval.
 * Exactly **two** targets are refused, forever and for every caller:
 *
 * 1. the ports the daemon **actually bound** ({@link daemonPorts}): the control
 *    endpoint, the model-gateway proxy, the project protocol port, the BFF and the
 *    admin surface. The agent's own context carries a live attempt capability, so
 *    reaching the control plane would turn a supervised tool into a control client;
 * 2. cloud metadata endpoints ({@link isMetadataAddress}) — link-local
 *    `169.254.0.0/16`, the well-known IMDS addresses and the `metadata.*` names —
 *    which hand out instance credentials and contradict "密钥永不进入agent环境".
 *
 * Nothing else is a network refusal. Classification still happens — every name is
 * resolved through the injected {@link HostResolver}, every answer is checked, and the
 * validated answers travel with the decision so the transport can pin its connection to
 * them (W7R1-01/W7R2-03/W7R2-06) — but the *verdict* is `deny metadata / deny bound
 * port / otherwise allow`. The one scheme rule that survives is the documented
 * plaintext rule: an `http:` public target needs the explicit `allowInsecureHttp` opt-in,
 * while a loopback/private `http:` target is ordinary local development.
 */
export class NetworkPolicy {
  private readonly allowed: readonly string[];
  private readonly allowInsecureHttp: boolean;
  private readonly resolver: HostResolver | undefined;
  private readonly nat64Prefixes: readonly string[];
  private readonly daemonPorts: () => readonly number[];
  private readonly localAliases: readonly string[];
  private readonly localAddresses: () => readonly string[];

  constructor(
    options: {
      /**
       * Targets the user explicitly authorized.
       *
       * Under §7.1 an exact authorization is no longer *required* for a private target;
       * the list is kept as advisory input (it still permits plaintext `http:` for the
       * exact endpoint) and so a caller that records authorizations keeps reporting them.
       */
      readonly allowedTargets?: readonly string[];
      /** Explicit opt-in for a plaintext target. Default `false`. */
      readonly allowInsecureHttp?: boolean;
      /** Injected DNS port; the default is a real `dns.lookup`. */
      readonly resolver?: HostResolver;
      /**
       * NAT64 prefixes whose embedded IPv4 is decoded before classification.
       *
       * Defaults to {@link DEFAULT_NAT64_PREFIXES}; a deployment that uses a
       * site-specific translator prefix adds it here (W7R2-06).
       */
      readonly nat64Prefixes?: readonly string[];
      /**
       * The ports the daemon actually bound, read live (first fixed denial).
       *
       * A function rather than a list because the listeners bind at runtime — the
       * control endpoint and the gateway proxy take ephemeral ports — so a snapshot
       * taken at construction would be stale immediately.
       */
      readonly daemonPorts?: () => readonly number[];
      /** Extra host names that mean this machine (the docker/containerd aliases). */
      readonly localAliases?: readonly string[];
      /** The host's own interface addresses, read live. */
      readonly localAddresses?: () => readonly string[];
    } = {},
  ) {
    // An authorized target may be written `host`, `host:port`, `http(s)://host…`;
    // only the host and port take part in the decision.
    this.allowed = [...(options.allowedTargets ?? [])].map((target) => {
      const withoutScheme = target
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '');
      return (withoutScheme.split('/')[0] ?? withoutScheme).replace(/^\[|\]$/g, '');
    });
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;
    this.resolver = options.resolver;
    this.nat64Prefixes = options.nat64Prefixes ?? DEFAULT_NAT64_PREFIXES;
    this.daemonPorts = options.daemonPorts ?? (() => []);
    this.localAliases = options.localAliases ?? LOCAL_HOST_ALIASES;
    this.localAddresses = options.localAddresses ?? (() => []);
  }

  /** The NAT64 prefixes this policy decodes. */
  get decodedNat64Prefixes(): readonly string[] {
    return this.nat64Prefixes;
  }

  /** The resolver this policy was given, if any. */
  get hostResolver(): HostResolver | undefined {
    return this.resolver;
  }

  /** Whether plaintext `http:` is explicitly permitted. */
  get insecureHttpAllowed(): boolean {
    return this.allowInsecureHttp;
  }

  /** The exact targets the user explicitly authorized. */
  get allowedTargets(): readonly string[] {
    return this.allowed;
  }

  /** The ports the daemon actually bound (first fixed denial). */
  get boundPorts(): readonly number[] {
    return [...this.daemonPorts()];
  }

  /** Whether an exact authorized target covers this host/port. */
  allows(host: string, port?: number): boolean {
    const normalized = normalizeHost(host);
    return this.allowed.some((target) => {
      const separator = target.lastIndexOf(':');
      const hasPort = separator > 0 && /^\d+$/.test(target.slice(separator + 1));
      const targetHost = (hasPort ? target.slice(0, separator) : target)
        .replace(/^\[|\]$/g, '')
        .replace(/^https?:\/\//, '')
        .split('/')[0];
      if (targetHost !== normalized) return false;
      if (!hasPort) return true;
      return port !== undefined && Number.parseInt(target.slice(separator + 1), 10) === port;
    });
  }

  /**
   * The synchronous target decision: the two fixed denials, then the scheme.
   *
   * It cannot resolve DNS, so it is a fast path and the helper the Egress proxy uses for a
   * host it has already resolved; admission itself awaits {@link decide}.
   */
  checkTarget(target: NetworkTargetSpec): NetworkPolicyDecision {
    if (target.url !== undefined) return this.checkUrl(target.url);
    const host = target.host;
    if (host === undefined || host.trim() === '') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: 'a network target needs a host or url',
      };
    }
    return this.decideSync(host, target.port);
  }

  /** Decides one URL: address, then the plaintext rule (no DNS). */
  checkUrl(input: string | URL): NetworkPolicyDecision {
    const parsed = this.parseUrl(input);
    if (!parsed.ok) return parsed;
    const address = this.decideSync(parsed.url.hostname, parsed.port);
    if (!address.ok) return address;
    return this.checkScheme(parsed.url, address.internal === true);
  }

  /**
   * The authoritative decision: the two fixed denials, then the scheme.
   *
   * Every question a hostname raises is answered before the transport is asked to make a
   * request: a metadata name or an address is refused by name, every DNS answer is checked
   * for metadata space and for a daemon-bound port on this machine, and only then is the
   * target admitted. The validated answers are returned so the transport pins its
   * connection to them (W7R2-03); a name that does not resolve is admitted with no
   * addresses, because an unresolvable target is a transport failure rather than a policy
   * decision.
   */
  async decide(input: {
    readonly url?: string;
    readonly host?: string;
    readonly port?: number;
  }): Promise<NetworkPolicyDecision> {
    if (input.url !== undefined) {
      const parsed = this.parseUrl(input.url);
      if (!parsed.ok) return parsed;
      const decision = await this.decideHost(parsed.url.hostname, parsed.port);
      if (!decision.ok) return decision;
      const scheme = this.checkScheme(parsed.url, decision.internal === true);
      if (!scheme.ok) return scheme;
      return decision.addresses === undefined
        ? { ok: true, internal: decision.internal === true }
        : { ok: true, addresses: decision.addresses, internal: decision.internal === true };
    }
    const host = input.host;
    if (host === undefined || host.trim() === '') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: 'a network target needs a host or url',
      };
    }
    return this.decideHost(host, input.port);
  }

  /**
   * The plaintext rule.
   *
   * A loopback/private target may speak plaintext `http:` — that is how a local dev
   * server or a local database is reached, and §7.1 names `127.0.0.1:3000` explicitly. A
   * **public** target needs `https:` unless plaintext was explicitly enabled, which keeps
   * W7R1-07's "a redirect cannot silently downgrade a public origin" promise. The rule is
   * enforced on an absolute-URI request; `CONNECT` carries TLS the proxy must not
   * reinterpret.
   */
  private checkScheme(parsed: URL, internal: boolean): NetworkPolicyDecision {
    if (parsed.protocol === 'https:') return { ok: true, internal };
    if (parsed.protocol !== 'http:') {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: `network scheme ${parsed.protocol} is refused; only http and https are supported`,
      };
    }
    if (internal) return { ok: true, internal: true };
    const port = parsed.port === '' ? 80 : Number.parseInt(parsed.port, 10);
    if (this.allowInsecureHttp && this.allows(parsed.hostname, port)) return { ok: true, internal };
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      reason:
        'network scheme http: to a public target is refused; https is required unless plaintext is explicitly authorized for this endpoint',
    };
  }

  /**
   * Decides a host name, resolving it when the name itself is not conclusive.
   *
   * The two fixed denials are applied to the name and then to **every** DNS answer, so a
   * name that resolves to a metadata address or to this machine's bound ports is refused
   * exactly like the literal spelling would be. Everything else is admitted.
   */
  private async decideHost(host: string, port: number | undefined): Promise<NetworkPolicyDecision> {
    const normalized = normalizeHost(host);
    const byName = this.denyHostname(normalized, port);
    if (byName !== undefined) return byName;
    const resolved = await classifyHostResolution(
      normalized,
      this.resolver ?? defaultHostResolver,
      this.nat64Prefixes,
    );
    const addresses = resolved.addresses === undefined ? [] : [...resolved.addresses];
    for (const address of addresses) {
      const denial = this.denyAddress(address, port, normalized);
      if (denial !== undefined) return denial;
    }
    // `classification === true` is the loopback/private/link-local/CGNAT projection the
    // plaintext rule is scoped to; an unclassifiable or unresolvable name is not internal
    // (the connection will simply fail).
    const internal = resolved.classification === true;
    return addresses.length === 0 ? { ok: true, internal } : { ok: true, addresses, internal };
  }

  private decideSync(host: string, port?: number): NetworkPolicyDecision {
    const normalized = normalizeHost(host);
    const byName = this.denyHostname(normalized, port);
    if (byName !== undefined) return byName;
    const byAddress = this.denyAddress(normalized, port, normalized);
    if (byAddress !== undefined) return byAddress;
    const internal = isPrivateAddress(normalized, undefined, this.nat64Prefixes);
    return { ok: true, internal, addresses: [normalized] };
  }

  /** The first fixed denial applied to a host name (before DNS). */
  private denyHostname(host: string, port?: number): NetworkPolicyDecision | undefined {
    if (isMetadataHostname(host)) return this.refuseMetadata(host, port);
    if (port !== undefined && this.daemonPorts().includes(port) && this.isLocalHostname(host)) {
      return this.refuseDaemonPort(host, port);
    }
    return undefined;
  }

  /** The two fixed denials applied to one address (a DNS answer or a literal). */
  private denyAddress(
    address: string,
    port: number | undefined,
    host: string,
  ): NetworkPolicyDecision | undefined {
    if (isMetadataAddress(address, this.nat64Prefixes)) return this.refuseMetadata(host, port);
    if (port !== undefined && this.daemonPorts().includes(port) && this.isLocalAddress(address)) {
      return this.refuseDaemonPort(host, port);
    }
    return undefined;
  }

  private isLocalHostname(host: string): boolean {
    if (this.localAliases.includes(host)) return true;
    return isAlwaysInternalHost(host) || isLoopbackAddress(host);
  }

  private isLocalAddress(address: string): boolean {
    if (isLoopbackAddress(address)) return true;
    const normalized = normalizeHost(address);
    return this.localAddresses().some((local) => normalizeHost(local) === normalized);
  }

  private refuseMetadata(host: string, port?: number): NetworkPolicyDecision {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      reason: `network target ${host}${port === undefined ? '' : `:${String(port)}`} is a cloud metadata address and is refused permanently; it is not a development target and no configuration or authorization can admit it — do not retry it`,
    };
  }

  private refuseDaemonPort(host: string, port: number): NetworkPolicyDecision {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      reason: `network target ${host}:${String(port)} is a port the daemon itself is listening on and is refused permanently; it is the control plane, not a development target, and no configuration or authorization can admit it — do not retry it`,
    };
  }

  private parseUrl(
    input: string | URL,
  ):
    | { readonly ok: true; readonly url: URL; readonly port: number }
    | Extract<NetworkPolicyDecision, { ok: false }> {
    let parsed: URL;
    try {
      parsed = typeof input === 'string' ? new URL(input) : input;
    } catch {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: `network target ${String(input)} is not a valid URL`,
      };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: `network scheme ${parsed.protocol} is refused; only http and https are supported`,
      };
    }
    const port =
      parsed.port === ''
        ? parsed.protocol === 'https:'
          ? 443
          : 80
        : Number.parseInt(parsed.port, 10);
    return { ok: true, url: parsed, port };
  }
}

export interface RedirectHop {
  readonly url: string;
  readonly status?: number;
  readonly allowed: boolean;
}

export type NetworkFetchOutcome =
  | {
      readonly ok: true;
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
      readonly finalUrl: string;
      readonly hops: readonly RedirectHop[];
    }
  | {
      readonly ok: false;
      readonly code: BrokerErrorCode;
      readonly reason: string;
      readonly blockedUrl: string;
      readonly hops: readonly RedirectHop[];
    };

/** The minimal `fetch` surface the guarded requester needs. */
export interface NetworkResponseLike {
  readonly status: number;
  readonly headers: {
    get(name: string): string | null;
    forEach?(callback: (value: string, key: string) => void): void;
  };
  text(): Promise<string>;
}

/**
 * The transport seam, with an address-pinning option.
 *
 * `pinnedAddresses` carries the answers {@link NetworkPolicy.decide} validated for
 * this hop. A fetcher that can bind its connection must connect only to one of
 * them, so a second DNS lookup cannot rebind the name to a private address between
 * the guard and the connection (W7R2-03). {@link defaultNetworkFetcher} does that
 * with a `lookup` callback that ignores DNS; a caller-supplied fetcher is handed
 * the same list and decides whether it can honour it.
 */
export type NetworkFetcher = (
  url: string,
  init: {
    readonly method: string;
    readonly redirect: 'manual';
    readonly headers: Record<string, string>;
    readonly pinnedAddresses?: readonly string[];
  },
) => Promise<NetworkResponseLike>;

/** The built-in `fetch`, captured so a replaced global can be detected. */
const nativeFetch: typeof globalThis.fetch = globalThis.fetch;

/**
 * The default transport.
 *
 * An un-pinned hop goes through `fetch` unchanged. A hop the policy pinned is
 * performed by {@link pinnedNodeRequest}, which supplies a `lookup` that answers
 * only with a validated address — so the connection cannot be rebound. If the
 * process replaced the global `fetch` (a test double, or a caller's own
 * proxy-aware transport), that transport is authoritative and is used as-is; the
 * pin is still passed on `init` for it to honour.
 */
export const defaultNetworkFetcher: NetworkFetcher = (url, init) => {
  const pinned = init.pinnedAddresses?.[0];
  if (pinned !== undefined && globalThis.fetch === nativeFetch) {
    return pinnedNodeRequest(url, init, pinned);
  }
  return globalThis.fetch(url, init);
};

/**
 * A `lookup` that always answers with the address the policy validated.
 *
 * Node calls this instead of the system resolver while connecting, which is what
 * turns "the address was checked" into "the checked address was used".
 */
function pinnedLookup(address: string) {
  const family = isIPv6(address) ? 6 : 4;
  return (
    _hostname: string,
    options: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      resolved: string | LookupAddress[],
      resolvedFamily?: number,
    ) => void,
  ): void => {
    if (options.all === true) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

/** Performs one request through `node:http(s)` while pinned to `address`. */
function pinnedNodeRequest(
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string> },
  address: string,
): Promise<NetworkResponseLike> {
  return new Promise((settle, fail) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(
      parsed,
      {
        method: init.method,
        headers: init.headers,
        lookup: pinnedLookup(address),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          settle({
            status: response.statusCode ?? 0,
            headers: nodeHeaders(response.headers),
            text: () => Promise.resolve(Buffer.concat(chunks).toString('utf8')),
          });
        });
      },
    );
    request.on('error', fail);
    request.end();
  });
}

function nodeHeaders(headers: IncomingHttpHeaders): NetworkResponseLike['headers'] {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    lower.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value);
  }
  return {
    get: (name) => lower.get(name.toLowerCase()) ?? null,
    forEach: (callback) => {
      for (const [key, value] of lower) callback(value, key);
    },
  };
}

const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

/**
 * Performs a network request while re-validating every redirect hop.
 *
 * The request uses `redirect: 'manual'` deliberately: a transport that follows
 * redirects internally would make the private-address rule unenforceable, because
 * the disallowed hop would already have been fetched. Here the policy is checked
 * **before** each fetch — through the async decision, so the hop's hostname is
 * resolved and refused when any answer is loopback/private (W7R1-01) — so a 302
 * to `169.254.169.254` or to a name resolving to `127.0.0.1` is refused without
 * the request ever leaving the process. The validated answers from that same
 * decision are handed to the fetcher as `pinnedAddresses`, so the hop connects to
 * the address that was checked rather than resolving the name again (W7R2-03).
 */
export class GuardedRequester {
  private readonly policy: NetworkPolicy;
  private readonly fetcher: NetworkFetcher;
  private readonly maxRedirects: number;
  private readonly resolver: HostResolver;

  constructor(options: {
    readonly policy: NetworkPolicy;
    readonly fetcher?: NetworkFetcher;
    readonly maxRedirects?: number;
    /** Injected DNS port; defaults to the policy's, then to a real lookup. */
    readonly resolver?: HostResolver;
  }) {
    this.policy = options.policy;
    this.fetcher = options.fetcher ?? defaultNetworkFetcher;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.resolver = options.resolver ?? options.policy.hostResolver ?? defaultHostResolver;
  }

  get networkPolicy(): NetworkPolicy {
    return this.policy;
  }

  async request(
    url: string,
    init: { readonly method?: string; readonly headers?: Readonly<Record<string, string>> } = {},
  ): Promise<NetworkFetchOutcome> {
    const method = init.method ?? 'GET';
    const headers = { ...(init.headers ?? {}) };
    const hops: RedirectHop[] = [];
    let current = url;

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const decision = await this.policy.decide({ url: current });
      if (!decision.ok) {
        hops.push({ url: current, allowed: false });
        return {
          ok: false,
          code: decision.code,
          reason: decision.reason,
          blockedUrl: current,
          hops,
        };
      }
      let response: NetworkResponseLike;
      try {
        response = await this.fetcher(current, {
          method,
          redirect: 'manual',
          headers,
          ...(decision.addresses === undefined ? {} : { pinnedAddresses: decision.addresses }),
        });
      } catch (error) {
        // A transport failure (ECONNREFUSED, DNS/connect/TLS errors, an injected
        // fetcher that throws) is a refusal, not an exception the caller has to
        // guess how to handle (W7R3-03). It is reported with the hop it happened
        // on and the original reason.
        return {
          ok: false,
          code: 'PROVIDER_UNAVAILABLE',
          reason: `network transport to ${current} failed: ${messageOf(error)}`,
          blockedUrl: current,
          hops,
        };
      }
      hops.push({ url: current, status: response.status, allowed: true });
      if (!REDIRECT_STATUSES.includes(response.status)) {
        let body: string;
        try {
          body = await response.text();
        } catch (error) {
          return {
            ok: false,
            code: 'PROVIDER_UNAVAILABLE',
            reason: `reading the response body from ${current} failed: ${messageOf(error)}`,
            blockedUrl: current,
            hops,
          };
        }
        return {
          ok: true,
          status: response.status,
          headers: headerRecord(response),
          body,
          finalUrl: current,
          hops,
        };
      }
      const location = response.headers.get('location');
      if (location === null || location.trim() === '') {
        return {
          ok: false,
          code: 'INVALID_STATE',
          reason: `redirect ${String(response.status)} from ${current} carries no Location`,
          blockedUrl: current,
          hops,
        };
      }
      current = new URL(location, current).toString();
    }
    return {
      ok: false,
      code: 'INVALID_STATE',
      reason: `more than ${String(this.maxRedirects)} redirects starting at ${url}`,
      blockedUrl: current,
      hops,
    };
  }
}

function headerRecord(response: NetworkResponseLike): Record<string, string> {
  const headers: Record<string, string> = {};
  // `fetch`'s Headers exposes `forEach`; the minimal interface only promises
  // `get`, so known headers are copied explicitly and the rest through forEach
  // when the concrete response offers it.
  const iterable = response.headers as {
    forEach?: (callback: (value: string, key: string) => void) => void;
  };
  if (typeof iterable.forEach === 'function') {
    iterable.forEach((value, key) => {
      headers[key] = value;
    });
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Container execution plan
// ---------------------------------------------------------------------------

export interface ContainerMount {
  /** Absolute host path. */
  readonly path: string;
  /** Where it is mounted inside the container. */
  readonly target: string;
  readonly mode: 'ro' | 'rw';
}

export interface ContainerPlanInput {
  readonly command: string;
  readonly image?: string;
  /** Source roots; read-only unless listed in `writableRoots`. */
  readonly roots?: readonly string[];
  readonly writableRoots?: readonly string[];
  /**
   * Whether the controlled egress channel is mounted.
   *
   * `none` (the default) is a container with no egress channel at all. `proxy` mounts the
   * channel's named volume read-only and starts the in-container bridge; the container's
   * **IP network stays `none` in both cases**, so the mounted socket is the only path out
   * (`w1-implementation.md` §7, `execution.md` §2).
   */
  readonly network?: 'none' | 'proxy';
  /** The live controlled channel; required when `network` is `proxy`. */
  readonly egress?: ContainerEgressChannel;
  readonly workdir?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ContainerPlan {
  readonly image: string;
  readonly command: string;
  /** Flags passed to `docker`, starting with `run`. */
  readonly args: readonly string[];
  readonly mounts: readonly ContainerMount[];
  readonly network: 'none' | 'proxy';
  readonly user: string;
  readonly workdir: string;
}

/** Where the primary root and the extra roots are mounted. */
export function containerMountTarget(index: number): string {
  return index === 0 ? '/workspace' : `/mnt/agentdev-${String(index)}`;
}

/**
 * Builds the exact `docker run` invocation for one tool call.
 *
 * The hardening flags are the ones `docker/run-agentdev.sh` documents and
 * `execution.md` §1 fixes. `--network none` is **always** used: the controlled egress is a
 * Unix socket in a named volume, not an IP path, so the container keeps zero network
 * reachability — no route to the daemon, to `host.docker.internal`, to the docker bridge
 * gateway, to the LAN or to the internet — while still being able to install dependencies
 * through the proxy. `proxy` only decides whether that volume is mounted and the bridge
 * started.
 */
export function planContainerRun(input: ContainerPlanInput): ContainerPlan {
  const image = input.image ?? EXEC_IMAGE;
  const roots = [...(input.roots ?? [])];
  const writable = new Set(input.writableRoots ?? []);
  const mounts: ContainerMount[] = roots.map((path, index) => ({
    path,
    target: containerMountTarget(index),
    mode: writable.has(path) ? 'rw' : 'ro',
  }));
  // An egress request without a live channel is not silently downgraded to "no network":
  // the Broker refuses such a call before it gets here (`PROVIDER_UNAVAILABLE`), so this
  // only decides whether the channel is attached for a call that does not need it.
  const network = input.network ?? 'none';
  const egress =
    network === 'proxy' && input.egress?.available() === true ? input.egress : undefined;
  const workdir = input.workdir ?? containerMountTarget(0);
  const args: string[] = [
    'run',
    '--rm',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=256m',
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '--memory',
    '2g',
    '--cpus',
    '2',
    '--network',
    'none',
    '--user',
    '10001:10001',
  ];
  for (const mount of mounts) {
    args.push('--volume', `${mount.path}:${mount.target}:${mount.mode}`);
  }
  if (egress !== undefined) {
    // A named volume, mounted read-only: the tool can `connect(2)` the socket but cannot
    // unlink it (the mount is read-only), and the volume is invisible to the host, so a
    // container cannot use it to smuggle a file into the daemon.
    args.push('--mount', `type=volume,source=${egress.volume},target=${egress.mountPath},readonly`);
  }
  for (const [key, value] of Object.entries(input.env ?? {})) {
    args.push('--env', `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(
    egress === undefined ? {} : egressToolEnv(egress.mountPath),
  )) {
    args.push('--env', `${key}=${value}`);
  }
  // The bridge starts before the tool command; the command itself travels through the
  // environment so a model-supplied shell string is never concatenated into a wrapper.
  args.push(
    '--env',
    `${EGRESS_COMMAND_ENV}=${input.command}`,
    '--workdir',
    workdir,
    image,
    '-lc',
    egress === undefined ? input.command : egressWrapperCommand(),
  );
  return {
    image,
    command: input.command,
    args,
    mounts,
    network: egress === undefined ? 'none' : 'proxy',
    user: '10001:10001',
    workdir,
  };
}

/** The default execution image tag (`apps/cli doctor` reports its digest). */
export const EXEC_IMAGE = 'agentdev/exec:0.0.0';

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------

export interface ToolInvocation {
  readonly workId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly role: Role;
  readonly stage: string;
  /** `Scope.operations` name, e.g. `read`, `write`, `bash`, `network`. */
  readonly operation: string;
  /** Repository-relative targets; the Grant is evaluated on exactly these. */
  readonly targets: readonly string[];
  /** The decoded tool input; only its hash is persisted. */
  readonly input: unknown;
  readonly mode?: ExecutionMode;
  readonly at?: string;
  readonly toolOperationId?: string;
  readonly argsRef?: string;
  readonly toolName?: string;
  /** Absolute roots a file target must resolve inside. */
  readonly roots?: readonly string[];
  /**
   * Absolute working directory for a shell call.
   *
   * Validated against `roots` exactly like a target, so a `bash`/`git` invocation
   * cannot walk out of the authorized tree through its `cwd`.
   */
  readonly cwd?: string;
  /** Roots that may be written; everything else is read-only (container mode). */
  readonly writableRoots?: readonly string[];
  readonly access?: 'read' | 'write';
  /** A network use the call declares; evaluated by the policy before admission. */
  readonly network?: NetworkTargetSpec;
  /** Exact targets the user authorized for this call (from the Grant). */
  readonly allowedNetworkTargets?: readonly string[];
  /** The tool body; when omitted the Broker performs the built-in operation. */
  readonly run?: (context: ToolContext) => unknown;
  readonly timeoutMs?: number;
  /**
   * Aborted when the caller went away (the Runner's socket closed, the turn was
   * cancelled). A shell call's whole process group is terminated on abort, which is what
   * lets a cancel reach a tool the daemon itself started (`reliability.md` §6).
   */
  readonly signal?: AbortSignal;
  /**
   * Tool-audience secret values injected into the child process environment (`AC-051`).
   *
   * Only the daemon sets this: it resolves the refs from the Run's `secret` Grant through
   * `SecretStore.environmentFor`, so the values reach exactly one child process and never
   * the audit rows, the tool result body or the model's context beyond what the command
   * itself prints. A Runner cannot inject anything, because the endpoint builds the
   * invocation from server-side facts plus the tool name and arguments.
   */
  readonly secretEnv?: Readonly<Record<string, string>>;
  /**
   * The effective sensitive-file tier this call was planned under (`T3-implementation.md`
   * 附录 A.7).
   *
   * The admission layer has already refused a target the frozen table covers; the Broker
   * forwards the tier so a **directory search** can skip the listed files during its walk
   * instead of reading them and filtering afterwards — "search 不同表生效等于没拦". It
   * travels on the invocation rather than in a global so two projects with different
   * tiers cannot influence each other's tools.
   */
  readonly configPolicy?: ConfigPolicy;
}

/**
 * A shell input: either a command line handed to `/bin/sh -lc`, or an argv vector.
 *
 * The argv form exists so `git` is never assembled into a shell string: the tool's
 * arguments come from the model, and a `;` in a path would otherwise become command
 * syntax. `bash` keeps the string form because a shell command *is* its contract.
 */
export type ToolCommandInput =
  string | { readonly program: string; readonly args: readonly string[] };

export interface ToolAsyncRunOptions {
  /** Overrides the invocation's own deadline (already clamped by the Grant). */
  readonly timeoutMs?: number;
  /** Grace between the terminating `SIGTERM` and the `SIGKILL`. */
  readonly cancelGraceMs?: number;
  /** Aborting cancels the process group; the Pi tool signal is threaded here. */
  readonly signal?: AbortSignal | undefined;
  /** Bytes written to the child's stdin (container writes use the sync path instead). */
  readonly stdin?: string;
}

/** What a tool body receives: the mode plus boundary-checked primitives. */
export interface ToolContext {
  readonly mode: ExecutionMode;
  readonly operation: string;
  readonly inputHash: string;
  readonly toolOperationId: string;
  readonly targets: readonly string[];
  /** The resolved real paths of the targets, already checked inside the roots. */
  readonly paths: readonly string[];
  readonly roots: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /**
   * The sensitive-file tier this call runs under (`T3-implementation.md` 附录 A.7).
   *
   * A tool body that walks a directory (the literal search) reads it so the walk skips
   * the frozen list at the point of reading rather than after the content already
   * entered a result. Defaults to `strict` when the caller declared nothing.
   */
  readonly sensitiveTier: ConfigPolicy;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  run(command: string): ProcessResult;
  /**
   * Runs a command **asynchronously** in its own process group.
   *
   * This is the tool execution path (`reliability.md` §5/§6): it does not block the
   * daemon, it can be cancelled through {@link ToolAsyncRunOptions.signal} or by the
   * Attempt-scoped `ToolProcessRegistry`, and cancellation escalates from `SIGTERM` to
   * `SIGKILL` over the whole process tree. A read-only role receives a rejecting body
   * instead of a shell, exactly like {@link ToolContext.run}.
   */
  runAsync(input: ToolCommandInput, options?: ToolAsyncRunOptions): Promise<AsyncProcessResult>;
  request(
    url: string,
    init?: { readonly method?: string; readonly headers?: Readonly<Record<string, string>> },
  ): Promise<NetworkFetchOutcome>;
}

export interface ToolSuccess {
  readonly ok: true;
  readonly outcome: 'executed' | 'replayed';
  readonly mode: ExecutionMode;
  readonly operation: string;
  readonly inputHash: string;
  readonly toolOperationId: string;
  readonly grantId: string;
  readonly result: unknown;
  readonly toolOperation: ToolOperation;
  readonly grant: Grant;
  /**
   * The Attempt's read-ledger binding after this call (`AC-085`).
   *
   * Set by the daemon handler, which owns the ledger; the Broker neither reads nor writes
   * the ledger and simply carries the value back to the endpoint, which returns it to the
   * Runner so `stage_yield` can report the real binding instead of a placeholder.
   */
  readonly ledger?: { readonly seq: number; readonly hash: string };
}

export interface ToolRefusal {
  readonly ok: false;
  readonly code: BrokerErrorCode;
  readonly reason: string;
  readonly fields: readonly string[];
  readonly mode: ExecutionMode;
  readonly operation: string;
  readonly inputHash: string;
  readonly toolOperationId: string;
}

export type ToolOutcome = ToolSuccess | ToolRefusal;

/**
 * The roots no role may read or write, derived from the store rather than from
 * caller input (W7R1-04).
 *
 * `execution.md` §3: "运行数据库、其他Session/Transcript、全局SecretStore不挂载
 * 到Agent或工具". The project state directory holds exactly those things for this
 * process — `project.sqlite`, the content-addressed blob store and the migration
 * backups — so it is protected structurally. `protectedPaths` stays available as
 * an extra narrowing (other sessions' transcript directories, a relocated secret
 * store) and can never widen the derived set.
 *
 * Every derived root is canonicalised at construction: protection must not depend
 * on the caller's working directory, and a path that does not exist yet is
 * normalised rather than skipped.
 */
export function deriveProtectedPaths(
  store: ProjectStore,
  dataDir: string | undefined,
  extra: readonly string[],
): string[] {
  const roots = new Set<string>();
  const stateDir = dataDir ?? store.dataDir;
  // The documented default: the configuration data directory, including the
  // store file, blobs and backups.
  roots.add(canonicalExisting(stateDir));
  roots.add(canonicalExisting(join(stateDir, 'project.sqlite')));
  for (const path of extra) roots.add(canonicalExisting(path));
  return [...roots];
}

/** The report/scratch root a write is allowed to target, when the role may have one. */
function reportWriteRootsFor(
  invocation: ToolInvocation,
  access: 'read' | 'write',
  reportRoots: readonly string[],
): readonly string[] {
  if (access !== 'write' || !isReadOnlyRole(invocation.role)) return [];
  return reportRoots;
}

/**
 * One project-declared acceptance command a Test Run asks the Broker to execute.
 *
 * `stage` is the Run's own stage (always `test` in the documented route) and
 * `roots` is the Run's workspace root. There is no `targets`, no model input and no
 * tool operation id: the command is the whole contract and it must be declared.
 */
export interface DeclaredTestCommandInvocation {
  readonly workId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly role: 'test';
  readonly stage: string;
  readonly command: string;
  /** Absolute workspace roots to mount; the first becomes the container workdir. */
  readonly roots: readonly string[];
  readonly timeoutMs?: number;
}

/** The result of one declared test command: the real process result, or a refusal. */
export type DeclaredTestCommandOutcome =
  | {
      readonly ok: true;
      readonly mode: 'container';
      readonly result: ProcessResult;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly code: BrokerErrorCode;
      readonly reason: string;
    };

export interface BrokerOptions {
  readonly store: ProjectStore;
  readonly grants: GrantStore;
  readonly now?: () => string;
  /** Default mode for calls that do not name one. */
  readonly mode?: ExecutionMode;
  readonly execImage?: string;
  /** Injectable Docker probe; the default runs `docker version`. */
  readonly docker?: DockerProbe;
  /**
   * The **synchronous** process seam (bounded container file primitives and tests).
   *
   * Tool shells do not use it; see `asyncProcess`.
   */
  readonly process?: ProcessRunner;
  /**
   * The asynchronous process port every `bash`/`git` call runs through.
   *
   * Defaults to the real {@link defaultAsyncProcessRunner}: a detached process group
   * with a `SIGTERM`→`SIGKILL` escalation (`reliability.md` §5/§6).
   */
  readonly asyncProcess?: AsyncProcessRunner;
  /**
   * The live tool processes of every Attempt, so a cancel can reach them.
   *
   * A daemon normally constructs one registry and passes it in, because the same
   * object is what `onAttemptEnded`, `attempt.abort` and shutdown call
   * (`reliability.md` §6/§7). A Broker built without one owns a private registry,
   * reachable through {@link Broker.processes}.
   */
  readonly toolProcesses?: ToolProcessRegistry;
  /** Extra exact network targets the user authorized globally. */
  readonly allowedNetworkTargets?: readonly string[];
  /**
   * Paths no role may ever read or write (run DB, other sessions).
   *
   * These are *additional* to the roots the Broker derives from its store
   * (W7R1-04): the project state directory (which holds `project.sqlite`, the
   * blob store and migration backups) is always protected, so a Grant cannot
   * authorize reading the run database.
   */
  readonly protectedPaths?: readonly string[];
  /**
   * The project state directory whose contents are structurally protected.
   *
   * Defaults to `store.dataDir`. A caller that stores the run database elsewhere
   * passes that location here, because protection must not depend on the caller
   * remembering to list it in `protectedPaths`.
   */
  readonly dataDir?: string;
  /**
   * Report/scratch roots a Review or Test Run may write to
   * (`execution.md` §3: Review owns "自己报告与检查临时目录", Test owns "隔离构建
   * 目录、测试数据和报告"). Source and run-database writes stay refused.
   */
  readonly writableReportRoots?: readonly string[];
  /** Injected DNS port for the network policy; defaults to a real lookup. */
  readonly resolver?: HostResolver;
  /** NAT64 prefixes whose embedded IPv4 is decoded (W7R2-06). */
  readonly nat64Prefixes?: readonly string[];
  /**
   * Injected transport for the guarded requester.
   *
   * Defaults to {@link defaultNetworkFetcher}; a caller may supply its own (for
   * example a proxy-aware transport) and honour `pinnedAddresses` itself.
   */
  readonly fetcher?: NetworkFetcher;
  /** Explicit opt-in for plaintext `http:` on an authorized local test endpoint. */
  readonly allowInsecureHttp?: boolean;
  /**
   * The ports the daemon **actually** bound, read live (first fixed denial).
   *
   * A function, because the control endpoint and the model-gateway proxy bind ephemeral
   * ports at runtime; `w1-implementation.md` §7.2 requires the real values, not constants.
   */
  readonly daemonPorts?: () => readonly number[];
  /**
   * The controlled channel the containers use to reach the network
   * (`execution.md` §2/§4, `w1-implementation.md` §7).
   *
   * When it is present and live, a tool shell is given the mounted socket and its
   * `HTTP(S)_PROXY` environment; the container itself stays on `--network none`, so the
   * Channel is its only egress. When it is absent, a call whose Grant covers network is
   * refused rather than opened (`PROVIDER_UNAVAILABLE`).
   */
  readonly egress?: ContainerEgressChannel;
  /**
   * The commands the project declares as its acceptance commands
   * (`policy.testCommands`, `protocol.md` §1 `ConfigPatch`).
   *
   * This is the **only** authority under which {@link Broker.runDeclaredTestCommand}
   * executes a shell for a Test Run. The set is human-authored project configuration,
   * never model output, and it is read live so a configuration edit cannot be
   * bypassed by a stale copy. Absent means no declared-command path exists at all
   * (the method refuses), which is the fail-closed default.
   */
  readonly declaredTestCommands?: () => readonly string[];
}

export class Broker {
  private readonly store: ProjectStore;
  private readonly grants: GrantStore;
  private readonly now: () => string;
  private readonly defaultMode: ExecutionMode;
  private readonly execImage: string;
  private readonly docker: DockerProbe;
  private readonly process: ProcessRunner;
  private readonly asyncProcess: AsyncProcessRunner;
  private readonly toolProcesses: ToolProcessRegistry;
  private readonly allowedNetworkTargets: readonly string[];
  private readonly protectedPaths: readonly string[];
  private readonly writableReportRoots: readonly string[];
  private readonly resolver: HostResolver;
  private readonly nat64Prefixes: readonly string[];
  private readonly fetcher: NetworkFetcher;
  private readonly allowInsecureHttp: boolean;
  private readonly daemonPorts: () => readonly number[];
  private readonly egressChannel: ContainerEgressChannel | undefined;
  private readonly declaredTestCommands: (() => readonly string[]) | undefined;

  constructor(options: BrokerOptions) {
    this.store = options.store;
    this.grants = options.grants;
    this.now = options.now ?? (() => options.store.now());
    this.defaultMode = options.mode ?? 'host';
    this.execImage = options.execImage ?? EXEC_IMAGE;
    this.docker = options.docker ?? probeDockerAvailability;
    this.process = options.process ?? defaultProcessRunner;
    this.asyncProcess = options.asyncProcess ?? defaultAsyncProcessRunner;
    this.toolProcesses = options.toolProcesses ?? new ToolProcessRegistry();
    this.allowedNetworkTargets = options.allowedNetworkTargets ?? [];
    // W7R1-04: the run database is protected structurally, not by caller input.
    this.protectedPaths = deriveProtectedPaths(
      options.store,
      options.dataDir,
      options.protectedPaths ?? [],
    );
    this.writableReportRoots = (options.writableReportRoots ?? []).map(canonicalExisting);
    this.resolver = options.resolver ?? defaultHostResolver;
    this.nat64Prefixes = options.nat64Prefixes ?? DEFAULT_NAT64_PREFIXES;
    this.fetcher = options.fetcher ?? defaultNetworkFetcher;
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;
    this.daemonPorts = options.daemonPorts ?? (() => []);
    this.egressChannel = options.egress;
    this.declaredTestCommands = options.declaredTestCommands;
  }

  /** The roots no role may read or write; the derived run-data roots included. */
  get protectedRoots(): readonly string[] {
    return this.protectedPaths;
  }

  /** The report/scratch roots Review and Test may write inside. */
  get reportRoots(): readonly string[] {
    return this.writableReportRoots;
  }

  /** The live tool processes, so the supervisor can cancel an Attempt's tree. */
  get processes(): ToolProcessRegistry {
    return this.toolProcesses;
  }

  /** The execution image every container call (and declared test command) runs in. */
  get execImageTag(): string {
    return this.execImage;
  }

  /** The policy a call's network targets are evaluated against. */
  networkPolicy(invocation: Pick<ToolInvocation, 'allowedNetworkTargets'>): NetworkPolicy {
    return this.buildNetworkPolicy(invocation.allowedNetworkTargets ?? []);
  }

  /**
   * The policy an admission-layer caller evaluates a *literal* target with.
   *
   * `tool-handler.ts` uses this for the URLs a shell command spells out; it is the same
   * object — same two fixed denials, same live bound-port registry — the Egress proxy and
   * the Broker's own admission use, so the pre-check cannot disagree with the egress.
   */
  egressPolicy(): NetworkPolicy {
    return this.buildNetworkPolicy([]);
  }

  /** The live controlled channel, when this daemon started one. */
  get egress(): ContainerEgressChannel | undefined {
    return this.egressChannel;
  }

  /**
   * Runs one **project-declared** acceptance command for a Test Run.
   *
   * `execution.md` §5 gives the Test stage a real execution environment and
   * `workflow.md` §3 makes the Test stage the route's evidence point, but
   * `execution.md` §7 keeps the Test role shell-less: the model cannot run commands.
   * Core therefore runs the commands the **project** declares (`policy.testCommands`,
   * the documented `ConfigPatch` field) on the Test Run's behalf, and this method is
   * that path. Its guarantees, all of which are refusals otherwise:
   *
   * - **The command is declared.** It must be one of {@link BrokerOptions.declaredTestCommands};
   *   anything else is `NOT_AUTHORIZED`, so a model that somehow reached this method
   *   still cannot run an undeclared program.
   * - **The role is Test.** Only a `test` Run may use the path, so it can never widen
   *   a Developer or Chief Run's toolset.
   * - **The mode is the container.** The call is pinned to `mode: 'container'`; there
   *   is no host fallback. Docker being unavailable is `PROVIDER_UNAVAILABLE`, exactly
   *   like every other container call ("缺Docker即阻断独立验证", `execution.md` §1).
   * - **The same boundary as a tool shell.** It goes through
   *   {@link Broker.commandVector}/`containerPlan`, so the container keeps
   *   `--network none`, the read-only mounts, the hardening flags and the controlled
   *   egress channel; nothing new is opened.
   *
   * The invocation is deliberately **not** a `tool.execute`: the model's tool bridge never
   * sees it, so no capability and no model-supplied argument is involved. It is recorded
   * as a `test.command_executed` audit event with the real command and exit code
   * (`reliability.md` §2's audit intent) and is registered in the Attempt's process
   * registry, so a cancel or an Attempt end reaps the group like any other shell.
   */
  async runDeclaredTestCommand(
    input: DeclaredTestCommandInvocation,
  ): Promise<DeclaredTestCommandOutcome> {
    const declared = this.declaredTestCommands;
    if (declared === undefined) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason:
          'this daemon has no declared test commands wired; a Test Run cannot execute an acceptance command',
      };
    }
    if (input.role !== 'test') {
      // `input.role` is typed as the `test` literal; this is the runtime guard for a
      // caller outside the type system, and a fixed message keeps it honest.
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: 'declared test commands run only for the test role',
      };
    }
    const command = input.command;
    if (command.trim() === '') {
      return { ok: false, code: 'VALIDATION_ERROR', reason: 'a test command must not be empty' };
    }
    const available = declared();
    if (!available.includes(command)) {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: `command ${JSON.stringify(command)} is not one of the project's declared testCommands`,
      };
    }
    if (input.roots.length === 0) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        reason: 'a test command needs the Run workspace root to mount',
      };
    }
    const availability = this.docker(this.execImage);
    if (!availability.available) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        reason: `declared test command refused: ${availability.reason}; the Broker does not fall back to host execution`,
      };
    }
    if (this.egressChannel !== undefined) {
      await this.egressChannel.ensure().catch(() => false);
    }
    const timeoutMs = input.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const invocation: ToolInvocation = {
      workId: input.workId,
      runId: input.runId,
      attemptId: input.attemptId,
      epoch: input.epoch,
      role: 'test',
      stage: input.stage,
      operation: 'bash',
      targets: [],
      input: { command },
      roots: [...input.roots],
      mode: 'container',
      timeoutMs,
    };
    const started = Date.now();
    let result: ProcessResult;
    try {
      result = await this.runCommandAsync(command, invocation, 'container', { timeoutMs });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.recordTestCommand(input, command, null, null, Date.now() - started, reason);
      return { ok: false, code: asBrokerErrorCode('INTERNAL_ERROR'), reason };
    }
    const durationMs = Date.now() - started;
    this.recordTestCommand(input, command, result.status, result.signal, durationMs);
    return { ok: true, mode: 'container', result, durationMs };
  }

  /** Appends the audit event for one declared test command (`reliability.md` §2). */
  private recordTestCommand(
    input: DeclaredTestCommandInvocation,
    command: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    durationMs: number,
    error?: string,
  ): void {
    const run = this.store.runs.find(input.runId);
    this.store.events.append({
      name: 'test.command_executed',
      entityId: input.runId,
      entityVersion: run?.version ?? 0,
      data: {
        workId: input.workId,
        runId: input.runId,
        attemptId: input.attemptId,
        stage: input.stage,
        command,
        exitCode,
        signal,
        durationMs,
        ...(error === undefined ? {} : { error }),
      },
    });
  }

  private buildNetworkPolicy(extraTargets: readonly string[]): NetworkPolicy {
    return new NetworkPolicy({
      allowedTargets: [...this.allowedNetworkTargets, ...extraTargets],
      resolver: this.resolver,
      nat64Prefixes: this.nat64Prefixes,
      allowInsecureHttp: this.allowInsecureHttp,
      daemonPorts: this.daemonPorts,
      localAddresses: () => hostInterfaceAddresses(),
    });
  }

  /** A policy-guarded requester; the transport a network tool must use. */
  networkRequester(invocation: Pick<ToolInvocation, 'allowedNetworkTargets'>): GuardedRequester {
    return new GuardedRequester({
      policy: this.networkPolicy(invocation),
      resolver: this.resolver,
      fetcher: this.fetcher,
    });
  }

  /**
   * Admits and runs one tool call.
   *
   * Every branch that refuses returns a typed outcome and appends a
   * `tool.refused` audit event; nothing executes on a refusal. An admitted call
   * is recorded by `GrantStore.consumeOnceAsync` as a `tool_operation` row (tool name,
   * input hash, Grant reference, state) and by a `tool.invoked` event.
   *
   * The method is **async** because network admission resolves DNS before deciding
   * (W7R2-02) and because the tool body itself may be asynchronous: a target whose
   * name resolves into private space is refused before `consumeOnceAsync`, so no
   * Grant is consumed and no `tool_operation` row is written.
   */
  async invoke(invocation: ToolInvocation): Promise<ToolOutcome> {
    const at = invocation.at ?? this.now();
    const mode = invocation.mode ?? this.defaultMode;
    const operation = invocation.operation;
    const inputHash = hashToolInput(invocation.input);
    const toolOperationId = invocation.toolOperationId ?? uuidv7();
    const argsRef = invocation.argsRef ?? uuidv7();
    const toolName = invocation.toolName ?? operation;

    const refuse = (
      code: BrokerErrorCode,
      reason: string,
      fields: readonly string[] = [],
    ): ToolRefusal => {
      this.recordRefusal({ invocation, mode, operation, inputHash, toolOperationId, code, reason });
      return { ok: false, code, reason, fields, mode, operation, inputHash, toolOperationId };
    };

    // 1. Shape. A malformed call must not reach the Grant or a process.
    const shape = validateInvocation(invocation);
    if (shape !== undefined) return refuse(shape.code, shape.reason, shape.fields);

    // 2. Role gate (AC-050). Review/Test never gain a write to source or
    //    verification input, in any mode. The question is a tool's **capability**,
    //    not its name (W7R2-01): only a mutating tool whose whole effect is a path
    //    can be confined to a declared report root; `bash`/`git` run an arbitrary
    //    command, and `push`/`deploy`/an unknown name have no path to bound, so all
    //    of them are refused outright for a read-only role.
    const capability = toolCapability(operation);
    const access = declaredAccess(operation, invocation.access);
    const writeRoots = reportWriteRootsFor(invocation, access, this.writableReportRoots);
    if (isReadOnlyRole(invocation.role) && capability === 'mutating') {
      if (isArbitraryCommandOperation(operation)) {
        return refuse(
          'NOT_AUTHORIZED',
          `${invocation.role} runs are read-only; ${operation} executes an arbitrary command and cannot be confined to a report/scratch root`,
          ['role', 'operation'],
        );
      }
      if (!isFileOperation(operation)) {
        return refuse(
          'NOT_AUTHORIZED',
          `${invocation.role} runs are read-only; ${operation} is not confined to a path inside a report/scratch root`,
          ['role', 'operation'],
        );
      }
      if (writeRoots.length === 0) {
        return refuse(
          'NOT_AUTHORIZED',
          `${invocation.role} runs are read-only; ${operation} cannot write source or verification input`,
          ['role'],
        );
      }
    }
    if (invocation.access === 'write' && capability === 'read-only') {
      return refuse(
        'VALIDATION_ERROR',
        `operation ${operation} is read-only but was declared as a write`,
      );
    }

    // 3. File boundary. Checked before admission and re-checked on open, so a
    //    refusal never depends on the tool body being well behaved. A Review/Test
    //    write additionally needs an explicit report root; source stays refused.
    const roots = (invocation.roots ?? []).map(canonicalExisting);
    const paths: string[] = [];
    if (isFileOperation(operation) && (roots.length > 0 || writeRoots.length > 0)) {
      for (const target of invocation.targets) {
        // Relative targets resolve against the source root; a read-only role's
        // write is then confined to its report/scratch root (W7R1-13).
        const decision = resolveWithinRoots({
          path: target,
          access,
          roots: roots.length === 0 ? writeRoots : roots,
          ...(access === 'write' && isReadOnlyRole(invocation.role) && writeRoots.length > 0
            ? { writeRoots }
            : {}),
          protectedPaths: this.protectedPaths,
        });
        if (!decision.ok) {
          return refuse(
            decision.code,
            isReadOnlyRole(invocation.role) && access === 'write'
              ? `${decision.reason}; ${invocation.role} may only write inside its report/scratch root [${this.writableReportRoots.join(', ')}]`
              : decision.reason,
            ['targets'],
          );
        }
        paths.push(decision.realPath);
      }
    }
    if (requiresRoots(operation) && roots.length === 0 && writeRoots.length === 0) {
      return refuse(
        'VALIDATION_ERROR',
        `operation ${operation} needs the allowed roots to verify its targets`,
        ['roots'],
      );
    }
    // A shell call's working directory is a boundary too: without this check a `bash`
    // could `cd` out of the authorized tree (or read the run database) before running
    // its command, which no `targets` rule would see.
    if (invocation.cwd !== undefined) {
      if (roots.length === 0) {
        return refuse(
          'VALIDATION_ERROR',
          `operation ${operation} declared a cwd but no allowed roots to verify it`,
          ['cwd'],
        );
      }
      const decision = resolveWithinRoots({
        path: invocation.cwd,
        access: 'read',
        roots,
        protectedPaths: this.protectedPaths,
      });
      if (!decision.ok) {
        return refuse(decision.code, `cwd refused: ${decision.reason}`, ['cwd']);
      }
    }

    // 4. Network boundary, before anything leaves the process. The decision is
    //    awaited, so a name resolving into private space (or not resolving at all)
    //    is refused here — before step 6 consumes the Grant (W7R2-02).
    if (operation === 'network' || invocation.network !== undefined) {
      const decision = await this.networkPolicy(invocation).decide(invocation.network ?? {});
      if (!decision.ok) return refuse(decision.code, decision.reason, ['network']);
    }

    // 5. Execution environment. A container call without Docker is refused with
    //    its reason; it is never downgraded to the host.
    if (mode === 'container') {
      const availability = this.docker(this.execImage);
      if (!availability.available) {
        return refuse(
          'PROVIDER_UNAVAILABLE',
          `container mode refused: ${availability.reason}; the Broker does not fall back to host execution`,
          ['mode'],
        );
      }
      // Bring the controlled egress up **before** the container exists, so the first tool
      // call already has a live channel. A channel that cannot start is not fatal: the
      // container simply has no network, and the network-covered branch below says so.
      if (this.egressChannel !== undefined) {
        // `ensure` is a container lifecycle call; a throwing implementation must leave the
        // channel unavailable rather than break admission, which is exactly what the
        // network-covered branch below turns into a typed refusal.
        await this.egressChannel.ensure().catch(() => false);
      }
    }
    // A container may only reach the network through the Core-controlled proxy.
    // With no live egress channel, a call whose Grant covers network is refused outright
    // rather than being given an open network path. The container *never* gets an IP
    // network: when the channel is missing the network is simply absent, and saying so is
    // louder than letting the tool fail with a connection error.
    if (mode === 'container' && this.networkCovered(invocation, at)) {
      if (this.egressChannel === undefined || !this.egressChannel.available()) {
        return refuse(
          'PROVIDER_UNAVAILABLE',
          'container network is refused: no Core-controlled egress channel is live; the Broker does not open a direct network path',
          ['network'],
        );
      }
    }

    // 6. Admission through the Grant service, then execution.
    const context = this.contextFor({
      invocation,
      mode,
      operation,
      inputHash,
      toolOperationId,
      roots,
      paths,
      at,
    });
    const request = {
      workId: invocation.workId,
      role: invocation.role,
      stage: invocation.stage,
      operation,
      targets: invocation.targets,
      at,
      runId: invocation.runId,
      toolName,
      toolOperationId,
      inputHash,
      argsRef,
      attemptId: invocation.attemptId,
      epoch: invocation.epoch,
      // The two spends the Grant's `limits` can cap (`domain/evaluateGrant`): the
      // encoded input size and the effective deadline. They are measured here because
      // this is where the canonical input already exists and where the mode/limits
      // decide the deadline; `GrantStore` adds the recorded call count.
      inputBytes: Buffer.byteLength(canonicalJson(invocation.input ?? {}), 'utf8'),
      durationSec: Math.ceil((invocation.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS) / 1000),
      executor: () => this.execute(invocation, context),
    };
    let consumed;
    try {
      // `consumeOnceAsync` awaits the tool body outside the database transaction,
      // so an asynchronous body is recorded with its resolved value and a failing
      // body rolls the claim back (W7R3-02).
      consumed = await this.grants.consumeOnceAsync(request);
    } catch (error) {
      // A `ProtocolError` here is a recovery state (`core/grants.ts` replay of a
      // result the store cannot resolve); it is surfaced, never swallowed.
      if (error instanceof ProtocolError) {
        return refuse(asBrokerErrorCode(error.code), error.message, []);
      }
      throw error;
    }
    if (consumed.outcome === 'refused') {
      return refuse(consumed.code, consumed.reason, consumed.fields);
    }
    this.store.events.append({
      name: TOOL_EVENTS.invoked,
      entityId: consumed.toolOperation.id,
      entityVersion: consumed.toolOperation.version,
      data: {
        workId: invocation.workId,
        runId: invocation.runId,
        operation,
        inputHash,
        grantId: consumed.grant.id,
        toolOperationId: consumed.toolOperation.id,
        outcome: consumed.outcome,
        mode,
      },
    });
    return {
      ok: true,
      outcome: consumed.outcome,
      mode,
      operation,
      inputHash,
      toolOperationId: consumed.toolOperation.id,
      grantId: consumed.grant.id,
      result: consumed.result,
      toolOperation: consumed.toolOperation,
      grant: consumed.grant,
    };
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  private async execute(invocation: ToolInvocation, context: ToolContext): Promise<unknown> {
    if (invocation.run !== undefined) return invocation.run(context);
    switch (invocation.operation) {
      case 'read':
      case 'search': {
        const contents = context.paths.map((path) => ({
          path,
          content: context.readFile(path),
        }));
        return contents.length === 1 ? contents[0]?.content : contents;
      }
      case 'write':
      case 'edit':
      case 'artifact_write': {
        const content = readInputString(invocation.input, 'content');
        for (const path of context.paths) context.writeFile(path, content);
        return { written: context.paths.length };
      }
      case 'bash':
      case 'git': {
        // An `argv` input is spawned directly (`git`), so a model-supplied argument
        // that contains shell syntax stays an argument; a plain `command` keeps the
        // `/bin/sh -lc` semantics `bash` promises.
        const argv = readInputArgv(invocation.input);
        const command = readInputString(invocation.input, 'command');
        // The asynchronous, cancellable port (`reliability.md` §5/§6): the tool shell
        // never blocks the daemon's event loop and its whole process tree can be
        // reaped on timeout, abort or cancel.
        return context.runAsync(
          argv === undefined ? command : { program: argv[0] ?? '', args: argv.slice(1) },
          {
            ...(invocation.timeoutMs === undefined ? {} : { timeoutMs: invocation.timeoutMs }),
            ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
          },
        );
      }
      default:
        // No built-in executor exists for network/secret/push/deploy. Inventing a
        // result here would present an unexecuted tool as finished, so the call is
        // refused and the transaction (Grant consumption + tool operation) rolls
        // back. A caller with a real transport supplies it through `run`.
        throw new ProtocolError(
          'INVALID_STATE',
          `operation ${invocation.operation} has no built-in executor; supply run() with the tool body`,
          { details: { operation: invocation.operation } },
        );
    }
  }

  private contextFor(input: {
    invocation: ToolInvocation;
    mode: ExecutionMode;
    operation: string;
    inputHash: string;
    toolOperationId: string;
    roots: readonly string[];
    paths: readonly string[];
    at: string;
  }): ToolContext {
    const { invocation, mode, operation, inputHash, toolOperationId, roots, paths } = input;
    const requester = this.networkRequester(invocation);
    const readOnly = isReadOnlyRole(invocation.role);
    const check = (path: string, checkAccess: 'read' | 'write'): string => {
      // A read-only role's write boundary must **not** come from the call's
      // declared access (W7R3-01): a `read` call has `access: 'read'`, so
      // deriving the write roots from it handed the tool body an unrestricted
      // `writeFile` into source. Review/Test may only ever write inside the
      // configured report/scratch roots, whatever access the call declared.
      if (checkAccess === 'write' && readOnly) {
        if (this.writableReportRoots.length === 0) {
          throw new ProtocolError(
            'NOT_AUTHORIZED',
            `${invocation.role} runs are read-only; no report/scratch root is configured to write ${path}`,
            { details: { path } },
          );
        }
        const writeDecision = resolveWithinRoots({
          path,
          access: 'write',
          roots: this.writableReportRoots,
          protectedPaths: this.protectedPaths,
        });
        if (!writeDecision.ok) {
          throw new ProtocolError(writeDecision.code, writeDecision.reason, { details: { path } });
        }
        return writeDecision.realPath;
      }
      const decision = resolveWithinRoots({
        path,
        access: checkAccess,
        roots,
        protectedPaths: this.protectedPaths,
      });
      if (!decision.ok) {
        throw new ProtocolError(decision.code, decision.reason, { details: { path } });
      }
      return decision.realPath;
    };
    return {
      mode,
      operation,
      inputHash,
      toolOperationId,
      targets: invocation.targets,
      paths,
      roots,
      env: {},
      sensitiveTier: invocation.configPolicy ?? 'strict',
      readFile: (path) => {
        const real = check(path, 'read');
        if (mode === 'container') return this.containerRead(real, invocation);
        return readFileSync(real, 'utf8');
      },
      writeFile: (path, content) => {
        const real = check(path, 'write');
        if (mode === 'container') {
          this.containerWrite(real, content, invocation);
          return;
        }
        writeFileSync(real, content, 'utf8');
      },
      run: (command) =>
        // A read-only role never receives a run-capable context (W7R3-01): the
        // stub fails closed with a typed refusal instead of executing a shell,
        // and the tool body's call is what surfaces it.
        readOnly
          ? refuseReadOnlyCommand(invocation.role, operation)
          : this.runCommand(command, invocation, mode),
      runAsync: (input, options) =>
        readOnly
          ? Promise.reject(
              new ProtocolError(
                'NOT_AUTHORIZED',
                `${invocation.role} runs are read-only; the ${operation} tool body cannot execute shell commands`,
                { details: { role: invocation.role, operation } },
              ),
            )
          : this.runCommandAsync(input, invocation, mode, options ?? {}),
      request: (url, init) => requester.request(url, init ?? {}),
    };
  }

  /**
   * Runs a shell command under the mode's isolation.
   *
   * Container runs get the full hardening plan; host runs inherit the authorized
   * account, exactly as `execution.md` §2 describes ("Full Access工具宿主进程继承
   * 授权执行账户，但仍经Broker控制工具准入和领域Gate").
   */
  private runCommand(
    command: string,
    invocation: ToolInvocation,
    mode: ExecutionMode,
  ): ProcessResult {
    if (mode === 'container') {
      const plan = this.containerPlan(command, invocation, { egress: true });
      return this.process.run('docker', plan.args, {
        timeoutMs: invocation.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      });
    }
    return this.process.run('/bin/sh', ['-lc', command], {
      timeoutMs: invocation.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    });
  }

  /**
   * The asynchronous, cancellable form of {@link runCommand} (`reliability.md` §5/§6).
   *
   * The command runs in its own process group through the injected
   * {@link AsyncProcessRunner}, registered under the Attempt so a cancel, a lost
   * heartbeat or a graceful shutdown can reap the whole tree. An argv input is spawned
   * directly rather than assembled into a shell string, so a `git` argument can never
   * become shell syntax; a string input keeps `/bin/sh -lc` semantics because that *is*
   * the `bash` contract. Container mode wraps either form in the same hardened
   * `docker run` plan the synchronous path used.
   */
  private async runCommandAsync(
    input: ToolCommandInput,
    invocation: ToolInvocation,
    mode: ExecutionMode,
    options: ToolAsyncRunOptions,
  ): Promise<AsyncProcessResult> {
    const timeoutMs = options.timeoutMs ?? invocation.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const { command, args } = this.commandVector(input, invocation, mode);
    const handle: AsyncProcessHandle = this.asyncProcess.start(command, args, {
      timeoutMs,
      ...(options.cancelGraceMs === undefined ? {} : { cancelGraceMs: options.cancelGraceMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(mode === 'container' || invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
      // Tool-audience secrets reach the child environment only (`AC-051`).
      ...(invocation.secretEnv === undefined ? {} : { env: { ...invocation.secretEnv } }),
    });
    const unregister = this.toolProcesses.register(invocation.attemptId, handle);
    try {
      return await handle.done;
    } finally {
      unregister();
    }
  }

  /** The `{command, args}` a shell input becomes in the requested mode. */
  private commandVector(
    input: ToolCommandInput,
    invocation: ToolInvocation,
    mode: ExecutionMode,
  ): { command: string; args: readonly string[] } {
    if (mode === 'container') {
      // The container entrypoint is `-lc`, so either form is expressed as one command
      // string; every argv token is shell-quoted because the model supplied it.
      const command =
        typeof input === 'string'
          ? input
          : [input.program, ...input.args.map(shellQuote)].join(' ');
      return {
        command: 'docker',
        args: this.containerPlan(command, invocation, { egress: true }).args,
      };
    }
    return typeof input === 'string'
      ? { command: '/bin/sh', args: ['-lc', input] }
      : { command: input.program, args: input.args };
  }

  private containerPlan(
    command: string,
    invocation: ToolInvocation,
    options: { readonly egress?: boolean } = {},
  ): ContainerPlan {
    // The egress channel is attached to a call that runs an arbitrary command — the shell
    // is the only thing that can start `npm`/`pip`/`curl` — and only while the channel is
    // live. `read`/`write` use dedicated container primitives and stay channel-less, so a
    // file read does not pay for a bridge it cannot use.
    const channel = this.egressChannel;
    const network =
      options.egress === true && channel !== undefined && channel.available() ? 'proxy' : 'none';
    const reportRoots = reportWriteRootsFor(
      invocation,
      declaredAccess(invocation.operation, invocation.access),
      this.writableReportRoots,
    );
    // A read-only role's caller-supplied `writableRoots` are **stripped**: the
    // report/scratch root is the only thing that may be mounted `rw`, so a Review
    // or Test call cannot ask for the source tree to become writable (W7R2-01).
    const callerWritable = isReadOnlyRole(invocation.role)
      ? []
      : [...(invocation.writableRoots ?? [])];
    return planContainerRun({
      command,
      image: this.execImage,
      roots: [...(invocation.roots ?? []), ...reportRoots],
      writableRoots: [...callerWritable, ...reportRoots],
      network,
      ...(network === 'proxy' && channel !== undefined ? { egress: channel } : {}),
    });
  }

  private containerRead(realPath: string, invocation: ToolInvocation): string {
    const command = `cat ${shellQuote(this.containerPath(realPath, invocation))}`;
    const result = this.runCommand(command, invocation, 'container');
    if (result.status !== 0) {
      throw new ProtocolError('INTERNAL_ERROR', `container read failed: ${result.stderr.trim()}`, {
        details: { path: realPath },
      });
    }
    return result.stdout;
  }

  /**
   * Writes content inside the container over the container's **stdin**.
   *
   * The content is base64-encoded and decoded by `base64 -d`, so it is data on a
   * pipe rather than text in a shell command: the old here-document let content
   * containing its own delimiter line (`AGENTDEV_EOF`) close the document and
   * continue as shell (W7R1-09). The encoded form contains no byte that can end
   * the command, and the path is still shell-quoted.
   */
  private containerWrite(realPath: string, content: string, invocation: ToolInvocation): void {
    const target = this.containerPath(realPath, invocation);
    const plan = this.containerPlan(`base64 -d > ${shellQuote(target)}`, invocation);
    const result = this.process.run('docker', plan.args, {
      timeoutMs: invocation.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      stdin: Buffer.from(content, 'utf8').toString('base64'),
    });
    if (result.status !== 0) {
      throw new ProtocolError('INTERNAL_ERROR', `container write failed: ${result.stderr.trim()}`, {
        details: { path: realPath },
      });
    }
  }

  /** Translates an absolute host path into its path inside the container. */
  private containerPath(realPath: string, invocation: ToolInvocation): string {
    const reportRoots = reportWriteRootsFor(
      invocation,
      declaredAccess(invocation.operation, invocation.access),
      this.writableReportRoots,
    );
    const roots = [...(invocation.roots ?? []), ...reportRoots];
    for (const [index, root] of roots.entries()) {
      const canonical = canonicalExisting(root);
      if (isWithinRoot(realPath, canonical)) {
        const relativePath = relative(canonical, realPath);
        return relativePath === ''
          ? containerMountTarget(index)
          : join(containerMountTarget(index), relativePath);
      }
    }
    throw new ProtocolError('NOT_AUTHORIZED', `path ${realPath} is not inside a mounted root`, {
      details: { path: realPath },
    });
  }

  /** Whether the Grant for this call explicitly covers network. */
  private networkCovered(invocation: ToolInvocation, at: string): boolean {
    if (invocation.network === undefined) return false;
    const grant = this.grants.findGrantFor({
      workId: invocation.workId,
      operation: invocation.operation,
      role: invocation.role,
      stage: invocation.stage,
      targets: invocation.targets,
      at,
      runId: invocation.runId,
      ...(invocation.toolOperationId === undefined
        ? {}
        : { toolOperationId: invocation.toolOperationId }),
      inputHash: hashToolInput(invocation.input),
    });
    if (grant === undefined) return false;
    return grant.limits['network'] === true || grant.limits['network'] === 'proxy';
  }

  private recordRefusal(input: {
    invocation: ToolInvocation;
    mode: ExecutionMode;
    operation: string;
    inputHash: string;
    toolOperationId: string;
    code: BrokerErrorCode;
    reason: string;
  }): void {
    const data: JsonObject = {
      workId: input.invocation.workId,
      runId: input.invocation.runId,
      operation: input.operation,
      inputHash: input.inputHash,
      code: input.code,
      reason: input.reason,
      mode: input.mode,
      // Targets are paths/hosts, never the decoded input: the audit row records
      // what was asked for without persisting a secret value.
      targets: [...input.invocation.targets],
    };
    this.store.events.append({
      name: TOOL_EVENTS.refused,
      entityId: input.toolOperationId,
      entityVersion: 1,
      data,
    });
  }
}

function refuse(code: BrokerErrorCode, reason: string, fields: readonly string[] = []) {
  return { code, reason, fields };
}

/**
 * The `ToolContext.run` a read-only role receives: always a typed refusal.
 *
 * Review/Test must not be able to turn a tool body into arbitrary command
 * execution (W7R3-01), and a context member that simply did not exist would
 * surface as an untyped `TypeError` instead of a contract refusal. The stub
 * therefore throws the same `NOT_AUTHORIZED` a `bash`/`git` call gets.
 */
function refuseReadOnlyCommand(role: Role, operation: string): never {
  throw new ProtocolError(
    'NOT_AUTHORIZED',
    `${role} runs are read-only; the ${operation} tool body cannot execute shell commands`,
    { details: { role, operation } },
  );
}

function validateInvocation(
  invocation: ToolInvocation,
):
  | { readonly code: BrokerErrorCode; readonly reason: string; readonly fields: readonly string[] }
  | undefined {
  if (invocation.workId.trim() === '')
    return refuse('VALIDATION_ERROR', 'workId is required', ['workId']);
  if (invocation.runId.trim() === '')
    return refuse('VALIDATION_ERROR', 'runId is required', ['runId']);
  if (invocation.attemptId.trim() === '') {
    return refuse('VALIDATION_ERROR', 'attemptId is required', ['attemptId']);
  }
  if (invocation.operation.trim() === '') {
    return refuse('VALIDATION_ERROR', 'operation is required', ['operation']);
  }
  if (!Number.isInteger(invocation.epoch) || invocation.epoch < 0) {
    return refuse('VALIDATION_ERROR', 'epoch must be a non-negative integer', ['epoch']);
  }
  return undefined;
}

/** The optional `argv` a shell input carries; see the `git` tool's plan. */
function readInputArgv(input: unknown): string[] | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const argv = (input as Record<string, unknown>)['argv'];
  if (!Array.isArray(argv) || argv.length === 0) return undefined;
  return argv.map((token) => String(token));
}

function readInputString(input: unknown, field: string): string {
  if (typeof input === 'object' && input !== null) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  throw new ProtocolError('VALIDATION_ERROR', `tool input must carry a string ${field}`, {
    details: { field },
  });
}

/** Single-quotes a value for `/bin/sh`, so a path cannot become a command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
