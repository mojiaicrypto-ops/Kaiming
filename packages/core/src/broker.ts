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
 *    the network policy are evaluated before either mode runs.
 * 3. **File boundary is a real path, not a string.** `resolveWithinRoots`
 *    resolves symlinks (including a symlinked parent of a not-yet-existing
 *    file), refuses `..` and absolute escapes, and refuses a path inside a
 *    protected root. The Broker checks it before admission and re-checks it
 *    inside `readFile`/`writeFile`, so `open` cannot be tricked by a race. The
 *    protected roots are **derived from the store** (project state directory,
 *    run database, blobs, backups) rather than trusted from the caller, so a
 *    Grant cannot authorize reading the run database (W7R1-04). A hard link
 *    inside the root is a documented limit of any path-containment rule
 *    (W7R1-08).
 * 4. **Network boundary is per hop and per resolution.** `NetworkPolicy` refuses
 *    loopback, private, link-local and metadata addresses by default; a user may
 *    authorize an exact target (`host` or `host:port`) and only then does it pass.
 *    Every hostname is resolved through an injectable {@link HostResolver} before
 *    the decision, and **any** answer in loopback/private/link-local/CGNAT/
 *    metadata space refuses the request (W7R1-01), including the hexadecimal
 *    IPv4-mapped IPv6 spellings the URL parser produces (W7R1-02). Plain `http:`
 *    is refused unless the caller explicitly opted in for an authorized local
 *    test endpoint (W7R1-07). `GuardedRequester` performs a request with
 *    `redirect: 'manual'` and re-validates every hop through the same async
 *    decision, so a 302 pointing at a private address — or at a name resolving to
 *    one — is refused **without following it**.
 *
 * Everything here is deliberately explicit: refusals are typed results, never
 * silently swallowed exceptions, and no secret value is ever read from or written
 * into an audit row. Secret resolution is `core/secrets.ts` (AC-051) and is not
 * re-implemented here.
 */
import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ErrorCode, Grant, JsonObject, Role, ToolOperation } from '@agentdev/contracts';
import { sha256, uuidv7, type ProjectStore } from '@agentdev/storage';
import { canonicalJson } from './dispatcher.js';
import { ProtocolError } from './errors.js';
import type { GrantStore } from './grants.js';

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
  'INTERNAL_ERROR',
];

/** Narrows an arbitrary contracts error code onto the Broker's subset. */
export function asBrokerErrorCode(code: ErrorCode): BrokerErrorCode {
  return BROKER_ERROR_CODES.includes(code) ? (code as BrokerErrorCode) : 'INTERNAL_ERROR';
}

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

/** The default runner: a real, synchronous child process. */
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

/** Operations that write, edit or delete something. */
const WRITE_OPERATIONS: readonly string[] = [
  'write',
  'edit',
  'artifact_write',
  'delete_data',
  'push',
  'deploy',
];

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

function isWriteOperation(operation: string): boolean {
  return WRITE_OPERATIONS.includes(operation);
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
  | { readonly ok: true }
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
 * Classifies an address literal as loopback, private, link-local, CGNAT,
 * benchmarking, multicast/reserved or metadata space.
 *
 * Literal addresses are the only thing this function can decide on its own: a
 * hostname needs DNS, which is why it returns `undefined` for one. The review
 * (W7R1-01/W7R1-02) showed both halves of that rule matter — a name resolving to
 * `127.0.0.1` and a hexadecimal IPv4-mapped literal (`::ffff:7f00:1`) each slipped
 * through a name-only/literal-prefix check.
 */
export function classifyAddressLiteral(address: string): boolean | undefined {
  const normalized = normalizeHost(address);
  if (normalized === '') return true;
  if (isIPv4(normalized)) return isPrivateIpv4(normalized);
  if (isIPv6(normalized)) return isPrivateIpv6(normalized);
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
export function isPrivateAddress(host: string, classifyHost?: HostClassifier): boolean {
  const normalized = normalizeHost(host);
  if (normalized === '') return true;
  if (isAlwaysInternalHost(normalized)) return true;
  const literal = classifyAddressLiteral(normalized);
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
 * spelling (W7R1-02).
 */
function isPrivateIpv6(address: string): boolean {
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
  // 64:ff9b::/96 NAT64 well-known prefix.
  if (
    (bytes[0] ?? 0) === 0x00 &&
    (bytes[1] ?? 0) === 0x64 &&
    (bytes[2] ?? 0) === 0xff &&
    (bytes[3] ?? 0) === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isPrivateIpv4(asIpv4(ipv4At(12)));
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
 * Whether a host name resolves into internal address space.
 *
 * A name that resolves to *any* private/loopback/link-local/CGNAT/metadata
 * address is internal, because the transport may pick that answer. A name that
 * cannot be resolved is also refused: an unverifiable target is not a public one.
 */
export async function resolvesToPrivateAddress(
  host: string,
  resolver: HostResolver,
): Promise<boolean | string> {
  const normalized = normalizeHost(host);
  if (normalized === '') return true;
  if (isAlwaysInternalHost(normalized)) return true;
  const literal = classifyAddressLiteral(normalized);
  if (literal !== undefined) return literal;
  if (isResolverInternalName(normalized)) return true;
  const resolved = await resolver.resolve(normalized);
  if (!resolved.ok) return resolved.reason;
  for (const address of resolved.addresses) {
    const classified = classifyAddressLiteral(address);
    if (classified === undefined) {
      return `resolved address ${address} is not an address literal and cannot be classified`;
    }
    if (classified) return true;
  }
  return false;
}

/**
 * The allow-by-default-public policy with an exact-target allowlist.
 *
 * An authorized target is written exactly as the user authorized it: `host`
 * covers every port of that host, `host:port` only that port. Nothing else about
 * a private address is relaxed.
 *
 * W7R1-07 makes `https:` the only scheme a *private* target may use unless the
 * caller explicitly opted into plaintext for an authorized local test endpoint
 * (`allowInsecureHttp`), so a redirect to `http://…` cannot silently downgrade
 * the transport.
 */
export class NetworkPolicy {
  private readonly allowed: readonly string[];
  private readonly allowInsecureHttp: boolean;
  private readonly resolver: HostResolver | undefined;

  constructor(
    options: {
      readonly allowedTargets?: readonly string[];
      /** Explicit opt-in for a plaintext local test endpoint. Default `false`. */
      readonly allowInsecureHttp?: boolean;
      /** Injected DNS port; the default is a real `dns.lookup`. */
      readonly resolver?: HostResolver;
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
  }

  /** The resolver this policy was given, if any. */
  get hostResolver(): HostResolver | undefined {
    return this.resolver;
  }

  /** Whether plaintext `http:` is explicitly permitted for authorized targets. */
  get insecureHttpAllowed(): boolean {
    return this.allowInsecureHttp;
  }

  /** The exact targets the user explicitly authorized. */
  get allowedTargets(): readonly string[] {
    return this.allowed;
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
   * The synchronous target decision: scheme, then the literal/internal host rule.
   *
   * It cannot resolve DNS, so it is used where the caller is synchronous
   * (`Broker.invoke`) and as a fast path; the transport always awaits
   * {@link decide} so a name resolving privately is refused before a request.
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

  /** Decides one URL: the address, then the scheme (no DNS). */
  checkUrl(input: string | URL): NetworkPolicyDecision {
    const parsed = this.parseUrl(input);
    if (!parsed.ok) return parsed;
    const address = this.decideSync(parsed.url.hostname, parsed.port);
    if (!address.ok) return address;
    return this.checkScheme(parsed.url);
  }

  /**
   * The authoritative decision: address, scheme, then DNS.
   *
   * Every question a hostname raises is answered before the transport is asked to
   * make a request: an internal-by-construction name or an exactly authorized
   * target is decided by name, anything else is resolved through the injected
   * {@link HostResolver} and refused when **any** answer is internal or when the
   * name cannot be resolved (W7R1-01). The scheme is checked after the address so
   * a private target reports *why* it is private, and plaintext is refused unless
   * the exact target was authorized and plaintext was explicitly enabled
   * (W7R1-07).
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
      return this.checkScheme(parsed.url);
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
   * W7R1-07: `https:` is the transport unless plaintext was explicitly enabled for
   * an exactly authorized local test endpoint.
   */
  private checkScheme(parsed: URL): NetworkPolicyDecision {
    if (parsed.protocol === 'https:') return { ok: true };
    if (parsed.protocol !== 'http:') {
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        reason: `network scheme ${parsed.protocol} is refused; only https is supported`,
      };
    }
    const port = parsed.port === '' ? 80 : Number.parseInt(parsed.port, 10);
    if (this.allowInsecureHttp && this.allows(parsed.hostname, port)) return { ok: true };
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      reason:
        'network scheme http: is refused; https is required unless plaintext is explicitly authorized for an authorized local test endpoint',
    };
  }

  private async decideHost(host: string, port: number | undefined): Promise<NetworkPolicyDecision> {
    const normalized = normalizeHost(host);
    // A known-internal name is decided by name: only an exact authorization
    // relaxes it, and no DNS answer can change that. `undefined` marks a name
    // whose classification needs the resolver.
    if (isAlwaysInternalHost(normalized) || isResolverInternalName(normalized)) {
      if (this.allows(normalized, port)) return { ok: true };
      return this.refuse(normalized, port);
    }
    // `isPrivateAddress` returns a boolean for everything it can decide alone
    // (address literals and internal names), so the resolver is only consulted
    // when it answers `false` and the caller did not authorize the exact target.
    if (isPrivateAddress(normalized)) {
      if (this.allows(normalized, port)) return { ok: true };
      return this.refuse(normalized, port);
    }
    if (this.allows(normalized, port)) return { ok: true };
    const classified = await resolvesToPrivateAddress(
      normalized,
      this.resolver ?? defaultHostResolver,
    );
    if (classified === false) return { ok: true };
    if (classified === true) return this.refuse(normalized, port);
    // A name that could not be resolved (or whose answer is not an address) is
    // not a public target: an unverifiable destination is refused.
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      reason: `network target ${normalized} is refused: ${classified}`,
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
        reason: `network scheme ${parsed.protocol} is refused; only https is supported`,
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

  private decideSync(host: string, port?: number): NetworkPolicyDecision {
    if (!isPrivateAddress(host)) return { ok: true };
    if (this.allows(host, port)) return { ok: true };
    return this.refuse(host, port);
  }

  private refuse(host: string, port?: number): NetworkPolicyDecision {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      reason: `network target ${host}${port === undefined ? '' : `:${String(port)}`} is loopback/private/link-local and is not explicitly authorized`,
    };
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
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type NetworkFetcher = (
  url: string,
  init: {
    readonly method: string;
    readonly redirect: 'manual';
    readonly headers: Record<string, string>;
  },
) => Promise<NetworkResponseLike>;

const defaultNetworkFetcher: NetworkFetcher = (url, init) => fetch(url, init);

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
 * the request ever leaving the process.
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
      const response = await this.fetcher(current, { method, redirect: 'manual', headers });
      hops.push({ url: current, status: response.status, allowed: true });
      if (!REDIRECT_STATUSES.includes(response.status)) {
        const body = await response.text();
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
  /** `none` unless the Grant explicitly covers network and a proxy exists. */
  readonly network?: 'none' | 'proxy';
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
 * `execution.md` §1 fixes. `--network` is `none` unless the caller passed
 * `proxy`, which only happens when the Grant explicitly covers network (and a
 * Core-controlled proxy exists, see `Broker`).
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
  const network = input.network ?? 'none';
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
    // The Core proxy is the only sanctioned network path (`execution.md` §4);
    // `bridge` is used only when that proxy has been configured.
    network === 'proxy' ? 'bridge' : 'none',
    '--user',
    '10001:10001',
  ];
  for (const mount of mounts) {
    args.push('--volume', `${mount.path}:${mount.target}:${mount.mode}`);
  }
  for (const [key, value] of Object.entries(input.env ?? {})) {
    args.push('--env', `${key}=${value}`);
  }
  args.push('--workdir', workdir, image, '-lc', input.command);
  return { image, command: input.command, args, mounts, network, user: '10001:10001', workdir };
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
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  run(command: string): ProcessResult;
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

export interface BrokerOptions {
  readonly store: ProjectStore;
  readonly grants: GrantStore;
  readonly now?: () => string;
  /** Default mode for calls that do not name one. */
  readonly mode?: ExecutionMode;
  readonly execImage?: string;
  /** Injectable Docker probe; the default runs `docker version`. */
  readonly docker?: DockerProbe;
  readonly process?: ProcessRunner;
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
  /** Explicit opt-in for plaintext `http:` on an authorized local test endpoint. */
  readonly allowInsecureHttp?: boolean;
  /**
   * The Core-controlled network proxy the Grant-covered container mode uses
   * (`execution.md` §4). When it is absent, a container network request is
   * refused rather than opened.
   */
  readonly networkProxy?: string;
}

export class Broker {
  private readonly store: ProjectStore;
  private readonly grants: GrantStore;
  private readonly now: () => string;
  private readonly defaultMode: ExecutionMode;
  private readonly execImage: string;
  private readonly docker: DockerProbe;
  private readonly process: ProcessRunner;
  private readonly allowedNetworkTargets: readonly string[];
  private readonly protectedPaths: readonly string[];
  private readonly writableReportRoots: readonly string[];
  private readonly resolver: HostResolver;
  private readonly allowInsecureHttp: boolean;
  private readonly networkProxy: string | undefined;

  constructor(options: BrokerOptions) {
    this.store = options.store;
    this.grants = options.grants;
    this.now = options.now ?? (() => options.store.now());
    this.defaultMode = options.mode ?? 'host';
    this.execImage = options.execImage ?? EXEC_IMAGE;
    this.docker = options.docker ?? probeDockerAvailability;
    this.process = options.process ?? defaultProcessRunner;
    this.allowedNetworkTargets = options.allowedNetworkTargets ?? [];
    // W7R1-04: the run database is protected structurally, not by caller input.
    this.protectedPaths = deriveProtectedPaths(
      options.store,
      options.dataDir,
      options.protectedPaths ?? [],
    );
    this.writableReportRoots = (options.writableReportRoots ?? []).map(canonicalExisting);
    this.resolver = options.resolver ?? defaultHostResolver;
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;
    this.networkProxy = options.networkProxy;
  }

  /** The roots no role may read or write; the derived run-data roots included. */
  get protectedRoots(): readonly string[] {
    return this.protectedPaths;
  }

  /** The report/scratch roots Review and Test may write inside. */
  get reportRoots(): readonly string[] {
    return this.writableReportRoots;
  }

  /** The policy a call's network targets are evaluated against. */
  networkPolicy(invocation: Pick<ToolInvocation, 'allowedNetworkTargets'>): NetworkPolicy {
    return new NetworkPolicy({
      allowedTargets: [...this.allowedNetworkTargets, ...(invocation.allowedNetworkTargets ?? [])],
      resolver: this.resolver,
      allowInsecureHttp: this.allowInsecureHttp,
    });
  }

  /** A policy-guarded requester; the transport a network tool must use. */
  networkRequester(invocation: Pick<ToolInvocation, 'allowedNetworkTargets'>): GuardedRequester {
    return new GuardedRequester({
      policy: this.networkPolicy(invocation),
      resolver: this.resolver,
    });
  }

  /**
   * Admits and runs one tool call.
   *
   * Every branch that refuses returns a typed outcome and appends a
   * `tool.refused` audit event; nothing executes on a refusal. An admitted call
   * is recorded by `GrantStore.consumeOnce` as a `tool_operation` row (tool name,
   * input hash, Grant reference, state) and by a `tool.invoked` event.
   */
  invoke(invocation: ToolInvocation): ToolOutcome {
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
    //    verification input, in any mode. `execution.md` §3 gives them exactly one
    //    write boundary — their own report/check scratch directory — so a write is
    //    admitted only inside a declared report root (W7R1-13).
    const access = invocation.access ?? (isWriteOperation(operation) ? 'write' : 'read');
    const writeRoots = reportWriteRootsFor(invocation, access, this.writableReportRoots);
    if (isReadOnlyRole(invocation.role)) {
      if (access === 'write' || isWriteOperation(operation)) {
        if (writeRoots.length === 0) {
          return refuse(
            'NOT_AUTHORIZED',
            `${invocation.role} runs are read-only; ${operation} cannot write source or verification input`,
            ['role'],
          );
        }
      }
    }
    if (access === 'write' && isWriteOperation(operation) === false) {
      return refuse(
        'VALIDATION_ERROR',
        `operation ${operation} is not a write operation but was declared as one`,
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

    // 4. Network boundary, before anything leaves the process.
    if (operation === 'network' || invocation.network !== undefined) {
      const decision = this.networkPolicy(invocation).checkTarget(invocation.network ?? {});
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
    }
    // A container may only reach the network through the Core-controlled proxy.
    // With no proxy configured, a call whose Grant covers network is refused
    // outright rather than being given an open `--network bridge`.
    if (mode === 'container' && this.networkCovered(invocation, at)) {
      if (this.networkProxy === undefined) {
        return refuse(
          'PROVIDER_UNAVAILABLE',
          'container network is refused: no Core-controlled proxy is configured; the Broker does not open a direct network path',
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
      executor: () => this.execute(invocation, context),
    };
    let consumed;
    try {
      consumed = this.grants.consumeOnce(request);
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

  private execute(invocation: ToolInvocation, context: ToolContext): unknown {
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
        const command = readInputString(invocation.input, 'command');
        return context.run(command);
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
    const writeRoots = reportWriteRootsFor(
      invocation,
      invocation.access ?? (isWriteOperation(operation) ? 'write' : 'read'),
      this.writableReportRoots,
    );
    const check = (path: string, checkAccess: 'read' | 'write'): string => {
      const decision = resolveWithinRoots({
        path,
        access: checkAccess,
        roots: roots.length === 0 ? writeRoots : roots,
        ...(checkAccess === 'write' && isReadOnlyRole(invocation.role) && writeRoots.length > 0
          ? { writeRoots }
          : {}),
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
      run: (command) => this.runCommand(command, invocation, mode),
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
      const plan = this.containerPlan(command, invocation);
      return this.process.run('docker', plan.args, { timeoutMs: invocation.timeoutMs ?? 120_000 });
    }
    return this.process.run('/bin/sh', ['-lc', command], {
      timeoutMs: invocation.timeoutMs ?? 120_000,
    });
  }

  private containerPlan(command: string, invocation: ToolInvocation): ContainerPlan {
    // `proxy` is only used once a proxy actually exists; the caller was already
    // refused otherwise, so the default stays `none`.
    const network =
      this.networkProxy !== undefined && this.networkCovered(invocation, this.now())
        ? 'proxy'
        : 'none';
    const reportRoots = reportWriteRootsFor(
      invocation,
      invocation.access ?? (isWriteOperation(invocation.operation) ? 'write' : 'read'),
      this.writableReportRoots,
    );
    return planContainerRun({
      command,
      image: this.execImage,
      roots: [...(invocation.roots ?? []), ...reportRoots],
      writableRoots: [...(invocation.writableRoots ?? []), ...reportRoots],
      network,
      ...(this.networkProxy === undefined
        ? {}
        : { env: { AGENTDEV_NETWORK_PROXY: this.networkProxy } }),
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
      timeoutMs: invocation.timeoutMs ?? 120_000,
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
      invocation.access ?? (isWriteOperation(invocation.operation) ? 'write' : 'read'),
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
