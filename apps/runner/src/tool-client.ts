/**
 * The Runner's client for `tool.execute` (`docs/architecture/protocol.md` §6).
 *
 * §6 gives the internal tool method as
 *
 * > tool.execute* | attemptId,epoch,toolName,args,expectedInputHash? | accepted或工具结果Ref
 *
 * and `reliability.md` §2 fixes what the idempotency binding must be: "once Grant的消费与
 * prepared在同一事务保存consumedByOperationId/inputHash；同操作同Hash重取原结果，不重复
 * 消费，同操作不同Hash拒绝". This module is the Runner half of that contract:
 *
 * - the **arguments hash** is `sha256(canonicalJson(args))`, computed with the same
 *   `@agentdev/contracts` function Core uses, because two canonicalisers that disagreed
 *   would turn every retry into an `IDEMPOTENCY_CONFLICT`;
 * - the **tool-operation id** is derived deterministically from
 *   `(attemptId, role, toolName, toolCallId)`, so a transport retry of one Pi tool call
 *   reuses the same id while a *second* model call with the same arguments is a new
 *   operation (`reliability.md` §2: a non-idempotent effect is never replayed silently);
 * - the **timeout is per tool**, not the 30s control-channel timeout
 *   (`control-client.ts`): a shell command may legitimately run for the Grant's whole
 *   `maxDurationSec` (up to `LIMITS.shellTimeoutSec.max`, 1800s);
 * - a retry happens **only** when no response body was received. A refusal is an answer:
 *   retrying it would replay a decision Core already made.
 *
 * A refusal is reported to the model as an error result carrying the protocol code, so a
 * correctable `VALIDATION_ERROR` lets it fix the call while a terminal `NOT_AUTHORIZED`
 * tells it to ask for authorization instead. That second half is deliberately narrow
 * after the first-phase permission model (`T3-implementation.md` 附录 A): a call the user
 * decision could admit (`details.approvable === true`, i.e. an environment operation) still
 * posts `permission.request` with the very operation id and hash it just used, so Core
 * records a decision whose approval can only admit *this* call. A **phase-1 hard block**
 * (`details.approvable === false` — a sensitive file, a loopback/metadata target, an
 * outside-workspace delete, a Git-ref change) is final: the typed refusal goes straight to
 * the model, no decision is recorded, and the Run is never parked on a call no approval
 * could admit.
 */
import { createHash } from 'node:crypto';
import { LIMITS, READ_LEDGER_SEAL_GENESIS, canonicalJson } from '@agentdev/contracts';
import type { BrokerToolName } from '@agentdev/contracts';
import type { ToolBridge } from './tools.js';

/** The result of one tool call, as the Pi tool text plus its protocol facts. */
/** What the endpoint answered for a `permission.request` (`protocol.md` §4). */
export interface PermissionRequestResult {
  readonly decisionId?: string;
  readonly status?: string;
}

export interface ToolCallResult {
  /** The text the model sees. */
  readonly text: string;
  readonly isError?: boolean;
  /** `executed` or `replayed` on success; absent on a refusal. */
  readonly status?: 'executed' | 'replayed';
  /** The protocol error code on a refusal (`protocol.md` §7). */
  readonly code?: string;
  /**
   * Whether a user decision could admit this refused call (`tool-handler.ts`).
   *
   * `false` marks a phase-1 hard block — a sensitive file, a loopback/metadata target, an
   * outside-workspace delete, a Git-ref change. The refusal text already tells the model
   * not to retry, and `execute` must not open a `permission.request` for it, because no
   * approval could ever admit the call (附录 A.1/A.4).
   */
  readonly approvable?: boolean;
  readonly toolOperationId: string;
  readonly inputHash: string;
  readonly resultRef?: string;
  readonly truncated?: boolean;
  readonly durationMs?: number;
  /** The Attempt's read-ledger binding after this call (`AC-085`), when Core reported one. */
  readonly ledger?: ReadLedgerBinding;
}

/**
 * The `(seq, hash)` a stage result must report (`AC-085`).
 *
 * The Runner never computes it from the filesystem: Core records every read, sends the
 * binding with each `tool.execute` answer, and the Runner reports the last one it saw.
 * Before any read the binding is the documented empty seal, derived here from the same
 * genesis string Core uses (`sha256(genesis)`) — not a placeholder.
 */
export interface ReadLedgerBinding {
  readonly seq: number;
  readonly hash: string;
}

/** The binding an Attempt that has not read anything reports. */
export function emptyReadLedgerBinding(): ReadLedgerBinding {
  return {
    seq: 0,
    hash: createHash('sha256').update(READ_LEDGER_SEAL_GENESIS).digest('hex'),
  };
}

export interface ToolClientOptions {
  /** Base URL of the Core control endpoint, e.g. `http://127.0.0.1:51234`. */
  readonly url: string;
  /** The short-lived attempt capability (`execution.md` §2). */
  readonly capability: string;
  readonly attemptId: string;
  readonly epoch: number;
  /** The Run's role; part of the derived tool-operation id. */
  readonly role: string;
  /**
   * Default deadline for one tool call.
   *
   * Defaults to `LIMITS.shellTimeoutSec.default` (120s). A Grant may authorize up to
   * `LIMITS.shellTimeoutSec.max`; the endpoint re-checks the requested deadline against
   * the Grant and answers `BUDGET_EXCEEDED` rather than running longer.
   */
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly log?: (line: string) => void;
  /** Injectable for tests; only used to keep derived keys deterministic. */
  readonly randomSuffix?: () => string;
}

/** `sha256(canonicalJson(value))`: the digest a tool call is bound to. */
export function toolInputHash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value ?? {}))
    .digest('hex');
}

/**
 * A UUIDv7-shaped id derived from a seed.
 *
 * `tool_operation.id` is an entity reference, so it must have the contract's UUID form;
 * the value must also be *stable* for one Pi tool call so a transport retry is a replay.
 * The version and variant bits are set as the contract requires; the timestamp bits are
 * the digest's, which is fine because this id is a key, not a clock reading.
 */
export function derivedToolOperationId(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Renders an arbitrary tool result as the text the model reads. */
function resultText(result: unknown, ref: string | null, truncated: boolean): string {
  const body = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  if (!truncated) return body ?? 'null';
  return [
    body ?? 'null',
    '',
    `[result truncated: the complete value is stored under resultRef ${ref ?? '<missing>'}]`,
  ].join('\n');
}

export interface ToolClient extends ToolBridge {
  /** The derived ids for one call, exposed so tests can assert idempotency. */
  derive(input: {
    readonly toolName: string;
    readonly args: unknown;
    readonly toolCallId: string;
  }): { readonly toolOperationId: string; readonly inputHash: string };
  /**
   * Asks Core to record a user decision for the tool call that was just refused.
   *
   * Best effort by design: if the request itself fails, the original `NOT_AUTHORIZED`
   * refusal is still what the model is told — inventing "waiting for approval" for a call
   * Core never recorded would strand the Run.
   */
  requestPermission(input: {
    readonly toolName: BrokerToolName;
    readonly args: Record<string, unknown>;
    readonly toolCallId: string;
    readonly timeoutMs?: number;
  }): Promise<PermissionRequestResult | undefined>;
  /** The Attempt's read-ledger binding (`AC-085`): the last value Core reported. */
  readLedgerBinding(): ReadLedgerBinding;
  /** One call with its protocol facts, for the Runner's own logging and for tests. */
  call(input: {
    readonly toolName: BrokerToolName;
    readonly args: Record<string, unknown>;
    readonly toolCallId: string;
    readonly signal?: AbortSignal | undefined;
    readonly timeoutMs?: number;
  }): Promise<ToolCallResult>;
}

interface WireAnswer {
  readonly status: number;
  readonly body: unknown;
}

function errorOf(
  body: unknown,
): { code: string; message: string; approvable?: boolean } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  // The endpoint says whether a user decision could change this refusal
  // (`tool-handler.ts`). Absent means "the server did not say", which is read as
  // approvable so a version skew cannot silently drop the approval chain.
  const details = (error as { details?: unknown }).details;
  const approvable =
    typeof details === 'object' && details !== null
      ? (details as { approvable?: unknown }).approvable
      : undefined;
  return {
    code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
    message: typeof message === 'string' ? message : 'the tool endpoint refused the call',
    ...(typeof approvable === 'boolean' ? { approvable } : {}),
  };
}

/**
 * Creates one Attempt's tool client.
 *
 * `execute` is the {@link ToolBridge} `roleTools` binds into the Pi tool specs; `call`
 * is the same call with the protocol facts kept.
 */
/** Reads a `ledger` member off the wire, ignoring anything malformed. */
function readLedgerOf(value: unknown): ReadLedgerBinding | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const seq = (value as { seq?: unknown }).seq;
  const hash = (value as { hash?: unknown }).hash;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return undefined;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return undefined;
  return { seq, hash };
}

export function createToolClient(options: ToolClientOptions): ToolClient {
  const doFetch = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => undefined);
  const defaultTimeoutMs = options.timeoutMs ?? LIMITS.shellTimeoutSec.default * 1000;
  // Starts at the documented empty binding and is replaced by every answer that carries one.
  let currentLedger: ReadLedgerBinding = emptyReadLedgerBinding();

  function derive(input: {
    readonly toolName: string;
    readonly args: unknown;
    readonly toolCallId: string;
  }): { toolOperationId: string; inputHash: string } {
    // An empty tool-call id (a direct library invocation) still has to produce a stable
    // key, so the seed falls back to the canonical arguments rather than colliding every
    // such call on one id.
    const callId =
      input.toolCallId === '' ? `no-call-id:${canonicalJson(input.args ?? {})}` : input.toolCallId;
    return {
      toolOperationId: derivedToolOperationId(
        `${options.attemptId}|${options.role}|${input.toolName}|${callId}`,
      ),
      inputHash: toolInputHash(input.args ?? {}),
    };
  }

  /**
   * Operation ids of calls this Attempt was **refused** for, keyed by their semantics.
   *
   * `protocol.md` §4: the user approves *this* call and the model then **retries the same
   * call** — but a retry is a new SDK tool call with a new call id, so a `toolOperationId`
   * derived from the call id would name a different operation and the approved `once` Grant
   * (bound to the first id and its `inputHash`) could never admit it. Reusing the refused
   * call's identity makes the approval mean what the user clicked, without weakening the
   * binding: different arguments hash differently, get a new id and stay refused (WP-12 R7).
   */
  const refusedOperations = new Map<string, { toolOperationId: string; inputHash: string }>();

  /** The semantics key that survives a retry: the tool plus the exact arguments. */
  function refusedKey(toolName: string, inputHash: string): string {
    return `${toolName}|${inputHash}`;
  }

  /**
   * The identity a call is executed under: the remembered refused one when this exact call
   * was refused before, its own derivation otherwise.
   */
  function identityFor(input: {
    readonly toolName: string;
    readonly args: unknown;
    readonly toolCallId: string;
  }): { toolOperationId: string; inputHash: string; key: string } {
    const derived = derive(input);
    const key = refusedKey(input.toolName, derived.inputHash);
    const remembered = refusedOperations.get(key);
    return remembered === undefined ? { ...derived, key } : { ...remembered, key };
  }

  async function post(
    body: Record<string, unknown>,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<WireAnswer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await doFetch(`${options.url}/control/tool.execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.capability}`,
        },
        body: JSON.stringify({ attemptId: options.attemptId, epoch: options.epoch, ...body }),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim().length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      return { status: response.status, body: parsed };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function call(input: {
    readonly toolName: BrokerToolName;
    readonly args: Record<string, unknown>;
    readonly toolCallId: string;
    readonly signal?: AbortSignal | undefined;
    readonly timeoutMs?: number;
  }): Promise<ToolCallResult> {
    const { toolOperationId, inputHash, key } = identityFor(input);
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const body = {
      toolName: input.toolName,
      args: input.args,
      toolOperationId,
      expectedInputHash: inputHash,
      timeoutMs,
    };
    const startedAt = Date.now();
    let answer: WireAnswer | undefined;
    let lastError: unknown;
    // Exactly one retry, and only when no response body arrived: a refusal is an answer
    // and must not be replayed, while a connection that broke before answering left the
    // server side keyed on the same operation id (so the retry is a replay, not a rerun).
    for (let attempt = 0; attempt < 2 && answer === undefined; attempt += 1) {
      try {
        answer = await post(body, timeoutMs, input.signal);
      } catch (error) {
        lastError = error;
        log(`tool: ${input.toolName} transport attempt ${String(attempt + 1)} failed`);
      }
    }
    if (answer === undefined) {
      return {
        text: `TOOL_UNREACHABLE: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
        isError: true,
        toolOperationId,
        inputHash,
      };
    }
    const durationMs = Date.now() - startedAt;
    if (answer.status < 200 || answer.status >= 300) {
      const error = errorOf(answer.body) ?? {
        code: 'INTERNAL_ERROR',
        message: `HTTP ${String(answer.status)}`,
      };
      if (error.code === 'NOT_AUTHORIZED') {
        // Remember the identity the user will be asked to approve, so the retry after the
        // approval lands on the same operation (`protocol.md` §4).
        refusedOperations.set(key, { toolOperationId, inputHash });
      }
      return {
        text: `${error.code}: ${error.message}`,
        isError: true,
        code: error.code,
        toolOperationId,
        inputHash,
        durationMs,
        ...(error.approvable === undefined ? {} : { approvable: error.approvable }),
      };
    }
    // The call was admitted (or replayed): the refusal, if any, is settled, and a *later*
    // identical call is its own operation again rather than a replay of this one.
    refusedOperations.delete(key);
    const parsed = (answer.body ?? {}) as {
      status?: unknown;
      result?: unknown;
      resultRef?: unknown;
      truncated?: unknown;
      toolOperationId?: unknown;
      ledger?: unknown;
    };
    const status = parsed.status === 'replayed' ? 'replayed' : 'executed';
    const resultRef = typeof parsed.resultRef === 'string' ? parsed.resultRef : null;
    const truncated = parsed.truncated === true;
    const operationId =
      typeof parsed.toolOperationId === 'string' ? parsed.toolOperationId : toolOperationId;
    const ledger = readLedgerOf(parsed.ledger);
    if (ledger !== undefined) currentLedger = ledger;
    return {
      text: resultText(parsed.result, resultRef, truncated),
      status,
      toolOperationId: operationId,
      inputHash,
      ...(resultRef === null ? {} : { resultRef }),
      truncated,
      durationMs,
      ...(ledger === undefined ? {} : { ledger }),
    };
  }

  /**
   * Asks Core to record a user decision for the tool call that was just refused.
   *
   * Best effort by design: if the request itself fails, the original `NOT_AUTHORIZED`
   * refusal is still what the model is told — inventing "waiting for approval" for a call
   * Core never recorded would strand the Run.
   */
  async function requestPermission(input: {
    readonly toolName: BrokerToolName;
    readonly args: Record<string, unknown>;
    readonly toolCallId: string;
    readonly timeoutMs?: number;
  }): Promise<PermissionRequestResult | undefined> {
    // The same identity the refused `call()` used, so the Decision and the Grant bind the
    // operation the model will retry (`identityFor`, not a fresh derivation).
    const { toolOperationId, inputHash } = identityFor(input);
    try {
      const response = await doFetch(`${options.url}/control/permission.request`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.capability}`,
        },
        body: JSON.stringify({
          attemptId: options.attemptId,
          epoch: options.epoch,
          toolName: input.toolName,
          args: input.args,
          toolOperationId,
          inputHash,
        }),
        signal: AbortSignal.timeout(input.timeoutMs ?? defaultTimeoutMs),
      });
      const text = await response.text();
      if (!response.ok) {
        log(
          `tool: permission.request for ${input.toolName} was refused (HTTP ${String(response.status)})`,
        );
        return undefined;
      }
      const parsed = text.trim() === '' ? {} : (JSON.parse(text) as PermissionRequestResult);
      log(
        `tool: permission.request for ${input.toolName} recorded (${parsed.decisionId ?? 'no id'})`,
      );
      return parsed;
    } catch (error) {
      log(
        `tool: permission.request for ${input.toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  return {
    derive,
    call,
    requestPermission,
    readLedgerBinding: () => ({ ...currentLedger }),
    execute: async (input) => {
      const result = await call(input);
      log(`tool: ${input.toolName} -> ${result.status ?? result.code ?? 'error'}`);
      if (
        result.isError === true &&
        result.code === 'NOT_AUTHORIZED' &&
        result.approvable !== false
      ) {
        // `protocol.md` §4: the refused call becomes a pending user decision, and the model
        // is told to wait rather than retry blindly. A permission request Core did not
        // record leaves the plain refusal: promising a decision that does not exist would
        // strand the Run.
        //
        // `approvable === false` is the phase-1 hard block (`T3-implementation.md` 附录 A.1):
        // a sensitive file, a loopback/metadata address, an outside-workspace delete or a
        // Git-ref change is refused by policy, not by a missing Grant, so the typed refusal
        // goes to the model **without** parking the Run on a decision that could never admit
        // it. That is the "zero prompts during a run" half of W1.
        const asked = await requestPermission(input);
        if (asked === undefined) return { text: result.text, isError: true };
        const decision = asked.decisionId === undefined ? '' : ` (decision ${asked.decisionId})`;
        return {
          text: `${result.text}; a permission request was recorded${decision}; wait for the user's decision, then retry this call`,
          isError: true,
        };
      }
      return result.isError === true ? { text: result.text, isError: true } : { text: result.text };
    },
  };
}
