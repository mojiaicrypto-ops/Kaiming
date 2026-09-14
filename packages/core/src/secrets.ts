/**
 * Purpose-scoped secret resolution and leak prevention (AC-051).
 *
 * `docs/architecture/execution.md` §4 fixes the model: "Secret按用途使用，模型Secret
 * 仅在Gateway；项目命令Secret按Grant短时注入目标工具，不注入所有Agent。日志做敏感
 * 字段和已知值遮蔽；输出不含认证Header。" and `acceptance.md` AC-051 states the
 * observable promise: a Provider or project-command credential is "只在受权用途注入，
 * UI/Artifact/日志不含已知Secret".
 *
 * This module is the single place in Core that knows a secret *value*, and three
 * properties make the boundary hold:
 *
 * 1. **Resolution is authorized.** `resolve(ref, context)` re-evaluates the
 *    caller's Grants with `domain/evaluateGrant` for the `secret` operation, so
 *    role, stage, run, target and expiry bind exactly as they do for every other
 *    tool call (`data.md` §2 "全匹配后才准入"). A sibling Run, a foreign
 *    purpose/role or an expired/revoked Grant resolves nothing. The Grant check
 *    runs *before* the ref is looked up, so an unauthorized caller cannot use
 *    `NOT_FOUND` to enumerate which credentials exist.
 * 2. **No query returns a value.** `list`/`has` expose refs and metadata only;
 *    values live in ECMAScript private fields, so serialising the store object
 *    itself cannot reveal one. The only value-returning method is `resolve`, and
 *    only for the authorized caller.
 * 3. **Leaks are preventable and detectable.** `redact`/`redactValue` mask every
 *    known value in arbitrary text, nested payloads and `Error`s — the helpers
 *    the log, Artifact and UI paths apply — while `scanForLeaks` reports where a
 *    value still appears, which is the audit-path and test assertion of AC-051.
 *
 * The store is deliberately in-memory: `execution.md` §4 keeps the durable copy
 * in the OS Keychain / a 0600 encrypted file owned by the installer, and nothing
 * here may write a value into the repository. `put` is the registration seam the
 * installer/configuration layer calls.
 */
import type { Grant, Purpose, Role } from '@agentdev/contracts';
import { evaluateGrant, grantDenialCode, type GrantRequest } from '@agentdev/domain';
import { ProtocolError } from './errors.js';
import type { SecretResolver } from './model-gateway.js';

/** `data.md` §1 `Scope.operations`: the operation a secret Grant must carry. */
export const SECRET_OPERATION = 'secret';

/** Replacement written in place of every known value by the redaction helpers. */
export const SECRET_MASK = '[redacted]';

/** Prefix of the derived environment variable name of a secret. */
export const SECRET_ENV_PREFIX = 'AGENTDEV_SECRET_';

/** Marker used when a payload contains a reference cycle. */
const CIRCULAR_MARK = '[circular]';

const MAX_REF_LENGTH = 128;
const MAX_VALUE_LENGTH = 64 * 1024;
const MAX_ENV_NAME_LENGTH = 128;
const PREVIEW_LENGTH = 160;

/**
 * Upper bound of the environment variable name a secret is injected as.
 *
 * Exported (WP-12 fix round 2, W12T1-03) so the durable repository can reject a ref whose
 * derived name would not fit *before* it writes a record; otherwise `set` would report a
 * validation failure after the credential was already on disk.
 */
export const MAX_SECRET_ENV_NAME_LENGTH = MAX_ENV_NAME_LENGTH;

/** Printable ASCII without whitespace: a provider `secretRef` is an opaque name. */
const REF_PATTERN = /^[!-~]+$/;
/** Environment variable names a child process can carry. */
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Where a secret may be used at all.
 *
 * `execution.md` §4 separates the two audiences: the Provider credential stays
 * in the trusted Gateway ("模型Secret仅在Gateway"), while a project-command
 * credential is injected into the target tool container only. A secret of one
 * audience is never resolvable through the other's channel.
 */
export type SecretAudience = 'gateway' | 'tool';

/** Codes a resolution or injection can be refused with. */
export type SecretDenialCode = 'NOT_AUTHORIZED' | 'AUTH_EXPIRED' | 'NOT_FOUND' | 'VALIDATION_ERROR';

/**
 * The authorization context a secret is resolved under.
 *
 * The caller passes the Run's identity (purpose/role/stage/run) *and* the Grant
 * rows it holds, so the store re-decides admission rather than trusting a claim.
 */
export interface SecretAccessContext {
  /** The channel asking: the trusted Gateway or a tool/child process. */
  readonly audience: SecretAudience;
  /** The Run's purpose (`agents.md` §3). */
  readonly purpose: Purpose;
  readonly role: Role;
  readonly workId: string;
  readonly stage: string;
  /** Use time; an expired or revoked Grant refuses. */
  readonly at: string;
  readonly runId?: string;
  readonly toolOperationId?: string;
  readonly inputHash?: string;
  /** Every Grant the caller holds for this Run. */
  readonly grants: readonly Grant[];
  /**
   * The one credential ref the Gateway is resolving for *this* call (WP-12 fix round 2).
   *
   * Honored **only** when `audience === 'gateway'` and the value comes from an immutable
   * source — a Run's frozen provider snapshot, or the live configuration for an
   * installation-level `provider.test` — never from a `runParams` layer the model could
   * influence. `tool` and every other audience keep the pure `evaluateGrant` path, and the
   * registration's own audience/purpose/role narrowing still applies.
   */
  readonly allowedRefs?: readonly string[];
}

/** What `put` registers; the value never leaves the store except via `resolve`. */
export interface SecretRegistration {
  readonly ref: string;
  readonly value: string;
  readonly audience: SecretAudience;
  /**
   * Purposes allowed to resolve it. Omitted means "any purpose its Grant
   * admits", which keeps the Grant the single source of authority.
   */
  readonly purposes?: readonly Purpose[];
  /** Roles allowed to resolve it; omitted means "any role its Grant admits". */
  readonly roles?: readonly Role[];
  /** Environment variable it is injected as; derived from the ref when omitted. */
  readonly envName?: string;
}

/** The public description of a registered secret; never contains its value. */
export interface SecretMetadata {
  readonly ref: string;
  readonly audience: SecretAudience;
  readonly purposes: readonly Purpose[];
  readonly roles: readonly Role[];
  readonly envName: string;
}

export type SecretResolution =
  | { readonly ok: true; readonly ref: string; readonly value: string }
  | { readonly ok: false; readonly code: SecretDenialCode; readonly reason: string };

/**
 * The outcome of building a child environment.
 *
 * Injection is strict: a requested ref the context may not use refuses the whole
 * environment instead of silently dropping it, because a tool that starts with
 * only part of its credentials is a half-configured process — the failure the
 * caller must see (`reliability.md` §5: no silent success).
 */
export type SecretInjection =
  | {
      readonly ok: true;
      readonly refs: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }
  | {
      readonly ok: false;
      readonly code: SecretDenialCode;
      readonly reason: string;
      readonly fields: readonly string[];
    };

/** A place a known secret value still appears, as reported by `scanForLeaks`. */
export interface LeakFinding {
  /** JSON-ish path of the leaking string, e.g. `$.artifact.lines[2]`. */
  readonly path: string;
  /** Index into the `knownSecrets` array passed to the scanner. */
  readonly secretIndex: number;
  /** The leaking text with every known value masked; never the value itself. */
  readonly preview: string;
}

interface StoredSecret {
  readonly value: string;
  readonly metadata: SecretMetadata;
}

interface Refusal {
  readonly ok: false;
  readonly code: SecretDenialCode;
  readonly reason: string;
}

interface Admission {
  readonly ok: true;
}

/**
 * The environment variable a secret is injected as.
 *
 * Derived deterministically from the ref so a caller that only knows the ref can
 * still build the env; `put` accepts an explicit `envName` when the deployed
 * tool expects a fixed name.
 */
export function secretEnvName(ref: string): string {
  const normalized = ref
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${SECRET_ENV_PREFIX}${normalized}`;
}

/**
 * Whether `ref` is a usable secret reference.
 *
 * This is the **ref shape only**: 1–128 printable characters without whitespace. It does
 * *not* bound the environment variable name derived by {@link secretEnvName}, which
 * `put` also validates; a caller that persists a ref before registering it (the durable
 * repository, WP-12 T1.1) must check {@link MAX_SECRET_ENV_NAME_LENGTH} as well, or a
 * rejected `put` would leave a record behind (W12T1-03).
 */
export function isValidSecretRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= MAX_REF_LENGTH && REF_PATTERN.test(ref);
}

/**
 * An in-memory `secretRef` → value store with Grant-checked resolution.
 *
 * Values are held in `#secrets`, which JavaScript's private-field semantics keep
 * out of every enumeration and out of `JSON.stringify(store)`.
 */
export class SecretStore {
  readonly #secrets = new Map<string, StoredSecret>();

  constructor(options: { readonly secrets?: readonly SecretRegistration[] } = {}) {
    for (const registration of options.secrets ?? []) this.put(registration);
  }

  /**
   * Registers or replaces one secret.
   *
   * @throws ProtocolError `VALIDATION_ERROR` for an unusable ref, value or
   * environment variable name. Replace-on-same-ref is intentional: rotating a
   * Provider credential is a configuration update, and the durable copy lives
   * outside this process (`execution.md` §4).
   */
  put(registration: SecretRegistration): SecretMetadata {
    const { ref, value } = registration;
    if (ref.length === 0 || ref.length > MAX_REF_LENGTH || !REF_PATTERN.test(ref)) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `secret ref must be 1–${String(MAX_REF_LENGTH)} printable characters without whitespace`,
      );
    }
    if (value.length === 0 || value.length > MAX_VALUE_LENGTH || value.includes('\0')) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `secret ${ref} must carry a non-empty value shorter than ${String(MAX_VALUE_LENGTH)} bytes and free of NUL`,
      );
    }
    if (registration.audience !== 'gateway' && registration.audience !== 'tool') {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `secret ${ref} has an unknown audience; expected gateway or tool`,
      );
    }
    const envName = registration.envName ?? secretEnvName(ref);
    if (envName.length > MAX_ENV_NAME_LENGTH || !ENV_NAME_PATTERN.test(envName)) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `secret ${ref} envName must be an uppercase environment variable name`,
      );
    }
    const metadata: SecretMetadata = Object.freeze({
      ref,
      audience: registration.audience,
      purposes: Object.freeze([...(registration.purposes ?? [])]),
      roles: Object.freeze([...(registration.roles ?? [])]),
      envName,
    });
    this.#secrets.set(ref, { value, metadata });
    return metadata;
  }

  /** Whether a ref is registered; reveals existence only, never a value. */
  has(ref: string): boolean {
    return this.#secrets.has(ref);
  }

  /**
   * Removes one registration; `true` when it existed.
   *
   * The durable copy is deleted first by the caller (WP-12 T1.1), so a crash between
   * the two leaves the repository as the authority and the next start loads it again.
   */
  remove(ref: string): boolean {
    return this.#secrets.delete(ref);
  }

  /** Every registered ref, sorted; the query surface callers may log freely. */
  refs(): readonly string[] {
    return [...this.#secrets.keys()].sort();
  }

  /** Metadata of every registered secret, sorted by ref; never a value. */
  list(): readonly SecretMetadata[] {
    return this.refs().map((ref) => this.#require(ref).metadata);
  }

  /**
   * The value of `ref`, or the documented refusal.
   *
   * Admission runs first: the caller's Grants are evaluated for the `secret`
   * operation on this exact ref at this role/stage/run/use-time. Only an
   * admitted caller can learn whether the ref exists (`NOT_FOUND`), whether its
   * declared audience/purposes/roles allow this use (`NOT_AUTHORIZED`), or its
   * value.
   */
  resolve(ref: string, context: SecretAccessContext): SecretResolution {
    const resolved = this.resolveStored(ref, context);
    if (!resolved.ok) return resolved;
    return { ok: true, ref, value: resolved.stored.value };
  }

  /**
   * Builds the environment of one authorised child process.
   *
   * `refs` is the exact set the tool asks for. Every one of them must be
   * resolvable under `context`; the first refusal is returned and no environment
   * is produced, so an unauthorized credential can never reach a child by being
   * mixed into an otherwise valid set.
   */
  environmentFor(context: SecretAccessContext, refs: readonly string[]): SecretInjection {
    const env: Record<string, string> = {};
    const injected: string[] = [];
    for (const [index, ref] of refs.entries()) {
      const resolved = this.resolveStored(ref, context);
      if (!resolved.ok) {
        return {
          ok: false,
          code: resolved.code,
          reason: `secret injection refused: ${resolved.reason}`,
          fields: [`refs[${String(index)}]`],
        };
      }
      env[resolved.stored.metadata.envName] = resolved.stored.value;
      injected.push(ref);
    }
    return { ok: true, refs: injected, env };
  }

  /**
   * Masks every registered value in `text`.
   *
   * The audit path applies this to a log line or a payload before it is
   * persisted. No authorization is needed because masking can only remove
   * information, and the values themselves never leave the method.
   */
  maskAll(text: string): string {
    return redact(text, this.#knownValues());
  }

  /**
   * Scans `input` for every registered value, as the audit path does.
   *
   * `LeakFinding.secretIndex` indexes the sorted {@link refs} list, so the
   * caller can name the credential that leaked without ever handling its value.
   */
  scanAll(input: unknown): readonly LeakFinding[] {
    return scanForLeaks(input, this.#knownValues());
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resolveStored(
    ref: string,
    context: SecretAccessContext,
  ): { readonly ok: true; readonly stored: StoredSecret } | Refusal {
    if (ref.length === 0 || ref.length > MAX_REF_LENGTH || !REF_PATTERN.test(ref)) {
      return refuse('VALIDATION_ERROR', 'secret ref must be 1–128 printable characters');
    }
    const admission = this.admit(ref, context);
    if (!admission.ok) return admission;
    const stored = this.#secrets.get(ref);
    if (stored === undefined) {
      return refuse('NOT_FOUND', `no secret is registered as ${ref}`);
    }
    const scoped = this.scopeAllows(ref, stored.metadata, context);
    if (!scoped.ok) return scoped;
    return { ok: true, stored };
  }

  /**
   * Whether some Grant the caller holds admits the `secret` operation on `ref`.
   *
   * The request carries the caller's role/stage/run/time, so `evaluateGrant`
   * decides exactly as the Broker would; a refusal distinguishes "expired or
   * revoked" from every other binding mismatch so the caller learns the right
   * next step (`AUTH_EXPIRED` vs `NOT_AUTHORIZED`).
   */
  private admit(ref: string, context: SecretAccessContext): Admission | Refusal {
    // The Gateway holds the Provider credential on the Run's behalf (`execution.md` §2):
    // there is no per-run `secret` Grant to evaluate, and the ref it may use is exactly the
    // one frozen for that Run. Everything else — the `tool` audience above all — still goes
    // through `evaluateGrant` unchanged.
    if (context.audience === 'gateway' && (context.allowedRefs ?? []).includes(ref)) {
      return { ok: true };
    }
    const request = this.grantRequest(ref, context);
    const decisions = context.grants.map((grant) => evaluateGrant(grant, request));
    if (decisions.some((decision) => decision.allowed)) return { ok: true };
    const codes = decisions.map((decision) =>
      decision.allowed ? 'NOT_AUTHORIZED' : grantDenialCode(decision.reason),
    );
    if (codes.length > 0 && codes.every((code) => code === 'AUTH_EXPIRED')) {
      return refuse('AUTH_EXPIRED', `every Grant for secret ${ref} is expired or revoked`);
    }
    return refuse(
      'NOT_AUTHORIZED',
      context.grants.length === 0
        ? `no Grant authorizes secret ${ref}`
        : `no Grant admits secret ${ref} for ${context.role}@${context.stage}`,
    );
  }

  private grantRequest(ref: string, context: SecretAccessContext): GrantRequest {
    return {
      operation: SECRET_OPERATION,
      role: context.role,
      stage: context.stage,
      targets: [ref],
      at: context.at,
      workId: context.workId,
      ...(context.runId === undefined ? {} : { runId: context.runId }),
      ...(context.toolOperationId === undefined
        ? {}
        : { toolOperationId: context.toolOperationId }),
      ...(context.inputHash === undefined ? {} : { inputHash: context.inputHash }),
    };
  }

  /**
   * The registration's own restrictions.
   *
   * A registration may narrow its use beyond what a Grant allows (audience,
   * purpose, role) but never widen it: the Grant check has already run.
   */
  private scopeAllows(
    ref: string,
    metadata: SecretMetadata,
    context: SecretAccessContext,
  ): Admission | Refusal {
    if (metadata.audience !== context.audience) {
      return refuse(
        'NOT_AUTHORIZED',
        `secret ${ref} belongs to the ${metadata.audience} channel, not ${context.audience}`,
      );
    }
    if (metadata.purposes.length > 0 && !metadata.purposes.includes(context.purpose)) {
      return refuse(
        'NOT_AUTHORIZED',
        `secret ${ref} is not authorized for purpose ${context.purpose}`,
      );
    }
    if (metadata.roles.length > 0 && !metadata.roles.includes(context.role)) {
      return refuse('NOT_AUTHORIZED', `secret ${ref} is not authorized for role ${context.role}`);
    }
    return { ok: true };
  }

  #require(ref: string): StoredSecret {
    const stored = this.#secrets.get(ref);
    if (stored === undefined) {
      throw new ProtocolError('NOT_FOUND', `no secret is registered as ${ref}`);
    }
    return stored;
  }

  /** Every registered value, in the sorted `refs()` order; never returned. */
  #knownValues(): readonly string[] {
    return this.refs().map((ref) => this.#require(ref).value);
  }
}

function refuse(code: SecretDenialCode, reason: string): Refusal {
  return { ok: false, code, reason };
}

/**
 * Adapts the store to the Gateway's one-argument `SecretResolver`.
 *
 * `model-gateway.ts` resolves a Provider secret through a bare
 * `resolve(secretRef)`, which by itself carries no authorization. The adapter
 * closes over one already-authorized {@link SecretAccessContext}, so the narrow
 * Gateway interface never becomes a way to read a credential the Run may not
 * use: a refusal is reported as "not available", which the Gateway already maps
 * to `CONFIG_INVALID`/`PROVIDER_UNAVAILABLE` instead of a silent fallback.
 */
export function gatewaySecretResolver(
  store: SecretStore,
  context: SecretAccessContext,
): SecretResolver {
  return {
    has: (secretRef: string): boolean => store.has(secretRef),
    resolve: (secretRef: string, options?: { readonly allowRef?: string }): string | undefined => {
      // The per-call allow-list is narrowed to the single ref the Gateway is about to use,
      // and only for the `gateway` audience; the stored context's own identity is kept, so
      // the registration's purpose/role restrictions still apply.
      const scoped: SecretAccessContext =
        options?.allowRef === undefined ? context : { ...context, allowedRefs: [options.allowRef] };
      const resolution = store.resolve(secretRef, scoped);
      return resolution.ok ? resolution.value : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Redaction and leak scanning
// ---------------------------------------------------------------------------

/**
 * Masks every known value in arbitrary text.
 *
 * Values are replaced longest-first so one value that contains another cannot
 * leave a partial copy behind.
 */
export function redact(text: string, knownSecrets: readonly string[]): string {
  let output = text;
  for (const secret of orderedSecrets(knownSecrets)) {
    output = output.split(secret).join(SECRET_MASK);
  }
  return output;
}

/** Whether any known value appears in the given text. */
export function containsSecret(text: string, knownSecrets: readonly string[]): boolean {
  return orderedSecrets(knownSecrets).some((secret) => text.includes(secret));
}

/**
 * Deep-redacts a payload for a log, Artifact or UI message.
 *
 * Plain objects, arrays, `Map`s, `Set`s, `Date`s and `Error`s are copied
 * defensively — the input is never mutated. An `Error` becomes a plain record
 * (`name`/`message`/`stack`/`cause`) so the redacted form still serialises with
 * `JSON.stringify`, which is exactly what a leaked stack trace would otherwise
 * defeat.
 */
export function redactValue(value: unknown, knownSecrets: readonly string[]): unknown {
  const secrets = orderedSecrets(knownSecrets);
  return redactInto(value, secrets, new WeakSet());
}

function redactInto(value: unknown, secrets: readonly string[], seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redact(value, secrets);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    if (seen.has(value)) return CIRCULAR_MARK;
    seen.add(value);
    const output: Record<string, unknown> = {
      name: redact(value.name, secrets),
      message: redact(value.message, secrets),
    };
    if (typeof value.stack === 'string') output['stack'] = redact(value.stack, secrets);
    if (value.cause !== undefined) output['cause'] = redactInto(value.cause, secrets, seen);
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
      output[redact(key, secrets)] = redactInto(entry, secrets, seen);
    }
    return output;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR_MARK;
    seen.add(value);
    return value.map((entry) => redactInto(entry, secrets, seen));
  }
  if (value instanceof Map) {
    if (seen.has(value)) return CIRCULAR_MARK;
    seen.add(value);
    const output = new Map<unknown, unknown>();
    for (const [key, entry] of value) {
      const safeKey =
        typeof key === 'string' ? redact(key, secrets) : redactInto(key, secrets, seen);
      output.set(safeKey, redactInto(entry, secrets, seen));
    }
    return output;
  }
  if (value instanceof Set) {
    if (seen.has(value)) return CIRCULAR_MARK;
    seen.add(value);
    const output = new Set<unknown>();
    for (const entry of value) output.add(redactInto(entry, secrets, seen));
    return output;
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return CIRCULAR_MARK;
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[redact(key, secrets)] = redactInto(entry, secrets, seen);
    }
    return output;
  }
  return value;
}

/**
 * Finds every place a known secret value still appears.
 *
 * Used by the tests and by the audit path: it walks strings, arrays, nested
 * objects, object keys, `Map`/`Set` contents and `Error` message/stack/cause,
 * and reports a path plus a masked preview. The value itself is never returned,
 * so a finding can be shown in a report safely.
 */
export function scanForLeaks(
  input: unknown,
  knownSecrets: readonly string[],
): readonly LeakFinding[] {
  const secrets = orderedSecrets(knownSecrets).map((value) => ({
    value,
    index: knownSecrets.indexOf(value),
  }));
  if (secrets.length === 0) return [];
  const findings: LeakFinding[] = [];
  scanInto(input, '$', secrets, knownSecrets, findings, new WeakSet());
  return findings;
}

/** Whether {@link scanForLeaks} would report anything. */
export function hasLeaks(input: unknown, knownSecrets: readonly string[]): boolean {
  return scanForLeaks(input, knownSecrets).length > 0;
}

interface ScanSecret {
  readonly value: string;
  readonly index: number;
}

function scanInto(
  value: unknown,
  path: string,
  secrets: readonly ScanSecret[],
  all: readonly string[],
  findings: LeakFinding[],
  seen: WeakSet<object>,
): void {
  if (typeof value === 'string') {
    recordString(value, path, secrets, all, findings);
    return;
  }
  if (value instanceof Date) return;
  if (value instanceof Error) {
    if (seen.has(value)) return;
    seen.add(value);
    recordString(value.name, `${path}.name`, secrets, all, findings);
    recordString(value.message, `${path}.message`, secrets, all, findings);
    if (typeof value.stack === 'string') {
      recordString(value.stack, `${path}.stack`, secrets, all, findings);
    }
    if (value.cause !== undefined) {
      scanInto(value.cause, `${path}.cause`, secrets, all, findings, seen);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
      scanInto(entry, `${path}.${redact(key, all)}`, secrets, all, findings, seen);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((entry, index) => {
      scanInto(entry, `${path}[${String(index)}]`, secrets, all, findings, seen);
    });
    return;
  }
  if (value instanceof Map) {
    if (seen.has(value)) return;
    seen.add(value);
    let index = 0;
    for (const [key, entry] of value) {
      const keyPath = `${path}{key:${String(index)}}`;
      scanInto(key, keyPath, secrets, all, findings, seen);
      scanInto(entry, `${path}{value:${String(index)}}`, secrets, all, findings, seen);
      index += 1;
    }
    return;
  }
  if (value instanceof Set) {
    if (seen.has(value)) return;
    seen.add(value);
    let index = 0;
    for (const entry of value) {
      scanInto(entry, `${path}{${String(index)}}`, secrets, all, findings, seen);
      index += 1;
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, entry] of Object.entries(value)) {
      // A key can itself be a leaked value; report that under an opaque path so
      // the finding's own path never carries the secret.
      if (containsSecret(key, all)) {
        findings.push({
          path: `${path}.*`,
          secretIndex: matchingIndex(key, secrets),
          preview: previewOf(key, all),
        });
      }
      scanInto(entry, `${path}.${redact(key, all)}`, secrets, all, findings, seen);
    }
  }
}

function recordString(
  text: string,
  path: string,
  secrets: readonly ScanSecret[],
  all: readonly string[],
  findings: LeakFinding[],
): void {
  for (const secret of secrets) {
    if (text.includes(secret.value)) {
      findings.push({ path, secretIndex: secret.index, preview: previewOf(text, all) });
    }
  }
}

function matchingIndex(text: string, secrets: readonly ScanSecret[]): number {
  return secrets.find((secret) => text.includes(secret.value))?.index ?? -1;
}

function previewOf(text: string, knownSecrets: readonly string[]): string {
  const masked = redact(text, knownSecrets);
  return masked.length > PREVIEW_LENGTH ? `${masked.slice(0, PREVIEW_LENGTH - 1)}…` : masked;
}

/**
 * The known values to scan/redact with, longest first and deduplicated.
 *
 * Empty strings are dropped: they would match every text and mask it entirely.
 */
function orderedSecrets(knownSecrets: readonly string[]): readonly string[] {
  return [...new Set(knownSecrets.filter((secret) => secret !== ''))].sort(
    (left, right) => right.length - left.length,
  );
}
